using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Timer = System.Threading.Timer;

namespace WebTools.NativeHost.SuperPanel;

internal enum PointerDownDisposition { PassThrough, DismissAndForward, CancelTrigger }

/// <summary>One configured physical button/gesture. Other buttons and injected input pass through.</summary>
internal sealed class MouseTriggerObserver : IDisposable
{
    private readonly object _gate = new();
    private readonly HookProc _callback;
    private readonly Action<long, MouseTriggerActivation> _activate;
    private readonly Action<string> _report;
    private readonly Func<int, int, string, PointerDownDisposition> _pointerDown;
    private SuperPanelSettings _settings;
    private IntPtr _hook;
    private Timer? _timer;
    private GCHandle _keepAlive;
    private bool _disposed, _pressed, _fired, _forwarded;
    private string _pressedButton = "";
    private Point _origin;
    private long _pressedTimestamp;
    private DateTimeOffset _pressedTimestampUtc;
    private long _sequence;
    private long _bindingVersion = 1;

    public MouseTriggerObserver(SuperPanelSettings settings, Action<long, MouseTriggerActivation> activate, Action<string> report, Func<int, int, string, PointerDownDisposition> pointerDown)
    {
        if (!settings.IsValid || !settings.Enabled) throw new ArgumentException("Invalid mouse trigger settings.");
        _settings = settings; _activate = activate; _report = report; _pointerDown = pointerDown; _callback = Observe;
        _keepAlive = GCHandle.Alloc(this);
        _hook = SetWindowsHookEx(14, _callback, GetModuleHandle(null), 0);
        if (_hook == IntPtr.Zero) { _keepAlive.Free(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
    }
    public void Configure(SuperPanelSettings settings)
    {
        if (!settings.IsValid || !settings.Enabled) throw new ArgumentException("Invalid mouse trigger settings.");
        string? restoreDown = null;
        lock (_gate)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(MouseTriggerObserver));
            if (_settings == settings) return;
            ++_bindingVersion;
            CancelTimer();
            // Restore an unfinished non-trigger gesture before changing its binding.
            if (_pressed && !_fired && !_forwarded) { restoreDown = _pressedButton; _forwarded = true; }
            _settings = settings;
        }
        if (restoreDown is not null) Replay(restoreDown, false);
    }
    private IntPtr Observe(int code, IntPtr message, IntPtr data)
    {
        if (code < 0) return CallNextHookEx(_hook, code, message, data);
        var value = Marshal.PtrToStructure<MouseData>(data);
        if ((value.Flags & 3) != 0) return CallNextHookEx(_hook, code, message, data);
        var msg = message.ToInt32();
        var button = msg is 0x207 or 0x208 ? "middle"
            : msg is 0x20B or 0x20C ? (value.Mouse >> 16) switch { 1 => "xbutton1", 2 => "xbutton2", _ => "" } : "";
        var down = msg is 0x207 or 0x20B;
        var up = msg is 0x208 or 0x20C;
        // A physical outside click must dismiss even if Windows denied initial foreground activation.
        // A configured trigger outside the visible panel dismisses rather than re-opening it.
        var disposition = !_disposed && (msg is 0x201 or 0x204 || down)
            ? _pointerDown(value.Position.X, value.Position.Y, button.Length > 0 ? button : msg == 0x201 ? "left" : "right")
            : PointerDownDisposition.PassThrough;
        var consume = false; var activate = false; var release = false; long bindingVersion = 0;
        MouseTriggerActivation? activation = null;
        string? restoreDown = null, restoreClick = null;
        lock (_gate)
        {
            if (msg == 0x200 && _pressed && !_fired && !_forwarded
                && (Math.Abs(value.Position.X - _origin.X) > 12 || Math.Abs(value.Position.Y - _origin.Y) > 12))
            {
                CancelTimer(); _forwarded = true; restoreDown = _pressedButton;
            }
            if (up && _pressed && button == _pressedButton)
            {
                consume = !_forwarded;
                if (!_fired && !_forwarded) restoreClick = button;
                _pressed = false; CancelTimer(); release = _disposed;
            }
            else if (!_disposed && down && !_pressed && button == _settings.MouseButton)
            {
                _pressed = true; _pressedButton = button; _origin = value.Position;
                _pressedTimestamp = Stopwatch.GetTimestamp(); _pressedTimestampUtc = DateTimeOffset.UtcNow;
                _fired = false; _forwarded = false; consume = true;
                var sequence = ++_sequence;
                // Dismissal must not swallow the target application's original outside click,
                // including a button also configured as the Super Panel trigger.
                if (disposition == PointerDownDisposition.CancelTrigger) { _fired = true; consume = true; }
                else if (disposition == PointerDownDisposition.DismissAndForward) { _fired = true; _forwarded = true; consume = false; }
                else if (_settings.Gesture == "press")
                {
                    _fired = true; activate = true; bindingVersion = _bindingVersion;
                    activation = new(button, "press", _pressedTimestamp, _pressedTimestampUtc, Stopwatch.GetTimestamp(), DateTimeOffset.UtcNow);
                }
                else _timer = new Timer(_ => HoldElapsed(sequence), null, _settings.HoldMilliseconds, Timeout.Infinite);
            }
        }
        if (restoreDown is not null) Replay(restoreDown, false);
        if (restoreClick is not null) Replay(restoreClick, true);
        if (activate && activation is not null) _activate(bindingVersion, activation);
        if (release) { try { ReleaseHook(); } catch (Exception failure) { _report("unhook:" + failure.GetType().Name); } }
        return consume ? new IntPtr(1) : CallNextHookEx(_hook, code, message, data);
    }
    private void HoldElapsed(long sequence)
    {
        long bindingVersion;
        MouseTriggerActivation activation;
        lock (_gate)
        {
            if (_disposed || !_pressed || _forwarded || _fired || sequence != _sequence) return;
            _fired = true; bindingVersion = _bindingVersion; CancelTimer();
            activation = new(_pressedButton, "hold", _pressedTimestamp, _pressedTimestampUtc, Stopwatch.GetTimestamp(), DateTimeOffset.UtcNow);
        }
        _activate(bindingVersion, activation);
    }
    public bool IsCurrentBinding(long version) { lock (_gate) return !_disposed && version == _bindingVersion; }
    private void CancelTimer() { ++_sequence; _timer?.Dispose(); _timer = null; }
    private void Replay(string button, bool includeUp)
    {
        var downFlag = button == "middle" ? 0x20u : 0x80u;
        var upFlag = button == "middle" ? 0x40u : 0x100u;
        var mouseData = button == "xbutton1" ? 1u : button == "xbutton2" ? 2u : 0u;
        var inputs = includeUp
            ? new[] { new Input { Data = new MouseInput { MouseData = mouseData, Flags = downFlag } }, new Input { Data = new MouseInput { MouseData = mouseData, Flags = upFlag } } }
            : new[] { new Input { Data = new MouseInput { MouseData = mouseData, Flags = downFlag } } };
        // Only restores the user's configured non-trigger click; never keyboard/Clipboard injection.
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>()) != inputs.Length)
            _report("mouse-click-restore:" + Marshal.GetLastWin32Error());
    }
    public void Dispose()
    {
        string? restoreDown = null;
        bool defer;
        lock (_gate)
        {
            _disposed = true; ++_bindingVersion; CancelTimer();
            if (_pressed && !_fired && !_forwarded) { restoreDown = _pressedButton; _forwarded = true; }
            // A fired, consumed DOWN must have its matching UP consumed even if settings change meanwhile.
            defer = _pressed && _fired && !_forwarded;
        }
        if (restoreDown is not null) Replay(restoreDown, false);
        if (!defer) ReleaseHook();
    }
    private void ReleaseHook()
    {
        lock (_gate)
        {
            if (_hook != IntPtr.Zero)
            {
                if (!UnhookWindowsHookEx(_hook)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not release the Super Panel mouse observer.");
                _hook = IntPtr.Zero;
            }
            if (_keepAlive.IsAllocated) _keepAlive.Free();
        }
    }
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseData { public Point Position; public uint Mouse, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public MouseInput Data; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int X, Y; public uint MouseData, Flags, Time; public UIntPtr Extra; }
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int type, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
}

internal sealed record MouseTriggerActivation(
    string Button,
    string Gesture,
    long TriggerTimestamp,
    DateTimeOffset TriggerTimestampUtc,
    long ActivationTimestamp,
    DateTimeOffset ActivationTimestampUtc);
