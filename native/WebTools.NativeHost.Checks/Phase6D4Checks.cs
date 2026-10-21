using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using WebTools.NativeHost.Catalog;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Files;
using WebTools.NativeHost.Search;
using WebTools.NativeHost.Services;

internal static class Phase6D4Checks
{
    private const string SessionA = "2e83e777-81e5-47bb-8a5e-1f52e5d7bd34";
    private const string SessionB = "123e4567-e89b-42d3-a456-426614174000";

    public static void Run()
    {
        VerifyProjectionParserAndSearchIntegration();
        VerifyProjectionStoreSessionAndDurability();
        VerifyProjectionFailureBoundaries();
        VerifyTransportNegotiationAndDisconnectedSearchAsync().GetAwaiter().GetResult();
    }

    private static void VerifyProjectionParserAndSearchIntegration()
    {
        var translation = Row("webtools.translation", "translate-text", "翻译", "翻译", ["Translate", "Translation"], "translate", "built-in");
        var privateNotes = Row("org.example.private-notes", "legacy-manager-page", "Private Notes", "Private Notes Plugin", ["notes", "随手记"], "plugin", "declarative-compatibility");
        var parsed = NativeFeatureProjectionStore.Parse(Element(Snapshot([translation, privateNotes])));
        Check(parsed.Features.Count == 2, "The closed projection parser accepts a complete valid Feature snapshot.");
        Check(parsed.Features[0].Ref.FeatureId == "translate-text", "Feature rows retain their composite identity.");

        var appEntries = Enumerable.Range(0, 9)
            .Select(index => SearchEntry.Application(index.ToString("x16"), $"Private Notes Tool {index}", []))
            .ToArray();
        var websiteEntries = Enumerable.Range(0, 9)
            .Select(index => SearchEntry.Website($"site-{index}", $"Notes Site {index}", $"https://notes{index}.example/"))
            .ToArray();
        var featureEntries = parsed.Features.Select(SearchEntry.PluginFeature).ToArray();
        var search = new SearchCore(appEntries, websiteEntries, pluginFeatures: featureEntries);
        var baseline = new SearchCore(appEntries, websiteEntries);
        var results = search.Search(SearchCommand.Parse("notes"));
        Check(results.Count(item => item.Kind is ResultKind.Application or ResultKind.Website) == 8, "Feature search preserves the existing shared eight app/site result cap.");
        Check(search.Search(SearchCommand.Parse("tool")).Count(item => item.Kind == ResultKind.Application) == 8, "Application-only matches retain their existing eight-row cap.");
        Check(search.Search(SearchCommand.Parse("site")).Count(item => item.Kind == ResultKind.Website) == 8, "Website-only matches retain their existing eight-row cap.");
        Check(results.Where(item => item.Kind is ResultKind.Application or ResultKind.Website)
            .Select(item => (item.Id, item.Rank, item.Match))
            .SequenceEqual(baseline.Search(SearchCommand.Parse("notes"))
                .Where(item => item.Kind is ResultKind.Application or ResultKind.Website)
                .Select(item => (item.Id, item.Rank, item.Match))),
            "Adding Features leaves existing app/site ranking and ordering unchanged.");
        var noteResult = results.Single(item => item.Action is OpenPluginFeatureAction { Ref.PluginId: "org.example.private-notes" });
        Check(noteResult.Title == "Private Notes" && noteResult.Subtitle == "Private Notes Plugin", "Feature title and plugin name are searchable and presented separately.");
        Check(((OpenPluginFeatureAction)noteResult.Action).Ref.FeatureId == "legacy-manager-page", "Search results retain the exact FeatureRef without an invocation route.");
        ExpectInvalidOperation(() => new ResultActionExecutor(new AppCatalogService(), new EverythingClient("")).Execute(noteResult),
            "The generic result executor must not bypass ManagerController for Feature invocation.");
        Check(search.Search(SearchCommand.Parse("plugin")).Any(item => item.Action is OpenPluginFeatureAction { Ref.PluginId: "org.example.private-notes" }), "Plugin display name is searchable as a Feature alias.");
        Check(search.Search(SearchCommand.Parse("随手记")).Any(item => item.Action is OpenPluginFeatureAction { Ref.PluginId: "org.example.private-notes" }), "Feature command aliases are searchable through the existing normalization path.");
        Check(search.Search(SearchCommand.Parse("suishouji")).Any(item => item.Action is OpenPluginFeatureAction { Ref.PluginId: "org.example.private-notes" }), "Feature metadata uses the existing Chinese pinyin index.");
        Check(search.Search(SearchCommand.Parse("ssj")).Any(item => item.Action is OpenPluginFeatureAction { Ref.PluginId: "org.example.private-notes" }), "Feature metadata uses the existing initials matcher.");
        Check(search.GetEmptyQueryPluginFeatures().Count == 2, "Eligible cached Features are available to the empty-query Plugins section.");
        var disabledSearch = new SearchCore(appEntries, websiteEntries, pluginFeatures: [SearchEntry.PluginFeature(translation)]);
        Check(!disabledSearch.Search(SearchCommand.Parse("notes")).Any(item => item.Action is OpenPluginFeatureAction { Ref.PluginId: "org.example.private-notes" }), "A complete replacement projection omitting a disabled Feature removes it from search.");
        Check(search.Search(SearchCommand.Parse("/notes")).All(item => item.Kind == ResultKind.Website), "Saved-website mode remains website-only after Feature integration.");
        Check(search.Search(SearchCommand.Parse("?notes")).Count == 0 && search.Search(SearchCommand.Parse("file:notes")).Count == 0,
            "Web and Everything command modes remain unchanged after Feature integration.");

        var translationMatches = search.Search(SearchCommand.Parse("Translation"));
        Check(translationMatches.Any(item => item.Action is OpenPluginFeatureAction { Ref.PluginId: "webtools.translation", Ref.FeatureId: "translate-text" }), "Built-in Translation participates in normal Feature search.");
        Check(!translationMatches.Any(item => item.Kind == ResultKind.Translation), "A shown Translation Feature suppresses the duplicate contextual Translation row.");
        foreach (var arbitraryText in new[] { "hello world", "今天天气很好", "abc中文123" })
            Check(search.Search(SearchCommand.Parse(arbitraryText)).Any(item => item.Kind == ResultKind.Translation), "Arbitrary text keeps the existing contextual Translation action.");
        foreach (var command in new[] { "/notes", "?notes", "file:notes" })
            Check(!search.Search(SearchCommand.Parse(command)).Any(item => item.Kind == ResultKind.PluginFeature), "Website, web and file command modes remain unchanged.");

        var manyFeatures = Enumerable.Range(0, 8)
            .Select(index => SearchEntry.PluginFeature(Row($"org.example.cap{index}", "feature", "Common Utility", "Common Utility Plugin", ["common"], "plugin", "declarative-compatibility")))
            .ToArray();
        var capped = new SearchCore([], [], pluginFeatures: manyFeatures).Search(SearchCommand.Parse("common"));
        Check(capped.Count(item => item.Kind == ResultKind.PluginFeature) == 6, "Feature search uses its independent six-result cap.");
        Check(capped.Take(8).Count(item => item.Kind == ResultKind.Application) == 0, "Feature results do not consume or reduce the existing app/site cap.");
    }

    private static void VerifyProjectionStoreSessionAndDurability()
    {
        var root = TemporaryRoot();
        try
        {
            var store = new NativeFeatureProjectionStore(root);
            var first = Snapshot([Row("org.example.cache", "notes", "Notes", "Notes Plugin", ["notes"], "plugin", "declarative-compatibility")]);
            var accepted = store.AcceptAsync(Element(first)).GetAwaiter().GetResult();
            Check(accepted.Changed && accepted.Projection.Revision == 5, "A valid initial complete snapshot is accepted.");

            var idempotent = store.AcceptAsync(Element(first with { GeneratedAtUnixMs = first.GeneratedAtUnixMs + 1 })).GetAwaiter().GetResult();
            Check(!idempotent.Changed && store.Current?.Revision == 5, "Same-session same-revision identical content is idempotent despite timestamp changes.");
            ExpectInvalid(() => store.AcceptAsync(Element(first with { Revision = 4 })).GetAwaiter().GetResult(), "Lower revision is rejected as stale.");
            ExpectInvalid(() => store.AcceptAsync(Element(first with { Features = [first.Features[0] with { Title = "Changed" }] })).GetAwaiter().GetResult(), "Same revision with different canonical content is rejected.");
            Check(store.Current?.Features[0].Title == "Notes", "Rejected revisions preserve the last-known-good in-memory projection.");

            var nextSession = Snapshot([Row("org.example.cache", "offline-notes", "Offline Notes", "Notes Plugin", ["offline"], "plugin", "declarative-compatibility")], SessionB, revision: 1);
            var reset = store.AcceptAsync(Element(nextSession)).GetAwaiter().GetResult();
            Check(reset.Changed && reset.Projection.Revision == 1 && reset.Projection.HostSessionId == SessionB, "A valid new Host session may reset revision to one.");
            Check(File.Exists(Path.Combine(root, NativeFeatureProjectionStore.CacheFileName)), "Accepted snapshots are durably cached under the application profile.");
            var reloaded = new NativeFeatureProjectionStore(root).Load(out var status);
            Check(status == "loaded" && reloaded?.HostSessionId == SessionB && reloaded.Features.Count == 1, "A complete cached snapshot reloads for Manager-closed search.");
            var afterManagerClose = new SearchCore([], [], pluginFeatures: reloaded!.Features.Select(SearchEntry.PluginFeature));
            Check(afterManagerClose.Search(SearchCommand.Parse("offline")).Any(item => item.Action is OpenPluginFeatureAction { Ref.FeatureId: "offline-notes" }), "Native search uses the durable Feature cache after the Manager disconnects.");

            var failing = new NativeFeatureProjectionStore(root, (_, _) => throw new IOException("Injected atomic replacement failure."));
            _ = failing.Load(out _);
            ExpectIOException(() => failing.AcceptAsync(Element(Snapshot([Row("org.example.cache", "notes", "Later", "Notes Plugin", ["notes"], "plugin", "declarative-compatibility")], SessionA, revision: 1))).GetAwaiter().GetResult(), "A failed atomic replacement does not report acceptance.");
            Check(failing.Current?.HostSessionId == SessionB, "A failed cache write leaves the last-known-good in-memory generation intact.");
            var disk = new NativeFeatureProjectionStore(root).Load(out status);
            Check(status == "loaded" && disk?.HostSessionId == SessionB, "A failed cache write leaves the previous durable file intact.");
        }
        finally { try { Directory.Delete(root, recursive: true); } catch (IOException) { } }
    }

    private static void VerifyProjectionFailureBoundaries()
    {
        var valid = Snapshot([]);
        Check(NativeFeatureProjectionStore.Parse(Element(valid)).Features.Count == 0, "An empty complete Feature projection is valid.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(Element(valid with { ProjectionVersion = 1 })), "Wrong Projection v2 version is rejected.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(JsonDocument.Parse(JsonSerializer.Serialize(valid).Replace("\"projectionVersion\":2", "\"unexpected\":true,\"projectionVersion\":2", StringComparison.Ordinal)).RootElement), "Unknown top-level fields are rejected.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(JsonDocument.Parse(JsonSerializer.Serialize(new { projectionVersion = 2, hostSessionId = SessionA, revision = 1, generatedAtUnixMs = 1 })).RootElement), "Missing required projection fields are rejected.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(Element(Snapshot([
            Row("org.example.duplicate", "same", "First", "Plugin", [], "plugin", "declarative-compatibility"),
            Row("org.example.duplicate", "same", "Second", "Plugin", [], "plugin", "declarative-compatibility"),
        ]))), "Duplicate composite FeatureRefs reject the complete snapshot.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(Element(Snapshot([Row("org.example.invalid", "Bad_ID", "Feature", "Plugin", [], "plugin", "declarative-compatibility")]))), "Invalid Feature ID grammar is rejected.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(Element(Snapshot([Row("org.example.invalid", "feature", "Feature", "Plugin", [], "remote", "declarative-compatibility")]))), "Unapproved icon tokens are rejected.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(Element(Snapshot([Row("org.example.invalid", "feature", "Feature", "Plugin", [], "plugin", "web")]))), "Unapproved Feature kinds are rejected.");
        var invalidContext = Row("org.example.invalid", "feature", "Feature", "Plugin", [], "plugin", "declarative-compatibility") with
        {
            AcceptedContexts = [new NativeFeatureAcceptedContextV2("html", ["launcher-input"])],
        };
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(Element(Snapshot([invalidContext]))), "Unsupported Feature context metadata is rejected.");
        ExpectJsonException(() => JsonDocument.Parse("{\"projectionVersion\":2"), "Truncated projection JSON is rejected by the bounded JSON parser.");

        var oversizedUnicode = "{\"extra\":\"" + new string('中', NativeFeatureProjectionStore.MaximumSerializedBytes / 3 + 1) + "\"}";
        Check(oversizedUnicode.Length < NativeFeatureProjectionStore.MaximumSerializedBytes
            && Encoding.UTF8.GetByteCount(oversizedUnicode) > NativeFeatureProjectionStore.MaximumSerializedBytes,
            "The multibyte test distinguishes UTF-8 bytes from UTF-16 string length.");
        using (var unicodeDocument = JsonDocument.Parse(oversizedUnicode))
            ExpectInvalid(() => NativeFeatureProjectionStore.Parse(unicodeDocument.RootElement), "The Native parser rejects payloads above three MiB measured as UTF-8 bytes.");

        var root = TemporaryRoot();
        try
        {
            File.WriteAllText(Path.Combine(root, NativeFeatureProjectionStore.CacheFileName), "{\"projectionVersion\":2");
            var loaded = new NativeFeatureProjectionStore(root).Load(out var status);
            Check(loaded is null && status == "invalid-cache", "Corrupt startup cache fails closed to an empty index without throwing.");
            File.WriteAllBytes(Path.Combine(root, NativeFeatureProjectionStore.CacheFileName), new byte[NativeFeatureProjectionStore.MaximumSerializedBytes + 1]);
            loaded = new NativeFeatureProjectionStore(root).Load(out status);
            Check(loaded is null && status == "invalid-cache", "Oversized startup cache is rejected before allocating an unbounded read buffer.");
        }
        finally { try { Directory.Delete(root, recursive: true); } catch (IOException) { } }

        var sixtyFour = Enumerable.Range(0, 64).Select(index => Row("org.example.boundary", $"feature-{index}", "Feature", "Plugin", [], "plugin", "declarative-compatibility")).ToArray();
        Check(NativeFeatureProjectionStore.Parse(Element(Snapshot(sixtyFour))).Features.Count == 64, "Sixty-four Features per plugin are accepted.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(Element(Snapshot([.. sixtyFour, Row("org.example.boundary", "feature-64", "Feature", "Plugin", [], "plugin", "declarative-compatibility")]))), "Sixty-five Features per plugin are rejected.");

        var many = Enumerable.Range(0, 2000).Select(index => Row($"org.example.p{index / 16:D4}", $"f{index % 16:D2}", "Feature", "Plugin", [], "plugin", "declarative-compatibility")).ToArray();
        Check(NativeFeatureProjectionStore.Parse(Element(Snapshot(many))).Features.Count == 2000, "The 2,000-row global projection boundary is accepted.");
        ExpectInvalid(() => NativeFeatureProjectionStore.Parse(Element(Snapshot([.. many, Row("org.example.p0125", "f00", "Feature", "Plugin", [], "plugin", "declarative-compatibility")]))), "A 2,001st projection row is rejected.");
    }

    private static async Task VerifyTransportNegotiationAndDisconnectedSearchAsync()
    {
        var root = TemporaryRoot();
        var pipeName = $"WebTools.NativeHost.Manager.Phase6D4.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var stateStore = new LauncherStateStore(Path.Combine(root, "launcher-state.json"));
        var cache = new NativeFeatureProjectionStore(root);
        var server = new NativeManagerPipeServer(
            pipeName,
            stateStore,
            _ => Task.FromResult(stateStore.Snapshot),
            _ => Task.FromResult(stateStore.Snapshot),
            (_, _) => Task.FromResult(stateStore.Snapshot),
            new DiagnosticsService(Stopwatch.GetTimestamp()),
            updateFeatureProjection: async payload => (await cache.AcceptAsync(payload).ConfigureAwait(false)).Projection,
            peerAuthenticator: WebTools.NativeHost.Checks.Phase6D5Checks.CreateAcceptingPipeAuthenticator(Environment.ProcessId));
        var serverTask = server.RunAsync(cancellation.Token);
        var first = Snapshot([Row("org.example.transport", "cached-search", "Cached Search", "Transport Plugin", ["cached"], "plugin", "declarative-compatibility")]);

        try
        {
            using (var manager = await ConnectManagerAsync(pipeName).ConfigureAwait(false))
            {
                var hello = await SendAsync(manager, "hello", new { processId = Environment.ProcessId, capabilities = new[] { NativeManagerPipeServer.FeatureProjectionV2Capability } }).ConfigureAwait(false);
                Check(hello.Payload.GetProperty("result").GetProperty("supportedFeatures")[0].GetString() == NativeManagerPipeServer.FeatureProjectionV2Capability,
                    "A compatible Manager explicitly negotiates Feature Projection v2.");
                var accepted = await SendAsync(manager, "features-update", first).ConfigureAwait(false);
                var acknowledgement = accepted.Payload.GetProperty("result");
                Check(accepted.Payload.GetProperty("ok").GetBoolean()
                    && acknowledgement.GetProperty("count").GetInt32() == 1
                    && acknowledgement.GetProperty("hostSessionId").GetString() == first.HostSessionId
                    && acknowledgement.GetProperty("revision").GetInt64() == first.Revision,
                    "A negotiated Manager can replace the complete Native projection snapshot.");
            }

            var disconnectedCache = cache.Current;
            Check(disconnectedCache?.Features.Single().Ref.FeatureId == "cached-search", "Manager disconnect leaves its accepted Native cache resident.");
            Check(new SearchCore([], [], pluginFeatures: disconnectedCache!.Features.Select(SearchEntry.PluginFeature))
                .Search(SearchCommand.Parse("cached")).Any(item => item.Kind == ResultKind.PluginFeature),
                "Feature search remains available with no connected Manager process.");

            using (var incompatibleManager = await ConnectManagerAsync(pipeName).ConfigureAwait(false))
            {
                var hello = await SendAsync(incompatibleManager, "hello", new { processId = Environment.ProcessId, capabilities = new object[] { NativeManagerPipeServer.FeatureProjectionV2Capability, "unknown-capability" } }).ConfigureAwait(false);
                Check(hello.Payload.GetProperty("result").GetProperty("supportedFeatures").GetArrayLength() == 0,
                    "Malformed or unsupported capability negotiation fails closed for v2.");
                var rejected = await SendAsync(incompatibleManager, "features-update", Snapshot([], SessionB, revision: 1)).ConfigureAwait(false);
                Check(!rejected.Payload.GetProperty("ok").GetBoolean()
                    && rejected.Payload.GetProperty("error").GetProperty("code").GetString() == "FEATURE_PROJECTION_NOT_NEGOTIATED",
                    "An unnegotiated Manager cannot update the Native Feature cache.");
            }
            var preserved = cache.Current;
            Check(preserved?.HostSessionId == SessionA && preserved.Features.Count == 1,
                "A rejected unnegotiated message cannot replace the last-known-good cache.");

            using (var restartedManager = await ConnectManagerAsync(pipeName).ConfigureAwait(false))
            {
                _ = await SendAsync(restartedManager, "hello", new { processId = Environment.ProcessId, capabilities = new[] { NativeManagerPipeServer.FeatureProjectionV2Capability } }).ConfigureAwait(false);
                var replacement = Snapshot([Row("org.example.transport", "restarted", "Restarted Feature", "Transport Plugin", ["restart"], "plugin", "declarative-compatibility")], SessionB, revision: 1);
                var accepted = await SendAsync(restartedManager, "features-update", replacement).ConfigureAwait(false);
                Check(accepted.Payload.GetProperty("ok").GetBoolean() && cache.Current?.HostSessionId == SessionB && cache.Current.Revision == 1,
                    "A restarted Manager session can publish a full snapshot at revision one.");
                var current = cache.Current!;
                var refreshedSearch = new SearchCore([], [], pluginFeatures: current.Features.Select(SearchEntry.PluginFeature));
                Check(refreshedSearch.Search(SearchCommand.Parse("restart")).Any(item => item.Action is OpenPluginFeatureAction { Ref.FeatureId: "restarted" })
                    && !refreshedSearch.Search(SearchCommand.Parse("cached")).Any(item => item.Kind == ResultKind.PluginFeature),
                    "The new complete Manager session replaces old Feature rows without duplicates or stale results.");
            }
        }
        finally
        {
            cancellation.Cancel();
            try { await serverTask.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false); }
            catch (OperationCanceledException) { }
            await server.DisposeAsync().ConfigureAwait(false);
            try { Directory.Delete(root, recursive: true); } catch (IOException) { }
        }
    }

    private static async Task<NamedPipeClientStream> ConnectManagerAsync(string pipeName)
    {
        var manager = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
        await manager.ConnectAsync(5_000).ConfigureAwait(false);
        return manager;
    }

    private static async Task<NativePipeEnvelope> SendAsync(NamedPipeClientStream manager, string type, object payload)
    {
        using var document = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(payload, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        await NativePipeFrameCodec.WriteAsync(manager, new NativePipeEnvelope(NativePipeFrameCodec.CurrentProtocolVersion, Guid.NewGuid().ToString("N"), type, document.RootElement.Clone())).ConfigureAwait(false);
        return await NativePipeFrameCodec.ReadAsync(manager).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false)
            ?? throw new EndOfStreamException("Native Manager pipe closed before an acknowledgement.");
    }

    private static NativeFeatureProjectionV2 Snapshot(IReadOnlyList<NativeFeatureProjectionRowV2> rows, string session = SessionA, long revision = 5) =>
        new(2, session, revision, 1_798_999_200_000, rows);

    private static NativeFeatureProjectionRowV2 Row(string pluginId, string featureId, string title, string pluginName, IReadOnlyList<string> commands, string iconToken, string featureKind) =>
        new(new NativeFeatureRef(pluginId, featureId), pluginName, title, commands, [], iconToken, featureKind, "plugin-features");

    private static JsonElement Element<T>(T value)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        return document.RootElement.Clone();
    }

    private static string TemporaryRoot()
    {
        var path = Path.Combine(Path.GetTempPath(), $"webtools-phase6d4-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }

    private static void ExpectInvalid(Action action, string message)
    {
        try { action(); }
        catch (InvalidDataException) { return; }
        throw new InvalidOperationException(message);
    }

    private static void ExpectIOException(Action action, string message)
    {
        try { action(); }
        catch (IOException) { return; }
        throw new InvalidOperationException(message);
    }

    private static void ExpectJsonException(Action action, string message)
    {
        try { action(); }
        catch (JsonException) { return; }
        throw new InvalidOperationException(message);
    }

    private static void ExpectInvalidOperation(Action action, string message)
    {
        try { action(); }
        catch (InvalidOperationException) { return; }
        throw new InvalidOperationException(message);
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
