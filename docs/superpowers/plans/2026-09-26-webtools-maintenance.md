# WebTools Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the existing Windows WebTools app by clarifying Electron module ownership, fixing website and search engine persistence flows, cleaning up launcher overflow/shadows, and removing the manager's Ctrl+K focus shortcut.

**Architecture:** Keep `src/features`, `src/shared`, and `electron/services` as the renderer/domain/adapter layers. Reduce `electron/main.ts` to application startup and lifecycle by moving typed IPC registration into focused `electron/ipc` modules; make website saving one validated store update; keep search engine validation and settings persistence behind existing shared helpers and typed IPC.

**Tech Stack:** Electron 44, electron-vite, Vue 3, TypeScript, Node.js filesystem APIs.

**Spec:** `docs/superpowers/specs/2026-09-26-webtools-maintenance-design.md`

## Global Constraints

- Target Windows only.
- Preserve AppData version 2, Electron `appId` `dev.nook.launcher`, and the existing `%APPDATA%\\Nook` user-data path.
- Keep `src/shared/ipc.ts` as the renderer-facing typed contract and `electron/preload.ts` as the only renderer bridge.
- Do not add dependencies or change features outside the approved maintenance scope.
- Do not add or run automated tests; verify with `npm run typecheck`, `npm run build`, and the manual checks below.
- Do not silently install or replace the user's installed app.

## Review Focus

- Website saves with no folder, several folders, fetched favicon, and edit of existing entry must update one website without losing its ID, creation time, or unselected metadata (Task 2 manual checks).
- A data-store write failure must remain distinguishable from validation, metadata-fetch, and post-save list-refresh failures; the renderer must not falsely report that a successful save failed (Tasks 2–3 manual checks).
- Selecting every enabled built-in engine, saving a custom engine with one `%s`, disabling/deleting the current default, and a failed write must preserve the correct default or show a useful error (Task 3 manual checks).
- The launcher's compact 850×88 state must not show a document scrollbar, and its expanded result area must stay within the window without hiding keyboard focus (Task 4 manual checks).
- Manager input must no longer intercept Ctrl/Cmd+K, while the configured global launcher shortcut still opens the launcher (Task 4 manual checks).

## File Map

- `electron/main.ts`: construct services and windows, then register feature handlers; retain app, tray, hotkey, and shutdown lifecycle.
- `electron/ipc/window-handlers.ts`: expose show/hide/resize window IPC through injected callbacks.
- `electron/ipc/app-handlers.ts`: expose app list, refresh, and launch operations.
- `electron/ipc/website-handlers.ts`: validate website IPC payload shapes and register website/folder/metadata handlers.
- `electron/ipc/settings-handlers.ts`: register settings read/update and web-search opening, with injected hotkey and login-start callbacks.
- `electron/ipc/translation-handlers.ts`: register AI and Google Translate operations.
- `electron/ipc/everything-handlers.ts`: register Everything detect/path/search/open operations.
- `electron/services/website-service.ts`: validate complete website mutations and persist website fields plus folder membership atomically.
- `src/shared/domain.ts`: define the renderer/main `WebsiteSaveInput` contract with optional ID, description and favicon, and required name, URL and folder IDs.
- `src/shared/ipc.ts`, `electron/preload.ts`: retain one typed `saveWebsite` call and existing narrow bridge.
- `src/features/entries/EntryEditor.vue`, `EntriesView.vue`: submit the complete mutation once and separate write failure from list-refresh failure.
- `src/features/settings/SearchEngineEditor.vue`, `SettingsView.vue`: serialize settings writes, reflect only returned state, and display validation versus persistence errors.
- `src/shared/search-providers.ts`: retain the single `%s` HTTP(S) template validation and encoded query expansion.
- `src/App.vue`, `src/features/search/SearchView.vue`: remove manager Ctrl/Cmd+K handling and its visual hint.
- `src/styles/tokens.css`: scope sizing and overflow to launcher mode, remove launcher bar/results shadows, and retain focus styling.

## Interfaces and Contracts

```ts
export interface WebsiteSaveInput {
  id?: string
  name: string
  url: string
  description?: string
  favicon?: string
  folderIds: string[]
}

// DesktopApi
saveWebsite(input: WebsiteSaveInput): Promise<IpcResult<WebsiteEntry>>

// WebsiteService
save(input: WebsiteSaveInput): Promise<IpcResult<WebsiteEntry>>
```

`WebsiteService.save` validates name, URL, description, favicon and folder IDs; uses a single `DataStore.update`; preserves ID/creation time and an existing favicon when the corresponding input field is omitted; returns the persisted website. IPC modules receive only the services and callbacks their registrations need.

## Tasks

### Task 1: Extract Feature IPC Registration

**Files:**
- Create: `electron/ipc/window-handlers.ts`
- Create: `electron/ipc/app-handlers.ts`
- Create: `electron/ipc/website-handlers.ts`
- Create: `electron/ipc/settings-handlers.ts`
- Create: `electron/ipc/translation-handlers.ts`
- Create: `electron/ipc/everything-handlers.ts`
- Modify: `electron/main.ts`

**Interfaces:** Each `register*IpcHandlers(dependencies)` accepts only the service instances and callbacks used by that module. `electron/main.ts` is the composition root and calls the registration functions after data and services are initialized. Preserve existing IPC channel names and payload/result shapes in this task.

- [ ] **Step 1: Add window and app handler registrars.** Move the current window actions into `registerWindowIpcHandlers({ showLauncher, hideLauncher, setLauncherExpanded, showManager })`; move app list/refresh/launch into `registerAppIpcHandlers({ appCatalog, appLauncher })`.
- [ ] **Step 2: Add website and settings handler registrars.** Move the current website/folder/metadata channels to `registerWebsiteIpcHandlers({ websiteService, websiteMetadata })`; move settings read/update and web-search open to `registerSettingsIpcHandlers({ dataStore, hotkeyService, setOpenAtLogin, openExternal })`.
- [ ] **Step 3: Add translation and Everything handler registrars.** Move existing translation/secret handlers to `registerTranslationIpcHandlers({ aiTranslationService, secretStore, openExternal })`; move Everything channels to `registerEverythingIpcHandlers({ everything, dataStore, chooseEverythingPath })`.
- [ ] **Step 4: Reduce `electron/main.ts` to composition and lifecycle.** Delete the moved `ipcMain.handle` blocks and register each domain module after its dependencies exist. Keep current IPC names, validation, hotkey behavior, and dialogs unchanged.
- [ ] **Step 5: Verify the extraction.** Run `npm run typecheck` and `npm run build`; inspect `electron/main.ts` to confirm there are no feature `ipcMain.handle` registrations left outside lifecycle/version handlers.
- [ ] **Step 6: Commit.** Commit `refactor: separate Electron IPC handlers by feature`.

### Task 2: Make Website Saving Atomic and Diagnosable

**Files:**
- Modify: `src/shared/domain.ts` or `src/shared/ipc.ts`
- Modify: `src/shared/ipc.ts`, `electron/preload.ts`, `src/types/electron.d.ts`
- Modify: `electron/services/website-service.ts`
- Modify: `electron/ipc/website-handlers.ts`
- Modify: `src/features/entries/EntryEditor.vue`, `src/features/entries/EntriesView.vue`

**Interfaces:** Use `WebsiteSaveInput` above. `WebsiteService.save` stores URL/name/description/favicon/folder IDs in a single update. `DesktopApi.saveWebsite` returns the resulting saved `WebsiteEntry` or a typed failure.

- [ ] **Step 1: Define the full save input.** Add `WebsiteSaveInput` to `src/shared/domain.ts` and change `DesktopApi.saveWebsite` and its preload implementation to accept it. Keep AppData schema unchanged.
- [ ] **Step 2: Validate and persist in `WebsiteService.save`.** Validate all fields and folder IDs against the current update state; preserve the existing website ID and `createdAt` on edit; retain the old favicon if input omits it; persist the website and the submitted folder IDs in one `DataStore.update`.
- [ ] **Step 3: Update the website IPC handler.** Validate the unknown payload's field types and call `websiteService.save(input)` without discarding favicon or folder IDs. Return stable `IpcResult` error codes and log unexpected persistence causes with `[website:save]` context; do not send paths or stack traces to the renderer. Remove the now-unused `websites:cache-metadata` channel from `src/shared/ipc.ts`, preload and website handler registration after confirming no remaining callers.
- [ ] **Step 4: Submit once from the website manager.** Keep `EntryEditor`'s URL, name, description, favicon and folder selections in the emitted value. In `EntriesView.save`, call `saveWebsite` once; remove follow-up `cacheWebsiteMetadata` and `addWebsiteToFolders` writes.
- [ ] **Step 5: Separate save and refresh feedback.** Close the editor only after a successful save. Refresh the list afterward; if refresh fails, report that the website was saved but the list needs refreshing instead of showing a save failure. Surface typed validation/persistence messages unchanged.
- [ ] **Step 6: Verify website cases.** Run `npm run typecheck` and `npm run build`. Manually create a URL with no folder, with multiple folders and with a fetched favicon; edit it and confirm ID, creation time, favicon and folder selection persist after reload. Cause an invalid URL and confirm it is reported as validation failure.
- [ ] **Step 7: Commit.** Commit `fix: save website details in one transaction`.

### Task 3: Stabilize Search Engine Settings and Routing

**Files:**
- Modify: `src/features/settings/SearchEngineEditor.vue`, `src/features/settings/SettingsView.vue`
- Modify: `electron/ipc/settings-handlers.ts`

**Interfaces:** Keep `DesktopApi.updateSettings(Partial<AppSettings>): Promise<IpcResult<AppSettings>>`, `normalizeSearchEngines(value): SearchEngine[]`, `buildSearchUrl(engine, query): URL`, and `search:open-web` unchanged unless diagnosis identifies a concrete contract defect.

- [ ] **Step 1: Make engine editor persistence resilient.** Wrap `SearchEngineEditor.persist` in `try/catch/finally`; always clear `saving`; display typed `IpcResult` failures or a concise IPC failure message; keep the last returned engine list/default on failure.
- [ ] **Step 2: Serialize engine edits.** Disable default, visibility, ordering, edit and delete controls while `saving` is true. After a successful write, use the returned `AppSettings`; preserve the current list and selected default on failure.
- [ ] **Step 3: Isolate the Windows login-start side effect.** In `settings:update`, call the injected `setOpenAtLogin` callback only when `launchOnStartup` changes. Apply the OS setting before persisting that change; if persistence then fails, restore the previous OS setting. Convert callback failures to a typed settings error. Engine and layout saves must not invoke login-start integration.
- [ ] **Step 4: Keep engine validation and routing within their existing contract.** Preserve `normalizeSearchEngines` and `buildSearchUrl`: templates use exactly one `%s`, accept only HTTP(S), and encode the query as one component. Preserve `?query` resolution through the persisted enabled default engine. No new discovery or test-search control.
- [ ] **Step 5: Verify engine behavior.** Run `npm run typecheck` and `npm run build`. Manually select Google, Baidu and Bilibili; add a custom `%s` engine, make it default, reload settings, and submit `?中文 query&x`; confirm encoded query routing. Disable/delete a selected engine and confirm a valid default remains. Confirm IPC/write errors leave the old visible settings and saving state resets.
- [ ] **Step 6: Commit.** Commit `fix: persist selected web search engine`.

### Task 4: Remove Launcher Overflow, Shadows and Ctrl+K

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/App.vue`
- Modify: `src/features/search/SearchView.vue`

**Interfaces:** No IPC or data changes. Keep the configurable global launcher shortcut (default `Control+Alt+Space`) unchanged.

- [ ] **Step 1: Scope document sizing to launcher mode.** Override launcher-mode body minimum dimensions and document overflow so the compact 850×88 window cannot produce an outer scrollbar. Constrain expanded results to the available window height and keep result rows keyboard-scrollable within the popup.
- [ ] **Step 2: Remove launcher shadows.** Remove the outer `box-shadow` from `.launcher-bar` and `.launcher-results`; retain the existing border and selected/focus-visible treatments.
- [ ] **Step 3: Remove manager Ctrl/Cmd+K handling.** Delete `handleGlobalKeydown` and its `window` listener registration in `src/App.vue`, retain `focusSearch` for the existing fallback button, and remove the Ctrl/K hint from `SearchView.vue`.
- [ ] **Step 4: Verify the UI behavior.** Run `npm run typecheck` and `npm run build`. Manually inspect the collapsed and expanded launcher at 850×88 and expanded height, verify no document scrollbar or outer shadow, confirm search focus and arrow/Enter/Escape behavior, and confirm Ctrl/Cmd+K no longer changes manager sections while the global launcher hotkey still works.
- [ ] **Step 5: Commit.** Commit `fix: clean up launcher chrome and remove Ctrl K`.

### Task 5: Final Integration Review

**Files:**
- Modify documentation only if the implemented behavior or instructions change.

- [ ] **Step 1: Review module ownership.** Confirm all feature IPC registration is in `electron/ipc`, `main.ts` owns composition/lifecycle, preload remains narrow, and no channel names changed accidentally.
- [ ] **Step 2: Run final verification.** Run `npm run typecheck` and `npm run build`. Manually repeat the Task 2–4 scenarios in one app session, including restart persistence for a website and selected custom search engine.
- [ ] **Step 3: Review the diff.** Run `git diff --check`; inspect changed files for accidental AppData schema, appId, user-data path, dependency, translation or Everything changes.
- [ ] **Step 4: Commit final integration notes.** Commit any necessary documentation update as `docs: document WebTools maintenance fixes` and report checks plus any remaining environment-specific limitations.

## Plan Self-Review

- **Spec coverage:** IPC module layout (Task 1); atomic website mutation and stage-aware errors (Task 2); custom/default engine persistence and `?` routing (Task 3); launcher sizing/shadows and Ctrl/Cmd+K removal (Task 4); final integrated checks and scope preservation (Task 5).
- **Failure coverage:** invalid URL/name/folder/favicon input, IPC rejection, persistence error, metadata fetch failure and post-save refresh failure are all mapped to explicit behavior in Task 2. Invalid engine templates, persistence failure, stale parallel editor writes, disabled/deleted default and encoded search queries are mapped to Task 3.
- **Type consistency:** `WebsiteSaveInput` is introduced in Task 2 and used identically by `DesktopApi`, preload and `WebsiteService`; Task 1 introduces the IPC module seams consumed by Tasks 2–3.
- **Scope:** no schema migration, new engine discovery, test-search feature, dependencies, automated tests, or silent installation.
