using System.Text.Json;
using System.IO;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;
using WebTools.NativeHost.SuperPanel;

namespace WebTools.NativeHost.Checks;

internal static class Phase6G1QuickResultChecks
{
    internal static int Run()
    {
        var count = 0;
        void Check(bool condition, string name) { count++; if (!condition) throw new InvalidOperationException("FAIL " + name); }
        Check(NativeFeatureQuickResultProtocol.NormalizeText(new string('a', 8192)) is not null, "8192 scalars");
        Check(NativeFeatureQuickResultProtocol.NormalizeText(string.Concat(Enumerable.Repeat("😀", 8192))) is not null, "32768 UTF8 bytes");
        foreach (var bad in new[] { new string('a', 8193), string.Concat(Enumerable.Repeat("😀", 8193)), "\ud800", "x\0", "x\u0001", " \n\t" })
            Check(NativeFeatureQuickResultProtocol.NormalizeText(bad) is null, "invalid text rejected");
        Check(NativeFeatureQuickResultProtocol.NormalizeText(" 中文\r\nnext\rlast ") == " 中文\nnext\nlast ", "line endings only");
        Check(NativeFeatureQuickResultProtocol.NormalizeText("\ufeff") is null, "ECMAScript BOM whitespace matches Main");
        Check(NativeFeatureQuickResultProtocol.NormalizeText("\u0085") == "\u0085", "NEL is not ECMAScript blank text");
        var id = "6528d127-0182-4a60-9e4b-8c89070c50f0";
        var reference = new NativeFeatureRef("org.example.result", "quick-text");
        var valid = JsonSerializer.Serialize(new { resultVersion = 1, requestId = id, @ref = new { pluginId = reference.PluginId, featureId = reference.FeatureId }, text = "exact" });
        using var doc = JsonDocument.Parse(valid);
        Check(NativeFeatureQuickResultProtocol.TryParseResult(doc.RootElement, out _), "valid result");
        using var duplicate = JsonDocument.Parse(valid.Replace("\"text\":\"exact\"", "\"text\":\"exact\",\"\\u0074ext\":\"other\""));
        Check(!NativeFeatureQuickResultProtocol.TryParseResult(duplicate.RootElement, out _), "duplicate escaped field");
        var request = NativeFeatureInvocationProtocol.CreateSuperPanelRequest(reference, new("text", "selected-text", "selected", 1)) with { QuickResult = new(1) };
        Check(NativeFeatureInvocationProtocol.IsValidRequest(request), "selected-text result request");
        Check(!NativeFeatureInvocationProtocol.IsValidRequest(request with { Source = "launcher" }), "wrong surface");
        Check(!NativeFeatureInvocationProtocol.IsValidRequest(request with { Context = null }), "no context");
        var slot = new SuperPanelQuickResultState();
        var output = new NativeFeatureTextResult(1, id, reference, "accepted");
        slot.Begin(id, reference, 10);
        Check(slot.AcceptedBinding is null, "pending correlation is never offered as accepted metadata");
        Check(!slot.TryAccept(output with { RequestId = Guid.NewGuid().ToString() }), "wrong request");
        Check(!slot.TryAccept(output with { Ref = reference with { FeatureId = "other" } }), "wrong ref");
        slot.OnTransportDisconnected();
        Check(!slot.TryAccept(output), "pending session disconnected");
        slot.Begin(id, reference, 11);
        Check(slot.TryAccept(output), "accepted result");
        Check(!slot.TryAccept(output), "duplicate result");
        slot.OnTransportDisconnected();
        Check(slot.Result?.Text == "accepted", "accepted survives idle Pipe exit");
        Check(slot.AcceptedBinding == new NativeFeatureResultControl(id, reference), "accepted correlation survives without exposing text");
        Check(!slot.TryClear(Guid.NewGuid().ToString(), reference), "old clear rejected");
        Check(slot.TryClear(id, reference) && slot.Result is null, "matching clear");
        slot.Begin(id, reference, 12); slot.Dismiss();
        Check(!slot.TryAccept(output), "dismiss rejects late result");
        var confirmation = new NativeFeatureAIConfirmation(id, reference, Guid.NewGuid().ToString("D"), "Synthetic", "Synthetic provider", "synthetic prompt");
        slot.Begin(id, reference, 13);
        Check(!slot.TryConfirm(confirmation with { RequestId = Guid.NewGuid().ToString("D") }), "wrong confirmation");
        Check(slot.TryConfirm(confirmation) && !slot.TryConfirm(confirmation), "one active confirmation");
        slot.Dismiss(); Check(slot.Confirmation is null && slot.TakeConfirmation() is null, "dismiss drops consent");
        using var completed = JsonDocument.Parse(JsonSerializer.Serialize(new { requestId = id, status = "completed", reasonCode = "completed", dismissPanel = true }));
        Check(NativeFeatureInvocationProtocol.TryParseResult(completed.RootElement, id, out _, out _, out var dismissPanel) && dismissPanel,
            "completed external-open disposition reaches Native");
        foreach (var invalid in new[]
        {
            new { requestId = id, status = "accepted", reasonCode = "accepted", dismissPanel = true },
            new { requestId = id, status = "cancelled", reasonCode = "cancelled", dismissPanel = true },
            new { requestId = id, status = "failed", reasonCode = "command-failed", dismissPanel = true },
            new { requestId = id, status = "completed", reasonCode = "completed", dismissPanel = false },
        })
        {
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(invalid));
            Check(!NativeFeatureInvocationProtocol.TryParseResult(json.RootElement, id, out _, out _, out _), "invalid dismissal rejected");
        }
        using var duplicateDismissal = JsonDocument.Parse(completed.RootElement.GetRawText().Replace("\"dismissPanel\":true", "\"dismissPanel\":true,\"dismissPanel\":true"));
        Check(!NativeFeatureInvocationProtocol.TryParseResult(duplicateDismissal.RootElement, id, out _, out _, out _), "duplicate dismissal rejected");
        VerifyFailurePresentation(Check);
        Console.WriteLine($"Quick Result Checks: {count}/{count} PASS");
        return 0;
    }
    private static void VerifyFailurePresentation(Action<bool, string> check)
    {
        var root = Path.Combine(Path.GetTempPath(), "quick-result-routing-" + Guid.NewGuid().ToString("N"));
        var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
        var diagnostics = new DiagnosticsService(System.Diagnostics.Stopwatch.GetTimestamp());
        var launcher = new ManagerProcessLauncher(allowDevelopmentLaunch: false, testProfileRoot: root);
        var server = new NativeManagerPipeServer("WebTools.NativeHost.Resource.QuickResultRouting", state,
            _ => Task.FromResult(state.Snapshot), _ => Task.FromResult(state.Snapshot), (_, _) => Task.FromResult(state.Snapshot), diagnostics,
            peerAuthenticator: launcher.PeerIdentityService);
        var dialogs = 0; var feedback = 0;
        using var controller = new ManagerController(server, launcher, diagnostics, _ => dialogs++);
        controller.FeatureInvocationFeedback += (_, _, status, _) => { if (status == "failed") feedback++; };
        var type = typeof(ManagerController);
        var intentType = type.GetNestedType("FeatureInvocationIntent", System.Reflection.BindingFlags.NonPublic)!;
        var reference = new NativeFeatureRef("org.example.result", "quick-text");
        var report = type.GetMethod("ReportFeatureFailure", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!;
        object Intent(bool quick) => Activator.CreateInstance(intentType, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic,
            null, [Guid.NewGuid().ToString("D"), reference, null, quick ? "super-panel" : "launcher", quick ? new NativeQuickResultOptions(1) : null], null)!;
        report.Invoke(controller, [Intent(true), "fixed failure", "failed"]);
        check(dialogs == 0 && feedback == 1, "Quick Result failure stays in panel, no modal dialog");
        report.Invoke(controller, [Intent(false), "legacy failure", "failed"]);
        check(dialogs == 1 && feedback == 2, "legacy Launcher failure keeps existing dialog");
        var queue = (NativeFeatureInvocationQueue)type.GetField("_featureInvocations", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.GetValue(controller)!;
        var pending = NativeFeatureInvocationProtocol.CreateSuperPanelRequest(reference, new("text", "selected-text", "synthetic", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())) with { QuickResult = new(1) };
        queue.TryEnqueue(pending);
        type.GetMethod("ReportPendingFailure", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.Invoke(controller, ["startup failure"]);
        check(queue.Count == 0 && dialogs == 1 && feedback == 3, "Quick Result startup failure clears queue and reports without modal");
        server.DisposeAsync().AsTask().GetAwaiter().GetResult();
    }
}
