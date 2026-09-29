# Native Launcher Phase 4D Acceptance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Correct WPF result selection, packaged-app icons and tray branding, then bring Native Launcher geometry and theme styling close to the existing Electron Launcher and rebuild the separate Phase 4D acceptance installer.

**Architecture:** Keep Native Host as the product entry point and retain the WPF launcher. Fix result selection at the WPF `ItemsSource` synchronization boundary, resolve packaged icons lazily from AUMID/package manifest assets with a generic fallback, and load the tray icon from the executable directory. Use the current Electron Launcher Vue/CSS as the visual source of truth and map its tokens into WPF resources without adding dependencies.

**Tech Stack:** .NET 10 WPF / Windows Forms NotifyIcon, Win32 package and Shell APIs, XML manifest parsing, Vue/CSS reference, NSIS acceptance installer.

**Spec:** User-provided Phase 4D acceptance fixes request pasted at `C:\Users\zry\.codex\attachments\116fa1f5-1b82-454d-af8b-74f2ccaafa8e\已粘贴的文本.txt`.

## Global Constraints

- Do not enter Phase 4E, remove the Electron Launcher, modify the production installer, add dependencies, commit, push, or create a PR.
- Keep the Native Host as the installed product entry point; search must not start Electron.
- Preserve Win32 icon extraction (`SHGetFileInfoW` → HICON → WPF bitmap → `DestroyIcon`), lazy visible-result loading, the bounded cache, and safe generic fallbacks.
- Keep the existing global hotkey, Enter/arrow behavior, IME, compact/expanded preference, website/file/translation actions, DPI behavior, and accessibility semantics.
- The acceptance build remains separate from the production installer and includes `app.ico` beside `WebTools.NativeHost.exe`.
- Never use timers, delays, SendKeys, forced GC, working-set trimming, or memory trimming to hide lifecycle defects or improve measurements.

## Review Focus

- Replacing a WPF `ItemsSource` can synchronously raise `SelectionChanged` before the selection synchronization guard is active; test that programmatic replacement preserves default first-row selection.
- Rapid query generations must leave Enter targeting the current query's first result, while Arrow Up/Down selection remains stable during icon property updates.
- Missing, malformed, inaccessible, localized, or unsupported package manifest assets must not fail catalog search or crash the launcher; test asset path selection and fallback.
- A missing `app.ico` must leave Native Host startup working and the `NotifyIcon` safely disposed; test packaged path resolution and fallback selection.
- Light, dark, and system themes plus compact/expanded/search-result layouts must remain within the work area without clipping or changing keyboard/focus behavior; mark visual behavior for manual acceptance.

---

### Task 1: Pin the result-selection regression

**Files:**
- Modify: `native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj`
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`
- Modify: `native/WebTools.NativeHost/Models/LauncherInteractionState.cs` only if the focused test proves its contract is incomplete.

**Interfaces:**
- Consume the existing `LauncherInteractionState` API and a WPF `ListBox` on an STA thread.
- Produce regression coverage for the WPF result replacement/synchronization boundary and Enter's selected-result target.

- [x] Add STA WPF checks for queries `u`, `ut`, `uto`, `utoo`, `utool`, and `utools`; each non-empty result generation must select index 0 and resolve the first result for Enter.
- [x] Add a check for query → ArrowDown → icon-only row property update; the selected row must remain selected.
- [x] Reproduce the current `ItemsSource` replacement order in the test and run `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj`; verify the regression assertion fails for the expected lost selection.

### Task 2: Fix WPF selection synchronization

**Files:**
- Modify: `native/WebTools.NativeHost/MainWindow.xaml.cs`
- Modify or create: `native/WebTools.NativeHost/Services/LauncherResultSelection.cs` if needed to keep the WPF synchronization behavior directly testable.
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`

**Interfaces:**
- Programmatic row replacement must set the synchronization guard before assigning `ItemsSource`, then apply the model's selected index.
- User mouse/arrow selection must update the same `LauncherInteractionState`; icon-only property changes must not replace the result generation.

- [x] Make the failing WPF regression check exercise the production synchronization helper.
- [x] Run the focused check and confirm it fails before the fix and passes after the fix.
- [x] Keep `QueryBox` keyboard focus independent from `ListBox` result selection; Enter resolves the state model's current selected result.
- [x] Run the full Native Host checks.

### Task 3: Add packaged-app manifest icon resolution

**Files:**
- Modify: `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`
- Create: `native/WebTools.NativeHost/Services/PackagedIconResolver.cs`
- Modify: `native/WebTools.NativeHost/Services/NativeIconCache.cs`
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`

**Interfaces:**
- Packaged catalog entries expose an opaque `appx:<AUMID>` icon reference; the renderer/UI receives only a frozen `BitmapSource`, never a package path.
- `PackagedIconResolver` resolves AUMID package-family identity through Windows package APIs, finds the matching manifest application, chooses a raster logo variant, and returns null on any isolated failure.
- `NativeIconCache.GetAsync` dispatches packaged references to that resolver while retaining the existing file/executable `SHGetFileInfoW` path and LRU capacity.

- [x] Add checks that packaged catalog records have a packaged icon reference, manifest application ID matching is exact, and scale/targetsize/theme asset selection handles unavailable or malformed variants.
- [x] Run checks to confirm the packaged catalog reference and asset-selection assertions fail before implementation.
- [x] Implement package-family lookup with `FindPackagesByPackageFamily` / `GetPackagePathByFullName`; parse package manifests with DTD/entity resolution disabled and bounded input.
- [x] Resolve package-relative assets inside the package root, prefer a suitable target-size/scale and theme variant, load supported raster formats with `BitmapCacheOption.OnLoad`, and freeze the bitmap.
- [x] Keep resolution lazy and cache results through the current bounded icon cache; record packaged lookup outcomes without making failures fatal.
- [x] Add `--packaged-icons` to the Native checks. If no installed packaged entries exist, print `USER MANUAL VERIFICATION` rather than claiming a real package pass.
- [x] Run the focused and full Native checks, including existing Win32 icon/GDI checks.

### Task 4: Load and own the Native tray icon safely

**Files:**
- Modify: `native/WebTools.NativeHost/Services/TrayIconService.cs`
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`

**Interfaces:**
- Resolve `app.ico` relative to `AppContext.BaseDirectory`; use `SystemIcons.Application` only when the branded icon cannot be loaded.
- The service owns and disposes only the `Icon` it creates; hide/dispose `NotifyIcon` and dispose its context menu deterministically.

- [x] Add checks for `app.ico` path discovery independent of current working directory and missing-file fallback.
- [x] Review the tray baseline and confirm it always used `SystemIcons.Application` without looking up the staged `app.ico`.
- [x] Load the branded icon with an owned copy, retain it for the NotifyIcon lifetime, and dispose after hiding/disposal.
- [x] Run full Native checks and build/publish once to verify `app.ico` is next to the executable in the acceptance layout.

### Task 5: Map Electron Launcher UI tokens into WPF

**Files:**
- Modify: `native/WebTools.NativeHost/MainWindow.xaml`
- Modify: `native/WebTools.NativeHost/MainWindow.xaml.cs`
- Create or modify: `native/WebTools.NativeHost/Services/LauncherThemePalette.cs`
- Modify: `docs/native-launcher-phase4d-acceptance-build.md` (Electron → WPF token mapping section)

**Interfaces:**
- WPF palette resources represent Electron dark/light colors; saved `light`/`dark` selection is honored and `system` resolves to Windows app theme and tracks system appearance changes while the host is alive.
- Layout retains the 850px window width, Electron's 128px compact and 466px search-result heights, 76px search bar, 34px result icon, 51px result row, and compact/expanded content flow.

- [x] Record the exact Electron Vue/CSS values for width, shell/panel geometry, padding, radii, typography, row/icon sizes, selected/hover colors, scrollbar, compact/expanded, website/file/translation rows.
- [x] Adjust WPF XAML to place search input, brand control, compact/expanded toggle, result panel and help footer in the Electron hierarchy without changing the WPF framework or adding UI packages.
- [x] Use theme palette resources for panel, input, text, muted text, borders, selection, hover and scrollbar; retain IME and input focus.
- [x] Match WPF shortcut/result/status rendering for website, application, file/folder, web-search and translation rows as far as native controls allow.
- [x] Run `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj` and inspect XAML/resource compilation; GUI visual and theme acceptance remains manual if native desktop interaction is unavailable.

### Task 6: Measure, rebuild and document Phase 4D acceptance

**Files:**
- Modify: `scripts/build-native-phase4d-acceptance.ps1` only for checks required by the corrected layout.
- Modify: `docs/native-launcher-phase4d-acceptance-build.md`

**Interfaces:**
- Build creates a new timestamped release directory, independent of production installer output.
- Acceptance report records exact installer path, implementation/root causes, Electron → WPF token mapping, automated results, measured memory/GUI resources, and manual checklist.

- [x] Run 1,000 search stress iterations and record Private Bytes, Working Set, GDI, USER and thread counts.
- [x] Attempt 300 actual show/hide cycles only if they can be driven through the installed app's real window/hotkey path; otherwise explicitly mark them `USER MANUAL VERIFICATION`.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`, and Native checks.
- [x] Run `scripts/build-native-phase4d-acceptance.ps1` to produce the separate installer and Chinese/space install smoke; do not alter production installer settings.
- [x] Verify that the installer staging layout contains `WebTools.NativeHost.exe`, root `app.ico`, and `Manager\WebTools.exe` plus Electron resources.
- [x] Update the acceptance report with measured before/after data and the outstanding user acceptance checks; do not claim GUI behaviors not actually tested.
- [x] Report final branch/status and installer absolute path. Do not commit, push, merge, delete the Electron Launcher, or enter Phase 4E.
