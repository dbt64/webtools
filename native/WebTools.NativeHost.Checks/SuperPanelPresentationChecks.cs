using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Interop;
using System.Windows.Threading;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;
using WebTools.NativeHost.SuperPanel;
using ListBox = System.Windows.Controls.ListBox;

namespace WebTools.NativeHost.Checks;

internal static class SuperPanelPresentationChecks
{
    internal static Task<(int Total, int Failed)> RunAsync()
    {
        var done = new TaskCompletionSource<(int, int)>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            var dispatcher = Dispatcher.CurrentDispatcher;
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(dispatcher));
            dispatcher.BeginInvoke(new Action(async () =>
            {
                var total = 0; var failed = 0;
                try
                {
                    var root = Path.Combine(Path.GetTempPath(), "WebTools-Panel-Presentation-" + Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(root);
                    var diagnostics = new DiagnosticsService(Stopwatch.GetTimestamp());
                    var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
                    await using var pipe = new NativeManagerPipeServer("WebTools.Checks." + Guid.NewGuid().ToString("N"), state,
                        _ => Task.FromResult(state.Snapshot), _ => Task.FromResult(state.Snapshot), (_, _) => Task.FromResult(state.Snapshot), diagnostics);
                    using var manager = new ManagerController(pipe, new ManagerProcessLauncher(false, root), diagnostics, _ => throw new InvalidOperationException());
                    var features = Enumerable.Range(0, 2000).Select(i => new NativeFeatureProjectionRowV2(
                        new("org.example.panel", "feature-" + i), "Fixture", $"Action {i:D4}", [],
                        [new("none", []), new("text", ["selected-text"])], "plugin", "runtime-v3", "plugin-features",
                        IconDataUrl: "data:image/png;base64,fixture-" + i)).ToArray();
                    var projection = new NativeFeatureProjectionV2(2, Guid.NewGuid().ToString(), 1, 1, features);
                    var store = new SuperPanelStateStore(root);
                    store.Save(SuperPanelState.Default with { Pinned = features.Take(12).Reverse().Select(f => f.Ref).ToArray() });
                    var requests = new List<string>();
                    var pending = new List<TaskCompletionSource<BitmapSource?>>();
                    var blocked = true;
                    var bitmap = BitmapSource.Create(1, 1, 96, 96, PixelFormats.Bgra32, null, new byte[4], 4); bitmap.Freeze();
                    Task<BitmapSource?> Icon(string? reference)
                    {
                        requests.Add(reference!);
                        if (!blocked) return Task.FromResult<BitmapSource?>(bitmap);
                        var completion = new TaskCompletionSource<BitmapSource?>(TaskCreationOptions.RunContinuationsAsynchronously);
                        pending.Add(completion); return completion.Task;
                    }
                    using var window = new SuperPanelWindow(store, manager, Icon, projection);
                    async Task Check(string name, Func<Task> action)
                    {
                        total++;
                        try { await action(); Console.WriteLine("PASS " + name); }
                        catch (Exception error) { failed++; Console.WriteLine("FAIL " + name + ": " + error.Message); }
                    }
                    var context = SelectionCapturePayloads.FromSelectedText("Synthetic presentation fixture", false, null).Context;
                    await Check("reused HWND is compact and concealed at native show before exposing fresh pending content", async () =>
                    {
                        window.Present(context, null); await Layout(dispatcher, window);
                        var handle = new WindowInteropHelper(window).Handle;
                        var source = HwndSource.FromHwnd(handle)!;
                        var shown = new List<(double Height, double Opacity)>();
                        IntPtr ObserveShow(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
                        {
                            if (message == 0x0018 && wParam != IntPtr.Zero && GetWindowRect(hwnd, out var bounds))
                                shown.Add(((bounds.Bottom - bounds.Top) / VisualTreeHelper.GetDpi(window).DpiScaleY, window.Opacity));
                            return IntPtr.Zero;
                        }
                        source.AddHook(ObserveShow);
                        try
                        {
                            window.Dismiss();
                            window.PresentInitialCompact(null, null);
                            Require(shown.Count == 1, "Expected exactly one native show.");
                            Console.WriteLine($"PENDING_NATIVE_SHOW height={shown[0].Height:F1} opacity={shown[0].Opacity:F1}");
                            Require(shown[0].Height <= 80 && shown[0].Opacity == 0,
                                "Reused HWND exposes its previous frame/size before pending layout is ready.");
                            await Layout(dispatcher, window);
                            Require(window.Opacity == 1 && window.ActualHeight <= 80 && !window.IsActive,
                                "Fresh compact content was not revealed without activation.");
                            Require(((FrameworkElement)window.FindName("ContextSurface")).Visibility == Visibility.Collapsed
                                && ((TextBlock)window.FindName("TextPreview")).Text.Length == 0, "Previous context survived.");
                            window.Present(SelectionContext.None(), null); await Layout(dispatcher, window);
                            Require(window.ActualHeight > 200 && window.Opacity == 1, "Pending did not expand to the board.");
                            Require(new WindowInteropHelper(window).Handle == handle, "Presentation recreated the HWND.");
                        }
                        finally { source.RemoveHook(ObserveShow); window.Dismiss(); }
                    });
                    await Check("dismiss and replacement invalidate pending reveal work", async () =>
                    {
                        window.PresentInitialCompact(null, null);
                        window.Dismiss();
                        await Layout(dispatcher, window);
                        Require(!window.IsVisible && window.Opacity == 0, "A dismissed frame was revealed by queued work.");
                        window.PresentInitialCompact(null, null);
                        window.Dismiss();
                        window.PresentInitialCompact(null, null);
                        window.Present(context, null);
                        await Layout(dispatcher, window);
                        Require(window.IsVisible && window.Opacity == 1
                            && ((FrameworkElement)window.FindName("BoardSurface")).Visibility == Visibility.Collapsed
                            && ((FrameworkElement)window.FindName("TextContextRoot")).IsVisible,
                            "A stale reveal replaced or suppressed the current context.");
                        window.Dismiss();
                    });
                    await Check("context keeps all 2000 actions but realizes only viewport rows with bounded icon work", async () =>
                    {
                        window.Present(context, null); await Layout(dispatcher, window);
                        var lists = ActionLists(window);
                        Require(lists.Sum(list => list.Items.Count) == 2000, "Actions were truncated.");
                        var realized = lists.Sum(list => Descendants(list).OfType<ListBoxItem>().Count());
                        Console.WriteLine($"PRESENTATION_ROWS total=2000 realized={realized} iconRequests={requests.Count}");
                        Require(realized is > 0 and < 30, "Context actions are not effectively virtualized.");
                        Require(requests.Count is > 0 and <= 2, "Icon decode concurrency is not bounded.");
                        Require(Title(lists[0].Items[0]) == "Action 0011", "Saved pin order changed.");
                    });
                    await Check("dismiss cancels queued icons and reopen shares unfinished decodes", async () =>
                    {
                        var started = requests.Count;
                        window.Dismiss(); window.Present(context, null); await Layout(dispatcher, window);
                        Require(requests.Count == started, "Reopen duplicated in-flight icon decodes.");
                        window.Dismiss(); blocked = false;
                        foreach (var completion in pending) completion.TrySetResult(bitmap);
                        await Layout(dispatcher, window);
                        Require(requests.Count == started, "Dismissed rows started queued icon work.");
                        Require(ActionLists(window).All(list => list.Items.Count == 0), "Dismiss retained context actions.");
                    });
                    // Ensure a failed assertion cannot strand synthetic decodes or affect subsequent checks.
                    blocked = false; foreach (var completion in pending) completion.TrySetResult(bitmap);
                    await Check("scrolling releases old row bitmaps and loads newly visible actions", async () =>
                    {
                        window.Dismiss(); window.Present(context, null); await Layout(dispatcher, window);
                        var list = ActionLists(window).Last(); var first = list.Items[0];
                        Require(IconOf(first) is not null, "Visible row did not receive its icon.");
                        list.ScrollIntoView(list.Items[^1]); await Layout(dispatcher, window);
                        Require(list.ItemContainerGenerator.ContainerFromIndex(list.Items.Count - 1) is not null, "Last action is unreachable.");
                        Require(IconOf(first) is null, "Offscreen row retained a bitmap.");
                        Require(IconOf(list.Items[^1]) is not null, "Recycled container did not load its current icon.");
                        window.Dismiss();
                    });
                    await Check("nine-slot board preserves pins, pagination and explicit add picker", async () =>
                    {
                        window.Present(SelectionContext.None(), null); await Layout(dispatcher, window);
                        var board = (ListBox)window.FindName("BoardList");
                        Require(board.Items.Count == 9 && Title(board.Items[0]) == "Action 0011", "Board first page changed.");
                        ((System.Windows.Controls.Button)window.FindName("NextPage")).RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
                        await Layout(dispatcher, window);
                        Require(board.Items.Count == 3 && Title(board.Items[0]) == "Action 0002", "Board paging changed.");
                        ((System.Windows.Controls.Button)window.FindName("AddShortcut")).RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
                        await Layout(dispatcher, window);
                        var choices = (ListBox)window.FindName("ChoiceList");
                        Require(choices.Items.Count == 1988 && Title(choices.Items[0]) == "Action 0012", "Add picker lost sorted unpinned features.");
                        window.Dismiss();
                    });
                    await Check("ordinary board retains only matched pins while picker and contexts preserve feature filters", () =>
                    {
                        var selected = SuperPanelFeatureSelection.Create(features, store.Snapshot.Pinned, true, false, null);
                        Require(selected.Pinned.Count == 12 && selected.Others.Count == 0 && selected.MatchedCount == 2000,
                            "Ordinary board retained unpinned candidates or changed its diagnostic count.");
                        var restricted = features[0] with { Ref = new("org.example.panel", "selection-only"), AcceptedContexts = [new("text", ["selected-text"])] };
                        var unsupported = features[1] with { FeatureKind = "declarative-compatibility" };
                        var inputs = new[] { features[0], restricted, unsupported };
                        var pins = new[] { restricted.Ref, new NativeFeatureRef("org.example.missing", "missing"), features[0].Ref };
                        selected = SuperPanelFeatureSelection.Create(inputs, pins, true, true, null);
                        Require(selected.Pinned.Count == 1 && selected.Pinned[0].Ref == features[0].Ref && selected.Others.Count == 0,
                            "Board displayed unavailable or non-general pins.");
                        selected = SuperPanelFeatureSelection.Create(inputs, pins, false, false, context.Payload);
                        Require(selected.Pinned.Count == 2 && selected.Pinned[0].Ref == restricted.Ref && selected.MatchedCount == 2,
                            "Context matching or pin order changed.");
                        Require(SuperPanelFeatureSelection.Create(inputs, pins, false, false, null).MatchedCount == 0,
                            "Explorer metadata became a selected context.");
                        return Task.CompletedTask;
                    });
                    await Check("one cancelled icon subscriber cannot cancel another and failed loads release slots", async () =>
                    {
                        var started = new List<string>();
                        var first = new TaskCompletionSource<BitmapSource?>(TaskCreationOptions.RunContinuationsAsynchronously);
                        var second = new TaskCompletionSource<BitmapSource?>(TaskCreationOptions.RunContinuationsAsynchronously);
                        var loader = new SuperPanelIconLoader(key =>
                        {
                            started.Add(key!);
                            return key switch { "first" => first.Task, "second" => second.Task,
                                "bad" => Task.FromException<BitmapSource?>(new InvalidDataException()), _ => Task.FromResult<BitmapSource?>(bitmap) };
                        });
                        using var cancelOwner = new CancellationTokenSource(); using var cancelQueued = new CancellationTokenSource();
                        var owner = loader.GetAsync("first", cancelOwner.Token);
                        var other = loader.GetAsync("second", CancellationToken.None);
                        var subscriber = loader.GetAsync("first", CancellationToken.None);
                        var queued = loader.GetAsync("queued", cancelQueued.Token);
                        cancelOwner.Cancel(); cancelQueued.Cancel();
                        try
                        {
                            try { await owner; throw new InvalidOperationException("Owner was not cancelled."); } catch (OperationCanceledException) { }
                            try { await queued; throw new InvalidOperationException("Queue was not cancelled."); } catch (OperationCanceledException) { }
                            Require(started.SequenceEqual(new[] { "first", "second" }) && !subscriber.IsCompleted,
                                "Cancellation duplicated or aborted shared work.");
                        }
                        finally { first.TrySetResult(bitmap); second.TrySetResult(bitmap); }
                        Require(ReferenceEquals(await subscriber, bitmap) && ReferenceEquals(await other, bitmap), "Live subscriber lost its result.");
                        Require(await loader.GetAsync("bad", CancellationToken.None) is null, "Failure did not fall back.");
                        Require(ReferenceEquals(await loader.GetAsync("good", CancellationToken.None), bitmap), "Failure retained its concurrency slot.");
                    });
                    await Check("visible projection replacement rejects old icons and clears zero-match context", async () =>
                    {
                        var delayed = new TaskCompletionSource<BitmapSource?>(TaskCreationOptions.RunContinuationsAsynchronously);
                        var fresh = BitmapSource.Create(1, 1, 96, 96, PixelFormats.Bgra32, null, new byte[] { 255, 0, 0, 255 }, 4); fresh.Freeze();
                        var original = features[0];
                        using var changing = new SuperPanelWindow(store, manager,
                            key => key == original.IconDataUrl ? delayed.Task : Task.FromResult<BitmapSource?>(fresh),
                            projection with { Features = [original] });
                        try
                        {
                            changing.Present(context, null); await Layout(dispatcher, changing);
                            changing.ApplyProjection(projection with { Revision = 2, Features = [original with { Title = "Updated", IconDataUrl = "new-icon" }] });
                            await Layout(dispatcher, changing);
                            delayed.TrySetResult(bitmap); await Layout(dispatcher, changing);
                            var actions = ActionLists(changing).Single();
                            Require(actions.Items.Count == 1 && Title(actions.Items[0]) == "Updated" && ReferenceEquals(IconOf(actions.Items[0]), fresh),
                                "Previous presentation overwrote the latest row/icon.");
                            changing.ApplyProjection(projection with { Revision = 3, Features = [] }); await Layout(dispatcher, changing);
                            Require(actions.Items.Count == 0 && ((FrameworkElement)changing.FindName("TextContextRoot")).IsVisible
                                && ((FrameworkElement)changing.FindName("EmptyText")).IsVisible, "Zero matches lost selected-text presentation.");
                        }
                        finally { delayed.TrySetResult(bitmap); changing.Dismiss(); }
                    });
                    await Check("selected-text short, long and repeated presentations keep pinned Translation at the first action", async () =>
                    {
                        var translation = new NativeFeatureProjectionRowV2(
                            new("webtools.translation", "translate-text"), "翻译", "翻译", ["Translate", "Translation"],
                            [new("text", ["selected-text"])], "translate", "built-in", "plugin-features");
                        var other = Enumerable.Range(0, 24).Select(i => new NativeFeatureProjectionRowV2(
                            new("org.example.actions", "action-" + i), "Actions", $"Action {i:D2}", [],
                            [new("text", ["selected-text"])], "plugin", "runtime-v3", "plugin-features")).ToArray();
                        var fixtureStore = new SuperPanelStateStore(Path.Combine(root, "translation-pinned"));
                        fixtureStore.Save(SuperPanelState.Default with { Pinned = [translation.Ref] });
                        using var current = new SuperPanelWindow(fixtureStore, manager, _ => Task.FromResult<BitmapSource?>(bitmap),
                            projection with { Features = other.Append(translation).ToArray() });
                        var shortText = SelectionCapturePayloads.FromSelectedText("English short selection", false, null).Context;
                        current.Present(shortText, null); await Layout(dispatcher, current);
                        var actions = ActionLists(current).Single();
                        Require(actions.Items.Count == other.Length + 1 && Title(actions.Items[0]) == "翻译",
                            "Applicable built-in Translation was not pinned at the first action for short text.");
                        var longText = SelectionCapturePayloads.FromSelectedText(new string('x', 210), false, null).Context;
                        current.Present(longText, null); await Layout(dispatcher, current);
                        Require(actions.Items.Count == other.Length + 1 && Title(actions.Items[0]) == "翻译",
                            "Applicable built-in Translation disappeared when replacing a short selection with a long one.");
                        current.Present(longText, null); await Layout(dispatcher, current);
                        Require(actions.Items.Count == other.Length + 1 && Title(actions.Items[0]) == "翻译",
                            "Repeated selection of the same text lost the pinned Translation action.");
                        current.Present(SelectionContext.None(), null); await Layout(dispatcher, current);
                        Require(((FrameworkElement)current.FindName("BoardSurface")).IsVisible
                            && !((FrameworkElement)current.FindName("ContextSurface")).IsVisible,
                            "No-context presentation did not restore its shortcut board.");
                        current.Dismiss();
                    });
                    await Check("host search and link actions are integrated before projected selected-text features", async () =>
                    {
                        var translation = new NativeFeatureProjectionRowV2(
                            new("webtools.translation", "translate-text"), "翻译", "翻译", ["Translate", "Translation"],
                            [new("text", ["selected-text"])], "translate", "built-in", "plugin-features");
                        var snapshot = new WebsiteSnapshot([], [new("custom", "Custom", "https://search.example.test/?q=%s", true)],
                            "custom", false, "", false);
                        var starts = new List<ProcessStartInfo>();
                        using var current = new SuperPanelWindow(new SuperPanelStateStore(Path.Combine(root, "host-text-actions")), manager,
                            _ => Task.FromResult<BitmapSource?>(bitmap), projection with { Features = [translation] }, () => snapshot, starts.Add);

                        current.Present(SelectionCapturePayloads.FromSelectedText("ordinary selection", false, null).Context, null);
                        await Layout(dispatcher, current);
                        var actions = ActionLists(current).Single();
                        Require(actions.Items.Count == 2 && Title(actions.Items[0]) == "搜索选中文字" && Title(actions.Items[1]) == "翻译",
                            "Host search was not placed before projected text features.");
                        var first = actions.ItemContainerGenerator.ContainerFromIndex(0) as DependencyObject;
                        var searchButton = first is null ? null : Descendants(first).OfType<Button>().FirstOrDefault();
                        Require(searchButton is not null, "Host search action button was not realized.");
                        searchButton!.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                        await Layout(dispatcher, current);
                        Require(starts.Count == 1 && starts[0].UseShellExecute
                            && starts[0].FileName == "https://search.example.test/?q=ordinary%20selection" && !current.IsVisible,
                            "Host search did not use the live configured engine and dismiss the panel.");

                        current.Present(SelectionCapturePayloads.FromSelectedText("https://example.com/path", false, null).Context, null);
                        await Layout(dispatcher, current);
                        Require(actions.Items.Count == 3 && Title(actions.Items[0]) == "搜索选中文字"
                            && Title(actions.Items[1]) == "打开选中链接" && Title(actions.Items[2]) == "翻译",
                            "Validated URL did not add the host open-link action in deterministic order.");
                        current.Present(SelectionContext.None(), null); await Layout(dispatcher, current);
                        Require(actions.Items.Count == 0 && ((FrameworkElement)current.FindName("BoardSurface")).IsVisible,
                            "Host selected-text actions leaked into the no-context shortcut board.");
                        current.Dismiss();
                    });
                    await Check("plugin external-only completion dismisses its panel while Quick Result, failure and stale feedback preserve the current surface", async () =>
                    {
                        using var current = new SuperPanelWindow(new SuperPanelStateStore(Path.Combine(root, "plugin-command-lifecycle")), manager,
                            _ => Task.FromResult<BitmapSource?>(bitmap), projection);
                        var flags = BindingFlags.Instance | BindingFlags.NonPublic;
                        var requestField = typeof(SuperPanelWindow).GetField("_requestId", flags)!;
                        var slot = (SuperPanelQuickResultState)typeof(SuperPanelWindow).GetField("_quickResult", flags)!.GetValue(current)!;
                        var reference = features[0].Ref;
                        string BeginCommand()
                        {
                            var id = Guid.NewGuid().ToString("D"); requestField.SetValue(current, id);
                            slot.Begin(id, reference, (long)typeof(SuperPanelWindow).GetField("_visibleGeneration", flags)!.GetValue(current)!);
                            return id;
                        }
                        void Feedback(string id, string status, bool dismiss) =>
                            ((Delegate)typeof(ManagerController).GetField("FeatureInvocationFeedback", flags)!.GetValue(manager)!)
                                .DynamicInvoke(id, reference, status, dismiss);

                        current.Present(context, null); await Layout(dispatcher, current);
                        Feedback(BeginCommand(), "completed", true); await Layout(dispatcher, current);
                        Require(!current.IsVisible && slot.Binding is null && ((TextBlock)current.FindName("TextPreview")).Text.Length == 0,
                            "Successful external-only completion retained its panel or selection.");
                        foreach (var status in new[] { "completed", "failed", "cancelled" })
                        {
                            current.Present(context, null); await Layout(dispatcher, current);
                            Feedback(BeginCommand(), status, false); await Layout(dispatcher, current);
                            Require(current.IsVisible, "Void/failure/cancellation unexpectedly dismissed the panel.");
                        }
                        current.Present(context, null); await Layout(dispatcher, current);
                        var resultId = BeginCommand();
                        var output = new NativeFeatureTextResult(1, resultId, reference, "Synthetic inline result");
                        Require(slot.TryAccept(output), "Could not prepare accepted Quick Result.");
                        Feedback(resultId, "completed", true); await Layout(dispatcher, current);
                        Require(current.IsVisible && slot.Result == output, "Accepted Quick Result lost to external-open completion.");

                        current.Present(context, null); await Layout(dispatcher, current);
                        var oldId = BeginCommand();
                        Feedback(oldId, "completed", true);
                        current.Present(SelectionContext.None(), null); await Layout(dispatcher, current);
                        Require(current.IsVisible && ((FrameworkElement)current.FindName("BoardSurface")).IsVisible,
                            "Queued completion from an older invocation dismissed the replacement board.");
                        current.Dismiss(); current.Present(context, null); await Layout(dispatcher, current);
                        Feedback(oldId, "completed", true); await Layout(dispatcher, current);
                        Require(current.IsVisible, "Old completion dismissed a newly opened context panel.");
                        current.Present(SelectionContext.None(), null); await Layout(dispatcher, current);
                        Feedback(BeginCommand(), "completed", true); await Layout(dispatcher, current);
                        Require(!current.IsVisible, "External-only command from the shortcut board did not dismiss.");
                    });
                    await Check("new selected-text presentation and live projection refresh reset the action viewport to Translation", async () =>
                    {
                        var translation = new NativeFeatureProjectionRowV2(
                            new("webtools.translation", "translate-text"), "翻译", "翻译", ["Translate", "Translation"],
                            [new("text", ["selected-text"])], "translate", "built-in", "plugin-features");
                        var other = Enumerable.Range(0, 24).Select(i => new NativeFeatureProjectionRowV2(
                            new("org.example.actions", "action-" + i), "Actions", $"Action {i:D2}", [],
                            [new("text", ["selected-text"])], "plugin", "runtime-v3", "plugin-features")).ToArray();
                        var fixtureStore = new SuperPanelStateStore(Path.Combine(root, "translation-scroll"));
                        fixtureStore.Save(SuperPanelState.Default with { Pinned = [translation.Ref] });
                        var rows = other.Append(translation).ToArray();
                        using var current = new SuperPanelWindow(fixtureStore, manager, _ => Task.FromResult<BitmapSource?>(bitmap),
                            projection with { Features = rows });
                        var selection = SelectionCapturePayloads.FromSelectedText("same selected text", false, null).Context;
                        current.Present(selection, null); await Layout(dispatcher, current);
                        var actions = ActionLists(current).Single();
                        var scroll = Descendants(actions).OfType<ScrollViewer>().Single();
                        bool FirstActionAtTop()
                        {
                            if (actions.ItemContainerGenerator.ContainerFromIndex(0) is not FrameworkElement first) return false;
                            var top = first.TransformToAncestor(scroll).Transform(new Point(0, 0)).Y;
                            return scroll.VerticalOffset <= 2.1 && top >= -1 && top + first.ActualHeight <= scroll.ViewportHeight + 1;
                        }
                        scroll.ScrollToEnd(); await Layout(dispatcher, current);
                        Require(scroll.VerticalOffset > 0, "Fixture did not scroll the long action list.");
                        current.Present(SelectionCapturePayloads.FromSelectedText(new string('y', 210), false, null).Context, null);
                        await Layout(dispatcher, current);
                        Require(FirstActionAtTop() && Title(actions.Items[0]) == "翻译",
                            $"New selected-text context did not return the first action to the viewport top (offset={scroll.VerticalOffset:F1}).");
                        scroll.ScrollToEnd(); await Layout(dispatcher, current);
                        current.ApplyProjection(projection with
                        {
                            Revision = projection.Revision + 1,
                            Features = rows.Select(row => row.Ref == translation.Ref ? row with { Title = "翻译" } : row with { Title = row.Title + " updated" }).ToArray(),
                        });
                        await Layout(dispatcher, current);
                        Require(FirstActionAtTop() && Title(actions.Items[0]) == "翻译",
                            "Live feature projection refresh did not return the first action to the viewport top.");
                        current.Dismiss();
                    });
                    await Check("short work area keeps the first selected-text action fully inside the scroll viewport", async () =>
                    {
                        var translation = new NativeFeatureProjectionRowV2(
                            new("webtools.translation", "translate-text"), "翻译", "翻译", ["Translate", "Translation"],
                            [new("text", ["selected-text"])], "translate", "built-in", "plugin-features");
                        var fixtureStore = new SuperPanelStateStore(Path.Combine(root, "translation-short-screen"));
                        fixtureStore.Save(SuperPanelState.Default with { Pinned = [translation.Ref] });
                        using var current = new SuperPanelWindow(fixtureStore, manager, _ => Task.FromResult<BitmapSource?>(bitmap),
                            projection with { Features = [translation] });
                        var anchor = new MonitorPlacement.FloatingPanelAnchor(400, 100, 0, 0, 1000, 220, 1, 1);
                        current.Present(SelectionCapturePayloads.FromSelectedText(new string('z', 210), false, null).Context, null, anchor);
                        await Layout(dispatcher, current);
                        var actions = ActionLists(current).Single();
                        var scroll = Descendants(actions).OfType<ScrollViewer>().Single();
                        var first = actions.ItemContainerGenerator.ContainerFromIndex(0) as FrameworkElement;
                        Require(current.ActualHeight <= anchor.MaxHeight && scroll.ViewportHeight >= 38
                            && first is not null && first.ActualHeight <= scroll.ViewportHeight,
                            $"First action was clipped on short work area (panel={current.ActualHeight:F0}/{anchor.MaxHeight:F0}, root={((FrameworkElement)current.FindName("PanelRoot")).ActualHeight:F0}, context={((FrameworkElement)current.FindName("TextContextRoot")).ActualHeight:F0}, preview={((TextBlock)current.FindName("TextPreview")).ActualHeight:F0}/{((TextBlock)current.FindName("TextPreview")).MaxHeight:F0}, action={((FrameworkElement)current.FindName("ActionSurface")).ActualHeight:F0}/{((FrameworkElement)current.FindName("ActionSurface")).MaxHeight:F0}, viewport={scroll.ViewportHeight:F0}, row={first?.ActualHeight:F0}).");
                        current.Dismiss();
                    });
                }
                catch (Exception error) { total++; failed++; Console.WriteLine("FAIL presentation fixture: " + error); }
                finally { done.TrySetResult((total, failed)); dispatcher.BeginInvokeShutdown(DispatcherPriority.Background); }
            }));
            Dispatcher.Run();
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
        return done.Task.WaitAsync(TimeSpan.FromSeconds(30));
    }

    private static async Task Layout(Dispatcher dispatcher, Window window)
    {
        window.UpdateLayout();
        for (var i = 0; i < 4; i++) await dispatcher.InvokeAsync(() => window.UpdateLayout(), DispatcherPriority.ContextIdle);
    }
    private static ListBox[] ActionLists(Window window) => new[] { "ActionList", "PinnedList", "RecommendedList" }
        .Select(window.FindName).OfType<ListBox>().ToArray();
    private static string? Title(object row) => (string?)row.GetType().GetProperty("Title")!.GetValue(row);
    private static object? IconOf(object row) => row.GetType().GetProperty("Icon")!.GetValue(row);
    private static IEnumerable<DependencyObject> Descendants(DependencyObject parent)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        { var child = VisualTreeHelper.GetChild(parent, i); yield return child; foreach (var item in Descendants(child)) yield return item; }
    }
    private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect bounds);
}
