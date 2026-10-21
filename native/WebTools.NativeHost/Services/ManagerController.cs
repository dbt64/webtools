using System.Diagnostics;
using System.IO;
using System.Text.Json;
using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.Services;

public enum ManagerPage { Favorites, Entries, Settings, Translation }

public sealed class ManagerController : IDisposable
{
    internal async Task<bool> TryFocusCurrentTemporaryWindowAsync()
    {
        // Summoning search must not start Electron or replay a cached plugin identity.
        if (!_pipeServer.IsConnected || !_pipeServer.SupportsLauncherFeatures) return false;
        try
        {
            var result = await _pipeServer.SendRequestAsync("focus-current-temporary-window", new { }, TimeSpan.FromSeconds(2)).ConfigureAwait(false);
            return result.ValueKind == JsonValueKind.Object && result.TryGetProperty("focused", out var focused) && focused.ValueKind == JsonValueKind.True;
        }
        catch (Exception error) when (error is IOException or TimeoutException or OperationCanceledException or NativeManagerRequestException)
        {
            _diagnostics.Record("plugin_window_focus_unavailable", error.GetType().Name);
            return false;
        }
    }

    private readonly object _sync = new();
    private readonly SemaphoreSlim _startGate = new(1, 1);
    private readonly NativeManagerPipeServer _pipeServer;
    private readonly ManagerProcessLauncher _processLauncher;
    private readonly DiagnosticsService _diagnostics;
    private readonly Action<string> _showError;
    private readonly TimeSpan _rendererReadyTimeout;
    private bool _sessionPrewarmEnabled;
    internal void ConfigureSessionPrewarmForResourceTest(bool enabled) { lock (_sync) _sessionPrewarmEnabled = enabled; }
    internal void DisconnectPipeForResourceTest() => _pipeServer.DisconnectForResourceTest();
    internal void DisconnectAfterHandoffForResourceTest() => _pipeServer.DisconnectAfterHandoffForResourceTest();
    internal void DisconnectDuringInitializationForResourceTest() => _pipeServer.DisconnectDuringInitializationForResourceTest();
    private readonly ManagerRendererReadiness _rendererReadiness = new();
    private readonly ManagerRendererReadiness _hostReadiness = new();
    private readonly ManagerPeerIdentityService _peerIdentityService;
    private Process? _managerProcess;
    private ManagerLaunchIdentity? _managerPeerIdentity;
    private long _managerGeneration;
    private PendingManagerIntent? _pendingIntent;
    private readonly NativeFeatureInvocationQueue _featureInvocations = new();
    private long _intentGeneration;
    private bool _ensuring;
    private bool _shuttingDown;
    private bool _disposed;
    private bool _hostClosing;
    private readonly ElectronHostOwnership _ownership = new();
    private readonly SemaphoreSlim _ownershipSyncGate = new(1, 1);
    internal bool HasLiveElectronHost { get { lock (_sync) return _managerProcess is { } process && !HasExitedOrUnavailable(process); } }
    private void TracePendingWindow(string stage)
    {
        lock (_sync)
        {
            if (_pendingIntent is TranslationIntent translation)
                WindowStartupTrace.Record(stage, translation.RequestId, translation.Source, "webtools.translation", "cold");
            else if (_featureInvocations.Peek() is { } feature)
                WindowStartupTrace.Record(stage, feature.RequestId, feature.Source, feature.Ref.PluginId, "cold");
        }
    }
    public event Action<string, NativeFeatureRef, string, bool>? FeatureInvocationFeedback;
    public event Func<NativeFeatureTextResult, bool>? FeatureQuickResult;
    public event Action<NativeFeatureResultControl>? FeatureQuickResultClear;
    public event Action? QuickResultTransportDisconnected;
    public event Action<NativeFeatureProjectionV2?>? DevelopmentProjectionChanged;
    public event Func<NativeFeatureAIConfirmation, bool>? FeatureQuickResultConfirmation;
    public event Func<NativeFeatureResultControl?>? AcceptedQuickResultRequested;
    public NativeFeatureProjectionV2? DevelopmentProjection { get; private set; }
    private bool ReceiveQuickResult(NativeFeatureTextResult result) => FeatureQuickResult?.Invoke(result) == true;
    private void ClearQuickResult(NativeFeatureResultControl clear) => FeatureQuickResultClear?.Invoke(clear);
    private bool ReceiveQuickResultConfirmation(NativeFeatureAIConfirmation confirmation) => FeatureQuickResultConfirmation?.Invoke(confirmation) == true;
    private NativeFeatureResultControl? ReadAcceptedQuickResult() => AcceptedQuickResultRequested?.Invoke();
    private void ReceiveDevelopmentProjection(NativeFeatureProjectionV2 projection) { DevelopmentProjection = projection; DevelopmentProjectionChanged?.Invoke(projection); }

    internal ManagerController(
        NativeManagerPipeServer pipeServer,
        ManagerProcessLauncher processLauncher,
        DiagnosticsService diagnostics,
        Action<string> showError,
        TimeSpan? rendererReadyTimeout = null, bool sessionPrewarmEnabled = true)
    {
        _sessionPrewarmEnabled = sessionPrewarmEnabled;
        _rendererReadyTimeout = rendererReadyTimeout ?? TimeSpan.FromSeconds(60);
        if (_rendererReadyTimeout <= TimeSpan.Zero || _rendererReadyTimeout > TimeSpan.FromSeconds(60))
            throw new ArgumentOutOfRangeException(nameof(rendererReadyTimeout));
        _pipeServer = pipeServer;
        _processLauncher = processLauncher;
        _peerIdentityService = processLauncher.PeerIdentityService;
        _diagnostics = diagnostics;
        _showError = showError;
        _pipeServer.ConfigureHostOwnership(ReadHostOwnership, ConfirmHostOwnership);
        _pipeServer.RendererReady += OnRendererReady;
        _pipeServer.ElectronHostReady += OnElectronHostReady;
        _pipeServer.ElectronHostClosing += OnElectronHostClosing;
        _pipeServer.RendererNotReady += OnRendererNotReady;
        _pipeServer.ManagerDisconnected += OnManagerDisconnected;
        _pipeServer.QuickResultReceived += ReceiveQuickResult;
        _pipeServer.QuickResultCleared += ClearQuickResult;
        _pipeServer.DevelopmentProjectionReceived += ReceiveDevelopmentProjection;
        _pipeServer.QuickResultConfirmation += ReceiveQuickResultConfirmation;
        _pipeServer.AcceptedQuickResultRequested += ReadAcceptedQuickResult;
    }

    public string OpenPage(ManagerPage page, string? requestId = null)
    {
        var intent = new OpenPageIntent(requestId ?? Guid.NewGuid().ToString("N"), page);
        QueueIntent(intent);
        return intent.RequestId;
    }
    internal void BeginLauncherSession(string sessionId)
    {
        var start = false;
        lock (_sync)
        {
            if (_disposed || _shuttingDown) return;
            _ownership.BeginSession(sessionId);
            if (_sessionPrewarmEnabled && !_hostReadiness.IsReady && !_ensuring) { _ensuring = true; start = true; }
        }
        WindowStartupTrace.Record("launcher-session-created", startup: "prewarm", sessionId: sessionId);
        if (start) _ = Task.Run(EnsureAndDispatchAsync);
        else _ = SynchronizeHostOwnershipAsync();
    }
    internal void EndLauncherSession(string sessionId)
    {
        lock (_sync) _ownership.EndSession(sessionId);
        WindowStartupTrace.Record("launcher-session-released", startup: "prewarm", sessionId: sessionId);
        _ = SynchronizeHostOwnershipAsync();
    }
    private ElectronHostOwnershipSnapshot ReadHostOwnership()
    {
        lock (_sync)
        {
            var pending = _featureInvocations.RequestIds.ToHashSet(StringComparer.Ordinal);
            if (_pendingIntent is { } intent) pending.Add(intent.RequestId);
            _ownership.PruneQueued(pending);
            return _ownership.Snapshot();
        }
    }
    private ElectronHostOwnershipSync ConfirmHostOwnership(long revision)
    {
        bool start = false;
        ElectronHostOwnershipSync result;
        lock (_sync)
        {
            var snapshot = ReadHostOwnership();
            var synchronized = revision == snapshot.Revision;
            if (synchronized)
            {
                _hostReadiness.MarkReady();
                if (!_ensuring && (_pendingIntent is not null || _featureInvocations.Count > 0) && !_disposed && !_shuttingDown)
                { _ensuring = true; start = true; }
            }
            result = new(synchronized, snapshot);
        }
        if (start) _ = Task.Run(EnsureAndDispatchAsync);
        return result;
    }
    private async Task<bool> SynchronizeHostOwnershipAsync()
    {
        await _ownershipSyncGate.WaitAsync().ConfigureAwait(false);
        try
        {
            ElectronHostOwnershipSnapshot snapshot;
            lock (_sync)
            {
                if (!_hostReadiness.IsReady || !_pipeServer.IsConnected || _hostClosing || _disposed || _shuttingDown) return false;
                if (!_pipeServer.SupportsHostLifecycle) return true;
                snapshot = ReadHostOwnership();
            }
            var response = await _pipeServer.SendRequestAsync("host-ownership-sync", snapshot, TimeSpan.FromSeconds(5)).ConfigureAwait(false);
            if (response.TryGetProperty("exiting", out var exiting) && exiting.ValueKind == JsonValueKind.True)
            { OnElectronHostClosing(); return false; }
            return true;
        }
        catch (NativeManagerRequestException error) when (error.Code == "HOST_CLOSING")
        { OnElectronHostClosing(); return false; }
        catch (Exception error) when (error is IOException or TimeoutException or NativeManagerRequestException or InvalidOperationException)
        { _diagnostics.Record("host_ownership_sync_pending", error.GetType().Name); return false; }
        finally { _ownershipSyncGate.Release(); }
    }
    public void OpenSuperPanelSettings() => QueueIntent(new OpenPageIntent(Guid.NewGuid().ToString("N"), ManagerPage.Settings, "super-panel"));
    public string? OpenPlugin(LauncherPluginRef reference, string? requestId = null)
    {
        if (!reference.IsValid) { _showError("插件入口无效。"); return null; }
        if (reference.Kind == "builtin") return OpenPage(ManagerPage.Translation, requestId);
        var intent = new PluginIntent(requestId ?? Guid.NewGuid().ToString("N"), reference);
        QueueIntent(intent);
        return intent.RequestId;
    }

    public string? InvokeFeature(NativeFeatureRef reference, string? launcherText = null, string? requestId = null)
    {
        if (reference is null || !reference.IsValid)
        {
            _showError("功能入口无效，请刷新启动器后重试。");
            return null;
        }
        var request = NativeFeatureInvocationProtocol.CreateRequest(reference, launcherText);
        return QueueFeatureRequest(requestId is null ? request : request with { RequestId = requestId });
    }
    public string? InvokeSuperPanelFeature(NativeFeatureRef reference, NativeLauncherTextContext? context, bool quickResult = false, string? requestId = null)
    {
        if (reference is null || !reference.IsValid) { _showError("功能入口无效。"); return null; }
        var request = NativeFeatureInvocationProtocol.CreateSuperPanelRequest(reference, context);
        return QueueFeatureRequest(request with { RequestId = requestId ?? request.RequestId, QuickResult = quickResult ? new(1) : null });
    }
    public void CancelSuperPanelFeature(NativeFeatureResultControl binding)
    {
        lock (_sync) { if (_disposed) return; _featureInvocations.Cancel(binding.RequestId); _ownership.Complete(binding.RequestId); }
        _ = SynchronizeHostOwnershipAsync();
        if (_pipeServer.SupportsQuickResult) _ = SendQuickResultControlAsync("feature-result-cancel-v1", binding);
    }
    internal async Task SendQuickResultControlAsync(string type, object payload)
    {
        try { await _pipeServer.SendRequestAsync(type, payload, TimeSpan.FromSeconds(5)).ConfigureAwait(false); }
        catch (Exception error) when (error is IOException or TimeoutException or InvalidOperationException or NativeManagerRequestException)
        { _diagnostics.Record("quick_result_control_failed", type); }
    }
    private string? QueueFeatureRequest(NativeFeatureInvocationRequest request)
    {
        var reference = request.Ref;
        if (!NativeFeatureInvocationProtocol.IsValidRequest(request))
        {
            _showError("功能请求无效，请刷新启动器后重试。");
            return null;
        }

        var start = false;
        lock (_sync)
        {
            if (_disposed || _shuttingDown) return null;
            var enqueue = _featureInvocations.TryEnqueue(request);
            if (enqueue != NativeFeatureInvocationEnqueueResult.Enqueued)
            {
                _diagnostics.Record("feature_invocation_queue_rejected", enqueue.ToString());
                _showError(enqueue == NativeFeatureInvocationEnqueueResult.QueueFull
                    ? "当前打开请求较多，请稍后重试。"
                    : "功能请求无效，请刷新启动器后重试。");
                return null;
            }
            _intentGeneration++;
            _ownership.Acquire(request.RequestId);
            WindowStartupTrace.Record("request-ownership-acquired", request.RequestId, request.Source, request.Ref.PluginId);
            _diagnostics.Record("feature_invocation_queued", $"request={request.RequestId};plugin={reference.PluginId};feature={reference.FeatureId};queued={_featureInvocations.Count}");
            if (!_ensuring) { _ensuring = true; start = true; }
        }
        if (start) _ = Task.Run(EnsureAndDispatchAsync);
        return request.RequestId;
    }

    internal object CaptureLifecycleForResourceTest()
    {
        lock (_sync)
        {
            return new
            {
                processId = _managerProcess is { } process && !HasExitedOrUnavailable(process) ? process.Id : (int?)null,
                connected = _pipeServer.IsConnected,
                rendererReady = _rendererReadiness.IsReady,
                electronHostReady = _hostReadiness.IsReady,
                ownership = _ownership.Snapshot(),
                ensuring = _ensuring,
                intentGeneration = _intentGeneration,
                pendingRequestId = _pendingIntent?.RequestId,
                pendingKind = _pendingIntent?.Kind,
            };
        }
    }

    public void OpenTranslation(string exactText) => OpenTranslation(exactText, Guid.NewGuid().ToString("N"), "launcher");
    internal void OpenTranslation(string exactText, string requestId, string source)
    {
        if (string.IsNullOrWhiteSpace(exactText) || exactText.Length > 20_000)
        {
            _showError("翻译内容为空或超过 20,000 个字符。");
            return;
        }
        QueueIntent(new TranslationIntent(requestId, exactText, source));
    }

    public async Task ShutdownAsync()
    {
        _shuttingDown = true;
        Process? process;
        lock (_sync) process = _managerProcess;
        if (process is null) return;
        try
        {
            if (process.HasExited)
            {
                ClearExitedManager(process);
                process.Dispose();
                return;
            }
        }
        catch (InvalidOperationException) { ClearExitedManager(process); process.Dispose(); return; }

        try
        {
            if (_pipeServer.IsConnected)
            {
                await _pipeServer.SendRequestAsync("shutdown-manager", new { }, TimeSpan.FromSeconds(5)).ConfigureAwait(false);
                _diagnostics.Record("manager_shutdown_ack", "graceful");
            }
        }
        catch (Exception error) when (error is IOException or TimeoutException or NativeManagerRequestException)
        {
            _diagnostics.Record("manager_shutdown_request_failed", error.GetType().Name);
        }

        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8)).ConfigureAwait(false); }
        catch (TimeoutException)
        {
            _diagnostics.Record("manager_shutdown_timeout", "terminating-process-tree");
            try { process.Kill(entireProcessTree: true); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false); }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or TimeoutException) { }
        }
        finally
        {
            ClearExitedManager(process);
            process.Dispose();
        }
    }

    public async Task<bool> TryPrepareForUpdateAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (timeout <= TimeSpan.Zero) return false;

        Process? process;
        lock (_sync)
        {
            if (_disposed || _shuttingDown) return false;
            process = _managerProcess;
            if (_ensuring && (process is null || HasExitedOrUnavailable(process)))
            {
                _diagnostics.Record("update_manager_prepare_refused", "manager-launch-in-progress");
                return false;
            }
            _shuttingDown = true;
        }

        if (process is null)
        {
            _diagnostics.Record("update_manager_prepare", "no-manager-running");
            return true;
        }

        if (HasExitedOrUnavailable(process))
        {
            ClearExitedManager(process);
            process.Dispose();
            _diagnostics.Record("update_manager_prepare", "manager-already-exited");
            return true;
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            if (!_pipeServer.IsConnected) throw new IOException("The Manager control pipe is disconnected.");
            var requestTimeout = timeout < TimeSpan.FromSeconds(5) ? TimeSpan.FromTicks(Math.Max(1, timeout.Ticks / 2)) : TimeSpan.FromSeconds(5);
            await _pipeServer.SendRequestAsync("shutdown-manager", new { }, requestTimeout, cancellationToken).ConfigureAwait(false);

            var remaining = timeout - stopwatch.Elapsed;
            if (remaining <= TimeSpan.Zero) throw new TimeoutException("Manager exceeded the update shutdown deadline.");
            await process.WaitForExitAsync(cancellationToken).WaitAsync(remaining, cancellationToken).ConfigureAwait(false);

            ManagerLaunchIdentity? identityToDispose = null;
            lock (_sync)
            {
                if (ReferenceEquals(_managerProcess, process))
                {
                    _managerProcess = null;
                    identityToDispose = DetachPeerIdentityLocked();
                }
            }
            identityToDispose?.Dispose();
            process.Dispose();
            _diagnostics.Record("update_manager_prepare", "graceful-exit-confirmed");
            return true;
        }
        catch (Exception error) when (error is IOException or TimeoutException or NativeManagerRequestException or OperationCanceledException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            var exited = HasExitedOrUnavailable(process);
            ManagerLaunchIdentity? identityToDispose = null;
            lock (_sync)
            {
                if (ReferenceEquals(_managerProcess, process) && exited)
                {
                    _managerProcess = null;
                    identityToDispose = DetachPeerIdentityLocked();
                }
                if (!_disposed) _shuttingDown = false;
            }
            identityToDispose?.Dispose();
            if (exited) process.Dispose();
            _diagnostics.Record("update_manager_prepare_refused", error.GetType().Name);
            return false;
        }
    }

    private static bool HasExitedOrUnavailable(Process process)
    {
        try { return process.HasExited; }
        catch (InvalidOperationException) { return true; }
        catch (System.ComponentModel.Win32Exception) { return true; }
    }

    private void QueueIntent(PendingManagerIntent intent)
    {
        lock (_sync)
        {
            if (_disposed || _shuttingDown) return;
            if (_pendingIntent is { } replaced) _ownership.Complete(replaced.RequestId);
            _pendingIntent = intent; // Navigation and translation handoff are latest-wins while the Manager starts.
            _ownership.Acquire(intent.RequestId);
            WindowStartupTrace.Record("request-ownership-acquired", intent.RequestId, pluginId: intent is PluginIntent plugin ? plugin.Ref.Id : null);
            _intentGeneration++;
            _diagnostics.Record("manager_intent_queued", intent.Kind);
            if (_ensuring) return;
            _ensuring = true;
        }
        _ = Task.Run(EnsureAndDispatchAsync);
    }

    private async Task EnsureAndDispatchAsync()
    {
        long readinessGenerationAtStart = 0;
        long intentGenerationAtStart = 0;
        try
        {
            await _startGate.WaitAsync().ConfigureAwait(false);
            try
            {
                Process? current;
                lock (_sync) current = _managerProcess;
                bool closing;
                lock (_sync) closing = _hostClosing;
                if (current is not null && closing && !HasExitedOrUnavailable(current))
                    await WaitForHostExitAsync(current).ConfigureAwait(false);
                lock (_sync) current = _managerProcess;
                if (current is null || current.HasExited)
                {
                    lock (_sync)
                    {
                        if (!_ownership.HasOwners) return;
                        _rendererReadiness.MarkNotReady();
                        _hostReadiness.MarkNotReady();
                        _hostClosing = false;
                    }
                    var generation = Interlocked.Increment(ref _managerGeneration);
                    TracePendingWindow("electron-process-start");
                    WindowStartupTrace.Record("electron-process-start", startup: "session-or-request", sessionId: ReadHostOwnership().SessionIds.FirstOrDefault());
                    var launch = await _processLauncher.StartAsync(_pipeServer.PipeName, generation, hostOnly: true).ConfigureAwait(false);
                    var launched = launch.Process;
                    launched.Exited += (_, _) => OnManagerExited(launched);
                    Process? replacedExitedProcess = null;
                    ManagerLaunchIdentity? replacedIdentity = null;
                    lock (_sync)
                    {
                        if (_managerProcess is { } old && HasExitedOrUnavailable(old))
                        {
                            replacedExitedProcess = old;
                            replacedIdentity = DetachPeerIdentityLocked();
                        }
                        _managerProcess = launched;
                        _managerPeerIdentity = launch.Identity;
                    }
                    replacedIdentity?.Dispose();
                    replacedExitedProcess?.Dispose();
                    _diagnostics.Record("manager_launch", $"pid={launched.Id};generation={generation};mode={(_processLauncher.DevelopmentMode ? "development" : "packaged")}");
                    if (launched.HasExited) OnManagerExited(launched);
                }
            }
            finally { _startGate.Release(); }

            Task ready;
            lock (_sync)
            {
                ready = _hostReadiness.ReadyTask;
                readinessGenerationAtStart = _hostReadiness.Generation;
                intentGenerationAtStart = _intentGeneration;
            }
            await ready.WaitAsync(_rendererReadyTimeout).ConfigureAwait(false);
            if (!await SynchronizeHostOwnershipAsync().ConfigureAwait(false)) return;
            await DispatchPendingAsync().ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            _diagnostics.Record("manager_ready_timeout", "electron-host-ready-not-received");
            ReportPendingFailure("WebTools 管理窗口启动超时，请重试。");
        }
        catch (OperationCanceledException) when (_disposed || _shuttingDown)
        {
            // Controller shutdown cancels any waiter; do not leave a detached faulted task.
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or System.ComponentModel.Win32Exception or TimeoutException)
        {
            _diagnostics.Record("manager_launch_failed", error.GetType().Name);
            ReportPendingFailure("无法打开 WebTools 管理窗口，请检查安装状态后重试。");
        }
        finally
        {
            await SynchronizeHostOwnershipAsync().ConfigureAwait(false);
            bool retry;
            lock (_sync)
            {
                _ensuring = false;
                var pending = _pendingIntent is not null || _featureInvocations.Count > 0;
                var releasedHostHasNewSession = _sessionPrewarmEnabled && _hostClosing && _ownership.HasOwners;
                var intentChanged = _intentGeneration != intentGenerationAtStart;
                retry = (pending || releasedHostHasNewSession) && !_disposed && !_shuttingDown && (intentChanged || _hostClosing
                    || _hostReadiness.ShouldRetryAfter(readinessGenerationAtStart, pending, intentChanged, _disposed, _shuttingDown));
                if (retry) _ensuring = true;
            }
            if (retry) _ = EnsureAndDispatchAsync();
        }
    }

    private async Task DispatchPendingAsync()
    {
        while (true)
        {
            PendingManagerIntent? intent;
            lock (_sync)
            {
                if (!_hostReadiness.IsReady || _disposed || _shuttingDown) return;
                if (_pendingIntent is not null) intent = _pendingIntent;
                else
                {
                    var nextFeature = _featureInvocations.Peek();
                    intent = nextFeature is null ? null : new FeatureInvocationIntent(nextFeature.RequestId, nextFeature.Ref, nextFeature.Context, nextFeature.Source, nextFeature.QuickResult);
                }
            }
            if (intent is null) return;

            // A result-targeted invocation must never downgrade to the Manager route.
            if (intent is FeatureInvocationIntent { QuickResult: not null } unsupported && !_pipeServer.SupportsQuickResult)
            {
                CompleteFeatureInvocation(unsupported);
                ReportFeatureFailure(unsupported, "当前管理程序不支持面板快速结果，请更新后重试。");
                continue;
            }

            try
            {
                lock (_sync) _ownership.Delivered(intent.RequestId);
                if (!await SynchronizeHostOwnershipAsync().ConfigureAwait(false)) return;
                WindowStartupTrace.Record("request-delivered", intent.RequestId);
                var response = await (intent switch
                {
                    OpenPageIntent page => _pipeServer.SendRequestAsync("open-page", page.SettingsSection is null
                        ? new { requestId = page.RequestId, section = PageName(page.Page) }
                        : (object)new { requestId = page.RequestId, section = PageName(page.Page), settingsSection = page.SettingsSection }, TimeSpan.FromSeconds(45)),
                    TranslationIntent translation => _pipeServer.SendRequestAsync("translation-prefill", new { requestId = translation.RequestId, text = translation.Text, source = translation.Source }, TimeSpan.FromSeconds(45)),
                    PluginIntent plugin => _pipeServer.SendRequestAsync("open-plugin", new { requestId = plugin.RequestId, @ref = plugin.Ref }, TimeSpan.FromSeconds(45)),
                    FeatureInvocationIntent feature => _pipeServer.SendRequestAsync("feature-invoke", new NativeFeatureInvocationRequest(feature.RequestId, feature.Ref, feature.Source, feature.Context, _pipeServer.SupportsQuickResult ? feature.QuickResult : null), TimeSpan.FromSeconds(_pipeServer.SupportsLauncherFeatures ? 60 : 45)),
                    _ => throw new InvalidOperationException("Unsupported Manager intent."),
                }).ConfigureAwait(false);
                WindowStartupTrace.Record("request-accepted", intent.RequestId);
                if (intent is FeatureInvocationIntent featureIntent)
                {
                    if (!NativeFeatureInvocationProtocol.TryParseResult(response, featureIntent.RequestId, out var status, out var reasonCode, out var dismissPanel))
                    {
                        CompleteFeatureInvocation(featureIntent);
                        _diagnostics.Record("feature_invocation_invalid_response", featureIntent.RequestId);
                        ReportFeatureFailure(featureIntent, "功能响应无效，请重新打开该功能。");
                        continue;
                    }
                    CompleteFeatureInvocation(featureIntent);
                    _diagnostics.Record("feature_invocation_result", $"request={featureIntent.RequestId};status={status};reason={reasonCode}");
                    if (status is "rejected" or "failed") ReportFeatureFailure(featureIntent, FeatureInvocationErrorMessage(reasonCode), status);
                    else FeatureInvocationFeedback?.Invoke(featureIntent.RequestId, featureIntent.Ref, status, dismissPanel);
                    continue;
                }
                lock (_sync) { if (ReferenceEquals(_pendingIntent, intent)) _pendingIntent = null; _ownership.Complete(intent.RequestId); }
                _diagnostics.Record("manager_intent_delivered", intent.Kind);
            }
            catch (NativeManagerRequestException error)
            {
                if (error.Code == "HOST_CLOSING")
                {
                    OnElectronHostClosing();
                    Process? process;
                    lock (_sync) process = _managerProcess;
                    if (process is not null && !HasExitedOrUnavailable(process))
                        await WaitForHostExitAsync(process).ConfigureAwait(false);
                    return; // Main rejected before execution; retain the exact queued request for the replacement Host.
                }
                if (intent is FeatureInvocationIntent featureIntent)
                {
                    CompleteFeatureInvocation(featureIntent);
                    _diagnostics.Record("feature_invocation_rejected", $"request={featureIntent.RequestId};code={error.Code}");
                    ReportFeatureFailure(featureIntent, FeatureInvocationErrorMessage(error.Code));
                    continue;
                }
                _diagnostics.Record("manager_intent_rejected", $"{intent.Kind};{error.Code}");
                if (intent is TranslationIntent rejectedTranslation) FeatureInvocationFeedback?.Invoke(rejectedTranslation.RequestId,
                    new NativeFeatureRef("webtools.translation", "translate-text"), "failed", false);
                lock (_sync) { if (ReferenceEquals(_pendingIntent, intent)) _pendingIntent = null; _ownership.Complete(intent.RequestId); }
                _showError($"管理窗口未能完成操作：{error.Message}");
            }
            catch (Exception error) when (error is IOException or TimeoutException or InvalidOperationException)
            {
                _diagnostics.Record("manager_intent_unconfirmed", $"{intent.Kind};{error.GetType().Name}");
                // A broken transport is not a failed activation. The replacement
                // authenticated pipe resends this requestId and Electron deduplicates it.
                if (error is IOException && HasLiveElectronHost) return;
                if (intent is FeatureInvocationIntent featureIntent)
                {
                    CompleteFeatureInvocation(featureIntent);
                    ReportFeatureFailure(featureIntent, error is TimeoutException
                        ? "管理窗口响应超时，无法确认功能是否打开。请重试。"
                        : "管理窗口连接已断开，无法确认功能是否打开。请重试。");
                    continue;
                }
                // Keep an unacknowledged intent; a replacement request or reconnect can deliver it again.
                if (intent is TranslationIntent unconfirmedTranslation) FeatureInvocationFeedback?.Invoke(unconfirmedTranslation.RequestId,
                    new NativeFeatureRef("webtools.translation", "translate-text"), "failed", false);
                return;
            }
        }
    }

    private void OnRendererReady()
    {
        lock (_sync)
        {
            _rendererReadiness.MarkReady();
        }
        // Older Electron Hosts do not negotiate the separate Host-ready message.
        if (!_pipeServer.SupportsHostLifecycle) OnElectronHostReady();
    }

    private void OnElectronHostReady()
    {
        TracePendingWindow("electron-host-ready");
        lock (_sync)
        {
            _hostReadiness.MarkReady();
            if (_pendingIntent is null && _featureInvocations.Count == 0
                || _ensuring || _disposed || _shuttingDown) return;
            _ensuring = true;
        }
        _ = EnsureAndDispatchAsync();
    }

    private void OnRendererNotReady()
    {
        lock (_sync)
        {
            _rendererReadiness.MarkNotReady();
        }
        _diagnostics.Record("manager_renderer_not_ready", "navigation-or-reload");
    }

    private void OnElectronHostClosing()
    {
        lock (_sync) { _hostClosing = true; _hostReadiness.MarkNotReady(); }
    }

    private static async Task WaitForHostExitAsync(Process process)
    {
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8)).ConfigureAwait(false); }
        catch (InvalidOperationException) when (HasExitedOrUnavailable(process)) { /* The verified process was already exited/disposed by its exit observer. */ }
    }

    private void OnManagerDisconnected()
    {
        lock (_sync)
        {
            _rendererReadiness.MarkNotReady();
            _hostReadiness.MarkNotReady();
        }
        DevelopmentProjection = null; DevelopmentProjectionChanged?.Invoke(null);
        QuickResultTransportDisconnected?.Invoke();
        _diagnostics.Record("manager_disconnect", "Native Host keeps running");
    }

    private void OnManagerExited(Process process)
    {
        var dispose = false;
        var expectedClosing = false;
        var restart = false;
        ManagerLaunchIdentity? identity = null;
        lock (_sync)
        {
            if (!ReferenceEquals(_managerProcess, process)) return;
            expectedClosing = _hostClosing;
            _managerProcess = null;
            identity = DetachPeerIdentityLocked();
            _rendererReadiness.MarkExited(new IOException("Manager exited before becoming ready."));
            _hostReadiness.MarkExited(new IOException("Electron Host exited before becoming ready."));
            dispose = !_shuttingDown;
            if (expectedClosing && !_ensuring && !_disposed && !_shuttingDown
                && (_pendingIntent is not null || _featureInvocations.Count > 0 || _sessionPrewarmEnabled && _ownership.HasOwners))
            { _ensuring = true; restart = true; }
        }
        _diagnostics.Record("manager_exit", $"code={SafeExitCode(process)}");
        WindowStartupTrace.Record("electron-process-exit");
        if (!expectedClosing) ReportPendingFailure("无法打开 WebTools 管理窗口：Electron Host 已退出，请重试。");
        identity?.Dispose();
        if (dispose) process.Dispose();
        if (restart) _ = Task.Run(EnsureAndDispatchAsync);
    }

    private void ClearExitedManager(Process process)
    {
        ManagerLaunchIdentity? identity = null;
        lock (_sync)
        {
            if (ReferenceEquals(_managerProcess, process))
            {
                _managerProcess = null;
                identity = DetachPeerIdentityLocked();
            }
        }
        identity?.Dispose();
    }

    private ManagerLaunchIdentity? DetachPeerIdentityLocked()
    {
        var identity = _managerPeerIdentity;
        _managerPeerIdentity = null;
        if (identity is not null) _peerIdentityService.ClearCurrent(identity);
        return identity;
    }

    private void ReportFeatureFailure(FeatureInvocationIntent intent, string message, string status = "failed")
    {
        FeatureInvocationFeedback?.Invoke(intent.RequestId, intent.Ref, status, false);
        // The selected-text panel owns its error UI. A second native modal can
        // outlive the invocation and block shutdown of this transient surface.
        if (intent.QuickResult is null) _showError(message);
    }
    private void ReportPendingFailure(string message)
    {
        TranslationIntent? failedTranslation;
        var failed = new List<NativeFeatureInvocationRequest>();
        bool showGeneralError;
        lock (_sync)
        {
            failedTranslation = _pendingIntent as TranslationIntent;
            showGeneralError = _pendingIntent is not null;
            _pendingIntent = null;
            _ownership.ClearRequests();
            while (_featureInvocations.Peek() is { } request)
            { failed.Add(request); _featureInvocations.Complete(request.RequestId); }
        }
        if (failedTranslation is not null) FeatureInvocationFeedback?.Invoke(failedTranslation.RequestId,
            new NativeFeatureRef("webtools.translation", "translate-text"), "failed", false);
        foreach (var request in failed) FeatureInvocationFeedback?.Invoke(request.RequestId, request.Ref, "failed", false);
        if (showGeneralError || failed.Any(request => request.QuickResult is null)) _showError(message);
    }

    private void CompleteFeatureInvocation(FeatureInvocationIntent intent)
    {
        lock (_sync)
        {
            _featureInvocations.Complete(intent.RequestId);
            _ownership.Complete(intent.RequestId);
        }
    }

    private static string FeatureInvocationErrorMessage(string code) => code switch
    {
        "command-failed" => "插件命令执行失败，请在开发者诊断中查看详情。",
        "command-timeout" => "插件命令执行超时，已停止。",
        "plugin-disabled" or "PLUGIN_DISABLED" => "此插件已停用，无法打开该功能。",
        "permission-denied" or "PERMISSION_DENIED" => "此插件尚未获得打开页面所需的权限。",
        "feature-not-found" or "unsupported-feature-kind" or "NOT_INSTALLED" or "ACTION_NOT_DECLARED" => "此功能已不可用，请刷新启动器后重试。",
        "manager-timeout" or "INTENT_TIMEOUT" => "管理窗口响应超时，请重试。",
        "manager-disconnected" or "MANAGER_DISCONNECTED" => "管理窗口连接已断开，请重试。",
        "queue-full" => "当前打开请求较多，请稍后重试。",
        _ => "无法打开此功能，请稍后重试。",
    };

    private static int SafeExitCode(Process process)
    {
        try { return process.ExitCode; }
        catch (InvalidOperationException) { return -1; }
    }

    private static string PageName(ManagerPage page) => page switch
    {
        ManagerPage.Favorites => "favorites",
        ManagerPage.Entries => "entries",
        ManagerPage.Settings => "settings",
        ManagerPage.Translation => "translate",
        _ => throw new ArgumentOutOfRangeException(nameof(page)),
    };

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _pipeServer.RendererReady -= OnRendererReady;
        _pipeServer.ElectronHostReady -= OnElectronHostReady;
        _pipeServer.ElectronHostClosing -= OnElectronHostClosing;
        _pipeServer.RendererNotReady -= OnRendererNotReady;
        _pipeServer.ManagerDisconnected -= OnManagerDisconnected;
        _pipeServer.QuickResultReceived -= ReceiveQuickResult;
        _pipeServer.QuickResultCleared -= ClearQuickResult;
        _pipeServer.DevelopmentProjectionReceived -= ReceiveDevelopmentProjection;
        _pipeServer.QuickResultConfirmation -= ReceiveQuickResultConfirmation;
        _pipeServer.AcceptedQuickResultRequested -= ReadAcceptedQuickResult;
        ManagerLaunchIdentity? identity;
        lock (_sync)
        {
            _pendingIntent = null;
            _featureInvocations.Clear();
            _rendererReadiness.CancelWaiters();
            _hostReadiness.CancelWaiters();
            identity = DetachPeerIdentityLocked();
        }
        identity?.Dispose();
    }

    private abstract record PendingManagerIntent(string RequestId) { public abstract string Kind { get; }
    }
    private sealed record OpenPageIntent(string Id, ManagerPage Page, string? SettingsSection = null) : PendingManagerIntent(Id) { public override string Kind => $"page:{Page}"; }
    private sealed record TranslationIntent(string Id, string Text, string Source) : PendingManagerIntent(Id) { public override string Kind => "translation-prefill"; }
    private sealed record PluginIntent(string Id, LauncherPluginRef Ref) : PendingManagerIntent(Id) { public override string Kind => "open-plugin"; }
    private sealed record FeatureInvocationIntent(string Id, NativeFeatureRef Ref, NativeLauncherTextContext? Context = null, string Source = "launcher", NativeQuickResultOptions? QuickResult = null) : PendingManagerIntent(Id) { public override string Kind => "feature-invoke"; }
}
