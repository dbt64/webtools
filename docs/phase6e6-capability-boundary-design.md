# Phase 6E-6 Capability Boundary Research & Design

**Status:** research/design only; ready for review
**Repository:** D:\SystemDefault\Desktop\HomePage
**Branch / HEAD at audit:** codex/shared-ai-translation-2.0 / 5d56309ac3bf4529352b7da64db07f8a5457c500
**Historical checkpoint:** test(plugins): validate packaged web plugin bridge
**Protected Launcher work:** unchanged; remains outside this phase
**Scope:** one design document only. No product code, test, SDK, Bridge, Manifest, package, lockfile, or frozen design was changed.

## 1. Executive Summary

WebTools should keep Web Plugins as ordinary web applications and expose only a small, typed Host boundary for operations that the sandbox cannot safely perform itself. Browser, npm, JavaScript, and WASM remain the default implementation tools. No generic request API, Node/Electron surface, raw IPC, filesystem path API, shell API, or SDK reimplementation of standard web features is justified.

The first Phase 6E-6 implementation set contains four capability families, consistent with the already-frozen Phase 6E-2 contract:

1. Invocation-bound **context.current()** for only a validated, accepted text context. Launcher input is the safe initial source. Clipboard text remains one-shot and requires a deliberate Native action plus its separate grant and authenticated handoff.
2. **storage.get/set/delete** backed by the existing Main-owned PluginStore, with read and write kept as separate grants. No key enumeration or arbitrary path.
3. **ai.complete({prompt})** through the existing SharedAIService and the user-selected default model/provider. The plugin sees only **{text}**.
4. **clipboard.writeText(text)** as the already-designed, single-purpose, user-confirmed write. No clipboard read/history/monitor, image, file, or rich clipboard API.
**external.open(url)** remains a valid future Host capability because default-browser integration crosses the Host/system boundary, but it is deferred: it adds less platform-validation value to the first slice than the four different authority shapes above.

This is not a proposal to add new capability strings: use the names and meanings already present in Phase 6E-2 / Manifest v2. In particular, context acceptance is metadata tied to one Feature invocation, not a new ambient clipboard permission.

**The minimum persisted Manifest v2 authority needed by Host capabilities is a formal Phase 6E-6 production-enablement prerequisite.** The v2 validator can parse a package, but the current PluginManager deliberately rejects v2 for installation; the current Web Bridge supports readiness, close, cancellation plumbing, and **bridge.ping** only. Test-only or explicitly trusted first-party paths may validate mechanics, but no selected capability may be exposed to ordinary third-party production plugins until the complete persisted identity/grant/Feature/runtime authority chain exists and survives restart, update, disable, revocation and uninstall.

Shared AI should remain a Host service used by built-in features and explicitly authorized plugins. The effective first plugin operation must honor frozen Phase 6E-2: one user prompt, no caller-supplied roles or provider/model override, no streaming, no tool calling, no credentials or endpoint exposure, Host confirmation on each call, cancellation, safe errors, and the existing quota contract. Whether a persisted grant plus an explicit foreground user action could later replace per-call confirmation is recorded only as a possible contract amendment; Phase 6E-2 remains authoritative unless that amendment is explicitly approved. Plugin-owned network AI remains an independent future track behind Phase 6E-7; local WASM/WebGPU AI remains plugin-owned and does not need Shared AI permission.

Competitor documentation confirms useful patterns—model discovery, streaming/cancellation, storage, clipboard, system integration and dynamic features—but documents broader privileged surfaces than WebTools should copy. The recommendations below are WebTools decisions, not feature-parity requirements.

## 2. Current WebTools Baseline

The audit distinguishes **implemented behavior** from **frozen design** and **future recommendation**.

### Main, Manager, and Web Plugin boundary

- The Electron Main process creates the SecretStore, AI credential store, SharedAIService, TranslationService, plugin services, and their IPC handlers. The settings and credential services are therefore already on the trusted side; a plugin Renderer must not receive the trusted Manager preload.
- The Web Plugin runtime owns one Main-created WebContentsView in the existing Manager window, one isolated non-persistent Session, a validated immutable package snapshot, a random webtools-plugin:// origin, and a runtime generation. It uses sandboxing, context isolation, nodeIntegration false, web security, no webview, no insecure content, and no DevTools in the production runtime. See [web-plugin-runtime.ts](../electron/plugins/web-plugin-runtime.ts#L38) and [web-runtime-policy.ts](../electron/plugins/web-runtime-policy.ts#L5).
- CSP defaults to no resources except package-origin scripts/styles/images/fonts and same-origin connection declarations; Workers and frames are denied. Runtime selection rejects any Manifest whose network mode is not none. These are implementation boundaries, not permission grants. See [web-runtime-policy.ts](../electron/plugins/web-runtime-policy.ts#L13).
- The public @webtools/plugin-sdk/web currently exposes connectWebTools() whose frozen public client has ready and onClose; there is no public generic request, method string, runtime identity, grant, or capability API. See [index.mjs](../plugin-sdk/declarative-v1/web/index.mjs#L4), [bridge-client.mjs](../plugin-sdk/declarative-v1/web/bridge-client.mjs#L34), and the [Phase 6E-5C report](phase6e5c-minimal-plugin-bridge-implementation.md#browser-sdk-and-private-facade).
- The production Web Bridge authenticates the active sender/runtime generation, validates a closed wire format, bounds pending calls and request rates, supports cancellation, and revokes pending work synchronously. Its only accepted operation is side-effect-free bridge.ping; unknown methods fail closed as unavailable. See [web-plugin-bridge.ts](../electron/plugins/web-plugin-bridge.ts#L20), especially lines 54–112 and 115–169.
- The Manager preload is a trusted application surface; it is not a Plugin API. Keep the dedicated Web Plugin preload and fixed private transport separate. The SDK must only expose capability-specific typed functions above that transport.

### Manifest v2 and persisted authority

- The v2 Manifest validator has a bounded requested-capability allowlist and per-Feature declarations such as required capabilities and accepted contexts. A declaration is package input, not a user grant. See [manifest-v2.mjs](../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs#L14) and the [Phase 6E-3 validator report](phase6e3-manifest-v2-validator.md).
- The current PluginManager.install validates an incoming package and rejects incoming.kind === v2 as INCOMPATIBLE_PLUGIN before persisting it. Existing persisted registry/grant state and setGrants belong to the declarative v1 path. See [plugin-manager.ts](../electron/plugins/plugin-manager.ts#L244) and [plugin-registry.ts](../electron/plugins/plugin-registry.ts#L8).
- The current shared v1 capability list includes clipboard.write, sharedAI.complete, storage/config, external-open and Manager-page effects. V1 confirmation/provider paths are not proof that an untrusted WebContents has a v2 grant. See [plugin-contracts.ts](../src/shared/plugin-contracts.ts#L2), [permission-broker.ts](../electron/plugins/permission-broker.ts#L33), and [electron-plugin-host.ts](../electron/plugins/electron-plugin-host.ts#L21).
- The Phase 6E-5 packaged acceptance explicitly excludes normal persisted v2 installation/grants and adds no production Host capability. Gate 4 remains uncertified and network.mode:domains remains unsupported. See [Phase 6E-5E acceptance](phase6e5e-packaged-bridge-acceptance.md#scope-boundaries-and-limitations).

### Shared AI, Translation, settings, and secrets

- SharedAIService is already provider-neutral enough to reuse: it reads settings.sharedAI.defaultProviderId, resolves the configured model and endpoint in Main, obtains a credential through AIProviderCredentialStore, selects an adapter, and calls the provider. Its internal AIProviderInfo and SharedAICompletion also contain provider/model and API-key/configuration status, which should **not** be passed through to Web Plugin code. See [shared-ai-service.ts](../electron/services/shared-ai-service.ts#L14) and [ai-provider-registry.ts](../electron/services/ai-provider-registry.ts#L5).
- Providers currently include OpenAI, Anthropic, Gemini, DeepSeek, Qwen, and Custom/OpenAI-compatible descriptors. Endpoint validation enforces HTTPS except local loopback HTTP, rejects URL credentials/query/hash, and builds the provider-specific endpoint inside Main. See [ai-provider-registry.ts](../electron/services/ai-provider-registry.ts#L15) and lines 47–79.
- AIProviderCredentialStore addresses the SecretStore by internal provider ID. Electron safeStorage encrypts strings; Main stores the serialized secrets file under the app user-data directory. Plugins must never receive the key, authorization header, SecretStore handle, path, or raw endpoint. See [ai-credentials.ts](../electron/services/ai-credentials.ts#L10), [secret-store.ts](../electron/services/secret-store.ts#L1), and [main.ts](../electron/main.ts#L526).
- TranslationService is translation-specific orchestration: translation settings, language validation, request cancellation/admission, MyMemory and Qwen-MT adapters, prompt construction, translation-specific timeouts, and use of SharedAI as one optional translation engine. SharedAI completion/adapters/credentials are generic; translation prompt and business-provider configuration are not. See [translation-service.ts](../electron/services/translation-service.ts#L11) and lines 44–80 / 127–174.
- Translation IPC and Manager settings endpoints are trusted Manager functionality. They expose provider status/setup operations to trusted UI and are not safe Web Plugin calls. See [translation-handlers.ts](../electron/ipc/translation-handlers.ts#L32).

### PluginStore, Feature context, clipboard, and system actions

- The current v1 PluginStore stores strict JSON by Main-derived plugin ID in userData/plugins, serializes writes, caps documents at 200 keys / 5 MiB and individual values at 512 KiB, and uses an atomic write guarded by a current-session predicate. Existing cleanup removes that plugin's config/data. See [plugin-store.ts](../electron/plugins/plugin-store.ts#L6) and [managed-fs.ts](../electron/plugins/managed-fs.ts#L67).
- The current Feature invocation DTO crossing NativeHost → Manager contains request ID, Feature reference, and the closed source value launcher; it does not carry query text, clipboard text, arbitrary payload, or file path. The special Translation handoff is a separate typed operation. See [feature-invocation-contracts.ts](../src/shared/feature-invocation-contracts.ts#L21), [NativeFeatureInvocationProtocol.cs](../native/WebTools.NativeHost/Services/NativeFeatureInvocationProtocol.cs#L7), and [ManagerController.cs](../native/WebTools.NativeHost/Services/ManagerController.cs#L368).
- The Main Feature Registry projects validated metadata and currently supplies empty acceptedContexts for the rows it creates. Phase 6E-2 has a frozen ContextSnapshotV1 design, but that context payload path is not the current production behavior. See [feature-registry.ts](../electron/plugins/feature-registry.ts#L32) and [Phase 6E-2, Invocation Context](phase6e2-web-plugin-runtime-contract.md#19-invocation-context).
- Current Manager translation UI writes its own result through navigator.clipboard.writeText; NativeHost file operations copy text/file-drop lists and open only selected host-issued file results. This is not ambient clipboard read access for plugins. See [TranslateView.vue](../src/features/translate/TranslateView.vue#L172), [FileResultOperations.cs](../native/WebTools.NativeHost/Files/FileResultOperations.cs#L121), and [ResultActionExecutor.cs](../native/WebTools.NativeHost/Services/ResultActionExecutor.cs#L12).
- Native application launch is a typed Launcher result operation over catalog app identity, validated HTTPS URLs, and opaque file tokens. It is not a general plugin shell or arbitrary process API. See [ResultActionExecutor.cs](../native/WebTools.NativeHost/Services/ResultActionExecutor.cs#L12) and [FileResultOperations.cs](../native/WebTools.NativeHost/Files/FileResultOperations.cs#L27).

## 3. Competitor Research

Research used official uTools documentation and the ZTools project’s official documentation, repository, and release notes, checked on 2026-10-08. These sources describe public developer APIs; they do not independently prove competitors’ internal runtime enforcement, credential storage, or permission-revocation implementation. Each fact below is separated from the WebTools recommendation.

### uTools

- **AI and model discovery — documented fact:** uTools documents utools.ai, allAiModels(), model metadata, streaming callbacks, abortable requests, and function/tool registration. Its documentation describes user selection/configuration of models in settings. See [AI capability](https://next.u-tools.cn/docs/api-reference/ai.html) and the [legacy AI API](https://www.u-tools.cn/docs/developer/utools-api/ai.html).
- **Storage — documented fact:** the database API is plugin-scoped and documents local data plus optional cloud synchronization. The storage documentation separates durable plugin data from temporary/runtime data and discusses when frequent writes are inappropriate. See [Database API](https://www.u-tools.cn/docs/developer/utools-api/db.html) and [Storage guide](https://next.u-tools.cn/docs/development/storage.html).
- **Clipboard — documented fact:** the documented APIs include copying text, images/files, retrieving copied file information, and input/paste integration. See [Copy API](https://www.u-tools.cn/docs/developer/utools-api/copy.html) and [Input API](https://www.u-tools.cn/docs/developer/utools-api/input.html).
- **Invocation and dynamic Features — documented fact:** entry events can deliver payload/type/code; Feature APIs can read, add, update, and remove dynamic search Features; redirect APIs route to another Feature. See [Events](https://next.u-tools.cn/docs/api-reference/events.html), [Feature APIs](https://next.u-tools.cn/docs/api-reference/features.html), and [Redirect](https://next.u-tools.cn/docs/api-reference/redirect.html).
- **System and screen — documented fact:** APIs include file dialogs, open/reveal/external open, notifications, screenshot/screen capture, display enumeration, and color selection. See [System APIs](https://next.u-tools.cn/docs/api-reference/system.html) and [Screen APIs](https://next.u-tools.cn/docs/api-reference/screen.html).
- **Network, preload, and automation — documented fact:** plugin setup documents a preload layer with Node/Electron capability; the docs warn about exposing raw Node objects. The FAQ discusses remote-resource restrictions. uBrowser exposes broad browser automation such as navigation, DOM selection, input, upload/download, cookies, screenshots, PDF, and proxy-related options. See [plugin architecture](https://next.u-tools.cn/docs/development/plugin-architecture.html), [preload bridge](https://next.u-tools.cn/docs/development/preload.html), [plugin configuration](https://next.u-tools.cn/docs/development/plugin-json.html), [FAQ](https://next.u-tools.cn/docs/faq/), and [uBrowser](https://next.u-tools.cn/docs/api-reference/ubrowser.html).
- **Permissions — evidence limitation:** the public developer sources reviewed do not define a complete per-capability persisted grant/revocation lifecycle. This is a documentation limitation; it is not a claim that no internal controls exist.

**WebTools recommendation:** borrow clear typed ergonomics, cancellation, plugin-namespaced storage, and explicit user-context concepts. Do not copy Node-enabled preload, generic system/file access, dynamic Native Features, broad browser automation, or a privilege model that is not supported by WebTools’ isolated runtime.

### ZTools

- **AI and model discovery — documented fact:** ZTools documents model listing, model/provider metadata, streaming and cancellation for AI calls, plus AI tool-call events. Its standalone AI API distinguishes a tool-automation call from a chat API where the plugin owns any tool loop. The model listing does not return API keys or API URLs. See [AI API](https://ztoolscenter.github.io/ZTools-doc/ai-api.html).
- **Providers — documented fact:** the provider-development guide documents separate business-provider integrations, including translation/OCR-style providers, distinct from AI chat models and provider settings. See [Provider development guide](https://ztoolscenter.github.io/ZTools-doc/provider-development-guide.html).
- **Context, Features, and storage — documented fact:** plugin entry events can include payload/type/code; feature APIs include dynamic feature operations; plugin API documents plugin-scoped database/key-value data. See [Plugin API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html), [plugin manifest](https://github.com/ZToolsCenter/ZTools-doc/blob/main/docs/plugin-json.md), and [release notes](https://github.com/ZToolsCenter/ZTools/releases).
- **Clipboard and system APIs — documented fact:** the plugin API documents clipboard read/write/history/monitoring, file dialogs, path operations, shell open/reveal, notifications, screen capture/color-picking, and browser/window helpers. The public surface is broad. See [Plugin API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html).
- **Permissions and credentials — evidence limitation:** the public sources reviewed document provider settings and APIs but do not establish a complete general per-capability grant/revocation or network-domain-enforcement model. No stronger conclusion is made.
- **Architecture — documented fact:** the official repository describes an Electron/Vue/TypeScript application with native/platform integrations. See [ZTools repository](https://github.com/ZToolsCenter/ZTools) and [README](https://github.com/ZToolsCenter/ZTools/blob/main/README_EN.md).

**WebTools recommendation:** provider APIs, model listing and cancellation are useful patterns to study, but do not copy their broad clipboard/system/preload surfaces. WebTools should keep capability methods few, Main-mediated, explicitly granted, runtime-generation bound, and independently testable.

### Standards and browser APIs

Browser APIs provide a user-mediated Clipboard API ([Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)), user-selected file handles and pickers ([File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)), permission-gated notifications ([Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)), user-selected display capture ([getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)), and transient-user-activation-gated APIs such as EyeDropper ([User activation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/User_activation)). WebCrypto, Canvas, Workers, WebAssembly and WebGPU are ordinary browser APIs ([Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API), [Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API), [WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly), [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)). The WebTools custom runtime may intentionally deny some of them; that does not justify an SDK wrapper unless a concrete Host authority is required.

## 4. WebTools Design Principles

1. **Thin SDK:** typed conveniences for approved Host authority only; no standard-library replacement.
2. **Normal Web application first:** Vue/React/Svelte/Vanilla, browser APIs, npm/pnpm packages, JavaScript and WASM belong to plugin code.
3. **No ambient authority:** no Node, require, fs, child_process, process, Electron, raw IPC, raw NativeHost pipe, unrestricted shell, or arbitrary path.
4. **Main is authoritative:** Main derives plugin, package hash, active Feature, sender, origin, grant, request quota, and runtime generation. Renderer-supplied identity is not authorization.
5. **Declarations are not grants:** Manifest requests and Feature requirements only inform the grant UI and eligibility check. Persisted user grant plus live runtime checks are required on each Host operation.
6. **Explicit user intent:** context/clipboard/system operations must be caused by an explicit user action and bounded to that invocation. Super Panel visibility never implies clipboard access.
7. **Safe data only:** no API keys, auth headers, SecretStore references, provider endpoints, raw exception details, file paths, or internal Bridge route names.
8. **Fail closed and revoke first:** grant revocation, Feature switch, disable, update, uninstall, navigation, crash, hang, and Manager close invalidate authority before cooperative cleanup; outstanding requests abort and late results are discarded.
9. **Capability-specific APIs:** no public request(method,payload). The private 6E-5 transport stays private and accepts only explicitly implemented, closed operations.
10. **One residency model:** one NativeHost; Manager on demand; one bounded WebContentsView; no per-plugin Electron process/window or always-on AI process.

## 5. Capability Classification Matrix

“Browser/npm/WASM” refers to standard web application capability, not a guarantee that the current restricted Web Plugin Session permits that API. Host means a WebTools-specific or OS operation beyond the plugin’s sandbox.

| Capability | Concrete use case | Browser/npm/WASM can already do it? | Requires WebTools/OS privilege? | Sensitive? | Needs user permission? | Candidate SDK capability? | Recommended phase | Reason |
|---|---|---|---|---|---|---|---|---|
| Shared AI completion | Summarize/translate a user-submitted prompt with the configured WebTools model | PARTIAL | YES | YES | YES | YES, frozen sharedAI.complete | 6E-6, gated | Browser cannot use WebTools-held credentials/default provider; Main must own consent, provider selection, quotas, and secret boundary. |
| AI model discovery | Let a plugin select a model | PARTIAL | YES | YES (availability/config metadata) | YES | DEFER | Later review | First version can use the user’s global default; exposing a model catalog is not needed for one prompt call and expands metadata/selection policy. |
| AI streaming | Show tokens before completion | PARTIAL | YES for WebTools Shared AI | YES | YES | DEFER | Later only if measured need | Current transport is bounded request/response; stream lifecycle/backpressure/revocation is additional authority and accounting work. |
| AI tool calling | Ask an AI to call a named action | YES for plugin-owned models, not Host authority | YES for any privileged effect | YES | YES for each separate effect | NO in first API | Later separate design | Model output must never authorize an operation; any action needs its own typed SDK capability and grant. |
| Feature Context | Receive exact Launcher query for the invoked Feature | PARTIAL | YES | DEPENDS | DEPENDS on context source | YES, context.current under accepted-context rules | 6E-6, launcher text first | Cross-process NativeHost input cannot be recovered from the Web page; Main must bind data to the exact invocation and expiry. |
| Clipboard read | Process text the user explicitly chose to pass | PARTIAL (browser access is restricted here) | YES in current Session | YES | YES | DEFER as ambient API; clipboard context only | 6E-6 only after explicit Native action/grant | No background read/history; the current browser Clipboard API is denied by runtime policy. |
| Clipboard write | Copy plugin output after the user requests it | PARTIAL (browser API exists but runtime denies it) | YES in current Session | YES | YES | YES, frozen clipboard.write / clipboard.writeText | 6E-6, one-shot | Host can preview, confirm, bound bytes, and commit only to the system clipboard. |
| Clipboard images | Copy rendered image or image payload | PARTIAL | YES | YES | YES | NO | Defer | Requires image bytes/native clipboard formats and a larger size/format attack surface; no required first-release use case. |
| PluginStore | Persist a user’s plugin settings/data across invocations | PARTIAL (IndexedDB is web-owned/ephemeral here) | YES for WebTools-managed durable lifecycle | LOW–MEDIUM | YES, separate read/write grants | YES, frozen plugin.storage.read/write | 6E-6, gated | Main must bind namespace, quota, atomicity, migration, and uninstall cleanup to installed plugin identity. |
| File picker | User selects one input file | YES | NO if browser picker is allowed | DEPENDS | YES, direct user action | NO | Browser API | Use input type=file / supported browser handle APIs; if restricted Session prevents this, prove the gap before proposing a narrow picker. |
| Filesystem read | Read a selected file | PARTIAL (only user-selected handles/bytes) | YES for arbitrary paths | YES | YES | NO for arbitrary path; DEFER selected-file bridge | Browser first | User-selected handles are the least-authority route; never expose fs.readFile(path). |
| Filesystem write | Export a generated result | PARTIAL (Blob/download/user-selected handle) | YES for arbitrary paths | YES | YES | NO for arbitrary path | Browser first | Browser download/save picker covers common exports without giving plugins a host filesystem path. |
| Open/reveal path | Show a user-selected export in Explorer | NO for OS Explorer integration | YES | DEPENDS | YES | DEFER | Later narrow operation | Would require an opaque Host-issued file token or user selection; never accept an arbitrary path. |
| Application launch | Open a known installed app | NO | YES | YES | YES | DEFER | Later system-capability review | If justified, accept only a stable Host catalog identity; never raw executable/arguments/shell. |
| Open URL | Open plugin documentation in default browser | PARTIAL (page navigation only; not reliable OS external-open) | YES for default-browser integration | LOW–MEDIUM | YES | DEFER, future external.open | Later only if justified | It is a valid Host/system boundary, but adds less first-slice validation value than the selected four capability families. If approved later, keep strict HTTPS canonicalization, size bounds, explicit permission/confirmation as contractually required, and no arbitrary protocol or shell target. |
| Notifications | Notify the user that plugin work finished | YES (standard browser API) | NO in standards-capable browser | MEDIUM | YES | NO initially | Browser API; later only if runtime gap proven | Browser notification permission is the appropriate mechanism; do not duplicate it in Host without a demonstrated sandbox need. |
| Screenshot (plugin content) | Capture the plugin’s own rendered Canvas/document | YES | NO | DEPENDS | NO beyond user action in plugin | NO | Browser API | Use Canvas/export within the page; no Host capability. |
| Screen capture | Capture a chosen screen/window region | PARTIAL | NO if standard display picker is safely available; otherwise YES | HIGH | YES, every capture | NO initially | Browser API / later specific review | getDisplayMedia requires user selection; never provide silent desktop capture. Current runtime denies permissions, so validate actual browser flow before any Host design. |
| Color picker | Sample a screen pixel for a design tool | PARTIAL | NO where EyeDropper works; YES for native fallback | MEDIUM | YES, transient activation | NO initially | Browser API / defer fallback | Prefer EyeDropper; do not add OS screen scraping for parity. |
| Dynamic Features | Add a search keyword while the plugin runs | PARTIAL (plugin can change its own UI) | YES to alter Native search projection | LOW–MEDIUM | YES (install/update authority) | NO | Later only if justified | Validated Manifest + Main Feature Registry remain authoritative and bounded; runtime self-registration risks unbounded persistent entries. |
| Plugin/provider invocation | Plugin A asks a Translation/OCR provider owned by Plugin B | NO | YES | HIGH | YES | NO | Defer | No arbitrary Plugin A → Plugin B IPC. Any future provider broker is a separate Host-authorized contract. |
| Custom windows | Open a separate utility window for a plugin | PARTIAL (in-page UI) | YES for desktop window management | MEDIUM | YES | NO | Defer | Keep one Manager and one bounded WebContentsView; no per-plugin BrowserWindow. |
| Browser automation | Automate an external site from a plugin | PARTIAL (can manipulate only its own page) | YES for external browser/session | HIGH | YES | NO | Separate future subsystem, if ever | Browser automation exposes cookies, input, navigation, downloads, and network authority; not a thin SDK capability. |
| Network | Plugin-owned backend or remote AI | YES in a normal browser | YES to enforce WebTools domains/network policy | HIGH | YES | NO sdk.fetch/http; standard fetch only after Gate 4 | 6E-7 | network:none is current policy; network.mode:domains remains unsupported and Gate 4 is not certified. |
| Secrets | Plugin reads a user API token | NO safe direct access | YES | CRITICAL | YES | NO | Never expose raw secrets | SharedAI owns credentials in Main; plugin-owned service credentials belong to the developer/backend, not WebTools SecretStore. |
| Local WASM AI | Run a small local model inside the plugin | YES, subject to size/runtime support | NO | Depends on plugin data | No WebTools permission | NO | Plugin-owned; framework/WASM acceptance in 6E-8 | “AI” alone does not justify sharedAI.complete; plugin code owns local inference and resource lifecycle. |
| WebAssembly runtime | Run a bundled codec or inference kernel | YES | NO | NO | NO | NO | Browser/WASM | WebTools already validates WASM declaration/inventory and CSP policy; no SDK wrapper. |
| WebGPU | Run local GPU inference | PARTIAL (browser/device support varies) | NO | DEPENDS | Browser/device permission as applicable | NO | Plugin-owned; 6E-8 acceptance | Capability availability is a normal feature-detection concern; a Host facade adds no necessary privilege. |
| Web Workers | Move parsing/inference off UI thread | YES in normal web context; current CSP denies Worker | NO | NO | NO | NO | Browser API; revisit runtime policy separately | A blocked Worker policy is a runtime decision, not justification for sdk.worker. Do not modify CSP in this design task. |
| Canvas | Crop/render a user-provided image | YES | NO | DEPENDS on image data | No Host permission | NO | Browser API | Plugin owns its document and Canvas; a Host Canvas wrapper would duplicate the platform. |
| Image processing | Resize/compress/convert an image | YES via Canvas, npm, WASM | NO | DEPENDS | No Host permission | NO | Browser/npm/WASM | Keep algorithms and bytes in the plugin sandbox unless a concrete OS integration appears. |
| QR | Generate/decode a QR code | YES via npm/JS/WASM | NO | NO | NO | NO | npm/WASM | Standard library problem, not WebTools authority. |
| Markdown | Render or edit Markdown | YES via npm/browser | NO | NO | NO | NO | npm/browser | Use a parser/sanitizer owned by plugin; no sdk.markdown. |
| Compression | Zip/gzip or compress media | YES via npm/WASM/browser streams | NO | NO | NO | NO | npm/WASM | Normal plugin computation; bound resource use within package/runtime policy. |
| Hashing | Hash a generated export | YES via WebCrypto/npm/WASM | NO | NO | NO | NO | Browser API/npm | Do not confuse public digest operations with access to WebTools credentials. |
| Crypto | Encrypt plugin-owned data | YES via WebCrypto/npm | NO | NO (unless handling secret material) | DEPENDS | NO | Browser API/npm | Never pass WebTools SecretStore keys or encryption handles; ordinary plugin crypto is plugin-owned. |
| Timers | Debounce input or retry UI work | YES | NO | NO | NO | NO | Browser API | No sdk.timer; use browser scheduling with runtime close cleanup. |
| JSON | Parse/serialize plugin data | YES | NO | NO | NO | NO | JavaScript | Standard language feature. |
| Ordinary npm libraries | Use Vue/React, editors, parsers, utility packages | YES | NO | DEPENDS on package | NO beyond package provenance | NO | npm/pnpm | Keep SDK framework-neutral; package validation/runtime policy governs artifacts. |

## 6. Shared AI Architecture

### Goals

- Reuse one user-configured WebTools model service for built-in features and explicitly authorized plugins.
- Keep credentials, provider endpoint, transport adapter, settings writes, and model selection in Main/Manager.
- Make an AI request an explicit user-visible effect, not a side effect of page load or context delivery.
- Support independent plugin-owned AI without forcing every plugin through WebTools Shared AI.

### Existing WebTools AI Infrastructure

SharedAIService already chooses the global default provider/model from SharedAISettings, loads its credential in Main, validates/resolves the provider endpoint, selects an OpenAI-compatible or Anthropic adapter, and returns completion text plus internal provider metadata. AIProviderCredentialStore and SecretStore are separate from Renderer/plugin code. This is a usable shared-service foundation, not a requirement to replace the Translation module.

### Reusable Components

- SharedAIService.complete and its provider adapters.
- AI provider descriptor/endpoint validation and default provider/model settings.
- Main-owned AIProviderCredentialStore and encrypted SecretStore.
- Existing consent concepts and the frozen 6E-2 per-call confirmation model.
- AbortSignal propagation from the service/adapters where the provider supports cancellation.

The Plugin boundary must wrap and narrow these pieces. Do not pass AIProviderInfo, SharedAICompletion, AIProviderDescriptor, adapter requests, or raw settings across it.

### Translation-specific Components

TranslationService remains responsible for translation text/language rules, MyMemory/Qwen-MT business-provider routing, translation prompts, translation-specific timeouts, and translation admission/cancellation. Its use of SharedAIService is a consumer relationship. Translation/OCR are business providers; OpenAI/Anthropic/Gemini/etc. are Shared AI model providers. Do not merge these into a universal Provider framework.

### Credential Boundary

Plugin code must never receive:

- API keys, provider tokens, auth headers, SecretStore handles or serialized secret objects.
- Credential filenames, user-data paths, arbitrary provider URLs, raw provider request objects, or exception text containing configuration.
- A capability that lets a plugin enumerate/update/delete WebTools AI credentials.

The Main-side consent view may show a safe provider/model display label and a bounded prompt preview before the user approves. The public result remains only {text}. Plugin-owned services are a different trust model: WebTools does not proxy their credentials or expose its own SecretStore.

### Model Discovery

The user can choose the global default provider and model in trusted WebTools Settings today. The plugin does not need to identify or choose the model to submit a prompt. Therefore the first Shared AI plugin surface should **not** expose listModels(), API-key presence, configured account state, documentation URLs, provider endpoint, provider selection, or model override. Main internally uses the current user-selected default.

If later evidence shows that per-plugin model choice is necessary, first define an allowlisted safe metadata DTO (for example stable model ID, display label, capability tags, input/output bounds, and explicit availability) and a user-authorized model set. Do not expose account identifiers, key status, endpoint, secret state, or provider configuration. This is deferred, not part of the first API.

### Permission Model

An AI operation requires all of:

1. Validated Manifest v2 requests sharedAI.complete.
2. The selected Feature declares/requires that operation under the frozen Feature contract.
3. Normal v2 persisted user grant exists and is current.
4. Main authenticates the exact active WebContents/frame and derives plugin, feature, package hash, and generation.
5. Under the current frozen contract, trusted Host confirmation is accepted for each call immediately before sending the bounded prompt.

Manifest declaration, being installed, the existence of an API key, a successful earlier approval, or model output is not a grant. No AI request runs on Feature startup.

#### Current frozen contract

Phase 6E-2 remains authoritative: persisted Shared AI grant, Feature eligibility, Main authority checks, and Host confirmation for every Shared AI call are all required. This revision does not change that contract or authorize a different consent flow.

#### Possible contract amendment candidate — not approved

The unresolved UX/security question for final review is whether every explicit foreground AI call must show an additional Host confirmation after a persisted grant, or whether the grant plus a direct user action within the visible Feature could authorize that call.

A possible future amended model would request Shared AI during install/first use and explain in trusted WebTools UI that the plugin may send user-provided content to the configured provider, may consume paid/provider quota, and never receives WebTools credentials. If the user grants it, an explicit foreground action such as Send, Translate, Summarize, or Generate might authorize that individual call without another Host confirmation dialog. This is only a candidate; it is not approved and must not be implemented unless the contract is explicitly amended.

Under either model, automatic/background AI remains prohibited. Page load, Feature startup, context arrival, timers, background polling, hidden retry, automatic repeated generation, unrelated UI events, and runtime initialization must not silently invoke Shared AI. Quotas, foreground intent, cancellation, Main revalidation, safe errors, and every other security invariant below remain unchanged.

### Plugin Revocation

Persist the grant by plugin identity. At revoke, disable, Feature switch, update, uninstall, navigation/reload, crash/hang, and Manager close: mark the runtime generation unavailable synchronously; cancel/abort active requests; close confirmation state; reject new calls; discard late provider responses; and prevent later storage/clipboard commits. Registry persistence and capability availability must not race with the old generation. Do not preserve authority based on an SDK object left in page memory.

### Quotas

Honor the frozen Phase 6E-2 limits for first release:

- One in-flight Shared AI call per active runtime; five per rolling 60 seconds.
- One prompt, UTF-8 ≤32 KiB; no system/assistant role, model/provider, temperature, tools, or arbitrary options.
- Provider output ≤1,024 tokens and UTF-8 ≤32 KiB; reject oversize output, never silently truncate.
- Bridge-wide bounds, deadlines, rate limiting, and pending-call caps remain in force in addition to the method quota.
- Require bounded prompt preview and user confirmation per call; do not infer consent from a plugin grant alone.

Record only bounded operational counts/outcomes necessary for abuse diagnosis (plugin identity, safe capability, time bucket, result category); never persist prompt/context text, response text, API keys, endpoints, or raw provider errors for analytics. There is no current Web-v2 usage ledger. Do not invent billing/account infrastructure. Because the frozen quota is per active runtime, future acceptance should explicitly test repeated runtime replacement; any stricter cross-runtime spend cap needs a reviewed contract change rather than a silent implementation change.

### Cancellation

Do not expose AbortSignal across IPC. The SDK may offer a browser-side cancellation option only if it maps to the frozen request-cancel protocol; Main associates cancel with its own pending request and AbortController, rechecks authority before provider dispatch and before returning, and discards stale responses. Runtime revocation/close must always cancel active work. User cancellation/revocation is best effort with remote providers: aborting the local request cannot guarantee that an already accepted remote request incurs no cost.

### Error Model

Expose only stable bounded codes such as unavailable/not configured, permission denied, user cancelled, rate/size limit, timeout, and safe provider failure. Do not return stack traces, HTTP response bodies, raw provider exception text, credentials, endpoint, or host paths. Retryability must be explicit and safe. No automatic repeated paid request.

### Streaming Decision

**No streaming in the first Shared AI capability.** The current Web Bridge is request/response, with four pending calls maximum, a 30-second call deadline, explicit cancel, rate limits, and synchronous revocation. A stream would need bounded chunk bytes/count, backpressure, listener registration/unsubscription, a defined terminal event exactly once, partial-output policy, provider abort, and revocation semantics. Reuse the current single response until a concrete UX demonstrates that bounded completion is inadequate.

- Event stream/stream handle: plausible future design but adds event authority and per-chunk accounting.
- Chunked request lifecycle: harder to cancel/revoke correctly and adds no first-release value.
- Generic event transport: explicitly rejected as a public API.

### Tool Calling Decision

First version has no tool definitions, function calling, automatic agent loop, or Host-executed model tool call. It returns plain text only. If a model later suggests an operation, the plugin must still invoke a separate typed SDK capability; that operation independently validates permission, context, user intent, bounds, and Main authority. AI output is never authorization.

### Track A — WebTools Shared AI

Use trusted Settings → provider/model configuration → Main-held credentials → SharedAIService → built-in consumer or explicitly authorized plugin. Translation remains one consumer. No plugin-facing provider object or arbitrary provider selection.

### Track B — Plugin-owned AI

Plugins may bring a developer-owned remote service or their own provider library when policy allows, or run a local model with browser/WASM/WebGPU. Do not require Shared AI permission merely because a feature is described as AI. A plugin-owned API key should not be placed in the WebTools SharedAI SecretStore through a plugin API.

Remote Track B cannot currently run from the Web Plugin because network:none is authoritative. Do not add sdk.fetch, sdk.http, proxy IPC, or temporary Main egress. Standard fetch() becomes useful only after Phase 6E-7 proves connection-level Session enforcement and Gate 4 is separately certified.

### Track C — Local Browser/WASM/WebGPU AI

Treat model/runtime bytes, inference state, caching, and UI as plugin-owned. Detect WebGPU/WASM capability in-page, lazy-load model assets, handle memory/CPU limits, and release plugin-owned resources on runtime close. No Shared AI permission is needed. Current CSP has worker-src none; this design does not alter that runtime policy.

## 7. Provider Architecture

Keep these concepts distinct:

| Concept | Meaning | Current state | Recommendation |
|---|---|---|---|
| Shared AI Model Provider | Generic prompt completion against OpenAI, Anthropic, Gemini, DeepSeek, Qwen, or Custom-compatible service | Implemented in Main; configurable default and Host-held credential | Reuse SharedAIService; expose only the frozen narrow ai.complete method to a granted plugin. |
| Translation/business Provider | Translation API/service and language-specific semantics | Implemented in TranslationService (MyMemory, Qwen-MT, optional Shared AI engine) | Keep separate; Translation may use a traditional translator or Shared AI. |
| OCR/business Provider | OCR-specific model/service contract | Not a generic shared platform in this audited path | Keep plugin/browser/WASM-owned until a concrete shared platform-level use case exists. |
| Third-party Provider invocation | One plugin requesting another plugin’s provider | No generic contract | Defer; if useful, route through a later Host broker with identity, grant, quotas and lifecycle; never add direct plugin IPC. |

Do not add a universal Provider registry or provider marketplace in 6E-6.

## 8. Feature Context

### Safe/default

- Current behavior: the generic NativeHost Feature invocation transmits request ID, Feature reference, and source launcher; it carries no query text. Translation has its own explicit prefill handoff.
- Future context.current() returns invocation-bound data that is immutable from the Plugin's perspective: the Plugin cannot mutate, replace, extend, refresh, rebind, or request another Feature's context. Main creates and binds it to one validated Feature invocation. Default is no context unless that Feature explicitly accepts the context pair in the validated Manifest.
- Initial practical source is exact Launcher input text for the Feature the user deliberately selected. Preserve exact content (no hidden normalization that changes the user’s input), enforce the frozen limits, expose no caller-controlled IDs or expiry, and expire/clear it after the invocation/runtime lifetime.
- Public SDK should return only minimal safe fields, conceptually text + closed source/type; correlation IDs, Native pipe identity, package path/hash, Main generation, and internal timestamps remain private.

The Plugin-visible value may be immutable while its lifetime remains Host-owned and revocable. Main may expire, invalidate, erase, or revoke it, and must clear it on Feature switch, runtime close, grant revoke, crash/hang, or Manager exit. No API promises indefinite retention.

### Sensitive context

- Clipboard text is never read when Super Panel/Launcher merely opens. A separate explicit Native Clipboard Context action may capture text once, subject to the frozen accepted-context match, clipboard.read grant, Gate 2 peer authentication, 32 KiB UTF-8 bound, delivery TTL and one-time binding.
- Selected OS text is not silently copied via synthetic Ctrl+C. Any future selected-text integration is a separate explicit contract.
- No browsing history, clipboard history, file contents, path, image, URL, folder, account, or arbitrary application state in this first text context.

### Never exposed by this API

No ambient clipboard surveillance, context polling, arbitrary context lookup by plugin/Feature ID, another plugin’s invocation, global search history, or unrestricted payload bag. Context is data, not a standalone permission to inspect the system.

## 9. Clipboard

- **Read text:** browser Clipboard API is permission-/gesture-controlled in standard browsers; current Web Plugin runtime deliberately denies direct Clipboard access. Do not add readText() or monitoring. The only acceptable first route is a one-shot explicit Native clipboard-context gesture, matching acceptedContexts, clipboard.read grant, authenticated handoff and expiry.
- **Write text:** ordinary browser Clipboard API exists, but current runtime denies it and Phase 6E-2 already defines a narrow clipboard.writeText Host operation. Use explicit plugin user action, bounded text, visible preview/confirmation immediately before Main writes, and recheck generation after confirmation.
- **Image/file/rich formats:** defer. Do not accept raw file drops, native image handles, clipboard history, or file-drop list via the web boundary.
- **No monitor/listener:** no polling, change listener, clipboard history, Super Panel ambient capture, or background write.

## 10. PluginStore

Use the existing Main-owned PluginStore as durable state, not as a universal localStorage replacement:

- Public methods: get(key), set(key,value), and delete(key). No list() in first release; callers know their own keys.
- Main derives plugin identity from the validated installed record and active runtime; never accept plugin ID, directory, filename, or path from plugin input.
- Reuse current strict JSON, prototype safety, key grammar, 200-key count, 512 KiB serialized value, and 5 MiB serialized document limits. Writes remain serialized/atomic; recheck generation before commit. Keep the frozen 60 calls per rolling 60 seconds per runtime.
- Read and write are separate grants; delete is a write operation. Missing get yields null; deleting a missing key is idempotent.
- Browser ephemeral origin storage remains session-only and is purged. It is not PluginStore and is not migrated into durable data automatically.
- Bind data to plugin identity across an approved package update; do not run package migration code in the Host. On uninstall, follow existing Host confirmation and data-retention choice; never access another plugin’s namespace.
- No schema change or storage migration is authorized by this report. If current v1 PluginStore format cannot serve v2 safely, stop and report the incompatibility rather than creating an alternative store.

## 11. File / System Capabilities

| Need | First choice | Host boundary |
|---|---|---|
| Import a file | Browser input type=file or drag/drop | Only propose a narrow picker if actual WebContents acceptance proves browser selection unavailable. Return bounded bytes/opaque handle, never absolute path. |
| Export generated content | Blob/download; browser save picker where supported | No arbitrary path writes. |
| Read/write plugin file | User-selected web file handle, within platform support | No fs.readFile(path) or fs.writeFile(path). Any future persistent file handle requires explicit user selection and separate review. |
| Reveal/open an output | Browser download or a Host-created opaque file token | A possible later one-operation open.reveal(token); no arbitrary path. |
| Launch app | Existing Native Launcher typed catalog action | Not in first Web SDK. If justified later: stable Host app identity, optional confirmation, no path or arbitrary args. |
| Open website | Browser navigation within current allowed runtime where applicable | external.open is deferred from the first 6E-6 set. If reviewed later, retain HTTPS-only validation, the frozen URL bound and required confirmation; never pass arbitrary input to shell.openExternal. |
| Open system setting | Render instructions/link or an explicit Host-owned settings route | Defer until a named setting and fixed allowlist have a demonstrated use case. |

App launch and WebTools Feature invocation remain separate. A plugin cannot execute shell strings, command prompts, PowerShell, child processes, arbitrary executables, URL schemes, or arguments.

## 12. Notifications / Screen / Capture

- **Notifications:** prefer the browser Notifications API with the browser’s explicit permission UX when Web Plugin runtime can securely support it. Current runtime defaults permissions closed. Do not create a Host notification API until an acceptance test demonstrates a WebTools-only requirement.
- **Plugin-document screenshot:** use browser Canvas/rendering/export APIs.
- **Screen/window capture:** prefer standard user-selected getDisplayMedia if a safe permission flow is proven. Never grant silent desktop capture. Current Web Plugin permission policy is deny-by-default; do not bypass it with an SDK wrapper. A future native capture would need a dedicated user gesture, visible capture UI, explicit target selection, no background capture, and a separate reviewed capability.
- **Color picker:** prefer EyeDropper with transient user activation. Do not sample arbitrary desktop pixels or implement a hidden native picker for parity.

## 13. Dynamic Features

Do not add runtime Feature registration to the first Web capability slice. The validated Manifest and Main-derived Feature Registry are the authority; global Feature projections are bounded (2,000 maximum) and Manifest Feature counts are bounded. Dynamic persistent search rows would require updates to package validation, grants, indexing, sorting, uninstall, and stale projection invalidation. If later needed, implement as a Host transaction that revalidates strict limits and updates the same registry; never expose arbitrary unbounded add/remove APIs.

## 14. Plugin-to-Plugin / Provider Invocation

No direct Plugin A → Plugin B RPC. Plugins may share data only through their own external/user-selected mechanisms, not an implicit host privilege bridge. If a genuine translation/OCR provider use case emerges, define a Host-owned call that derives both identities, requires an explicit consumer grant/provider acceptance, validates schema, caps data/rate, and revokes on either plugin’s lifecycle. This is deferred; no plugin discovery or invocation API is part of 6E-6.

## 15. Window / Browser Automation

Web Plugins stay inside the existing on-demand Manager and its single bounded WebContentsView. Do not create plugin BrowserWindows, extra Electron processes, another NativeHost, SuperPanel.exe, or unbounded hidden views. Plugin UI can build in-page dialogs and panes.

Browser automation is a separate high-authority subsystem because it can access external pages, cookies, form input, downloads, screenshots and network. Do not expose uBrowser-like APIs, cookies, proxy configuration, arbitrary page JavaScript, browser profile access, or remote automation in the SDK.

## 16. Network Boundary

Preserve Phase 6E-7:

- network.mode:none remains the only currently supported runtime.
- network.mode:domains remains unsupported; Gate 4 remains NOT CERTIFIED.
- No sdk.fetch(), sdk.http(), generic request proxy, custom bypass or temporary allowlist in 6E-6.
- If Gate 4 later passes, developers should call standard browser fetch() and enforcement should occur at the isolated Session/connection boundary. A Web SDK network helper must not become the authority layer.

## 17. Minimal Phase 6E-6 Capability Set

The following is the minimal set that remains compatible with the frozen Phase 6E-2 contract. It introduces no new Manifest string or Bridge primitive. All calls remain unavailable to ordinary third-party packages until persisted v2 install/grants are authoritative.

### 17.1 context.current()

- **Why Host is needed:** Launcher input originates in NativeHost, outside the Web process. The Renderer cannot safely infer the selected Feature’s exact input from global state.
- **Conceptual public API:** webtools.context.current(): Promise<Readonly<TextContext> | null>. TextContext has only type: 'text', a closed source, and text. No IDs, arbitrary metadata, or path.
- **Permission/grant:** launcher-input is allowed only when the validated Feature explicitly accepts it and the Host binds it to the exact invocation. Clipboard context additionally needs the separate clipboard.read grant and deliberate Native action. No generic context permission is added.
- **Main authority:** Main resolves validated snapshot, plugin/Feature, actual frame, invocation, source, expiry, generation and accepted-context pair; NativeHost peer authentication is required for a cross-process clipboard handoff.
- **Quotas:** retain frozen Launcher ≤300 UTF-16 units / ≤16 KiB envelope; clipboard ≤32 KiB UTF-8; undelivered lifetime ≤30 seconds and active context maximum 10 minutes. Reject over-limit; never silently truncate.
- **Lifecycle/cancellation:** data is immutable from the Plugin's perspective and bound to at most one invocation; its lifetime is Host-owned and revocable. Main may expire, invalidate, erase, or revoke it and clears it on consume/expiry/Feature switch/runtime close/grant revoke/crash/hang/Manager exit. A pending bridge call uses standard request cancellation.
- **Not supported:** polling, arbitrary clipboard read, history, synthetic Ctrl+C, URL/path/file/image/folder/selection payloads, another Feature’s context.

### 17.2 storage.get/set/delete

- **Why Host is needed:** browser origin storage is intentionally ephemeral and cannot provide WebTools-controlled identity/update/uninstall semantics.
- **Conceptual public API:** webtools.storage.get(key), set(key,value), delete(key). JSON-only values. No list().
- **Permission/grant:** use frozen plugin.storage.read and plugin.storage.write; set/delete require write. Grant belongs to installed plugin; operation is checked against the active Feature’s required-capability set.
- **Main authority:** derives plugin ID and store namespace; authenticates active sender/generation; validates strict JSON/key; checks grant and package compatibility; commits atomically only if generation is still current.
- **Quotas:** existing bounds only: 200 keys, 512 KiB serialized value, 5 MiB document, 60 operations per rolling 60 seconds per runtime.
- **Lifecycle/cancellation:** queued write canceled before commit if generation becomes stale. Update keeps the same plugin-owned data only under identity/version rules. Uninstall follows user data choice and existing cleanup.
- **Not supported:** arbitrary path, filesystem API, cross-plugin reads, key enumeration, browser-storage migration, migration scripts, Host settings access.

### 17.3 ai.complete({prompt})

- **Why Host is needed:** only Main can safely use WebTools’ configured provider, endpoint and SecretStore credential.
- **Conceptual public API:** webtools.ai.complete({prompt}) -> Promise<{text: string}>. Cancellation is local SDK request cancellation mapped to the frozen cancel message; no AbortSignal crosses IPC.
- **Permission/grant:** existing sharedAI.complete; per-call Host confirmation is still required. No call on load/context arrival. The plugin cannot request a model override.
- **Main authority:** validates sender/runtime/feature/requested capability/current persisted grant/generation; constructs only Host-allowed messages, uses current default provider, calls existing SharedAIService; returns text only.
- **Quotas:** existing Phase 6E-2 cap: 1 concurrent and 5 per rolling 60 seconds per runtime; one UTF-8 prompt ≤32 KiB; provider output ≤1,024 tokens and ≤32 KiB. Preserve general Bridge caps.
- **Lifecycle/cancellation:** request cancellation maps to the Bridge cancel operation and Main AbortController. Revoke/close aborts pending work and late results are dropped. Remote billing cancellation is best effort.
- **Not supported:** listModels, provider/model override, custom endpoint, API key, roles/messages, system prompt, temperature, tools, structured/multimodal input, streaming, background use, auto-retry, raw provider errors.

### 17.4 clipboard.writeText(text)

- **Why Host is needed:** the current Web Plugin Session denies direct browser clipboard permission; NativeHost/Main owns the OS clipboard effect.
- **Conceptual public API:** webtools.clipboard.writeText(text): Promise<void>.
- **Permission/grant:** frozen clipboard.write; require a user-initiated action and a bounded Host preview/confirmation immediately before commit.
- **Main authority:** validates active WebContents/frame/plugin/Feature/generation, exact declared and granted capability, UTF-8 size, and rechecks generation after confirmation before the clipboard write.
- **Quotas:** frozen ≤64 KiB UTF-8 and five consent evaluations per rolling 60 seconds; no dialog flood.
- **Lifecycle/cancellation:** cancellation or stale generation leaves clipboard unchanged. Once the OS write commits, later cancellation cannot undo it.
- **Not supported:** read, monitor, history, polling, image/file/rich formats, background write, Native clipboard bypass.

## 18. Manifest / Permission Implications

No Manifest or permission schema change is authorized by this research. Retain the frozen v2 capability vocabulary already defined by Phase 6E-2 / the v2 validator. external.open remains a valid deferred vocabulary item but is not part of the first Phase 6E-6 implementation set:

- sharedAI.complete
- plugin.storage.read
- plugin.storage.write
- clipboard.read
- clipboard.write
- external.open
- network.domains remains structurally recognized only as an unsupported declaration until Gate 4 passes.

For the four selected capability families, use package-level requested/granted capabilities with per-Feature requiredCapabilities and acceptedContexts eligibility checks. A plugin-level grant does not make an undeclared Feature eligible; each operation still checks the selected active Feature and current grant. Do not add a second grant database or permission system.

The production authority chain is:

```text
validated Manifest v2 package
→ normal persisted install identity
→ enabled and compatible package state
→ persisted requested capabilities and user grants
→ active Feature eligibility
→ live WebContents/runtime generation
→ typed capability request
→ Main revalidation
→ effect
```

The minimum persisted authority must answer whether the plugin is installed; which exact package/version/hash is authoritative; whether it is enabled or disabled; whether the Feature is valid and active; whether the user granted or revoked the requested capability; whether an update, disable, or uninstall invalidated it; whether old runtime generations have lost authority; and whether plugin data remains or is removed according to the approved lifecycle. It must be restart-safe and crash-safe so restart cannot silently recreate a grant.

## 19. Persisted Grant Gap

| Capability / surface | Classification | Safe exposure before normal persisted grants? | Conclusion |
|---|---|---|---|
| context.current() with launcher text | B | Only in a controlled first-party/test path with Main-created single-invocation context; not to third-party production | Requires v2 install/Feature binding and stale-generation proof before third-party use. |
| Clipboard context (clipboard.read) | B | Only a test/first-party flow with explicit Native gesture and authenticated handoff | Third-party production waits for persisted grant and user-facing action/consent; no ambient read. |
| PluginStore | B | Existing v1 store can be reused in isolated test/first-party authority | Do not infer v2 ownership/grant from v1 records; third-party exposure waits for installed v2 identity and uninstall lifecycle. |
| Shared AI | B | Main service may be exercised under test-only authority or a trusted first-party route | Third-party production waits for per-plugin persisted grant and trusted per-call confirmation. |
| Clipboard write | B | Existing v1 consent code is not a Web-v2 grant; a controlled fixture can validate isolated operation | Third-party production waits for v2 grant and WebContents/generation checks. |
| external.open | B | A test-only/first-party route could validate strict URL handling and confirmation | Deferred from the first 6E-6 implementation set; any later use still requires v2 grant lifecycle and no direct shell API. |
| network.domains | C | No | Must wait for Phase 6E-7 and a certified connection-level Gate 4. |
| Raw filesystem, shell, app launch, custom windows, browser automation | C | No | Not in the selected set; each requires a later explicit product/security design, if ever. |

**A = safe for normal product capability exposure before persisted v2 grants:** none of the selected Host operations. Pure browser-side SDK types/validation or non-authoritative metadata may be developed without grants, but they do not confer runtime authority.

The crucial distinction is **testability is not production authorization**. A test-only gate must be explicit and fail closed in normal packaged launches. None of the following is production authorization by itself: a Manifest declaration; validator success; `acceptedContexts`; a v1 grant; test or fixture identity; test-only authority; an acceptance environment variable; package presence on disk; possession of an SDK object; Bridge readiness; a prior successful request; AI provider configuration or API-key presence; or renderer-supplied plugin identity. Each operation must resolve the authoritative persisted v2 installation and grant, then revalidate the active Feature and runtime generation in Main immediately before its effect.

## 20. Representative Plugin Walkthroughs

| Example | Required surface | What stays plugin-owned | Decision |
|---|---|---|---|
| A. AI Translation Plugin | context.current() for launcher text; optionally ai.complete if user-approved | Language selection, UI, prompts/formatting; it may use Translation as a business service only through a later separate contract | Uses Shared AI only after persisted grant, Feature eligibility, Main validation, and the current frozen per-call Host confirmation. |
| B. Plugin-owned AI Service | None from WebTools initially; standard fetch() only after Gate 4 | Developer backend, provider auth, model, prompt and UI | Not currently network-capable; never use a temporary SDK HTTP proxy. |
| C. Local AI Plugin | None | WASM/WebGPU model loading, inference, worker strategy where allowed, lifecycle and UI | No Shared AI permission merely because it performs AI. |
| D. Clipboard Text Tool | Explicit clipboard context with clipboard.read grant; optionally clipboard.writeText for output | Text transformation and UI | No clipboard monitor/history; context arrives only after explicit Native action. |
| E. Image Compression Plugin | None | File input, Canvas/WASM/npm compression, browser download | Demonstrates thin SDK: no Host call needed. |
| F. Markdown Tool | None | Parser/rendering/editor, npm libraries, local persistence if ephemeral is enough | PluginStore only if durable WebTools-managed state is genuinely required. |
| G. Application Utility | None in the first 6E-6 set | UI and safe catalog selection intent | Opening an installed app needs a future narrow stable app identity capability; never shell/executable arguments. |

## 21. Security Review

| Threat | Required mitigation in the selected design |
|---|---|
| Credential theft | Keep credentials/endpoints in Main; narrow AI method; return {text} only; never expose credential status or SecretStore. |
| AI quota/cost abuse | Persisted grant plus the current frozen per-call Host confirmation, per-runtime limits, one concurrent call, size/output caps, safe errors, no automatic retries. Any future consent amendment must still require explicit foreground intent and preserve every listed technical control. |
| Context leakage | Main-created invocation snapshot; accepted-context check; exact Feature binding; expiry; one-shot clipboard context; no polling/logging/storage by Host. |
| Clipboard surveillance | No read/list/monitor API; clipboard context only following explicit Native gesture and separate read grant. |
| Filesystem escalation | Browser picker/download first; no arbitrary paths; future reveal must use Host-issued opaque token. |
| Cross-plugin authority | Main derives one plugin namespace; no direct plugin IPC/provider call; no caller-chosen identity. |
| Bridge bypass | Private fixed IPC transport; Main authenticates actual WebContents/frame, validated origin/snapshot, active generation and closed method schema; public SDK has typed calls only. |
| AI tool-call privilege escalation | No first-release tool calling. Model output never authorizes Host action; any later effect requires its separate capability/grant/confirmation. |
| Consent TOCTOU | Bind confirmation to request/runtime; recheck generation and grant immediately before side effect. Cancellation/stale calls do not write/open. |
| Persisted-state confusion | Do not enable v2 capabilities until v2 installation, grant persistence, revocation, update, and uninstall are authoritative. |
| Denial-of-service/resource pressure | Reuse strict pending/rate/deadline/output/storage limits; one WebContentsView, no plugin windows or persistent worker/process. |

## 22. Performance / Residency

This design adds no background process and does not change the NativeHost/Electron lifecycle. SharedAI remains a Main-owned service object and uses the existing adapters only when requested; no always-running AI worker/process is introduced. Plugins own their JS/WASM state and should lazy-load heavy local models, terminate owned workers when permitted, and release references on runtime close. The Web runtime remains one bounded WebContentsView in the already on-demand Manager; no per-plugin BrowserWindow, Manager preload expansion, second NativeHost, or always-resident Manager is proposed.

Some browser APIs (Workers, WebGPU, WASM) may have current CSP/runtime-policy restrictions. This document does not relax those restrictions; do not silently trade sandbox security for plugin performance.

## 23. Implementation Plan

One bounded Phase 6E-6 implementation may proceed only after this document is reviewed. Do not create additional 6E-6 subphases.

1. **Freeze the revised design.** Confirm the four selected capability families and the exact frozen Phase 6E-2 request/limit shapes. Preserve per-call AI Host confirmation unless a contract amendment is explicitly reviewed and approved; this UX question does not reopen the accepted AI architecture.
2. **Implement the minimum persisted Manifest v2 production authority.** Persist install identity, exact package/version/hash binding, enabled/compatible state, requested capabilities and user grants. Support grant revocation, active Feature eligibility, update invalidation/revalidation, uninstall authority cleanup, runtime generation revocation, and restart/crash-safe state that cannot silently grant authority. This prerequisite is part of Phase 6E-6 production enablement, not optional test scaffolding.
3. **Add typed SDK mappings for only the four selected families.** Add context, storage, Shared AI, and clipboard-write public browser-safe namespaces; keep method strings/private routes out of public exports. Preserve fixed routes, closed schemas, per-method bounds, cancellation, and safe errors.
4. **Add Main handlers using existing systems.** Map context to the exact validated invocation; storage to the existing PluginStore; AI to the existing SharedAIService; clipboard write to the narrow Main OS effect. Do not create a second store, AI provider framework, permission database, or generic dispatcher.
5. **Prove lifecycle and revocation.** Validate grant denial, revoke during pending requests, generation switch, update/uninstall, timeout/cancel, stale result rejection, Manager close, and process cleanup in packaged production runtime.
6. **Perform bounded packaged adversarial acceptance.** Exercise valid/invalid schema, forged sender/frame, stale Feature/hash/generation, context expiry, quota edges, output/byte bounds, user cancellation, clipboard unchanged on denial, storage atomicity/quota/uninstall, and AI secret non-exposure with isolated fixtures and no real tokens.
7. **Run regression and checkpoint.** Run focused Node/security tests, typecheck, full Node tests, build, NativeHost/UpdateHelper checks, packaged Windows acceptance as authorized, diff review and git diff --check. Stop at the approved Phase 6E-6 checkpoint; Phase 6E-7 remains NOT STARTED.

Do not benchmark or change Gate 4 as part of this capability design. Network acceptance remains its own phase.

## 24. Explicitly Deferred

- **external.open(url):** valid future Host capability, but deferred from the first Phase 6E-6 implementation set because it is another Plugin-to-OS effect and adds less platform-validation value than the four selected authority shapes. If reviewed later, the conceptual API may remain webtools.external.open(url), limited to canonical HTTPS URLs ≤2,048 UTF-8 bytes, the frozen grant/Host-confirmation requirement, and ten consent evaluations per rolling 60 seconds. Reject credentials, HTTP, file/local/custom schemes, executable paths, and shell arguments; revalidate the active generation immediately before opening. No arbitrary navigation, app launch, browser automation, remote page fetch, or cookie access.
- **Shared AI consent UX amendment:** the idea of replacing Host confirmation on every call with persisted grant + explicit foreground user gesture is only a contract-amendment candidate. It is not approved; frozen Phase 6E-2 remains effective.

- Manifest/API/SDK/Bridge/permission schema changes in this research-only task.
- Product implementation code in this design-revision task. The minimum persisted v2 authority remains a formal prerequisite within the later Phase 6E-6 implementation plan.
- Any public generic request/RPC/event/IPC API.
- Plugin-owned network access, sdk.fetch, sdk.http, domain proxy, or Gate 4.
- Streaming AI, model listing, per-plugin model override, tool calling, agents, structured/multimodal input.
- AI billing, marketplace, cloud account, monetization, provider marketplace, or analytics system.
- OCR/Translation universal Provider framework.
- Ambient clipboard read/history/monitor, image/file/rich clipboard.
- Arbitrary filesystem, raw paths, shell/process, app launch, system settings API.
- Native notifications, silent screen capture, global color sampling.
- Dynamic Features, plugin-to-plugin calls, custom windows, browser automation.
- A second NativeHost, per-plugin Electron process, or always-running AI process.
- Package layout, dependency, product version, Manifest version, Plugin API major, or lockfile changes.

## 25. Open Questions

The only unresolved review decision is Shared AI consent UX:

- **Option A — current frozen behavior:** persisted grant + Feature eligibility + Main authority + Host confirmation for every call.
- **Option B — possible future amendment:** after a persisted grant, a direct foreground user action may be sufficient without another Host confirmation dialog for each call.

Until an explicit amendment is reviewed and approved, Option A and the existing Phase 6E-2 contract remain authoritative. This UX question does not block review of the rest of the capability architecture. The minimum persisted v2 lifecycle is not an open question: it is a formal Phase 6E-6 production-enablement prerequisite.

## 26. Recommendation

Proceed to final review of this revised design. The first implementation set is exactly:

- context.current()
- storage.get/set/delete
- ai.complete({prompt})
- clipboard.writeText(text)

Persisted v2 authority is a formal production-enablement prerequisite. external.open is deferred. AI streaming and AI tool calling are deferred. Network/Gate 4 remains Phase 6E-7 / NOT STARTED. The current Phase 6E-2 per-call AI confirmation remains authoritative; the UX amendment candidate is recorded for review only.

```text
PHASE 6E-6 REVISED DESIGN READY FOR FINAL REVIEW
FIRST IMPLEMENTATION SET: context.current(); storage.get/set/delete; ai.complete({prompt}); clipboard.writeText(text)
PERSISTED V2 AUTHORITY: FORMAL PRODUCTION-ENABLEMENT PREREQUISITE
EXTERNAL.OPEN: DEFERRED
AI STREAMING: DEFERRED
AI TOOL CALLING: DEFERRED
NETWORK / GATE 4: PHASE 6E-7 / NOT STARTED
AI PER-CALL CONFIRMATION: CURRENT 6E-2 CONTRACT PRESERVED; UX AMENDMENT CANDIDATE RECORDED FOR REVIEW
NO PRODUCT CODE CHANGED
NO COMMIT
NO PUSH
```
