# Update Installer Auto-Shutdown Implementation Plan

## Superseding correction — 2026-09-30 user acceptance

**Latest revision:** The user subsequently requested automatic normal exit again,
through an explicit **退出后台 / 取消** confirmation. That is now the current flow:
the custom NSIS update page invokes `--prepare-install`, retains the same page on
failure, and continues automatically after exact-path processes exit. Recognized
updates reuse the existing installation directory. The previous uninstaller is
invoked with final, unquoted `_?=<old-install-root>` so `ExecWait` waits for the real
uninstall instead of a temporary launcher. A complete isolated cover-install test
is now part of the production packaging gate. The manual-only flow described in
the following paragraphs is historical and superseded.

### Superseded interim behavior

An intermediate implementation required the user to exit from the tray and then
choose **Retry / Cancel**; its helper only checked process state and did not request
shutdown. That behavior was later superseded by the explicit **退出后台 / 取消**
confirmation described above. On confirmation, the installer requests a graceful
close, waits for the exact installation's processes to exit, and continues in the
same installer session. Current behavior and regression evidence are recorded in
`docs/website-and-installer-regression-fixes.md`.

The old automatic-shutdown tasks below are retained as implementation history, not
the current acceptance contract. Current verification is recorded in
`docs/website-and-installer-regression-fixes.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the WebTools installer close the exact previous NativeHost and Manager processes gracefully before uninstalling/replacing their files, without requiring manual tray exit.

**Architecture:** Add a dedicated current-user-only `prepare-update` pipe to NativeHost and a small self-contained Windows helper shipped with the existing NSIS installer. The helper targets only processes whose executable paths are inside the recognized prior install root; when the old host has no update pipe, it uses `WM_CLOSE` in Manager-then-NativeHost order. Any timeout, unsafe path, wrong host identity, or explicit refusal aborts the installer before uninstallation or file replacement; no process is force-killed.

**Tech Stack:** .NET 10 Windows/WPF, `System.IO.Pipes`, Windows inbox APIs, NSIS, PowerShell build script, existing NativeHost checks harness.

**Spec:** `docs/superpowers/specs/2026-09-30-websites-manager-and-update-install-design.md`

## Global Constraints

- Do not force-kill NativeHost, Manager, or their child processes.
- Do not proceed to the old uninstaller or file replacement unless all exact-path target processes have exited.
- Do not target processes by executable name alone; compare canonical executable paths under the recognized install root.
- Keep the update pipe restricted to the current Windows user and accept only the fixed `prepare-update` operation.
- Do not pass filesystem paths or arbitrary commands through the pipe.
- Preserve user data, install user-data path, startup preference, and current installation behavior.
- Add no runtime dependency; publish the helper self-contained for `win-x64`.
- Do not change Native Launcher search, window lifecycle, tray behavior, or Manager navigation other than the shutdown coordination needed by an update.
- Do not commit, push, create a PR, release, or enter Phase 4G as part of this implementation.

## Review Focus

- A same-named WebTools process from a different install path must remain untouched.
- A connected pipe that rejects the expected PID or reports Manager shutdown failure must abort; it must not fall through to a less-safe close path.
- An absent pipe from the immediately previous build must select the exact-path legacy close path.
- An unresponsive Manager must not be force-killed and must prevent the installer from invoking the previous uninstaller or copying files.
- Chinese characters and spaces in the prior install root must survive NSIS argument passing and canonical path comparison.

---

### Task 1: Add a bounded NativeHost update-preparation endpoint

**Files:**
- Create: `native/WebTools.NativeHost/Services/UpdatePreparationProtocol.cs`
- Create: `native/WebTools.NativeHost/Services/UpdatePreparationServer.cs`
- Modify: `native/WebTools.NativeHost/Services/ManagerController.cs`
- Modify: `native/WebTools.NativeHost/App.xaml.cs`
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`

**Interfaces:**
- Pipe name: `WebTools.NativeHost.Update.v1`.
- Request: `{ protocolVersion: 1, operation: 'prepare-update', expectedHostProcessId: number }`.
- Response: `{ protocolVersion: 1, success: boolean, errorCode?: string }`.
- Pipe server uses `PipeOptions.CurrentUserOnly`; it accepts no path or arbitrary command field.
- `ManagerController.TryPrepareForUpdateAsync(TimeSpan timeout, CancellationToken cancellationToken): Task<bool>` is update-specific and never calls `Process.Kill()`.

- [x] **Step 1: Add failing protocol and shutdown-path checks**

  Extend the NativeHost checks harness to cover accepted/rejected protocol version and operation, expected PID validation, successful preparation, Manager timeout refusal, and the invariant that the update path contains no process-kill fallback. Use an isolated named-pipe name for the protocol round-trip check.

- [x] **Step 2: Run the focused checks and confirm failure**

  Run: `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release`

  Expected: FAIL because the update protocol/server path does not exist.

- [x] **Step 3: Add the typed update protocol and current-user-only pipe server**

  Implement a single-operation request/response protocol in the two new service files. Reject malformed JSON, protocol mismatch, unknown operation, duplicate/unexpected fields as appropriate, and mismatched `expectedHostProcessId`. Serialize responses before initiating host shutdown so the helper can receive an acknowledgement.

- [x] **Step 4: Add a no-force Manager preparation path**

  Add `TryPrepareForUpdateAsync()` to `ManagerController`. If no Manager process exists or it has already exited, return success. Otherwise request the existing graceful `shutdown-manager` operation and wait up to the supplied bound for that exact process to exit. Return failure on timeout/request refusal/disconnect; do not reuse the existing tray Exit `ShutdownAsync()` force-kill fallback. Restore the controller to usable state if preparation fails.

- [x] **Step 5: Integrate preparation and host exit without changing ordinary tray Exit**

  Start and stop the update pipe with NativeHost lifetime in `App.xaml.cs`. On a valid request, prepare Manager first; only after success, acknowledge and close the NativeHost window through its normal cleanup path. On failure, keep NativeHost/tray running and return a failure response. Leave `ExitApplicationAsync()` and normal tray Exit semantics unchanged.

- [x] **Step 6: Run NativeHost checks and build**

  Run: `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release`

  Expected: PASS, including pipe validation, Manager timeout refusal, and no-force update shutdown.

  Run: `dotnet build native/WebTools.NativeHost/WebTools.NativeHost.csproj --configuration Release --runtime win-x64`

  Expected: PASS.

---

### Task 2: Build the exact-path update helper and legacy compatibility path

**Files:**
- Create: `native/WebTools.UpdateHelper/WebTools.UpdateHelper.csproj`
- Create: `native/WebTools.UpdateHelper/Program.cs`
- Create: `native/WebTools.UpdateHelper/InstallProcessTargets.cs`
- Create: `native/WebTools.UpdateHelper/UpdatePipeClient.cs`
- Create: `native/WebTools.UpdateHelper/LegacyWindowCloser.cs`
- Create: `native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj`
- Create: `native/WebTools.UpdateHelper.Checks/Program.cs`

**Interfaces:**
- Installer invocation: `WebTools.UpdateHelper.exe --prepare-install <canonical-install-root>`.
- Success exit code: `0`; unsafe target, explicit host refusal, or timeout returns nonzero with a concise localized error.
- Recognized target paths: `<root>\WebTools.NativeHost.exe` and `<root>\Manager\WebTools.exe` only.
- New-pipe request supplies the exact discovered NativeHost PID, not a path.

- [x] **Step 1: Add failing exact-path and pipe-fallback checks**

  In `WebTools.UpdateHelper.Checks`, test canonical path matching (including case and Chinese/space paths), reject same-named executables outside the root, fixed protocol serialization, and fallback classification: only pipe-not-found permits the legacy path; timeout, access denied, malformed reply, PID mismatch, or explicit Manager refusal must fail closed.

- [x] **Step 2: Run helper checks and confirm failure**

  Run: `dotnet run --project native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj --configuration Release`

  Expected: FAIL because helper contracts are not implemented.

- [x] **Step 3: Resolve running processes by canonical executable path**

  Implement `InstallProcessTargets` to normalize the supplied root and compare each target process's full executable path using Windows case-insensitive path semantics. Handle inaccessible/exited processes as transient only when a fresh enumeration confirms they are gone; never match by process name alone.

- [x] **Step 4: Prefer the new NativeHost pipe and wait for process exit**

  Implement `UpdatePipeClient` to connect to `WebTools.NativeHost.Update.v1`, send only protocol version 1, `prepare-update`, and the exact expected PID, then validate the matching response. Wait for the target Manager and NativeHost processes to exit. A positive response followed by a still-running process at timeout is failure.

  Treat only the OS result meaning “pipe does not exist” as a legacy build. Pipe busy, timeout, access denied, malformed reply, wrong PID, or a negative host response must abort without `WM_CLOSE` fallback.

- [x] **Step 5: Implement the old-build close fallback**

  In `LegacyWindowCloser`, enumerate top-level windows without filtering out hidden ones, map each HWND back to its PID, and verify that PID's canonical executable path is exactly the target Manager or NativeHost path. Post `WM_CLOSE` to Manager first and wait for its process to exit; then post `WM_CLOSE` to NativeHost and wait. If a target has no closable window or does not exit by the bound, return failure. Never call `TerminateProcess`, `Process.Kill`, or equivalent.

- [x] **Step 6: Add the helper command flow and run checks**

  Validate one install-root argument, canonicalize it, discover targets, use the pipe when available, use legacy fallback only for a genuinely absent pipe, and return nonzero if safe shutdown cannot be confirmed. Run:

  `dotnet run --project native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj --configuration Release`

  Expected: PASS for path filtering and fail-closed compatibility rules.

  Publish self-contained for `win-x64` and confirm the helper can run without an installed .NET runtime.

---

### Task 3: Gate NSIS replacement on successful preflight and ship the helper

**Files:**
- Modify: `scripts/native-production.nsi`
- Modify: `scripts/build-native-production.ps1`
- Modify: `tests/phase4f-native-first-architecture.test.mjs`

**Interfaces:**
- NSIS calls the staged helper with the `InstallLocation` from each recognized previous uninstall entry before invoking that entry's `UninstallString`.
- Missing/unresolvable prior `InstallLocation` or nonzero helper exit aborts the installer before the uninstaller and before copying new host/Manager files.
- The existing `/PHASE4FTEST` isolated smoke-install mode continues to skip previous-install cleanup and must not touch real product registry entries.

- [x] **Step 1: Add failing NSIS/build-contract tests**

  Extend `phase4f-native-first-architecture.test.mjs` to assert helper publish/staging, exact prior `InstallLocation` passing, helper invocation before `ExecWait` of the previous uninstaller, Abort on helper failure, and preservation of the existing isolated Phase 4F test-install bypass.

- [x] **Step 2: Run the focused test and confirm failure**

  Run: `node --experimental-strip-types --test tests/phase4f-native-first-architecture.test.mjs`

  Expected: FAIL until NSIS and the package staging script include the helper gate.

- [x] **Step 3: Publish the self-contained helper into the existing production stage**

  Update `build-native-production.ps1` to publish `WebTools.UpdateHelper` as Release `win-x64`, self-contained, into `stage\updater`; run the helper checks as part of packaging; assert the helper executable exists before invoking NSIS.

- [x] **Step 4: Add preflight before old uninstall and replacement**

  In `native-production.nsi`, read the previous entry's `InstallLocation`, extract the helper into `$PLUGINSDIR`, invoke it with correct NSIS quoting, check its exit code, and `Abort` with a retry-after-exit message on failure. Keep `Call RemovePreviousWebTools` before `SetOutPath`/file copy and do not modify user-data or startup-preference preservation.

- [x] **Step 5: Run NSIS contract tests and package smoke build**

  Run: `node --experimental-strip-types --test tests/phase4f-native-first-architecture.test.mjs`

  Expected: PASS, proving the preflight is ordered before uninstall/copy and the Phase 4F smoke path remains isolated.

  Run: `npm run package:win`

  Expected: NativeHost, Manager, and helper publish; NSIS compiles; existing isolated Unicode/space install smoke succeeds; helper is present in the generated installer stage.

---

### Task 4: Verify update safety on Windows

The automated package smoke covers a fresh isolated Unicode/space installation and its own uninstall only. All live-update flows below remain **USER MANUAL VERIFICATION**; no active installation was updated or closed during this build.

**Files:**
- No additional product files unless a preceding task's failing verification requires a scoped correction.
- Verify: helper publish output, generated `WebTools-Setup-0.1.0.exe`, installed NativeHost/Manager paths, and NSIS update path.

- [ ] **Step 1: Verify the immediately previous installed build compatibility path**

  Install/update while the old NativeHost is idle in the tray and Manager is closed. Confirm setup itself closes NativeHost, performs the update, and does not require manual tray Exit.

- [ ] **Step 2: Verify the old-build Manager-open path**

  Open Manager from the old installation, start setup, and confirm it sends close to the exact Manager first and NativeHost second; the installer continues only after both old processes exit.

- [ ] **Step 3: Verify the new pipe path**

  Install one build containing the new endpoint, open Manager, then run the next candidate installer. Confirm the pipe request gracefully closes Manager, acknowledges the matching NativeHost PID, exits NativeHost, and allows the installer to continue.

- [ ] **Step 4: Verify fail-closed behavior**

  Use a controlled unresponsive Manager fixture. Confirm the helper returns nonzero, the installer aborts before the old uninstaller/file copy, both processes are not force-killed, and a retry after normal close works.

- [ ] **Step 5: Verify exact targeting and path handling**

  Run with an installation root containing Chinese characters and spaces. Keep a same-named WebTools process from a different directory running and confirm it remains untouched.

- [ ] **Step 6: Verify product state and search-box regression**

  Confirm settings, saved websites, folder memberships, startup preference, and user-data path survive update. Confirm NativeHost still starts, tray remains available after Manager close, hotkey/search work, and Manager can be reopened. Recheck app search, Chinese/pinyin/initials, website search, `?`, `/`, and `file:` behavior.

---

## Task Dependencies

`Task 1 → Task 2 → Task 3 → Task 4`.

Task 1 establishes the host protocol and no-force Manager shutdown before the helper depends on its request contract. Task 2 must pass its path and fail-closed checks before installer wiring. Task 3's package smoke build must pass before Windows update acceptance.

## Completion Boundary

Stop after the update installer works and the acceptance results are reported. Do not commit, push, create a PR, release, or begin Phase 4G unless requested separately.
