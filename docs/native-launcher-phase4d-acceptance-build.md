# WebTools Native Launcher Phase 4D — Windows Acceptance Build

**Date:** 2026-09-29
**Branch:** `codex/shared-ai-translation-2.0`
**Status:** The latest Phase 4D acceptance installer is built and its package layout, icon assets, and release Manager discovery passed automated checks. WPF visual/hotkey acceptance remains **USER MANUAL VERIFICATION**. No production installer change, Phase 4E work, commit, push, or PR was performed.

## Acceptance installer

```text
D:\System default\Desktop\HomePage\release\native-phase4d-acceptance-20260929-173001\WebTools-Native-Phase4D-Setup.exe
```

The installer is a standalone Phase 4D test package. It uses a separate Start Menu group and a separate default install directory, so it does not overwrite the existing production Electron installer. The existing `package.json` electron-builder/NSIS configuration was not changed.

## Installed layout

Default per-user install directory:

```text
%LOCALAPPDATA%\Programs\WebTools Native Phase 4D\
  WebTools.NativeHost.exe
  WebTools.NativeHost.dll and self-contained .NET runtime files
  app.ico
  Manager\
    WebTools.exe
    resources\app.asar
    Electron runtime DLLs, locales, and other packaged resources
  Uninstall.exe
```

The Start Menu and desktop shortcuts created by an interactive install both target `WebTools.NativeHost.exe`. The installer does not add an auto-run action. Launching the Native Host is expected to leave Electron unloaded until a Manager page is requested; the process-count behavior still needs manual GUI verification.

The Native Host's first packaged-manager candidate is `<NativeHost directory>\Manager\WebTools.exe`. This matches the staged install layout. The test check invokes the existing `ManagerProcessLauncher.ResolvePackagedManagerExecutable` method, rather than reimplementing its search rule.

## Build and automated verification

The repeatable build is defined by:

- `scripts/build-native-phase4d-acceptance.ps1`
- `scripts/native-phase4d-acceptance.nsi`

The acceptance build ran these stages:

1. `electron-vite build` — **PASS**; production Main, preload, Launcher, and Manager assets generated.
2. `dotnet publish native\WebTools.NativeHost\WebTools.NativeHost.csproj --configuration Release --runtime win-x64 --self-contained true -p:UseAppHost=true -p:PublishSingleFile=false -p:PublishTrimmed=false` — **PASS**.
3. `electron-builder --win --x64 --dir --config.directories.output=<release staging>\manager-build` — **PASS**; produced the production `win-unpacked` Manager payload.
4. `makensis native-phase4d-acceptance.nsi` using the electron-builder-cached NSIS 3.0.4.1 compiler — **PASS**.
5. Silent install to a temporary directory containing Chinese characters and spaces — **PASS**. The installed Native Host, Manager executable, and `resources\app.asar` were present.
6. Manager executable discovery against the actual installed directory — **PASS**. The smoke install contained the Native Host and the resolver returned the Manager executable at:

   ```text
   D:\System default\Desktop\HomePage\release\native-phase4d-acceptance-20260929-154826\smoke-install\Phase 4D 中文 空格验证\WebTools.NativeHost.exe
   D:\System default\Desktop\HomePage\release\native-phase4d-acceptance-20260929-154826\smoke-install\Phase 4D 中文 空格验证\Manager\WebTools.exe
   ```

7. Smoke uninstall — **PASS**; the temporary installation directory was removed after NSIS completed its self-cleanup.
8. Web and Node typecheck commands — **PASS** (`vue-tsc --noEmit -p tsconfig.web.json`; `tsc --noEmit -p tsconfig.node.json`).
9. Node suite — **PASS**, 109/109.
10. Native Host checks — **PASS**, 22/22, including the Chinese/space path-discovery check.
11. PowerShell build-script syntax check — **PASS**.
12. `git diff --check` — **PASS**.

## Runtime acceptance results

| Check | Result |
|---|---|
| Native Host and Electron Manager both exist in the installed layout | **PASS**, silent install smoke |
| Manager release executable discovery with spaces and Chinese in the installation path | **PASS**, actual installed directory passed to the Native Host resolver |
| Shortcuts from an interactive installer launch Native Host | **USER MANUAL VERIFICATION**; the smoke used silent install, which intentionally skips shell shortcuts |
| Native idle startup has zero Electron processes | **USER MANUAL VERIFICATION** |
| Native app/site/web/Everything search does not start Electron | **USER MANUAL VERIFICATION** |
| Tray ownership and global hotkey belong to Native Host | **USER MANUAL VERIFICATION** |
| Opening Search Manager, Entries, Settings, or Translation starts only one Manager process group/window | **USER MANUAL VERIFICATION** |
| Normal Manager close destroys the BrowserWindow and returns Electron process count to zero while Native Host remains | **USER MANUAL VERIFICATION**; this was not inferred from pipe-disconnect tests |
| Reopen Manager after normal close | **USER MANUAL VERIFICATION** |
| Translation handoff from Electron-absent state preserves exact text and does not auto-translate | **USER MANUAL VERIFICATION** |
| Hotkey/search-engine/website add-edit-delete syncs immediately and survives Native Host restart | **USER MANUAL VERIFICATION** |
| Native search commands `?`, `/`, `file:`, Chinese, pinyin, and initials | **USER MANUAL VERIFICATION** on the installed package |

GUI input, tray interaction, external application launch, Electron process counts, Manager close/reopen, Translation handoff, and settings sync were not driven in this environment. No GUI result is claimed as passed.

## Known limitations

- The acceptance installer is a separate test installer and does not replace or upgrade the existing production installer. It has no updater changes.
- The Native Host currently uses the existing `%APPDATA%\Nook` profile. Settings and Launcher state modified by this acceptance build will share that per-user profile with other WebTools builds using the same profile.
- The silent smoke intentionally omitted Start Menu/desktop shortcut creation; the NSIS script targets the Native Host for both shortcuts during an interactive install, but that shell interaction remains manual.
- The Native Host normal-close and process-zero lifecycle must be accepted through the Manager window's ordinary close button. Closing or terminating Native Host is not a substitute.
- The generated installer is unsigned (`Get-AuthenticodeSignature` reports `NotSigned`); Windows may show an unknown-publisher prompt.

## Changed files for this acceptance build

- `scripts/build-native-phase4d-acceptance.ps1` — builds production payloads, compiles the standalone installer, and performs install/path/uninstall smoke checks.
- `scripts/native-phase4d-acceptance.nsi` — test-only NSIS layout with Native Host as the shortcut target and Electron Manager nested under `Manager\`.
- `native/WebTools.NativeHost.Checks/Program.cs` — adds a check for the existing Manager resolver with Chinese and space-containing paths, plus a CLI entry for verifying an installed directory.
- `docs/native-launcher-phase4d-acceptance-build.md` — this acceptance record.

## Phase 4D acceptance follow-up — 2026-09-29

### Fixed selection and icon behavior

- WPF programmatic `ItemsSource` replacement now enters a synchronization guard before assigning the new source. The guard prevents a synchronous `SelectionChanged` reset from clearing the first-result selection.
- The production selection controller is covered on an STA WPF thread for `u`, `ut`, `uto`, `utoo`, `utool`, and `utools`; each query keeps row 0 selected for Enter. Arrow selection also survives an icon-only row property update.
- Packaged applications keep an opaque `appx:<AUMID>` icon reference. Only displayed result rows request icons. The Native Host resolves the package-family and application ID, reads a bounded `AppxManifest.xml`, chooses a package-local raster `VisualElements` asset, loads it with `OnLoad`, freezes the bitmap, and stores success or failure in the bounded 64-entry cache. Theme-specific entries are separate. Failed lookups return null for the generic command glyph and are negatively cached.
- Manifest lookup matches the requested application ID exactly, rejects paths outside the package root, prohibits DTD/entity resolution, and isolates damaged/inaccessible packages. Diagnostics record outcomes only; no package filesystem path is forwarded to a renderer or written in the lookup outcome.
- The tray now reads `app.ico` relative to `AppContext.BaseDirectory`, holds its owned `Icon` for the `NotifyIcon` lifetime, then hides and disposes the tray resources. If loading fails, it falls back to `SystemIcons.Application`.

Files changed for this follow-up:

- `native/WebTools.NativeHost/MainWindow.xaml.cs` and `MainWindow.xaml` — selection synchronization, icon request wiring, themed WPF layout, system theme update, brand button, result badges, and matching row/fallback icons.
- `native/WebTools.NativeHost/Services/LauncherResultSelectionController.cs` — testable WPF selection synchronization boundary.
- `native/WebTools.NativeHost/Services/NativeIconCache.cs` and `PackagedIconResolver.cs` — AUMID routing, manifest variant selection, frozen bitmaps, theme-keyed bounded cache, failure caching, and safe diagnostics.
- `native/WebTools.NativeHost/Catalog/AppCatalogService.cs` — opaque packaged-app icon reference.
- `native/WebTools.NativeHost/Services/TrayIconService.cs` — executable-relative branded icon loading and owned icon disposal.
- `native/WebTools.NativeHost/Services/LauncherThemePalette.cs` — Electron dark/light token mapping and system-theme resolution.
- `native/WebTools.NativeHost/AssemblyInfo.cs`, `native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj`, and `native/WebTools.NativeHost.Checks/Program.cs` — internal test access and WPF, package, cache, theme, and tray regression coverage.
- `docs/superpowers/plans/2026-09-29-native-launcher-phase4d-acceptance-fixes.md` — implementation checklist and verification status.

### Actual icon checks

- Current Start Menu catalog scan found 287 entries, including packaged applications.
- `--packaged-icons` resolved icons for all 12 sampled packaged applications in this environment, including 3D Viewer, Calculator, Notepad, Paint, Maps, and Snipping Tool.
- `--icons` resolved 100/100 sampled catalog icons. The cache remained at 64 entries and estimated 90,112 bitmap bytes. GDI handles were `0 → 41 → 41` across first extraction and repeat lookup, so the second pass added no GDI handles.
- These checks exercise actual installed package manifests and raster assets. Per-app visual appearance in the WPF result list still needs user verification.

### Electron-to-WPF visual token mapping

The WPF Launcher now uses the existing Electron Launcher as its source of truth. The values below match `src/styles/tokens.css`; system theme resolves from Windows `AppsUseLightTheme` and responds to `SystemEvents.UserPreferenceChanged` while Native Host is running.

| Token | Electron dark / WPF | Electron light / WPF |
|---|---|---|
| Canvas | `#0b0c0e` | `#f3f5f8` |
| Surface | `#18191b` | `#ffffff` |
| Raised surface | `#202124` | `#f7f9fb` |
| Border | `#2c2d30` | `#d6dee7` |
| Primary text | `#f4f4f5` | `#1b2633` |
| Muted text | `#a1a1aa` | `#5f6f80` |
| Quiet text / scrollbar | `#85858d` | `#8491a0` |
| Accent | `#e4e4e7` | `#2868b2` |
| Accent soft | `#27282b` | `#e7f0fb` |
| Hover | `#242528` | `#edf2f7` |
| Selected | `#2b2c30` | `#e2edf9` |

WPF layout now follows the Electron hierarchy: 850px width, 128px compact window, 326px expanded window, 466px search-result window, 76px search bar, 34px result icon, 51px result row, 14/11px result typography, outside-panel expand control, and a themed scrollbar. The search bar includes the packaged brand icon and opens Manager Search. Website, app, file, and translation results retain their existing actions and keyboard behavior. WPF rendering and light/system theme transitions require manual visual confirmation.

### Resource measurements

- Before this source update, the already-installed Native Host idle process was sampled for 30 seconds at approximately 114.1 MB Private Bytes and 179.3 MB Working Set, with 67 GDI objects, 41 USER objects, and 16 threads. This is the installed prior build and is separate from the search stress harness.
- A 1,000-query stress run completed 950 local and 50 Everything searches. Local median/P95 were 0.055/0.130 ms; Everything median/P95 were 168.985/188.677 ms. The stress process changed from 36,327,424 to 36,524,032 Private Bytes (about +0.19 MB); final Working Set was 93,691,904 bytes, GDI remained `0 → 0`, USER remained `6 → 6`, and final thread count was 23.
- The built Native Host could not be launched side-by-side for an after measurement because the user's already-running installed Native Host owns the single-instance mutex. It was left running and was not terminated. The stress-harness memory figures are not comparable to the WPF process-group idle baseline, so no post-change idle-memory claim is made.
- The 300-cycle real-window show/hide test was not driven in this UI automation environment. It remains **USER MANUAL VERIFICATION**; no SendKeys, synthetic timer loop, or hidden-window substitute was used.

### Latest package and validation

Latest installer:

```text
D:\System default\Desktop\HomePage\release\native-phase4d-acceptance-20260929-173001\WebTools-Native-Phase4D-Setup.exe
```

The final build re-ran Electron production build, .NET 10 `win-x64` self-contained publish, electron-builder Manager packaging, standalone NSIS compression, silent install into a unique Chinese/space-containing path, installed Manager executable discovery, and silent uninstall. The staged layout contains `host\WebTools.NativeHost.exe`, root `app.ico`, and `Manager\WebTools.exe` with its Electron resources. The NSIS icon uses the same root ICO. The acceptance install smoke passed; it does not start either application or claim GUI acceptance.

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | PASS, 109/109 |
| `npm run build` | PASS |
| Native Host regression checks | PASS, 33/33 |
| Real packaged app icon sample | PASS, 12/12 resolved |
| `--icons` cache/GDI check | PASS, 100/100 resolved; repeat GDI count stable |
| 1,000-query stress | PASS; timings and process figures above |
| Chinese/space silent install and Manager discovery | PASS |
| `git diff --check` | PASS after the final documentation update |

### Manual acceptance still required

- Launch the new installer and confirm the Native tray icon and shortcut icon display the WebTools brand.
- Verify dark, light, and system themes, including a system-theme change while running.
- Verify compact, expanded, and search-result layouts, scrollbar appearance, and no clipping at the user's display scale.
- Search packaged apps and installed Win32 apps; check the real icon and the generic fallback visually.
- Verify `u` → `ut` → `uto` → `utoo` → `utool` → `utools`, Enter activation, ArrowUp/Down, and async icon arrival without selection loss.
- Verify search, website shortcut opening, file/web prefixes, drag, blur-hide, Escape, and repeated hotkey show/hide.
- Complete 300 actual show/hide cycles, then inspect the installed Native Host's process memory, GDI/USER counts, handles, and threads. The prior installed build remains the only directly measured idle WPF baseline so far.
