# Phase 6E-5A Design Report — Thin Plugin SDK & Package Boundary

**Status:** AUDIT + DESIGN; approved with minor changes, final review pending
**Date:** 2026-10-08
**Scope:** No product implementation, dependency installation, package move, publication, commit, or push.

## Current Repository State

- **Branch:** `codex/shared-ai-translation-2.0`
- **HEAD:** `f3f0e0de5e905f3b84ef2ecf45513de60a7db640` — `feat(plugins): complete isolated web runtime baseline`
- **Dirty files preserved:**
  - `native/WebTools.NativeHost.Checks/Program.cs`
  - `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`
  - `docs/bugfix-launcher-app-search-after-autostart.md`
- The three dirty files are the separate Launcher work already present before this audit. This task did not alter them.
- Root is one private pnpm application (`webtools-desktop`, pnpm `9.15.9`). There is no `pnpm-workspace.yaml`. `plugin-sdk/declarative-v1/package.json` is a separate, non-workspace package.
- Phase 6E-4 reports Gate 1 as an accepted, bounded offline-runtime baseline. Gate 4 remains **NOT CERTIFIED**; `network.mode:domains` remains unsupported.

## Current Plugin Architecture Audit

| Area | Current responsibility and evidence |
|---|---|
| **Host** | Electron Main owns install-time validation, plugin registry/grants, runtime creation, custom protocol, isolated Session and privileged effects. Relevant code is under `electron/plugins/`; `package-validator.ts` wraps canonical validators, and `web-plugin-runtime.ts` owns the isolated `WebContentsView` lifecycle. Main uses Host-validated immutable snapshots. |
| **SDK** | `plugin-sdk/declarative-v1/` is the standalone `@webtools/plugin-sdk@1.2.0` package. It contains author-facing Manifest v1 types/schema and CLI, v1 validate/pack/inspect tooling, and bounded non-authoritative Manifest v2 preflight. It is `private`, distributed by local tarball, and is not published to npm. |
| **Shared contracts** | `src/shared/feature-contracts.ts`, `plugin-contracts.ts`, `feature-invocation-contracts.ts`, and related files are repository-local Main/renderer/native wire or product contracts. `FeatureRef` is a Host/native identity contract; it is not an SDK authorization token and should not be imported into the browser SDK. |
| **Trusted Manager renderer** | `src/features/plugins/WebRuntimeView.vue` hosts the visible surface and sends bounds/close requests through the existing trusted Manager preload. `electron/preload.ts` exposes `window.desktop`, including `webRuntime` controls and state. |
| **Web Plugin renderer** | `web-plugin-runtime.ts` creates a separate `WebContentsView` with `sandbox`, `contextIsolation`, `webSecurity`, and `nodeIntegration: false`; it does not attach the Manager preload. The current runtime has **no plugin-facing preload or bridge**. The Phase 6E-2 contract requires a separate minimal preload for that future boundary. |
| **NativeHost** | It owns Launcher/search/tray/hotkey and receives bounded Feature presentation/invocation metadata. It must not parse Web bundle content, execute plugin code, or own plugin grants. The authenticated Phase 6D pipe remains the NativeHost↔Manager route. |

### Dependency direction and compatibility

Current production direction is intentionally one-way at the plugin boundary:

```text
Electron Main ──imports──> plugin-sdk/declarative-v1/runtime validation core
Plugin author tooling ──imports──> @webtools/plugin-sdk public facade
Web Plugin ──currently has no SDK bridge──> (future browser entry)
```

The SDK implementation does not import Electron, Vue, NativeHost, or private application services. The Host imports the shared validation core; no production circular dependency was found in the audited boundary. Tests may compare SDK and Host acceptance, but those test references are not production imports.

Manifest v1 parser/bytes, API major 1, declarative compatibility adapter, and existing install/grant semantics are frozen. Manifest v2 is a separate closed Web bundle contract. The Phase 6E-3 report records that `PluginManager.install` validates a v2 candidate and then returns `INCOMPATIBLE_PLUGIN` before consent or state mutation because the persisted registry/lifecycle remains v1-only. Phase 6E-4 exercises the real packaged runtime through an isolated acceptance fixture; it does not establish normal Plugin Center installation or Native feature discovery for v2.

## Problems With Current Layout

These are concrete boundaries to address in the 6E-5 implementation sequence, not claims of an existing privilege escape:

1. The package root export (`plugin-sdk/declarative-v1/index.mjs`) imports `node:fs/promises`; it also exposes archive validation backed by `Buffer`, `node:crypto`, and `yauzl`. Importing the current package root from a browser plugin bundle is therefore not a browser-safe SDK path.
2. `package.json` has no browser-only SDK subpath. A Web Plugin needs a small entry whose complete import graph is browser-compatible and does not pull in the authoring CLI or Host validator.
3. The Web runtime has no dedicated preload/transport yet. Reusing `electron/preload.ts` would expose trusted Manager APIs and violate the frozen trust boundary.
4. The SDK has a package manifest and can be packed as a standalone local package, but the manifest has no package-local build/test scripts or development tool declarations. Existing tests are run from the application repository. Independent package checks should be explicit before npm publication.
5. The directory name `declarative-v1` no longer describes every file in the package because it also contains v2 preflight code. This is a naming mismatch, not a concrete reason to move the package or create a workspace.
6. Normal v2 installation/Feature projection is not yet connected. Phase 6E-5 bridge acceptance can prove the packaged runtime boundary with a real Host-validated fixture; it cannot claim normal installed-plugin UX until the relevant later product work exists.

No dependency cycle or current Web Plugin access to Node/Electron APIs was found in the audited code. Gate 1's bounded acceptance is not represented as exhaustive security certification.

## Historical `runtime/package-v2.*` Placement

The Phase 5H plan deliberately moved the canonical Manifest v1 parser, PNG validator, and ZIP package validator into the SDK-owned runtime directory so Host and author tooling use one implementation and parity tests can detect drift. Phase 6E-3 extended that canonical validation area with the strict v2 archive/inventory parser; Electron Main wraps it as the authoritative Host validator, while the SDK's v2 result remains advisory. This explains why `plugin-sdk/declarative-v1/runtime/package-v2.*` exists.

**Decision:** leave `runtime/package-v2.*` at its current path during 6E-5A and the bridge phases. It is Node-based package-validation code, not a browser bridge contract and not merely a shared DTO. Do not move or duplicate it to create the new SDK entry. The future browser entry must not import it. Keep the current Host adapter as the final install/runtime authority. If later npm publication or package ownership creates a concrete need to separate the canonical validator, review a dedicated internal validation-core boundary with parity coverage; do not put ZIP/Host validation into a browser-neutral contracts package.

## Proposed Package Boundary

Keep one package and one Git repository during active 6E development. The existing nested package is already a separate pnpm package; a conventional `packages/` directory would not itself improve the trust boundary. Avoid a workspace and avoid a path-only move that would touch Host imports, SDK tests, release checks, and the validated external author workflow.

Add an **additive browser entry** to the existing package, preserving its Node authoring root and current CLI contract:

```text
plugin-sdk/declarative-v1/
├── package.json                 # one package: @webtools/plugin-sdk
├── index.mjs / types.d.ts       # existing Node authoring facade; compatibility preserved
├── web/                         # new browser-only entry and declarations
│   ├── index.mjs (or .ts)
│   ├── index.d.ts
│   ├── bridge-client.*
│   └── protocol.*                # pure bounded wire DTOs/helpers; no Host imports
├── runtime/                     # existing canonical Node validators; paths unchanged
├── src/                          # existing Node CLI/authoring implementation
├── bin/
└── tests/
```

Expose it as the exact browser/runtime subpath `@webtools/plugin-sdk/web`. This is an additive compatibility decision: preserve the existing `@webtools/plugin-sdk` root for Node-oriented authoring/tooling, its `webtools-plugin` CLI, Manifest v1 behavior, and the validated local tarball workflow. The eventual package export map must make the browser entry's dependency graph auditable; `sideEffects: false` or tree-shaking alone is not a substitute for a Node-free import graph.

In a later extraction, the same package root and public subpath can move to a standalone Git repository without changing import names. Keep release/versioning independent of the WebTools product version, Plugin API major, and Manifest versions. Do not set `private: false` or publish during 6E-5.

## `@webtools/plugin-sdk` Responsibility

`@webtools/plugin-sdk/web` is the supported developer-facing entry. In 6E-5 it may expose connection/readiness and runtime lifecycle helpers plus stable public types. It does **not** expose a generic `request(method, payload)` capability API.

The internal transport adapter owns only the mechanics needed under that public layer:

- Connect to the private facade supplied by the dedicated plugin preload.
- Perform protocol-version/readiness negotiation.
- Use bounded opaque request-correlation IDs allocated by the dedicated preload; ordinary plugin code cannot choose identity or IDs.
- Send closed request envelopes, correlate responses, and map Host errors to safe SDK errors.
- Translate a local browser `AbortSignal` into an explicit cancel message; do not structured-clone the signal through IPC.
- Apply bounded deadlines and reject pending calls when runtime lifecycle closes.
- Release listeners/resources when the SDK client is disposed.

This transport layer is internal to the SDK/Host implementation. It may be package-internal or explicitly marked internal for focused acceptance, but it is not the stable capability-level API. Plugin author documentation must not teach direct calls to the preload facade or internal transport.

When a later phase approves a Host capability, the SDK should expose a typed method for it and map that method internally to a transport request. Conceptual examples such as `webtools.context.get()`, `webtools.ai.complete(...)`, or `webtools.store.get(...)` illustrate that layering only; 6E-5A does not define or freeze any of those capabilities.

Framework code, business logic, state management, local computation, rendering, and normal browser APIs stay in the plugin's own application. Vue, React, Svelte, and Vanilla output are ordinary static browser bundles; npm/pnpm packages are author build dependencies and must be bundled to package-local output before `.wtplugin` packing. Existing Manifest v1 authoring/packing functions stay on the existing Node-oriented path.

## Explicit Non-Responsibilities

Do not add wrappers for JSON, crypto/hash, image processing, compression, Canvas, timers, HTTP/fetch, WASM loading, Workers, npm, or UI frameworks. Do not provide filesystem, process, Electron, Manager, raw IPC, NativeHost pipe, SecretStore, or arbitrary app-launch APIs. Do not introduce `webtools.fetch()`.

Browser `fetch`, Web Crypto, Canvas, timers, Workers, and WebAssembly are used directly when ordinary browser code needs them. The Host's current Session/CSP policy remains authoritative: `network.mode:none` blocks network; Gate 4 is not certified, and `network.mode:domains` remains unsupported. Declared package-local WASM remains subject to the frozen v2 validator/CSP/runtime contract.

## Dependency Rules

**Allowed**

- Plugin application → browser-compatible packages and browser APIs.
- Plugin application → `@webtools/plugin-sdk/web` as the supported WebTools developer API.
- Public browser SDK → its own typed public surface; future approved capabilities are mapped internally to transport.
- SDK-internal transport adapter → pure protocol DTOs, browser primitives, and the private preload facade type.
- Dedicated plugin preload → Electron's minimum sandboxed preload bridge, fixed private IPC routes only.
- Electron Main → pure bridge wire contract and Main-owned runtime/validator/registry services.
- Electron Main → the existing canonical SDK validation core for host validation, as today.

**Forbidden**

- Browser SDK → Electron, Node built-ins, `plugin-sdk` Node CLI/runtime validators, Vue/Manager, NativeHost, private services, or filesystem paths.
- Plugin renderer → `window.desktop`, Manager preload APIs, `ipcRenderer`, arbitrary IPC channels, or caller-selected privileged channels.
- Supported plugin developer contract → direct use of the private preload global or internal generic transport method strings.
- Main → plugin-supplied plugin/feature/runtime IDs, origin, generation, package hash/version, context identity, grants, or permission decisions as authorization.
- NativeHost → Web bundle parsing, runtime execution, grants, or privileged Web bridge handling.
- Any new unauthenticated NativeHost pipe or parallel Feature registry.

## Minimal Bridge Contract

The Phase 6E-2 `RuntimeDescriptor` remains the authority. Main creates it from trusted state and binds it to the exact plugin `WebContents`/current main frame, a fresh random runtime origin, a never-reused generation, validated `FeatureRef`, plugin version, immutable Host-validated package hash, and the current Main-owned grant revision where a grant store applies. Context identity is included only when an existing invocation supplies it. It is never serialized to the Plugin as authority.

Every request is associated with identity by `event.sender` and `event.senderFrame`, then checked against the active Main-owned descriptor. Main verifies exact WebContents and top frame, expected current document/origin/path, READY and non-revoked state, current generation, current installed/enabled/compatible Feature and package hash, live grant revision where applicable, and bounded closed-schema payload before dispatch. Relevant identity and authority are rechecked after async boundaries and immediately before any future effect. The bridge does not add a NativeHost invocation path; existing authenticated Phase 6D invocation remains the only one.

The **internal transport** request DTO carries only protocol version, method, request correlation ID (allocated by the preload), and JSON payload. It never carries identity or authority fields. The transport adapter receives only the opaque per-call handle needed to correlate/cancel; it does not choose the ID. The correlation ID is bounded and unique only within a live bridge instance; it is not a credential, principal, or authorization token. Main rejects unknown methods. This `request(method, payload)` primitive is internal RPC plumbing, not a public capability API, and its method strings are not a stable Plugin developer contract. In 6E-5, no business capability method is enabled; protocol/readiness traffic may succeed, and unknown/future capability calls fail closed as unavailable.

Proposed closed v1 wire shapes:

```ts
type Request = {
  protocolMajor: 1
  requestId: string
  method: string
  payload: JsonValue
}

type Response =
  | { protocolMajor: 1; requestId: string; ok: true; result: JsonValue }
  | { protocolMajor: 1; requestId: string; ok: false; error: {
      code: WebPluginErrorCode; retryable: boolean; message?: string
    } }

type Cancel = { protocolMajor: 1; requestId: string }
```

Unknown protocol major, malformed envelope, oversized payload, unknown method, mismatched sender/frame/origin, stale generation, or closed runtime fails closed. Do not silently downgrade. SDK/package SemVer, Plugin API major, Manifest version, and bridge protocol major are separate version axes.

The v1 contract reuses Phase 6E-2 limits without silently changing them: request/response envelope ≤520 KiB; at most four concurrent pending calls; general token bucket capacity 20/refill 10 per second; 30-second ordinary-call deadline; 10-second preload-ready deadline after main document load; 2-second close/cancellation grace; stable bounded error codes/messages. AI's 60-second timeout and AI-specific limits are future 6E-6 concerns, not enabled in 6E-5. No implicit retry after timeout. Timeout/cancel discards late results; a request whose side effect already began is not claimed to have been rolled back.

### Runtime lifecycle

On close, switch, disable, uninstall, update, grant revoke, navigation/reload, crash/hang, or Manager close, Main revokes the generation synchronously before cancellation and teardown. Pending calls reject as canceled/closed/stale; late responses cannot commit. Reload requires a new explicit invocation and new origin/generation. Close-before-open and the current bounded teardown barrier remain in force.

## Plugin-Facing Surface

The supported developer entry is `@webtools/plugin-sdk/web`. A new dedicated plugin preload supplies a **private transport facade** to the SDK. That facade is an implementation detail: its eventual global name and exact primitives are left for 6E-5B/6E-5C, and plugin author documentation must not encourage direct use. Keep `electron/preload.ts` and trusted `window.desktop` for the Manager only.

The public SDK surface available in 6E-5 is limited to runtime connection/readiness/lifecycle helpers and types. For example:

```ts
import { connectWebTools } from '@webtools/plugin-sdk/web'

const webtools = connectWebTools()
await webtools.ready
webtools.onClose(() => {
  // Stop plugin-local work before the runtime is destroyed.
})
```

There is no public generic `webtools.request(method, payload)`. A packaged acceptance fixture may exercise request/response using a package-internal transport module, an explicit internal namespace, or a test-only seam. That does not make the primitive a supported capability API and must not create a second documented public surface.

Future approved capabilities belong in typed SDK methods, with internal method dispatch hidden beneath them. 6E-5 enables no Context, PluginStore, Shared AI, clipboard, system, network, or app integration capability. Those require later approved Host capability design. SDK connection/readiness fails outside a compatible WebTools runtime or on unsupported protocol.

## Security Boundary

The plugin remains untrusted static Web code running in its separate sandboxed/context-isolated WebContents and isolated Session, with Node integration disabled and no Manager preload. The new preload is separate, minimal, frozen, and backed by fixed IPC routes. Main validates actual sender/frame/origin and its private RuntimeDescriptor for every call; plugin-supplied IDs cannot choose another identity. Main is the sole authority for grants and effects.

The SDK cannot widen CSP or Session policy. The ordinary `fetch()` function remains a browser API, but `network:none` policy blocks egress below it. No domains behavior is enabled by this design. No secret, filesystem path, package path, raw exception, or internal IPC name crosses to the plugin.

## npm Strategy

| Option | Tradeoff | Decision |
|---|---|---|
| **A — Same Git repository, independent package** | Keeps the tested SDK source, Host validator adapter, existing SDK tests, release checks, and external local-tarball workflow together. Can be independently versioned/packed without a workspace. | **Use now.** Keep `plugin-sdk/declarative-v1` as the package root; add an explicit browser subpath and package-local checks in implementation. No workspace. |
| **B — Separate Git repository now** | Adds synchronization/release work while the bridge contract and Host integration are still evolving; no concrete blocker requires it. | **Defer.** The package export names can remain stable if the directory/repository is extracted later. |

The current path is already a package boundary; moving it solely to follow `packages/plugin-sdk/` convention is not justified. A future extraction should carry the package unchanged and keep public import paths stable. `private: true` and local tarball distribution remain until the separately scoped SDK finalization/publication work.

## Phase 6E-5 Implementation Plan

Sequence is strict: 6E-5B → 6E-5C → 6E-5D → 6E-5E. Every phase preserves the frozen 6E-2 contract, 6E-3 Host validator authority, 6E-4 runtime isolation/lifecycle, Manifest v1 behavior, and Gate 4 closure.

### 6E-5B — Bridge Contract

- **Goal:** Freeze the **internal transport** request/response/cancel/ready/lifecycle DTOs, protocol compatibility rule, request-ID bounds, error mapping, Main identity derivation and 6E-2 quotas before implementation. Keep capability-level public API design out of 6E-5B.
- **Likely files:** `docs/phase6e5b-plugin-bridge-contract.md`; focused wire-type/schema fixture under `plugin-sdk/declarative-v1/web/` only if a machine-checked contract is needed.
- **Invariants:** No caller-supplied principal; no capability catalog; no public generic method-string API; no Manager preload reuse; exact frozen deadlines/quotas; Main owns method allowlist; unsupported protocol/method fails closed.
- **Tests:** Closed-schema accept/reject cases, protocol-major mismatch, bounded correlation ID, error sanitization, internal request/response/cancel round-trip model, and exact quota boundary fixtures.
- **Non-goals:** Product code, capabilities, package move, changing Manifest/API versions, Gate 4, or a new IPC pipe.
- **STOP if:** Frozen runtime identity cannot be tied to the current WebContents/frame, an E2 quota cannot be implemented in the actual Electron transport, or protocol compatibility requires changing a frozen contract.

### 6E-5C — Minimal SDK/Bridge Implementation

- **Goal:** Add the browser-only SDK entry as the supported developer layer, a dedicated private plugin preload, fixed private IPC transport, readiness handshake and request correlation. Keep generic request/cancel plumbing internal to the package/runtime implementation. Preserve the existing SDK root/CLI and Manifest v1 author workflow. All unapproved method calls remain unavailable.
- **Likely files:** `plugin-sdk/declarative-v1/package.json`, new `plugin-sdk/declarative-v1/web/*`, `electron/plugins/web-plugin-preload.ts`, `electron/plugins/web-plugin-runtime.ts`, `electron/main.ts`, `electron.vite.config.ts`, and focused browser-entry/preload/runtime tests. Do not modify the trusted Manager preload except if the build tool requires an explicit, narrowly scoped input declaration; never expose plugin transport through `window.desktop`.
- **Invariants:** Browser entry has no Node/Electron/Host import; one private fixed transport facade; no raw IPC; no generic transport exposed as a stable public capability API; no capability side effects; no changes to v1 CLI/imports or authoritative package validation.
- **Tests:** Browser import graph has no Node built-ins; supported SDK subpath resolves in a browser bundler; preload exposes only the private facade; Manager globals absent; protocol readiness succeeds only for main frame; internal unknown methods produce safe unavailable errors.
- **Non-goals:** Host capability methods, storage, context, AI, clipboard, external-open, domains network, workspace/monorepo, npm publication.
- **STOP if:** The browser entry requires Node polyfills, the plugin preload would share Manager authority, an unknown request can reach a generic privileged handler, or preserving the validated 1.x author workflow requires a breaking API change.

### 6E-5D — Identity/Lifecycle/Quota Enforcement

- **Goal:** Connect every accepted internal transport message to the Main-owned RuntimeDescriptor; enforce sender/frame/origin/state/generation and live package/grant checks; add bounded pending-call, rate, byte and deadline handling plus cancellation/teardown behavior.
- **Likely files:** New Main-only bridge service such as `electron/plugins/web-plugin-bridge.ts`, `electron/plugins/web-plugin-runtime.ts`, the fixed Main IPC registration area in `electron/main.ts`, pure bridge protocol tests, and focused runtime/identity/quota tests. Use existing Feature and permission authorities; do not create a parallel registry.
- **Invariants:** Only actual `event.sender`/`senderFrame` selects principal; check exact active main document and current generation; revoke before async cleanup; revalidate after awaits and before commit; pending work is bounded and late responses are ignored; no side effect before authorization.
- **Tests:** Use **bounded, representative, deterministic regression testing**. For each security/runtime invariant, include at least one meaningful positive/negative case; for numeric quotas, test the exact boundary and boundary+1; retain a regression for each real defect found. Representative cases cover spoofed identity fields, unrelated WebContents, subframe, old origin, stale generation, reload/switch/close/crash, grant revision change where applicable, cancellation, timeout, byte/concurrency/rate limits, sanitized errors, and fail-closed teardown failure.
- **Non-goals:** Enabling any business capability, changing package storage/registry, standard v2 Plugin Center install, network broker, new persistence schema.
- **Not required:** Exhaustive adversarial permutations, every timing/event ordering, exhaustive browser or sender/origin combinations, fuzzing, long soak, or combinatorial scheduling exploration. A real defect is reproduced deterministically, minimally fixed, covered by one useful regression, then bounded acceptance continues; it does not automatically create an open-ended test phase.
- **STOP if:** Main cannot obtain a live authoritative Feature/package identity (and a live grant revision before any future privileged method), close-before-open cannot wait for teardown, or any stale request can produce/commit an effect.

### 6E-5E — Minimal End-to-End Acceptance

- **Goal:** Prove the path **real `.wtplugin` fixture → authoritative Host validation → packaged production Web runtime → dedicated plugin preload → browser SDK → Electron Main bridge**, using actual packaged Electron Main, `WebContentsView`, production custom protocol/Session, and a real valid fixture. This is bridge/runtime acceptance, not complete plugin installation UX.
- **Likely files:** A new focused `scripts/verify-phase6e5-packaged-bridge.mjs`, fixture only if required, focused test/evidence files, and `docs/phase6e5e-bridge-acceptance.md`. Keep the completed Phase 6E-4 verifier and its evidence unchanged.
- **Invariants:** Isolated install/profile/pipe; exact executable and process identity; no production user data; no Manager preload; Main validation is authoritative; zero unauthorized effects; bridge teardown returns the packaged Manager process group to zero without stopping NativeHost where applicable.
- **Tests:** Ready handshake; one successful internal protocol-level request/response; unknown/future method denial; renderer Node/Electron/Manager API absence; representative sender/frame/origin checks; cancellation/timeout and close/switch/reload stale-response behavior; representative quota boundaries; actual process cleanup. Use bounded deterministic cases and reuse applicable 6E-4 Gate 1 evidence; do not repeat the full Gate 1 matrix.
- **Non-goals:** Normal Plugin Center v2 installation or Native projection (not currently supported), full feature/capability workflow, exhaustive fuzzing, Gate 4, long soak, or a production installer/release.
- **STOP if:** Evidence requires synthetic Host or preload mocks in place of the packaged runtime; production install/profile isolation cannot be proven; or the v2 registry limitation makes the agreed bridge-only acceptance impossible without out-of-scope product work.

## Future Boundaries

- **6E-6 — Only Necessary Host Capabilities:** separately design and implement only approved capabilities such as invocation context, PluginStore, Shared AI, and narrowly justified clipboard/system integration. Main remains the effect authority; no capability is implied by this transport phase.
- **6E-7 — Network policy / Gate 4:** independently prove connection-level exact-domain enforcement. Until it passes, `network.mode:domains` stays unsupported and `network:none` remains the only runtime profile.
- **6E-8 — Developer Experience and SDK finalization:** framework compatibility, browser-bundle packaging, npm distribution decision/publication, external-author workflow, and final SDK compatibility acceptance. Do not treat this 6E-5A plan as authorization for that work.

## Risks / Review Boundaries

1. **Normal v2 install gap:** v2 packages are currently rejected by `PluginManager.install`; only the isolated packaged runtime fixture proves WebContents execution. The 6E-5E acceptance is bridge/runtime acceptance only. It does not require ordinary Plugin Center installation or Native search projection, which remain outside 6E-5.
2. **Public capability design remains deferred:** `@webtools/plugin-sdk/web` is the approved browser/runtime SDK entry. A future capability is exposed as a typed SDK method; its internal transport method string is not a supported author contract. No capability catalog is designed here.
3. **Grant revision source:** no v2 persisted grant record exists while standard v2 installation is disabled. 6E-5 exposes no privileged methods; any future capability request must stop unless Main can resolve a live grant revision from the eventual authoritative v2 grant store.

These are explicit boundaries and sequencing constraints, not newly discovered P0/P1 runtime defects. No product code, dependency, package layout, or evidence was changed by the audit.

## Recommendation

**PHASE 6E-5A DESIGN REVISION COMPLETE**
**READY FOR FINAL REVIEW**
**PHASE 6E-5B NOT STARTED**

The revision keeps the SDK thin, makes internal RPC distinct from the typed developer API, preserves the current authoring/validation workflow and 6E-2 identity/lifecycle contract, and bounds 6E-5D/6E-5E verification. Do not start Phase 6E-5B until final review and approval.
