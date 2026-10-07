using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.Checks;

internal static class Phase6D5Checks
{
    private const string PackagedManager = @"C:\acceptance\Manager\WebTools.exe";
    private const string NodeExecutable = @"C:\dev\node.exe";
    private const string ElectronExecutable = @"C:\dev\node_modules\electron\dist\electron.exe";

    public static void Run()
    {
        RunStep("packaged identity", VerifyPackagedIdentityMatrix);
        RunStep("development launch chain", VerifyDevelopmentLaunchChainMatrix);
        RunStep("development Electron executable resolution", VerifyDevelopmentElectronExecutableResolution);
        RunStep("OS-observed pipe PID and hello consistency", () => VerifyOsObservedPipePidAndHelloConsistencyAsync().GetAwaiter().GetResult());
        RunStep("pre-authentication update rejection", () => VerifyPreAuthenticationUpdatesAreRejectedAsync().GetAwaiter().GetResult());
        RunStep("missing authenticator fail-closed", () => VerifyMissingAuthenticatorFailsClosedAsync().GetAwaiter().GetResult());
    }

    private static void RunStep(string name, Action action)
    {
        try { action(); }
        catch (Exception error) { throw new InvalidOperationException($"Phase 6D5 {name} failed: {error.Message}", error); }
    }

    internal static IManagerPipePeerAuthenticator CreateAcceptingPipeAuthenticator(int expectedOsPid, Action<int>? observedPid = null) =>
        new AcceptingPipeAuthenticator(expectedOsPid, observedPid);

    private static void VerifyPackagedIdentityMatrix()
    {
        var api = new FakeProcessIdentityApi();
        var service = new ManagerPeerIdentityService(api);
        api.Add(99, 9900, PackagedManager);
        CheckThrows(() => service.CaptureLaunchIdentity(99, 9901, PackagedManager, PackagedManager, developmentMode: false, generation: 0),
            "A PID that was reused between Process.Start and identity capture cannot be retained.");
        var managerState = api.Add(101, 1001, PackagedManager);
        var identity = service.CaptureLaunchIdentity(101, 1001, PackagedManager, PackagedManager, developmentMode: false, generation: 1);
        service.SetCurrent(identity);
        IAuthenticatedManagerPipePeer? stalePeer = null;
        try
        {
            api.ClientPid = 101;
            Check(service.TryAuthenticate(101, out stalePeer, out _), "The retained packaged Manager process authenticates.");
            Check(service.IsCurrent(stalePeer!), "An authenticated packaged pipe session remains bound to the current launch generation.");

            api.ClientPid = 202;
            api.Add(202, 2002, PackagedManager);
            Check(!service.TryAuthenticate(202, out _, out _), "An OS-observed PID different from the retained packaged Manager PID is rejected even when its image path matches.");
            api.Add(203, 2003, @"C:\other\WebTools.exe");
            Check(!service.TryAuthenticate(203, out _, out _), "A same-user process with a different canonical executable is rejected.");

            api.ClientPid = 101;
            api.Add(101, 3003, PackagedManager);
            Check(!service.TryAuthenticate(101, out _, out _), "A recycled PID with a different process creation identity is rejected.");
            api.Add(101, 1001, PackagedManager);

            api.Add(101, 1001, @"C:\other\impostor.exe");
            api.ClientPid = 101;
            Check(!service.TryAuthenticate(101, out _, out _), "The expected PID and creation identity with an unexpected executable image is rejected.");
            api.Add(101, 1001, PackagedManager);

            api.ClientPid = 101;
            managerState.Alive = false;
            Check(!service.TryAuthenticate(101, out _, out _), "A retained Manager that exited cannot authenticate a new connection.");
            managerState.Alive = true;

            var disappearing = api.Add(404, 4004, PackagedManager);
            disappearing.AfterImagePathRead = () => disappearing.Alive = false;
            api.ClientPid = 404;
            Check(!service.TryAuthenticate(404, out _, out _), "A process that exits during image inspection is rejected.");
            disappearing.AfterImagePathRead = null;

            api.ClientPid = 101;
            api.OpenProcessFailurePids.Add(101);
            Check(!service.TryAuthenticate(101, out _, out _), "An identity API failure fails closed.");
            api.OpenProcessFailurePids.Clear();

            api.Add(505, 5005, PackagedManager);
            var nextIdentity = service.CaptureLaunchIdentity(505, 5005, PackagedManager, PackagedManager, developmentMode: false, generation: 2);
            Check(service.TryAcquireCurrentOperation(stalePeer!, out var oldOperation) && oldOperation is not null,
                "A current Manager request receives a bounded identity lease before side effects.");
            var replaceTask = service.SetCurrentAsync(nextIdentity);
            Check(!replaceTask.IsCompleted, "The next Manager cannot become current while an old authenticated request is still in flight.");
            oldOperation!.Dispose();
            replaceTask.GetAwaiter().GetResult();
            Check(!service.IsCurrent(stalePeer!), "A connection authenticated under Manager A becomes stale when Manager B becomes current.");
            api.ClientPid = 101;
            Check(!service.TryAuthenticate(101, out _, out _), "A stale Manager instance cannot authenticate after replacement.");
            api.ClientPid = 505;
            Check(service.TryAuthenticate(505, out var newPeer, out _), "A newly retained Manager instance can authenticate after replacement.");
            using (var newPeerLease = newPeer!)
                Check(service.IsCurrent(newPeerLease), "The new Manager session is current.");
            service.ClearCurrent(nextIdentity);
            nextIdentity.Dispose();
        }
        finally
        {
            service.ClearCurrent(identity);
            identity.Dispose();
            stalePeer?.Dispose();
        }
    }

    private static void VerifyDevelopmentLaunchChainMatrix()
    {
        var api = new FakeProcessIdentityApi { JobMembers = [7002] };
        var service = new ManagerPeerIdentityService(api);
        var root = api.Add(7001, 7001, NodeExecutable);
        api.Add(7002, 7002, ElectronExecutable);
        var identity = service.CaptureLaunchIdentity(7001, 7001, NodeExecutable, ElectronExecutable, developmentMode: true, generation: 7);
        service.SetCurrent(identity);
        try
        {
            api.ClientPid = 7002;
            Check(service.TryAuthenticate(7002, out _, out _), "The expected Electron executable inside the retained development Job is accepted.");

            api.Add(7003, 7003, ElectronExecutable);
            api.ClientPid = 7003;
            Check(!service.TryAuthenticate(7003, out _, out _), "An unrelated Electron process outside the current development Job is rejected.");

            api.Add(7004, 7004, NodeExecutable);
            api.JobMembers = [7002, 7004];
            api.ClientPid = 7004;
            Check(!service.TryAuthenticate(7004, out _, out _), "An unrelated Node process is rejected even if a test Job reports membership because its image is not Electron.");

            api.JobAssignmentFailure = true;
            CheckThrows(() => service.CaptureLaunchIdentity(7001, 7001, NodeExecutable, ElectronExecutable, developmentMode: true, generation: 8),
                "Development launch-chain setup failure is not weakened to PID-only authentication.");
            api.JobAssignmentFailure = false;

            api.JobApiFailure = true;
            api.ClientPid = 7002;
            Check(!service.TryAuthenticate(7002, out _, out _), "Development Job membership API failure rejects the peer.");
            api.JobApiFailure = false;

            root.Alive = false;
            Check(!service.TryAuthenticate(7002, out _, out _), "An exited development launch root invalidates its Electron child session.");
            root.Alive = true;
        }
        finally
        {
            service.ClearCurrent(identity);
            identity.Dispose();
        }
    }

    private static void VerifyDevelopmentElectronExecutableResolution()
    {
        var root = TemporaryRoot();
        try
        {
            var electronRoot = Path.Combine(root, "node_modules", "electron");
            var distribution = Path.Combine(electronRoot, "dist");
            Directory.CreateDirectory(distribution);
            var expected = Path.Combine(distribution, "electron.exe");
            File.WriteAllText(expected, string.Empty);
            File.WriteAllText(Path.Combine(electronRoot, "path.txt"), "electron.exe");
            Check(ManagerProcessLauncher.ResolveDevelopmentElectronExecutable(root) == Path.GetFullPath(expected),
                "Development launch pins ELECTRON_EXEC_PATH to the existing Electron package executable.");

            File.WriteAllText(Path.Combine(electronRoot, "path.txt"), @"..\..\outside.exe");
            CheckThrows(() => ManagerProcessLauncher.ResolveDevelopmentElectronExecutable(root),
                "An Electron path.txt traversal outside its package distribution is rejected.");

            File.WriteAllText(Path.Combine(electronRoot, "path.txt"), expected);
            CheckThrows(() => ManagerProcessLauncher.ResolveDevelopmentElectronExecutable(root),
                "An absolute Electron path.txt value is rejected.");
        }
        finally { TryDelete(root); }
    }

    private static async Task VerifyOsObservedPipePidAndHelloConsistencyAsync()
    {
        var root = TemporaryRoot();
        var pipeName = $"WebTools.NativeHost.Manager.Phase6D5.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
        var featureStore = new NativeFeatureProjectionStore(root);
        using var launchedFixture = Process.GetCurrentProcess();
        var executablePath = launchedFixture.MainModule?.FileName ?? Environment.ProcessPath
            ?? throw new InvalidOperationException("Could not resolve the isolated integration-test process image.");
        var api = new WindowsManagerProcessIdentityApi();
        var authenticator = new ManagerPeerIdentityService(api);
        var retainedIdentity = authenticator.CaptureLaunchIdentity(
            launchedFixture.Id,
            launchedFixture.StartTime.ToUniversalTime().ToFileTimeUtc(),
            executablePath,
            executablePath,
            developmentMode: false,
            generation: 1);
        authenticator.SetCurrent(retainedIdentity);
        var server = new NativeManagerPipeServer(
            pipeName,
            state,
            _ => Task.FromResult(state.Snapshot),
            _ => Task.FromResult(state.Snapshot),
            (_, _) => Task.FromResult(state.Snapshot),
            new DiagnosticsService(Stopwatch.GetTimestamp()),
            updateFeatureProjection: async payload => (await featureStore.AcceptAsync(payload).ConfigureAwait(false)).Projection,
            pipeClientProcessIdProvider: api,
            peerAuthenticator: authenticator);
        var serverTask = server.RunAsync(cancellation.Token);
        try
        {
            using (var client = await ConnectAsync(pipeName).ConfigureAwait(false))
            {
                var hello = await SendAsync(client, "hello", new { processId = Environment.ProcessId }).ConfigureAwait(false);
                Check(hello is { } helloReply && helloReply.Payload.GetProperty("ok").GetBoolean(), "The OS-observed current client PID is accepted when hello.processId matches.");
            }

            using (var client = await ConnectAsync(pipeName).ConfigureAwait(false))
            {
                var hello = await SendAsync(client, "hello", new { processId = Environment.ProcessId + 1000 }).ConfigureAwait(false);
                Check(hello is { } mismatchReply && !mismatchReply.Payload.GetProperty("ok").GetBoolean()
                    && mismatchReply.Payload.GetProperty("error").GetProperty("code").GetString() == "CLIENT_PID_MISMATCH",
                    "hello.processId is only a consistency field and a mismatch is rejected.");
            }
            using (var client = await ConnectAsync(pipeName).ConfigureAwait(false))
            {
                var malformed = await SendAsync(client, "hello", new { processId = 0, unexpected = true }).ConfigureAwait(false);
                Check(malformed is { } malformedReply && !malformedReply.Payload.GetProperty("ok").GetBoolean()
                    && malformedReply.Payload.GetProperty("error").GetProperty("code").GetString() == "INVALID_HELLO",
                    "Malformed hello data is rejected before the connection becomes authenticated.");
            }
            using (var client = await ConnectAsync(pipeName).ConfigureAwait(false))
            {
                var hello = await SendAsync(client, "hello", new
                {
                    processId = Environment.ProcessId,
                    capabilities = new[] { NativeManagerPipeServer.FeatureProjectionV2Capability },
                }).ConfigureAwait(false);
                Check(hello is { } accepted && accepted.Payload.GetProperty("ok").GetBoolean(),
                    "A mismatched or malformed connection does not poison the current Manager session or stop the Host.");
                var update = await SendAsync(client, "features-update", new
                {
                    projectionVersion = 2,
                    hostSessionId = Guid.NewGuid().ToString("D"),
                    revision = 1,
                    generatedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    features = new[]
                    {
                        new
                        {
                            @ref = new { pluginId = "org.example.auth", featureId = "authenticated" },
                            pluginName = "Authentication Check",
                            title = "Authenticated Feature",
                            commands = new[] { "auth" },
                            acceptedContexts = Array.Empty<object>(),
                            iconToken = "plugin",
                            featureKind = "declarative-compatibility",
                            group = "plugin-features",
                        },
                    },
                }).ConfigureAwait(false);
                Check(update is { } updateReply && updateReply.Payload.GetProperty("ok").GetBoolean()
                    && featureStore.Current is { Features.Count: 1 } projection
                    && projection.Features[0].Ref.FeatureId == "authenticated",
                    "A production-authenticated OS-observed peer can still publish a valid negotiated Feature Projection v2 snapshot.");
            }
        }
        finally
        {
            cancellation.Cancel();
            try { await serverTask.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false); }
            catch (OperationCanceledException) { }
            await server.DisposeAsync().ConfigureAwait(false);
            authenticator.ClearCurrent(retainedIdentity);
            retainedIdentity.Dispose();
            TryDelete(root);
        }
    }

    private static async Task VerifyPreAuthenticationUpdatesAreRejectedAsync()
    {
        var root = TemporaryRoot();
        var pipeName = $"WebTools.NativeHost.Manager.Phase6D5.PreAuth.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
        var pluginStore = new LauncherPluginProjectionStore(root);
        var featureStore = new NativeFeatureProjectionStore(root);
        var pluginUpdates = 0;
        var featureUpdates = 0;
        const string seedFeatureSession = "2d7fbada-7ba5-4999-8e0c-692b7fb4b8e0";
        await pluginStore.SaveAsync(new LauncherPluginProjection(1, [new LauncherPluginShortcut(new("declarative", "org.example.cached"), "Cached Notes", "plugin")]));
        var seedFeature = new NativeFeatureProjectionV2(2, seedFeatureSession, 1, 1,
            [new NativeFeatureProjectionRowV2(new("org.example.cached", "cached"), "Cached Feature", "Cached Feature", ["cached"], [], "plugin", "declarative-compatibility", "plugin-features")]);
        using (var seedDocument = JsonDocument.Parse(JsonSerializer.Serialize(seedFeature, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })))
            await featureStore.AcceptAsync(seedDocument.RootElement).ConfigureAwait(false);
        var server = new NativeManagerPipeServer(
            pipeName,
            state,
            _ => Task.FromResult(state.Snapshot),
            _ => Task.FromResult(state.Snapshot),
            (_, _) => Task.FromResult(state.Snapshot),
            new DiagnosticsService(Stopwatch.GetTimestamp()),
            updatePlugins: async projection => { await pluginStore.SaveAsync(projection).ConfigureAwait(false); pluginUpdates++; },
            updateFeatureProjection: async payload => { featureUpdates++; return (await featureStore.AcceptAsync(payload).ConfigureAwait(false)).Projection; },
            peerAuthenticator: new AcceptingPipeAuthenticator(Environment.ProcessId));
        var serverTask = server.RunAsync(cancellation.Token);
        try
        {
            foreach (var type in new[] { "plugins-update", "features-update" })
            {
                using var client = await ConnectAsync(pipeName).ConfigureAwait(false);
                var reply = await SendAsync(client, type, new { }).ConfigureAwait(false);
                Check(reply is { } rejected && !rejected.Payload.GetProperty("ok").GetBoolean()
                    && rejected.Payload.GetProperty("error").GetProperty("code").GetString() == "AUTHENTICATION_REQUIRED",
                    $"Pre-authentication {type} is rejected before dispatch.");
            }
            Check(pluginUpdates == 0 && featureUpdates == 0, "Unauthenticated v1/v2 updates cannot mutate either projection callback.");
            Check(pluginStore.Load(out _).Plugins.Single().Ref.Id == "org.example.cached"
                && featureStore.Current is { HostSessionId: seedFeatureSession, Features.Count: 1 } cachedFeature
                && cachedFeature.Features[0].Ref.FeatureId == "cached",
                "Authentication failure preserves the last-known-good v1 and v2 projection caches.");

            using (var validClient = await ConnectAsync(pipeName).ConfigureAwait(false))
            {
                var hello = await SendAsync(validClient, "hello", new { processId = Environment.ProcessId }).ConfigureAwait(false);
                Check(hello is { } accepted && accepted.Payload.GetProperty("ok").GetBoolean(), "A rejected pre-auth connection does not stop the NativeHost pipe server.");
                var v1 = await SendAsync(validClient, "plugins-update", new
                {
                    projectionVersion = 1,
                    plugins = new[] { new { @ref = new { kind = "builtin", id = "webtools.translation" }, displayName = "翻译", icon = "translation" } },
                }).ConfigureAwait(false);
                Check(v1 is { } v1Reply && v1Reply.Payload.GetProperty("ok").GetBoolean()
                    && pluginStore.Load(out _).Plugins.Single().Ref.Id == "webtools.translation",
                    "After hello, authenticated v1 plugin updates retain their existing semantics.");
            }
            Check(pluginUpdates == 1 && featureUpdates == 0, "Only the authenticated v1 update reached its projection callback.");
        }
        finally
        {
            cancellation.Cancel();
            try { await serverTask.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false); }
            catch (OperationCanceledException) { }
            await server.DisposeAsync().ConfigureAwait(false);
            TryDelete(root);
        }
    }

    private static async Task VerifyMissingAuthenticatorFailsClosedAsync()
    {
        var root = TemporaryRoot();
        var pipeName = $"WebTools.NativeHost.Manager.Phase6D5.NoAuth.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var state = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
        var server = new NativeManagerPipeServer(pipeName, state,
            _ => Task.FromResult(state.Snapshot), _ => Task.FromResult(state.Snapshot), (_, _) => Task.FromResult(state.Snapshot),
            new DiagnosticsService(Stopwatch.GetTimestamp()));
        var serverTask = server.RunAsync(cancellation.Token);
        try
        {
            using var client = await ConnectAsync(pipeName).ConfigureAwait(false);
            NativePipeEnvelope? hello = null;
            try { hello = await SendAsync(client, "hello", new { processId = Environment.ProcessId }).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false); }
            catch (IOException) { /* The server may close before reading when authentication is unavailable. */ }
            Check(hello is null, "A valid self-reported PID cannot authenticate when no NativeHost launch identity service is configured.");
        }
        finally
        {
            cancellation.Cancel();
            try { await serverTask.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false); }
            catch (OperationCanceledException) { }
            await server.DisposeAsync().ConfigureAwait(false);
            TryDelete(root);
        }
    }

    private static async Task<NamedPipeClientStream> ConnectAsync(string pipeName)
    {
        var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
        await client.ConnectAsync(5_000).ConfigureAwait(false);
        return client;
    }

    private static async Task<NativePipeEnvelope?> SendAsync(NamedPipeClientStream client, string type, object payload)
    {
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        await NativePipeFrameCodec.WriteAsync(client,
            new NativePipeEnvelope(NativePipeFrameCodec.CurrentProtocolVersion, Guid.NewGuid().ToString("N"), type, json.RootElement.Clone())).ConfigureAwait(false);
        return await NativePipeFrameCodec.ReadAsync(client).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
    }

    private static string TemporaryRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), $"webtools-phase6d5-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        return root;
    }

    private static void TryDelete(string root)
    {
        try { Directory.Delete(root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void CheckThrows(Action action, string message)
    {
        try { action(); }
        catch (Exception) { return; }
        throw new InvalidOperationException(message);
    }

    private sealed class AcceptingPipeAuthenticator(int expectedPid, Action<int>? observedPid = null) : IManagerPipePeerAuthenticator
    {
        public List<int> ObservedPids { get; } = [];

        public bool TryAuthenticate(int osObservedProcessId, out IAuthenticatedManagerPipePeer? peer, out string failureReason)
        {
            ObservedPids.Add(osObservedProcessId);
            observedPid?.Invoke(osObservedProcessId);
            if (osObservedProcessId != expectedPid)
            {
                peer = null;
                failureReason = "test-peer-mismatch";
                return false;
            }
            peer = new TestAuthenticatedPeer(osObservedProcessId);
            failureReason = string.Empty;
            return true;
        }

        public bool IsCurrent(IAuthenticatedManagerPipePeer peer) => peer is TestAuthenticatedPeer { IsDisposed: false } testPeer
            && testPeer.ClientProcessId == expectedPid;

        public bool TryAcquireCurrentOperation(IAuthenticatedManagerPipePeer peer, out IDisposable? lease)
        {
            if (!IsCurrent(peer)) { lease = null; return false; }
            lease = new DisposableLease();
            return true;
        }
    }

    private sealed class TestAuthenticatedPeer(int clientProcessId) : IAuthenticatedManagerPipePeer
    {
        public int ClientProcessId { get; } = clientProcessId;
        public long LaunchGeneration => 1;
        public bool IsDisposed { get; private set; }
        public void Dispose() => IsDisposed = true;
    }

    private sealed class DisposableLease : IDisposable { public void Dispose() { } }

    private sealed class FakeProcessIdentityApi : IManagerProcessIdentityApi
    {
        private readonly Dictionary<int, FakeProcessState> _processes = [];
        public int ClientPid { get; set; }
        public HashSet<int> JobMembers { get; set; } = [];
        public HashSet<int> OpenProcessFailurePids { get; } = [];
        public bool JobAssignmentFailure { get; set; }
        public bool JobApiFailure { get; set; }

        public FakeProcessState Add(int pid, long creationFileTimeUtc, string imagePath)
        {
            var state = new FakeProcessState(pid, creationFileTimeUtc, imagePath);
            _processes[pid] = state;
            return state;
        }

        public int GetClientProcessId(SafePipeHandle serverPipeHandle) => ClientPid;

        public IManagerProcessObservation OpenProcess(int processId)
        {
            if (OpenProcessFailurePids.Contains(processId) || !_processes.TryGetValue(processId, out var state))
                throw new InvalidOperationException("fake process identity API failure");
            return new FakeProcessObservation(state);
        }

        public IManagerLaunchJob CreateAndAssignLaunchJob(IManagerProcessObservation process)
        {
            if (JobAssignmentFailure || process is not FakeProcessObservation)
                throw new InvalidOperationException("fake Job assignment failure");
            return new FakeLaunchJob(this);
        }

        public string CanonicalizeExecutablePath(string path) => Path.GetFullPath(path);

        private sealed class FakeLaunchJob(FakeProcessIdentityApi owner) : IManagerLaunchJob
        {
            public bool Contains(IManagerProcessObservation process)
            {
                if (owner.JobApiFailure) throw new InvalidOperationException("fake Job membership API failure");
                return process is FakeProcessObservation observed && owner.JobMembers.Contains(observed.ProcessId);
            }
            public void Dispose() { }
        }
    }

    private sealed class FakeProcessState(int processId, long creationFileTimeUtc, string imagePath)
    {
        public int ProcessId { get; } = processId;
        public long CreationFileTimeUtc { get; } = creationFileTimeUtc;
        public string ImagePath { get; } = Path.GetFullPath(imagePath);
        public bool Alive { get; set; } = true;
        public Action? AfterImagePathRead { get; set; }
    }

    private sealed class FakeProcessObservation(FakeProcessState state) : IManagerProcessObservation
    {
        private bool _disposed;
        private readonly int _processId = state.ProcessId;
        private readonly long _creationFileTimeUtc = state.CreationFileTimeUtc;
        private readonly string _imagePath = state.ImagePath;
        public int ProcessId => _processId;
        public long CreationFileTimeUtc => _creationFileTimeUtc;
        public string ImagePath
        {
            get
            {
                var path = _imagePath;
                state.AfterImagePathRead?.Invoke();
                return path;
            }
        }
        public bool IsAlive => !_disposed && state.Alive;
        public void Dispose() => _disposed = true;
    }
}
