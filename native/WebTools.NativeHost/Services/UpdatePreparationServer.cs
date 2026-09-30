using System.IO;
using System.IO.Pipes;
using System.Text;

namespace WebTools.NativeHost.Services;

public sealed class UpdatePreparationServer
{
    public const string DefaultPipeName = "WebTools.NativeHost.Update.v1";
    private const int MaximumRequestBytes = 8 * 1024;
    private static readonly TimeSpan ManagerPreparationTimeout = TimeSpan.FromSeconds(15);
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private readonly string _pipeName;
    private readonly Func<TimeSpan, CancellationToken, Task<bool>> _prepareManager;
    private readonly Func<Task> _exitHost;
    private readonly Action<string>? _log;

    public UpdatePreparationServer(
        string pipeName,
        Func<TimeSpan, CancellationToken, Task<bool>> prepareManager,
        Func<Task> exitHost,
        Action<string>? log = null)
    {
        if (string.IsNullOrWhiteSpace(pipeName) || pipeName.Length > 200
            || pipeName.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '.' or '-' or '_')))
            throw new ArgumentException("The update pipe name contains unsupported characters.", nameof(pipeName));
        _pipeName = pipeName;
        _prepareManager = prepareManager;
        _exitHost = exitHost;
        _log = log;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await using var pipe = new NamedPipeServerStream(
                _pipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly,
                inBufferSize: 4096,
                outBufferSize: 4096);
            try { await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }

            try
            {
                var json = await ReadRequestLineAsync(pipe, cancellationToken).ConfigureAwait(false);
                if (json is null) continue;
                if (!UpdatePreparationProtocol.TryParseRequest(json, Environment.ProcessId, out _, out var errorCode))
                {
                    await WriteResponseAsync(pipe, new UpdatePreparationResponse(UpdatePreparationProtocol.CurrentProtocolVersion, false, errorCode), cancellationToken).ConfigureAwait(false);
                    _log?.Invoke($"update_request_rejected:{errorCode}");
                    continue;
                }

                bool prepared;
                try { prepared = await _prepareManager(ManagerPreparationTimeout, cancellationToken).ConfigureAwait(false); }
                catch (TimeoutException)
                {
                    prepared = false;
                    errorCode = "MANAGER_TIMEOUT";
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
                catch (Exception error)
                {
                    prepared = false;
                    errorCode = "MANAGER_PREPARE_FAILED";
                    _log?.Invoke($"update_manager_prepare_failed:{error.GetType().Name}");
                }

                var response = new UpdatePreparationResponse(
                    UpdatePreparationProtocol.CurrentProtocolVersion,
                    prepared,
                    prepared ? null : string.IsNullOrEmpty(errorCode) ? "MANAGER_REFUSED" : errorCode);
                try { await WriteResponseAsync(pipe, response, cancellationToken).ConfigureAwait(false); }
                catch (Exception error) when (error is IOException or OperationCanceledException)
                {
                    _log?.Invoke($"update_response_failed:{error.GetType().Name}");
                    continue;
                }

                if (!prepared) continue;
                _log?.Invoke("update_preparation_accepted");
                await _exitHost().ConfigureAwait(false);
                return;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception error) when (error is IOException or InvalidDataException or DecoderFallbackException or UnauthorizedAccessException)
            {
                _log?.Invoke($"update_pipe_request_failed:{error.GetType().Name}");
            }
        }
    }

    private static async Task<string?> ReadRequestLineAsync(Stream pipe, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream(capacity: 512);
        var chunk = new byte[1024];
        while (buffer.Length <= MaximumRequestBytes)
        {
            var bytesRead = await pipe.ReadAsync(chunk, cancellationToken).ConfigureAwait(false);
            if (bytesRead == 0) return null;
            var newline = Array.IndexOf(chunk, (byte)'\n', 0, bytesRead);
            var count = newline >= 0 ? newline : bytesRead;
            if (buffer.Length + count > MaximumRequestBytes) throw new InvalidDataException("Update request is too large.");
            buffer.Write(chunk, 0, count);
            if (newline < 0) continue;
            for (var index = newline + 1; index < bytesRead; index++)
                if (chunk[index] is not ((byte)' ' or (byte)'\r' or (byte)'\n' or (byte)'\t')) throw new InvalidDataException("Unexpected bytes followed the update request.");
            var request = StrictUtf8.GetString(buffer.ToArray()).TrimEnd('\r');
            return request;
        }
        throw new InvalidDataException("Update request is too large.");
    }

    private static async Task WriteResponseAsync(Stream pipe, UpdatePreparationResponse response, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(UpdatePreparationProtocol.SerializeResponse(response) + "\n");
        await pipe.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await pipe.FlushAsync(cancellationToken).ConfigureAwait(false);
    }
}
