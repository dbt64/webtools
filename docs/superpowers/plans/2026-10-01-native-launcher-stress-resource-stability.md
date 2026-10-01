# WebTools Phase 4G-2 — Audit & Test Plan

> **Status:** User approved execution on 2026-10-01 with the refinements below. Phase 4G-2 execution is in progress; no large stress workload has started yet.

> **Approved execution refinements (2026-10-01):** Scenario B performs 300 mostly visibility-only cycles, with one fixed-query/presentation/clear checkpoint every 50 cycles (six query checkpoints total). HWND identity, visible/hidden state, single-window reuse, and checkpoint cleanup are hard assertions. OS foreground ownership and focus are recorded diagnostically rather than treated as a hard failure on every cycle; the final real Windows hotkey/input sanity check is authoritative for focus.

## Current State

- `PHASE 4G-1 COMPLETE` — the five-cold-start baseline remains historical evidence; this plan does not change or reinterpret it.
- `HOTKEY SYSTEM 2.0 COMPLETE` — manual Windows acceptance is recorded as `MANUAL WINDOWS ACCEPTANCE — USER CONFIRMED PASS`; targeted automated regression is recorded as passing.
- `READY FOR PHASE 4G-2` — Phase 4G-2 has not started.
- Current branch: `codex/shared-ai-translation-2.0`; HEAD: `9d23d543633a29d729904f23273487748633177d`.
- The working tree contains uncommitted Hotkey System 2.0 code and documentation. Preserve it. Initial `git diff --check` reported no whitespace errors; Git emitted line-ending conversion warnings for existing modified files.

## Existing Infrastructure

The reusable Phase 4E path consists of:

- `native/WebTools.NativeHost/Diagnostics/Phase4EResourceTestOptions.cs`: explicit opt-in command line mode; restricts profile and catalog paths to a temporary isolated profile, gives the test process a unique current-user pipe/mutex identity, and accepts an unused `Control+Alt+Shift+F1..F12` test chord.
- `native/WebTools.NativeHost/Diagnostics/Phase4EResourceControlServer.cs`: current-user-only, single-client named pipe. Existing commands set a query on the real WPF window, read a presentation snapshot/state, or request normal process exit.
- `native/WebTools.NativeHost/MainWindow.xaml.cs`: the driver waits for catalog readiness; query injection sets `QueryBox.Text` on the WPF Dispatcher, awaits asynchronous Everything/icon work, and captures the real WPF result presentation.
- `native/scripts/Measure-Phase4EResources.ps1`: one-second external process sampling for Private Bytes, Working Set, GDI, USER, handles, threads, process presence, NativeHost count, and WebTools/Electron count. It also supports an optional non-forced managed-heap snapshot.
- `native/scripts/Invoke-Phase4EResourceAttribution.ps1`: builds/publishes the self-contained NativeHost to an external evidence directory, creates a temporary profile copy, records artifact hashes, launches an isolated diagnostic Host, and verifies normal pipe-requested process exit. Its existing A/B orchestration is not suitable unchanged: it starts separate A and UIA comparison PIDs and its UIA leg is not part of Phase 4G-2.
- `native/WebTools.NativeHost.Checks/Program.cs`: deterministic search and hotkey tests. `GlobalHotkeyService` already accepts fake registration and keyboard-observer factories. Existing checks cover transactional Chord/Double Ctrl/Double Alt transitions, rollback, observer reuse/disposal, shutdown, and low-level callback lifecycle using injectable hook APIs.

Historical Phase 4E evidence is in `docs/native-launcher-phase4e-parity.md`, `docs/native-launcher-phase4e-manual-checklist.md`, and Git-external artifacts referenced there (`external evidence archive\\run-20260930-155307`). It records a no-UIA, real-WPF 3 × 1000 query workload, 30-second initial settle, 60-second post-round settles, and a same-process plateau pattern. This is evidence that the approach and workload are viable, not a Phase 4G-2 result.

The existing no-UIA sampler currently sends 300 synthetic registered-hotkey show/hide cycles after its search rounds. Phase 4G-2 should not reuse that tail: it creates substantial injected Ctrl/Alt/Shift input, does not exercise Hotkey System 2.0 mode replacement, and conflates visibility activity with keyboard-input injection.

## Production Path Analysis

### Search

The Phase 4E no-UIA driver is not a parser-only microbenchmark. `SetQueryFromResourceTestAsync` assigns the actual `QueryBox.Text` on the Dispatcher. WPF raises `TextChanged`; `QueryBox_TextChanged` updates `LauncherInteractionState` and calls `RenderQuery`. The current production chain then parses the command and calls the shared `SearchCore.Search` for local, website, and web-command presentation; `file:` invokes the real `EverythingClient.SearchAsync`. `Present` creates the real `ResultRow` list and calls the selection controller to update `ResultsList`; the WPF list is laid out and visible-row icons load through the real favicon/native-icon paths. The driver waits for asynchronous file/icon work and returns query, mode, window visibility, result count, realized rows, icon counts, cache size, and status.

The current Native Search Core is still exercised: the current dirty diff does not modify `SearchCore`, `SearchCommand`, app catalog/search models, website search, or Everything. Hotkey System 2.0 changes are in the hotkey service, interop, settings UI, checks, and documentation. The Phase 4E code path therefore still represents the current search implementation.

The diagnostic query setter bypasses physical typing, keyboard routing, IME composition, and ordinary focus/caret behavior. It also waits for icons/files before replying, which is useful for stable checkpoints but differs from interactive rendering latency. It does not activate result actions, open websites, start translation, or intentionally launch Manager.

### Show / Hide

Production activation is `GlobalHotkeyService` callback → `MainWindow.OnHotkey` → `ShowLauncher` or `HideLauncher`. `ShowLauncher` reuses the same `MainWindow`, positions it, calls `Show`/`Activate`, focuses `QueryBox`, and updates layout. `HideLauncher` cancels transient search generations, clears query/results/selection/shortcut presentation, and calls `Hide`. Blur, Escape, results, web search, and shortcut actions use the same hide method. The Phase 4E pipe currently has no command to call either production method; its present 300-cycle route injects a real registered chord through `keybd_event`.

Proposed narrow seam: add test-mode-only `show` and `hide` pipe commands that dispatch to those existing methods on the window Dispatcher. Return/check the HWND, visible/active/focus state, query, and result-row count. This reuses the production window lifecycle without UI Automation, without constructing extra windows, and without sending keyboard input. It still bypasses delivery of a physical `WM_HOTKEY`; a small manual hotkey sanity check remains required.

### Hotkey modes

`GlobalHotkeyService` uses `RegisterHotKey` for chord/function bindings and an `IHotkeyKeyboardObserver` for Double Ctrl/Double Alt. The implementation’s injectable interfaces are already used by deterministic checks. The current checks already assert the individual transition invariants, but only a short transition sequence, not repeated lifecycle stress.

Use the fakes for a high-count deterministic transition test. For a small real-runtime cross-check, the isolated resource process can call the already-existing `MainWindow.TryReplaceHotkey` through a tightly restricted test-pipe command, cycling only its unique startup chord → Double Ctrl → Double Alt → same startup chord. This does not update `LauncherStateStore` or send actual key events. It does briefly install a system-wide low-level hook for DoubleModifier modes, so run this check only in the isolated test session when the desktop is idle. Process counters from this modest real check are useful corroboration; exact observer/registration counts come from the fake-based assertions.

## Measurement Contamination Risks

- **UI Automation:** the Phase 4E comparison showed substantially greater memory growth in the UIA-driven process. Do not use it in the primary workload or compare any UIA sample with the no-UIA series.
- **Synthetic keys:** do not run the existing 300-keypress tail. Pipe commands should call the existing visibility methods directly. Hotkey mode stress should use the injected fake interfaces; the real-runtime cross-check changes registration/hook mode without synthesizing key input.
- **Diagnostics:** external one-second OS sampling is primary. `GC.GetTotalMemory(false)` and `GC.GetGCMemoryInfo()` are already available through the test-only snapshot, but querying them requires a pipe round trip and layout capture. Collect them only at idle/round boundaries as secondary evidence, never force collection, and do not use them as a pass gate.
- **Everything:** `file:` uses the locally configured Everything CLI if enabled. Record enabled/path availability and the response. It is local and does not require network, but its result set can vary as the machine index changes. A failed/unavailable CLI must not be mistaken for a search-core result.
- **Live machine data:** Phase 4E clones the launcher state, website data, and app catalog snapshot under `%TEMP%`; catalog refresh still reads installed Start Menu/Desktop sources. Record the frozen snapshot hashes/counts. Do not log website URLs, local file paths, secrets, or personal result labels in the resource CSV.
- **Tray difference:** explicit Phase 4E resource mode omits `TrayIconService`, skips startup registry application and the update pipe, uses isolated profile/pipe/mutex names, and registers an isolated test hotkey. It still creates the real WPF Launcher, SearchCore, catalog, Everything client, Manager controller/pipe, and diagnostic pipe. Thus it can establish same-process resource trends for search/window/hotkey code, but its absolute numbers are not directly comparable to the installed 4G-1 tray-inclusive baseline.
- **Driver overhead:** pipe round trips and diagnostic snapshots add small work. Preserve the existing same-driver use at all checkpoints and record the driver identity. Do not interpret a single snapshot as a leak.

## Proposed Scenario A — Search Stress

**RESOURCE MEASUREMENT / AUTOMATED / NO UIA**

Reuse the current real-WPF dispatcher query path. Run 3 rounds × 1000 queries in one isolated NativeHost PID. The historical workload is validated and SearchCore is unchanged, so 1000 × 3 remains appropriate. Keep the existing 30-second initial settled idle and 60-second post-round settle. Capture a continuous one-second OS sample and explicit round checkpoints; do not restart the process between rounds.

Use a deterministic mixed corpus, in a fixed order, repeated evenly across each round:

- short and longer English prefixes/matches against a frozen app catalog;
- Windows built-in app queries and aliases (`控制面板`, `Control Panel`, `kongzhimianban`, `kzmb`), plus File Explorer/Device Manager aliases where useful;
- one website title and one URL-fragment query from a disposable website inserted only into the cloned test profile (use a reserved `.invalid` HTTPS URL and never activate it);
- one fixed no-result string; repeated known hit; and empty query to exercise clear/reset presentation;
- `?test` to exercise web-search command presentation only (never press Enter; no network request);
- `/` website-only mode; and `file:` only if the local Everything availability is recorded. If disabled/unavailable, assert the expected disabled/error status instead of claiming result coverage.

Freeze and record the corpus, app-catalog snapshot hash, and isolated website fixture hash for comparability. The pipe response should validate exact query and search mode plus a non-empty expected result category for stable app/site fixtures, or a visible status for no-result/disabled modes. Add a result-kind-only field if needed; do not place private paths or real website URLs in CSV. Do not expand this into a full search correctness suite.

At 1000 queries capture an immediate external sample and a small non-forced diagnostic snapshot; then settle 60 seconds and summarize the last 10 one-second process samples. Repeat Rounds 2 and 3 in the same PID. Existing Phase 4E cadence of progress samples every 100 queries can remain, but avoid managed-heap RPC snapshots every 100; use OS sampling throughout and managed-heap snapshots at idle and settled round boundaries.

## Proposed Scenario B — Show/Hide Stress

**RESOURCE MEASUREMENT / AUTOMATED / NO UIA**

In the same PID after Scenario A, run 300 show/hide cycles on the existing single `MainWindow` through the test-only pipe seam. Most cycles are `show` → hard-assert same HWND and visible → `hide` → hard-assert invisible and same HWND. Every 50th cycle inserts one fixed local query, verifies representative presentation, then hides and hard-asserts that query/results/transient state are cleared. This yields six query-clear checkpoints, not 300 additional search workloads. Never activate an app/site/action.

Sample continuously at one-second intervals, mark checkpoints every 50 cycles, then settle 60 seconds. Keep the same window instance; no window recreation. No tray click or UIA is used here. The production activation request is exercised on every show, but `IsActive`/query focus are diagnostic observations rather than per-cycle hard gates because Windows foreground policy can make them nondeterministic for an automated driver. This method exercises `ShowLauncher`/`HideLauncher` and clearing behavior; it does not synthesize `WM_HOTKEY`. A real hotkey path remains covered by the final manual sanity check and existing user-confirmed hotkey acceptance.

## Proposed Scenario C — Hotkey 2.0 Lifecycle Stress

**AUTOMATED / TEST-ONLY INFRASTRUCTURE + MODEST REAL RUNTIME CHECK**

Extend the existing deterministic `GlobalHotkeyService` fake-based check to repeat 300 complete cycles of `Chord → Double Ctrl → Double Alt → same Chord`, without changing persisted settings and without keyboard input. After every transition assert:

- Chord/function active: exactly one fake registration and zero active observers.
- Double Ctrl/Alt active: zero fake registrations and exactly one active observer of the requested modifier.
- Double Ctrl → Double Alt reuses the same observer.
- Returning to Chord disposes the observer and leaves one registration.
- No step leaves more than one active registration/observer; final `Dispose` leaves zero registrations and all observers disposed.
- Existing rollback/failure and stale-callback-after-dispose cases remain covered.

Also perform 10 complete cycles (30 transitions) in the isolated NativeHost PID through the current-user test pipe, using its unique test chord. This exercises actual `RegisterHotKey`/`WH_KEYBOARD_LL` install and teardown without pressing keys or persisting settings. Sample process counters continuously and settle 60 seconds afterward. The real integration portion is deliberately modest because a low-level hook is global; the high-count invariant test uses the existing fakes. Do not count fake-object allocations as NativeHost memory evidence.

## Resource Sampling Method

- Launch one self-contained `win-x64` NativeHost publish from the reviewed current source into a Git-external temporary evidence directory. Capture EXE/DLL SHA-256, branch/HEAD, dirty-file list and hashes, OS/runtime, profile/corpus/snapshot hashes, test hotkey, PID, and control-pipe identity in a manifest.
- Use a temporary copied profile under `%TEMP%`; source files are read-only. Keep the same diagnostic Host PID through A, B, and the modest real C check. Do not relaunch between rounds.
- Reuse the Phase 4E process sampler at 1-second cadence for Private Bytes, Working Set, GDI, USER, handles, threads, target PID/presence, NativeHost count, and WebTools/Electron process count. Record actual process paths when available so unrelated installations are never closed or attributed to the test PID.
- Sample after the diagnostic readiness handshake, then allow 30 seconds of settled idle. At each workload boundary record an immediate sample. After each query round, show/hide block, and real hotkey-transition block, allow 60 seconds of natural settle and summarize the last 10 one-second samples (median and range). No forced GC, working-set trim, compacting GC, cache clear, or process restart.
- Managed heap and existing icon/result counters are secondary snapshots at idle and settled boundaries only. They are not acceptance thresholds and are not forced-GC measurements.
- The existing phase4e attribution orchestrator starts a second UIA comparison Host; do not invoke that orchestration for Phase 4G-2. Reuse its isolated profile/publish precautions and the existing sampler/control-pipe code via a Phase 4G-2 option path.

## Plateau / Growth Interpretation

Do not compare the test host’s absolute values with the tray-inclusive Phase 4G-1 baseline and do not define an arbitrary MB ceiling. Compare settled same-PID rounds and object counts under the identical workload.

- Warm-up/cache establishment is plausible when the first round rises, later equal rounds add materially less, and process-object counts stabilize.
- Working Set movement alone is not a leak if Private Bytes and handles/GDI/USER/threads stabilize.
- Potential sustained growth requires reproducible settled growth across later equivalent rounds without a slowing trend, or repeated resource-object/thread increments tied to each show/hide or hook transition.
- A single high immediate sample is not a leak. Use the settled series. If a plausible monotonic trend appears, stop broad stress, preserve the CSV/manifest, repeat only the smallest affected scenario in the same PID if safe, and attribute before proposing a fix.
- P1 requires reproducible runaway resource growth, unbounded GDI/USER/handle/thread growth, crash/deadlock/unusable Launcher, or unintended Electron/Manager residency. Bounded warm-up is not automatically a defect.

## Electron-Zero Gate

Before launch, require no Manager/Electron process that would contaminate the measurement; if present, abort without closing it. During every sample, record process name, PID, path (when readable), and whether it belongs to the test Manager path. The query driver never activates result actions; direct show/hide/hotkey commands never call `ManagerController.OpenPage`. Any new Manager/Electron process during Native Launcher-only stress invalidates the run and is a finding. End by confirming the target NativeHost remains alive, test Manager/Electron count is zero, and the test Host exits only through the normal explicit `exit` pipe command.

The current Phase 4E script counts `WebTools` processes by image name globally. Preserve that conservative preflight behavior unless a path-aware check can reliably distinguish other installations; never kill/close an unrelated `D:\webtools` process. Record baseline process IDs and paths so a pre-existing process is not mistaken for a new child.

## Safety / Isolation Strategy

- Do not run an installer or overwrite/uninstall `D:\webtools`; no production installer is needed.
- Build to an external temporary/evidence directory. Use the Phase 4E isolated mode with a copied `%APPDATA%\Nook` launcher state/catalog and projected website data. Any synthetic website fixture is written only to the temporary profile and uses a reserved `.invalid` URL; never open it.
- Test mode uses a unique mutex, Manager pipe and random current-user-only control pipe, disables login-startup registry updates, and omits a second tray icon. Preserve every pre-existing NativeHost PID; if a Manager would contaminate the zero-process gate, stop and ask the user to close it normally rather than closing it automatically.
- The optional real hotkey mode check installs a system-wide low-level hook briefly. Run only on the dedicated test session/idle desktop; use no real keyboard events and restore the diagnostic process to its original unique chord before exit.
- Do not modify or commit any existing Hotkey System 2.0 changes during the test-plan stage.

## Required Test Infrastructure Changes

One small diagnostic seam is necessary: the current resource pipe can set queries and exit, but cannot drive the production `ShowLauncher`/`HideLauncher` path, and the current no-UIA script uses synthesized hotkeys for visibility. Add test-mode-gated `show`/`hide` commands and a constrained `replace-hotkey` command to that existing control pipe. These commands must marshal to the WPF Dispatcher, call existing production methods/service, validate inputs, expose no filesystem paths or persisted secrets, and remain unavailable in ordinary startup. Do not introduce a new benchmark framework or modify search algorithms.

The sampler needs a Phase 4G-2 scenario path that reuses the existing OS sampler and isolated host. It must run A, B, and the modest real C sequence on the same PID and skip the Phase 4E synthetic 300-keypress tail/UIA comparison. The deterministic high-count hotkey test belongs in the existing Checks program and uses its current injected interfaces. No installer packaging, production configuration changes, or new dependency is needed.

## Manual Windows Checks

These remain small sanity checks, not primary resource drivers:

- In the normal installed instance, verify one real user-initiated global hotkey show/hide cycle still displays the Launcher and focuses the query box; Escape/blur hide behavior remains intact. Do not change hotkey settings or click Manager actions during the measurement.
- In the isolated diagnostic process after stress, type one English and one Chinese/IME query manually, confirm the query box accepts input and results remain usable, then hide/show once. This checks physical typing/focus, which direct property injection does not cover.
- Confirm the user’s normal Native tray remains present and usable; the isolated resource mode deliberately omits a tray to avoid collision.
- Confirm no Manager window was opened and Electron/Manager remained absent during the test.
- Search correctness assertions and process counts are automated; no UIA-driven measurements are accepted.

## Files Expected to Change

Only after approval to execute Phase 4G-2:

- `native/WebTools.NativeHost/Diagnostics/Phase4EResourceControlServer.cs` — add tightly scoped test-only visibility and hotkey replacement commands; retain current-user-only pipe and request validation.
- `native/WebTools.NativeHost/MainWindow.xaml.cs` — add resource-mode-gated wrappers around existing show/hide methods and return only non-sensitive presentation identity/focus/result-kind fields needed by assertions.
- `native/WebTools.NativeHost.Checks/Program.cs` — extend injected hotkey transition tests to 300 cycles and assert per-transition resource invariants/cleanup; add command-contract tests if suitable.
- `native/scripts/Measure-Phase4EResources.ps1` — add an explicit Phase 4G-2 orchestration option that reuses the sampler/control pipe, runs search + visibility + modest mode-transition scenarios on one PID, records stage checkpoints, and omits the synthetic-key/UIA legs.
- `docs/native-launcher-phase4g-final-validation.md` — append a new `Phase 4G-2 — Native Launcher Stress & Resource Stability` section after execution; do not rewrite the Phase 4G-1 baseline or Hotkey System 2.0 acceptance section.
- `docs/superpowers/plans/2026-10-01-native-launcher-stress-resource-stability.md` — this approved plan only; it is the sole file created in the current audit task.

No product search behavior, profile schema, startup preference, production installer, tray implementation, Manager, Translation, or dependencies should change.

## Dependency-Ordered Execution Plan

### Task 1 — Add isolated control commands

- **Depends on:** user approval of this plan.
- **Files:** `Phase4EResourceControlServer.cs`, `MainWindow.xaml.cs`, and focused command validation in `Program.cs`.
- **Changes:** test-mode-only show/hide wrappers call the existing methods. A constrained hotkey command accepts only the startup unique chord, `DoubleModifier:Control`, or `DoubleModifier:Alt`; it calls the current `TryReplaceHotkey` without persistence. Responses include PID, HWND, visibility/activity/query-focus, mode/query, row count, and operation success—no real user URLs, search labels, filesystem paths, or settings values.
- **Verification:** focused NativeHost checks; `dotnet build native/WebTools.NativeHost/WebTools.NativeHost.csproj -c Release`; normal startup argument parsing remains opt-in; pipe command dispatch/invalid values are rejected. Then run `npm run typecheck` and `npm test` before later tasks.
- **Safety:** all commands require the explicitly opted-in test host and its random current-user-only pipe; ordinary product entry paths remain unchanged.

### Task 2 — Stress hotkey lifecycle through existing fakes

- **Depends on:** Task 1’s command contract review; implementation is in the existing Checks harness.
- **Files:** `native/WebTools.NativeHost.Checks/Program.cs`.
- **Workload:** 300 complete `Chord → Double Ctrl → Double Alt → Chord` sequences using fake registration/observer APIs; zero keyboard events and no settings/profile writes.
- **Verification:** assert invariants after every transition; observer reuse on Ctrl→Alt; rollback tests remain; all registrations/observers are disposed at shutdown; stale callback tests remain. Run `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj -c Release` and preserve/compare the current check count.
- **Safety:** fake counts are logical lifecycle evidence only, not process-memory measurements.

### Task 3 — Extend the existing sampler for one-PID Phase 4G-2

- **Depends on:** Tasks 1 and 2.
- **Files:** `native/scripts/Measure-Phase4EResources.ps1`.
- **Workload:** reuse the existing 1-second OS sampler and isolated control pipe; sequential A (3 × 1000), B (300), C (10 real mode cycles), 30-second initial idle and 60-second settles. Use stage markers and round-boundary managed snapshots only. Remove/skip synthetic-key and UIA legs in this mode.
- **Verification:** validate script parameters/corpus/control responses with small bounded smoke commands only; do not run the 1000/300 stress during implementation review. Confirm output paths are Git-external, CSV redacts user-specific labels/paths, normal pipe exit is used, and no script path can kill a process.
- **Safety:** retain all Phase 4E defaults/behavior; Phase 4G-2 must be explicitly selected.

### Task 4 — Build and establish isolated baseline

- **Depends on:** Task 3 and static checks.
- **Files:** no product file changes; outputs and manifest outside Git.
- **Build:** `dotnet publish native/WebTools.NativeHost/WebTools.NativeHost.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o <external-test-output>` from the exact current source tree. Do not run `npm run package:win` or an installer.
- **Baseline:** launch the test Host with isolated profile/control arguments, wait for ready and 30 seconds, verify the target PID and existing process baselines, record one-second resource metrics, and confirm no test Manager/Electron process. If startup, identity, or isolation preconditions fail, exit normally through the test pipe and stop.

### Task 5 — Run Search Stress (Scenario A)

- **Depends on:** Task 4.
- **Workload:** the deterministic frozen corpus, 1000 queries × 3 rounds, same PID, immediate + 60-second settled checkpoints after every round.
- **Verification:** exact input/mode processing, stable known app/site result category, expected no-result/empty status, no exceptions/timeouts, `file:` availability recorded, no network/action activation, results remain usable.
- **Metrics:** continuous Private Bytes/Working Set/GDI/USER/handles/threads/process counts; managed heap only as secondary settled snapshots.
- **Stop rule:** crash, deadlock, target PID loss, unexpected Manager/Electron, invalid result state, or clear monotonic resource-object growth stops the workload; no automatic restart/cleanup beyond normal test-pipe exit.

### Task 6 — Run Show/Hide and Hotkey lifecycle (Scenarios B/C)

- **Depends on:** Task 5; continue the exact same PID.
- **Scenario B:** 300 pipe-driven visibility cycles, with one query/presentation/clear checkpoint every 50 cycles (six total), then 60-second settle. Hard-assert one stable HWND, visible after show, hidden after hide, and cleared transient state at query checkpoints. Record focus/active state diagnostically only.
- **Scenario C:** fake high-count result from Task 2 plus 10 real mode-transition cycles (30 changes) through the constrained test command, no real key input, restore original test chord, 60-second settle.
- **Metrics:** same external process sample and counts at each checkpoint; no arbitrary memory threshold.
- **Safety:** if the low-level observer interferes with the desktop, stop the optional real integration portion and retain fake-based results with a clearly marked manual/inconclusive real-hook resource item.

### Task 7 — Post-stress sanity, analysis, and report

- **Depends on:** Tasks 5 and 6.
- **Checks:** one real hotkey manual sanity on the normal installed host, direct manual input/focus sanity in the isolated Host, tray presence, no Manager/Electron, normal exit of the test Host. Do not alter real settings/profile.
- **Automated regressions:** `npm run typecheck`; `npm test`; `npm run build`; NativeHost Checks; Release `dotnet publish`; `git diff --check`. No installer build is necessary.
- **Report:** append the new Phase 4G-2 section with artifact/source hashes, profile/corpus identity, same PID, timing, raw CSV location, functional checks, exact sample table and interpretation. Mark each result `AUTOMATED`, `MANUAL WINDOWS`, `RESOURCE MEASUREMENT`, `NOT TESTED`, or `INCONCLUSIVE`. Keep 4G-1 evidence and Hotkey System 2.0 status unchanged.

## Acceptance Criteria

- Three complete 1000-query rounds and 300 show/hide cycles run in the same isolated NativeHost PID without UIA or process restart.
- Known app and disposable saved-website queries reach expected result categories; empty/no-result and command-mode presentations complete; Everything condition is explicit; no result action or web request is activated.
- One Launcher HWND is reused; visible/hidden states are correct; checkpoint query/results/selection presentation clears on hide; after stress the Launcher remains responsive. Focus is recorded diagnostically during automated cycles and must pass the final real Windows hotkey/input sanity check.
- 300 fake-based hotkey mode sequences satisfy exact registration/observer invariants and shutdown cleanup; the modest real test-mode cycle changes actual registration/hook modes without persisted settings or injected keyboard input.
- Continuous OS metrics and explicit settled checkpoints exist for all phases; no forced GC, trimming, compaction, cache clearing, or re-launch between rounds.
- NativeHost remains alive through workload; no unexpected Manager/Electron process appears; test process exits normally via its control pipe.
- No reproducible P0/P1 remains. Any suspected sustained growth is preserved and attributed before a product fix is proposed.
- Phase 4G-1 baseline and Hotkey System 2.0 acceptance text remain unchanged.

## Risks / Open Questions

- The test Host omits tray and updater services by design. The resource trend is trustworthy for its repeated WPF/search/window/hotkey path, but absolute values must not be presented as the tray-inclusive production baseline.
- Direct show/hide dispatch exercises the actual production methods and focus request, but not a physical keyboard’s `WM_HOTKEY` delivery. Manual hotkey confirmation and previous user-confirmed hotkey acceptance cover that boundary.
- `WH_KEYBOARD_LL` is system-wide even though the isolated process/profile is not. Keep the 10-cycle real check short and run with no active keyboard work; the 300-cycle stress stays on fakes.
- `file:` result availability depends on local Everything configuration/index. Record it; do not introduce network or mutate its configuration.
- The current repo is dirty. Future publish must record hashes for the actual built EXE/DLL and all dirty source inputs; branch + HEAD alone is not enough to identify this build.
- The real user’s `D:\webtools` instance/profile/startup settings must remain untouched. If an already-open Manager makes the zero-process gate ambiguous, abort rather than closing it.

## Recommendation

Approve the smallest Phase 4G-2 infrastructure delta: add diagnostic-only pipe commands to reuse the existing MainWindow visibility/hotkey methods, extend the current sampler with a separate explicitly selected Phase 4G-2 sequence, and increase fake-based hotkey lifecycle repetitions. Build a self-contained NativeHost to an external directory and run A/B/C on one isolated PID. Do not package an installer, alter the live installation, rerun UIA attribution, or change product behavior.

After the user approves this plan, execute Tasks 1–7 in order. Do not start Phase 4G-3 or make memory optimizations as part of this gate.
