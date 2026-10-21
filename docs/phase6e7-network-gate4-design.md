# Phase 6E-7 — Network / Gate 4 Research & Architecture Design

**Status: FINAL DESIGN CLARIFICATION COMPLETE — READY FOR HUMAN DESIGN FREEZE REVIEW**

**Gate 4: NOT CERTIFIED**

**`network.mode:domains`: UNSUPPORTED**

**No product implementation or network attack testing was performed for this document.**

## Evidence labels

- **[CODE]** Directly observed in the current repository at the recorded HEAD.
- **[OFFICIAL]** Directly documented in the exact Electron release/source or another named primary source.
- **[INFERENCE]** Security/design consequence inferred from those facts; it is not runtime proof.
- **[UNKNOWN]** Not established by static source or public API documentation. It needs a bounded packaged test or a platform-specific proof.

This document does not certify a network control merely because an API exists, a policy callback ran, CSP rejected a request, or a test fixture passed. “No network effect” and “the permitted connection reached only the approved public address” are separate claims.

## Repository and build identity

Read-only baseline on 2026-10-09:

| Item | Observed |
|---|---|
| Repository | `D:\SystemDefault\Desktop\HomePage` |
| Branch | `codex/shared-ai-translation-2.0` |
| HEAD | `707c5673dff479285b34a5b441bec9d3b725c737` |
| Electron declaration | `package.json` declares `^44.4.5` |
| Locked Electron | `pnpm-lock.yaml` resolves `electron@44.4.5` |
| Electron-bundled Chromium | `152.0.7977.130`, per the Electron 44.4.5 release record |
| Existing worktree changes | Two modified Launcher source/check files, one untracked Launcher bug report, and untracked `undefined/` containing the protected `app.asar` artifact |

The dirty Launcher files and `undefined/` existed before this task and were left untouched. The exact Electron version above is the lockfile/build target; the package range by itself is not an identity. Official version references are listed in [§4](#4-electron-4445-research-findings).

## 1. Executive Summary

**[CODE]** Web Plugin execution currently supports only `network.mode:none`. A v2 package can structurally declare `network.mode:domains`, but the Host validator reports runtime support as unavailable, the registry removes stale `network.domains` grants, PluginManager will not grant or run that mode, and the Web runtime independently rejects a non-`none` mode. No user grant enables it.

**[CODE]** The supported offline profile combines an in-memory dedicated Electron Session, disabled HTTP cache, deny-all permission callbacks, cancelled downloads, CSP, a Main-owned `webRequest.onBeforeRequest` rule that permits only the current immutable package origin and inventory, navigation/popup restrictions, and runtime teardown. This is defense in depth for the already-supported no-network profile. It is not a domain egress implementation.

**[OFFICIAL]** Electron 44.4.5 exposes URL-oriented request callbacks. `onBeforeRequest` can cancel a request; `onBeforeSendHeaders` may run after TCP connection establishment; `onBeforeRedirect` is observational and may include the IP used for the request; `resolveHost()` returns DNS results but does not document binding them to a later Chromium socket. Electron also documents connection pooling and `closeAllConnections()` for teardown. These APIs do not establish a public, documented pre-connect hook that both authorizes and pins Chromium’s actual destination IP.

**Recommendation:** preserve the existing `network.mode:none` behavior. Keep Gate 4 closed. After human design-freeze review, the next bounded research activity may test feasibility of a Main-owned, connection-bound egress authority applied to the existing isolated Session, potentially via a narrowly scoped in-process loopback CONNECT broker. It must not be a plugin-facing HTTP API or a generic host proxy. This is only a candidate: CONNECT itself lacks scheme/runtime/request identity, and Electron 44.4.5 has not been shown to force every relevant connection through one authority, pin DNS results to the actual socket, prevent proxy/QUIC/preconnect/pool bypass, or revoke all active channels. If any required property cannot be proved, do not ship domains mode.

No design in this document constitutes Gate 4 certification. The current connection-level DNS/IP boundary is **UNPROVEN / BLOCKING FOR GATE 4**.

Phase status remains unchanged: Phase 6E-6 is COMPLETE / CHECKPOINTED; Gate 1 has bounded packaged acceptance evidence, Gate 2 has Native peer authentication, Gate 3 has fail-closed Feature Projection, and Gate 4 remains NOT CERTIFIED. This is not a reopening of 6E-6.

## 2. Existing Runtime / Network Audit

### Current Main and Web runtime path

```text
validated Manifest v2 archive
  → Host package validator + immutable byte snapshot
  → PluginManager resolves persisted plugin identity / version / hash / status
  → Main-created WebFeatureAuthority for one Feature
  → one WebPluginRuntime active generation
  → one WebContentsView attached to existing Manager window
  → dedicated in-memory Electron Session
  → webtools-plugin://<random runtime host>/<validated inventory path>
  → Main protocol handler serves bytes from the current immutable snapshot
```

Network attempts from the WebContents are handled by that Session; there is no plugin-facing `fetch`, `http`, socket, proxy, or IPC-to-network API. Main’s unrelated provider/network work is not delegated to the plugin and is outside the `network.domains` permission. It must remain separate in any future implementation.

### Code audit

| Concern | Current implementation and evidence |
|---|---|
| Session identity | `electron/plugins/web-plugin-runtime.ts:12,45-55,232-289` uses partition `webtools-web-plugin-runtime`, obtained with `session.fromPartition(PARTITION, { cache: false })`. Since it has no `persist:` prefix, it is in-memory. Electron documents that the same partition returns the same Session and that creation options cannot later be changed. |
| Session sharing / reuse | One `WebPluginRuntime` is constructed in `electron/main.ts:566`. It stores one `runtimeSession` and reuses it for subsequent Feature invocations. Each runtime gets a new random 32-hex host/origin (`web-runtime-policy.ts:5-11`), but not a new Session. No other production `webRequest`, `setProxy`, `resolveHost`, `preconnect`, `Session.fetch`, or `net.fetch` use was found under `electron/`. |
| Offline network policy | `web-plugin-runtime.ts:244-255` has the sole production `webRequest` registration found by source search. It cancels every request except a current active `webtools-plugin://` path present in the validated inventory. This rule is implemented for `network.mode:none`; it does not check a domain allowlist or a resolved/connected IP. |
| Custom scheme | `electron/main.ts:55-58` registers `webtools-plugin` before app readiness with `standard`, `secure`, and `supportFetchAPI`; it does not enable `bypassCSP` or ServiceWorker privilege. Runtime content can load the immutable custom origin through `protocol.handle` (`web-plugin-runtime.ts:256-285`). |
| CSP | `web-runtime-policy.ts:13-19` sets `default-src 'none'`, `connect-src 'self'`, `worker-src 'none'`, `frame-src 'none'`, and package-only script/style/font policies. CSP is defense in depth, not the trusted network authority; current `connect-src 'self'` intentionally excludes remote domains. |
| Renderer/process restrictions | `web-plugin-runtime.ts:131-145` creates a sandboxed `WebContentsView` with context isolation, Node disabled, web security enabled, webview disabled, insecure content disabled, and DevTools disabled. |
| Proxy / WebRTC | `web-plugin-runtime.ts:185` sets `disable_non_proxied_udp`; `:288` sets Session proxy mode `direct`. Direct mode is not an allowlist; the request policy and CSP deny requests. This WebRTC option is not proof that every UDP/QUIC/browser transport path is controlled. |
| Permissions / downloads | `web-plugin-runtime.ts:235-243` denies permission checks/requests and cancels `will-download`. |
| Navigation / popup | `web-plugin-runtime.ts:186,292-334` denies new windows and non-package navigation/redirects, blocks login/client-certificate UI, rejects certificate errors, blocks webview attachment, and closes unexpected document navigation or renderer failure. Subresource network access is separately denied by the Session rule. |
| Lifecycle / connections | `web-plugin-runtime.ts:394-435` synchronously sets `active = null` before bridge/view teardown, revokes the authority, then closes the WebContents and calls `closeAllConnections()`, `clearStorageData()`, and `clearCache()` with a five-second cleanup bound. Failure makes the runtime unavailable. This destroys active-view authority before async cleanup, but the connection close happens after up to the bridge’s bounded cooperative grace. With domains currently unsupported this is not an active grant-revocation path; a future network grant should prioritize closing connections immediately after synchronous revocation. |
| PermissionBroker / authority | `permission-broker.ts:21-52` validates existing declarative actions and rate-limits Shared AI; it does not implement network authority. Web Feature authority is separately Main-branded (`web-feature-authority.ts:5-39`). `plugin-manager.ts:279-313` derives package, Feature, requested/granted capability and active intent; only `IMPLEMENTED_WEB_CAPABILITIES` can pass. Network is absent from that set. |
| Persisted network grant | `plugin-registry.ts:10-12,45-46` excludes `network.domains` from grantable v2 capabilities and sanitizes stale persisted grants. `plugin-manager.ts:156,291,363,410,421-438` rejects/inactivates domains mode or direct grant attempts. `plugin-consent-view.ts:14` labels the network capability currently unsupported. |
| Validator contract | `plugin-sdk/declarative-v1/runtime/manifest-v2.mjs:113-143` structurally accepts only the closed v2 `{mode, domains}` object. `none` requires an empty list and no `network.domains` request. `domains` requires the requested capability and 1–16 unique `{host, protocol}` tuples; protocol is `https` or `wss`; canonical lower-case ASCII A-label host is required; wildcard, localhost and IP literal hosts reject. A valid declaration is returned as runtime unavailable. |

**[INFERENCE]** Today’s code has a single effective listener owner. This is important because Electron documents that for each `webRequest` event only the last attached listener is used. Adding an independent module listener later could silently replace the security policy. A future design must keep one listener per event and explicitly multiplex policy decisions from one owner.

### Network state conclusion

- `network.mode:none`: currently supported; prior Phase 6E-4 packaged Gate 1 evidence is relevant to this behavior only.
- `network.mode:domains`: schema-recognized, not grantable, not runnable, no egress authority.
- Gate 4: **NOT CERTIFIED**.
- No live network attack or runtime measurement was performed in this design task.

## 3. Frozen Contract Compatibility

The following existing rules remain binding; this design does not change them:

1. Web Plugins use standard browser APIs, never `sdk.fetch`, `sdk.http`, a WebTools network helper, raw Node/Electron APIs, or an arbitrary IPC route.
2. Main derives authority from the installed validated package, exact package version/hash, enabled/compatible persisted record, active Feature, persisted grant, actual Session/WebContents, and current runtime generation. Renderer claims about identity, origin, domains, grant, generation, or package hash do not authorize traffic.
3. A Manifest declaration is a request, not consent. `network.domains` is unavailable until Gate 4 passes. No stale network grant may be restored automatically.
4. Current runtime uses a random per-invocation app origin and immutable package snapshot. The Session is isolated from Manager’s default Session and non-persistent.
5. `network.mode:none` remains supported independently of Gate 4. It must continue to load package assets, execute declared WASM, and support the existing bridge without outbound network.
6. Existing frozen v2 tuples are `{host, protocol}`. No new Manifest fields, API major, capability identifiers, wildcard syntax, unrestricted mode, per-path allowlist, or port field is designed here.
7. No general Host proxy or plug-in-visible transport facade is introduced.

### Frozen contract reconciliation decisions

1. **Session partition [minimum contract clarification recommended]:** `docs/phase6e2-web-plugin-runtime-contract.md:80` names `webtools-plugin-runtime-v1`; the accepted current implementation uses `webtools-web-plugin-runtime` at `electron/plugins/web-plugin-runtime.ts:12`. Preserve the implementation and clarify the contract to name the observed literal. The Session is dedicated to the Web Plugin runtime, non-persistent, isolated from the Manager's default Session and unrelated product traffic, and must have no accidental consumers outside that boundary. It is intentionally reused by the current `WebPluginRuntime` across sequential runtime generations; this clarification does not claim one Session per plugin or generation. Do not rename code just for consistency. **No source or Phase 6E-2 contract edit is made here; human review is required before any contract change.**
2. **`grantRevision` [equivalence not proven]:** the frozen contract defines a Main-only descriptor containing numeric `grantRevision` (`docs/phase6e2-web-plugin-runtime-contract.md:345-357,372,514-515`). Current `WebFeatureAuthority` has no numeric revision and `PluginRecord` has no such field; current code instead has a Main-only branded authority/ticket, current persisted-record checks, synchronous revocation listeners and runtime-generation invalidation (`web-feature-authority.ts:15-35`, `plugin-manager.ts:80-89,292-310`, `web-plugin-runtime.ts:394-435`). These mechanisms establish several intended checks, but the static evidence does not prove a monotonic revision is equivalent across every queued/asynchronous network-admission race. Do not call this resolved. Before implementation, either prove and test the current semantics against captured asynchronous work, or obtain human approval for the smallest **Main-only, non-persisted authority epoch** clarification: increment it synchronously on grant/package/lifecycle invalidation, capture it with each admission, and reject completion if the captured epoch or runtime generation is stale. Do not add a persisted registry field, grant database, or schema version for this purpose. **No Phase 6E-2 contract or product-code change is made here.**

## 4. Electron 44.4.5 Research Findings

The project lockfile resolves Electron `44.4.5`. The official release page identifies its Chromium as `152.0.7977.130`. Electron exact-tag documentation/source links are used below rather than extrapolating from a different Electron major.

| API / behavior | Officially documented fact | Security consequence |
|---|---|---|
| `session.fromPartition` | Same partition returns the same Session; no `persist:` means in-memory; creation options cannot be changed after first use. [`session.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md) | A partition string is not a per-runtime destroyable object. A random partition per generation may create more Session objects, and the public API does not document Session destruction. Current reuse is real; any move to per-generation Session needs lifecycle/memory evidence and contract review. |
| `cache: false` | Disables the Session HTTP cache option; it does not describe socket-pool destruction. [`session.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md) | Keep cache behavior and connection-reuse behavior distinct. A disabled HTTP cache is not DNS pinning and does not prove there are no reused sockets. |
| `webRequest.onBeforeRequest` | Called when a request is about to occur; callback can cancel or redirect. Details include URL, method, resource type, and optional WebContents/frame fields. `initiatorOrigin` may be absent for browser-started requests and is retained across redirects. [`web-request.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md) | Useful early URL gate, but missing attribution must deny. URL/resource metadata is not the socket’s authenticated remote IP and does not on its own solve DNS rebinding. |
| Listener ownership | Only the last listener attached for a given event is used; `null` unsubscribes. [`web-request.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md) | Security policy needs one central listener per event, one owner, bounded exactly-once callback resolution, and tests proving no later registration replaces it. |
| `onBeforeSendHeaders` | May occur after a TCP connection is made, although before HTTP data is sent. [`web-request.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md) | Too late as the sole SSRF/IP authorization gate. |
| `onBeforeRedirect` | Observer callback; details may include the IP the request was actually sent to, but callback has no cancel parameter. [`web-request.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md) | Useful evidence/telemetry after a request, not a preventative connection control. Do not authorize the current request retroactively. |
| Redirect restart | Electron’s exact-tag URL loader re-evaluates request info when a request is restarted/following redirects. [`proxying_url_loader_factory.cc`](https://github.com/electron/electron/blob/v44.4.5/shell/browser/net/proxying_url_loader_factory.cc) | This supports a design requirement to re-check every target, but real packaged redirects, cached redirects and protocol-specific behavior still need acceptance evidence. |
| `session.resolveHost()` | Resolves a hostname and can use system, DNS, mDNS, cache or other permitted sources. It returns IP addresses. The API does not state that a later Chromium connection is bound to the returned addresses. [`session.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md) | A separate preflight lookup is vulnerable to time-of-check/time-of-use; it is not IP pinning. |
| `closeAllConnections()` | Resolves when Session connections are closed and terminates/fails in-flight requests. Proxy changes may require it so pooled sockets do not reuse the previous proxy. [`session.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md) | Useful for teardown, not the allowlist itself. Must be tested with active fetch, response body, WebSocket, pooled HTTP/2, and revoke races. It can interrupt all traffic within this shared Session. |
| `preconnect` | Session can preconnect; Electron emits a `preconnect` event for renderer resource hints. The event API has no documented deny callback. [`session.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md) | Whether resource-hint preconnect can create sockets outside an enforceable `onBeforeRequest` decision is **UNKNOWN** and must be tested. Do not count an observer event as prevention. |
| Proxy config | Modes include `direct`, `system`, auto-detect/PAC and fixed servers. Proxy rules can contain failover to `direct://`, and bypass rules can exclude hosts or addresses. [`proxy-config.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/proxy-config.md) | A candidate broker must have no PAC/system fallback, no `direct://`, no bypass, and must test implicit localhost/internal bypass behavior. Config text alone is not evidence every transport is forced through the broker. |
| `webSocket` | `webSocket` is an Electron WebRequest resource type; implementation maps it to the WebRequest type. [`web-request.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md), [`electron_api_web_request.cc`](https://github.com/electron/electron/blob/v44.4.5/shell/browser/api/electron_api_web_request.cc) | The handshake is request-policy material; after upgrade, long-lived frames require channel teardown, not only request admission. Verify both `wss` and denial of `ws`. |
| `clearStorageData` | Storage types include cookies, IndexedDB, local storage, service workers, CacheStorage, etc. [`session.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md) | Current cleanup can erase prior runtime site data. There is no documented `Session.destroy()` method; a reused Session remains a lifecycle object. |
| Custom scheme | Privileges are explicitly enabled by setting their boolean flags to true. Current app sets standard/secure/fetch only; it does not set `allowServiceWorkers` or `bypassCSP`. [`protocol.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/protocol.md) | Current ServiceWorker path remains denied by the scheme configuration and CSP. Do not infer a future enabled Worker’s behavior from ordinary `fetch`. |
| WebRTC IP policy | `disable_non_proxied_udp` does not expose public/local IPs and should use TCP unless a proxy supports UDP. [`web-contents.md`](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents.md) | It reduces WebRTC exposure but is not proof that all UDP, QUIC, proxy UDP, or non-WebRTC egress is impossible. |
| Chromium build | Electron release record maps v44.4.5 to Chromium `152.0.7977.130`. [Electron Releases](https://releases.electronjs.org/release/v44.4.5) | Packaged Gate 4 must record the actual packaged executable/version; tests against another Electron/Chrome build do not certify this baseline. |

Official references: [Electron 44.4.5 release](https://releases.electronjs.org/release/v44.4.5); exact tag [Session](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md), [WebRequest](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md), [ProxyConfig](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/proxy-config.md), [Protocol](https://github.com/electron/electron/blob/v44.4.5/docs/api/protocol.md), [WebContents](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents.md), and [WebRequest implementation](https://github.com/electron/electron/blob/v44.4.5/shell/browser/api/electron_api_web_request.cc).

## 5. Network Threat Model

The table distinguishes what current code does from what a future Gate 4 must prove. “Same Session” below means the plugin Session. It does not imply that a particular event is always present or that the final remote IP is known.

| Path | Plugin-triggered / current Session | Observe / prevent before effect | Authoritative layer and bypass concern | Gate 4 evidence / fail-closed rule |
|---|---|---|---|---|
| `fetch()` / XHR | Yes; normal renderer requests use its WebContents Session. Current policy cancels non-package URLs. | `onBeforeRequest` can cancel by URL; `onBeforeSendHeaders` may be after TCP. Exact destination IP is not exposed there. | Main-owned policy plus connection-level gate. Main-world code cannot be trusted with an allow decision. | Test HTTPS allowed/denied, OPTIONS preflight and DNS destination. Unknown identity, host, scheme, port or socket mapping: deny. |
| EventSource | Yes; browser network stream; current CSP and request rule deny remote requests. | Expected to use Session request policy, but current product has no positive domains test. | Same URL/connection authority as fetch; long stream must be aborted at revoke. | Packaged connection capture, redirects and revoke during an open stream. On uncertainty, deny. |
| WebSocket / WSS | Yes; current rule denies remote handshake. Electron reports `webSocket` type. | Handshake is observable as request metadata; established frames are not new WebRequest events. | Request gate plus connection ownership/close. `ws` must remain denied. | Test WSS allowed only for exact tuple, `ws` denied, connection closed on revoke and Manager close. Missing channel identity: deny. |
| Dedicated/shared/module Worker fetch | Current `worker-src 'none'` prevents Worker creation; no positive network support. | If later enabled, browser requests should remain in Session, but optional frame/WebContents attribution and worker lifecycle need packaged proof. | Same generation-bound connection authority; do not accept worker-supplied identity. | Current acceptance expects Worker creation denied. Enabling any Worker is a frozen-contract change; re-review and test identity, fetch, crash, termination and revoke before enabling. |
| ServiceWorker fetch/background sync | Current CSP says `worker-src 'none'`; scheme registration omits ServiceWorker privilege; close clears the serviceworkers storage type. | No current intended registration path. A worker may outlive a page if later permitted; session API does not provide an obvious “disable all workers” request gate. | Keep ServiceWorkers disabled for the first Gate 4 design. If ever enabled, separate security/lifecycle design is required. | Test registration, old controller/script, fetch, restart, update and revoke. Any registration/control in current profile is failure. |
| iframe / frame resources | Current `frame-src 'none'`; runtime navigation policy rejects non-package frame navigation; all non-package requests are denied. | CSP is first layer; WebContents navigation handlers and Session rule are additional layers. | Do not create cross-origin browsing contexts in the first Gate 4 slice. | Attempt nested frame and frame-based request; verify no subframe or external packet. Fail closed. |
| Script / module / dynamic import | Current script policy is package `'self'`; unlisted/external URLs also fail Session check. | CSP and `onBeforeRequest`; static and dynamic import remain package inventory constrained. | Do not widen `script-src` to allowed network hosts. Network grant must not silently grant remote code execution. | External `<script>`, import map and dynamic import remain denied, including from a granted API domain; no external code executes. |
| CSS / image / font / media | Current CSP admits only package assets plus explicitly bounded data images; Session denies external requests. | CSP may stop common loads; Main request rule is the Host boundary. | Recommended initial Gate 4 exposes domains only through `connect-src`; do not expand other resource directives without a separate requirement/review. | Try CSS `url()`, image, font, audio/video, preload; no network unless a separate later contract authorizes that class. |
| Main-frame / subframe navigation | Current handler denies non-package URLs. | `will-navigate`, `will-frame-navigate`, `will-redirect`, and Session rule. | Network permission is not navigation permission. | Attempt external navigation and `target=_blank`; require no new BrowserWindow and no external navigation. |
| `window.open` / popup | Yes, but current window-open handler denies. | Main receives synchronous window-open decision; no target load. | Keep denied; `external.open` is a different future Host action, not a browser navigation exception. | Popup and link-target tests create no new WebContents/window and make no request. |
| Download | Yes; current Session `will-download` cancels. | Electron event cancels before write. URL network request may separately be denied. | Keep all plugin downloads denied initially; do not let a domain grant imply file write. | Check no save dialog/file/temp artifact and no completed transfer. |
| HTTP redirect | Current remote HTTP denied; package protocol cannot redirect outside active inventory. | Electron source re-enters `onBeforeRequest` on request restart, but redirect policy itself is not a `onBeforeRedirect` cancellation callback. | Re-parse and authorize every target from scratch; never inherit previous allow. | Test same-host, cross-host, HTTP→HTTPS, credentials, downgrade, IP target. Any target not independently approved is cancelled. |
| HTTPS redirect | Current external HTTPS denied. | URL loader source indicates the restarted target is seen by `onBeforeRequest`; `onBeforeRedirect` only observes and may expose the prior server IP. | New target must satisfy exact scheme/host/effective-port tuple and connection pinning. | Test allowlisted→unlisted, allowlisted A→allowlisted B, loops, redirect through public/private DNS. One unauthorized hop is a Gate failure. |
| DNS rebinding | Plugin can address an allowlisted hostname; current mode blocks all network. | `resolveHost` can return addresses, but no public API ties them to Chromium’s later socket; `onBeforeRedirect.ip` is post-request information. | Enforce at the socket/connect authority, not by preflight URL+DNS. | A controlled DNS fixture must alternate public/private answers and record actual destination for every socket/retry. Any private connection or unprovable socket is Gate 4 failure. |
| localhost / loopback / private / link-local | Plugin can form such URLs; current Session rule denies external URLs. | Host labels like `localhost` reject at Manifest validation; aliases resolving to local IP do not. URL filtering alone cannot catch DNS aliases. | Resolve at the connection authority and deny loopback, private, link-local, unique-local, multicast, unspecified, reserved and any non-public destination. | Test IPv4/IPv6 addresses, host aliases, mixed public/private DNS, hosts file and local services. Any local packet is a blocking failure. |
| Direct IP / alternate numeric IPv4 | Manifest rejects IP literals, but runtime may request IPs/odd numeric forms. | Exact hostname matching prevents a direct literal tuple, but canonicalization must occur before any connect. | URL canonical parser plus resolver/pinned connect; do not rely on string matching. | Test dotted forms, integer/octal/hex forms, encoded hosts and redirect forms. All direct/numeric IP destinations denied. |
| IPv6 / IPv4-mapped / zone ID | Manifest host validation rejects literal IPs; future URLs/answers can still be IPv6. | URL layer may normalize some forms; `resolveHost` may return AAAA. | Connection guard classifies binary addresses, rejects mapped IPv4, zones and non-public/special prefixes. | Test `::1`, link-local, ULA, mapped, NAT64/transition and mixed A/AAAA. Any private/special target denied. |
| Proxy / PAC / system proxy / bypass | Current Session is `direct`; OS proxy does not authorize a plugin domain. | `setProxy` controls Session behavior; Electron offers system, PAC, fixed, direct and bypass/fallback syntax. Actual Chromium route must be observed. | Candidate broker config must be fixed-only, no PAC/system, bypass or direct fallback; do not leak credentials. | Test environment PAC/system proxy, proxy unavailable, bypass host, proxy auth, localhost and scheme-specific rules. No unapproved route or silent fallback. |
| Preconnect / speculative DNS or sockets | Renderer can express resource hints; Electron emits a Session `preconnect` event, but no cancellation callback is documented. | Whether `webRequest` sees a request before a preconnected socket exists is **UNKNOWN**. | Treat any unapproved socket attempt as denied at the network boundary; never rely only on resource policy callbacks. | Trigger `<link rel=preconnect>`, DNS-prefetch, preload, speculative navigation, and Chromium preconnect API. Capture packets/sockets and prove allow/deny behavior. |
| HTTP cache / service cache | Current Session has `cache:false`; cleanup clears CacheStorage and service worker state. | `fromCache` is observable on later-stage callbacks, not an authorization decision. Requests may reuse pooled connections; proxy changes may require `closeAllConnections()`. | Re-check current authority on every logical request even on cache hit; force connection teardown on revoke. | Warm cache, connection reuse, HTTP/2, alt-svc/HTTP3, in-flight body, and same Session next generation. Ensure no old authorization revives. |
| WebTransport / other browser transports | Current Manifest tuple vocabulary has only HTTPS/WSS and current runtime supports no domains mode. Electron’s WebRequest resource-type list does not document `webTransport`. | Whether this Chromium API is available to the WebContents, whether it uses a cancellable Session hook, and whether it can open UDP/QUIC without the expected request event are **UNKNOWN**. | No transport permission is implied by HTTPS/WSS; keep unsupported unless a distinct reviewed contract and connection-level control cover it. | Probe only in a later packaged Gate 4 test. If it is reachable but not attributable/blocked, it blocks Gate 4; do not silently broaden tuples. |
| CORS preflight | Browser may create OPTIONS before the actual cross-origin fetch. Current policy denies remote requests. | Session sees request flow if Chromium emits it; positive interception behavior is not yet certified. | Apply same domain/protocol/port and destination checks to OPTIONS; keep browser CORS enabled. | Test allowed and denied preflight with normal CORS headers. Host must not synthesize ACAO or bypass CORS. |
| Main/Node/Electron initiated request | Not available to plugin under current sandbox; Main has separate first-party services. | Plugin Session WebRequest is not a universal monitor for Main Node fetch or arbitrary process networking. | No Host generic fetch/network bridge; any separate explicit capability remains separately authorized and must not consume `network.domains`. | Static/API surface test plus process/network attribution test ensures a plugin cannot reach Main network APIs. |

## 6. Domain Matching Contract

The implementation must consume only the existing Manifest v2 representation validated by `manifest-v2.mjs`; no schema widening is authorized.

### Frozen inputs and exact decision

1. Manifest list: 1–16 unique `{ host, protocol }` tuples, where `host` is canonical lower-case ASCII IDNA A-label and protocol is only `https` or `wss`.
2. For a request, use a standards-compliant URL parser before any policy decision. Reject malformed/ambiguous URLs, credentials (`username` or `password`), unsupported schemes, invalid ports and non-canonical host forms. Never use `includes()` or `endsWith()`.
3. Normalize the request hostname using the same canonical IDNA A-label model as the Manifest. Lower-case it. A Manifest value itself remains ASCII only; Unicode U-label text is not added as a new accepted schema form.
4. Exact equality only: `api.example.com` does not authorize `example.com`, `sub.api.example.com`, `api.example.com.evil.test`, or another tuple’s host. No wildcard and no implicit subdomain inheritance.
5. Match protocol independently: `https` does not imply `wss`, and neither implies `http` or `ws`.
6. Effective destination port is exactly 443. The schema has no port field; explicit `:443` is equivalent to default port 443, while any non-default port rejects.
7. Reject IP literal hosts and alternate numeric forms. DNS names that resolve to a non-public address reject at the connection authority even when their text exactly matches an approved hostname.
8. A trailing dot is not canonical under current Manifest validation. The runtime should reject it rather than silently treat a second spelling as equivalent.
9. Redirects and retries are new authorization decisions. Do not carry an allow result to the new URL. Reject HTTP downgrades, unlisted destination hosts, credentials, private target IPs and non-443 ports.
10. CORS remains the browser’s responsibility. A user grant only permits a network destination; it does not authorize cross-origin response reading.

### Unicode, IDNA and public suffixes

The existing validator uses Node `domainToASCII()` and requires the Manifest input already equal its normalized ASCII form. Its runtime contract is lowercase IDNA A-labels; `bücher.example` must be declared as `xn--bcher-kva.example`. Request URLs must be canonicalized compatibly before exact comparison. Any Electron-vs-Node IDNA discrepancy is an acceptance case, not an assumption.

Wildcard and subdomain grants are prohibited, so public-suffix data is not needed to prevent `endsWith()`-style cross-boundary matching. The current validator does not consult the Public Suffix List and the frozen contract does not explicitly reject a literal host that happens to be a public suffix. Do not add a PSL dependency or new rejection rule in this phase. If product policy intends to ban such exact hosts, settle that separately before implementation; it is not a wildcard exception.

## 7. DNS / IP / SSRF Security

### Proven facts and gap

- **[OFFICIAL]** `ses.resolveHost()` performs name resolution and returns addresses. Its results may come from cache, OS, DNS, mDNS or other sources. The API does not document that a subsequent Chromium request reuses or pins that result.
- **[OFFICIAL]** `onBeforeRequest` identifies the request URL; `onBeforeSendHeaders` may happen after TCP is made. `onBeforeRedirect` may report the IP already used for the prior request and cannot cancel it.
- **[CODE]** Current runtime uses `setProxy({ mode: 'direct' })` and no `resolveHost()` call. It denies non-package URLs entirely.
- **[INFERENCE]** `resolveHost(host) → validate IP → allow Chromium URL` has a TOCTOU gap. Chromium may perform or consult a different resolution, use a cached answer, proxy-resolve the name, retry with another address, or reuse a socket. The current public API evidence does not rule these out.

Therefore: **DNS/IP connection authorization is UNPROVEN / BLOCKING FOR GATE 4.**

### Required connection invariant

For every new physical outbound connection attributable to a plugin request:

1. Main owns the active immutable runtime identity and current persisted authorization; renderer input never supplies the decision.
2. The URL is parsed and canonicalized; scheme/host/effective port match one exact granted tuple.
3. Resolver answers are collected under a known policy for both A and AAAA. If any answer is private, loopback, link-local, unique-local, multicast, unspecified, reserved, mapped, transitional/otherwise prohibited, or cannot be classified, deny the whole connection attempt. Do not accept the “good” address from a mixed public/private answer set.
4. The socket connects to one of the validated numeric public addresses without a second hostname resolution. TLS certificate validation and SNI continue to use the original approved hostname; certificate checks are never disabled.
5. Retries, redirects, proxy tunnel establishment, alternate protocols, pool reuse and reconnection each remain bound to the current authority. Reused sockets cannot revive a revoked generation.
6. The real connected destination is captured at a trusted boundary, not inferred from DNS preflight or request URL. Failure to observe/attribute a socket is a deny and a failed acceptance case.

Address classification must have an explicit source and update policy. IANA’s [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) Special-Purpose Address Registries distinguish globally reachable blocks from special-use ranges; “not RFC1918” is not a sufficient public-address test. Whether to reject any mixed set, DNS aliases, NAT64/6to4/Teredo and all non-globally-reachable allocations must be encoded in reviewed policy and tested against the current registry. Do not hand-wave an incomplete CIDR list as complete SSRF protection.

### Candidate connection controls (not yet proven)

- **Main-owned loopback broker candidate:** an internal-only component in the existing Electron Main, reached only through a dedicated Session’s fixed proxy configuration. It accepts only HTTPS CONNECT and WSS-compatible tunnel requests on 443, parses/canonicalizes the requested authority, resolves/checks A+AAAA itself, connects using the validated numeric IP, and leaves TLS end-to-end in Chromium using the original hostname. It has no SDK method, general-purpose relay, arbitrary port, raw tunnel, credential forwarding, or Main-window access. This avoids a new resident process, but is viable only if Electron can be forced through it without direct, PAC/system, implicit bypass, QUIC/UDP, speculative connection, WebRTC, pool or protocol escape. Electron’s proxy API documents failover and bypass mechanisms; config alone does not prove those escapes absent. **No feasibility proof exists.**
- **OS/process firewall candidate:** a per-process egress block is valuable defense in depth, but Electron Main also performs first-party network work and process identity does not by itself express per-plugin domain grants. A Windows Filtering Platform rule set or app-container boundary would need separate capability/identity infrastructure and has elevated maintenance/packaging risk. It may be appropriate only if it can isolate the plugin network path without breaking unrelated Manager/Main behavior; no such design is proven here.
- **Chromium network-stack/Embedder patch candidate:** a connection/resolver hook could provide the strongest binding point while retaining standard browser APIs, but maintaining a custom Electron/Chromium fork and security backports is a large build/release obligation beyond the approved small runtime. Do not select without a separate maintenance case.

## 8. Worker / Service Worker Policy

**Current fact:** `worker-src 'none'` rejects Worker creation; `webtools-plugin` does not enable ServiceWorker privilege; prior Phase 6E-2/Gate 1 contract requires Worker/SharedWorker/ServiceWorker denial; Phase 6E-4B packaged offline evidence recorded ServiceWorker rejection. Current runtime clears the ServiceWorker storage type on teardown. No Worker behavior was re-tested in this task.

**Preserve browser capability where safe:** ordinary Dedicated/Module Workers are desirable for CPU-bound work, WASM and conventional web app architecture. However the frozen runtime contract currently prohibits Worker and SharedWorker creation. Enabling them is a contract/behavior change requiring separate Human Design Review and a new Gate 1 compatibility decision; it must not be slipped into 6E-7 implementation. If later approved, first evaluate Dedicated Worker support under the same runtime Session, origin, package snapshot, generation and network authority. Any missing request identity is deny. Prove worker termination at runtime close, request cancellation on revoke, and no cross-generation reuse.

**ServiceWorker:** keep disabled for the first domains slice. Its background/persistent registration and controller lifecycle can outlive a page’s active code, making per-Feature network authority and revocation substantially harder. Reconsider only after a separate design proves registration scope, update/script fetch, fetch-event network forwarding, process termination, storage cleanup and restart behavior all remain generation-bound. No general `worker-src` relaxation is recommended here.

## 9. Runtime Identity / Authority

The future request decision must be derived in Main and, where possible, at the connection-opening boundary:

```text
Host-validated immutable package snapshot
  → exact installed plugin id + version + package hash
  → enabled + compatible current persisted record
  → requested network.domains declaration
  → explicit current persisted user grant for exact tuple set
  → active validated Feature and required capability
  → current runtime generation and non-revoked authority
  → current Session + exact WebContents / frame / runtime origin
  → canonical URL + allowed protocol / host / port
  → connection-bound egress decision + actual destination IP
```

Do not accept plugin-controlled `pluginId`, `featureId`, package hash, `grantRevision`, generation, origin, allowed domain list, URL authority, proxy, or connection result as evidence. `details.webContentsId`, `frame`, and `initiatorOrigin` are optional in Electron’s API; browser-started requests may lack `initiatorOrigin`. A missing/ambiguous origin or current runtime mapping must not inherit the last request’s identity. If the chosen network boundary cannot identify the originating runtime reliably for a connection, domains mode cannot be certified on the shared Session.

**CONNECT identity limitation:** an HTTP `CONNECT` authority exposes only a target `host:port`. By itself it cannot establish whether Chromium's originating URL was HTTPS or WSS, identify the `WebContents`, FeatureRef, runtime generation, grant revision/authority epoch, or correlate the tunnel to a particular Chromium request. Therefore, a broker must not authorize a tunnel by looking up whichever runtime happens to be current when the CONNECT request arrives. A trusted request-to-connection association is a prerequisite, not an implementation detail that can be inferred from host/port.

The required race behavior is explicit: Runtime A is synchronously revoked; an A CONNECT remains queued or in flight; Runtime B is created; then A's late CONNECT reaches the authority. The late request must retain A's captured identity and be rejected as stale. It must never be rebound to B's current grant. A generation-bound endpoint/admission token, trusted request-to-connection correlation, strict proxy-configuration lifecycle, and Session-wide teardown are candidate controls only. A Session teardown is useful defense in depth but does not alone prove the identity of a late request. A shared listener that resolves identity from mutable “current runtime” state is insufficient. If identity cannot be carried and checked at the admission boundary, deny the connection and keep domains unsupported.

If a shared Session/proxy configuration is retained, the transition must also prove its ordering: synchronously revoke A; invalidate/cancel A's queued admissions; close A's Session connections; establish and verify the intended B proxy/admission configuration; only then make B eligible. Electron's asynchronous proxy configuration and reused Session behavior must not allow a late A request to be interpreted under B's settings. This sequence is a feasibility hypothesis to test, not a proven guarantee.

HTTPS and WSS must be distinguished by trusted URL/request policy correlated to the actual connection authority. CONNECT's `host:port` cannot make that distinction. An HTTPS grant must not authorize WSS, or vice versa. If the correlation does not reliably identify the originating scheme and authority epoch, deny the connection.

The tuple decision must also distinguish requests from plugin WebContents from unrelated Manager or Main requests. A dedicated Session is a useful containment boundary, not a substitute for checking current runtime state. No cross-plugin access is allowed. The same URL is denied if the installed record changed or a newer runtime generation replaced the one that originally requested it.

## 10. Grant / Revocation Lifecycle

### Grant model (after Gate 4 only)

- Use the existing plugin-wide capability grant. The complete canonical `{host, protocol}` tuple set declared by the installed Manifest is authorized as one all-or-nothing grant. The UI may list tuples individually for clarity, but it must not offer independent per-domain grants.
- Install validates and records requested tuples but grants none by implication. Consent applies to the complete tuple set for the exact currently installed package identity, version, package hash and Manifest tuple set. At runtime, authority is additionally bound to the current Feature/runtime generation and Main-owned authority epoch; a stale generation or epoch cannot borrow a valid package grant.
- Any package update revokes the previous `network.domains` grant unconditionally, including an update whose tuple set is byte-for-byte identical. The replacement package needs fresh user confirmation. Do not use Phase 6E-6 same-format ordinary grant retention to carry a network grant across package updates.
- Removing scope, disabling, uninstalling, replacing the package or revoking consent invalidates old authority synchronously. Never reconstruct an old grant from the Manifest after restart.
- Do not add a grant database, Manifest field, registry version or persisted `grantRevision` for this model. Reuse the existing plugin-wide grant lifecycle only if it can enforce the above package binding and unconditional update revocation; otherwise stop for a separately reviewed contract/schema decision rather than silently weakening the requirement.

### Revocation ordering

Revocation must synchronously invalidate the current runtime authority before waiting on storage, dialogs, renderer shutdown, broker cleanup or persistence. Every pending network admission must carry the identity/epoch it captured when queued; resolving against a later “current” runtime is forbidden:

1. Mark old runtime generation ineligible; remove it as current; reject all future requests from that generation.
2. Cancel queued/pending broker decisions; abort in-flight fetch/response bodies and close WebSocket/EventSource connections; stop permitted Workers; prevent connection-pool reuse.
3. Close all sockets for the relevant Session and clear ephemeral site state. With one shared Session this is session-wide, so ensure no other product traffic shares it.
4. Await bounded cleanup; if cleanup fails or cannot prove old sockets are closed, keep network unavailable and do not reopen under the same authority. Never use a fixed delay as proof.
5. On new runtime, bind a fresh generation and exact current grant snapshot. Old views, handles, bridges, sockets and cached grants cannot regain authority.

Closing a channel cannot undo bytes already delivered to the remote server. The acceptance claim is that revocation synchronously blocks new authorization and promptly terminates pending/established client-side channels before any replacement runtime is granted; it is not a claim that a remote side effect can be reversed.

Current runtime close already revokes active identity before WebContents teardown, then performs Session cleanup. For a future network grant, move `closeAllConnections()` to the first bounded teardown work after synchronous revocation (not after a cooperative bridge grace), and prove exact behavior against fetch body streams, redirects, WebSocket, DNS wait, pool reuse, renderer crash and Manager close.

## 11. CORS / CSP Compatibility

- Do not disable `webSecurity`, CORS, certificate checks or mixed-content protections. Do not add wildcard CORS response headers or alter server responses to make plugins “work.” A Host network grant does not bypass CORS.
- Plugin origin is `webtools-plugin://<random-host>`, not the HTTPS endpoint’s origin. Ordinary `fetch()` remains subject to CORS. A server that only allows a fixed HTTPS origin may reject this dynamic custom origin; that is a web compatibility limitation to disclose, not a reason to spoof origin or bypass CORS.
- Current CSP has `connect-src 'self'`, appropriate for offline mode. A future domains profile would need a Main-built `connect-src` restricted to exact approved HTTPS/WSS hosts and `:443`, but CSP only mirrors the egress allowlist; it does not replace the connection authority.
- Keep `script-src 'self'`, `worker-src 'none'`, `frame-src 'none'`, `object-src 'none'`, `form-action 'none'`, and current navigation restrictions for an initial API-network slice. Do not allow remote scripts/styles or frames merely because a domain tuple was approved; remote code can execute with the plugin document’s host bridge authority.
- CORS preflight `OPTIONS` must pass through the same host/protocol/port and destination checks. Browser preflight behavior, cookies/credentials and custom-origin semantics require packaged tests; no credential forwarding or user proxy authentication is permitted.
- If a normal fetch fails CORS, surface the browser error; Host should not return a synthetic success or expose raw network internals through a new SDK API.

## 12. Permission UX

No UI grant is authorized before Gate 4 certification. Current UX correctly labels this capability unsupported.

After certification and separate implementation approval, show a permission section such as:

```text
Network access requested
  HTTPS  api.example.com:443
  WSS    events.example.net:443
```

Display exact normalized A-label or a safely rendered Unicode display label with the canonical A-label available to inspect; do not use the display form for matching. Explain that domains are exact hosts, subdomains are not included, redirects need another listed host, browser CORS still applies, and local/private/IP endpoints are denied. Avoid vague “internet access” copy.

Grant/revoke is one plugin-wide, all-or-nothing action for the entire exact tuple set, bound to the current installed package identity, version and hash, the Manifest tuple set, and the active Main-owned runtime generation/authority epoch. The UI may enumerate tuples but cannot independently grant one. Every package update revokes the old network grant, even when the tuple set is unchanged; the updated package needs fresh confirmation. Phase 6E-6 same-format grant retention must never preserve `network.domains`. Revocation closes the current runtime and active network channels, then requires explicit re-invocation. Never restore a stale grant after registry repair, downgrade, reinstall or restart. The Manager must not suggest that a declaration itself authorizes use.

## 13. Architecture Alternatives

| Alternative | Unauthorized URL control | DNS/IP binding | Worker / SW | WebSocket / redirects | Revoke | Electron 44.4.5 / compatibility | Cost / extra process / Thin SDK |
|---|---|---|---|---|---|---|---|
| **A. Session `webRequest` + CSP** | Good URL-level deny/allow before request callback; one listener owns the decision. CSP duplicates destination limits. | **No proven IP pin.** `resolveHost` is separate; `onBeforeSendHeaders` may be after TCP; `onBeforeRedirect.ip` is observational. | Shares Session hooks if worker requests reach them, but current policy forbids workers; ServiceWorker not certified. | URL callback plus recheck on restart; WebSocket handshake visible but channel needs explicit teardown. | `closeAllConnections()` and runtime revoke help; no IP authority. | Public APIs available, standard APIs mostly retained, but inadequate for SSRF/DNS-rebinding guarantee alone. | Lowest implementation cost and no new process. Compatible with Thin SDK. **Not sufficient for Gate 4.** |
| **B. Stricter Session lifecycle / fresh partition per runtime** | Reduces state/pool sharing and narrows one runtime’s requests. Still needs A or C for network decisions. | **No new IP binding**; a fresh Session can still resolve/connect to private DNS answers. | Helps make Worker/ServiceWorker teardown isolateable but does not prove worker requests are attributable or stopped. | Fresh Session may simplify socket closure; API docs do not expose Session destruction, and same partition is reused. | Better separation if Session is truly retired, but in-memory objects and cleanup lifetime need measurement. | Electron fromPartition is available; per-generation partitions diverge from the frozen single reused Session design and can accumulate objects. | Medium/high lifecycle complexity and possible memory cost; no new process; SDK stays thin. Not a standalone solution. |
| **C. Connection-bound egress authority** (candidate: internal Main loopback CONNECT guard; alternatives: OS/network-stack enforcement) | Can deny at the actual outbound connection point if Chromium cannot bypass it. | **Potentially yes** only if it resolves+filters+connects to the validated numeric IP itself and preserves TLS hostname validation. Must prove all socket paths. | Workers would need to share that path; current contract denies them. Keep ServiceWorker disabled. | Each new CONNECT/redirect/reconnect must be authorized; WebSocket must tunnel through same authority; pooled/coalesced connections need real tests. | Authority revokes synchronously and closes owned client sockets; proof required for in-flight tunnels. | No documented Electron public API exposes a general “connect to this validated IP for this Chromium request” hook. Fixed proxy APIs exist but bypass/fallback/QUIC/speculation must be eliminated and tested. OS/firewall approaches can overrestrict Main. | Highest complexity/maintenance and some latency. An in-process narrowly-scoped broker adds no resident process but is unproven; an OS component or Chromium fork has substantial deployment cost. It can keep SDK thin and standard browser fetch if all egress is forced through it. |

The alternatives compare security properties, not completed implementations. No measured latency or memory figures are available or invented.

## 14. Recommended Architecture

### Decision now

1. Retain `network.mode:none` as the only executable Web Plugin profile.
2. Keep `network.domains` structurally recognized but ungrantable/inactive; do not restore stale grants.
3. Keep the existing Session/CSP/request policy and Gate 1 behavior unchanged. No Gate 4 implementation or network attack testing is authorized by this design clarification.
4. Do not enable production network grant UI, add a proxy, change `setProxy`, change Session lifetime, alter CSP, or modify Manifest/API contracts here.
5. The next bounded technical activity, if separately authorized after human design freeze review, is **Phase 6E-7 — Bounded Connection-Egress Feasibility**, not full network implementation.

### Next bounded feasibility decision gate (not implementation authorization)

Use a small, deterministic and isolated packaged proof to answer all of these questions without weakening the requirements:

1. Can Chromium be reliably forced to use one trusted egress authority for every in-scope request?
2. Can direct, system/PAC, implicit bypass, fallback and other proxy-bypass routes be excluded and observed?
3. Can the trusted egress resolve DNS, reject non-public/special results and bind the validated numeric result to the actual socket without a second lookup?
4. Can HTTPS and WSS be authorized independently despite CONNECT exposing only `host:port`?
5. Can the actual connection be bound to the originating WebContents/Feature, package identity, grant authority epoch and runtime generation?
6. Can revoke synchronously deny new admissions and close pending/established old-generation connections before a replacement generation is admitted?
7. Can QUIC/UDP, WebRTC, preconnect/speculative connections, DNS prefetch, pooling/coalescing and other alternate paths be proven blocked or routed through the same authority?
8. Can normal browser `fetch()`/XHR and standard browser CORS behavior be retained without adding a plugin-facing network helper?
9. Does the candidate affect Manager-owned traffic or other Electron Session behavior?
10. Does it require an additional resident process or platform component? If so, stop and return that architecture/cost decision for human review; this phase does not authorize it.

The leading hypothesis remains a Main-owned internal loopback CONNECT guard, but its generation/authority/request association is **unproven** and CONNECT alone is insufficient. Other mechanisms may be compared only as bounded feasibility candidates. No candidate is selected as production architecture. A host HTTP helper or generic proxy API is not an acceptable fallback. If any required identity, routing, DNS/socket or revocation property cannot be proven, keep Gate 4 not certified and domains unsupported.

## 15. Implementation Boundaries

Any later approved implementation must remain a separately approved phase. Before it, bounded feasibility must establish whether the trusted egress boundary is technically possible. Any implementation should limit code changes to the smallest surfaces needed for that boundary, Main-derived network permission state, and focused packaged validation. It must preserve:

- existing NativeHost + on-demand Manager process architecture;
- one Manager and at most one active Web Feature view;
- Main-owned verified package snapshot and capability authority;
- random runtime origin and no Node/Electron privileges in plugin Renderer;
- no new long-lived process, no second Manager, no generic proxy, no plugin network SDK method;
- existing Manifest v2 `{mode, domains:[{host,protocol}]}` and supported contract, unless a separately approved design revision is necessary;
- all `network.mode:none` functionality, local bundle loads, WASM under declared CSP, bridge and cleanup;
- no CORS bypass, TLS verification bypass, credentials, arbitrary port, HTTP/WS, raw TCP/UDP, file access, downloads or external navigation;
- no stale grant restoration, and synchronous old-generation revocation before async work.

If these constraints cannot be met without a large architecture shift, new dependency, OS service, Chromium fork, or breaking frozen Worker behavior, stop implementation and present the smallest alternative for review. Do not broaden scope to make a Gate pass.

## 16. Gate 4 Acceptance Matrix

Gate 4 is a future packaged acceptance gate, not work performed here. Every PASS below requires the exact packaged Electron build and a disposable TEMP `userData` profile; no production profile, SecretStore, AI token, real Favorites, or installed `D:\webtools` directory may be touched. Use a controlled test hostname, controlled DNS responses and a controlled **public HTTPS/WSS endpoint**, or an appropriately isolated network fixture that still provides trustworthy evidence of a real public destination. A localhost/private endpoint may be used for negative/bypass probes only; it must never be represented as a public positive target. Capture DNS answers, packet/socket destination and endpoint logs, and bind them to exact packaged process/runtime identities. Tests are bounded and deterministic, not open-ended fuzz or soak.

Positive acceptance must independently establish: a real HTTPS or WSS exchange; a valid certificate for the approved hostname; normal browser CORS behavior; the approved public IP answer; that the validated DNS answer was bound to the actual connection; and the actual socket's remote destination. Missing socket or packet attribution is NOT VERIFIED, not a positive result. If the environment cannot reliably provide this evidence, mark the positive case BLOCKED / NOT CERTIFIED.

Any grant used only to exercise positive Gate 4 cases must be an **acceptance-only grant** available solely in an explicitly isolated acceptance mode/build with disposable `userData` and Phase 6E-3-validated test packages. It must not write or mutate production user grants, must not add a production Manager network-grant UI, must not be triggerable by ordinary plugins, and must still derive package/Feature/WebContents/Session/runtime/generation/authority-epoch identity in Main. It must not create a production backdoor or bypass the authority under test. If that separation cannot be proved, do not run the positive grant cases.

| Group | Case / evidence required | Pass condition |
|---|---|---|
| Build identity | Packaged executable version/hash, Electron 44.4.5 and Chromium 152 version; isolated profile/install root; NativeHost pipe identity | Evidence binds every result to the actual shipped packaged binary and isolated test environment. |
| Acceptance-only grant | Explicit isolated acceptance mode, disposable TEMP `userData`, exact validated test package and Main-derived identity; no production grant UI or grant storage | Positive-test authority cannot be invoked by an ordinary plugin or leak into production user permissions; identity and generation checks remain enabled. |
| `network.mode:none` preservation | Local package files, bridge, manifest-declared WASM compile/instantiate, browser Web APIs; captured IPv4/IPv6/UDP/QUIC/WebRTC egress attempts | Local package and bridge work; configured WASM works; zero unauthorized external/private/local packet or socket; no unexpected UI/runtime regression. |
| Positive exact HTTPS | One controlled public exact hostname on valid TLS/443; browser `fetch` and XHR; controlled DNS answer; response endpoint log, packet/socket evidence and client destination | Request succeeds subject to normal browser CORS; certificate/hostname validation succeeds; the controlled public DNS answer is bound to the actual socket and actual TCP target; no proxy credentials leak. A localhost/private target cannot satisfy this row. |
| Positive WSS | A separate controlled test package/complete tuple-set grant containing the public WSS hostname on valid TLS/443, controlled DNS and captured handshake/message/socket target | WSS succeeds only when the exact `wss` tuple is in that package's complete granted set; HTTPS alone does not authorize WSS. This is not a per-domain UI grant. Valid TLS, public destination and connection-bound DNS are evidenced. Revoke closes the socket. |
| URL negatives | Unlisted host, parent, child/subdomain, suffix-confusion, wrong scheme, `http`, `ws`, non-443, userinfo, malformed URL, trailing-dot, Unicode/A-label edge | Denied before unauthorized network effect; no string suffix loophole; malformed input fails closed. |
| IP negatives | IPv4 literal/alternate numeric form, IPv6 literal, mapped IPv6, zone id, loopback, RFC1918, shared, link-local, multicast, unspecified, reserved, NAT64/transition | No local/special target connection. Machine-readable evidence records request URL class and actual destination. |
| DNS/SSRF | Controlled A and AAAA answers: public-only positive endpoint, private-only, mixed public/private, rebinding, changed answer after TTL, resolver cache/hosts file; repeated connections | Only validated numeric public socket target is reached; a private/mixed/unknown answer always rejects; no second hostname lookup race or private packet. Failure to observe the actual socket is FAIL/NOT CERTIFIED. |
| Redirects/retries | HTTPS same-host, cross-host, ungranted host, protocol downgrade, redirect to IP/local/private, loops, retry after DNS answer change | Every new target is independently checked; no unauthorized hop reaches the sink; redirect observer data is not used as permission. |
| Resource classes | Fetch/XHR/OPTIONS, EventSource, WebSocket, image, CSS, font, media, script/dynamic import, iframe, form, download | Only resource classes explicitly approved by this design work; initial design allows only `connect-src` HTTPS/WSS tuples. No remote executable code, frame, navigation or file write. |
| Worker state | Dedicated/shared/module Worker and ServiceWorker registration/controller/fetch, including old worker and runtime switch | Current frozen behavior: all Worker and ServiceWorker creation attempts reject. Any future change requires separate contract approval and positive packaged identity/revoke coverage. |
| Proxy/speculation/alternate transport | System/PAC environment, proxy unavailable, bypass/failover, direct fallback, HTTP/2 pooling, HTTP/3/QUIC, resource hints/preconnect, WebRTC/STUN, DNS prefetch | Every attempted socket is attributable to the current plugin authority and forced through the connection gate, or is blocked. Any path that cannot be tested is NOT CERTIFIED. |
| Cache / pool | Warm cache, reused HTTP/2 connection, preconnect socket, new runtime generation, same Session reuse | A cached response cannot leak an old authorization; every request checks current authority; no old socket is reused after revoke; current network mode is independently applied. |
| Authority | Forged plugin/Feature/hash/grant/revision/generation/origin; disabled/incompatible package; revoked/old grant; old runtime URL; A late CONNECT after B starts | Main-derived identity only; every mismatch fails closed before network effect; an A request cannot inherit B authority; restart does not restore a stale grant. HTTPS and WSS remain distinct through trusted request-to-connection correlation. |
| Revocation | Revoke during DNS, connect, request headers, body stream, redirect, EventSource, WSS; disable/update/uninstall/runtime replacement | New requests deny synchronously; pending work aborts; old sockets/channels close within a bounded observable condition; no old generation reconnects. Remote already-processed effects are not claimed reversible. |
| Failure modes | Egress authority unavailable, crash, hung resolver, tunnel error, identity missing, cleanup timeout, renderer crash/hang, Manager close | Fail closed; no direct fallback; old authority is revoked; isolated Manager/Electron process group exits on normal close and NativeHost remains. |
| Evidence integrity | Sanitized machine-readable evidence JSON, raw test/sink/capture logs outside repo, exact binary hashes | Reports distinguish AUTOMATED PASS, PACKAGED ACCEPTANCE PASS, USER CONFIRMED, NOT TESTED, INCONCLUSIVE. No secrets or real user data. |

**Decision rule:** every required positive and negative row for the approved scope must be VERIFIED/PASS on the packaged Electron build, with zero P0/P1/blocking P2 and no untested bypass path. Any unknown transport, unobservable connection target, DNS/private-address failure, direct fallback, stale-grant reuse or production-data exposure leaves Gate 4 **NOT CERTIFIED**. `network.mode:none` evidence cannot substitute for domains evidence.

## 17. Performance / Memory Implications

No new measurements were collected. Relative costs only:

| Area | Expected direction / reason | Evidence needed later |
|---|---|---|
| Web Plugin cold start | A broker readiness handshake and strict Session policy may add startup work; no amount is known. | Packaged time to active view and first local package resource. |
| First fetch | Resolver check and connection-bound IP selection add latency; cache behavior and DNS source affect variance. | Repeated deterministic first/second fetch timing with exact resolver result. |
| Ordinary requests | Central policy lookup per request is likely small; a CONNECT hop and socket relay add work and may affect pooling. No MB/ms estimates are justified. | Small bounded requests across HTTPS, redirects, WSS, worker decision. |
| Session creation/reuse | A fresh per-runtime Session can improve state separation but `fromPartition` reuses named sessions and public API lacks destroy. Unique partitions may retain objects/resources for process lifetime. | Process/Session count and teardown checks in isolated packaged runs before any change. |
| Runtime switch/revoke | Closing the shared Session’s connections interrupts active work; a new TLS handshake is expected after re-invocation. | Observed socket close and successful fresh connection after grant and new runtime. |
| Manager close | Any in-process broker must stop with Electron Main; no independent process should survive. | Exact Electron process group reaches zero; no broker listener/socket remains. |

Do not run a broad performance benchmark to decide whether the security capability should exist. Correctness and fail-closed connection attribution are the Gate 4 acceptance criteria; measure only the bounded path needed to assess usability after feasibility is proven.

## 18. Risks / Blockers / Unknowns

### Blocking for Gate 4

1. **DNS/IP pinning [UNPROVEN / BLOCKING].** Electron 44.4.5 public APIs do not show a documented way to bind `resolveHost()` answers to the actual Chromium socket. `webRequest` URL data and post-request `ip` data are insufficient proof.
2. **Complete egress routing [UNKNOWN / BLOCKING].** It has not been demonstrated that a Main loopback proxy can prevent every direct, system/PAC, bypass, preconnect, connection-pool, HTTP/3/QUIC, UDP, WebRTC, worker and proxy-fallback route for Chromium 152.
3. **Actual network identity [UNKNOWN / BLOCKING].** WebRequest metadata has optional WebContents/frame/initiator fields. Worker and browser-started activity attribution must fail closed if identity is absent; positive Worker support is currently forbidden by the frozen contract.
4. **Revocation of active network channels [UNKNOWN FOR DOMAINS].** Existing code revokes runtime authority synchronously and later closes Session connections; no positive network grant exists. Immediate cancellation ordering under DNS/request/WebSocket activity remains a future packaged test requirement.

### Contract reconciliation status

- **Partition literal:** the recommended minimum resolution is to clarify the frozen contract to preserve the accepted implementation literal and its dedicated, non-persistent, Manager-isolated, intentionally reused Session scope (§3). No source change or contract rewrite is made in this task. Human design-freeze review remains required.
- **`grantRevision`:** equivalence is **NOT PROVEN**. Current tickets, current-record checks, synchronous revocation and runtime-generation invalidation cover important parts of the invariant, but the review has not proved a monotonic revision equivalent for all pending asynchronous admissions (§3). Before any implementation, prove the existing behavior under captured races or obtain approval for a Main-only, non-persisted authority epoch. This remains a Gate 4 blocker; no persisted field/schema is proposed.

### Other unknowns / non-blockers for current `none` runtime

- **[UNKNOWN]** Whether preconnect/speculative sockets are denied early enough for Gate 4. Electron documents an event without a cancellation callback.
- **[UNKNOWN]** Whether all Chromium 152 cache hits, worker requests, WebSocket handshake variants and ServiceWorker paths reach the hook exactly as the future gate needs. Existing offline packaged evidence covers `none`, not domains.
- **[UNKNOWN]** Whether HTTP/3/QUIC can be disabled or forced onto the same authority without an undesirable process-global change affecting Manager traffic.
- **[UNKNOWN]** Whether a local CONNECT guard can observe/pin DNS while preserving Browser TLS validation and WebSocket, with zero implicit proxy bypass.
- **[UNKNOWN / BLOCKING]** Whether CONNECT admission can be securely correlated to HTTPS versus WSS, the originating WebContents/Feature, package tuple grant, authority epoch and runtime generation, including Runtime A's late request after Runtime B starts. CONNECT host/port alone cannot provide these identities.
- **[UNKNOWN / BLOCKING]** Whether a deterministic test environment can produce trustworthy public-endpoint, valid-TLS, controlled-DNS, actual-socket and normal-CORS evidence for both HTTPS and WSS. A local/private positive fixture is not an acceptable substitute.
- **[UNKNOWN / BLOCKING]** Whether an acceptance-only grant can be isolated from production persisted permissions and ordinary plugins while still exercising the exact Main-derived authority path.
- **[UNKNOWN]** Exact request-origin/CORS behavior for dynamic `webtools-plugin://<random>` origins against real public API servers.
- **[UNKNOWN]** Public-suffix host admission is not explicit in the existing validator/contract; exact-match semantics do not need PSL for wildcard boundaries, but a product-level rule would need explicit agreement.
- **[UNKNOWN]** Resource-type scope for an initial domain grant beyond `connect-src`. This design recommends no remote script/style/frame/navigation/download expansion.

No P0/P1 product defect was identified in the currently supported `network.mode:none` path by this static review. The above Gate 4 blockers mean this phase recommends against implementing/enabling domains now; they are not a claim that supported offline behavior failed. No new runtime tests were run.

## 19. Explicitly Deferred Features

- `network.mode:domains` implementation or permission grant UI.
- Generic Host HTTP proxy, plugin-facing `fetch`/`http` SDK method, arbitrary proxy config, proxy credentials, unrestricted network mode, raw TCP/UDP or custom socket API.
- HTTP/WS, non-default ports, wildcard/subdomain grants, IP-literal grants, private/local service access, non-HTTP protocols.
- Remote script/module execution, remote frames, external main-frame navigation, downloads or browser credential use under a network grant.
- ServiceWorkers and background network execution. Dedicated Workers remain disabled by the current frozen contract pending separate review.
- CORS bypass, TLS certificate bypass, mixed-content relaxation, Node/Electron access, arbitrary IPC or Host secret access.
- Product-code Session partition rename, per-Feature Session redesign, custom Chromium/Electron fork, new resident egress process, WFP driver/firewall product integration, dependency or Manifest/API changes. The only partition change suggested here is a documentation clarification after human review.
- Gate 4 production network tests, performance benchmark, network implementation, release, Phase 6E-8 and any product UI work. The separately authorized next research step, if approved, is bounded isolated feasibility only.

## 20. Final Recommendation

1. Treat this as a research/design clarification for human freeze review only; it is not network feature authorization.
2. Preserve production `network.mode:none` as currently implemented and keep `network.mode:domains` ungrantable and inactive.
3. Recommend a documentation-only Session partition clarification preserving `webtools-web-plugin-runtime`; do not rename product code.
4. Do not call `grantRevision` equivalent today. Before implementation, prove captured async admission behavior or obtain human approval for a Main-only, non-persisted authority epoch; do not add registry schema.
5. If approved after design review, the next step is **Phase 6E-7 — Bounded Connection-Egress Feasibility**, limited to a deterministic isolated proof. It must answer the ten questions in §14, including CONNECT identity correlation, HTTPS/WSS separation, actual public socket/DNS binding, revocation races, alternate transport, browser CORS, Manager isolation and resident-process cost.
6. A positive test grant must exist only in explicitly isolated acceptance mode with TEMP userData, exact validated test package and Main-derived identity; it must not touch production grants or be invokable by ordinary plugins.
7. If the feasibility environment or any required connection identity/routing/DNS/revocation property cannot be proven, stop and retain no-network mode. Do not weaken the domain contract to get a PASS.

**Gate 4 final status: NOT CERTIFIED.**

**`network.mode:domains`: UNSUPPORTED.**

**Phase 6E-7 Bounded Connection-Egress Feasibility: NOT STARTED; requires separate authorization after human design-freeze review.**

**No network implementation or Phase 6E-8 work is authorized by this document.**
