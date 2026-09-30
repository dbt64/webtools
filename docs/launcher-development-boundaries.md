# Launcher Development Boundaries

The deterministic behavior fixtures live in `tests/fixtures/launcher-parity.json`. The contract tests exercise shared search semantics and typed launcher actions; they intentionally do not automate Electron windows or Windows application discovery.

## Ownership

- **NativeHost** is the production launcher and owns the WPF search window, input and selection state, Windows app discovery/launch, icons, Everything integration, tray, global hotkey, login startup, and the Native launcher state store.
- **Native search behavior** implements command parsing, normalization, matching, ranking, pinyin, result limits, app-search memory, and typed actions. The JSON parity fixtures and contract tests describe cross-implementation behavior; changes to those semantics must update the fixtures and relevant implementations.
- **Electron Main** is Manager-only in production. It owns the Manager window, secure renderer IPC, the Manager DataStore, and the Named Pipe client to NativeHost. It does not create a production Launcher window, tray icon, global shortcut, or startup entry.
- **Manager** owns website management, Settings UI, translation providers, and other full-page tools. Launcher settings and website changes are projected to NativeHost over the versioned Named Pipe protocol.

## Current behavior baseline

- `?query` searches the selected web engine, `file:query` delegates to Everything, and `/query` searches saved websites only. Manager quick search converts `/query` to ordinary local search. Prefix recognition currently requires the first raw character; leading whitespace before a prefix remains local text.
- Ordinary local search mixes applications and saved websites. `/` mode limits candidates to saved websites. Website names, URL aliases, and descriptions are indexed; opening a website uses its saved ID.
- Search normalizes case, accents, and punctuation, supports pinyin, and sorts by the current rank tiers before name ordering. Ordinary app and website rows share an eight-result limit. An eligible Latin phrase can append a translation action after those rows, including as row nine.
- Native launcher row actions distinguish application, website, file, and translation. Web search is a command mode rather than a row action. App and website launches use stable IDs; file launch uses an opaque Everything result ID.

## Change rule

- Manager-only UI changes do not need to change the Launcher contract.
- Launcher-only interaction changes usually stay in the UI.
- Changes to command parsing, matching, ranking, memory, result limits, or action payloads update the behavior fixtures and parity tests in the same change.
- Do not test focus, hover, scrolling, drag, shortcut registration, window lifecycle, or external launches as shared search behavior.

## Applications and data ownership

NativeHost owns the production app catalog and launcher-specific persisted state. Catalog IDs are derived from effective launch identity; aliases let duplicate shortcuts remain searchable. Manager continues to own the existing website and translation configuration data and synchronizes the reduced launcher website projection and launcher settings through the Named Pipe protocol. Do not add a second writer for the Manager website schema or expose local filesystem paths to Manager renderer code.

## Parity fixtures

The JSON fixtures use fictional applications, websites, fixed IDs, and fixed memory timestamps without machine paths or user data. Keep them deterministic and update the parity contract when changing shared search semantics. Windows discovery, focus, hover, scrolling, drag, tray, shortcut registration, window lifecycle, and external launches require NativeHost runtime verification; they are not established by the shared contract tests.
