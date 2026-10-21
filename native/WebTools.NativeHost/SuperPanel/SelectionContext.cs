using System.IO;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

public enum SurfaceContextMode { NoContext, SelectedText, SelectedFiles, SelectedDirectories, ExplorerFolder }
public sealed record ExplorerFolderMetadata(string Path, string DisplayName);

public sealed record SelectionContext(NativeLauncherTextContext? Payload, string Hint)
{
    // Native visual metadata only. It is never converted into an invocation payload.
    public ExplorerFolderMetadata? ExplorerFolder { get; init; }
    // Native-only transaction feedback. Never part of the Feature invocation payload or persisted state.
    public string? CaptureNotice { get; init; }
    // Native capture metadata only. Never automatically translate an incomplete selection.
    public bool TextTruncated { get; init; }
    public SurfaceContextMode Mode => Payload?.Type switch
    {
        "text" => SurfaceContextMode.SelectedText,
        "files" => SurfaceContextMode.SelectedFiles,
        "directories" => SurfaceContextMode.SelectedDirectories,
        _ => ExplorerFolder is not null ? SurfaceContextMode.ExplorerFolder : SurfaceContextMode.NoContext,
    };
    public static SelectionContext None(string hint = "未获取到选中内容 · 可使用通用功能") => new(null, hint);
    public string Summary => Mode switch { SurfaceContextMode.SelectedText => "选中文本", SurfaceContextMode.SelectedDirectories => "选中目录", SurfaceContextMode.SelectedFiles => "选中文件", SurfaceContextMode.ExplorerFolder => "当前文件夹", _ => "无上下文" };
    public string Preview => ExplorerFolder?.DisplayName ?? (Payload?.Type == "text" ? PreviewText(Payload.Text ?? "")
        : Payload?.Items is { } items ? string.Join(" · ", items.Take(5).Select(item => Path.GetFileName(item.Path.TrimEnd('\\', '/')))) : Hint);
    private static string PreviewText(string text)
    {
        var length = Math.Min(text.Length, 220);
        if (length > 0 && char.IsHighSurrogate(text[length - 1])) --length;
        return text[..length] + (length < text.Length ? "…" : "");
    }
}

public static class SuperPanelFeatureMatcher
{
    public static bool IsGeneral(NativeFeatureProjectionRowV2 row) => row.AcceptedContexts.Count == 0 || row.AcceptedContexts.Any(rule => rule.Type == "none");
    public static bool Matches(NativeFeatureProjectionRowV2 row, NativeLauncherTextContext? context)
    {
        if (context is null) return IsGeneral(row);
        if (IsGeneral(row)) return true; // General actions receive no selection when Main resolves authority.
        return MatchesSelection(row, context);
    }
    public static bool MatchesSelection(NativeFeatureProjectionRowV2 row, NativeLauncherTextContext context)
    {
        if (context.Type == "text") return row.AcceptedContexts.Any(rule => rule.Type == "text" && rule.Sources.Contains(context.Source)
            && (rule.TextMatch is null || context.Source == "selected-text" && SelectedTextMatch.Matches(context.Text, rule.TextMatch)));
        var items = context.Items ?? [];
        return items.Select(item => item.Kind).Distinct().All(kind => row.AcceptedContexts.Any(rule =>
            rule.Type == (kind == "file" ? "files" : "directories") && rule.Sources.Contains(context.Source)
            && (rule.MaxItems is null || items.Count <= rule.MaxItems)
            && (kind != "file" || rule.Extensions is null || rule.Extensions.Count == 0
                || items.Where(item => item.Kind == "file").All(item => rule.Extensions.Contains(Path.GetExtension(item.Path).ToLowerInvariant())))));
    }
}
