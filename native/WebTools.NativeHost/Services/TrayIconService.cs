using System.Drawing;
using System.IO;
using Forms = System.Windows.Forms;

namespace WebTools.NativeHost.Services;

internal sealed class TrayIconService : IDisposable
{
    private readonly Forms.NotifyIcon _icon;
    private readonly Forms.ContextMenuStrip _menu;
    private readonly Font _menuFont;
    private readonly Icon? _ownedIcon;
    private string? _effectiveTheme;

    public TrayIconService(Action openManager, Action openEntries, Action openSettings, Action openTranslation, Action showLauncher, Action onExit)
    {
        _menuFont = new Font("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
        _menu = new Forms.ContextMenuStrip
        {
            Font = _menuFont,
            Padding = new Forms.Padding(4),
            ShowCheckMargin = false,
            ShowImageMargin = false,
        };
        _menu.Items.Add(CreateMenuItem("Open WebTools", openManager));
        _menu.Items.Add(CreateMenuItem("Websites", openEntries));
        _menu.Items.Add(CreateMenuItem("Translation", openTranslation));
        _menu.Items.Add(CreateMenuItem("Settings", openSettings));
        _menu.Items.Add(new Forms.ToolStripSeparator { Margin = new Forms.Padding(7, 3, 7, 3) });
        _menu.Items.Add(CreateMenuItem("Exit", onExit));
        EnsureMenuWidth(_menu);
        _menu.Opening += (_, _) => EnsureMenuWidth(_menu);

        var iconPath = ResolveIconPath(AppContext.BaseDirectory);
        try { _ownedIcon = iconPath is null ? null : new Icon(iconPath); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or System.Runtime.InteropServices.ExternalException)
        {
            _ownedIcon = null;
        }

        _icon = new Forms.NotifyIcon
        {
            Icon = _ownedIcon ?? SystemIcons.Application,
            Text = "WebTools Native Host",
            ContextMenuStrip = _menu,
            Visible = true,
        };
        _icon.DoubleClick += (_, _) => showLauncher();
    }

    internal void ApplyEffectiveTheme(string effectiveTheme)
    {
        effectiveTheme = effectiveTheme == "light" ? "light" : "dark";
        if (_effectiveTheme == effectiveTheme) return;
        _effectiveTheme = effectiveTheme;
        var colors = LauncherTrayMenuPalette.ForTheme(effectiveTheme);
        _menu.BackColor = colors.Background;
        _menu.ForeColor = colors.Foreground;
        _menu.Renderer = new LauncherTrayMenuRenderer(colors);
        foreach (Forms.ToolStripItem item in _menu.Items)
        {
            item.BackColor = colors.Background;
            item.ForeColor = item.Enabled ? colors.Foreground : colors.Muted;
        }
        _menu.Invalidate(true);
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        _menu.Dispose();
        _menuFont.Dispose();
        _ownedIcon?.Dispose();
    }

    internal static Forms.ToolStripMenuItem CreateMenuItem(string text, Action action)
    {
        var item = new Forms.ToolStripMenuItem(text)
        {
            AutoSize = true,
            Margin = new Forms.Padding(2, 1, 2, 1),
            Padding = new Forms.Padding(11, 0, 11, 0),
        };
        item.Click += (_, _) => action();
        return item;
    }

    internal static void EnsureMenuWidth(Forms.ContextMenuStrip menu)
    {
        var labelWidth = menu.Items.OfType<Forms.ToolStripMenuItem>()
            .Select(item => Forms.TextRenderer.MeasureText(item.Text, item.Font).Width)
            .DefaultIfEmpty(0).Max();
        menu.MinimumSize = new Size(Math.Max(160, labelWidth + 96), 0);
    }

    internal static string? ResolveIconPath(string baseDirectory)
    {
        var path = Path.Combine(baseDirectory, "app.ico");
        return File.Exists(path) ? path : null;
    }
}
