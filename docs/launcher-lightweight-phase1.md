# Launcher Lightweight Optimization — Phase 1

## Scope

This phase reduces repeated Launcher data transfer and resident website icon data. It keeps the Launcher `BrowserWindow`, show/hide and focus behavior, search behavior, persistent website schema, app-icon lazy loading, and Translation 2.0 unchanged. No dependency was added.

## Before: observed data flow

The code was rechecked before editing. `LauncherView.vue` called `load()` on mount and on every `webtools-launcher-show` event. Each call invoked `getApps()` and `listWebsites()` together, then replaced both arrays. `WebsiteService.list()` returned complete `WebsiteEntry` records from `DataStore.snapshot()`, including `favicon` data URLs and `createdAt`. A single computed index was rebuilt from the combined app and website entries after those replacements.

The app catalog already loaded app icons lazily through `useAppResultIcons`, for the current app results only. That behavior remains intact.

## After: Launcher data flow

```text
AppCatalogService ── refresh ──> LauncherDataService (app version)
                                      │
WebsiteService / DataStore ──────────┤ (website version)
                                      ▼
Launcher IPC: getChanges(known versions)
                                      │ only changed datasets
                                      ▼
preload DesktopApi ──> LauncherView ──> app/site entries
                                      ├─> per-dataset pinyin index cache
                                      └─> search results

Visible website result / shortcut
    └─ IntersectionObserver ──> getWebsiteIcons(visible IDs)
                                  └─> DataStore returns only requested favicon data
```

On first load, the renderer reports `-1` for both versions and receives the app list and lightweight website list. On each later show it sends one version-check request. If both versions are unchanged, the response contains only the two version numbers; the existing arrays and index remain in use. If only one version changes, only that dataset is sent.

Successful app-catalog refreshes increment the app version. Successful website add/edit/delete, website folder assignment, and bookmark-folder deletion increment the website version. The next Launcher show receives the changed data. The Launcher bookmark action also checks the versioned endpoint after a successful folder assignment. Existing Manager `getApps()` and `listWebsites()` APIs remain available and unchanged for Manager pages.

## Payload and favicon lifecycle

`WebsiteSearchEntry` now carries only `id`, `name`, `url`, optional `description`, and `folderIds`. It is a renderer DTO; `WebsiteEntry` persistence and stored favicons are unchanged. The DataStore creates the DTO directly from in-memory records, avoiding a full `structuredClone()` of the settings and favicon payloads for the Launcher list.

Website favicons are fetched only for shortcut tiles or website result rows intersecting their visible scroll areas. Requests are batched, limited to 64 IDs, and restricted to the Launcher main frame. Main returns only requested favicon data; no filesystem path or Node API is exposed. Renderer icon state is keyed by website ID, pruned when an item is no longer visible, and invalidated when the website-data version changes. Late responses from an old website version are ignored. Missing icons continue to use the existing initial-letter fallback.

App icons remain lazy through the existing `useAppResultIcons` implementation. No app catalog-wide icon extraction was added.

### Synthetic serialized website payload comparison

To make the field reduction concrete without reading a user's private bookmark database, a deterministic local fixture was serialized with each synthetic favicon set to a 262,144-character data URL. These are fixture sizes, not measurements of actual user data or IPC runtime traffic.

| Synthetic records | Full `WebsiteEntry` JSON | Lightweight Launcher DTO JSON | Reduction |
| ---: | ---: | ---: | ---: |
| 0 | 2 B | 2 B | 0 B |
| 50 | 13,115,221 B | 4,971 B | 13,110,250 B |
| 200 | 52,461,271 B | 20,271 B | 52,441,000 B |

The unchanged-version show response contains only the version object and does not include either list. App-list bytes and actual user favicon payloads were not instrumented in this run.

## Search-index lifecycle

The combined index is now cached by `LauncherSearchIndexCache`, with separate app and website indexes. An app data change rebuilds only the app pinyin entries; a website search-field change rebuilds only the website pinyin entries. Website folder membership updates still refresh the current website DTO but do not rebuild pinyin data because folder IDs are not searchable fields. Reopening or hiding the Launcher does not replace either dataset, so it does not invalidate the index. Search candidate ranking and the existing Chinese, pinyin, initials, aliases, and raw-text search functions remain unchanged.

## Launcher retained state after this change

- **Must stay resident:** app search entries, lightweight website search entries, the two pinyin indexes, current UI/theme state, and the current visible result state.
- **Loaded on demand:** Website favicons for currently visible rows or shortcut cards; existing app icons remain lazy for current visible app results.
- **Released as the view changes:** Website icon data for IDs that leave visible areas, and old-version icon responses.
- **No longer retained by the Launcher list:** the complete website records, `createdAt`, and the full set of favicon data URLs.

## Files changed

- `electron/services/launcher-data.ts`: version counters, per-dataset response selection, and icon request delegation.
- `electron/ipc/launcher-data-handlers.ts`: Launcher-frame-only version and bounded favicon IPC handlers.
- `electron/services/data-store.ts`, `electron/services/website-service.ts`: lightweight website projection and ID-scoped favicon reads without changing the persistence schema.
- `electron/ipc/app-handlers.ts`, `electron/ipc/website-handlers.ts`, `electron/main.ts`: mark successful dataset changes and register the new service/handlers.
- `src/shared/domain.ts`, `src/shared/ipc.ts`, `electron/preload.ts`: DTO and narrow preload API contracts.
- `src/features/search/LauncherView.vue`, `src/features/search/launcher-results.ts`: version-aware loading, light website state, and visible-only website icons.
- `src/features/search/launcher-search-index-cache.ts`: independent cached app/site pinyin indexes.
- `electron/services/data-store-launcher.test.mjs`, `electron/services/launcher-data.test.mjs`, `src/features/search/launcher-search-index-cache.test.mjs`: focused data, payload, invalidation, and index cache coverage.

No BrowserWindow lifecycle code, app icon loader, Translation 2.0 code, dependency, or website persistence schema was changed.

## Validation

- `npm run typecheck`: passed.
- `npm test`: passed, 96 tests total.
- `npm run build`: passed.
- `git diff --check`: passed after implementation.
- Windows NSIS package: passed; artifact: `release/launcher-lightweight-phase1/WebTools-Setup-0.1.0.exe`.
- The package build reports existing duplicate dependency references from electron-builder; this did not fail packaging and was not changed in this Launcher-only task.

`npm run electron:dev` built the Main, preload, and renderer bundles and invoked Electron, but the runtime output reported access denied while creating the existing `WebTools-Dev` process lock and Chromium cache files, along with Windows credential-store errors. No interactive Launcher session from that invocation was confirmed. The existing installed WebTools processes were left untouched.

## Memory results

The pre-change idle baseline supplied for this project was about 135 MB with Manager closed and Launcher resident. A post-change Windows process-memory measurement was not available in this execution. No MB savings are claimed from the synthetic payload comparison; please compare the packaged version under the same machine, process grouping, and idle/search conditions.

## Manual Windows verification

Use the package above and record total WebTools process-group memory, individual process memory, and elapsed time for each stage:

1. **Baseline:** close Manager, leave Launcher compact, wait 30 seconds, record idle memory.
2. **Repeated show:** show the Launcher, type a query, hide it, repeat 50 times; check responsiveness and whether memory reaches a stable plateau.
3. **Add:** add a website in Manager, close Manager, show Launcher, and search the new name and URL immediately.
4. **Edit:** change a saved website's name, URL, or description, then confirm Launcher search reflects the edit.
5. **Delete:** remove a saved website and confirm it no longer appears in Launcher results or shortcuts.
6. **Refresh apps:** refresh the app catalog in Manager and confirm Launcher can search the updated catalog.
7. **Scale and icons:** compare 0, 50, and 200 websites, including entries with saved icons; verify fallback behavior, compact/expanded shortcut rows, internal scrolling, and memory after collapsing the section.
8. **Search regression:** check Chinese text, pinyin, initials, aliases, app results, `/` website search, and `?` web search.
9. **Window behavior:** check global hotkey, Escape, blur-hide, drag, repeated show/hide, and that Manager website edits synchronize on the next Launcher show.

The repeated keyboard/mouse actions, external app interactions, and actual Windows memory measurements remain user-side runtime checks.
