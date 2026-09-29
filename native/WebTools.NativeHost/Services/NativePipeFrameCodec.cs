using System.Buffers.Binary;
using System.IO;
using System.Text.Json;

namespace WebTools.NativeHost.Services;

public sealed record NativePipeEnvelope(int ProtocolVersion, string RequestId, string Type, JsonElement Payload);

public static class NativePipeFrameCodec
{
    public const int CurrentProtocolVersion = 1;
    public const int MaxProtocolMessageBytes = 4 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static byte[] Encode(NativePipeEnvelope envelope)
    {
        if (envelope is null || envelope.ProtocolVersion != CurrentProtocolVersion || string.IsNullOrWhiteSpace(envelope.RequestId) || envelope.RequestId.Length > 128 || string.IsNullOrWhiteSpace(envelope.Type) || envelope.Type.Length > 48 || envelope.Payload.ValueKind == JsonValueKind.Undefined)
            throw new InvalidDataException("Invalid Native Manager protocol envelope.");
        var payload = JsonSerializer.SerializeToUtf8Bytes(envelope, JsonOptions);
        if (payload.Length is 0 or > MaxProtocolMessageBytes) throw new InvalidDataException("Native Manager protocol message is too large.");
        var frame = new byte[payload.Length + sizeof(uint)];
        BinaryPrimitives.WriteUInt32LittleEndian(frame.AsSpan(0, sizeof(uint)), (uint)payload.Length);
        payload.CopyTo(frame.AsSpan(sizeof(uint)));
        return frame;
    }

    public static async Task WriteAsync(Stream stream, NativePipeEnvelope envelope, SemaphoreSlim? writeGate = null, CancellationToken cancellationToken = default)
    {
        var frame = Encode(envelope);
        if (writeGate is not null) await writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await stream.WriteAsync(frame, cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        finally { writeGate?.Release(); }
    }

    public static async Task<NativePipeEnvelope?> ReadAsync(Stream stream, CancellationToken cancellationToken = default)
    {
        var header = new byte[sizeof(uint)];
        var first = await stream.ReadAsync(header.AsMemory(0, 1), cancellationToken).ConfigureAwait(false);
        if (first == 0) return null;
        if (!await ReadRemainingAsync(stream, header.AsMemory(1), cancellationToken).ConfigureAwait(false)) throw new EndOfStreamException("Native Manager pipe ended mid-frame header.");
        var length = BinaryPrimitives.ReadUInt32LittleEndian(header);
        if (length is 0 or > MaxProtocolMessageBytes) throw new InvalidDataException("Native Manager protocol message is too large.");
        var body = new byte[(int)length];
        if (!await ReadRemainingAsync(stream, body, cancellationToken).ConfigureAwait(false)) throw new EndOfStreamException("Native Manager pipe ended mid-frame.");
        var envelope = JsonSerializer.Deserialize<NativePipeEnvelope>(body, JsonOptions);
        if (envelope is null || string.IsNullOrWhiteSpace(envelope.RequestId) || envelope.RequestId.Length > 128 || string.IsNullOrWhiteSpace(envelope.Type) || envelope.Type.Length > 48 || envelope.Payload.ValueKind == JsonValueKind.Undefined)
            throw new InvalidDataException("Native Manager protocol envelope is malformed.");
        return envelope;
    }

    private static async Task<bool> ReadRemainingAsync(Stream stream, Memory<byte> buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer[offset..], cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                return false;
            }
            offset += read;
        }
        return true;
    }
}

public sealed class NativePipeProtocolException(string message) : Exception(message);
