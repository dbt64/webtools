# Super Panel memory optimization

## Scope and source identity

Implemented on 2026-10-13 in the existing working tree, branch `codex/shared-ai-translation-2.0`, HEAD `707c5673dff479285b34a5b441bec9d3b725c737`. The working tree already contains substantial uncommitted work; this is not a clean-HEAD build. Existing changes were preserved.

The user approved reducing panel presentation work without repeating a memory benchmark to establish whether optimization is warranted. This round changes panel presentation and panel-local icon scheduling. It does not change selection capture, clipboard handling, Launcher search/catalog, Manager, window activation, or the shared NativeIconCache.

## Implemented

1. **Ordinary shortcut board:** retain matching saved pins without allocating and sorting every available Feature. Build the complete sorted unpinned candidate list only when the user opens the add picker. The eligibility scan remains for accurate match diagnostics. Nine slots, pagination, saved ordering, and existing matching rules remain.
2. **Context actions:** combine pinned and remaining actions into one bounded, self-scrolling ListBox with a recycling VirtualizingStackPanel. Remove the outer ScrollViewer that previously allowed all rows to be realized. Preserve all matched actions and pinned-first ordering; scrolling reaches later rows.
3. **Visible icons:** subscribe when a row is loaded and visible. Release its bitmap reference and cancel its waiting subscription on unload, recycling, hide, or projection replacement. Presentation generation and subscription identity reject late results.
4. **Bounded decoding:** a panel-local loader limits active underlying icon calls to two, shares unfinished requests for the same reference, and cancels obsolete queue waits. An already-running shared decode may finish and populate the existing cache; a cancelled subscriber cannot cancel another subscriber's result. No second completed-image cache was added, and Launcher cache scheduling is untouched.

Window creation remains unchanged. Delaying creation would move initialization cost to first use; it was not included in this implementation. WPF first-display cost and the observed empty-board memory increase are not claimed to be eliminated by list virtualization.

## Files changed in this round

- `native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml`
- `native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml.cs`
- `native/WebTools.NativeHost/SuperPanel/SuperPanelFeatureSelection.cs` (new)
- `native/WebTools.NativeHost/SuperPanel/SuperPanelIconLoader.cs` (new)
- `native/WebTools.NativeHost.Checks/SuperPanelHardeningChecks.cs`
- `native/WebTools.NativeHost.Checks/SuperPanelPresentationChecks.cs` (new)
- This report.

Several parent files/directories were already untracked before this task. Their current Git status alone does not identify this round's delta; pre-edit copies were retained outside the repository.

## Functional verification

These are bounded functional checks, not memory measurements, installed-build acceptance, or a new benchmark.

| Check | Result |
| --- | --- |
| Dedicated real-WPF presentation checks | 7/7 PASS |
| Existing hardening checks plus new presentation checks | 26/26 PASS |
| High-match synthetic projection | All 2,000 actions retained; 6 realized row containers at the checked viewport; 2 blocked underlying icon calls |
| Scroll to later actions | PASS; old row bitmap references cleared and newly visible icons requested |
| Dismiss/reopen with unfinished icons | PASS; obsolete queued work cancelled, in-flight work shared |
| Board/picker | PASS; saved order, nine-slot page, next page, unpinned picker, feature filters |
| Icon failure and shared subscribers | PASS; fallback retained, slots released, subscriber cancellation isolated |
| Visible projection replacement/zero matches | PASS; old icons rejected, correct text-context empty state retained |

Commands:

```powershell
dotnet run --project native/WebTools.NativeHost.Checks -c Release -- --super-panel-hardening-checks --presentation-only
dotnet run --project native/WebTools.NativeHost.Checks -c Release -- --super-panel-hardening-checks
git -c core.safecrlf=false diff --check
```

The .NET commands compile Release successfully. Existing UIAutomation assembly-reference warnings remain; the initial compilation also reported the existing nullable warning in `TextSelectionProvider.cs`. No unrelated warning cleanup was performed.

### Intermediate failures and test correction

The pre-change presentation run realized all 2,000 rows and requested all 2,000 icons; three of four initial checks failed (virtualization, reopen request sharing, and offscreen bitmap release). The board check passed. The suite was subsequently expanded to seven checks.

The broader hardening run also exposed three pre-existing stale test expectations, both before and after this production change: Launcher takeover, physical Escape cancellation, and focus change. They expected zero presentation callbacks during capture. The existing controller already presents a provisional NoContext board before waiting for capture. Only these test assertions were corrected: require exactly one provisional callback before cancellation/focus change, and still exactly one afterward, with the existing capture/hook cleanup assertions retained. The focus fixture explicitly confirmed foreground change. No controller or capture production code was changed to obtain PASS.

The final broader run passed 26/26. A fresh read-only scoped review found no actionable production issues. These checks do not establish universal third-party application capture compatibility or full-repository regression status.

## Evidence and limits

Local evidence root:

`C:\Users\admin\AppData\Local\Temp\WebTools-Panel-Memory-15d0b3c7c45848df92a7cfb1618cb0c3`

This contains pre-edit source copies, initial failing logs, the expanded presentation log, and `final-hardening-corrected.log`.

Final hardening log SHA-256:

`5A903C10FA3AFC5A8F21EB8288C9CC1B0AF9F0006FEEBCE18169A6A95C634CD9`

The 2,000-action fixture verifies bounded UI realization and icon concurrency, not an MB saving. No new PB/WS baseline, forced GC, working-set trim, or memory A/B was performed. Actual memory reduction and installed UI feel are not measured in this round. Ordinary board savings are limited to avoided candidate preparation; the largest structural reduction concerns high-match context action lists.

No installer/ZIP was produced. No user profile, production installation, or startup registration was modified. No Git stage, commit, or push was performed.
