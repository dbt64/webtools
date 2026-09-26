# Search Engine Picker, Themes, and Launcher Display Mode

## Status

Design approved in conversation; awaiting review of this written specification.

## Goal

Make the main quick-search page faster to use by moving default search-engine selection into the search field, offer light/dark/system appearance choices, and let users choose whether the separate launcher opens compact or expanded. Preserve existing settings and keep the current compact launcher behavior as the default.

## Scope

- Add a compact search-engine picker to the main `SearchView` search field.
- Add a theme preference in Settings: light, dark, or follow Windows/system appearance.
- Replace the green-leaning dark palette with a cool, blue-tinted dark palette.
- Add a launcher display preference: compact (current behavior) or expanded on show.
- Persist both new preferences in the existing local settings store and apply them in both renderer windows.
- Keep custom search-engine editing in the existing Settings editor.

Out of scope: remote logo fetching, redesigning the settings page, adding search engines or built-in launcher apps, and changing search query syntax or launch behavior.

## Main Quick-Search Engine Picker

Replace the magnifying-glass icon in the main quick-search input with a button showing the selected engine's mark and a small disclosure indicator. Clicking it opens a compact, keyboard-accessible menu listing enabled engines in their configured order. Selecting an engine immediately calls the existing settings update IPC to change `defaultSearchEngineId`; the menu closes after a successful save. On failure, keep the prior selection and show an inline error.

Use local marks only: recognizable marks for Google, Baidu, and Bilibili, and the first character of a custom engine name for custom engines. Do not fetch remote logos. A plus action at the bottom navigates directly to Settings, where the existing search-engine editor remains the sole place to add, edit, enable, disable, or reorder engines.

The popup closes on Escape, outside click, or successful selection. Keyboard focus remains predictable, with selection exposed to assistive technology.

## Theme Preference

Add `theme: 'light' | 'dark' | 'system'` to `AppSettings`. Existing data without this field resolves to `dark`, preserving today's dark appearance. The Settings page presents three clear choices and saves changes through the existing `updateSettings` IPC.

Apply theme tokens through a `data-theme` attribute on the document root in both the manager and launcher renderer. In `system` mode, resolve colors from `prefers-color-scheme` and listen for system preference changes while each renderer is open. Explicit light and dark choices ignore OS changes.

Refactor the shared CSS palette to theme variables for canvas, panels, borders, text, muted text, and accent states. The dark theme uses cool blue/slate surfaces and a restrained blue accent in place of the current green emphasis. The light theme uses matching neutral surfaces and readable contrast. Existing components continue to use the shared tokens so both windows stay visually consistent.

Persist the new field without treating existing version-2 data as corrupt. Data loading must supply the default for older files before returning settings; later setting updates write the normalized settings through the current store.

## Launcher Display Mode

Add `launcherDisplayMode: 'compact' | 'expanded'` to `AppSettings`, defaulting to `compact`. The Settings page presents a two-choice control with descriptions: compact opens with only the search field and overall expand button; expanded opens with the search field plus the existing Favorites and Apps modules.

The persisted choice controls only the initial launcher presentation. Per-section expansion remains session UI state: each module starts at its existing one-row state, and its own expand control remains available only when its content wraps beyond one row. Collapsing manually does not rewrite the saved preference; the next hotkey invocation returns to the selected initial mode.

The main process reads the saved preference before sizing/showing the launcher and includes the initial mode in the existing show notification. The renderer applies the same mode before synchronizing the window size, avoiding a compact-to-expanded resize flash. Existing global hotkey toggle, Escape, blur-hide, and drag behavior remain unchanged.

## Settings and Data Flow

Extend `AppSettings` with `theme` and `launcherDisplayMode`, add defaults, and validate both values in the settings IPC. The data-store loader accepts existing v2 records that lack these fields and normalizes them to `dark` and `compact`. The existing `updateSettings` contract remains the persistence boundary.

The search view loads the selected engine with its current settings, saves picker selections through `updateSettings`, and emits navigation to the existing Settings section for the plus action. Settings controls update their local state from the returned settings object so the UI reflects the persisted value.

The manager and launcher independently load local settings. The manager applies theme while mounted; the launcher applies theme and display mode on each show. `system` theme mode tracks OS color changes using `matchMedia`, without polling.

## Error Handling and Accessibility

- Keep the current search engine selected until a new selection is persisted successfully.
- Surface settings-save errors inline without closing the picker or silently changing the displayed engine.
- Disable settings controls while their save request is pending.
- Provide visible focus indicators, keyboard navigation and Escape behavior for the engine menu.
- Maintain sufficient foreground/background contrast in all three theme modes.
- Do not expose theme or launcher mode as security-sensitive settings; they remain ordinary local preferences.

## Verification

- Run `npm run typecheck` and `npm run build`.
- Launch `npm run electron:dev` for interactive verification.
- Verify picker options reflect enabled engines and configured order, selection persists, and plus opens Settings.
- Verify settings added in this version do not invalidate existing v2 user data.
- Verify light, dark, and system themes in the manager and launcher, including a live system theme change.
- Verify compact and expanded launcher preferences across hide/show and hotkey invocation; per-section row controls continue to work.
- Verify existing `?query` web search still uses the selected engine.

## Likely Change Areas

- `src/shared/domain.ts` and `electron/services/data-store.ts` for settings defaults and backward-compatible normalization.
- `electron/ipc/settings-handlers.ts` for validation and saving the new preferences.
- `src/features/search/SearchView.vue` and `src/App.vue` for the picker and direct navigation to Settings.
- `src/features/settings/SettingsView.vue` for theme and launcher-mode choices.
- `src/launcher.ts`, `src/main.ts`, `src/features/search/LauncherView.vue`, and `electron/main.ts` for theme application and launch-mode handoff.
- `src/styles/tokens.css` for shared light and cool-blue dark palettes.

No new dependency or separate persistence mechanism is needed.
