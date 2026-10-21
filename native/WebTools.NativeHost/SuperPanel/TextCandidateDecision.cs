namespace WebTools.NativeHost.SuperPanel;

internal enum SelectionCaptureOutcome
{
    SelectedText, SelectedContext, ConfirmedEmpty, ProviderMissing, SafetyRejected, Unavailable, TimedOut, Cancelled,
}

internal static class TextCandidateDecision
{
    internal static bool CanUseScopedCaretAuthority(bool textContainer, bool genuineCaret, bool ownerVerified,
        bool insideFocusedSubtree, bool focusStillCurrent) =>
        textContainer && genuineCaret && ownerVerified && insideFocusedSubtree && focusStillCurrent;
    internal static bool ShouldStop(SelectionCaptureOutcome outcome, bool focusedTextOwner) => outcome switch
    {
        SelectionCaptureOutcome.SelectedText or SelectionCaptureOutcome.TimedOut or SelectionCaptureOutcome.Cancelled => true,
        SelectionCaptureOutcome.ConfirmedEmpty or SelectionCaptureOutcome.SafetyRejected => focusedTextOwner,
        _ => false,
    };
}
