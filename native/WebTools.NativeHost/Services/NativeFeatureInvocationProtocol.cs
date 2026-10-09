using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.Services;

public sealed record NativeLauncherTextContext(string Type, string Source, string Text, long CapturedAtUnixMs);
public sealed record NativeFeatureInvocationRequest(string RequestId, NativeFeatureRef Ref, string Source,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] NativeLauncherTextContext? Context = null);

public static class NativeFeatureInvocationProtocol
{
    public const int MaximumRequestBytes = 16 * 1024;
    public const int MaximumResponseBytes = 256;

    private static readonly HashSet<string> RejectedReasons = new(StringComparer.Ordinal)
    {
        "invalid-request", "feature-not-found", "plugin-disabled", "permission-denied", "feature-unavailable",
        "stale-request", "unsupported-feature-kind", "queue-full", "manager-not-ready",
    };
    private static readonly HashSet<string> FailedReasons = new(StringComparer.Ordinal)
    {
        "manager-timeout", "manager-disconnected", "dispatch-failed",
    };
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static NativeFeatureInvocationRequest CreateRequest(NativeFeatureRef reference, string? launcherText = null) =>
        new(Guid.NewGuid().ToString("D"), reference with { }, "launcher", string.IsNullOrEmpty(launcherText) ? null
            : new("text", "launcher-input", launcherText, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));

    public static bool IsValidRequest(NativeFeatureInvocationRequest request)
    {
        if (!Guid.TryParseExact(request.RequestId, "D", out var id) || id.ToString("D") != request.RequestId
            || request.Ref is null || !request.Ref.IsValid || request.Source != "launcher") return false;
        if (request.Context is { } context && (context.Type != "text" || context.Source != "launcher-input"
            || context.Text is null || context.Text.Length > 300 || context.CapturedAtUnixMs < 0)) return false;
        try
        {
            if (request.Context is { } textContext) _ = new UTF8Encoding(false, true).GetByteCount(textContext.Text);
            return JsonSerializer.SerializeToUtf8Bytes(request, JsonOptions).Length <= (request.Context is null ? 1024 : MaximumRequestBytes);
        }
        catch (Exception error) when (error is JsonException or NotSupportedException or EncoderFallbackException) { return false; }
    }

    public static bool TryParseResult(JsonElement value, string expectedRequestId, out string status, out string reasonCode)
    {
        status = "";
        reasonCode = "";
        if (Encoding.UTF8.GetByteCount(value.GetRawText()) > MaximumResponseBytes || value.ValueKind != JsonValueKind.Object) return false;
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!names.Add(property.Name) || property.Name is not ("requestId" or "status" or "reasonCode")) return false;
        if (names.Count != 3
            || !value.TryGetProperty("requestId", out var requestId) || requestId.ValueKind != JsonValueKind.String
            || requestId.GetString() != expectedRequestId
            || !value.TryGetProperty("status", out var statusValue) || statusValue.ValueKind != JsonValueKind.String
            || !value.TryGetProperty("reasonCode", out var reasonValue) || reasonValue.ValueKind != JsonValueKind.String) return false;

        status = statusValue.GetString()!;
        reasonCode = reasonValue.GetString()!;
        return status switch
        {
            "accepted" => reasonCode == "accepted",
            "rejected" => RejectedReasons.Contains(reasonCode),
            "failed" => FailedReasons.Contains(reasonCode),
            _ => false,
        };
    }
}
