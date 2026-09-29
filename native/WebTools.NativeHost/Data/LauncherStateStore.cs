using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using WebTools.NativeHost.Search;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.Data;

public sealed record LauncherWebsiteRecord(string Id, string Name, string Url, string Description, IReadOnlyList<string> FolderIds);
public sealed record AppSearchMemoryRecord(string Query, string AppId, long LastUsedAt);

/// <summary>Only the data needed by the resident Native Launcher. Secrets and Manager-only settings are intentionally excluded.</summary>
public sealed record LauncherState(
    int SchemaVersion,
    string QuickSearchShortcut,
    string Theme,
    string LauncherDisplayMode,
    bool LaunchOnStartup,
    IReadOnlyList<SearchEngineData> SearchEngines,
    string DefaultSearchEngineId,
    bool EverythingEnabled,
    string EverythingEsPath,
    IReadOnlyList<LauncherWebsiteRecord> Websites,
    IReadOnlyList<AppSearchMemoryRecord> AppSearchMemory)
{
    public bool ExpandedByDefault => LauncherDisplayMode == "expanded";

    public WebsiteSnapshot ToWebsiteSnapshot() => new(
        Websites.Select(website => SearchEntry.Website(website.Id, website.Name, website.Url, website.Description)).ToArray(),
        SearchEngines,
        DefaultSearchEngineId,
        EverythingEnabled,
        EverythingEsPath,
        ExpandedByDefault);
}

public sealed record LauncherSettingsUpdate(
    string? QuickSearchShortcut = null,
    string? Theme = null,
    string? LauncherDisplayMode = null,
    bool? LaunchOnStartup = null,
    IReadOnlyList<SearchEngineData>? SearchEngines = null,
    string? DefaultSearchEngineId = null,
    bool? EverythingEnabled = null,
    string? EverythingEsPath = null);

public sealed class LauncherStateStore
{
    private const int CurrentSchemaVersion = 1;
    private const int MaxWebsites = 2000;
    private const int MaxSearchEngines = 64;
    private static readonly Regex AppIdPattern = new("^[a-fA-F0-9]{16}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex SearchEngineIdPattern = new("^[a-zA-Z0-9_-]{1,64}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private readonly string _filePath;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private LauncherState _state = CreateDefault();

    public LauncherStateStore(string filePath) => _filePath = Path.GetFullPath(filePath);

    public string WebsiteDataPath => Path.Combine(Path.GetDirectoryName(_filePath)!, "nook-data.json");

    public static string DefaultPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Nook", "launcher-state.json");
    public LauncherState Snapshot => _state with
    {
        SearchEngines = _state.SearchEngines.ToArray(),
        Websites = _state.Websites.Select(item => item with { FolderIds = item.FolderIds.ToArray() }).ToArray(),
        AppSearchMemory = _state.AppSearchMemory.ToArray(),
    };

    public LauncherState LoadOrMigrate(string legacyDataPath, out string status)
    {
        if (File.Exists(_filePath))
        {
            try
            {
                var loaded = JsonSerializer.Deserialize<LauncherState>(ReadBounded(_filePath, 8 * 1024 * 1024), JsonOptions);
                if (loaded is not null && IsValid(loaded))
                {
                    _state = Normalize(loaded);
                    status = "loaded";
                    return Snapshot;
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
            {
                status = $"state-invalid:{error.GetType().Name}";
            }

            var backupPath = _filePath + ".bak";
            try
            {
                var backup = JsonSerializer.Deserialize<LauncherState>(ReadBounded(backupPath, 8 * 1024 * 1024), JsonOptions);
                if (backup is not null && IsValid(backup))
                {
                    _state = Normalize(backup);
                    status = "restored-backup";
                    PersistSynchronously(_state);
                    return Snapshot;
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
            {
                status = $"backup-unavailable:{error.GetType().Name}";
            }

            PreserveCorruptFile();
            _state = CreateDefault();
            status = "corrupt-state-defaulted";
            PersistSynchronously(_state);
            return Snapshot;
        }

        _state = ImportLegacy(legacyDataPath, out status);
        PersistSynchronously(_state);
        return Snapshot;
    }

    public async Task<LauncherState> UpdateAsync(Func<LauncherState, LauncherState> update)
    {
        await _writeGate.WaitAsync().ConfigureAwait(false);
        try
        {
            var candidate = update(Snapshot);
            if (!IsValid(candidate)) throw new InvalidDataException("Launcher state failed validation.");
            var next = Normalize(candidate);
            await PersistAsync(next).ConfigureAwait(false);
            _state = next;
            return Snapshot;
        }
        finally { _writeGate.Release(); }
    }

    public static LauncherState ApplySettings(LauncherState current, LauncherSettingsUpdate update)
    {
        var next = current with
        {
            QuickSearchShortcut = update.QuickSearchShortcut ?? current.QuickSearchShortcut,
            Theme = update.Theme ?? current.Theme,
            LauncherDisplayMode = update.LauncherDisplayMode ?? current.LauncherDisplayMode,
            LaunchOnStartup = update.LaunchOnStartup ?? current.LaunchOnStartup,
            SearchEngines = update.SearchEngines?.ToArray() ?? current.SearchEngines,
            DefaultSearchEngineId = update.DefaultSearchEngineId ?? current.DefaultSearchEngineId,
            EverythingEnabled = update.EverythingEnabled ?? current.EverythingEnabled,
            EverythingEsPath = update.EverythingEsPath ?? current.EverythingEsPath,
        };
        if (!IsValid(next)) throw new InvalidDataException("The requested Launcher settings are invalid.");
        return Normalize(next);
    }

    public static LauncherState RestoreUpdatedSettings(LauncherState current, LauncherState previous, LauncherSettingsUpdate update) => current with
    {
        QuickSearchShortcut = update.QuickSearchShortcut is null ? current.QuickSearchShortcut : previous.QuickSearchShortcut,
        Theme = update.Theme is null ? current.Theme : previous.Theme,
        LauncherDisplayMode = update.LauncherDisplayMode is null ? current.LauncherDisplayMode : previous.LauncherDisplayMode,
        LaunchOnStartup = update.LaunchOnStartup is null ? current.LaunchOnStartup : previous.LaunchOnStartup,
        SearchEngines = update.SearchEngines is null ? current.SearchEngines : previous.SearchEngines,
        DefaultSearchEngineId = update.DefaultSearchEngineId is null ? current.DefaultSearchEngineId : previous.DefaultSearchEngineId,
        EverythingEnabled = update.EverythingEnabled is null ? current.EverythingEnabled : previous.EverythingEnabled,
        EverythingEsPath = update.EverythingEsPath is null ? current.EverythingEsPath : previous.EverythingEsPath,
    };

    public async Task<LauncherState> ReplaceWebsitesAsync(IReadOnlyList<LauncherWebsiteRecord> websites) =>
        await UpdateAsync(current => current with { Websites = websites.ToArray() }).ConfigureAwait(false);

    public async Task<LauncherState> RememberApplicationAsync(string query, string appId)
    {
        if (!IsValidAppSearchMemory(query, appId)) return Snapshot;
        var normalized = SearchCore.Normalize(query);
        return await UpdateAsync(current =>
        {
            var memory = current.AppSearchMemory.Where(item => item.Query != normalized).ToList();
            memory.Add(new AppSearchMemoryRecord(normalized, appId, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
            var bounded = memory.OrderByDescending(item => item.LastUsedAt).Take(100).ToArray();
            return current with { AppSearchMemory = bounded };
        }).ConfigureAwait(false);
    }

    public static bool IsValidAppSearchMemory(string? query, string? appId) =>
        !string.IsNullOrWhiteSpace(query)
        && query.Length <= 128
        && !string.IsNullOrWhiteSpace(appId)
        && AppIdPattern.IsMatch(appId)
        && SearchCore.Normalize(query).Length > 0;

    public static LauncherState CreateDefault() => new(
        CurrentSchemaVersion,
        "Control+Alt+Space",
        "dark",
        "compact",
        false,
        [
            new SearchEngineData("google", "Google", "https://www.google.com/search?q=%s", true, true, 0),
            new SearchEngineData("baidu", "百度", "https://www.baidu.com/s?wd=%s", true, true, 1),
            new SearchEngineData("bilibili", "Bilibili", "https://search.bilibili.com/all?keyword=%s", true, true, 2),
        ],
        "google",
        false,
        "",
        [],
        []);

    public static bool IsValid(LauncherState state)
    {
        if (state.QuickSearchShortcut is null || state.Theme is null || state.LauncherDisplayMode is null || state.DefaultSearchEngineId is null || state.EverythingEsPath is null) return false;
        if (state.SchemaVersion != CurrentSchemaVersion || !GlobalHotkeyService.TryParse(state.QuickSearchShortcut, out _)) return false;
        if (state.Theme is not ("light" or "dark" or "system") || state.LauncherDisplayMode is not ("compact" or "expanded")) return false;
        if (state.SearchEngines is null || state.SearchEngines.Count is < 1 or > MaxSearchEngines || state.SearchEngines.Any(engine => engine is null)) return false;
        if (state.Websites is null || state.Websites.Count > MaxWebsites || state.Websites.Any(website => website is null) || state.AppSearchMemory is null || state.AppSearchMemory.Count > 100 || state.AppSearchMemory.Any(item => item is null)) return false;
        if (state.EverythingEsPath.Length > 1000 || (state.EverythingEsPath.Length > 0 && (!Path.IsPathFullyQualified(state.EverythingEsPath) || !Path.GetFileName(state.EverythingEsPath).Equals("es.exe", StringComparison.OrdinalIgnoreCase)))) return false;
        if (!SearchEngineIdPattern.IsMatch(state.DefaultSearchEngineId) || !state.SearchEngines.Any(engine => engine.Id == state.DefaultSearchEngineId && engine.Enabled)) return false;

        var engineIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var engine in state.SearchEngines)
        {
            if (engine.Id is null || engine.Name is null || engine.Template is null) return false;
            if (!SearchEngineIdPattern.IsMatch(engine.Id) || !engineIds.Add(engine.Id) || engine.Name.Length is 0 or > 80 || engine.Template.Length > 1000 || engine.Order < 0) return false;
            if (engine.Template.Split("%s", StringSplitOptions.None).Length != 2) return false;
            var candidate = engine.Template.Replace("%s", "webtools", StringComparison.Ordinal);
            if (!Uri.TryCreate(candidate, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("http" or "https") || parsed.UserInfo.Length > 0) return false;
        }
        foreach (var website in state.Websites)
        {
            if (website.Id is null || website.Name is null || website.Url is null || website.Description is null || website.FolderIds is null) return false;
            if (string.IsNullOrWhiteSpace(website.Id) || website.Id.Length > 128 || website.Name.Length is 0 or > 256 || website.Url.Length > 2048 || website.Description.Length > 2000 || website.FolderIds.Count > 128) return false;
            if (!Uri.TryCreate(website.Url, UriKind.Absolute, out var url) || url.Scheme is not ("http" or "https") || url.UserInfo.Length > 0) return false;
            if (website.FolderIds.Any(folder => folder is null || folder.Length > 128)) return false;
        }
        return state.AppSearchMemory.All(item => item.Query is not null && item.AppId is not null && item.Query.Length is > 0 and <= 128 && SearchCore.Normalize(item.Query) == item.Query && AppIdPattern.IsMatch(item.AppId) && item.LastUsedAt > 0);
    }

    private static LauncherState Normalize(LauncherState state)
    {
        var memory = state.AppSearchMemory
            .Where(item => item.Query.Length is > 0 and <= 128 && SearchCore.Normalize(item.Query) == item.Query && AppIdPattern.IsMatch(item.AppId))
            .OrderByDescending(item => item.LastUsedAt)
            .Take(100)
            .ToArray();
        return state with
        {
            SearchEngines = state.SearchEngines.OrderBy(engine => engine.Order).ToArray(),
            Websites = state.Websites.Select(website => website with { Description = website.Description ?? "", FolderIds = (website.FolderIds ?? []).Distinct(StringComparer.Ordinal).ToArray() }).ToArray(),
            AppSearchMemory = memory,
        };
    }

    private static LauncherState ImportLegacy(string legacyDataPath, out string status)
    {
        var defaults = CreateDefault();
        if (!File.Exists(legacyDataPath)) { status = "initialized-defaults"; return defaults; }
        try
        {
            var websiteSnapshot = WebsiteDataLoader.Read(legacyDataPath);
            using var document = JsonDocument.Parse(ReadBounded(legacyDataPath, 32 * 1024 * 1024));
            var root = document.RootElement;
            if (!root.TryGetProperty("version", out var version) || version.GetInt32() != 2) throw new InvalidDataException("Legacy data version is not v2.");
            var settings = root.TryGetProperty("settings", out var settingsElement) && settingsElement.ValueKind == JsonValueKind.Object ? settingsElement : default;
            string ReadString(string name, string fallback) => TryString(settings, name, out var value) ? value : fallback;
            var memory = ReadMemory(root);
            var websites = ReadWebsites(root);
            var engines = ReadEngines(settings, websiteSnapshot.SearchEngines);
            var selected = ReadString("defaultSearchEngineId", websiteSnapshot.DefaultSearchEngineId);
            if (!engines.Any(engine => engine.Id == selected && engine.Enabled)) selected = engines.FirstOrDefault(engine => engine.Enabled)?.Id ?? defaults.DefaultSearchEngineId;
            var imported = defaults with
            {
                QuickSearchShortcut = ReadString("quickSearchShortcut", defaults.QuickSearchShortcut),
                Theme = ReadString("theme", defaults.Theme),
                LauncherDisplayMode = ReadString("launcherDisplayMode", defaults.LauncherDisplayMode),
                LaunchOnStartup = settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("launchOnStartup", out var launch) && launch.ValueKind == JsonValueKind.True,
                SearchEngines = engines,
                DefaultSearchEngineId = selected,
                EverythingEnabled = websiteSnapshot.EverythingEnabled,
                EverythingEsPath = websiteSnapshot.EverythingEsPath,
                Websites = websites,
                AppSearchMemory = memory,
            };
            if (!IsValid(imported)) throw new InvalidDataException("Legacy launcher settings are invalid.");
            status = "migrated-v2-once";
            return Normalize(imported);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidDataException or ArgumentException)
        {
            status = $"legacy-import-fallback:{error.GetType().Name}";
            return defaults;
        }
    }

    private static LauncherWebsiteRecord[] ReadWebsites(JsonElement root)
    {
        if (!root.TryGetProperty("webEntries", out var entries) || entries.ValueKind != JsonValueKind.Array) return [];
        return entries.EnumerateArray().Take(MaxWebsites + 1).Select(item =>
        {
            string Field(string name) => TryString(item, name, out var value) ? value : "";
            var folders = item.TryGetProperty("folderIds", out var ids) && ids.ValueKind == JsonValueKind.Array
                ? ids.EnumerateArray().Where(id => id.ValueKind == JsonValueKind.String).Select(id => id.GetString() ?? "").Take(128).ToArray()
                : [];
            return new LauncherWebsiteRecord(Field("id"), Field("name"), Field("url"), Field("description"), folders);
        }).ToArray();
    }

    private static SearchEngineData[] ReadEngines(JsonElement settings, IReadOnlyList<SearchEngineData> fallback)
    {
        if (settings.ValueKind != JsonValueKind.Object || !settings.TryGetProperty("searchEngines", out var array) || array.ValueKind != JsonValueKind.Array) return fallback.ToArray();
        var engines = array.EnumerateArray().Take(MaxSearchEngines + 1).Select((item, index) =>
        {
            string Field(string name, string defaultValue = "") => TryString(item, name, out var value) ? value : defaultValue;
            var enabled = !item.TryGetProperty("enabled", out var enabledElement) || enabledElement.ValueKind != JsonValueKind.False;
            var builtIn = item.TryGetProperty("builtIn", out var builtInElement) && builtInElement.ValueKind == JsonValueKind.True;
            var order = item.TryGetProperty("order", out var orderElement) && orderElement.TryGetInt32(out var readOrder) ? Math.Max(0, readOrder) : index;
            return new SearchEngineData(Field("id"), Field("name"), Field("template"), enabled, builtIn, order);
        }).ToArray();
        return engines.Length is > 0 and <= MaxSearchEngines ? engines : fallback.ToArray();
    }

    private static AppSearchMemoryRecord[] ReadMemory(JsonElement root)
    {
        if (!root.TryGetProperty("appSearchMemory", out var memory) || memory.ValueKind != JsonValueKind.Object) return [];
        return memory.EnumerateObject().Select(property =>
        {
            var entry = property.Value;
            if (entry.ValueKind != JsonValueKind.Object || !TryString(entry, "appId", out var id) || !entry.TryGetProperty("lastUsedAt", out var timestamp) || !timestamp.TryGetInt64(out var lastUsed)) return null;
            return new AppSearchMemoryRecord(property.Name, id, lastUsed);
        }).Where(item => item is not null).Cast<AppSearchMemoryRecord>().OrderByDescending(item => item.LastUsedAt).Take(100).ToArray();
    }

    private static bool TryString(JsonElement element, string property, out string value)
    {
        value = "";
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var field) || field.ValueKind != JsonValueKind.String) return false;
        value = field.GetString() ?? "";
        return true;
    }

    private static string ReadBounded(string path, int maxBytes)
    {
        var info = new FileInfo(path);
        if (info.Length > maxBytes) throw new InvalidDataException("Launcher state file is too large.");
        return File.ReadAllText(path);
    }

    private void PreserveCorruptFile()
    {
        try { File.Copy(_filePath, _filePath + $".corrupt-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}", overwrite: false); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private void PersistSynchronously(LauncherState state)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!);
        var temporaryPath = _filePath + ".tmp";
        var backupPath = _filePath + ".bak";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(state, JsonOptions));
        if (File.Exists(_filePath))
        {
            try { File.Replace(temporaryPath, _filePath, backupPath, ignoreMetadataErrors: true); }
            catch (PlatformNotSupportedException) { File.Move(temporaryPath, _filePath, overwrite: true); }
        }
        else File.Move(temporaryPath, _filePath);
    }

    private async Task PersistAsync(LauncherState state)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!);
        var temporaryPath = _filePath + ".tmp";
        var backupPath = _filePath + ".bak";
        await File.WriteAllTextAsync(temporaryPath, JsonSerializer.Serialize(state, JsonOptions)).ConfigureAwait(false);
        if (File.Exists(_filePath))
        {
            try { File.Replace(temporaryPath, _filePath, backupPath, ignoreMetadataErrors: true); }
            catch (PlatformNotSupportedException) { File.Move(temporaryPath, _filePath, overwrite: true); }
        }
        else File.Move(temporaryPath, _filePath);
    }
}
