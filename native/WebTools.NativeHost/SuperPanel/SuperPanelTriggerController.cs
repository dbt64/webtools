using System.Diagnostics;
using System.Windows.Threading;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

public sealed class SuperPanelTriggerController : IDisposable
{
    private readonly SuperPanelWindow _window;
    private readonly SelectionCaptureService _capture;
    private readonly DiagnosticsService _diagnostics;
    private readonly Action _dismissLauncher, _openSettings;
    private readonly List<MouseTriggerObserver> _retired = [];
    private MouseTriggerObserver? _mouse;
    private SuperPanelState _configured = SuperPanelState.Default;
    private long _intent;
    private bool _disposed;
    private CaptureInvocation? _pending;
    private SuperPanelEscapeObserver? _escape, _failedEscape;
    private readonly Action<SelectionContext, SelectionDiagnosticAttempt?, MonitorPlacement.FloatingPanelAnchor?> _present;
    private readonly Func<Action, SuperPanelEscapeObserver> _escapeFactory;
    private readonly Action<string>? _notifyCaptureFailure;
    internal bool CapturePending => _pending is not null;
    internal int ActiveWorkerCount => _capture.ActiveWorkerCount;
    internal Task WorkerCompletion => _capture.WorkerCompletion;
    public string TriggerStatus => _disposed || !_configured.Enabled ? "disabled" : _mouse is not null ? "registered" : "failed";
    public SuperPanelSettings? ActiveTrigger => _mouse is not null && _configured.Enabled ? SuperPanelSettings.FromState(_configured) : null;
    public string? Error { get; private set; }

    internal SuperPanelTriggerController(SuperPanelWindow window, DiagnosticsService diagnostics, Action dismissLauncher, Action openSettings,
        SelectionCaptureService? capture = null,
        Action<SelectionContext, SelectionDiagnosticAttempt?, MonitorPlacement.FloatingPanelAnchor?>? present = null,
        Func<Action, SuperPanelEscapeObserver>? escapeFactory = null, Action<string>? notifyCaptureFailure = null)
    {
        _window = window; _diagnostics = diagnostics; _capture = capture ?? new SelectionCaptureService();
        _dismissLauncher = dismissLauncher; _openSettings = openSettings; _present = present ?? window.Present;
        _escapeFactory = escapeFactory ?? (cancel => new SuperPanelEscapeObserver(cancel));
        _notifyCaptureFailure = notifyCaptureFailure;
        _window.Dismissed += WindowDismissed;
        _window.InteractionStarted += WindowInteracted;
    }
    public void Initialize(SuperPanelState settings)
    {
        _configured = settings;
        if (!settings.Enabled) return;
        try { _mouse = CreateMouse(settings); }
        catch (Exception failure) { Error = "鼠标触发器未注册：" + failure.Message; _diagnostics.Record("super_panel_trigger_error", failure.GetType().Name); }
    }
    public bool Configure(SuperPanelState settings, out string error)
    {
        error = "";
        try
        {
            if (_disposed) throw new InvalidOperationException("Super Panel 触发器已关闭。");
            if (!SuperPanelSettings.FromState(settings).IsValid) throw new InvalidOperationException("鼠标触发设置无效。");
            if (settings.Enabled)
            {
                if (_mouse is null) _mouse = CreateMouse(settings);
                else _mouse.Configure(SuperPanelSettings.FromState(settings));
            }
            else if (_mouse is { } observer)
            {
                _mouse = null;
                try { observer.Dispose(); } catch { _retired.Add(observer); throw; }
            }
            _configured = settings; Error = null; CancelPending("trigger-rebind");
            if (!settings.Enabled) _window.Dismiss();
            return true;
        }
        catch (Exception failure)
        {
            error = Error = "触发器设置未完成：" + failure.Message;
            if (_configured.Enabled && _mouse is null)
            {
                try { _mouse = CreateMouse(_configured); }
                catch (Exception restoreFailure) { error = Error = error + "；恢复原触发器失败：" + restoreFailure.Message; }
            }
            _diagnostics.Record("super_panel_trigger_error", failure.GetType().Name);
            return false;
        }
    }
    private MouseTriggerObserver CreateMouse(SuperPanelState settings)
    {
        MouseTriggerObserver? observer = null;
        observer = new MouseTriggerObserver(SuperPanelSettings.FromState(settings), (bindingVersion, activation) =>
        {
            if (_disposed || _window.Dispatcher.HasShutdownStarted) return;
            var attempt = _diagnostics.BeginSelectionAttempt(activation.Button, activation.Gesture,
                activation.TriggerTimestamp, activation.TriggerTimestampUtc, activation.ActivationTimestamp, activation.ActivationTimestampUtc);
            try
            {
                _window.Dispatcher.BeginInvoke(new Action(() =>
                {
                    attempt?.Record("TRIGGER_RECEIVED", "SUCCESS", timestamp: activation.TriggerTimestamp,
                        ("triggerButton", activation.Button), ("gesture", activation.Gesture),
                        ("triggerReceivedUtc", activation.TriggerTimestampUtc.ToString("O")),
                        ("holdThresholdMs", activation.Gesture == "hold" ? _configured.HoldMilliseconds.ToString() : "0"));
                    if (activation.Gesture == "hold")
                        attempt?.Record("HOLD_ELAPSED", "SUCCESS", timestamp: activation.ActivationTimestamp,
                            ("holdElapsedUtc", activation.ActivationTimestampUtc.ToString("O")));
                    var dispatcherTimestamp = Stopwatch.GetTimestamp();
                    attempt?.Record("DISPATCHER_ACTIVATION", "SUCCESS", timestamp: dispatcherTimestamp,
                        ("dispatcherUtc", DateTimeOffset.UtcNow.ToString("O")),
                        ("triggerToDispatcherMs", Stopwatch.GetElapsedTime(activation.TriggerTimestamp, dispatcherTimestamp).TotalMilliseconds.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)));
                    if (!_configured.Enabled || !ReferenceEquals(_mouse, observer) || observer?.IsCurrentBinding(bindingVersion) != true)
                    {
                        attempt?.Record("TRIGGER_DISCARDED", "REJECTED", "STALE_OR_DISABLED_BINDING");
                        return;
                    }
                    _ = ToggleAsync(attempt);
                }));
            }
            catch (InvalidOperationException)
            {
                attempt?.Record("DISPATCHER_ACTIVATION", "FAILED", "DISPATCHER_STOPPED");
            }
        }, reason => _diagnostics.Record("super_panel_mouse_error", reason), (x, y, button) =>
        {
            if (_disposed || _window.Dispatcher.HasShutdownStarted) return PointerDownDisposition.PassThrough;
            if (_pending is not null)
            {
                var trigger = button == _configured.MouseButton;
                if (trigger)
                {
                    CancelPending("toggle"); // Revoke before any queued result acceptance.
                    SafeDismiss();
                    return PointerDownDisposition.CancelTrigger;
                }
                if (!_window.IsVisible)
                {
                    CancelPending("outside-click"); // Revoke before any queued result acceptance.
                    return PointerDownDisposition.PassThrough;
                }
                if (_window.ObservePointerDown(x, y))
                {
                    CancelPending("outside-click"); // The dispatcher dismissal is visual cleanup, not the revocation boundary.
                    return PointerDownDisposition.DismissAndForward;
                }
                _pending?.MarkPanelInteraction(); // Revoke before a queued capture result can replace a clicked panel.
                return PointerDownDisposition.PassThrough;
            }
            return _window.ObservePointerDown(x, y) ? PointerDownDisposition.DismissAndForward : PointerDownDisposition.PassThrough;
        });
        return observer;
    }
    internal async Task ToggleAsync(SelectionDiagnosticAttempt? attempt)
    {
        if (_disposed || !_configured.Enabled) return;
        if (_window.IsVisible || _pending is not null)
        {
            CancelPending("toggle"); SafeDismiss(); return;
        }
        CaptureInvocation? invocation = null;
        try
        {
            invocation = CaptureInvocation.Snapshot(++_intent, captureAnchor: true);
            _pending = invocation;
            attempt?.Record("INTENT_CREATED", "SUCCESS", ("intentGeneration", invocation.Generation.ToString()));
            if (!EnsureEscape(invocation.Generation))
            { NotifyCaptureFailure("无法准备捕获取消监听，请稍后重试。", "COPY_CANCEL_OBSERVER_UNAVAILABLE"); return; }
            _escape!.CaptureInputChanged = () =>
            {
                if (_pending?.Generation != invocation.Generation) return;
                CancelPending("keyboard-input");
                SafeDismiss();
            };
            _dismissLauncher();
            var captureTask = _capture.CaptureAsync(invocation, attempt);
            using var checkpointCancellation = CancellationTokenSource.CreateLinkedTokenSource(invocation.Token);
            var checkpoint = Task.Delay(50, checkpointCancellation.Token);
            _window.PresentInitialCompact(attempt, invocation.Anchor);
            // Let the compact layout and its reveal work run before even a cold/expired
            // checkpoint can expand it. This is render ordering, not a timed UI wait.
            await _window.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Input, invocation.Token);
            var defaultPresented = false;
            await Task.WhenAny(captureTask, checkpoint);
            if (!captureTask.IsCompleted && !_disposed && ReferenceEquals(_pending, invocation)
                && invocation.Generation == _intent && _configured.Enabled && !invocation.Token.IsCancellationRequested
                && invocation.IsNativeFocusCurrent())
            {
                attempt?.Record("COPY_FIRST_UI_CHECK", "DEFAULT", ("copyInjected", invocation.CopyInjected.ToString()),
                    ("clipboardUpdated", invocation.CopyResultObserved.ToString()));
                _present(SelectionContext.None(), attempt, invocation.Anchor);
                defaultPresented = true; // Presentation only; the Copy/restore transaction is still alive.
            }
            checkpointCancellation.Cancel();
            var capture = await captureTask;
            var focusCurrent = invocation.IsNativeFocusCurrent();
            if (_disposed || !ReferenceEquals(_pending, invocation) || invocation.Generation != _intent || !_configured.Enabled
                || capture.Outcome == SelectionCaptureOutcome.Cancelled || !focusCurrent)
            {
                if (!_disposed && ReferenceEquals(_pending, invocation) && invocation.Generation == _intent)
                    SafeDismiss();
                attempt?.Record("INTENT_STALE_DISCARDED", "DISCARDED", !focusCurrent ? "CAPTURE_FOCUS_CHANGED" : "INTENT_CHANGED",
                    ("focusRelation", focusCurrent ? "current" : "changed")); return;
            }
            if (invocation.PanelInteracted)
            {
                // The transaction was allowed to read/restore its own Copy, but the user's
                // current picker/page/action now owns the surface. Keep its Escape observer.
                attempt?.Record("INTENT_STALE_DISCARDED", "DISCARDED", "PANEL_INTERACTED");
                return;
            }
            if (capture.Outcome == SelectionCaptureOutcome.SelectedText && invocation.Remaining <= TimeSpan.Zero)
            {
                SafeDismiss();
                NotifyCaptureFailure("本次捕获已超时，请重新唤出。", "COPY_RESULT_TIMEOUT");
                attempt?.Record("COPY_CAPTURE_NOT_PRESENTED", "FAILED", "COPY_RESULT_TIMEOUT");
                return;
            }
            if (!invocation.TryAccept(capture.Outcome))
            { SafeDismiss(); attempt?.Record("INTENT_STALE_DISCARDED", "DISCARDED", "INTENT_NOT_ACCEPTED"); return; }
            attempt?.Record("INTENT_RESULT_ACCEPTED", "ACCEPTED");
            if (capture.TextCaptureFailed)
            {
                SafeDismiss();
                NotifyCaptureFailure(capture.Context.Hint, capture.ReasonCode);
                attempt?.Record("COPY_CAPTURE_NOT_PRESENTED", "FAILED", capture.ReasonCode);
                return;
            }
            if (!defaultPresented || capture.Context.Mode != SurfaceContextMode.NoContext)
                _present(capture.Context, attempt, invocation.Anchor);
            // The deadline cancels the worker, but its accepted no-result fallback owns a real visible board.
            // Do not dismiss that board just because the worker's timeout token is cancelled.
            var acceptedTimeoutFallback = capture.Outcome == SelectionCaptureOutcome.TimedOut
                && capture.Context.Mode == SurfaceContextMode.NoContext && !capture.TextCaptureFailed
                && invocation.CancelReason == "timeout" && !invocation.PhysicalInputChanged;
            if (invocation.Token.IsCancellationRequested && !acceptedTimeoutFallback
                || invocation.Generation != _intent || !invocation.IsNativeFocusCurrent()) SafeDismiss();
        }
        catch (OperationCanceledException) when (invocation?.Token.IsCancellationRequested == true)
        {
            attempt?.Record("INTENT_STALE_DISCARDED", "DISCARDED", "INTENT_CANCELLED");
            if (!_disposed && ReferenceEquals(_pending, invocation)) SafeDismiss();
        }
        catch (Exception error)
        {
            attempt?.Record("PRESENTATION_FAILED", "FAILED", "PRESENTATION_FAILED", ("exceptionType", error.GetType().Name));
            _diagnostics.Record("super_panel_presentation_error", error.GetType().Name);
            CancelPending("presentation-failed"); SafeDismiss();
            NotifyCaptureFailure("面板未能打开，请重试。", "PRESENTATION_FAILED");
        }
        finally
        {
            if (ReferenceEquals(_pending, invocation))
            {
                _pending = null;
                if (_escape is not null) _escape.CaptureInputChanged = _window.CancelAutomaticTranslationForInput;
                // An inactive window cannot receive normal Escape. Keep exactly this observer until dismiss.
                if (!_window.IsVisible) ReleaseEscape();
            }
            invocation?.Dispose();
        }
    }
    private bool EnsureEscape(long generation)
    {
        if (_failedEscape is not null) return false;
        if (_escape is not null) return true;
        try
        {
            _escape = _escapeFactory(() =>
            {
                if (_intent != generation) return;
                CancelPending("escape"); SafeDismiss();
            });
            return true;
        }
        catch (Exception error)
        {
            _diagnostics.Record("super_panel_cancel_observer_error", error.GetType().Name);
            return false;
        }
    }
    private void NotifyCaptureFailure(string hint, string reason)
    {
        _diagnostics.Record("super_panel_capture_failed", reason);
        try { _notifyCaptureFailure?.Invoke(hint); }
        catch (Exception error) { _diagnostics.Record("super_panel_capture_notification_error", error.GetType().Name); }
    }
    private void WindowDismissed() => CancelPending("window-dismissed");
    private void WindowInteracted() => _pending?.MarkPanelInteraction();
    private void CancelPending(string reason)
    {
        ++_intent;
        var pending = _pending; _pending = null;
        pending?.Cancel(reason); pending?.Dispose(); ReleaseEscape();
    }
    private void ReleaseEscape()
    {
        if (_escape is not { } observer) return;
        _escape = null;
        if (!observer.TryDispose(out _))
        {
            _failedEscape = observer; // Keep its inactive callback rooted; do not stack replacements.
            _diagnostics.Record("super_panel_cancel_observer_error", "unhook-failed-inactive-retained");
        }
    }
    private void SafeDismiss()
    {
        try { _window.Dismiss(); }
        catch (Exception error) { _diagnostics.Record("super_panel_dismiss_error", error.GetType().Name); }
    }
    public void ShowFromTray()
    {
        if (!_configured.Enabled) { ShowSettingsFromTray(); return; }
        var now = Stopwatch.GetTimestamp();
        var utc = DateTimeOffset.UtcNow;
        var attempt = _diagnostics.BeginSelectionAttempt("tray", "click", now, utc, now, utc);
        attempt?.Record("TRIGGER_RECEIVED", "SUCCESS", timestamp: now, ("triggerButton", "tray"), ("gesture", "click"), ("triggerReceivedUtc", utc.ToString("O")));
        attempt?.Record("DISPATCHER_ACTIVATION", "SUCCESS", timestamp: now, ("dispatcherUtc", utc.ToString("O")), ("triggerToDispatcherMs", "0"));
        // A tray click is an explicit generic entry, not permission to copy from the foreground tray/menu.
        CancelPending("tray");
        if (_window.IsVisible) { SafeDismiss(); return; }
        if (!EnsureEscape(_intent))
        { NotifyCaptureFailure("无法准备面板关闭监听，请稍后重试。", "PANEL_ESCAPE_UNAVAILABLE"); return; }
        try { _dismissLauncher(); _present(SelectionContext.None(), attempt, MonitorPlacement.CaptureFloatingPanelAnchor()); }
        catch (Exception error)
        {
            _diagnostics.Record("super_panel_presentation_error", error.GetType().Name);
            SafeDismiss(); ReleaseEscape();
        }
    }
    public void ShowSettingsFromTray() { if (_disposed) return; CancelPending("settings"); SafeDismiss(); _openSettings(); }
    public void DismissForLauncher() { CancelPending("launcher"); SafeDismiss(); }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true; CancelPending("shutdown"); _capture.Dispose();
        _window.Dismissed -= WindowDismissed; _failedEscape?.TryDispose(out _);
        _window.InteractionStarted -= WindowInteracted;
        if (_mouse is not null) _retired.Add(_mouse);
        foreach (var observer in _retired)
        { try { observer.Dispose(); } catch { _diagnostics.Record("super_panel_mouse_unhook_error", "inactive-observer-retained-until-exit"); } }
        _mouse = null; _retired.Clear();
    }
}
