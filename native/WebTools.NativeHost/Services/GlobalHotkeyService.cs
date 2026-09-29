using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using System.Windows.Interop;
using WebTools.NativeHost.Interop;

namespace WebTools.NativeHost.Services;

internal sealed record HotkeyDefinition(uint Modifiers, uint VirtualKey, string Canonical);

internal sealed class GlobalHotkeyService : IDisposable
{
    private static readonly Regex FunctionKeyPattern = new("^F(?:[1-9]|1[0-2])$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private readonly IntPtr _windowHandle;
    private readonly Action _onPressed;
    private readonly DiagnosticsService _diagnostics;
    private readonly HwndSource _source;
    private int _activeId = NativeMethods.HotkeyId;
    private bool _registered;
    private bool _disposed;

    public GlobalHotkeyService(IntPtr windowHandle, string shortcut, Action onPressed, DiagnosticsService diagnostics)
    {
        _windowHandle = windowHandle;
        _onPressed = onPressed;
        _diagnostics = diagnostics;
        _source = HwndSource.FromHwnd(windowHandle)
            ?? throw new InvalidOperationException("The launcher window has no WPF message source.");

        if (!TryParse(shortcut, out var definition))
            throw new ArgumentException("The configured global shortcut is invalid.", nameof(shortcut));
        if (!Register(windowHandle, definition, _activeId))
        {
            var error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, $"RegisterHotKey({definition.Canonical}) failed. The shortcut may be in use by another application.");
        }

        _registered = true;
        Shortcut = definition.Canonical;
        _source.AddHook(WindowProc);
        _diagnostics.Record("hotkey_registered", definition.Canonical);
    }

    public string Shortcut { get; private set; } = "";

    public bool TryReplace(string shortcut, out string error)
    {
        error = "";
        if (!TryParse(shortcut, out var next))
        {
            error = "快捷键格式无效。";
            return false;
        }
        if (next.Canonical.Equals(Shortcut, StringComparison.OrdinalIgnoreCase)) return true;

        var nextId = _activeId == NativeMethods.HotkeyId ? NativeMethods.AlternateHotkeyId : NativeMethods.HotkeyId;
        if (!Register(_windowHandle, next, nextId))
        {
            error = $"无法注册快捷键 {next.Canonical}，可能已被其他程序占用；原快捷键仍然有效。";
            _diagnostics.Record("hotkey_replace_failed", $"{next.Canonical};error={Marshal.GetLastWin32Error()}");
            return false;
        }

        var previousId = _activeId;
        if (_registered && !NativeMethods.UnregisterHotKey(_windowHandle, previousId))
        {
            var errorCode = Marshal.GetLastWin32Error();
            _diagnostics.Record("hotkey_unregister_error", errorCode.ToString());
            if (!NativeMethods.UnregisterHotKey(_windowHandle, nextId))
                _diagnostics.Record("hotkey_rollback_unregister_error", Marshal.GetLastWin32Error().ToString());
            error = "新快捷键已注册，但无法安全移除旧快捷键；已保留原快捷键设置。";
            return false;
        }
        _activeId = nextId;
        Shortcut = next.Canonical;
        _diagnostics.Record("hotkey_replaced", next.Canonical);
        return true;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _source.RemoveHook(WindowProc);
        if (_registered && !NativeMethods.UnregisterHotKey(_windowHandle, _activeId))
            _diagnostics.Record("hotkey_unregister_error", Marshal.GetLastWin32Error().ToString());
        _registered = false;
    }

    internal static bool TryParse(string? shortcut, out HotkeyDefinition definition)
    {
        definition = new HotkeyDefinition(0, 0, "");
        if (string.IsNullOrWhiteSpace(shortcut) || shortcut.Length > 80) return false;
        var parts = shortcut.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return false;

        uint modifiers = NativeMethods.ModNoRepeat;
        var modifierNames = new List<string>();
        string? key = null;
        foreach (var part in parts)
        {
            var normalized = part.ToLowerInvariant();
            var modifier = normalized switch
            {
                "control" or "ctrl" => (NativeMethods.ModControl, "Control"),
                "alt" => (NativeMethods.ModAlt, "Alt"),
                "shift" => (NativeMethods.ModShift, "Shift"),
                "super" or "win" or "meta" => (NativeMethods.ModWin, "Super"),
                _ => ((uint)0, ""),
            };
            if (modifier.Item1 != 0)
            {
                if (modifierNames.Contains(modifier.Item2, StringComparer.Ordinal)) return false;
                modifiers |= modifier.Item1;
                modifierNames.Add(modifier.Item2);
            }
            else
            {
                if (key is not null) return false;
                key = part;
            }
        }

        if (key is null || modifierNames.Count == 0 || !TryVirtualKey(key, out var virtualKey)) return false;
        var orderedModifiers = new[] { "Control", "Alt", "Shift", "Super" }.Where(modifierNames.Contains).ToList();
        definition = new HotkeyDefinition(modifiers, virtualKey, string.Join('+', orderedModifiers.Append(CanonicalKey(key))));
        return true;
    }

    private static bool TryVirtualKey(string key, out uint value)
    {
        if (key.Length == 1 && char.IsAsciiLetterOrDigit(key[0]))
        {
            value = char.ToUpperInvariant(key[0]);
            return true;
        }
        if (FunctionKeyPattern.IsMatch(key) && Enum.TryParse<Keys>(key, true, out var functionKey))
        {
            value = (uint)functionKey;
            return true;
        }
        var canonical = CanonicalKey(key);
        var named = canonical switch
        {
            "Space" => Keys.Space,
            "Up" => Keys.Up,
            "Down" => Keys.Down,
            "Left" => Keys.Left,
            "Right" => Keys.Right,
            "PageUp" => Keys.PageUp,
            "PageDown" => Keys.PageDown,
            "Home" => Keys.Home,
            "End" => Keys.End,
            "Insert" => Keys.Insert,
            "Delete" => Keys.Delete,
            "Backspace" => Keys.Back,
            "Tab" => Keys.Tab,
            "Enter" => Keys.Enter,
            _ => Keys.None,
        };
        value = (uint)named;
        return named != Keys.None;
    }

    private static string CanonicalKey(string key) => key.ToLowerInvariant() switch
    {
        "space" or " " => "Space",
        "up" or "arrowup" => "Up",
        "down" or "arrowdown" => "Down",
        "left" or "arrowleft" => "Left",
        "right" or "arrowright" => "Right",
        "pageup" => "PageUp",
        "pagedown" => "PageDown",
        "backspace" => "Backspace",
        var name when name.Length == 1 => name.ToUpperInvariant(),
        _ => key,
    };

    private static bool Register(IntPtr handle, HotkeyDefinition definition, int id) =>
        NativeMethods.RegisterHotKey(handle, id, definition.Modifiers, definition.VirtualKey);

    private IntPtr WindowProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message == NativeMethods.WmHotkey && wParam.ToInt32() == _activeId)
        {
            handled = true;
            _diagnostics.Record("hotkey_received", Shortcut);
            _onPressed();
        }
        return IntPtr.Zero;
    }
}
