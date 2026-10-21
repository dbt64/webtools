# Phase 6E-1 Web Plugin Runtime Audit

**Audit status:** `PHASE 6E-1 AUDIT COMPLETE`<br>
**Implementation status:** no Phase 6E runtime, Manifest v2 parser, or SDK v2 was implemented.<br>
**Recommendation:** `READY FOR PHASE 6E-2` (design and implementation planning only; do not execute untrusted Web Plugins until the isolation and network gates below pass).

This is a source-and-design audit, not a packaged-runtime security certification. Findings are based on the current checkout and the frozen Phase 6C/6D documents. Electron behavior is cross-checked against the Electron `v44.4.5` first-party documentation linked in Section 4. No Windows plugin-runtime acceptance was possible because no Web runtime exists yet.

## 1. Status

`PHASE 6E-1 AUDIT COMPLETE`

The present product only runs the closed declarative v1 plugin model. No third-party JavaScript/Web bundle is loaded by the current PluginManager. Gate 1 (WebContents isolation) and Gate 4 (connection-level enforcement for `network.domains`) remain future Phase 6E release gates, not claims that a current Web runtime passed them.

Severity summary:

| Level | Count | Finding |
|---|---:|---|
| P0 | 0 | No current critical product defect identified in the audited plugin execution path. |
| P1 | 0 | No confirmed current high-severity defect identified. |
| P2 | 1 | The existing Manager BrowserWindow security policy is not a third-party Web Plugin boundary and must not be reused for one. This is a Phase 6E implementation gate; current plugins do not execute author JavaScript. |
| P3 | 2 | No production CSP is authored for Manager content; packaged Web framework compatibility and custom-scheme cleanup still require real runtime acceptance. |

The P2 item is detailed in Section 4 and must be treated as a hard prerequisite for execution of untrusted content, not as evidence of an exploitable current plugin feature.

## 2. Current Repository State

| Field | Audited value |
|---|---|
| Branch | `codex/shared-ai-translation-2.0` |
| HEAD | `62b9774ad851f7c7159fbc6539f7d8771400d632` (`feat: complete phase 6d feature platform foundation`) |
| Upstream | `origin/codex/shared-ai-translation-2.0` |
| Ahead / behind | ahead 4 / behind 0 at audit start |
| Worktree at audit start | clean |
| Phase 6D checkpoint identity | `62b9774ad851f7c7159fbc6539f7d8771400d632` |
| Node package layout | root WebTools package plus the separately packageable `plugin-sdk/declarative-v1` package; no pnpm workspace/monorepo |
| Node package manager | root `package.json` pins `pnpm@9.15.9` |
| Electron | root range `^44.4.5`; lockfile resolves `44.4.5` |

This audit adds only this document. No source, dependency, package schema, or user-data change is included. Phase 6D baseline values below are inherited from the approved task/report, not rerun as part of this audit: `pnpm run typecheck`, `pnpm test` (410/410), `pnpm run build`, NativeHost Checks (71/71), UpdateHelper (10/10), Release Contract (13/13), and human acceptance (14/14 PASS). Phase 6D Gate 2 (actual pipe peer authentication) and Gate 3 (projection fail-closed) remain complete.

Audited source and design include `electron/main.ts`, `electron/preload.ts`, `electron/ipc/*`, `electron/plugins/*`, `electron/services/feature-invocation-service.ts`, `electron/services/shared-ai-service.ts`, `electron/services/ai-credentials.ts`, `electron/services/secret-store*.ts`, `src/shared/plugin-contracts.ts`, `src/shared/feature-contracts.ts`, `src/shared/feature-invocation-contracts.ts`, `plugin-sdk/declarative-v1/*`, `package.json`, `pnpm-lock.yaml`, and the Phase 6C/6D architecture, migration, security, projection, peer-authentication, and invocation documents. No `packages/` directory, workspace file, Web plugin runtime, `BrowserView`, `WebContentsView`, or v2 package implementation exists.

## 3. Existing Plugin Architecture

### Current execution path

```text
User-selected .wtplugin bytes
  → trusted Manager renderer requests install
  → Electron Main file dialog reads bounded bytes
  → Host canonical v1 validator validates the archive and Manifest
  → immutable content-addressed package + Main-owned registry/store
  → PluginManager initializes when Manager starts
  → DeclarativeRuntime interprets closed page/action DTOs
  → trusted Vue Manager renders DeclarativePluginView
  → Main PermissionBroker authorizes a closed host action
  → Main service / capability effect
```

This is data interpretation, not an embedded author-code runtime. `src/shared/plugin-contracts.ts` explicitly labels v1 as closed data contracts with no executable plugin code. `DeclarativeRuntime` has a fixed action switch and does not load modules, evaluate source, create a process/worker, or create WebContents. `PluginManager` may retain a small declarative runtime object for an enabled v1 package while Manager is open; that object is not a renderer and is destroyed with PluginManager/Manager lifecycle. The architecture freeze rule that enabling a future Web plugin must not make its runtime resident should not be confused with this current in-memory v1 interpreter state.

### Main, NativeHost, and Feature authority

- Electron Main owns PluginManager, validation, immutable installed bytes, permissions, PluginStore, AI dispatch, feature registry/projection publication, and live invocation authorization.
- NativeHost owns the always-resident Launcher and consumes a bounded Feature projection for search/presentation. It does not read `.wtplugin`, parse HTML, run JavaScript, or hold permission authority.
- Launcher invocation crosses the authenticated NativeHost↔Manager pipe. Main revalidates current session, FeatureRef, plugin enabled/active state, immutable package hash, capabilities, and the resolved feature before dispatch. Projection rows and request payload IDs are not authorization.
- Built-in Translation has reserved identity `(webtools.translation, translate-text)` and is checked via Main's built-in lifecycle, rather than being inferred from a search row.
- Manager is on demand. Manager close destroys its BrowserWindow/WebContents and exits the Electron process group; NativeHost remains resident.

The Phase 6D design therefore already has the correct authority direction for a Web runtime: Web code must call a deliberately narrow Main capability bridge; neither Native projection nor plugin-provided identity can authorize work.

The current plugin action model has no arbitrary process-launch capability. `external.open` accepts HTTPS URLs and is routed through Main consent and `shell.openExternal`; it is not a shell command. The separate Everything integration uses Main-side `execFile` to call the configured Everything executable with bounded arguments; that service is not exposed as a plugin action or raw process API. Do not turn it into a Web capability as part of this phase.

## 4. Existing Electron Security Model

### Current renderer and plugin execution shape

`package.json` requests Electron `^44.4.5`; `pnpm-lock.yaml` resolves Electron `44.4.5` (`package.json:31`, `pnpm-lock.yaml:1058`). The audit below uses Electron's first-party documentation at the `v44.4.5` tag.

`electron/main.ts#createWindow()` is the only `new BrowserWindow(...)` call in the application source (`electron/main.ts:252-275`). It loads `file:.../renderer/index.html` when packaged and `ELECTRON_RENDERER_URL` in development (`electron/main.ts:317-320`). There is no `WebContentsView` construction or other plugin-owned `WebContents` in the current source.

The current plugin contract is `declarative-manager`: the v1 contract says plugin content is data, and `DeclarativeRuntime` returns a page DTO and invokes closed host actions rather than loading plugin JavaScript (`src/shared/plugin-contracts.ts:1-3, 22-36`; `electron/plugins/declarative-runtime.ts:8-34`). The fixed `DeclarativePluginView` Vue component renders the DTO's blocks in the Manager renderer (`src/features/plugins/DeclarativePluginView.vue:12-29, 168-183`). No separate plugin origin, preload, or session is implemented in this source.

### Manager BrowserWindow preferences

The Manager's explicit `webPreferences` are: the bundled preload path, `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` (`electron/main.ts#createWindow()`, lines 260-275). Electron v44.4.5 documents `contextIsolation` as separating the preload/Electron context from the page, and `sandbox: true` as sandboxing the renderer while limiting preload APIs ([WebPreferences](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/web-preferences.md)).

The constructor does not set `devTools`, `webSecurity`, `allowRunningInsecureContent`, `webviewTag`, `session`, or `partition`. These are omissions in application configuration, not additional host policy. Electron v44.4.5 documents defaults of `devTools: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`, and the default app session when neither `session` nor `partition` is specified ([WebPreferences](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/web-preferences.md)). Thus the source does not disable DevTools; it also does not explicitly select a Manager-specific or plugin-specific session. No source call to `webContents.openDevTools()` was found.

### Navigation and new windows

`createWindow()` installs `setWindowOpenHandler(() => ({ action: 'deny' }))`, which denies renderer-created windows, including `window.open()` and links/forms using `_blank` under Electron v44.4.5 (`electron/main.ts:277`; [webContents `setWindowOpenHandler`](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents.md)). The Manager's plugin catalog contains an author link with `target="_blank"` (`src/features/plugins/PluginManagerView.vue:176`), so that link is subject to the same denial.

The `will-navigate` handler allows any URL whose string starts with `file:` or `http://localhost:` and cancels other URLs (`electron/main.ts:278-280`). This is a prefix check; it does not compare against the packaged renderer file or a single development origin/port. Electron v44.4.5 documents `will-navigate` as applying to main-frame navigations initiated by a user or page, excluding programmatic `loadURL`/`back` and in-page changes; redirects have a separate `will-redirect` event ([webContents navigation events](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents.md)). The Manager source registers no `will-redirect` or `will-frame-navigate` handler. Its `did-start-navigation` listener resets renderer-bound plugin/translation state on main-frame navigations but does not cancel navigation (`electron/main.ts:281-293`).

### Session permissions, request hooks, protocol, and CSP

No `session.fromPartition`, `session.fromPath`, `setPermissionRequestHandler`, or `setPermissionCheckHandler` call appears in the application source. Since `session` and `partition` are omitted from the Manager's `webPreferences`, Electron v44.4.5 selects its default session ([WebPreferences](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/web-preferences.md)). Electron's v44.4.5 security guide states that, without a custom handler, Electron automatically approves permission requests. The current Manager source therefore contains no explicit browser-permission deny policy for that session ([Security guide](https://github.com/electron/electron/blob/v44.4.5/docs/tutorial/security.md); [Session permission handlers](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md)).

The application's `PermissionBroker` is a separate host capability system: `PluginManager` checks requested and granted plugin capability IDs before invoking a declared host action, while `DeclarativeRuntime` implements config/storage, external-open, clipboard, and shared-AI actions (`electron/plugins/permission-broker.ts:33-42`; `electron/plugins/plugin-manager.ts:353-359`; `electron/plugins/declarative-runtime.ts:50-85`). It does not configure Chromium/Electron session permissions.

No Electron `webRequest` listener or custom-protocol API call is present in the application source. There is no `Content-Security-Policy` meta tag in `index.html:1-14`, and no source-level response-header injection. The current Manager renderer consequently has no app-authored CSP in the checked entry HTML or Electron request hooks. Electron v44.4.5 documents `webRequest` as session-scoped and shows `onHeadersReceived` as a way to add a CSP header; the app does not use that mechanism ([webRequest](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md); [Security guide](https://github.com/electron/electron/blob/v44.4.5/docs/tutorial/security.md)). No `protocol.registerSchemesAsPrivileged`, `protocol.handle`, or session protocol handler is present.

### Preload bridge and IPC sender checks

`electron/preload.ts` builds a typed `DesktopApi` from fixed `ipcRenderer.invoke/send` wrappers and exposes it as `window.desktop`; it does not expose the `ipcRenderer` object or generic channel access (`electron/preload.ts:1-69`). `onNativeManagerIntent` parses the payload and returns a listener-removal function (`electron/preload.ts:29-36`). This matches Electron's documented `contextBridge.exposeInMainWorld` model; the exact v44.4.5 docs warn against exposing the whole `ipcRenderer` module ([contextBridge](https://github.com/electron/electron/blob/v44.4.5/docs/api/context-bridge.md)).

Sender checks are per-handler rather than global. `isCurrentWindowMainFrame()` requires the current Manager `webContents` and its `mainFrame` (`electron/ipc/window-security.ts:11-19`). The plugin, plugin-catalog, built-in handoff, settings, and translation handlers receive this predicate; plugin handlers check it before and after asynchronous work (`electron/main.ts:463-516`; `electron/ipc/plugin-handlers.ts:16-28`; `electron/ipc/plugin-catalog-handlers.ts:21-33`). By contrast, the website and Everything registrations do not receive or call that predicate (`electron/main.ts:503, 518`; `electron/ipc/website-handlers.ts`; `electron/ipc/everything-handlers.ts`). The `managerReady` notification passes only `event.sender` to `markManagerRendererReady`, which checks WebContents identity but not `senderFrame`; native-intent acknowledgments use the full main-frame check (`electron/ipc/window-handlers.ts:5-10`; `electron/main.ts:235-243, 332-342`).

### Source links (Electron v44.4.5)

All Electron references below are first-party documentation files pinned to the `v44.4.5` tag.

- [BrowserWindow](https://github.com/electron/electron/blob/v44.4.5/docs/api/browser-window.md)
- [WebPreferences](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/web-preferences.md)
- [webContents navigation and window-open handlers](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents.md)
- [contextBridge](https://github.com/electron/electron/blob/v44.4.5/docs/api/context-bridge.md)
- [Session and permission handlers](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md)
- [webRequest](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md)
- [Custom protocol](https://github.com/electron/electron/blob/v44.4.5/docs/api/protocol.md)
- [window.open behavior](https://github.com/electron/electron/blob/v44.4.5/docs/api/window-open.md)
- [Electron security guide](https://github.com/electron/electron/blob/v44.4.5/docs/tutorial/security.md)
- [WebContentsView](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents-view.md)
- [BaseWindow child WebContents lifecycle](https://github.com/electron/electron/blob/v44.4.5/docs/api/base-window.md)

### Audit finding: the trusted Manager is not a Web Plugin boundary (P2)

**Evidence:** `electron/main.ts` currently gives the Manager a broad trusted preload and default Session, permits `file:` and any `http://localhost:` URL by string-prefix check, denies popups, but has no custom Session permission request/check handlers, `will-redirect` policy, app-authored CSP, or session request policy. The Electron v44.4.5 security guide documents that permission requests are automatically approved when no handler is installed. Sender validation is selective: plugin/catalog/settings/translation paths check the current Manager main frame, while website and Everything handlers do not; `getVersion` has no sender predicate. `isCurrentWindowMainFrame()` proves current WebContents/main-frame identity, but not a plugin origin or per-plugin principal.

**Current impact:** no Web Plugin JavaScript is loaded today, and v1 plugin manifests remain declarative data, so this is not evidence that current third-party plugins can execute arbitrary code. It does mean the existing Manager policy cannot safely be reused for plugin content. Attaching a Web runtime to this Manager WebContents, reusing its preload/default Session, or relying on its file-prefix navigation rule would cross the intended trust boundary.

**Required before Web execution:** a new independently owned WebContentsView, dedicated non-persistent Session and origin, no Manager preload, deny-by-default browser permission handlers, exact package-origin navigation/redirect allowlist, per-runtime generated CSP, and sender-to-runtime identity binding for the only exposed bridge. Audit every handler reachable from any future preload. Pass packaged Gate 1 adversarial tests before enabling Web packages.

**Verification:** source search and handler review confirmed the conditions above; this audit did not load untrusted content or claim runtime Gate 1 acceptance. Files: `electron/main.ts`, `electron/preload.ts`, `electron/ipc/window-security.ts`, `electron/ipc/website-handlers.ts`, `electron/ipc/everything-handlers.ts`, and `electron/ipc/plugin-handlers.ts`.

## 5. Existing SDK / Packaging Model

The repository has two Node package manifests, not a workspace: the application root and standalone `plugin-sdk/declarative-v1/package.json`. The SDK is `@webtools/plugin-sdk` v1.1.0, uses the same `.wtplugin` ZIP extension, has a CLI for create/validate/pack/inspect, and is distributed as a local tarball. It depends on `yauzl` 3.4.0. There is no SDK-to-Host monorepo import contract for external plugin authors.

The v1 Host install path is Main-owned: `createElectronPluginHost()` opens a native file dialog, reads one bounded `.wtplugin` into bytes, and calls `PluginManager.install`; the renderer does not submit an arbitrary filesystem path. `electron/plugins/package-validator.ts` delegates to the SDK's canonical `runtime/package-v1.mjs` validator, which snapshots bytes, parses the ZIP from memory using `yauzl`, checks ZIP metadata/CRC/size/path safety, verifies the closed manifest and exact asset inventory, then returns the SHA-256 of the original bytes. `PluginManager` stores immutable archives by plugin ID/version/content hash under its managed storage root and re-reads/revalidates the recorded bytes before sensitive invocation.

Current v1 bounds include 20 MiB compressed archive, 256 entries, 50 MiB expanded archive, 64 KiB manifest, 100:1 compression ratio, 256 KiB per PNG, 8 pages, 64 blocks/page, 32 actions, 64 settings, 200 storage keys, 512 KiB/value, and 5 MiB serialized config/data document. v1 assets are PNG only; v1 type is `declarative-manager`, with a required `manager.page` capability. The ZIP inventory permits only `manifest.json` plus declared `assets/` entries; unsafe paths, encrypted entries, special files, path/case/Unicode collisions and undeclared entries are rejected. These v1 parser rules and package bytes are frozen; v2 needs a separate closed validator and must not reinterpret v1.

`PluginRegistry` stores metadata, enablement, capability requests/grants, version/hash identities and source `local-unsigned`; `PluginStore` owns durable plugin config/data with bounded JSON and safe managed paths. Content hash proves package-byte identity/integrity, not publisher identity or authenticity. Current install consent says the publisher is unverified and import does not automatically grant permissions.

Source evidence: `electron/plugins/electron-plugin-host.ts`, `electron/plugins/plugin-manager.ts`, `electron/plugins/package-validator.ts`, `electron/plugins/managed-fs.ts`, `electron/plugins/plugin-store.ts`, `electron/plugins/plugin-registry.ts`, `plugin-sdk/declarative-v1/runtime/{manifest-v1,package-v1}.mjs`, `plugin-sdk/declarative-v1/package.json`, `docs/phase6c-migration-design.md`.

## 6. Web Plugin Trust Model

Manifest v2 changes the trust class: a `.wtplugin` contains publisher-controlled executable JavaScript and is untrusted third-party code, even when installed, enabled, signed by a future publisher, or discoverable from Native search. Installation must explicitly disclose that executable code will run; a package with zero Host capabilities still has browser-side code execution authority within its isolated Web runtime.

The trust boundary must keep the plugin outside the trusted Manager renderer and prevent ambient access to Node, `process`, filesystem, child processes, raw Electron APIs, raw IPC, Manager DOM/Vue state, NativeHost pipe, PluginStore paths, SecretStore and credentials. All host effects pass through an explicit SDK → restricted preload → Main bridge with Main-derived identity and live permission checks. A plugin-supplied `pluginId`, `featureId`, runtime ID, permission claim or origin is never authority.

This is capability isolation, not a claim that Chromium is a formal OS sandbox or that a plugin is safe from its own malicious logic. The renderer sandbox, unique app-owned origin, dedicated Session, CSP, navigation denial, bounded IPC and lifecycle teardown are defense layers. User consent is necessary for executable packages but does not replace those technical controls.

## 7. Recommended Runtime Architecture

Keep the frozen process model: one always-resident `WebTools.NativeHost.exe`; Electron Manager starts on demand and exits completely when its window closes. When a Feature is invoked, Native sends only its existing typed invocation to Main. Main authenticates the current NativeHost peer and revalidates the Feature/package/grants. Main starts or reuses the one Manager process/window; only then does it create one fresh plugin `WebContentsView` attached to the existing Manager `BrowserWindow`.

Use the approved Phase 6C shape:

```text
NativeHost Launcher / future Super Panel
  → authenticated pipe: FeatureRef + invocation/context IDs
  → Electron Main live revalidation
  → existing on-demand Manager BrowserWindow
  → one isolated WebContentsView for the active Web Feature
       own sandboxed WebContents
       dedicated non-persistent plugin Session
       per-invocation random app-owned origin
       generated restrictive CSP
       optional minimal dedicated preload
  → Main-owned protocol serves validated bytes from immutable .wtplugin
```

No extra `BrowserWindow`, persistent helper process, plugin service, worker, prewarm or pool is needed. The host toolbar/chrome remains outside the plugin view. NativeHost continues to cache/search projection metadata only. For v1 Declarative plugins, retain the existing lightweight interpreter and synthetic Feature adapter; do not route v1 through the Web runtime.

## 8. WebContents Isolation Design

| Option | Security/lifecycle | Cost/reuse | Decision |
|---|---|---|---|
| Reuse Manager Vue renderer, component, iframe, or `webview` | Shares trusted renderer/preload/origin/storage or adds a complex nested-frame boundary; easy to expose host APIs or escape navigation policy | Low initial cost, but wrong trust boundary | Reject |
| New `BrowserWindow` per Feature | Separate top-level WebContents but still needs sandbox/session/preload/navigation hardening; creates more windows/process surface and conflicts with Manager host chrome | Highest window/process/lifecycle cost; poor future Super Panel reuse | Reject for first release |
| Fresh `WebContentsView` inside existing Manager `BrowserWindow` | Independent WebContents and lifecycle with no Manager DOM/preload; Main owns the view and its bounds | Reuses Manager process group and can later attach to another trusted surface; bounded to one active Feature | Recommend; already frozen in Phase 6C |

`WebContentsView` is an Electron WebContents lifecycle boundary, not a promise of a dedicated OS process or VM. Use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, no webview tag and a separate minimal preload only if bridge implementation requires it. Do not depend on renderer-process co-location or separation for authorization. BrowserWindow/BaseWindow does not automatically destroy child WebContentsViews on close, so teardown must explicitly revoke bridge work, remove the view and close/destroy its WebContents before Manager exits. Electron v44.4.5 API docs and type declarations support `WebContentsView`, `Session`, per-session protocols and permission handlers, but API availability alone is not runtime acceptance.

## 9. Storage / Session Model

Use one dedicated **in-memory/non-persistent plugin Session**, separate from the Manager's default Session. The first release has at most one active Web Feature, so a single isolated plugin Session with per-runtime random origin is sufficient; do not use a `persist:` partition, the Manager default session, or one permanent partition per plugin. Never share it with Manager content.

| State | First-release policy |
|---|---|
| PluginStore | Only durable plugin state; Main validates identity, capability, JSON shape, quota and safe path. |
| `localStorage`, IndexedDB, CacheStorage, cookies | No durable contract; ephemeral only, origin-isolated, clear for the runtime on teardown. If cleanup cannot be demonstrated on Electron 44.4.5, disable runtime until fixed. |
| Service workers | Deny; no persistent/hidden worker lifetime. |
| Session cache | Clear plugin-session cache on runtime teardown; discard session/runtime references. |
| Manager default Session | Never used by plugin WebContents. |

Treat site storage as hostile transient state, not as backup/migration data. Test two sequential plugins for cross-origin/state leakage, repeated invocation cleanup, Manager close, crash, update and permission revoke. Do not increase the current PluginStore 200-key, 512 KiB/value and 5 MiB document limits in this phase without a separate review.

## 10. Navigation / CSP Model

Serve the single entry HTML and all listed assets from a random app-owned custom origin such as `webtools-plugin://<runtime-random-host>/...`, using the dedicated plugin Session's protocol handler. The handler maps only canonical package-relative paths to validated immutable archive entries. It must never convert renderer-controlled strings to host filesystem paths. Register scheme privileges before `app` readiness and enable only standard/secure-origin/fetch semantics required by the runtime; do not enable CSP bypass or service-worker privileges.

Fail closed for navigation, redirects, popups, downloads, frames, `<webview>`, permission requests and checks, workers, service workers, external protocols and remote module imports. Main-frame navigation remains on that exact runtime origin and listed package tree. `file:`, arbitrary `http:`, arbitrary `https:`, `data:`, `blob:`, `javascript:` and other custom schemes are not valid plugin navigation targets. External links use Main `external.open` after capability checks and the existing explicit confirmation policy. Deny nested frames (`frame-src 'none'`, `frame-ancestors 'none'`) and verify `location`, redirects, target blank and form navigation attempts at runtime.

Host should attach a generated response-header CSP to every package document/resource and not trust author-supplied headers:

```text
default-src 'none'; base-uri 'none'; object-src 'none';
frame-ancestors 'none'; form-action 'none';
script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
img-src 'self' data:; font-src 'self';
connect-src 'self' [exact approved HTTPS/WSS origins];
worker-src 'none'; frame-src 'none'; manifest-src 'self'
```

Do not add `unsafe-eval`; `wasm-unsafe-eval` is only for browser WebAssembly compilation and must be verified in the shipped Electron/Chromium build. Inline scripts remain forbidden. Inline styles are not enabled by default; only consider an explicit CSP decision after production builds for supported frameworks demonstrate a genuine need. CSP is defense-in-depth; it is not network authorization.

## 11. Manifest v2 Requirements

These are frozen Phase 6C contract constraints, not implementation in this audit:

- Manifest v1 bytes, parser and declarative `declarative-manager` packages remain unchanged. V2 uses a separate strict, closed parser and `.wtplugin` ZIP container.
- V2 top-level shape has explicit `manifestVersion: 2`, identity/version/API fields, `type: feature-bundle`, requested capabilities, 1–16 Feature definitions, closed `webBundle.files` inventory, declared assets and explicit network mode (`none` or exact `domains`). Unknown fields fail closed.
- A Feature has stable composite identity `(pluginId, featureId)`, title/commands/context declarations, web-bundle entry and required capabilities. Its required capabilities are a subset of the plugin's declared requests; neither projection nor declaration grants authority.
- Host-reserved identities, especially `(webtools.translation, translate-text)`, cannot be claimed by third-party packages. Feature ID and Plugin ID normalization/duplicate checks are canonical and closed.
- Projection v2 currently recognizes `declarative-compatibility | built-in`. A future Web implementation may add exactly the approved `web` projection kind as a separately versioned/source-reviewed change; this audit does not widen the union.
- Keep bounds: max 16 Features/plugin, 2,000 total projected Features, 3 MiB projection, 20 MiB archive, 256 entries, 50 MiB expanded, 100:1 ratio, 64 KiB manifest, max 1 MiB entry HTML, 8 MiB per other JS/CSS/JSON/WASM file, max 128 asset entries, max 16 exact network host/protocol tuples. Closed archive inventory must equal manifest plus listed files exactly.
- Web bundle may include HTML, JS modules, CSS, JSON, package-local `.wasm`, and fixed-MIME image/font assets. Reject native executable/DLL, native addon, source maps in release packages, remote imports, inline script, absolute entry URLs, undeclared files and path/Unicode/case collisions. Package-local WASM is browser-sandboxed code, not Node/WASI/OS access.
- SDK validation is author preflight; Electron Main's install-time validation is final authority. Main validates bytes before state mutation, computes capability and network-scope deltas, prompts for executable code and requested scopes, and stores the original package immutably by content hash. Content hash is integrity, not publisher authenticity/signature.
- Added capabilities or domain scopes on update require explicit re-consent; cancellation leaves the current valid package/grants intact. Existing v1 plugins remain on the compatibility adapter, not rewritten into v2.

Sources: `docs/phase6c-migration-design.md`, `docs/phase6c-feature-context-contract.md`, `docs/phase6c-native-feature-projection.md`, `docs/phase6c-architecture-freeze.md`, and `src/shared/feature-contracts.ts`.

## 12. SDK / Capability Bridge

Keep `@webtools/plugin-sdk` thin and framework-neutral: types/contracts, one request/response API, invocation context, capability methods and lifecycle hooks. Vue/React/Svelte/Vanilla are author choices that build to plain static Web output. Host retains permissions, storage, AI provider access, credentials, networking, clipboard, external navigation and system integration.

Proposed authority path:

```text
Plugin JS → SDK request facade → isolated minimal preload → Main IPC endpoint
          → derive WebContents/runtime identity from Main-owned map
          → verify top frame + origin + runtime generation + FeatureRef/package hash
          → current enabled/grant/capability revalidation
          → capability implementation
```

If a preload is needed, it must not be the Manager preload and must expose only typed, fixed methods. No generic `send/invoke(channel)` and no raw `ipcRenderer`. Main binds the sender's `webContents.id` and main-frame identity to a runtime descriptor created by Main; every request payload's identity fields are correlation hints only. Reject stale generation, changed hash, revoked grants, non-main-frame senders and requests after teardown. Revalidate after each asynchronous prompt/provider/storage boundary before committing effects.

Existing `isCurrentWindowMainFrame()` binds a request to the one trusted Manager WebContents/main frame, but does not validate origin and is not a reusable plugin principal system. Some existing IPC handlers (for example website and Everything) do not pass this predicate; the Manager preload also contains more authority than Web content needs. Therefore no existing preload or IPC endpoint should be attached to Web plugin content. Introduce a dedicated, minimum bridge and test sender ownership for every method.

Current SharedAI/SecretStore direction is suitable to reuse behind Main: `SharedAIService` reads the configured key through `AIProviderCredentialStore`/`SecretStore` and returns generated text/provider metadata, while UI APIs expose setup/status but no credential getter. Future Web Plugin `sharedAI.complete` should send bounded prompt/messages to Main, apply existing capability/confirmation and provider policy, and return only result data. Never disclose API keys, SecretStore material, raw provider configuration containing secrets, or AI token to SDK/plugin code.

## 13. Network Enforcement

`network.mode: none` is the first safe runtime profile and may be implemented without `network.domains`. Deny all external requests at the isolated Session, with CSP and navigation rules as additional filters. Test all network-capable entry points and resource types, including `fetch`, XHR, WebSocket, EventSource, image/script/style/font/media URLs, redirects, CSS URLs, dynamic imports, iframe, workers, WebRTC and proxy settings. Keep internal package requests on the app-owned scheme.

For `network.domains`, neither “SDK has no fetch API” nor CSP nor `webRequest` is sufficient. Electron `webRequest` provides request URL, initiator, WebContents ID and resource type; it does not prove or pin the actual connected IP. The frozen candidate is a Main-owned loopback egress broker on the dedicated Session's forced proxy path: canonicalize exact HTTPS/WSS host and port 443, resolve A and AAAA, reject if any address is loopback/private/link-local/reserved/multicast/unspecified, connect to a validated IP without a second hostname resolution, retain TLS host verification, and re-run policy for redirect/retry/CONNECT. Centralized `webRequest` checks add defense-in-depth but do not replace the connection authority.

Gate 4 must prove no direct, proxy, QUIC, UDP, WebRTC, DNS rebinding, IPv4/IPv6 or redirect bypass; exact IDNA-normalized host matching; no wildcard/IP/localhost/private scopes; WSS is separately declared; and grant changes require re-consent. Do not enable `network.domains` until this full connection-level proof passes in the shipped runtime. If broker enforcement cannot be proven, ship only `network.mode: none`; do not weaken the gate. This is consistent with Phase 6C's frozen sequencing, not a new decision in this audit.

## 14. Runtime Lifecycle

| Event | Required behavior |
|---|---|
| Install | Validate bytes in Main, disclose executable Web package, request user confirmation, store immutable hash; do not instantiate a WebContents. |
| Enable | Persist enabled/grant state and update projection; do not prewarm or keep Web runtime resident. |
| Searchable projection | Metadata only; no HTML/JS load, no WebContents. NativeHost never loads package content. |
| Cold invocation | Authenticate existing pipe; Main revalidates current Feature/package/grants; start/reuse Manager; create a fresh view/session-origin runtime; load only package entry. |
| Repeated invocation / switch Feature | At most one active Feature. Reuse Manager process but close prior runtime, revoke its generation, cancel work, clear its origin, then create next runtime. No hidden pool. |
| Close Feature / Manager | Revoke runtime first; reject new bridge calls, abort pending operations, send best-effort close notification, remove view, close WebContents, clear origin/session cache; Manager close then destroys Manager and exits all Electron processes. |
| Disable / permission revoke / update / uninstall | Mark identity/generation stale before async work; stop runtime before mutating grants/package. Old package/hash completion cannot write or emit effects. Update keeps old valid package on cancellation/failure. |
| Crash / hang / timeout | Mark only current Web runtime faulted, cancel calls and destroy its WebContents; keep Manager responsive when safe. Bounded startup/ready and capability timeouts; no infinite retry or queue. Require a fresh invocation after recovery. |

No NativeHost runtime, child process, Worker, persistent Electron helper, or resident hidden WebContents is allowed. Manager closed must continue to mean Electron process group equals zero.

## 15. Resource / IPC Bounds

Frozen concurrency limits: at most one active Web Feature; projected independent Feature result group maximum six; max 16 Features/plugin, 2,000 global projected Features and 3 MiB projection. The group/result cap is not permission to run six WebContents concurrently.

Reuse current package/storage limits rather than inventing larger persistence. Existing Native invocation FIFO is capped at four; Main invocation IDs are bounded to 2,048 per authenticated session; the existing D6 request/result envelopes are 1,024/256 UTF-8 bytes with 45-second pipe, 60-second Manager-ready and 40-second renderer-ack deadlines. Those are existing transport contracts, not automatically the future plugin bridge's complete quotas.

The Web bridge must add hard limits for request/response bytes, concurrent pending calls, request rate, context size, AI input/output, startup/ready deadline, and cancellation. Reject overload synchronously with bounded error codes, do not grow a queue without limit, and discard late responses after runtime generation changes. For v1 storage reuse the current 200 keys / 512 KiB value / 5 MiB serialized document limits. Phase 6E-2 must specify numeric Web bridge quotas and budgets before implementation, then test exact limit, limit+1, flooding, slow host effects, cancellation and teardown. Resource targets must be measured on the installed build; no memory-cost claims are inferred from this static audit.

## 16. Package Integrity

Keep `.wtplugin` and immutable content-addressed package bytes. The v2 Host validator must parse the entire archive in bounded memory, enforce exact inventory, safe canonical relative POSIX names and closed MIME map, reject ZIP ambiguity/duplicates/path escape/symlink/special files/undeclared payloads, validate all Feature/entry/WASM/asset references, and hash the exact bytes that are committed to storage. Avoid extracting plugin content to temporary or mutable directories.

The runtime protocol handler looks up the immutable package by Main-owned `(pluginId, version, hash)` and serves only a validated exact archive entry by canonical path. Request path normalization is repeated at the serving boundary; do not trust install-time parsing alone or accept `..`, encoded separators, alternate normalization, query-based path selection or renderer paths. Revalidate the current package identity/generation before opening each runtime and after relevant async operations. Package mutation after installation must either fail integrity validation or address a new immutable hash; do not silently execute edited source.

Development project-folder/localhost loading is outside production behavior. A future developer mode needs an explicit opt-in and isolated test profile and must not reuse production grants, app data or secrets. Phase 6E-1 does not create such a mode.

## 17. Framework Compatibility

Host contract is static browser output, not a framework component/runtime API. Future acceptance should build and run one minimal production example for Vue, React, Svelte and Vanilla against the same Host contract.

Define framework-neutral artifact requirements before implementation: one listed entry HTML; relative package paths/base URL; package-local JS/CSS/chunks/dynamic imports only; local CSS/images/fonts/JSON; listed package-local WASM with fixed `application/wasm`; no bare npm imports in the installed archive; no absolute URLs, CDN dependencies, source maps or external imports in release packages. Verify code splitting and dynamic import keep every chunk in exact inventory. Framework dev-server/HMR output is not a production acceptance artifact. If a real production framework build requires inline style, evaluate a narrowly scoped CSP relaxation separately; do not globally enable `unsafe-inline` or `unsafe-eval` preemptively.

## 18. Threat Matrix

| Threat | Boundary / impact | Required mitigation | Phase |
|---|---|---|---|
| `require('fs')`, `process`, `child_process`, Node/native addon access | Plugin renderer may read files, launch processes or escape intended capability model | Sandboxed WebContents; Node off; isolated minimal preload; no native package entries; no Node/WASI system interface | 6E runtime / validator |
| Raw `ipcRenderer`, arbitrary Host IPC, Manager Vue/DOM/preload access | Plugin can invoke privileged handlers or manipulate trusted Manager | Independent WebContents/origin/session; never attach Manager preload; fixed capability bridge only | Gate 1, 6E bridge |
| Spoof pluginId, featureId, runtime ID, origin or package identity | Confused-deputy call against another plugin/Feature | Main derives principal from sender WebContents map and checks current top-frame, runtime generation, package hash and exact FeatureRef; payload identity is not trusted | 6E bridge |
| Navigate to remote/file/data/blob/javascript URL; redirect; `window.open` | Content escapes package policy or loads attacker-controlled code | Exact custom-origin/package-tree navigation allowlist; deny redirects/popups/downloads/other schemes; external.open via Main only | 6E runtime |
| iframe/frame escape, webview, worker/service worker | Hidden content or persistent background execution | `frame-src 'none'`, webview off, deny frame navigation and worker/service-worker permissions; test top-frame ownership | 6E runtime |
| Network without permission via fetch/XHR/WebSocket/EventSource/assets/CSS/media/dynamic import/WebRTC/QUIC | Exfiltration or arbitrary remote code/data access | `network.mode none` session-wide deny; CSP/navigation as defense; Gate4 broker and bypass matrix before exact domains become available | Gate 4 |
| Secret/API-token extraction through SharedAI | Credential theft and provider abuse | Never expose token/getter; route requests through Main SharedAI; capability + consent + bounds; return result only | 6E bridge |
| Cross-plugin storage/session leakage | Read or corrupt another plugin's data or browser state | Dedicated isolated non-persistent Session, unique random origin, Main-derived PluginStore identity; clear site data/cache at teardown | 6E runtime/storage |
| Path traversal, encoded separators, symlink/reparse escape | Read arbitrary host files or execute wrong package bytes | No extraction; canonical package paths; exact archive inventory; serving-boundary validation; ManagedFs remains Main-only | 6E validator/protocol |
| Package mutation after install / hash confusion | Execute bytes different from reviewed/authorized package | Immutable hash-addressed bytes; rehash/revalidate and bind runtime/Feature to package version+hash; updates are new identities and re-consent on privilege increase | 6E install/runtime |
| XSS inside a Web plugin | Attacker-controlled script runs within plugin principal | Treat all plugin code as malicious; sandbox, origin/session isolation, CSP, no ambient bridge authority, narrow capabilities, live Main checks | Gate 1 / 6E bridge |
| DoS, huge IPC payload, request flood, memory/CPU exhaustion | Manager becomes unresponsive or resource growth unbounded | One active WebContents; bounded package/Feature/storage limits; per-runtime pending/rate/byte budgets, timeouts, cancel and teardown; no unbounded queue | 6E runtime/acceptance |
| Runtime crash/hang, late async result after revoke/update | Stale effects, orphan WebContents or Manager instability | Runtime generation, abort/cancel, bounded ready/effect deadlines, reject after close, destroy child WebContents explicitly, process/lifecycle tests | 6E lifecycle |
| Host browser permission prompts (camera/mic/location/notifications/etc.) | Ambient OS access bypasses explicit Host capability model | Dedicated plugin Session with request/check handlers that deny by default; no web permission API in SDK | Gate 1 / 6E runtime |

Current conclusion: these are design threats for a future executable Web runtime; current v1 declarative packages cannot author arbitrary JavaScript under the audited contract.

## 19. Phase 6D Compatibility

The future runtime must preserve these completed/frozen boundaries:

- Native Feature Registry projection/cache is presentation and search only. It does not grant permission, choose package paths or execute a plugin.
- Electron Main remains execution authority and live-revalidates every invocation against current session, feature, package hash, plugin state and grants.
- Actual NativeHost↔Manager pipe peer authentication remains the existing Phase 6D Gate 2; do not add an unauthenticated side pipe or trust request-supplied process identity.
- Projection v2 remains closed for current `declarative-compatibility | built-in`; a future `web` kind needs a narrowly scoped contract implementation in Phase 6E, not an unreviewed audit edit.
- Built-in Translation identity/lifecycle and Translation providers remain unchanged. Third-party Manifest v2 cannot claim the reserved identity.
- Declarative v1 adapter, parser, package bytes, permission semantics and Manager UI remain compatible; v1 is not rewritten as a Web Feature.
- NativeHost must never parse Web bundle files, execute JavaScript, open plugin HTML, start a Web runtime or own plugin permissions. Search projection remains bounded metadata.
- Manager close still destroys plugin WebContents before Electron exit; NativeHost remains running and Launcher search remains independent.

## 20. Open Decisions

No Phase 6C/6D architecture decision needs reopening for the first Web runtime. The core runtime, Session, origin, v1 compatibility, one-active-Feature limit, Host authority, v2 validator authority, and “domains networking stays unavailable until Gate 4 passes” are frozen.

One conditional security/product decision remains evidence-driven: whether any supported production framework truly requires inline styles. Default is no inline style. Only if Vue/React/Svelte/Vanilla packaged artifacts fail under the frozen CSP should Phase 6E-2 compare a nonce/hash-based policy and a narrowly scoped alternative; do not choose `unsafe-inline` without concrete compatibility evidence and explicit approval.

Broker feasibility and numeric Web bridge budgets are engineering gates for Phase 6E design/testing, not permission to weaken the frozen requirements. If broker proof fails, the already-approved fallback is `network.mode: none` only.

## 21. Proposed Phase 6E Breakdown

Implementation should proceed sequentially at security seams. Do not parallelize work that shares the v2 contract, protocol/session policy, runtime identity map or bridge. Each implementation task should run focused tests and `pnpm run typecheck`; run `pnpm test`/`pnpm run build` at integration milestones. This audit does not execute any of these phases.

| Phase | Scope | Security boundary | Required tests | Exit criteria |
|---|---|---|---|---|
| **6E-2 — Detailed design and acceptance contract** | Freeze numeric bridge/resource/time budgets, v2 error contract, runtime state machine and CSP compatibility test rules. | No runtime code; preserve all 6C/6D decisions. | Design cross-review; schema examples; adversarial test matrix; no product-code diff. | Approved contract with no unresolved high-risk architecture question. |
| **6E-3 — Manifest v2 Host validation and package integrity** | Add a separate closed v2 parser/validator and package-inventory tests; preserve v1 path. | Main install-time validator final; bytes hashed and stored immutably; no execution yet. | Malformed/oversized ZIP, duplicate/case/NFC paths, traversal, extra/missing inventory, invalid references, capability/network grammar, reserved FeatureRef, regression proving v1 bytes/parser behavior unchanged. | Only valid v2 static bundles install; failures leave current registry/package untouched. |
| **6E-4 — Isolated `network.mode:none` Web runtime** | Create/close one WebContentsView in Manager, plugin Session, unique random origin and archive protocol; do not expose bridge yet. | Dedicated sandbox/session/origin; deny external navigation, permission, popup, download, frame and worker; no Manager preload. | Process/runtime identity, no Node/Manager globals, all navigation/resource denials, local archive serving, sequential plugin isolation, teardown/cache clear, Manager close→Electron 0. | Gate 1 passes on packaged Electron; only offline bundle loads. |
| **6E-5 — Minimal SDK bridge and Main identity binding** | Add separate narrow preload/API; bind every call to Main-owned WebContents/runtime/Feature/package identity; revalidate state. | No raw IPC; origin/main-frame/runtime-generation checks; per-call capability authority. | Spoofed IDs, subframe, stale generation, revoked grant, package update, unexpected channel, over-limit and late async calls all fail closed. | Only typed, bounded, authorized requests reach host effects. |
| **6E-6 — PluginStore and approved capabilities/context/AI lifecycle** | Add approved storage, external.open, clipboard/context and SharedAI paths required by frozen contract; explicit consent UX. | Main owns durable storage, clipboard, external navigation, AI and consent; no secret values cross bridge. | Quotas/path attacks, confirmation/cancel, secret canary non-disclosure, provider timeout/cancel, runtime close/revoke/update races. | Capability effects match consent and are canceled/revalidated on lifecycle changes. |
| **6E-7 — Gate 4 exact-domain network feasibility** | Prototype forced egress enforcement for exact HTTPS/WSS domains; keep capability disabled until evidence passes. | Main-owned connection-level policy; no direct/proxy/UDP/QUIC/WebRTC bypass. | A/AAAA and IP pinning, private/local/reserved targets, IDN, redirects/retries, DNS rebinding, proxy tamper, websocket/WSS, bypass matrix on packaged runtime. | Either Gate 4 passes and exact grants are enabled with re-consent, or domains stay unavailable and only `none` ships. |
| **6E-8 — SDK v2, framework/WASM acceptance, packaged release gate** | Publish the framework-neutral static bundle workflow and finalize Vue/React/Svelte/Vanilla/WASM samples/tests. | Author SDK remains preflight only; Host validation/runtime policy final; no developer-folder execution in production. | Production build artifacts for four frameworks; relative assets/code splitting; WASM MIME/CSP/eval denial; install/update/uninstall; adversarial runtime, lifecycle/resource and packaged Windows acceptance. | Complete security checklist, installed UX and regression evidence; Manager close returns Electron count to 0; no unresolved P0/P1/blocking P2. |

Suggested sequence is deliberately stricter than “implement a bridge while runtime isolation is being built”: keep initial runtime offline and bridge-free, pass Gate 1, then add authority incrementally. Gate 4 can be investigated after a safe offline runtime exists, but it must not delay or silently broaden that profile.

## 22. Recommendation

`READY FOR PHASE 6E-2`

The repository audit is complete and the frozen architecture provides a sufficiently specific direction for detailed implementation planning. This means ready to write/review the 6E-2 design and acceptance contract only. It does **not** authorize Web runtime implementation or third-party JavaScript execution yet.

Before any untrusted Web bundle is activated, Phase 6E must address the P2 Manager-boundary finding by creating and validating a genuinely separate plugin WebContents/session/preload policy; Gate 1 must pass in the shipped build. `network.domains` remains disabled until Gate 4 connection-level enforcement is independently proven. No product code, dependencies, data format, Manifest parser, or runtime was changed by this audit. No commit or push was performed.
