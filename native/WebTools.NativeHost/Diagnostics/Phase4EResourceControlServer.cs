using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using WebTools.NativeHost;
using WebTools.NativeHost.Services;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.SuperPanel;
using System.Diagnostics;

namespace WebTools.NativeHost.Diagnostics;

internal sealed record Phase4EResourcePresentation(
    string Query,
    string SearchMode,
    bool WindowVisible,
    int ResultCount,
    int RealizedResultCount,
    int IconCount,
    int IconCacheCount,
    long IconCacheBitmapBytes,
    string Status,
    long WindowHandle,
    bool IsActive,
    bool QueryHasKeyboardFocus,
    bool EverythingEnabled,
    IReadOnlyList<string> ResultKinds,
    IReadOnlyList<LauncherPluginShortcut> PluginShortcuts,
    int RealizedPluginShortcutCount);

/// <summary>
/// Local, current-user-only control surface used only by the explicitly opted-in Phase 4E resource test process.
/// It drives the real WPF QueryBox and explicit Manager requests, never application/website launches.
/// </summary>
internal sealed class Phase4EResourceControlServer(string pipeName, MainWindow window, string startupHotkey, ManagerController? managerController = null,
    SuperPanelTriggerController? superPanel = null, SuperPanelWindow? panelWindow = null, DiagnosticsService? selectionDiagnostics = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await using var pipe = new NamedPipeServerStream(
                pipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly,
                inBufferSize: 4096,
                outBufferSize: 4096);

            try { await pipe.WaitForConnectionAsync(cancellationToken); }
            catch (OperationCanceledException) { return; }

            using var reader = new StreamReader(pipe, new UTF8Encoding(false), detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), bufferSize: 4096, leaveOpen: true) { AutoFlush = true };

            // Startup frame acceptance supplies its own catalog. It measures a
            // feature activation, not the unrelated whole-desktop deep scan.
            if (Environment.GetEnvironmentVariable("WEBTOOLS_STARTUP_ACCEPTANCE") != "1")
                await window.WaitForResourceTestReadyAsync();
            await WriteAsync(writer, new { ok = true, type = "ready", processId = Environment.ProcessId }, cancellationToken);

            while (!cancellationToken.IsCancellationRequested)
            {
                string? line;
                try { line = await reader.ReadLineAsync(cancellationToken); }
                catch (IOException) { break; }
                if (line is null) break;
                if (line.Length > 4096)
                {
                    await WriteAsync(writer, new { ok = false, error = "request-too-large" }, cancellationToken);
                    return;
                }

                var shouldExit = false;
                object response;
                try
                {
                    using var document = JsonDocument.Parse(line, new JsonDocumentOptions { MaxDepth = 4 });
                    var root = document.RootElement;
                    var type = root.TryGetProperty("type", out var typeValue) && typeValue.ValueKind == JsonValueKind.String
                        ? typeValue.GetString()
                        : null;
                    switch (type)
                    {
                        case "launcher-prewarm-mode":
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            managerController.ConfigureSessionPrewarmForResourceTest(root.GetProperty("enabled").GetBoolean());
                            response = new { ok = true, type };
                            break;
                        case "manager-pipe-disconnect":
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            managerController.DisconnectPipeForResourceTest();
                            response = new { ok = true, type };
                            break;
                        case "manager-disconnect-on-handoff":
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            managerController.DisconnectAfterHandoffForResourceTest();
                            response = new { ok = true, type };
                            break;
                        case "manager-disconnect-during-initialization":
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            managerController.DisconnectDuringInitializationForResourceTest();
                            response = new { ok = true, type };
                            break;
                        case "launcher-session-begin":
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            managerController.BeginLauncherSession(root.GetProperty("sessionId").GetString() ?? throw new InvalidOperationException("Session ID required."));
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        case "launcher-session-end":
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            managerController.EndLauncherSession(root.GetProperty("sessionId").GetString() ?? throw new InvalidOperationException("Session ID required."));
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        case "quick-result-invoke":
                        {
                            if (superPanel is null || panelWindow is null || selectionDiagnostics is null) throw new InvalidOperationException("Super Panel acceptance is not enabled.");
                            var reference = new NativeFeatureRef(root.GetProperty("pluginId").GetString() ?? "", root.GetProperty("featureId").GetString() ?? "");
                            var text = root.GetProperty("text").GetString() ?? "";
                            var previewOnly = root.TryGetProperty("previewOnly", out var preview) && preview.ValueKind == JsonValueKind.True;
                            var requestId = await window.Dispatcher.InvokeAsync(() => panelWindow.InvokeQuickResultForAcceptance(reference, text, previewOnly));
                            response = new { ok = true, type, processId = Environment.ProcessId, requestId };
                            break;
                        }
                        case "quick-result-decision":
                            if (superPanel is null || panelWindow is null || selectionDiagnostics is null) throw new InvalidOperationException("Super Panel acceptance is not enabled.");
                            var approved = root.GetProperty("approved").GetBoolean();
                            await window.Dispatcher.InvokeAsync(() => panelWindow.DecideQuickResultForAcceptance(approved));
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        case "super-panel-open":
                        case "super-panel-start":
                        {
                            if (superPanel is null || panelWindow is null || selectionDiagnostics is null) throw new InvalidOperationException("Super Panel acceptance is not enabled.");
                            var now = Stopwatch.GetTimestamp(); var utc = DateTimeOffset.UtcNow;
                            var attempt = selectionDiagnostics.BeginSelectionAttempt("control", "click", now, utc, now, utc);
                            var activation = await window.Dispatcher.InvokeAsync(() => superPanel.ToggleAsync(attempt));
                            if (type == "super-panel-open") await activation;
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        }
                        case "super-panel-dismiss":
                            if (superPanel is null) throw new InvalidOperationException("Super Panel acceptance is not enabled.");
                            await window.Dispatcher.InvokeAsync(superPanel.DismissForLauncher);
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        case "super-panel-state":
                            if (superPanel is null || panelWindow is null || selectionDiagnostics is null) throw new InvalidOperationException("Super Panel acceptance is not enabled.");
                            response = await window.Dispatcher.InvokeAsync(() => new
                            {
                                ok = true, type, processId = Environment.ProcessId, pending = superPanel.CapturePending,
                                workers = superPanel.ActiveWorkerCount, panel = panelWindow.CaptureHardeningSnapshot(),
                                panelWindowCount = System.Windows.Application.Current.Windows.OfType<SuperPanelWindow>().Count(),
                                events = selectionDiagnostics.SelectionSnapshot().TakeLast(48).ToArray(),
                            });
                            break;
                        case "manager-open":
                        {
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            var section = root.GetProperty("section").GetString();
                            var page = section switch
                            {
                                "favorites" => ManagerPage.Favorites,
                                "entries" => ManagerPage.Entries,
                                "settings" => ManagerPage.Settings,
                                "translate" => ManagerPage.Translation,
                                _ => throw new ArgumentException("Unsupported Manager section."),
                            };
                            await window.Dispatcher.InvokeAsync(() => window.OpenManagerPage(page));
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        }
                        case "manager-plugin":
                        {
                            var reference = new LauncherPluginRef(root.GetProperty("kind").GetString() ?? "", root.GetProperty("id").GetString() ?? "");
                            if (!reference.IsValid) throw new ArgumentException("Invalid test plugin reference.");
                            await window.ActivatePluginFromResourceTestAsync(reference);
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        }
                        case "launcher-feature":
                        {
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            var reference = new NativeFeatureRef(root.GetProperty("pluginId").GetString() ?? "", root.GetProperty("featureId").GetString() ?? "");
                            var query = root.GetProperty("query").GetString() ?? "";
                            if (!reference.IsValid || query.Length is < 1 or > 300) throw new ArgumentException("Invalid test Feature query.");
                            await window.ActivateFeatureFromResourceTestAsync(query, reference);
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        }
                        case "manager-translation":
                        {
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            var text = root.GetProperty("text").GetString();
                            if (string.IsNullOrWhiteSpace(text) || text.Length > 300) throw new ArgumentException("Invalid test prefill.");
                            await window.ActivateTranslationFromResourceTestAsync(text);
                            response = new { ok = true, type, processId = Environment.ProcessId };
                            break;
                        }
                        case "manager-state":
                            if (managerController is null) throw new InvalidOperationException("Manager driver is not available.");
                            response = new { ok = true, type, processId = Environment.ProcessId, manager = managerController.CaptureLifecycleForResourceTest() };
                            break;
                        case "query":
                        {
                            var query = root.TryGetProperty("query", out var queryValue) && queryValue.ValueKind == JsonValueKind.String
                                ? queryValue.GetString()
                                : null;
                            if (query is null || query.Length > 300 || query.IndexOfAny(['\0', '\r', '\n']) >= 0)
                                throw new ArgumentException("The resource driver query is invalid.");
                            var presentation = await window.SetQueryFromResourceTestAsync(query);
                            response = CreateQueryResponse(presentation);
                            break;
                        }
                        case "snapshot":
                        {
                            var presentation = await window.GetResourceTestPresentationAsync();
                            response = CreateSnapshotResponse("snapshot", presentation);
                            break;
                        }
                        case "state":
                        {
                            var presentation = await window.GetResourceTestPresentationAsync();
                            response = CreateQueryResponse(presentation);
                            break;
                        }
                        case "show":
                        {
                            var presentation = await window.SetVisibilityFromResourceTestAsync(true);
                            response = CreateQueryResponse(presentation, "show");
                            break;
                        }
                        case "hide":
                        {
                            var presentation = await window.SetVisibilityFromResourceTestAsync(false);
                            response = CreateQueryResponse(presentation, "hide");
                            break;
                        }
                        case "replace-hotkey":
                        {
                            var shortcut = root.TryGetProperty("shortcut", out var shortcutValue) && shortcutValue.ValueKind == JsonValueKind.String
                                ? shortcutValue.GetString()
                                : null;
                            if (shortcut is null || !IsAllowedHotkeyReplacement(shortcut, startupHotkey))
                                throw new ArgumentException("The resource driver hotkey is outside the isolated test binding set.");

                            var replacement = await window.Dispatcher.InvokeAsync(() =>
                            {
                                var success = window.TryReplaceHotkey(shortcut, out _);
                                return (Success: success, Shortcut: shortcut);
                            }).Task;
                            response = new
                            {
                                ok = replacement.Success,
                                type = "hotkey",
                                shortcut = replacement.Shortcut,
                                errorCode = replacement.Success ? null : "replacement-failed",
                                processId = Environment.ProcessId,
                            };
                            break;
                        }
                        case "exit":
                            response = new { ok = true, type = "exit", processId = Environment.ProcessId };
                            shouldExit = true;
                            break;
                        default:
                            throw new ArgumentException("The resource driver command is not supported.");
                    }
                }
                catch (Exception error) when (error is ArgumentException or JsonException or InvalidOperationException or IOException or OperationCanceledException)
                {
                    response = new { ok = false, error = error.GetType().Name, message = error.Message };
                }

                await WriteAsync(writer, response, cancellationToken);
                if (!shouldExit) continue;

                await window.Dispatcher.InvokeAsync(() => System.Windows.Application.Current.Shutdown());
                return;
            }
        }
    }

    internal static bool IsAllowedHotkeyReplacement(string shortcut, string startupHotkey)
    {
        if (!GlobalHotkeyService.TryParse(shortcut, out var requested) ||
            !GlobalHotkeyService.TryParse(startupHotkey, out var startup)) return false;
        return requested.Canonical.Equals(startup.Canonical, StringComparison.OrdinalIgnoreCase) ||
               requested.Canonical is "DoubleModifier:Control" or "DoubleModifier:Alt";
    }

    private static object CreateSnapshotResponse(string type, Phase4EResourcePresentation presentation)
    {
        var memory = GC.GetGCMemoryInfo();
        return new
        {
            ok = true,
            type,
            processId = Environment.ProcessId,
            presentation.Query,
            presentation.SearchMode,
            presentation.WindowVisible,
            presentation.ResultCount,
            presentation.RealizedResultCount,
            presentation.IconCount,
            presentation.IconCacheCount,
            presentation.IconCacheBitmapBytes,
            presentation.Status,
            presentation.WindowHandle,
            presentation.IsActive,
            presentation.QueryHasKeyboardFocus,
            presentation.EverythingEnabled,
            presentation.ResultKinds,
            presentation.PluginShortcuts,
            presentation.RealizedPluginShortcutCount,
            managedHeapUsedBytes = GC.GetTotalMemory(forceFullCollection: false),
            managedHeapSizeBytes = memory.HeapSizeBytes,
            managedFragmentedBytes = memory.FragmentedBytes,
        };
    }

    private static object CreateQueryResponse(Phase4EResourcePresentation presentation, string type = "query") => new
    {
        ok = true,
        type,
        processId = Environment.ProcessId,
        presentation.Query,
        presentation.SearchMode,
        presentation.WindowVisible,
        presentation.ResultCount,
        presentation.RealizedResultCount,
        presentation.IconCount,
        presentation.IconCacheCount,
        presentation.Status,
        presentation.WindowHandle,
        presentation.IsActive,
        presentation.QueryHasKeyboardFocus,
        presentation.EverythingEnabled,
        presentation.ResultKinds,
        presentation.PluginShortcuts,
        presentation.RealizedPluginShortcutCount,
    };

    private static async Task WriteAsync(StreamWriter writer, object value, CancellationToken cancellationToken)
    {
        await writer.WriteLineAsync(JsonSerializer.Serialize(value, JsonOptions).AsMemory(), cancellationToken);
        await writer.FlushAsync(cancellationToken);
    }
}
