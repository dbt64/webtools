# Plugin Runtime and Surface Lifecycle

Current consolidated source: **2026-10-21**. See the [checkpoint notes](2026-10-21-platform-consolidation.md) for implementation changes and verification boundaries. Phase reports linked from this document retain their historical scope.

## Ownership

WebTools NativeHost is the only persistent Host. Launcher, global hotkeys and tray remain native. The existing Electron Host starts on demand and owns Manager and independent plugin windows; no second Electron application, plugin daemon or background runtime is introduced.

```text
NativeHost
  └─ authenticated existing Named Pipe → Electron Host / Main
       ├─ Manager BrowserWindow (management UI and guarded Manager preload)
       ├─ Plugin BrowserWindow A (unprivileged window shell)
       │    └─ Runtime 2.0 WebContentsView A (validated Web/Node bootstrap)
       └─ Plugin BrowserWindow B (unprivileged window shell)
            └─ Runtime 2.0 WebContentsView B (validated Web/Node bootstrap)
       + invocation-scoped Node Command Utility children (no UI, no resident service)
```

The plugin execution view belongs to its own BrowserWindow, not Manager. The shell has no Manager preload or privileged IPC. Host-controlled Runtime 2.0 remains the execution engine: immutable validated snapshot, materialized Node inventory, stable origin, persistent browser Session, private bootstrap, generation-bound bridge, PluginStore, local data, Shared AI and clipboard authority.

The Manager main-frame sender guard remains the authority for Manager IPC. A plugin view and its window shell never pass that guard. Node plugins retain the trusted local-code model; this window separation is not an OS sandbox against code running as the current Windows user.

## Plugin Window theme

The Host provides optional `--webtools-*` color variables before runtime READY and updates them from the saved light/dark/system preference. Host CSS contains only a `:root` custom-property rule. Plugin pages explicitly consume variables, including assigning `--webtools-color-scheme` to CSS `color-scheme` if desired. Pages that ignore them retain their own styles and are not promised to visually match WebTools. Window shell ownership and page accessibility remain separate. See [Plugin Window Theme and UI Contract](plugin-window-theme-contract.md) for values, four-framework examples, fallback behavior and contrast limitations.

## Feature activation

Identity is `{ pluginId, featureId }`. Invocation surface (`manager`, `launcher`, `super-panel`) and presentation (`window`, `command`) are separate contracts. Main resolves installed Features against the live package record, enabled state, grants, Feature requirements and validated package snapshot; neither cached Native metadata nor Renderer claims issue runtime authority.

`FeatureActivationService` obtains live authority, then `FeaturePresentationRouter` selects a presentation host. `PluginWindowManager` owns only window identity, placement, reuse and teardown. Existing Runtime 2.0 owns execution and Host capability enforcement. Developer activation passes the existing project-scoped Host authority into that same router instead of installing the development package.

Old Manifest v3 features normalize to window presentation. Node command presentation uses a CommonJS `node-command` entry and the Runtime 2.0 Node execution adapter. Web command/HTML command combinations remain unsupported. Manifest v1 declarative Manager pages and built-in Translation retain their existing Manager presentation. Plugin settings do not become independent windows.

## Native Launcher discovery

The existing Main-derived Feature Registry now includes eligible installed Manifest v3 Features alongside existing declarative compatibility and built-in rows. It checks enabled/package state, the validated package inventory, Feature requirements and grants, and the supported presentation matrix. NativeHost does not read plugin packages or Node directories. Development Session Features are not included.

Projection v2 remains the bounded discovery transport/cache. Native and Main negotiate `launcher-feature-surfaces-v1` in addition to existing `feature-projection-v2` and `electron-host-lifecycle-v1`. New rows use `featureKind: runtime-v3` and optional description, presentation and bounded inline PNG metadata. Main keeps the existing wire shape and supported rows for older peers. Each plugin has at most 64 projected Features; the entire snapshot retains the existing 2,000-row/3 MiB bounds. Built-ins are retained before applying the global budget. Optional image bytes are dropped before metadata rows are omitted. No absolute plugin asset path crosses the boundary.

Install, replacement, uninstall, enable/disable and grant changes invalidate the derived Registry and publish full snapshots on the existing authenticated Named Pipe. Native atomically persists the last valid projection in its existing profile cache, then rebuilds its local search index. Login/restart can discover cached Features with Electron absent; a new installation that has never been synchronized has no v3 metadata until Main first runs. No background Electron discovery process is started.

Native search uses canonical `{ pluginId, featureId }` row identity and the existing `PluginFeature` result group. Title, plugin name, existing `commands` aliases and description enter the local index, including existing title/name pinyin matching. Title exact/prefix matches outrank aliases; description matches use the existing lower rank tier. Up to six Feature results are appended after the existing eight app/website rows, preserving app-search memory and result ownership. Built-in Translation stays in the empty-query preview. `?`, `/` and `file:` keep their existing provider behavior.

Asset icons are decoded and reduced to small PNG bytes by Main from validated snapshots. Feature assets take precedence, then package representative assets, then a Host/default token. Declared Host Feature tokens take precedence over package image fallback. Native reuses its existing bounded icon LRU to decode the inline images; icon loss never authorizes or invalidates execution. Feature title and plugin name are shown instead of internal IDs.

Selecting a window Feature hides Launcher and routes its ref through live Main authorization to the existing singleton PluginWindowManager. Selecting a command keeps the current Launcher available and shows execution/completion/cancellation status. Failure uses the existing short error dialog/status path. The captured query travels through the existing text context contract only when the Feature declares it; it is never encoded into a URL. No command argument grammar is inferred from search text.

Projection is not authority. A rejected stale activation triggers a fresh Main derivation and sync before replying. Known disabled, removed, unsupported or broken Features are omitted from the next snapshot; failed synchronization preserves Native's last valid cache, and every activation is still revalidated. A package altered outside WebTools can remain in an offline cache until Main detects the change. There is no offline filesystem watcher/validator in NativeHost.

## Node command execution

`NodeCommandExecutionAdapter` reuses the existing live authority, immutable package snapshot, materialized package paths, Node descriptor/integrity bootstrap, generation sequence, WebHostCapabilities, PluginStore, local data and diagnostic store. Its execution primitive is one temporary Electron Utility child per invocation. No BrowserWindow, HTML page, offscreen Web renderer, second application or permanent Node service is created for a command.

The CommonJS module exports a handler that receives the validated context or null, AbortSignal and typed Host capability proxies. Resolving a void handler produces `completed`; cancellation produces `cancelled`; unsupported combinations produce a rejection; faults/timeouts produce failure. The ordinary authenticated Native completion response remains status-only. An explicitly targeted Super Panel invocation may additionally return the bounded text Quick Result through its separate negotiated result channel; it does not turn every command into an arbitrary result transport. See the [Quick Result report](phase6g1-feature-quick-result-foundation.md).

Execution/preparation has a 30-second deadline and a maximum of eight concurrent commands per Electron Host. Cancellation aborts Host requests, revokes authority and gives the child a one-second cooperative cleanup grace before terminating only that owned child. Actual process exit is awaited, with a bounded five-second cleanup deadline. A failed cleanup stops this Electron Host rather than leaving an unaccounted execution resident. Plugin-authored detached helpers remain subject to the trusted local-code model and the author's cleanup obligations.

Child environment omits Host credential/control variables. Private child messages reach only the existing closed capability dispatcher associated with that invocation authority. The child receives no Shared AI token, Manager preload, Manager WebContents or Native pipe identity through the SDK. Shared AI and clipboard keep their existing grants/consent contract; native consent dialogs do not require Manager to be opened. This is not an OS sandbox for Node plugins.

## Independent windows

Installed window identity is the canonical FeatureRef. Development window identity additionally includes the development session, allowing an installed and development version of the same Feature to coexist. Repeated activation of an already-ready Feature restores and focuses the same OS window and execution view. Distinct FeatureRefs have independent Runtime instances; retention also follows the current attached/detached and focus-switch policy.

Window preferences are a closed Manifest contract: default/minimum width and height, resizable, and `blurBehavior` (`temporary-hide` or `background`). Defaults are 960 × 680 with a 360 × 260 minimum. Host placement and clamping use the current display work area. The existing Host chrome draws the title bar and its controls; the plugin document remains a separate execution view. `temporary-hide` preserves the hidden window/runtime for summon recovery without an idle expiry; `background` leaves it behind other applications. Explicit close, switching away under the existing temporary-run policy, plugin disable and development reload end the appropriate run. Manual minimize and Host dialogs are handled separately from blur. See the [focus/lifecycle design](superpowers/specs/2026-10-19-plugin-window-focus-lifecycle-design.md).

Each Runtime instance routes through the existing persistent browser partition. A Host-owned Session coordinator installs protocol, permission and download handlers once, then identifies each live execution WebContents by its owner. Protocol resource lookup uses the owner's stable origin and immutable snapshot. Permissions and user dialogs use the actual plugin window. Closing one window removes only its owner; shared network connections are closed when the last runtime owner is released. Persistent browser storage is preserved on ordinary close.

Different live generations for the same origin must serve the same validated package hash. Update closes all installed windows of the affected plugin before package replacement. Development reload waits for every old context of that session to finish teardown before serving the new hash. Development origins remain separate from installed origins. No random invocation origin or transient-storage mode is introduced.

## Host lifecycle

| Surfaces | Electron behavior |
| --- | --- |
| Visible WPF Launcher/Super Panel session | Prewarm Host after WPF first frame/input; create no Electron page |
| Manager open | Keep Host alive |
| Manager closed, plugin window open | Keep Host and plugin runtimes alive |
| Temporary plugin hidden or manually minimized | Keep its window/runtime until the run ends explicitly |
| Plugin window closed, Manager open | Keep Manager alive |
| Command or activation queue owns work | Keep Host until execution/queue ownership is released |
| Last surface and active work released | Finish runtime teardown and exit Host |

Manager close cancels Manager-owned translation requests and declarative UI sessions, destroys only Manager's window and releases its page readiness. It does not revoke installed window authorities, close development windows, erase Main diagnostics or destroy the Electron Host while plugin windows remain.

Plugin window close revokes the Runtime authority/generation, bridge and pending capabilities, destroys the execution view, releases its Session ownership and removes the window registry entry. Loading, closing and development-reload work retain bounded/transient Host ownership while teardown or activation is pending. Diagnostic records and development watchers alone are not Electron surfaces.

NativeHost and Electron negotiate lifecycle support on the existing authenticated pipe. `electron-host-ready` means Main services can process activation; `manager-renderer-ready` is separate UI readiness. Native starts the same executable with `WEBTOOLS_ELECTRON_HOST_ONLY=1` for a visible WPF session or submitted request. NativeHost startup alone does not prewarm Electron. A released session with no target/window/work ends the Host normally; there is no permanent keep-warm flag or 60-second idle lease. Manager, plugin and Translation pages are created only for the actual target. Translation 2.0 owns an independent window, never a Manager page.

NativeHost retains control of the same Electron process group after Manager closes. Native exit/update requests shut down the entire Electron Host, including plugin windows, through the existing shutdown contract. Normal last-surface Electron exit does not stop NativeHost.

NativeHost owns the complete revisioned snapshot of active WPF sessions and queued/delivered business request IDs. Initial connection and reconnect synchronize that snapshot before dispatch or idle exit. A submitted request is acquired before WPF hides; Electron deduplicates execution by its payload request ID, independently of the Pipe delivery envelope ID. Lost acknowledgement can replay the existing presentation without executing the feature twice. `host-ownership-sync` replaces the old queue-only ownership message; `electron-host-closing` marks readiness unavailable. These paths reuse the existing start gate, authenticated Pipe and process identity, without fixed-delay lifecycle coordination or a second service. See the [session prewarm design](superpowers/specs/2026-10-20-electron-launcher-session-prewarm-design.md).

Activation resolution itself owns work independently of Manager UI, with a 30-second admission expiry before execution. Native uses a 60-second Feature response deadline with the new capability; older peers keep the existing response timeout. Command ownership follows actual preparation/execution/teardown rather than a timer that merely keeps Electron alive.

## Plugin and development lifecycle

- Disable, grant replacement, uninstall and update revoke affected installed authorities and await their plugin window/command teardown before deleting/replacing runtime resources. Window close preserves data; uninstall retention/deletion stays governed by the existing user choice.
- Unexpected plugin view destruction, renderer crash, load failure or unresponsive renderer tears down its Runtime and removes the associated window entry. A subsequent activation resolves a new authority and creates a fresh window. There is no automatic restart loop.
- Developer Mode and its connection belong to Electron Main. Manager can disappear while a development window is active. Reopening Manager reads current project state and diagnostics.
- Successful development updates use the existing coordinator to revoke/destroy all old contexts, including Node preload contexts, and reopen the previously open FeatureRefs inside their existing windows. Deleted/failed features close without stopping unrelated windows. A temporary reload lease prevents Electron from quitting between old-context teardown and new load.
- Development commands are cancelled before old development files are released. Reload does not automatically repeat a completed/cancelled command.
- Developer diagnostic records remain small and Main-owned, keyed by Plugin/Feature with runtime generation. Manager-only IPC displays/copies redacted records. Web and Node windows use the same diagnostics pipeline.

## Scope

This implementation includes installed v3 Native Feature discovery, window/Node command activation and the [Native Super Panel](super-panel.md). Super Panel has context-aware matching and its own ordered canonical pins; it does not change website Favorites, app usage memory or Launcher provider priority. Web command execution, complex command argument parsing, arbitrary command result UI, final Plugin Center/window visual design and bounds persistence remain outside this implementation. No second history database or raw Electron SDK API is introduced.

The implementation is not a verification claim. Tests, typecheck, build and runtime acceptance require a separately authorized testing task.

## Typed configuration authority (Phase 6F-4D)

Manifest v3's optional `configuration` metadata is included in the Host-validated immutable package snapshot. Manager management reads/writes the current installed identity and can configure disabled plugins without opening a Feature. Manager main-frame identity and package version/hash are rechecked before atomic commit; a Host-derived config revision prevents overwriting concurrent edits.

Web and Node Runtime calls use the existing closed Host bridge: `config.get` requires `plugin.config.read`, and `config.set` requires `plugin.config.write`. The active Feature, requested/granted capability, implemented package descriptor, snapshot/hash and live runtime generation must all agree. Revoked or stale calls cannot commit. Node Command remains temporary; no second runtime/daemon is added.

The v3 envelope is `{ storageVersion: 1, schemaVersion, values }` under the managed `config/v3` namespace. It is distinct from v1's `config/<pluginId>.json`, plugin storage, AppSettings, and SecretStore. Reads resolve validated defaults without writing. Invalid/schema-incompatible data is preserved; user-confirmed Manager reset retains one latest raw-byte backup before writing defaults. Explicit private-data deletion includes both config formats and that backup. Existing explicit config grants are preserved, but a package without a descriptor still cannot use config capabilities.

Focused source tests and type checks are recorded in the [6F-4D implementation report](phase6f4d-plugin-configuration-development.md). Packaged Web/Node execution and real Manager UI remain a separate verification round.
