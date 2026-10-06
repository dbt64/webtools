# Phase 6C-1 — Plugin Platform Architecture Audit

**Audit date:** 2026-10-06
**Scope:** architecture, implementation evidence, compatibility, risks, recommendations
**Status:** audit only; implementation not started

## 1. Executive Summary

Phase 6B provides a host-owned, declarative plugin platform. A package describes a Manager page, settings, assets, and a closed set of actions; it cannot execute author JavaScript. Electron Main validates and owns package state, permission decisions, and effects. NativeHost receives only a bounded presentation projection and does not read the package registry.

That is a sound foundation to extend. It is not yet a runtime for third-party HTML/JavaScript. In particular, the existing Manager renderer has a broad trusted preload API and is not an appropriate place to execute Web plugin bundles. The Main window also permits local-file navigation under its existing policy, and no explicit app Content Security Policy was found in the searched application entry/configuration files. These are future-runtime design gates, not evidence that current declarative plugins can execute arbitrary code.

Recommended direction:

1. Keep Declarative Plugin v1, its SDK 1.1.0 author workflow, install lifecycle, grants, package identity, and Main authority intact.
2. Evolve the logical model to one Plugin with one or more typed Features. Adapt existing v1 entry pages into one synthetic Feature at read time; do not require users to repackage them.
3. Reuse Native SearchCore and the current Main-to-Native projection pattern for a bounded Feature Index. Native stores derived search metadata only; Main revalidates each invocation.
4. Keep the .wtplugin ZIP container and immutable content-addressed storage, but freeze Manifest v1 and add a separately validated Manifest v2 for Web bundles. Do not extract package entries to arbitrary filesystem paths.
5. If an executable Web runtime is approved, host it on demand in an isolated WebContents, preferably an Electron WebContentsView embedded in the Manager. Do not run it in the trusted Manager renderer, do not share one WebContents between plugin authors, do not use a persistent Electron background process, and do not use the webview tag.
6. Make invocation create/load the runtime only after an explicit user action. Destroy it on feature close and Manager close. Do not add a runtime pool in the first version.
7. Begin context support narrowly. Treat context type and context source as separate fields, bound and snapshot values at invocation, and defer files/images/selection until their handles, permissions, freshness, and Windows acquisition mechanisms are designed. Clipboard reads must be explicit and must never emulate Ctrl+C or silently replace clipboard contents.

No P0 or P1 current product defect was found in the audited plugin architecture. Three P2 design gates remain before an implementation plan can safely become code: executable-code isolation and navigation policy; context/clipboard privacy and permission semantics; and the versioned, fail-closed Feature Index and invocation contract. These are future-platform risks, not current Phase 6B failures.

## 2. Current Architecture Map

    Windows
    └── WebTools.NativeHost.exe (one WPF process)
        ├── App.xaml.cs: single-instance mutex, explicit shutdown, profile/state
        ├── MainWindow: Launcher UI and Native SearchCore
        ├── Global hotkey and tray
        ├── NativeManagerPipeServer: current-user-only named pipe
        ├── Launcher state and derived launcher-plugins.json cache
        └── ManagerController / ManagerProcessLauncher
             └── starts one on-demand Manager process group
                 └── Electron Main
                     ├── PluginManager / PluginRegistry / PluginStore
                     ├── PluginCatalog and permission/effect brokers
                     ├── preload exposes the trusted Manager DesktopApi
                     └── one BrowserWindow
                         └── Vue App.vue section switch
                             ├── Favorites
                             ├── Settings
                             ├── Translation
                             ├── Plugin Center
                             └── DeclarativePluginView

Evidence:

- native/WebTools.NativeHost/App.xaml.cs, App.OnStartup: sets ShutdownMode.OnExplicitShutdown, obtains a named single-instance mutex, loads Native state and plugin projection, creates the pipe, ManagerController, one MainWindow, hotkey, and tray.
- native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs, RunAsync: creates a single-instance named pipe with PipeOptions.CurrentUserOnly; protocol handlers include settings, website, and plugin-projection updates.
- native/WebTools.NativeHost/Services/ManagerController.cs, OpenPage, OpenPlugin, and QueueIntent: sends page/plugin intents and starts or reuses the Manager when needed.
- native/WebTools.NativeHost/Services/ManagerProcessLauncher.cs, Start: starts the packaged Manager only after a Manager intent and supplies manager-only and pipe arguments.
- electron/main.ts, createWindow: contains the only production new BrowserWindow found. Manager window close destroys the window and closes/clears plugin and service lifecycle; normal Manager close quits Electron.
- src/App.vue: uses an internal activeSection switch, not a separate BrowserWindow per page. Settings and Plugin Center are async components; plugin pages render through DeclarativePluginView.

The intended process invariant is reflected in startup ownership: NativeHost can run without Electron, and Electron is started by ManagerController on a request. This audit did not run an installed application or inspect production process counts.

## 3. Existing Reusable Components

| Component | Current authority and behavior | Reuse for Phase 6C |
|---|---|---|
| Canonical manifest parser | plugin-sdk/declarative-v1/runtime/manifest-v1.mjs; Electron electron/plugins/manifest.ts adapts to it | Keep v1 frozen; add a separate v2 parser and parity tests rather than forking v1 |
| Package validator | plugin-sdk/declarative-v1/runtime/package-v1.mjs; strict ZIP inventory, CRC, sizes, compression/ratio, path and PNG checks; no extraction | Reuse ZIP/container primitives and hash pipeline with a content-type-specific allowlist |
| PluginManager | electron/plugins/plugin-manager.ts; serializes mutation, validates bytes, owns immutable package versions, grants, enable state, recovery and runtime cleanup | Extend via typed runtime adapters; do not move authority to Vue or NativeHost |
| ManagedFs / PluginStore / PluginRegistry | Main-owned bounded storage rooted under Electron userData; separate registry, package, config, and data areas | Preserve package identity, path containment and private storage policy |
| PermissionBroker / DeclarativeRuntime | electron/plugins/permission-broker.ts and declarative-runtime.ts; exact action union, consent, grants, cancellation and bounded effects | Reuse capability vocabulary and broker principles; Web runtime must not call declarative actions through a renderer shortcut |
| PluginCatalog | electron/plugins/plugin-catalog.ts; derived presentation; open rechecks current enabled/granted package state | Evolve presentation toward Feature DTOs while keeping authoritative invocation checks in Main |
| IPC sender/session guards | electron/ipc/window-security.ts and plugin IPC handler modules | Reuse and strengthen with runtime WebContents identity, frame/origin, plugin id, package hash and invocation generation |
| Native projection path | NativePluginProjectionPublisher, NativeManagerPipeServer plugins-update, LauncherPluginProjectionStore | Best current template for Main-authored, Native-cached, fail-closed feature metadata |
| Native SearchCore | native/WebTools.NativeHost/Search/SearchCore.cs, typed SearchResult/ResultAction | Add Feature index entries/actions to existing matcher; preserve command parser and current app/website behavior |
| Hotkey/tray/Native lifecycle | App.xaml.cs, MainWindow, existing native services | Extend within NativeHost; no extra resident service process |

Phase 6B’s shared SDK package is @webtools/plugin-sdk 1.1.0; root product package is WebTools 0.1.0 and pins pnpm 9.15.9. These are independent version domains. Current Electron dependency is 44.4.5. Do not infer that the SDK author validator is the installation authority: the Host still revalidates package bytes using the canonical runtime.

## 4. Current manager.page Couplings

The current plugin is specifically a Declarative Manager page:

- src/shared/plugin-contracts.ts: PluginManifest requires manifestVersion 1, api.apiMajor 1, type declarative-manager, and entry.pageId/label. Its closed PluginBlock and PluginAction unions describe controls/actions rather than arbitrary views.
- plugin-sdk/declarative-v1/runtime/manifest-v1.mjs, manifest parser: requires type declarative-manager, API major 1, and the manager.page capability; rejects unknown fields/types.
- electron/plugins/plugin-manager.ts, getPages and invoke: getPages enforces manager.page, then verifies package integrity, enabled status and current runtime. invoke checks exact version/hash, a declared action, grants, package integrity, and current session/runtime.
- electron/plugins/plugin-catalog.ts, project, open, launcherProjection: maps every package entry to declarative-page; Native projection includes an enabled/active package only when manager.page is granted.
- src/shared/plugin-catalog-contracts.ts: DeclarativeEntryDTO.entry is fixed to declarative-page; CatalogOpenDTO returns a declarative page payload.
- src/App.vue: has plugins and plugin-page sections. openPluginPage requests pluginCatalog.open, validates current identity/version/hash, then mounts DeclarativePluginView.
- native/WebTools.NativeHost/Services/ManagerController.cs: ManagerPage is a fixed enum for Favorites, Entries, Settings, Translation; OpenPlugin handles the built-in Translation ref specially and queues a declarative plugin ref otherwise.
- native/WebTools.NativeHost/Data/LauncherPluginProjectionStore.cs: projection rows are {ref, displayName, icon} with kinds builtin/declarative; there is no feature id, command list, context declaration, or runtime kind.
- native/WebTools.NativeHost/Search/SearchModels.cs and SearchCore.cs: current indexed kinds/actions do not include plugin features. Plugin shortcuts are shown on the empty-query Launcher home, outside the search index.

Implication: Feature should be added as a logical unit without redefining the current page contract in place. Existing v1 pages can be exposed as one compatibility Feature whose entry points to the same page. Do not treat each declarative page section or each button action as an independent user-facing feature automatically.

## 5. Plugin Package / Manifest Findings

Current package:

- .wtplugin is a ZIP container. PluginManager.install accepts bytes supplied by a Main-owned file picker, calls validatePackage, computes SHA-256, and stores the original archive under an immutable logical path like packages/<id>/<version>/<hash>.wtplugin.
- plugin-sdk/declarative-v1/runtime/package-v1.mjs bounds archive size (20 MiB), entry count (256), expanded bytes (50 MiB), manifest bytes (64 KiB), compression ratio (100), and PNG asset size (256 KiB); it rejects encrypted/special entries, malformed CRC/ZIP64/path forms, duplicate/case-colliding names, undeclared files and unlisted assets.
- Package contents are read into bounded memory and not extracted to arbitrary paths. Manifest-declared image/png is the only asset kind. Other entries are rejected.
- The package hash is an integrity/content identity check, not proof of author identity or publisher signature. The current catalog labels imported packages local-unsigned; installation and replacement require host-owned consent.

Conclusion: the container can be extended in principle without changing .wtplugin or extracting files, but the current v1 content contract cannot carry executable web content. A v2 validator must explicitly allow a bounded bundle layout (for example a fixed entry HTML and relative JS/CSS/assets), validate every normalized ZIP path and referenced file, reject undeclared content, preserve decompression limits, and keep package bytes immutable/content-addressed. A ZIP file being technically able to contain JavaScript does not make current Host validation safe for it.

## 6. Plugin API / SDK Findings

The current shared contract says explicitly that v1 plugin content is not executable code (src/shared/plugin-contracts.ts, first comment). The SDK provides the canonical declarative manifest/runtime validators and package authoring workflow; the Host uses the same canonical validator through electron/plugins/manifest.ts and package-validator.ts.

The current API surface is a typed authoring contract for settings, pages, actions and package lifecycle. Electron preload maps a trusted Manager-oriented plugin API, but it does not expose that API as a separate plugin SDK runtime. The existing SDK therefore does not solve:

- loading framework-produced Web bundles;
- browser-runtime initialization, navigation or origin identity;
- web-to-host bridge version negotiation;
- runtime-scoped permissions or context delivery;
- WebContents lifecycle or cleanup.

Keep SDK small and integration-focused. Vue/React/Svelte, browser-compatible npm libraries and WASM belong in author bundles when they can run without Host privileges. Do not add OCR, PDF, image/video/audio utilities to the Host SDK. For each proposed Host API ask whether browser APIs/npm/WASM can do it, which process actually needs it, whether it is permissioned, and whether it can be lazy and request-scoped.

## 7. Permission / Capability Findings

Current capabilities in src/shared/plugin-contracts.ts are manager.page, config read/write, private storage read/write, external.open, clipboard.write, and sharedAI.complete. There is no clipboard read, arbitrary filesystem, process launch, Node, or network capability.

PluginManager owns requested/granted state, requires new capabilities to be reauthorized on upgrade, and checks current plugin/session/hash and declared action at invocation. PermissionBroker.enforce requires both requested and granted state. DeclarativeRuntime executes a fixed action union and obtains host consent for sensitive effects. electron/plugins/electron-plugin-host.ts uses Main-owned shell.openExternal, clipboard write, AI and file picker effects; it does not expose raw paths to the renderer through the plugin API.

Reuse:

- Main-owned grants and effects;
- current capability delta/re-consent behavior;
- exact input schemas, bounds, cancellation and per-call state validation;
- Main confirmation for install, replacement, sensitive actions and uninstall.

Extend before Web execution:

- bind each WebContents and bridge session to plugin id, feature id, version/hash and runtime generation;
- revalidate current enabled/granted state for every bridge call, including after asynchronous consent;
- prevent a plugin from claiming an undeclared capability in a context or action payload;
- decide whether capabilities remain plugin-wide or whether Feature requirements can narrow them.

The current plugin-wide grant model is the compatibility baseline. A future per-feature requiredCapabilities list can be useful for least privilege, but must be a validated subset of the package’s requested capability set; it should not silently expand grants.

## 8. Electron Security / Runtime Findings

Current Main:

- electron/main.ts, createWindow: contextIsolation true, nodeIntegration false, sandbox true; denies setWindowOpenHandler popups.
- The current will-navigate handler allows any file URL and localhost HTTP URLs, while preventing other navigation. This is existing trusted-Manager policy, not evidence of an exploit in the declarative runtime.
- Only one production new BrowserWindow was found. No production BrowserView/WebContentsView, webview tag, plugin protocol handler, plugin session partition, or explicit Content-Security-Policy declaration was found in the searched Electron/Vue entry/config files.
- electron/preload.ts exposes window.desktop via contextBridge. The API includes Plugin Center, Settings, websites, translation/AI and other trusted Manager functions. Context isolation protects the isolated preload world from the page world; it does not make arbitrary third-party code safe if that code is loaded into the Manager page and can invoke the page-visible API.
- electron/ipc/window-security.ts checks the current BrowserWindow WebContents and main frame. Plugin handlers validate argument shape and session and re-check sender/session after async work. A future Web runtime needs its own sender boundary rather than being accepted as the Manager main frame.
- Current Main close path destroys/clears plugin lifecycle and quits Electron; no detached plugin WebContents currently exists.

Readiness: current Electron Manager is safe for the present host-rendered DeclarativePluginView model based on data. It is not ready to load plugin-authored scripts into the trusted Manager renderer. Before Web runtime code, specify navigation allowlists, custom origin/asset handling, CSP, separate session/storage, permission handlers, popup/download behavior, network policy, bridge sender checks and deterministic WebContents destruction.

Electron’s current security guidance recommends isolating untrusted content, limiting navigation, validating IPC senders, using CSP, and not exposing privileged APIs to arbitrary content. Electron documents WebContentsView as a Main-owned embedded WebContents surface; it also warns against relying on the webview tag for new designs. See [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [Session](https://www.electronjs.org/docs/latest/api/session), [Protocol](https://www.electronjs.org/docs/latest/api/protocol), and [webview tag](https://www.electronjs.org/docs/latest/api/webview-tag).

These links inform future design only; this report does not assert that a chosen Electron runtime has been implemented or tested.

## 9. NativeHost Findings

App.xaml.cs owns one WPF application process, one single-instance mutex, one MainWindow, one tray service, hotkey registration, the named pipe and explicit cleanup. The global input hook is confined to the existing hotkey implementation; no UI Automation, foreground-window capture, selected-text capture or screenshot feature was found in production source. Scripted UIAutomation in tests/measurement tooling is not a product capability.

LauncherPluginProjectionStore stores a bounded 2 MiB, version-1 JSON projection under the Native profile and validates exact fields, ids and icon tokens. It stores no package path, manifest, grants, permissions or bundle content. Missing, malformed or inaccessible cache results in an empty projection; it is a derived presentation cache and not authority.

NativeManagerPipeServer uses a current-user-only named pipe, a single server instance and versioned messages. plugins-update validates the projection and calls the store update callback. PluginCatalog.launcherProjection produces that projection from Main’s current catalog. On click, Native sends a tagged ref; Main rechecks the plugin’s current status before opening it. This is the desired trust direction.

No technical blocker was found to hosting a second WPF Window in the same NativeHost process: WPF already has a Dispatcher, and App uses ShutdownMode.OnExplicitShutdown. The existing lifecycle is nevertheless Launcher-centric: closing the current MainWindow triggers host cleanup/shutdown. A future Super Panel must define window ownership/close policy and ensure closing/hiding Launcher does not accidentally terminate an active panel. Hotkey and focus behavior also need explicit coordination. This is a lifecycle contract to design, not a reason to introduce SuperPanel.exe.

## 10. Launcher Search Integration Findings

SearchCommand.Parse owns the existing local, ? web, file: Everything and / saved-website modes. SearchCore owns the app + website index, normalized names/aliases, pinyin/initials, ranking, remembered-app promotion, eight-result local cap and typed result actions. Current Windows system apps are represented through the app catalog as application entries, not a separate plugin search engine.

MainWindow.xaml.cs, RefreshPluginShortcuts, presents projected plugin shortcuts on the expanded empty-query view; selecting one hides Launcher and asks ManagerController to open the tagged ref. SearchCore does not currently index plugin names as searchable rows or plugin commands.

Recommendation:

- Extend the existing SearchCore index and ResultAction with a typed Feature action carrying a composite {pluginId, featureId} ref. Do not build a separate search engine.
- Add bounded title, description/aliases/commands as indexed metadata; use current normalization, localized matching and pinyin behavior.
- Keep /, ?, and file: routing exactly where it is. Only Local mode should match globally invoked feature commands unless a separate product decision authorizes command-specific routing.
- Keep search metadata separate from executable package assets. Query text may be a context snapshot, but never a filesystem path supplied by renderer or an executable command string.
- Define stable duplicate/collision behavior. Normalize aliases consistently, preserve deterministic ordering, and avoid one plugin shadowing another through duplicate ids or aliases.
- Decide whether Feature rows share the existing eight app/website rows or have a separately bounded appended group. The current code does not answer this. Preserve the relative order and behavior of current app/website matches; do not silently change their result cap.

The initial match model can remain keyword/alias/prefix plus existing pinyin/initial logic. Fuzzy scoring already exists as ranks in SearchCore; do not add a second fuzzy algorithm without measured need.

## 11. Clipboard Findings

Production plugin capability is write-only. electron/plugins/electron-plugin-host.ts calls Electron clipboard write; no production clipboard-read/monitor API was found. Native file-result operations use WPF clipboard writes for explicit user actions. No background clipboard polling or history is implemented.

Clipboard should be a context source and a separately granted Host capability, not a third invocation surface. The context snapshot needs a type (text/image/files), source (clipboard), capture time/request identity, bounded size and explicit lifetime. Do not persist or log clipboard contents. A read should occur only after a clear user gesture and any required consent/setting. Write should be a distinct capability and should not happen as a side effect of read.

For Phase 6C initial scope, recommend text clipboard only if product approves an explicit user-invoked snapshot flow. Defer clipboard images and files until payload bounds, secure image transfer, opaque file handles, cleanup and Windows clipboard ownership semantics are defined. Never simulate Ctrl+C to obtain selected text and never overwrite clipboard as a capture mechanism.

## 12. Windows Context / Selection Findings

| Candidate | Current evidence | Classification |
|---|---|---|
| Launcher input text | Native Launcher owns QueryBox and passes explicit query through typed search/action flow | Reliable now |
| URL | Saved website/app catalogue already has explicit URLs, and external open is Main-owned | Reliable as a user-selected website/URL, not as arbitrary foreground-page metadata |
| Clipboard text | Current code writes clipboard but has no product read/snapshot API | Requires new Native or Main integration and explicit permission policy |
| Clipboard image/files | No product reader or bounded transfer contract | Requires new integration; defer |
| Selected text | No UI Automation/foreground selection implementation; do not synthesize Ctrl+C | Application-dependent; high risk across arbitrary apps |
| Explorer selected file(s) | Existing Everything results have host-owned opaque tokens for selected search results, not current Explorer selection capture | Requires new Explorer/Windows integration |
| Foreground window/title/process | No product foreground-window query path found | Requires new Native integration; privacy-sensitive |
| UI Automation context | No production UIA implementation found | Application-dependent and requires new Native integration |
| Screen capture | No production screen capture found | Requires new Native integration and explicit sensitive permission; defer |
| Mouse/keyboard | Existing hotkey infrastructure observes specific activation keys; it is not a general selection/context API | Not a reliable general context source |

Do not promise selection support for every Windows application. UIA providers vary, applications may expose no selected-text range, and clipboard-assisted capture can overwrite user state or fail silently. Treat Selection as a source separate from Clipboard; validate with a supported-application matrix before offering it.

## 13. Feature Model Recommendation

Recommended minimum logical contract:

| Candidate field | Recommendation | Reason |
|---|---|---|
| pluginId | Derive from containing package/manifest; do not duplicate | Avoid identity mismatch |
| featureId | Required, stable within plugin | Enables composite identity and safe invocation |
| title | Required, bounded localized display value | Native index and accessible UI need a label |
| description | Optional, bounded | Helpful in Manager, not needed to match |
| commands | Optional bounded aliases/keywords | Needed for Launcher intent matching; not executable text |
| icon | Optional reference to declared validated asset or Host token; defer custom large assets | Avoid duplicating app asset or loading bundles in Native |
| acceptedContexts | Optional explicit declarations, typed by type and source | Enables context-aware matching without implying access |
| entry | Required discriminated union | Separates declarative page and Web bundle without guessing by fields |
| requiredCapabilities | Optional subset of package-level requested capabilities | Documents feature needs; Main still grants at plugin scope initially |

Proposed entry kinds for design discussion:

- declarative-page: page id resolved from the existing validated v1 package.
- web-bundle: fixed package-relative entry document and runtime profile, validated only by a future v2 validator.

Do not copy pluginId, version, hash, enabled state, grants, bundle path or context payload into the Native feature projection as authority. Native needs FeatureRef, title, commands and compact display token. Main resolves the latest package and verifies current identity/state at invocation.

## 14. Context Model Recommendation

Keep type and source distinct:

    PluginContext
    ├── type: text | url | image | file | files | directory | directories
    ├── source: launcher-input | selection | clipboard | website | file-search
    ├── capturedAt / requestId / bounded payload or opaque handle
    └── lifetime: invocation-scoped

This is a concept sketch, not a schema. The same text type can originate from Launcher input, clipboard or a supported selection adapter. Context source does not grant access by itself. acceptedContexts is a matching declaration; actual delivery still requires source policy and relevant capability.

Recommended first slice: Launcher-input text. Optionally add explicit clipboard text snapshot only after user confirms the UX and permission. URLs can be represented as a typed, validated URL context where a user explicitly selected a website or asks the Launcher to invoke a matching feature. Defer image, file(s), directory/directories and general selection.

For file-like contexts, pass opaque Main/Native-owned short-lived handles rather than Windows paths. Validate ownership, target, expiry and one-time or scoped access for every use. For large binary data, use bounded out-of-band transfer rather than copying raw bytes through search rows or the projection cache.

## 15. Command Model Recommendation

Treat commands as metadata for the existing Native matcher:

- Store bounded aliases in the Feature definition; normalize using the same rules as names and aliases.
- Do not parse a command into a shell command, URL, JS function or executable path.
- Resolve a result to a composite FeatureRef and a separately created context snapshot.
- Define collisions at both plugin-local feature id and global normalized command level. Plugin id namespaces feature identity; deterministic ranking handles text collisions.
- Preserve Chinese, pinyin and initials by using existing SearchCore behavior for localized title/aliases; do not imply pinyin support from the declarative parser itself.
- Keep local, website, web-search and Everything modes unchanged.

Ranking alternatives:

1. Merge app/site/Feature candidates into one deterministic rank list and apply a single cap. Simple, but may displace existing app/site results.
2. Preserve the current eight app/website rows, then append a small independently bounded Feature group before contextual actions. More backward-compatible, but can increase rows and needs a cap.
3. Add explicit command mode/prefix for features. Predictable but adds product behavior and conflicts with the global-intent direction.

Recommendation: option 2 as the lowest-regression first proposal, subject to user approval; preserve app/site order and cap, add a small independently bounded Feature group. Keep /, ?, file: unchanged. If product prefers one unified list, specify tie-breaking and compatibility tests first.

## 16. Web Plugin Runtime Alternatives

| Hosting model | Security | Compatibility / UX | Memory / lifecycle | Complexity | Recommendation |
|---|---|---|---|---|---|
| A. Load bundle in trusted Manager route | Poor separation: same origin/page and visible broad window.desktop API; one plugin can reach Manager DOM/API surface | Easiest routing and SDK integration | Lowest incremental WebContents cost, but unload is Vue-dependent and trust is shared | Low | Reject for third-party executable code |
| B. Sandboxed iframe inside Manager renderer | Better DOM/JS realm separation when sandboxed and cross-origin, but shares parent WebContents/process and needs careful postMessage/CSP/storage design | Embedded UX; works with browser bundles | Low-to-medium additional resource; unload iframe on close | Medium; opaque-origin and bridge mistakes are easy | Possible only if threat model verifies origin and message boundary; not preferred |
| C. Separate WebContentsView per active feature embedded in Manager | Strongest fit: own WebContents, per-plugin origin/session, no Manager preload, Main broker | Embedded UX; Manager shell stays consistent; browser bundle compatibility | Adds a renderer while active; destroy on close/Manager exit; no idle runtime | Medium-high | Recommended |
| D. Separate BrowserWindow per active feature | Separate WebContents and clear window boundary | Simple isolation story, but fragmented UX and multiple windows | More visible window/runtime lifecycle; destroy on close | Medium | Fallback if embedding is technically blocked |
| E. webview tag | Electron documentation warns against new use due architectural instability | Familiar embed | Lifecycle and security vary with guest contents | Medium/high | Do not use |

Recommendation C means one active Web runtime at a time initially. Create the Manager only when a Web feature is explicitly invoked. Attach a dedicated WebContentsView, with a unique app-owned plugin origin and non-persistent plugin-specific session. Do not pass the Manager preload; if a bridge is required, expose only an isolated, typed, permission-checked API bound to the exact plugin ref/hash/runtime generation. Do not share one WebContents across plugins. Destroy the view/WebContents and dispose request/session state on feature close; Manager close destroys all child contents before Electron exits.

No runtime pool or preloaded hidden plugin renderer in the first version. If simultaneous Web features are later required, create separately isolated WebContents on demand and set a bounded concurrent count. Network access must be an explicit design decision; default-deny or a per-plugin allowlist enforced by both response CSP and Main/session policy is safer than implicit unrestricted fetch.

## 17. Native Feature Index Authority Alternatives

| Option | Authority / security | Staleness / availability | Atomicity / migration | Memory / complexity | Decision |
|---|---|---|---|---|---|
| A. NativeHost reads Electron plugin registry/packages | Duplicates Main parsing/grants and crosses ownership boundary; exposes package storage to Native | Available while Manager closed, but Native must reproduce current package semantics | Two authorities and coupled schema migrations | More Native code and package IO | Reject |
| B. Main publishes projection over existing pipe; Native caches derived index | Main remains authority; Native can only search/display refs; invocation is revalidated in Main | Cache works while Manager closed; updates arrive on Manager mutation/start; missing/corrupt cache fails closed | Current tested pattern, but projection schema needs a versioned feature shape and atomic cache replacement | Bounded metadata only; moderate incremental work | Recommend |
| C. Main writes shared durable index file read by Native | Main can author derived data, but needs file ownership/ACL, atomic replacement, versioning and corruption handling; risks two channels | Available while Manager closed | File and protocol consistency need coordination | Low query IPC but more filesystem coupling | Consider only if pipe projection becomes a proven bottleneck |
| D. Native starts Manager to refresh before search | Main authority retained | Breaks Electron=0 idle and adds input latency | Avoids stale cache at cost of activation | Highest idle/process cost | Reject |

Recommended model B: Main publishes a bounded, versioned Feature projection through the existing current-user pipe. Native persists it atomically as a rebuildable cache, displays/searches from it while Manager is closed, and never uses it to authorize execution. Missing, malformed, unsupported-version or stale refs fail closed; next Manager startup/catalog change republishes. Add revision/hash or monotonic generation if concurrent update ordering can otherwise install an older projection last.

## 18. Declarative Compatibility Strategy

Keep Manifest v1 archives valid and unchanged. At catalog projection time, map each current v1 plugin’s single entry.pageId/label to one synthetic declarative-page FeatureRef derived from plugin id plus a stable compatibility feature id. The v1 package bytes and SDK output do not change.

For a future v2 Web bundle:

1. Host parser identifies manifest version/type and invokes exactly one strict parser.
2. Package validator applies v1 rules unchanged or v2-specific entry/asset rules.
3. PluginManager stores either version as immutable original bytes under the existing id/version/hash address.
4. A tagged runtime adapter chooses DeclarativeRuntime or the future isolated Web runtime.
5. Registry remains the Host authority for enabled state, requested/granted capabilities and installed identities; any schema change needs explicit migration/backward-read tests.
6. Catalog maps both runtime kinds to Feature DTOs; Launcher gets only metadata projection.
7. Disable, revoke, uninstall, update and Manager close invalidate all associated runtimes and pending calls.

Do not rename .wtplugin, force existing developers to repack, reinterpret Manifest v1 as a Web package, or allow old Host versions to guess at unknown v2 fields. Old Hosts should reject unsupported v2 packages with a safe, explicit incompatibility error.

## 19. Manifest / API Version Recommendation

Manifest version and Plugin API version have different meanings:

- Manifest version describes package/metadata schema.
- Plugin API major describes the compatibility of WebTools host-facing API.
- SDK package version describes the developer library/tooling.
- Product version describes WebTools itself.

| Decision | Option | Compatibility | Recommendation |
|---|---|---|---|
| Manifest extension | A. Add optional fields to v1 | Current canonical parser uses exact closed fields; old Host/SDK rejects new fields. “Optional” is not backward-compatible in this implementation | Do not mutate v1 |
|  | B. Add Manifest v2, continue accepting v1 | Existing packages remain as-is; new Web fields are strict and opt-in | Recommend |
|  | C. Replace .wtplugin/create a new container | Unnecessary; existing bounded ZIP/content-hash pipeline is reusable | Reject absent a proven container limit |
| Plugin API | A. Bump API Major 1 to 2 for all plugins | Would break unchanged v1 packages and require migration | Do not bump globally without an actual breaking API change |
|  | B. Keep API 1 for current semantics; add a versioned Web runtime/bridge contract as an additive profile | Existing plugins remain API1; Web entry explicitly opts in | Recommend |
|  | C. Use API2 only if new semantics cannot be safely represented additively | Clear break when justified | Keep as fallback, not default |

Manifest v2 is warranted because executable Web bundles, entry documents and runtime/security declarations do not fit the current closed declarative-manager shape. This does not imply Plugin API Major 2. Keep SDK 1.1.0 and Product Version unchanged during design; any SDK release/version decision belongs to implementation planning after the contracts are approved.

## 20. Process Model

Keep one resident OS process: WebTools.NativeHost.exe. Add FeatureRegistry, matcher, context coordinator and clipboard adapter as in-process modules. Do not introduce Launcher.exe, SuperPanel.exe, FeatureService.exe, ClipboardService.exe or PluginRegistry.exe.

Electron Manager remains on demand. Launcher can search the metadata projection without starting Electron. Explicit invocation of a Web UI feature may start/reuse Manager and create a WebContents only then. Manager close must destroy every plugin runtime and return the Electron process group to zero while NativeHost, tray and hotkey continue.

The NativeHost pipe/session remains the cross-process seam. A Feature invocation message should contain an opaque typed ref and bounded context envelope, not executable text, filesystem paths or plugin code. Main must resolve current package/state and reject stale or revoked references.

## 21. Memory Model

No Phase 6C runtime measurements exist in this audit. Bundle byte size is not runtime memory.

Expected growth boundaries:

- Native idle: bounded feature metadata, normalized aliases/index data, small symbolic/display metadata only. Index size will grow with feature count and command count; cap both per plugin and globally, avoid parsing ZIPs or loading JavaScript/WASM/assets in Native.
- Manager open: plugin registry and existing declarative runtimes are currently reconstructed/validated at Manager startup; this occurs only after Manager opens. Keep any future Web bundles lazy until explicit feature invocation.
- Active Web feature: one separate renderer/WebContents plus Chromium resources while open. Destroy on close. More concurrent features means more active WebContents; do not pool or prewarm.
- Package bytes: remain disk-backed and hash-verified; read only on install/validation or invocation as required. Do not keep every bundle or heavy asset in Native memory.
- Context: use bounded snapshots/opaque handles with explicit TTL; never keep clipboard image/file payloads in global singleton state.

Candidate later measurements: 0/10/50/100 installed plugin features, recording Native private bytes/managed heap, index size and lookup latency; then one active WebContents, close, and Manager exit. These are implementation/performance tests, not Phase 6C-1 evidence. Require bounded metadata and no idle growth proportional to Web bundle size.

## 22. Security Threat Review

| Threat | Existing control/evidence | Gap and design requirement |
|---|---|---|
| Malicious .wtplugin | Main-owned picker, canonical Host validation, unsigned-source label, explicit install/replace consent, immutable hash | Web code is a new trust class; consent is not a sandbox. Treat every bundle as untrusted |
| ZIP traversal / archive bomb | Strict normalized names, bounded archive/entry/expanded bytes and ratio, exact inventory, CRC; no extraction | Extend same checks to every v2 bundle entry and import path |
| Manifest spoofing / plugin identity collision | Closed exact schema, validated id, registry uniqueness, package hash/id/version verification | Keep plugin id unique; validate feature ids in plugin namespace and reject duplicate composite refs |
| Feature/command collision | No current feature command index | Normalize commands, deterministic ordering, collision diagnostics; never allow command text to choose package path/code |
| Asset path escape | Current declared PNG paths validated against package contents | Validate canonical relative URLs and every runtime asset request; deny traversal, encoded separator tricks and undeclared entries |
| Navigation escape / popup | Manager denies popups and filters top-level navigation | Existing Manager allows file: and localhost by design; Web runtime must be restricted to its own app-owned plugin origin and deny external navigation/popups/downloads by default |
| CSP bypass / XSS | Declarative content is structured data rendered by Host Vue; no author JS | Web runtime needs response CSP, no unsafe-eval unless an approved need, no inline script by default, strict asset origin; XSS becomes execution in that plugin’s granted capability domain |
| Raw IPC / preload exposure | Manager sender/main-frame checks; sandbox/context isolation; typed preload API | Never provide Manager preload to plugin content. Dedicated minimal bridge; verify exact WebContents, frame, origin, plugin/hash/session and current gesture |
| Permission spoofing / stale grant | Main validates declared actions, requested+granted capability, package hash and session; async actions recheck | Bind future bridge requests to one runtime generation; Main rechecks state after prompts and before effects |
| Context substitution | Current typed actions and pipe schemas constrain existing requests | Context must be Main/Native-created, request-scoped, bounded and bound to invoked FeatureRef; renderer cannot submit arbitrary source/provenance |
| Clipboard exfiltration | Current plugin supports only clipboard.write, no read | Add no read by default; explicit user action, separate read capability, no background watchers, persistence or logs |
| Unauthorized file access | No raw filesystem plugin capability; Main-owned file picker reads bounded package; Native file actions use opaque tokens | Future files context must use scoped opaque handles and explicit consent; do not send filesystem paths into plugin renderer |
| Network access | Current declarative runtime has no web fetch execution | Define default-deny/domain grants; enforce CSP and Electron session/request policy; separate external.open from fetch access |
| Persistent background activity | Current declarative runtime owns no webContents/worker/service worker; stop aborts operations | Deny service workers/background pages/notifications unless a later reviewed requirement; destroy all runtime contents on close |
| Runtime escape | Current plugin cannot execute code; Electron sandbox settings apply to trusted Manager window | Sandboxing reduces risk but does not prove zero-day immunity; keep Electron patched and minimize bridge authority |
| Plugin-to-plugin isolation | Declarative plugins have separate data namespace through PluginStore | Separate WebContents, origin and non-persistent per-plugin session; no shared JS global, storage partition, or unrestricted cross-plugin messaging |
| Plugin-to-Manager isolation | Current data DTO and Host-rendered page | Web bundle must not share Manager DOM, preload, localStorage or main-frame origin |
| Host authority bypass | Native projection is explicitly derived and Main rechecks current state on open | Preserve Main as the only grant/package/effect authority; projection must never authorize invocation |

## 23. Migration Risks

1. Adding Web execution to Manifest v1 would contradict the current closed parser and invalidate older Host compatibility. Freeze v1.
2. Adding commands/feature ids to Native projection changes its schema; current Native parser accepts only projectionVersion 1 exact keys. Introduce an explicit versioned projection migration and fail closed on unknown versions.
3. Current catalog only projects enabled plugins with manager.page. Feature visibility must instead derive from enabled runtime kind and grants, not an accidental page permission.
4. The current registry’s status conflates package enabled state and declarative runtime activation. A Web runtime needs separate Installed, Enabled, Indexed and Runtime state, without falsely marking all indexed features as loaded.
5. In-flight consent, AI review, file/context handles and WebContents may finish after disable/update/uninstall. Reuse generation/session cancellation patterns and bind every pending action to exact package hash.
6. Old Host versions must continue to read v1 packages and reject v2 safely. Update sequencing must not leave users with a package newer than their Host can understand.
7. Custom protocol and session partition behavior must be tested on the project’s Electron version, including Windows paths with spaces/Unicode. Do not expose direct filesystem bundle paths in renderer-visible URLs or APIs.
8. Clipboard, selection and files have distinct privacy and ownership semantics. Treating them as generic JSON context would risk leaking or persisting sensitive data.
9. Feature commands can collide with each other and existing apps/websites. Ranking and result-cap behavior need a product decision and parity tests before changing Launcher results.
10. A second WPF surface needs an explicit host shutdown/focus/owner model because MainWindow close currently triggers host shutdown.

## 24. Open Questions Requiring Human Approval

Recommendations are stated, but these product/security decisions remain open:

1. **Runtime isolation:** approve separate on-demand WebContentsView per active Web Feature as the default, with one active plugin runtime at a time? If not, choose iframe or separate BrowserWindow and accept the corresponding isolation/UX trade-offs.
2. **Network policy:** should Web plugins be denied outbound fetch by default and request a bounded domain allowlist, or can they use arbitrary web requests after a separate consent? This changes supply-chain/exfiltration risk.
3. **Initial context:** should the first Web runtime support only Launcher-input text, or also an explicit clipboard text snapshot? If clipboard is included, confirm the permission prompt and whether it is per plugin, per invocation, or remembered grant.
4. **Feature result placement:** should Feature rows be appended after the existing eight app/website rows, or share the same eight-result cap? Recommendation is append a small bounded group to preserve current ordering.
5. **Capabilities:** keep grants plugin-wide for first compatibility release, or require per-feature grants from the first Web package? Recommendation is plugin-wide requested/granted with validated per-feature needs as a subset, then revisit finer grants with actual use cases.
6. **Persistent plugin UI state:** should Web runtime use existing Main-owned PluginStore only, or allow per-plugin browser storage in an isolated persistent partition? Recommendation is Host store only initially; do not enable persistent Web storage before a recovery/uninstall policy is decided.
7. **Super Panel close/focus:** should closing Launcher while Super Panel is open hide Launcher but keep NativeHost running until both surfaces/explicit Exit are resolved? A lifecycle rule is required before implementation.

## 25. Recommended Phase 6C Design Tasks

These are proposed design tasks only, not authorized implementation:

1. **Threat model and trust boundaries:** define package source, attacker capabilities, WebContents origins, session partitions, navigation, CSP, network, bridge and failure behavior.
2. **Feature contract:** define stable composite identity, title/commands/entry union, accepted contexts, icon metadata and capability subset rules.
3. **Context contract:** define type vs source, snapshot timing, size limits, expiry, privacy, clipboard policy, file handles and error/fallback states.
4. **Native Feature Index:** define Main-authoritative projection v2, compatibility with projection v1, ordering/revision behavior, cache corruption/staleness and invocation revalidation.
5. **Search integration:** specify matcher reuse, localization/pinyin, collision ranking, Local-only behavior and row-cap behavior with explicit regression cases.
6. **Package and Manifest v2:** define Web bundle inventory, entry document, asset MIME/size/count limits, protocol URL mapping, content-hash identity and old-Host error behavior.
7. **API/SDK evolution:** retain SDK package scope, add framework-agnostic author workflow, typed bridge versioning and local archive validation while Host remains final authority.
8. **Runtime lifecycle:** define Dormant → Invoke → Load → Active → Close → Unload, package update/disable/revoke cancellation, no-pool rule, Manager-close teardown and one/multiple runtime limits.
9. **Compatibility/migration:** write v1 package fixtures and migration table, registry/projection schema plan and rollback/error scenarios.
10. **Verification plan:** hostile archive tests, sender/origin tests, context privacy tests, invocation replay/staleness tests, Windows install/launch/close checks, and native idle process gate.

## 26. Recommended Phase 6D Implementation Boundaries

After the design is approved, Phase 6D should implement in bounded dependency order:

1. Freeze and regression-test v1 parser, package, SDK workflow, install, grants, and declarative rendering.
2. Add typed Feature contract and v1 adapter without changing existing package bytes or UI semantics.
3. Add Main-authored versioned Feature projection and Native cache reader with corruption/staleness tests.
4. Extend the current SearchCore and typed action union; test existing app/site/web/file modes for unchanged behavior.
5. Implement context transport only for approved initial types/sources; never expose raw paths or ambient clipboard.
6. Add v2 manifest/package validation and framework bundle packing; Host validation remains authoritative.
7. Add isolated on-demand Web runtime and narrow bridge only after security decisions; destroy it deterministically on close/revoke/update/Manager exit.
8. Add Developer Acceptance tests and Windows installed-build verification before declaring the new runtime usable.

Out of scope for the first Web runtime unless separately approved: new resident processes, OCR/PDF/image/video/audio Host APIs, native addons, arbitrary filesystem, child processes, unrestricted Node/Electron APIs, background workers/service workers, runtime pooling, and Super Panel implementation.

## Verification and Evidence Summary

### Automated checks run for this audit

| Check | Result | Why it was run |
|---|---:|---|
| Plugin/SDK/IPC focused Node suite | 82/82 passed | Verifies current parser, package validator, lifecycle, permission, catalog and IPC evidence used by this audit |
| dotnet run --project native/WebTools.NativeHost.Checks --no-restore | 68/68 passed | Verifies current Native search, projection cache, pipe/lifecycle contracts relevant to Feature Index design |
| git diff --check | Clean at baseline; rerun after this document | Required whitespace validation; existing four files have line-ending advisories only |

Node emitted existing MODULE_TYPELESS_PACKAGE_JSON warnings while loading TypeScript modules as ESM. They did not fail tests and are not changed by this audit.

No production runtime, installer, profile, clipboard, registry, tray, or installed application was modified or exercised. No product code, schema, dependency or package was changed.

### Severity summary

| Level | Count | Finding |
|---|---:|---|
| P0 | 0 | No current critical defect identified |
| P1 | 0 | No current high-severity defect identified |
| P2 | 3 | Web runtime isolation/navigation policy; context and clipboard privacy contract; Feature Index/versioned invocation authority contract. These block safe Phase 6C implementation until design approval |
| P3 | 2 | Search result cap/ranking needs an explicit policy; two-window Native shutdown/focus policy needs definition. Neither is a current product failure |

**Conclusion:** the current Declarative Plugin platform is a reusable foundation, but an executable Web Plugin is a new trust boundary. Preserve current v1 behavior, define and approve the isolated runtime, context, network and Feature-index contracts before implementation.

**Phase boundary:** PHASE 6C-1 ARCHITECTURE AUDIT COMPLETE. Implementation NOT started. Awaiting human review; do not begin Phase 6C implementation or Phase 6D from this report alone.

## Phase 6C-3 architecture decision addendum — 2026-10-06

This addendum records decisions approved after the Phase 6C-1 audit and Phase 6C-2 specification review. The audit observations, test counts and severity table above remain historical and are not rewritten. Where its recommendations or open questions differ from the later approved design, the Phase 6C-3 [architecture freeze](phase6c-architecture-freeze.md) and linked Phase 6C design documents are authoritative.

- Manifest v1 remains immutable; v1 Declarative Plugins receive one deterministic synthetic Feature through a read-time adapter. Manifest v2 is Web Feature-only, in the same .wtplugin container; Plugin API Major remains 1 unless a breaking Host API semantic change is approved.
- Package-local WebAssembly is supported as sandboxed browser computation without a Host capability. Its closed inventory entry, application/wasm media type, size bound, CSP, unique origin and runtime lifecycle remain enforced. WASM support does not permit native executables, DLLs, addons, Node, child processes or OS access.
- network.mode none is a supported Web Runtime profile independent of network.domains. Domain access remains disabled until exact-host connection enforcement, DNS/IP pinning, redirect/retry validation and bypass resistance are demonstrated.
- Opening Super Panel does not access the clipboard. Choosing the Native-owned Clipboard Context action is the one-shot capture gesture and previews a bounded local snapshot. A Plugin grant is still required for delivery; actual Native/Manager peer authentication is mandatory before sensitive Context crosses the pipe. The self-reported hello PID and CurrentUserOnly ACL are not executable authentication.
- First-release Feature, projection and Context capacities are engineering/safety bounds, not permanent SDK or Product Contract ceilings. One active Rich Web Feature runtime is allowed; close/revoke/cancel/destroy/prove teardown before opening another.
- The existing native process model, on-demand Manager lifecycle, Main authority, Native projection non-authority, Plugin-wide grants, transient Web storage, fail-closed updates and the separation between plugin business algorithms and Host integrations remain frozen.

Current severity counts and Phase 6D mandatory gates are maintained in the architecture freeze report, not in this Phase 6C-1 historical audit.
