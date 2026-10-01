using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Windows.Interop;
using WebTools.NativeHost.Interop;
using WebTools.NativeHost.Models;

namespace WebTools.NativeHost.Services;

internal sealed record HotkeyDefinition(uint Modifiers, uint VirtualKey, string Canonical);

internal interface IGlobalHotkeyRegistrationApi
{
    bool Register(IntPtr windowHandle, int id, HotkeyDefinition definition, out int errorCode);
    bool Unregister(IntPtr windowHandle, int id, out int errorCode);
}

internal sealed class Win32GlobalHotkeyRegistrationApi : IGlobalHotkeyRegistrationApi
{
    public bool Register(IntPtr windowHandle, int id, HotkeyDefinition definition, out int errorCode)
    {
        var result = NativeMethods.RegisterHotKey(windowHandle, id, definition.Modifiers, definition.VirtualKey);
        errorCode = result ? 0 : Marshal.GetLastWin32Error();
        return result;
    }

    public bool Unregister(IntPtr windowHandle, int id, out int errorCode)
    {
        var result = NativeMethods.UnregisterHotKey(windowHandle, id);
        errorCode = result ? 0 : Marshal.GetLastWin32Error();
        return result;
    }
}

internal sealed class GlobalHotkeyService : IDisposable
{
    private readonly IntPtr _windowHandle;
    private readonly Action _onPressed;
    private readonly DiagnosticsService _diagnostics;
    private readonly HwndSource _source;
    private readonly IGlobalHotkeyRegistrationApi _registrationApi;
    private readonly Func<HotkeyModifier, Action, IHotkeyKeyboardObserver> _observerFactory;
    private readonly List<IHotkeyKeyboardObserver> _retiredObservers = [];
    private HotkeyBinding _binding;
    private IHotkeyKeyboardObserver? _observer;
    private int _activeId = NativeMethods.HotkeyId;
    private bool _registered;
    private bool _disposed;

    public GlobalHotkeyService(IntPtr windowHandle, string shortcut, Action onPressed, DiagnosticsService diagnostics)
        : this(windowHandle, shortcut, onPressed, diagnostics, null, null)
    {
    }

    internal GlobalHotkeyService(
        IntPtr windowHandle,
        string shortcut,
        Action onPressed,
        DiagnosticsService diagnostics,
        IGlobalHotkeyRegistrationApi? registrationApi,
        Func<HotkeyModifier, Action, IHotkeyKeyboardObserver>? observerFactory)
    {
        _windowHandle = windowHandle;
        _onPressed = onPressed;
        _diagnostics = diagnostics;
        _source = HwndSource.FromHwnd(windowHandle)
            ?? throw new InvalidOperationException("The launcher window has no WPF message source.");
        _registrationApi = registrationApi ?? new Win32GlobalHotkeyRegistrationApi();
        _observerFactory = observerFactory ?? ((modifier, activated) => new LowLevelKeyboardObserver(
            modifier,
            activated,
            action => _source.Dispatcher.BeginInvoke(action)));

        if (!HotkeyBindingCodec.TryParse(shortcut, out _binding!))
            throw new ArgumentException("The configured global shortcut is invalid.", nameof(shortcut));

        switch (_binding)
        {
            case HotkeyBinding.DoubleModifier doubleModifier:
                _observer = CreateObserver(doubleModifier.Modifier);
                break;
            case HotkeyBinding.Chord or HotkeyBinding.FunctionKey:
                var definition = ToDefinition(_binding);
                if (!Register(definition, _activeId, out var errorCode))
                    throw new Win32Exception(errorCode, $"RegisterHotKey({definition.Canonical}) failed. The shortcut may be in use by another application.");
                _registered = true;
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(shortcut), "The configured global shortcut has an unsupported mode.");
        }

        _source.AddHook(WindowProc);
        _diagnostics.Record("hotkey_registered", _binding.Canonical);
    }

    public string Shortcut => _binding.Canonical;

    public bool TryReplace(string shortcut, out string error)
    {
        error = "";
        if (_disposed)
        {
            error = "快捷键服务已关闭。";
            return false;
        }
        if (!HotkeyBindingCodec.TryParse(shortcut, out var next))
        {
            error = "快捷键格式无效。";
            return false;
        }
        if (next.Canonical.Equals(_binding.Canonical, StringComparison.OrdinalIgnoreCase)) return true;

        if (_binding is HotkeyBinding.DoubleModifier currentDouble && next is HotkeyBinding.DoubleModifier nextDouble)
        {
            if (_observer is null)
            {
                error = "双击快捷键观察器尚未初始化。";
                return false;
            }
            try { _observer.SetModifier(nextDouble.Modifier); }
            catch (Exception failure)
            {
                error = "无法更新双击快捷键；原快捷键仍保持有效。";
                _diagnostics.Record("hotkey_replace_failed", $"{next.Canonical};reason={failure.GetType().Name}");
                return false;
            }
            _binding = next;
            _diagnostics.Record("hotkey_replaced", next.Canonical);
            return true;
        }

        if (next is HotkeyBinding.DoubleModifier nextObserverBinding)
            return TryReplaceWithObserver(nextObserverBinding, out error);

        return TryReplaceWithRegistration(next, out error);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _source.RemoveHook(WindowProc);

        if (_registered)
        {
            if (!_registrationApi.Unregister(_windowHandle, _activeId, out var errorCode))
                _diagnostics.Record("hotkey_unregister_error", errorCode.ToString());
            _registered = false;
        }

        if (_observer is not null)
        {
            _observer.Deactivate();
            if (!_observer.TryDispose(out var errorCode))
            {
                _diagnostics.Record("keyboard_observer_unhook_error", errorCode.ToString());
                _retiredObservers.Add(_observer);
            }
            _observer = null;
        }

        foreach (var observer in _retiredObservers)
        {
            observer.Deactivate();
            if (!observer.TryDispose(out var errorCode))
                _diagnostics.Record("keyboard_observer_unhook_error", errorCode.ToString());
        }
        _retiredObservers.Clear();
    }

    internal static bool TryParse(string? shortcut, out HotkeyDefinition definition)
    {
        definition = new HotkeyDefinition(0, 0, "");
        if (!HotkeyBindingCodec.TryParse(shortcut, out var binding)) return false;
        definition = ToDefinition(binding);
        return true;
    }

    private IHotkeyKeyboardObserver CreateObserver(HotkeyModifier modifier)
    {
        var observer = _observerFactory(modifier, _onPressed);
        if (observer.Modifier == modifier) return observer;

        observer.Deactivate();
        if (!observer.TryDispose(out var errorCode)) _retiredObservers.Add(observer);
        throw new InvalidOperationException($"The keyboard observer factory returned the wrong modifier (error={errorCode}).");
    }

    private bool TryReplaceWithObserver(HotkeyBinding.DoubleModifier next, out string error)
    {
        error = "";
        IHotkeyKeyboardObserver candidate;
        try { candidate = CreateObserver(next.Modifier); }
        catch (Exception failure)
        {
            error = "无法安装双击快捷键观察器；原快捷键仍保持有效。";
            _diagnostics.Record("hotkey_replace_failed", $"{next.Canonical};reason={failure.GetType().Name}");
            return false;
        }

        if (_registered && !_registrationApi.Unregister(_windowHandle, _activeId, out var unregisterError))
        {
            RetireCandidate(candidate);
            _diagnostics.Record("hotkey_unregister_error", unregisterError.ToString());
            error = "无法安全移除原快捷键；原快捷键仍保持有效。";
            return false;
        }

        _registered = false;
        _observer = candidate;
        _binding = next;
        _diagnostics.Record("hotkey_replaced", next.Canonical);
        return true;
    }

    private bool TryReplaceWithRegistration(HotkeyBinding next, out string error)
    {
        error = "";
        var definition = ToDefinition(next);
        var nextId = _activeId == NativeMethods.HotkeyId ? NativeMethods.AlternateHotkeyId : NativeMethods.HotkeyId;
        if (!Register(definition, nextId, out var registerError))
        {
            _diagnostics.Record("hotkey_replace_failed", $"{next.Canonical};error={registerError}");
            error = $"无法注册快捷键 {next.Canonical}，可能已被其他程序占用；原快捷键仍然有效。";
            return false;
        }

        if (_observer is not null)
        {
            if (!_observer.TryDispose(out var observerError))
            {
                if (!_registrationApi.Unregister(_windowHandle, nextId, out var rollbackError))
                    _diagnostics.Record("hotkey_rollback_unregister_error", rollbackError.ToString());
                _diagnostics.Record("keyboard_observer_unhook_error", observerError.ToString());
                error = "无法安全移除双击观察器；原快捷键仍保持有效。";
                return false;
            }
            _observer = null;
        }
        else if (_registered && !_registrationApi.Unregister(_windowHandle, _activeId, out var previousError))
        {
            if (!_registrationApi.Unregister(_windowHandle, nextId, out var rollbackError))
                _diagnostics.Record("hotkey_rollback_unregister_error", rollbackError.ToString());
            _diagnostics.Record("hotkey_unregister_error", previousError.ToString());
            error = "无法安全移除旧快捷键；原快捷键仍然有效。";
            return false;
        }

        _activeId = nextId;
        _registered = true;
        _binding = next;
        _diagnostics.Record("hotkey_replaced", next.Canonical);
        return true;
    }

    private void RetireCandidate(IHotkeyKeyboardObserver observer)
    {
        observer.Deactivate();
        if (!observer.TryDispose(out var errorCode))
        {
            _diagnostics.Record("keyboard_observer_unhook_error", errorCode.ToString());
            _retiredObservers.Add(observer);
        }
    }

    private bool Register(HotkeyDefinition definition, int id, out int errorCode) =>
        _registrationApi.Register(_windowHandle, id, definition, out errorCode);

    private static HotkeyDefinition ToDefinition(HotkeyBinding binding) => binding switch
    {
        HotkeyBinding.Chord chord => new HotkeyDefinition(ToNativeModifiers(chord.Modifiers), (uint)chord.Key, chord.Canonical),
        HotkeyBinding.FunctionKey functionKey => new HotkeyDefinition(NativeMethods.ModNoRepeat, (uint)functionKey.Key, functionKey.Canonical),
        HotkeyBinding.DoubleModifier doubleModifier => new HotkeyDefinition(0, 0, doubleModifier.Canonical),
        _ => throw new ArgumentOutOfRangeException(nameof(binding)),
    };

    private static uint ToNativeModifiers(HotkeyModifier modifiers)
    {
        var native = NativeMethods.ModNoRepeat;
        if ((modifiers & HotkeyModifier.Control) != 0) native |= NativeMethods.ModControl;
        if ((modifiers & HotkeyModifier.Alt) != 0) native |= NativeMethods.ModAlt;
        if ((modifiers & HotkeyModifier.Shift) != 0) native |= NativeMethods.ModShift;
        if ((modifiers & HotkeyModifier.Win) != 0) native |= NativeMethods.ModWin;
        return native;
    }

    private IntPtr WindowProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (!_disposed && _registered && message == NativeMethods.WmHotkey && wParam.ToInt32() == _activeId)
        {
            handled = true;
            _diagnostics.Record("hotkey_received", Shortcut);
            _onPressed();
        }
        return IntPtr.Zero;
    }
}
