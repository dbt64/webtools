using System.Globalization;
using System.Windows.Forms;
using WebTools.NativeHost.Models;

namespace WebTools.NativeHost.Services;

internal static class HotkeyBindingCodec
{
    private const HotkeyModifier AllModifiers = HotkeyModifier.Control | HotkeyModifier.Alt | HotkeyModifier.Shift | HotkeyModifier.Win;
    private static readonly string[] ModifierOrder = ["Control", "Alt", "Shift", "Super"];

    internal static bool TryParse(string? value, out HotkeyBinding binding)
    {
        binding = null!;
        if (string.IsNullOrWhiteSpace(value) || value.Length > 80) return false;

        var candidate = value.Trim();
        if (candidate.StartsWith("DoubleModifier:", StringComparison.OrdinalIgnoreCase))
            return TryParseDoubleModifier(candidate["DoubleModifier:".Length..], out binding);

        var functionKeyText = candidate.StartsWith("FunctionKey:", StringComparison.OrdinalIgnoreCase)
            ? candidate["FunctionKey:".Length..]
            : candidate;
        if (TryParseFunctionKey(functionKeyText, out var functionKey))
        {
            binding = functionKey;
            return true;
        }
        if (candidate.StartsWith("FunctionKey:", StringComparison.OrdinalIgnoreCase)) return false;

        return TryParseChord(candidate, out binding);
    }

    internal static string Serialize(HotkeyBinding binding) => binding.Canonical;

    internal static string FormatDisplay(HotkeyBinding binding) => binding.DisplayText;

    private static bool TryParseDoubleModifier(string value, out HotkeyBinding binding)
    {
        var modifier = value.Trim().ToLowerInvariant() switch
        {
            "control" or "ctrl" => HotkeyModifier.Control,
            "alt" => HotkeyModifier.Alt,
            _ => HotkeyModifier.None,
        };
        if (modifier == HotkeyModifier.None)
        {
            binding = null!;
            return false;
        }

        var canonicalName = modifier == HotkeyModifier.Control ? "Control" : "Alt";
        var displayName = modifier == HotkeyModifier.Control ? "Ctrl" : "Alt";
        binding = new HotkeyBinding.DoubleModifier(modifier, $"DoubleModifier:{canonicalName}", $"双击 {displayName}");
        return true;
    }

    private static bool TryParseFunctionKey(string value, out HotkeyBinding.FunctionKey binding)
    {
        binding = null!;
        var keyText = value.Trim();
        if (keyText.Length < 2 || char.ToUpperInvariant(keyText[0]) != 'F'
            || !int.TryParse(keyText.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out var number)
            || number is < 1 or > 10)
            return false;

        var canonical = $"FunctionKey:F{number}";
        binding = new HotkeyBinding.FunctionKey(number, (Keys)Enum.Parse(typeof(Keys), $"F{number}"), canonical, $"F{number}");
        return true;
    }

    private static bool TryParseChord(string value, out HotkeyBinding binding)
    {
        binding = null!;
        var parts = value.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return false;

        var modifiers = HotkeyModifier.None;
        string? keyText = null;
        foreach (var part in parts)
        {
            var modifier = part.ToLowerInvariant() switch
            {
                "control" or "ctrl" => HotkeyModifier.Control,
                "alt" => HotkeyModifier.Alt,
                "shift" => HotkeyModifier.Shift,
                "super" or "win" or "meta" => HotkeyModifier.Win,
                _ => HotkeyModifier.None,
            };
            if (modifier != HotkeyModifier.None)
            {
                if ((modifiers & modifier) != 0) return false;
                modifiers |= modifier;
            }
            else
            {
                if (keyText is not null) return false;
                keyText = part;
            }
        }

        if (modifiers == HotkeyModifier.None || (modifiers & ~AllModifiers) != 0 || keyText is null || !TryParseKey(keyText, out var key, out var canonicalKey))
            return false;

        var canonicalModifiers = ModifierOrder
            .Where(name => IsModifierSet(modifiers, name))
            .ToArray();
        var canonical = string.Join('+', canonicalModifiers.Append(canonicalKey));
        var display = string.Join(" + ", canonicalModifiers.Select(FormatModifier).Append(canonicalKey));
        binding = new HotkeyBinding.Chord(modifiers, key, canonical, display);
        return true;
    }

    private static bool TryParseKey(string value, out Keys key, out string canonical)
    {
        key = Keys.None;
        canonical = "";
        var text = value.Trim();
        if (text.Length == 1 && char.IsAsciiLetterOrDigit(text[0]))
        {
            key = (Keys)char.ToUpperInvariant(text[0]);
            canonical = char.ToUpperInvariant(text[0]).ToString();
            return true;
        }

        var normalized = text.ToLowerInvariant() switch
        {
            "space" or " " => "Space",
            "up" or "arrowup" => "Up",
            "down" or "arrowdown" => "Down",
            "left" or "arrowleft" => "Left",
            "right" or "arrowright" => "Right",
            "pageup" => "PageUp",
            "pagedown" => "PageDown",
            "home" => "Home",
            "end" => "End",
            "insert" => "Insert",
            "delete" => "Delete",
            "backspace" => "Backspace",
            "tab" => "Tab",
            "enter" => "Enter",
            var name when name.Length >= 2 && name[0] == 'f'
                && int.TryParse(name.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out var number)
                && number is >= 1 and <= 12 => $"F{number}",
            _ => "",
        };
        if (normalized.Length == 0 || !Enum.TryParse(normalized, true, out key) || key == Keys.None) return false;
        canonical = normalized;
        return true;
    }

    private static bool IsModifierSet(HotkeyModifier modifiers, string name) => name switch
    {
        "Control" => (modifiers & HotkeyModifier.Control) != 0,
        "Alt" => (modifiers & HotkeyModifier.Alt) != 0,
        "Shift" => (modifiers & HotkeyModifier.Shift) != 0,
        "Super" => (modifiers & HotkeyModifier.Win) != 0,
        _ => false,
    };

    private static string FormatModifier(string name) => name switch
    {
        "Control" => "Ctrl",
        "Super" => "Win",
        _ => name,
    };
}
