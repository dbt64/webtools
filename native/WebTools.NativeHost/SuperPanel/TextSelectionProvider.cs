using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.CompilerServices;
using System.Text;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>Selection ranges only, resolved inside one foreground UIA hierarchy. No document/value/Clipboard fallback.</summary>
internal sealed class TextSelectionProvider
{
    private const int AncestorDepthLimit = 8;
    private const int DescendantDepthLimit = 4;
    private const int CandidateNodeLimit = 96;
    private const int PatternCandidateLimit = 12;
    private const int OwnershipDepthLimit = 32;
    private const int SelectionRangeLimit = 8;
    private const int SelectedRangeChildLimit = 32;
    private const int MaximumTextCharacters = 3000;
    private const int ResolutionBudgetMilliseconds = 500;
    private const int CaptureBudgetMilliseconds = 650;
    private const int CandidateDiagnosticLimit = 6;
    private const int TextPattern2PatternId = 10024;
    private readonly IntPtr _foreground;
    private readonly uint _processId;
    private readonly SelectionDiagnosticAttempt? _attempt;
    private readonly long _captureStarted, _resolutionStarted;
    private readonly HashSet<string> _inspected = new(StringComparer.Ordinal);
    private AutomationElement? _root;
    private int _nodesInspected, _patternCandidates, _diagnosticCandidates, _descendantNodes, _subtreeFailures;
    private bool _sensitiveSelection;
    private int _ownerDiagnosticCount;
    private CaptureInvocation? _invocation;
    private AutomationElement? _focused;
    private bool _candidateIsFocusedOwner;
    private bool _candidateMayBeProxy;
    private bool _focusedEditEmpty;
    private SelectionCaptureOutcome _lastOutcome = SelectionCaptureOutcome.ProviderMissing;
    private readonly Dictionary<AutomationElement, string> _runtimeKeys = new(ReferenceEqualityComparer.Instance);
    private readonly HashSet<string> _emptyDocuments = new(StringComparer.Ordinal);
    private string _lastReason = "UIA_TEXT_PATTERN_UNAVAILABLE";

    private TextSelectionProvider(IntPtr foreground, uint processId, SelectionDiagnosticAttempt? attempt, long captureStarted)
    { _foreground = foreground; _processId = processId; _attempt = attempt; _captureStarted = captureStarted; _resolutionStarted = Stopwatch.GetTimestamp(); }

    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static SelectionCaptureResult Capture(IntPtr foreground, uint processId,
        SelectionDiagnosticAttempt? attempt, long captureStarted, CaptureInvocation? invocation = null)
    {
        var provider = new TextSelectionProvider(foreground, processId, attempt, captureStarted) { _invocation = invocation };
        return provider.Capture();
    }

    private SelectionCaptureResult Capture()
    {
        _attempt?.Record("TEXT_CAPTURE_STARTED", "STARTED", timestamp: _resolutionStarted,
            ("provider", "UIAutomation"), ("uiaProviderStartedUtc", DateTimeOffset.UtcNow.ToString("O")));
        _attempt?.Record("TEXT_PROVIDER_RESOLUTION_STARTED", "STARTED", timestamp: _resolutionStarted,
            ("ancestorDepthLimit", AncestorDepthLimit.ToString()), ("descendantDepthLimit", DescendantDepthLimit.ToString()),
            ("candidateNodeLimit", CandidateNodeLimit.ToString()), ("patternCandidateLimit", PatternCandidateLimit.ToString()),
            ("ownershipDepthLimit", OwnershipDepthLimit.ToString()), ("resolutionBudgetMs", ResolutionBudgetMilliseconds.ToString()));
        try
        {
            _root = AutomationElement.FromHandle(_foreground);
            // PID validates the actual top-level HWND. Descendant ownership is established by ancestry, not a PID-only filter.
            if (_root is null || _root.Current.ProcessId != _processId
                || unchecked((uint)_root.Current.NativeWindowHandle) != unchecked((uint)_foreground.ToInt64()))
                return Failed("UIA_FOREGROUND_ROOT_UNAVAILABLE");
            var focused = _focused = AutomationElement.FocusedElement;
            if (focused is null) return Failed("UIA_FOCUSED_ELEMENT_UNAVAILABLE");
            var focusedInfo = focused.Current;
            var processMatches = focusedInfo.ProcessId == _processId;
            _attempt?.Record("UIA_FOCUSED_ELEMENT", "FOUND", timestamp: Stopwatch.GetTimestamp(),
                ("focusedElementAvailable", "true"), ("controlType", focusedInfo.ControlType?.ProgrammaticName ?? "unknown"),
                ("frameworkId", focusedInfo.FrameworkId ?? "unknown"), ("isPassword", Bool(focusedInfo.IsPassword)));
            _attempt?.Record("UIA_PROCESS_MATCH", processMatches ? "MATCH" : "MISMATCH", timestamp: Stopwatch.GetTimestamp(),
                ("focusedProcessMatch", Bool(processMatches)));
            if (!IsOwnedAndUnprotected(focused, out var focusedReason)) return Failed(focusedReason);
            _attempt?.Record("UIA_APPLICATION_OWNERSHIP", "ACCEPTED", timestamp: Stopwatch.GetTimestamp(),
                ("applicationOwnership", "foreground-hierarchy"), ("focusedProcessMatch", Bool(processMatches)));

            var result = TryCandidate(focused, "direct", 0, ownershipVerified: true);
            if (result is not null) return result;

            // An action control without TextPattern is not a request to inspect the
            // document behind it. Text/Custom/Group/Pane remain discovery-capable.
            if (IsActionControl(focusedInfo.ControlType)
                && _lastOutcome is (SelectionCaptureOutcome.ProviderMissing or SelectionCaptureOutcome.ConfirmedEmpty))
                return Failed(_lastOutcome == SelectionCaptureOutcome.ConfirmedEmpty ? "UIA_SELECTION_EMPTY" : "UIA_TEXT_PATTERN_UNAVAILABLE");
            if (_lastOutcome == SelectionCaptureOutcome.ProviderMissing && Automation.Compare(focused, _root)
                && (focusedInfo.ControlType == ControlType.Window || focusedInfo.ControlType == ControlType.Pane))
                return Failed("UIA_TEXT_PATTERN_UNAVAILABLE");

            // RawView retains intermediary text owners omitted by ControlView, including
            // focus-proxy containers. Inspect ancestors themselves, never their unrelated
            // sibling subtrees or the entire foreground window.
            var ancestor = focused;
            for (var depth = 1; depth <= AncestorDepthLimit && CanContinue() && !Automation.Compare(ancestor, _root); depth++)
            {
                var parent = TreeWalker.RawViewWalker.GetParent(ancestor);
                if (parent is null || Automation.Compare(parent, ancestor)) break;
                if (Automation.Compare(parent, _root)) break;
                if (!IsOwnedAndUnprotected(parent, out var reason)) { _lastReason = reason; break; }
                ancestor = parent;
                result = TryCandidate(ancestor, "ancestor", depth, ownershipVerified: true);
                if (result is not null) return result;
                // A document is the semantic boundary for its embedded focus proxy;
                // walking into the surrounding window chrome adds unrelated providers.
                if (ancestor.Current.ControlType == ControlType.Document) break;
            }

            // A focused leaf has no descendant text owner to discover. Structural focus
            // and editor proxies can still expose text through bounded RawView children.
            var expanded = new HashSet<string>(StringComparer.Ordinal);
            var queue = new Queue<(AutomationElement Element, int Depth, bool EmptyDocument)>();
            queue.Enqueue((focused, 0, false));
            while (queue.Count > 0 && CanContinue() && _descendantNodes < CandidateNodeLimit)
            {
                var (element, depth, emptyDocument) = queue.Dequeue();
                _descendantNodes++;
                try
                {
                    var key = ElementKey(element);
                    if (!expanded.Add(key)) continue;
                    var info = element.Current;
                    // Do not collect a retained selection from another independently
                    // focusable input inside a structural page/window focus.
                    if (depth > 0 && !info.HasKeyboardFocus
                        && (IsActionControl(info.ControlType) || info.ControlType == ControlType.Edit && info.IsKeyboardFocusable)) continue;
                    // A document's empty selection already covers its ordinary text
                    // leaves. Continue through containers/embedded providers, but do not
                    // ask every static label for the same empty selection again.
                    if (!(emptyDocument && info.ControlType == ControlType.Text))
                    {
                        if (!IsOwnedAndUnprotected(element, out _)) continue;
                        result = TryCandidate(element, "descendant", depth, ownershipVerified: true);
                        if (result is not null) return result;
                    }
                    if (info.IsPassword) continue;
                    if (info.IsOffscreen || depth >= DescendantDepthLimit || !CanContinue()) continue;
                    var childrenCovered = info.ControlType == ControlType.Document ? _emptyDocuments.Contains(key)
                        : info.ControlType == ControlType.Custom || info.ControlType == ControlType.Edit ? false : emptyDocument;
                    var child = TreeWalker.RawViewWalker.GetFirstChild(element);
                    while (child is not null && CanContinue() && _descendantNodes + queue.Count < CandidateNodeLimit)
                    {
                        queue.Enqueue((child, depth + 1, childrenCovered));
                        child = TreeWalker.RawViewWalker.GetNextSibling(child);
                    }
                }
                catch (Exception error)
                {
                    if (++_subtreeFailures <= 2) RecordException(error, "UIA_SUBTREE_UNAVAILABLE");
                }
            }
            if (_sensitiveSelection) return Failed("PASSWORD_CONTROL");
            if (!WithinTimeAndForeground(out var stopReason)) _lastReason = stopReason;
            else if (!Automation.Compare(focused, AutomationElement.FocusedElement)) _lastReason = "CAPTURE_FOCUS_CHANGED";
            else if (_nodesInspected >= CandidateNodeLimit || _patternCandidates >= PatternCandidateLimit || _descendantNodes >= CandidateNodeLimit)
                _lastReason = "UIA_RESOLUTION_LIMIT";
            else if (_focusedEditEmpty) _lastReason = "UIA_SELECTION_EMPTY";
            return Failed(_lastReason);
        }
        catch (Exception error)
        {
            RecordException(error, "UIA_PROVIDER_EXCEPTION");
            return Failed("UIA_PROVIDER_EXCEPTION");
        }
    }

    private static bool IsActionControl(ControlType type) => type == ControlType.Button || type == ControlType.CheckBox
        || type == ControlType.RadioButton || type == ControlType.MenuItem || type == ControlType.TabItem
        || type == ControlType.ScrollBar || type == ControlType.Slider;

    private SelectionCaptureResult? TryCandidate(AutomationElement element, string strategy, int depth, bool ownershipVerified = false)
    {
        if (!CanContinue() || !_inspected.Add(ElementKey(element))) return null;
        _nodesInspected++;
        _candidateIsFocusedOwner = false;
        _candidateMayBeProxy = false;
        var detail = strategy == "direct" || _diagnosticCandidates < CandidateDiagnosticLimit;
        try
        {
            string reason;
            if (!ownershipVerified && !IsOwnedAndUnprotected(element, out reason)) return RejectCandidate(reason, strategy, depth, detail, 0, 0);
            var info = element.Current;
            _candidateMayBeProxy = strategy == "direct" && info.ControlType == ControlType.Edit
                && (info.NativeWindowHandle == 0 || info.IsOffscreen);
            // The actual focused Edit can be an offscreen accessibility proxy. Its
            // GetSelection is still meaningful; unrelated offscreen nodes are excluded.
            if (info.IsOffscreen && strategy != "direct") return null;
            if (!element.TryGetCurrentPattern(TextPattern.Pattern, out var value) || value is not TextPattern pattern)
            {
                if (strategy == "direct")
                    _attempt?.Record("UIA_TEXT_PATTERN_UNAVAILABLE", "UNAVAILABLE", "UIA_TEXT_PATTERN_UNAVAILABLE", timestamp: Stopwatch.GetTimestamp(),
                        ("resolutionStrategy", strategy), ("textPatternAvailable", "false"),
                        ("textPattern2Available", ProbePattern2(element)), ("valuePatternAvailable", ProbePattern(element, ValuePattern.Pattern)));
                _lastOutcome = SelectionCaptureOutcome.ProviderMissing;
                return null;
            }
            _patternCandidates++;
            if (pattern.SupportedTextSelection == SupportedTextSelection.None)
            { _lastOutcome = SelectionCaptureOutcome.ProviderMissing; return null; }
            _candidateIsFocusedOwner = strategy == "direct" && info.HasKeyboardFocus
                && (info.ControlType == ControlType.Edit || info.ControlType == ControlType.Document);
            if (detail)
            {
                _diagnosticCandidates++;
                var stage = strategy switch { "direct" => "DIRECT_PATTERN_FOUND", "ancestor" => "ANCESTOR_PATTERN_FOUND", _ => "DESCENDANT_PATTERN_FOUND" };
                _attempt?.Record(stage, "FOUND", timestamp: Stopwatch.GetTimestamp(),
                    ("resolutionStrategy", strategy), ("resolutionDepth", depth.ToString()), ("candidatesInspected", _nodesInspected.ToString()),
                    ("resolvedControlType", info.ControlType?.ProgrammaticName ?? "unknown"), ("resolvedFrameworkId", info.FrameworkId ?? "unknown"),
                    ("candidateProcessMatch", Bool(info.ProcessId == _processId)), ("textPatternAvailable", "true"),
                    ("textPattern2Available", ProbePattern2(element)), ("valuePatternAvailable", ProbePattern(element, ValuePattern.Pattern)));
            }
            if (!WithinTimeAndForeground(out reason)) { _lastReason = reason; return null; }
            var ranges = pattern.GetSelection();
            var rangeCount = ranges?.Length ?? 0;
            var collapsed = new HashSet<TextPatternRange>(ReferenceEqualityComparer.Instance);
            foreach (var range in (ranges ?? []).Take(SelectionRangeLimit))
            {
                if (!WithinTimeAndForeground(out reason)) return RejectCandidate(reason, strategy, depth, detail, rangeCount, 0);
                if (range.CompareEndpoints(TextPatternRangeEndpoint.Start, range, TextPatternRangeEndpoint.End) == 0) collapsed.Add(range);
            }
            _attempt?.Record("SELECTION_RANGE_SHAPE", "OBSERVED", ("rangeShape", rangeCount == 0 ? "empty" : collapsed.Count == rangeCount ? "degenerate" : "non-empty"), ("resolutionStrategy", strategy));
            if (!_candidateIsFocusedOwner && rangeCount > 0 && collapsed.Count == rangeCount
                && (info.ControlType == ControlType.Document || info.ControlType == ControlType.Edit))
            {
                var related = true;
                foreach (var range in collapsed)
                {
                    var enclosing = range.GetEnclosingElement();
                    if (enclosing is null || !IsOwnedAndUnprotected(enclosing, out _, "caret-enclosing") || !IsWithinFocused(enclosing))
                    { related = false; break; }
                }
                var currentFocus = _focused is not null && _focused.Current.HasKeyboardFocus
                    && Automation.Compare(_focused, AutomationElement.FocusedElement);
                _candidateIsFocusedOwner = TextCandidateDecision.CanUseScopedCaretAuthority(true, true, related, related, currentFocus);
                _attempt?.Record("CARET_OWNER_RELATION", "OBSERVED", ("focusRelation", related ? "focused-subtree" : "unverified"));
            }
            if (rangeCount == 0 || collapsed.Count == rangeCount)
            {
                if (info.ControlType == ControlType.Document) _emptyDocuments.Add(ElementKey(element));
                return RejectCandidate("UIA_SELECTION_EMPTY", strategy, depth, detail, rangeCount, 0);
            }
            var output = new StringBuilder(256);
            var limited = rangeCount > SelectionRangeLimit;
            foreach (var range in ranges!.Take(SelectionRangeLimit))
            {
                if (collapsed.Contains(range)) continue;
                if (!WithinTimeAndForeground(out reason)) return RejectCandidate(reason, strategy, depth, detail, rangeCount, output.Length);
                if (!IsRangeUnprotected(range, out reason))
                {
                    if (reason == "PASSWORD_CONTROL") _sensitiveSelection = true;
                    return RejectCandidate(reason, strategy, depth, detail, rangeCount, output.Length);
                }
                if (!IsSelectionFocusRelated(pattern, range, strategy))
                    return RejectCandidate("UIA_SELECTION_FOCUS_UNRELATED", strategy, depth, detail, rangeCount, 0);
                var remaining = MaximumTextCharacters - output.Length - (output.Length > 0 ? 1 : 0);
                if (remaining <= 0) { limited = true; break; }
                var selectedText = range.GetText(remaining);
                if (!WithinTimeAndForeground(out reason)) return RejectCandidate(reason, strategy, depth, detail, rangeCount, output.Length);
                if (string.IsNullOrEmpty(selectedText)) continue; // Caret-only ranges are not selections.
                if (selectedText.Length >= remaining) { selectedText = selectedText[..remaining]; limited = true; }
                if (output.Length > 0) output.Append('\n');
                output.Append(selectedText);
                if (limited && output.Length == MaximumTextCharacters) break;
            }
            var text = output.ToString();
            if (text.Length > 0 && char.IsHighSurrogate(text[^1])) text = text[..^1];
            if (string.IsNullOrWhiteSpace(text)) return RejectCandidate("UIA_SELECTION_EMPTY", strategy, depth, detail, rangeCount, text.Length);
            _attempt?.Record("TEXT_PROVIDER_RESOLVED", "SUCCESS", timestamp: Stopwatch.GetTimestamp(),
                ("resolutionStrategy", strategy), ("resolutionDepth", depth.ToString()), ("candidatesInspected", _nodesInspected.ToString()),
                ("patternCandidates", _patternCandidates.ToString()), ("selectionRangeCount", rangeCount.ToString()), ("characterCount", text.Length.ToString()),
                ("resolvedControlType", info.ControlType?.ProgrammaticName ?? "unknown"), ("resolvedFrameworkId", info.FrameworkId ?? "unknown"));
            if (_focused is null || !Automation.Compare(_focused, AutomationElement.FocusedElement))
                return RejectCandidate("CAPTURE_FOCUS_CHANGED", strategy, depth, detail, rangeCount, 0);
            var result = SelectionCapturePayloads.FromSelectedText(text, limited, _attempt);
            return result with { Outcome = result.Context.Mode == SurfaceContextMode.SelectedText ? SelectionCaptureOutcome.SelectedText : SelectionCaptureOutcome.SafetyRejected };
        }
        catch (Exception error)
        {
            _lastReason = "UIA_CANDIDATE_EXCEPTION";
            if (detail) { _diagnosticCandidates++; RecordException(error, _lastReason); }
            return RejectCandidate(_lastReason, strategy, depth, detail, 0, 0);
        }
    }

    private SelectionCaptureResult? RejectCandidate(string reason, string strategy, int depth, bool detail, int rangeCount, int characterCount)
    {
        _lastReason = reason;
        _lastOutcome = OutcomeForReason(reason);
        if (detail)
            _attempt?.Record("TEXT_PROVIDER_CANDIDATE_REJECTED", "REJECTED", reason, timestamp: Stopwatch.GetTimestamp(),
                ("resolutionStrategy", strategy), ("resolutionDepth", depth.ToString()), ("candidatesInspected", _nodesInspected.ToString()),
                ("selectionRangeCount", rangeCount.ToString()), ("characterCount", characterCount.ToString()));
        // A focused Edit may be a caret-only proxy for an ancestor/embedded editor.
        // Preserve its empty result, but inspect the local owner topology before accepting it.
        if (_lastOutcome == SelectionCaptureOutcome.ConfirmedEmpty && _candidateMayBeProxy)
        { _focusedEditEmpty = true; return null; }
        if (_lastOutcome == SelectionCaptureOutcome.ConfirmedEmpty && _focusedEditEmpty) return null;
        if (TextCandidateDecision.ShouldStop(_lastOutcome, _candidateIsFocusedOwner))
        {
            if (_lastOutcome == SelectionCaptureOutcome.ConfirmedEmpty
                && (_focused is null || !Automation.Compare(_focused, AutomationElement.FocusedElement))) return Failed("CAPTURE_FOCUS_CHANGED");
            return Failed(reason);
        }
        return null;
    }

    private static SelectionCaptureOutcome OutcomeForReason(string reason) => reason switch
    {
        "UIA_SELECTION_EMPTY" => SelectionCaptureOutcome.ConfirmedEmpty,
        "UIA_RESOLUTION_BUDGET_EXHAUSTED" => SelectionCaptureOutcome.TimedOut,
        "CAPTURE_CANCELLED" or "CAPTURE_FOCUS_CHANGED" or "CAPTURE_FOREGROUND_CHANGED" => SelectionCaptureOutcome.Cancelled,
        "UIA_TEXT_PATTERN_UNAVAILABLE" => SelectionCaptureOutcome.ProviderMissing,
        _ when reason.StartsWith("UIA_OWNER", StringComparison.Ordinal) || reason == "PASSWORD_CONTROL"
            || reason.Contains("BOUNDARY", StringComparison.Ordinal) || reason.Contains("SAFETY", StringComparison.Ordinal) => SelectionCaptureOutcome.SafetyRejected,
        _ => SelectionCaptureOutcome.Unavailable,
    };

    private bool IsSelectionFocusRelated(TextPattern pattern, TextPatternRange selection, string strategy)
    {
        if (_focused is null || !WithinTimeAndForeground(out _)) return false;
        if (strategy == "direct") return true;
        var enclosing = selection.GetEnclosingElement();
        if (enclosing is not null && IsWithinFocused(enclosing, rejectOtherInputs: true)) return true;
        // An ancestor provider may own the real selection for an embedded focused
        // proxy. RangeFromChild is only an ownership/endpoint probe: never read its text.
        // The selected range must intersect that child's range (or include its caret).
        try
        {
            var focusRange = pattern.RangeFromChild(_focused);
            if (focusRange is null || !WithinTimeAndForeground(out _)) return false;
            var caret = focusRange.CompareEndpoints(TextPatternRangeEndpoint.Start, focusRange, TextPatternRangeEndpoint.End) == 0;
            var start = selection.CompareEndpoints(TextPatternRangeEndpoint.Start, focusRange, TextPatternRangeEndpoint.End);
            var end = selection.CompareEndpoints(TextPatternRangeEndpoint.End, focusRange, TextPatternRangeEndpoint.Start);
            return caret ? start <= 0 && end >= 0 : start < 0 && end > 0;
        }
        catch (InvalidOperationException) { return false; }
        catch (ArgumentException) { return false; }
        catch (ElementNotAvailableException) { return false; }
        catch (COMException) { return false; }
    }

    private bool IsRangeUnprotected(TextPatternRange range, out string reason)
    {
        reason = "UIA_SELECTION_OWNER_UNAVAILABLE";
        var enclosing = range.GetEnclosingElement();
        if (enclosing is null || !IsOwnedAndUnprotected(enclosing, out reason, "range-enclosing"))
        { reason = enclosing is null ? "UIA_SELECTION_OWNER_UNAVAILABLE" : reason; return false; }
        // Inspect embedded controls in the selected range before GetText, without reading names or values.
        var children = range.GetChildren();
        if (children.Length > SelectedRangeChildLimit) { reason = "UIA_SELECTION_SAFETY_LIMIT"; return false; }
        foreach (var child in children)
            if (!IsOwnedAndUnprotected(child, out reason, "range-child")) return false;
        reason = "";
        return true;
    }

    private bool IsOwnedAndUnprotected(AutomationElement element, out string reason, string scope = "candidate")
    {
        reason = "UIA_OWNERSHIP_UNVERIFIED";
        var current = element;
        // RawView is ancestor-only here so a password container omitted by ControlView cannot be bypassed.
        for (var depth = 0; depth <= OwnershipDepthLimit; depth++)
        {
            if (!WithinTimeAndForeground(out reason)) return false;
            var info = current.Current;
            if (info.IsPassword) { reason = "PASSWORD_CONTROL"; return RecordOwnership(false, reason, depth, scope); }
            if (info.ProcessId <= 0 || info.ProcessId == Environment.ProcessId)
            { reason = "UIA_APPLICATION_BOUNDARY_REJECTED"; return RecordOwnership(false, reason, depth, scope); }
            if (info.NativeWindowHandle != 0)
            {
                var hwnd = new IntPtr(info.NativeWindowHandle);
                if (GetAncestor(hwnd, 2) != _foreground) { reason = "UIA_OWNER_FOREGROUND_ROOT_MISMATCH"; return RecordOwnership(false, reason, depth, scope); }
            }
            if (Automation.Compare(current, _root!)) { reason = ""; return RecordOwnership(true, "ROOT_REACHED", depth, scope); }
            var parent = TreeWalker.RawViewWalker.GetParent(current);
            if (parent is null) { reason = "UIA_OWNER_PARENT_UNAVAILABLE"; return RecordOwnership(false, reason, depth, scope); }
            if (Automation.Compare(current, parent)) { reason = "UIA_OWNER_SELF_PARENT"; return RecordOwnership(false, reason, depth, scope); }
            current = parent;
        }
        reason = "UIA_OWNER_DEPTH_EXHAUSTED";
        return RecordOwnership(false, reason, OwnershipDepthLimit, scope);
    }

    private bool RecordOwnership(bool accepted, string reason, int depth, string scope)
    {
        if (_ownerDiagnosticCount++ < 10)
            _attempt?.Record("OWNER_VALIDATION", accepted ? "ACCEPTED" : "REJECTED", reason,
                ("ownerScope", scope), ("ownerDepth", depth.ToString()), ("ownerTermination", reason));
        return accepted;
    }

    private bool IsWithinFocused(AutomationElement element, bool rejectOtherInputs = false)
    {
        var current = element;
        for (var depth = 0; depth <= AncestorDepthLimit && WithinTimeAndForeground(out _); depth++)
        {
            if (_focused is not null && Automation.Compare(current, _focused)) return true;
            if (_root is not null && Automation.Compare(current, _root)) return false;
            if (rejectOtherInputs)
            {
                var info = current.Current;
                if (info.ControlType == ControlType.Edit && info.IsKeyboardFocusable && !info.HasKeyboardFocus) return false;
            }
            var parent = TreeWalker.RawViewWalker.GetParent(current);
            if (parent is null || Automation.Compare(current, parent)) return false;
            current = parent;
        }
        return false;
    }

    private bool CanContinue() => !_sensitiveSelection && _nodesInspected < CandidateNodeLimit
        && _patternCandidates < PatternCandidateLimit && WithinTimeAndForeground(out _);

    private bool WithinTimeAndForeground(out string reason)
    {
        if (_invocation?.Token.IsCancellationRequested == true) { reason = "CAPTURE_CANCELLED"; return false; }
        if (GetForegroundWindow() != _foreground) { reason = "CAPTURE_FOREGROUND_CHANGED"; return false; }
        if (Stopwatch.GetElapsedTime(_resolutionStarted).TotalMilliseconds >= ResolutionBudgetMilliseconds
            || Stopwatch.GetElapsedTime(_captureStarted).TotalMilliseconds >= CaptureBudgetMilliseconds)
        { reason = "UIA_RESOLUTION_BUDGET_EXHAUSTED"; return false; }
        reason = "";
        return true;
    }

    private SelectionCaptureResult Failed(string reason)
    {
        _attempt?.Record("TEXT_PROVIDER_RESOLUTION_FAILED", "FAILED", reason, timestamp: Stopwatch.GetTimestamp(),
            ("candidatesInspected", _nodesInspected.ToString()), ("patternCandidates", _patternCandidates.ToString()),
            ("descendantNodesInspected", _descendantNodes.ToString()), ("subtreeFailures", _subtreeFailures.ToString()));
        _attempt?.Record("TEXT_PROVIDER_COMPLETED", "FAILED", reason);
        return new(SelectionContext.None("该应用未提供可安全读取的选择 · 剪贴板保持不变"), reason, Outcome: OutcomeForReason(reason));
    }

    private string ProbePattern2(AutomationElement element)
    {
        if (_attempt is null) return "unknown";
        try
        {
            // This target uses the managed TextPattern wrapper. TextPattern2 inherits selection semantics;
            // its caret/annotation extensions and ValuePattern must not manufacture a selection.
            var pattern = AutomationPattern.LookupById(TextPattern2PatternId);
            return pattern is null ? "unknown" : ProbePattern(element, pattern);
        }
        catch { return "unknown"; }
    }

    private string ProbePattern(AutomationElement element, AutomationPattern pattern)
    {
        if (_attempt is null) return "unknown";
        try { return Bool(element.TryGetCurrentPattern(pattern, out _)); }
        catch { return "unknown"; }
    }

    private void RecordException(Exception error, string reason) => _attempt?.Record("UIA_EXCEPTION", "FAILED", reason,
        timestamp: Stopwatch.GetTimestamp(), ("exceptionType", error.GetType().Name), ("hresult", $"0x{error.HResult:X8}"));

    private string ElementKey(AutomationElement element)
    {
        if (_runtimeKeys.TryGetValue(element, out var existing)) return existing;
        var id = element.GetRuntimeId();
        if (id is null || id.Length is < 1 or > 32) throw new InvalidOperationException("UIA runtime identity unavailable.");
        var key = string.Join(":", id); // Invocation-local metadata only.
        if (_runtimeKeys.Count < CandidateNodeLimit) _runtimeKeys[element] = key;
        return key;
    }
    private static string Bool(bool value) => value ? "true" : "false";
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
}
