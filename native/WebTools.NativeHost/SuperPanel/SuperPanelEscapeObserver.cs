using System.Runtime.InteropServices;
using WebTools.NativeHost.Interop;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>Passive Escape while capturing/visible; physical keyboard changes revoke a pending Copy. Never consumes input.</summary>
internal sealed class SuperPanelEscapeObserver
{
    private readonly ILowLevelKeyboardHookApi _api;
    private readonly NativeMethods.LowLevelKeyboardProc _callback;
    private IntPtr _hook;
    private GCHandle _keepAlive;
    private bool _active = true;
    internal Action? CaptureInputChanged { get; set; }
    internal SuperPanelEscapeObserver(Action escape, ILowLevelKeyboardHookApi? api = null)
    {
        _api = api ?? new Win32LowLevelKeyboardHookApi();
        _callback = (code, message, pointer) =>
        {
            try
            {
                if (_active && code >= 0 && pointer != IntPtr.Zero
                    && (message.ToInt32() is NativeMethods.WmKeyDown or NativeMethods.WmSysKeyDown or NativeMethods.WmKeyUp or NativeMethods.WmSysKeyUp))
                {
                    var data = Marshal.PtrToStructure<NativeMethods.LowLevelKeyboardData>(pointer);
                    if ((data.Flags & 0x12) == 0)
                    {
                        if (data.VirtualKey == 0x1B && message.ToInt32() == NativeMethods.WmKeyDown) escape();
                        else CaptureInputChanged?.Invoke();
                    }
                }
            }
            catch { /* Contain exceptions at the unmanaged callback boundary. */ }
            try { return _api.CallNext(_hook, code, message, pointer); }
            catch { return IntPtr.Zero; }
        };
        _keepAlive = GCHandle.Alloc(this);
        try
        {
            _hook = _api.Install(_callback);
            if (_hook == IntPtr.Zero) throw new InvalidOperationException("Escape observer installation failed.");
        }
        catch { _keepAlive.Free(); throw; }
    }
    internal bool TryDispose(out int error)
    {
        _active = false; CaptureInputChanged = null; error = 0;
        if (_hook == IntPtr.Zero) return true;
        try { if (!_api.Uninstall(_hook, out error)) return false; }
        catch { error = -1; return false; }
        _hook = IntPtr.Zero;
        if (_keepAlive.IsAllocated) _keepAlive.Free();
        return true;
    }
}
