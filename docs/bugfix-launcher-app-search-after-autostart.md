# Launcher Application Search After Auto-Start Bug

## Severity

P0 candidate / release blocker candidate, because the reported failure removes all local Windows application results. The recurring catalog persistence/index failure described below is confirmed for the reproduced current-source path. The complete install-day → reboot timeline is **not confirmed** because no install-day runtime log or cache snapshot is available.

## User Symptom

The user reports that local Windows application search worked on installation day, then returned no Windows application results after a shutdown/reboot with login startup enabled. Manually restarting WebTools after the reboot did not restore results. The affected groups include Win32 applications, packaged apps, Settings, Control Panel, and Remote Desktop/system entries.

## Environment Change

The project and Codex environment had been migrated to a new Windows computer, and a new installer was built there. The current checkout is on the new computer. The live production installation at `D:\webtools` was observed but not launched, stopped, modified, or used for destructive testing.

## Reproduction

- A true Windows reboot was not performed as part of this investigation.
- The isolated current-source catalog diagnostic reproduced the invalid merged record and catalog snapshot save failure using the current Windows discovery results.
- NativeHost diagnostic records available under `%TEMP%\WebToolsNativeHost-PoC` contained `catalog_snapshot_unavailable=missing` followed by `catalog_error=Application catalog is not safe to persist.` on two runs. These records establish repeated failure in those runs, but do not establish what happened on installation day.
- After the fix, the same isolated discovery run completed, the snapshot saved and reloaded, and representative SearchCore queries returned results.
- Actual Launcher UI, login startup after reboot, and physical keyboard behavior still require human acceptance.

## Search Pipeline

Current code path:

1. `App.OnStartup` in `native/WebTools.NativeHost/App.xaml.cs` loads Native launcher settings and constructs `MainWindow` with `AppCatalogSnapshotStore.DefaultPath` (`%LOCALAPPDATA%\WebTools\app-catalog.v1.json`).
2. `MainWindow.InitializeSearchAsync()` in `native/WebTools.NativeHost/MainWindow.xaml.cs` restores a valid snapshot if present, builds the initial SearchCore, then starts `RefreshCatalogAsync()`.
3. `AppCatalogService.RefreshAsync()` runs `WindowsAppSource.List()` off the UI thread, merges provider records, then marks the catalog ready.
4. `WindowsAppSource.List()` in `native/WebTools.NativeHost/Catalog/WindowsAppSource.cs` enumerates per-user/common Start Menu and Desktop shortcuts, Start Apps / AppsFolder records, App Paths registry entries, and fixed system entries. Broken individual shortcuts are isolated.
5. `RefreshCatalogAsync()` persists the refreshed catalog and then calls `RebuildIndexAsync()` to publish a new SearchCore.
6. SearchCore receives `CatalogApp.AsSearchEntry()` records and serves Launcher queries.

## Auto-Start Path

`LoginStartupService.Apply()` in `native/WebTools.NativeHost/Services/LoginStartupService.cs` writes the current `Environment.ProcessPath` as a quoted absolute command to the per-user `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value named `WebTools`. If the process is the development `dotnet` host, it adds the entry assembly path; packaged runs use the NativeHost executable directly. On the inspected machine the value pointed to `D:\webtools\WebTools.NativeHost.exe`. Discovery uses Windows known-folder APIs and registry sources; the inspected search path has no `Directory.GetCurrentDirectory()` dependency or old-computer absolute path.

## Root Cause

**Confirmed for the reproduced current-source persistent failure mechanism:** one merged catalog record had an identity computed from an executable invocation while retaining a different `AppFolderTarget` as its launch target. `AppCatalogSnapshotStore.SaveIfChangedAsync()` validates that each catalog ID matches its retained target. The identity mismatch rejected the entire refreshed catalog with `InvalidDataException("Application catalog is not safe to persist.")`.

The refresh order in `MainWindow.RefreshCatalogAsync()` is:

`RefreshAsync()` → `SaveIfChangedAsync()` → `RebuildIndexAsync()`.

When persistence rejected the catalog, the exception skipped `RebuildIndexAsync()`. On a cold start with no usable snapshot, the initial SearchCore had been built from the empty catalog. Thus discovery could return applications while the active search index remained empty. The failure was not a SearchCore ranking defect and not an empty-provider result.

The defect was in `AppCatalogService.Merge()`: an AppsFolder/AppFolder record may acquire the ID of a matching later shortcut/executable invocation, but the pre-fix merge retained the first record's AppFolder target even though its own ID did not equal the merged ID.

## First-Run vs Subsequent-Run Root Cause Analysis

- **Why manual restart after the failure did not recover:** a missing/invalid snapshot caused a fresh discovery and merge; the same matching source rows reproduced the same identity mismatch; the snapshot save failed before SearchCore rebuild again. Restarting the process therefore repeated the deterministic failure rather than clearing it.
- **Why all application classes disappeared:** all provider records converge into one merged catalog and one SearchCore. A single invalid record caused validation of the whole snapshot write to fail, and the exception prevented publishing the refreshed index. This shared failure affected Win32, packaged apps, system/settings tools, and Control Panel together.
- **Why it appeared after reboot despite working on installation day:** the available evidence does not establish the installation-day catalog contents, cache state, provider ordering, or binary identity. A previously valid snapshot or a difference in which App Paths/shortcut rows were discoverable could explain the apparent first-run success, but neither is proven. Do not treat either as the confirmed explanation.
- **Conclusion:** the persistent post-reboot failure mechanism is confirmed for the reproduced current-source path. The complete chronology, including the initial success, is **ROOT CAUSE NOT CONFIRMED** until a user-run candidate reproduces the post-reboot scenario or install-day evidence becomes available.

## Evidence

An isolated diagnostic scan on this Windows account, without changing the production installation or user data, observed:

- 380 provider records before merge; 236 merged catalog entries.
- Source totals: Desktop/shortcut and App Paths records 258 combined, packaged 47, Start Apps 70, system 5.
- Start Apps and AppsFolder discovery available; no provider-level failure reported.
- One merged entry failed the catalog identity/target snapshot invariant. The harness reported source/target types and hashed IDs only; it did not print application names, user file lists, or full paths.
- SearchCore constructed directly from discovered records returned results for `visual` (3), `设置` (4), `控制面板` (1), `远程桌面` (1), and `mstsc` (1).
- After the fix: same 380 input / 236 merged counts, zero invalid merged records, successful isolated snapshot save and reload, and the same representative query counts.

The persisted catalog is versioned (`app-catalog.v1.json`, schema 1) and contains machine-local launch paths. It is loaded if valid; missing or invalid snapshots trigger discovery. The observed failure did not write an empty snapshot: validation threw before writing. The existing catch path, however, also skipped refreshing the live SearchCore.

## Fix

- `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`: when a merged identity came from an incoming executable/shortcut target and the retained target did not itself produce that ID, retain the target that does produce the merged ID and recompute its icon reference. This keeps the persisted ID/target invariant valid while preserving aliases and the effective invocation identity.
- `native/WebTools.NativeHost.Checks/Program.cs`: add a regression case for an AppsFolder record followed by a matching App Paths executable record; assert the merged target matches its ID and passes snapshot validation and persistence.

No catalog schema, settings schema, provider, startup registration, NativeHost process model, or SearchCore algorithm was changed.

## Cache / Index Safety

The fix prevents this reproduced invalid-record condition from rejecting the whole current catalog snapshot. The existing atomic temp-file/replace writer remains unchanged. No cache was cleared or reset during investigation. No new behavior was added to treat provider failure as a successful empty catalog. Broader startup recovery redesign was not performed because it was outside the minimal confirmed defect.

## Tests

Results from the isolated source worktree at base commit `62b9774ad851f7c7159fbc6539f7d8771400d632` plus only the two fix files:

- TDD regression before fix: 71/72 NativeHost checks, with the new identity/snapshot test failing as expected.
- `dotnet run --project native\WebTools.NativeHost.Checks\WebTools.NativeHost.Checks.csproj --configuration Release`: **72/72 PASS** after fix.
- `dotnet build native\WebTools.NativeHost\WebTools.NativeHost.csproj --configuration Release`: **PASS**, 0 warnings, 0 errors.
- `pnpm install --frozen-lockfile`: **PASS** in detached isolated worktree.
- `pnpm run typecheck`: **PASS** (the official package script proceeded to the following test stage).
- `pnpm test`: **FAIL, 408/410**. Two existing Phase 5D UI-smoke source assertions failed in `scripts/verify-phase5d-plugin-ui-smoke.test.mjs`; both assert exact source-text ordering/patterns in `scripts/verify-phase5d-plugin-ui-smoke.mjs`. Neither file was changed by this bugfix. No unrelated test or production behavior was changed to mask them.
- `pnpm run build`: **PASS**; Electron Main, preload, and renderer bundles built.
- `dotnet run --project native\WebTools.UpdateHelper.Checks\WebTools.UpdateHelper.Checks.csproj --configuration Release`: **PASS** (all checks).
- `git diff --check`: **PASS**; Git emitted only line-ending normalization warnings for the pre-existing dirty files.

## Packaged Validation

One isolated acceptance candidate was generated from the clean base checkout plus only the NativeHost fix and focused check; pre-existing Phase 6E-3 dirty work was not included.

- Candidate: `C:\Users\admin\Documents\Codex\RestoredProjects\webTools\release\manual-test\WebTools-Setup-0.1.0-app-search-fix.exe`
- SHA-256: `15D8DACB776FFCEFAE10DA70F0D7D30AAFA295FE3A8491D158A56E50262EDD45`
- Build identity: base `62b9774ad851f7c7159fbc6539f7d8771400d632` plus the two fix files listed above.
- Staged NativeHost `WebTools.NativeHost.exe` SHA-256: `34EE04AB213A6B74B3487E44DA0443BCD048138D29A8D2420606062A46A06EF1`.
- Staged Manager `resources\app.asar` SHA-256: `E3FB5CED9BAE6CAA60E3FB88A3DE8398EF7BB028ECD9711E358D3ACDD22E926F`.
- Electron Manager production directory build: PASS.
- NativeHost and UpdateHelper self-contained staging: PASS.
- Cover-install protocol check: PASS.
- NSIS build: PASS (one existing missing `LegalCopyright` metadata warning).
- Isolated install to a Unicode/space path, installed Manager path discovery, and isolated self-uninstall: PASS.
- The standard `pnpm run package:win` command stopped before packaging because of the two unrelated Node tests above. The candidate was therefore built by running the same later build/stage/NSIS/isolated-smoke steps directly; this deviation is disclosed rather than reported as a full `package:win` pass.
- No GUI was launched, no reboot was simulated, and the candidate was not installed over `D:\webtools`.

## Human Reboot Acceptance

**REQUIRES HUMAN REBOOT ACCEPTANCE.** The current user's `HKCU\...\Run\WebTools` entry points to the live `D:\webtools` install. Do not enable candidate auto-start in this Windows account, because it would replace that production startup entry. Use a separate Windows test account (with its own HKCU and `%APPDATA%`) and a separate install directory, never `D:\webtools`, then:

1. Launch it manually and verify a known Win32 app, packaged app, Settings item, Control Panel, and Remote Desktop search.
2. Exit from the Native tray, relaunch manually, and repeat representative searches.
3. In the test account, enable login startup and confirm its per-user startup entry targets the candidate installation.
4. Sign out/in or reboot, wait for WebTools to start automatically, then open Launcher and repeat the same searches.
5. Confirm Manager remains closed and Electron is absent during Native-only search. Report whether installation-day → post-reboot behavior is now resolved.

Record user-observed pass/fail in the follow-up bug report or reply; no machine-specific PID, timestamp, registry snapshot, or screenshot is claimed here.

## Regression Risk

The target replacement only happens when the retained target does not match the merged ID and the incoming target does. Existing aliases continue to merge. NativeHost checks cover persistence safety and snapshot reload; the live Windows UI and startup-after-reboot behavior remain unverified.

## Phase 6D / 6E Compatibility

The fix touches only NativeHost catalog merge logic and its focused check. Feature Registry, Native Feature Projection v2, Gate 2/Gate 3, Manifest v1, Electron, and Phase 6E-3 files were not advanced or modified by this bugfix. The emergency change must remain separate from the pre-existing Phase 6E-3 working-tree changes.

## Git State

- Branch: `codex/shared-ai-translation-2.0`.
- Base HEAD: `62b9774ad851f7c7159fbc6539f7d8771400d632`; branch is ahead 4 / behind 0 relative to `origin/codex/shared-ai-translation-2.0`. No checkout, reset, clean, stash, commit, or push was performed.
- No files are staged. The existing dirty Phase 6E-3/plugin documentation and implementation files were retained; they were not copied into the isolated build worktree.
- Bugfix source changes: `native/WebTools.NativeHost/Catalog/AppCatalogService.cs` and `native/WebTools.NativeHost.Checks/Program.cs`.
- This report is the only additional tracked file created for this bugfix.
- Pre-existing Phase 6E-3 dirty changes remain present and unstaged; they were excluded from the candidate build.
- Candidate binaries and isolated build outputs are under ignored `release/` or the system temp directory.
- Commit: NO. Push: NO.
