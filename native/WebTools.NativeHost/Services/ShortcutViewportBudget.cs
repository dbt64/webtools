namespace WebTools.NativeHost.Services;

public static class ShortcutViewportBudget
{
    public static (double Websites, double Plugins) Calculate(int websiteCount, bool websitesExpanded, int pluginCount, bool pluginsExpanded, double available)
    {
        const double row = 60;
        var websites = websitesExpanded ? Math.Clamp((websiteCount + 5) / 6, 1, 4) * row : row;
        var plugins = pluginsExpanded ? Math.Clamp((pluginCount + 5) / 6, 1, 4) * row : row;
        var wantedExtra = websites + plugins - 2 * row;
        var extra = Math.Max(0, available - 2 * row);
        if (wantedExtra > extra) {
            var ratio = extra / wantedExtra;
            websites = row + (websites - row) * ratio;
            plugins = row + (plugins - row) * ratio;
        }
        return (websites, plugins);
    }
}
