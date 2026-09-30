# Unified Websites Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate website and folder management into one `网址` Manager page with persistent per-folder ordering, website CRUD, folder CRUD, drag reordering, and drag-to-classify.

**Architecture:** Reuse the current compact Favorites Vue page as the only website workspace and move the existing Entries CRUD behavior into it. Persist Manager-only collection order in `AppData` without changing `WebsiteEntry` or the schema version; expose it through narrow typed IPC. Keep the NativeHost search projection based on website content and membership only.

**Tech Stack:** Vue 3, TypeScript, Electron IPC/preload, existing `DataStore`, Node built-in test runner, CSS Grid, HTML5 drag-and-drop.

**Spec:** `docs/superpowers/specs/2026-09-30-websites-manager-and-update-install-design.md`

## Global Constraints

- Preserve the `WebsiteEntry` shape and `AppData.version: 2`.
- Add no runtime dependency.
- Keep website order Manager-only; do not include display ordering in the NativeHost website projection.
- Keep Native Launcher UI, search, hotkey, tray, show/hide, focus, and drag behavior unchanged.
- Keep the search box and its `?`, `/`, and `file:` modes unchanged.
- Preserve website URLs, names, memberships, settings, and existing Native search behavior.
- Do not commit, push, create a PR, or release as part of this implementation.

## Review Focus

- A version-2 profile with no or malformed ordering metadata must retain all websites and deterministically recover order from `webEntries`.
- A site shared by multiple folders must be reorderable independently in each folder.
- A deleted or stale folder membership must leave its site visible under `未分类` without deleting the site.
- A failed or invalid drop must preserve the last persisted collection order and membership and show a recoverable error.
- Reordering Manager display order must not alter NativeHost website search results or launch targets.

---

### Task 1: Add backward-compatible collection-order model

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `electron/services/data-store.ts`
- Create: `electron/services/website-order.ts`
- Create: `electron/services/website-order.test.mjs`

**Interfaces:**
- Produces `WebsiteCollection = { kind: 'unclassified' } | { kind: 'folder'; folderId: string }`.
- Produces `WebsiteOrderByCollection = { unclassified: string[]; folders: Record<string, string[]> }`.
- Produces `normalizeWebsiteOrderByCollection(input: unknown, websites: WebsiteEntry[], folders: BookmarkFolder[]): WebsiteOrderByCollection`.
- `AppData.websiteOrderByCollection` is required in normalized in-memory data and initialized by `createDefaultAppData()`.

- [x] **Step 1: Add failing normalization tests**

  In `electron/services/website-order.test.mjs`, cover a missing value, a malformed value, duplicate/unknown website IDs, deleted folder keys, stale memberships, and a site shared by two folders. Assert that valid saved order is retained and missing current members are appended in `webEntries` order.

- [x] **Step 2: Run the focused test and confirm it fails**

  Run: `node --experimental-strip-types --test electron/services/website-order.test.mjs`

  Expected: FAIL because the normalizer and collection-order type do not exist.

- [x] **Step 3: Add and normalize the Manager-only order field**

  Add `WebsiteCollection` and `WebsiteOrderByCollection` to `src/shared/domain.ts`. Add the default `{ unclassified: [], folders: {} }`. Implement normalization in `electron/services/website-order.ts`: retain only unique IDs that actually belong to each collection, drop unknown folder keys/IDs, then append missing members using current `webEntries` order. Treat absent or malformed optional JSON metadata as a recoverable value; do not reject an otherwise valid version-2 profile.

- [x] **Step 4: Normalize all loaded version-2 profiles**

  Update `LegacyV2AppData` and `normalizeV2()` in `electron/services/data-store.ts` to call the new normalizer. Keep `validV2()` permissive about the optional ordering field so malformed ordering metadata cannot trigger whole-profile recovery.

- [x] **Step 5: Run tests and typecheck**

  Run: `node --experimental-strip-types --test electron/services/website-order.test.mjs`

  Expected: PASS for legacy, malformed, duplicate, stale, shared-site, and deterministic append cases.

  Run: `npm run typecheck`

  Expected: PASS.

---

### Task 2: Persist order through website/folder services and typed IPC

**Files:**
- Modify: `electron/services/website-order.ts`
- Modify: `electron/services/website-service.ts`
- Modify: `electron/services/bookmark-service.ts`
- Modify: `electron/ipc/website-handlers.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `electron/preload.ts`
- Create: `electron/services/website-service.test.mjs`

**Interfaces:**
- `WebsiteService.getOrderByCollection(): WebsiteOrderByCollection` returns a sanitized snapshot.
- `WebsiteService.reorder(collection: WebsiteCollection, orderedIds: string[]): Promise<IpcResult<WebsiteOrderByCollection>>` accepts exactly the current unique IDs for that collection.
- `DesktopApi.getWebsiteOrder(): Promise<WebsiteOrderByCollection>`.
- `DesktopApi.reorderWebsites(collection: WebsiteCollection, orderedIds: string[]): Promise<IpcResult<WebsiteOrderByCollection>>`.
- IPC channels are `websites:get-order` and `websites:reorder`.

- [x] **Step 1: Add failing service tests**

  In `electron/services/website-service.test.mjs`, use a temporary `DataStore` file and cover: exact-set reorder validation; separate ordering for a website shared across folders; website create/edit/delete order maintenance; folder create/delete order maintenance; folder deletion retaining websites; and reorder leaving `webEntries` unchanged.

- [x] **Step 2: Run the focused test and confirm it fails**

  Run: `node --experimental-strip-types --test electron/services/website-service.test.mjs`

  Expected: FAIL because collection order is not exposed or maintained.

- [x] **Step 3: Implement collection reconciliation helpers**

  In `electron/services/website-order.ts`, add focused helpers that remove a website ID from deleted collections and append it to newly joined collections. Preserve an existing collection position when its membership did not change. When a folder is deleted, remove its order entry and let newly unclassified sites append in existing `webEntries` order.

- [x] **Step 4: Keep every website mutation consistent with order**

  In `WebsiteService`, update `save()`, `delete()`, and `addWebsiteToFolders()` so create, membership changes, and deletion update `websiteOrderByCollection` in the same `DataStore.update()` as the website mutation. Add `getOrderByCollection()` and `reorder()`. Reject missing folders, duplicate IDs, omitted IDs, foreign IDs, and IDs that do not exactly match the live collection; on rejection, persist nothing.

- [x] **Step 5: Keep folder mutations consistent with order**

  In `BookmarkService.saveFolder()`, create an empty order list only for a new folder. In `deleteFolder()`, remove the folder's order list and folder membership in the same update while retaining the websites.

- [x] **Step 6: Expose only the two narrow operations over IPC**

  Add typed `DesktopApi` signatures and channel constants in `src/shared/ipc.ts`, validate untrusted collection/ID payloads in `electron/ipc/website-handlers.ts`, and wire the two calls in `electron/preload.ts`. Do not expose `DataStore`, filesystem paths, or generic mutation callbacks.

  Reordering is Manager presentation state only: do not call `onWebsitesChanged()` for `websites:reorder`. Keep existing website content/membership synchronization after save/delete/membership changes.

- [x] **Step 7: Run tests and typecheck**

  Run: `node --experimental-strip-types --test electron/services/website-order.test.mjs electron/services/website-service.test.mjs`

  Expected: PASS; invalid reorder leaves both collection order and website membership unchanged.

  Run: `npm run typecheck`

  Expected: PASS.

---

### Task 3: Consolidate the Manager UI and add edit/reorder interactions

**Files:**
- Modify: `src/App.vue`
- Modify: `src/features/favorites/FavoritesView.vue`
- Modify: `src/features/favorites/FolderNameDialog.vue`
- Modify: `src/features/favorites/favorites-model.ts`
- Modify: `src/features/favorites/favorites-model.test.mjs`
- Modify: `src/styles/tokens.css`
- Create: `tests/website-workspace.test.mjs`
- Delete: `src/features/entries/EntriesView.vue` after all of its CRUD behavior has moved
- Preserve: `src/features/entries/EntryEditor.vue`

**Interfaces:**
- `buildFavoriteSections(folders, websites, order)` produces folder sections plus `未分类`, ordered independently by collection. Keep a fallback to input website order for an absent/partial renderer value.
- Drag reordering submits the resulting full ID order through `window.desktop.reorderWebsites(collection, orderedIds)`.
- Dropping an unclassified site onto a named folder submits that website's membership through the existing `window.desktop.addWebsiteToFolders(id, [folderId])`.
- Existing Native intent section `entries` remains accepted and maps to the sole `favorites` Manager page.

- [x] **Step 1: Add failing section ordering tests**

  Extend `favorites-model.test.mjs` to assert independent folder/unclassified order for a shared website, empty folders remain visible, and missing renderer order falls back to website data order.

- [x] **Step 2: Run the focused test and confirm it fails**

  Run: `node --experimental-strip-types --test src/features/favorites/favorites-model.test.mjs`

  Expected: FAIL because section construction does not consume persisted ordering.

- [x] **Step 3: Update route and navigation without changing Native routing contracts**

  In `src/App.vue`, expose one nav item labeled `网址`, render the consolidated `FavoritesView` for that page, and map legacy Native `entries` intents to the same page. Keep ordinary Manager open on this page. Leave Settings and Translation intent handling and acknowledgement intact.

- [x] **Step 4: Move existing Entries CRUD into the consolidated page**

  In `FavoritesView.vue`, retain the current compact collapsible sections and add an `编辑` mode beside `新建收藏夹` and `添加网址`. In edit mode expose website edit/delete and folder rename/delete actions; clicking a website in edit mode must not open it. Reuse `EntryEditor.vue`; extend `FolderNameDialog.vue` with initial name/title/action props for create and rename. Confirm folder deletion and state that websites are retained.

- [x] **Step 5: Implement independent reorder and classify drops**

  Load websites, folders, and `getWebsiteOrder()` together. Render each collection using its own order. Enable HTML drag only in edit mode. A drop on another item in the same collection submits a complete reordered ID list. A drop from `未分类` onto a named folder updates membership and immediately removes the site from `未分类`. Do not support direct named-folder-to-named-folder dragging; retain the existing EntryEditor membership controls. On IPC failure, restore the last persisted view and show an error.

- [x] **Step 6: Add drag/drop and editing state styling**

  Update `tokens.css` only for the website workspace: clear edit-mode affordances, valid folder drop target, dragged item state, and the existing design's focus/hover treatment. Do not change Native Launcher XAML or search-box styles.

- [x] **Step 7: Remove the duplicate page and keep regression contracts**

  Remove the unused `EntriesView.vue` import/route and delete the file after confirming no other import remains. In `tests/website-workspace.test.mjs`, assert one `网址` nav entry, default-home behavior, and legacy `entries` intent aliasing. Keep `ManagerPage.Entries`, Native tray commands, search providers, and website projection contracts unchanged.

- [x] **Step 8: Run focused tests and typecheck**

  Run: `node --experimental-strip-types --test src/features/favorites/favorites-model.test.mjs tests/website-workspace.test.mjs`

  Expected: PASS; only one website workspace is reachable, and its test contract does not include Native Launcher search UI.

  Run: `npm run typecheck`

  Expected: PASS.

---

### Task 4: Full regression and Windows acceptance

**Files:**
- No additional product files unless a preceding task's failing verification requires a scoped correction.
- Verify: `src/App.vue`, website order/service/IPC files, `src/features/favorites/**`, `src/styles/tokens.css`, `native/WebTools.NativeHost/**` search behavior.

- [x] **Step 1: Run the full automated suite**

  Run: `npm test`

  Expected: PASS, including existing Native-first architecture and launcher parity checks.

- [x] **Step 2: Run the production renderer build and diff checks**

  Run: `npm run build`

  Expected: PASS.

  Run: `git diff --check`

  Expected: no whitespace errors.

- [x] **Step 3: Run NativeHost search checks**

  Run: `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release`

  Expected: PASS; existing app, Chinese, pinyin, initials, website, `?`, `/`, and `file:` checks remain unchanged.

- [ ] **Step 4: Run the Manager UI through the existing development command** — startup smoke passed on temporary port 5300 (default 5173 is OS-excluded); route and UI interaction acceptance remains manual.

  Run: `npm run electron:dev`

  Expected: Manager starts and existing explicit Settings/Translation routes still work. This does not by itself count as Native Launcher GUI acceptance.

- [ ] **Step 5: Complete the Windows website acceptance checklist** — USER MANUAL VERIFICATION required.

  Verify one `网址` sidebar item; create/rename/delete folders; create/edit/delete websites; create an empty folder and restart; delete a nonempty folder and verify sites are retained; reorder a site independently in two folders; drag an unclassified site into a folder; restart and confirm order/membership persistence; verify responsive layout and focus styles.

- [ ] **Step 6: Complete protected search-box regression checks** — USER MANUAL VERIFICATION required.

  Using the Native Launcher, verify application search, Chinese/pinyin/initial matching, saved website search/launch, `?query`, `/query`, and `file:query`. Confirm website create/edit/delete/membership updates still synchronize searchable website content, while pure order changes do not affect search order or launch behavior.

---

## Task Dependencies

`Task 1 → Task 2 → Task 3 → Task 4`.

Do not start Task 2 before Task 1's focused tests and typecheck pass. Do not start Task 3 before the typed IPC and service behavior pass. Task 4 is the final regression gate.

## Completion Boundary

Stop after implementation, automated verification, and Windows acceptance reporting. Do not commit, push, create a PR, or start a later architecture phase unless requested separately.
