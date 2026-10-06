# Phase 6C-2 — Plugin Platform Design Specification

**Status:** architecture design frozen after approved revisions; implementation is not started

**Phase 6C-1:** COMPLETE
**Phase 6C-2:** APPROVED WITH DESIGN REVISIONS
**Phase 6C-3:** COMPLETE
**Phase 6D:** NOT STARTED
**Scope:** design only. This specification does not authorize production implementation.

## 1. Purpose and boundaries

This specification turns the approved Phase 6C-1 architecture into reviewable contracts for Features, context, Manifest v2, the Web runtime, the narrow bridge, Native projection, migration, and UI flow. Companion documents contain field-level and security details:

- [Feature and context contracts](phase6c-feature-context-contract.md)
- [Web bundle and runtime security](phase6c-web-runtime-security-design.md)
- [Native Feature projection](phase6c-native-feature-projection.md)
- [Interaction wireframes and lifecycle sequences](phase6c-product-interaction-wireframes.md)
- [Manifest migration and compatibility](phase6c-migration-design.md)
- [Phase 6C-1 audit](phase6c-plugin-platform-audit.md)
- [Phase 6C-3 architecture freeze](phase6c-architecture-freeze.md)

Phase 6C-2 does not change product code, schemas, parser behavior, Plugin API, SDK public API, NativeHost, user data, or package bytes. TypeScript and C# snippets are design examples, not source files.

## 2. Existing code facts that constrain the design

The current repository has one WPF NativeHost and an on-demand Electron Manager. The Manager has one production BrowserWindow and switches Vue sections inside that renderer. The trusted Manager preload exposes a broad application API and therefore is not a safe Web Plugin bridge.

The existing plugin system is declarative: Manifest v1 is a closed schema, .wtplugin is a bounded ZIP archive, Main validates package bytes and owns grants/effects, and the SDK validator is not the install-time authority. NativeHost receives a bounded presentation cache through the current-user pipe; it does not own the plugin registry. SearchCore already handles application, website, web, and file result kinds and their established ranking/caps.

Source cross-checks: electron/main.ts (createWindow and Manager close lifecycle); electron/preload.ts; electron/ipc/window-security.ts; src/shared/plugin-contracts.ts; plugin-sdk/declarative-v1/runtime/manifest-v1.mjs; plugin-sdk/declarative-v1/runtime/package-v1.mjs; electron/plugins/plugin-manager.ts; electron/plugins/plugin-registry.ts; electron/plugins/plugin-store.ts; electron/plugins/plugin-catalog.ts; native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs; native/WebTools.NativeHost/Data/LauncherPluginProjectionStore.cs; native/WebTools.NativeHost/Search/SearchCore.cs.

These are source observations, not claims of installed-runtime verification. Phase 6C-1 found no production WebContentsView runtime or clipboard-read feature.

## 3. Approved architecture decisions

The following are inputs, not reopened proposals:

1. **Plugin and Feature are different concepts.** A Plugin owns package identity, grants, settings and one or more Features. A Feature is the invocation unit. Launcher intent and Super Panel context use the same Feature Registry and Matcher.
2. **Native ownership stays in one process.** Launcher, future Super Panel, context capture and Feature matching stay within WebTools.NativeHost.exe. No resident helper process is added. When Manager is closed, the Electron process group is zero.
3. **Manager is on demand.** It remains the management, permission, settings, shared-AI and rich-UI surface, not a resident plugin host.
4. **Web runtime is isolated and explicit.** One active Web Feature at a time is the first-release default. Each invocation creates a separate WebContentsView-backed WebContents; it never uses the trusted Manager renderer or Manager preload. There is no prewarm, hidden runtime pool or persistent plugin renderer.
5. **Manifest v1 is frozen.** Existing .wtplugin files remain byte-for-byte valid. New Web/Feature packages use a separately validated Manifest v2 in the same .wtplugin container.
6. **Plugin API Major 1 remains the compatibility baseline.** A Manifest version change does not itself require an API major change.
7. **Native projection is presentation data only.** Main publishes a bounded, versioned Feature projection. NativeHost caches it for search and display; Main revalidates every invocation.
8. **Existing search commands remain unchanged.** /, ?, and file: retain their current routing. Existing app/site ranking and caps are preserved; Plugin Features use a separately bounded group of at most 6 rows and never displace or reorder app/site results.
9. **First context sources are text from Launcher input and text from the OS clipboard.** Clipboard read and write are separate capabilities. Opening Super Panel does not read the clipboard. The user explicitly chooses the Native-owned Clipboard Context action; that action authorizes one local, bounded, one-shot capture and preview. A Plugin receives the snapshot only after Main validates the selected Feature and plugin-wide grant, and the sensitive Native/Manager transport gate passes. Context is invocation-scoped, not persisted and not logged.
10. **Grants remain plugin-wide.** A Feature may narrow access by declaring required capabilities, which must be a subset of the Plugin's requested capabilities. No complex per-Feature grant UI is introduced.
11. **Host PluginStore remains the durable storage contract.** Persistent Chromium localStorage, IndexedDB or profile state is not a supported plugin-data contract.
12. **Native window lifetime is not host-process lifetime.** Closing or dismissing Launcher or Super Panel hides that window. Only explicit WebTools Exit, fatal host shutdown or OS/session shutdown ends NativeHost.
13. **Package-local WebAssembly is supported inside the sandboxed Web runtime.** It is browser-side computation, needs no additional Host capability, and remains subject to exact package inventory, MIME/size bounds, CSP, origin isolation and runtime teardown. It does not permit native executables, DLLs, addons, Node, child processes or OS access.
14. **Network is independently gated.** A Web Runtime with network.mode none can ship without domain networking. network.domains stays unavailable until exact-host connection enforcement, DNS/IP pinning and bypass resistance are proven; failure of that gate does not disable the base Web Runtime.
15. **Sensitive context transport requires actual peer authentication.** CurrentUserOnly pipe ACLs and a self-reported PID are not executable identity. Authenticate the actual connection peer, bound to the expected launched Manager executable/lifecycle, before any sensitive Context crosses the channel. Ordinary non-sensitive projection remains a separate path.
16. **First-release capacities are engineering and safety bounds, not permanent Product Contract or SDK limits.** The initial bounds are 16 Features per Plugin, 2,000 enabled/projected Features globally, a 3 MiB projection payload, and the Context bounds in the companion contract. Raising them requires evidence and a versioned projection change where needed.
17. **One active Rich Web Feature runtime is the first-release maximum.** Revoke its bridge generation, cancel requests, destroy its WebContents and prove teardown before opening another. No pool or prewarm is allowed.

## 4. Logical architecture

~~~text
WebTools.NativeHost.exe
  LauncherWindow ─┐
  SuperPanelWindow├─ Native Feature Matcher ── Native Feature projection cache
  Tray / hotkey ──┘              │                              ▲
                                 │ FeatureRef + ContextRef       │ current-user pipe
                                 ▼                              │
                         Electron Main ── PluginManager/Store/Grants
                            │       │
                            │       └── bounded projection publisher
                            │
                            ├── existing trusted Manager BrowserWindow / Vue shell
                            │
                            └── isolated WebContentsView (only during explicit Web Feature use)
                                  └── app-owned plugin origin + narrow, per-runtime bridge
~~~

The Feature Registry is a Main-owned authoritative catalog plus a sanitized Native projection. Native matching is an optimization and UX entry point; it never grants access or resolves package files.

## 5. Core contracts at a glance

- **Identity:** FeatureRef = (pluginId, featureId). IDs are stable within their owner. A Plugin can own multiple Features; equal feature IDs in different Plugins are not equal Features.
- **Entry kinds:** v1 compatibility page or v2 static Web bundle. A v2 Web Feature references a document in its immutable package; it does not contain an arbitrary URL.
- **Matcher:** normalized title, bounded command aliases and Plugin identity are indexed. Context acceptance is an eligibility filter, not a grant.
- **Invocation:** a tagged, one-shot request identifies Feature, Native host session, invocation ID, optional context reference and user gesture. Main resolves the latest package and checks enabled/grant/hash/runtime state before opening or invoking.
- **Projection:** only display/search metadata crosses to NativeHost. It contains no filesystem path, package bytes, raw manifest, secret, executable content or permission authority.
- **WebContents:** sandboxed, context-isolated, Node-disabled, no Manager preload, no external main-frame navigation, no popup/download, no persistent plugin profile and no service worker.
- **Durable state:** Web plugins call the narrow bridge; Main routes data through the existing Host-owned PluginStore bounds and atomic-write semantics.

Field-level TypeScript/C# drafts and JSON examples are in the [Feature and context contract](phase6c-feature-context-contract.md). Manifest limits and examples are in the [migration design](phase6c-migration-design.md).

## 6. Invocation and lifecycle

### Launcher → Web Feature

~~~mermaid
sequenceDiagram
    participant U as User
    participant L as Native Launcher
    participant N as NativeHost
    participant M as Electron Main
    participant V as Isolated WebContentsView
    U->>L: Type query and select a Feature row
    L->>N: FeatureRef + host session + invocation ID
    N->>M: Feature invocation over current-user pipe
    M->>M: Resolve current package; validate enabled, hash, grants, context and runtime state
    M->>M: Start or reuse the one Manager process
    M->>V: Create a fresh WebContentsView and load package entry
    V-->>M: Runtime-ready for matching generation
    M-->>N: Invocation accepted / runtime opened acknowledgement
~~~

When the selected Feature accepts launcher-input:text, the selected query is captured once and bound to this invocation. Merely searching does not broadcast the query to plugins. If the Feature does not accept that source, no query context is attached.

### Runtime teardown

~~~mermaid
sequenceDiagram
    participant U as User
    participant M as Electron Main
    participant V as Plugin WebContentsView
    participant S as Ephemeral plugin session
    U->>M: Close Feature
    M->>V: Revoke bridge generation; stop accepting requests
    M->>V: Remove view and close WebContents
    M->>S: Clear this runtime origin transient site data/cache
    M->>M: Drop runtime descriptor and pending requests
    M-->>U: Return to Manager shell
~~~

BaseWindow close does not automatically destroy child WebContentsView contents. Manager close therefore explicitly removes and closes every plugin WebContents before allowing Electron Main to quit. This is a hard lifecycle requirement, not an optional cleanup optimization. Electron documents this behavior in [BaseWindow](https://www.electronjs.org/docs/latest/api/base-window) and the independent view model in [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view).

### One active Web Feature

Opening another Web Feature while one is active asks the active runtime to close and waits for destruction before creating the next one. If close does not complete within a bounded timeout, do not create a second runtime; show a host-owned error and retain the ability to close the Manager. The design does not silently stack WebContentsViews.

## 7. Manifest v2 and bundle summary

Manifest v2 is a new, closed schema. It uses the same .wtplugin archive and content-addressed package storage, with a fixed list of allowed static bundle entries. The Host must validate the archive, exact entry inventory, references, path normalization, decompressed sizes and MIME types during installation. The SDK packer may produce early diagnostics, but Host validation remains the final authority.

The v2 entry is web-bundle and references a package-relative document. It is not an HTTP URL and cannot select an executable, filesystem path or arbitrary origin. Existing v1 packages are projected to a stable synthetic Feature at read time; v1 bytes and the v1 parser remain unchanged.

Full archive policy, CSP, navigation, worker, WASM, MIME and development-mode rules are in the [Web runtime security design](phase6c-web-runtime-security-design.md).

## 8. Native search and context

SearchCore remains the single Native matcher. Existing app/site results keep their current route, ordering and cap. Feature results are produced in a separate group with its own cap and cannot displace an existing application or website result.

For a Launcher-input Feature invocation, FeatureRef and the captured query are sent together. For Super Panel, the Native window captures one approved source, creates a short-lived context snapshot, and presents matching Features. acceptedContexts decides whether a Feature may be offered for a given source. It does not let a Plugin read the clipboard or any other resource by itself.

Clipboard Context flow is explicit and does not add a duplicate confirmation:

1. Opening Super Panel does not read the clipboard. The user explicitly chooses the Native-owned Clipboard Context action.
2. NativeHost captures one bounded text snapshot, shows a bounded preview and runs the shared Feature Matcher. The snapshot remains Native-owned during preview and matching.
3. The user chooses a matching Feature. Main revalidates the current Feature/package, enable state, accepted context, plugin-wide clipboard.read request and grant, invocation and runtime state.
4. Before the snapshot crosses NativeHost ↔ Manager transport, the actual pipe peer must pass the mandatory executable-identity gate. A payload PID or CurrentUserOnly ACL alone is insufficient.
5. Only then is the one-shot snapshot delivered to the exact invocation/runtime generation; it is never exposed through an ambient renderer clipboard method.

No background polling, clipboard history, synthetic Ctrl+C, or silent clipboard overwrite is permitted. Details and bounds are in the [context contract](phase6c-feature-context-contract.md).

## 9. Security invariants

The following MUST hold in any future implementation:

1. Main is the authority for package identity, grants, enable state, storage, network policy and invocation.
2. A Native projection row never authorizes a Feature. Main resolves the live registry again for every invocation and effect.
3. Feature capabilities are a subset of Plugin requested capabilities; user grants are independently required.
4. Web Plugin content never receives window.desktop, Node, Electron modules, Manager DOM, Manager origin, raw filesystem paths or raw IPC.
5. Every bridge call is bound to exact WebContents ID, top frame, runtime generation, package ID/version/hash, FeatureRef and current invocation; state is rechecked before and after asynchronous host effects.
6. Context values are data, not authority. Context is source-checked, bounded, short-lived, one invocation only, and absent from logs/storage/telemetry.
7. Network-enabled Web Features use a per-session policy and connection-level DNS/IP pinning. URL-string filtering alone is insufficient to prevent DNS rebinding.
8. All external main-frame navigation, popups, downloads, permission requests and service-worker registration are denied by default. External links require a Main-mediated, user-confirmed external.open.
9. Runtime close, plugin disable/update/uninstall, permission revocation, Manager close and renderer crash revoke bridge sessions and destroy the corresponding WebContents.
10. Closing both Native windows does not terminate NativeHost. Explicit Exit is the product-level shutdown path.

## 10. Compatibility rules

| Input/runtime state | Required behavior |
|---|---|
| Existing v1 declarative package on new Host | Accept unchanged; project one deterministic compatibility Feature |
| v2 Web package on supporting Host | Install-time Host validation, permission review, disabled until user enables |
| v2 package on older Host | Reject as unsupported; do not partially install or mutate v1 state |
| Disabled package | Keep management record; exclude from active Feature projection and reject invocation |
| Unknown v2 key or entry kind | Reject the package; no permissive unknown-field fallback |
| Unsupported Plugin API major | Show incompatible state; no runtime creation |
| Corrupt Native projection | Use safe empty/rebuildable cache and request a complete Main snapshot on reconnect |
| Stale projection row | May be displayed as stale only while Manager starts; Main rejects stale authority and returns a refresh |
| Web runtime crash | Revoke that generation, destroy its view, retain plugin installation, allow explicit retry |

Detailed migration and rollback behavior is in the [migration design](phase6c-migration-design.md).

## 11. Native window and process state

~~~text
NativeHost: Running | ExplicitExit | FatalShutdown | OSShutdown
Launcher:   Hidden | Visible | Focused
SuperPanel: Hidden | Visible | Focused
Manager:    NotRunning | Running
~~~

Launcher and Super Panel transitions never mutate the NativeHost process state. Closing Manager destroys its BrowserWindow and every plugin WebContents; it does not close NativeHost. Tray Exit explicitly closes both Native windows, asks Manager to stop gracefully, disposes hotkey/pipe/tray resources and ends the process.

The [wireframe and lifecycle document](phase6c-product-interaction-wireframes.md) expands the states and diagrams.

## 12. Design review findings and implementation gates

### Source/design mismatch addressed here

The current Main window policy permits local-file navigation and the existing trusted Manager preload is broad. Neither is suitable for plugin WebContents. The design therefore gives each plugin runtime its own WebContents, origin, deny-by-default navigation policy and a separate minimal preload. This does not change the current Manager's pre-existing policy in Phase 6C-2.

The current pipe projection is version 1 and contains declarative plugin shortcuts only. Feature Projection v2 is a separately versioned message/cache design; it must not reinterpret v1 rows as a new authority. The current-user-only named pipe does not authenticate the peer executable: its hello processId is self-reported in the reviewed source. Actual peer authentication is a mandatory gate before sensitive Context transport. Ordinary non-sensitive Feature metadata projection does not depend on that clipboard/context gate.

Electron's webRequest reports URL/initiator and request metadata but does not itself guarantee the actual connected IP remains in the approved public address range. Connection-level DNS/IP pinning and bypass resistance remain mandatory before enabling network.domains. The base Web Runtime with network.mode none is independent and is not blocked by this feasibility gate.

### Severity

| Level | Count | Finding |
|---|---:|---|
| P0 | 0 | No current product defect identified in this design-only pass |
| P1 | 0 | No current product defect identified in this design-only pass |
| P2 | 4 | Future implementation gates: connection-level network enforcement/DNS rebinding proof; exact WebContents/preload teardown and sender binding; fail-closed projection generation/rollback verification; authenticate the Manager pipe peer before sensitive clipboard/context transfer |
| P3 | 2 | Non-blocking validation: responsive WebContentsView geometry inside the Manager shell; real-world query ranking and context-match tuning |

P2/P3 describe future implementation verification, not defects in current declarative plugins.

### Decisions closed by Phase 6C-3

The Phase 6C-3 architecture freeze records the approved WASM, network sequencing, clipboard gesture, peer authentication, capacity, lifecycle and compatibility decisions in [phase6c-architecture-freeze.md](phase6c-architecture-freeze.md). No further product architecture choice is open in this specification. Phase 6D still requires separate implementation authorization and must satisfy the mandatory security gates in the freeze report.

## 13. Phase boundary

**PHASE 6C-2: APPROVED WITH DESIGN REVISIONS**

**PHASE 6C-3: ARCHITECTURE FROZEN**

**PHASE 6D: NOT STARTED — production implementation is not authorized by this design revision.**
