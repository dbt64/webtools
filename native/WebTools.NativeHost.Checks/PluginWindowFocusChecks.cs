using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text.Json;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.Checks;

internal static class PluginWindowFocusChecks
{
    private static int _passed;
    private static void Check(bool value, string description)
    {
        if (!value) throw new InvalidOperationException(description);
        _passed++;
        Console.WriteLine($"PASS {description}");
    }

    internal static async Task<int> RunAsync()
    {
        var root = Path.Combine(@"D:\SystemDefault\Desktop\webtoolstest", $"focus-pipe-check-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var pipeName = $"WebTools.Focus.Checks.{Guid.NewGuid():N}";
        var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
        var diagnostics = new DiagnosticsService(Stopwatch.GetTimestamp());
        using var cancellation = new CancellationTokenSource();
        await using var server = new NativeManagerPipeServer(pipeName, state, _ => Task.FromResult(state.Snapshot),
            _ => Task.FromResult(state.Snapshot), (_, _) => Task.FromResult(state.Snapshot), diagnostics,
            peerAuthenticator: Phase6D5Checks.CreateAcceptingPipeAuthenticator(Environment.ProcessId));
        var returns = 0;
        server.ConfigureLauncherReturn(() => { returns++; return Task.CompletedTask; });
        using var controller = new ManagerController(server, new ManagerProcessLauncher(false), diagnostics,
            _ => throw new InvalidOperationException("Unexpected process launch."), sessionPrewarmEnabled: false);
        var running = server.RunAsync(cancellation.Token);
        try
        {
            Check(!await controller.TryFocusCurrentTemporaryWindowAsync(), "Disconnected summon falls back without starting Electron.");
            using (var client = await ConnectAsync(pipeName, offerFeatures: false))
            {
                Check(!await controller.TryFocusCurrentTemporaryWindowAsync(), "Unnegotiated peer leaves original search behavior available.");
                var denied = await RequestAsync(client, "launcher-show-empty", new { });
                Check(!denied.Payload.GetProperty("ok").GetBoolean() && returns == 0, "Esc return requires the existing Launcher capability.");
            }
            using (var client = await ConnectAsync(pipeName, offerFeatures: true))
            {
                foreach (var focused in new[] { true, true, false })
                {
                    var focus = controller.TryFocusCurrentTemporaryWindowAsync();
                    var request = await ReadAsync(client);
                    Check(request.Type == "focus-current-temporary-window" && !request.Payload.EnumerateObject().Any(), "Each summon sends an empty request without window identity.");
                    await WriteAsync(client, "ack", new { replyToId = request.RequestId, replyToType = request.Type, ok = true, result = new { focused } });
                    Check(await focus == focused, "Focus acknowledgement selects restore versus original search toggle.");
                }
                var returned = await RequestAsync(client, "launcher-show-empty", new { });
                Check(returned.Payload.GetProperty("ok").GetBoolean() && returns == 1, "Plugin Esc invokes the configured empty-search return.");
                var invalid = await RequestAsync(client, "launcher-show-empty", new { windowId = 123 });
                Check(!invalid.Payload.GetProperty("ok").GetBoolean() && returns == 1, "Return rejects cached identity and does not invoke search.");
            }
            using (var client = await ConnectAsync(pipeName, offerFeatures: true))
            {
                var focus = controller.TryFocusCurrentTemporaryWindowAsync();
                var request = await ReadAsync(client);
                Check(!request.Payload.EnumerateObject().Any(), "Reconnected summon still sends no cached identity.");
                await WriteAsync(client, "ack", new { replyToId = request.RequestId, replyToType = request.Type, ok = false, error = new { code = "HOST_CLOSING", message = "Closing" } });
                Check(!await focus, "A failed focus acknowledgement returns to original search behavior.");
            }
            ElectronHostOwnershipChecks.Run();
            controller.BeginLauncherSession("old");
            using (var client = await ConnectAsync(pipeName, offerFeatures: true, hostLifecycle: true))
            {
                var initial = (await RequestAsync(client, "electron-host-ownership-get", new { })).Payload.GetProperty("result");
                Check(initial.GetProperty("sessionIds")[0].GetString() == "old", "Initial authenticated connection reads the complete current ownership snapshot.");
                controller.BeginLauncherSession("new"); controller.EndLauncherSession("old");
                var stale = (await RequestAsync(client, "electron-host-ready", new { ownershipRevision = initial.GetProperty("revision").GetInt64() })).Payload.GetProperty("result");
                Check(!stale.GetProperty("synchronized").GetBoolean(), "Host readiness rejects a snapshot superseded during handshake.");
                var current = stale.GetProperty("snapshot");
                Check(current.GetProperty("sessionIds").GetArrayLength() == 1 && current.GetProperty("sessionIds")[0].GetString() == "new", "Late old-session release cannot remove the new session.");
                var ready = await RequestAsync(client, "electron-host-ready", new { ownershipRevision = current.GetProperty("revision").GetInt64() });
                Check(ready.Payload.GetProperty("result").GetProperty("synchronized").GetBoolean(), "Host becomes ready only after matching the complete snapshot revision.");
                controller.EndLauncherSession("new");
                var released = await ReadAsync(client);
                Check(released.Type == "host-ownership-sync" && released.Payload.GetProperty("sessionIds").GetArrayLength() == 0,
                    "Session cancellation sends an atomic empty snapshot without an idle timer.");
                await WriteAsync(client, "ack", new { replyToId = released.RequestId, replyToType = released.Type, ok = true, result = new { exiting = false } });
            }
            using (var client = await ConnectAsync(pipeName, offerFeatures: true, hostLifecycle: true))
            {
                controller.BeginLauncherSession("reconnected");
                var snapshot = (await RequestAsync(client, "electron-host-ownership-get", new { })).Payload.GetProperty("result");
                Check(snapshot.GetProperty("sessionIds")[0].GetString() == "reconnected", "Pipe reconnect obtains current sessions rather than replaying release deltas.");
            }
            Console.WriteLine($"Plugin window focus and session ownership checks: {_passed}/{_passed} passed.");
            return 0;
        }
        finally
        {
            cancellation.Cancel();
            try { await running.WaitAsync(TimeSpan.FromSeconds(3)); } catch (OperationCanceledException) { }
            Directory.Delete(root, recursive: true);
        }
    }

    private static async Task<NamedPipeClientStream> ConnectAsync(string pipeName, bool offerFeatures, bool hostLifecycle = false)
    {
        var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
        await client.ConnectAsync(5000);
        var capabilities = new List<string>();
        if (offerFeatures) capabilities.Add(NativeManagerPipeServer.LauncherFeatureSurfacesCapability);
        if (hostLifecycle) capabilities.Add(NativeManagerPipeServer.ElectronHostLifecycleCapability);
        var hello = await RequestAsync(client, "hello", new { processId = Environment.ProcessId, capabilities });
        if (!hello.Payload.GetProperty("ok").GetBoolean()) throw new InvalidOperationException("Authentication failed.");
        return client;
    }
    private static async Task WriteAsync(NamedPipeClientStream client, string type, object payload)
    {
        await NativePipeFrameCodec.WriteAsync(client, new NativePipeEnvelope(NativePipeFrameCodec.CurrentProtocolVersion,
            Guid.NewGuid().ToString("N"), type, JsonSerializer.SerializeToElement(payload)));
    }
    private static async Task<NativePipeEnvelope> ReadAsync(NamedPipeClientStream client) =>
        await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(5)) ?? throw new EndOfStreamException();
    private static async Task<NativePipeEnvelope> RequestAsync(NamedPipeClientStream client, string type, object payload)
    { await WriteAsync(client, type, payload); return await ReadAsync(client); }
}
