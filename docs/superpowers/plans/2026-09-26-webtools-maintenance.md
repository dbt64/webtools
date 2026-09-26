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

`WebsiteService.save` validates name, URL, description, favicon and folder IDs; uses a single `DataStore.update`; preserves ID/creation time and an exi