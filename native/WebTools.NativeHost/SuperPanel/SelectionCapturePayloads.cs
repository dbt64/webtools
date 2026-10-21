using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>Shared Shell classification and existing invocation limits, independent of the selection source.</summary>
internal static class SelectionCapturePayloads
{
    internal static SelectionCaptureResult FromFilesystemItems(object selected, int length,
        SelectionDiagnosticAttempt? attempt, bool desktop = false, CancellationToken cancellation = default)
    {
        var stage = desktop ? "DESKTOP_ITEM_CLASSIFICATION" : "EXPLORER_ITEM_CLASSIFICATION";
        var completedStage = desktop ? "DESKTOP_PROVIDER_COMPLETED" : "EXPLORER_PROVIDER_COMPLETED";
        if (length is < 0 or > 64)
        {
            attempt?.Record(stage, "REJECTED", "TOO_MANY_ITEMS", timestamp: Stopwatch.GetTimestamp(),
                ("itemCount", length.ToString()), ("invalidItemCount", length > 64 ? length.ToString() : "1"));
            return new(SelectionContext.None("选择数量超过 64 项"), "TOO_MANY_ITEMS");
        }

        var items = new List<NativeSelectionItem>();
        var fileCount = 0; var directoryCount = 0; var invalidCount = 0;
        for (var index = 0; index < length; index++)
        {
            cancellation.ThrowIfCancellationRequested();
            object? item = null;
            try
            {
                item = ((dynamic)selected).Item(index);
                if (!Convert.ToBoolean(((dynamic)item!).IsFileSystem))
                {
                    invalidCount++;
                    var reason = desktop ? "DESKTOP_VIRTUAL_ITEM_UNSUPPORTED" : "VIRTUAL_ITEM";
                    attempt?.Record(stage, "REJECTED", reason, timestamp: Stopwatch.GetTimestamp(),
                        ("itemsProcessed", (index + 1).ToString()), ("filesystemItemCount", items.Count.ToString()),
                        ("fileCount", fileCount.ToString()), ("directoryCount", directoryCount.ToString()),
                        ("invalidItemCount", invalidCount.ToString()), ("isFileSystem", "false"));
                    return new(SelectionContext.None("虚拟 Shell 项目暂不支持"), reason);
                }
                var path = Convert.ToString(((dynamic)item!).Path) ?? "";
                if (!Path.IsPathFullyQualified(path) || !IsProtocolPathShapeValid(path))
                {
                    invalidCount++;
                    var reason = desktop ? "DESKTOP_ITEM_INVALID" : "INVALID_PATH";
                    attempt?.Record(stage, "REJECTED", reason, timestamp: Stopwatch.GetTimestamp(),
                        ("itemsProcessed", (index + 1).ToString()), ("filesystemItemCount", items.Count.ToString()),
                        ("fileCount", fileCount.ToString()), ("directoryCount", directoryCount.ToString()),
                        ("invalidItemCount", invalidCount.ToString()), ("isFileSystem", "true"), ("pathValidation", "failed"));
                    return new(SelectionContext.None("选择未提供完整文件路径"), reason);
                }
                var isFolder = Convert.ToBoolean(((dynamic)item!).IsFolder);
                items.Add(new(isFolder ? "directory" : "file", path));
                if (isFolder) directoryCount++; else fileCount++;
            }
            finally { if (item is not null && Marshal.IsComObject(item)) Marshal.ReleaseComObject(item); }
        }

        attempt?.Record(stage, "COMPLETE", timestamp: Stopwatch.GetTimestamp(),
            ("itemsProcessed", items.Count.ToString()), ("filesystemItemCount", items.Count.ToString()),
            ("fileCount", fileCount.ToString()), ("directoryCount", directoryCount.ToString()), ("invalidItemCount", invalidCount.ToString()));
        var payload = new NativeLauncherTextContext(items.All(item => item.Kind == "directory") ? "directories" : "files",
            "explorer-selection", null, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Array.AsReadOnly(items.ToArray()));
        var request = NativeFeatureInvocationProtocol.CreateSuperPanelRequest(new("org.example.capture", "selection"), payload);
        if (!NativeFeatureInvocationProtocol.IsValidRequest(request))
        {
            var reason = attempt is null ? "PROTOCOL_VALIDATION_REJECTED" : GetProtocolValidationReason(request);
            attempt?.Record("PROTOCOL_VALIDATION_REJECTED", "REJECTED", reason, timestamp: Stopwatch.GetTimestamp(),
                ("protocolValidation", "rejected"), ("validationReason", reason), ("protocolEnvelopeBytes", GetEnvelopeSize(request).ToString()));
            attempt?.Record(completedStage, "FAILED", reason);
            return new(SelectionContext.None("文件选择超出传输上限"), reason);
        }
        attempt?.Record("PROTOCOL_VALIDATION_ACCEPTED", "ACCEPTED", timestamp: Stopwatch.GetTimestamp(),
            ("protocolValidation", "accepted"), ("protocolEnvelopeBytes", GetEnvelopeSize(request).ToString()));
        var context = new SelectionContext(payload, $"{(desktop ? "Windows Desktop" : "File Explorer")} selection · {items.Count} 项");
        attempt?.Record(completedStage, "SUCCESS", timestamp: Stopwatch.GetTimestamp(),
            ("providerCompletedUtc", DateTimeOffset.UtcNow.ToString("O")), ("itemCount", items.Count.ToString()),
            ("fileCount", fileCount.ToString()), ("directoryCount", directoryCount.ToString()));
        return new(context, desktop
            ? payload.Type == "directories" ? "DESKTOP_DIRECTORIES_CAPTURED" : "DESKTOP_FILES_CAPTURED"
            : payload.Type == "directories" ? "EXPLORER_DIRECTORIES_CAPTURED" : "EXPLORER_FILES_CAPTURED");
    }

    internal static SelectionCaptureResult FromSelectedText(string text, bool limited, SelectionDiagnosticAttempt? attempt, string? captureHint = null)
    {
        var payload = new NativeLauncherTextContext("text", "selected-text", text, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var request = NativeFeatureInvocationProtocol.CreateSuperPanelRequest(new("org.example.capture", "selection"), payload);
        if (!NativeFeatureInvocationProtocol.IsValidRequest(request))
        {
            var reason = attempt is null ? "PROTOCOL_VALIDATION_REJECTED" : GetProtocolValidationReason(request);
            attempt?.Record("PROTOCOL_VALIDATION_REJECTED", "REJECTED", reason, timestamp: Stopwatch.GetTimestamp(),
                ("protocolValidation", "rejected"), ("validationReason", reason), ("characterCount", text.Length.ToString()),
                ("protocolEnvelopeBytes", GetEnvelopeSize(request).ToString()));
            attempt?.Record("TEXT_PROVIDER_COMPLETED", "FAILED", reason);
            return new(SelectionContext.None("所选文本超出传输上限"), reason);
        }
        attempt?.Record("PROTOCOL_VALIDATION_ACCEPTED", "ACCEPTED", timestamp: Stopwatch.GetTimestamp(),
            ("protocolValidation", "accepted"), ("characterCount", text.Length.ToString()), ("protocolEnvelopeBytes", GetEnvelopeSize(request).ToString()));
        attempt?.Record("TEXT_PROVIDER_COMPLETED", "SUCCESS", timestamp: Stopwatch.GetTimestamp(),
            ("providerCompletedUtc", DateTimeOffset.UtcNow.ToString("O")), ("characterCount", text.Length.ToString()));
        var hint = captureHint ?? "从当前应用读取的选择";
        if (limited) hint = "前 3000 字符 · " + hint;
        return new(new(payload, hint) { TextTruncated = limited }, "TEXT_CAPTURED");
    }

    private static string GetProtocolValidationReason(NativeFeatureInvocationRequest request)
    {
        var context = request.Context;
        if (context?.Text is { Length: > 3000 }) return "TEXT_TOO_LONG";
        if (context?.Items is { Count: > 64 }) return "TOO_MANY_ITEMS";
        if (context?.Items is { } items)
        {
            if (items.Any(item => item is null || item.Kind is not ("file" or "directory"))) return "INVALID_ITEM";
            if (items.Any(item => item.Path is null || !Path.IsPathFullyQualified(item.Path) || !IsProtocolPathShapeValid(item.Path))) return "INVALID_PATH";
            if (items.Select(item => item.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != items.Count) return "INVALID_ITEM";
        }
        return GetEnvelopeSize(request) > NativeFeatureInvocationProtocol.MaximumRequestBytes ? "ENVELOPE_TOO_LARGE" : "OTHER_VALIDATION_FAILURE";
    }

    private static int GetEnvelopeSize(NativeFeatureInvocationRequest request)
    {
        try { return JsonSerializer.SerializeToUtf8Bytes(request, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }).Length; }
        catch { return -1; }
    }

    private static bool IsProtocolPathShapeValid(string path) => path.Length <= 1024 && !path.Any(char.IsControl)
        && !path.StartsWith(@"\\?\", StringComparison.Ordinal) && !path.StartsWith(@"\\.\", StringComparison.Ordinal)
        && !path[(path.Length >= 2 && path[1] == ':' ? 2 : 0)..].Contains(':');
}
