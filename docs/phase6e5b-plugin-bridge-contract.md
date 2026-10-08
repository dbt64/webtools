# Phase 6E-5B — Internal Plugin Bridge Contract

**Status:** CONTRACT DESIGN ONLY — ready for review
**Date:** 2026-10-08
**Phase boundary:** Phase 6E-5C is not started. No production Bridge, preload, SDK implementation, tests, dependencies, package changes, normal v2 installation, or Launcher changes are included.

## 1. Purpose and frozen scope

This contract freezes only how an untrusted Web Plugin request crosses the private browser SDK/preload/IPC boundary and reaches Electron Main. It defines a bounded, cancellable transport and the identity/lifecycle checks around it. It does not define which WebTools business capabilities a Plugin may call.

The supported developer entry remains **`@webtools/plugin-sdk/web`**. The generic transport primitive and its method strings are internal plumbing. No Context, PluginStore, Shared AI, clipboard, filesystem, shell, external-open, application-launch, system, secrets, network, Super Panel, or Launcher API is defined here.

The only request method permitted in the 6E-5 transport baseline is the side-effect-free transport probe `bridge.ping`. It accepts `null` and returns `null`; it proves correlation and response routing, grants no authority, reads no application state, and commits no effect. It is internal/test-level and is not exposed as a public SDK method. All other well-formed method strings fail closed as unavailable.

## 2. Existing contract and implementation alignment

The design reuses the frozen Phase 6E-2 `RuntimeDescriptor`, main-frame identity rules, state machine, error-code set, and bridge quotas. Phase 6E-5A narrows the current SDK phase to connection/readiness/lifecycle support and explicitly defers capabilities. Those statements are compatible: the Phase 6E-2 capability/grant checks apply before a future privileged method or effect; the 6E-5B ping has no capability requirement or effect.

Current code evidence:

| Existing boundary | Current implementation |
|---|---|
| Runtime instance | [`electron/plugins/web-plugin-runtime.ts`](../electron/plugins/web-plugin-runtime.ts) owns one active `WebContentsView`, its generation/state, random origin host, selected feature and Host-validated snapshot. Replacement waits for teardown. |
| Snapshot authority | [`electron/plugins/package-validator.ts`](../electron/plugins/package-validator.ts) creates immutable runtime snapshots from the authoritative v2 validator. [`electron/plugins/validated-web-package-snapshot.ts`](../electron/plugins/validated-web-package-snapshot.ts) exposes only snapshot metadata/resource lookup; the package hash is Main-owned. |
| Runtime origin and entry | [`electron/plugins/web-runtime-policy.ts`](../electron/plugins/web-runtime-policy.ts) creates a fresh random custom-scheme host and resolves only validated inventory paths. |
| Feature identity | [`src/shared/feature-contracts.ts`](../src/shared/feature-contracts.ts) defines `FeatureRef`; [`electron/plugins/feature-registry.ts`](../electron/plugins/feature-registry.ts) derives Main-owned live Feature candidates and a metadata-only projection. Projection is not runtime authorization. |
| Manager IPC | [`electron/preload.ts`](../electron/preload.ts), [`src/shared/ipc.ts`](../src/shared/ipc.ts), and [`electron/main.ts`](../electron/main.ts) use narrow preload methods and fixed IPC handlers. `isCurrentWindowMainFrame` authenticates the Manager; it is not sufficient to authenticate a Plugin WebContents. |
| Manager shutdown | Main closes the Web runtime before quitting. Plugin Bridge revocation must be tied to the active runtime and must not make the Manager preload the Plugin transport. |

The actual Web runtime currently has **no dedicated Plugin preload or Bridge**. Normal v2 Plugin installation and a persisted v2 grant authority also do not exist; the accepted 6E-4 runtime path is an isolated packaged acceptance path. Consequently, 6E-5 enables no capability requiring an installed-plugin grant. The absence of a v2 grant record must never be interpreted as a grant. A future capability remains unavailable until Main can resolve its authoritative installed/enabled/compatible record and live grant revision.

Phase 6E-2 records a 20-second accepted-invocation-to-document-load bound; the current 6E-4 runtime code uses a separate 15-second `LOAD_TIMEOUT_MS`. This contract does not change either runtime-load behavior. Its frozen **10-second Bridge-ready deadline starts after the exact main document's `did-finish-load`**. The existing load bound and post-load Bridge handshake bound are separate; 6E-5C must retain the current runtime lifecycle and must not silently widen either bound.

## 3. Roles and public/private boundary

### Browser Plugin and public SDK

- Plugin code uses ordinary browser APIs and its own bundled application code.
- `@webtools/plugin-sdk/web` is the only supported WebTools developer entry. For 6E-5 it provides only runtime connection/readiness/lifecycle helpers and public types, including the approved `connectWebTools()`, `ready`, and `onClose(...)` shape.
- The SDK validates JSON inputs for its internal transport adapter, maintains local AbortSignal listeners, maps safe Bridge errors, and disposes its own listeners. `AbortSignal` never crosses IPC.
- The SDK does not expose `request(method, payload)`, method strings, IDs, channel names, or preload functions as a capability API.

### Dedicated private Plugin preload

- A separate sandboxed/context-isolated preload is attached only to the Web Plugin `WebContentsView`; it is not `electron/preload.ts` and does not expose `window.desktop`.
- It exposes a small **private implementation facade** consumed by the browser SDK: readiness state/subscription, request submission returning an SDK-internal opaque per-call handle and response promise, cancellation by that handle, runtime-close subscription, and local disposal as needed.
- It allocates correlation IDs and owns the renderer-side ID-to-pending-response map. The Plugin author API does not let callers supply or choose an ID.
- It exposes no `ipcRenderer`, generic send/invoke/listen, arbitrary channel, Electron/Node object, filesystem path, process control, Manager API, NativeHost pipe, or package path. The facade global name is not a public contract and is intentionally not fixed here.

### Electron Main

- Main is the sole runtime and authorization authority. It owns the descriptor, generation, live WebContents/frame check, method allowlist, authoritative pending map, quotas, deadlines, cancellation, revocation and any future effect commit.
- It parses and validates the closed transport wire format, derives identity from Electron's actual sender/frame and active runtime, and sends responses only to that exact active WebContents.
- Bridge handlers use fixed private IPC routes. A method string is data in a closed request schema; it never selects an IPC channel or handler dynamically.
- The existing trusted Manager preload remains separate and unchanged.

## 4. Fixed transport routes and exact message schemas

Use one fixed private renderer-to-Main route and one fixed private Main-to-renderer event route. Both carry a **canonical JSON string**, not an arbitrary structured-clone object. The private route names remain implementation details and are never returned to Plugin code or errors. The renderer-to-Main route accepts only the tagged union below; the reverse route sends only the reverse union.

Every message has an exact closed schema: reject unknown/missing fields and wrong types. No message carries a caller-selected principal or authority. The examples show the canonical outer-property order.

```ts
type ClientMessage =
  | { type: 'hello'; protocolMajor: 1 }
  | { type: 'request'; protocolMajor: 1; requestId: string; method: string; payload: JsonValue }
  | { type: 'cancel'; protocolMajor: 1; requestId: string }

type HostMessage =
  | { type: 'ready'; protocolMajor: 1; accepted: true }
  | { type: 'ready'; protocolMajor: 1; accepted: false; error: {
      code: 'INVALID_REQUEST' | 'NOT_AVAILABLE'; retryable: false
    } }
  | { type: 'response'; protocolMajor: 1; requestId: string; ok: true; result: JsonValue }
  | { type: 'response'; protocolMajor: 1; requestId: string; ok: false; error: BridgeError }
  | { type: 'runtime-closed'; protocolMajor: 1 }

type BridgeError = {
  code: WebPluginErrorCode
  retryable: boolean
}
```

The wire forms are:

```json
{"type":"hello","protocolMajor":1}
{"type":"ready","protocolMajor":1,"accepted":true}
{"type":"ready","protocolMajor":1,"accepted":false,"error":{"code":"NOT_AVAILABLE","retryable":false}}
{"type":"request","protocolMajor":1,"requestId":"1","method":"bridge.ping","payload":null}
{"type":"response","protocolMajor":1,"requestId":"1","ok":true,"result":null}
{"type":"response","protocolMajor":1,"requestId":"1","ok":false,"error":{"code":"LIMIT_EXCEEDED","retryable":false}}
{"type":"cancel","protocolMajor":1,"requestId":"1"}
{"type":"runtime-closed","protocolMajor":1}
```

There is no separate minor negotiation, no `identity`/`context` message, no generic event/listener message, and no generic close reason. `runtime-closed` is a terminal best-effort notification; its absence cannot preserve authority.

### Protocol major

- Bridge protocol major is **1**. Major-only matching is sufficient; no minor axis is introduced.
- It is independent of SDK SemVer, WebTools product version, Plugin API major, Manifest version, and Plugin version.
- Main accepts a handshake only for an exact supported major. A mismatch receives `ready.accepted=false` with safe `NOT_AVAILABLE`, then the runtime is revoked/closed. No silent downgrade, partial API, or fallback to a lower major is allowed.
- A malformed `hello` is rejected with `INVALID_REQUEST` where it can be safely represented, then closed. Requests are never accepted before an accepted ready handshake.
- The SDK treats an absent/rejected handshake as an unavailable runtime. It does not probe another major or retry automatically.

## 5. Request correlation

- **Allocator:** the dedicated trusted preload allocates the ID when it creates a request. Plugin code and the SDK caller do not supply it; the SDK receives only an opaque internal per-call handle from the preload.
- **Format:** positive base-10 safe integer text matching `[1-9][0-9]{0,15}` and numerically no greater than `Number.MAX_SAFE_INTEGER` (`9007199254740991`). No UUID or random identity token is needed.
- **Uniqueness scope:** one live preload/document/Bridge generation. IDs start at `1`, increase monotonically, and are never reused in that scope. At exhaustion, fail new calls and close/recreate the Bridge under a fresh Main-issued runtime generation; never wrap.
- **Authority:** an ID is correlation only. It is not authentication, authorization, a principal, a capability, or a bearer token.
- **Pending maps:** preload owns renderer-side response correlation and SDK promise handles. Main owns the authoritative pending-operation map keyed by the exact active runtime instance/generation plus ID; it holds at most four entries.
- **Duplicate request ID:** Main must not overwrite or settle the older pending entry. Because a correlated error would be ambiguous, a duplicate from the active Bridge is a protocol violation: Main synchronously revokes that runtime, rejects all its pending work as closed, and does not dispatch the duplicate.
- **Unknown/duplicate cancel:** a cancel only applies to a pending entry keyed by the exact active runtime instance/generation plus ID. If no such entry exists, it is a stateless no-op: it creates no tombstone, pending entry, or authority; it reserves no future cancellation; and it cannot affect a later request with the same ID text or another generation. Duplicate cancellation after terminal settlement is also a no-op. Bridge correctness does not depend on IPC delivery ordering; a later request with that ID is evaluated normally.
- **Unknown/duplicate response:** preload discards it. It cannot create a promise, replace a pending response, or affect another generation.
- **Late old-generation response:** discard at Main/preload; it cannot settle a request in a replacement runtime even if an ID text happens to match.

## 6. Identity, frame and authority checks

The request contains only `protocolMajor`, `requestId`, `method`, and `payload`. It must not contain `pluginId`, `featureId`, `runtimeId`, `origin`, `generation`, `packageHash`, Plugin version, grant/permission revision, context identity, or a caller-selected source. Extra copies of these fields fail the closed schema; they never select identity.

For each accepted `hello`, request, or cancel, Main derives the sender from `event.sender` and `event.senderFrame` and checks against its active Main-owned descriptor/runtime:

1. `event.sender` is the exact active Plugin `WebContents` object (and its WebContents ID matches the descriptor); it is not the Manager, Launcher, another view, or an unrelated renderer.
2. `event.senderFrame` is non-null and exactly `event.sender.mainFrame`. No subframe receives or uses the Bridge.
3. That main frame is live, the WebContents is not destroyed, the descriptor is the current active object, the generation is current and not revoked, and runtime state is `LOADING` for the handshake or `READY` for requests/cancels.
4. The document URL has the exact `webtools-plugin` custom scheme, random host, and canonical initial entry path held by Main. Query/fragment may remain UI state on that already-loaded document, but never select a package resource or authority; the existing resource protocol parser continues to reject them for archive lookup.
5. The runtime package snapshot carries the Main-validated package hash; its manifest/plugin version and selected Feature are the values captured from that snapshot. Projection rows and Plugin-supplied names/IDs are not authority.
6. Any installed/enabled/compatible Feature state used by a future capability must be re-resolved from a live Main authority and match the captured Feature, version, and package hash. A missing v2 install registry is a denial, not an implicit installed state.
7. A future capability requiring grants must use a current Main-owned grant record and revision. Manifest declarations or renderer data are not grants. If the host cannot resolve the live grant revision, the call is unavailable and no effect starts. The ping has no capability or grant requirement.
8. Request schema, canonical payload, method allowlist, size/rate/concurrency/deadline state are validated before dispatch.

A new cross-document main-frame navigation or reload revokes the generation synchronously; the old document cannot continue using the same WebContents as a new principal. Any message from an old/stale frame is dropped. Same-document state changes do not create a new authority; every call must still match the current custom origin and initial package entry path. A current Plugin WebContents attempting a subframe or wrong-origin/path Bridge call is treated as a runtime-fatal identity violation. An unrelated WebContents is simply denied and cannot close the legitimate active Plugin runtime.

## 7. Ready semantics

Three states must not be conflated:

| Term | Exact meaning |
|---|---|
| **Preload hello** | Dedicated Plugin preload executed in the isolated WebContents and sent `{type:"hello",protocolMajor:1}` from the verified top frame. It proves preload transport presence only. |
| **Main runtime READY** | Main observed `did-finish-load` for the exact selected entry and a compatible main-frame preload hello; Main rechecked sender, frame, origin, path and generation; Main atomically changed that runtime to `READY`. |
| **SDK `ready`** | The SDK's Promise resolves only after it receives Main's accepted `ready` message for that runtime. Preload execution alone, document load alone, or a local protocol constant does not resolve it. |

The 10-second handshake deadline starts at the exact main document's `did-finish-load`, using a monotonic clock. The hello may arrive before or after that event. If it arrived first, Main completes readiness after load; if it arrives later, Main completes readiness when it arrives before deadline. Main changes state to READY before publishing `ready.accepted=true`, so the first subsequent request cannot observe a half-ready runtime.

Failure behavior:

| Condition | Behavior |
|---|---|
| SDK called outside WebTools / private facade absent | SDK rejects `ready` locally with safe `NOT_AVAILABLE`; no IPC is attempted. |
| Preload never sends hello | After the post-load 10-second deadline, Main revokes and destroys that exact runtime; no call is accepted. |
| Unsupported protocol major | Main returns rejected `ready` (`NOT_AVAILABLE`), revokes, and closes; no downgrade. |
| Runtime closes before readiness | Main revokes first, sends `runtime-closed` if possible, rejects local SDK readiness as `RUNTIME_CLOSED`, and continues bounded teardown. |
| Cross-document navigation/reload before readiness | Main revokes synchronously and closes; the old document cannot become READY. |
| Renderer crash before readiness | Main revokes and tears down the exact runtime; pending local readiness rejects as `RUNTIME_CLOSED` or safe `NOT_AVAILABLE` if the renderer is already gone. |
| Document load failure or existing runtime load timeout | Existing runtime load failure path wins; Main revokes/closes and SDK readiness rejects. |

## 8. Request lifecycle, deadlines and quotas

### Minimal state model

```text
SDK_LOCAL
  → SENT
  → ACCEPTED (Main reserved one concurrency slot and began dispatch)
  → SETTLED (SUCCESS | ERROR | CANCELLED | TIMED_OUT | RUNTIME_CLOSED | STALE)
```

`SDK_LOCAL` may be canceled without sending a request. Main acceptance is atomic and synchronous after validation/quota checks and before the first asynchronous dispatch boundary. There is no request queue. Exactly one terminal outcome wins; settlement removes the Main pending entry and releases its slot exactly once. Late work is detached/ignored and cannot emit a second response or commit an effect.

### Frozen limits and exact accounting

| Bound | Contract and accounting |
|---|---|
| Request envelope | At most **532,480 UTF-8 bytes (520 KiB)**. Count each complete canonical request envelope independently. Exactly the limit passes the envelope-size gate; +1 byte fails `LIMIT_EXCEEDED`. |
| Response envelope | At most **532,480 UTF-8 bytes (520 KiB)**. Count each complete canonical response independently. Never send a partial response; if a future result would exceed the limit, return a small `LIMIT_EXCEEDED` response. |
| Concurrent pending calls | At most **4 per active runtime**. Atomically acquire a slot after valid structure, sender/state, method and rate checks, immediately before dispatch. Four pending pass; the fifth is rejected immediately with `LIMIT_EXCEEDED`, without queuing. |
| General token bucket | **Capacity 20; refill 10 tokens/second**, per active runtime, using a monotonic clock and continuous refill capped at 20. The same bucket is available before readiness so authenticated malformed pre-ready input can be charged; a valid pre-ready `hello` consumes no token, so an otherwise clean runtime reaches READY with a full bucket. One token is consumed for each authenticated renderer→Main attempt not proven to be a valid exempt control, including malformed, unknown-method, oversized, or concurrency-rejected attempts. Only a canonical, exact-schema `hello` with supported major in the pre-ready state or a canonical, exact-schema `cancel` in READY is exempt. Host→renderer messages are not renderer request attempts. Sender/frame/runtime mismatch is not charged to another runtime's bucket. |
| Ready | **10 seconds** from main document `did-finish-load` to compatible preload handshake, as defined above. At deadline without readiness, runtime is revoked and destroyed. |
| Ordinary Host call | **30 seconds** from Main dispatch, monotonic. Completion at or before the deadline may settle; completion after it is `TIMEOUT`. Timeout aborts supported work and discards late results; the runtime remains READY unless another fatal condition occurred. |
| Close/cancel grace | **2 seconds** after synchronous revocation/abort to observe cooperative cancellation. On expiry, Main detaches late work and force-destroys only the exact validated Plugin WebContents; it never kills a process by name. Existing runtime/session cleanup bounds remain separate and unchanged. |

Accounting order for renderer→Main input is fixed:

1. Perform only the minimum sender/runtime authentication needed to identify the exact active Plugin WebContents, main frame, and generation. Drop or revoke identity mismatches as specified in Section 6; do not charge an unrelated runtime's bucket.
2. Before parsing, canonicalizing, or trying to recover an ID, apply a raw UTF-8 envelope-size gate. The gate is bounded and may stop counting as soon as the 532,480-byte limit is exceeded. A non-string input or oversized input from the authenticated active runtime consumes one general token and is rejected/dropped without scanning further for a correlation ID.
3. For an in-limit string only, parse once into a bounded value. To prove a control exemption, validate the complete exact schema, supported major, applicable state, request ID where applicable, and canonical byte representation: `{type:"hello", protocolMajor:1}` only in the appropriate pre-ready state, or `{type:"cancel", protocolMajor:1, requestId}` only in READY. A proven valid control is handled without a request token. Host→renderer messages are outside this accounting path.
4. If parsing fails, charge one general token immediately after the bounded parse fails. If parsing succeeds but the input is not proven to be one of those valid controls—including a fake/malformed `hello` or `cancel`, unsupported major, extra/missing fields, any request, or any other renderer→Main message—consume one token before continuing request validation or rejecting it. Only the bounded parse and control-shape checks needed to establish an exemption run before this charge; do not canonicalize a non-control request or do further expensive work first.
5. For a non-exempt attempt, reuse the already parsed value; do not parse it again. Apply strict closed-schema, request ID/method/payload, JSON-value and canonical-byte validation, then validate the recognized internal method. Unknown valid method strings return `NOT_AVAILABLE` and acquire no concurrency slot. A well-formed, uniquely correlated rejection receives a bounded error response; without a trustworthy ID, Main does not invent one or echo attacker text.
6. Acquire a slot only if fewer than four calls are pending; then start the Host's 30-second deadline at dispatch. A rejected fifth call consumes its request token but no slot. On every terminal outcome, remove the pending entry and release its slot exactly once. Cancellation, timeout and revocation release the slot immediately even if a non-cooperative underlying Promise remains unresolved.

Malformed, unknown, fake-control, and oversized attempts from the authenticated active runtime consume one token deliberately to bound repeated parser/Bridge work. A valid `cancel` consumes none whether it matches a pending request or is an unknown/duplicate no-op. Oversized input is rejected/dropped without parsing an arbitrarily large body or searching it for an ID; the caller-side local deadline settles an SDK Promise when no correlated response can safely be sent.

### Shorter caller timeout

The Bridge request envelope has no caller-controlled timeout. The Host maximum is always 30 seconds from Main dispatch. A future typed SDK method may impose a shorter local deadline; the SDK then sends cancellation and settles locally. The effective deadline is the earlier of that local limit and the Host's fixed 30 seconds. A caller cannot extend the Host deadline. In 6E-5B there is no public call API or timeout option.

## 9. Cancellation and terminal races

- Browser `AbortSignal` stays inside SDK JavaScript. The SDK installs/removes its abort listener locally and asks the private preload to cancel its own opaque handle; no signal or callback object is structured-cloned through IPC.
- If aborted before the preload emits the request, reject locally as `CANCELLED`; do not send a request and avoid allocating a Main-visible request ID where possible. No Main token or slot is consumed.
- If aborted after emission, the SDK may settle that local call as `CANCELLED`; the preload sends a best-effort cancel. Main applies it only if the exact active runtime/generation plus ID currently has a pending entry. If none exists—including when cancel is observed before request admission—it is a no-op with no tombstone or retained state. A request admitted later is evaluated normally and may be dispatched; correctness does not rely on IPC delivery order.
- If Main accepts cancellation, it marks the matching request terminal before calling `AbortController.abort()`, releases the slot, and sends one `CANCELLED` response when the sender is still live. The SDK/preload correlation layer discards any response after its local call has already settled; the Promise is never reopened or re-settled, and no Main cancellation tombstone is required.
- Cancellation after response/timeout/revocation, duplicate cancellation, or an unknown ID is a no-op. It cannot reopen a settled request or create retained cancellation state, and cancellation state cannot cross runtime-generation boundaries.
- Timeout and explicit cancellation race by Main's monotonic terminal decision: whichever is first wins. At/after the 30-second Host deadline, `TIMEOUT` wins; a later cancel is ignored. No implicit retry occurs.
- Runtime close/revocation wins over any not-yet-committed result. SDK rejects unresolved work on `runtime-closed`; Main aborts pending work. A response already settled before revocation remains settled and cannot be overwritten by a later close event.
- Cancellation is best-effort interruption. It does **not** roll back an already committed side effect. Future capability implementations must use the separate pre-effect/post-await/pre-commit revalidation rule in Section 13.

## 10. JSON payload and canonical wire encoding

The accepted payload is a bounded JSON value:

```ts
type JsonValue = null | boolean | finite number | string | JsonValue[] | { [key: string]: JsonValue }
```

Apply validation in the SDK/preload before encoding and again in Main after decoding. IPC carries only a string; arbitrary Electron structured-clone objects are never accepted as a bridge payload or response.

Accepted object values are plain objects with `Object.prototype` or `null` prototype, own enumerable string-keyed data properties only. Arrays must be dense and contain no extra enumerable properties. Container nesting is at most 16 levels, reusing the frozen strict-JSON parser depth bound. Strings and keys must contain valid Unicode scalar sequences; object keys `__proto__`, `prototype`, and `constructor` are rejected. Normalize `-0` to `0`.

Reject `undefined`, sparse arrays, accessors, symbols, functions, `bigint`, `NaN`, infinities, cyclic references, class/prototype-bearing instances, `Date`, `RegExp`, `Map`, `Set`, `Error`, `Promise`, `URL`, `ArrayBuffer`, typed arrays, `Blob`, `File`, DOM objects, Electron objects, and all other non-JSON values. Do not silently stringify or drop unsupported values.

Canonical encoding is compact JSON with no insignificant whitespace. The top-level message fields use the schema order in Section 4; error fields are `code`, then `retryable`; nested object keys are sorted by ordinal UTF-16 code-unit order at every level; arrays preserve order; strings/numbers use ECMAScript `JSON.stringify` encoding after validation and `-0` normalization. Main measures the received string's UTF-8 bytes before parse, parses it, applies closed-schema/value validation, canonicalizes it, and requires exact byte equality with the received text. This rejects duplicate JSON keys, alternate whitespace/order encodings and non-canonical text rather than measuring an ambiguous representation. Request and response envelopes are measured independently.

The browser SDK's ordinary `JSON`, Web Crypto, Canvas, timers, Workers, WASM, framework and npm needs remain ordinary browser/build concerns. No binary payload transport is introduced.

## 11. Internal method selector

- Syntax: 1–64 ASCII bytes matching `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){0,3}$`.
- This grammar is internal and is not a stable Plugin author API. It does not map to IPC channel names.
- The sole 6E-5 method allowlisted by Main is `bridge.ping`, with exactly `payload: null` and `result: null`; it has no side effect and no authority.
- A malformed selector or wrong payload shape returns `INVALID_REQUEST`. A syntactically valid but unknown method returns `NOT_AVAILABLE`. Both are bounded, correlated failures and never fall through to dynamic dispatch.
- No future capability names are reserved or frozen here. Later approved capabilities must be exposed as typed `@webtools/plugin-sdk/web` methods and separately authorized by Main.

## 12. Stable Bridge error model

Reuse, without extension, the closed Phase 6E-2 error-code set:

```ts
type WebPluginErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'PERMISSION_DENIED'
  | 'STALE_RUNTIME'
  | 'CONTEXT_EXPIRED'
  | 'NOT_AVAILABLE'
  | 'LIMIT_EXCEEDED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'USER_CANCELLED'
  | 'RUNTIME_CLOSED'
  | 'INTERNAL_ERROR'
```

Bridge mapping:

| Condition | Code |
|---|---|
| Malformed/extra-field schema or invalid JSON value/method shape | `INVALID_REQUEST` |
| Wrong protocol major or unknown method | `NOT_AVAILABLE` |
| Request/response size, concurrency, or rate limit | `LIMIT_EXCEEDED` |
| Explicit accepted cancellation | `CANCELLED` |
| Host deadline | `TIMEOUT` |
| Current runtime revoked/closed | `RUNTIME_CLOSED` |
| Superseded/stale generation or stale pre-commit authority | `STALE_RUNTIME` |
| Runtime/SDK unavailable without a safe more-specific code | `NOT_AVAILABLE` |
| Unexpected sanitized internal failure | `INTERNAL_ERROR` |
| Sender/frame identity mismatch | Do not reply to the untrusted/stale sender; revoke only if it is the current Plugin WebContents violating its frame/origin contract. |

The error envelope contains only `code` and `retryable`. `message` is omitted: a stable SDK-owned safe message can be derived from the code, while Main never needs to serialize exception text. In 6E-5, `retryable` is always `false`; the generic transport cannot promise that repeating an operation is safe. No implicit retry occurs. No raw Electron exception, stack, username, token, secret, filesystem/package path, IPC route, pipe name, proxy detail, or internal Host information crosses to the Plugin.

## 13. Revocation, async work and future effect commit

Main is the only lifecycle authority. On close, Feature switch, disable, uninstall, update, grant revoke, main-frame navigation/reload, renderer crash/hang, or Manager close:

1. Main synchronously makes the old descriptor/generation ineligible and prevents admission before any `await`.
2. Main sends `runtime-closed` to the old private preload if that exact WebContents can still receive it; this is advisory and best-effort.
3. Main marks pending entries terminal, aborts their controllers, and gives cancellation the frozen 2-second grace. A hung/non-cooperative renderer or handler cannot keep authority or concurrency slots.
4. Main destroys only the exact validated Plugin WebContents and completes existing bounded Session/origin cleanup before a replacement runtime may be created. The current 6E-4 cleanup timeout is separate and is not changed by this contract.
5. Late handlers/responses are detached or discarded. They cannot settle a new generation, republish runtime state, or commit an effect. Cleanup failure leaves runtime unavailable; it does not create overlapping authority.

Every future privileged capability must capture Main-owned authority at admission and revalidate after each asynchronous boundary and immediately before committing its effect. At minimum, immediately before commit verify:

- same current active runtime instance and generation, not revoked;
- same authoritative `FeatureRef`, Plugin version, validated package hash and compatible live installed/enabled state;
- the requested/required capability still matches the validated manifest and current Main-owned grant record/revision;
- any invocation context remains bound to this Feature/generation, unexpired and unconsumed where applicable;
- the service operation has not been canceled/timed out and its input remains within its method-specific bound.

If any required authority is absent or changed, do not commit; return/discard as `STALE_RUNTIME`, `PERMISSION_DENIED`, or `NOT_AVAILABLE` as appropriate. Cancellation alone is never the commit guarantee. `bridge.ping` only rechecks active runtime identity/state and returns `null`; it does not use grants, contexts, or external services.

## 14. Test contract for later implementation

Testing remains **BOUNDED / REPRESENTATIVE / DETERMINISTIC**. This section defines focused acceptance for 6E-5C/5D/5E; it does not authorize building a large adversarial framework in this phase.

| Invariant | Required focused evidence |
|---|---|
| Protocol and readiness | Major 1 positive; unsupported/malformed major rejected with no downgrade; document-load + hello required; ready deadline and each pre-ready failure closes safely. |
| Closed schema/canonical bytes | Exact fields accepted; extra/missing/wrong fields rejected; duplicate keys/whitespace/noncanonical encoding rejected; unsupported JSON values rejected in SDK and Main. |
| Correlation | Preload allocation; ID at `9007199254740991` boundary accepted by parser and +1 rejected; no ID reuse/wrap; duplicate request is not dispatched and cannot settle/replace old pending; unknown/duplicate response discarded; unknown cancel before a matching request creates no retained state and a later same-ID request is evaluated normally; duplicate cancel is a no-op. |
| Main identity/frame | Active exact WebContents/top frame positive; unrelated WebContents denied without harming active runtime; subframe, wrong origin/path, stale document/generation rejected; one real navigation/reload revokes before another call. |
| Ping round trip | A real internal `bridge.ping` request returns a correlated `null`; unknown valid method returns safe `NOT_AVAILABLE`; no public generic request API appears. |
| Envelope bytes | Request and response are measured separately in UTF-8; exact 532,480-byte envelope passes the size gate and +1 fails. Because production ping has a fixed null payload/result, use the pure closed-envelope validator/serializer test seam for exact response construction; do not add a production echo method. |
| Concurrency | Four admitted pending calls pass; fifth fails immediately; terminal cancel/timeout/revoke frees each slot exactly once; use a deterministic held test dispatcher, not a production method. |
| Rate | Initial 20 attempts pass, attempt 21 at no elapsed refill fails; exact 1-token refill after 100 ms passes; invalid/unknown/oversized attempts and malformed fake `hello`/`cancel` are charged; only canonical exact-schema exempt controls avoid a token, and valid cancel remains token-free. Use a fake monotonic clock. |
| Deadline/cancel | At-or-before 30-second Host deadline may settle; late response is discarded; caller-shorter local timeout sends best-effort cancel; cancel before request emission is local; a locally cancelled call ignores a late response and its Promise stays settled; cancel observed before request admission leaves no retained effect and the later request is evaluated normally; accepted cancel returns one terminal result; close/revoke race leaves no late commit. |
| Errors/revocation | Only frozen error codes; `retryable:false`; messages/stack/path/secret absent; revoke is synchronous before async cleanup; close/switch/navigation/crash and Manager close deny old generation; teardown failure stays unavailable. |

Use one meaningful positive and negative case per invariant, exact/+1 boundary cases where numerical, and regressions for real discovered defects. Do **not** require exhaustive permutations, fuzzing, exhaustive browser matrices, long soak, combinatorial scheduling, or another Phase 6E-4-style matrix.

## 15. Explicit non-goals

This contract does not:

- design or implement Context, PluginStore, Shared AI, clipboard, filesystem, shell, external-open, application launch, system operation, secrets, or any other business capability;
- create `webtools.fetch()` or a network broker;
- enable or design `network.mode:domains` (Gate 4 remains **NOT CERTIFIED**; domains remains **UNSUPPORTED**; `network.mode:none` remains the only supported Web runtime profile);
- implement normal Manifest v2 installation, Plugin Center v2 consent, Projection v3, Native Feature discovery, Launcher, or Super Panel behavior;
- reuse the trusted Manager preload or change Manager IPC/security boundaries;
- change Manifest/API/Product/SDK versions, package layout, dependency graph, persistent schemas, or Phase 6E-2 quotas/errors;
- implement or begin Phase 6E-5C.

## 16. Implementation validation required

The transport wire/authority contract above is frozen for review. One **non-blocking implementation validation** remains for 6E-5C: verify the exact Electron 44.4.5 `contextBridge` mechanics for the private facade's Promise response, close subscription, and SDK-internal opaque cancellation handle, then verify the fixed string-only IPC routes in the real isolated `WebContentsView`. Static repository code cannot demonstrate those not-yet-implemented calls. This validation may select the smallest mechanically supported private facade shape, but may not change the schemas, ID ownership, authority model, quotas, public/private distinction, or lifecycle rules above.

### Non-normative 6E-5C implementation note: bounded canonicalization

The required contract order remains raw canonical JSON string → UTF-8 size measurement → parse → validate → canonicalize → byte-for-byte comparison. For input already bounded to at most 520 KiB, an implementation should avoid unnecessary repeated full-size copies or multi-stage serializer pipelines beyond what validation and the comparison require. This is implementation guidance only: it adds no security gate, quota, acceptance phase, benchmark, or test requirement and does not change canonical encoding.

This is not a design TBD or permission to expand scope. If Electron's mechanics cannot carry the approved facade without exposing raw IPC/authority, stop and report the concrete incompatibility before implementing an alternate API.

## 17. Open questions

**NONE at the contract level.** The Electron 44.4.5 private facade mechanics listed in Section 16 are a bounded implementation validation, not an unresolved schema, authority, or product decision.

## 18. Review checklist and recommendation

- [x] Reuses the frozen Phase 6E-2 `RuntimeDescriptor`, error set, identity model, and numeric quotas.
- [x] Keeps `@webtools/plugin-sdk/web` public and the dedicated preload facade/private transport internal.
- [x] No generic public `request()` or capability catalog.
- [x] Main derives identity from actual sender/frame and current runtime snapshot; no caller-selected authority fields.
- [x] Readiness requires document load plus compatible preload handshake within the frozen 10-second post-load deadline.
- [x] Correlation, schemas, byte accounting, concurrency, rate, cancellation, timeout, revocation, and late-response behavior are explicit.
- [x] Async future effects require generation/package/grant/context revalidation immediately before commit.
- [x] Gate 4, domains networking, normal v2 install, projection, and Launcher remain out of scope.
- [x] No production source or implementation is included.

**Recommendation:** `PHASE 6E-5B CONTRACT READY FOR REVIEW`

**Next phase:** `PHASE 6E-5C NOT STARTED`
