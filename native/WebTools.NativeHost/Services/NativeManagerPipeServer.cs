using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Text.Json;
using WebTools.NativeHost.Data;

namespace WebTools.NativeHost.Services;

public sealed record AppMemoryUpdate(string? Query, string? AppId);
public sealed record WebsiteUpdatePayload(IReadOnlyList<LauncherWebsiteRecord>? Websites);
public sealed class NativeManagerRequestException(string code, string message) : Exception(message) { public string Code { get; } = code; }

public sealed class NativeManagerPipeServer : IAsyncDisposable
{
    public const string DefaultPipeName = "WebTools.NativeHost.Manager.v1";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly string _pipeName;
    private readonly LauncherStateStore _stateStore;
    private readonly Func<LauncherSettingsUpdate, Task<LauncherState>> _updateSettings;
    private readonly Func<IReadOnlyList<LauncherWebsiteRecord>, Task<LauncherState>> _updateWebsites;
    private readonly Func<string, string, Task<LauncherState>> _rememberApplication;
    private readonly DiagnosticsService _diagnostics;
    private readonly Func<LauncherPluginProjection, Task>? _updatePlugins;
    private readonly SemaphoreSlim _connectionGate = new(1, 1);
    private PipeSession? _session;
    private bool _disposed;

    internal NativeManagerPipeServer(
        string pipeName,
        LauncherStateStore stateStore,
        Func<LauncherSettingsUpdate, Task<LauncherState>> updateSettings,
        Func<IReadOnlyList<LauncherWebsiteRecord>, Task<LauncherState>> updateWebsites,
        Func<string, string, Task<LauncherState>> rememberApplication,
        DiagnosticsService diagnostics,
        Func<LauncherPluginProjection, Task>? updatePlugins = null)
    {
        _pipeName = pipeName;
        _stateStore = stateStore;
        _updateSettings = updateSettings;
        _updateWebsites = updateWebsites;
        _rememberApplication = rememberApplication;
        _diagnostics = diagnostics;
        _updatePlugins = updatePlugins;
    }

    public bool IsConnected => _session is not null;
    public string PipeName => _pipeName;
    public event Action? ManagerConnected;
    public event Action? ManagerDisconnected;
    public event Action? RendererReady;
    public event Action? RendererNotReady;

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && !_disposed)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(
                    _pipeName,
                    PipeDirection.InOut,
                    maxNumberOfServerInstances: 1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly,
                    inBufferSize: 4096,
                    outBufferSize: 4096);
                await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
                _diagnostics.Record("manager_pipe_connected", "current-user-only");
                using var session = new PipeSession(pipe);
                await _connectionGate.WaitAsync(cancellationToken).ConfigureAwait(false);
                try { _session = session; }
                finally { _connectionGate.Release(); }

                try { await ReadSessionAsync(session, cancellationToken).ConfigureAwait(false); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
                catch (NativePipeProtocolException error)
                {
                    _diagnostics.Record("manager_pipe_protocol_error", error.Message);
                    await session.TrySendErrorAsync("PROTOCOL_VERSION", error.Message, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception error) when (error is IOException or JsonException or InvalidDataException or UnauthorizedAccessException)
                {
                    _diagnostics.Record("manager_pipe_error", $"{error.GetType().Name}:{error.Message}");
                }
                finally
                {
                    await _connectionGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
                    try { if (ReferenceEquals(_session, session)) _session = null; }
                    finally { _connectionGate.Release(); }
                    session.Dispose();
                    if (session.Handshook) ManagerDisconnected?.Invoke();
                    _diagnostics.Record("manager_pipe_disconnected", "session-ended");
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                _diagnostics.Record("manager_pipe_server_error", $"{error.GetType().Name}:{error.Message}");
                await Task.Delay(250, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    public async Task<JsonElement> SendRequestAsync(string type, object payload, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        PipeSession? session;
        await _connectionGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { session = _session; }
        finally { _connectionGate.Release(); }
        if (session is null) throw new IOException("The Manager pipe is disconnected.");
        return await session.SendRequestAsync(type, payload, timeout, cancellationToken).ConfigureAwait(false);
    }

    private async Task<bool> ReadSessionAsync(PipeSession session, CancellationToken cancellationToken)
    {
        var greeted = false;
        var requestIds = new HashSet<string>(StringComparer.Ordinal);
        while (!cancellationToken.IsCancellationRequested)
        {
            var message = await NativePipeFrameCodec.ReadAsync(session.Stream, cancellationToken).ConfigureAwait(false);
            if (message is null) return greeted;
            if (message.Payload.ValueKind != JsonValueKind.Object)
            {
                await session.ReplyAsync(message, false, null, "INVALID_PAYLOAD", "Manager protocol payload must be a JSON object.", cancellationToken).ConfigureAwait(false);
                return greeted;
            }
            if (message.ProtocolVersion != NativePipeFrameCodec.CurrentProtocolVersion)
            {
                await session.ReplyAsync(message, false, null, "PROTOCOL_VERSION", $"Unsupported protocol version {message.ProtocolVersion}; Native Host requires {NativePipeFrameCodec.CurrentProtocolVersion}.", cancellationToken).ConfigureAwait(false);
                _diagnostics.Record("manager_pipe_protocol_error", $"version={message.ProtocolVersion}");
                return greeted;
            }
            if (message.Type == "ack") { session.AcceptAcknowledgement(message); continue; }
            if (requestIds.Count >= 2048)
            {
                await session.ReplyAsync(message, false, null, "SESSION_LIMIT", "Manager pipe session exceeded the request limit.", cancellationToken).ConfigureAwait(false);
                return greeted;
            }
            if (!requestIds.Add(message.RequestId))
            {
                await session.ReplyAsync(message, false, null, "DUPLICATE_REQUEST", "This request ID has already been used in this Manager session.", cancellationToken).ConfigureAwait(false);
                continue;
            }
            if (message.Type == "hello")
            {
                if (greeted) { await session.ReplyAsync(message, false, null, "DUPLICATE_HELLO", "Manager hello may only be sent once.", cancellationToken).ConfigureAwait(false); return true; }
                var payload = message.Payload;
                if (!payload.TryGetProperty("processId", out var pid) || !pid.TryGetInt32(out var processId) || processId <= 0)
                {
                    await session.ReplyAsync(message, false, null, "INVALID_HELLO", "Manager process identity is invalid.", cancellationToken).ConfigureAwait(false);
                    return false;
                }
                greeted = true;
                session.Handshook = true;
                _diagnostics.Record("manager_pipe_hello", $"pid={processId}");
                await session.ReplyAsync(message, true, new { state = _stateStore.Snapshot, hostProcessId = Environment.ProcessId }, null, null, cancellationToken).ConfigureAwait(false);
                ManagerConnected?.Invoke();
                continue;
            }
            if (!greeted)
            {
                await session.ReplyAsync(message, false, null, "HELLO_REQUIRED", "Manager must complete the versioned hello handshake first.", cancellationToken).ConfigureAwait(false);
                return false;
            }
            await HandleManagerRequestAsync(message, session, cancellationToken).ConfigureAwait(false);
        }
        return greeted;
    }

    private async Task HandleManagerRequestAsync(NativePipeEnvelope message, PipeSession session, CancellationToken cancellationToken)
    {
        try
        {
            switch (message.Type)
            {
                case "manager-renderer-ready":
                    RendererReady?.Invoke();
                    _diagnostics.Record("manager_renderer_ready", "acknowledged");
                    await session.ReplyAsync(message, true, null, null, null, cancellationToken).ConfigureAwait(false);
                    return;
                case "manager-renderer-not-ready":
                    RendererNotReady?.Invoke();
                    await session.ReplyAsync(message, true, null, null, null, cancellationToken).ConfigureAwait(false);
                    return;
                case "launcher-settings-update":
                    var update = message.Payload.Deserialize<LauncherSettingsUpdate>(JsonOptions)
                        ?? throw new InvalidDataException("Launcher settings payload is empty.");
                    if (update.QuickSearchShortcut is { } shortcut && !GlobalHotkeyService.TryParse(shortcut, out _))
                        throw new NativeManagerRequestException("INVALID_HOTKEY", "快捷键格式无效。");
                    var state = await _updateSettings(update).ConfigureAwait(false);
                    _diagnostics.Record("launcher_settings_updated", "fields-validated-and-persisted");
                    await session.ReplyAsync(message, true, state, null, null, cancellationToken).ConfigureAwait(false);
                    return;
                case "plugins-update":
                    if (_updatePlugins is null) throw new InvalidDataException("Plugin projection is unavailable.");
                    var projection = LauncherPluginProjectionStore.Parse(message.Payload);
                    await _updatePlugins(projection).ConfigureAwait(false);
                    await session.ReplyAsync(message, true, new { count = projection.Plugins.Count }, null, null, cancellationToken).ConfigureAwait(false);
                    return;
                case "websites-update":
                    var websiteUpdate = message.Payload.Deserialize<WebsiteUpdatePayload>(JsonOptions)
                        ?? throw new InvalidDataException("Website projection is empty.");
                    var websites = websiteUpdate.Websites
                        ?? throw new InvalidDataException("Website projection is missing from the update payload.");
                    var next = await _updateWebsites(websites).ConfigureAwait(false);
                    _diagnostics.Record("launcher_websites_updated", $"count={next.Websites.Count}");
                    await session.ReplyAsync(message, true, new { count = next.Websites.Count }, null, null, cancellationToken).ConfigureAwait(false);
                    return;
                case "app-memory-get":
                    if (!message.Payload.TryGetProperty("query", out var queryElement) || queryElement.ValueKind != JsonValueKind.String || (queryElement.GetString()?.Length ?? 0) > 128)
                        throw new NativeManagerRequestException("INVALID_QUERY", "搜索内容无效。");
                    var normalized = WebTools.NativeHost.Search.SearchCore.Normalize(queryElement.GetString() ?? "");
                    var remembered = _stateStore.Snapshot.AppSearchMemory.FirstOrDefault(item => item.Query == normalized)?.AppId;
                    await session.ReplyAsync(message, true, new { appId = remembered }, null, null, cancellationToken).ConfigureAwait(false);
                    return;
                case "app-memory-remember":
                    var memoryUpdate = message.Payload.Deserialize<AppMemoryUpdate>(JsonOptions)
                        ?? throw new NativeManagerRequestException("INVALID_APP_MEMORY", "应用搜索记忆无效。");
                    if (!IsValidAppMemoryUpdate(memoryUpdate))
                        throw new NativeManagerRequestException("INVALID_APP_MEMORY", "应用搜索记忆无效。");
                    var updated = await _rememberApplication(memoryUpdate.Query!, memoryUpdate.AppId!).ConfigureAwait(false);
                    _diagnostics.Record("app_search_memory_saved", $"entries={updated.AppSearchMemory.Count}");
                    await session.ReplyAsync(message, true, null, null, null, cancellationToken).ConfigureAwait(false);
                    return;
                default:
                    await session.ReplyAsync(message, false, null, "UNKNOWN_MESSAGE", "Manager sent an unsupported message type.", cancellationToken).ConfigureAwait(false);
                    return;
            }
        }
        catch (NativeManagerRequestException error)
        {
            await session.ReplyAsync(message, false, null, error.Code, error.Message, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is JsonException or InvalidDataException or ArgumentException or UnauthorizedAccessException or IOException)
        {
            _diagnostics.Record("manager_request_rejected", $"type={message.Type};reason={error.GetType().Name}");
            await session.ReplyAsync(message, false, null, "INVALID_PAYLOAD", "Manager request payload was invalid or could not be persisted.", cancellationToken).ConfigureAwait(false);
        }
    }

    public static bool IsValidAppMemoryUpdate(AppMemoryUpdate? update) =>
        update is not null && LauncherStateStore.IsValidAppSearchMemory(update.Query, update.AppId);

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _connectionGate.WaitAsync().ConfigureAwait(false);
        try { _session?.Dispose(); _session = null; }
        finally { _connectionGate.Release(); }
        _connectionGate.Dispose();
    }

    private sealed class PipeSession : IDisposable
    {
        private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        private readonly Stream _stream;
        private readonly SemaphoreSlim _writeGate = new(1, 1);
        private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new(StringComparer.Ordinal);
        private bool _disposed;

        public PipeSession(Stream stream) { _stream = stream; }
        public Stream Stream => _stream;
        public bool Handshook { get; set; }

        public async Task<JsonElement> SendRequestAsync(string type, object payload, TimeSpan timeout, CancellationToken cancellationToken)
        {
            var requestId = Guid.NewGuid().ToString("N");
            var response = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!_pending.TryAdd(requestId, response)) throw new InvalidOperationException("Could not allocate a Manager request ID.");
            try
            {
                await NativePipeFrameCodec.WriteAsync(_stream, Create(type, requestId, payload), _writeGate, cancellationToken).ConfigureAwait(false);
                using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeoutSource.CancelAfter(timeout);
                JsonElement ack;
                try { ack = await response.Task.WaitAsync(timeoutSource.Token).ConfigureAwait(false); }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { throw new TimeoutException($"Manager did not acknowledge {type} within {timeout.TotalSeconds:0} seconds."); }
                var data = ack.Deserialize<NativeManagerAckPayload>(JsonOptions) ?? throw new InvalidDataException("Manager acknowledgement is malformed.");
                if (data.ReplyToId != requestId || data.ReplyToType != type || !data.Ok) throw new NativeManagerRequestException(data.Error?.Code ?? "MANAGER_REJECTED", data.Error?.Message ?? "Manager did not apply the request.");
                return data.Result is { ValueKind: not JsonValueKind.Undefined } result ? result.Clone() : JsonDocument.Parse("null").RootElement.Clone();
            }
            finally { _pending.TryRemove(requestId, out _); }
        }

        public void AcceptAcknowledgement(NativePipeEnvelope message)
        {
            if (message.Payload.ValueKind != JsonValueKind.Object || !message.Payload.TryGetProperty("replyToId", out var id) || id.ValueKind != JsonValueKind.String) return;
            if (_pending.TryGetValue(id.GetString()!, out var pending)) pending.TrySetResult(message.Payload.Clone());
        }

        public Task ReplyAsync(NativePipeEnvelope request, bool ok, object? result, string? errorCode, string? errorMessage, CancellationToken cancellationToken) =>
            NativePipeFrameCodec.WriteAsync(_stream, Create("ack", request.RequestId, new
            {
                replyToId = request.RequestId,
                replyToType = request.Type,
                ok,
                result,
                error = errorCode is null ? null : new { code = errorCode, message = errorMessage ?? "请求失败。" },
            }), _writeGate, cancellationToken);

        public async Task TrySendErrorAsync(string code, string message, CancellationToken cancellationToken)
        {
            if (!_stream.CanWrite) return;
            try { await NativePipeFrameCodec.WriteAsync(_stream, Create("error", Guid.NewGuid().ToString("N"), new { code, message }), _writeGate, cancellationToken).ConfigureAwait(false); }
            catch (Exception error) when (error is IOException or OperationCanceledException or ObjectDisposedException) { }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var pending in _pending.Values) pending.TrySetException(new IOException("Manager pipe disconnected."));
            _pending.Clear();
            _writeGate.Dispose();
            _stream.Dispose();
        }

        private static NativePipeEnvelope Create(string type, string requestId, object? payload)
        {
            using var document = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions));
            return new NativePipeEnvelope(NativePipeFrameCodec.CurrentProtocolVersion, requestId, type, document.RootElement.Clone());
        }
    }

    private sealed record NativeManagerAckPayload(string ReplyToId, string ReplyToType, bool Ok, JsonElement Result, NativeManagerError? Error);
    private sealed record NativeManagerError(string Code, string Message);
}
