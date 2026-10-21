using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using WebTools.NativeHost.Catalog;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Diagnostics;
using WebTools.NativeHost.Services;
using WebTools.NativeHost.SuperPanel;
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
    private bool _previewDoesNotOwnStartup;
    private DiagnosticsService? _diagnostics;
    private LauncherStateStore? _stateStore;
    private LauncherPluginProjectionStore? _pluginProjectionStore;
    private NativeFeatureProjectionStore? _featureProjectionStore;
    private NativeManagerPipeServer? _pipeServer;
    private ManagerController? _managerController;
    private MainWindow? _launcherWindow;
    private SuperPanelWindow? _superPanel;
    private SuperPanelTriggerController? _superPanelTriggers;
    private SuperPanelSettingsController? _superPanelSettings;
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
        _diagnostics.Record("host_executable", Environment.ProcessPath ?? AppContext.BaseDirectory);
        var previewMetadataPath = Path.Combine(AppContext.BaseDirectory, "preview-build.json");
        if (File.Exists(previewMetadataPath))
        {
            try
            {
                if (new FileInfo(previewMetadataPath).Length <= 8192)
                {
                    using var metadata = JsonDocument.Parse(File.ReadAllText(previewMetadataPath));
                    if (metadata.RootElement.TryGetProperty("superPanelUxRevision", out var revision) && revision.ValueKind == JsonValueKind.String
                        && revision.GetString() is { Length: <= 64 } label && !label.Any(char.IsControl))
                    {
                        _diagnostics.Record("preview_revision", label);
                        var isSelectionDiagnosticPreview = metadata.RootElement.TryGetProperty("previewName", out var previewName)
                            && previewName.ValueKind == JsonValueKind.String
                            && ((previewName.GetString() == "WebTools-Phase6F3-Selection-Diagnostic-Preview"
                                    && label == "phase6f3-selection-diagnostic")
                                || (previewName.GetString() == "WebTools-Phase6F3-Universal-Selection-Preview"
                                     && label == "phase6f3-universal-selection")
                                 || (previewName.GetString() == "WebTools-SuperPanel-Hardening-R2-Preview"
                                     && label == "superpanel-hardening-r2")
                                 || (previewName.GetString() == "WebTools-SuperPanel-CopyCapture-Preview"
                                     && label == "superpanel-copy-capture"));
                        _diagnostics.SelectionDiagnosticsEnabled = isSelectionDiagnosticPreview;
                    }
                }
            }
            catch (Exception error) { _diagnostics.Record("preview_metadata_error", error.GetType().Name); }
        }
        _diagnostics.Record("runtime", $"os={Environment.OSVersion};dotnet={Environment.Version};arch={RuntimeInformation.ProcessArchitecture}");
        foreach (var display in MonitorPlacement.DescribeDisplays()) _diagnostics.Record("display", display);

        Phase4EResourceTestOptions? resourceTest = null;
        try
        {
            resourceTest = Phase4EResourceTestOptions.Parse(e.Args);
            // Additional bounded driver only after the existing disposable-profile/pipe guard succeeds.
            var superPanelAcceptance = resourceTest is not null
                && Environment.GetEnvironmentVariable("WEBTOOLS_SUPER_PANEL_ACCEPTANCE") == "1";
            if (superPanelAcceptance) _diagnostics.SelectionDiagnosticsEnabled = true;
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
                if (resourceTest is null) ExplainDifferentRunningInstallation();
                Shutdown();
                return;
            }

            var allowDevelopmentManager = e.Args.Contains("--manager-dev", StringComparer.Ordinal);
            var profileDirectory = allowDevelopmentManager ? "WebTools-Dev" : "Nook";
            var profilePath = resourceTest?.ProfileRoot ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), profileDirectory);
            _stateStore = new LauncherStateStore(Path.Combine(profilePath, "launcher-state.json"));
            _pluginProjectionStore = new LauncherPluginProjectionStore(profilePath);
            _featureProjectionStore = new NativeFeatureProjectionStore(profilePath);
            var cachedFeatureProjection = _featureProjectionStore.Load(out var featureCacheStatus);
            _diagnostics.Record("launcher_feature_cache", featureCacheStatus);
            _previewDoesNotOwnStartup = !allowDevelopmentManager && resourceTest is null && LoginStartupService.IsUnregisteredPreview();
            _useLoginStartupRegistry = !allowDevelopmentManager && resourceTest is null && !_previewDoesNotOwnStartup;
            if (_previewDoesNotOwnStartup) _diagnostics.Record("login_startup", "portable-preview-preserves-existing-registration");
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
                _diagnostics,
                ReplacePluginProjectionAsync,
                ReplaceFeatureProjectionAsync);
            var processLauncher = new ManagerProcessLauncher(allowDevelopmentManager, resourceTest?.ProfileRoot);
            _pipeServer.ConfigurePeerAuthenticator(processLauncher.PeerIdentityService);
            _managerController = new ManagerController(_pipeServer, processLauncher, _diagnostics, ShowManagerError,
                sessionPrewarmEnabled: resourceTest is null || Environment.GetEnvironmentVariable("WEBTOOLS_LAUNCHER_SESSION_PREWARM") != "0");
            _pipeTask = _pipeServer.RunAsync(_hostCancellation.Token);
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
            var featureProjectionAtWindowCreation = _featureProjectionStore.Current ?? cachedFeatureProjection;
            _launcherWindow = new MainWindow(
                _diagnostics,
                _stateStore,
                state,
                new AppCatalogSnapshotStore(resourceTest?.CatalogSnapshotPath ?? AppCatalogSnapshotStore.DefaultPath),
                _managerController,
                resourceTest is not null,
                featureProjectionAtWindowCreation,
                featureProjectionAtWindowCreation is not null);
            MainWindow = _launcherWindow;
            var launcherForPluginReturn = _launcherWindow;
            _pipeServer.ConfigureLauncherReturn(() => launcherForPluginReturn.Dispatcher.InvokeAsync(launcherForPluginReturn.ShowEmptyFromPlugin).Task);
            _pipeServer.ConfigureWindowHandoff(async (requestId, target, processId) => await Dispatcher.InvokeAsync(() =>
                launcherForPluginReturn.CompleteWindowHandoff(requestId, target, processId) || _superPanel?.CompleteWindowHandoff(requestId, target, processId) == true));
            var latestFeatureProjection = _featureProjectionStore.Current;
            if (latestFeatureProjection is not null
                && (latestFeatureProjection.HostSessionId != featureProjectionAtWindowCreation?.HostSessionId
                    || latestFeatureProjection.Revision != featureProjectionAtWindowCreation?.Revision))
                _ = ApplyFeatureProjectionAtStartupAsync(_launcherWindow, latestFeatureProjection);
            _launcherWindow.ApplyPluginProjection(_pluginProjectionStore.Load(out var pluginCacheStatus));
            _diagnostics.Record("launcher_plugin_cache", pluginCacheStatus);
            var handle = new WindowInteropHelper(_launcherWindow).EnsureHandle();
            _launcherWindow.RegisterHotkey(handle, resourceTest?.Hotkey);
            if (resourceTest is null || superPanelAcceptance)
            {
                var panelStore = new SuperPanelStateStore(profilePath);
                string? panelLoadWarning = null;
                try { panelStore.Load(); } catch (Exception error)
                {
                    _diagnostics.Record("super_panel_settings_load", error.GetType().Name + ";original-preserved");
                    panelLoadWarning = "Super Panel 配置读取失败，当前使用默认配置，原文件保持不变。可在设置中重新应用配置。";
                }
                _superPanel = new SuperPanelWindow(panelStore, _managerController, _launcherWindow.ReadProjectedFeatureIconAsync,
                    _featureProjectionStore.Current, () => (_stateStore ?? throw new InvalidOperationException("Launcher state is not ready.")).Snapshot.ToWebsiteSnapshot());
                _superPanel.ApplyTheme(LauncherThemePalette.ResolveEffectiveTheme(state.Theme, PackagedIconResolver.GetCurrentSystemTheme()));
                _superPanel.ShowLauncher = _launcherWindow.ShowFromTray;
                _superPanel.ShowWindowHandoff = _launcherWindow.BeginWindowHandoff;
                _superPanelTriggers = new SuperPanelTriggerController(_superPanel, _diagnostics, _launcherWindow.DismissForQuickSurface,
                    _managerController.OpenSuperPanelSettings, notifyCaptureFailure: message => _trayIcon?.ShowSuperPanelCaptureFailure(message));
                var panelSettingsController = new SuperPanelSettingsController(panelStore, _superPanelTriggers);
                _superPanelSettings = panelSettingsController;
                _superPanel.ReadTriggerSettings = panelSettingsController.Read;
                panelSettingsController.Changed += SuperPanelSettingsChanged;
                panelSettingsController.Initialize(panelLoadWarning);
                _pipeServer.ConfigureSuperPanelSettings(
                    async () => await Dispatcher.InvokeAsync(panelSettingsController.Read),
                    async settings => await Dispatcher.InvokeAsync(() => panelSettingsController.Update(settings)));
                _launcherWindow.QuickSurfaceShowing += _superPanelTriggers.DismissForLauncher;
                _launcherWindow.EffectiveThemeChanged += _superPanel.ApplyTheme;
                if (resourceTest is null)
                {
                _trayIcon = new TrayIconService(
                    () => _managerController.OpenPage(ManagerPage.Favorites),
                    () => _managerController.OpenPage(ManagerPage.Entries),
                    () => _managerController.OpenPage(ManagerPage.Settings),
                    () => _managerController.OpenPage(ManagerPage.Translation),
                    () => Dispatcher.BeginInvoke(new Action(() => _launcherWindow?.ShowFromTray())),
                    () => Dispatcher.BeginInvoke(new Action(() => _ = ExitApplicationAsync())),
                    () => Dispatcher.BeginInvoke(new Action(() => _superPanelTriggers?.ShowFromTray())),
                    () => Dispatcher.BeginInvoke(new Action(() => _superPanelTriggers?.ShowSettingsFromTray())));
                _launcherWindow.EffectiveThemeChanged += _trayIcon.ApplyEffectiveTheme;
                _trayIcon.ApplyEffectiveTheme(LauncherThemePalette.ResolveEffectiveTheme(state.Theme, PackagedIconResolver.GetCurrentSystemTheme()));
                if (_superPanelSettings.Read().Error is { } panelError) _trayIcon.ShowSuperPanelTriggerError(panelError);
                }
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
                _phase4eResourceControl = new Phase4EResourceControlServer(resourceTest.ControlPipeName, _launcherWindow, resourceTest.Hotkey,
                    _managerController, superPanelAcceptance ? _superPanelTriggers : null, superPanelAcceptance ? _superPanel : null,
                    superPanelAcceptance ? _diagnostics : null);
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
        if (startupChanged && _previewDoesNotOwnStartup)
            throw new NativeManagerRequestException("STARTUP_UNAVAILABLE", "Portable 预览不修改开机启动项，请在安装版 WebTools 中设置。");

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

    private async Task ReplacePluginProjectionAsync(LauncherPluginProjection projection)
    {
        await (_pluginProjectionStore ?? throw new InvalidOperationException("Plugin cache is not ready.")).SaveAsync(projection).ConfigureAwait(false);
        var window = _launcherWindow;
        if (window is not null && !window.Dispatcher.HasShutdownStarted)
            await window.Dispatcher.InvokeAsync(() => window.ApplyPluginProjection(projection));
    }

    private async Task<NativeFeatureProjectionV2> ReplaceFeatureProjectionAsync(JsonElement payload)
    {
        var result = await (_featureProjectionStore ?? throw new InvalidOperationException("Native Feature cache is not ready."))
            .AcceptAsync(payload).ConfigureAwait(false);
        var window = _launcherWindow;
        if (window is not null && !window.Dispatcher.HasShutdownStarted)
        {
            var apply = await window.Dispatcher.InvokeAsync(() => window.ApplyFeatureProjectionAsync(result.Projection)).Task.ConfigureAwait(false);
            await apply.ConfigureAwait(false);
        }
        _diagnostics?.Record("launcher_feature_projection_updated", $"count={result.Projection.Features.Count};revision={result.Projection.Revision};changed={result.Changed}");
        if (_superPanel is { } panel && !panel.Dispatcher.HasShutdownStarted)
            await panel.Dispatcher.InvokeAsync(() => panel.ApplyProjection(result.Projection));
        return result.Projection;
    }

    private async Task ApplyFeatureProjectionAtStartupAsync(MainWindow window, NativeFeatureProjectionV2 projection)
    {
        try { await window.ApplyFeatureProjectionAsync(projection); }
        catch (Exception error) { _diagnostics?.Record("launcher_feature_projection_startup_apply_error", error.GetType().Name); }
    }

    private void SuperPanelSettingsChanged(SuperPanelSettingsStatus status)
    {
        try { _superPanel?.RefreshTriggerStatus(); }
        catch (Exception error) { _diagnostics?.Record("super_panel_status_display_error", error.GetType().Name); }
        if (_pipeServer?.SupportsSuperPanelSettings == true) _ = NotifySuperPanelSettingsAsync(status);
    }
    private async Task NotifySuperPanelSettingsAsync(SuperPanelSettingsStatus status)
    {
        try { if (_pipeServer is { } server) await server.SendRequestAsync("super-panel-settings-changed", status, TimeSpan.FromSeconds(5), _hostCancellation.Token).ConfigureAwait(false); }
        catch (Exception error)
        { _diagnostics?.Record("super_panel_settings_notification", error.GetType().Name); }
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
        if (_launcherWindow is not null && _superPanelTriggers is not null) _launcherWindow.QuickSurfaceShowing -= _superPanelTriggers.DismissForLauncher;
        if (_launcherWindow is not null && _superPanel is not null) _launcherWindow.EffectiveThemeChanged -= _superPanel.ApplyTheme;
        _superPanelTriggers?.Dispose(); _superPanelTriggers = null;
        if (_superPanelSettings is not null) _superPanelSettings.Changed -= SuperPanelSettingsChanged;
        _superPanelSettings = null;
        _superPanel?.Dispose(); _superPanel = null;
        _launcherWindow?.DisposeNativeResources();
        if (_launcherWindow is not null && _trayIcon is not null)
            _launcherWindow.EffectiveThemeChanged -= _trayIcon.ApplyEffectiveTheme;
        _trayIcon?.Dispose();
        _trayIcon = null;
        _managerController?.Dispose();
        _managerController = null;
        _hostCancellation.Cancel();
    }

    private void ExplainDifferentRunningInstallation()
    {
        foreach (var candidate in Process.GetProcessesByName("WebTools.NativeHost"))
        {
            using (candidate)
            {
                if (candidate.Id == Environment.ProcessId) continue;
                try
                {
                    var image = candidate.MainModule?.FileName;
                    if (image is null || string.Equals(image, Environment.ProcessPath, StringComparison.OrdinalIgnoreCase)) continue;
                    _diagnostics?.Record("secondary_instance_owner", $"pid={candidate.Id};executable={image}");
                    WpfMessageBox.Show($"另一个目录的 WebTools 正在运行。请从该实例的托盘正常退出，再启动当前版本。\n\n正在运行：{image}\n当前入口：{Environment.ProcessPath}",
                        "WebTools 已在其他目录运行", WpfMessageBoxButton.OK, WpfMessageBoxImage.Information);
                    return;
                }
                catch (Exception error) when (error is Win32Exception or InvalidOperationException or NotSupportedException)
                { _diagnostics?.Record("secondary_instance_identity_error", error.GetType().Name); }
            }
        }
    }

    private void ReleaseSingleInstanceMutex()
    {
        if (!_ownsSingleInstanceMutex) return;
        try { _singleInstanceMutex?.ReleaseMutex(); }
        catch (ApplicationException) { _diagnostics?.Record("cleanup_error", "mutex ownership was lost"); }
        _ownsSingleInstanceMutex = false;
    }
}
