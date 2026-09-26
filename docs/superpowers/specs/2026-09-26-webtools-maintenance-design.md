# WebTools Maintenance and Bug Fix Design

## Goal

Stabilize the current Windows WebTools app before adding more features. Keep the existing user-visible workflows and data format while making website persistence and search engine preferences reliable, removing the launcher overflow/shadows and removing the manager's Ctrl+K focus shortcut. Reshape the main-process code so feature IPC registration is easier to locate and maintain.

## Current Findings

- The renderer already groups manager pages under `src/features`, shared types and search helpers under `src/shared`, and Electron adapters under `electron/services`.
- `electron/main.ts` still owns application lifecycle, dependency construction and IPC handlers for windows, websites, apps, settings, translation and Everything. This makes feature behavior harder to trace.
- `EntriesView.save()` performs website creation/update, optional favicon persistence, folder membership persistence and list refresh as separate asynchronous steps. Its `catch` converts any thrown exception from that full sequence to `保存失败，请重试。`, so the displayed error does not identify which step failed. The visible request does not identify the failing IPC or storage operation; implementation must retain the actual failing stage in its diagnostic path before considering the fault fixed.
- `SearchEngineEditor` saves engine edits, enabled state, ordering and default selection through `settings:update`. The main handler normalizes these values and persists them through the same `DataStore` used by websites. Code inspection alone does not establish which operation fails in the user's running installation.
- The launcher BrowserWindow starts at 850×88, while shared CSS applies `body { min-height: 560px }`, `#app { min-height: 100vh }` and `.launcher-shell { min-height: 100vh }`. The launcher bar and result panel both declare outer shadows.
- `src/App.vue` contains the manager-wide Ctrl/Cmd+K listener; `SearchView.vue` also shows a Ctrl+K hint. The global launcher shortcut remains independently configurable in settings.

## Design

### Main-process module layout

Keep current renderer feature folders, shared domain/search modules, and Electron service adapters. Reduce `electron/main.ts` to startup, dependency wiring, tray/window lifecycle, and shutdown. Move channel registration into focused modules under `electron/ipc/`, grouped by the existing domains: window, app catalog, websites/folders, search settings and web search, translation, and Everything. Each registration function receives only the services and callbacks that it needs. Keep `src/shared/ipc.ts` as the typed renderer-facing contract and `electron/preload.ts` as the only renderer bridge; do not add generic IPC access.

Do not change the on-disk schema, Electron `appId`, or legacy user-data path. The work is a targeted split of existing responsibilities, not a general rewrite of feature components or state management.

### Website save transaction and error reporting

Have the website editor submit one complete website mutation: optional ID, name, URL, description, folder IDs and optional fetched favicon. Validate URL, name, description and folder IDs in the website module. Persist the website and its folder memberships in one `DataStore.update`, preserving the existing ID, creation time and favicon when editing fields are omitted. Cache remote metadata remains best-effort before submission and cannot prevent a manually entered website from saving.

Return a typed `IpcResult<WebsiteEntry>` from the single save operation. On failure, preserve the returned stage/code in the UI; log unexpected main-process exceptions with operation context, without exposing local file paths or stack traces in renderer messages. Refresh the website list only after a successful save. Keep folder create/rename/delete behavior on its existing typed operations.

### Search engine setting and query flow

Keep custom engines as HTTP(S) URL templates containing exactly one `%s`. Preserve built-in and custom engine validation in `src/shared/search-providers.ts`. Make the UI's default, enabled, ordering, add, edit and delete actions consistently round-trip through the typed settings operation and reflect the returned setting only after persistence succeeds. Keep `?query` routed through the selected enabled default engine and existing external URL opener. If the default is disabled or removed, select the first enabled engine through the same persisted update path and show a clear failure if persistence fails.

Because website and search-engine changes share `DataStore`, diagnose the actual failing step before attributing either symptom to the storage layer. Do not add an engine-discovery or test-search feature; this work repairs the existing manual template flow.

### Launcher presentation and focus shortcut

Scope the launcher's document sizing to launcher mode so its 88px compact window does not inherit the manager's 560px minimum body height.