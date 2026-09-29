using System.Security.Cryptography;
using System.Text;
using System.IO;
using System.Text.Json.Serialization;
using WebTools.NativeHost.Search;

namespace WebTools.NativeHost.Catalog;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(ShortcutTarget), "shortcut")]
[JsonDerivedType(typeof(ExecutableTarget), "executable")]
[JsonDerivedType(typeof(PackagedTarget), "packaged")]
[JsonDerivedType(typeof(SystemTarget), "system")]
public abstract record AppLaunchTarget;
public sealed record ShortcutTarget(string ShortcutPath, string TargetPath, string Arguments, string WorkingDirectory) : AppLaunchTarget;
public sealed record ExecutableTarget(string Path) : AppLaunchTarget;
public sealed record PackagedTarget(string AppId) : AppLaunchTarget;
public sealed record SystemTarget(string App) : AppLaunchTarget;

public sealed record AppRecord(string Name, IReadOnlyList<string> Aliases, string Source, AppLaunchTarget Target);
public sealed record CatalogApp(string Id, string Name, IReadOnlyList<string> Aliases, string Source, AppLaunchTarget Target, string? IconReference)
{
    public SearchEntry AsSearchEntry() => SearchEntry.Application(Id, Name, Aliases, IconReference);
}

public sealed class AppCatalogService
{
    private readonly WindowsAppSource _source = new();
    private IReadOnlyList<CatalogApp> _apps = [];
    private IReadOnlyDictionary<string, CatalogApp> _byId = new Dictionary<string, CatalogApp>();

    public IReadOnlyList<CatalogApp> Apps => _apps;
    public bool Ready { get; private set; }

    public void RestoreSnapshot(IReadOnlyList<CatalogApp> apps)
    {
        if (apps is null || apps.Count > 6000 || apps.Any(app => !IsValidSnapshotApp(app)) || apps.Select(app => app.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != apps.Count)
            throw new InvalidDataException("Application catalog snapshot is invalid.");
        _apps = apps.ToArray();
        _byId = _apps.ToDictionary(app => app.Id, StringComparer.OrdinalIgnoreCase);
        Ready = true;
    }

    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        var records = await Task.Run(() => _source.List(cancellationToken), cancellationToken);
        var merged = Merge(records);
        _apps = merged;
        _byId = merged.ToDictionary(app => app.Id);
        Ready = true;
    }

    public CatalogApp? Find(string id) => _byId.GetValueOrDefault(id);

    public static IReadOnlyList<CatalogApp> Merge(IEnumerable<AppRecord> records)
    {
        var merged = new Dictionary<string, CatalogApp>(StringComparer.Ordinal);
        foreach (var record in records)
        {
            var id = GetId(record.Target);
            if (merged.TryGetValue(id, out var existing))
            {
                merged[id] = existing with
                {
                    Aliases = existing.Aliases.Concat([record.Name]).Concat(record.Aliases).Distinct(StringComparer.Ordinal).ToArray(),
                };
                continue;
            }
            var icon = record.Target switch
            {
                ShortcutTarget shortcut => shortcut.ShortcutPath,
                ExecutableTarget executable => executable.Path,
                PackagedTarget packaged => "appx:" + packaged.AppId,
                SystemTarget system => SystemIconPath(system.App),
                _ => null,
            };
            merged.Add(id, new CatalogApp(id, record.Name, record.Aliases.Distinct(StringComparer.Ordinal).ToArray(), record.Source, record.Target, icon));
        }
        var compare = System.Globalization.CultureInfo.GetCultureInfo("zh-CN").CompareInfo;
        return merged.Values.OrderBy(record => record.Name, Comparer<string>.Create((a, b) => compare.Compare(a, b))).ToArray();
    }

    private static string PathKey(string path, string args, string cwd)
    {
        var normalizedPath = path.ToLowerInvariant();
        if (args.Length == 0 && cwd.Length == 0) return "path:" + normalizedPath;
        // Matches Electron's JSON.stringify([args,cwd]) for ordinary Windows path text.
        return $"path:{normalizedPath}:{System.Text.Json.JsonSerializer.Serialize(new[] { args, cwd.ToLowerInvariant() }, new System.Text.Json.JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping })}";
    }

    public static string GetId(AppLaunchTarget target)
    {
        var key = target switch
        {
            PackagedTarget packaged => "aumid:" + packaged.AppId.ToLowerInvariant(),
            SystemTarget system => "system:" + system.App,
            ShortcutTarget shortcut => PathKey(shortcut.TargetPath, shortcut.Arguments, shortcut.WorkingDirectory),
            ExecutableTarget executable => PathKey(executable.Path, "", ""),
            _ => throw new InvalidOperationException("Unknown application launch target."),
        };
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)))[..16].ToLowerInvariant();
    }

    public static bool IsValidSnapshotApp(CatalogApp app)
    {
        if (app is null || app.Id is null || app.Name is null || app.Aliases is null || app.Source is null || app.Target is null) return false;
        if (app.Id.Length != 16 || !app.Id.All(Uri.IsHexDigit) || app.Name.Length is 0 or > 512 || app.Aliases.Count > 64) return false;
        if (app.Aliases.Any(alias => alias is null || alias.Length > 512) || app.Source is not ("desktop" or "packaged" or "system")) return false;
        if (app.IconReference is { Length: > 32768 }) return false;
        var targetValid = app.Target switch
        {
            ShortcutTarget shortcut => !string.IsNullOrWhiteSpace(shortcut.TargetPath) && shortcut.TargetPath.Length <= 32768 && shortcut.Arguments is not null && shortcut.Arguments.Length <= 32768 && shortcut.WorkingDirectory is not null && shortcut.WorkingDirectory.Length <= 32768 && shortcut.ShortcutPath is not null && shortcut.ShortcutPath.Length <= 32768,
            ExecutableTarget executable => !string.IsNullOrWhiteSpace(executable.Path) && executable.Path.Length <= 32768,
            PackagedTarget packaged => !string.IsNullOrWhiteSpace(packaged.AppId) && packaged.AppId.Length <= 512,
            SystemTarget system => system.App is "file-explorer" or "control-panel" or "device-manager",
            _ => false,
        };
        return targetValid && app.Id.Equals(GetId(app.Target), StringComparison.OrdinalIgnoreCase);
    }

    private static string? SystemIconPath(string app) => app switch
    {
        "file-explorer" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"),
        "control-panel" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "control.exe"),
        "device-manager" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "mmc.exe"),
        _ => null,
    };
}
