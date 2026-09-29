using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using WebTools.NativeHost.Catalog;
using WebTools.NativeHost.Data;
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

    protected override void OnStartup(StartupEventArgs e)
    {
        var startupTimestamp = Stopwatch.GetTimestamp();
        base.OnStartup(e);
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        _diagnostics = new DiagnosticsService(startupTimestamp);
        _diagnostics.Record("process_start", Environment.ProcessId.ToString());
        _diagnostics.Record("runtime", $"os={Environment.OSVersion};dotnet={Environment.Version};arch={RuntimeInformation.ProcessArchitecture}");
        foreach (var display in MonitorPlacement.DescribeDisplays()) _diagnostics.Record("display", display);

        try
        {
            _singleInstanceMutex = new Mutex(false, MutexName);
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
            var profilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), profileDirectory);
            _stateStore = new LauncherStateStore(Path.Combine(profilePath, "launcher-state.json"));
            _useLoginStartupRegistry = !allowDevelopmentManager;
            var state = _stateStore.LoadOrMigrate(Path.Combine(profilePath, "nook-data.json"), out var migrationStatus);
            _diagnostics.Record("launcher_state_loaded", migrationStatus);
            if (_useLoginStartupRegistry)
            {
                try { LoginStartupService.Apply(state.LaunchOnStartup); }
                catch (Exception error) { _diagnostics.Record("login_startup_apply_error", error.GetType().Name); }
            }

            _pipeServer = new NativeManagerPipeServer(
                ManagerPipeName,
                _stateStore,
                ApplyLauncherSettingsAsync,
                ReplaceWebsitesAsync,
                RememberApplicationAsync,
                _diagnostics);
            _pipeTask = _pipeServer.RunAsync(_hostCancellation.Token);

            var processLauncher = new ManagerProcessLauncher(allowDevelopmentManager);
            _managerController = new ManagerController(_pipeServer, processLauncher, _diagnostics, ShowManagerError);
            _launcherWindow = new MainWindow(
                _diagnostics,
                _stateStore,
                state,
                new AppCatalogSnapshotStore(AppCatalogSnapshotStore.DefaultPath),
                _managerController);
            MainWindow = _launcherWindow;
            var handle = new WindowInteropHelper(_launcherWindow).EnsureHandle();
            _launcherWindow.RegisterHotkey(handle);
            _trayIcon = new TrayIconService(
                () => _managerController.OpenPage(ManagerPage.Search),
                () => _managerController.OpenPage(ManagerPage.Entries),
                () => _managerController.OpenPage(ManagerPage.Settings),
                () => _managerController.OpenPage(ManagerPage.Translation),
                () => Dispatcher.BeginInvoke(new Action(() => _launcherWindow?.ShowFromTray())),
                () => Dispatcher.BeginInvoke(new Action(() => _ = ExitApplicationAsync())));
            _launcherWindow.EffectiveThemeChanged += _trayIcon.ApplyEffectiveTheme;
            _trayIcon.ApplyEffectiveTheme(LauncherThemePalette.ResolveEffectiveTheme(state.Theme, PackagedIconResolver.GetCurrentSystemTheme()));
            _launcherWindow.Closing += (_, _) => CleanupHostResources();
            _launcherWindow.Closed += (_, _) =>
            {
                ReleaseSingleInstanceMutex();
                Shutdown();
            };

            _diagnostics.Record("host_ready", $"hotkey={state.QuickSearchShortcut};tray=visible;pipe={ManagerPipeName}");
            _diagnostics.RecordStartupReady();
            _ = _launcherWindow.InitializeSearchAsync();
        }
        catch (Win32Exception exception)
        {
            _diagnostics.Record("startup_error", $"{exception.NativeErrorCode}: {exception.Message}");
            WpfMessageBox.Show($"WebTools Native Host could not start.\n{exception.Message}\nWin32 error: {exception.NativeErrorCode}", "WebTools Native Host", WpfMessageBoxButton.OK, WpfMessageBoxImage.Error);
            Shutdown(1);
        }
        catch (Exception exception)
        {
            _diagnostics.Record("startup_error", exception.ToString());
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
