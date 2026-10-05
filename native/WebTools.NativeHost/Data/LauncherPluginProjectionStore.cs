using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace WebTools.NativeHost.Data;

public sealed record LauncherPluginRef(string Kind, string Id)
{
    [JsonIgnore] public bool IsValid => Kind == "builtin" ? Id == "webtools.translation"
        : Kind == "declarative" && !string.IsNullOrEmpty(Id) && Id.Length <= 128 && Regex.IsMatch(Id, "^[a-z0-9]+(?:[.-][a-z0-9]+)*$");
}
public sealed record LauncherPluginShortcut(LauncherPluginRef Ref, string DisplayName, string Icon);
public sealed record LauncherPluginProjection(int ProjectionVersion, IReadOnlyList<LauncherPluginShortcut> Plugins);

/// <summary>Rebuildable presentation cache supplied by Main, never a plugin registry or enable-state authority.</summary>
public sealed class LauncherPluginProjectionStore
{
    private const int MaxBytes = 2 * 1024 * 1024; // Bounded 1,000-package registry plus one builtin, including JSON Unicode escaping.
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly string _filePath;
    private readonly Action<string> _deleteTemporary;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    public static LauncherPluginProjection Empty => new(1, []);
    public LauncherPluginProjectionStore(string profileRoot) : this(profileRoot, File.Delete) { }
    internal LauncherPluginProjectionStore(string profileRoot, Action<string> deleteTemporary)
    { _filePath = Path.Combine(Path.GetFullPath(profileRoot), "launcher-plugins.json"); _deleteTemporary = deleteTemporary; }

    public static LauncherPluginProjection Parse(JsonElement value)
    {
        if (value.GetRawText().Length > MaxBytes || !Keys(value, "projectionVersion", "plugins") || value.GetProperty("projectionVersion").ValueKind != JsonValueKind.Number || !value.GetProperty("projectionVersion").TryGetInt32(out var version) || version != 1)
            throw new InvalidDataException("Invalid Launcher plugin projection.");
        var rows = value.GetProperty("plugins");
        if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > 1001) throw new InvalidDataException("Invalid Launcher plugin list.");
        var result = new List<LauncherPluginShortcut>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in rows.EnumerateArray())
        {
            if (!Keys(row, "ref", "displayName", "icon") || !Keys(row.GetProperty("ref"), "kind", "id")) throw new InvalidDataException("Invalid Launcher plugin fields.");
            var reference = row.GetProperty("ref");
            var kind = Text(reference.GetProperty("kind")); var id = Text(reference.GetProperty("id"));
            var pluginRef = new LauncherPluginRef(kind, id);
            var name = Text(row.GetProperty("displayName")); var icon = Text(row.GetProperty("icon"));
            if (!pluginRef.IsValid || string.IsNullOrWhiteSpace(name) || name.Length > 128 || name.Any(char.IsControl)
                || icon != (kind == "builtin" ? "translation" : "plugin") || !seen.Add(kind + ":" + id)) throw new InvalidDataException("Invalid Launcher plugin shortcut.");
            result.Add(new(pluginRef, name, icon));
        }
        return new(1, result.ToArray());
    }

    public LauncherPluginProjection Load(out string status)
    {
        try
        {
            CheckPath();
            if (!File.Exists(_filePath)) { status = "missing"; return Empty; }
            using var stream = new FileStream(_filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length > MaxBytes) throw new InvalidDataException();
            var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
            using var document = JsonDocument.Parse(bytes);
            var projection = Parse(document.RootElement); status = "loaded"; return projection;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
        { status = "invalid-cache"; return Empty; }
    }

    public async Task SaveAsync(LauncherPluginProjection projection)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(projection, JsonOptions);
        if (bytes.Length > MaxBytes) throw new InvalidDataException("Launcher plugin projection exceeds its limit.");
        using var document = JsonDocument.Parse(bytes); _ = Parse(document.RootElement);
        await _writeGate.WaitAsync().ConfigureAwait(false);
        var temporary = _filePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            CheckPath(); Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!); CheckPath();
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { await stream.WriteAsync(bytes).ConfigureAwait(false); await stream.FlushAsync().ConfigureAwait(false); }
            CheckPath(); File.Move(temporary, _filePath, true);
        }
        finally { try { if (File.Exists(temporary)) _deleteTemporary(temporary); } finally { _writeGate.Release(); } }
    }

    private void CheckPath()
    {
        for (var current = _filePath; current is not null; current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidDataException("Launcher plugin cache cannot use a reparse path.");
    }
    private static bool Keys(JsonElement value, params string[] keys) => value.ValueKind == JsonValueKind.Object
        && value.EnumerateObject().Count() == keys.Length && keys.All(key => value.TryGetProperty(key, out _));
    private static string Text(JsonElement value) => value.ValueKind == JsonValueKind.String ? value.GetString()! : throw new InvalidDataException("Invalid Launcher text.");
}
