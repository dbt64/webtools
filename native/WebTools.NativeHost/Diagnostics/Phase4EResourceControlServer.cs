using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using WebTools.NativeHost;

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
    string Status);

/// <summary>
/// Local, current-user-only control surface used only by the explicitly opted-in Phase 4E resource test process.
/// It drives the real WPF QueryBox and never activates a result.
/// </summary>
internal sealed class Phase4EResourceControlServer(string pipeName, MainWindow window)
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

                await window.Dispatcher.InvokeAsync(() => window.Close());
                return;
            }
        }
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
            managedHeapUsedBytes = GC.GetTotalMemory(forceFullCollection: false),
            managedHeapSizeBytes = memory.HeapSizeBytes,
            managedFragmentedBytes = memory.FragmentedBytes,
        };
    }

    private static object CreateQueryResponse(Phase4EResourcePresentation presentation) => new
    {
        ok = true,
        type = "query",
        processId = Environment.ProcessId,
        presentation.Query,
        presentation.SearchMode,
        presentation.WindowVisible,
        presentation.ResultCount,
        presentation.RealizedResultCount,
        presentation.IconCount,
        presentation.IconCacheCount,
        presentation.Status,
    };

    private static async Task WriteAsync(StreamWriter writer, object value, CancellationToken cancellationToken)
    {
        await writer.WriteLineAsync(JsonSerializer.Serialize(value, JsonOptions).AsMemory(), cancellationToken);
        await writer.FlushAsync(cancellationToken);
    }
}
