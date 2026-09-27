# Launcher Development Boundaries

The deterministic behavior fixtures live in `tests/fixtures/launcher-parity.json`. The contract tests exercise shared search semantics and typed launcher actions; they intentionally do not automate Electron windows or Windows application discovery.

## Ownership

- **Launcher UI** owns input state, focus, keyboard selection, hover, scrolling, layout, and animation.
- **Shared search behavior** owns command parsing, normalization, matching, ranking, pinyin, result limits, app-search memory semantics, and typed actions.
- **Windows/Electron adapters** own `.lnk`, AUMID, App Paths, icons, process launching, Everything integration, global shortcuts, tray, and `BrowserWindow` lifecycle.
- **Manager** owns Settings UI, translation providers, website management, and future complex modules such as Applications.

## Current behavior baseline

- `?query` searches the selected web engine, `file:query` delegates to Everything, and `/query` searches saved websites only. Manager quick search converts `/query` to ordinary local search. Prefix recognition currently requires the first raw character; leading whitespace before a prefix remains local text.
- Ordinary local search mixes applications and saved websites. `/` mode limits candidates to saved websites. Website names, URL aliases, and descriptions are indexed; opening a website uses its saved ID.
- Search normalizes case, accents, and punctuation, supports pinyin, and sorts by the current rank tiers before name ordering. Ordinary app and website rows share an eight-result limit. An eligible Latin phrase can append a translation action after those rows, including as row nine.
- Launcher row actions distinguish application, website, file, and translation. Web search is a command mode rather than a row action. App and website launches use stable IDs; file launch uses an opaque Everything result ID.

## Change rule

- Manager-only UI changes do not need to change the Launcher contract.
- Launcher-only interaction changes usually stay in the UI.
- Changes to command parsing, matching, ranking, memory, result limits, or action payloads update the behavior fixtures and parity tests in the same change.
- Do not test focus, hover, scrolling, drag, shortcut registration, window lifecycle, or external launches as shared search behavior.

## Applications and data ownership

An Applications module must reuse the Electron-owned `AppSearchEntry` identity, display name, aliases, icon lookup, and `launchApp(id)` semantics; it must not create a second app catalog or alias model. Catalog IDs are derived from the effective launch identity and remain stable while that identity is unchanged; changing an install target or shortcut invocation can change an ID. Any future persisted aliases, favorites, hidden state, or categories need one explicit writer. Electron remains the sole `DataStore` owner; a future Native proof of concept must not write the existing data file or create a competing persistence model.

## Future Native parity

The JSON fixtures define fictional applications, websites, fixed IDs, and fixed memory timestamps without machine paths or user data. A future Native launcher can reproduce the same semantic inputs and outputs. This phase does not create a Native project or an Applications module.
