using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.Services;

public sealed record NativeSelectionItem(string Kind, string Path);
public sealed record NativeLauncherTextContext(string Type, string Source,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Text, long CapturedAtUnixMs,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<NativeSelectionItem>? Items = null);
public sealed record NativeFeatureInvocationRequest(string RequestId, NativeFeatureRef Ref, string Source,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] NativeLauncherTextContext? Context = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] NativeQuickResultOptions? QuickResult = null);

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
        "manager-timeout", "manager-disconnected", "dispatch-failed", "command-failed", "command-timeout",
    };
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static NativeFeatureInvocationRequest CreateRequest(NativeFeatureRef reference, string? launcherText = null) =>
        new(Guid.NewGuid().ToString("D"), reference with { }, "launcher", string.IsNullOrEmpty(launcherText) ? null
            : new("text", "launcher-input", launcherText, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
    public static NativeFeatureInvocationRequest CreateSuperPanelRequest(NativeFeatureRef reference, NativeLauncherTextContext? context) =>
        new(Guid.NewGuid().ToString("D"), reference with { }, "super-panel", context is null ? null : context with
        { Items = context.Items is null ? null : Array.AsReadOnly(context.Items.Select(item => item with { }).ToArray()) });

    public static bool IsValidRequest(NativeFeatureInvocationRequest request)
    {
        if (request.QuickResult is { } quick && (quick.Version != 1 || request.Source != "super-panel"
            || request.Context is not { Type: "text", Source: "selected-text" })) return false;
        if (!Guid.TryParseExact(request.RequestId, "D", out var id) || id.ToString("D") != request.RequestId
            || request.Ref is null || !request.Ref.IsValid || request.Source is not ("launcher" or "super-panel")) return false;
        if (request.Context is { } context)
        {
            if (context.CapturedAtUnixMs < 0) return false;
            if (context.Type == "text")
            {
                if (context.Source != (request.Source == "launcher" ? "launcher-input" : "selected-text") || context.Text is null
                    || context.Items is not null || context.Text.Length > (request.Source == "launcher" ? 300 : 3000)) return false;
            }
            else
            {
                if (request.Source != "super-panel" || context.Type is not ("files" or "directories") || context.Source != "explorer-selection"
                    || context.Text is not null || context.Items is null || context.Items.Count is < 1 or > 64) return false;
                if (context.Items.Any(item => item is null || item.Kind is not ("file" or "directory") || item.Path is null || item.Path.Length > 1024
                    || !System.IO.Path.IsPathFullyQualified(item.Path) || item.Path.Any(char.IsControl) || item.Path.StartsWith(@"\\?\") || item.Path.StartsWith(@"\\.\")
                    || item.Path[(item.Path.Length >= 2 && item.Path[1] == ':' ? 2 : 0)..].Contains(':'))) return false;
                if (context.Items.Select(item => item.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != context.Items.Count
                    || context.Type == "directories" && context.Items.Any(item => item.Kind != "directory")
                    || context.Type == "files" && !context.Items.Any(item => item.Kind == "file")) return false;
            }
        }
        try
        {
            if (request.Context?.Text is { } text) _ = new UTF8Encoding(false, true).GetByteCount(text);
            foreach (var item in request.Context?.Items ?? []) _ = new UTF8Encoding(false, true).GetByteCount(item.Path);
            return JsonSerializer.SerializeToUtf8Bytes(request, JsonOptions).Length <= (request.Context is null ? 1024 : MaximumRequestBytes);
        }
        catch (Exception error) when (error is JsonException or NotSupportedException or EncoderFallbackException) { return false; }
    }

    public static bool TryParseResult(JsonElement value, string expectedRequestId, out string status, out string reasonCode)
        => TryParseResult(value, expectedRequestId, out status, out reasonCode, out _);

    public static bool TryParseResult(JsonElement value, string expectedRequestId, out string status, out string reasonCode, out bool dismissPanel)
    {
        status = "";
        reasonCode = "";
        dismissPanel = false;
        if (Encoding.UTF8.GetByteCount(value.GetRawText()) > MaximumResponseBytes || value.ValueKind != JsonValueKind.Object) return false;
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!names.Add(property.Name) || property.Name is not ("requestId" or "status" or "reasonCode" or "dismissPanel")) return false;
        if (names.Count != (names.Contains("dismissPanel") ? 4 : 3)
            || !value.TryGetProperty("requestId", out var requestId) || requestId.ValueKind != JsonValueKind.String
            || requestId.GetString() != expectedRequestId
            || !value.TryGetProperty("status", out var statusValue) || statusValue.ValueKind != JsonValueKind.String
            || !value.TryGetProperty("reasonCode", out var reasonValue) || reasonValue.ValueKind != JsonValueKind.String) return false;

        status = statusValue.GetString()!;
        reasonCode = reasonValue.GetString()!;
        if (names.Contains("dismissPanel"))
        {
            if (status != "completed" || reasonCode != "completed" || value.GetProperty("dismissPanel").ValueKind != JsonValueKind.True) return false;
            dismissPanel = true;
        }
        return status switch
        {
            "accepted" => reasonCode == "accepted",
            "completed" => reasonCode == "completed",
            "cancelled" => reasonCode == "cancelled",
            "rejected" => RejectedReasons.Contains(reasonCode),
            "failed" => FailedReasons.Contains(reasonCode),
            _ => false,
        };
    }
}
