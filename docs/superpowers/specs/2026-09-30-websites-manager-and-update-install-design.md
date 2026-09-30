# Websites Manager and Update Install Design

## User acceptance correction — 2026-09-30

**Latest user revision:** show **退出后台 / 取消** in the installer. The first action
requests normal shutdown and automatically continues the same update session.
Failure keeps that page open for retry after normal tray exit; updates reuse the
recognized installation directory. Old uninstall must complete before new files
are installed. The manual-only variant below is superseded by this revision.

The installer shutdown design below is superseded: detect the exact previous-install
processes, ask the user to exit through the tray, and offer Retry / Cancel. Retry
rechecks in the same setup session and continues only when all matching processes
have exited. The installer does not automatically close WebTools. The website
workspace design remains unchanged.

## Status

Approved by the user on 2026-09-30. The user added the constraint that the work must not affect the Launcher search box or search behavior.

## Goal

Make the Manager's website area a single, complete workspace. The sidebar should have one `网址` entry, combining the compact folder view with the existing website and folder management actions. Users should be able to reorder saved sites and classify unassigned sites without opening a second page.

Also make an update installer close an already-running WebTools tray host and Manager automatically before replacing installed files. The update must not require the user to find and exit the tray app manually.

## Current Implementation

- `src/App.vue` currently exposes separate `收藏夹` and `网址` navigation entries. `FavoritesView.vue` provides the compact, collapsible folder layout, adding websites and creating folders. `EntriesView.vue` provides website edit/delete, folder rename/delete, and the older layout switch.
- `BookmarkService.deleteFolder()` already deletes a folder while retaining its websites and removing that folder ID from their `folderIds`.
- `WebsiteService.addWebsiteToFolders()` already updates a website's folder membership and the IPC handler publishes the resulting website projection to NativeHost.
- `AppData.webEntries` is an ordered array, but it only provides one global order. A website may belong to multiple folders. `BookmarkFolder` has no per-folder ordering field.
- `scripts/native-production.nsi` invokes the previous install's uninstaller before replacing files, but does not request the running NativeHost or Electron Manager to close first. NativeHost's tray Exit path already calls `ManagerController.ShutdownAsync()` before closing NativeHost. Manager normally exits when its window closes.

## Design

### One Websites workspace

Keep one Manager sidebar navigation entry, labeled `网址`, and remove the separate `网址` route currently used by `EntriesView`. Rename the current Favorites page heading, breadcrumb, and navigation label to `网址`. Move the existing website CRUD and folder management actions into this page so removing the duplicate entry does not remove behavior.

The ordinary `Open WebTools` action and the tray's `Websites` action should both land on this workspace. Existing explicit Settings and Translation requests keep their current routes and handoff behavior. The Native launcher, global search behavior, and website search projection remain unchanged.

In normal mode, website items open their saved URL. An `编辑` control beside the folder and website creation actions toggles edit mode. In edit mode:

- Website items can be dragged to reorder them within their current folder section.
- An unclassified website can be dragged onto a named folder to classify it there. The website is removed from `未分类` and added to that folder.
- Website edit and delete actions are available.
- Folder rename and delete actions are available.
- Clicking an item while editing must not open its URL.

Folder deletion asks for confirmation, removes the folder, and preserves its websites. Sites with no remaining valid folder membership appear in `未分类`; sites assigned to another folder remain there. Dragging a site from one named folder into a different named folder is outside this request; existing multi-folder membership editing remains available through the website editor.

### Per-collection ordering

Persist website order independently for each named folder and for `未分类`. Reordering one collection must not change the order of the same website in another folder.

Add a backward-compatible `websiteOrderByCollection` value to `AppData`, shaped as `{ unclassified: string[], folders: Record<string, string[]> }`. Do not change the `WebsiteEntry` shape or `AppData.version`. Existing version-2 data without an ordering value derives initial order from its current `webEntries` order. On load, discard unknown IDs and duplicates and append collection websites missing from the saved order so data repairs remain deterministic.

Folder creation starts with an empty order list. Folder deletion removes its order list and removes that folder ID from website memberships; newly unclassified sites are appended in their existing data order. Website creation appends it to the selected folder order lists, or to the unclassified list when it has no folder. Editing membership moves the ID between the affected order lists. Add a narrow typed `reorderWebsites` IPC operation that accepts either `{ kind: 'unclassified' }` or `{ kind: 'folder', folderId }` plus that collection's ordered website IDs. The service validates that the supplied IDs are unique and exactly match the current collection before saving. Drag reordering persists only the current collection's ordered IDs. The Native launcher projection continues to use the existing website fields and ignores Manager display ordering.

### Update installation shutdown

Before `RemovePreviousWebTools` runs an old uninstaller or the installer writes over existing files, perform a preflight against the exact previous installation paths discovered from the recognized uninstall entries. The preflight must not target unrelated processes with the same executable name.

Use a small Windows helper invoked by the NSIS installer. For a NativeHost build that supports update preparation, the helper sends one fixed `prepare-update` request over a dedicated named pipe restricted to the current Windows user. NativeHost asks Manager to close through a bounded update-specific shutdown path that does not force-kill Electron. If Manager exits, NativeHost acknowledges the request, then closes its launcher window and tray. The helper waits for that NativeHost process to exit. If Manager does not close before the timeout, NativeHost remains running and returns an error so the installer can abort safely. The pipe accepts no caller-supplied paths or arbitrary commands.

The immediately previous installed build does not yet implement that pipe. For that compatibility case, the helper locates only the exact old Manager and NativeHost executable paths, sends a standard Windows close request to their top-level windows (including hidden NativeHost windows), closes Manager first, and waits before closing NativeHost. It then waits for both processes to exit. If a matching process does not exit or the old install path cannot be resolved safely, the installer stops before uninstalling or replacing files and explains that WebTools could not close; it does not force-kill the process or continue with a partially locked install. A later retry after a manual close remains the recovery path for an unresponsive process.

The updater must not remove user data, change the user-data path, launch an extra tray instance, or alter the installed startup preference. The new app may be launched from the installer finish page using the existing behavior.

## Persistence and Compatibility

- Keep the current `WebsiteEntry` shape and website membership semantics.
- Treat the new collection-order value as optional when loading existing version-2 data and normalize missing or malformed ordering data from the existing website list.
- Do not project Manager-only ordering to NativeHost; Native app/site search and its persistence contract remain unchanged.
- Preserve website add/edit/delete, folder create/rename/delete, and explicit Manager navigation behavior while consolidating the UI.
- Do not add a runtime dependency. The installer helper may use Windows inbox APIs/runtime only.

## Error Handling

- A failed folder, website, order, or membership write leaves the view on the last persisted order and reports the error.
- Dragging a website to an invalid or deleted folder must not silently drop the site; reload or preserve its current membership and show a recoverable error.
- Folder deletion displays the existing consequence that websites are retained.
- If the update helper cannot close a matching process within its timeout, installation aborts before previous uninstall or file replacement and shows a clear retry instruction.
- The helper targets exact executable paths rather than process names alone. Processes from another install directory are never closed by this update.

## Verification

### Website workspace

- Only one Manager navigation item is shown for websites, labeled `网址`.
- Existing website create, edit, and delete behavior remains available.
- Create, rename, delete, and restart with a folder; verify persistence.
- Delete a folder with sites and verify the sites remain, with valid memberships preserved and unassigned sites appearing in `未分类`.
- Edit mode enables drag reorder; normal mode opens websites and does not show edit-only actions.
- Reorder websites in two folders independently, restart Manager, and verify each order persists without affecting the other.
- Drag a site from `未分类` into a folder and verify it is removed from `未分类`, appears in the target folder, persists after restart, and synchronizes to NativeHost search.
- Confirm ordinary Manager open lands on `网址`; explicit Settings, Entries/website action, and Translation handoff still route correctly, with Entries/website action resolving to the same single page.
- Verify responsive grid and keyboard focus styling at narrow, medium, and wide window widths.

### Update installer

- Update while NativeHost is idle in the tray and Manager is closed; installer closes NativeHost and completes without manual tray interaction.
- Update while Manager is open; installer closes Manager first, waits for Electron to exit, closes NativeHost, then updates.
- Update when neither process is running; installation proceeds normally.
- Verify the exact-path window-close compatibility fallback against the currently installed build that predates the update pipe, and verify the named-pipe path on a build that supports it.
- Verify install paths containing spaces and Chinese characters.
- Verify process detection targets only executables under the previous installation directory.
- Simulate an unresponsive process; verify installation aborts before running the old uninstaller or replacing files, with no forced process termination.
- Confirm settings, saved websites, folder memberships, and startup preference remain intact after update.

## Out of Scope

- Native launcher visual redesign, search ranking, hotkey, window lifecycle, or Favorites/Apps launcher content.
- Website data-field changes, new website search behavior, new app features, or new dependencies.
- Dragging a website directly between two named folders, outside the existing editor's membership controls.
- Automatic process termination by force, silently deleting user data, or changing the installation's startup preference.
- Commit, push, PR, release, or entering Phase 4G as part of the implementation task unless requested separately.
