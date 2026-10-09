using System.Diagnostics;
using System.IO;
using System.Text.Json;
using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.Services;

public enum ManagerPage { Favorites, Entries, Settings, Translation }

public sealed class ManagerController : IDisposable
{
    private readonly object _sync = new();
    private readonly SemaphoreSlim _startGate = new(1, 1);
    private readonly NativeManagerPipeServer _pipeServer;
    private readonly ManagerProcessLauncher _processLauncher;
    private readonly DiagnosticsService _diagnostics;
    private readonly Action<string> _showError;
    private readonly TimeSpan _rendererReadyTimeout;
    private readonly ManagerRendererReadiness _rendererReadiness = new();
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

    internal ManagerController(
        NativeManagerPipeServer pipeServer,
        ManagerProcessLauncher processLauncher,
        DiagnosticsService diagnostics,
        Action<string> showError,
        TimeSpan? rendererReadyTimeout = null)
    {
        _rendererReadyTimeout = rendererReadyTimeout ?? TimeSpan.FromSeconds(60);
        if (_rendererReadyTimeout <= TimeSpan.Zero || _rendererReadyTimeout > TimeSpan.FromSeconds(60))
            throw new ArgumentOutOfRangeException(nameof(rendererReadyTimeout));
        _pipeServer = pipeServer;
        _processLauncher = processLauncher;
        _peerIdentityService = processLauncher.PeerIdentityService;
        _diagnostics = diagnostics;
        _showError = showError;
        _pipeServer.RendererReady += OnRendererReady;
        _pipeServer.RendererNotReady += OnRendererNotReady;
        _pipeServer.ManagerDisconnected += OnManagerDisconnected;
    }

    public void OpenPage(ManagerPage page)
    {
        var intent = new OpenPageIntent(Guid.NewGuid().ToString("N"), page);
        QueueIntent(intent);
    }
    public void OpenPlugin(LauncherPluginRef reference)
    {
        if (!reference.IsValid) { _showError("插件入口无效。"); return; }
        if (reference.Kind == "builtin") { OpenPage(ManagerPage.Translation); return; }
        QueueIntent(new PluginIntent(Guid.NewGuid().ToString("N"), reference));
    }

    public void InvokeFeature(NativeFeatureRef reference, string? launcherText = null)
    {
        if (reference is null || !reference.IsValid)
        {
            _showError("功能入口无效，请刷新启动器后重试。");
            return;
        }
        var request = NativeFeatureInvocationProtocol.CreateRequest(reference, launcherText);
        if (!NativeFeatureInvocationProtocol.IsValidRequest(request))
        {
            _showError("功能请求无效，请刷新启动器后重试。");
            return;
        }

        var start = false;
        lock (_sync)
        {
            if (_disposed || _shuttingDown) return;
            var enqueue = _featureInvocations.TryEnqueue(request);
            if (enqueue != NativeFeatureInvocationEnqueueResult.Enqueued)
            {
                _diagnostics.Record("feature_invocation_queue_rejected", enqueue.ToString());
                _showError(enqueue == NativeFeatureInvocationEnqueueResult.QueueFull
                    ? "当前打开请求较多，请稍后重试。"
                    : "功能请求无效，请刷新启动器后重试。");
                return;
            }
            _intentGeneration++;
            _diagnostics.Record("feature_invocation_queued", $"request={request.RequestId};plugin={reference.PluginId};feature={reference.FeatureId};queued={_featureInvocations.Count}");
            if (!_ensuring) { _ensuring = true; start = true; }
        }
        if (start) _ = EnsureAndDispatchAsync();
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
                ensuring = _ensuring,
                intentGeneration = _intentGeneration,
                pendingRequestId = _pendingIntent?.RequestId,
                pendingKind = _pendingIntent?.Kind,
            };
        }
    }

    public void OpenTranslation(string exactText)
    {
        if (string.IsNullOrWhiteSpace(exactText) || exactText.Length > 20_000)
        {
            _showError("翻译内容为空或超过 20,000 个字符。");
            return;
        }
        QueueIntent(new TranslationIntent(Guid.NewGuid().ToString("N"), exactText));
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
            _pendingIntent = intent; // Navigation and translation handoff are latest-wins while the Manager starts.
            _intentGeneration++;
            _diagnostics.Record("manager_intent_queued", intent.Kind);
            if (_ensuring) return;
            _ensuring = true;
        }
        _ = EnsureAndDispatchAsync();
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
                if (current is null || current.HasExited)
                {
                    lock (_sync)
                    {
                        _rendererReadiness.MarkNotReady();
                    }
                    var generation = Interlocked.Increment(ref _managerGeneration);
                    var launch = await _processLauncher.StartAsync(_pipeServer.PipeName, generation).ConfigureAwait(false);
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
                ready = _rendererReadiness.ReadyTask;
                readinessGenerationAtStart = _rendererReadiness.Generation;
                intentGenerationAtStart = _intentGeneration;
            }
            await ready.WaitAsync(_rendererReadyTimeout).ConfigureAwait(false);
            await DispatchPendingAsync().ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            _diagnostics.Record("manager_ready_timeout", "renderer-ready-not-received");
            ClearPendingIntent();
            _showError("WebTools 管理窗口启动超时，请重试。");
        }
        catch (OperationCanceledException) when (_disposed || _shuttingDown)
        {
            // Controller shutdown cancels any waiter; do not leave a detached faulted task.
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or System.ComponentModel.Win32Exception or TimeoutException)
        {
            _diagnostics.Record("manager_launch_failed", error.GetType().Name);
            ClearPendingIntent();
            _showError("无法打开 WebTools 管理窗口，请检查安装状态后重试。");
        }
        finally
        {
            bool retry;
            lock (_sync)
            {
                _ensuring = false;
                var pending = _pendingIntent is not null || _featureInvocations.Count > 0;
                var intentChanged = _intentGeneration != intentGenerationAtStart;
                retry = _rendererReadiness.ShouldRetryAfter(readinessGenerationAtStart, pending, intentChanged, _disposed, _shuttingDown);
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
                if (!_rendererReadiness.IsReady || _disposed || _shuttingDown) return;
                if (_pendingIntent is not null) intent = _pendingIntent;
                else
                {
                    var nextFeature = _featureInvocations.Peek();
                    intent = nextFeature is null ? null : new FeatureInvocationIntent(nextFeature.RequestId, nextFeature.Ref, nextFeature.Context);
                }
            }
            if (intent is null) return;

            try
            {
                var response = await (intent switch
                {
                    OpenPageIntent page => _pipeServer.SendRequestAsync("open-page", new { requestId = page.RequestId, section = PageName(page.Page) }, TimeSpan.FromSeconds(45)),
                    TranslationIntent translation => _pipeServer.SendRequestAsync("translation-prefill", new { requestId = translation.RequestId, text = translation.Text }, TimeSpan.FromSeconds(45)),
                    PluginIntent plugin => _pipeServer.SendRequestAsync("open-plugin", new { requestId = plugin.RequestId, @ref = plugin.Ref }, TimeSpan.FromSeconds(45)),
                    FeatureInvocationIntent feature => _pipeServer.SendRequestAsync("feature-invoke", new NativeFeatureInvocationRequest(feature.RequestId, feature.Ref, "launcher", feature.Context), TimeSpan.FromSeconds(45)),
                    _ => throw new InvalidOperationException("Unsupported Manager intent."),
                }).ConfigureAwait(false);
                if (intent is FeatureInvocationIntent featureIntent)
                {
                    if (!NativeFeatureInvocationProtocol.TryParseResult(response, featureIntent.RequestId, out var status, out var reasonCode))
                    {
                        CompleteFeatureInvocation(featureIntent);
                        _diagnostics.Record("feature_invocation_invalid_response", featureIntent.RequestId);
                        _showError("功能响应无效，请重新打开该功能。");
                        continue;
                    }
                    CompleteFeatureInvocation(featureIntent);
                    _diagnostics.Record("feature_invocation_result", $"request={featureIntent.RequestId};status={status};reason={reasonCode}");
                    if (status != "accepted") _showError(FeatureInvocationErrorMessage(reasonCode));
                    continue;
                }
                lock (_sync) if (ReferenceEquals(_pendingIntent, intent)) _pendingIntent = null;
                _diagnostics.Record("manager_intent_delivered", intent.Kind);
            }
            catch (NativeManagerRequestException error)
            {
                if (intent is FeatureInvocationIntent featureIntent)
                {
                    CompleteFeatureInvocation(featureIntent);
                    _diagnostics.Record("feature_invocation_rejected", $"request={featureIntent.RequestId};code={error.Code}");
                    _showError(FeatureInvocationErrorMessage(error.Code));
                    continue;
                }
                _diagnostics.Record("manager_intent_rejected", $"{intent.Kind};{error.Code}");
                lock (_sync) if (ReferenceEquals(_pendingIntent, intent)) _pendingIntent = null;
                _showError($"管理窗口未能完成操作：{error.Message}");
            }
            catch (Exception error) when (error is IOException or TimeoutException or InvalidOperationException)
            {
                _diagnostics.Record("manager_intent_unconfirmed", $"{intent.Kind};{error.GetType().Name}");
                if (intent is FeatureInvocationIntent featureIntent)
                {
                    CompleteFeatureInvocation(featureIntent);
                    _showError(error is TimeoutException
                        ? "管理窗口响应超时，无法确认功能是否打开。请重试。"
                        : "管理窗口连接已断开，无法确认功能是否打开。请重试。");
                    continue;
                }
                // Keep an unacknowledged intent; a replacement request or reconnect can deliver it again.
                return;
            }
        }
    }

    private void OnRendererReady()
    {
        lock (_sync)
        {
            _rendererReadiness.MarkReady();
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

    private void OnManagerDisconnected()
    {
        lock (_sync)
        {
            _rendererReadiness.MarkNotReady();
        }
        _diagnostics.Record("manager_disconnect", "Native Host keeps running");
    }

    private void OnManagerExited(Process process)
    {
        var dispose = false;
        ManagerLaunchIdentity? identity = null;
        lock (_sync)
        {
            if (!ReferenceEquals(_managerProcess, process)) return;
            _managerProcess = null;
            identity = DetachPeerIdentityLocked();
            _rendererReadiness.MarkExited(new IOException("Manager exited before becoming ready."));
            dispose = !_shuttingDown;
        }
        _diagnostics.Record("manager_exit", $"code={SafeExitCode(process)}");
        identity?.Dispose();
        if (dispose) process.Dispose();
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

    private void ClearPendingIntent()
    {
        lock (_sync)
        {
            _pendingIntent = null;
            _featureInvocations.Clear();
        }
    }

    private void CompleteFeatureInvocation(FeatureInvocationIntent intent)
    {
        lock (_sync)
        {
            _featureInvocations.Complete(intent.RequestId);
        }
    }

    private static string FeatureInvocationErrorMessage(string code) => code switch
    {
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
        _pipeServer.RendererNotReady -= OnRendererNotReady;
        _pipeServer.ManagerDisconnected -= OnManagerDisconnected;
        ManagerLaunchIdentity? identity;
        lock (_sync)
        {
            _pendingIntent = null;
            _featureInvocations.Clear();
            _rendererReadiness.CancelWaiters();
            identity = DetachPeerIdentityLocked();
        }
        identity?.Dispose();
    }

    private abstract record PendingManagerIntent(string RequestId) { public abstract string Kind { get; }
    }
    private sealed record OpenPageIntent(string Id, ManagerPage Page) : PendingManagerIntent(Id) { public override string Kind => $"page:{Page}"; }
    private sealed record TranslationIntent(string Id, string Text) : PendingManagerIntent(Id) { public override string Kind => "translation-prefill"; }
    private sealed record PluginIntent(string Id, LauncherPluginRef Ref) : PendingManagerIntent(Id) { public override string Kind => "open-plugin"; }
    private sealed record FeatureInvocationIntent(string Id, NativeFeatureRef Ref, NativeLauncherTextContext? Context = null) : PendingManagerIntent(Id) { public override string Kind => "feature-invoke"; }
}
