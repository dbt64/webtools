using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace WebTools.NativeHost.Services;

internal sealed class DiagnosticsService
{
    private const int SummarySampleCount = 30;
    private const int MaxEvents = 2000;
    private const int MaxSelectionEvents = 512;
    private const int MaxSelectionEventsPerAttempt = 48;
    private const int MaxSelectionEventJsonLength = 1024;
    private const int MaxSelectionFields = 24;
    private const int MaxSelectionFieldLength = 80;
    private static readonly JsonSerializerOptions SelectionJsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly HashSet<string> SelectionFieldAllowlist = new(StringComparer.Ordinal)
    {
        "triggerButton", "gesture", "triggerReceivedUtc", "holdElapsedUtc", "dispatcherUtc", "triggerToDispatcherMs",
        "intentGeneration", "foregroundHwnd", "foregroundPid", "foregroundProcess", "isNativeHost", "foregroundWindowClass",
        "snapshotUtc", "shellEnumeration", "shellWindowsCandidateCount", "shellCandidatesEnumerated", "matchingHwndCandidateCount",
        "candidateIndex", "documentAvailable", "activeTabIdentity", "selectedItemsCall", "selectedItemsCount", "itemsProcessed",
        "filesystemItemCount", "fileCount", "directoryCount", "invalidItemCount", "currentFolderMetadataAvailable",
        "protocolValidation", "validationReason", "focusedElementAvailable", "focusedProcessMatch", "controlType", "frameworkId",
        "isPassword", "textPatternAvailable", "textPattern2Available", "valuePatternAvailable", "selectionCall",
        "selectionRangeCount", "characterCount", "workerStartedUtc", "explorerProviderStartedUtc", "uiaProviderStartedUtc",
        "providerCompletedUtc", "timeoutOccurred", "timeoutElapsedMs", "workerCompletedAfterTimeout", "workerTotalMs",
        "foregroundMatchesInitial", "initialHwnd", "currentHwnd", "blockedByAttemptId", "captureResult", "itemCount", "mode",
        "visualRoot", "matchedFeatureCount", "exceptionType", "hresult", "reasonCode", "workerStillRunning",
        "captureAccepted", "resultAvailable", "isFileSystem", "pathValidation", "holdThresholdMs", "provider",
        "workerStarted", "captureDurationMs", "intentDiscarded", "protocolEnvelopeBytes",
        "resolutionStrategy", "resolutionDepth", "candidatesInspected", "resolvedControlType", "resolvedFrameworkId",
        "applicationOwnership", "candidateProcessMatch", "patternCandidates", "descendantNodesInspected",
        "ancestorDepthLimit", "descendantDepthLimit", "candidateNodeLimit", "patternCandidateLimit", "ownershipDepthLimit",
        "resolutionBudgetMs", "desktopViewVerified", "desktopStage", "subtreeFailures"
        , "clipboardUpdated", "clipboardOwnerMatch", "clipboardRestoration", "copyInjected",
        "ownerScope", "ownerDepth", "ownerTermination", "rangeShape", "captureOutcome", "cancelled",
        "focusRelation", "providerStage", "renderProxy", "activeWorkerCount", "ownershipCacheHits"
    };
    private static readonly Regex SafeDiagnosticCode = new("^[A-Za-z0-9_.-]{1,64}$", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private readonly object _sync = new();
    private readonly long _startupTimestamp;
    private readonly List<(DateTimeOffset Time, string Event, string Value)> _events = [];
    private readonly List<SelectionDiagnosticEvent> _selectionEvents = [];
    private int _selectionAttemptSequence;
    public bool SelectionDiagnosticsEnabled { get; set; }
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

    public SelectionDiagnosticAttempt? BeginSelectionAttempt(
        string triggerButton,
        string gesture,
        long triggerTimestamp,
        DateTimeOffset triggerTimestampUtc,
        long activationTimestamp,
        DateTimeOffset activationTimestampUtc)
    {
        if (!SelectionDiagnosticsEnabled) return null;
        var id = $"SP-{Interlocked.Increment(ref _selectionAttemptSequence):D4}";
        return new SelectionDiagnosticAttempt(this, id, triggerButton, gesture,
            triggerTimestamp, triggerTimestampUtc, activationTimestamp, activationTimestampUtc);
    }

    internal IReadOnlyList<SelectionDiagnosticEvent> SelectionSnapshot()
    { lock (_sync) return _selectionEvents.ToArray(); }

    internal void RecordSelectionEvent(SelectionDiagnosticEvent value)
    {
        if (!SafeDiagnosticCode.IsMatch(value.AttemptId)
            || !SafeDiagnosticCode.IsMatch(value.Stage)
            || !SafeDiagnosticCode.IsMatch(value.Result)
            || (value.ReasonCode is not null && !SafeDiagnosticCode.IsMatch(value.ReasonCode))) return;

        var fields = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var field in value.Fields.Take(MaxSelectionFields))
        {
            if (!SelectionFieldAllowlist.Contains(field.Key) || field.Value is null) continue;
            var safe = SanitizeSelectionField(field.Value);
            if (safe is not null) fields[field.Key] = safe;
        }

        var safeEvent = value with
        {
            ElapsedMilliseconds = double.IsFinite(value.ElapsedMilliseconds) ? Math.Clamp(value.ElapsedMilliseconds, 0, 86_400_000) : 0,
            Fields = fields
        };
        var serialized = JsonSerializer.Serialize(safeEvent, SelectionJsonOptions);
        while (serialized.Length > MaxSelectionEventJsonLength && fields.Count > 0)
        {
            fields.Remove(fields.Keys.Last());
            serialized = JsonSerializer.Serialize(safeEvent with { Fields = fields }, SelectionJsonOptions);
        }
        if (serialized.Length > MaxSelectionEventJsonLength) return;

        lock (_sync)
        {
            var perAttempt = _selectionEvents.Count(entry => entry.AttemptId == safeEvent.AttemptId);
            var terminal = IsSelectionTerminal(safeEvent.Stage);
            // Keep room for completion/cancellation/presentation evidence after discovery detail.
            if (!terminal && perAttempt >= MaxSelectionEventsPerAttempt - 8) return;
            if (perAttempt >= MaxSelectionEventsPerAttempt)
            {
                var replace = _selectionEvents.FindIndex(entry => entry.AttemptId == safeEvent.AttemptId && !IsSelectionTerminal(entry.Stage));
                if (replace < 0) return;
                _selectionEvents.RemoveAt(replace);
            }
            _selectionEvents.Add(safeEvent with { Fields = fields });
            if (_selectionEvents.Count > MaxSelectionEvents)
                _selectionEvents.RemoveRange(0, _selectionEvents.Count - MaxSelectionEvents);
            _events.Add((safeEvent.TimestampUtc, "super_panel_selection", serialized));
            if (_events.Count > MaxEvents) _events.RemoveRange(0, _events.Count - MaxEvents);
        }
    }

    private static string? SanitizeSelectionField(string value)
    {
        if (value.Length > MaxSelectionFieldLength) value = value[..MaxSelectionFieldLength];
        value = value.Trim();
        if (value.Length == 0 || value.Contains('/') || value.Contains('\\') || value.Any(char.IsControl)) return null;
        if (value.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is ' ' or '_' or '.' or '-' or ':' or '=' or '+' or '#')))
            return null;
        return value;
    }

    private static bool IsSelectionTerminal(string stage) => stage is "CAPTURE_COMPLETED" or "WORKER_COMPLETED"
        or "CAPTURE_CANCELLED" or "CAPTURE_TIMEOUT" or "INTENT_STALE_DISCARDED" or "PRESENTATION_SELECTED"
        or "PRESENTATION_FAILED" or "WINDOW_VISIBLE";

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

internal sealed record SelectionDiagnosticEvent(
    string AttemptId,
    DateTimeOffset TimestampUtc,
    string Stage,
    double ElapsedMilliseconds,
    string Result,
    string? ReasonCode,
    IReadOnlyDictionary<string, string?> Fields);

internal sealed record SelectionDiagnosticFooterState(
    string AttemptId,
    string CaptureResult,
    string? ReasonCode,
    bool WorkerRunning,
    string Mode,
    string VisualRoot,
    int MatchedFeatureCount);

internal sealed class SelectionDiagnosticAttempt
{
    private readonly DiagnosticsService _diagnostics;
    private readonly long _startTimestamp;
    private readonly object _sync = new();
    private string _captureResult = "Pending";
    private string? _reasonCode;
    private bool _workerRunning;
    private string _mode = "Pending";
    private string _visualRoot = "Pending";
    private int _matchedFeatureCount;

    internal SelectionDiagnosticAttempt(
        DiagnosticsService diagnostics,
        string attemptId,
        string triggerButton,
        string gesture,
        long triggerTimestamp,
        DateTimeOffset triggerTimestampUtc,
        long activationTimestamp,
        DateTimeOffset activationTimestampUtc)
    {
        _diagnostics = diagnostics;
        AttemptId = attemptId;
        TriggerButton = triggerButton;
        Gesture = gesture;
        TriggerTimestamp = triggerTimestamp;
        TriggerTimestampUtc = triggerTimestampUtc;
        ActivationTimestamp = activationTimestamp;
        ActivationTimestampUtc = activationTimestampUtc;
        _startTimestamp = triggerTimestamp;
    }

    public string AttemptId { get; }
    public string TriggerButton { get; }
    public string Gesture { get; }
    public long TriggerTimestamp { get; }
    public DateTimeOffset TriggerTimestampUtc { get; }
    public long ActivationTimestamp { get; }
    public DateTimeOffset ActivationTimestampUtc { get; }
    public event EventHandler? Updated;

    public void Record(string stage, string result, params (string Name, string? Value)[] fields) =>
        RecordCore(stage, result, null, null, fields);

    public void Record(string stage, string result, string? reasonCode, params (string Name, string? Value)[] fields) =>
        RecordCore(stage, result, reasonCode, null, fields);

    public void Record(string stage, string result, long timestamp, params (string Name, string? Value)[] fields) =>
        RecordCore(stage, result, null, timestamp, fields);

    public void Record(string stage, string result, string? reasonCode, long timestamp, params (string Name, string? Value)[] fields) =>
        RecordCore(stage, result, reasonCode, timestamp, fields);

    private void RecordCore(string stage, string result, string? reasonCode, long? timestamp,
        (string Name, string? Value)[] fields)
    {
        try
        {
            var at = timestamp ?? System.Diagnostics.Stopwatch.GetTimestamp();
            var safeFields = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var field in fields) safeFields[field.Name] = field.Value;
            _diagnostics.RecordSelectionEvent(new SelectionDiagnosticEvent(
                AttemptId, DateTimeOffset.UtcNow, stage,
                System.Diagnostics.Stopwatch.GetElapsedTime(_startTimestamp, at).TotalMilliseconds,
                result, reasonCode, safeFields));
        }
        catch { /* Diagnostic failures must never change capture or presentation behavior. */ }
        NotifyUpdated();
    }

    public void SetCaptureState(string captureResult, string? reasonCode, bool workerRunning)
    {
        lock (_sync)
        {
            _captureResult = captureResult;
            _reasonCode = reasonCode;
            _workerRunning = workerRunning;
        }
        NotifyUpdated();
    }

    public void SetWorkerRunning(bool workerRunning)
    {
        lock (_sync) _workerRunning = workerRunning;
        NotifyUpdated();
    }

    public void SetPresentationState(string mode, string visualRoot, int matchedFeatureCount)
    {
        lock (_sync)
        {
            _mode = mode;
            _visualRoot = visualRoot;
            _matchedFeatureCount = Math.Max(0, matchedFeatureCount);
        }
        NotifyUpdated();
    }

    public SelectionDiagnosticFooterState FooterState()
    {
        lock (_sync)
            return new(AttemptId, _captureResult, _reasonCode, _workerRunning, _mode, _visualRoot, _matchedFeatureCount);
    }

    private void NotifyUpdated()
    {
        try { Updated?.Invoke(this, EventArgs.Empty); }
        catch { /* Diagnostic observers must never affect selection capture or presentation. */ }
    }
}
