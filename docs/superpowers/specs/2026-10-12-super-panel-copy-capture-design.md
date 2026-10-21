# Super Panel — Copy Capture Design

Status: USER APPROVED. The user approved this written design and authorized implementation in the current checkout, limited to source writing. Testing, build, runtime, packaging and Git checkpoint operations are not authorized in this implementation round.

Date: 2026-10-12 (Asia/Shanghai).

Scope: independent Super Panel compatibility project. Phase 6F-4D and Phase 6G are not started. No checkpoint, push, installer, or production installation operation belongs to this design task.

## Intent and approved decisions

The user has rejected continuing the UIA text-selection strategy after repeated compatibility failures and a reported regression affecting ordinary selected text in browsers and Codex. Replace that text-capture direction with the application's Copy operation, following the supplied uTools reference. Functionality takes priority over subsequent memory optimization.

The user confirmed:

1. Continue capture if the previous clipboard contains formats that cannot be faithfully backed up. Capture is a transient panel operation. When preservation is possible, restore the original clipboard; never overwrite a subsequent user copy to perform restoration.
2. Updated by the user on 2026-10-13: if Copy was sent but no new text is available, open the normal general 3x3 board in every application. This supersedes the earlier no-update notification/no-panel choice. Actual access, injection, source-attribution, or text-read failures remain error notifications.
3. Super Panel itself always remains non-activating and is primarily mouse-operated.

The earlier prohibition on Clipboard/Copy is superseded for this explicitly user-triggered capture direction. It is not permission to read clipboard continuously, expose raw clipboard APIs to plugins, or record clipboard contents.

## Evidence and boundaries

Reference: D:/SystemDefault/Desktop/rea/utools-superpanel-analysis.md and its supplied source-excerpts JSON. E2 is ev_fa266778b82403fe14c5cce1fa7718be61f2967d823b63437fab7bd8a08dcad9.

The supplied static triggerShow/initVoiceWindow methods show simulated Copy, clipboard-change checking, a reused non-focusable Windows BrowserWindow, and showInactive(). They do not establish faithful clipboard rollback, universal password detection, or measured memory savings. The native addon identity mismatch and unknown hook internals remain limitations. No uTools runtime execution is required or authorized by this design.

Current checkout: codex/shared-ai-translation-2.0, HEAD 707c5673dff479285b34a5b441bec9d3b725c737, pre-existing dirty work preserved. The user's running installed DLL matches the latest Focused Fix preview DLL. The new browser/Codex regression is a USER OBSERVATION; the prior synthetic Chrome probe did not reproduce it. Neither the previous 18 focused checks nor that probe certifies the user's physical trigger workflow.

## Architecture

Retain WPF NativeHost as the persistent host, with Electron Manager on demand. Do not adopt an Electron Super Panel or React UI.

The existing controller admits a user gesture and snapshots its foreground target and generation. Explorer/Desktop providers retain their current native file/directory behavior. Other text capture uses one Copy transaction instead of TextSelectionProvider. Context creation still precedes feature matching; zero matching actions must not erase successfully captured text.

Keep the existing text envelope, selected-text source, 3,000-character bound, authenticated Manager handoff, and Main live revalidation. Plugins receive only the context of an explicitly selected feature invocation, not direct clipboard access. No persisted data schema or SDK changes are proposed.

## One Copy transaction

1. Admit one user gesture. Snapshot the foreground/window identity and invocation generation before capture. A second gesture or dismissal revokes that invocation.
2. Attempt a transient backup of the previous clipboard without reading/logging its private contents outside the capture implementation. Preservation must be complete for the offered formats to count as restorable. Unsupported, excessive, delayed-rendered, or failed backup follows the approved continue-capture policy; it must not become a new compatibility refusal.
3. Validate that the intended foreground target is still current. Respect the existing keyboard state; do not release keys held by the user or send a modified Copy shortcut accidentally.
4. Send one application Copy operation. Do not automatically send multiple different shortcuts, Select All, or read the whole document. A terminal-specific Copy binding is not inferred merely from a process name; explicit exceptions require evidence and review.
5. Wait for a clipboard update within the bounded invocation deadline, with cancellation. A changed sequence is the update condition; a fixed sleep is not a correctness signal. Only an update belonging to the current attempt may be considered. Never reuse clipboard text merely because it was present before the attempt. Identical text can still be a valid new copy if the clipboard update is confirmed.
6. Read only bounded Unicode text for the new context, preserving existing surrogate-pair and envelope handling. Do not invoke feature matching with stale text or infer missing selection from a previous clipboard value.
7. Apply the restoration policy below, then finalize the current invocation. Present the successful text context without activating the panel. Failed/cancelled generations do not present later.

The transaction exists only during user-triggered capture. There is no background clipboard monitor, broad accessibility crawler, provider retry tree, process-per-attempt helper, or global selection cache.

## Clipboard ownership and restoration

Windows clipboard sequence numbers indicate changes; they do not identify their cause. Data can be delayed-rendered. OLE IDataObject access may call the source application through RPC. Do not describe a generic data-object reference as an immutable full backup.

For a faithfully preserved original clipboard, restoration is conditional on the clipboard still being the result observed by this attempt and there being no later detected copy/update. The comparison and restoration must account for the clipboard lock; an unconditional restore after a timer is forbidden. If preservation or safe restoration cannot be established, continue with the captured context and leave the current clipboard as approved. Give a concise indication that restoration did not occur.

Cancellation before injection leaves clipboard unchanged. Cancellation after injection discards the context and applies the same conditional restoration rule. A timeout cannot justify restoring over an unrelated update; a late copy completion must not display a stale panel or cause an unconditional rollback.

Do not promise complete attribution of arbitrary concurrent clipboard writers. If the available signals cannot distinguish an update, record the limitation and fail that ambiguous capture rather than treating unrelated clipboard text as selected text.

### Product limits that the written-design review must acknowledge

- A copy-capable editor can copy its current line with no visible selection. The copy result follows the application's Copy semantics; it does not establish that the user visibly selected that text. The proposed uTools-style behavior accepts that text result. Enforcing visible-selection-only across all editors would require another selection interface and is outside this replacement.
- Standard protected password controls often refuse Copy. This route must test those negative cases and reject known protected controls. It cannot claim universal detection of custom copyable secret fields merely from the copy result. If a stronger universal password guarantee is required, that conflicts with relying on Copy alone and must be resolved before implementation approval.
- Windows clipboard history and third-party managers may observe the temporary copy even if the current clipboard is restored. This design does not erase their histories or integrate with clipboard managers.
- Input injection is subject to Windows integrity-level restrictions. Do not add administrator elevation, UIAccess, or repeated input injection to conceal that restriction.

## Presentation and user interaction

The WPF panel opens and remains non-activating, including clicks inside it. Remove explicit Activate/Focus requests and prevent implicit mouse activation at the native window boundary. Keep positioning/DPI handling, fixed 3x3 shortcut board, context preview/action layout, add/remove/reorder, and pagination.

Outside click and Escape dismiss the panel without requiring initial activation. Reuse bounded observer ownership; no stacked hooks. Keyboard navigation inside an inactive panel is not promised under the user's mouse-first policy. Clicking an explicit feature may open/activate its target Manager or plugin window as the intended action.

Copy sent without a new text update, empty text, and non-text copy results use the general NoContext board. Copy alone cannot prove whether no update means no selection or an application that did not respond; the fallback never reuses old clipboard text. Actual access/input/read/attribution errors use a concise Native tray notification. Explicit generic/tray entry and Desktop/Explorer contexts retain their intended presentation.

## Scope of source changes after approval

- Replace the text branch in SelectionCaptureService with a focused Copy-capture implementation and conditional clipboard handling.
- Retire UIA text-provider selection/discovery from the production entry path. Do not delete unrelated code or tests merely to hide historic failures.
- Adjust controller result handling so failed text capture notifies instead of opening the board; retain generation/cancellation invariants.
- Adjust SuperPanelWindow/observer integration for permanently non-activating interaction and mouse operation.
- Update capture hints, safe diagnostic metadata, focused regression checks, and current Super Panel documentation. Preserve historical reports as history and append the change in direction.

No Translation service, provider, AI configuration, plugin runtime, Manager architecture, Launcher ranking, Websites, installer, update protocol, package dependency, or UI redesign changes.

## Verification and acceptance

Before claiming implementation success, verify the actual capture/controller path, not just policy functions:

- ordinary displayed document text, input, textarea, contenteditable, selected versus empty;
- identical copied text with a new update; unchanged clipboard; delayed update; timeout; target/focus change; cancellation before/after injection;
- original text and non-text clipboard preservation when supported; approved behavior when unsupported; later user copy not overwritten; locks/RPC/format failures do not silently become a success;
- modifier keys retained correctly; injection failure; password negative cases;
- same panel/window ownership, no foreground theft when shown or clicked, outside/ESC dismissal, exact text handoff through Translation feature, no stale result after another invocation;
- Explorer/Desktop regression and Native-only Electron count zero.

Use isolated profiles and synthetic content. Do not alter or stop D:/webtools, read actual tokens/secrets, use private conversations as fixtures, or record text/path contents. Real VS Code, IDEA, browser/Codex composer, and WeChat compatibility requires suitable real/manual evidence; unavailable cases remain explicitly unverified. No memory savings or universal application compatibility claim follows from this design.

## Source implementation record

The user explicitly authorized implementation after reviewing the design. Execute inline in the existing checkout: Copy transaction, service/controller integration, non-activating window/observer integration, then source review and development report. No separate review pause or test execution is introduced in this source-only round.

Implementation rulings:

- The production text entry no longer calls TextSelectionProvider. The old provider source and historical checks remain for traceability; their PASS counts are not evidence for the replacement.
- 2026-10-13 cold-start correction: an initial clipboard sequence of zero is accepted after OpenClipboard succeeds. It is not used as an access-error sentinel. The real preview trace repeatedly failed before injection with COPY_CLIPBOARD_UNAVAILABLE and started succeeding after a manual copy, directly identifying the previous zero-value rejection.
- Invocation-local atomic CopyInjected / CopyResultObserved flags keep the provider's no-update NoContext fallback consistent with the outer timeout path. Cancellation/focus/generation checks still reject revoked results, and no background update promotes a later result into an already-presented board.
- Native ConsoleWindowClass / CASCADIA_HOSTING_WINDOW_CLASS hosts use one Ctrl+Insert rather than Ctrl+C, which can interrupt a running terminal command. This exception is backed by the supplied uTools triggerShow excerpt, Windows Terminal's documented Copy binding, and its source-defined hosting window class. It is not an app-name allowlist or a shortcut retry sequence. Custom bindings and embedded terminals still require runtime verification.
- Backup is optional and limited to complete supported flat-memory formats, at most 64 formats / 8 MiB. Foreign-owned original data is treated as potentially delayed-rendered and not materialized merely for a backup. Capture continues, but ordinary clipboard content still owned by another application will often not be restored. This trades restoration coverage for avoiding an optional foreign-owner request before the application's Copy.
- Clipboard updates with a null or other-process owner are ambiguous and are rejected, rather than guessed through process-name allowlists. Actual multi-process clipboard brokers remain a required compatibility verification item.
- Restore compares the sequence while holding the clipboard lock and skips after detected physical input/newer updates. It does not claim complete attribution of every concurrent external clipboard writer.
- Capture deadline remains the existing 650 ms; native GetClipboardData can still synchronously ask an owner to render the copied format. As with other native calls, this is not forcibly preempted. Only one worker is admitted and late results cannot present. No universal hang-free claim is made without runtime evidence.
- The existing Native tray balloon reports actual capture errors; normal absence of a new text result opens the general board. Explicit Tray → Super Panel opens the general board without injecting Copy into the tray/menu. The panel's keyboard navigation is retired under the approved permanently inactive/mouse-first policy; passive Escape remains available.

Source implementation is not runtime acceptance. Browser/Codex, VS Code, IDEA, WeChat, clipboard restoration, context-menu focus, and drag behavior must be verified in a separately authorized round. No tests, fixtures, compiler, typecheck, build, runtime or packaging commands were run for this implementation.

Verification profiles do not isolate the Windows clipboard. Existing UIA probes now reach Copy through SelectionCaptureService and must not be rerun under the old claim of read-only capture. Future runtime verification needs an explicitly prepared test clipboard/session and a preservation decision; ordinary TEMP browser/profile isolation alone does not protect the user's global clipboard.

Relevant official references:

- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardsequencenumber
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
- https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-olegetclipboard
- https://learn.microsoft.com/en-us/windows/terminal/customize-settings/actions#copy
- https://github.com/microsoft/terminal/blob/main/src/cascadia/WindowsTerminal/IslandWindow.cpp

## Accepted timeout fallback ownership clarification (2026-10-13)

The existing no-new-text policy opens the general board. An accepted timeout fallback terminates capture work without revoking that board. The controller must distinguish the worker's `timeout` cancellation from stale generation, physical-input change, focus change or explicit dismissal. Only the accepted non-error `TimedOut / NoContext` presentation survives worker timeout; all other revocations retain their existing behavior. No timeout extension, delayed re-show or second Copy is added.

The user authorized focused functional verification after the source-only pass. The corresponding report records RED/GREEN deadline-controller regression, 19/19 focused WPF checks, ten real Chromium no-selection cases and three selected cases, and explicitly retains the Word/physical-key verification limits and current unrelated Node/typecheck failures.
