# Search Engine Picker, Themes, and Launcher Display Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-field search-engine picker, persisted light/dark/system appearance, a cool blue dark palette, and a persisted compact/expanded launcher default.

**Architecture:** Extend the existing `AppSettings` and `DataStore` format with backward-compatible defaults, then keep `updateSettings` as the persistence boundary. The main quick-search view selects enabled engines and navigates to the existing editor; shared theme code applies tokens independently in manager and launcher renderers; the main process hands the saved launcher mode to the launcher before it is shown.

**Tech Stack:** Vue 3, TypeScript, Electron IPC, CSS custom properties, renderer `matchMedia` for live system appearance updates.

**Spec:** [../specs/2026-09-26-search-engine-theme-launcher-mode-design.md](../specs/2026-09-26-search-engine-theme-launcher-mode-design.md)

## Global Constraints

- Existing data without `theme` or `launcherDisplayMode` resolves to `dark` and `compact`.
- Theme choices are `light`, `dark`, or `system`; launcher choices are `compact` or `expanded`.
- The search picker lists only enabled engines and preserves their configured order.
- Local engine marks are used; do not fetch remote logos.
- The plus action opens Settings; existing Settings remains the only search-engine editor.
- Expanded launcher mode shows the existing Favorites and Apps modules, with each module initially at its one-row state.
- Do not change existing `?query` search behavior, hotkey toggle, Escape, blur-hide, or drag behavior.
- Do not add dependencies or a separate persistence mechanism.

## Review Focus

- Existing v2 settings files lack the new keys: loading must normalize them rather than report corruption (Task 1).
- The selected engine is disabled or removed: the picker must not offer disabled engines and IPC must keep a valid enabled default (Tasks 2–3).
- Saving a picker or appearance choice fails: displayed selection/theme must remain consistent with the last persisted value (Tasks 3 and 5).
- The OS appearance changes while `system` is active, versus while explicit `light` or `dark` is active (Task 4).
- The launcher is manually collapsed during a session, hidden, then invoked again: the saved initial mode must apply on the next show without forcing module row expansion (Task 6).

---

### Task 1: Add Backward-Compatible Settings Fields

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `electron/services/data-store.ts`

**Interfaces:**
- Produce `ThemePreference = 'light' | 'dark' | 'system'` and `LauncherDisplayMode = 'compact' | 'expanded'` exported from `src/shared/domain.ts`.
- Add `theme: ThemePreference` and `launcherDisplayMode: LauncherDisplayMode` to `AppSettings`.
- Set defaults to `dark` and `compact` in `DEFAULT_APP_DATA`.
- Keep persisted `AppData.version` at `2`; normalize v2 records missing either new key rather than treating them as corrupt.
- Define an internal `LegacyV2AppData` shape whose `settings` requires all existing v2 fields and makes only the two new fields optional; `validV2` must narrow to this shape, not to `AppData`.

- [ ] **Step 1: Define the preference types and defaults**

Add the two exported string-union types, reference them from `AppSettings`, and set their defaults. Confirm `createDefaultAppData()` returns independent defaults as before.

- [ ] **Step 2: Normalize legacy v2 records**

Update `validV2` to accept each new field when absent or valid and narrow to `LegacyV2AppData`. Add `normalizeV2(input: LegacyV2AppData): AppData` to copy the record and fill absent fields with `dark` and `compact`. During `DataStore.load()`, assign `normalizeV2(parsed)` for valid v2 input; preserve all existing entries and settings.

- [ ] **Step 3: Verify schema compatibility**

Run `npm run typecheck`.

Expected: both TypeScript projects pass; existing v2 data remains accepted by the loader and defaults are typed throughout the app.

---

### Task 2: Validate and Persist New Preferences

**Files:**
- Modify: `electron/ipc/settings-handlers.ts`

**Interfaces:**
- Consume `AppSettings.theme` and `AppSettings.launcherDisplayMode` from Task 1.
- Keep `DesktopApi.updateSettings(settings: Partial<AppSettings>)` unchanged.

- [ ] **Step 1: Validate enum values at the IPC boundary**

Reject provided `theme` values outside `light | dark | system` and `launcherDisplayMode` values outside `compact | expanded` with the existing `INVALID_SETTINGS` error result.

- [ ] **Step 2: Persist values while preserving omitted settings**

In the `dataStore.update` merge, write each supplied valid preference; when omitted, preserve the corresponding value from `data.settings`.

- [ ] **Step 3: Verify settings IPC types**

Run `npm run typecheck`.

Expected: IPC handlers compile with the existing update settings contract; all unrelated setting updates preserve the two new fields.

---

### Task 3: Add the Main Search-Field Engine Picker

**Files:**
- Modify: `src/features/search/SearchView.vue`
- Modify: `src/App.vue`
- Reuse: `src/features/settings/SearchEngineEditor.vue` remains unchanged as the editor.

**Interfaces:**
- Consume `AppSettings.searchEngines` and `defaultSearchEngineId`.
- Keep `SearchView` navigation typed as `navigate: [section: 'entries' | 'translate' | 'settings']` and route `settings` through `App.vue`'s existing `Section` type.

- [ ] **Step 1: Render a selected-engine mark in the search input**

Replace the main quick-search magnifier with a button. Show the known local marks for Google (`G`), Baidu (`百`), and Bilibili (`B`); use the first grapheme of a custom engine name. Include a disclosure indicator and an accessible label containing the selected engine name.

- [ ] **Step 2: Add the enabled-engine picker menu**

Render enabled engines in configured order in a `role="listbox"`, with each engine as an option and the current engine marked `aria-selected`. Opening focuses the current option; Up/Down moves through options; Enter/Space selects; Escape closes and restores focus to the trigger; outside click closes. Selecting an engine calls `window.desktop.updateSettings({ defaultSearchEngineId: engine.id })`; update local settings and close only on success. Show an inline `role="alert"` error and retain the previous display on failure.

- [ ] **Step 3: Route the plus action to Settings**

Add a plus action at the bottom of the picker. Emit `navigate('settings')` and close the picker; do not open or duplicate the custom engine editor.

- [ ] **Step 4: Verify menu and navigation behavior**

Run `npm run typecheck`, then verify in `npm run electron:dev`: disabled engines do not appear, choosing an engine persists after revisiting the page, and plus opens Settings.

Expected: the normal `?query` path uses the selected engine with existing query parsing and search IPC unchanged.

---

### Task 4: Apply Shared Theme Tokens in Both Renderers

**Files:**
- Create: `src/shared/theme.ts`
- Modify: `src/main.ts`
- Modify: `src/launcher.ts`
- Modify: `src/styles/tokens.css`

**Interfaces:**
- Export `applyTheme(theme: ThemePreference): void` from `src/shared/theme.ts`. It sets the root `data-theme` to the resolved `light` or `dark` value and replaces any previous system listener for `matchMedia('(prefers-color-scheme: dark)')`.
- Manager and launcher renderer entry points both load `window.desktop.getSettings()` and apply the preference before presenting themed content.

- [ ] **Step 1: Implement the renderer theme controller**

Implement `applyTheme` to resolve explicit preferences immediately and track OS appearance only for `system`. Keep the active `MediaQueryList` listener in module state, remove it before each reapply, and listen to changes without polling.

- [ ] **Step 2: Add the light and cool-blue dark token sets**

Define theme-specific CSS variables for page canvas, sidebar, surfaces, raised surfaces, border, text, muted text, and accent. Replace component-specific hard-coded dark/green colors in `tokens.css` with the shared tokens where needed for a coherent light theme and blue-tinted dark theme. Set the root `color-scheme` to match the resolved theme.

- [ ] **Step 3: Apply theme at renderer startup**

Apply the saved theme before mounting manager and launcher views. Reapply when Settings successfully saves a new theme; the launcher reads again whenever it is shown so changes made in the manager are reflected on its next invocation.

- [ ] **Step 4: Verify theme behavior**

Run `npm run typecheck` and `npm run build`. Launch `npm run electron:dev` and verify all three modes in manager and launcher. Change the OS appearance while `system` is selected; verify explicit light/dark stay fixed.

Expected: no flash of the previous theme on initial render, all text and controls remain legible, and both windows use the same palette.

---

### Task 5: Add Theme and Launcher-Mode Controls to Settings

**Files:**
- Modify: `src/features/settings/SettingsView.vue`

**Interfaces:**
- Consume and save `AppSettings.theme` and `AppSettings.launcherDisplayMode` through the existing `window.desktop.updateSettings` method.
- Call `applyTheme` from Task 4 after a successful theme save.

- [ ] **Step 1: Add three theme choices**

Add a Settings group with Light, Dark, and Follow system choices. Save the selected value, use the returned `AppSettings`, and keep the previous selection if saving fails.

- [ ] **Step 2: Add compact/expanded launcher choices**

Add a two-choice Settings control with descriptions: compact opens with only the search field and overall expand control; expanded opens with the Favorites and Apps modules. Save with the same IPC and preserve the old value on error.

- [ ] **Step 3: Verify persistence and error behavior**

Run `npm run typecheck`; in `npm run electron:dev`, change both preferences, navigate away and back, and confirm values remain selected. Verify a rejected update shows the existing inline error and does not leave an unsaved choice displayed.

---

### Task 6: Apply the Saved Launcher Mode Before Show

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/features/search/LauncherView.vue`
- Reuse: existing `window:show-launcher`, `webtools-launcher-show`, `window:set-launcher-expanded` IPC.

**Interfaces:**
- Main process show notification carries `{ launcherDisplayMode: LauncherDisplayMode }`.
- Launcher renderer handles `CustomEvent<{ launcherDisplayMode: LauncherDisplayMode }>`; compact sets the overall section state false, expanded sets it true. Per-section flags remain false on every show.

- [ ] **Step 1: Size and notify from the persisted preference**

In `showLauncher()`, read `dataStore.snapshot().settings.launcherDisplayMode`, resize for compact or expanded before showing, and include the selected mode in the existing show event whether the renderer is still loading or already loaded.

- [ ] **Step 2: Initialize renderer content before syncing size**

Update `handleLauncherShow` to consume the event detail, reset query and per-section expansion as today, set the overall expanded state from the preference, apply theme from current settings, and call `syncWindowSize()` after state is updated.

- [ ] **Step 3: Verify launcher show/hide cycles**

Run `npm run typecheck` and `npm run build`; launch `npm run electron:dev`. Verify both saved launch modes on first show and after hotkey re-invocation, verify manual collapse does not rewrite the preference, and confirm each module still begins with one row and has independent expansion.

Expected: the preferred layout is visible on first paint without a compact-to-expanded resize flash; hotkey toggle, Escape, blur-hide, and drag still work.

---

### Task 7: End-to-End Review

**Files:**
- Review all files modified in Tasks 1–6.

- [ ] **Step 1: Run final static checks**

Run `npm run typecheck`, `npm run build`, and `git diff --check`.

Expected: all commands exit successfully.

- [ ] **Step 2: Exercise the acceptance checklist in Electron**

Run `npm run electron:dev`. Check engine selection and plus navigation, all three themes in both renderers, live OS appearance tracking, both launcher modes, data persistence after restart, and existing `?query` web search.

- [ ] **Step 3: Inspect the final diff**

Review `git diff` to confirm only search picker, theme preferences/palette, launcher-mode preference, and their data compatibility are included. Keep the work on the current `codex/*` branch; do not push or merge unless separately requested.
