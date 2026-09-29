using System.Diagnostics;
using System.IO;

namespace WebTools.NativeHost.Services;

public enum ManagerPage { Search, Entries, Settings, Translation }

public sealed class ManagerController : IDisposable
{
    private readonly object _sync = new();
    private readonly SemaphoreSlim _startGate = new(1, 1);
    private readonly NativeManagerPipeServer _pipeServer;
    private readonly ManagerProcessLauncher _processLauncher;
    private readonly DiagnosticsService _diagnostics;
    private readonly Action<string> _showError;
    private readonly ManagerRendererReadiness _rendererReadiness = new();
    private Process? _managerProcess;
    private PendingManagerIntent? _pendingIntent;
    private long _intentGeneration;
    private bool _ensuring;
    private bool _shuttingDown;
    private bool _disposed;

    internal ManagerController(NativeManagerPipeServer pipeServer, ManagerProcessLauncher processLauncher, DiagnosticsService diagnostics, Action<string> showError)
    {
        _pipeServer = pipeServer;
        _processLauncher = processLauncher;
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
            if (process.HasExited) { process.Dispose(); return; }
        }
        catch (InvalidOperationException) { process.Dispose(); return; }

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
        finally { process.Dispose(); }
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
                    var launched = _processLauncher.Start(NativeManagerPipeServer.DefaultPipeName);
                    launched.Exited += (_, _) => OnManagerExited(launched);
                    lock (_sync) _managerProcess = launched;
                    _diagnostics.Record("manager_launch", $"pid={launched.Id};mode={(_processLauncher.DevelopmentMode ? "development" : "packaged")}");
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
            await ready.WaitAsync(TimeSpan.FromSeconds(60)).ConfigureAwait(false);
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
            _diagnostics.Record("manager_launch_failed", $"{error.GetType().Name}:{error.Message}");
            ClearPendingIntent();
            _showError($"无法打开 WebTools 管理窗口：{error.Message}");
        }
        finally
        {
            bool retry;
            lock (_sync)
            {
                _ensuring = false;
                var pending = _pendingIntent is not null;
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
                intent = _pendingIntent;
            }
            if (intent is null) return;

            try
            {
                var result = intent switch
                {
                    OpenPageIntent page => await _pipeServer.SendRequestAsync("open-page", new { requestId = page.RequestId, section = PageName(page.Page) }, TimeSpan.FromSeconds(45)).ConfigureAwait(false),
                    TranslationIntent translation => await _pipeServer.SendRequestAsync("translation-prefill", new { requestId = translation.RequestId, text = translation.Text }, TimeSpan.FromSeconds(45)).ConfigureAwait(false),
                    _ => throw new InvalidOperationException("Unsupported Manager intent."),
                };
                lock (_sync) if (ReferenceEquals(_pendingIntent, intent)) _pendingIntent = null;
                _diagnostics.Record("manager_intent_delivered", intent.Kind);
                if (intent is OpenPageIntent { Page: ManagerPage.Search }) _ = result;
            }
            catch (NativeManagerRequestException error)
            {
                _diagnostics.Record("manager_intent_rejected", $"{intent.Kind};{error.Code}");
                lock (_sync) if (ReferenceEquals(_pendingIntent, intent)) _pendingIntent = null;
                _showError($"管理窗口未能完成操作：{error.Message}");
            }
            catch (Exception error) when (error is IOException or TimeoutException or InvalidOperationException)
            {
                _diagnostics.Record("manager_intent_unconfirmed", $"{intent.Kind};{error.GetType().Name}");
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
            if (_pendingIntent is null || _ensuring || _disposed || _shuttingDown) return;
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
        lock (_sync)
        {
            if (!ReferenceEquals(_managerProcess, process)) return;
            _managerProcess = null;
            _rendererReadiness.MarkExited(new IOException("Manager exited before becoming ready."));
            dispose = !_shuttingDown;
        }
        _diagnostics.Record("manager_exit", $"code={SafeExitCode(process)}");
        if (dispose) process.Dispose();
    }

    private void ClearPendingIntent()
    {
        lock (_sync) _pendingIntent = null;
    }

    private static int SafeExitCode(Process process)
    {
        try { return process.ExitCode; }
        catch (InvalidOperationException) { return -1; }
    }

    private static string PageName(ManagerPage page) => page switch
    {
        ManagerPage.Search => "search",
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
        lock (_sync)
        {
            _pendingIntent = null;
            _rendererReadiness.CancelWaiters();
        }
    }

    private abstract record PendingManagerIntent(string RequestId) { public abstract string Kind { get; }
    }
    private sealed record OpenPageIntent(string Id, ManagerPage Page) : PendingManagerIntent(Id) { public override string Kind => $"page:{Page}"; }
    private sealed record TranslationIntent(string Id, string Text) : PendingManagerIntent(Id) { public override string Kind => "translation-prefill"; }
}
