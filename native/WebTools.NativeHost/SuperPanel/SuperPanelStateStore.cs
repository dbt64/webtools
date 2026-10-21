using System.IO;
using System.Text.Json;
using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.SuperPanel;

public sealed record SuperPanelState(int SchemaVersion, bool Enabled, string MouseButton, string Gesture, int HoldMilliseconds, IReadOnlyList<NativeFeatureRef> Pinned, bool AutoTranslationPreview = false)
{
    public static SuperPanelState Default => new(2, true, "middle", "hold", 600, []);
}
public sealed class SuperPanelStateStore
{
    private readonly string _path;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    public SuperPanelState Snapshot { get; private set; } = SuperPanelState.Default;
    public SuperPanelStateStore(string profileRoot) { _path = Path.Combine(profileRoot, "super-panel-state.json"); }
    public void Load()
    {
        CheckPath();
        if (!File.Exists(_path)) return;
        if (new FileInfo(_path).Length > 32768) throw new InvalidDataException("Super Panel settings exceed their bound.");
        using var json = JsonDocument.Parse(File.ReadAllText(_path));
        if (json.RootElement.ValueKind != JsonValueKind.Object || !json.RootElement.TryGetProperty("schemaVersion", out var schema)
            || !schema.TryGetInt32(out var version)) throw new InvalidDataException("Super Panel settings have no valid schema.");
        SuperPanelState? state;
        if (version == 1)
        {
            var legacy = json.RootElement.Deserialize<LegacyState>(JsonOptions);
            // Removed keyboard bindings never register again. Preserve middle-hold preference and pins in memory.
            state = legacy is null ? null : new(2, legacy.Enabled && legacy.MiddleHoldEnabled, "middle", "hold", legacy.HoldMilliseconds, legacy.Pinned);
        }
        else state = version == 2 ? json.RootElement.Deserialize<SuperPanelState>(JsonOptions) : null;
        if (state is null || !Valid(state)) throw new InvalidDataException("Super Panel settings are invalid; the original file is preserved.");
        Snapshot = state; // No startup rewrite; the next explicit save persists the new trigger schema.
    }
    public void Save(SuperPanelState state)
    {
        if (!Valid(state)) throw new InvalidDataException("Super Panel settings are invalid.");
        CheckPath(); Directory.CreateDirectory(Path.GetDirectoryName(_path)!); CheckPath();
        var temporary = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(state, JsonOptions);
            if (bytes.Length > 32768) throw new InvalidDataException("Super Panel settings exceed their bound.");
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { stream.Write(bytes); stream.Flush(true); }
            File.Move(temporary, _path, true); Snapshot = state;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private static bool Valid(SuperPanelState state) => state.SchemaVersion == 2 && SuperPanelSettings.FromState(state).IsValid
        && state.Pinned is not null && state.Pinned.Count <= 100
        && state.Pinned.All(reference => reference is not null && reference.IsValid) && state.Pinned.Distinct().Count() == state.Pinned.Count;
    private void CheckPath()
    {
        for (string? current = Path.GetFullPath(_path); current is not null; current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint)) throw new InvalidDataException("Super Panel settings cannot use a reparse path.");
    }
    private sealed record LegacyState(int SchemaVersion, string KeyboardShortcut, bool MiddleHoldEnabled, int HoldMilliseconds, IReadOnlyList<NativeFeatureRef> Pinned)
    { public bool Enabled { get; init; } = true; }
}
