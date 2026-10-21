using System.Diagnostics;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

internal enum SuperPanelBuiltInTextActionKind
{
    SearchSelectedText,
    OpenSelectedLink,
}

internal sealed record SuperPanelBuiltInTextAction(
    SuperPanelBuiltInTextActionKind Kind,
    NativeFeatureRef Ref,
    string Title,
    string FallbackGlyph);

/// <summary>
/// Native Host actions that operate on the current transient selected-text context.
/// Discovery is local and has no process, network or persistence side effect.
/// </summary>
internal static class SuperPanelBuiltInTextActions
{
    private static readonly SuperPanelBuiltInTextAction Search = new(
        SuperPanelBuiltInTextActionKind.SearchSelectedText,
        new NativeFeatureRef("webtools.host", "search-selected-text"),
        "搜索选中文字",
        "搜");

    private static readonly SuperPanelBuiltInTextAction OpenLink = new(
        SuperPanelBuiltInTextActionKind.OpenSelectedLink,
        new NativeFeatureRef("webtools.host", "open-selected-link"),
        "打开选中链接",
        "↗");

    internal static IReadOnlyList<SuperPanelBuiltInTextAction> Create(NativeLauncherTextContext? context)
    {
        if (!TryReadText(context, out var text)) return [];
        return SelectedTextMatch.Matches(text, "http-url") ? [Search, OpenLink] : [Search];
    }

    internal static ProcessStartInfo CreateStartInfo(
        SuperPanelBuiltInTextAction action,
        NativeLauncherTextContext? context,
        WebsiteSnapshot snapshot)
    {
        if (!TryReadText(context, out var text) || !Create(context).Any(candidate => candidate.Kind == action.Kind))
            throw new InvalidOperationException("当前选中文本不适用于此操作。");

        var url = action.Kind switch
        {
            SuperPanelBuiltInTextActionKind.SearchSelectedText => snapshot.BuildWebSearchUrl(text),
            SuperPanelBuiltInTextActionKind.OpenSelectedLink => text.Trim(),
            _ => throw new InvalidOperationException("未知的宿主文本操作。"),
        };
        return ResultActionExecutor.ForUrl(url);
    }

    private static bool TryReadText(NativeLauncherTextContext? context, out string text)
    {
        text = context?.Text ?? "";
        return context is { Type: "text", Source: "selected-text" }
            && text.Length is > 0 and <= 3000
            && !string.IsNullOrWhiteSpace(text);
    }
}
