# Phase 6E-7 — Plugin Runtime 2.0 Alignment Review

**Status:** READY FOR PLUGIN RUNTIME 2.0 IMPLEMENTATION
**Review type:** Code-level impact audit and migration design only
**Review date:** 2026-10-09
**Source identity:** branch codex/shared-ai-translation-2.0, HEAD 707c5673dff479285b34a5b441bec9d3b725c737
**Implementation performed:** No product code, runtime policy, persisted schema, or package format was changed.

**Repository cleanup note (2026-10-10):** Recommendations below to retain the Phase 6E-4A/4C probe code and evidence describe the review-time state. The standalone old-runtime harness and checked-in evidence snapshot were later retired during repository cleanup; the historical reports remain, while current tests target Runtime 2.0.

## 1. Executive Summary

The repository implements a real, lifecycle-controlled Web Plugin runtime, but its production policy still encodes the earlier “untrusted web bundle / no network / no browser persistence / no Worker / no Node” product contract. Those assumptions are spread across the Manifest v2 parser and package inventory, PluginManager admission, runtime CSP and Session setup, the random per-invocation origin, teardown cleanup, SDK declarations, and packaged acceptance harnesses. Changing only CSP or only the package schema would therefore leave the new runtime internally contradictory.

The recommended Runtime 2.0 product boundary is:

- Standard web and plugin-owned Node abilities belong to the installed plugin, with a clear install-time trust decision for Node code.
- WebTools-specific capabilities continue to pass through Main-owned, typed, revocable Host APIs.
- A Node-capable plugin gets Node in its isolated preload, not in the page. The page keeps nodeIntegration disabled, contextIsolation enabled, and webSecurity enabled. Full Node preload requires an unsandboxed plugin renderer in the current Electron model; this is a material trust tradeoff and must be stated plainly. It is not an OS sandbox.
- Keep one on-demand Electron Manager process, one active UI Feature, NativeHost ownership, package identity and immutable validated package bytes.
- Use a persistent plugin Session shared by plugin origins; derive one stable origin per canonical plugin ID and put Features below that host as paths. Browser origin isolation separates plugin storage while letting Features of one plugin share it.
- Restore ordinary Chromium networking and standard web storage, and enable Dedicated/Module Workers. Keep CORS, TLS, and webSecurity enabled. Gate 4 remains historical high-assurance research, not a normal-plugin release gate.
- Move local Node data to a lifecycle-managed plugin data directory. Keep PluginStore as the smaller WebTools-managed API.
- Make a deliberate breaking move from Web Manifest v2 to a new closed Manifest v3 contract. Keep the existing v1 declarative compatibility path; require old v2 web packages to be repacked rather than inventing a complex conversion layer.

Two concrete implementation prerequisites were found: website/favorites IPC, Everything IPC, and the version handler do not all use the exact Manager-main-frame sender guard used by other sensitive handlers; and development Native pipe authentication accepts launch-Job descendants while passing the pipe name through inherited environment. A Node preload can access Electron renderer IPC and the development pipe path, so close both gaps before enabling Node plugins. They are first implementation steps, not reasons to defer the architecture decision. Also, same-user Node plugins cannot be promised OS-enforced secrecy from user-account data such as encrypted-at-rest secrets; installation trust must describe that limit.

Estimated production impact is **HIGH** because this changes the plugin runtime privilege profile, package and Manifest contract, persistent browser state, preload composition, network policy, and acceptance suite. The work can still be done in a controlled sequence without redesigning NativeHost, Launcher, FeatureRef, Manager lifecycle, or Native projection.

### Finding severity

- **P0: 0**
- **P1: 2 implementation prerequisites before Node activation:** uniform Main IPC sender guards; narrow development Native pipe authentication to Electron Main or disable Node plugins in dev.
- **P2: 3 bounded packaged checks, non-blocking to start implementation:** custom-origin CORS/preflight, exact custom-origin storage cleanup coverage, and representative npm/pnpm dependency-tree materialization.
- **P3: 0**
- The same-user SecretStore caveat is an inherent limit of the explicitly selected install-trust model, not a Host API bug. If the product instead requires OS-enforced secrecy from installed Node code, Node runtime must be disabled or separated by another OS identity/broker.

## 2. Current Repository State

### 2.1 Git and protected work

| Field | Observed |
|---|---|
| Repository | D:\SystemDefault\Desktop\HomePage |
| Branch | codex/shared-ai-translation-2.0 |
| HEAD | 707c5673dff479285b34a5b441bec9d3b725c737 |
| Index | Empty; no staged paths |
| Working tree | Dirty before this report; protected Launcher work and existing untracked evidence/design/build residue are present |

Pre-existing working-tree paths, all preserved:

- Modified: native/WebTools.NativeHost.Checks/Program.cs
- Modified: native/WebTools.NativeHost/Catalog/AppCatalogService.cs
- Untracked: docs/bugfix-launcher-app-search-after-autostart.md
- Untracked: docs/phase6e7-connection-egress-feasibility.md
- Untracked: docs/phase6e7-network-gate4-design.md
- Untracked generated residue: undefined/manager-package/win-unpacked/resources/app.asar

The three protected Launcher files retain the supplied SHA-256 values:

| Path | SHA-256 |
|---|---|
| native/WebTools.NativeHost.Checks/Program.cs | 1E0F46FA219277A061D5234E1EFC103120B63E5DED0AE1335BA6F4EE99AAC9D0 |
| native/WebTools.NativeHost/Catalog/AppCatalogService.cs | EA2F84F917603FA6CE3D61DFFF0267E45EE7DA89973EBAE0A24DC1F4A73521FD |
| docs/bugfix-launcher-app-search-after-autostart.md | B5FB3AF4F618D927275ED3D3C07ACCC8F06FE55480902DCF0D2A0BABA1E2BBA8 |

The unrelated generated app.asar is 34,634,260 bytes and retains SHA-256 282F98E970CECBB1CFCB2203E586356CED2DA20D7E277BAB9794FB9EAABDC96D. It was not used as an input and was not changed.

No checkout, reset, clean, stash, staging, commit, push, production installation, or real profile operation was performed. D:\webtools and %APPDATA%\Nook were not touched.

### 2.2 Toolchain and package shape

| Item | Observed |
|---|---|
| Node.js | v24.21.0 |
| pnpm | 9.15.9 |
| npm | 12.0.2 |
| Electron dependency resolved from installed package | 44.4.5 |
| Chromium | 152.0.7977.130, from the repository's Phase 6E-7 runtime identity |
| Product package | webtools-desktop 0.1.0 |
| Root package manager declaration | pnpm@9.15.9 |

There is no pnpm workspace. The repository has the root Node package plus standalone package manifests for plugin-sdk/declarative-v1 and tests/security/web-plugin-runtime-probe. Root electron-vite builds Main, preload, and Vue renderer; Main and preload dependencies are externalized. The root electron-builder configuration packages out/**/* and package.json and does not currently package third-party plugin runtime payloads. The current built-in plugin support and package validator are application code, not an independently packaged plugin host.

The root script is named test, not tests. The documented equivalent pnpm test was run. No package scripts, dependencies, lockfiles, Vite/electron-vite configuration, or electron-builder configuration were changed.

### 2.3 Historical documents reviewed

The review cross-checked the Phase 6C architecture/security/projection contracts; Phase 6D audit, Feature Registry, projection, invocation, pipe-authentication, and acceptance reports; Phase 6E-1 audit; 6E-2 runtime contract; 6E-3 Manifest v2 validator; 6E-4A/4B/4C probe and acceptance reports; 6E-5 SDK/bridge reports; 6E-6 capability design/report; and 6E-7 Gate 4 design and feasibility report.

The current 6E-7 feasibility report remains **INCONCLUSIVE**, Gate 4 remains **NOT CERTIFIED**, and network.mode:domains remains unsupported by the old runtime. Those historical results are retained as written and are not reclassified as a Runtime 2.0 defect or pass.

## 3. Current Plugin Runtime Architecture

The current production path is:

~~~mermaid
flowchart LR
  NH[WPF NativeHost: tray, hotkey, Launcher, search] -->|authenticated typed FeatureRef / intent pipe| Main[Electron Main: on-demand authority]
  Main --> PM[PluginManager: validate install, grants, package identity]
  PM --> FR[Feature Registry and metadata projection]
  Main --> MW[one Manager BrowserWindow]
  Main -->|at most one active UI Feature| WV[WebContentsView]
  WV -->|fresh random origin, local-only protocol| P[Manifest v2 Web Plugin]
  P -->|sandboxed dedicated preload / bounded bridge| Bridge[Main-authenticated Web Plugin Bridge]
  Bridge --> Host[PluginStore, Shared AI, clipboard and context]
  FR -->|metadata only| NH
~~~

Observed behavior and boundaries:

- NativeHost owns the always-on Launcher, tray, global hotkey, native application search, and Native Feature projection.
- NativeHost starts Electron only for Manager work. Manager is one BrowserWindow and a separate WebContentsView is mounted for the currently active Web Feature.
- Main resolves and revalidates FeatureRef, plugin identity/version/hash, enabled state, grants, context and runtime generation. The Host-provided immutable snapshot serves exact inventoried package bytes.
- The Web Plugin view currently has sandbox=true, contextIsolation=true, nodeIntegration=false, webSecurity=true, webviewTag=false and a dedicated web-plugin preload.
- A fresh random 128-bit host is generated for each invocation. One in-memory Session is reused sequentially. All browser permission requests/checks and downloads are denied; a Session webRequest handler cancels non-package requests; a direct proxy is set.
- The CSP permits only same-origin connections and workers are denied. WASM requires a Feature declaration.
- Runtime close revokes authority, removes listeners/view, closes WebContents and clears Session storage/cache before another generation can open. This teardown correctness is valuable but its storage-erasure policy is contrary to Runtime 2.0 persistence.
- Normal Manager close closes the runtime and quits Electron. NativeHost stays alive. No extra plugin daemon or Electron instance is currently part of the architecture.
- Feature Registry and Native projection contain only safe metadata. They do not parse or execute plugin code and must remain that way.

## 4. Old Security Model Inventory

“Retire” below means remove as a normal Runtime 2.0 plugin contract after replacement acceptance is ready. It does not mean deleting historical evidence or changing the archived result of an old gate.

| Old assumption | Production source and tests enforcing it | Runtime 2.0 decision | Migration action |
|---|---|---|---|
| Only network.mode:none is executable; domains are inert/ungrantable | plugin-sdk/declarative-v1/runtime/manifest-v2.mjs, electron/plugins/web-runtime-policy.ts, electron/plugins/plugin-manager.ts; manifest-v2.test.mjs, web-runtime-policy.test.mjs, plugin-manager.test.mjs, web-plugin-authority.test.mjs, verify-phase6e6-packaged-capabilities.mjs | Ordinary installed plugins get standard Chromium networking; network is not a WebTools Host capability | Remove network from the new manifest and grant set; remove admission rejection; replace deny tests with standard network/CORS tests. Keep Gate 4 research historical |
| Session webRequest cancellation is the network security boundary | electron/plugins/web-plugin-runtime.ts; web-plugin-runtime.test.mjs and packaged 6E-4 probes | Chromium network stack handles ordinary requests; webRequest is not a domain/IP security gate | Remove the cancel-all filter; retain protocol-local package serving, lifecycle observation and request diagnostics only where needed |
| Session proxy is forced to direct | electron/plugins/web-plugin-runtime.ts; 6E-4B probe | Do not override OS/Electron normal proxy configuration | Remove setProxy({mode:'direct'}); test standard system proxy behavior only if acceptance environment can do so reliably |
| Per-invocation random origin is an isolation primitive | web-runtime-policy.ts and web-plugin-runtime.ts; web-runtime-policy.test.mjs, web-plugin-runtime.test.mjs | Stable per-plugin origin gives identity-scoped browser storage | Replace random host with deterministic hash host of canonical plugin ID; retain exact-host/path/snapshot authorization |
| All web storage is disposable and cleared on runtime close | web-plugin-runtime.ts calls clearStorageData(), clearCache(); 6E-4B fixture/probe asserts transient localStorage/IndexedDB removal | localStorage and IndexedDB persist by plugin origin; CacheStorage may persist by normal origin quota | Remove teardown clearing; add restart/update/uninstall tests; clear only the exact origin on explicit data removal |
| worker-src none; no Worker | web-runtime-policy.ts; web-runtime-policy.test.mjs, web-plugin-runtime.test.mjs, 6E-4B probe | Dedicated and Module Workers are standard plugin capability | Replace worker denial with local/Blob Worker tests; defer SharedWorker and Service Worker |
| WASM is a declared Feature capability | manifest-v2 parser, CSP generator and runtime; manifest-v2.test.mjs, web-runtime-policy.test.mjs, 6E-4B fixture | WASM is ordinary web capability subject to CSP | Remove executionRequirements.wasm and the per-Feature gate; allow wasm-unsafe-eval in baseline CSP and add real WASM fixture |
| All permission requests and downloads are denied | web-plugin-runtime.ts Session handlers; web-plugin-runtime.test.mjs and packaged probe | Do not block ordinary web primitives. Keep unsupported device/browser permissions denied by default; supported permissions need explicit per-origin UX. Route user-initiated downloads through a user-visible save flow | Replace unconditional download cancellation with safe save-dialog handling; retain deny for unsupported permission types and test origin-bound permission handling |
| CSP is intentionally self-only and blocks normal build behavior | web-runtime-policy.ts; web-runtime-policy.test.mjs, 6E-4B probe | Allow local production scripts/chunks, common styles/assets, WASM, workers and normal API/WebSocket URLs while denying remote executable scripts and eval | Replace CSP baseline and test each directive by behavior, not string fragments alone |
| Plugin has no preload, Node or npm runtime | web-plugin-runtime.ts, electron/web-plugin-preload.ts, manifest-v2/package-v2 validators; package-validator.test.mjs, web-plugin-runtime.test.mjs, 6E-4B probe | Optional installed Node runtime with a plugin-owned preload, frontend Node-disabled | Add runtime mode and preload/dependency inventory; web remains no-Node; node mode is explicit install trust and unsandboxed renderer tradeoff |
| Plugin code cannot access ipcRenderer | web-plugin-preload.ts and web-plugin-preload-client.ts; preload-client and bridge tests; current tests assert renderer Node APIs absent | Node preload can use Electron renderer IPC; that must not grant a WebTools route | Uniformly guard every Main IPC handler by exact trusted sender; bridge remains narrow and independently authenticated |
| v2 archive contains only a narrow web/assets inventory and rejects executable/runtime packaging | plugin-sdk/declarative-v1/runtime/manifest-v2.mjs and package-v2.mjs; package-v2.test.mjs, package-validator.test.mjs | Continue closed inventory and size/type limits, but permit declared JS/CJS/MJS/package metadata and materialized JS dependencies; continue to reject native .node in first release | New v3 inventory groups and packer; no blanket node_modules exclusion; exact archive inventory remains Host-validated |
| External requests should fail in packaged acceptance | scripts/create-phase6e4b-runtime-fixture.mjs, scripts/verify-phase6e4b-packaged-runtime.mjs and security/web-plugin-runtime-probe; evidence reports and tests | External requests work under standard CORS/TLS/browser semantics | Replace current-runtime acceptance; retain old probe and JSON only as historical Gate 1 evidence |
| Gate 4 must certify every network connection before standard requests work | docs/phase6e2-web-plugin-runtime-contract.md, docs/phase6e7-network-gate4-design.md and docs/phase6e7-connection-egress-feasibility.md | Gate 4 only applies if a future high-assurance untrusted remote-content mode is proposed | Remove it from ordinary plugin release checklist; keep the INCONCLUSIVE research record unchanged |
| New-window/navigation policy is treated as part of egress denial | web-plugin-runtime.ts; runtime tests/probe navigation checks | Continue to prevent takeover of Manager/NativeHost and unexpected windows, but do not block ordinary fetch, XHR, WebSocket, SSE or same-plugin navigation | Keep exact runtime-origin navigation; deny popups by default or use a reviewed external-open handoff; allow requested web requests normally |
| Runtime generation, authority, package hash and revocation are “untrusted plugin isolation” controls | web-feature-authority.ts, web-plugin-bridge.ts, web-plugin-runtime.ts, plugin-manager.ts; authority/bridge/runtime tests | Keep as WebTools API authorization and stale-runtime protection, not as a claim to OS isolation | Preserve and adapt identity tuple to stable origin plus active version/hash/generation; still revoke before switching/close |
| Security evidence JSON certifies future Runtime 2.0 behavior | tests/security/web-plugin-runtime-gate1/results/phase6e4c-gate1-evidence.json and evidence.test.mjs | Evidence is valid only for the old packaged policy/build | Keep immutable as historical evidence; new acceptance creates separately named sanitized Runtime 2.0 evidence |

## 5. uTools-aligned Capability Target

The target is familiar desktop-plugin ergonomics, not uTools API or implementation compatibility:

- Web features are normal applications: HTML/CSS/JS, TypeScript build output and framework bundles; normal Fetch/XHR/Axios/EventSource/WebSocket; local and remote assets; browser storage; Workers and WASM.
- Node-capable plugins can include a Host-loaded preload with Node and ordinary npm JavaScript dependencies.
- WebTools-specific services stay narrow and typed: invocation context, Shared AI, PluginStore, clipboard/Host integration and future Feature integrations.
- Node mode trusts the installed package as local code running with the user's account. A confirmation should say it may access user-readable files, network, programs and resources. Do not make every filesystem/network/process operation ask for confirmation.
- No promise of OS isolation for Node plugins. API isolation protects WebTools private capabilities; it does not remove the operating-system rights of Node code.

## 6. Runtime 2.0 Proposed Architecture

~~~text
NativeHost (tray / Launcher / hotkey / local search; always on)
  └─ authenticated existing Manager pipe: typed FeatureRef / invocation
       └─ Electron Main (on demand; one Manager BrowserWindow; one active UI Feature)
            ├─ Host-authoritative v3 validation + content-addressed immutable package
            ├─ Feature authority (plugin, feature, version, hash, grants, generation)
            ├─ one persistent plugin Session, distinct from Manager default Session
            └─ WebContentsView
                 ├─ web mode: sandboxed page; no Node
                 └─ node mode: nodeIntegration:false page + contextIsolation:true
                      + webSecurity:true + Host bootstrap + declared plugin preload
                           ├─ ordinary browser APIs: Chromium network, storage, Worker, WASM
                           ├─ Node plugin APIs: installed-code trust; user account rights
                           └─ WebTools public facade → authenticated typed Main bridge
                                └─ context / PluginStore / Shared AI / clipboard
                                     (never raw secrets, internal IPC authority or Native pipe)
~~~

Main stays the only source of package/runtime authority. A Feature switch synchronously revokes the old generation and closes the existing WebContentsView before opening the next. Manager close destroys Host-owned runtime contents and quits the Electron process group. No persistent background plugin runtime is introduced in this release. A plugin may spawn child processes from its Node preload; those are plugin-created processes and are outside any claim that WebTools can terminate arbitrary descendants. The Host must close what it owns and clearly disclose that plugins are trusted local code.

## 7. Optional Plugin Preload Model

### 7.1 Chosen model

Use one Host-owned bootstrap file as the sole Electron preload path. It establishes the WebTools public facade and the private bridge transport, validates the plugin preload path against the Host-created runtime descriptor, then loads the declared plugin preload inside the same isolated preload context. The plugin preload is a regular declared package file and may import its packaged JavaScript dependencies using Node resolution. It does not receive a second Electron preload slot.

The public page continues to use nodeIntegration=false, contextIsolation=true and webSecurity=true. The WebContentsView differs by runtime mode:

| Mode | nodeIntegration | contextIsolation | sandbox | webSecurity |
|---|---:|---:|---:|---:|
| web | false | true | true | true |
| node preload | false | true | false | true |

Electron documents that sandboxing is on by default and that disabling it is necessary for full Node behavior; a sandboxed preload has only a polyfilled subset of Node modules. A preload still has privileged access while the page remains isolated, and contextBridge is intended for narrow APIs. The exact Electron 44.4.5 sources are [WebPreferences](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/web-preferences.md), [Process Sandboxing](https://github.com/electron/electron/blob/v44.4.5/docs/tutorial/sandbox.md), and [contextBridge](https://github.com/electron/electron/blob/v44.4.5/docs/api/context-bridge.md).

### 7.2 Electron API and IPC boundary

The Node preload can require Electron renderer APIs including ipcRenderer. It must not receive Manager's electron/preload.ts or any raw Host channel list. The Host facade is the existing narrow SDK bridge, not ipcRenderer. Plugin code can attempt arbitrary channel names, so correctness must be enforced in Main: every registered handle/on/sendSync route must classify the sender and reject any Web Plugin WebContents unless that exact route is explicitly part of the private plugin bridge. The initial audit found unguarded routes in website-handlers.ts, everything-handlers.ts and IPC_CHANNELS.getVersion in main.ts; audit every remaining route, including routes registered through helpers, before the first Node runtime is enabled.

The bridge authenticates identity from Main's actual WebContents/main frame plus the current runtime descriptor, plugin/version/package hash and generation. Renderer-supplied IDs, paths and “capability tokens” are not authority. The Node preload can use contextBridge for its own plugin API; it cannot gain Host privileges by importing SDK code or by knowing an IPC channel. Any API object exposed in the page remains plugin-controlled and is not trusted by Main.

### 7.3 Composition and failures

Electron provides a single preload path in WebPreferences. The bootstrap is therefore the stable composition point; the package-supplied entry is validated as one exact regular file under the immutable plugin directory and loaded only after Host initialization. Host bridge setup must be idempotent and reserved to a WebTools namespace. If the plugin preload throws, the Host catches/reports the preload error, marks only that plugin runtime as failed and closes its WebContentsView; Manager/Main continue operating. Electron emits preload-error for an unhandled preload exception; use that event plus render-process-gone for diagnostics/teardown. Exact v44.4.5 references: [preload-error](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents.md) and [preload loading implementation](https://github.com/electron/electron/blob/v44.4.5/lib/renderer/init.ts).

For the first release accept exactly one CommonJS .cjs plugin preload entry. Authors may write TypeScript/ESM and bundle to that entry. This is a packager/resolution simplification, not an Electron limitation: Electron 44.4.5 source loads both CJS and .mjs preload paths. Revisit additional entry formats only if an actual plugin fixture requires them.

### 7.4 Dependencies and native modules

The SDK provides build/pack guidance, not a second runtime. A plugin package includes its declared production JS dependencies as regular materialized files with package metadata needed for Node resolution. Packer output must not preserve pnpm symlinks or references outside the source root; Host validation checks canonical relative paths, exact inventory, file types, byte/entry/expansion limits and collision rules before installation. Package code is never executed during validation.

Do not support native .node addons in the first release. Their ABI, Electron-specific rebuild, platform/architecture matrix, signing and native loading authority greatly widen release and review scope. JavaScript dependencies plus browser/WASM and JS/WASM SQLite options cover the initial target. The package validator must reject .node files; this is an explicit support boundary, not a claim that a trusted Node plugin is otherwise sandboxed.

## 8. WebTools Private Boundary

| Always Main-owned | Plugin-owned ordinary capability |
|---|---|
| Host runtime authority, FeatureRef resolution, grants/revocation, package/version/hash identity | DOM, JS, HTML/CSS, frameworks and bundled runtime code |
| Main internal services and registered IPC routes | Browser Fetch/XHR/Axios/SSE/WebSocket with normal CORS/TLS |
| NativeHost pipe, tray/hotkey/search state and private Manager state | Node built-ins and npm JS dependencies in declared preload mode |
| SecretStore entries, provider credentials and Shared AI raw keys | Plugin-owned files and child processes under current user rights |
| Other plugins' WebTools-managed PluginStore/Plugin Local Data | Plugin-origin localStorage, IndexedDB and CacheStorage |
| Typed context, Shared AI, PluginStore, clipboard/approved Host integrations | Worker, WASM, normal assets and plugin backend |

Keep the SDK limited to WebTools-specific methods. Keep current Host-side authorization, quotas, cancellation and safe output shaping. A Node plugin may create its own token or backend connection; it must never receive the Shared AI key, provider credential, SecretStore entry, WebTools account credential, raw NativeHost pipe, arbitrary Main service, or another plugin's managed data.

**Trust-model limit:** this table describes the APIs WebTools exposes, not confidentiality against code trusted to run with the current Windows user's full rights. The current SecretStore file is under Electron userData and stores Electron safeStorage-encrypted values; Main alone calls its decrypt path. A Node plugin is nevertheless explicitly trusted local code and may inspect user-readable files or invoke user-context operating-system facilities. Runtime 2.0 can guarantee that no documented SDK/IPC call returns a raw credential; it cannot honestly guarantee that a malicious Node plugin running as the same user can never recover a credential protected only by that user's account. If the product requires OS-enforced secrecy from installed Node plugins, that requirement conflicts with this trust model and needs a separate identity/broker boundary or disabling Node runtime. This report treats “private Host capability” as API/service isolation, with the limitation shown in Node install consent.

### IPC closure gate

Before enabling Node runtime, change Main IPC registration so all routes share an exact trusted-sender classification. The trusted Manager main frame can call Manager APIs; the exact plugin main frame can reach only the Host bridge transport; subframes, destroyed/stale senders and unrelated WebContents are rejected. A route with no documented owner is denied. Add table-driven tests enumerating every registered IPC channel, with malicious plugin WebContents as sender. In particular guard website/favorites CRUD and Everything file search/open, plus getVersion. This is a P1 enablement prerequisite because the new preload can access ipcRenderer; it is not an unresolved design question.

The NativeHost pipe has a related concrete dev-mode caveat. In packaged mode, ManagerPeerIdentityService requires the exact launched Manager PID, creation time and image, so a separate plugin renderer process cannot authenticate as the packaged Manager. In development mode it accepts a process inside the Electron launch Job; plugin renderer children may also be in that Job. ManagerProcessLauncher places WEBTOOLS_NATIVE_PIPE in the inherited Manager environment, and electron/main.ts reads it. Therefore Node plugin code in development may learn the pipe name and, by using Node net, may attempt a raw pipe connection that passes the current Job-membership test. Before enabling Node plugins in development, narrow the development peer rule to the actual trusted Electron Main process (or explicitly disable Node plugin activation in development) and add a real isolated negative test. This does not require changing the pipe protocol or NativeHost product ownership.

## 9. Network Model

- Remove network.mode and network.domains from the v3 normal plugin contract and Host grant list. Standard web network does not pass through a new webtools.fetch/axios/worker API.
- Allow ordinary Chromium fetch, XHR, Axios, EventSource, WebSocket/WSS and HTTP(S) under normal browser semantics. Node preload uses Node networking and is governed by install trust and the user's OS rights.
- Keep webSecurity=true, certificate validation, same-origin policy and CORS. Do not disable TLS verification or install a global CORS bypass.
- Keep CSP as defense against unintended remote executable script. API traffic is allowed by connect-src but remote script/module origins remain absent from script-src.
- Honor the normal OS/Electron proxy behavior; remove forced direct proxy. Do not add a broker, CONNECT proxy, DNS pinning or Gate 4 to the standard plugin path.
- Custom protocol handler serves only the active plugin's exact inventoried files. It must not become a route to other installed plugins. Ordinary https/http requests are left to Chromium, not canceled by that handler.
- Keep navigation and popup controls for Host protection: disallow navigation that replaces the active app-owned origin or leaves the WebContentsView policy. A popup may be denied or handed to the approved external opener after URL validation; neither rule blocks ordinary fetch.
- Maintain deny-by-default for unsupported device/system permission APIs. If a standard browser permission is later supported, prompt per plugin/origin with explicit bounded choices. This is separate from network and must not silently turn normal requests into consent dialogs.
- Replace blanket download cancellation with user-visible save behavior for a plugin-initiated browser download; do not allow a hidden download to write arbitrary paths.

Gate 4, exact domains, DNS A/AAAA checks, private IP rejection, socket pinning, CONNECT broker, QUIC/UDP and WebRTC egress proof are retired from normal plugin acceptance and retained as **Historical / High-Assurance Network Isolation Research**. The 6E-7 INCONCLUSIVE result remains unchanged.

## 10. Session Model

Use one lazily created persistent Session with a fixed app-owned partition such as persist:webtools-plugin-runtime-v3. It is shared by sequential plugin runtime views and is separate from the Manager/default Session. Do not create a permanent Session per plugin. The Electron v44.4.5 API confirms that persist: partitions are persistent and shared by pages using the same partition, while partitions without that prefix are in-memory; Session options cannot be changed after first use. See [Session API](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md) and [WebPreferences partition semantics](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/web-preferences.md).

Origin, not Session count, is the browser storage isolation boundary: one plugin's stable origin is same-origin with its own Features and cross-origin with another plugin. The protocol handler maps only active plugin package requests; same Session does not authorize package-file access. Manager continues to use its own default Session.

Configure safe permission handling, explicit download routing and the app-owned protocol on this Session once. Do not add webRequest cancel-all or force-direct proxy. Use Chromium cache defaults and quotas; persistent cache may improve repeated launches, but clear cache as a performance control only when needed, never as a storage wipe. Manager close destroys WebContents and exits Electron; the disk-backed Session remains for future launches. Electron has no public per-session destroy API; a single shared partition avoids unbounded Session objects.

## 11. Origin / Storage Model

### 11.1 Recommendation and alternatives

| Option | Storage sharing and isolation | Decision |
|---|---|---|
| 1. Stable origin per plugin | Same plugin Features share browser storage; different plugin hosts are cross-origin | Choose |
| 2. Stable origin per Feature | Isolates every Feature but fragments one plugin's durable state and migration | Reject for first release |
| 3. Stable plugin host plus Feature path | Same origin, distinct URL path per Feature; supports stable assets and shared plugin data | Choose together with option 1 |
| 4. Separate stable storage identity from runtime URL | Requires a second host-managed persistence layer or mapping; does not naturally give browser localStorage/IndexedDB persistence | Defer |

Map canonical validated plugin ID to a deterministic ASCII origin host such as p- plus the full lowercase SHA-256 of the UTF-8 ID. Do not interpolate raw IDs, Unicode, IDN or punctuation into the hostname. Use URLs like webtools-plugin://p-<digest>/<feature-id>/index.html. The digest is a namespacing token, not a secret.

The scheme is already registered as standard, secure and fetch-capable. Electron's v44.4.5 protocol docs explicitly state that web storage APIs are disabled for non-standard custom schemes and enabled for a standard scheme, so the current custom scheme foundation is suitable for localStorage, IndexedDB and cookies. Keep registration before app ready. See [protocol API, custom scheme privileges](https://github.com/electron/electron/blob/v44.4.5/docs/api/protocol.md).

### 11.2 Lifecycle policy

- Plugin A cannot read Plugin B localStorage/IndexedDB through browser APIs because origins differ and same-origin policy remains enabled. Tests must also prove the protocol handler does not serve B's files in A's runtime.
- Features belonging to one plugin share origin storage. If later a plugin requires Feature-level isolation, add a deliberate schema/storage migration; do not change first-release origin granularity.
- Updates retain storage when the canonical plugin ID is unchanged. Version/hash/generation still change runtime authority, not origin.
- Uninstall offers explicit keep/remove managed data behavior. Keep means stable origin data and Node Local Data remain for reinstall; remove means clear the exact plugin origin's localStorage/indexedDB/cookies/CacheStorage and remove its Host-managed data directory.
- Reinstall with same ID reuses retained data only after normal install trust and version confirmation. A different ID never inherits it.
- Browser localStorage/IndexedDB/CacheStorage and cookies use normal Chromium per-origin semantics and quotas. Add a documented app-level disk-budget policy and visibility in Plugin Center; do not claim infinite storage. Persistent Session plus stable origin preserves data across Manager close and WebTools restart.
- A stable custom origin is sent to remote servers as the browser request Origin when applicable; CORS remains server-controlled. Add a packaged test recording exact Origin/preflight behavior. Node requests are not subject to browser CORS, but remain plugin-owned trusted code.
- Node preload is not authorized by the browser origin. Main still authenticates the actual sender and active runtime identity.

## 12. Worker / WASM Model

- Dedicated Worker: enabled for packaged same-origin scripts and supported blob workers under CSP.
- Module Worker: enabled for same-origin bundled modules and module dependencies included in the package.
- SharedWorker: defer first release; it complicates lifecycle because worker state may outlive a single document.
- Service Worker: defer first release; it adds long-lived background, Cache/network interception, update and Manager-close semantics. Do not use this deferral to deny Dedicated or Module Workers.
- WASM: permit under CSP using wasm-unsafe-eval. Remove executionRequirements.wasm; no Host grant or per-Feature permission is needed.
- Node preload worker_threads are ordinary Node runtime behavior when Node mode is trusted; no independent Host daemon is started.

Acceptance must verify Worker termination on view close and no worker/background process keeps Electron alive after Manager close.

## 13. CSP Model

Use a non-disabled, modern-app baseline. Candidate policy:

~~~text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline' https: http:;
img-src 'self' data: blob: https: http:;
font-src 'self' data: https: http:;
media-src 'self' data: blob: https: http:;
connect-src 'self' https: http: ws: wss:;
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
frame-src 'self';
form-action 'self' https: http:;
~~~

This supports local Vite-style production chunks and dynamic import, framework-generated inline styles, ordinary image/font/media resources, WASM, Dedicated/Module Workers, API calls, SSE and WebSocket. It does not allow eval or remote executable JavaScript. External CSS is not executable JS but is still network content; allow it in this baseline for real application compatibility while keeping remote script sources absent. Use webSecurity=true and normal mixed-content enforcement: an HTTP endpoint may be blocked from a secure context depending on Chromium's rules, which is an intentional normal browser semantic rather than a Host network gate. If acceptance shows a specific framework production bundle needs a narrower adjustment, test that bundle instead of globally disabling CSP.

CSP is a web frontend defense. It is not a sandbox against a Node-enabled installed plugin, whose preload is explicitly trusted local code.

## 14. Plugin Local Data Model

Add a Main-owned, lifecycle-managed directory under the existing WebTools userData root, for example plugins/plugin-data/<stable-safe-key>/. Stable-safe-key should be a deterministic digest derived from the validated canonical plugin ID, avoiding Windows reserved names, Unicode normalization, traversal, case folding and path-length surprises. SDK Node preload exposes a Host-provided pluginLocalData.getPath() helper (or equivalent) returning only that plugin's data directory; it does not expose another plugin's path. The path helper is developer ergonomics and lifecycle management, not a filesystem sandbox: Node code can already use ordinary fs permissions.

Create the directory lazily after package validation/install or first Node runtime use, with owner-only application defaults where Windows ACLs permit. Use existing ManagedFs path checks for Host-owned initialization/deletion. Reject/recover reparse points when resolving the Host-managed root; cleanup must not recursively follow junctions/symlinks outside it. Because plugin code has arbitrary fs in Node mode, explain that the plugin can manipulate files it can reach and this API cannot enforce confinement.

Update preserves data. Uninstall defaults to keep, matching current PluginManager private-data behavior, and offers explicit delete. Explicit delete removes the exact mapped plugin directory and browser origin data only after confirming identity and completing an operation journal. Portable installs still store data under Electron's userData, not under the package/install directory. Exclude data, database, model, cache and generated files from package archives.

PluginStore remains a separate, quota-bounded WebTools-managed key/config API useful for settings, migration and future Host-managed sync. It is not a replacement for SQLite, IndexedDB or large local files.

## 15. Manifest v2 Impact and Candidate v3

Keep identity, name/metadata, version, API compatibility, Features, Host capabilities, package hash and exact package inventory. Make the runtime model explicit:

~~~json
{
  "manifestVersion": 3,
  "id": "vendor.example",
  "name": "Example",
  "version": "1.0.0",
  "api": { "major": 1 },
  "runtime": { "kind": "web" },
  "requestedCapabilities": ["sharedAI.complete"],
  "features": [
    {
      "id": "main",
      "title": "Example",
      "entry": { "kind": "web-bundle", "document": "web/index.html" },
      "requiredCapabilities": []
    }
  ],
  "webBundle": { "files": [] },
  "assets": []
}
~~~

For Node mode, runtime.kind is node and a closed nodeBundle declaration identifies the one CJS preload entry, package metadata, and exact production dependency file inventory. The exact field names and quotas are an implementation task; they must be finalized in SDK and Host validator together, with Host validation remaining final authority. Keep the runtime declaration Plugin-scoped and Feature entries unchanged. Do not add permissions for standard web APIs.

| Manifest v2 field/contract | v3 |
|---|---|
| plugin identity, metadata, version, API major, Features/entries | Preserve |
| requestedCapabilities / per-Feature requiredCapabilities for WebTools Host APIs | Preserve; only WebTools-specific capabilities |
| network.mode and network.domains | Remove from ordinary runtime and persisted grants |
| executionRequirements.wasm | Remove; WASM is baseline web capability |
| webBundle and assets closed inventory | Retain with bounded exact inventory |
| no preload, no package.json/node_modules, reject all runtime files | Replace with explicit optional nodeBundle and materialized JS dependency inventory |
| random runtime origin | Not a manifest field; derive stable host from canonical plugin ID |
| unknown-field rejection and Host final validation | Preserve and extend to v3 runtime payloads |

This is a breaking change to Manifest v2 Web packages. Do not auto-convert v2 packages because they contain no declared runtime/preload contract and their network declarations were never executable. Existing v1 declarative packages continue through the already established v1 adapter. Existing v2 Web packages must be re-packed as v3; the Plugin Center should mark them as needing repack/reinstall and avoid silently changing their trust level. No broad compatibility layer is justified before public ecosystem release.

## 16. SDK / Bridge Impact

The thin SDK direction is correct and should remain:

- Keep context, Shared AI, PluginStore, clipboard and future WebTools-specific Host APIs.
- Keep request bounds, closed schemas, rate/concurrency quotas, timeout/cancellation and safe error shaping in the bridge.
- Add runtime/preload helpers and pluginLocalData.getPath() typing for Node mode.
- Do not wrap Fetch, Axios, WebSocket, EventSource, Worker, IndexedDB, fs, path or Node http.
- Keep bridge identity Main-derived. Do not serialize internal runtime authority, grants or channel names into the SDK.
- Split SDK entry points by runtime (web page SDK and node preload SDK) so web plugins do not import Node declarations accidentally.
- Bump SDK major only if its current public package contract requires it; product version, Plugin API major and Native projection contract do not need to change solely because Manifest v2 is replaced.

The current SDK at plugin-sdk/declarative-v1 is a narrow web bridge with context/storage/AI/clipboard methods and no networking or Node wrapper. Its capabilities are appropriate, but its package name/path/types are coupled to the v1/v2 declarative contract and need a new stable Runtime 2.0 entrypoint.

## 17. Host Capability Impact

- PluginStore: preserve service, storage schema, quota and safe managed file I/O. Consider separate naming in UI from Plugin Local Data; no schema rewrite is needed for Runtime 2.0.
- Shared AI: preserve Main-owned service and SecretStore adapter, input review, confirmation, provider selection, output filtering, quotas and cancellation. Never return credential/provider secret. Do not lower the current per-call confirmation in this task; it may be a future UX review because it is stricter than install-time trust, but that is not a Runtime 2.0 blocker.
- Clipboard: preserve explicit typed Host calls and current permission rules. Node fs or Electron clipboard import is not a substitute for WebTools clipboard integration if the plugin requests WebTools-specific behavior.
- Context/Feature authority: preserve Main-created context and FeatureRef, generation, package version/hash, enabled state and grants for every WebTools API call.
- Consent: show a one-time install/update trust warning when runtime.kind=node, with the full local-code rights explanation. Do not issue prompts per fs/network/process operation. Host API capability consent remains separate.
- UI: Plugin Center can show runtime kind and data-removal actions without changing Native Feature projection contracts.

## 18. File-by-file Production Impact Matrix

| File | Current responsibility / old assumption | Runtime 2.0 change | Dependencies and tests | Risk |
|---|---|---|---|---|
| electron/main.ts | Registers custom scheme; owns Manager window, PluginManager/runtime wiring and IPC routes | Keep lifecycle; guard getVersion and every route; register v3 protocol/session services; preserve on-demand quit | main tests, ipc tests, packaged acceptance | HIGH |
| electron/plugins/web-plugin-runtime.ts | Random-origin WebContentsView, sandboxed preload, deny-all permission/download, cancel-all webRequest, direct proxy, clears all storage at close | Split web/node preferences; stable origin; persistent Session; Host bootstrap; normal network; safe download; exact package protocol; no storage wipe on close | runtime/policy/bridge tests; installed fixture | HIGH |
| electron/plugins/web-runtime-policy.ts | Random origin, self-only CSP, worker none, network none and WASM Feature gate | Stable origin mapping, v3 policy validation, modern CSP and worker/WASM rules | policy tests and Chromium packaged tests | HIGH |
| electron/plugins/validated-web-package-snapshot.ts | Immutable inventory-backed bytes, package identity/hash | Keep; extend immutable validated snapshot to web and node bundle file groups, preload/dependency metadata | snapshot/validator tests | MEDIUM |
| electron/plugins/package-validator.ts | Host authoritative v1/v2 dispatch | Dispatch v1 declarative plus v3 runtime; do not fall back from invalid v3; v2 Web is repack-required | validator tests and SDK parity | HIGH |
| plugin-sdk/declarative-v1/runtime/manifest-v2.mjs | Strict v2 schema with network, WASM declaration, web-only inventory | Add v3 parser/contract; retire v2 as active Web runtime schema; retain historical tests/evidence | SDK schema tests | HIGH |
| plugin-sdk/declarative-v1/runtime/package-v2.mjs | Web-only ZIP inventory and executable extension denial | Add v3 exact inventory for web/preload/deps; materialize regular files; reject .node and unsafe links | packer/Host parity tests | HIGH |
| electron/plugins/plugin-manager.ts | Installs and restores v1/v2; blocks domains; grants APIs; manages identity/hash/lifecycle | Preserve install transaction/grants/identity; change v2 rejection to v3 runtime trust; add trust consent and plugin data lifecycle; remove network grant filtering | manager/registry/authority tests | HIGH |
| electron/plugins/plugin-registry.ts | Persists plugin identity, versions, grants and status | Keep identity/version/hash and grant revocation; remove normal network.domains grant semantics; persist v3 runtime kind as normalized metadata only if needed | registry/manager tests | MEDIUM |
| electron/plugins/managed-fs.ts | Safe bounded Host-managed filesystem operations | Keep and reuse for package install and managed plugin-data root; do not portray as boundary for Node | managed-fs/plugin-store tests plus data deletion tests | LOW |
| electron/plugins/plugin-store.ts | Host-managed config/key storage with quotas and private-data retention/deletion | Keep format/API; distinguish from large Plugin Local Data | PluginStore regression remains | LOW |
| electron/plugins/web-feature-authority.ts | Main-only Web Feature grant, package and generation authority | Keep; ensure stable origin is derived after identity validation; bind each call to current runtime generation/version/hash | authority tests | MEDIUM |
| electron/plugins/web-plugin-bridge.ts | Typed requests, sender/frame/generation auth, bounds/rate/abort/revoke | Keep and audit Main IPC transport; Node page must not be trusted to provide identity | bridge and adversarial sender tests | MEDIUM |
| electron/plugins/web-plugin-bridge-routes.ts | Private bridge request/response/cancel route names | Keep narrow routes; never expose raw IPC route list in page SDK | route tests | LOW |
| electron/plugins/web-plugin-preload-client.ts | Sandboxed preload-side typed bridge client | Keep transport mechanics; update to Host bootstrap and split Node/page facade if needed | preload-client tests | MEDIUM |
| electron/web-plugin-preload.ts | Current small plugin preload entry, exposes typed facade | Convert to Host bootstrap or make explicit web-mode bootstrap; add Node mode composition without Manager preload | packaged tests, preload-error lifecycle | HIGH |
| electron/preload.ts | Trusted Manager desktop facade | Preserve exclusively for Manager BrowserWindow; never reuse for plugin view | phase4f architecture regression | LOW |
| electron/ipc/window-security.ts | Exact Manager WebContents/main-frame sender predicate | Generalize to explicit sender roles and exact plugin WebContents identity; fail closed | window-security and exhaustive IPC route tests | HIGH |
| electron/ipc/website-handlers.ts | Favorites/websites reads/writes; current routes lack uniform sender checks | Add exact trusted Manager sender guard before Node mode | IPC route enumeration + website regression | HIGH |
| electron/ipc/everything-handlers.ts | File-search detect/choose/search/open; current routes lack uniform sender checks | Add exact trusted Manager sender guard; reject plugin view | IPC route enumeration + isolated file-search tests | HIGH |
| electron/ipc/settings-handlers.ts | Manager settings routes with existing guard | Keep and include in exhaustive sender audit | settings IPC tests | LOW |
| electron/ipc/translation-handlers.ts | Translation routes with existing guard | Keep guard, ensure plugin sender denied | translation IPC tests | LOW |
| electron/ipc/plugin-handlers.ts | Plugin UI operations guarded to Manager frame | Keep; ensure no Node plugin can call Manager-only management APIs | plugin IPC tests | LOW |
| electron/ipc/plugin-catalog-handlers.ts | Catalog/registry IPC with sender guard | Keep Manager-only; include all route names in audit | catalog IPC tests | LOW |
| electron/ipc/builtin-translation-handoff-handlers.ts | Fixed Main handoff and session validation | Preserve fixed typed request; Node plugin cannot forge NativeHost identity | handoff tests | LOW |
| electron/ipc/window-handlers.ts | Manager ready and Native intent acknowledgements | Keep exact sender/session validation and test helper internals | window and handoff tests | MEDIUM |
| electron/plugins/electron-plugin-host.ts | Install/version consent and plugin operations | Add clear Node local-code trust warning; preserve capability consent and no credential disclosure | consent UI tests/manual acceptance | MEDIUM |
| electron/plugins/permission-broker.ts | WebTools-specific capability policy | Remove network.domains as a grant; keep only Host capabilities and revocation | broker/authority tests | MEDIUM |
| electron/plugins/web-host-capabilities.ts | Context, PluginStore, Shared AI, clipboard | Keep policy and calls; add explicit Plugin Local Data path only in Node API | host-capability tests | MEDIUM |
| electron/plugins/web-host-confirmation.test.mjs | Confirms sensitive Host effects | Keep; do not conflate plugin install trust with per-call Host capability policy | focused test | LOW |
| electron/services/shared-ai-service.ts | Provider/credential-owned Main service | Preserve unchanged; never expose secret through new preload | Shared AI tests | LOW |
| electron/services/secret-store.ts and ai-credentials.ts | Secret storage and provider credential boundary | Preserve unchanged; exhaustive tests ensure no raw credential route | secret/AI tests | LOW |
| electron/services/secret-store-core.ts and electron/main.ts credential initialization | Encrypted SecretStore file and Main-only decrypt call site | Keep Main API ownership; disclose same-user Node trust limitation; never treat encryption-at-rest as isolation from a trusted same-user Node plugin | no-key-return tests plus trust-consent review | MEDIUM |
| electron/plugins/feature-registry.ts and src/shared/feature-contracts.ts | Derived metadata-only Feature registry | Preserve schema and metadata-only behavior | existing projection tests | LOW |
| electron/services/native-feature-projection-publisher.ts | Publishes safe feature metadata to NativeHost | Preserve; no package bytes, paths, runtime or Node capability cross pipe | publisher tests | LOW |
| native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs and NativeFeatureProjectionStore.cs | Typed Manager pipe/projection receiver | Preserve; no Runtime 2.0 package transport or raw plugin IPC | existing Native checks | LOW |
| native/WebTools.NativeHost/Services/ManagerPeerIdentity.cs and ManagerProcessLauncher.cs | Production peer requires exact launched PID/image/time; development peer currently trusts launch Job membership and passes pipe name in environment | Keep production authentication; before Node plugins run in development, restrict peer identity to actual Electron Main or disable Node mode in dev; do not change pipe contract | Add isolated real-pipe tests proving plugin renderer cannot impersonate Main in both modes | HIGH |
| electron/plugins/manifest-v2.test.mjs | Enforces v2 network/WASM and closed schema | Retire as active v2 Web contract; preserve frozen historical evidence and replace with v3 tests | schema migration | MEDIUM |
| electron/plugins/web-runtime-policy.test.mjs | Asserts random origin, self-only CSP, network none | Rewrite for stable host, modern CSP, Worker/WASM and protocol inventory | Chromium acceptance | HIGH |
| electron/plugins/web-plugin-runtime.test.mjs | Lifecycle, race, crash, session cleanup | Keep lifecycle assertions; change expected persistence/network/Worker behavior | packaged runtime regression | HIGH |
| scripts/create-phase6e4b-runtime-fixture.mjs and scripts/verify-phase6e4b-packaged-runtime.mjs | Builds/asserts offline, ephemeral old runtime | Preserve as historical runner or archive; do not present as Runtime 2.0 acceptance | replace with v3 packaged fixtures | MEDIUM |
| scripts/verify-phase6e6-packaged-capabilities.mjs | Asserts domains remain unavailable | Retire from current plugin acceptance; preserve historical run result | new packaged network test | MEDIUM |
| plugin-sdk/declarative-v1/** | Current thin Web SDK, v1 path and v2 package tooling | Add stable v3 SDK entrypoints, web/page and node/preload exports; retain no standard API wrappers | all SDK workflow tests | HIGH |
| tests/security/web-plugin-runtime-probe/** | 6E-4A policy probe for no Node/no network/no Worker | Keep only as immutable historical evidence, mark unsupported as current acceptance | no longer release gate | LOW |
| tests/security/web-plugin-runtime-gate1/results/phase6e4c-gate1-evidence.json | Sanitized old Gate 1 evidence | Preserve unchanged and label old build/policy scope | evidence.test remains historical | LOW |
| electron.vite.config.ts, package.json, electron-builder config | Build/externalize app and package Manager | Only targeted packaging changes if needed to include Host bootstrap; avoid dependency additions unless demonstrated necessary | pnpm build/package, output-layout tests | MEDIUM |

## 19. Test Migration Matrix

| Existing test/fixture | Classification | Migration |
|---|---|---|
| web-runtime-snapshot.test.mjs | KEEP / EXTEND | Preserve immutable bytes, canonical inventory, hash authority, size/path/type defenses; cover web + node payload groups |
| package-validator.test.mjs and package-v2.test.mjs | REPLACE ACTIVE CONTRACT | Keep archive adversarial cases; add v3 package/preload/node_modules regular-file inventory; continue reject .node, links and unsafe paths |
| manifest-v2.test.mjs | HISTORICAL ONLY / REPLACE | Keep only if documenting frozen old parser; active tests cover v3 and no v3-to-v2 fallback |
| web-runtime-policy.test.mjs | UPDATE EXPECTATION | Stable origin, normal connect-src, Worker/WASM, remote script denied, eval denied, feature URL exactness |
| web-plugin-runtime.test.mjs | KEEP / UPDATE EXPECTATION | Keep generation, crash, hang, switch/close race and listener cleanup; assert persistent state survives restart and normal network is not canceled |
| plugin-manager.test.mjs and plugin-registry.test.mjs | KEEP / UPDATE EXPECTATION | Keep transactions, identity/hash, revocation, rollback, data retention; replace network.domains-grant cases with runtime trust and v3 state |
| web-feature-authority / web-plugin-authority tests | KEEP | Preserve sender-derived authority, Feature/version/hash/grants/generation and stale-operation denial |
| web-plugin-bridge / preload-client tests | KEEP / EXTEND | Keep narrow methods, bounds, rate, cancellation and identity-free payload; test Node preload cannot invoke non-bridge Main handlers |
| web-host-capabilities / web-host-confirmation tests | KEEP | Preserve Shared AI/clipboard/context/plugin data policies and no credential output |
| plugin-store.test.mjs | KEEP | Existing config/data quotas and explicit deletion behavior remain |
| window-security.test.mjs | EXTEND | Add plugin-main-frame role plus subframe/stale/unrelated sender denial |
| IPC handler tests | ADD / EXTEND | Enumerate every registered channel and verify untrusted plugin WebContents are rejected before service access |
| create/verify-phase6e4b-runtime-fixture | HISTORICAL ONLY | Old offline fixture must not be relabeled; create v3 fixture set |
| verify-phase6e6-packaged-capabilities.mjs | REMOVE OBSOLETE ACCEPTANCE | Its domains-unavailable assertion is superseded by normal browser networking |
| 6E-4A policy probe tests/results | HISTORICAL ONLY | Preserve old no-Node/no-network/no-Worker evidence but remove from current acceptance gate |
| Phase 6E-4C Gate 1 evidence JSON | KEEP IMMUTABLE / HISTORICAL | Do not rewrite, delete or use as Runtime 2.0 proof |
| New Standard Web fixture | ADD | Vue or equivalent plus Fetch/Axios/XHR/WebSocket/SSE, localStorage/IndexedDB restart, Dedicated/Module Worker, WASM, normal CORS and failed-CORS control |
| New Node-capable fixture | ADD | Host bootstrap + plugin preload, Node built-ins and packaged npm dependency, fs/path, local data, Node network and child_process; explicitly record unsandboxed renderer tradeoff |
| New Host Integration fixture | ADD | Context, PluginStore, Shared AI with fake provider, clipboard and negative tests for SecretStore/raw IPC/pipe/other plugin data |
| New framework fixtures | ADD | Vanilla/Vue/React/Svelte build → validate → pack → install → launch → close → relaunch |
| New lifecycle/security fixture | ADD | same PID/Manager lifecycle, Worker close, preload error, crash/hang/switch, no background daemon, Electron=0 after Manager close; distinguish plugin-created child processes |

The standard runtime acceptance must use packaged Host, real validated v3 packages, authoritative Host validator, immutable snapshot, actual custom protocol, actual persistent Session and actual WebContentsView. Unit policy tests alone cannot certify it.

## 20. Breaking Changes

1. Manifest v2 Web packages become incompatible with active Runtime 2.0; they must be repacked as Manifest v3. Declarative v1 compatibility remains.
2. network.mode/network.domains cease to be ordinary runtime or grant state. Old domains declarations are not migrated into new permissions.
3. executionRequirements.wasm is removed; WASM is a normal web capability.
4. Web package inventory expands to declared runtime/preload/dependency files; regular node_modules must be materialized. Native .node remains rejected.
5. Browser storage changes from cleared per invocation to persistent by stable plugin origin. This is observable and requires explicit uninstall data behavior.
6. Node-mode install consent becomes a local-code trust decision with a clear rights warning. It is not an OS sandbox or per-call permission prompt.
7. The Web Runtime SDK entrypoint/package path is versioned for the v3 contract; no wrappers for standard APIs are added.

## 21. Migration Order

The sequence keeps the existing v1 declarative path and Manager/Native architecture while avoiding a period where Node runtime is enabled against unguarded IPC.

| Step | Files / work | Exit criteria and tests |
|---|---|---|
| 0. Freeze baseline | Add no product behavior; record branch/HEAD, pnpm test/typecheck/build and protected files; identify all IPC registration sites | Baseline is reproducible; no user dirty files included |
| 1. Close Main IPC sender boundary | electron/ipc/window-security.ts; every electron/ipc/* registration; electron/main.ts; website/everything/version handlers; focused tests | Every registered route has a declared sender role; exhaustive test proves Web Plugin sender cannot touch Manager services, Favorites, Everything, settings, AI, secrets, pipe or catalog |
| 2. Define v3 contract and packer/Host validator together | plugin-sdk/declarative-v1/runtime new v3 parser/package code; electron/plugins/package-validator.ts, snapshot, manifest types; focused schema/package tests | Closed exact inventory, bounds, path/symlink/type defense; no code executed at validate/install; Host validator is final authority; v1 remains |
| 3. Add install trust and local-data lifecycle | PluginManager/registry, Plugin Center consent, ManagedFs or focused LocalData service, tests | Node package triggers one clear trust prompt; plugin data is safely mapped, retained on update, explicit keep/delete on uninstall; .NET-style OS isolation is not claimed |
| 4. Implement stable origin and persistent Session | web-runtime-policy.ts, web-plugin-runtime.ts, Main protocol/session setup and tests | Stable hashed per-plugin origin; one shared persist partition, separate from Manager; localStorage/IndexedDB isolation and restart survival; protocol serves only active package snapshot |
| 5. Compose the optional Node preload | Host bootstrap, web-plugin-preload, SDK node entrypoint, validator-resolved CJS preload, packaged tests | Web remains sandboxed; Node mode keeps page nodeIntegration=false/contextIsolation=true/webSecurity=true and sets sandbox=false; preload failure is contained/reported; dependency resolution works from packaged files |
| 6. Restore web platform behavior | CSP/session policy/runtime handlers and test fixtures | Chromium Fetch/XHR/Axios/SSE/WS, CORS/TLS, Workers, WASM and normal assets pass; remote executable JS and eval remain denied; safe permissions/download behavior is explicit |
| 7. Integrate Host APIs | web bridge, Host capabilities, SDK declarations and UI | Context/PluginStore/Shared AI/clipboard still use Main authority; no raw secrets/internal API; bounded calls/revocation remain |
| 8. Packaged acceptance and old-policy retirement | New verification scripts, Standard Web/Node/Host/framework fixtures, old verifier removal from active release flow | All packaged fixtures build/validate/install/launch/close/relaunch; Manager close yields Electron=0; no Host daemon; cross-plugin storage/data isolation proven |
| 9. Remove obsolete active v2 runtime assumptions and update docs | old v2 runtime rejection/tests/policy wording; current acceptance docs | No active test or UI treats network:none, ephemeral storage or no Worker as product acceptance; historical 6E4/6E7 records remain unchanged |

Do not delete old tests or policy before the replacement fixture covers the corresponding capability. Do not add a migration compatibility mode for old Manifest v2 Web packages.

## 22. Risks / Open Questions

### Known risks with concrete treatment

| Risk | Severity | Treatment |
|---|---|---|
| Full Node preload disables Chromium renderer sandbox | HIGH / accepted product tradeoff | Make Node an explicit install-time trust level; display rights; keep page isolation/webSecurity; no claim of OS sandbox; standard Web mode retains sandbox |
| Unguarded existing Main IPC routes | P1 implementation prerequisite | Step 1 guards exact sender before Node is activatable |
| Development Job-based Native pipe identity may include plugin renderer children | P1 implementation prerequisite for Node-plugin development | Narrow development peer identity to the real Main process or disable Node-plugin activation in development; add real-pipe negative test |
| Same-user Node code may reach data protected only by the current user's account | HIGH / inherent trust-model limit | Treat Node install as trusting that package with current-user rights; do not claim absolute SecretStore secrecy; use another OS identity/broker or prohibit Node if stricter secrecy is required |
| Persistent storage adds disk growth and stale data | MEDIUM | Stable origin, bounded app-documented budget, explicit uninstall keep/delete, no wipe at Manager close |
| Arbitrary plugin child_process can outlive Host-owned WebContents | MEDIUM | Document plugin-created process distinction; do not claim the Host owns/kills arbitrary descendants; acceptance watches Host-owned Electron only |
| CORS sees a custom webtools-plugin origin | MEDIUM | Browser semantics remain normal; packaged controlled-server fixture records Origin/preflight and positive/negative CORS |
| npm dependency trees may contain symlinks/platform binaries | MEDIUM | Packer materializes regular files, Host checks exact inventory and rejects native addons/links |
| Shared Session still requires strict origin and protocol authorization | MEDIUM | Hashed plugin host, SOP, exact active snapshot, cross-plugin URL and storage negative tests |

### Non-blocking bounded questions

1. **Exact custom-origin CORS/preflight bytes in packaged Electron 44.4.5.** Electron documents standard scheme storage and the runtime uses Chromium, but only the package can establish the precise Origin/preflight seen by representative servers. Minimal experiment: an isolated local HTTP(S) test server plus actual WebContentsView. This is not an architecture blocker; ordinary CORS remains enabled.
2. **Exact uninstall cleanup coverage for cookies/CacheStorage on custom origins.** The API supports origin-scoped storage clearing; confirm the exact stores in the packaged fixture before shipping deletion UX. This does not block implementing persistent storage.
3. **Node dependency packaging edge cases.** Packer should materialize a small representative pnpm and npm dependency tree. Native addons remain out of scope; no new dependency is justified by this audit.

No question requires reopening Gate 4, delaying the first Runtime 2.0 implementation, or redesigning the NativeHost architecture.

## 23. What Can Be Deleted / Retired

- Active Runtime 2.0 rejection of network.mode other than none and network.domains grants.
- Forced direct proxy and Session cancel-all request/redirect policy.
- Random per-invocation origin generator and “fresh origin as isolation” assumptions.
- Runtime-close clearStorageData()/clearCache() as a required privacy wipe.
- worker-src none and tests expecting Worker failure.
- Feature-level WASM permission and executionRequirements.wasm.
- Blanket download cancellation, replaced with user-visible save handling.
- Manifest v2 Web runtime parser/active release acceptance after v3 package fixtures pass.
- 6E-4B offline test runner and 6E-6 domains rejection runner as current acceptance gates.

Retirement must not remove historical reports, old sanitized evidence, or Phase 6E-7's INCONCLUSIVE finding. Keep the Gate 4 design available for a future remote-untrusted/high-assurance mode.

## 24. What Must Be Preserved

- WPF NativeHost as the always-on tray, Launcher, global hotkey, native search and Native Feature projection owner.
- Manager/Electron starts on demand; normal Manager close leaves Electron process count at zero.
- Existing authenticated NativeHost↔Manager pipe, typed FeatureRef, feature invocation, and one-active-UI-Feature model.
- Feature Registry and Native projection remain metadata-only; never send package bytes, preload code, filesystem paths, secrets or runtime authority to NativeHost.
- Host-authoritative package validation, strict archive/path/type/size/duplicate protections, exact package inventory, package hash and immutable validated snapshot.
- Plugin identity, version, compatibility, grant/revoke, current generation, cancellation and safe Main authority revalidation.
- WebTools private boundary, Main-owned SecretStore and Shared AI credentials, existing PluginStore schema/quotas and safe Host APIs.
- Separate trusted Manager preload from every plugin preload.
- Web mode sandbox and Node mode install trust disclosure; no false OS isolation promise.
- Current user changes and all historical 6C–6E evidence.

## 25. Final Recommended Implementation Plan

This is the implementation order for the next approved task, not authorization to implement now:

1. **Sender authorization first:** enumerate Main IPC routes and exact trusted senders; guard website/favorites, Everything, getVersion, and any helper-registered route. Add exhaustive plugin-WebContents negative tests. Also tighten development Native pipe peer authentication (or disable Node plugins in dev), since launch-Job membership can include renderer children. Do not enable Node until both checks pass.
2. **Freeze Manifest v3 and SDK contract:** retain v1 declarative compatibility; define runtime kind, per-Feature web entry, optional CJS Node preload, exact materialized dependency inventory, Host-only requested capabilities and quotas. Remove network and WASM permission fields from v3. Write parser and package parity tests.
3. **Host validator and transactional install:** validate the entire v3 archive before extraction or execution; install immutable content-addressed regular files; reject links, traversal, collisions and .node; bind registry version/hash/runtime trust. Keep Host validation authoritative.
4. **Trust and Plugin Local Data:** install/update warning for Node code; add deterministic per-plugin userData path and safe keep/delete lifecycle. Preserve current PluginStore independently.
5. **Stable origin and Session:** register the already privileged standard secure scheme before ready; use a distinct persistent plugin partition; map canonical IDs to hashed ASCII hosts; use feature paths; enforce active snapshot-only protocol serving; test storage isolation, update retention, restart persistence and uninstall cleanup.
6. **Host bootstrap and Node preload:** one Host-owned bootstrap as sole preload; web mode uses sandbox; node mode uses sandbox=false while page stays nodeIntegration=false, contextIsolation=true and webSecurity=true. Load exactly the validated CJS plugin preload; support regular JS npm dependencies; contain/report preload failure.
7. **Normal browser platform policy:** standard Chromium networking and proxy, normal CORS/TLS, modern CSP, Dedicated/Module Worker and baseline WASM. Keep eval and remote script-src denied. Implement a user-visible download path and an explicit supported browser-permission allowlist; unsupported permissions remain denied.
8. **Preserve and adapt Host APIs:** keep SDK thin and split web/node entrypoints. Retain context, PluginStore, Shared AI and clipboard behind the current Main authority/revocation model; prove that Node preload IPC cannot access internal Main services or credentials.
9. **Packaged adversarial acceptance:** actual packaged Electron/Manager, Host validator, persistent Session, custom protocol and WebContentsView. Run Standard Web, Node, Host integration and Vanilla/Vue/React/Svelte fixtures through build/validate/pack/install/launch/close/relaunch. Test same-PID Manager lifecycle, no Host daemon, and Electron=0 after close.
10. **Retire only superseded active gates:** remove v2 Web runtime assumptions and old acceptance assertions after replacement fixtures pass. Keep Manifest v1 declarative adapter, all historical Gate 1/4 artifacts and previous phase measurements unchanged.

## 26. Direct Answers to Q1–Q25

| Q | Decision |
|---|---|
| Q1. How much runtime can be reused? | Most of the Host lifecycle, WebContentsView, immutable snapshot/protocol, package identity, Feature authority, bridge, PluginStore and Manager lifecycle. Runtime policy, origin/session/storage, schema/inventory, IPC guard coverage and acceptance need substantial work. |
| Q2. What old security design must be removed? | Normal-runtime network:none/domains gate, forced direct proxy, cancel-all webRequest, ephemeral random origin/storage wipe, Worker denial, WASM declaration, no-Node/preload assumption, no-node_modules inventory rule and their current acceptance expectations. |
| Q3. What security remains valuable? | Main authority, exact sender/frame checks, strict Host validator, path/type/size/integrity rules, package hash/snapshot, Feature generation/revocation, narrow Host bridge, SecretStore boundary, webSecurity/CORS/TLS, navigation/popup controls and sandbox for web mode. |
| Q4. Best Optional Plugin Preload? | One Host-owned bootstrap configured as the sole preload; it initializes the public bridge and loads the one Host-validated CJS plugin preload in the isolated context. |
| Q5. Does frontend keep nodeIntegration=false? | Yes in both web and node modes. |
| Q6. How does preload get Node without internal IPC? | Node-enabled mode uses sandbox=false for full Node in preload, contextIsolation=true and page nodeIntegration=false; sender-guard every Main IPC route, tighten the development Native pipe peer rule (or disable Node mode in dev), and expose only typed SDK bridge. This is API isolation, not protection from code trusted as the same OS user. |
| Q7. How are npm dependencies supported? | Packer stages/materializes production JS dependencies and exact package files; Node resolves them relative to immutable plugin package. Do not package pnpm symlinks. |
| Q8. Native Node add-ons in v1? | No; reject .node due ABI, platform/build/signing and native code risk. |
| Q9. Session model? | One lazily initialized persistent plugin partition shared by sequential plugin views, isolated from Manager default Session. |
| Q10. Stable origin? | Deterministic per-plugin SHA-256 ASCII host plus Feature path. |
| Q11. Storage isolation/persistence? | Chromium origin isolation in persistent Session; same plugin Features share; update/restart retain; uninstall offers exact origin and local data keep/delete. |
| Q12. Network APIs? | Normal Chromium requests through Fetch/XHR/Axios/SSE/WebSocket and Node network; no generic SDK wrapper. |
| Q13. CORS? | Keep normal Chromium CORS/TLS. Server must allow the webtools-plugin origin. Node network is outside browser CORS as trusted plugin code. |
| Q14. Workers? | Enable Dedicated and Module Workers; defer SharedWorker and Service Worker first release. |
| Q15. WASM declaration? | No. Baseline CSP permits WASM; remove executionRequirements.wasm. |
| Q16. CSP? | Allow local/normal app assets, inline styles, network connect, workers and wasm-unsafe-eval; keep eval and remote executable scripts denied. |
| Q17. Plugin Local Data? | Host-resolved per-plugin directory under userData, safe stable mapping, explicit lifecycle keep/delete, returned only to that plugin's Node preload; ergonomics, not sandbox. |
| Q18. network.mode fields? | Remove from the new normal manifest/grants; do not retain as an optional mode now. Gate 4 remains historical for a future high-assurance product mode. |
| Q19. PluginStore? | Keep service, format, quotas and API; distinguish from larger local files/databases. |
| Q20. Shared AI? | Keep Main service, SecretStore, confirmation, quotas and output filtering; no raw keys. Review confirmation UX separately, without lowering it here. |
| Q21. Runtime generation/Feature authority? | Keep and bind it to stable plugin origin plus active version/hash/generation; it still protects WebTools APIs and stale runtime transitions. |
| Q22. Manifest v2 break size? | Breaking for v2 Web packages: re-pack as v3. Keep v1 declarative compatibility; no v2 auto-conversion layer. |
| Q23. Validator rules to relax? | Allow declared CJS/MJS/JS/JSON and materialized JS dependencies/preload inventory; retain exact inventory, bounds, traversal/duplicate/link/type defenses; continue to reject .node. |
| Q24. Tests to delete/rewrite? | Rewrite tests asserting network denied, storage cleared, Worker/WASM denied or no Node; retire old domains packaged gate from active acceptance; preserve lifecycle, authority, validator and historical Gate evidence. |
| Q25. Safest shortest order? | Main IPC sender gate → v3 contract/validator → Node trust and local data → persistent Session/stable origin → preload → ordinary web policy → Host API integration → packaged acceptance → retire old active gates. |

## 27. Baseline Verification

No source was changed to obtain these results. The first focused invocation passed the source list as one PowerShell argument and Node reported “Could not find …”; this was a command-line quoting issue, not a test failure. Re-running with Node's supported test glob produced:

| Check | Result |
|---|---|
| Focused Plugin tests: pnpm exec node --experimental-strip-types --test 'electron/plugins/*.test.mjs' | PASS — 190 tests, 0 failed, 0 skipped |
| Full Node suite: pnpm test | PASS — 537 tests, 0 failed, 0 skipped |
| pnpm run typecheck | PASS |
| pnpm run build | PASS — Electron Main, both preload bundles and Vue renderer built |
| git diff --check before report edit | PASS; existing CRLF normalization warnings only |

The full suite reports Module Typeless package warnings because package.json has no type:module; those warnings existed in the current test/build invocation and did not fail verification. The exact command requested as pnpm tests is not a defined root script; pnpm test is the actual project script and was run.

No real installed application, user profile, NativeHost runtime, or production installation was exercised. This was a source/build baseline only.

## 28. Final Audit Status

- Old Plugin Runtime assumptions are confirmed in multiple production paths and tests; this is not a name-only inference.
- New Runtime 2.0 architecture and migration order are sufficiently specified to start implementation.
- Two P1 implementation prerequisites remain before Node activation: complete uniform Main IPC sender guards, and prevent a development Job descendant from authenticating directly to the NativeHost pipe. They are explicitly first in the plan and do not block starting that controlled implementation.
- The existing SecretStore is encrypted at rest and only Main exposes a decrypt API, but a trusted same-user Node plugin is outside an enforceable secrecy boundary. The Node install warning must state this; stricter isolation would require a separate OS identity/broker and is not part of this design.
- Historical Gate 4 remains INCONCLUSIVE / NOT CERTIFIED and is no longer a normal plugin capability gate.
- Production implementation: none.
- Existing Launcher work, historical reports, user data and generated app.asar: preserved.
- Commit/push/PR: none.

**Final decision: READY FOR PLUGIN RUNTIME 2.0 IMPLEMENTATION**
