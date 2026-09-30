# Website dialog and cover-install regression fixes

Date: 2026-09-30. Branch: `codex/shared-ai-translation-2.0`.

## Latest installer follow-up — complete cover-install verification

The user reported that Retry still failed after tray Exit and requested an explicit
**退出后台 / 取消** update confirmation. The earlier read-only Retry fixture below
did not execute the actual old uninstaller, so it did not verify complete updates.

A full regression using the actual NSIS functions with a private registry namespace
and disposable Unicode/space install directory reproduced a real uninstall race:
the candidate returned success and wrote new files, then the delayed old temporary
uninstaller deleted them. NSIS uninstallers normally launch a temporary child;
`ExecWait` alone does not wait for that child. The corrected invocation uses final,
unquoted `_?=$R8`, as documented in the [NSIS command-line reference](https://nsis.sourceforge.io/Docs/Chapter3.html#3.2.2).
The installer also checks that the old uninstall registration and executables are
gone before replacing files. This is a confirmed defect; it is not a claim that
every possible failure in the user's initial run had this same cause.

The current update page:

- Reuses the recognized installed directory, skipping folder selection for updates.
- Offers **退出后台 / 取消** while WebTools remains running.
- Calls the helper's `--prepare-install` only after explicit confirmation.
- Requests existing current-user, PID-validated NativeHost preparation; only a
  genuinely absent pipe allows exact-path legacy window closing.
- Waits for Host and Manager process paths to disappear, not merely an acknowledgement.
- Keeps the page and directory on shutdown failure, with **重试退出**.
- Rechecks readiness immediately before old uninstall. No force-kill path is used.
- Waits for old uninstall to finish before writing new files.

Additional files: `InstallPreparationService.cs`, helper checks' `WindowFixture.cs`,
and `scripts/verify-cover-install.mjs`. The full cover test is now run by
`scripts/build-native-production.ps1` alongside the existing fresh-install smoke.
Only helper/installer/test/documentation code changed for this follow-up; Launcher
search and Manager website UI were not changed.

Executed follow-up checks:

| Verification | Result |
| --- | --- |
| Full isolated silent cover install with deliberately delayed old uninstall | FAIL before `_?=` fix; PASS after fix; new files survive delayed verification |
| Windows update UI: 退出后台 → normal fixture exit → old uninstall → new install → Finish | PASS, installer exit 0, unchanged directory and retained new files |
| Windows update UI: failed exit → retained page → normal manual fixture exit → 重试退出 → complete update | PASS, installer exit 0, unchanged session and retained new files |
| Current installed `protected live installation` NativeHost normal preparation | PASS, helper exit 0; Host=0 and Manager=0 afterwards; installed Host restarted normally |
| Helper Release checks | PASS, 10 checks including cooperative Host+Manager exit and refusal safety |
| `npm test` | PASS, 95/95 |

The GUI tests use the complete installer template with only registry/shortcut
locations redirected, a lightweight test payload, and a delayed old uninstaller.
They do not overwrite the user's installed product. Early GUI driver attempts had
hidden-window and watchdog issues; those attempts were not counted as successful
acceptance. The two completed GUI scenarios above returned exit 0. Actual installed
Host exit was additionally verified against the user's existing executable path.

The historical results and installer path below describe the previous candidate.
Use the newest candidate reported at the end of this follow-up, not the older
`native-production-20260930-211820` installer.

Final candidate:
`release\native-production-20260930-221227\WebTools-Setup-0.1.0.exe`

Final `npm run package:win` exited 0 and passed typecheck, 95 Node tests, Manager
production build, 10 helper checks, integrated complete cover-install regression,
fresh Unicode/space install, Manager executable discovery, and self-uninstall.
NativeHost checks separately passed 47/47; final `git diff --check` exited 0.
No commit, push, PR, or release was performed. User verification of the final
full-payload installer over the live installation remains recommended, especially
with Manager open; the automated GUI cover tests use a lightweight fixture payload.

## Installer

The previous implementation attempted automatic shutdown and aborted on failure.
Manually exiting afterwards could not resume that installation attempt.

The revised installer checks the exact executable paths under the previous
installation's registered `InstallLocation`. Recognized paths are NativeHost,
`Manager/WebTools.exe`, and the older Electron-only root `WebTools.exe`.
The helper only checks process presence; it does not send shutdown commands or
kill processes. A running application produces a localized Retry / Cancel prompt
instructing the user to exit through the tray. Retry checks again in the same setup
session. Only success proceeds to old uninstall and file replacement. Unknown or
inaccessible state fails closed with a retry prompt. Silent installation aborts
while the old application is running. User data and startup preference handling
are unchanged.

The old shutdown pipe and helper library code remain available as historical
implementation; the installer CLI no longer calls those shutdown paths.

## Folder dialog

Folder/site deletion previously used `window.confirm`, a native modal. The reported
focus failure occurred when returning from deletion to the new-folder dialog.
Deletion now uses an in-page Vue confirmation dialog, with Cancel initially focused
and focus restored when it closes. The folder name input explicitly receives focus
after mount and Vue's next render tick, rather than relying on HTML autofocus.
There is no timer-based focus workaround or Manager minimize/restore workaround.
Deletion still preserves websites when removing a folder.

## Modified files for these regressions

- `native/WebTools.UpdateHelper/Program.cs`: read-only `--check-install` command.
- `native/WebTools.UpdateHelper/InstallProcessTargets.cs`: legacy exact-root executable recognition.
- `native/WebTools.UpdateHelper.Checks/Program.cs`: real isolated-process retry checks.
- `scripts/native-production.nsi`: Retry / Cancel loop before uninstall/copy.
- `src/features/favorites/FavoritesView.vue`: shared folder/site delete dialog.
- `src/features/favorites/DeleteConfirmationDialog.vue`: new in-page confirmation.
- `src/features/favorites/FolderNameDialog.vue`: explicit mounted input focus.
- `tests/phase4f-native-first-architecture.test.mjs`: updated installer/dialog contracts.
- `scripts/verify-website-dialogs.mjs`: built Electron regression test with disposable profile.
- Existing update plan/spec: note the user-approved replacement of automatic shutdown.

## Executed verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 95/95 |
| `npm run build` | PASS |
| `git diff --check` | PASS; Git prints existing LF/CRLF conversion warnings |
| UpdateHelper Release checks | PASS, 6 checks |
| NativeHost Release checks | PASS, 47/47 |
| `node --experimental-strip-types scripts/verify-website-dialogs.mjs` | PASS, 3 delete/create/focus/input/save cycles in the actual built Electron renderer |
| `npm run package:win` | PASS; NativeHost/helper self-contained win-x64, Electron Manager and NSIS |
| Isolated install, Manager discovery, self-uninstall | PASS, Unicode/space directory |
| Windows Retry prompt interaction | PASS in isolated NSIS fixture |

The Retry UI fixture copies the actual production NSIS preflight/retry block and
uses the published self-contained helper. A synthetic exact-path Manager remained
running while Retry displayed the warning again. After its normal stdin-driven
exit, clicking Retry in the same setup reached a continuation marker. The fixture
quits at that marker without invoking an uninstaller, copying product files, or
writing product registry entries. Its intentional early NSIS Quit returned code 2;
the observed continuation marker, not that exit code, establishes this assertion.
One initial harness attempt had unavailable stdin and was cancelled/cleaned up;
the subsequent interactive attempt performed the normal-exit path successfully.

The Electron dialog test uses an independent temporary profile, actual CRUD IPC,
and CDP focus/text insertion. It guards native `window.confirm` to catch regressions
back to that modal path. This is not a claim of physical mouse testing of the
installed user profile.

## Test installer

`release\native-production-20260930-211820\WebTools-Setup-0.1.0.exe`

## User acceptance still required

1. Run this installer while the currently installed WebTools is in the tray.
   Exit WebTools normally, then click Retry in the existing prompt. Confirm the
   complete real cover-install succeeds and saved data/startup preference remain.
2. Create a folder, move an unclassified website into it in edit mode, delete the
   folder, and create another folder. Confirm typing and mouse focus work without
   minimizing the Manager; repeat several times.
3. Confirm Native Launcher hotkey and search still work after installation.

No user installation was updated during automated testing. Native search code and
Launcher UI behavior were not changed for these two fixes. Existing Phase 4F work
remains in the working tree. No commit, push, PR, or release was performed.
