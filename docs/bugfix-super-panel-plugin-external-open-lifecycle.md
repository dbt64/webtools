# Super Panel — Plugin External-Open Completion Lifecycle

Date: 2026-10-17

## Scope and evidence

The user confirmed Phase 6G-2 built-in selected-text search and search-engine switching passed manual acceptance. Separately, the older optional search plugin opened the browser but left Super Panel visible with `执行完成，未返回快速结果`. The supplied screenshot is user-observed runtime evidence; this task did not reproduce against the live installation.

Repository: `D:\SystemDefault\Desktop\HomePage`, branch `codex/shared-ai-translation-2.0`, HEAD `707c5673dff479285b34a5b441bec9d3b725c737`. There were substantial pre-existing tracked and untracked changes. Task-start file copies and Git status are preserved outside the repository at `D:\SystemDefault\Desktop\webtoolstest\plugin-command-lifecycle-20261017\baseline`.

## Confirmed cause

- `SuperPanelWindow.ActivateBuiltInTextAction` opens the external target and explicitly calls `Dismiss()`.
- The optional example's `src/actions.cjs` awaits the existing public SDK `external.open()` and returns void.
- `WebHostCapabilities.dispatch` performs the authorized external open and returns `null`. The Node command adapter previously discarded the fact that an external target was opened successfully.
- `FeatureInvocationService` returned the same `completed` response for all successful void commands. Native feedback cleared the pending Quick Result binding, displayed `执行完成，未返回快速结果`, and kept the panel visible.

This is a missing Host completion disposition for external-only commands. The investigation does not establish a general inability to dismiss the panel by Escape/outside click. It does not implicate capture, matching, or the configured search engine.

## Minimal fix

1. The existing Node command adapter records `externalOpened: true` only after Host `external.open` dispatch succeeds and the invocation remains current. This flag is internal; a plugin cannot claim it in its completion payload.
2. Following normal command completion and owned-child cleanup, Main adds optional `dismissPanel: true` to the existing invocation acknowledgement only for Super Panel commands that successfully opened an external target and have no Quick Result.
3. TypeScript and Native response parsers accept that field only as literal `true` on a valid `completed/completed` acknowledgement. Other fields and duplicate Native JSON properties remain rejected; responses remain bounded at 256 bytes.
4. `ManagerController` carries the disposition in invocation feedback. Super Panel dismisses only if that request still owns the visible panel. A newer presentation clears the old request identity. An already accepted Quick Result takes precedence and stays visible.

| Command outcome | Super Panel behavior |
|---|---|
| External open succeeds, command completes, no Quick Result | Dismiss and clear transient context |
| External open succeeds and command returns Quick Result | Retain inline result and actions |
| Void command without successful external open | Retain existing completion feedback |
| Command failure or cancellation, including after an external effect | Retain error/cancellation feedback |
| Old invocation completes after panel replacement or reopening | Ignore old completion |
| Launcher/Manager invocation | No panel dismissal directive |

The Host acknowledgement is private to the paired Main/Native application build. Plugin Manifest, public SDK, capability declarations and result payloads are unchanged. Existing plugins need no migration. `MainWindow.xaml.cs` changes only its event-handler signature to receive the new internal feedback argument; Launcher behavior is unchanged.

## Verification

All test profiles and logs use `D:\SystemDefault\Desktop\webtoolstest\plugin-command-lifecycle-20261017`; process-local `TEMP`/`TMP` point to its `temp` subdirectory.

| Verification | Result |
|---|---|
| Before implementation: new adapter/service/wire regressions | 4 failures reproduced the missing disposition; 22 existing cases passed |
| Node command adapter, activation, invocation service and wire parser | 27/27 PASS |
| `pnpm run typecheck` | PASS |
| `dotnet run --project native/WebTools.NativeHost.Checks -- --quick-result-checks` | 39/39 PASS |
| `dotnet run --no-build --project native/WebTools.NativeHost.Checks -- --super-panel-hardening-checks --presentation-only` | 14/14 PASS |

The Node tests use the real validated package snapshot, command adapter, Host capability dispatch and invocation service with controlled child-process/external-open dependencies. They cover successful opens, failures, cancellation, Quick Result precedence, forged child flags, replay and other entry surfaces. They do not launch a real UtilityProcess or OS browser.

The WPF checks create actual isolated windows and exercise the existing Manager feedback event and UI dispatcher. They verify dismissal, state cleanup, retained Quick Result, void/failure/cancellation, queued stale completion and the no-context board. Existing scrolling, virtualization, Translation visibility and constrained-height checks also pass. They do not simulate physical selection or browser focus changes in the installed application.

The Native build succeeded with existing UIAutomation reference-resolution warnings and a nullable warning in untouched `TextSelectionProvider.cs`; no compilation errors occurred.

Logs: `red-tests.log`, `focused-tests.log`, `typecheck.log`, `native-quick-result.log`, `native-presentation.log`. Incremental task diff: `scoped-changes.patch` in the external test directory.

## Delivery boundary

Source fix and focused regressions are complete. The installed executable has not been replaced, and this task does not claim packaged browser/mouse acceptance for the fix. That check requires a build containing both the updated Main and NativeHost.

No real `%APPDATA%\Nook` data, current installation, selected text, Token or Secret was read or modified for this investigation. No stage, commit, push, installer distribution or next-phase development was performed. No subagent was used; the user's prohibition on Astra applies to future subagent work.
