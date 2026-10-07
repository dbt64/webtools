# WebTools Phase 5I Launcher Improvement Pass

**Date:** 2026-10-05
**Scope:** Discoverable `file:` search, dedicated Native Launcher file-search presentation and safe file actions, plus broader Windows system-app discovery.
**Phase boundary:** This is a bounded Phase 5I improvement. Phase 6 was not started.

**Current candidate:** The original `native-production-20261005-204221` installer below is superseded by the startup fix in the final section. Use `native-production-20261005-211823` for the next user retest.

## Summary

The Native Launcher now offers a `Search Files` contextual action for ordinary nonblank local queries. It retains the raw query and enters the existing `file:` / Everything pipeline without closing the Launcher. In `file:` mode, the result area presents a file-category sidebar and bounded, virtualized file list. File operations use host-owned result tokens and expose only Open, Show in Folder, Copy object, Copy path, and Copy parent path.

Windows app discovery now supplements the existing shortcut/App Paths catalog with bounded `Get-StartApps` and Shell `AppsFolder` metadata. It uses typed, validated AppFolder targets, merges aliases against an existing launch invocation only when identity is unambiguous, and feeds the existing catalog, pinyin index and search pipeline. Discovery failures are reported separately from unavailable optional sources/components.

## Source and candidate identity

- Branch: `codex/shared-ai-translation-2.0`
- Source base at implementation start: `c1dec0c94e717ce05e6773c5b67576f8c3d5ea95`
- Candidate built from that source plus the Phase 5I Launcher Improvement working-tree changes on 2026-10-05; the checkpoint commit is recorded in Git after this report.
- Package root: `D:\System default\Desktop\HomePage\release\native-production-20261005-204221` (ignored by Git).
- Installer: `D:\System default\Desktop\HomePage\release\native-production-20261005-204221\WebTools-Setup-0.1.0.exe`
- Installer size: `191,507,101` bytes.
- Installer SHA-256: `48352DB1CD326D91B454DDC75340F91A8B29286FCD30A387D28F32501F05F34A`.
- Staged NativeHost SHA-256: `E792DB349722F3CCEF0D96401B476C76F5D581964A875F38DF8926746E64F5B8`.
- Staged Manager executable SHA-256: `39B1FCABBAFE953664E3611F7FDA3DC5D9FFDDDBD8D7BBE030E04AD2CA58E8FF`.
- Manager `app.asar` SHA-256: `EBC447212CF15077DBC7313A750C90CCE4B309D1D2AAA1B5C6B8AF40DBCCAB56`.

The current candidate is an unsigned acceptance build, not a published release. Build identities above identify the actual tested package outputs; no source archive or build is claimed to be reproducible from the base commit alone.

## Implementation and changed files

| File | Change |
|---|---|
| `native/WebTools.NativeHost/Search/SearchModels.cs` | Adds the `SearchFiles` result kind and typed contextual action. |
| `native/WebTools.NativeHost/Search/SearchCore.cs` | Adds Search Files only to ordinary local search, after normal results and Translation; preserves the exact raw query. Prefix modes remain excluded. |
| `native/WebTools.NativeHost/Files/FileCategory.cs` | Central extension-to-category mapping, including folder precedence and unknown `Other`. |
| `native/WebTools.NativeHost/Files/FileSearchProjection.cs` | Detects `file:` mode, bounds results at 20, and filters the current result projection without a second Everything query. |
| `native/WebTools.NativeHost/Files/FileResultOperations.cs` | Validates host-owned tokens and paths; implements safe shell, Explorer selection and clipboard operations with bounded failures. It has no destructive operation. |
| `native/WebTools.NativeHost/Files/EverythingClient.cs` | Keeps the current token/path resolution contract and invalidates stale results consistently for the new actions. |
| `native/WebTools.NativeHost/MainWindow.xaml` | Adds themed category and file-result presentation with recycling virtualization and native context menus. |
| `native/WebTools.NativeHost/MainWindow.xaml.cs` | Wires category selection, keyboard/focus behavior, contextual Search Files transition, and token-only actions. |
| `native/WebTools.NativeHost/Models/LauncherInteractionState.cs` | Tracks the active file-search presentation state. |
| `native/WebTools.NativeHost/Services/LauncherResultSelectionController.cs` | Preserves bounded shared selection when switching between category and result lists. |
| `native/WebTools.NativeHost/Services/ResultActionExecutor.cs` | Adds the typed AppFolder launch path using fixed Explorer invocation. |
| `native/WebTools.NativeHost/Catalog/WindowsAppSource.cs` | Enumerates bounded Start Apps and AppsFolder metadata, records source availability/failure, isolates broken entries, and uses a conditional Disk Management record. |
| `native/WebTools.NativeHost/Catalog/AppCatalogService.cs` | Adds validated typed AppFolder targets and conservative effective-invocation deduplication with alias merge. |
| `native/WebTools.NativeHost.Checks/Program.cs` | Adds contextual action, file model/operation, discovery parsing, target safety, pinyin/initials, deduplication and capability diagnostics. |
| `native/search-contract/launcher-search-parity.json` | Updates the deterministic search/action parity contract. |
| `docs/superpowers/plans/2026-10-05-phase5i-launcher-file-search-system-discovery.md` | Records implementation tasks and the remaining packaged GUI/manual acceptance gate. |
| `docs/webtools-phase5i-launcher-improvement.md` | This implementation and acceptance report. |

No dependencies, Electron/Manager code, data schemas, production install, real user profile, startup registration, SecretStore or token were modified.

## Search Files action and file mode

- Ordinary local queries with non-whitespace text expose `Search Files`; whitespace-only and the `?`, `/`, and `file:` command modes do not.
- Search Files carries the exact original local query, including leading/trailing whitespace, without a path. Choosing it changes the input to a single `file:` prefix and keeps the Launcher open.
- Translation remains an extra contextual action after the normal result set; the user's selected rule is preserved: only ordinary text mode may show it, and existing prefix search behavior is unchanged.
- The existing Everything client remains the sole file-search backend. Category changes never resubmit the query.
- The category model is `All`, `Folder`, `Application`, `Document`, `Image`, `Video`, `Audio`, `Archive`, and `Other`; extension groups live in one classifier. Directories always classify as Folder.
- File rows show fixed type glyphs, display name and parent path, use a 20-row bound and recycling virtualization.
- All privileged actions resolve an opaque current result token inside NativeHost. The view does not submit a filesystem path. Paths are length/type/existence checked again before action; failures return bounded UI messages.
- Available actions are Open, Show in Folder, Copy object, Copy path and Copy parent path. Copy object uses the Windows file-drop clipboard format. No Delete, Move, Rename or Cut action exists.
- Physical WPF focus/context-menu interaction, Explorer clipboard paste and external opening were not executed in this session; see Manual Verification.

## Windows system discovery

### Previous coverage and gap

The existing catalog centered on Start Menu shortcut discovery, App Paths and the previously supported packaged/fixed records. Some Windows shell-visible entries, including Remote Desktop Connection on the observed machine, were not represented through that limited shortcut/executable coverage. Extending only a hand-maintained Remote Desktop row would not provide maintainable coverage of other Start Apps/Windows Tools.

### Chosen discovery and identity

- Retains current Start Menu `.lnk`, App Paths and fixed safe system records.
- Adds bounded `Get-StartApps` metadata and Shell `AppsFolder` enumeration; it does not recursively scan `C:\Windows` or `System32`.
- Uses a typed `AppFolderTarget` and validated identifiers. Launch is constructed by NativeHost as fixed `explorer.exe` plus a validated `shell:AppsFolder\<AppId>` argument. Returned display metadata and query text are never treated as commands.
- Start Apps may omit an executable/working directory. A metadata record merges with a non-AppFolder launch only when the path plus arguments and available working-directory information select exactly one invocation. Otherwise it retains a distinct stable AppFolder identity. Different arguments or working directories are not collapsed.
- Localized names join the existing alias/index path; Chinese aliases use the existing pinyin/initial matching. English, localized Chinese, full pinyin and initials for Remote Desktop each returned one matching result on this machine.
- Capability diagnostics distinguish available discovery sources, unavailable optional tools and source discovery failure. Intrusive administration tools were never launched automatically.

### Current-machine capability observation

The live diagnostic enumerated 298 catalog applications in 17,463 ms. `Get-StartApps` and `AppsFolder` both reported `AVAILABLE`, with no source failure. These entries were reported as `AVAILABLE` on this machine: Remote Desktop Connection, Control Panel, Device Manager, Disk Management, Services, Task Scheduler, Registry Editor, Event Viewer, System Information, Resource Monitor, Performance Monitor, Command Prompt, PowerShell and Windows Terminal.

Remote Desktop English, Chinese, full-pinyin and initials searches each returned one application result. The textual match list may include other semantically related tools; availability is based on the fixed expected executable/entry and match, not on name coincidence alone.

One earlier same-environment catalog scan observed 298 apps in 16,611 ms. The runs were not a controlled A/B and diagnostics changed between them; the difference is not evidence of a performance change. No reliable idle-CPU sample, installed packaged first-search latency, Everything first-result latency or category-switch timing was obtained. No numeric performance claim is made.

## Review findings

- **P0: 0; P1: 0; blocking P2: 0.** Spec review identified and the implementation corrected two issues before closeout: discovery-source failures could be reported like an empty successful catalog, and Search Files could lose raw query edge whitespace. Diagnostics now carry explicit source status/failure; action tests verify exact raw text and one-prefix transformation.
- **P3: 1.** The main window currently constructs/uses the small file-operation adapter in both result activation and context-menu dispatch. This is a maintainability duplication, not a correctness or acceptance blocker; it is left unchanged to avoid widening this bounded pass.
- No arbitrary shell command, renderer-supplied path, full Windows directory scan, new dependency or destructive file action was introduced.
- The isolated packaged NativeHost/Manager runtime driver was denied by the current execution policy. No policy bypass was attempted. An ordinary UI launch of the non-test Host would use the real Nook profile, so it was not used as a substitute. Packaged GUI behavior remains a manual gate.

## Automated and package verification

| Check | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS, 313/313; existing `MODULE_TYPELESS_PACKAGE_JSON` warnings only |
| `pnpm run build` | PASS — Electron Main, preload and Vue Renderer |
| NativeHost Checks | PASS, 67/67, including search parity, all nine categories, action/token safety, system-entry parsing/identity and pinyin/initial matching |
| UpdateHelper Checks | PASS, 10/10 |
| `pnpm run package:win` | PASS; generated the installer and staged release outputs listed above |
| Isolated installer smoke | PASS; installed under a disposable path containing spaces and Chinese characters, confirmed Manager executable discovery, then ran the isolated uninstaller. It did not touch `D:\webtools` or `%APPDATA%\Nook`. |
| Isolated packaged Host/Manager runtime and normal-close smoke | NOT TESTED; the execution-policy-controlled driver was denied. |
| `git diff --check` | PASS before report creation; rerun at final review/checkpoint. |

`D:\webtools`, `%APPDATA%\Nook`, real Favorites, Settings, SecretStore, AI tokens, startup registration and unrelated applications were not operated on. The staged release and smoke-install paths are under the ignored `release/` directory.

## USER MANUAL VERIFICATION

Use the candidate installer above only in an isolated test directory/profile; do not replace the production installation. Record results with the candidate SHA-256 from this report.

1. In ordinary Launcher search, enter `host`. Confirm `Search Files` appears. Choose it by mouse and then, in a fresh query, by keyboard. Confirm the Launcher remains visible and the input becomes `file:host` (with any typed edge whitespace preserved).
2. Confirm `file:` shows the dedicated layout: categories on the left and bounded file rows on the right. Test all nine categories and verify an empty category shows a clear empty state and does not change the query.
3. Use disposable test files/folders with Unicode names and test Open, Show in Folder, Copy object (paste into Explorer), Copy path and Copy parent path. Confirm no destructive item is offered. Do not use important files or disconnected/network paths for the first check.
4. Search Remote Desktop Connection by English, `远程桌面连接`, full pinyin and initials; confirm one result and, if safe in the test environment, launch it. Check optional tools such as Control Panel, Device Manager, Disk Management, Services and Task Scheduler against what is installed on the machine. Do not change system settings or registry data.
5. Smoke ordinary app, website, Translation, plugin, `?`, `/` and existing `file:` searches. Confirm prefix semantics and selection remain unchanged.
6. Open and close Manager. Confirm normal close returns the candidate's Electron process group to zero while its isolated NativeHost remains available, and reopening Manager works.
7. Check file-mode keyboard navigation, category/list focus, Escape/hide behavior, Light/Dark theme and narrow/normal Launcher sizing.

Record each as `USER CONFIRMED PASS`, `FAIL` or `NOT TESTED`. No physical GUI, keyboard, mouse, clipboard paste or external-application result is claimed in this report.

## Final status

Automated regression, system discovery diagnostics, packaging and isolated installer-layout smoke passed. Packaged physical GUI/runtime behavior still requires user testing.

**PHASE 5I LAUNCHER IMPROVEMENT PASS — MANUAL RETEST REQUIRED**

No Phase 6 work, PR, merge, tag or release is included in this report. The checkpoint commit and push status are reported in the task closeout.

## Startup regression repair — 2026-10-05

The user installed the original candidate and reported a startup dialog: `WebTools Native Host could not start. 设置 connectionId 时引发了异常。` This is a confirmed **P1 startup regression** introduced by this improvement pass. The earlier zero-blocker review describes its historical engineering snapshot; it does not override the user's later failure.

### Reproduction and root cause

A new STA regression check constructs the real `MainWindow` with disposable profile paths, without starting Manager, registering production hotkeys or accessing the real profile. Before the repair, the suite produced **67/68 PASS**, with the new startup check failing exactly as reported:

```text
System.Windows.Markup.XamlParseException: 设置 connectionId 时引发了异常。
 ---> System.InvalidCastException:
 Unable to cast object of type 'System.Windows.Controls.ContextMenu'
 to type 'System.Windows.Controls.TextBlock'.
 at MainWindow.IComponentConnector.Connect(...)
 at MainWindow.InitializeComponent()
```

Event declarations inside the file-result style's inline `ContextMenu` caused the generated BAML connection mapping to address the later `FileEmptyText` TextBlock. Compiling/publishing succeeded, but loading the actual window failed. The previous model-level checks and install-layout smoke did not instantiate the real window and therefore missed this defect.

### Minimal repair and prevention

- `MainWindow.xaml`: moves the same five-action menu into a keyed window resource and lets the style reference it. Event names and file-operation contracts are unchanged.
- `NativeHost.Checks/Program.cs`: adds the real compiled-XAML startup check, verifies the nine initialized categories and loaded safe context menu, and releases the window's native resources afterward. The failure was observed before changing the product XAML.
- `scripts/build-native-production.ps1`: runs the NativeHost Checks before publishing/packing, so this startup path is now a mandatory installer-build gate.

After repair, NativeHost Checks pass **68/68**. No dependency, user-data format, search algorithm or Manager lifecycle change was needed.

### New candidate and verification

- Source: `0711fa53047c4ebf10af5ce433141a1cfbfd47f6` plus this startup-repair working tree.
- Installer: `D:\System default\Desktop\HomePage\release\native-production-20261005-211823\WebTools-Setup-0.1.0.exe`
- Size: `191,435,320` bytes.
- SHA-256: `6457191C190CD7E04C81C6AA8A6EA884831D7622AB960E075503CEC45CE9FF54`.
- NativeHost DLL SHA-256: `C6817A8B93F1313A3A26C42008003A16D2662A82A95FFF2B918363C7D392C96E`.
- Manager `app.asar` remains `EBC447212CF15077DBC7313A750C90CCE4B309D1D2AAA1B5C6B8AF40DBCCAB56`.

`pnpm run package:win` exited 0 and freshly passed TypeScript checks, Node **313/313**, Electron Main/preload/Renderer build, NativeHost **68/68**, UpdateHelper checks, cover-install ordering, and isolated Chinese/space-path installation/Manager discovery/self-uninstall. Package log: `D:\系统缓存\webtools-phase5i-launcher-startup-fix-package.log`, SHA-256 `AEA1DC2F45584FE4984F6AFF63998AA5B5A9CB35066313E95B6894E2EC6A9CE1`.

The actual self-contained staged NativeHost was also run with its existing opt-in isolated profile/pipe/mutex/hotkey mode. **AUTOMATED PACKAGED STARTUP SMOKE PASS**:

- NativeHost PID `19464`, exact staged executable path and process creation time recorded.
- Real WPF window loaded and showed with HWND `3082780`; diagnostic snapshot reported the input focused.
- Ordinary `host` query rendered application, Translation and Search Files rows.
- `file:startup-smoke` entered Files mode. Everything was deliberately disabled; actual Everything results and file operations were not exercised by this startup smoke.
- Hide cleared query/results and hid the same HWND.
- No process under the candidate Manager path was present.
- Exact isolated control pipe requested normal exit; the Host exited with code 0. PID `19464` was subsequently absent.

Evidence: `D:\系统缓存\webtools-startup-fix-smoke-5LqMbX\startup-smoke-report.json`, SHA-256 `4759FC8E702FA9FE05EDF486AEC4982E129E590882E286088D710650F20E7ABA`. This short startup test used programmatic WPF control and omitted the tray in test mode. It is not a physical hotkey/tray/installer GUI acceptance claim. It did not touch `D:\webtools`, `%APPDATA%\Nook`, real credentials or startup registration.

The startup P1 is repaired and verified; no unresolved P0/P1 from this repair is known. User installation/startup retest and the file/context-menu manual checklist above remain required. No new commit or push was performed by this repair task.

**PHASE 5I LAUNCHER IMPROVEMENT PASS — MANUAL RETEST REQUIRED**
