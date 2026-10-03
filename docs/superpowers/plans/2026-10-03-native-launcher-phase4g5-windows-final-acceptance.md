# WebTools Phase 4G-5 — Windows Environment Final Acceptance Plan

> **Status:** PHASE 4G-5 COMPLETE. On 2026-10-04 the user confirmed all remaining manual groups passed. The initial matrix and dated execution record below remain historical; the final closeout section is authoritative. Do not begin Phase 4G-6 without user approval.

**Goal:** Verify the current NativeHost-first Windows release environment using current build identity plus still-applicable historical evidence, and publish an auditable Phase 4G-5 result without touching the live installation or profile.

**Architecture:** NativeHost owns the resident WPF Launcher, tray, global hotkey, search, and Manager lifecycle. Electron Manager is launched only on demand and must exit as a process group after normal close. This acceptance uses current packaged artifacts and isolated test evidence; it does not change production architecture or repeat prior stress workloads.

**Tech Stack:** Windows 11 x64, .NET 10 self-contained `win-x64`, Electron 44, Vue, Node 24, pnpm 9.15.9, existing NativeHost/UpdateHelper checks and isolated Manager lifecycle runner.

**Spec:** User request `WebTools — Phase 4G-5 Windows Environment Final Acceptance` (2026-10-03); historical source of truth `docs/native-launcher-phase4g-final-validation.md` and `docs/native-launcher-phase4f-removal.md`.

## Global Constraints

- Preserve `D:\webtools`, `%APPDATA%\Nook`, real Favorites/Settings/SecretStore, AI credentials, startup registration, and unrelated applications.
- Never terminate by process name; any test process must be isolated and identified by executable path, PID, and creation time.
- Do not repeat Phase 4G-2 search/show-hide stress, Phase 4G-3 30-cycle lifecycle, or Phase 4G-4 three-hour Soak.
- Do not access real AI providers or send real secrets; use disposable profile data and no provider credentials.
- Reuse pnpm regression/package evidence when the current source and artifact identity match; do not change dependencies or package layout.
- Do not commit, push, merge, create PR, tag, release, or enter Phase 4G-6.
- Result labels are limited to `PASS`, `FAIL`, `NOT TESTED`, `MANUAL VERIFICATION REQUIRED`, and `NOT APPLICABLE`.

## Review Focus

- A normal production NativeHost launch must not start Electron before an explicit Manager request; current test mode is not itself proof of normal tray/startup behavior.
- Launcher focus and hotkey response require a physical keyboard observation; WPF pipe-driven query tests do not prove it.
- Login startup writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\WebTools`; do not test it in the primary Windows account.
- An installed test build must not reuse the real `%APPDATA%\Nook` or close the live `D:\webtools` instance.
- Current pnpm packaging must resolve the actual installed Manager from the target root and leave unrelated Electron processes untouched.

## Current Source and Environment Identity

- Branch: `codex/shared-ai-translation-2.0`.
- Git HEAD: `1f68fe0ccc916e33197a9ec19d42b58ef5da5161`; upstream has the same HEAD (`0/0` divergence).
- Existing uncommitted changes are only the approved pnpm migration: `README.md`, `package-lock.json` removal, `package.json`, `pnpm-lock.yaml`, `scripts/build-native-production.ps1`, and a pnpm command comment in `scripts/verify-website-dialogs.mjs`.
- Current machine/tool record from the pnpm migration: Windows 11 Pro x64 build 22631; Node `v24.21.0`; pnpm `9.15.9`; .NET 10 Release `win-x64` self-contained publish.
- Current installer candidate: `release/native-production-20261003-220039/WebTools-Setup-0.1.0.exe`, 191,374,341 bytes, SHA-256 `98C43D2235D44F98A0C7BC8E7D9DB208466368041CEF123DD94F001135C91547`.
- Current staged NativeHost/Manager runtime hashes are compared against the isolated current-manager smoke evidence in the execution report before reuse.

## Existing Evidence to Reuse

| Phase | Existing evidence | Reuse condition / limitation |
|---|---|---|
| 4G-1 | Five normal installed NativeHost cold-start samples; user confirmed tray presence, hotkey show, and hide leaving NativeHost alive. | Historical behavior evidence only. The original report notes the startup registry pre-value was not captured; it does not prove the current candidate's visible tray menu or startup toggle. |
| Hotkey System 2.0 | Full manual matrix is `USER CONFIRMED PASS`; automated parser/state-machine/registration checks passed. | Hotkey implementation has not changed since acceptance. Reuse; do not repeat the full matrix. Physical hotkey smoke still needs a brief representative check if not directly observed in this Phase. |
| 4G-2 | 3 × 1,000 real-WPF searches, 300 show/hide cycles, six transient-query-clear checkpoints, 10 real hotkey-mode cycles, registration probes; final result complete. | Product search/hotkey paths remain unchanged; no high-count rerun. |
| 4G-3 | Real Release Manager lifecycle, 20 reuse requests, 30 normal open/close cycles, active-operation closes, exact Translation handoff, recovery; 55 NativeHost and 10 UpdateHelper checks. | Reuse where current NativeHost, Manager EXE and `app.asar` hashes match. Scenario D supplement evidence is isolated and uses a disposable profile. |
| 4G-4 | Same-PID, two 90-minute Soak scenarios; six normal Manager closes; final checkpoint review and commit/push. | Reuse unchanged historical evidence; do not rerun Soak. Current branch HEAD/upstream confirms the checkpoint is present. |
| 4F | User-confirmed local upgrade and Websites/Favorites acceptance; automated update helper, retry, delayed-uninstaller and isolated cover-install checks. | Reuse product behavior evidence. Current pnpm candidate gets targeted package-layout/isolated-install verification; do not operate on the live installation. |
| pnpm migration | Clean frozen install, typecheck, 118/118 Node tests, Electron Main/Preload/Renderer build, Windows package, NativeHost 55/55 and UpdateHelper 10/10; isolated package smoke. | Reuse only for the matching current working-tree/installer identity; do not redo package migration. |

## Evidence Matrix

Each row in the final report records all seven requested fields: Requirement, Historical Evidence, Evidence Version / Build Identity, Current Verification, Manual Verification, Result, Remaining Gap.

| ID | Requirement | Historical evidence | Evidence identity | Current verification / manual work | Initial result |
|---|---|---|---|---|---|
| A1 | NativeHost normal startup, single instance, idle Electron=0, normal exit | 4G-1 five settled normal launches; 4G-4 normal isolated Host exit | 4G-1 installed binary and 4G-4 isolated Release; current pnpm candidate hash listed above | Reuse current exact-hash isolated Host/Manager smoke for process gating; production startup/menu exit remains a disposable-account manual check | `MANUAL VERIFICATION REQUIRED` |
| A2 | Launcher show/hide, normal input focus, query clears, Host remains alive | 4G-2 and 4G-4 real-WPF lifecycle/search; prior user hotkey acceptance | Historical Phase 4G runtime; product search/lifecycle unchanged | Existing evidence covers WPF state/search. Physical hotkey-to-focus/input and tray hide need manual observation | `MANUAL VERIFICATION REQUIRED` |
| B1 | App, Chinese/pinyin/initials, website, `?`, `/`, `file:` search presentation | 4G-2 frozen mixed corpus and 4G-4 repeated Launcher checks | Existing Release/runtime source; no product search changes since | Reuse; do not rerun stress | `PASS` |
| C1 | Hotkey default/custom Apply/Cancel/conflict and mode registration/release | User-confirmed complete Hotkey 2.0 matrix; 4G-2 10 real mode cycles and RegisterHotKey probes | Hotkey source unchanged; current NativeHost checks are 55/55 | Reuse full matrix; brief physical default/custom toggle and Cancel smoke may be recorded manually | `MANUAL VERIFICATION REQUIRED` |
| D1 | Tray icon/menu open actions and exit | 4G-1 user confirmed tray presence; tray palette/layout checks in NativeHost suite | Current package includes the same tray resource/code path | Click/keyboard behavior and visible menu require manual observation | `MANUAL VERIFICATION REQUIRED` |
| D2 | Startup preference persistence, correct Run value, no duplicates | 4G-1 records preference false and absent Run value after runs, but original registry value was not captured | Current `LoginStartupService` writes/deletes one `WebTools` value; no runtime registry mutation in this task | Must test only in a disposable Windows account and restore/record its initial value | `MANUAL VERIFICATION REQUIRED` |
| E1 | On-demand Manager, route render, instance reuse, normal close to Electron=0, NativeHost remains, reopen | 4G-3 A–F and 4G-4 six Manager groups | Current candidate NativeHost, Manager EXE and `app.asar` hashes must match the isolated smoke evidence | Exact-hash current packaged runtime smoke covers Settings/Favorites/Translation/page-switch and normal closes | `PASS` |
| F1 | Websites/Favorites, Settings persistence, Translation exact prefill without auto-provider | 4G-3 Scenario D/E; 4F user-confirmed Websites/Favorites UI and upgrade behavior | Current Manager EXE and `app.asar` hash compared with 4G-3 supplement | Reuse isolated local UI evidence; no real tokens/provider requests | `PASS` |
| G1 | NativeHost/Manager installed layout and Manager discovery with pnpm layout | 4F package evidence; pnpm current candidate package smoke | Current installer SHA above; current staged executable/ASAR hashes recorded in report | Isolated same-directory cover install, Unicode/space path discovery, install/uninstall smoke passed in package task | `PASS` |
| G2 | Visible shortcuts/icons, installed launch, current-candidate upgrade/data retention, uninstall boundaries | 4F user-confirmed update; historical installer tests | Prior 4F installer SHA differs from current pnpm candidate | Do not touch production. Manual only in a disposable Windows account; UI shortcuts/icon and preserved test data need observation | `MANUAL VERIFICATION REQUIRED` |

## Required Automation and Test-Addition Decision

- Re-run in this acceptance: `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, NativeHost Checks, and UpdateHelper Checks. Expected: frozen lock succeeds; Node tests report 118/118; NativeHost Checks 55/55; UpdateHelper Checks 10/10.
- Reuse current-candidate `pnpm run package:win` only after checking its installer SHA and matching the packaged NativeHost/Manager/ASAR hashes to the isolated runtime smoke. The current candidate meets this condition, so do not rebuild solely to create a new timestamp.
- Run `node --check scripts/verify-manager-lifecycle.mjs` and parse `scripts/build-native-production.ps1` with the PowerShell AST parser.
- No new permanent test is planned: the user-facing product sources are unchanged by the pnpm migration; existing NativeHost, UpdateHelper, Node contracts and real packaged Manager lifecycle evidence cover the automated contracts. Missing tray/physical keyboard/startup/visible shortcut observations are OS-interactive and remain manual, not suitable for synthetic tests that would mutate the primary registry/profile.

## Execution Tasks

### Task 1 — Verify repository and historical evidence

- [x] Confirm branch, HEAD/upstream, dirty-file list, and Phase 4G-4 remote checkpoint.
- [x] Confirm the report explicitly has no Phase 4G-5 result yet; this is missing evidence, not a product failure.
- [x] Review the 4G-1 through 4G-4 record, Hotkey 2.0 confirmation, Phase 4F final acceptance, and pnpm migration checks.

### Task 2 — Validate current pnpm build identity

- [x] Reuse the current-session `pnpm install --frozen-lockfile`, typecheck, 118/118 tests, Electron build, and Corepack `package:win` result because no source changed after the package was generated.
- [x] Record NativeHost 55/55 and UpdateHelper 10/10 checks.
- [x] Verify current installer SHA/size and compare NativeHost EXE/DLL, Manager EXE, and ASAR hashes with the real packaged-runtime smoke evidence.

### Task 3 — Verify isolated Manager/runtime evidence

- [x] Reuse the current packaged-runtime Scenario D smoke only after exact artifact hashes match.
- [x] Confirm isolated profile/pipe, no provider credential, four Manager normal-close cases, and no change to real profile hashes.
- [x] Do not launch or close the real `D:\webtools` process.

### Task 4 — Verify installer and package boundaries

- [x] Reuse the current candidate's isolated cover-install, Manager discovery, Unicode/space path, self-uninstall and package layout results.
- [x] Confirm no product code or installer configuration changed in the pnpm migration.
- [ ] Verify the visible Start Menu/Desktop shortcut icon and real GUI installation behavior in a disposable Windows account. This remains part of the required manual acceptance gate.

### Task 5 — Publish the acceptance report and manual checklist

- [x] Append `Phase 4G-5 — Windows Environment Final Acceptance` to `docs/native-launcher-phase4g-final-validation.md` with the evidence matrix and the exact evidence labels.
- [x] Keep aggregate status `PHASE 4G-5 INCOMPLETE — MANUAL VERIFICATION REQUIRED` until the user records the required Windows actions below.
- [x] Stop after providing the checklist; do not enter Phase 4G-6.

## Manual Windows Acceptance Checklist

Use only a disposable local Windows account (preferred) or a disposable VM with an isolated profile. Do not run the candidate in the primary account or over `D:\webtools`. Before the test, record the test account's original `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\WebTools` value (expected absent on a fresh account). Use fake website/folder data and leave AI Provider credentials empty. Record the result for each row in the appended 4G-5 report or reply with the row IDs and outcomes.

| ID | Operation | Expected result / observation | Result record |
|---|---|---|---|
| M-A | Install the current candidate to a new test-account path; start `WebTools.NativeHost.exe`; observe process paths. | One NativeHost; Electron=0 before requesting Manager; no access to primary profile or `D:\webtools`. | M-A: PASS / FAIL + observed PIDs |
| M-B | Use the default hotkey to show Launcher; type `visual`, a Chinese app name/pinyin initials, a disposable website query, `?test`, `/test`, and `file:test`; hide with Escape, then repeat via blur. | Launcher appears once, input accepts typing, expected search mode/results display, query clears on hide, NativeHost remains. | M-B: PASS / FAIL + notes |
| M-C | In the test profile, open Settings, confirm current default binding, enter an unused custom chord, Cancel one change, then Apply the custom chord; test default/custom activation and restore default before ending. | Cancel preserves the active binding; Apply updates it; each chord toggles once; no duplicate activation. Do not repeat the full Hotkey 2.0 matrix. | M-C: PASS / FAIL + chords tested |
| M-D | Open the tray menu; use its Launcher, Websites/Manager, Settings/Translation entries; inspect current startup preference; enable startup and inspect the test account Run value; restart/log out-in once; then disable startup and restore the recorded original registry value. Use the Exit menu. | Menu labels/icons are visible and clickable; startup launches one NativeHost and no Electron; exactly one expected value exists while enabled and it is removed/restored afterward; Exit leaves no test process. | M-D: PASS / FAIL + initial/final Run value (redact unrelated values) |
| M-E | Open Favorites, then Settings and Translation; send one exact local Translation handoff from Launcher; close Manager normally and reopen it. | One Manager process group is reused while open; pages render; exact text prefill arrives without starting a provider; normal close returns Electron=0 while NativeHost/tray remain; reopen works. | M-E: PASS / FAIL + process observations |
| M-F | In disposable data, create/edit/delete a website and folder; save a setting; restart Manager and verify persistence; avoid external/paid translation. | Test data persists as expected; no real Favorites, Settings or secrets are involved. | M-F: PASS / FAIL + data observations |
| M-G | In the disposable account, install the available previous Phase 4F candidate (`release/native-production-20260930-224223/WebTools-Setup-0.1.0.exe`, SHA-256 `1872CCA579F8A6D425515A4576751917ADD3BE9205600B348EC24330B0F09FF4`) to a fresh test path. Add only fake folder/site/setting data. Then run the current pnpm candidate (`release/native-production-20261003-220039/WebTools-Setup-0.1.0.exe`) over that same test path; inspect Start Menu/Desktop shortcut target/icon and finally uninstall only this test installation. | Shortcut/icon point to NativeHost; update affects only the test installation; fake data retention follows the expected policy; uninstall does not remove profile data unexpectedly or affect unrelated apps/the production install. | M-G: PASS / FAIL + target path |

## Desktop Execution Update — 2026-10-03

The original matrix/checklist above preserves the initial plan. Latest execution evidence is `D:\系统缓存\webtools-phase4g5-ui-1d8b2e702590485a97907f3c5cd61476` and the matching Windows Desktop Execution Supplement in the authoritative report.

| Item | Latest state | Evidence / remaining work |
|---|---|---|
| M-A | `MANUAL VERIFICATION REQUIRED` | Exact-hash copied Release Host idle Electron=0, isolated single-instance contract and acknowledged Host exit verified. Normal installed entry/tray exit remains untested. |
| M-B | `MANUAL VERIFICATION REQUIRED` | Current real-WPF pipe search and transient clearing verified; native transparent window was not returned by the supported desktop tool. Physical default hotkey/input/Escape/blur still required; prior Everything evidence reused. |
| M-C | `MANUAL VERIFICATION REQUIRED` | Real Manager recorder/Cancel/Apply/restore UI verified with F12/F11. Desktop SendInput activation and old-chord release observed using isolated PID-checked pipe, not physical keyboard. Brief physical default/custom smoke remains; no full matrix rerun. |
| M-D | `MANUAL VERIFICATION REQUIRED` | No elevated disposable-account or VM capability available. No primary registry write/login test or tray operation; complete in disposable account only. |
| M-E | `PASS` | Actual Manager pages/text/titlebar closes plus on-demand IPC/reuse and two Electron-zero process checks. Host remained; Manager reopened. Tray and Launcher action click remain separate gates. |
| M-F | `PASS` | Actual fake website/folder create/edit/delete, Baidu default restoration, persisted data on Manager reopen, new-folder input after deletion and Cancel non-persistence. Native site projection before/after deletion verified through pipe. |
| M-G | `MANUAL VERIFICATION REQUIRED` | Both installer SHA-256 values reverified. Historical package/install smoke reused. Current visible GUI upgrade/shortcut/icon/data-retention/uninstall needs disposable account/VM. |

- [x] Perform all safely accessible Manager desktop actions, preserve 60 actual screenshots and 61 observations outside repository, and finish both Manager sessions by actual window X close.
- [x] Verify final isolated process count zero; production Host PID/creation time still unchanged. Final-cleanup file/Run-value snapshots match; primary data hashes also match the prior smoke.
- [x] Record initial environment snapshot failure honestly (`environment-before.json` is null); do not claim full-run independent initial registry/install hash comparison.
- [x] Keep historical 4G-1 through 4G-4 evidence and original baseline unchanged. No stress rerun, new installer, product change or Git publication.
- [ ] Complete the three reduced remaining groups in a disposable account/VM: normal install + physical Launcher/hotkey smoke; tray + startup relogin; old-to-current GUI upgrade/shortcuts/data retention/target uninstall. Detailed steps are in the authoritative report. Do not repeat M-E/M-F or the full historical matrices.

**PHASE 4G-5 INCOMPLETE — MANUAL VERIFICATION REQUIRED**

## Blocking Conditions and Final Gate

- Any real NativeHost crash/hang, unexpected Electron launch, process identity escape, user-data access, duplicate startup value, or failed Manager normal close is a blocking issue and must be recorded before a minimal fix is considered.
- A test that cannot be isolated from the primary profile, registry, installation or another application's processes must not be run.
- Phase 4G-5 is complete only when all required automated evidence is valid and every required manual row is confirmed. Until then, the final status is `PHASE 4G-5 INCOMPLETE — MANUAL VERIFICATION REQUIRED`; Phase 4G-6 remains blocked.

## Final User Acceptance and Closeout — 2026-10-04

The user explicitly confirms: **剩余人工操作全部测试通过，没有发现问题。** The date records receipt of confirmation, not the individual operations' execution times. This closes the prior pending checklist without changing its historical record.

| Items | Final result | Confirmation scope |
|---|---|---|
| M-A / M-B / M-C | **USER CONFIRMED PASS** | Normal installation/start, single NativeHost, idle Electron=0, physical hotkey/input/search modes/focus/Escape/blur, custom shortcut Apply/Cancel and original-binding restoration. |
| M-D | **USER CONFIRMED PASS** | Tray icon/menu/entries/Exit; startup enable/login/disable; no observed duplicate startup or abnormal behavior. |
| M-E / M-F | **PASS** | Existing real packaged Manager desktop and runtime evidence remains valid; no repeat requested. |
| M-G | **USER CONFIRMED PASS** | Previous-version-to-current-pnpm GUI upgrade, fake-data retention, shortcut target/icon, target uninstall, no observed unrelated/production-install effect. |

- [x] Close Task 4's visible shortcut/icon/GUI installation gate using **USER CONFIRMED PASS**.
- [x] Close all three remaining desktop-execution groups using **USER CONFIRMED PASS**.
- [x] Merge four explicitly separate evidence classes: historical phases, current automated checks, real Manager desktop verification, and user-confirmed Windows operations.
- [x] Preserve `environment-before.json` failure and its non-blocking comparison limit. User confirmation does not create missing filesystem/registry snapshots or independent machine evidence.
- [x] Preserve original cold-start/Soak/stress data; no full build or acceptance rerun for this documentation closeout.

No new user test path, PID, screenshot, registry value, operation timestamp or log was provided; none is inferred. Final M-A–M-G acceptance matrix and evidence reuse rationale are in the report's `Phase 4G-5 Final Acceptance Closeout — 2026-10-04` section. P0=0, P1=0, blocking P2=0; one non-blocking P3 evidence limitation remains.

Checkpoint authorization is limited to two separable commits (approved pnpm migration, then Phase 4G-5 documents) and ordinary push to the existing branch upstream after diff review. No merge/PR/tag/release or Phase 4G-6 execution.

**PHASE 4G-5 COMPLETE**

**WINDOWS ENVIRONMENT FINAL ACCEPTANCE PASS**

**READY FOR PHASE 4G-6**
