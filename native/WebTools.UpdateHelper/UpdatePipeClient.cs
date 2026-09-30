using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace WebTools.UpdateHelper;

public enum UpdatePipeOutcome { Prepared, PipeNotFound, Timeout, AccessDenied, MalformedReply, HostPidMismatch, HostRefused, UnexpectedFailure }
public sealed record UpdatePipeResult(UpdatePipeOutcome Outcome, string? ErrorCode = null);

public sealed class UpdatePipeClient
{
    public const string PipeName = "WebTools.NativeHost.Update.v1";
    private const int ProtocolVersion = 1;
    private const int MaximumResponseBytes = 8 * 1024;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private readonly string _pipeName;

    public UpdatePipeClient(string pipeName = PipeName)
    {
        _ = GetWindowsPipePath(pipeName);
        _pipeName = pipeName;
    }

    public static string SerializePrepareRequest(int expectedHostProcessId)
    {
        if (expectedHostProcessId <= 0) throw new ArgumentOutOfRangeException(nameof(expectedHostProcessId));
        return JsonSerializer.Serialize(new
        {
            protocolVersion = ProtocolVersion,
            operation = "prepare-update",
            expectedHostProcessId,
        });
    }

    public static string GetWindowsPipePath(string pipeName)
    {
        if (string.IsNullOrWhiteSpace(pipeName)
            || pipeName.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '.' or '-' or '_')))
            throw new ArgumentException("The pipe name contains unsupported characters.", nameof(pipeName));
        return @"\\.\pipe\" + pipeName;
    }

    public static bool ShouldUseLegacyWindowClose(UpdatePipeOutcome outcome) => outcome == UpdatePipeOutcome.PipeNotFound;

    public async Task<UpdatePipeResult> PrepareAsync(int expectedHostProcessId, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        if (expectedHostProcessId <= 0 || timeout <= TimeSpan.Zero) return new UpdatePipeResult(UpdatePipeOutcome.UnexpectedFailure, "invalid-request");
        var timeoutMs = (uint)Math.Clamp(Math.Ceiling(timeout.TotalMilliseconds), 1, uint.MaxValue);
        var pipePath = GetWindowsPipePath(_pipeName);
        if (!WaitNamedPipe(pipePath, timeoutMs))
        {
            return Marshal.GetLastWin32Error() switch
            {
                2 => new UpdatePipeResult(UpdatePipeOutcome.PipeNotFound, "pipe-not-found"),
                5 => new UpdatePipeResult(UpdatePipeOutcome.AccessDenied, "access-denied"),
                121 => new UpdatePipeResult(UpdatePipeOutcome.Timeout, "pipe-busy-timeout"),
                var error => new UpdatePipeResult(UpdatePipeOutcome.UnexpectedFailure, $"win32-{error}"),
            };
        }

        try
        {
            using var pipe = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
            await pipe.ConnectAsync((int)Math.Clamp(timeoutMs, 1, int.MaxValue), cancellationToken).ConfigureAwait(false);
            var request = Encoding.UTF8.GetBytes(SerializePrepareRequest(expectedHostProcessId) + "\n");
            await pipe.WriteAsync(request, cancellationToken).ConfigureAwait(false);
            await pipe.FlushAsync(cancellationToken).ConfigureAwait(false);
            var responseLine = await ReadResponseLineAsync(pipe, cancellationToken).ConfigureAwait(false);
            if (responseLine is null || !TryParseResponse(responseLine, out var success, out var errorCode))
                return new UpdatePipeResult(UpdatePipeOutcome.MalformedReply, "malformed-response");
            if (success) return new UpdatePipeResult(UpdatePipeOutcome.Prepared);
            return errorCode == "HOST_PID_MISMATCH"
                ? new UpdatePipeResult(UpdatePipeOutcome.HostPidMismatch, errorCode)
                : new UpdatePipeResult(UpdatePipeOutcome.HostRefused, errorCode ?? "host-refused");
        }
        catch (TimeoutException)
        {
            return new UpdatePipeResult(UpdatePipeOutcome.Timeout, "connect-timeout");
        }
        catch (UnauthorizedAccessException)
        {
            return new UpdatePipeResult(UpdatePipeOutcome.AccessDenied, "access-denied");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return new UpdatePipeResult(UpdatePipeOutcome.Timeout, "cancelled");
        }
        catch (IOException error)
        {
            var nativeCode = error.HResult & 0xFFFF;
            return new UpdatePipeResult(nativeCode == 5 ? UpdatePipeOutcome.AccessDenied : UpdatePipeOutcome.UnexpectedFailure, $"io-{nativeCode}");
        }
        catch (Win32Exception error)
        {
            return new UpdatePipeResult(error.NativeErrorCode == 5 ? UpdatePipeOutcome.AccessDenied : UpdatePipeOutcome.UnexpectedFailure, $"win32-{error.NativeErrorCode}");
        }
    }

    private static bool TryParseResponse(string json, out bool success, out string? errorCode)
    {
        success = false;
        errorCode = null;
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                if (property.Name is not ("protocolVersion" or "success" or "errorCode") || !seen.Add(property.Name)) return false;
            }
            if (!seen.Contains("protocolVersion") || !seen.Contains("success")
                || !root.GetProperty("protocolVersion").TryGetInt32(out var version) || version != ProtocolVersion) return false;
            var successElement = root.GetProperty("success");
            if (successElement.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
            success = successElement.GetBoolean();
            if (root.TryGetProperty("errorCode", out var errorElement))
            {
                if (errorElement.ValueKind != JsonValueKind.String) return false;
                errorCode = errorElement.GetString();
                if (string.IsNullOrWhiteSpace(errorCode) || errorCode.Length > 64 || success) return false;
            }
            return !success || errorCode is null;
        }
        catch (JsonException) { return false; }
    }

    private static async Task<string?> ReadResponseLineAsync(Stream pipe, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream(512);
        var chunk = new byte[1024];
        while (buffer.Length <= MaximumResponseBytes)
        {
            var read = await pipe.ReadAsync(chunk, cancellationToken).ConfigureAwait(false);
            if (read == 0) return null;
            var newline = Array.IndexOf(chunk, (byte)'\n', 0, read);
            var count = newline >= 0 ? newline : read;
            if (buffer.Length + count > MaximumResponseBytes) return null;
            buffer.Write(chunk, 0, count);
            if (newline < 0) continue;
            for (var index = newline + 1; index < read; index++)
                if (chunk[index] is not ((byte)' ' or (byte)'\r' or (byte)'\n' or (byte)'\t')) return null;
            try { return StrictUtf8.GetString(buffer.ToArray()).TrimEnd('\r'); }
            catch (DecoderFallbackException) { return null; }
        }
        return null;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WaitNamedPipe(string name, uint timeout);
}
