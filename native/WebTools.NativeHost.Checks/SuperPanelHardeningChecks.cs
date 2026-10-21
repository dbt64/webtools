using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using WebTools.NativeHost.Services;
using WebTools.NativeHost.SuperPanel;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Interop;
using System.Windows.Threading;

namespace WebTools.NativeHost.Checks;

internal static class SuperPanelHardeningChecks
{
    internal static async Task<int> RunAsync(string[] args)
    {
        if (args.Contains("--presentation-only", StringComparer.Ordinal))
        {
            var result = await SuperPanelPresentationChecks.RunAsync();
            Console.WriteLine($"Super Panel presentation: {result.Total - result.Failed}/{result.Total}");
            return result.Failed == 0 ? 0 : 1;
        }
        if (args[0] == "--super-panel-prepare-profile")
        {
            if (args.Length != 2) return 2;
            var root = Path.GetFullPath(args[1]); var temp = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
            if (!root.StartsWith(temp + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(root)) return 2;
            for (var path = root; path.Length > temp.Length; path = Path.GetDirectoryName(path)!)
                if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) return 2;
            var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
            await state.UpdateAsync(s => s with { LaunchOnStartup = false, EverythingEnabled = false });
            await new WebTools.NativeHost.Catalog.AppCatalogSnapshotStore(Path.Combine(root, "catalog.json")).SaveIfChangedAsync([]);
            new SuperPanelStateStore(root).Save(SuperPanelState.Default with { MouseButton = "xbutton2", Gesture = "press" });
            Console.WriteLine("ISOLATED_PROFILE_PREPARED"); return 0;
        }
        if (args[0] == "--super-panel-capture-probe") return await ProbeAsync(args);
        if (args[0] == "--super-panel-no-context-regression")
        {
            var result = await RunWindowChecksAsync(noContextOnly: true);
            Console.WriteLine($"Super Panel no-context regression: {result.Total - result.Failed}/{result.Total}");
            return result.Failed == 0 ? 0 : 1;
        }
        var failures = 0; var total = 0;
        void Check(string name, Action action)
        {
            total++;
            try { action(); Console.WriteLine("PASS " + name); }
            catch (Exception error) { failures++; Console.WriteLine("FAIL " + name + ": " + error.GetType().Name); }
        }
        Check("no-update Copy transaction retains its full bounded cleanup budget", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1);
            var watch = Stopwatch.StartNew();
            var changed = CopyTextCaptureProvider.WaitForCopyResponse(invocation, 0, () => 0, invocation.Token.ThrowIfCancellationRequested);
            Console.WriteLine($"COPY_NO_UPDATE elapsedMs={watch.Elapsed.TotalMilliseconds:F0} remainingMs={invocation.Remaining.TotalMilliseconds:F0}");
            if (changed || watch.ElapsedMilliseconds < 600 || watch.ElapsedMilliseconds > 1200
                || invocation.Remaining != TimeSpan.Zero || invocation.Token.IsCancellationRequested)
                throw new InvalidOperationException("UI fallback prematurely ended the Copy transaction.");
        });
        Check("first copy from sequence zero keeps the remaining read and restoration budget", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1);
            var watch = Stopwatch.StartNew();
            var changed = CopyTextCaptureProvider.WaitForCopyResponse(invocation, 0,
                () => watch.ElapsedMilliseconds >= 30 ? 1u : 0u, invocation.Token.ThrowIfCancellationRequested);
            if (!changed || invocation.Remaining.TotalMilliseconds < 400 || invocation.CopyResultObserved)
                throw new InvalidOperationException("A sequence change must still pass owner/content validation.");
        });
        Check("slow Copy after the UI checkpoint remains observable within the invocation budget", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1);
            var watch = Stopwatch.StartNew();
            if (!CopyTextCaptureProvider.WaitForCopyResponse(invocation, 5,
                () => watch.ElapsedMilliseconds >= 300 ? 6u : 5u, invocation.Token.ThrowIfCancellationRequested)
                || invocation.Remaining == TimeSpan.Zero)
                throw new InvalidOperationException("Slow Copy was lost before read/restoration.");
        });
        Check("copy response wait honours cancellation before inspecting clipboard state", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1);
            var inspected = false;
            invocation.Cancel("outside-click");
            try
            {
                CopyTextCaptureProvider.WaitForCopyResponse(invocation, 0,
                    () => { inspected = true; return 1; }, invocation.Token.ThrowIfCancellationRequested);
            }
            catch (OperationCanceledException) when (!inspected) { return; }
            throw new InvalidOperationException("Cancelled capture inspected a result.");
        });
        Check("cancelled presentation still observes its late Copy for bounded restoration", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1); invocation.MarkCopyInjected(); invocation.Cancel("launcher");
            var clock = Stopwatch.StartNew(); var restored = 0;
            var result = CopyTextCaptureProvider.WaitForCopyCleanup(invocation, 0,
                () => clock.ElapsedMilliseconds >= 30 ? 1u : 0u,
                sequence => { restored++; return sequence == 1 ? "restored" : "wrong-sequence"; });
            if (result != "restored" || restored != 1 || invocation.TryAccept(SelectionCaptureOutcome.SelectedText))
                throw new InvalidOperationException("Late Copy cleanup admitted a cancelled presentation or missed its update.");
        });
        Check("new physical input prevents cancelled-Copy cleanup from touching a user's update", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1); invocation.Cancel("keyboard-input");
            var inspected = false;
            var result = CopyTextCaptureProvider.WaitForCopyCleanup(invocation, 0,
                () => { inspected = true; return 1; }, _ => throw new InvalidOperationException());
            if (result != "new-user-input" || inspected) throw new InvalidOperationException();
        });
        Check("cancelled Copy cleanup retries a busy clipboard only within its original deadline", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1, 40); invocation.Cancel("focus-changed");
            var attempts = 0;
            var result = CopyTextCaptureProvider.WaitForCopyCleanup(invocation, 3, () => 4, _ => { attempts++; return null; });
            if (result != "no-update-within-budget" || attempts < 1 || invocation.Remaining != TimeSpan.Zero)
                throw new InvalidOperationException();
        });
        Check("unverified clipboard owner ends cleanup without a restoration write", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1); invocation.Cancel("focus-changed");
            var attempts = 0;
            var result = CopyTextCaptureProvider.WaitForCopyCleanup(invocation, 1, () => 2, _ => { attempts++; return "owner-unverified"; });
            if (result != "owner-unverified" || attempts != 1) throw new InvalidOperationException();
        });
        Check("ownership diagnostics preserve safe relation but exclude content", () =>
        {
            var diagnostics = NewDiagnostics();
            var attempt = NewAttempt(diagnostics);
            attempt.Record("OWNER_VALIDATION", "REJECTED", "UIA_OWNER_PARENT_UNAVAILABLE",
                ("ownerScope", "range-enclosing"), ("ownerDepth", "3"), ("ownerTermination", "parent-unavailable"),
                ("selectedText", "PRIVATE_FIXTURE_CONTENT"), ("filePath", "PRIVATE_FIXTURE_PATH"));
            var value = Events(diagnostics).Single();
            if (value.Fields.GetValueOrDefault("ownerTermination") != "parent-unavailable"
                || value.Fields.GetValueOrDefault("ownerScope") != "range-enclosing"
                || value.Fields.ContainsKey("selectedText") || value.Fields.ContainsKey("filePath"))
                throw new InvalidOperationException();
        });
        Check("diagnostic candidate flood cannot remove terminal capture evidence", () =>
        {
            var diagnostics = NewDiagnostics(); var attempt = NewAttempt(diagnostics);
            for (var i = 0; i < 60; i++) attempt.Record("CANDIDATE", "CHECKED", ("candidatesInspected", i.ToString()));
            attempt.Record("CAPTURE_COMPLETED", "None", "UIA_SELECTION_EMPTY");
            if (!Events(diagnostics).Any(value => value.Stage == "CAPTURE_COMPLETED") || Events(diagnostics).Count > 48)
                throw new InvalidOperationException();
        });
        Check("focused text owner empty terminates discovery", () =>
        {
            if (!TextCandidateDecision.ShouldStop(SelectionCaptureOutcome.ConfirmedEmpty, true)) throw new InvalidOperationException();
        });
        Check("empty structural ancestor preserves discovery", () =>
        {
            if (TextCandidateDecision.ShouldStop(SelectionCaptureOutcome.ConfirmedEmpty, false)) throw new InvalidOperationException();
        });
        Check("missing provider permits discovery", () =>
        {
            if (TextCandidateDecision.ShouldStop(SelectionCaptureOutcome.ProviderMissing, true)) throw new InvalidOperationException();
        });
        Check("scoped caret authority requires a safe focus-related text owner", () =>
        {
            if (!TextCandidateDecision.CanUseScopedCaretAuthority(true, true, true, true, true)
                || TextCandidateDecision.CanUseScopedCaretAuthority(false, true, true, true, true)
                || TextCandidateDecision.CanUseScopedCaretAuthority(true, false, true, true, true)
                || TextCandidateDecision.CanUseScopedCaretAuthority(true, true, false, true, true)
                || TextCandidateDecision.CanUseScopedCaretAuthority(true, true, true, false, true)
                || TextCandidateDecision.CanUseScopedCaretAuthority(true, true, true, true, false)) throw new InvalidOperationException();
        });
        Check("selected text and direct safety rejection are terminal", () =>
        {
            if (!TextCandidateDecision.ShouldStop(SelectionCaptureOutcome.SelectedText, false)
                || !TextCandidateDecision.ShouldStop(SelectionCaptureOutcome.SafetyRejected, true)) throw new InvalidOperationException();
        });
        Check("cancelled invocation cannot accept even before deadline", () =>
        {
            using var invocation = CaptureInvocation.ForCheck(1);
            invocation.Cancel("dismiss");
            if (invocation.TryAccept(SelectionCaptureOutcome.SelectedText) || !invocation.Token.IsCancellationRequested) throw new InvalidOperationException();
        });
        Check("invocation accepts once and worker lease outlives owner", () =>
        {
            var invocation = CaptureInvocation.ForCheck(1);
            using var worker = invocation.RetainWorker();
            if (!invocation.TryAccept(SelectionCaptureOutcome.SelectedText) || invocation.TryAccept(SelectionCaptureOutcome.SelectedText)) throw new InvalidOperationException();
            invocation.Dispose(); invocation.Cancel("shutdown");
            if (!invocation.Token.IsCancellationRequested) throw new InvalidOperationException();
        });
        Check("Shell classifications and empty display metadata remain separate", () =>
        {
            var files = SelectionCapturePayloads.FromFilesystemItems(new SuperPanelFixtureItems(false, false), 2, null);
            var directories = SelectionCapturePayloads.FromFilesystemItems(new SuperPanelFixtureItems(true, true), 2, null);
            var mixed = SelectionCapturePayloads.FromFilesystemItems(new SuperPanelFixtureItems(true, false), 2, null);
            if (files.Context.Mode != SurfaceContextMode.SelectedFiles || directories.Context.Mode != SurfaceContextMode.SelectedDirectories
                || mixed.Context.Mode != SurfaceContextMode.SelectedFiles || mixed.Context.Payload?.Items?.Count != 2
                || SelectionContext.None().Mode != SurfaceContextMode.NoContext
                || new SelectionContext(null, "fixture") { ExplorerFolder = new("C:\\fixture", "fixture") }.Mode != SurfaceContextMode.ExplorerFolder)
                throw new InvalidOperationException();
        });
        Check("cancelled Shell item work is not read", () =>
        {
            using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
            try { SelectionCapturePayloads.FromFilesystemItems(new SuperPanelFixtureItems(false), 1, null, cancellation: cancellation.Token); }
            catch (OperationCanceledException) { return; }
            throw new InvalidOperationException();
        });
        total++;
        try
        {
            using var entered = new ManualResetEventSlim(); using var release = new ManualResetEventSlim();
            using var service = new SelectionCaptureService((invocation, _) =>
            {
                entered.Set(); release.Wait();
                return new(SelectionContext.None(), "TEST_LATE_RESULT");
            });
            using var invocation = CaptureInvocation.ForCheck(1, 30);
            var result = await service.CaptureAsync(invocation, null);
            if (!entered.IsSet || result.Outcome != SelectionCaptureOutcome.TimedOut || !invocation.Token.IsCancellationRequested
                || service.ActiveWorkerCount != 1) throw new InvalidOperationException();
            using var next = CaptureInvocation.ForCheck(2);
            var busy = await service.CaptureAsync(next, null);
            if (busy.ReasonCode != "CAPTURE_BUSY" || service.ActiveWorkerCount != 1) throw new InvalidOperationException();
            release.Set(); await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
            if (service.ActiveWorkerCount != 0 || result.ReasonCode != "CAPTURE_TIMEOUT") throw new InvalidOperationException();
            Console.WriteLine("PASS timeout cancels cooperatively and never creates replacement worker");
        }
        catch (Exception error) { failures++; Console.WriteLine("FAIL timeout and strict worker bound: " + error.GetType().Name); }
        var windowResults = await RunWindowChecksAsync(); total += windowResults.Total; failures += windowResults.Failed;
        var presentationResults = await SuperPanelPresentationChecks.RunAsync(); total += presentationResults.Total; failures += presentationResults.Failed;
        Console.WriteLine($"Super Panel hardening focused: {total - failures}/{total}");
        return failures == 0 ? 0 : 1;
    }

    private static async Task<int> ProbeAsync(string[] args)
    {
        if (args.Length != 4 || !long.TryParse(args[2], out var handle) || !int.TryParse(args[3], out var count)
            || count is < 1 or > 20) return 2;
        var root = Path.GetFullPath(args[1]);
        var temp = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
        if (!root.StartsWith(temp + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || !Directory.Exists(root)) return 2;
        for (var path = root; path.Length > temp.Length; path = Path.GetDirectoryName(path)!)
            if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) return 2;
        var service = new SelectionCaptureService();
        var samples = new List<object>();
        for (var i = 0; i < count; i++)
        {
            if (GetForegroundWindow().ToInt64() != handle) { Console.WriteLine("FOREGROUND_NOT_FIXTURE"); return 3; }
            var diagnostics = NewDiagnostics(); var attempt = NewAttempt(diagnostics);
            var clock = Stopwatch.StartNew();
            var result = await service.CaptureAsync(attempt);
            clock.Stop();
            samples.Add(new { index = i, mode = result.Context.Mode.ToString(), result.ReasonCode,
                result.TimedOut, result.WorkerRunning, captureMs = clock.Elapsed.TotalMilliseconds,
                characterCount = result.Context.Payload?.Text?.Length ?? 0,
                itemCount = result.Context.Payload?.Items?.Count ?? 0, events = Events(diagnostics) });
            await Task.Delay(80);
        }
        var output = Path.Combine(root, "capture-" + Guid.NewGuid().ToString("N") + ".json");
        await File.WriteAllTextAsync(output, JsonSerializer.Serialize(samples, new JsonSerializerOptions
            { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true }));
        Console.WriteLine(output);
        return 0;
    }

    private static Task<(int Total, int Failed)> RunWindowChecksAsync(bool noContextOnly = false)
    {
        var completion = new TaskCompletionSource<(int, int)>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            var dispatcher = Dispatcher.CurrentDispatcher;
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(dispatcher));
            dispatcher.BeginInvoke(new Action(async () =>
            {
                var total = 0; var failed = 0;
                var root = Path.Combine(Path.GetTempPath(), "WebTools-SuperPanel-Checks-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(root);
                var diagnostics = NewDiagnostics();
                var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
                await using var pipe = new NativeManagerPipeServer("WebTools.Checks." + Guid.NewGuid().ToString("N"), state,
                    _ => Task.FromResult(state.Snapshot), _ => Task.FromResult(state.Snapshot), (_, _) => Task.FromResult(state.Snapshot), diagnostics);
                using var manager = new ManagerController(pipe, new ManagerProcessLauncher(false, root), diagnostics, _ => throw new InvalidOperationException());
                using var window = new SuperPanelWindow(new SuperPanelStateStore(root), manager, _ => Task.FromResult<System.Windows.Media.Imaging.BitmapSource?>(null), null);
                async Task Check(string name, Func<Task> run)
                {
                    if (noContextOnly && !name.StartsWith("no-update fallback", StringComparison.Ordinal)) return;
                    total++;
                    try { await run(); Console.WriteLine("PASS " + name); }
                    catch (Exception error) { failed++; Console.WriteLine("FAIL " + name + ": " + error.Message); }
                }
                async Task DrainLayout()
                {
                    window.UpdateLayout();
                    for (var i = 0; i < 4; i++) await dispatcher.InvokeAsync(() => window.UpdateLayout(), DispatcherPriority.ContextIdle);
                }
                async Task WaitForBoard()
                {
                    var deadline = Stopwatch.StartNew();
                    while (((FrameworkElement)window.FindName("BoardSurface")).Visibility != Visibility.Visible
                        && deadline.ElapsedMilliseconds < 300) await Task.Delay(5);
                    await DrainLayout();
                    if (((FrameworkElement)window.FindName("BoardSurface")).Visibility != Visibility.Visible)
                        throw new InvalidOperationException("Board waited for capture instead of the first UI checkpoint.");
                }
                await Check("real compact header is shown immediately and board expands while capture is still running", async () =>
                {
                    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                    using var release = new ManualResetEventSlim(); var api = new FixtureHookApi();
                    using var service = new SelectionCaptureService((_, _) =>
                    {
                        entered.TrySetResult(); release.Wait();
                        return new(SelectionContext.None(), "SHELL_CONTEXT_UNAVAILABLE", Outcome: SelectionCaptureOutcome.ConfirmedEmpty);
                    });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        escapeFactory: cancel => new SuperPanelEscapeObserver(cancel, api));
                    Task? pending = null;
                    var compact = (FrameworkElement)window.FindName("PanelHeader");
                    var compactShown = false; double compactHeight = 0;
                    var clock = Stopwatch.StartNew();
                    System.Windows.Interop.HwndSource? source = null;
                    IntPtr ObserveShow(IntPtr handle, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
                    {
                        if (message == 0x0018 && wParam != IntPtr.Zero)
                        {
                            compactHeight = window.ActualHeight;
                            compactShown = compact.Visibility == Visibility.Visible
                                && ((FrameworkElement)window.FindName("BoardSurface")).Visibility == Visibility.Collapsed
                                && ((FrameworkElement)window.FindName("ContextSurface")).Visibility == Visibility.Collapsed
                                && window.Opacity == 0 && compactHeight <= 80;
                        }
                        return IntPtr.Zero;
                    }
                    void ObserveSource(object? sender, EventArgs args)
                    {
                        source = System.Windows.Interop.HwndSource.FromHwnd(new System.Windows.Interop.WindowInteropHelper(window).Handle);
                        source!.AddHook(ObserveShow);
                    }
                    window.SourceInitialized += ObserveSource;
                    try
                    {
                        pending = controller.ToggleAsync(NewAttempt(diagnostics));
                        await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
                        await DrainLayout();
                        if (!compactShown || !window.IsVisible)
                            throw new InvalidOperationException("Capture did not show the actual compact header alone.");
                        if (((TextBlock)window.FindName("PanelTitle")).Text != "WebTools")
                            throw new InvalidOperationException("Compact initial state is not actual panel content.");
                        var handle = new System.Windows.Interop.WindowInteropHelper(window).Handle;
                        await WaitForBoard();
                        Console.WriteLine($"COLD_INITIAL_BOARD elapsedMs={clock.Elapsed.TotalMilliseconds:F0} compactHeight={compactHeight:F0} workerActive={service.ActiveWorkerCount}");
                        if (pending.IsCompleted || service.ActiveWorkerCount != 1 || !controller.CapturePending
                            || new System.Windows.Interop.WindowInteropHelper(window).Handle != handle)
                            throw new InvalidOperationException("Board did not reuse the window independently of capture.");
                        release.Set(); await pending.WaitAsync(TimeSpan.FromSeconds(2));
                        await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
                        await DrainLayout();
                        if (compact.Visibility != Visibility.Visible
                            || ((FrameworkElement)window.FindName("BoardSurface")!).Visibility != Visibility.Visible
                            || window.ActualHeight < compactHeight + 80 || controller.CapturePending)
                            throw new InvalidOperationException("Accepted no-context result did not expand to the normal board.");
                    }
                    finally
                    {
                        release.Set();
                        if (pending is not null) await pending.WaitAsync(TimeSpan.FromSeconds(2));
                        await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
                        window.Dismiss();
                        window.SourceInitialized -= ObserveSource;
                        source?.RemoveHook(ObserveShow);
                    }
                });
                await Check("quick text result selects context without an intermediate expanded board", async () =>
                {
                    var api = new FixtureHookApi(); var attempt = NewAttempt(diagnostics);
                    using var service = new SelectionCaptureService((_, _) => SelectionCapturePayloads.FromSelectedText("Fast fixture", false, null));
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        escapeFactory: cancel => new SuperPanelEscapeObserver(cancel, api));
                    try
                    {
                        await controller.ToggleAsync(attempt); await DrainLayout();
                        if (!((FrameworkElement)window.FindName("TextContextRoot")).IsVisible
                            || Events(diagnostics).Any(e => e.AttemptId == attempt.AttemptId && e.Stage == "PRESENTATION_SELECTED"
                                && e.Fields.GetValueOrDefault("mode") == "NoContext"))
                            throw new InvalidOperationException("Quick text capture expanded the default board first.");
                    }
                    finally { window.Dismiss(); }
                });
                await Check("late text replaces an untouched board while reusing the same HWND", async () =>
                {
                    using var release = new ManualResetEventSlim(); var api = new FixtureHookApi();
                    using var service = new SelectionCaptureService((_, _) =>
                    { release.Wait(); return SelectionCapturePayloads.FromSelectedText("Slow fixture", false, null); });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        escapeFactory: cancel => new SuperPanelEscapeObserver(cancel, api));
                    Task? pending = null;
                    try
                    {
                        var clock = Stopwatch.StartNew();
                        pending = controller.ToggleAsync(NewAttempt(diagnostics));
                        var handle = new System.Windows.Interop.WindowInteropHelper(window).Handle;
                        await WaitForBoard();
                        Console.WriteLine($"WARM_INITIAL_BOARD elapsedMs={clock.Elapsed.TotalMilliseconds:F0} workerActive={service.ActiveWorkerCount}");
                        if (pending.IsCompleted) throw new InvalidOperationException("Copy transaction ended at the UI checkpoint.");
                        release.Set(); await pending; await DrainLayout();
                        if (!((FrameworkElement)window.FindName("TextContextRoot")).IsVisible
                            || ((TextBlock)window.FindName("TextPreview")).Text != "Slow fixture"
                            || new System.Windows.Interop.WindowInteropHelper(window).Handle != handle)
                            throw new InvalidOperationException("Valid late text did not replace the untouched board.");
                    }
                    finally { release.Set(); if (pending is not null) await pending; window.Dismiss(); }
                });
                await Check("panel interaction freezes presentation even when UI acceptance is delayed past the capture deadline", async () =>
                {
                    using var release = new ManualResetEventSlim(); var api = new FixtureHookApi(); var workerFinished = false;
                    using var service = new SelectionCaptureService((_, _) =>
                    { release.Wait(); workerFinished = true; return SelectionCapturePayloads.FromSelectedText("Discard this fixture", false, null); });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        escapeFactory: cancel => new SuperPanelEscapeObserver(cancel, api));
                    Task? pending = null;
                    try
                    {
                        pending = controller.ToggleAsync(NewAttempt(diagnostics)); await WaitForBoard();
                        var invocation = (CaptureInvocation)typeof(SuperPanelTriggerController).GetField("_pending", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller)!;
                        var add = (System.Windows.Controls.Button)window.FindName("AddShortcut");
                        add.RaiseEvent(new System.Windows.Input.MouseButtonEventArgs(System.Windows.Input.Mouse.PrimaryDevice, 0, System.Windows.Input.MouseButton.Left)
                        { RoutedEvent = UIElement.PreviewMouseDownEvent });
                        add.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
                        if (invocation.Token.IsCancellationRequested) throw new InvalidOperationException("Panel interaction cancelled clipboard cleanup.");
                        release.Set();
                        // Copy completes on its worker while the UI is busy. Its expired result
                        // must still not dismiss/replace the user's already selected picker.
                        Thread.Sleep(750);
                        await pending; await DrainLayout();
                        if (!workerFinished || !window.IsVisible || !((FrameworkElement)window.FindName("BoardChooser")).IsVisible
                            || ((FrameworkElement)window.FindName("TextContextRoot")).IsVisible || api.Active != 1)
                            throw new InvalidOperationException("Late text replaced the user's picker or removed its Escape observer.");
                    }
                    finally { release.Set(); if (pending is not null) await pending; window.Dismiss(); }
                });
                await Check("keyboard input after default expansion dismisses and rejects late text", async () =>
                {
                    using var release = new ManualResetEventSlim(); var api = new FixtureHookApi();
                    using var service = new SelectionCaptureService((_, _) =>
                    { release.Wait(); return SelectionCapturePayloads.FromSelectedText("Stale keyboard fixture", false, null); });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        escapeFactory: cancel => new SuperPanelEscapeObserver(cancel, api));
                    Task? pending = null;
                    try
                    {
                        pending = controller.ToggleAsync(NewAttempt(diagnostics)); await WaitForBoard();
                        if (api.Key(0x41) != new IntPtr(73)) throw new InvalidOperationException("Input was consumed.");
                        release.Set(); await pending; await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
                        if (window.IsVisible || controller.CapturePending || api.Active != 0)
                            throw new InvalidOperationException("Late text revived the dismissed keyboard session.");
                    }
                    finally { release.Set(); if (pending is not null) await pending; window.Dismiss(); }
                });
                await Check("dismiss and new tray generation reject the previous Copy without clearing the new board", async () =>
                {
                    using var release = new ManualResetEventSlim(); var api = new FixtureHookApi();
                    using var service = new SelectionCaptureService((_, _) =>
                    { release.Wait(); return SelectionCapturePayloads.FromSelectedText("Old generation fixture", false, null); });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        escapeFactory: cancel => new SuperPanelEscapeObserver(cancel, api));
                    Task? pending = null;
                    try
                    {
                        pending = controller.ToggleAsync(NewAttempt(diagnostics)); await WaitForBoard();
                        var handle = new System.Windows.Interop.WindowInteropHelper(window).Handle;
                        window.Dismiss(); controller.ShowFromTray();
                        release.Set(); await pending; await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2)); await DrainLayout();
                        if (!window.IsVisible || !((FrameworkElement)window.FindName("BoardSurface")).IsVisible
                            || ((TextBlock)window.FindName("TextPreview")).Text.Length != 0 || api.Active != 1
                            || new System.Windows.Interop.WindowInteropHelper(window).Handle != handle)
                            throw new InvalidOperationException("The retired invocation mutated the new generation.");
                    }
                    finally { release.Set(); if (pending is not null) await pending; window.Dismiss(); }
                });
                await Check("no-update fallback survives accepted timeout and keeps the WPF board visible", async () =>
                {
                    var api = new FixtureHookApi(); var notified = false;
                    using var service = new SelectionCaptureService((invocation, _) =>
                    {
                        // Exercise the real outer deadline/controller/presentation chain, without clipboard/input side effects.
                        invocation.MarkCopyInjected();
                        invocation.Token.WaitHandle.WaitOne();
                        invocation.Token.ThrowIfCancellationRequested();
                        throw new InvalidOperationException("The deadline must cancel this synthetic no-result operation.");
                    });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        escapeFactory: cancel => new SuperPanelEscapeObserver(cancel, api), notifyCaptureFailure: _ => notified = true);
                    try
                    {
                        var attempt = NewAttempt(diagnostics);
                        await controller.ToggleAsync(attempt).WaitAsync(TimeSpan.FromSeconds(3));
                        await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
                        await Task.Delay(150);
                        var snapshot = JsonSerializer.SerializeToElement(window.CaptureHardeningSnapshot());
                        Console.WriteLine($"NO_UPDATE_STATE visible={snapshot.GetProperty("visible").GetBoolean()} mode={snapshot.GetProperty("mode").GetString()} hooks={api.Active} notified={notified}");
                        if (!Events(diagnostics).Any(e => e.AttemptId == attempt.AttemptId && e.Stage == "PRESENTATION_SELECTED"))
                            throw new InvalidDataException("The real WPF presentation path was not reached.");
                        if (!snapshot.GetProperty("visible").GetBoolean() || snapshot.GetProperty("mode").GetString() != "NoContext"
                            || api.Active != 1 || notified || controller.CapturePending)
                            throw new InvalidOperationException("Accepted no-update fallback was immediately dismissed.");
                        if (api.Escape(0) != new IntPtr(73) || window.IsVisible || api.Active != 0)
                            throw new InvalidOperationException("The shown board must still dismiss on physical Escape and release its observer.");
                    }
                    finally { window.Dismiss(); }
                });
                await Check("Launcher takeover cancels pending controller and prevents late presentation", async () =>
                {
                    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                    using var release = new ManualResetEventSlim(); var presented = 0; var api = new FixtureHookApi();
                    using var service = new SelectionCaptureService((_, _) => { entered.TrySetResult(); release.Wait(); return new(SelectionContext.None(), "fixture"); });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        (_, _, _) => presented++, cancel => new SuperPanelEscapeObserver(cancel, api));
                    try
                    {
                        var pending = controller.ToggleAsync(NewAttempt(diagnostics)); await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
                        if (presented != 0 || !window.IsVisible || ((FrameworkElement)window.FindName("PanelHeader")!).Visibility != Visibility.Visible)
                            throw new InvalidOperationException("Capture must show the compact shell without presenting the final board early.");
                        controller.DismissForLauncher(); await pending.WaitAsync(TimeSpan.FromSeconds(2));
                        release.Set(); await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
                        if (presented != 0 || window.IsVisible || controller.CapturePending || api.Active != 0)
                            throw new InvalidOperationException("Launcher takeover must dismiss the compact shell and prevent late presentation.");
                    }
                    finally { release.Set(); }
                });
                await Check("physical Escape cancels pending without consuming input", async () =>
                {
                    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                    using var release = new ManualResetEventSlim(); var presented = 0; var api = new FixtureHookApi();
                    using var service = new SelectionCaptureService((_, _) => { entered.TrySetResult(); release.Wait(); return new(SelectionContext.None(), "fixture"); });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        (_, _, _) => presented++, cancel => new SuperPanelEscapeObserver(cancel, api));
                    try
                    {
                        var pending = controller.ToggleAsync(NewAttempt(diagnostics)); await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
                        if (presented != 0 || !window.IsVisible || ((FrameworkElement)window.FindName("PanelHeader")!).Visibility != Visibility.Visible)
                            throw new InvalidOperationException("Capture must show the compact shell without presenting the final board early.");
                        if (api.Escape(0x10) != new IntPtr(73) || !controller.CapturePending) throw new InvalidOperationException();
                        if (api.Escape(0) != new IntPtr(73)) throw new InvalidOperationException();
                        await pending.WaitAsync(TimeSpan.FromSeconds(2)); release.Set(); await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
                        if (presented != 0 || window.IsVisible || controller.CapturePending || api.Active != 0)
                            throw new InvalidOperationException("Escape must dismiss the compact shell and prevent late presentation.");
                    }
                    finally { release.Set(); }
                });
                await Check("presentation exception is contained and transient session cleared", async () =>
                {
                    var api = new FixtureHookApi(); using var service = new SelectionCaptureService((_, _) => new(SelectionContext.None(), "fixture"));
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        (_, _, _) => throw new InvalidOperationException("Synthetic fixture failure"), cancel => new SuperPanelEscapeObserver(cancel, api));
                    var attempt = NewAttempt(diagnostics); await controller.ToggleAsync(attempt);
                    if (controller.CapturePending || api.Active != 0 || !Events(diagnostics).Any(e => e.AttemptId == attempt.AttemptId && e.Stage == "PRESENTATION_FAILED"))
                        throw new InvalidOperationException();
                });
                await Check("pending outside click revokes before dispatcher cleanup", async () =>
                {
                    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                    using var release = new ManualResetEventSlim(); var api = new FixtureHookApi();
                    using var service = new SelectionCaptureService((_, _) => { entered.TrySetResult(); release.Wait(); return new(SelectionContext.None(), "fixture"); });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        (_, _, _) => { }, cancel => new SuperPanelEscapeObserver(cancel, api));
                    controller.Initialize(SuperPanelState.Default with { MouseButton = "xbutton2", Gesture = "press" });
                    try
                    {
                        var pending = controller.ToggleAsync(NewAttempt(diagnostics)); await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
                        var invocation = (CaptureInvocation)typeof(SuperPanelTriggerController).GetField("_pending", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller)!;
                        var mouse = typeof(SuperPanelTriggerController).GetField("_mouse", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller)!;
                        var pointer = (Delegate)typeof(MouseTriggerObserver).GetField("_pointerDown", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(mouse)!;
                        pointer.DynamicInvoke(0, 0, "left");
                        if (!invocation.Token.IsCancellationRequested) throw new InvalidOperationException();
                        release.Set(); await pending; await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
                    }
                    finally { release.Set(); }
                });
                await Check("focus changed after default expansion cannot present late context", async () =>
                {
                    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                    using var release = new ManualResetEventSlim(); var api = new FixtureHookApi(); var presented = 0;
                    using var service = new SelectionCaptureService((_, _) => { entered.TrySetResult(); release.Wait(); return SelectionCapturePayloads.FromSelectedText("Synthetic fixture", false, null); });
                    using var controller = new SuperPanelTriggerController(window, diagnostics, () => { }, () => { }, service,
                        (context, attempt, anchor) => { if (context.Mode != SurfaceContextMode.NoContext) presented++; window.Present(context, attempt, anchor); },
                        cancel => new SuperPanelEscapeObserver(cancel, api));
                    var alternate = new System.Windows.Window { Title = "Synthetic focus fixture", Width = 200, Height = 100 };
                    try
                    {
                        var pending = controller.ToggleAsync(NewAttempt(diagnostics)); await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
                        await WaitForBoard();
                        if (presented != 0 || !window.IsVisible || ((FrameworkElement)window.FindName("PanelHeader")!).Visibility != Visibility.Visible)
                            throw new InvalidOperationException("Capture must show the compact shell without presenting the final board early.");
                        alternate.Show(); alternate.Activate();
                        var invocation = (CaptureInvocation)typeof(SuperPanelTriggerController).GetField("_pending", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller)!;
                        if (invocation.IsNativeFocusCurrent()) throw new InvalidDataException("Fixture focus did not change");
                        Console.WriteLine("FOCUS_FIXTURE_CHANGED_CONFIRMED");
                        release.Set(); await pending; await service.WorkerCompletion.WaitAsync(TimeSpan.FromSeconds(2));
                        if (presented != 0 || window.IsVisible) throw new InvalidOperationException("Focus change must dismiss the compact shell and prevent presentation of the captured context.");
                    }
                    finally { release.Set(); alternate.Close(); }
                });
                await Check("repeated WPF presentations reuse HWND and clear selected context", () =>
                {
                    long handle = 0;
                    for (var i = 0; i < 30; i++)
                    {
                        var context = i % 2 == 0 ? SelectionContext.None() : SelectionCapturePayloads.FromSelectedText("Synthetic fixture selection", false, null).Context;
                        window.Present(context, null);
                        var snapshot = JsonSerializer.SerializeToElement(window.CaptureHardeningSnapshot());
                        var current = snapshot.GetProperty("windowHandle").GetInt64();
                        if (current == 0 || handle != 0 && current != handle || !snapshot.GetProperty("visible").GetBoolean()) throw new InvalidOperationException();
                        handle = current; window.Dismiss();
                        snapshot = JsonSerializer.SerializeToElement(window.CaptureHardeningSnapshot());
                        if (snapshot.GetProperty("visible").GetBoolean() || !snapshot.GetProperty("transientCleared").GetBoolean()) throw new InvalidOperationException();
                    }
                    return Task.CompletedTask;
                });
                completion.TrySetResult((total, failed)); dispatcher.BeginInvokeShutdown(DispatcherPriority.Background);
            }));
            Dispatcher.Run();
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
        return completion.Task.WaitAsync(TimeSpan.FromSeconds(25));
    }

    private sealed class FixtureHookApi : ILowLevelKeyboardHookApi
    {
        internal int Active; private NativeMethods.LowLevelKeyboardProc? _callback;
        public IntPtr Install(NativeMethods.LowLevelKeyboardProc callback) { Active++; _callback = callback; return new IntPtr(1); }
        public bool Uninstall(IntPtr hook, out int errorCode) { Active--; errorCode = 0; return true; }
        public IntPtr CallNext(IntPtr hook, int code, IntPtr wParam, IntPtr lParam) => new(73);
        internal IntPtr Escape(uint flags) => Key(0x1B, flags);
        internal IntPtr Key(uint virtualKey, uint flags = 0)
        {
            var memory = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.LowLevelKeyboardData>());
            try
            {
                Marshal.StructureToPtr(new NativeMethods.LowLevelKeyboardData { VirtualKey = virtualKey, Flags = flags }, memory, false);
                return _callback!(0, new IntPtr(NativeMethods.WmKeyDown), memory);
            }
            finally { Marshal.FreeHGlobal(memory); }
        }
    }

    internal static IReadOnlyList<SelectionDiagnosticEvent> Events(DiagnosticsService diagnostics) =>
        ((List<SelectionDiagnosticEvent>)typeof(DiagnosticsService).GetField("_selectionEvents", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(diagnostics)!).ToArray();
    private static DiagnosticsService NewDiagnostics() => new(Stopwatch.GetTimestamp()) { SelectionDiagnosticsEnabled = true };
    private static SelectionDiagnosticAttempt NewAttempt(DiagnosticsService diagnostics)
    {
        var now = Stopwatch.GetTimestamp(); var utc = DateTimeOffset.UtcNow;
        return diagnostics.BeginSelectionAttempt("fixture", "probe", now, utc, now, utc)!;
    }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
}

public sealed class SuperPanelFixtureItems(params bool[] directories)
{
    public SuperPanelFixtureItem Item(int index) => new(index, directories[index]);
}
public sealed class SuperPanelFixtureItem(int index, bool directory)
{
    public bool IsFileSystem => true;
    public string Path => $"C:\\SuperPanelFixture\\item-{index}";
    public bool IsFolder => directory;
}
