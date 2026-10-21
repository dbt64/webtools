using System.Buffers;
using System.IO;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace WebTools.NativeHost.Data;

public sealed record NativeFeatureRef(string PluginId, string FeatureId)
{
    private static readonly Regex PluginIdPattern = new("^[a-z0-9]+(?:[.-][a-z0-9]+)*$", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex FeatureIdPattern = new("^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    [JsonIgnore]
    public bool IsValid => PluginId is { Length: >= 3 and <= 128 }
        && PluginId is not ("__proto__" or "prototype" or "constructor")
        && PluginIdPattern.IsMatch(PluginId)
        && FeatureId is { Length: >= 1 and <= 64 }
        && FeatureIdPattern.IsMatch(FeatureId);
}
public sealed record NativeFeatureAcceptedContextV2(string Type, IReadOnlyList<string> Sources,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Extensions = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? MaxItems = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TextMatch = null);
public sealed record NativeFeatureProjectionRowV2(
    NativeFeatureRef Ref,
    string PluginName,
    string Title,
    IReadOnlyList<string> Commands,
    IReadOnlyList<NativeFeatureAcceptedContextV2> AcceptedContexts,
    string IconToken,
    string FeatureKind,
    string Group,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Presentation = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? IconDataUrl = null);
public sealed record NativeFeatureProjectionV2(
    int ProjectionVersion,
    string HostSessionId,
    long Revision,
    long GeneratedAtUnixMs,
    IReadOnlyList<NativeFeatureProjectionRowV2> Features);
public sealed record NativeFeatureProjectionApplyResult(NativeFeatureProjectionV2 Projection, bool Changed);

/// <summary>Bounded, rebuildable presentation cache. It is not Plugin or permission authority.</summary>
public sealed class NativeFeatureProjectionStore
{
    public const string CacheFileName = "feature-projection-v2.json";
    public const int MaximumSerializedBytes = 3 * 1024 * 1024;
    public const int MaximumFeaturesPerPlugin = 64;
    public const int MaximumFeatures = 2000;
    private const long MaximumSafeInteger = 9_007_199_254_740_991;
    private static readonly string[] ProjectionFields = ["projectionVersion", "hostSessionId", "revision", "generatedAtUnixMs", "features"];
    private static readonly string[] RowFields = ["ref", "pluginName", "title", "commands", "acceptedContexts", "iconToken", "featureKind", "group"];
    private static readonly string[] RefFields = ["pluginId", "featureId"];
    private static readonly string[] ContextFields = ["type", "sources"];
    private static readonly Regex HostSessionPattern = new("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly HashSet<string> IconTokens = new(["plugin", "sparkles", "document", "globe", "translate"], StringComparer.Ordinal);
    private static readonly HashSet<string> ContextSources = new(["launcher-input", "clipboard", "selected-text", "explorer-selection"], StringComparer.Ordinal);
    private static readonly HashSet<string> FeatureKinds = new(["declarative-compatibility", "built-in", "runtime-v3"], StringComparer.Ordinal);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly string _filePath;
    private readonly Action<string, string> _replaceFile;
    private readonly Action<string> _deleteTemporary;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private NativeFeatureProjectionV2? _current;

    public NativeFeatureProjectionStore(string profileRoot)
        : this(profileRoot, static (temporary, destination) => File.Move(temporary, destination, overwrite: true), File.Delete) { }

    internal NativeFeatureProjectionStore(string profileRoot, Action<string, string> replaceFile, Action<string>? deleteTemporary = null)
    {
        _filePath = Path.Combine(Path.GetFullPath(profileRoot), CacheFileName);
        _replaceFile = replaceFile;
        _deleteTemporary = deleteTemporary ?? File.Delete;
    }

    public NativeFeatureProjectionV2? Current
    {
        get
        {
            var current = Volatile.Read(ref _current);
            return current is null ? null : Copy(current);
        }
    }
    public string CachePath => _filePath;

    public NativeFeatureProjectionV2? Load(out string status)
    {
        try
        {
            CheckPath();
            if (!File.Exists(_filePath))
            {
                Volatile.Write(ref _current, null);
                status = "missing";
                return null;
            }

            using var stream = new FileStream(_filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length is <= 0 or > MaximumSerializedBytes) throw new InvalidDataException("Native Feature cache exceeds its size limit.");
            var bytes = new byte[(int)stream.Length];
            stream.ReadExactly(bytes);
            if (stream.ReadByte() != -1) throw new InvalidDataException("Native Feature cache changed while it was being read.");
            using var document = JsonDocument.Parse(bytes);
            var parsed = Parse(document.RootElement);
            Volatile.Write(ref _current, parsed);
            status = "loaded";
            return Copy(parsed);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidDataException or ArgumentException)
        {
            Volatile.Write(ref _current, null);
            status = "invalid-cache";
            return null;
        }
    }

    public async Task<NativeFeatureProjectionApplyResult> AcceptAsync(JsonElement payload, CancellationToken cancellationToken = default)
    {
        var incoming = Parse(payload);
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = Volatile.Read(ref _current);
            if (current is not null && string.Equals(incoming.HostSessionId, current.HostSessionId, StringComparison.Ordinal))
            {
                if (incoming.Revision < current.Revision) throw new InvalidDataException("Stale Feature Projection revision.");
                if (incoming.Revision == current.Revision)
                {
                    if (!string.Equals(ContentIdentity(incoming), ContentIdentity(current), StringComparison.Ordinal))
                        throw new InvalidDataException("Conflicting Feature Projection payload for the current revision.");
                    return new(Copy(current), false);
                }
            }

            await SaveAsync(incoming, cancellationToken).ConfigureAwait(false);
            Volatile.Write(ref _current, incoming);
            return new(Copy(incoming), true);
        }
        finally { _writeGate.Release(); }
    }

    public static NativeFeatureProjectionV2 Parse(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Feature Projection v2 must be an object.");
        var raw = value.GetRawText();
        if (Encoding.UTF8.GetByteCount(raw) is 0 or > MaximumSerializedBytes)
            throw new InvalidDataException("Feature Projection v2 exceeds its serialized UTF-8 byte limit.");
        if (!HasExactFields(value, ProjectionFields)
            || !ReadInt32(value, "projectionVersion", out var version) || version != 2
            || !ReadString(value, "hostSessionId", out var hostSession) || !HostSessionPattern.IsMatch(hostSession) || !Guid.TryParseExact(hostSession, "D", out var parsedSession)
            || !ReadInt64(value, "revision", out var revision) || revision is < 1 or > MaximumSafeInteger
            || !ReadInt64(value, "generatedAtUnixMs", out var generatedAt) || generatedAt is < 0 or > MaximumSafeInteger)
            throw new InvalidDataException("Feature Projection v2 header is invalid.");

        hostSession = parsedSession.ToString("D");
        var rows = value.GetProperty("features");
        if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > MaximumFeatures)
            throw new InvalidDataException("Feature Projection v2 has too many rows.");

        var features = new List<NativeFeatureProjectionRowV2>(rows.GetArrayLength());
        var identities = new HashSet<string>(StringComparer.Ordinal);
        var pluginCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var row in rows.EnumerateArray())
        {
            var parsed = ParseRow(row);
            var identity = parsed.Ref.PluginId + "\n" + parsed.Ref.FeatureId;
            if (!identities.Add(identity)) throw new InvalidDataException("Feature Projection v2 contains a duplicate FeatureRef.");
            var count = pluginCounts.GetValueOrDefault(parsed.Ref.PluginId) + 1;
            if (count > MaximumFeaturesPerPlugin) throw new InvalidDataException("Feature Projection v2 exceeds the per-plugin row limit.");
            pluginCounts[parsed.Ref.PluginId] = count;
            features.Add(parsed);
        }

        return new NativeFeatureProjectionV2(2, hostSession, revision, generatedAt, Array.AsReadOnly(features.ToArray()));
    }

    private async Task SaveAsync(NativeFeatureProjectionV2 projection, CancellationToken cancellationToken)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(projection, JsonOptions);
        if (bytes.Length is 0 or > MaximumSerializedBytes) throw new InvalidDataException("Normalized Feature Projection cache exceeds its UTF-8 byte limit.");
        using (var validation = JsonDocument.Parse(bytes)) _ = Parse(validation.RootElement);

        CheckPath();
        Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!);
        CheckPath();
        var temporary = _filePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await using (var stream = new FileStream(temporary, new FileStreamOptions
            {
                Mode = FileMode.CreateNew,
                Access = FileAccess.Write,
                Share = FileShare.None,
                Options = FileOptions.Asynchronous | FileOptions.WriteThrough,
            }))
            {
                await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }
            CheckPath();
            _replaceFile(temporary, _filePath);
        }
        finally
        {
            if (File.Exists(temporary)) _deleteTemporary(temporary);
        }
    }

    private static NativeFeatureProjectionRowV2 ParseRow(JsonElement row)
    {
        var optionalFields = new[] { "description", "presentation", "iconDataUrl" }.Where(name => row.ValueKind == JsonValueKind.Object && row.TryGetProperty(name, out _)).ToArray();
        if (!HasExactFields(row, RowFields.Concat(optionalFields).ToArray())) throw new InvalidDataException("Feature Projection row has unknown or missing fields.");
        var reference = row.GetProperty("ref");
        if (!HasExactFields(reference, RefFields)
            || !ReadString(reference, "pluginId", out var pluginId)
            || !ReadString(reference, "featureId", out var featureId)
            || !new NativeFeatureRef(pluginId, featureId).IsValid)
            throw new InvalidDataException("Feature Projection FeatureRef is invalid.");

        if (!ReadString(row, "pluginName", out var rawPluginName) || NormalizeText(rawPluginName, 80) is not { } pluginName
            || !ReadString(row, "title", out var rawTitle) || NormalizeText(rawTitle, 80) is not { } title)
            throw new InvalidDataException("Feature Projection presentation text is invalid.");

        var commandElement = row.GetProperty("commands");
        if (commandElement.ValueKind != JsonValueKind.Array || commandElement.GetArrayLength() > 8)
            throw new InvalidDataException("Feature Projection command list is invalid.");
        var commands = new List<string>(commandElement.GetArrayLength());
        var commandSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var commandElementItem in commandElement.EnumerateArray())
        {
            var command = NormalizeText(commandElementItem.ValueKind == JsonValueKind.String ? commandElementItem.GetString()! : null, 48);
            if (command is null || !commandSet.Add(command)) throw new InvalidDataException("Feature Projection command is invalid or duplicated.");
            commands.Add(command);
        }

        var contextElement = row.GetProperty("acceptedContexts");
        if (contextElement.ValueKind != JsonValueKind.Array || contextElement.GetArrayLength() > 4)
            throw new InvalidDataException("Feature Projection accepted context metadata is invalid.");
        var contexts = new List<NativeFeatureAcceptedContextV2>(contextElement.GetArrayLength());
        foreach (var context in contextElement.EnumerateArray()) contexts.Add(ParseContext(context));

        if (!ReadString(row, "iconToken", out var iconToken) || !IconTokens.Contains(iconToken)
            || !ReadString(row, "featureKind", out var featureKind) || !FeatureKinds.Contains(featureKind)
            || !ReadString(row, "group", out var group) || group != "plugin-features")
            throw new InvalidDataException("Feature Projection icon, kind or group is invalid.");

        string? description = null;
        string? presentation = null;
        string? iconDataUrl = null;
        if (row.TryGetProperty("description", out _))
        {
            if (!ReadString(row, "description", out var text) || (description = NormalizeText(text, 240)) is null)
                throw new InvalidDataException("Feature description is invalid.");
        }
        if (row.TryGetProperty("presentation", out _))
        {
            if (!ReadString(row, "presentation", out var text) || text is not ("window" or "command"))
                throw new InvalidDataException("Feature presentation is invalid.");
            presentation = text;
        }
        if (featureKind == "runtime-v3" && presentation is null) throw new InvalidDataException("Runtime Feature presentation is missing.");
        if (row.TryGetProperty("iconDataUrl", out _))
        {
            if (!ReadString(row, "iconDataUrl", out var text) || text.Length > 5500 || !text.StartsWith("data:image/png;base64,", StringComparison.Ordinal))
                throw new InvalidDataException("Feature icon is invalid.");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(text[22..]); } catch (FormatException) { throw new InvalidDataException("Feature icon encoding is invalid."); }
            if (bytes.Length is < 24 or > 4096 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })
                || Convert.ToBase64String(bytes) != text[22..]) throw new InvalidDataException("Feature icon is not a bounded canonical PNG.");
            iconDataUrl = text;
        }
        return new NativeFeatureProjectionRowV2(
            new NativeFeatureRef(pluginId, featureId), pluginName, title,
            Array.AsReadOnly(commands.ToArray()), Array.AsReadOnly(contexts.ToArray()), iconToken, featureKind, group, description, presentation, iconDataUrl);
    }

    private static NativeFeatureAcceptedContextV2 ParseContext(JsonElement value)
    {
        var optional = new[] { "extensions", "maxItems", "textMatch" }.Where(name => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out _)).ToArray();
        if (!HasExactFields(value, ContextFields.Concat(optional).ToArray()) || !ReadString(value, "type", out var type) || type is not ("text" or "files" or "directories" or "none"))
            throw new InvalidDataException("Feature Projection context metadata has an invalid shape.");
        var sourceElement = value.GetProperty("sources");
        string[] allowed = type == "text" ? ["launcher-input", "clipboard", "selected-text"] : type == "none" ? [] : ["explorer-selection"];
        if (sourceElement.ValueKind != JsonValueKind.Array || sourceElement.GetArrayLength() < (type == "none" ? 0 : 1) || sourceElement.GetArrayLength() > allowed.Length)
            throw new InvalidDataException("Feature Projection context sources are invalid.");
        var sources = new List<string>(sourceElement.GetArrayLength());
        var sourceSet = new HashSet<string>(StringComparer.Ordinal);
        foreach (var sourceElementItem in sourceElement.EnumerateArray())
        {
            if (sourceElementItem.ValueKind != JsonValueKind.String) throw new InvalidDataException("Feature Projection context source is invalid.");
            var source = sourceElementItem.GetString()!;
            if (!ContextSources.Contains(source) || !allowed.Contains(source, StringComparer.Ordinal) || !sourceSet.Add(source)) throw new InvalidDataException("Feature Projection context source is invalid or duplicated.");
            sources.Add(source);
        }
        sources.Sort(StringComparer.Ordinal);
        string? textMatch = null;
        if (value.TryGetProperty("textMatch", out _))
        {
            if (type != "text" || sources.Count != 1 || sources[0] != "selected-text"
                || !ReadString(value, "textMatch", out textMatch) || textMatch != "http-url")
                throw new InvalidDataException("Selected-text matcher metadata is invalid.");
        }
        int? maxItems = null;
        if (value.TryGetProperty("maxItems", out _))
        {
            if (type is not ("files" or "directories") || !ReadInt32(value, "maxItems", out var limit) || limit is < 1 or > 64) throw new InvalidDataException("Context count limit is invalid.");
            maxItems = limit;
        }
        string[]? extensions = null;
        if (value.TryGetProperty("extensions", out var extensionValues))
        {
            if (type != "files" || extensionValues.ValueKind != JsonValueKind.Array || extensionValues.GetArrayLength() > 16) throw new InvalidDataException("Context extensions are invalid.");
            extensions = extensionValues.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString()! : "").ToArray();
            if (extensions.Any(extension => !Regex.IsMatch(extension, @"^\.[a-z0-9]{1,16}$", RegexOptions.CultureInvariant)) || extensions.Distinct(StringComparer.Ordinal).Count() != extensions.Length) throw new InvalidDataException("Context extensions are invalid.");
        }
        return new NativeFeatureAcceptedContextV2(type, Array.AsReadOnly(sources.ToArray()), extensions is null ? null : Array.AsReadOnly(extensions), maxItems, textMatch);
    }

    private static string ContentIdentity(NativeFeatureProjectionV2 value) => JsonSerializer.Serialize(value.Features, JsonOptions);

    private static NativeFeatureProjectionV2 Copy(NativeFeatureProjectionV2 value) => value with
    {
        Features = Array.AsReadOnly(value.Features.Select(row => row with
        {
            Ref = row.Ref with { },
            Commands = Array.AsReadOnly(row.Commands.ToArray()),
            AcceptedContexts = Array.AsReadOnly(row.AcceptedContexts.Select(context => context with
            {
                Sources = Array.AsReadOnly(context.Sources.ToArray()),
                Extensions = context.Extensions is null ? null : Array.AsReadOnly(context.Extensions.ToArray()),
            }).ToArray()),
        }).ToArray()),
    };

    private void CheckPath()
    {
        for (string? current = _filePath; current is not null; current = Path.GetDirectoryName(current))
        {
            if ((File.Exists(current) || Directory.Exists(current)) && File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidDataException("Native Feature projection cache cannot use a reparse path.");
        }
    }

    private static bool HasExactFields(JsonElement value, IReadOnlyList<string> expected)
    {
        if (value.ValueKind != JsonValueKind.Object) return false;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!expected.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) return false;
        return seen.Count == expected.Count;
    }

    private static bool ReadString(JsonElement value, string name, out string result)
    {
        result = "";
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String) return false;
        result = property.GetString() ?? "";
        return true;
    }

    private static bool ReadInt32(JsonElement value, string name, out int result)
    {
        result = 0;
        return value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out result);
    }

    private static bool ReadInt64(JsonElement value, string name, out long result)
    {
        result = 0;
        return value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out result);
    }

    private static string? NormalizeText(string? value, int maximumScalars)
    {
        if (value is null || !TryCountScalars(value, out _)) return null;
        string normalized;
        try { normalized = value.Normalize(NormalizationForm.FormC); }
        catch (ArgumentException) { return null; }
        var builder = new StringBuilder(normalized.Length);
        var pendingSpace = false;
        foreach (var rune in normalized.EnumerateRunes())
        {
            if (Rune.IsWhiteSpace(rune))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }
            if (pendingSpace) builder.Append(' ');
            pendingSpace = false;
            builder.Append(rune.ToString());
        }
        var result = builder.ToString();
        return result.Length > 0 && CountScalars(result) <= maximumScalars ? result : null;
    }

    private static int CountScalars(string value) => TryCountScalars(value, out var count) ? count : int.MaxValue;

    private static bool TryCountScalars(string value, out int count)
    {
        count = 0;
        for (var offset = 0; offset < value.Length;)
        {
            if (Rune.DecodeFromUtf16(value.AsSpan(offset), out _, out var consumed) != OperationStatus.Done) return false;
            offset += consumed;
            count++;
        }
        return true;
    }
}
