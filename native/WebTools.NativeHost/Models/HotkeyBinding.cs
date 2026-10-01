using System.Windows.Forms;

namespace WebTools.NativeHost.Models;

[Flags]
internal enum HotkeyModifier
{
    None = 0,
    Control = 1,
    Alt = 2,
    Shift = 4,
    Win = 8,
}

internal abstract record HotkeyBinding(string Canonical, string DisplayText)
{
    internal sealed record Chord(
        HotkeyModifier Modifiers,
        Keys Key,
        string Canonical,
        string DisplayText) : HotkeyBinding(Canonical, DisplayText);

    internal sealed record FunctionKey(
        int Number,
        Keys Key,
        string Canonical,
        string DisplayText) : HotkeyBinding(Canonical, DisplayText);

    internal sealed record DoubleModifier(
        HotkeyModifier Modifier,
        string Canonical,
        string DisplayText) : HotkeyBinding(Canonical, DisplayText);
}
