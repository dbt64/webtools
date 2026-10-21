using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

internal sealed record SuperPanelFeatureSelection(
    IReadOnlyList<NativeFeatureProjectionRowV2> Pinned,
    IReadOnlyList<NativeFeatureProjectionRowV2> Others,
    int MatchedCount)
{
    internal static SuperPanelFeatureSelection Create(IReadOnlyList<NativeFeatureProjectionRowV2> features,
        IReadOnlyList<NativeFeatureRef> pins, bool board, bool choosing, NativeLauncherTextContext? context)
    {
        var pinSet = pins.ToHashSet();
        var pinned = new Dictionary<NativeFeatureRef, NativeFeatureProjectionRowV2>();
        // The ordinary board needs only saved pins, not a sorted copy of the whole catalog.
        List<NativeFeatureProjectionRowV2>? others = !board || choosing ? [] : null;
        var count = 0;
        foreach (var row in features)
        {
            if (row.FeatureKind is not ("runtime-v3" or "built-in")
                || !(board ? SuperPanelFeatureMatcher.IsGeneral(row)
                    : context is not null && SuperPanelFeatureMatcher.MatchesSelection(row, context))) continue;
            count++;
            if (pinSet.Contains(row.Ref)) pinned[row.Ref] = row;
            else others?.Add(row);
        }
        return new(pins.Where(pinned.ContainsKey).Select(reference => pinned[reference]).ToArray(),
            others is null ? [] : others.OrderBy(row => row.Title).ToArray(), count);
    }
}
