# WebTools Native Launcher Phase 4G — Final Performance / Stability Validation

## Phase 4G-1 — Final Production Baseline & Cold Start

### Environment

- Test time: 2026-10-01, Asia/Hong_Kong (UTC+08:00).
- OS: Microsoft Windows 11 Pro, build 22631, x64.
- Branch: `codex/shared-ai-translation-2.0`.
- Commit: `9d23d543633a29d729904f23273487748633177d` (`feat: complete native launcher migration and manager cleanup`).
- Working tree before this report: clean.
- Measured executable: installed `D:\webtools\WebTools.NativeHost.exe` (product version `1.0.0+9dbbace29f5f92e2729826be27e467dd9528ba19`).
- Installed NativeHost SHA-256: `18BE0D1FB5B8FBEA9BD10BC59D2A8B04D8EAC487A38CE1C350CD26AA6C1E2E04`; it matches the host staged with the locked Phase 4F candidate.
- Candidate installer: `release\native-production-20260930-224223\WebTools-Setup-0.1.0.exe`, SHA-256 `1872CCA579F8A6D425515A4576751917ADD3BE9205600B348EC24330B0F09FF4` (matches the Phase 4F report). The installer was not run or rebuilt.
- Profile: existing `%APPDATA%\Nook` (`C:\Users\zry\AppData\Roaming\Nook`). No profile reset or explicit data/settings edits were performed. Normal NativeHost diagnostics were written by the application to `%TEMP%\WebToolsNativeHost-PoC`.
- Sampling: five separate process launches; each sample was taken 30 seconds after `Start-Process`, with no Launcher interaction during the settle window.
- A pre-existing target NativeHost (PID 3500) was gracefully closed before run 1 and was not counted as a baseline run.
- Process exit between runs: the app's current-user update-preparation pipe received the fixed `prepare-update` request with the exact expected Host PID. Each request received a success acknowledgement; the NativeHost and target-install Manager process group were observed to exit before the next launch. No process was force-terminated.
- Private Bytes and Working Set came from the Windows process counters exposed by `Get-Process`; GDI and USER came from `GetGuiResources`. Electron/Manager counts are processes whose executable path is under this installation's `D:\webtools\Manager` directory, so unrelated installations/processes were not counted.
- Raw read-only sample CSV: `D:\系统缓存\WebTools-Phase4G1-Baseline-20261001-142759.csv`.

The application state has `LaunchOnStartup: false`, and the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\WebTools` value was absent after the runs. Production startup normally reapplies this persisted setting. The pre-test registry value was not captured, so its exact before/after identity cannot be independently established; no startup preference was changed during this validation.

### Cold Start Results

Memory is reported as MiB (1 MiB = 1,048,576 bytes). All samples had one target NativeHost and zero Electron/Manager processes.

| Run | PID | Sample time (UTC+08:00) | Private Bytes | Working Set | GDI | USER | Threads | Handles | Electron | Manager |
|-----|-----|-------------------------|---------------|-------------|-----|------|---------|---------|----------|---------|
| 1 | 4900 | 14:25:56.624 | 72.56 MiB | 136.37 MiB | 22 | 27 | 27 | 741 | 0 | 0 |
| 2 | 22844 | 14:26:27.273 | 73.09 MiB | 136.70 MiB | 22 | 27 | 27 | 739 | 0 | 0 |
| 3 | 23228 | 14:26:57.922 | 72.70 MiB | 136.47 MiB | 22 | 27 | 28 | 745 | 0 | 0 |
| 4 | 9472 | 14:27:28.556 | 72.93 MiB | 136.96 MiB | 22 | 27 | 27 | 739 | 0 | 0 |
| 5 | 11584 | 14:27:59.187 | 72.60 MiB | 136.75 MiB | 22 | 27 | 27 | 740 | 0 | 0 |

### Summary

| Metric | Minimum | Maximum | Mean | Range |
|--------|---------|---------|------|-------|
| Private Bytes | 72.56 MiB | 73.09 MiB | 72.78 MiB | 0.53 MiB |
| Working Set | 136.37 MiB | 136.96 MiB | 136.65 MiB | 0.59 MiB |
| GDI Objects | 22 | 22 | 22.00 | 0 |
| USER Objects | 27 | 27 | 27.00 | 0 |
| Threads | 27 | 28 | 27.20 | 1 |
| Handles | 739 | 745 | 740.80 | 6 |

### Architecture Gate

- NativeHost-only idle: **PASS** for all five settled samples.
- Electron process count: **0/5**.
- Manager process count: **0/5**.
- Between runs: target-install NativeHost and Manager processes were observed absent before each next start.
- After run 5: no process with an executable path under `D:\webtools` remained.
- After sampling, one separate, unmeasured NativeHost launch restored the initially running app state (PID 12904); a process-path check found NativeHost = 1 and Manager = 0. This launch is not included in the five-run statistics.
- No crash or orphan process was observed.

### Functional Sanity

- Normal executable launch and 30-second idle survival: **AUTOMATED PASS**, five runs.
- Tray presence: **NOT TESTED**. This session's Computer Use inventory exposed no native Windows apps/windows, so the notification area could not be inspected.
- Global hotkey showing Launcher: **NOT TESTED**.
- Launcher hide and NativeHost remaining alive afterward: **NOT TESTED**.
- Spontaneous Manager launch: **AUTOMATED PASS** for the five idle samples; none appeared.

No UI action is reported as manually verified. The functional interactions above remain for a user on the Windows desktop to confirm.

### Findings

- **P0: 0 observed.**
- **P1: 0 observed.**
- **P2: 0 observed from the measured process/resource results.**
- **P3: 0 observed.**
- Private Bytes, Working Set, and object/handle counts varied within the ranges shown, without a monotonic progression across the five samples. This is baseline characterization, not a leak finding.
- The tray/hotkey/show-hide behavior remains unverified because native Windows UI control was unavailable in this session.

### Decision

The five-run cold-process baseline and idle Electron gate passed. The complete Phase 4G-1 acceptance gate is **not yet closed** because tray, global hotkey, and Launcher show/hide functional sanity could not be observed. No Phase 4G-2 work was started.

**PHASE 4G-1 INCOMPLETE — USER MANUAL VERIFICATION REQUIRED**

## Post-Baseline User Confirmation and Phase 4G-1 Closeout

This follow-up records the user's later confirmation of the functional sanity items. The baseline measurements and the contemporaneous status above are retained unchanged.

- Tray presence: **USER CONFIRMED — PASS**.
- Global hotkey shows Launcher: **USER CONFIRMED — PASS**.
- Hiding Launcher leaves NativeHost alive: **USER CONFIRMED — PASS**.
- Cold-start Electron process count: **AUTOMATED PASS — 0** in the five baseline samples.

**PHASE 4G-1 COMPLETE** — the original cold-start baseline and the user-confirmed functional sanity gate are both recorded.

## Native Launcher Hotkey System 2.0 Status

- Implementation: **COMPLETE**.
- Automated regression: **TARGETED REGRESSION PASS** (`npm run typecheck`, `npm test` 96/96, `npm run build`, and NativeHost checks 52/52).
- `git diff --check`: **PASS**.
- Post-hotkey resource sample: **POST-HOTKEY RESOURCE SAMPLE — NOT MEASURED**. No production-equivalent sample was run because the live installation, profile, and startup settings were kept untouched.
- Manual Windows acceptance: **MANUAL WINDOWS ACCEPTANCE — USER CONFIRMED PASS**. The user reports the full requested matrix passed with no observed issues, covering supported hotkey modes, Apply/Cancel behavior, normal activation and retrigger, persistence, conflict handling, false-positive checks, and observer cleanup when switching modes.

- Final code-review follow-up: preserved legacy modified `F11`/`F12` chords so an old shortcut cannot invalidate the complete Native Launcher profile; bare `F11`/`F12` and standalone `FunctionKey:F11/F12` remain rejected and are not presets. The regression test was observed failing before the fix and the NativeHost suite passes 52/52 afterward.

The user completed the real Windows hotkey matrix and reported no issues.

**HOTKEY SYSTEM 2.0 COMPLETE**
**TARGETED REGRESSION PASS**
**READY FOR PHASE 4G-2**

Phase 4G-2 has not started.

## Phase 4G-2 — Native Launcher Stress & Resource Stability

> **Status history:** decisions in the following dated checkpoints record what was known at that time. The authoritative current decision is the `Phase 4G-2 Final Acceptance` section at the end of this report; later evidence supersedes earlier pause/incomplete wording without changing the historical measurements.

### Decision

**PHASE 4G-2 INCOMPLETE — STOPPED AFTER SCENARIO A; HANDLE-COUNT ATTRIBUTION REMAINS OPEN.** Scenario A completed in one isolated NativeHost process. Its settled Private Bytes and Working Set declined over the three search rounds, but the settled handle count increased between rounds. A subsequent 60-second idle sample showed the count falling and then holding steady, which is not enough to establish a leak or to explain the increase. In accordance with the approved stop rule, broad execution stopped before Scenario B and before Scenario C's real runtime leg. Do not proceed to Phase 4G-3.

### Source, Build, and Isolation Identity

- Test date: 2026-10-01 (Asia/Hong_Kong, UTC+08:00).
- Source branch/HEAD: `codex/shared-ai-translation-2.0` / `9d23d543633a29d729904f23273487748633177d`.
- The worktree was already dirty for Hotkey System 2.0 when this phase began. No existing work was discarded, and no commit, push, installer, or release was created.
- NativeHost was published from the current worktree with .NET 10, `win-x64`, self-contained, `PublishSingleFile=false` to `D:\系统缓存\WebTools Phase4G2 验收-20261001-9d23d543\publish`.
- Scenario A executable SHA-256: `9BF4E58A2DE052D517D824DDB93E9CEB7978A44B21FA89FDAA81EB978AF4BFF7`.
- Scenario A assembly SHA-256: `3446DBE88B166BF8791B8059BD81DF3E5BC439D8DB9C30C4D5D6EC3018B28119`.
- Scenario A sampler SHA-256: `0EA2A402914742BEEC35A21FD2B08B8A4EC823EDEF3E504F9CA5DFCB13C2BC45`. After the run, the sampler was narrowly updated to flush each Phase 4G-2 managed snapshot checkpoint immediately and retain non-empty sampler-error evidence (including when sampler shutdown times out); its current SHA-256 is `515CB0D95FCD7F31FBAE7A857F92FAC376A6F333D22676CCE73C7A9C822D5F14`. These changes affect only Phase 4G-2 evidence durability; Phase 4E behavior is unchanged.
- External isolated profile: `D:\系统缓存\WebTools Phase4G2 验收-20261001-9d23d543\profiles\g2`. It used projected/synthetic test state and a disposable `.invalid` test website, not the real user profile or credentials.
- Isolated NativeHost PID: `20412`; MainWindow HWND: `2689636`. The same PID/HWND was used throughout initial sampling and all three Scenario A rounds, with no restart.
- The live installation `D:\webtools\WebTools.NativeHost.exe` (PID `25244`) remained running and untouched. The machine therefore showed two NativeHost processes during sampling: the isolated test host plus the live installation. Manager/Electron process count was 0 in every sampled row.
- Scenario A raw OS sample CSV: `D:\系统缓存\WebTools Phase4G2 验收-20261001-9d23d543\phase4g2-resource-stress-G2-1-20261001-175352.csv`, SHA-256 `238C46260AEB38F694D3AF131A0928EDFB5D546424CBC9F6F23FDC834067D8A5`.
- Frozen query corpus: `D:\系统缓存\WebTools Phase4G2 验收-20261001-9d23d543\phase4g2-corpus-G2-1-20261001-175352.json`, SHA-256 `FF2BFF21B22EC1F7779DEAE8DFF9554578F99990B804309A6522722DB8308111`.
- The installed user's profile, startup preference, tray, registry registration, shortcuts, and `D:\webtools` files were not changed. No installer was run.

### Scenario A — Search Stress

- **AUTOMATED PASS, bounded to Scenario A:** 3 rounds × 1,000 query changes, no UI Automation, one-second external OS sampling, same isolated PID `20412` and HWND `2689636`.
- Each round exercised the frozen 20-query corpus across built-in/app aliases, Chinese names, pinyin and initials, saved website name and URL fragment, `/`, no-result and empty input, `?`, and `file:`. Query/presentation assertions passed in all three rounds. Everything was enabled in the isolated profile. Results were inspected as presentation only; no result was launched and the `.invalid` website was not opened.
- A 30-second initial idle sampling window and 60-second settled window after each search round were captured. Each settled window contains 60 one-second samples. No process restart, forced GC, working-set trim, UIA, or synthetic hotkey input was used.

Settled resource windows (Private Bytes / Working Set are MiB; object and thread columns are ranges during the window):

| Stage | Samples | Private Bytes | Working Set | GDI | USER | Threads | Handles | Final handles |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Initial idle sampling window (~30 s) | 32 | 94.56–111.43 | 164.22–179.82 | 54 | 35–39 | 19–26 | 860–873 | 872 |
| Search round 1 settle (60 s) | 60 | 121.62–121.94 | 188.09–188.27 | 54 | 37–42 | 21–28 | 841–855 | 846 |
| Search round 2 settle (60 s) | 60 | 120.89–121.17 | 187.34–187.49 | 54 | 35–39 | 17–23 | 855–866 | 855 |
| Search round 3 settle (60 s) | 60 | 119.44–119.73 | 186.27–186.40 | 54 | 35–42 | 17–24 | 871–887 | 871 |

Private Bytes and Working Set declined from the first settled search round to the third. GDI remained 54. Handles rose at the settled round endpoints from 846 to 855 to 871. This upward sequence triggered the approved stop-and-review gate; it is a resource signal to investigate, not a leak verdict.

### Targeted Post-A Attribution

- **AUTOMATED OBSERVATION:** a separate 60-second idle-only sample was taken on the same hidden isolated PID after Scenario A. It performed no searches, window operations, forced GC, or trimming. HWND remained `2689636`; query length and result count remained 0; Manager/Electron remained 0.
- Private Bytes ended at `125,140,992` bytes (`119.34 MiB`); the last ten samples were constant. Handles fell from 918 at the start to 907 at the end, and the last ten samples were all 907. This suggests delayed release or settling may explain part of the earlier step, but does not establish the source or prove that all retained handles are expected.
- A small local-app-versus-file attribution attempt did not produce usable evidence: the collector omitted GDI interop initialization and wrote a zero-length `phase4g2-handle-attribution.csv`. It is **INCONCLUSIVE** and is not used to support a pass or a diagnosis. No broad workload was resumed.
- The original run's managed heap checkpoint rows were held in sampler memory and were not exported when execution stopped at the review gate. They are **UNAVAILABLE** for this run. The Phase 4G-2 sampler now rewrites the managed checkpoint CSV at each snapshot, so a future explicitly authorized run will preserve checkpoints on interruption; no values were reconstructed or invented.

### Scenario B — Show/Hide Lifecycle

- **NOT RUN.** The 300-cycle workload was not started after the Scenario A handle signal.
- Therefore no Phase 4G-2 claim is made for 300-cycle HWND reuse, show/hide visibility, 6 periodic query-clear checkpoints, or focus diagnostics.

### Scenario C — Hotkey Lifecycle

- The 300 fake-backed hotkey mode lifecycle cycles **PASSED** as part of the NativeHost Checks suite (54/54 total checks).
- **NOT RUN:** the 10 real isolated runtime mode cycles were not started after the Scenario A stop gate. No 300-key synthetic tail was used.

### Final Isolated Host State and Functional Sanity

- After evidence capture, a final control-pipe snapshot confirmed the isolated host was hidden with empty query/results and HWND `2689636`. The isolated Host then acknowledged the explicit test-only `exit` command and PID `20412` exited normally.
- The live installation PID `25244` remained present at `D:\webtools\WebTools.NativeHost.exe`; Manager/Electron remained 0. This is a path-scoped process observation, not a GUI/manual test of the live installation.
- Initial bounded pipe/corpus smoke before Scenario A passed all 20 query categories and showed the production activation path reaching an active window with QueryBox focus. This does not replace the final real keyboard/hotkey acceptance.
- Tray interaction, real physical hotkey/input after the stress workload, the 300 show/hide scenario, and the 10 real runtime hotkey mode cycles remain **NEEDS MANUAL / FUTURE TARGETED VERIFICATION**. No GUI behavior is inferred from code.

### Automated Regression

- `npm run typecheck` — **PASS**.
- `npm test` — **PASS, 96/96** (Node emitted existing `MODULE_TYPELESS_PACKAGE_JSON` reparsing warnings; no test failed).
- `npm run build` — **PASS**.
- `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release` — **PASS, 54/54**, including fake-backed 300-cycle hotkey transitions.
- PowerShell AST parse of `native/scripts/Measure-Phase4EResources.ps1` — **PASS**.
- Release publish with `.NET 10`, `win-x64`, self-contained, `PublishSingleFile=false` — **PASS**, to a separate external `publish-regression` directory; its EXE/DLL hashes matched the Scenario A build. No installer/package was made.
- `git diff --check` — **PASS** after the final documentation edit (Git emitted only the existing LF-to-CRLF working-copy notices; no whitespace errors).
- The final read-only review found no P0/P1 issue in the Phase 4G-2 additions. It identified that generic sampler cleanup discarded non-empty error evidence; this was fixed only in the Phase 4G-2 cleanup path, including a guard against racing a sampler job that has not confirmed shutdown.

### Files Changed and Git State

Phase 4G-2 files changed:

- `native/WebTools.NativeHost/Diagnostics/Phase4EResourceControlServer.cs` — bounded test-mode commands and window/resource presentation fields.
- `native/WebTools.NativeHost/App.xaml.cs` — connect the isolated diagnostic pipe to the existing MainWindow and hotkey service.
- `native/WebTools.NativeHost/MainWindow.xaml.cs` — test-mode-only query/show/hide calls and snapshot fields using the production window methods.
- `native/WebTools.NativeHost.Checks/Program.cs` — 300 fake-backed hotkey lifecycle cycle check and command validation.
- `native/scripts/Measure-Phase4EResources.ps1` — opt-in A/B/C measurement path; incremental G2 managed-snapshot and error-evidence persistence.
- `docs/native-launcher-phase4g-final-validation.md` — this Phase 4G-2 evidence and decision section.
- `docs/superpowers/plans/2026-10-01-native-launcher-stress-resource-stability.md` — approved execution plan.

Other existing Hotkey System 2.0 work in this same worktree remains untouched and uncommitted, including `README.md`, `native/WebTools.NativeHost/Interop/NativeMethods.cs`, `native/WebTools.NativeHost/Services/GlobalHotkeyService.cs`, `src/features/settings/SettingsView.vue`, the new hotkey model/service files, and its plan. `Program.cs` contains both the 4G-2 check and pre-existing Hotkey System 2.0 checks.

- Branch: `codex/shared-ai-translation-2.0`.
- HEAD: `9d23d543633a29d729904f23273487748633177d`.
- `git status`: **DIRTY**, with the files listed above; no files were staged or committed.
- No push, PR, merge, tag, release, or Phase 4G-3 work occurred.

### Findings and Remaining Gate

- **P0: 0 observed. P1: 0 confirmed. P2: 1 inconclusive resource-retention signal. P3: 0.** The P2 item is the stepwise settled handle increase during Scenario A, followed by a decline from 918 to a stable 907 during idle. The faulty small attribution collector did not resolve it. No product fix was made because the source and persistence of the handles are not yet established.
- **Scenario A: complete and recorded. Scenario B: not run. Scenario C: fake 300-cycle automated leg passed; real 10-cycle runtime leg not run.** The complete Phase 4G-2 acceptance criteria are not satisfied.
- No commit, push, PR, merge, tag, release, or Phase 4G-3 work was performed.

**PHASE 4G-2 INCOMPLETE — HANDLE-COUNT ATTRIBUTION AND SCENARIOS B/C REMAIN OPEN.**

### Targeted Handle Attribution — 2026-10-01

This is a follow-up to the historical Scenario A evidence above. It preserves the original 3 × 1,000 measurements and the earlier zero-length attribution attempt. The new collector smoke and targeted run are separate evidence; no product search behavior was changed.

#### Collector Validation

- **Collector smoke: PASS.** The sacrificial real-WPF test host (PID `24116`) produced 34 non-empty OS samples with timestamps, stages, PID, Private Bytes, Working Set, GDI, USER, Handles, and Threads. All rows reported the target process present. A disposable saved-website fixture, `/` website query, empty query, no-result query, and Control Panel presentation were checked without opening a URL. Seven managed checkpoints were incrementally exported and read back after each flush.
- **Error persistence: PASS.** The error probe intentionally expected three NativeHost processes while only two were present. It persisted the exact error (`Expected 3 NativeHost process(es); found 2.`) to the error text and JSON after sampler cleanup; its CSV retained one sample. The probe was not a product failure.
- **Targeted CSV integrity: PASS.** The targeted run produced 158 rows across the initial idle, workload, checkpoint, immediate, hidden, and two settle stages. All rows have the same isolated target PID (`28732`), valid timestamps and plausible numeric counters; no target-missing or nonzero-Electron row was found. The sampler's output contamination prevented the wrapper from writing its final aggregate manifest after Block A. The raw CSV and incrementally flushed managed CSV remain valid. The wrapper issue was corrected afterward by making snapshot return opt-in; no workload was rerun with the corrected script.
- Collector smoke OS CSV SHA-256: `A04D81F01951E4BAC3E30B2A464E595C2D80DA003F052C485FFFCA81DC74EAC2`.
- Collector smoke managed CSV SHA-256: `D999C0940ED291DCF85B7A157AA1A4F4E0953919896F902419AE2093E4367331`.
- Targeted OS CSV SHA-256: `9B0E8D824613500C73DAFB9E17F41301E4B2573BCA96B6EC60146E8EEECD1187`.
- Targeted managed CSV SHA-256: `7ABDBED7A17E27F100A5239B061919039C1DC8033857AE641B4A81151CCB0567`.

#### Attribution Environment

- Source branch/HEAD: `codex/shared-ai-translation-2.0` / `9d23d543633a29d729904f23273487748633177d`.
- Runtime: .NET SDK `10.0.401`, `win-x64`, self-contained Release output, `PublishSingleFile=false`.
- Isolated executable: `D:\系统缓存\WebTools Phase4G2 Attribution-20261001-9d23d543\publish\WebTools.NativeHost.exe`, SHA-256 `9BF4E58A2DE052D517D824DDB93E9CEB7978A44B21FA89FDAA81EB978AF4BFF7`.
- Isolated assembly: `WebTools.NativeHost.dll`, SHA-256 `3446DBE88B166BF8791B8059BD81DF3E5BC439D8DB9C30C4D5D6EC3018B28119`.
- The sampled collector version SHA-256 was `B97343B5F843247C25FE036CEABABFB9F2167B719712E8B7A56F75A5B9877435`. After the run, the wrapper-only output fix changed the current collector SHA-256 to `BE9E72D7F016D2225B9B55A4127FB4460ECE99151C2216F1DCB981D8595C0FCE`; the fix was AST-checked but not used for another workload.
- Isolated profile: `D:\系统缓存\WebTools Phase4G2 Attribution-20261001-9d23d543\profiles\targeted-attribution`. The separate live installation `D:\webtools\WebTools.NativeHost.exe` (PID `25244`) remained untouched. Targeted samples observed two NativeHosts system-wide (the isolated host plus that live instance), while Manager/Electron stayed at zero.
- The fresh isolated process PID `28732` and MainWindow HWND `3541152` were used throughout Block A and both settle windows. A final control-pipe snapshot showed it hidden with empty query/results, and the host acknowledged the test-only `exit` command and exited normally. The live PID `25244` remained running afterward.
- Everything was enabled and available (`D:\System default\Download\es\es.exe`; Everything PIDs `1868` and `5620`), but the Everything attribution block was not run after the stop gate.
- The real user profile, startup setting, tray/hotkey configuration, and installed files were not changed. No installer, forced GC, working-set trim, process restart between blocks, UIA, or synthetic keyboard input was used.

#### Block A — Local App/Search

- **AUTOMATED OBSERVATION: 300 query changes completed** in the same isolated PID/HWND. The repeated local-only corpus covered Control Panel and File Explorer/Device Manager aliases, Chinese names, and pinyin (`kongzhimianban`, `wenjian`); no `file:` or website-only query was used in this block.
- At 100/200/300-query managed checkpoints, the presentation was the expected local app result state (`wenjian`: two results, two realized rows, one visible icon, five cached app icons). The window remained the same HWND. Hide cleared query/results/visible icons; the app icon cache count remained five.
- OS Handles were 815 at the 100/200 query snapshots and 813 immediately after the block; the two workload-time OS samples ranged from 816 to 823. These are observations, not a leak determination.
- The required natural settle completed for 60 seconds and then one additional 60-second idle window because the first window's early/late Handles medians differed by at least two. The second window still met the collector's conservative “still changing” criterion, which meets the approved stop condition. After the measurements had completed, the wrapper errored while aggregating Block A because snapshot objects had contaminated its PowerShell output collection; it therefore did not serialize the final block/stop manifest. Blocks B/C/D were not started, and no repeat of A was run. The stop decision here is based on the durable raw samples, not a claim that the wrapper successfully executed its stop branch.

#### Block B — Website

- **NOT RUN as an attribution workload** because Block A remained inconclusive after 120 seconds.
- The separate collector smoke did verify the disposable website fixture's local-name and `/` presentation paths. Its URL used the `.invalid` test domain and was never opened. This smoke does not count as Block B attribution or external-open acceptance.

#### Block C — Everything

- Everything and `es.exe` were available, but the block was **NOT RUN** because the Block A stop gate applied first. No `file:` attribution queries were issued in this targeted run, and Everything configuration was not changed. The prior Scenario A's Everything coverage remains historical context only; it does not isolate this signal.

#### Block D — Control / Clear

- **NOT RUN as an attribution workload** because the Block A stop gate applied first. Empty/no-result controls were checked only in collector smoke, not as a 300-query resource block.

#### Handle-Type Attribution

- **HANDLE TYPE ATTRIBUTION — NOT AVAILABLE.** `handle.exe` / `handle64.exe` were not on PATH and no copy was found in the checked Sysinternals/common program locations. No invasive instrumentation or downloaded tool was introduced. GDI and USER object counters were available, but they do not classify the process's kernel Handles by object type.

#### Resource Table

MiB is bytes divided by 1,048,576. Settling windows contain one-second external process samples; single-checkpoint rows are points, not statistical windows.

| Stage | Samples | Private Bytes (median; range MiB) | Working Set (median; range MiB) | GDI | USER | Threads | Handles |
|---|---:|---:|---:|---:|---:|---:|---:|
| Initial hidden idle, 30 s | 30 | 71.80; 71.53–71.93 | 128.40; 128.12–128.46 | 12 | 23 (21–23) | 26 (21–28) | 760 (754–763) |
| During A workload | 2 | 90.28; 87.00–93.55 | 153.16; 150.14–156.18 | 54–55 | 40 | 26–27 | 816–823 |
| A checkpoint at 100 | 1 | 100.07 | 164.73 | 54 | 40 | 27 | 815 |
| A checkpoint at 200 | 1 | 102.37 | 167.47 | 54 | 41 | 27 | 815 |
| A immediate | 1 | 103.59 | 171.50 | 54 | 41 | 27 | 813 |
| A hidden | 1 | 103.86 | 172.76 | 54 | 40 | 27 | 811 |
| A settle, first 60 s | 60 | 106.75; 106.64–107.11 | 176.54; 176.49–176.73 | 54 | 34 (33–40) | 20 (18–27) | 800 (793–811) |
| A settle, additional 60 s | 60 | 99.72; 99.72–99.93 | 167.72; 167.71–167.81 | 54 | 33 (32–34) | 16 (16–21) | 800 (798–808) |

Handles first-ten versus last-ten medians were `808 → 793` during the first settle window and `802.5 → 800` during the additional window. The latter absolute delta (`2.5`) meets the sampler's conservative `>= 2` threshold, despite moving downward rather than showing monotonic growth. The initial hidden-idle Handles median was 760; the two settled-window medians were 800 (about +40). GDI rose from 12 in the initial hidden idle window to 54 after first presentation and stayed at 54 through both settles; this is consistent with a one-time presentation-associated change, but without object-type enumeration it cannot explain the total Handles delta.

Across all targeted OS rows, NativeHost count was 2 (isolated test host plus untouched live installation), Electron/Manager count was 0, and the target PID remained present. No repeated equivalent block was run, so there is no reproducibility evidence.

#### Managed Heap Secondary Evidence

The same PID/HWND reported managed heap used bytes of 9.38 MB at initial idle; 17.10/17.33/19.42 MB at the 100/200/300 checkpoints; 19.44 MB immediate; 19.72 MB hidden; 19.75 MB at 60 seconds; and 19.77 MB at 120 seconds (decimal MB). At the final checkpoint, `GC.GetGCMemoryInfo()` reported heap size 9.92 MB and fragmentation 0.39 MB. These are different freshness views: used bytes come from `GC.GetTotalMemory(false)`, while heap size/fragmentation describe the most recent GC and can lag allocations since then. The values were flushed incrementally. No GC was forced; heap-used values alone neither attribute kernel Handles nor prove a leak.

#### Interpretation

The new run establishes that first local app presentation coincided with a GDI counter change and a higher total-Handles band, while Private Bytes/Working Set and thread counts fell during the second natural idle window. The Handles series varied (including a falling 2.5-count first-ten/last-ten median delta in the final window) and was not confirmed by a repeated equivalent workload. The exact kernel handle types and whether the bounded change is WPF/search/icon warm-up or another retained resource remain unknown. Therefore the evidence supports neither “harmless” nor “leak/product defect.”

#### P0/P1/P2/P3

- **P0: 0 observed.**
- **P1: 0 confirmed.**
- **P2: 1 — unresolved, non-monotonic Handles/GDI attribution signal; no repeatability evidence.**
- **P3: 0.**
- No product fix was made or should be inferred from this run.

#### Files Changed

- `native/scripts/Measure-Phase4EResources.ps1` — the snapshot object is now returned only when explicitly requested by the visible-presentation checkpoint. Ordinary managed snapshots no longer leak objects into a caller's PowerShell output collection. PowerShell AST parsing passes. This fixes the wrapper aggregation failure after Block A; the corrected script was not rerun against a workload.
- `docs/native-launcher-phase4g-final-validation.md` — appended this targeted-attribution evidence; the original Phase 4G-1, Hotkey System 2.0, and Scenario A measurements were not edited.

#### Git Status

- Branch: `codex/shared-ai-translation-2.0`; HEAD: `9d23d543633a29d729904f23273487748633177d`.
- Worktree remains dirty with the existing Hotkey System 2.0 / Phase 4G-2 changes plus the collector and documentation updates. Nothing was staged or committed; no push, PR, merge, tag, or release occurred.

#### Decision

**HANDLE SIGNAL STILL INCONCLUSIVE — PHASE 4G-2 REMAINS PAUSED.** Do not resume Scenario B or the real Scenario C leg yet. The targeted data did not establish repeatable retained-handle growth, and it did not identify the types/source of the changed handles. Phase 4G-2 remains incomplete; do not start Phase 4G-3.

### Handle Repetition Confirmation — 2026-10-01

#### Collector Validation

- Pre-workload PowerShell AST parse: **PASS**. NativeHost Checks: **54/54 PASS**.
- The corrected collector smoke before the workload wrote/read back its aggregate manifest, produced a non-empty OS CSV (34 rows), and incrementally flushed/read back 9 managed checkpoints. The controlled error probe wrote one valid sample and preserved the deliberate error `Expected 3 NativeHost process(es); found 2.`
- The actual repetition run wrote its manifest, 220-row OS CSV, and 16-row managed CSV. All OS rows passed PID/process-presence/native-count/Electron-count/driver and numeric-field validation. Its final stage validator returned exit code 1 because it incorrectly required one-second OS samples for the instantaneous `ATTR-WARMUP-PRESENTED` and `ATTR-WARMUP-HIDDEN` stages. Both were present in the managed checkpoint CSV; their transitions were shorter than the OS sampler interval.
- Collector-only correction: warm-up presentation/hide are now validated from managed checkpoints, while only duration-bearing stages are required in the one-second OS CSV. The correction also validates same-HWND visible/result and cleared-hidden state from those checkpoints. No product code changed and the workload was not rerun.
- On the corrected sampler, a fresh collector smoke passed (33 OS rows, 9 managed rows, manifest read-back) and a fresh error probe passed (one OS row and durable deliberate-error evidence). A read-only post-hoc validation of the existing repetition artifacts passed for all required duration stages, all warm-up/workload managed checkpoints, same PID/HWND, and process-safety columns. The corrected WarmRepetition finalizer itself was not run a second time.
- Because the repetition script had already aborted before its requested pipe-exit step, the exact isolated test window received a graceful `WM_CLOSE` after PID, executable path, HWND, and window title were verified. The isolated process exited; no force termination was used. The live `D:\webtools` process was not touched.

#### Test Identity

- Source branch/HEAD: `codex/shared-ai-translation-2.0` / `9d23d543633a29d729904f23273487748633177d`.
- Runtime: .NET SDK `10.0.401`, self-contained `win-x64` NativeHost Release. Executable SHA-256: `9BF4E58A2DE052D517D824DDB93E9CEB7978A44B21FA89FDAA81EB978AF4BFF7`; assembly SHA-256: `3446DBE88B166BF8791B8059BD81DF3E5BC439D8DB9C30C4D5D6EC3018B28119`.
- Sampler used for the workload SHA-256: `AB28E696BE3BD92954D461AF2E62C52C9FAD6C0E2F1DB514258F6F0461143939`. Corrected current sampler SHA-256: `B01E3881B2280C0D5A78B611718E6CED498AA3B2EEEF09852940ED403FF15981`.
- Isolated profile: `D:\系统缓存\WebTools Phase4G2 Handle Repetition-20261001-9d23d543-37c5a42c\profiles\warm-repetition`; it is outside the user's app-data profile and contains the disposable `.invalid` website fixture. Output directory: `D:\系统缓存\WebTools Phase4G2 Handle Repetition-20261001-9d23d543-37c5a42c\handle-repetition-20261001-195326`.
- One isolated NativeHost PID `29664` and one Launcher HWND `985130` were retained through initial idle, warm-up, warm baseline, A1, and A2. The only other NativeHost in every sample was the untouched live `D:\webtools\WebTools.NativeHost.exe` PID `25244`; Manager/Electron count was 0 in all 220 OS samples.
- Repetition manifest: `phase4g2-handle-repetition-manifest-HandleRepetition-1-20261001-195327.json`. OS CSV SHA-256: `F4FE86739384F8036EDF7B8DFC2AD6019736CB7F47C5A384B251F887A45A27EE`. Managed CSV SHA-256: `C70A807A2022B0A51BDE84BCE01F5287346AD114D48C0FDD63CC27F14E726`.

#### Warm-up

- Initial hidden settle: 30 seconds, 30 OS samples; query/results remained empty.
- Warm-up presented the same 10-query Local App corpus used by targeted Block A once: Control Panel (English/Chinese/pinyin), File Explorer (English/Chinese/executable alias), Device Manager (English/Chinese/MSC alias), and `wenjian`. It did not issue website or `file:` queries and did not launch results.
- The final warm-up presentation had 2 results, 2 realized rows, 1 visible icon, and 5 cached app icons. The following hidden checkpoint had an empty query and zero results on the same HWND; the icon cache remained 5.

#### Warm Baseline

After hiding and clearing the warm-up query, the host naturally settled for 60 seconds. The collector recorded 59 one-second samples (minimum acceptance: 50). This becomes the comparison point for both equivalent blocks.

#### Local Block A1

- 300 query changes completed through the real WPF resource-control path on PID `29664` / HWND `985130`; no UI Automation, synthetic keyboard input, GC, working-set trim, process restart, or launch action was used.
- At the managed 100/200/300 checkpoints, presentation remained 2 results / 2 realized rows / 1 visible icon / 5 cached app icons. Hide cleared the query/results while retaining the same HWND and icon cache.
- After hide, A1 settled naturally for 60 seconds (59 OS samples). Settled Handles median: `816`, versus warm baseline last-10 median `824` (`-8`). First-ten to last-ten Handles median moved `826 → 816` (`-10`, **DOWNWARD**), so no extra 60-second window was triggered.

#### Local Block A2

- A second equivalent 300-query block completed without restarting PID `29664` or changing HWND `985130`. The same 100/200/300 managed checkpoints and hide-clear assertions passed.
- After hide, A2 settled naturally for 60 seconds (59 OS samples). Settled Handles median: `828`, versus A1 `816` (`+12`), but only `+3` versus the warm-baseline full-window median `825` (`+4` versus its last-10 median `824`). First-ten to last-ten Handles median moved `836 → 828` (`-8`, **DOWNWARD**), so no extra 60-second window was triggered.

#### Settled Resource Table

Private Bytes and Working Set are MiB (bytes ÷ 1,048,576); their parentheses show the stage min–max. Other counters are medians, with ranges shown where useful. Immediate/hidden checkpoints have one sample.

| Stage | Samples | Private Bytes MiB | Working Set MiB | GDI | USER | Threads | Handles |
|---|---:|---:|---:|---:|---:|---:|---:|
| Initial hidden idle, 30 s | 30 | 72.02 (71.75–72.15) | 128.56 (128.41–128.64) | 12 | 23 | 26 | 753 |
| Warm baseline, 60 s | 59 | 86.84 (86.79–87.18) | 156.15 (155.17–156.35) | 54 | 36 (35–41) | 20 (19–26) | 825 (821–834) |
| A1 immediate | 1 | 102.16 | 171.46 | 54 | 40 | 23 | 831 |
| A1 hidden | 1 | 104.11 | 174.92 | 54 | 39 | 23 | 829 |
| A1 settled, 60 s | 59 | 104.19 (104.19–104.51) | 175.87 (175.86–176.05) | 54 | 35 (34–39) | 16 (16–23) | 816 (814–829) |
| A2 immediate | 1 | 116.79 | 192.02 | 54 | 40 | 21 | 839 |
| A2 hidden | 1 | 115.68 | 189.82 | 54 | 39 | 21 | 839 |
| A2 settled, 60 s | 59 | 115.44 (115.44–115.68) | 189.69 (189.69–189.82) | 54 | 35 (35–39) | 16 (16–21) | 828 (828–839) |

#### Handle Trend

Using the sampler's last-ten medians for the settled windows:

`Warm baseline 824 → A1 settled 816 → A2 settled 828`

This is not a monotonic rise: A1 fell, and A2 returned close to the warm-baseline band (warm baseline `821–834`, A2 `828–839`, overlapping `828–834`). Both settle windows trended downward internally. GDI rose once during first WPF presentation (`12 → 54`) and remained `54` through A1/A2; USER medians were `36 → 35 → 35`, and Threads `20 → 16 → 16`. The data does not reproduce a settled, workload-by-workload Handle/GDI/USER/Thread increase, but the A1-to-A2 Handle step and the paired memory counters prevent treating the entire resource profile as conclusively flat.

#### Managed Heap Secondary Evidence

`GC.GetTotalMemory(false)` reported managed heap used of `5.680 MiB` at warm baseline, `15.144 MiB` at A1 settled, and `15.430 MiB` at A2 settled. This is a large first-block increase followed by a small second-block increase. Reported last-GC heap size was `11.692 MiB`, `7.921 MiB`, and `9.292 MiB`, respectively; fragmentation was `4.284 MiB`, `0.345 MiB`, and `0.372 MiB`. Heap size/fragmentation describe the latest GC snapshot and can lag current allocations. No GC was forced. These values cannot prove or rule out retained objects or attribute kernel Handles.

#### Electron Gate

- All 220 OS rows: target PID present, total NativeHost count 2 (live install plus isolated test host), Manager/Electron process count 0.
- The isolated test Host exited after the run. Final process inventory contained only the unchanged live PID `25244` at `D:\webtools`; Manager/Electron count remained 0.

#### Interpretation

- The specific Handle signal was non-monotonic and close to the warm-baseline range; GDI/USER/Threads did not rise across A1/A2. This does not establish a repeatable Handle leak.
- Private Bytes and Working Set did rise at each settled stage (`86.84/156.15 → 104.19/175.87 → 115.44/189.69 MiB`). Because the run contained only two repeated blocks and no forced GC, this may include lazy/committed runtime or presentation memory, but the cause is **UNKNOWN**. It is a separate resource-retention observation, not proof of a Handle leak.
- No product change was made. Do not continue to Scenario B/C or Phase 4G-3 on this result without user review; the limited A1/A2 evidence cannot distinguish bounded process-memory warm-up from further retained growth.

#### P0/P1/P2/P3

- **P0: 0 observed.**
- **P1: 0 confirmed.**
- **P2: 1 — Handle trend is non-monotonic, while settled Private Bytes/Working Set rise across the two repeats and remain unattributed. No product defect is confirmed.**
- **P3: 0.**

#### Files Changed

- `native/scripts/Measure-Phase4EResources.ps1` — corrected the collector's stage policy so instantaneous warm-up presentation/hide are asserted from managed checkpoints rather than requiring a one-second OS sample; added persisted managed-state validation for same-HWND presentation and cleared-hidden state.
- `docs/native-launcher-phase4g-final-validation.md` — appended this repetition evidence. Historical Phase 4G-1 and earlier Phase 4G-2 measurements remain unchanged.
- No product code changed.

#### Git Status

- Branch/HEAD remain `codex/shared-ai-translation-2.0` / `9d23d543633a29d729904f23273487748633177d`.
- Worktree remains dirty with prior Hotkey System 2.0 / Phase 4G-2 work plus this collector/report update. Nothing is staged or committed; no push, PR, merge, tag, release, or Phase 4G-3 work occurred.

#### Decision

**HANDLE SIGNAL STILL INCONCLUSIVE.** Handles alone did not show a monotonic increase, but the A1/A2 variation and stepwise settled Private Bytes/Working Set mean the broader repeated-resource result cannot yet be called a confirmed plateau. Keep Phase 4G-2 incomplete and stopped here for user review; Scenario B/C were not run.

### Warm Memory Convergence Confirmation — 2026-10-01

#### Scope and Safety

- This was a finite, measurement-only confirmation. It stopped after A4; Scenario B/C and Phase 4G-3 were not started.
- The live installation at `D:\webtools` was left running and untouched throughout (NativeHost PID `25244`). Manager/Electron remained at 0.
- The primary run used a new isolated profile under the system temp directory. It contained only the disposable `launcher-state.json` and `app-catalog.v1.json` snapshots; no user AppData profile, settings, or credentials were used.
- No process restart, UI Automation, result activation, `file:` query, website-only query, forced GC, or working-set trim was performed.

#### Source and Build Identity

- Source branch/HEAD: `codex/shared-ai-translation-2.0` / `9d23d543633a29d729904f23273487748633177d`.
- Runtime artifact reused from the prior isolated attribution build: `D:\系统缓存\WebTools Phase4G2 Attribution-20261001-9d23d543\publish\WebTools.NativeHost.exe`, self-contained `win-x64` NativeHost Release, .NET SDK `10.0.401`.
- NativeHost executable SHA-256: `9BF4E58A2DE052D517D824DDB93E9CEB7978A44B21FA89FDAA81EB978AF4BFF7`.
- NativeHost assembly SHA-256: `3446DBE88B166BF8791B8059BD81DF3E5BC439D8DB9C30C4D5D6EC3018B28119`.
- NativeHost source fingerprint captured for the run: `37AA8A2AE77C10552A93479EBAA4B6DF52C461E00ACA7CA594E1C8D77258AEFD` (47 source/configuration files). No NativeHost product source changed during this confirmation.
- Primary test PID/HWND: `26636` / `3737670`. Both remained constant through initial idle, warm-up, warm baseline, and A1–A4.

#### Collector Preflight

- Before the primary run, a separate disposable smoke Host (PID `9296`, HWND `8391188`) completed the corrected sampler's smoke: **34 OS samples**, **9 incrementally persisted managed checkpoints**, manifest write/read-back, same PID/HWND checks, and Manager/Electron `0`. The smoke Host exited normally through its test-only pipe.
- Smoke artifacts are under `D:\系统缓存\WebTools Phase4G2 Warm Memory Convergence-20261001-9d23d543\warm-memory-20261001-204205\collector-smoke\`; manifest result was `collector-smoke-pass`.
- The sampler used for the primary run had SHA-256 `8C6B6600AD533EF78F5E9CEF6C866B7FE459631D9346A4A4CB9CD4737F444136`.

#### Warm-up and Workload

- Initial hidden idle: **30 seconds / 30 OS samples**. The same single test Launcher HWND was retained.
- Warm-up ran the same 10-query Local App corpus used by Block A once: `Control Panel`, `控制面板`, `kongzhimianban`, `File Explorer`, `文件资源管理器`, `explorer.exe`, `Device Manager`, `devmgmt.msc`, `设备管理器`, and `wenjian`. No website or `file:` query was used, and no result was launched.
- Warm-up presentation had 2 results, 2 realized rows, 1 visible icon, and 5 cached app icons. The managed hidden checkpoint showed an empty query, zero results/realized rows, the same HWND, and the retained 5-entry icon cache.
- After warm-up, the Launcher was hidden and naturally settled for **60 seconds / 59 OS samples** to form the warm baseline.
- A1, A2, A3, and A4 each performed **300 equivalent local-app query changes** (the 10-query corpus repeated 30 times) on the same PID/HWND. At each 100/200/300 checkpoint, presentation remained 2 results, 2 realized rows, 1 visible icon, and 5 cached icons. Each block then hid and cleared the query/results and naturally settled for 60 seconds / 59 OS samples. No block required an extra 60-second settle.

#### Settled Resource Table

Private Bytes and Working Set are MiB. The table gives the median across each stage's one-second OS samples and the stage min–max. `Handles` shows full-stage median / final-ten median; other counters are full-stage medians.

| Stage | Samples | Private Bytes MiB (range) | Working Set MiB (range) | Handles median / last 10 | GDI | USER | Threads |
|---|---:|---:|---:|---:|---:|---:|---:|
| Initial hidden idle, 30 s | 30 | 71.85 (70.96–71.98) | 128.51 (126.53–128.58) | 753 / 750 | 12 | 23 | 25 |
| Warm baseline, 60 s | 59 | 86.99 (86.90–87.31) | 156.21 (154.35–156.43) | 821 / 820 | 54 | 36 | 20 |
| A1 settled, 60 s | 59 | 108.07 (108.07–108.39) | 179.48 (179.48–179.65) | 816 / 816 | 54 | 35 | 16 |
| A2 settled, 60 s | 59 | 106.87 (106.87–114.04) | 179.49 (179.49–187.32) | 828 / 828 | 54 | 35 | 16 |
| A3 settled, 60 s | 59 | 105.76 (105.76–113.05) | 179.26 (179.26–186.24) | 828 / 828 | 54 | 35 | 16 |
| A4 settled, 60 s | 59 | 108.69 (108.64–108.87) | 182.13 (182.10–182.22) | 824 / 826 | 54 | 35 | 18 |

The A2/A3 stage maxima were transient samples within their 60-second windows; their final-ten medians returned to `106.87 / 179.49 MiB` and `105.76 / 179.26 MiB`, respectively. A4's final-ten medians were `108.73 / 182.17 MiB`.

#### Explicit Settled Memory Deltas

Deltas below use each 60-second stage-wide median:

| Transition | Private Bytes | Working Set |
|---|---:|---:|
| Warm → A1 | +21.07 MiB | +23.26 MiB |
| A1 → A2 | -1.20 MiB | +0.02 MiB |
| A2 → A3 | -1.11 MiB | -0.23 MiB |
| A3 → A4 | +2.93 MiB | +2.87 MiB |

The corresponding final-ten median deltas were `+21.11 / +23.28`, `-1.20 / +0.02`, `-1.11 / -0.23`, and `+2.97 / +2.91 MiB`. The first block produced a clear one-time increase over the warm baseline. Across the four repeated settled blocks, Private Bytes and Working Set did not increase monotonically: A2/A3 were close to or below A1, and A4 rose modestly, leaving A4 only `+0.62 MiB` Private Bytes and `+2.65 MiB` Working Set above A1. The observed repeat-block range is bounded rather than a continued stepwise rise. The run does not attribute the first-block increase to a specific allocation source; no GC was forced.

#### Managed Heap and Handles

`GC.GetTotalMemory(false)` and related managed snapshots were secondary measurements; they were not forced or treated as a leak verdict.

| Checkpoint | Heap used MiB | Heap size MiB | Fragmented MiB | Visible / results / realized / icon cache |
|---|---:|---:|---:|---|
| Warm baseline | 9.59 | 7.76 | 0.36 | hidden / 0 / 0 / 5 |
| A1 settled | 15.12 | 7.99 | 0.35 | hidden / 0 / 0 / 5 |
| A2 settled | 16.24 | 10.05 | 0.39 | hidden / 0 / 0 / 5 |
| A3 settled | 14.53 | 9.23 | 0.49 | hidden / 0 / 0 / 5 |
| A4 settled | 14.60 | 10.17 | 0.38 | hidden / 0 / 0 / 5 |

Handles followed `821 → 816 → 828 → 828 → 824` (warm baseline through A4); each per-block 60-second window trended downward internally. GDI stayed at `54` after first presentation; USER stayed around `35–36`; Threads were `20 → 16 → 16 → 16 → 18`. These secondary signals did not show a sustained monotonic increase.

#### Process Gate and Artifact Validation

- The primary OS CSV contains **349 rows** across 28 stages. Every row has target PID `26636`, `ProcessPresent=True`, NativeHost count `2` (the untouched installed process plus the isolated test Host), Manager/Electron count `0`, and populated numeric resource fields.
- The 28-row managed CSV consistently records PID `26636` and HWND `3737670`. Warm-up visible/hidden states and A1–A4 100/200/300 presentation and hide-clear checkpoints all passed read-only validation.
- The four-block manifest read-back reports `four-equivalent-local-blocks-completed`, 4 blocks × 300 query changes, warm-up count 10, and Manager/Electron `0`.
- The isolated Host exited normally after an acknowledged test-only resource-pipe `exit` command. The final inventory contained only the unchanged live `D:\webtools\WebTools.NativeHost.exe` PID `25244`; Manager/Electron remained `0`.
- OS CSV SHA-256: `36BB497542E2F6FFA04DE592FCD67A0B95E43580D37E845977E7BD79D0D004E9`.
- Managed CSV SHA-256: `D4ECFA5D121946EBA2260656035DFE36C7496FFDB25FD4AFB5009166D5906B43`.
- Manifest SHA-256: `7634D52AA6386F999FC468CA80D276FFC149742E75B5C7944A7A26011728B154`.

#### Collector Finalizer Correction

- The complete A1–A4 workload and its evidence were written, but the sampler's first final validation exited with code 1 because its duration-stage list mistakenly included the instantaneous `ATTR-WARMUP-HIDDEN` checkpoint. That transition is intentionally validated from the managed checkpoint CSV, not the one-second OS CSV. The manifest, all duration-bearing stages, process-safety columns, and managed presentation/clear checkpoints independently passed read-only validation.
- The sampler was corrected to exclude both instantaneous warm-up checkpoints from required OS stages and to dispose its control-pipe client in an outer `finally` path if validation fails. Corrected script SHA-256: `04E719E5936DAA12552DAC8DDD6DAC4BD45FFA1A027CD63CA334ECA62DBA595B`.
- The four-block workload was not repeated. After the wrapper stopped, the exact isolated process identity was rechecked and the test-only pipe acknowledged a normal exit. No force termination was used. Earlier evidence remains unchanged.

#### Checks and Files Changed

- PowerShell AST parse and the A1–A4 runner/duration-stage contract: **PASS**.
- NativeHost Checks: **54/54 PASS** after the final sampler-only correction; no product code changed.
- Collector preflight smoke: **PASS** (34 OS rows, 9 managed checkpoints, manifest read-back, same PID/HWND, Manager/Electron 0).
- `git diff --check`: **PASS**; Git emitted only its existing LF-to-CRLF working-copy notices.
- This confirmation changed only `native/scripts/Measure-Phase4EResources.ps1` and this report. No product code, dependencies, data schema, or prior measurements were changed. Nothing was staged or committed.
- Evidence directory: `D:\系统缓存\WebTools Phase4G2 Warm Memory Convergence-20261001-9d23d543\warm-memory-20261001-204205\`.

#### P0 / P1 / P2 / P3

- **P0: 0 observed.**
- **P1: 0 confirmed.**
- **P2: 0 confirmed from this finite convergence sample.** The first-block increase remains unattributed, but the three subsequent settled blocks (A2–A4) do not show continued monotonic growth.
- **P3: 0.**

#### Decision

**RESOURCE SIGNAL RESOLVED — WARM-UP CONVERGES / BOUNDED**

The new same-process A1–A4 run resolves the previous limited-repeat ambiguity for this workload: the initial increase occurs in A1, while subsequent settled Private Bytes, Working Set, Handles, GDI, USER, Threads, and managed heap values fluctuate within a bounded band rather than growing continuously. This is not a general long-duration stability claim and does not attribute the initial increase. **At the time of this checkpoint**, Scenario B/C had not run and Phase 4G-2 remained pending. The later final acceptance section records their completion.

## Phase 4G-2 Final Acceptance — 2026-10-01

This is the sole authoritative Phase 4G-2 closeout. Earlier incomplete/pause statements are preserved as dated intermediate checkpoints; the remaining scenarios and final gates have now been executed.

### Final Decision

**PHASE 4G-2 COMPLETE**

**NATIVE LAUNCHER STRESS / RESOURCE STABILITY PASS**

**READY FOR PHASE 4G-3**

This closes Phase 4G-2 only. Phase 4G-3 was not started. No commit, push, PR, merge, tag, or release was created.

### Source, Build, and Isolation Identity

- Source branch/HEAD: `codex/shared-ai-translation-2.0` / `9d23d543633a29d729904f23273487748633177d`.
- Runtime build: current dirty worktree, .NET SDK `10.0.401`, Release, `win-x64`, self-contained, `PublishSingleFile=false`.
- Scenario B and C used byte-identical NativeHost artifacts. EXE SHA-256: `9BF4E58A2DE052D517D824DDB93E9CEB7978A44B21FA89FDAA81EB978AF4BFF7`; DLL SHA-256: `3446DBE88B166BF8791B8059BD81DF3E5BC439D8DB9C30C4D5D6EC3018B28119`. The final regression publish reproduced both hashes.
- Final sampler SHA-256: `BDC561912FDE4B336632520F681877774E29A44BD53CF8F6A752A038CF0958FD`.
- Scenario A remains the previously recorded 3 × 1,000 search run on PID `20412` / HWND `2689636`. Scenario B used one isolated process/PID `17140` / HWND `12454030`; Scenario C used one isolated process/PID `15016` / HWND `4523812`. PID/HWND identity was stable within each scenario.
- B and C ran in different isolated PIDs because the combined B/C wrapper failed after B completed: the `replace-hotkey` acknowledgement did not contain a window handle, and the wrapper exited the isolated B Host normally. The durable B lifecycle, resource, and managed CSVs were independently validated. The test-only runner was corrected to request a snapshot after each acknowledgement, and C then passed in a fresh isolated PID. Both scenarios used the identical EXE/DLL hashes; the completed B workload was not needlessly repeated.
- Evidence files/hashes in the isolated evidence directory: B `phase4g2-resource-stress-BC-Remaining-1-20261001-212918.csv` (`75EB6FDFF85590960395ACC73402E6A9636AA5905830D3DCF6CF4C3B604B5F3F`), `phase4g2-managed-BC-Remaining-1-20261001-212918.csv` (`2196EE0F170FCC9757F2183973D49506C36482539EE818C555394B21D6642AED`), and `phase4g2-lifecycle-BC-Remaining-1-20261001-212918.csv` (`46375EF0905BAF0D5D422B32E33C145F057013A4D1564BDDEE36AE5BDC170B2A`); C `phase4g2-c-only-manifest-20261001-213915.json` (`11492F949014EF27496F6CD83AE31586E8A065851082DFDBD4AA92AA42B22A8F`), `phase4g2-resource-c-only-20261001-213915.csv` (`CA838363F13D7064FA68C667ADA64C7D0D82A937A5E38C2493E5ED7E4F80AB66`), and `phase4g2-lifecycle-c-only-20261001-213915.csv` (`ABDAEB49AC99EEEC94A66C8883F34BB5CAF26BC9757AD617D6CE22AA2B83F654`).
- Isolated profiles and evidence are under `D:\系统缓存\WebTools Phase4G2 Final Closeout-20261001-9d23d543\`. The real installation/profile/startup settings at `D:\webtools` were not modified. Live NativeHost PID `25244` remained untouched.

### Scenario A — Search Stress

- **PASS / COMPLETE:** 3 rounds × 1,000 no-UIA WPF query changes; same PID/HWND within the scenario; 30-second initial idle and natural 60-second post-round settles.
- The frozen corpus covered app aliases, Chinese, pinyin, initials, English, fuzzy matching, saved website name/URL fragment, `/`, `?`, `file:`, empty/no-result states, and result ordering. Presentation assertions passed; no result was launched.
- The later same-PID A1–A4 repetition showed the initial warm-up increase followed by bounded, non-monotonic settled Private Bytes, Working Set, Handles, GDI, USER, Threads, and managed heap. Handle repetition was also non-monotonic and near the warm baseline. **RESOURCE SIGNAL RESOLVED — WARM-UP CONVERGES / BOUNDED.** This is a finite-workload stability result, not a claim about indefinite uptime.

### Scenario B — 300 Window Show/Hide Cycles

- **PASS:** 300 `show → visible → hide → hidden` cycles ran on the same NativeHost PID `17140` and HWND `12454030`; no window instance/PID growth, crash, hang, orphan, Manager, or Electron process was observed.
- Six fixed local-search checkpoints ran at cycles 50/100/150/200/250/300. Each displayed four application results on the same HWND; each subsequent hide cleared query and results. The lifecycle CSV contains 606 records (300 show, 300 hide, six checkpoint queries). Every show recorded visible/active/query-focus true; every hide recorded invisible and inactive. Focus is diagnostic evidence, not an independent hard gate.
- The OS collector retained 118 one-second samples, including 30 seconds initial idle and 60 seconds after the scenario. Every row retained the target PID, `ProcessPresent=True`, NativeHost count 2 (isolated Host plus untouched live installation), and `ElectronProcessCount=0`.
- Settled B counters did not show sustained cycle-by-cycle accumulation. Transient GDI/Private Bytes/Working Set variations during WPF presentation settled; the final settled window had GDI 54, USER median 36, Handles median 817 (range 807–829), and Threads median 19.

### Scenario C — Hotkey Lifecycle

- Fake-backed hotkey lifecycle stress remains **PASS: 300 complete cycles** in NativeHost Checks.
- **Real isolated runtime PASS:** 10 mode cycles (30 acknowledged replacements) on PID `15016` / HWND `4523812`, alternating the test chord `Control+Alt+Shift+F12`, `DoubleModifier:Control`, `DoubleModifier:Alt`, and back to the chord. The same hidden Launcher window and empty query/results were retained across every transition.
- 31 external `RegisterHotKey` probes passed: the startup chord was occupied at initial/final chord mode and free in both double-modifier modes on every cycle. Real mode changes exercised observer acquisition/release; replacement would fail if observer disposal failed. The observer hook itself is not independently enumerated by Windows, so no system-wide hook count is claimed.
- No stale registration, failed transition, window recreation, NativeHost exit, or Manager/Electron launch occurred. The 101-row OS sample retained the isolated PID and process gate through initial idle, transitions, and settle.

### Settled Resource Table

Private Bytes and Working Set are MiB (bytes ÷ 1,048,576); ranges are the samples within each listed stage. For historical A rows, Handles retains the source table's full-stage / final-ten medians; B/C show full-stage median and sample range. These are separate isolated process runs; cross-PID absolute values are not treated as a same-process trend.

| Scenario / Stage | Samples | Private Bytes (median; range MiB) | Working Set (median; range MiB) | GDI | USER | Threads | Handles (median; range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| A — initial idle | 30 | 71.80; 71.53–71.93 | 128.40; 128.12–128.46 | 12 | 23 | 26 | 753 / 750 |
| A — warm baseline | 59 | 86.99; 86.90–87.31 | 156.21; 154.35–156.43 | 54 | 36 | 20 | 821 / 820 |
| A — A1 settle | 59 | 108.07; 108.07–108.39 | 179.48; 179.48–179.65 | 54 | 35 | 16 | 816 / 816 |
| A — A2 settle | 59 | 106.87; 106.87–114.04 | 179.49; 179.49–187.32 | 54 | 35 | 16 | 828 / 828 |
| A — A3 settle | 59 | 105.76; 105.76–113.05 | 179.26; 179.26–186.24 | 54 | 35 | 16 | 828 / 828 |
| A — A4 settle | 59 | 108.69; 108.64–108.87 | 182.13; 182.10–182.22 | 54 | 35 | 18 | 824 / 826 |
| B — initial idle | 30 | 72.05; 70.03–72.18 | 128.66; 126.68–128.73 | 12 | 23 | 26 | 758; 752–758 |
| B — post-cycle settle | 60 | 96.36; 96.23–96.67 | 171.51; 171.45–171.68 | 54 | 36 | 19 | 817; 807–829 |
| C — initial idle | 33 | 71.76; 70.61–71.89 | 128.62; 126.37–128.67 | 12 | 23 | 27 | 760; 754–763 |
| C — post-transition checkpoint | 2 | 71.72; 71.71–71.72 | 129.27; 129.14–129.40 | 12 | 25 | 26 | 777; 777 |
| C — post-transition settle | 66 | 71.32; 71.32–71.72 | 129.26; 129.26–129.41 | 12 | 21 | 17 | 761; 761–777 |

The A warm-baseline row is from the four-block warm convergence run; the exact original Phase 4G-1 five-launch baseline remains unchanged. A/B/C settles were natural; no forced GC, working-set trim, or process restart within a scenario was used. B's 54 GDI after WPF presentation was stable through its settle. C's transient USER/Handles/Threads rise after mode transitions declined by settle; Private Bytes and Working Set returned close to C's idle values. There is no reproducible sustained monotonic trend across equivalent repeats and no newly observed independent resource anomaly.

### Electron / Manager Gate and Post-Stress Sanity

- During A/B/C isolated evidence, the OS sampler consistently saw the isolated Host plus the untouched installed Host, while `ElectronProcessCount=0`.
- Both isolated test Hosts exited through the acknowledged test-only pipe command and normal process exit. Final process inventory contained only the unchanged installed PID `25244` at `D:\webtools`; Manager/Electron count was 0.
- Scenario A search corpus and Scenario B periodic app-query presentation/clear checks passed. Scenario C hotkey mode transitions and registration probes passed. The real user profile and startup registration were not used for test data or modified.
- The prior Hotkey System 2.0 manual Windows acceptance remains **USER CONFIRMED PASS**. No new physical-keyboard interaction was injected during this resource run; direct post-stress keyboard input is therefore not claimed as a newly observed action.

### Final Architecture Gate

- Review of `GlobalHotkeyService`, `LowLevelKeyboardObserver`, `DoubleModifierGestureRecognizer`, `App` cleanup, and the resource-test pipe found one active observer per service, generation-guarded queued activations, explicit deactivation/disposal when leaving observer mode, and deterministic unregister/unhook cleanup on disposal. Mode replacement retains rollback paths for registration/disposal failures.
- Fake-backed 300-cycle lifecycle checks and real 10-cycle runtime replacements passed. Registration probes detected no stale `RegisterHotKey` binding; no product crash, hang, deadlock, duplicate MainWindow/HWND, orphan, or unexpected Electron/Manager process was observed.
- The `replace-hotkey` response omitted HWND and caused the first combined runner to stop after B. This was a test-harness contract issue only. B evidence was already durable and independently validated; the runner now takes a follow-up snapshot after each acknowledgement. No product behavior was changed to accommodate the test tool.
- **P0: 0. P1: 0. Unresolved blocking P2: 0. P3: 1 measurement-continuity note** — Scenario B and C used separate isolated PIDs after the collector issue, although each scenario independently preserved its single PID/HWND and both used identical artifacts. This does not invalidate either completed workload and did not justify repeating B.

### Final Regression

- `npm run typecheck` — **PASS**.
- `npm test` — **PASS**, 96/96.
- `npm run build` — **PASS**.
- NativeHost Checks — **PASS**, 54/54 (includes fake-backed hotkey lifecycle stress).
- UpdateHelper Checks — **PASS**, 10/10.
- Final self-contained `win-x64` NativeHost publish — **PASS**, EXE/DLL hashes match the Scenario B/C runtime artifacts.
- `git diff --check` — **PASS** after this report update.

### Manual Verification Remaining

- **No blocking manual gate remains for Phase 4G-2.** Scenario A/B/C used real isolated WPF NativeHost processes and real Windows window/hotkey-registration APIs, while the previously required user Hotkey System 2.0 matrix is already user-confirmed. A fresh physical-keyboard smoke after the stress run was not performed and is not claimed.

### Files / Git

- Phase 4G-2 evidence/documentation: `docs/native-launcher-phase4g-final-validation.md`.
- Phase 4G-2 sampler and test-mode validation updates: `native/scripts/Measure-Phase4EResources.ps1`, `native/WebTools.NativeHost/App.xaml.cs`, `native/WebTools.NativeHost/MainWindow.xaml.cs`, `native/WebTools.NativeHost/Diagnostics/Phase4EResourceControlServer.cs`, `native/WebTools.NativeHost/Interop/NativeMethods.cs`, `native/WebTools.NativeHost/Services/GlobalHotkeyService.cs`, and `native/WebTools.NativeHost.Checks/Program.cs`.
- Existing Hotkey System 2.0 work in this same uncommitted worktree remains intact; no files were staged or committed.
- Branch/HEAD: `codex/shared-ai-translation-2.0` / `9d23d543633a29d729904f23273487748633177d`.
- Working tree is **DIRTY** with the above work and existing Hotkey System 2.0 documentation/UI/model changes. No commit, push, PR, merge, tag, release, or Phase 4G-3 work occurred.

**PHASE 4G-2 COMPLETE — NATIVE LAUNCHER STRESS / RESOURCE STABILITY PASS — READY FOR PHASE 4G-3**

## Phase 4G-3 — Manager Lifecycle & Process Stability

### Test Identity

- Runtime evidence: 2026-10-02, approximately 23:40–23:47, Asia/Hong_Kong. Documentation closeout: 2026-10-03.
- Windows 11 Pro `10.0.22631`, x64; build SDK `.NET 10.0.401`; Electron `44.4.5`.
- Branch: `codex/shared-ai-translation-2.0`; source checkpoint: `55bb7b29e2dac933780500ee20d125833e1f3b51`. The task attachment's differently spelled hash is a transcription error; actual Git is authoritative.
- Initial working tree: clean. Tested source is that checkpoint plus the explicitly isolated acceptance infrastructure listed below. No installer was built or run.
- Evidence/build directory: `D:\系统缓存\WebTools Phase4G3 验收-20261002-233226`.
- Real self-contained .NET 10 `win-x64` NativeHost: `Native\WebTools.NativeHost.exe` under that directory.
- Real electron-builder unpacked Manager: `manager-build\win-unpacked\WebTools.exe`, with its production `resources\app.asar`. This is a real Release application group, not a synthetic Manager fixture.

| Artifact | SHA-256 |
|---|---|
| NativeHost EXE | `479D87A39C69145ABB260718A3693E2FCCD99A7A18A0C4B21CDDE0DAC1D32C44` |
| NativeHost DLL | `0600499AC9D738C6E8DD6DCE790CF1725A616AEA0A2714844318802CC495ACC0` |
| Manager EXE | `DB0A928D2D3CC63A35CB1F209D4E256607366D26B9249CA55EAB26B910755EE2` |
| Manager app.asar | `83C69EBB48AAD446B5CFF20F03021D2F80722A5ED41B5367455A3657FE520491` |

A final NativeHost publish matched both tested EXE/DLL hashes. The archived Electron Main matched the final build byte-for-byte (SHA-256 `A51AD5F799006A87BC6CC30968A6EF2C68F056F6EDF18F768346FC855FCEF4C5`). Test-driver-only review fixes did not change those runtime artifacts.

### Test Environment and Safety

- Both Native state and Manager DataStore/SecretStore/Chromium user data use a disposable `profile` under the current user's TEMP. Fictional folder/site records and an empty catalog snapshot were seeded; no real catalog, websites, credentials, or tokens were copied.
- Existing explicit `--phase4e-resource-test` supplies the isolated Native mutex, profile, pipe and `Control+Alt+Shift+F12` binding. It omits the test tray/update server and disables login-startup registry application. This acceptance does not claim a new tray/hotkey test.
- Packaged Manager uses `--phase4g-manager-test`, a validated TEMP profile and the corresponding unique Native pipe. A loopback CDP port is added only by this explicitly isolated launch path. Normal production profiles, window preferences, sandbox/context isolation, and service ownership remain unchanged.
- Driver requests use the real `ManagerController` → `ManagerProcessLauncher` → packaged Electron Main → real Vue/preload/BrowserWindow chain. Normal close is a Windows `WM_CLOSE` message to the identified Manager window, exercising the production close/destroy/quit handlers; it is not pipe-owner shutdown or a forced normal exit.
- Process identity combines canonical executable path, PID, creation timestamp and ancestry. All Chromium children are scoped to this unpacked Manager directory, excluding other Electron apps. Scenario F terminates the confirmed isolated Main only, without terminating its children.
- Real installation `D:\webtools` was not launched, stopped, updated or modified. Original before/after inventories both show NativeHost PID `12556`, creation time `2026-10-02T14:23:02.623567+08:00`, same executable path, and no Manager. Real Nook data/state hashes matched before/after; `secrets.json` remained absent. On the next-day resume the user installation was observed at PID `13284`; it was only observed and not operated on.
- No startup setting was changed. There was no forced GC, working-set trim, UIA workload, Phase 4G-1 baseline rerun, Phase 4G-2 stress rerun, dependency change, or installer rebuild.

### Audit of the Production Lifecycle

- `App.xaml.cs` creates one Manager pipe server/controller. Tray/page requests call `OpenPage`; Launcher Translation actions call `OpenTranslation`. The control driver delegates to those same paths.
- `ManagerController` serializes launch, tracks its real process and renderer-ready generation, queues latest-wins intents and waits for acknowledgement. `Exited` clears the process reference; disconnect resets readiness without stopping NativeHost.
- One audit correction passes `_pipeServer.PipeName` to the process launcher instead of always passing the production constant. The normal pipe name is unchanged; isolated Hosts now cannot accidentally send their Manager to the live Host.
- Native-managed Electron relies on this Native launch gate rather than acquiring another Electron single-instance lock. The runtime reuse test verifies that ownership, rather than assuming a second Electron lock exists.
- Electron connects/handshakes before creating Manager, accepts renderer-ready only from its current main frame and sends the route/prefill intent with its request ID. `App.vue` applies the route; Translation acknowledges after exact prefill application.
- Normal BrowserWindow close destroys the Manager window, cancels active requests and quits Electron. `before-quit` closes the pipe client. Native disconnect/exit handling leaves the resident Host alive and permits a future launch.
- Translation currently auto-translates after an input debounce; that is established product behavior and was not changed. The isolated profile selects AI with no credentials, so these local UI/handoff scenarios cannot call a provider. No external-provider acceptance is claimed.

### Scenario A — Cold Start & Normal Exit

**REAL RELEASE RUNTIME PASS: 5/5 opens and normal closes.** Each ready group had one Main, one Renderer, one GPU and one Utility process. Each completed close reached Electron=0 with its NativeHost alive.

Timing begins immediately before the Native production-open request. Process time ends at the first identity-verified Main observation; window time at its single visible top-level HWND; ready time after Vue DOM, a successful preload `getVersion()` IPC, expected page heading and Native intent acknowledgement. These timings include driver polling/observation overhead and are not physical mouse/keyboard latency measurements.

| Run | Native PID | Main PID | Process observed | Window visible | Renderer/IPC ready | Group exit |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 11360 | 24116 | 171.97 ms | 632.65 ms | 660.28 ms | 368.76 ms |
| 2 | 11360 | 7536 | 246.18 ms | 618.20 ms | 625.68 ms | 365.63 ms |
| 3 | 11360 | 10524 | 185.09 ms | 366.37 ms | 371.27 ms | 289.56 ms |
| 4 | 11360 | 23412 | 244.07 ms | 432.00 ms | 436.72 ms | 289.03 ms |
| 5 | 11084 | 26044 | 192.01 ms | 407.51 ms | 432.32 ms | 295.96 ms |

The first driver's Windows console encoding failed before A. A subsequent exited-child metric race interrupted the first attempted fifth close after four completed samples; that attempt is retained but is not counted. Only run 5 was supplemented after the test-tool correction. Therefore A is not represented as one uninterrupted five-run Native PID.

### Scenario B — Single Instance & Reuse

**REAL RELEASE RUNTIME PASS: 20/20 requests.** Native PID `11084`, Manager Main PID `26152`, HWND `1836952` stayed the same. Each acknowledged Entries/Favorites request had one independent Main and the same single visible Manager HWND. Normal close left the NativeHost running and the entire Manager group absent.

### Scenario C — 30 Open/Close Cycles

**REAL RELEASE RUNTIME PASS: 30/30 cycles on Native PID `11084`.** Every cycle began with Electron=0, loaded the real isolated Favorites data, had one Manager Main/window and ended after normal `WM_CLOSE` with Electron=0 and the released Native Manager state. No Main/child orphan, duplicate instance, Native crash or hang was observed.

| Metric | Minimum | Median | Maximum |
|---|---:|---:|---:|
| Main process observed | 141.94 ms | 174.07 ms | 226.90 ms |
| Visible window observed | 311.79 ms | 349.94 ms | 387.52 ms |
| Renderer/IPC ready | 317.66 ms | 353.69 ms | 391.53 ms |
| Normal group exit | 254.25 ms | 271.39 ms | 390.36 ms |

### Scenario D — Close During Active Operations

**REAL RELEASE RUNTIME PASS: four representative cases.** Settings loaded and an isolated `theme=light` change was verified in Native persisted state; Favorites closed with a real new-folder dialog and unsaved input; Translation closed with local source text and an unconfigured AI provider; a fourth Manager switched Favorites → Settings → Favorites → Translation → Favorites before close. Every case released the Renderer/group and Native pipe session; no observed renderer exception or lingering process remained.

CDP inserted text in the real renderer and observed actual DOM/preload results. Physical keyboard/mouse operation and in-flight external-provider cancellation were not exercised here; this is local-UI lifecycle acceptance, not provider end-to-end acceptance.

### Scenario E — Handoff & Recovery

**REAL RELEASE RUNTIME PASS.** The real WPF query/result path activated Translation with exact original text `  Phase G test don't alter text  `, including its leading/trailing spaces. The resulting source textarea matched exactly and the matching request was acknowledged. A warm replacement `Second handoff exact text` arrived once, retained the same Manager Main and replaced the input.

Manager normal close returned to Native-only; opening Settings again established a new acknowledged IPC session; that Manager also closed normally. Native Launcher subsequently showed, found the isolated website through `/Phase4G3`, hid and cleared its query. The server remained operational. No product translation behavior was changed for this test.

### Scenario F — Unexpected Exit Recovery

**REAL RELEASE RUNTIME PASS on independent Native PID `25960`.** Manager Main `25604` was identity-verified and terminated alone. Its Renderer/GPU/Utility children disappeared without test cleanup. The Native controller reported no process, disconnected/not-ready state and no ensuring operation. NativeHost stayed alive; replacement Main `12316` launched normally as one instance and then closed normally (group-exit observation 380.95 ms).

The earlier F attempt was refused before termination because the test compared CIM microsecond timestamps to Process API 100-nanosecond timestamps as exact strings. The corrected driver retains exact CIM identity/path checks and corroborates the newly acquired handle's start time within the known precision difference. Only F was supplemented; B/C/D/E were not repeated.

### Resource Summary

MiB denotes 1,048,576 bytes. Scenario C checkpoints are taken after ten seconds of natural idle following each fifth close, without GC/trim. These are short lifecycle observations, not a new long-duration memory benchmark.

| Checkpoint | Native PID | PB MiB | WS MiB | Handles | Threads | GDI | USER | Electron |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B complete | 11084 | 74.85 | 134.48 | 778 | 28 | 12 | 25 | 0 |
| C 5 | 11084 | 74.79 | 135.46 | 779 | 26 | 12 | 25 | 0 |
| C 10 | 11084 | 75.33 | 137.12 | 777 | 26 | 12 | 25 | 0 |
| C 15 | 11084 | 71.90 | 133.09 | 773 | 22 | 12 | 25 | 0 |
| C 20 | 11084 | 72.61 | 134.05 | 773 | 22 | 12 | 25 | 0 |
| C 25 | 11084 | 72.61 | 134.09 | 774 | 22 | 12 | 25 | 0 |
| C 30 | 11084 | 78.73 | 142.14 | 774 | 22 | 12 | 25 | 0 |
| D complete | 11084 | 74.37 | 137.65 | 776 | 23 | 12 | 25 | 0 |
| E complete | 11084 | 86.44 | 155.23 | 832 | 26 | 19 | 42 | 0 |
| F crash recovered | 25960 | 70.59 | 128.36 | 775 | 29 | 12 | 24 | 0 |
| F normal close | 25960 | 73.11 | 131.97 | 777 | 29 | 12 | 24 | 0 |

C does not show cycle-correlated monotonic PB/WS/Handles/Threads accumulation; GDI/USER are constant. PB/WS fluctuate, and PB falls again after C30. E includes the first explicit WPF Launcher show/search and has higher first-use UI counters; that single different workload is not extrapolated into a leakage trend. F is a separate PID and is not compared as a continuation of C's memory curve.

Evidence files: `report.json`, `events.jsonl` (361 events), `process-samples.jsonl` (139 periodic samples), preserved `attempt1-*`, `attempt2-*`, `attempt3-*` records and regression/build logs. The one-second sampler captured only part of the principal run before an exited-process metric exception; uninterrupted one-second coverage is **NOT CLAIMED**. Independent identity-verified per-operation inventories and all six C checkpoints remain present. The correction records transient unavailable metrics rather than discarding a still-visible process. No already-valid workload was rerun to repair the collector/report wrapper.

### Final Regression and Review

- `npm run typecheck` — **PASS**.
- `npm test` — **PASS, 98/98**, including new profile-isolation and incomplete-evidence validation checks.
- `npm run build` — **PASS**.
- NativeHost Checks — **PASS, 55/55**; one new isolated Manager launch contract check.
- UpdateHelper Checks — **PASS, 10/10**.
- Native self-contained Release publish and source/artifact identity comparison — **PASS**; final Manager build/archive comparison — **MATCH**.
- PowerShell AST parsing and Node driver syntax check — **PASS**.
- `git diff --check` — **PASS** after the report update.
- Read-only independent review found no changed product lifecycle/isolation defect. The first reviewer was unavailable; a second reviewer completed the scoped review. It independently cross-checked 43 completed normal-close events, Manager ancestry, C checkpoint continuity and real profile/process protection.
- Review identified test-only resume defects: a partial D could be skipped; partial C could span a new Host; completed F could repeat; an old sampler stop marker could prevent resumed sampling. Completeness validation now rejects partial/mixed-PID evidence, incomplete C cannot resume on a new Host, D must contain all four cases, and completed acceptance returns without any new runtime workload. A failing-then-passing validator test and a real completed-report resume smoke cover this correction.

### Final Architecture Gate

| State (isolated installation only) | Result |
|---|---|
| Native idle | Native=1, Manager Main=0, Electron group=0 — **PASS** |
| Manager ready | Native=1, Main=1, one Renderer and Chromium children as required — **PASS** |
| Normal Manager close | Native=1, Manager/Electron=0, disconnected session — **PASS** |
| Unexpected Main exit | Native=1, no orphan/stale Manager; replacement launches and closes — **PASS** |
| Test cleanup | Isolated Native exits through its acknowledged test pipe; only the untouched real installation remains — **PASS** |

No Electron Launcher/tray/global-hotkey ownership was reintroduced. No always-running Manager remains. No production window lifecycle redesign or data schema change was made.

### Findings and Remaining Scope

- **P0: 0. P1: 0. Unresolved blocking P2: 0.** No reproducible product lifecycle defect was found.
- **Non-blocking measurement limitations:** segmented A sampling, separate F Host, incomplete periodic sampler coverage, observation overhead and no physical UI/provider-network acceptance in this pass. They are explicitly distinguished from completed real process/window/IPC assertions.
- Existing Phase 4G-1 measurements, Hotkey System 2.0 user acceptance and Phase 4G-2 resource conclusions remain unchanged. No large historical workload was reopened.

### Files and Git

- `electron/main.ts`, `electron/services/manager-test-options.ts` and its test: fail-closed explicit disposable Manager profile selection; production default unchanged.
- Native `App.xaml.cs`, `ManagerProcessLauncher.cs`, `NativeManagerPipeServer.cs`, `ManagerController.cs`: forward isolated profile/pipe and expose a read-only lifecycle snapshot for the existing test control surface.
- Native `MainWindow.xaml.cs` and `Diagnostics/Phase4EResourceControlServer.cs`: test-gated production page opening, lifecycle observation and real Translation action activation.
- `native/WebTools.NativeHost.Checks/Program.cs`: isolated packaged launch contract regression.
- `native/scripts/Measure-Phase4G3Processes.ps1`, `scripts/verify-manager-lifecycle.mjs`, `scripts/lib/manager-lifecycle-evidence.mjs`, `tests/manager-lifecycle-evidence.test.mjs`: process/window evidence, normal/controlled exit driver and completeness guard.
- At the time of the original Phase 4G-3 closeout, the worktree was **DIRTY** with that task's changes; no staging, commit, push, PR, merge, tag, installer or release action had occurred yet. Raw profiles/artifacts/evidence remained outside Git. The subsequent checkpoint review and Git actions are recorded below.

### Phase 4G-3 Closeout

**PHASE 4G-3 COMPLETE**

**MANAGER LIFECYCLE / PROCESS STABILITY PASS**

**READY FOR PHASE 4G-4**

Stop here. Phase 4G-4 has not started.

## Phase 4G-3 — Post-Acceptance Checkpoint Review

### Review Scope

- Reviewed the complete Phase 4G-3 worktree diff against checkpoint `55bb7b29e2dac933780500ee20d125833e1f3b51`, including NativeHost/Manager lifecycle wiring, the explicit runtime-test boundary, profile isolation, process sampler, evidence driver/validator, and this report.
- The real `D:\webtools` installation, its running NativeHost, startup registration, and real Nook profile were not operated on. The acceptance runtime used separate Release artifacts and a disposable profile below TEMP.
- No A/B/C/E/F workload or Phase 4G-2 stress workload was repeated. Only Scenario D was run as a targeted supplement because the archived report omitted durable operation-level evidence.

### Finding 1 — Profile Isolation

The review confirmed that earlier checks relied on lexical path containment in the Manager acceptance profile, NativeHost resource-test profile, and PowerShell process-sampler output root. A junction could therefore make a TEMP-looking path resolve into a protected location; the process sampler also needed explicit artifact roots when evidence and Release builds lived in separate directories.

The profile boundaries now require an explicit test opt-in, Manager-only mode, absolute paths, an existing strict TEMP descendant, valid isolated pipe names, and no reparse-point traversal. The Manager independently resolves and checks its profile against the real Nook profile and the full packaged install root (including the parent of the `Manager` subdirectory). NativeHost rejects overlap with Nook and its own install directory before reading test data. The process sampler independently validates its evidence/artifact directories under TEMP and rejects reparse points before it writes output. Failures are closed before profile or sampler writes; ordinary launches continue using the established profile.

**Verification:** Manager profile isolation 2/2, including a real Windows junction to Nook; NativeHost Checks 55/55, including an actual temporary junction and explicit Nook/install-root cases; process-sampler PowerShell AST parse and isolated scan PASS; direct sampler invocation through a TEMP junction into Nook was rejected before sampling output.

### Finding 2 — Evidence Validation

The prior validator could treat complete-looking records as a pass without checking the key success facts for every scenario. It now checks each A–F scenario against matching raw runtime events, process identity, process-group membership, ready/normal-close state, NativeHost continuity, and the scenario-specific lifecycle assertions. Scenario D additionally requires one matching `manager-operation` event between the corresponding ready and normal-close events; a stored operation name by itself is insufficient. Known superseded harness errors are recognized only at their recorded scenario/cycle, while other failure records block PASS.

`--resume` now validates a completed report and its manifest/event bytes before launching a Host or creating profile data. The real driver entry was tested with an incomplete completed-looking report; it exited nonzero and created neither `profile` nor `stage.json`.

### Historical Evidence Revalidation

- The original `report.json` and `events.jsonl` were read-only throughout this review. Their SHA-256 values are respectively `f69badfebe27c3f3f03be3bbacf48120d28586ff095e95a293039683970c6b66` and `d767c6844757dcdfd3b6097396bdba6f5de9ca314fe33b85cf3ea7d1b1a6ab95`.
- The archived report contains A=5, B=20, C=30, D=4, E=1, F=1 lifecycle records. Its on-disk NativeHost EXE/DLL, Manager EXE, and `app.asar` hashes were recomputed and match the values in the historical report.
- Revalidation found one actual evidence gap: the historical Scenario D JSON rows did not retain their operation proofs/events. The report narrative described those actions, but the stricter validator correctly returned `EVIDENCE INCOMPLETE` for the archived files alone. No historical data was edited to conceal this gap.
- A derived manifest was created only in memory for the unchanged historical report. The independent current-build D supplement below was then validated separately and combined with the historical A–F evidence. The combined result is **PASS**; the revalidation manifest, both raw-file hashes, and recomputed artifact hashes are preserved outside Git at `D:\系统缓存\WebTools Phase4G3 D ManagerOnly Retry 20261003\historical-revalidation.json`.
- The historical event log has exactly two superseded test-infrastructure failures: A/5 (`GetGuiResources` null `IntPtr`) and F/0 (CIM/Process timestamp precision mismatch). Both are followed by independently matching successful acceptance evidence. These classifications are now restricted to those exact scenario/cycle locations. No unclassified failure remains.

### Scenario D — Independent Current Release Supplement

**REAL RELEASE RUNTIME PASS — 4/4 representative cases.** The self-contained NativeHost and electron-builder Windows unpacked Manager were freshly built from the reviewed worktree at `D:\系统缓存\WebTools Phase4G3 Rebuild 20261003`. The real packaged Manager, Vue renderer, preload, IPC, WPF control pipe, and Native `ManagerController`/`ManagerProcessLauncher` chain were exercised with a disposable TEMP profile and an isolated pipe. The recorded Manager command line includes both `--manager-only` and `--phase4g-manager-test`, and the packaged Main requires Manager-only mode before accepting the test profile. The test used renderer/CDP observation, not physical mouse or keyboard input; it did not call a translation provider.

| Case | Observed action | Normal Manager close |
|---|---|---:|
| Settings | Changed theme to Light and confirmed it persisted in the isolated Native state | PASS; group returned to zero |
| Favorites | Opened the actual new-folder dialog and entered `unsaved local state` | PASS; group returned to zero |
| Translation | Entered `local unsent test`; confirmed provider was unconfigured | PASS; group returned to zero |
| Page switching | Verified Settings → Favorites → Translation → Favorites headings in the live renderer | PASS; group returned to zero |

All four Manager Main processes were children of the same isolated NativeHost PID `19384`; each recorded exactly one visible HWND and one Renderer in its ready group. Normal close waited for the Electron group to reach zero and for the Native Manager controller to disconnect before recording success. A subsequent exact-path scan found no remaining process from this acceptance build. Real Nook hashes for `nook-data.json` and `launcher-state.json` were identical before/after; `secrets.json` remained absent.

Current Release identity:

| Artifact | SHA-256 |
|---|---|
| NativeHost EXE | `479d87a39c69145abb260718a3693e2fccd99a7a18a0c4b21cdde0dac1d32c44` |
| NativeHost DLL | `badccbefcd6d2d669a6e27e488ed98f3a506d577f0c6cd198b9eb11c516fe5b6` |
| Manager EXE | `2fbacdec06a0cb890b8a4571ab2ddc38335e77db9efdc38d2e7e756e6ebd616a` |
| Manager `app.asar` | `8eecbb5fc34fca43e83921cb4a77fe8af07ebdd4610315d4b15152af81a3c285` |

Two D supplement attempts stopped before starting an isolated NativeHost or taking any scenario action: the first supplied the evidence directory instead of the separate artifact root, and the second supplied already-nested `Native`/`win-unpacked` roots that the driver then joined again. Both were harness argument mistakes, not product failures; their evidence directories were retained. The completed D result above is from a fresh root with the corrected artifact-root arguments and matching process identities. Its raw `report.json` and `events.jsonl` SHA-256 values are `697434ba000fd0a012c2f823a8083424da4fae420ee8b860ed77075eefbf8403` and `0bca1cb3bdf474e9749d15b74da26f4fd1ff7140ce296c7dfba70c282207a5a8`; the existing A–F report and event files remain unchanged.

### Regression Tests Added

- Manager test-profile opt-in, mandatory Manager-only mode, absolute/existing TEMP profile, real-profile/install-root overlap, missing pipe, and junction escape checks.
- NativeHost profile/catalog canonicalization, TEMP-prefix confusion, real Nook/install-root overlap, and junction rejection checks.
- Evidence-semantic tests for A–F successes/failures, process identities, manifest/raw event mismatch, D operation-event ordering, independent D supplement, and exact classification of known harness failures.
- A subprocess test invokes the actual `--resume` entry and confirms incomplete evidence is rejected before profile/process setup.

### Manager Lifecycle / Production Boundary Review

- The regular NativeHost startup still owns tray, hotkey, and the production Manager pipe. The isolated resource-test mode is opt-in only, uses a derived mutex/Manager pipe and CurrentUserOnly control pipe, and omits tray, update pipe, and login-startup registry application. The command surface accepts only fixed Manager page names, bounded translation text, lifecycle snapshots, and existing query/show/hide test commands.
- Packaged Manager test-profile selection occurs before Electron readiness and is accepted only when the explicit test flag, absolute isolated profile, and isolated Native pipe are present. Normal Manager launch removes the test-profile environment override and passes the unchanged production pipe. Renderer isolation/sandbox and preload boundaries remain unchanged; no filesystem path or Node API is exposed to the renderer.
- Native still owns the Manager process lifecycle; repeated opens are routed through its single controller, and normal Manager close/disconnect leaves NativeHost alive. The only product startup change is choosing the full installation root for the acceptance-profile exclusion check; normal profile selection is unchanged.
- No data schema, provider, Translation behavior, Favorites behavior, or production window lifecycle was redesigned.

### Final Regression

- `npm run typecheck` — **PASS**.
- `npm test` — **PASS, 118/118**, including the new evidence and isolation regressions.
- `npm run build` — **PASS**.
- NativeHost Checks — **PASS, 55/55**.
- UpdateHelper Checks — **PASS, 10/10**.
- Node lifecycle driver syntax check — **PASS**.
- PowerShell AST parse, isolated process scan, and junction rejection — **PASS**.
- Current NativeHost self-contained `win-x64` Release publish and real electron-builder `--dir` Manager package — **PASS**; the packaged runtime artifacts above were hash-verified against their reports.
- `git diff --check` — **PASS** after the final report update.

### Repository Hygiene and Findings

- The worktree contains only Phase 4G-3 production/test/documentation changes. Native/Electron build output, logs, raw evidence, profiles, derived manifests, and revalidation sidecar are outside Git; no credentials or user data are included.
- P0: 0. P1: 0. P2: 0. P3: 0. The two isolation/evidence findings and the sampler root mismatch were fixed; the only historical failure events are the two explicitly classified superseded harness attempts.

### Final Checkpoint Decision

**CHECKPOINT REVIEW PASS**

**P0 = 0**

**P1 = 0**

**P2 = 0**

**PHASE 4G-3 COMPLETE — MANAGER LIFECYCLE / PROCESS STABILITY PASS — READY FOR PHASE 4G-4**

Phase 4G-4 has not started. This review does not start it.

## Phase 4G-4 — Long-Running / Soak Stability

### Phase 4G-3 Checkpoint

- The stable checkpoint is commit 926c8bf799ee36deb6898865a78399af85991035 on codex/shared-ai-translation-2.0.
- At Phase 4G-4 start, HEAD matched origin/codex/shared-ai-translation-2.0 and the worktree was clean. At the implementation closeout before this final review, the Phase 4G-4 test-only changes and report were intentionally left uncommitted and unpushed.
- No merge, PR, tag, release, or installer action was performed for Phase 4G-4. The later stable checkpoint commit/push is a separate closeout action, not part of the soak workload.

### 1. Source and Build Identity

The acceptance runtime was built from the checkpoint above. NativeHost was published as .NET 10.0.401, self-contained win-x64, with the app host enabled and trimming disabled. Manager was built by electron-vite and packaged by electron-builder 26.15.3 for Electron 44.4.5 using the Windows x64 unpacked directory target. Node was 24.21.0. No installer was created.

Build commands:

- dotnet publish native\WebTools.NativeHost\WebTools.NativeHost.csproj --configuration Release --runtime win-x64 --self-contained true -p:UseAppHost=true -p:PublishSingleFile=false -p:PublishTrimmed=false
- npm run build
- node node_modules\electron-builder\cli.js --win --x64 --dir --config.directories.output=<TEMP>\manager-build

Runtime layout was D:\系统缓存\WebTools Phase4G4 Soak 20261003-160332\runtime\WebTools.NativeHost.exe and the corresponding runtime\Manager\WebTools.exe plus Manager\resources\app.asar.

| Artifact | SHA-256 |
|---|---|
| WebTools.NativeHost.exe | 1932AFABF294014A23074522EC644DD242AF96391B70059360395CCB72905A8F |
| WebTools.NativeHost.dll | F47EAB3C08E4EC05497A9EAFE699B81D5F356A4740538BE90CA16665C8A94A38 |
| Manager\WebTools.exe | 2FBACDEC06A0CB890B8A4571AB2DDC38335E77DB9EFDC38D2E7E756E6EBD616A |
| Manager\resources\app.asar | 8EECBB5FC34FCA43E83921CB4A77FE8AF07EBDD4610315D4B15152AF81A3C285 |
| Soak driver | A83268BE4CFC05013B59F9CDAFEFC1E5046EFB7D60FC3E260CF8178958EDF2BA |
| Process sampler | 69FE4C9E412B37E95A58818CFF6ABD29261C6416CDE4B79B8454468303409E6F |

### 2. Test Environment and Isolation

- Formal soak evidence: D:\系统缓存\WebTools Phase4G4 Soak 20261003-160332\soak
- Isolated runtime: D:\系统缓存\WebTools Phase4G4 Soak 20261003-160332\runtime
- Disposable test profile: soak\profile
- The run used a unique test-only named pipe and exact executable-path/process-creation-time checks. It did not connect to the production pipe or pass real favorites, settings, credentials, or AI provider tokens to the test processes. The preservation witness reads `nook-data.json` and `launcher-state.json` only as bytes to compute SHA-256 before and after; it would also hash `secrets.json` if present. It does not parse or log those contents and does not write to the real profile. `secrets.json` was absent during this run.
- The real installation witness before and after was the same NativeHost PID 13284 at D:\webtools\WebTools.NativeHost.exe. nook-data.json remained SHA-256 003e9b2c2a4a5ef26d430f32b85f8d84b01df01be607cd1864a98804079eeb2f; launcher-state.json remained 825251a8db09e3e7774f25dac7111282adc1b7660e8f2c854accc03a5c036538; secrets.json remained absent. The manifest records liveProductionUnchanged=true.
- Preflight attempts that stopped before formal soak because of harness input/JSON BOM handling were retained in separate evidence directories. The corrected preflight-confirmed run passed; failed preflight attempts were not included in formal A/B statistics.

### 3. Preflight

**PREFLIGHT PASS** at 2026-10-03 08:10:42 UTC.

The isolated Release NativeHost started with Manager/Electron at zero, accepted its test pipe, showed/searched/hid the Native Launcher, opened Favorites, Settings, and Translation in turn, acknowledged renderer readiness, and normally closed each Manager process group. Translation prefill was local-only and providerInvocations was zero. Four incremental sampler samples were written, errors.json was empty, and the isolated host exited through its control pipe with no remaining target processes. The successful preflight used its own profile and evidence directory; it was not mixed into the formal soak.

### 4. Scenario A — 90-Minute NativeHost-only Soak

Scenario A ran continuously for 5,400,150 ms from 08:14:02.957 to 09:44:03.108 UTC. It used NativeHost PID 18496. The seven 15-minute checkpoints all observed the same PID and Launcher HWND 1116180, Manager Main=0, Electron process group=0, a responsive NativeHost, and a responsive pipe. Pipe round trips were 96–120 ms. No restart, crash, or hang occurred.

### 5. Scenario B — 90-Minute Intermittent Usage Soak

Scenario B immediately followed Scenario A without restarting NativeHost and ran 5,400,149 ms from 09:44:03.114 to 11:14:03.263 UTC, again on PID 18496. Six usage groups ran at 15-minute intervals and rotated Favorites, Settings, Translation, Favorites, Settings, Translation.

Each group displayed the same Launcher HWND, searched the fixed local Control Panel query, cleared and hid the Launcher, opened one Manager, waited for renderer acknowledgement, then normally closed the Manager and waited for the target Electron group to reach zero. The Launcher was then queried and hidden again. All 12 searches and all 12 hidden-state checks were recorded. Every group completed, the NativeHost remained responsive, and the Manager controller disconnected before the next group.

| Group | Page | Manager Main PID | Ready (ms) | Recorded members | Normal close | Electron=0 |
|---:|---|---:|---:|---:|---|---|
| 1 | Favorites | 10768 | 378 | 4 | PASS | PASS |
| 2 | Settings | 25416 | 321 | 4 | PASS | PASS |
| 3 | Translation | 1320 | 342 | 4 | PASS | PASS |
| 4 | Favorites | 3576 | 339 | 4 | PASS | PASS |
| 5 | Settings | 26148 | 368 | 4 | PASS | PASS |
| 6 | Translation | 2572 | 346 | 4 | PASS | PASS |

All six Main PIDs were distinct. Each ready group had one Manager Main plus its Renderer, GPU, and Utility process. Translation handoff text was acknowledged exactly by the local renderer; no provider was invoked. Six normal-close events and six Electron-zero events were recorded.

### 6. Resource Trend Analysis

The sampler produced 2,160 records over 3.002 hours. There were 2,158 NativeHost metric samples (99.84% coverage); the two records without NativeHost metrics are the process-start and normal-exit boundaries. Median sample interval was 5.01 seconds, maximum 5.272 seconds, with no intervals over 15 seconds.

| Scenario A checkpoint | Private MiB | Working Set MiB | Handles | Threads | GDI | USER | Pipe ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| A-00 | 70.08 | 125.58 | 773 | 29 | 12 | 24 | 102 |
| A-15 | 69.40 | 123.93 | 759 | 18 | 12 | 22 | 102 |
| A-30 | 69.41 | 124.02 | 768 | 17 | 12 | 22 | 120 |
| A-45 | 69.42 | 124.03 | 690 | 18 | 12 | 23 | 102 |
| A-60 | 69.46 | 97.73 | 702 | 19 | 12 | 23 | 96 |
| A-75 | 68.20 | 96.93 | 706 | 17 | 12 | 22 | 104 |
| A-90 | 69.48 | 98.37 | 715 | 18 | 12 | 22 | 117 |

| Scenario B checkpoint | Private MiB | Working Set MiB | Handles | Threads | GDI | USER | Pipe ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| B-00 | 82.14 | 136.18 | 781 | 25 | 56 | 40 | 122 |
| B-15 | 90.05 | 151.36 | 716 | 23 | 55 | 38 | 125 |
| B-30 | 90.34 | 154.72 | 735 | 23 | 57 | 37 | 137 |
| B-45 | 91.11 | 159.28 | 704 | 22 | 55 | 37 | 101 |
| B-60 | 95.19 | 165.27 | 729 | 23 | 57 | 38 | 128 |
| B-75 | 94.52 | 163.77 | 715 | 22 | 54 | 37 | 138 |
| B-90 | 88.67 | 158.68 | 719 | 17 | 54 | 34 | 110 |

| Metric across 2,158 NativeHost samples | Minimum | Median | Maximum | First | Last |
|---|---:|---:|---:|---:|---:|
| Private Bytes (MiB) | 68.51 | 70.07 | 95.32 | 75.05 | 88.48 |
| Working Set (MiB) | 97.33 | 126.52 | 165.43 | 128.00 | 158.52 |
| Handles | 672 | 710 | 782 | 744 | 706 |
| Threads | 13 | 14 | 29 | 24 | 14 |
| GDI | 12 | 12 | 57 | 12 | 54 |
| USER | 20 | 24 | 39 | 22 | 32 |

The A checkpoint Private Bytes median was 69.40 MiB; the B checkpoint median was 90.34 MiB. These are different workload phases: Scenario B includes the first real Launcher display and six Manager open/close groups. The first-use GDI/USER increase was bounded: after B-00, GDI remained 54–57 and USER 34–38, rather than increasing with each group. Private Bytes peaked at B-60, then declined at B-75 and B-90; handles and threads fluctuated and ended below their initial values. The time series does not show sustained monotonic or unrecovered per-cycle growth. No absolute memory threshold was used. The first-use retained-resource pattern is consistent with bounded UI/runtime warm-up; this test does not claim separate allocator-level attribution.

### 7. Manager Process-group Analysis

The manager-processes.csv contains 64 identity-checked process records: 12 each for Manager Main, Renderer, GPU, and Utility across two runtime snapshots per each of the six Manager groups, plus NativeHost observations. Every Manager executable path resolved under the isolated runtime root. The six Main PIDs were unique, each ready process group contained exactly one Main, and the process group returned to zero after each normal close. No target Manager/Electron orphan was found.

### 8. IPC and Responsiveness

All 14 formal checkpoints reported responsive=true. Pipe round trips were 96–138 ms across A and B without a rising latency trend. All six Manager sessions completed renderer acknowledgement and disconnected normally. Native search remained usable after each Manager close, and the Launcher was hidden with query cleared at every formal checkpoint.

### 9. Evidence Integrity

- Scenario A: PASS, seven checkpoints, 90 minutes.
- Scenario B: PASS, seven checkpoints and six completed usage groups, 90 minutes.
- NativeHost PID was 18496 at all 14 checkpoints; process creation time remained 2026-10-03T08:13:46.0005130Z.
- Formal event counts: 14 checkpoints, 179 heartbeats, 6 Manager ready, 6 normal close, 6 Electron-zero, 12 Launcher search, 12 Launcher hidden, zero errors.
- The evidence manifest reports SOAK EVIDENCE COMPLETE — REVIEW PENDING; its final architecture and production-witness fields were checked against the raw event and process evidence before this report was closed.

SHA-256 of the final raw evidence:

| Evidence | SHA-256 |
|---|---|
| manifest.json | 9D8335EDB252CAE5434D862FB355CA6F155FEF62CAA1AB8014E51E3B807F3C56 |
| checkpoints.json | 559BEC9CF9AE9D0AD63C158395EDEC1AA3B26B4F7C87B07A30D9B42B8A77E2A0 |
| errors.json | 37517E5F3DC66819F61F5A7BB8ACE1921282415F10551D2DEFA5C3EB0985B570 |
| lifecycle-events.jsonl | 9A4C6B7591C452A423A15EE67C8209DD2C257F5D6642A07AAC7C393DA5069825 |
| manager-processes.csv | F1ADB40224B7F449419F43D646F8C3E2FCCBC40E50E915EC7E2F5CDDBF13CEAF |
| process-samples.jsonl | 11B962ECD7E36CF5B3EE05E838B2342E8BE8D5A629DEAFA76EDF735B8920AB89 |

Raw evidence and disposable profiles remain outside the repository.

### 10. Final Architecture Gate

Immediately before normal exit: isolated NativeHost=1 (PID 18496), Manager Main=0, Electron process group=0, test pipe responsive, Launcher hidden, and query cleared. The NativeHost then exited through the acknowledged isolated control pipe with exit code 0. The post-exit exact-path scan found NativeHost=0, Manager=0, Electron=0 for the acceptance runtime. The unrelated real installation remained running and its recorded profile hashes were unchanged.

### 11. Final Regression

Freshly run after the soak:

- npm run typecheck — PASS.
- npm test — PASS, 118/118. Node emitted existing MODULE_TYPELESS_PACKAGE_JSON performance warnings while reparsing TypeScript test modules; there were no test failures.
- npm run build — PASS.
- dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release — PASS, 55/55.
- dotnet run --project native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj --configuration Release — PASS, 10/10.
- Node syntax check for scripts/verify-phase4g4-soak.mjs — PASS.
- PowerShell AST parse for native/scripts/Measure-Phase4G3Processes.ps1 — PASS.
- Release artifact hashes matched build-identity.json — PASS.
- git diff --check — PASS after this report update.

No product code was changed for this phase. The sampler interval remains configurable with a default of one second, preserving its Phase 4G-3 behavior; the soak driver uses five-second process samples.

### 12. Findings

- P0: 0.
- P1: 0.
- Unresolved blocking P2: 0.
- P3: one non-blocking observation — after the first real Launcher display, GDI/USER counts remained at a higher but bounded plateau through the rest of Scenario B. They did not climb with repeated groups, and the final counts were below the B-00 values. No defect was confirmed.
- Scope limit: this finite three-hour isolated soak does not prove indefinite stability and did not collect per-renderer JavaScript heap metrics. It provides OS process resource and real lifecycle evidence for the tested Release build.

### 13. Files Changed and Git

- native/scripts/Measure-Phase4G3Processes.ps1 — added a bounded SampleIntervalSeconds parameter with the original one-second default.
- scripts/verify-phase4g4-soak.mjs — added the isolated Release preflight and three-hour soak driver with incremental evidence and exact-path process checks.
- docs/native-launcher-phase4g-final-validation.md — appended this Phase 4G-4 closeout; all Phase 4G-1 through 4G-3 historical measurements remain unchanged.
- Checkpoint review base branch: codex/shared-ai-translation-2.0.
- Checkpoint review base HEAD and origin/codex/shared-ai-translation-2.0: 926c8bf799ee36deb6898865a78399af85991035.
- At checkpoint review start, the only repository changes were the Phase 4G-4 sampler, soak driver, and report. All raw soak evidence and disposable profiles remained outside Git; no product code was changed.

### Phase 4G-4 Decision

**PHASE 4G-4 COMPLETE**

**LONG-RUNNING / SOAK STABILITY PASS**

**READY FOR PHASE 4G-5**

Stop here. Phase 4G-5 has not started.

### Phase 4G-4 Checkpoint Review

- The final review rehashed all six raw soak evidence files and matched the report. The manifest, 14 checkpoints, 2,160 process samples, 179 heartbeats, six Manager-ready/normal-close/Electron-zero groups, 12 search/hidden events, zero errors, and the reported A/B durations agree. All checkpoints use NativeHost PID 18496 and HWND 1116180. The finite three-hour result is not presented as an indefinite stability guarantee.
- Five blocking-P2 test-driver gaps were found and minimally corrected without rerunning the soak: the entire isolated Release runtime tree now rejects symbolic links/junctions before any child starts; Manager identity is captured before renderer readiness checks; cleanup still drains an exact-path Manager group when NativeHost has already exited; the pipe greeting now has a bounded, interruptible wait that rejects socket close/error; and Manager startup-timeout cleanup targets the unique fixed-title `WebTools` HWND inside the already identity-checked Manager PID, including while Electron keeps it hidden before renderer readiness. Cleanup uses exact executable path, PID, and creation time, requests normal WM_CLOSE, waits for group exit, and never terminates by process name. The NativeHost fallback selects the unique `WebTools Native Launcher` HWND because the hidden WPF process also owns other top-level HWNDs.
- Review also corrected two evidence-path issues: malformed stage metadata is recorded on its sample instead of silently discarded, and successful sampler shutdown requires exit code 0. SIGINT/SIGTERM now enter bounded orderly cleanup; child-spawn failures are captured and surfaced. No NativeHost, Manager, Electron, IPC, preload, Translation, or user-data production code changed.
- The three-hour workload used the driver and sampler source hashes recorded in the Source and Build Identity table above. Review-time test-harness changes were not retroactively attributed to that workload; the runtime used by the completed run had no reparse points. Focused checks passed for the runtime-tree junction guard, malformed-stage sampler record, cleanup state paths, bounded/interrupted greeting wait, hidden exact-title HWND discovery, exact-identity hidden NativeHost WM_CLOSE smoke, source safeguards, Node syntax, PowerShell AST, and the full automated regression listed above. After the final hidden-Manager-window fix, a separate isolated Release preflight completed with three Manager ready/normal-close cycles, zero errors, normal NativeHost exit, and zero final isolated processes; the production install/profile witness remained unchanged. This preflight did not fault-inject renderer-readiness timeout. No three-hour Soak was rerun.
- A separate cancellation smoke at `D:\系统缓存\WebTools-Phase4G4-Interrupt-Smoke-20261003` started the isolated Release NativeHost, recorded only checkpoint A-00, then received Ctrl+C. The evidence remained `INCOMPLETE — REVIEW REQUIRED`; NativeHost, sampler, and probe all exited normally with code 0, a post-cleanup exact-path scan found zero isolated processes, and the real-install/profile witness remained unchanged. This partial run is not included in the soak results.
- A targeted real-process cleanup smoke at `D:\System default\Desktop\WebTools Phase4G4 Cleanup Smoke 20261003-D` launched the previously packaged Release NativeHost with a fresh isolated profile and unique pipe, then used the updated PowerShell probe to send WM_CLOSE to its hidden Launcher HWND after exact path/PID/creation-time verification. NativeHost PID 25712 exited with code 0 and the subsequent exact-path scan found no remaining test NativeHost. Separate extracted-function checks exercised cleanup with an exited Host plus a surviving mock Manager group, the live-Host/no-pipe fallback, SIGTERM during an unresolved greeting, timeout, and listener cleanup. These are targeted failure-path checks, not a rerun of the soak.
- SHA-256 of the reviewed post-fix harness sources:

| Source | SHA-256 |
|---|---|
| `scripts/verify-phase4g4-soak.mjs` | `7927F57729CAA221A35837C284EAF3D1A386F064BF3E1185AA052B05450E2617` |
| `native/scripts/Measure-Phase4G3Processes.ps1` | `D4855AF428B27417DD0F01C9733C735A0B99402E693F1CEC05217DA04FF4498F` |
- Review findings: P0 = 0; P1 = 0; blocking P2 = 0 after fixes; P3 = 1 bounded first-use GDI/USER plateau, unchanged from the measured finding above.
- Soak evidence remains outside the repository. The profile preservation evidence is hash-only: `nook-data.json` and `launcher-state.json` matched before/after; `secrets.json` was absent. No settings, Favorites, secret, token, profile, runtime, or raw sample artifact is staged.

**PHASE 4G-4 CHECKPOINT REVIEW PASS**

**READY FOR PHASE 4G-5**
