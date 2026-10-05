using System.Collections;
using WebTools.NativeHost.Models;
using WebTools.NativeHost.Search;
using WpfListBox = System.Windows.Controls.ListBox;

namespace WebTools.NativeHost.Services;

internal sealed class LauncherResultSelectionController(LauncherInteractionState state)
{
    private bool _synchronizing;

    public void Present(WpfListBox list, IReadOnlyList<SearchResult> results, IEnumerable rows, string? preferredResultId = null)
    {
        state.SetResults(results, preferredResultId);
        Synchronize(() =>
        {
            list.ItemsSource = rows;
            list.SelectedIndex = state.SelectedIndex;
        });
    }

    public void Clear(WpfListBox list)
    {
        Synchronize(() =>
        {
            list.ItemsSource = null;
            list.SelectedIndex = -1;
        });
    }

    public bool AcceptUserSelection(WpfListBox list)
    {
        if (_synchronizing) return false;
        state.Select(list.SelectedIndex);
        return true;
    }

    public int MoveSelection(WpfListBox list, int offset)
    {
        var index = state.MoveSelection(offset);
        Synchronize(() => list.SelectedIndex = index);
        return index;
    }

    public int Select(WpfListBox list, int index)
    {
        var selected = state.Select(index);
        Synchronize(() => list.SelectedIndex = selected);
        return selected;
    }

    private void Synchronize(Action update)
    {
        _synchronizing = true;
        try { update(); }
        finally { _synchronizing = false; }
    }
}
