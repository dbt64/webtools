using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>One transient Super Panel request. Worker leases keep cancellation alive during blocked native calls.</summary>
internal sealed class CaptureInvocation : IDisposable
{
    private readonly CancellationTokenSource _cancellation = new();
    private readonly int _budgetMilliseconds;
    private int _references = 1, _ownerReleased, _accepted, _physicalInputChanged, _copyInjected, _copyResultObserved, _panelInteracted;
    private string? _cancelReason;
    internal long Generation { get; }
    internal long Started { get; } = Stopwatch.GetTimestamp();
    internal IntPtr Foreground { get; }
    internal uint ProcessId { get; }
    internal string WindowClass { get; }
    internal IntPtr FocusWindow { get; }
    internal MonitorPlacement.FloatingPanelAnchor? Anchor { get; }
    internal CancellationToken Token { get; }
    internal string? CancelReason => Volatile.Read(ref _cancelReason);
    internal bool PhysicalInputChanged => Volatile.Read(ref _physicalInputChanged) != 0;
    internal bool CopyInjected => Volatile.Read(ref _copyInjected) != 0;
    internal bool CopyResultObserved => Volatile.Read(ref _copyResultObserved) != 0;
    internal bool PanelInteracted => Volatile.Read(ref _panelInteracted) != 0;
    internal void MarkPanelInteraction() => Interlocked.Exchange(ref _panelInteracted, 1);
    internal void MarkCopyInjected() => Interlocked.Exchange(ref _copyInjected, 1);
    internal void MarkCopyResultObserved() => Interlocked.Exchange(ref _copyResultObserved, 1);
    internal TimeSpan Remaining => TimeSpan.FromMilliseconds(Math.Max(0, _budgetMilliseconds - Stopwatch.GetElapsedTime(Started).TotalMilliseconds));

    private CaptureInvocation(long generation, IntPtr foreground, uint processId, string windowClass,
        IntPtr focus, MonitorPlacement.FloatingPanelAnchor? anchor, int budgetMilliseconds = 650)
    {
        Generation = generation; Foreground = foreground; ProcessId = processId; WindowClass = windowClass;
        FocusWindow = focus; Anchor = anchor; _budgetMilliseconds = budgetMilliseconds; Token = _cancellation.Token;
    }
    internal static CaptureInvocation Snapshot(long generation, bool captureAnchor = false)
    {
        var foreground = GetForegroundWindow();
        var thread = GetWindowThreadProcessId(foreground, out var process);
        var text = new StringBuilder(256); _ = GetClassName(foreground, text, text.Capacity);
        var focus = new GuiThreadInfo { Size = Marshal.SizeOf<GuiThreadInfo>() };
        var focusWindow = GetGUIThreadInfo(thread, ref focus) ? focus.Focus : IntPtr.Zero;
        return new(generation, foreground, process, text.ToString(), focusWindow,
            captureAnchor ? MonitorPlacement.CaptureFloatingPanelAnchor() : null);
    }
    internal static CaptureInvocation ForCheck(long generation, int budgetMilliseconds = 650) =>
        new(generation, new IntPtr(1), uint.MaxValue, "fixture", IntPtr.Zero, null, budgetMilliseconds);

    internal void Cancel(string reason)
    {
        if (reason is "keyboard-input" or "outside-click") Interlocked.Exchange(ref _physicalInputChanged, 1);
        Interlocked.CompareExchange(ref _cancelReason, reason, null);
        try { _cancellation.Cancel(); } catch (ObjectDisposedException) { }
    }
    internal bool TryAccept(SelectionCaptureOutcome outcome)
    {
        if (PanelInteracted) return false;
        if (outcome is SelectionCaptureOutcome.SelectedText or SelectionCaptureOutcome.SelectedContext && Remaining == TimeSpan.Zero) return false;
        if (Token.IsCancellationRequested && !(CancelReason == "timeout" && outcome == SelectionCaptureOutcome.TimedOut)) return false;
        return Interlocked.CompareExchange(ref _accepted, 1, 0) == 0;
    }
    internal IDisposable RetainWorker()
    {
        if (Volatile.Read(ref _ownerReleased) != 0) throw new ObjectDisposedException(nameof(CaptureInvocation));
        Interlocked.Increment(ref _references);
        return new WorkerLease(this);
    }
    private void Release() { if (Interlocked.Decrement(ref _references) == 0) _cancellation.Dispose(); }
    public void Dispose() { if (Interlocked.Exchange(ref _ownerReleased, 1) == 0) Release(); }
    private sealed class WorkerLease(CaptureInvocation owner) : IDisposable
    {
        private CaptureInvocation? _owner = owner;
        public void Dispose() => Interlocked.Exchange(ref _owner, null)?.Release();
    }
    internal bool IsNativeFocusCurrent()
        => IsFocusCurrent(Foreground, FocusWindow);
    internal static Func<bool> SnapshotFocusValidator()
    {
        using var snapshot = Snapshot(0);
        var foreground = snapshot.Foreground; var focus = snapshot.FocusWindow;
        return () => IsFocusCurrent(foreground, focus);
    }
    private static bool IsFocusCurrent(IntPtr foreground, IntPtr focusWindow)
    {
        if (GetForegroundWindow() != foreground) return false;
        if (focusWindow == IntPtr.Zero) return true;
        var thread = GetWindowThreadProcessId(foreground, out _);
        var info = new GuiThreadInfo { Size = Marshal.SizeOf<GuiThreadInfo>() };
        return GetGUIThreadInfo(thread, ref info) && info.Focus == focusWindow;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rectangle { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct GuiThreadInfo
    {
        public int Size; public uint Flags;
        public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public Rectangle CaretRectangle;
    }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
}
