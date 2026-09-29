using System.Windows;
using System.Windows.Media;

namespace WebTools.NativeHost.Services;

internal static class LauncherThemePalette
{
    public static string ResolveEffectiveTheme(string preference, string systemTheme) => preference switch
    {
        "light" => "light",
        "dark" => "dark",
        _ => systemTheme == "light" ? "light" : "dark",
    };

    public static void Apply(ResourceDictionary resources, string preference, string systemTheme)
    {
        var light = ResolveEffectiveTheme(preference, systemTheme) == "light";
        Set(resources, "CanvasBrush", light ? "#f3f5f8" : "#0b0c0e");
        Set(resources, "SurfaceBrush", light ? "#ffffff" : "#18191b");
        Set(resources, "RaisedBrush", light ? "#f7f9fb" : "#202124");
        Set(resources, "LineBrush", light ? "#d6dee7" : "#2c2d30");
        Set(resources, "TextBrush", light ? "#1b2633" : "#f4f4f5");
        Set(resources, "MutedBrush", light ? "#5f6f80" : "#a1a1aa");
        Set(resources, "QuietBrush", light ? "#8491a0" : "#85858d");
        Set(resources, "AccentBrush", light ? "#2868b2" : "#e4e4e7");
        Set(resources, "AccentInkBrush", light ? "#ffffff" : "#111214");
        Set(resources, "AccentSoftBrush", light ? "#e7f0fb" : "#27282b");
        Set(resources, "HoverBrush", light ? "#edf2f7" : "#242528");
        Set(resources, "SelectedBrush", light ? "#e2edf9" : "#2b2c30");
        Set(resources, "BrandBrush", "#000000");
    }

    private static void Set(ResourceDictionary resources, string key, string value)
    {
        var brush = new SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(value));
        brush.Freeze();
        resources[key] = brush;
    }
}
