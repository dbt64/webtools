using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;
using WebTools.NativeHost.SuperPanel;

namespace WebTools.NativeHost.Checks;

internal static class Phase6G3TranslationPreviewChecks
{
    internal static Task<int> RunAsync()
    {
        var done = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            var dispatcher = Dispatcher.CurrentDispatcher;
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(dispatcher));
            dispatcher.BeginInvoke(new Action(async () =>
            {
                var count = 0;
                void Check(bool value, string name) { if (!value) throw new InvalidOperationException(name); count++; }
                try
                {
                    foreach (var text in new[] { "capability", "Hello world!", "getUserName", "selected_text", "It’s fine — really.", new string('a', 3000) })
                        Check(SuperPanelTranslationPreview.IsCandidate(text), "English candidate");
                    foreach (var text in new[] { "", " \t", "123456", "中文", "hello 中文", "Hello 🙂", "https://example.com", "user@example.com", "<script>", "a\0", "\ud800", new string('a', 3001) })
                        Check(!SuperPanelTranslationPreview.IsCandidate(text), "non-candidate");
                    using var old = JsonDocument.Parse("{\"enabled\":true,\"mouseButton\":\"middle\",\"gesture\":\"hold\",\"holdMilliseconds\":600}");
                    Check(!SuperPanelSettings.Parse(old.RootElement).AutoTranslationPreview, "old preferences do not opt in");
                    var root = Path.Combine(Path.GetTempPath(), "g3-preview-" + Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(root);
                    await File.WriteAllTextAsync(Path.Combine(root, "super-panel-state.json"), "{\"schemaVersion\":2,\"enabled\":true,\"mouseButton\":\"middle\",\"gesture\":\"hold\",\"holdMilliseconds\":600,\"pinned\":[]}");
                    var store = new SuperPanelStateStore(root); store.Load();
                    Check(!store.Snapshot.AutoTranslationPreview, "old persisted state stays opted out");
                    var diagnostics = new DiagnosticsService(System.Diagnostics.Stopwatch.GetTimestamp());
                    var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
                    await using var pipe = new NativeManagerPipeServer("WebTools.Checks." + Guid.NewGuid().ToString("N"), state,
                        _ => Task.FromResult(state.Snapshot), _ => Task.FromResult(state.Snapshot), (_, _) => Task.FromResult(state.Snapshot), diagnostics);
                    using var manager = new ManagerController(pipe, new ManagerProcessLauncher(false, root), diagnostics, _ => throw new InvalidOperationException("Unexpected dialog"));
                    var row = new NativeFeatureProjectionRowV2(SuperPanelTranslationPreview.Reference, "翻译", "翻译", ["Translate"],
                        [new("text", ["selected-text"])], "plugin", "built-in", "plugin-features");
                    var projection = new NativeFeatureProjectionV2(2, Guid.NewGuid().ToString(), 1, 1, [row]);
                    var requests = new List<string>(); var translationHandoffs = new List<string>();
                    var featureInvocations = new List<(NativeFeatureRef Reference, NativeLauncherTextContext? Context, bool QuickResult)>();
                    var focusCurrent = true; var failPreviewStart = false;
                    using var window = new SuperPanelWindow(store, manager, _ => Task.FromResult<System.Windows.Media.Imaging.BitmapSource?>(null), projection,
                        readWebsiteSnapshot: WebsiteDataLoader.Empty,
                        beginTranslationPreview: (id, context) => { requests.Add(id); return failPreviewStart ? null : id; }, capturePreviewFocus: () => () => focusCurrent,
                        invokeSuperPanelFeature: (reference, context, quick) =>
                        {
                            featureInvocations.Add((reference, context, quick));
                            return Guid.NewGuid().ToString("D");
                        },
                        openTranslation: text => translationHandoffs.Add(text));
                    SelectionContext Selected(string text, long? capturedAtUnixMs = null) => new(
                        new("text", "selected-text", text, capturedAtUnixMs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()), "fixture");
                    var receive = typeof(SuperPanelWindow).GetMethod("ReceiveQuickResult", BindingFlags.Instance | BindingFlags.NonPublic)!;
                    var feedback = typeof(SuperPanelWindow).GetMethod("InvocationFeedback", BindingFlags.Instance | BindingFlags.NonPublic)!;
                    bool Deliver(string id, string text) => (bool)receive.Invoke(window, [new NativeFeatureTextResult(1, id, row.Ref, text)])!;
                    async Task Layout() { await dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle); window.UpdateLayout(); }
                    window.Present(Selected("capability"), null); await Layout();
                    Check(requests.Count == 0, "default disabled makes no request");
                    store.Save(store.Snapshot with { AutoTranslationPreview = true });
                    window.Present(SelectionCapturePayloads.FromSelectedText(new string('a', 3000), true, null).Context, null); await Layout();
                    Check(requests.Count == 0, "truncated capture is never automatically sent");
                    foreach (var text in new[] { "中文", "hello 中文", "https://example.com" }) window.Present(Selected(text), null);
                    window.Present(SelectionContext.None(), null); await Layout();
                    Check(requests.Count == 0, "no selection / rejected content makes no request");
                    window.Present(Selected("capability"), null); await Layout();
                    var first = requests.Single();
                    Check(((FrameworkElement)window.FindName("QuickResultSurface")).IsVisible, "loading is in same panel");
                    Check(((System.Windows.Controls.ListBox)window.FindName("ActionList")).Items.Count == 2, "search and Translation actions coexist");
                    window.ApplyProjection(projection); await Layout();
                    Check(requests.Count == 1, "projection refresh never repeats preview");
                    Check(Deliver(first, "MyMemory 免费翻译\n\n寻找"), "current result accepted"); await Layout();
                    Check(((TextBlock)window.FindName("QuickResultBody")).Text.EndsWith("寻找"), "translation displayed without character conversion");
                    Check(((FrameworkElement)window.FindName("ActionList")).IsVisible, "actions remain after result");
                    var resultBody = (TextBlock)window.FindName("QuickResultBody");
                    var chineseRuns = GlyphRuns(VisualTreeHelper.GetDrawing(resultBody))
                        .Where(run => run.Characters?.Any(c => c is >= '\u4e00' and <= '\u9fff') == true).ToArray();
                    Check(chineseRuns.Length > 0 && chineseRuns.All(run => run.GlyphTypeface.FamilyNames.Values
                            .Any(name => name.Contains("YaHei", StringComparison.OrdinalIgnoreCase))),
                        "Simplified Chinese uses the intended Chinese font instead of mixed Japanese/Traditional fallbacks");
                    var translationRow = (FrameworkElement)((ListBox)window.FindName("ActionList")).ItemContainerGenerator.ContainerFromIndex(1)!;
                    var translationBottom = translationRow.TranslatePoint(new System.Windows.Point(0, translationRow.ActualHeight), window).Y;
                    Check(translationRow.IsVisible && translationBottom <= window.ActualHeight - 12,
                        $"completed preview retains the full Translation action: bottom={translationBottom}, panel={window.ActualHeight}, rows={((FrameworkElement)window.FindName("ActionSurface")).ActualHeight}");
                    window.Present(Selected("capability"), null); await Layout();
                    var pendingMouseDownButton = FindVisualChild<Button>((DependencyObject)((ListBox)window.FindName("ActionList")).ItemContainerGenerator.ContainerFromIndex(1)!);
                    Check(pendingMouseDownButton is not null, "Translation action has a real WPF button");
                    var pendingPreviewSurface = (FrameworkElement)window.FindName("QuickResultSurface");
                    Check(pendingPreviewSurface.IsVisible, "auto preview is pending before action click");
                    Check(pendingMouseDownButton!.TranslatePoint(new System.Windows.Point(0, pendingMouseDownButton.ActualHeight), window).Y <= window.ActualHeight - 12,
                        "pending preview keeps the full Translation action visible");
                    var pendingTranslationRequest = requests.Last();
                    pendingMouseDownButton!.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                    { RoutedEvent = Mouse.PreviewMouseDownEvent });
                    Check(translationHandoffs.SequenceEqual(["capability"]) && !window.IsVisible,
                        "the first physical press on pending Translation immediately cancels preview and opens Manager");
                    Check(!Deliver(pendingTranslationRequest, "请求期间返回的预览"),
                        "first press revokes the pending preview before a late result can replace the Manager handoff");
                    Check(featureInvocations.Count == 0, "pending explicit Translation press never invokes the panel quick-result route");
                    await Layout();
                    Check(((TextBlock)window.FindName("StatusText")).Text != "自动翻译预览已取消。",
                        "window mouse-up cancellation cannot overwrite the first-press Manager route");
                    window.Present(Selected("capability"), null); await Layout();
                    var completedPreviewRequest = requests.Last();
                    Check(Deliver(completedPreviewRequest, "已就绪的预览"), "completed preview is accepted before explicit Translation click"); await Layout();
                    var completedMouseDownButton = FindVisualChild<Button>((DependencyObject)((ListBox)window.FindName("ActionList")).ItemContainerGenerator.ContainerFromIndex(1)!);
                    Check(completedMouseDownButton is not null, "completed preview retains a real Translation button");
                    Check(pendingPreviewSurface.IsVisible, "completed preview remains visible before the explicit action press");
                    completedMouseDownButton!.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                    { RoutedEvent = Mouse.PreviewMouseDownEvent });
                    Check(translationHandoffs.SequenceEqual(["capability", "capability"]) && featureInvocations.Count == 0,
                        "first physical press on completed Translation sends the original text once through Manager");
                    Check(!window.IsVisible, "completed preview Translation press dismisses the Super Panel");
                    const string staleSelection = "captured before the preview finished";
                    window.Present(Selected(staleSelection, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 31000), null); await Layout();
                    var stalePreviewRequest = requests.Last();
                    var staleTranslationButton = FindVisualChild<Button>((DependencyObject)((ListBox)window.FindName("ActionList")).ItemContainerGenerator.ContainerFromIndex(1)!);
                    staleTranslationButton!.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                    { RoutedEvent = Mouse.PreviewMouseDownEvent });
                    Check(translationHandoffs.SequenceEqual(["capability", "capability", staleSelection]),
                        "first press on a pending preview past the Feature age still opens Manager with the captured selection");
                    Check(!window.IsVisible && !Deliver(stalePreviewRequest, "late stale preview"),
                        "stale pending preview is revoked after the Manager handoff");
                    failPreviewStart = true;
                    window.Present(Selected("no preview result"), null); await Layout();
                    failPreviewStart = false;
                    Check(((TextBlock)window.FindName("StatusText")).Text.Contains("暂不可用", StringComparison.Ordinal),
                        "failed automatic preview leaves the explicit Translation action available");
                    var failedTranslationButton = FindVisualChild<Button>((DependencyObject)((ListBox)window.FindName("ActionList")).ItemContainerGenerator.ContainerFromIndex(1)!);
                    var failedPreviewRequest = requests.Last();
                    failedTranslationButton!.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                    { RoutedEvent = Mouse.PreviewMouseDownEvent });
                    Check(translationHandoffs.SequenceEqual(["capability", "capability", staleSelection, "no preview result"]),
                        "first press after a failed preview still opens Manager exactly once with the selection");
                    Check(!Deliver(failedPreviewRequest, "late failed preview"), "failed preview request cannot publish after explicit Manager handoff");
                    const string noResultSelection = "preview returned no result";
                    window.Present(Selected(noResultSelection), null); await Layout();
                    var noResultRequest = requests.Last();
                    feedback.Invoke(window, [noResultRequest, row.Ref, "completed", false]); await Layout();
                    Check(((TextBlock)window.FindName("StatusText")).Text.Contains("未返回快速结果", StringComparison.Ordinal),
                        "completed preview with no result keeps the explicit Translation action available");
                    var noResultTranslationButton = FindVisualChild<Button>((DependencyObject)((ListBox)window.FindName("ActionList")).ItemContainerGenerator.ContainerFromIndex(1)!);
                    noResultTranslationButton!.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                    { RoutedEvent = Mouse.PreviewMouseDownEvent });
                    Check(translationHandoffs.SequenceEqual(["capability", "capability", staleSelection, "no preview result", noResultSelection]),
                        "first press after a completed preview with no quick result opens Manager exactly once with the original selection");
                    Check(!Deliver(noResultRequest, "late no-result preview"), "no-result preview cannot publish after explicit Manager handoff");
                    window.Present(Selected("capability"), null); await Layout();
                    var ordinaryPendingRequest = requests.Last();
                    var actionList = (ListBox)window.FindName("ActionList");
                    actionList.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                    { RoutedEvent = Mouse.PreviewMouseDownEvent });
                    await Layout();
                    Check(pendingPreviewSurface.IsVisible, "ordinary interaction keeps preview stable until mouse-up");
                    actionList.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
                    { RoutedEvent = Mouse.MouseUpEvent });
                    await Layout();
                    Check(!pendingPreviewSurface.IsVisible && ((TextBlock)window.FindName("StatusText")).Text == "自动翻译预览已取消。",
                        "ordinary mouse-up cancels a pending preview after routed input");
                    Check(!Deliver(ordinaryPendingRequest, "AFTER INPUT"), "ordinary interaction rejects the late preview result");
                    window.Present(Selected("capability"), null); await Layout();
                    var second = requests.Last();
                    Check(!Deliver(first, "OLD"), "new capture rejects old result");
                    window.CancelAutomaticTranslationForInput();
                    Check(!Deliver(second, "LATE"), "input rejects late result");
                    window.Present(Selected("hello world"), null); await Layout();
                    focusCurrent = false;
                    Check(!Deliver(requests.Last(), "WRONG FOCUS"), "foreground change rejects late result"); await Layout();
                    focusCurrent = true; window.Present(Selected("hello world"), null); await Layout();
                    var closing = requests.Last(); window.Dismiss();
                    Check(!Deliver(closing, "CLOSED"), "closed panel rejects result");
                    var shortAnchor = new MonitorPlacement.FloatingPanelAnchor(400, 100, 0, 0, 1000, 220, 1, 1);
                    window.Present(Selected(new string('a', 210)), null, shortAnchor); await Layout();
                    Check(Deliver(requests.Last(), string.Join('\n', Enumerable.Repeat("long translated result", 100))), "long result accepted"); await Layout();
                    var action = (FrameworkElement)window.FindName("ActionSurface");
                    var list = (System.Windows.Controls.ListBox)window.FindName("ActionList");
                    var firstAction = (FrameworkElement?)list.ItemContainerGenerator.ContainerFromIndex(0);
                    Check(window.ActualHeight <= shortAnchor.MaxHeight && action.ActualHeight >= 38 && firstAction is not null
                        && firstAction.TranslatePoint(new System.Windows.Point(), action).Y >= -1
                        && firstAction.TranslatePoint(new System.Windows.Point(), action).Y + firstAction.ActualHeight <= action.ActualHeight + 1,
                        $"long preview clipped first action: panel={window.ActualHeight}, action={action.ActualHeight}");
                    list.ScrollIntoView(list.Items[1]); await Layout();
                    var scrolledTranslation = (FrameworkElement?)list.ItemContainerGenerator.ContainerFromIndex(1);
                    Check(scrolledTranslation is not null && scrolledTranslation.TranslatePoint(new System.Windows.Point(), action).Y >= -1
                        && scrolledTranslation.TranslatePoint(new System.Windows.Point(0, scrolledTranslation.ActualHeight), action).Y <= action.ActualHeight + 1
                        && scrolledTranslation.TranslatePoint(new System.Windows.Point(0, scrolledTranslation.ActualHeight), window).Y <= window.ActualHeight - 12,
                        "Translation remains reachable by scrolling a short work-area action viewport");
                    window.Present(Selected("hello world"), null); await Layout();
                    var settings = requests.Last(); store.Save(store.Snapshot with { AutoTranslationPreview = false }); window.RefreshTriggerStatus();
                    Check(!Deliver(settings, "DISABLED"), "disabled setting revokes pending preview");
                    window.Dismiss();
                    Console.WriteLine($"Translation Preview Checks: {count}/{count} PASS"); done.SetResult(0);
                }
                catch (Exception error) { Console.Error.WriteLine(error); done.SetResult(1); }
                finally { dispatcher.BeginInvokeShutdown(DispatcherPriority.Background); }
            }));
            Dispatcher.Run();
        });
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); return done.Task;
    }

    private static IEnumerable<GlyphRun> GlyphRuns(Drawing? drawing)
    {
        if (drawing is GlyphRunDrawing glyph) yield return glyph.GlyphRun;
        else if (drawing is DrawingGroup group)
            foreach (var child in group.Children)
                foreach (var run in GlyphRuns(child)) yield return run;
    }

    private static T? FindVisualChild<T>(DependencyObject parent) where T : DependencyObject
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(parent); index++)
        {
            var child = VisualTreeHelper.GetChild(parent, index);
            if (child is T match) return match;
            if (FindVisualChild<T>(child) is { } nested) return nested;
        }
        return null;
    }
}
