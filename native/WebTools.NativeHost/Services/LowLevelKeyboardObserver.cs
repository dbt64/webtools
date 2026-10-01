using System.ComponentModel;
using System.Runtime.InteropServices;
using WebTools.NativeHost.Interop;
using WebTools.NativeHost.Models;

namespace WebTools.NativeHost.Services;

internal interface IHotkeyKeyboardObserver : IDisposable
{
    HotkeyModifier Modifier { get; }
    void SetModifier(HotkeyModifier modifier);
    void Deactivate();
    bool TryDispose(out int errorCode);
}

internal interface ILowLevelKeyboardHookApi
{
    IntPtr Install(NativeMethods.LowLevelKeyboardProc callback);
    bool Uninstall(IntPtr hook, out int errorCode);
    IntPtr CallNext(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
}

internal sealed class Win32LowLevelKeyboardHookApi : ILowLevelKeyboardHookApi
{
    public IntPtr Install(NativeMethods.LowLevelKeyboardProc callback)
    {
        var module = NativeMethods.GetModuleHandle(null);
        if (module == IntPtr.Zero)
        {
            var moduleError = Marshal.GetLastWin32Error();
            throw new Win32Exception(moduleError, "Could not resolve the NativeHost module for the keyboard observer.");
        }

        var hook = NativeMethods.SetWindowsHookEx(NativeMethods.WhKeyboardLl, callback, module, 0);
        if (hook == IntPtr.Zero)
        {
            var errorCode = Marshal.GetLastWin32Error();
            throw new Win32Exception(errorCode, "Could not install the low-level keyboard observer.");
        }
        return hook;
    }

    public bool Uninstall(IntPtr hook, out int errorCode)
    {
        var success = NativeMethods.UnhookWindowsHookEx(hook);
        errorCode = success ? 0 : Marshal.GetLastWin32Error();
        return success;
    }

    public IntPtr CallNext(IntPtr hook, int code, IntPtr wParam, IntPtr lParam) =>
        NativeMethods.CallNextHookEx(hook, code, wParam, lParam);
}

/// <summary>Passively observes global key transitions for one Double Ctrl/Double Alt binding.</summary>
internal sealed class LowLevelKeyboardObserver : IHotkeyKeyboardObserver
{
    private readonly ILowLevelKeyboardHookApi _hookApi;
    private readonly Action<Action> _schedule;
    private readonly Action _onActivated;
    private DoubleModifierGestureRecognizer _recognizer;
    private readonly NativeMethods.LowLevelKeyboardProc _callback;
    private IntPtr _hook;
    private bool _disposed;
    private bool _active = true;
    private long _activationGeneration;

    internal LowLevelKeyboardObserver(
        HotkeyModifier modifier,
        Action onActivated,
        Action<Action> schedule,
        ILowLevelKeyboardHookApi? hookApi = null)
    {
        if (modifier is not (HotkeyModifier.Control or HotkeyModifier.Alt))
            throw new ArgumentOutOfRangeException(nameof(modifier), "Only Ctrl and Alt double taps are supported.");

        Modifier = modifier;
        _onActivated = onActivated ?? throw new ArgumentNullException(nameof(onActivated));
        _schedule = schedule ?? throw new ArgumentNullException(nameof(schedule));
        _hookApi = hookApi ?? new Win32LowLevelKeyboardHookApi();
        _recognizer = new DoubleModifierGestureRecognizer(modifier);
        _callback = HookCallback;
        _hook = _hookApi.Install(_callback);
        if (_hook == IntPtr.Zero)
            throw new Win32Exception("The keyboard observer API returned an invalid hook handle.");
    }

    public HotkeyModifier Modifier { get; private set; }

    public void SetModifier(HotkeyModifier modifier)
    {
        if (modifier is not (HotkeyModifier.Control or HotkeyModifier.Alt))
            throw new ArgumentOutOfRangeException(nameof(modifier), "Only Ctrl and Alt double taps are supported.");
        if (_disposed) throw new ObjectDisposedException(nameof(LowLevelKeyboardObserver));
        if (Modifier == modifier) return;

        Modifier = modifier;
        _recognizer = new DoubleModifierGestureRecognizer(modifier);
        Interlocked.Increment(ref _activationGeneration);
    }

    public void Deactivate()
    {
        if (!_active) return;
        _active = false;
        Interlocked.Increment(ref _activationGeneration);
    }

    private IntPtr HookCallback(int code, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (!_disposed && _active && code >= 0
                && TryTranslateKeyMessage(wParam.ToInt32(), ReadVirtualKey(lParam), out var virtualKey, out var modifier, out var isDown)
                && _recognizer.ProcessKeyEvent(virtualKey, modifier, isDown, Environment.TickCount64))
            {
                var generation = Interlocked.Read(ref _activationGeneration);
                _schedule(() =>
                {
                    if (!_disposed && generation == Interlocked.Read(ref _activationGeneration))
                        _onActivated();
                });
            }
        }
        catch
        {
            // A managed exception must never cross the unmanaged hook callback boundary.
        }

        try
        {
            return _hookApi.CallNext(_hook, code, wParam, lParam);
        }
        catch
        {
            return IntPtr.Zero;
        }
    }

    private static uint ReadVirtualKey(IntPtr dataPointer)
    {
        if (dataPointer == IntPtr.Zero) return 0;
        return Marshal.PtrToStructure<NativeMethods.LowLevelKeyboardData>(dataPointer).VirtualKey;
    }

    internal static bool TryTranslateKeyMessage(
        int message,
        uint virtualKey,
        out uint normalizedVirtualKey,
        out HotkeyModifier? modifier,
        out bool isDown)
    {
        normalizedVirtualKey = virtualKey;
        modifier = null;
        isDown = message is NativeMethods.WmKeyDown or NativeMethods.WmSysKeyDown;
        if (!isDown && message is not (NativeMethods.WmKeyUp or NativeMethods.WmSysKeyUp)) return false;

        switch (virtualKey)
        {
            case NativeMethods.VkControl:
            case NativeMethods.VkLControl:
            case NativeMethods.VkRControl:
                normalizedVirtualKey = NativeMethods.VkControl;
                modifier = HotkeyModifier.Control;
                break;
            case NativeMethods.VkMenu:
            case NativeMethods.VkLMenu:
            case NativeMethods.VkRMenu:
                normalizedVirtualKey = NativeMethods.VkMenu;
                modifier = HotkeyModifier.Alt;
                break;
            case NativeMethods.VkShift:
            case NativeMethods.VkLShift:
            case NativeMethods.VkRShift:
                normalizedVirtualKey = NativeMethods.VkShift;
                modifier = HotkeyModifier.Shift;
                break;
            case NativeMethods.VkLWin:
            case NativeMethods.VkRWin:
                modifier = HotkeyModifier.Win;
                break;
        }

        return true;
    }

    public bool TryDispose(out int errorCode)
    {
        errorCode = 0;
        if (_disposed) return true;
        if (_hook == IntPtr.Zero)
        {
            _disposed = true;
            return true;
        }

        Interlocked.Increment(ref _activationGeneration);
        if (!_hookApi.Uninstall(_hook, out errorCode)) return false;
        _hook = IntPtr.Zero;
        _disposed = true;
        Interlocked.Increment(ref _activationGeneration);
        return true;
    }

    public void Dispose()
    {
        if (!TryDispose(out var errorCode))
            throw new Win32Exception(errorCode, "Could not remove the low-level keyboard observer.");
    }
}
