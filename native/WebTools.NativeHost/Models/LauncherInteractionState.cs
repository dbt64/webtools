using WebTools.NativeHost.Search;

namespace WebTools.NativeHost.Models;

public sealed class LauncherInteractionState
{
    private IReadOnlyList<SearchResult> _results = [];

    public string Query { get; private set; } = string.Empty;

    public bool ResultsVisible => Query.Trim().Length > 0;

    public IReadOnlyList<SearchResult> Results => _results;

    public int SelectedIndex { get; private set; } = -1;

    public void SetQuery(string? query)
    {
        Query = query ?? string.Empty;
        if (!ResultsVisible) SetResults([]);
    }

    public void SetResults(IReadOnlyList<SearchResult> results)
    {
        _results = results;
        SelectedIndex = results.Count > 0 ? 0 : -1;
    }

    public int MoveSelection(int offset)
    {
        var resultCount = Results.Count;
        if (resultCount == 0 || offset == 0)
        {
            return SelectedIndex;
        }

        SelectedIndex = (SelectedIndex + offset % resultCount + resultCount) % resultCount;
        return SelectedIndex;
    }

    public int Select(int index)
    {
        SelectedIndex = index >= 0 && index < Results.Count ? index : -1;
        return SelectedIndex;
    }

    public SearchResult? GetSelectedResult()
    {
        return SelectedIndex >= 0 && SelectedIndex < Results.Count
            ? Results[SelectedIndex]
            : null;
    }

    public void Reset()
    {
        Query = string.Empty;
        _results = [];
        SelectedIndex = -1;
    }
}
