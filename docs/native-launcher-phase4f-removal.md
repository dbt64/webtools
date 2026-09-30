# WebTools Native Launcher Phase 4F — Electron Launcher Removal

Date: 2026-09-30
Branch: `codex/shared-ai-translation-2.0`
Base commit: `9dbbace29f5f92e2729826be27e467dd9528ba19`

## Summary

Phase 4F removes the legacy Vue/Electron Launcher from the production build. The NativeHost is the sole production search window, tray, global hotkey, and login-startup owner. Electron remains as a Manager-only process and starts on demand for Manager pages, settings, entries, or translation handoff.

The existing Native-first settings and website projection protocol remains in use. Existing Manager data paths and the Native first-start migration from legacy Electron data remain intact. No dependency was added, and the old Electron Launcher source is removed rather than replaced with another Electron entry point.

## Production layout and entry point

`npm run package:win` now runs `scripts/build-native-production.ps1`. It publishes the .NET 10 NativeHost for `win-x64` as self-contained, builds Electron Manager production output, then compiles `scripts/native-production.nsi`.

The installer layout is:

```text
<WebTools install directory>/
  WebTools.NativeHost.exe
  WebTools.NativeHost.dll
  ...self-contained NativeHost files...
  Manager/
    WebTools.exe
    resources/app.asar
    ...Electron runtime files...
```

The installer Start Menu and Desktop shortcuts target `WebTools.NativeHost.exe`. The Native ManagerProcessLauncher resolves `Manager/WebTools.exe` beside the NativeHost. Packaged Manager starts in Native-managed mode and connects over the existing Named Pipe before creating its single Manager window.

Installer migration recognition is restricted to the exact `WebToolsNative` uninstall key with the expected product display name, or versioned Electron Builder entries whose name has a numeric dotted version and whose uninstall command identifies `Uninstall WebTools.exe`. Similar names without these characteristics are skipped. Existing WebTools startup registration is retargeted to NativeHost after an upgrade. Isolated smoke mode skips old-install removal and production shortcuts/startup registration, and uses its own registry key and marker file.

## Removed Electron Launcher production code

Removed the Electron Launcher HTML/entrypoint, Vue Launcher view and its Launcher-only components/caches, Launcher-only IPC handlers/services and global hotkey service, Launcher visibility helpers/tests, and Electron tray PNG. `electron.vite.config.ts` now builds only the Manager renderer. Preload and shared IPC no longer expose the retired Launcher controls or data APIs.

## Retained compatibility and behavior

- Electron Manager, secure preload boundary, website/settings/translation services, and existing translation providers remain.
- NativeHost keeps tray, search UI, app catalog, website projection, settings, hotkey, startup, and Launcher persistence responsibilities.
- Existing saved website schema and Manager DataStore remain unchanged.
- NativeHost continues to import legacy Electron Launcher state on first start using the existing migration path.
- Normal Manager close destroys its BrowserWindow and quits Electron; NativeHost remains available.
- Existing Native/Electron website and launcher-settings synchronization remains over the versioned Named Pipe.

## Validation performed

- `npm run typecheck` — PASS.
- `npm test` — PASS, 82/82 tests. The count is lower than the prior report because Electron-only Search implementations and their tests were removed; Native search contract tests remain.
- `npm run build` — PASS; production output contains only the Manager renderer entry. Initial renderer bundle is 287.81 kB JS plus 35.11 kB CSS, with Settings split into a separate chunk.
- .NET 10 self-contained `win-x64` NativeHost publish — PASS.
- `WebTools.NativeHost.Checks` — PASS, 46/46 checks.
- `git diff --check` — PASS (Git emitted only working-tree LF/CRLF conversion warnings; no whitespace errors).
- `npm run package:win` — PASS; included typecheck, all 82 Node tests, Manager build, self-contained NativeHost publish, installer creation, Manager discovery, and isolated install/uninstall smoke.

## Installer artifact and isolated smoke test

Candidate installer: `release\native-production-20260930-184219\WebTools-Setup-0.1.0.exe`

SHA-256: `258D4EAF28C126D8EF00652E999321E3F6D087C43DB40EB57CCE89948D034EE5`

Size: 167,583,174 bytes. The build script stages NativeHost and Manager together, installs the candidate under a unique temporary path containing Chinese characters and spaces, verifies the installed NativeHost, Manager executable, app archive, registry location, and Manager executable discovery, then invokes that test install's own uninstaller and verifies that the test directory and test registry key are removed. The latest package run passed this full isolated smoke test.

The installer candidate is unsigned. The smoke install directory and its dedicated registry entry were both absent after cleanup. The production installer was not launched against the user's existing installation. The actual installed-version upgrade path was therefore not exercised by automation.

## Historical Acceptance Checkpoint (superseded by the final closeout below)

### Automated/static checks

- Production Electron output has no Launcher HTML or entrypoint.
- Electron Main has only the Manager BrowserWindow and no tray/global shortcut/startup registration.
- Installer shortcuts point to NativeHost; Manager files are installed under `Manager/`.
- NativeHost remains the single-instance tray/hotkey process and discovers the packaged Manager at the staged layout.
- Isolated Unicode/space-path install and uninstall smoke test.
- App and system search contract tests continue passing.

### Earlier USER MANUAL VERIFICATION

The following require review on a Windows desktop with the candidate installer:

- Install or upgrade over the existing WebTools install and confirm its user data/settings remain available.
- Launch from the Start Menu/Desktop shortcut and confirm it starts NativeHost, with no Electron process until a Manager page is requested.
- Verify tray menu, global hotkey, app and website search, `?`, `/`, and `file:` behavior.
- Verify ordinary Manager open lands on Favorites; explicitly open Entries, Settings, and Translation and verify one Manager process/window is reused.
- Close Manager normally and verify Electron processes exit while NativeHost, tray, and hotkey remain active; reopen Manager.
- Verify Translation query handoff and launcher settings/website synchronization after restart.
- Verify Windows login startup launches NativeHost only.
- Verify upgrade and uninstall behavior against a disposable Windows account or VM before using the production installer on the primary installation.
- In Favorites, create a folder, add a website into it, restart Manager, and confirm the empty-folder and saved-folder states persist.
- With actual saved websites, resize Favorites to narrow, medium, and wide windows and confirm auto-fill increases/decreases columns while titles remain one-line and truncated.

GUI behavior, process-tree exit on normal Manager close, and production upgrade/uninstall safety are not claimed as automated passes.

## Historical Known Limitations (superseded by the final closeout below)

- The production installer candidate is not signed in this environment.
- Normal GUI lifecycle and in-place upgrade acceptance remain manual gates.
- Folder creation/persistence and Favorites appearance with real website data remain user UI acceptance items; the folder service contract, default route, and responsive CSS are covered by automated/static checks.
- Existing Main-frame navigation handling still allows local `file:` URLs; that pre-existing policy was outside the Phase 4F Launcher-removal scope and was not changed here.
- Phase 4G has not started. No before/after memory benchmark, profiling, forced garbage collection, or working-set trimming was performed; memory figures are not an acceptance gate for this cleanup.

## Supplemental Websites Workspace and Manager Search Retirement

### Completed changes

- Manager opens to Favorites by default. Explicit Native requests for Settings, Entries, or Translation still route to those sections; Translation prefill handoff remains unchanged.
- Removed the Manager Quick Search navigation/page and Search-only Vue components/state, Electron app-catalog and launch APIs, preload/IPC handlers, and obsolete Search-only initialization. NativeHost search and its app catalog remain the production launcher implementation.
- Favorites reads existing website and folder records through current persistence services; `WebsiteEntry` schema was not changed. New folder creation uses the existing folder persistence API, adds the saved folder to the live view, and the empty folder provides an add-website entry point.
- Folder groups are collapsible. Bookmarks use a compact horizontal favicon/title row with ellipsis and tooltip, subtle hover/active styling, and `repeat(auto-fill, minmax(180px, 1fr))`; this is not a fixed three-column layout or large card grid.
- Responsive CSS was inspected in the dev renderer at narrow/medium/wide effective widths with a temporary 18-item DOM fixture: observed approximately 2–3, 4, and 6–7 columns respectively. Fixture nodes were injected only for layout inspection and were not persisted.
- Search-specific application catalog IPC and JS app-search memory mutation APIs were deleted. The legacy profile sanitizer/data field remains only to preserve Native first-start migration compatibility.

### Supplemental validation

- `npm run typecheck` — PASS.
- `npm test` — PASS, 82/82.
- `npm run build` — PASS.
- `WebTools.NativeHost.Checks` — PASS, 46/46.
- `npm run package:win` — PASS; refreshed candidate package and isolated Unicode/space-path install, Manager discovery, and self-uninstall smoke all passed.
- `git diff --check` — PASS after report update; only line-ending conversion warnings are expected from Git on this checkout.
- Memory A/B benchmarks and profiling — NOT RUN, as instructed.

At the time of this supplemental validation, folder-create click flow, persistence after a Manager restart, and review with the user's real website list were still pending. That status was superseded by the later user-confirmed manual acceptance recorded in Final Acceptance. Native Launcher search, hotkey, tray, and process lifecycle remain separately classified there.

## Working-tree note

No commit, push, tag, GitHub Release, PR, or merge was created. The local installer candidate is a test artifact only. The working tree also contains previously uncommitted Phase 4E resource-attribution/manual-acceptance work; those files were preserved and were not treated as Phase 4F changes.

## Update Installer Graceful Shutdown

**AUTOMATED PASS / ISOLATED INSTALLER PASS**

- The installer detects processes by canonical executable path inside the selected installation root. A same-named executable from another installation is left running.
- For a current NativeHost, the update helper uses the fixed versioned named-pipe request. The server waits for Manager preparation, writes and flushes the success response, and only then schedules NativeHost shutdown. A refusal leaves both processes running.
- Only a genuinely missing update pipe selects the legacy exact-path `WM_CLOSE` path. Timeout, access denied, malformed reply, PID mismatch, explicit refusal, and other failures are classified as fail-closed.
- The installer page offers “退出后台” and “取消”. If preparation fails, the same page remains and offers retry; the current install path is retained.
- A private NSIS same-directory cover-install fixture passed. Its deliberately delayed old uninstaller completed before replacement; new files remained after the delay.
- An isolated UI fixture previously exercised both a successful normal-exit/retry flow and a failed-exit-then-retry flow in the same installer session. It used a synthetic Manager fixture, not the user's installed production process group.

The packaging pipeline reran the silent cover-install regression for the final candidate. It did not run an in-place update against the live `protected live installation` installation.

## Bugfix Regression

**AUTOMATED PASS**

- The temporary-profile Electron UI harness completed 10 consecutive `delete folder → create → blur and refocus by mouse → cancel → reopen → type and save` cycles.
- The same harness passed `rename → cancel → rename → edit and save` and confirmed two folders collapse and expand independently.
- A separate temporary DataStore test reloads persisted folder names, website membership, and per-folder ordering, then verifies deleting a non-empty folder leaves its websites unclassified.
- The harness did not access the real user profile or external websites.

## Final Acceptance

### Final Candidate

**LOCKED CANDIDATE — USER ACCEPTANCE TARGET.** No relevant product source changed after this package; it was not rebuilt.

- Path: `release\native-production-20260930-224223\WebTools-Setup-0.1.0.exe`
- SHA-256: `1872CCA579F8A6D425515A4576751917ADD3BE9205600B348EC24330B0F09FF4`
- Size: 191,395,268 bytes
- Hash re-computed for this closeout and matches the locked candidate.

### Historical Development Scenario

**SPECIFIC HISTORICAL PHASE 4D PRE-PIPE UPGRADE — NOT TESTED — NON-BLOCKING HISTORICAL DEVELOPMENT SCENARIO.**

- Artifact: `release\native-phase4d-acceptance-20260929-173001\WebTools-Native-Phase4D-Setup.exe`
- SHA-256: `BFEA5B6463F32E3A16F88E1B99DE2167F88F2901DB3493265490F323ACE710B9`
- Historical source tree: `9dbbace29f5f92e2729826be27e467dd9528ba19`; it predates `UpdatePreparationServer.cs`.
- Runtime pipe absence: **NOT VERIFIED**. Source age is not presented as runtime protocol evidence.
- The Phase 4D/4E packages were internal development/local-test artifacts, not broadly distributed supported releases. A dedicated VM/Sandbox/test-only production identity is not justified solely for this artifact. This scenario is not reported as passed and is not a Phase 4F blocker.

### Real Local Upgrade

**REAL LOCAL OLD-VERSION → CURRENT INSTALLER UPGRADE — USER CONFIRMED — PASS.** The user confirms the real local upgrade flow was manually exercised after the installer fixes:

- An older local WebTools installation was running in the background.
- The newer installer detected it and presented the background-exit flow.
- The running application exited; the same installer session continued without reopening the installer or reselecting the installation path.
- The replacement installation completed successfully over the previous local installation.

This is user acceptance evidence, not an automated pass. It is not being generalized into a separately tested exact Phase 4D runtime scenario or an unreported Manager-open subcase.

### Installer / Uninstall Ordering

**AUTOMATED PASS** for the recorded UpdateHelper/installer coverage: exact-path matching, update protocol handling, fail-closed classification, retry behavior, and delayed old-uninstaller ordering. The delayed-uninstaller regression verifies that replacement files remain after the old uninstaller completes. The manual real upgrade is recorded separately above as **USER CONFIRMED — PASS**.

### Real Website UI

**WEBSITE / FAVORITES UI — USER CONFIRMED — PASS.** The user confirms that the relevant website and folder functionality was manually tested after the recent bugfixes, with no remaining issue observed. This includes:

- Actual website/folder interaction and mouse reorder.
- Folder classification behavior and normal-use persistence.
- Native `/` projection, including website edit/delete synchronization observed during use.
- Opening a normal HTTPS website.
- Folder create/delete/recreate behavior, including the previously reported input/focus regression.
- Responsive Favorites behavior during normal UI use.

These are user-confirmed results, not automated UI passes.

### Installed Process Lifecycle

- Cold-start Electron count of zero: **USER CONFIRMED (prior Phase 4E acceptance)**.
- Manager lifecycle and on-demand ownership: **AUTOMATED PASS (contract/package checks recorded earlier)**. This closeout adds no new manual claim about a separate Manager-open upgrade scenario.
- The protected `protected live installation` installation was not changed or used for this closeout.

### Isolation Environment

No new OS-level isolation was created or configured. The prior read-only audit did not identify an available Sandbox, VM, or separate interactive session; that limitation applies only to repeating the internal historical Phase 4D scenario, which is now classified as non-blocking. No Windows user, system feature, registry entry, startup setting, or product identity was added or changed for testing.

### Data Preservation

The user-confirmed upgrade establishes that the replacement installation completed, but the user did not separately attest to specific stored test records in this closeout. Existing automated evidence remains: DataStore persistence across reload and installer behavior that leaves `%APPDATA%\Nook` outside the install-directory uninstall target. No additional data-preservation observation is claimed.

### Automated Evidence

No product code changed, so automated checks were reused rather than rerun and the locked installer was not rebuilt. The existing recorded results are:

| Check | Result |
| --- | --- |
| `npm run typecheck` | **AUTOMATED PASS** |
| `npm test` | **AUTOMATED PASS, 96/96** |
| `npm run build` | **AUTOMATED PASS** |
| NativeHost Checks | **AUTOMATED PASS, 47/47** |
| UpdateHelper Checks | **AUTOMATED PASS, 10/10** |
| Website dialog verification | **AUTOMATED PASS** |
| Production package and isolated install/uninstall smoke | **AUTOMATED PASS** |
| Exact-path/update protocol checks | **AUTOMATED PASS** |
| Delayed-uninstaller ordering | **AUTOMATED PASS** |
| `git diff --check` | **PASS**, verified after the report update |
| Locked candidate SHA-256 | **MATCH** |

### Remaining Risk

No confirmed blocker remains for the supported Phase 4F product requirements. The one unexecuted upgrade scenario is the specific internal Phase 4D pre-pipe artifact, which was not broadly distributed and is classified **NOT TESTED — NON-BLOCKING HISTORICAL DEVELOPMENT SCENARIO**. It is not claimed to pass.

### P0 / P1

- **P0:** no confirmed defect.
- **P1:** no confirmed defect.

### Deferred

- Review whether Electron Manager has a legitimate requirement for main-frame `file:` navigation as separate security hardening.
- The installer candidate is unsigned in this environment; signing remains a release/deployment consideration, not a Phase 4F blocker.
- Phase 4G is not started.

### Git Status

- Branch: `codex/shared-ai-translation-2.0`
- HEAD: `9dbbace29f5f92e2729826be27e467dd9528ba19`
- Existing Phase 4E/4F working-tree changes remain preserved. This closeout changed only this report.
- No commit, push, PR, merge, tag, or release was created.

### Final Decision

**PHASE 4F COMPLETE — READY FOR PHASE 4G.**

Stop here; no Phase 4G work was started.