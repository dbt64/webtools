using System.Drawing;
using Forms = System.Windows.Forms;

namespace WebTools.NativeHost.Services;

internal sealed record LauncherTrayMenuColors(
    Color Background,
    Color Foreground,
    Color Muted,
    Color Border,
    Color Hover,
    Color Selected);

internal static class LauncherTrayMenuPalette
{
    public static LauncherTrayMenuColors ForTheme(string effectiveTheme)
    {
        var light = effectiveTheme == "light";
        return new LauncherTrayMenuColors(
            ColorTranslator.FromHtml(light ? "#ffffff" : "#18191b"),
            ColorTranslator.FromHtml(light ? "#1b2633" : "#f4f4f5"),
            ColorTranslator.FromHtml(light ? "#5f6f80" : "#a1a1aa"),
            ColorTranslator.FromHtml(light ? "#d6dee7" : "#2c2d30"),
            ColorTranslator.FromHtml(light ? "#edf2f7" : "#242528"),
            ColorTranslator.FromHtml(light ? "#e2edf9" : "#2b2c30"));
    }
}

internal sealed class LauncherTrayMenuRenderer(LauncherTrayMenuColors colors) : Forms.ToolStripProfessionalRenderer
{
    protected override void OnRenderToolStripBackground(Forms.ToolStripRenderEventArgs e)
    {
        using var brush = new SolidBrush(colors.Background);
        e.Graphics.FillRectangle(brush, e.AffectedBounds);
    }

    protected override void OnRenderMenuItemBackground(Forms.ToolStripItemRenderEventArgs e)
    {
        if (!e.Item.Selected && !e.Item.Pressed) return;
        var bounds = new Rectangle(Point.Empty, e.Item.Size);
        bounds.Inflate(-3, -1);
        using var brush = new SolidBrush(e.Item.Pressed ? colors.Selected : colors.Hover);
        e.Graphics.FillRectangle(brush, bounds);
    }

    protected override void OnRenderSeparator(Forms.ToolStripSeparatorRenderEventArgs e)
    {
        var bounds = e.Item.Bounds;
        using var pen = new Pen(colors.Border);
        var y = bounds.Top + bounds.Height / 2;
        e.Graphics.DrawLine(pen, bounds.Left + 8, y, bounds.Right - 8, y);
    }

    protected override void OnRenderToolStripBorder(Forms.ToolStripRenderEventArgs e)
    {
        var bounds = e.ToolStrip.ClientRectangle;
        if (bounds.Width < 2 || bounds.Height < 2) return;
        bounds.Width--;
        bounds.Height--;
        using var pen = new Pen(colors.Border);
        e.Graphics.DrawRectangle(pen, bounds);
    }
}
