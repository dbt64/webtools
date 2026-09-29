using System.IO;
using System.Text.Json;

namespace WebTools.NativeHost.Catalog;

public sealed record AppCatalogSnapshot(int SchemaVersion, DateTimeOffset GeneratedAtUtc, IReadOnlyList<CatalogApp> Apps);

public sealed class AppCatalogSnapshotStore
{
    private const int CurrentSchemaVersion = 1;
    private const int MaxSnapshotBytes = 24 * 1024 * 1024;
    private const int MaxAppCount = 6000;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false,
    };
    private readonly string _filePath;

    public AppCatalogSnapshotStore(string filePath) => _filePath = Path.GetFullPath(filePath);

    public static string DefaultPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WebTools", "app-catalog.v1.json");

    public bool TryLoad(out AppCatalogSnapshot? snapshot, out string reason)
    {
        snapshot = null;
        reason = "missing";
        if (!File.Exists(_filePath)) return false;
        try
        {
            var info = new FileInfo(_filePath);
            if (info.Length is <= 0 or > MaxSnapshotBytes) throw new InvalidDataException("snapshot-size");
            var loaded = JsonSerializer.Deserialize<AppCatalogSnapshot>(File.ReadAllText(_filePath), JsonOptions);
            if (loaded is null || loaded.SchemaVersion != CurrentSchemaVersion || loaded.Apps is null || loaded.Apps.Count > MaxAppCount) throw new InvalidDataException("snapshot-schema");
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var app in loaded.Apps)
            {
                if (!AppCatalogService.IsValidSnapshotApp(app) || !ids.Add(app.Id)) throw new InvalidDataException("snapshot-entry");
            }
            snapshot = loaded;
            reason = "loaded";
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidDataException or ArgumentException or InvalidOperationException or NullReferenceException)
        {
            reason = $"invalid:{error.GetType().Name}";
            return false;
        }
    }

    public async Task<bool> SaveIfChangedAsync(IReadOnlyList<CatalogApp> apps, CancellationToken cancellationToken = default)
    {
        if (apps.Count > MaxAppCount || apps.Any(app => !AppCatalogService.IsValidSnapshotApp(app)))
            throw new InvalidDataException("Application catalog is not safe to persist.");

        var json = JsonSerializer.Serialize(new AppCatalogSnapshot(CurrentSchemaVersion, DateTimeOffset.UtcNow, apps.ToArray()), JsonOptions);
        if (System.Text.Encoding.UTF8.GetByteCount(json) > MaxSnapshotBytes) throw new InvalidDataException("Application catalog snapshot is too large.");
        if (TryLoad(out var existing, out _) && existing is not null && SameCatalog(existing.Apps, apps)) return false;

        var directory = Path.GetDirectoryName(_filePath)!;
        Directory.CreateDirectory(directory);
        var temporary = _filePath + ".tmp";
        var backup = _filePath + ".bak";
        await using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough))
        {
            var bytes = System.Text.Encoding.UTF8.GetBytes(json);
            await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            stream.Flush(flushToDisk: true);
        }
        if (File.Exists(_filePath))
        {
            try { File.Replace(temporary, _filePath, backup, ignoreMetadataErrors: true); }
            catch (PlatformNotSupportedException) { File.Move(temporary, _filePath, overwrite: true); }
        }
        else File.Move(temporary, _filePath);
        return true;
    }

    private static bool SameCatalog(IReadOnlyList<CatalogApp> left, IReadOnlyList<CatalogApp> right)
    {
        if (left.Count != right.Count) return false;
        for (var index = 0; index < left.Count; index++)
        {
            var a = left[index];
            var b = right[index];
            if (a.Id != b.Id || a.Name != b.Name || a.Source != b.Source || a.IconReference != b.IconReference || !a.Aliases.SequenceEqual(b.Aliases) || a.Target != b.Target) return false;
        }
        return true;
    }
}
