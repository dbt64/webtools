using System.IO;
using System.Text.Json;
using WebTools.NativeHost.Search;

namespace WebTools.NativeHost.Data;

public sealed record SearchEngineData(string Id, string Name, string Template, bool Enabled, bool BuiltIn = false, int Order = 0);

public sealed record WebsiteSnapshot(
    IReadOnlyList<SearchEntry> Websites, IReadOnlyList<SearchEngineData> SearchEngines,
    string DefaultSearchEngineId, bool EverythingEnabled, string EverythingEsPath, bool ExpandedByDefault)
{
    public string BuildWebSearchUrl(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) throw new ArgumentException("Search query is empty.", nameof(query));
        var engine = SearchEngines.FirstOrDefault(item => item.Enabled && item.Id == DefaultSearchEngineId)
            ?? SearchEngines.FirstOrDefault(item => item.Enabled)
            ?? throw new InvalidOperationException("No enabled search engine is configured.");
        if (engine.Template.Split("%s", StringSplitOptions.None).Length != 2)
            throw new InvalidOperationException("Search engine template must contain exactly one %s placeholder.");
        var url = engine.Template.Replace("%s", Uri.EscapeDataString(query.Trim()), StringComparison.Ordinal);
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("http" or "https") || parsed.UserInfo.Length > 0)
            throw new InvalidOperationException("Search engine URL is invalid.");
        return parsed.AbsoluteUri;
    }
}

public static class WebsiteDataLoader
{
    public static WebsiteSnapshot Empty() => Defaults();
    public static string ProductionPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Nook", "nook-data.json");

    public static WebsiteSnapshot Read(string? path = null)
    {
        path ??= ProductionPath;
        if (!File.Exists(path)) return Defaults();
        using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("version", out var version) || version.GetInt32() != 2)
            throw new InvalidDataException("Native read-only loader requires the current v2 website data; Electron remains its writer.");

        var websites = new List<SearchEntry>();
        if (root.TryGetProperty("webEntries", out var webEntries) && webEntries.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in webEntries.EnumerateArray())
            {
                if (!TryString(item, "id", out var id) || !TryString(item, "name", out var name) || !TryString(item, "url", out var url)) continue;
                var description = TryString(item, "description", out var text) ? text : "";
                websites.Add(SearchEntry.Website(id, name, url, description));
            }
        }

        var settings = root.TryGetProperty("settings", out var configured) && configured.ValueKind == JsonValueKind.Object ? configured : default;
        var engines = new List<SearchEngineData>();
        if (settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("searchEngines", out var searchEngines) && searchEngines.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in searchEngines.EnumerateArray())
            {
                if (!TryString(item, "id", out var id) || !TryString(item, "name", out var name) || !TryString(item, "template", out var template)) continue;
                var enabledFlag = !item.TryGetProperty("enabled", out var enabled) || enabled.ValueKind != JsonValueKind.False;
                var builtIn = item.TryGetProperty("builtIn", out var builtInElement) && builtInElement.ValueKind == JsonValueKind.True;
                var order = item.TryGetProperty("order", out var orderElement) && orderElement.TryGetInt32(out var readOrder) ? Math.Max(0, readOrder) : engines.Count;
                engines.Add(new SearchEngineData(id, name, template, enabledFlag, builtIn, order));
            }
        }
        if (engines.Count == 0) engines.AddRange(DefaultEngines);
        var defaultId = TryString(settings, "defaultSearchEngineId", out var selected) ? selected : "google";
        var everythingEnabled = settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("everythingEnabled", out var enabledSetting) && enabledSetting.ValueKind == JsonValueKind.True;
        var esPath = TryString(settings, "everythingEsPath", out var configuredPath) ? configuredPath : "";
        var expanded = TryString(settings, "launcherDisplayMode", out var mode) && mode == "expanded";
        return new WebsiteSnapshot(websites, engines, defaultId, everythingEnabled, esPath, expanded);
    }

    private static bool TryString(JsonElement element, string property, out string value)
    {
        value = "";
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var field) || field.ValueKind != JsonValueKind.String) return false;
        value = field.GetString() ?? "";
        return true;
    }

    private static readonly SearchEngineData[] DefaultEngines =
    [
        new("google", "Google", "https://www.google.com/search?q=%s", true),
        new("baidu", "百度", "https://www.baidu.com/s?wd=%s", true),
        new("bilibili", "Bilibili", "https://search.bilibili.com/all?keyword=%s", true),
    ];

    private static WebsiteSnapshot Defaults() => new([], DefaultEngines, "google", false, "", false);
}
