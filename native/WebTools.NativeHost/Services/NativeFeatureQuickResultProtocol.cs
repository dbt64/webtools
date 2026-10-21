using System.Buffers;
using System.Text;
using System.Text.Json;
using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.Services;

public sealed record NativeQuickResultOptions(int Version);
public sealed record NativeFeatureTextResult(int ResultVersion, string RequestId, NativeFeatureRef Ref, string Text);
public sealed record NativeFeatureResultControl(string RequestId, NativeFeatureRef Ref);
public sealed record NativeFeatureAIConfirmation(string RequestId, NativeFeatureRef Ref, string ConsentId, string PluginName, string ProviderName, string Preview);

public static class NativeFeatureQuickResultProtocol
{
    public const string Capability = "super-panel-quick-result-v1";
    public const int MaximumPayloadBytes = 65536;
    public static string? NormalizeText(string? input)
    {
        if (input is null || input.Length > MaximumPayloadBytes) return null;
        var text = input.Replace("\r\n", "\n").Replace('\r', '\n');
        var span = text.AsSpan(); var count = 0;
        while (!span.IsEmpty)
        {
            if (Rune.DecodeFromUtf16(span, out var rune, out var consumed) != OperationStatus.Done
                || ++count > 8192 || rune.Value < 32 && rune.Value is not (9 or 10)) return null;
            span = span[consumed..];
        }
        // Match Main's ECMAScript trim set: .NET differs for NEL and BOM.
        var blank = text.All(c => c is '\t' or '\n' or ' ' or '\u00a0' or '\u1680'
            or >= '\u2000' and <= '\u200a' or '\u2028' or '\u2029' or '\u202f' or '\u205f' or '\u3000' or '\ufeff');
        return !blank && Encoding.UTF8.GetByteCount(text) <= 32768 ? text : null;
    }
    public static bool Exact(JsonElement value, params string[] fields)
    {
        if (value.ValueKind != JsonValueKind.Object || Encoding.UTF8.GetByteCount(value.GetRawText()) > MaximumPayloadBytes) return false;
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in value.EnumerateObject()) if (!names.Add(p.Name) || !fields.Contains(p.Name)) return false;
        return names.Count == fields.Length;
    }
    public static bool TryParseControl(JsonElement value, out NativeFeatureResultControl? result)
    {
        result = null;
        if (!Exact(value, "requestId", "ref")) return false;
        var idValue = value.GetProperty("requestId"); var reference = value.GetProperty("ref");
        if (idValue.ValueKind != JsonValueKind.String || !Guid.TryParseExact(idValue.GetString(), "D", out var id)
            || id.ToString("D")[14] != '4' || !"89ab".Contains(id.ToString("D")[19])
            || !Exact(reference, "pluginId", "featureId")
            || reference.GetProperty("pluginId").ValueKind != JsonValueKind.String || reference.GetProperty("featureId").ValueKind != JsonValueKind.String) return false;
        var feature = new NativeFeatureRef(reference.GetProperty("pluginId").GetString()!, reference.GetProperty("featureId").GetString()!);
        if (!feature.IsValid) return false;
        result = new(idValue.GetString()!, feature); return true;
    }
    public static bool TryParseResult(JsonElement value, out NativeFeatureTextResult? result)
    {
        result = null;
        if (!Exact(value, "resultVersion", "requestId", "ref", "text")
            || value.GetProperty("resultVersion").ValueKind != JsonValueKind.Number
            || !value.GetProperty("resultVersion").TryGetInt32(out var version) || version != 1
            || value.GetProperty("text").ValueKind != JsonValueKind.String) return false;
        using var binding = JsonDocument.Parse(JsonSerializer.Serialize(new { requestId = value.GetProperty("requestId"), @ref = value.GetProperty("ref") }));
        if (!TryParseControl(binding.RootElement, out var control) || NormalizeText(value.GetProperty("text").GetString()) is not { } text) return false;
        result = new(1, control!.RequestId, control.Ref, text); return true;
    }
    public static bool TryParseConfirmation(JsonElement value, out NativeFeatureAIConfirmation? result)
    {
        result = null;
        if (!Exact(value, "requestId", "ref", "consentId", "pluginName", "providerName", "preview")) return false;
        foreach (var key in new[] { "consentId", "pluginName", "providerName", "preview" }) if (value.GetProperty(key).ValueKind != JsonValueKind.String) return false;
        using var binding = JsonDocument.Parse(JsonSerializer.Serialize(new { requestId = value.GetProperty("requestId"), @ref = value.GetProperty("ref") }));
        if (!TryParseControl(binding.RootElement, out var control) || !Guid.TryParseExact(value.GetProperty("consentId").GetString(), "D", out var consent)
            || consent.ToString("D")[14] != '4' || !"89ab".Contains(consent.ToString("D")[19])) return false;
        var name = value.GetProperty("pluginName").GetString()!; var provider = value.GetProperty("providerName").GetString()!; var preview = value.GetProperty("preview").GetString()!;
        if (name.Length is < 1 or > 160 || provider.Length is < 1 or > 160 || preview.Length > 8192) return false;
        result = new(control!.RequestId, control.Ref, consent.ToString("D"), name, provider, preview); return true;
    }
}
