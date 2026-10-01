using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using WebTools.NativeHost.Catalog;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Diagnostics;
using WebTools.NativeHost.Services;
using WpfApplication = System.Windows.Application;
using WpfMessageBox = System.Windows.MessageBox;
using WpfMessageBoxButton = System.Windows.MessageBoxButton;
using WpfMessageBoxImage = System.Windows.MessageBoxImage;

namespace WebTools.NativeHost;

public partial class App : WpfApplication
{
    private const string MutexName = @"Local\WebTools.NativeHost";
    private static readonly string ManagerPipeName = NativeManagerPipeServer.DefaultPipeName;
    private readonly CancellationTokenSource _hostCancellation = new();
    private Mutex? _singleInstanceMutex;
    private bool _ownsSingleInstanceMutex;
    private bool _hostResourcesCleaned;
    private int _exitRequested;
    private bool _useLoginStartupRegistry;
    private DiagnosticsService? _diagnostics;
    private LauncherStateStore? _stateStore;
    private NativeManagerPipeServer? _pipeServer;
    private ManagerController? _managerController;
    private MainWindow? _launcherWindow;
    private TrayIconService? _trayIcon;
    private Task? _pipeTask;
    private Phase4EResourceControlServer? _phase4eResourceControl;
    private Task? _phase4eResourceControlTask;
    private UpdatePreparationServer? _updatePreparationServer;
    private Task? _updatePreparationTask;

    protected override void OnStartup(StartupEventArgs e)
    {
        var startupTimestamp = Stopwatch.GetTimestamp();
        base.OnStartup(e);
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        _diagnostics = new DiagnosticsService(startupTimestamp);
        _diagnostics.Record("process_start", Environment.ProcessId.ToString());
        _diagnostics.Record("runtime", $"os={Environment.OSVersion};dotnet={Environment.Version};arch={RuntimeInformation.ProcessArchitecture}");
        foreach (var display in MonitorPlacement.DescribeDisplays()) _diagnostics.Record("display", display);

        Phase4EResourceTestOptions? resourceTest = null;
        try
        {
            resourceTest = Phase4EResourceTestOptions.Parse(e.Args);
            if (resourceTest is not null)
            {
                var isolatedStatePath = Path.Combine(resourceTest.ProfileRoot, "launcher-state.json");
                if (!File.Exists(isolatedStatePath) || !File.Exists(resourceTest.CatalogSnapshotPath))
                    throw new InvalidDataException("The isolated Phase 4E resource test profile or catalog snapshot is missing.");
            }

            var testMutexSuffix = resourceTest is null ? "" : $".Phase4E.{resourceTest.ControlPipeName[(resourceTest.ControlPipeName.LastIndexOf('.') + 1)..]}";
            _singleInstanceMutex = new Mutex(false, MutexName + testMutexSuffix);
            try { _ownsSingleInstanceMutex = _singleInstanceMutex.WaitOne(0, false); }
            catch (AbandonedMutexException) { _ownsSingleInstanceMutex = true; _diagnostics.Record("mutex", "recovered-abandoned-instance"); }
            if (!_ownsSingleInstanceMutex)
            {
                _diagnostics.Record("secondary_instance", "exiting");
                Shutdown();
                return;
            }

            var allowDevelopmentManager = e.Args.Contains("--manager-dev", StringComparer.Ordinal);
            var profileDirectory = allowDevelopmentManager ? "WebTools-Dev" : "Nook";
            var profilePath = resourceTest?.ProfileRoot ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), profileDirectory);
            _stateStore = new LauncherStateStore(Path.Combine(profilePath, "launcher-state.json"));
            _useLoginStartupRegistry = !allowDevelopmentManager && resourceTest is null;
            var state = _stateStore.LoadOrMigrate(Path.Combine(profilePath, "nook-data.json"), out var migrationStatus);
            _diagnostics.Record("launcher_state_loaded", migrationStatus);
            if (_useLoginStartupRegistry)
            {
                try { LoginStartupService.Apply(state.LaunchOnStartup); }
                catch (Exception error) { _diagnostics.Record("login_startup_apply_error", error.GetType().Name); }
            }

            var managerPipeName = resourceTest is null ? ManagerPipeName : $"{ManagerPipeName}.Phase4E.{resourceTest.ControlPipeName[(resourceTest.ControlPipeName.LastIndexOf('.') + 1)..]}";
            _pipeServer = new NativeManagerPipeServer(
                managerPipeName,
                _stateStore,
                ApplyLauncherSettingsAsync,
                ReplaceWebsitesAsync,
                RememberApplicationAsync,
                _diagnostics);
            _pipeTask = _pipeServer.RunAsync(_hostCancellation.Token);

            var processLauncher = new ManagerProcessLauncher(allowDevelopmentManager);
            _managerController = new ManagerController(_pipeServer, processLauncher, _diagnostics, ShowManagerError);
            if (resourceTest is null)
            {
                _updatePreparationServer = new UpdatePreparationServer(
                    UpdatePreparationServer.DefaultPipeName,
                    (timeout, cancellationToken) => _managerController?.TryPrepareForUpdateAsync(timeout, cancellationToken) ?? Task.FromResult(true),
                    () =>
                    {
                        Dispatcher.BeginInvoke(new Action(() => _launcherWindow?.Close()));
                        return Task.CompletedTask;
                    },
                    message => _diagnostics.Record("update_pipe", message));
                _updatePreparationTask = _updatePreparationServer.RunAsync(_hostCancellation.Token);
            }
            _launcherWindow = new MainWindow(
                _diagnostics,
                _stateStore,
                state,
                new AppCatalogSnapshotStore(resourceTest?.CatalogSnapshotPath ?? AppCatalogSnapshotStore.DefaultPath),
                _managerController,
                resourceTest is not null);
            MainWindow = _launcherWindow;
            var handle = new WindowInteropHelper(_launcherWindow).EnsureHandle();
            _launcherWindow.RegisterHotkey(handle, resourceTest?.Hotkey);
            if (resourceTest is null)
            {
                _trayIcon = new TrayIconService(
                    () => _managerController.OpenPage(ManagerPage.Favorites),
                    () => _managerController.OpenPage(ManagerPage.Entries),
                    () => _managerController.OpenPage(ManagerPage.Settings),
                    () => _managerController.OpenPage(ManagerPage.Translation),
                    () => Dispatcher.BeginInvoke(new Action(() => _launcherWindow?.ShowFromTray())),
                    () => Dispatcher.BeginInvoke(new Action(() => _ = ExitApplicationAsync())));
                _launcherWindow.EffectiveThemeChanged += _trayIcon.ApplyEffectiveTheme;
                _trayIcon.ApplyEffectiveTheme(LauncherThemePalette.ResolveEffectiveTheme(state.Theme, PackagedIconResolver.GetCurrentSystemTheme()));
            }
            _launcherWindow.Closing += (_, _) => CleanupHostResources();
            _launcherWindow.Closed += (_, _) =>
            {
                ReleaseSingleInstanceMutex();
                Shutdown();
            };

            var activeShortcut = resourceTest?.Hotkey ?? state.QuickSearchShortcut;
            _diagnostics.Record("host_ready", $"hotkey={activeShortcut};tray={(_trayIcon is null ? "omitted-test-mode" : "visible")};pipe={managerPipeName}");
            _diagnostics.RecordStartupReady();
            if (resourceTest is not null)
            {
                _phase4eResourceControl = new Phase4EResourceControlServer(resourceTest.ControlPipeName, _launcherWindow, resourceTest.Hotkey);
                _phase4eResourceControlTask = _phase4eResourceControl.RunAsync(_hostCancellation.Token);
            }
            _ = _launcherWindow.InitializeSearchAsync();
        }
        catch (Win32Exception exception)
        {
            _diagnostics.Record("startup_error", $"{exception.NativeErrorCode}: {exception.Message}");
            if (resourceTest is not null) { Shutdown(1); return; }
            WpfMessageBox.Show($"WebTools Native Host could not start.\n{exception.Message}\nWin32 error: {exception.NativeErrorCode}", "WebTools Native Host", WpfMessageBoxButton.OK, WpfMessageBoxImage.Error);
            Shutdown(1);
        }
        catch (Exception exception)
        {
            _diagnostics.Record("startup_error", exception.ToString());
            if (resourceTest is not null) { Shutdown(1); return; }
            WpfMessageBox.Show($"WebTools Native Host could not start.\n{exception.Message}", "WebTools Native Host", WpfMessageBoxButton.OK, WpfMessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        CleanupHostResources();
        _hostCancellation.Cancel();
        try { _pipeTask?.Wait(TimeSpan.FromSeconds(2)); }
        catch (AggregateException error) { _diagnostics?.Record("pipe_task_exit_error", error.GetBaseException().GetType().Name); }
        try { _phase4eResourceControlTask?.Wait(TimeSpan.FromSeconds(2)); }
        catch (AggregateException error) { _diagnostics?.Record("resource_control_exit_error", error.GetBaseException().GetType().Name); }
        try { _updatePreparationTask?.Wait(TimeSpan.FromSeconds(2)); }
        catch (AggregateException error) { _diagnostics?.Record("update_pipe_exit_error", error.GetBaseException().GetType().Name); }
        try { _pipeServer?.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
        catch (Exception error) { _diagnostics?.Record("pipe_cleanup_error", error.GetType().Name); }
        ReleaseSingleInstanceMutex();
        _singleInstanceMutex?.Dispose();
        _hostCancellation.Dispose();
        _diagnostics?.Record("host_exit", "clean");
        _diagnostics?.Flush();
        base.OnExit(e);
    }

    private async Task<LauncherState> ApplyLauncherSettingsAsync(LauncherSettingsUpdate update)
    {
        var store = _stateStore ?? throw new InvalidOperationException("Launcher state is not ready.");
        var previous = store.Snapshot;
        var next = LauncherStateStore.ApplySettings(previous, update);
        var shortcutChanged = next.QuickSearchShortcut != previous.QuickSearchShortcut;
        var startupChanged = next.LaunchOnStartup != previous.LaunchOnStartup;
        var hotkeyChanged = false;
        var startupApplied = false;

        if (shortcutChanged)
        {
            var changed = await Dispatcher.InvokeAsync(() => _launcherWindow?.TryReplaceHotkey(next.QuickSearchShortcut, out var _error) == true);
            if (!changed) throw new NativeManagerRequestException("HOTKEY_UNAVAILABLE", "无法注册新快捷键，原快捷键仍保持有效。");
            hotkeyChanged = true;
        }

        try
        {
        if (startupChanged && _useLoginStartupRegistry)
            {
                LoginStartupService.Apply(next.LaunchOnStartup);
                startupApplied = true;
            }
            var persisted = await store.UpdateAsync(current => LauncherStateStore.ApplySettings(current, update)).ConfigureAwait(false);
            await ApplyStateToWindowAsync(persisted).ConfigureAwait(false);
            _diagnostics?.Record("launcher_settings_persisted", "native-state");
            return persisted;
        }
        catch
        {
            if (startupApplied)
            {
                try { LoginStartupService.Apply(previous.LaunchOnStartup); }
                catch (Exception error) { _diagnostics?.Record("login_startup_rollback_error", error.GetType().Name); }
            }
            if (hotkeyChanged)
            {
                await Dispatcher.InvokeAsync(() => _launcherWindow?.TryReplaceHotkey(previous.QuickSearchShortcut, out var _error));
            }
            try
            {
                var restored = await store.UpdateAsync(current => LauncherStateStore.RestoreUpdatedSettings(current, previous, update)).ConfigureAwait(false);
                await ApplyStateToWindowAsync(restored).ConfigureAwait(false);
            }
            catch (Exception error) { _diagnostics?.Record("launcher_settings_rollback_error", error.GetType().Name); }
            throw;
        }
    }

    private async Task<LauncherState> ReplaceWebsitesAsync(IReadOnlyList<LauncherWebsiteRecord> websites)
    {
        var store = _stateStore ?? throw new InvalidOperationException("Launcher state is not ready.");
        var state = await store.ReplaceWebsitesAsync(websites).ConfigureAwait(false);
        await ApplyStateToWindowAsync(state).ConfigureAwait(false);
        return state;
    }

    private async Task<LauncherState> RememberApplicationAsync(string query, string appId)
    {
        var store = _stateStore ?? throw new InvalidOperationException("Launcher state is not ready.");
        var state = await store.RememberApplicationAsync(query, appId).ConfigureAwait(false);
        await ApplyStateToWindowAsync(state).ConfigureAwait(false);
        return state;
    }

    private async Task ApplyStateToWindowAsync(LauncherState state)
    {
        var window = _launcherWindow;
        if (window is null || window.Dispatcher.HasShutdownStarted) return;
        var apply = await window.Dispatcher.InvokeAsync(() => window.ApplyLauncherStateAsync(state));
        await apply.ConfigureAwait(false);
    }

    private void ShowManagerError(string message)
    {
        Dispatcher.BeginInvoke(new Action(() =>
        {
            _launcherWindow?.ShowManagerError(message);
            WpfMessageBox.Show(message, "WebTools", WpfMessageBoxButton.OK, WpfMessageBoxImage.Warning);
        }));
    }

    private async Task ExitApplicationAsync()
    {
        if (Interlocked.Exchange(ref _exitRequested, 1) != 0) return;
        try { if (_managerController is not null) await _managerController.ShutdownAsync(); }
        catch (Exception error) { _diagnostics?.Record("manager_shutdown_error", error.GetType().Name); }
        if (_launcherWindow is not null) _launcherWindow.Close();
        else Shutdown();
    }

    private void CleanupHostResources()
    {
        if (_hostResourcesCleaned) return;
        _hostResourcesCleaned = true;
        _launcherWindow?.DisposeNativeResources();
        if (_launcherWindow is not null && _trayIcon is not null)
            _launcherWindow.EffectiveThemeChanged -= _trayIcon.ApplyEffectiveTheme;
        _trayIcon?.Dispose();
        _trayIcon = null;
        _managerController?.Dispose();
        _managerController = null;
        _hostCancellation.Cancel();
    }

    private void ReleaseSingleInstanceMutex()
    {
        if (!_ownsSingleInstanceMutex) return;
        try { _singleInstanceMutex?.ReleaseMutex(); }
        catch (ApplicationException) { _diagnostics?.Record("cleanup_error", "mutex ownership was lost"); }
        _ownsSingleInstanceMutex = false;
    }
}
