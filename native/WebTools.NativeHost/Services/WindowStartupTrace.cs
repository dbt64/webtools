using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace WebTools.NativeHost.Services;

// Opt-in timing only. Never records queries, selection text, URLs or credentials.
internal static class WindowStartupTrace
{
    private static readonly object Sync = new();
    internal static void Record(string stage, string? requestId = null, string? entry = null, string? pluginId = null, string? startup = null, string? sessionId = null)
    {
        var directory = Environment.GetEnvironmentVariable("WEBTOOLS_STARTUP_TRACE_DIR");
        if (string.IsNullOrWhiteSpace(directory) || !Path.IsPathFullyQualified(directory)) return;
        try
        {
            var line = JsonSerializer.Serialize(new { stage, requestId, entry, pluginId, startup, sessionId, processId = Environment.ProcessId,
                unixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), monotonicMs = Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency });
            lock (Sync) { Directory.CreateDirectory(directory); File.AppendAllText(Path.Combine(directory, "native-startup.jsonl"), line + Environment.NewLine); }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
