using System.Diagnostics;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Security.Principal;
using System.Text.Json;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.Checks;

internal static class Phase6D6Checks
{
    public static void Run()
    {
        VerifyProtocolAndCorrelation();
        VerifyBoundedFifoQueue();
        VerifyPreAuthenticationFeatureCommandIsRejectedAsync().GetAwaiter().GetResult();
        VerifyAuthenticatedControllerDispatchAsync().GetAwaiter().GetResult();
        RunStep("cold Manager wake and rapid Feature invocations", () => VerifyColdManagerWakeAndRapidInvocationsAsync().GetAwaiter().GetResult());
        RunStep("readiness timeout and rejected hello", () => VerifyReadinessTimeoutAndRejectedHelloDoNotDispatchAsync().GetAwaiter().GetResult());
    }

    private static void RunStep(string name, Action action)
    {
        try { action(); }
        catch (Exception error) { throw new InvalidOperationException($"Phase 6D6 {name} failed: {error}", error); }
    }

    private static void VerifyProtocolAndCorrelation()
    {
        var reference = new NativeFeatureRef("org.example.notes", "legacy-manager-page");
        Check(new NativeFeatureRef("webtools.translation", "translate-text").IsValid,
            "The built-in Translation FeatureRef follows the same bounded native identity grammar.");
        var request = NativeFeatureInvocationProtocol.CreateRequest(reference);
        Check(NativeFeatureInvocationProtocol.IsValidRequest(request), "A bounded Launcher Feature request has a valid protocol shape.");
        Check(request.Source == "launcher" && request.Ref == reference, "Native sends only the closed Launcher source and FeatureRef.");
        Check(!NativeFeatureInvocationProtocol.IsValidRequest(request with { Source = "super-panel" }), "Unsupported invocation sources are rejected.");
        Check(!NativeFeatureInvocationProtocol.IsValidRequest(request with { RequestId = "not-a-guid" }), "Malformed request IDs are rejected.");
        Check(!NativeFeatureInvocationProtocol.IsValidRequest(request with { Ref = new NativeFeatureRef("org.example.notes", "../settings") }), "Invalid FeatureRefs are rejected.");
        Check(!NativeFeatureInvocationProtocol.IsValidRequest(request with { Ref = new NativeFeatureRef(new string('a', 129), "notes") }), "Oversized FeatureRefs are rejected.");

        using var acceptedJson = JsonDocument.Parse(JsonSerializer.Serialize(new { requestId = request.RequestId, status = "accepted", reasonCode = "accepted" }));
        Check(NativeFeatureInvocationProtocol.TryParseResult(acceptedJson.RootElement, request.RequestId, out var status, out var reason)
            && status == "accepted" && reason == "accepted", "A matching accepted response is parsed.");
        Check(!NativeFeatureInvocationProtocol.TryParseResult(acceptedJson.RootElement, Guid.NewGuid().ToString("D"), out _, out _), "A late or mismatched request response cannot satisfy another invocation.");
        using var extraFieldJson = JsonDocument.Parse(JsonSerializer.Serialize(new { requestId = request.RequestId, status = "accepted", reasonCode = "accepted", pageId = "attacker-route" }));
        Check(!NativeFeatureInvocationProtocol.TryParseResult(extraFieldJson.RootElement, request.RequestId, out _, out _), "Responses with authority-like unknown fields are rejected.");
        using var invalidPairJson = JsonDocument.Parse(JsonSerializer.Serialize(new { requestId = request.RequestId, status = "accepted", reasonCode = "plugin-disabled" }));
        Check(!NativeFeatureInvocationProtocol.TryParseResult(invalidPairJson.RootElement, request.RequestId, out _, out _), "Response state and reason must form a valid pair.");
        using var oversizedJson = JsonDocument.Parse(JsonSerializer.Serialize(new { requestId = request.RequestId, status = "failed", reasonCode = "dispatch-failed", detail = new string('x', 300) }));
        Check(!NativeFeatureInvocationProtocol.TryParseResult(oversizedJson.RootElement, request.RequestId, out _, out _), "Oversized response bodies fail closed.");

        var translationProjection = new NativeFeatureProjectionV2(2, "2e83e777-81e5-47bb-8a5e-1f52e5d7bd34", 1, 0,
        [new NativeFeatureProjectionRowV2(new NativeFeatureRef("webtools.translation", "translate-text"), "翻译", "翻译", ["Translate"], [], "translate", "built-in", "plugin-features")]);
        using var projectionJson = JsonDocument.Parse(JsonSerializer.Serialize(translationProjection, new JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase }));
        Check(NativeFeatureProjectionStore.Parse(projectionJson.RootElement).Features.Single().Ref.FeatureId == "translate-text",
            "The built-in Translation FeatureRef survives the actual Native projection JSON contract.");
    }

    private static void VerifyBoundedFifoQueue()
    {
        var queue = new NativeFeatureInvocationQueue();
        var requests = Enumerable.Range(0, NativeFeatureInvocationQueue.MaximumCount)
            .Select(index => NativeFeatureInvocationProtocol.CreateRequest(new NativeFeatureRef($"org.example.plugin{index}", "legacy-manager-page")))
            .ToArray();
        foreach (var request in requests)
            Check(queue.TryEnqueue(request) == NativeFeatureInvocationEnqueueResult.Enqueued, "Requests fit within the explicit small queue bound.");
        Check(queue.Count == NativeFeatureInvocationQueue.MaximumCount, "The bounded queue retains all accepted requests.");
        Check(queue.TryEnqueue(NativeFeatureInvocationProtocol.CreateRequest(new NativeFeatureRef("org.example.overflow", "legacy-manager-page")))
            == NativeFeatureInvocationEnqueueResult.QueueFull, "Additional requests are rejected instead of growing without bound.");
        Check(queue.TryEnqueue(requests[0]) == NativeFeatureInvocationEnqueueResult.DuplicateRequest, "A duplicate in-flight request ID cannot be queued twice.");
        Check(queue.TryEnqueue(requests[0] with { Source = "unknown" }) == NativeFeatureInvocationEnqueueResult.InvalidRequest, "Malformed requests are rejected at the queue boundary.");
        Check(queue.Peek()?.RequestId == requests[0].RequestId, "The first queued request is dispatched first.");
        Check(!queue.Complete(requests[1].RequestId), "A later response cannot advance the FIFO head.");
        foreach (var request in requests)
        {
            Check(queue.Peek()?.RequestId == request.RequestId, "Invocation order remains FIFO.");
            Check(queue.Complete(request.RequestId), "Only the matching active head can be completed.");
        }
        Check(queue.Count == 0 && queue.Peek() is null, "Completed requests release bounded queue state.");
        queue.Clear();
        Check(queue.Count == 0, "Shutdown cleanup leaves no pending invocation state.");
    }

    private static async Task VerifyPreAuthenticationFeatureCommandIsRejectedAsync()
    {
        var pipeName = $"WebTools.NativeHost.Manager.Phase6D6.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var state = new LauncherStateStore(Path.Combine(Path.GetTempPath(), $"webtools-phase6d6-{Guid.NewGuid():N}.json"));
        await using var server = new NativeManagerPipeServer(pipeName, state,
            _ => Task.FromResult(state.Snapshot),
            _ => Task.FromResult(state.Snapshot),
            (_, _) => Task.FromResult(state.Snapshot),
            new DiagnosticsService(System.Diagnostics.Stopwatch.GetTimestamp()),
            peerAuthenticator: Phase6D5Checks.CreateAcceptingPipeAuthenticator(Environment.ProcessId));
        var serverTask = server.RunAsync(cancellation.Token);
        try
        {
            using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
            await client.ConnectAsync(5_000).ConfigureAwait(false);
            using var requestJson = JsonDocument.Parse(JsonSerializer.Serialize(new
            {
                requestId = Guid.NewGuid().ToString("D"),
                @ref = new { pluginId = "org.example.notes", featureId = "legacy-manager-page" },
                source = "launcher",
            }));
            await NativePipeFrameCodec.WriteAsync(client, new NativePipeEnvelope(
                NativePipeFrameCodec.CurrentProtocolVersion,
                Guid.NewGuid().ToString("N"),
                "feature-invoke",
                requestJson.RootElement.Clone())).ConfigureAwait(false);
            var response = await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
            Check(response is { Type: "ack" }
                && !response.Payload.GetProperty("ok").GetBoolean()
                && response.Payload.GetProperty("error").GetProperty("code").GetString() == "AUTHENTICATION_REQUIRED",
                "A Feature invocation-shaped message is rejected by the existing pre-authentication gate.");
        }
        finally
        {
            cancellation.Cancel();
            try { await serverTask.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        }
    }

    private static async Task VerifyAuthenticatedControllerDispatchAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), $"webtools-phase6d6-controller-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var pipeName = $"WebTools.NativeHost.Manager.Phase6D6.Controller.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
        var diagnostics = new DiagnosticsService(Stopwatch.GetTimestamp());
        await using var server = new NativeManagerPipeServer(pipeName, state,
            _ => Task.FromResult(state.Snapshot),
            _ => Task.FromResult(state.Snapshot),
            (_, _) => Task.FromResult(state.Snapshot),
            diagnostics,
            peerAuthenticator: Phase6D5Checks.CreateAcceptingPipeAuthenticator(Environment.ProcessId));
        var serverTask = server.RunAsync(cancellation.Token);
        var processStart = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? Path.Combine(Environment.SystemDirectory, "cmd.exe"))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        processStart.ArgumentList.Add("/d");
        processStart.ArgumentList.Add("/c");
        processStart.ArgumentList.Add("ping -n 30 127.0.0.1 >nul");
        using var existingManager = Process.Start(processStart) ?? throw new InvalidOperationException("Could not start the isolated Manager identity fixture.");
        var errors = new List<string>();
        using var controller = new ManagerController(server, new ManagerProcessLauncher(allowDevelopmentLaunch: false), diagnostics, errors.Add);
        typeof(ManagerController).GetField("_managerProcess", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(controller, existingManager);

        try
        {
            using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
            await client.ConnectAsync(5_000).ConfigureAwait(false);
            var helloId = Guid.NewGuid().ToString("N");
            await SendEnvelopeAsync(client, "hello", helloId, new { processId = Environment.ProcessId }).ConfigureAwait(false);
            var hello = await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
            Check(hello is { Type: "ack" } && hello.Payload.GetProperty("ok").GetBoolean(), "The isolated current Manager authenticates before any Feature request is sent.");

            var firstRef = new NativeFeatureRef("org.example.first", "legacy-manager-page");
            var secondRef = new NativeFeatureRef("org.example.second", "legacy-manager-page");
            controller.InvokeFeature(firstRef);
            controller.InvokeFeature(secondRef);
            var readyEnvelopeId = Guid.NewGuid().ToString("N");
            await SendEnvelopeAsync(client, "manager-renderer-ready", readyEnvelopeId, new { }).ConfigureAwait(false);

            var rendererReadyAcknowledged = false;
            NativePipeEnvelope? firstFeature = null;
            while (!rendererReadyAcknowledged || firstFeature is null)
            {
                var message = await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false)
                    ?? throw new EndOfStreamException("Pipe closed before the first Feature request.");
                if (message.Type == "ack" && message.Payload.TryGetProperty("replyToId", out var replyToId)
                    && replyToId.GetString() == readyEnvelopeId) rendererReadyAcknowledged = true;
                else if (message.Type == "feature-invoke") firstFeature = message;
            }

            AssertFeatureRequest(firstFeature, firstRef, "The first queued Feature is sent after authenticated renderer readiness.");
            await AcknowledgeFeatureAsync(client, firstFeature).ConfigureAwait(false);

            NativePipeEnvelope? secondFeature = null;
            while (secondFeature is null)
            {
                var message = await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false)
                    ?? throw new EndOfStreamException("Pipe closed before the second Feature request.");
                if (message.Type == "feature-invoke") secondFeature = message;
            }
            AssertFeatureRequest(secondFeature, secondRef, "A second rapid Feature click remains queued and is dispatched FIFO on the same Manager.");
            await AcknowledgeFeatureAsync(client, secondFeature).ConfigureAwait(false);

            var queueField = typeof(ManagerController).GetField("_featureInvocations", BindingFlags.Instance | BindingFlags.NonPublic)!;
            var queue = queueField.GetValue(controller)!;
            var countProperty = queue.GetType().GetProperty("Count")!;
            Check(SpinWait.SpinUntil(() => (int)countProperty.GetValue(queue)! == 0, TimeSpan.FromSeconds(3)), "Matching acknowledgements release each queued request.");
            Check(existingManager.Id == ((Process?)typeof(ManagerController).GetField("_managerProcess", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller))?.Id,
                "The already-running Manager process is reused for both invocations.");
            Check(errors.Count == 0, "Successful authenticated Feature dispatch presents no error.");
        }
        finally
        {
            try
            {
                controller.Dispose();
                cancellation.Cancel();
                try { await serverTask.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false); }
                catch (OperationCanceledException) { }
                try { if (!existingManager.HasExited) existingManager.Kill(entireProcessTree: true); }
                catch (InvalidOperationException) { }
                await existingManager.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false);
            }
            finally
            {
                existingManager.Dispose();
                try { Directory.Delete(root, recursive: true); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            }
        }
    }

    private static async Task VerifyColdManagerWakeAndRapidInvocationsAsync() =>
        await RunManagerFixtureScenarioAsync("ready", TimeSpan.FromSeconds(2), expectedFeatureCount: 2).ConfigureAwait(false);

    private static async Task VerifyReadinessTimeoutAndRejectedHelloDoNotDispatchAsync()
    {
        await RunManagerFixtureScenarioAsync("no-ready", TimeSpan.FromMilliseconds(500), expectedFeatureCount: 0,
            expectedError: "管理窗口启动超时").ConfigureAwait(false);
        await RunManagerFixtureScenarioAsync("reject-hello", TimeSpan.FromSeconds(2), expectedFeatureCount: 0,
            expectedError: "无法打开 WebTools 管理窗口").ConfigureAwait(false);
    }

    private static async Task RunManagerFixtureScenarioAsync(string mode, TimeSpan readinessTimeout, int expectedFeatureCount, string? expectedError = null)
    {
        var root = Path.Combine(Path.GetTempPath(), $"webtools-phase6d6-manager-start-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var pipeName = $"WebTools.NativeHost.Manager.Phase6D6.Start.{Guid.NewGuid():N}";
        var fixtureExe = Environment.ProcessPath ?? throw new InvalidOperationException("Could not locate the isolated NativeHost check executable.");
        var environmentNames = new[]
        {
            "WEBTOOLS_MANAGER_EXE",
            "WEBTOOLS_PHASE6D6_MANAGER_FIXTURE",
            "WEBTOOLS_PHASE6D6_FIXTURE_ROOT",
            "WEBTOOLS_PHASE6D6_FIXTURE_MODE",
        };
        var previousEnvironment = environmentNames.ToDictionary(name => name, Environment.GetEnvironmentVariable, StringComparer.Ordinal);
        using var cancellation = new CancellationTokenSource();
        var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
        var diagnostics = new DiagnosticsService(Stopwatch.GetTimestamp());
        var profileRoot = Path.Combine(root, "profile");
        var launcher = new ManagerProcessLauncher(allowDevelopmentLaunch: false, testProfileRoot: profileRoot);
        await using var server = new NativeManagerPipeServer(pipeName, state,
            _ => Task.FromResult(state.Snapshot),
            _ => Task.FromResult(state.Snapshot),
            (_, _) => Task.FromResult(state.Snapshot),
            diagnostics,
            peerAuthenticator: launcher.PeerIdentityService);
        var serverTask = server.RunAsync(cancellation.Token);
        var errors = new ConcurrentQueue<string>();
        var controller = new ManagerController(server, launcher, diagnostics, errors.Enqueue, readinessTimeout);
        Process? launchedManager = null;
        try
        {
            Environment.SetEnvironmentVariable("WEBTOOLS_MANAGER_EXE", Path.GetFullPath(fixtureExe));
            Environment.SetEnvironmentVariable("WEBTOOLS_PHASE6D6_MANAGER_FIXTURE", "1");
            Environment.SetEnvironmentVariable("WEBTOOLS_PHASE6D6_FIXTURE_ROOT", root);
            Environment.SetEnvironmentVariable("WEBTOOLS_PHASE6D6_FIXTURE_MODE", mode);

            Check(!server.IsConnected, "The isolated cold-wake scenario begins with no Manager pipe session.");
            controller.InvokeFeature(new NativeFeatureRef("org.example.first", "legacy-manager-page"));
            if (expectedFeatureCount > 0)
                controller.InvokeFeature(new NativeFeatureRef("org.example.second", "legacy-manager-page"));

            if (expectedFeatureCount > 0)
            {
                await WaitUntilAsync(() => Directory.GetFiles(root, "feature-*.json").Length == expectedFeatureCount,
                    TimeSpan.FromSeconds(12), "Cold Manager did not dispatch both queued Feature requests.").ConfigureAwait(false);
                var invocationFiles = Directory.GetFiles(root, "feature-*.json");
                var invocations = invocationFiles.Select(path => JsonDocument.Parse(File.ReadAllText(path)))
                    .Select(document =>
                    {
                        using (document)
                        {
                            return (Pid: document.RootElement.GetProperty("processId").GetInt32(),
                                PluginId: document.RootElement.GetProperty("pluginId").GetString(),
                                FeatureId: document.RootElement.GetProperty("featureId").GetString(),
                                Source: document.RootElement.GetProperty("source").GetString());
                        }
                    }).ToArray();
                var startMarkers = Directory.GetFiles(root, "started-*.txt");
                Check(startMarkers.Length == 1, "Two rapid Feature invocations cold-start exactly one Manager process.");
                launchedManager = (Process?)typeof(ManagerController).GetField("_managerProcess", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller);
                Check(launchedManager is { HasExited: false } && invocations.All(item => item.Pid == launchedManager.Id),
                    "Both cold-wake invocations are authenticated and dispatched through the same launched Manager process.");
                Check(invocations.Select(item => item.PluginId).Order(StringComparer.Ordinal)
                        .SequenceEqual(new[] { "org.example.first", "org.example.second" }.Order(StringComparer.Ordinal))
                    && invocations.All(item => item.FeatureId == "legacy-manager-page" && item.Source == "launcher"),
                    "Rapid cold-wake requests retain their exact FeatureRefs and closed source contract.");
                Check(errors.IsEmpty, "A successful cold Manager wake produces no Launcher error.");
                var featureQueue = typeof(ManagerController).GetField("_featureInvocations", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller)!;
                Check((int)featureQueue.GetType().GetProperty("Count")!.GetValue(featureQueue)! == 0,
                    "Matching cold-wake acknowledgements drain the bounded pending queue.");
            }
            else
            {
                await WaitUntilAsync(() => !errors.IsEmpty, TimeSpan.FromSeconds(5), "Expected Manager readiness/authentication failure did not reach the Launcher error path.").ConfigureAwait(false);
                Check(Directory.GetFiles(root, "feature-*.json").Length == 0,
                    "A Manager that never becomes renderer-ready or fails hello authentication receives no Feature invocation.");
                Check(errors.TryPeek(out var errorMessage) && errorMessage.Contains(expectedError!, StringComparison.Ordinal),
                    "Readiness/authentication failure produces the expected bounded user-facing error.");
                if (mode == "no-ready")
                    Check(Directory.GetFiles(root, "started-*.txt").Length == 1,
                        "The readiness timeout is exercised against one authenticated, launched Manager that never reports renderer-ready.");
                if (mode == "reject-hello")
                    Check(File.Exists(Path.Combine(root, "hello-rejected.txt")),
                        "A connected child with inconsistent self-reported PID is rejected before renderer readiness.");
            }
        }
        finally
        {
            try
            {
                launchedManager ??= (Process?)typeof(ManagerController).GetField("_managerProcess", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(controller);
                controller.Dispose();
                cancellation.Cancel();
                try { await serverTask.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false); }
                catch (Exception error) when (error is OperationCanceledException or TimeoutException) { }
                if (launchedManager is not null)
                {
                    try
                    {
                        if (!launchedManager.HasExited)
                        {
                            launchedManager.Kill(entireProcessTree: true);
                            await launchedManager.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false);
                        }
                        if (!launchedManager.HasExited)
                            throw new TimeoutException("The captured isolated Manager fixture did not exit after cleanup.");
                    }
                    catch (InvalidOperationException)
                    {
                        // ManagerController disposes this Process object only from its Exited handler.
                    }
                    finally { launchedManager.Dispose(); }
                }
            }
            finally
            {
                foreach (var name in environmentNames) Environment.SetEnvironmentVariable(name, previousEnvironment[name]);
                try { Directory.Delete(root, recursive: true); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            }
        }
    }

    internal static async Task<int> RunManagerFixtureAsync()
    {
        var root = Environment.GetEnvironmentVariable("WEBTOOLS_PHASE6D6_FIXTURE_ROOT");
        var pipeName = Environment.GetEnvironmentVariable("WEBTOOLS_NATIVE_PIPE");
        var mode = Environment.GetEnvironmentVariable("WEBTOOLS_PHASE6D6_FIXTURE_MODE");
        if (string.IsNullOrWhiteSpace(root) || string.IsNullOrWhiteSpace(pipeName) || string.IsNullOrWhiteSpace(mode)) return 2;
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, $"started-{Environment.ProcessId}.txt"), Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));

        var client = await ConnectFixtureManagerAsync(pipeName, mode == "reject-hello", root).ConfigureAwait(false);
        if (client is null) return mode == "reject-hello" && File.Exists(Path.Combine(root, "hello-rejected.txt")) ? 0 : 3;
        await using (client.ConfigureAwait(false))
        {
            if (mode == "no-ready")
            {
                await Task.Delay(Timeout.InfiniteTimeSpan).ConfigureAwait(false);
                return 0;
            }

            await SendEnvelopeAsync(client, "manager-renderer-ready", Guid.NewGuid().ToString("N"), new { }).ConfigureAwait(false);
            var readyReply = await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false);
            if (readyReply is not { Type: "ack" } || !readyReply.Payload.GetProperty("ok").GetBoolean()) return 4;

            while (true)
            {
                var message = await NativePipeFrameCodec.ReadAsync(client).ConfigureAwait(false);
                if (message is null) return 0;
                if (message.Type != "feature-invoke") return 5;
                var invocation = message.Payload.Deserialize<NativeFeatureInvocationRequest>(new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                });
                if (invocation is null || !NativeFeatureInvocationProtocol.IsValidRequest(invocation)) return 6;
                File.WriteAllText(Path.Combine(root, $"feature-{invocation.RequestId}.json"), JsonSerializer.Serialize(new
                {
                    processId = Environment.ProcessId,
                    pluginId = invocation.Ref.PluginId,
                    featureId = invocation.Ref.FeatureId,
                    source = invocation.Source,
                }));
                await SendEnvelopeAsync(client, "ack", Guid.NewGuid().ToString("N"), new
                {
                    replyToId = message.RequestId,
                    replyToType = message.Type,
                    ok = true,
                    result = new { requestId = invocation.RequestId, status = "accepted", reasonCode = "accepted" },
                }).ConfigureAwait(false);
            }
        }
    }

    private static async Task<NamedPipeClientStream?> ConnectFixtureManagerAsync(string pipeName, bool rejectSelfReportedPid, string root)
    {
        var timeout = Stopwatch.StartNew();
        while (timeout.Elapsed < TimeSpan.FromSeconds(15))
        {
            var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
            try
            {
                await client.ConnectAsync(500).ConfigureAwait(false);
                var helloId = Guid.NewGuid().ToString("N");
                await SendEnvelopeAsync(client, "hello", helloId, new
                {
                    processId = rejectSelfReportedPid ? Environment.ProcessId + 1 : Environment.ProcessId,
                    managerVersion = "phase6d6-check-fixture",
                    capabilities = Array.Empty<string>(),
                }).ConfigureAwait(false);
                var reply = await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(2)).ConfigureAwait(false);
                if (reply is { Type: "ack" } && reply.Payload.TryGetProperty("replyToId", out var replyTo)
                    && replyTo.GetString() == helloId && reply.Payload.TryGetProperty("ok", out var ok) && ok.GetBoolean()) return client;
                if (reply is { Type: "ack" } && reply.Payload.TryGetProperty("error", out var error)
                    && error.TryGetProperty("code", out var code) && code.GetString() == "CLIENT_PID_MISMATCH")
                {
                    File.WriteAllText(Path.Combine(root, "hello-rejected.txt"), "rejected");
                    client.Dispose();
                    return null;
                }
            }
            catch (Exception error) when (error is IOException or TimeoutException or InvalidOperationException or ObjectDisposedException) { }
            client.Dispose();
            if (rejectSelfReportedPid && timeout.Elapsed > TimeSpan.FromSeconds(3)) break;
            await Task.Delay(25).ConfigureAwait(false);
        }
        throw new TimeoutException("The isolated Manager fixture could not establish an authenticated pipe session.");
    }

    private static async Task WaitUntilAsync(Func<bool> condition, TimeSpan timeout, string failure)
    {
        var stopwatch = Stopwatch.StartNew();
        while (!condition())
        {
            if (stopwatch.Elapsed >= timeout) throw new TimeoutException(failure);
            await Task.Delay(10).ConfigureAwait(false);
        }
    }

    private static async Task SendEnvelopeAsync(NamedPipeClientStream client, string type, string requestId, object payload)
    {
        using var document = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(payload, new JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase }));
        await NativePipeFrameCodec.WriteAsync(client,
            new NativePipeEnvelope(NativePipeFrameCodec.CurrentProtocolVersion, requestId, type, document.RootElement.Clone())).ConfigureAwait(false);
    }

    private static async Task AcknowledgeFeatureAsync(NamedPipeClientStream client, NativePipeEnvelope feature)
    {
        var invocationId = feature.Payload.GetProperty("requestId").GetString()!;
        using var payload = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(new
        {
            replyToId = feature.RequestId,
            replyToType = "feature-invoke",
            ok = true,
            result = new { requestId = invocationId, status = "accepted", reasonCode = "accepted" },
        }, new JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase }));
        await NativePipeFrameCodec.WriteAsync(client,
            new NativePipeEnvelope(NativePipeFrameCodec.CurrentProtocolVersion, Guid.NewGuid().ToString("N"), "ack", payload.RootElement.Clone())).ConfigureAwait(false);
    }

    private static void AssertFeatureRequest(NativePipeEnvelope? message, NativeFeatureRef expectedRef, string description)
    {
        Check(message is { Type: "feature-invoke" } && message.Payload.ValueKind == JsonValueKind.Object, description);
        var request = message!.Payload;
        Check(request.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal)
            .SequenceEqual(new[] { "ref", "requestId", "source" }), "Native sends only requestId, FeatureRef and the closed invocation source.");
        Check(request.GetProperty("requestId").ValueKind == JsonValueKind.String
            && request.GetProperty("source").GetString() == "launcher"
            && request.GetProperty("ref").GetProperty("pluginId").GetString() == expectedRef.PluginId
            && request.GetProperty("ref").GetProperty("featureId").GetString() == expectedRef.FeatureId,
            "The exact composite FeatureRef crosses the authenticated pipe without a pageId or path.");
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
