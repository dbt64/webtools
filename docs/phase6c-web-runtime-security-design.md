# Phase 6C — Web Bundle and Runtime Security Design

**Status:** design only; no runtime or security policy has been implemented.

## 1. Trust boundary

A Manifest v2 Web Plugin contains author-controlled executable JavaScript. It is a different trust class from the current declarative v1 package. Installation therefore requires Host validation plus an explicit confirmation that the package executes code. “No capabilities requested” means no Host effects are available; it does not mean the HTML/JavaScript is trusted.

The runtime is hosted on demand as one WebContentsView attached to the existing Manager BrowserWindow. It never runs inside the Manager Vue renderer and does not inherit the Manager preload, origin, DOM, storage or IPC authority. The first release allows one active Web Feature at a time, with no pooling or prewarming.

Electron 44.4.5 provides an independently owned WebContents through WebContentsView. BrowserWindow extends BaseWindow, and BaseWindow leaves child WebContentsView contents to the application to close. Future implementation must remove the view and close its WebContents before Manager exit. See [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window), and [BaseWindow](https://www.electronjs.org/docs/latest/api/base-window).

## 2. Static package bundle

Keep the .wtplugin ZIP extension and immutable content-addressed storage. Manifest v1 inventory rules stay frozen. Manifest v2 uses a separate strict validator with a closed inventory:

- exactly one manifest.json;
- every listed Web Bundle file exists exactly once and every archive file is listed;
- every package-local WASM module is explicitly listed in the Web Bundle inventory and receives the fixed media type application/wasm;
- no duplicate/case-colliding names, encrypted entries, symlinks, special files, ZIP64 ambiguity or path traversal;
- no absolute paths, drive prefixes, backslashes, empty/dot segments, encoded separators or Unicode-normalization collisions;
- file paths are canonical relative POSIX archive paths;
- no extraction to an arbitrary filesystem path; Main reads validated entries from immutable package bytes by package hash and canonical entry name.

Retain the current archive defensive envelope unless a separate review requires stricter v2 limits: 20 MiB compressed package, 256 entries, 50 MiB expanded total, 64 KiB manifest, 100:1 maximum compression ratio and 256 KiB per PNG icon. Add tighter per-document limits in the migration design. Host installation validation remains final authority; SDK validation is preflight only.

Authors may use Vue, React, Svelte, Vanilla JS, package-local WebAssembly modules or browser-compatible libraries. WebTools sees only built output: HTML, JavaScript modules, CSS, JSON, explicitly listed WASM modules, fonts and static assets. A .wasm file is a browser Web Bundle module with the fixed application/wasm media type, not a native executable or general binary asset. Each module remains subject to the per-file/package bounds in the migration design. The Host does not load the author's framework or grant Node/Electron access. Bare npm imports must be bundled by the author.

## 3. App-owned origin and protocol

Use an app-owned custom scheme, for example webtools-plugin://, with a cryptographically random per-runtime host component. A runtime origin is unique to one Feature invocation and is not a general app origin. The URL never contains a Windows filesystem path or package storage path.

Electron requires privileged scheme declarations before app readiness and only once. Register only the privileges needed for standard origin resolution, secure-origin treatment and same-origin fetch. Do not grant bypassCSP, allowServiceWorkers or other privileges for convenience. Register the handler on the dedicated plugin Session. It maps the current runtime host and normalized package-relative URL to a validated archive entry; all other hosts and paths are denied. Never concatenate renderer text into a filesystem path.

References: [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol) and [Electron session](https://www.electronjs.org/docs/latest/api/session). Scheme privileges are process-level declarations, not per-plugin controls.

## 4. WebContents preferences and bridge

Design baseline:

- sandbox, contextIsolation and webSecurity enabled;
- nodeIntegration, webviewTag and allowRunningInsecureContent disabled;
- no Manager preload, Manager webContents reuse or raw ipcRenderer exposure;
- one dedicated minimal preload exposing only the typed bridge from the [Feature/context contract](phase6c-feature-context-contract.md);
- permission request/check handlers deny unlisted browser permissions;
- downloads canceled and new windows denied;
- production DevTools unavailable unless separately approved for a developer mode.

Main binds every bridge request to the actual sending WebContents ID, top frame, runtime ID/generation, FeatureRef, package version/hash and invocation. Payload identity is correlation data only. Main rechecks current plugin state after asynchronous operations.

Follow [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) for sandboxing, navigation, context isolation, CSP and IPC validation. The trusted Manager preload is not a template for plugin content.

## 5. Session and transient web state

Use a dedicated non-persistent plugin Session, separate from the Manager Session. The first-release one-runtime limit permits one active runtime descriptor and one centralized security-policy owner. Each active runtime receives a unique custom origin. On close, revoke its bridge generation, cancel pending requests, remove the view, close the WebContents, clear the runtime origin's site data and the plugin-session cache, then discard context and package-reader state.

The plugin Session is not persistent across Electron process exit. Durable plugin data is only through Host PluginStore. Do not treat localStorage, IndexedDB, Cache Storage or cookies as durable plugin data. Service workers are denied, and origin data is cleared on runtime close.

If Electron cannot reliably isolate and clear transient origin/site data and runtime state on the shipped version, keep the Web Runtime disabled until the design is revised. Failure to prove domain egress enforcement disables only network.domains; it does not disable the network.mode none Runtime profile.

## 6. CSP and content policy

Every package response receives a Host-generated Content-Security-Policy:

~~~text
default-src 'none';
base-uri 'none';
object-src 'none';
frame-ancestors 'none';
form-action 'none';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self' [exact approved https origins] [exact approved wss origins];
worker-src 'none';
manifest-src 'self';
~~~

For package-local WebAssembly, the script-src directive is narrowly set to self-hosted scripts plus wasm-unsafe-eval. Do not add unsafe-eval: wasm-unsafe-eval permits WebAssembly compilation/instantiation without enabling JavaScript eval. All WebAssembly bytes must come from an inventory-validated package-local application/wasm entry. Inline scripts, remote script/style, wildcard sources, blob workers and service workers remain denied. Inline style may be considered only if real framework output requires it and after a separate CSP review; do not silently add unsafe-inline. CSP is defense in depth, not the network authority.

## 7. Navigation, frames and browser features

- Main-frame navigation and redirects stay on the exact current runtime origin and package tree.
- Cross-origin navigation, new windows, nested frames and downloads are denied.
- External links use Main-mediated external.open after capability and user-confirmation checks.
- Browser permission prompts are denied: camera, microphone, notifications, geolocation, USB, serial, HID and screen capture are unavailable.
- The webview tag is not used. See [Electron webview guidance](https://www.electronjs.org/docs/latest/api/webview-tag).
- The current Manager's pre-existing local-file navigation policy is separate and must not be reused for plugin content or changed by this design.

| Feature | First-release policy | Reason |
|---|---|---|
| Dedicated/shared workers | Deny | Avoid background code and simplify deterministic close |
| Service workers | Deny | Prevent persistent or hidden lifetime |
| Package-local WebAssembly | Allow in the sandboxed browser runtime | No Host capability; closed package inventory, application/wasm MIME and byte limits, unique origin, CSP and teardown still apply |
| Dynamic import | Allow only package-local listed modules | Support framework chunks while inventory stays closed |
| Remote module/script import | Deny | Prevent bypass of install-time package review |
| Source maps | Exclude from packaged bundle by default | Avoid accidental source disclosure and bundle growth |
| Blob/data code execution | Deny | Prevent runtime-generated executable modules |

WebAssembly bytecode support is not support for arbitrary native executable loading. Native addons, DLL/EXE files, child processes, Node/WASI system access and arbitrary OS access remain prohibited. Phase 6D must use a real deterministic browser-compatible WASM fixture to prove package validation, MIME handling, CSP compile/instantiate behavior, origin isolation and runtime teardown. JavaScript eval must remain blocked.

## 8. Domain network policy

The Web Runtime MVP can run with network.mode none without implementing network.domains. This is a useful, supported first profile and its availability does not depend on the domain-network gate. When network.domains is eventually enabled, the v2 manifest must declare exact domains and the user must grant the exact scope after seeing it. Safe default:

~~~json
{
  "network": {
    "mode": "domains",
    "domains": [
      { "host": "api.example.com", "protocol": "https" },
      { "host": "stream.example.com", "protocol": "wss" }
    ]
  }
}
~~~

Rules:

1. Host is a canonical ASCII DNS A-label, lowercased and IDNA-normalized. Reject userinfo, IP literals, wildcard, scheme, port, path, query and fragment in host.
2. Matching is exact host only. api.example.com does not include sub.api.example.com or example.com.
3. HTTPS is the only HTTP request scheme. WSS is separate and must be listed. HTTP and WS are denied.
4. Port is fixed to 443. Non-default ports are denied.
5. Redirect destinations are checked as new requests against the same policy.
6. Localhost, loopback, link-local, private, unique-local, multicast, reserved and unspecified addresses are always denied.
7. IPv4/IPv6 literals, IPv4-mapped IPv6, zone identifiers, alternate numeric encodings and malformed IDNs are rejected.
8. Wildcards are rejected for the first release. Supporting them requires public-suffix handling and separate review.
9. Adding a host/protocol on update requires user re-consent; removing entries takes effect immediately.
10. Unrestricted network is not part of Manifest v2. Any future unrestricted mode is a separate high-risk profile, off by default, with separate install UX and security review.

### DNS rebinding and actual destination

Electron webRequest exposes URL, initiator, WebContents ID and resource type, including webSocket. It does not itself prove which IP the browser connects to. The current dependency is Electron 44.4.5; initiatorOrigin is available in the declared version range. Electron notes that only the last registered listener for an event is used. See [webRequest](https://www.electronjs.org/docs/latest/api/web-request).

network.domains MUST remain unavailable until connection-level enforcement is proven. Its failure is not a blocker for the Web Runtime or network.mode none plugins. Proposed enforcement is a loopback-only egress broker inside the existing Electron Main process, not a new OS process. The dedicated Session routes plugin HTTP/HTTPS/WSS through the broker. For each request/CONNECT, the broker canonicalizes and checks host/protocol/port, resolves both A and AAAA, rejects if any result is non-public, then connects to an already-validated IP without a second hostname resolution. TLS remains end-to-end; redirects and retries re-enter policy. A centralized Session webRequest handler supplies defense in depth but is not the connection authority.

The broker must prove there is no direct/QUIC/UDP/WebRTC/proxy-bypass route, must avoid leaking proxy authentication to plugin code, and must reject IPv6 mapping and DNS rebinding cases. If Electron cannot be forced through this policy reliably without an unacceptable dependency/process, do not ship domain network access; ship the Web Runtime with network.mode none instead. This is a future Phase 6D feasibility gate, not a current product defect.

## 9. Developer and packaged mode

Packaged runtime loads only immutable Host-validated .wtplugin bytes through the app-owned origin and has no arbitrary localhost fallback. A developer hot-reload mode is not added here. If later proposed, it must require an explicit developer command/setting, use loopback and an isolated test profile, display a development indicator, and never reuse production grants or real secrets.

## 10. Required future tests

- Prove plugin content has no Manager preload global and no Node/Electron APIs.
- Test sandbox, top-frame sender checks, stale runtime host and origin boundaries.
- Attempt path traversal, malformed archives, MIME confusion, popups, navigation, redirects, downloads, permissions, frames, workers and service workers.
- Package and execute a deterministic browser-compatible WASM fixture; verify application/wasm inventory validation, successful WebAssembly compile/instantiate, blocked JavaScript eval, no ambient capability, and teardown.
- Verify CSP handling for real Vue/React/Svelte/Vanilla build output without weakening the default silently.
- Test exact host, subdomain, IDN, redirect, WSS, IP literal, localhost, private IPv4/IPv6 and DNS rebinding.
- Close, update, disable, revoke and crash the runtime; prove all pending bridge work stops and WebContents is destroyed.
- Prove transient site data is cleared and durable data exists only in PluginStore.

## 11. Official references

- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron BaseWindow lifecycle](https://www.electronjs.org/docs/latest/api/base-window)
- [Electron Session](https://www.electronjs.org/docs/latest/api/session)
- [Electron Protocol](https://www.electronjs.org/docs/latest/api/protocol)
- [Electron webRequest](https://www.electronjs.org/docs/latest/api/web-request)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron webview tag](https://www.electronjs.org/docs/latest/api/webview-tag)
- [W3C Content Security Policy Level 3](https://www.w3.org/TR/CSP/) (the wasm-unsafe-eval source expression is specific to WebAssembly and does not authorize JavaScript eval)
