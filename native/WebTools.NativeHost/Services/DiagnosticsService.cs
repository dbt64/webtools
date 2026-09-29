using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;

namespace WebTools.NativeHost.Services;

internal sealed class DiagnosticsService
{
    private const int SummarySampleCount = 30;
    private const int MaxEvents = 2000;
    private readonly object _sync = new();
    private readonly long _startupTimestamp;
    private readonly List<(DateTimeOffset Time, string Event, string Value)> _events = [];
    private readonly List<double> _focusLatenciesMs = [];
    private bool _summaryRecorded;

    public DiagnosticsService(long startupTimestamp)
    {
        _startupTimestamp = startupTimestamp;
    }

    public string LogDirectory => Path.Combine(Path.GetTempPath(), "WebToolsNativeHost-PoC");

    public string LogPath => Path.Combine(
        LogDirectory,
        $"run-{DateTime.Now:yyyyMMdd-HHmmss}-{Environment.ProcessId}.csv");

    public void Record(string eventName, string value)
    {
        lock (_sync)
        {
            _events.Add((DateTimeOffset.UtcNow, eventName, value));
            if (_events.Count > MaxEvents) _events.RemoveRange(0, _events.Count - MaxEvents);
        }
    }

    public void RecordHotkeyFocusLatency(double elapsedMs)
    {
        lock (_sync)
        {
            if (!_summaryRecorded) _focusLatenciesMs.Add(elapsedMs);
            _events.Add((DateTimeOffset.UtcNow, "hotkey_to_textbox_focus_ms", elapsedMs.ToString("F3", CultureInfo.InvariantCulture)));
            if (_events.Count > MaxEvents) _events.RemoveRange(0, _events.Count - MaxEvents);

            if (!_summaryRecorded && _focusLatenciesMs.Count >= SummarySampleCount)
            {
                var samples = _focusLatenciesMs.Take(SummarySampleCount).Order().ToArray();
                var median = (samples[14] + samples[15]) / 2;
                var p95 = samples[(int)Math.Ceiling(samples.Length * 0.95) - 1];
                var maximum = samples[^1];
                _events.Add((DateTimeOffset.UtcNow, "first_30_show_latency_summary_ms", $"median={median:F3};p95={p95:F3};max={maximum:F3}"));
                _summaryRecorded = true;
            }
        }
    }

    public void RecordStartupReady()
    {
        var elapsedMs = Stopwatch.GetElapsedTime(_startupTimestamp).TotalMilliseconds;
        Record("process_start_to_host_ready_ms", elapsedMs.ToString("F3", CultureInfo.InvariantCulture));
    }

    public void Flush()
    {
        try
        {
            List<(DateTimeOffset Time, string Event, string Value)> snapshot;
            lock (_sync)
            {
                snapshot = [.. _events];
            }

            Directory.CreateDirectory(LogDirectory);
            var output = new StringBuilder("utc,event,value\r\n");
            foreach (var (time, eventName, value) in snapshot)
            {
                output.Append(time.ToString("O", CultureInfo.InvariantCulture))
                    .Append(',').Append(Csv(eventName))
                    .Append(',').Append(Csv(value))
                    .Append("\r\n");
            }

            File.WriteAllText(LogPath, output.ToString(), Encoding.UTF8);
        }
        catch (Exception error)
        {
            Trace.WriteLine($"Unable to write Native Host PoC diagnostics: {error}");
        }
    }

    private static string Csv(string value)
    {
        return $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
    }
}
