# Windows Launcher Search Discovery and Actions

## Status

Design approved in conversation; this written specification is awaiting user review.

## Goal

Make the Windows launcher more useful as a single entry point for installed and desktop applications, saved websites, and quick translation. Search results should identify applications with their real icons when Windows exposes them, and actions should remain selectable with the launcher's keyboard controls.

## Scope

- Extend the existing Windows application catalog to include desktop shortcuts and explicit entries for File Explorer, Control Panel, and Device Manager.
- Show the associated Windows application icon on matching launcher results when it can be resolved.
- Add `/query` to search the user's saved WebTools websites by name or URL.
- Show a translation action for English words and phrases in normal local search, whether or not an application matches.
- Route that action to the existing translation page with the query prefilled.

Out of scope: changing the saved website schema, changing translation providers or automatically submitting translation requests, replacing the optional Everything file-search feature, changing the manager's separate Quick Search page, adding non-Windows app discovery, or changing launcher hotkey, Escape, blur-hide, or drag behavior.

## Existing Search Flow

The separate launcher loads installed app records and saved websites through the existing preload API. `WindowsAppSource` currently reads Start Menu shortcuts, packaged Start Apps, and Windows App Paths. It does not inspect either Desktop folder. `AppSearchEntry` already has an optional icon field, but `LauncherView` currently renders the generic Command icon for every app result. Search commands currently distinguish ordinary local search, `?` web search, and `file:` Everything search.

Saved websites already provide a name, URL, favicon, and stable ID. The existing search index supports case-insensitive matching, aliases, pinyin, and initials. The translation page owns its input state and has no launcher-to-manager prefill handoff yet.

## Windows Application Discovery

Keep `WindowsAppSource` and `AppCatalogService` as the sources of application records. Continue using the existing Start Menu, Start Apps, and App Paths sources, and add recursive `.lnk` discovery from the current user's Desktop (using Electron's known Desktop path) and the Windows Public Desktop when available. Invalid, inaccessible, or broken shortcuts are skipped individually so one bad entry does not hide other apps.

Deduplicate records using their resolved launch target, as the catalog does today. Merge names and aliases from duplicate shortcuts. Keep pinyin and initial matching in the existing shared index.

Add stable built-in records for:

- File Explorer — aliases include `File Explorer`, `Explorer`, and `explorer.exe`.
- Control Panel — aliases include `Control Panel` and `control.exe`.
- Device Manager — aliases include `Device Manager` and `devmgmt.msc`.

Represent these as typed system launch targets with fixed executable and argument values. Launch them with direct process APIs, not a shell-interpolated command string. This extends the existing launch-target union without changing how `.lnk`, executable, or packaged-app records launch.

## Application Icons

Resolve icons in the Electron main process from the shortcut's declared icon or its resolved target, using the installed Electron file-icon API. Add a narrow `getAppIcon(id)` preload/IPC operation so the launcher requests icons only for the visible app results. Cache resolved icons in `AppCatalogService` by catalog ID; do not extract icons for the full catalog during startup. Return an image data URL, never an OS file path, to the renderer.

Render the returned image in the existing result icon slot. Keep the generic Command icon as a fallback when Windows does not provide a usable icon, including packaged entries without a resolvable shortcut or file path. Do not fetch icons from the network.

## Saved Website Prefix

Add a `saved-websites` command mode to `parseSearchCommand` when the input starts with `/`. The text after `/` is matched against saved website names and URLs using the existing search index. Include the URL in the website's indexed aliases so URL fragments participate in the same case-insensitive fuzzy matching. Keep website result ranking and pinyin/initial matching consistent with other local results.

The existing `openWebsite(id)` IPC remains the only action for opening a saved website. In this mode, Enter opens the selected saved website; the renderer must not construct an arbitrary external URL from the search text. `?query`, `file:query`, and normal application search retain their current meanings.

## Translation Action

For normal local search, show a data-driven Translation action whenever the trimmed input contains English words or phrases composed of Latin letters, spaces, and common apostrophe/hyphen punctuation, with at least one Latin letter. This includes a query such as `Visual Studio Code`. Do not show the action for `?`, `file:`, or `/` command modes.

Append the Translation action after matching application results, and still show it when there are no application matches. It participates in the same Arrow Up/Down, Enter, selected-row scrolling, and click behavior as other results. Selecting it opens the existing manager window on the Translation section and pre-fills the exact search text. It does not call AI or Google Translate until the user chooses one of the existing translation controls.

Add a narrowly scoped IPC handoff from the launcher to the manager. The main process validates the text length and queues the request until the manager renderer is ready, so a request works whether the manager is already open or must be created. `App.vue` routes to the Translation section and passes the text to `TranslateView`; the component updates its source input and clears any stale result when the prefill changes. The renderer API remains context-isolated and exposes no Node.js access.

## Result Selection and Error Handling

Use a discriminated launcher result/action model so app results, saved website results, and the Translation action have unambiguous click and Enter behavior. Recompute the selected row when the query or command mode changes. Preserve the existing eight application-result limit; the Translation action may appear as one additional row. The results panel continues to scroll internally.

- Unavailable Desktop folders and malformed shortcuts are ignored while the other catalog sources continue to load.
- A failed icon lookup uses the generic app icon and does not fail the search.
- App launch and website-open errors continue to use their existing IPC result handling.
- An invalid or overlong translation handoff is rejected by the main process and shown as a launcher error; valid handoffs prefill the manager without triggering a network request.

## Compatibility

- Keep `WebsiteEntry` and persisted application data unchanged.
- Keep the existing launcher shortcut, Escape, blur-hide, drag, `?` web search, and `file:` Everything behavior unchanged.
- Do not add dependencies or expose filesystem paths to the renderer.
- The new icon and translation operations use the existing contextBridge/preload boundary.

## Verification

- Run `npm run typecheck` and `npm run build`.
- Launch `npm run electron:dev` for Windows runtime checks.
- Verify a user Desktop shortcut and a Public Desktop shortcut are searchable and launch through the catalog.
- Verify File Explorer, Control Panel, and Device Manager appear by Chinese name and English alias and launch.
- Verify matching Win32 app results show their associated icons, with a generic fallback when an icon is unavailable.
- Verify `/` searches saved website names and URL fragments, selects with arrows, and opens the chosen saved site on Enter.
- Verify `?query` and `file:query` retain their existing actions.
- Verify `test`, an unmatched English phrase, and an application-matching English phrase each expose Translation; selecting it opens the manager's Translation section with the exact text prefilled, without starting a translation request.
- Verify launcher hotkey toggle, Escape, blur-hide, and drag remain unchanged.

The repository currently has no automated test script, so the Windows interaction checks above require a running desktop build.

## Likely Change Areas

- `electron/services/windows-app-source.ts` and `electron/services/app-catalog.ts` for desktop/system records, deduplication, launch targets, and cached icon resolution.
- `electron/ipc/app-handlers.ts`, `electron/main.ts`, and `electron/preload.ts` for icon lookup and safe translation handoff.
- `src/shared/domain.ts`, `src/shared/ipc.ts`, `src/shared/search-command.ts`, and `src/shared/pinyin-index.ts` for the shared search contract and website URL indexing.
- `src/features/search/LauncherView.vue` for command-specific results, app icons, and the Translation action.
- `src/App.vue` and `src/features/translate/TranslateView.vue` for routing and translation prefill.

No persisted setting or website-data migration is required.
