# WebTools Phase 6C-3 — Design Revision and Architecture Freeze

**Review date:** 2026-10-06
**Branch:** codex/shared-ai-translation-2.0
**Baseline HEAD:** 76e6e9a5c69ae3d0774c53eb5a3c37e6be9ef6a5
**Scope:** documentation and design contracts only

## Phase status

- Phase 6C-1: COMPLETE
- Phase 6C-2: APPROVED WITH DESIGN REVISIONS
- Phase 6C-3: COMPLETE
- Phase 6D: NOT STARTED

This record freezes the decisions approved in the Phase 6C-2 Architecture Review and synchronizes the Phase 6C design set. It is not production implementation authorization. Phase 6D requires its own explicit approval.

## Baseline and repository boundary

The baseline branch and HEAD above were checked before editing. The worktree already contained unrelated Launcher changes in:

- docs/webtools-phase5i-launcher-improvement.md
- native/WebTools.NativeHost.Checks/Program.cs
- native/WebTools.NativeHost/MainWindow.xaml
- native/WebTools.NativeHost/MainWindow.xaml.cs

Those pre-existing files were left unchanged and are unrelated Phase 5I Launcher work. The Phase 6C-1 audit and six Phase 6C-2 design documents were present before this revision. Phase 6A remains complete and Phase 6B remains complete; their historical reports and acceptance evidence were not rewritten. The Phase 6C-2 design changes themselves were documentation-only; the unrelated production-code changes already present in the worktree are not part of this architecture revision.

## Files reviewed

- docs/phase6c-plugin-platform-audit.md
- docs/phase6c-plugin-platform-design.md
- docs/phase6c-feature-context-contract.md
- docs/phase6c-web-runtime-security-design.md
- docs/phase6c-native-feature-projection.md
- docs/phase6c-product-interaction-wireframes.md
- docs/phase6c-migration-design.md
- docs/phase6-master-plan.md
- docs/webtools-phase6c-capability-backlog.md
- docs/webtools-phase6b-plugin-developer-experience.md
- package.json, only to determine whether a Markdown/document lint command already exists

## Files changed

- docs/phase6c-plugin-platform-design.md
- docs/phase6c-feature-context-contract.md
- docs/phase6c-web-runtime-security-design.md
- docs/phase6c-native-feature-projection.md
- docs/phase6c-product-interaction-wireframes.md
- docs/phase6c-migration-design.md
- docs/phase6c-plugin-platform-audit.md — historical audit retained, with a dated superseding-decision addendum
- docs/phase6-master-plan.md — current phase statuses and 6C/6D scope corrected
- docs/webtools-phase6c-capability-backlog.md
- docs/phase6c-architecture-freeze.md — this authoritative decision record

## Architecture Decisions Frozen

1. A Plugin is a package and lifecycle owner; it is not a Manager Page.
2. A Feature is the primary user-facing invocation unit.
3. One Plugin may provide multiple Features.
4. Launcher and Super Panel share one Feature Registry, Feature Projection, Feature Matcher and Context Model.
5. Launcher flow is Intent → Feature.
6. Super Panel flow is Context → Feature.
7. Manager owns Plugin install/uninstall, enable/disable, permissions, settings, update/data management and the on-demand Rich Web Plugin UI Host.
8. Launcher and Super Panel are both owned by NativeHost.
9. Both Native surfaces use C#/WPF.
10. Both Native surfaces live in the same WebTools.NativeHost.exe process. No SuperPanel.exe, ClipboardService.exe, PluginService.exe, FeatureService.exe, second NativeHost or other resident helper is introduced.
11. Manager remains an on-demand Electron process group. Electron is zero while Manager is closed and returns to zero after normal Manager close.
12. Installing a Plugin does not start its runtime.
13. Enabling a Plugin does not make its runtime resident.
14. A searchable Feature does not imply a loaded Plugin runtime.
15. Manifest v1 remains frozen and existing v1 package bytes remain unchanged.
16. A v1 Declarative Plugin is represented at read time by one deterministic synthetic Feature; the adapter does not rewrite or repackage it.
17. Manifest v2 is for Web Feature packages and does not introduce a second Declarative UI grammar.
18. The .wtplugin package container remains in use.
19. Plugin API Major remains 1 unless a separately approved breaking Host API semantic change requires a major change.
20. Native Feature Projection is presentation/cache data, never authority. Main revalidates package, version/hash, enabled state, grants, Feature, Context, runtime generation and session for every invocation or Host effect.
21. Web Plugins do not receive Node.js, Electron APIs, Manager preload/DOM, raw IPC, raw filesystem paths, child processes, arbitrary executable loading or native-addon capability.
22. The SDK remains thin. Browser-compatible code and business algorithms belong in the Plugin unless a future use case needs Host/system authority.
23. Declarative Plugins remain supported as the Lightweight Plugin Mode.
24. Web Plugin bundles remain framework-agnostic and may use normal Vanilla, Vue, React or Svelte build output.

## Design Revisions Applied

### WebAssembly

Package-local WebAssembly is supported as normal sandboxed browser-side computation. It is not a Host capability, does not add a Plugin permission and does not expose an operating-system interface. The Manifest v2 closed inventory explicitly includes package-local .wasm entries with the fixed application/wasm media type and per-file/package size bounds.

WASM remains inside the existing WebContents sandbox, unique app-owned origin, CSP, exact package inventory and runtime lifecycle. WASM bytecode support does not permit native executable or DLL loading, native addons, Node, child processes, WASI system access or arbitrary OS access. Manifest v1 Declarative packages do not gain WASM execution.

The Web Runtime CSP uses script-src 'self' 'wasm-unsafe-eval'. It must not use unsafe-eval. The narrower source expression permits WebAssembly compilation/instantiation without permitting JavaScript eval, as described by [W3C Content Security Policy Level 3](https://www.w3.org/TR/CSP/). Phase 6D must verify this behavior in the shipped Electron/Chromium version with a real deterministic browser-compatible WASM fixture; the design does not claim that runtime behavior has already been tested.

### Network sequencing

The Web Runtime can first ship with network.mode none. Its implementation, Feature invocation, sandbox, Context, storage, framework compatibility and WASM are not blocked by the separate network.domains feasibility gate.

network.domains remains unavailable until exact host/protocol/port enforcement and connection-level DNS/IP pinning are proven, including redirect/retry revalidation, IPv4/IPv6 handling, local/private-address denial, DNS-rebinding resistance, and the absence of direct, proxy, QUIC, UDP or WebRTC bypasses. If the gate cannot be passed safely, the Web Runtime may ship with network.mode none only; failure does not block Web Plugins generally.

If enabled later, domain grants are exact canonical scopes. Added host/protocol requires re-consent; removed scope is reduced immediately; a changed package hash cannot expand authority. A registry v2/networkGrant change remains a future schema implementation, not a Phase 6C-3 code change.

### Clipboard Context UX and privacy

Opening Super Panel does not read the clipboard. The user explicitly selects the Native-owned Clipboard Context action. That action itself is the trusted gesture for one bounded, one-shot Native capture and local preview; no redundant confirmation button is added. The shared matcher may use the local snapshot to present eligible Features.

Native creates the invocation ID at the explicit context action; the local pending snapshot may bind at most once to the Feature selected afterward and is discarded if no Feature is selected before its TTL. The gesture does not grant a Plugin permission. Before a selected Web Feature receives the snapshot, Main revalidates the live Feature/package, plugin-wide clipboard.read request and grant, accepted Context pair, invocation and runtime. No clipboard value crosses NativeHost ↔ Manager transport before actual peer authentication. The bridge has no ambient clipboard read method.

Keep the existing privacy rules: text only, bounded UTF-8 payload, one-shot invocation binding and TTL, no polling/watcher/history, no synthetic Ctrl+C, no silent reread, no persistence, and no clipboard value in logs, analytics or crash reports. clipboard.write remains an independent capability with Host-owned confirmation.

### Mandatory actual-peer authentication

CurrentUserOnly is a user ACL, not proof of the Manager executable. A self-reported hello PID is not identity evidence. Before any sensitive Context, especially clipboard text, crosses the NativeHost/Manager channel, authenticate the actual connected peer and bind it to the expected packaged Manager executable and launched process lifecycle using OS-observed identity, or use another handoff that proves peer identity. Do not add a resident broker.

This gate applies to sensitive Context transport. Ordinary non-sensitive Feature metadata projection remains a separate display/cache path; the pipe projection is still not authority and Main must revalidate every invocation.

### Capacity bounds

First-release engineering/safety bounds are:

- At most 16 Features per Plugin.
- At most 2,000 enabled/projected Features globally.
- At most 3 MiB serialized Feature Projection payload.
- Launcher input Context: existing 300 UTF-16-unit input guard and 16 KiB UTF-8 envelope cap.
- Clipboard Context: at most 32 KiB UTF-8; oversized input is rejected, not silently truncated.
- An undelivered snapshot expires after 30 seconds. After acceptance, it exists only for the active invocation and expires no later than 10 minutes; close, cancel, timeout, package-state change, runtime crash or Manager exit invalidates it.

These are not permanent Product Contract or public SDK ceilings. Future increases require representative benchmarks and, where wire compatibility changes, a new projection version. Phase 6D must test worst-case Unicode, JSON escaping, pipe framing, memory and search latency. SDK documentation must not describe the 2,000-row projection bound as permanent.

### Runtime and result lifecycle

- At most one Rich Web Feature runtime is active.
- Opening another runtime requires close-before-open: revoke the old bridge generation, cancel pending requests, destroy its WebContents, prove teardown, then create the next runtime. No pool or prewarm.
- Launcher app/site result behavior stays unchanged. Plugin Features occupy a separately bounded group of at most six rows and cannot displace or reorder app/site results.
- The existing /, ?, and file: command modes are unchanged. Empty-query Feature shortcuts are not enabled.
- Grants are Plugin-wide. Feature.requiredCapabilities is only a declaration and must be a subset of requestedCapabilities; it is not authority. No per-Feature grant database is introduced.
- Host PluginStore is the only durable Plugin persistence path. Web Runtime localStorage, IndexedDB, Cache Storage, persistent cookies and service-worker storage are not durable state. Runtime partition/session is transient and site data is cleared on teardown. PluginStore quota is not increased.
- Closing/dismissing Launcher hides it while NativeHost continues. Closing/dismissing Super Panel hides it, clears transient Context and leaves NativeHost running. Both hidden still leaves the tray host running.
- Normal Manager close destroys the BrowserWindow, Manager WebContents and Plugin runtime, then exits the Electron process group while NativeHost continues. Tray Exit is explicit application shutdown.

### Compatibility and migration

- Manifest v1 parser and package bytes remain immutable.
- v1 Declarative Plugin uses one deterministic read-time synthetic Feature.
- Manifest v2 is Web Feature-only in the existing .wtplugin container; no duplicated Declarative UI grammar.
- An old Host rejects unsupported v2 without partial installation or fallback reinterpretation.
- Invalid update keeps the current valid package active.
- Registry migration is atomic, backed up and fail-closed; no production migration occurs in Phase 6C-3.
- Corrupt Native projection is a rebuildable cache failure and must not mutate Plugin data/settings.
- Package hash is an integrity identity, not publisher authenticity. No signing or marketplace trust system is added here.

## Host API boundary

Keep Host APIs for platform authority/integration: Feature invocation, Context delivery, PluginStore, permission state, controlled external.open, clipboard integration, Shared AI and any future carefully scoped system/file/screen primitives.

Do not add Host business-algorithm APIs for OCR, PDF, image processing, compression, QR, Markdown, JSON, media algorithms, rename rules, parsing or local computation. WASM and browser-compatible packages remain Plugin-side.

## Revised Phase 6D dependency order

This is the approved implementation dependency order only. No step is executed in Phase 6C-3.

1. Freeze and regression-test the Manifest v1 compatibility baseline.
2. Implement the Feature contract and deterministic v1 synthetic compatibility adapter.
3. Implement Main-owned Feature Registry and Feature Projection v2.
4. Implement Native Feature cache and SearchCore integration.
5. Implement invocation protocol and Main revalidation.
6. Implement actual NativeHost ↔ Manager peer authentication before sensitive Context transport.
7. Implement Manifest v2 Host validation and closed package inventory.
8. Implement the sandboxed Web Runtime: dedicated WebContentsView, unique app-owned origin, dedicated minimal preload, no Node/Electron, no Manager DOM/preload, transient session, and denial of navigation, popups, downloads, permissions and service workers.
9. Implement the narrow typed bridge.
10. Implement Launcher-input text Context.
11. Implement Clipboard Context one-shot delivery only after the peer-authentication gate passes.
12. Verify framework compatibility for Vanilla, Vue, React and Svelte bundles.
13. Implement package-local WASM support and security tests.
14. Implement SDK v2 author workflow, validation, packing and inspection integration.
15. Only after the base Web Runtime is stable, investigate and implement network.domains connection-level enforcement.
16. If that enforcement cannot be proven safe, ship the Runtime with network.mode none only.
17. Run lifecycle, performance and security acceptance: Manager closed means Electron zero; no hidden runtime pool or Plugin runtime residency; at most one active Web Feature; teardown is proven.

## Phase 6D Mandatory Security Gates

### GATE 1 — WebContents isolation

Before accepting Web Plugin execution, prove:

- no Manager preload is attached;
- no Node/Electron API is available to Plugin content;
- every bridge request is bound to the correct top-frame sender;
- runtime generation is checked and stale bridge requests are rejected;
- teardown destroys the WebContents and cancels pending work.

### GATE 2 — Native/Manager sensitive transport authentication

Before sending sensitive Context:

- prove the identity of the actual connected pipe peer;
- never trust a self-reported PID as executable proof;
- reject sensitive clipboard/Context from an arbitrary same-user process;
- bind acceptance to the expected packaged Manager executable and launched process lifecycle, or use another proven identity handoff.

### GATE 3 — Projection fail-closed

Prove corrupt, truncated, oversized, stale, duplicate-revision, rollback, reconnect and wrong-session projections cannot create authority or execute a stale Feature. Main must re-resolve all live state before invocation/effect.

### GATE 4 — Domain network enforcement

network.domains stays disabled until tests demonstrate exact-host enforcement, DNS/IP pinning, DNS-rebinding resistance, redirect and retry revalidation, IPv4/IPv6 safety, no localhost/private target, and no direct/proxy/QUIC/UDP/WebRTC bypass.

Failure of GATE 4 blocks only network.domains. It does not block network.mode none Web Plugins or the base Web Runtime.

## Risk classification

No current production P0 or P1 defect was identified by this design-only revision.

| Level | Count | Classification |
|---|---:|---|
| P0 | 0 | No current critical production defect identified |
| P1 | 0 | No current high-severity production defect identified |
| P2 | 4 | Future implementation gates: connection-level network enforcement/DNS rebinding; exact WebContents/preload teardown and sender binding; projection generation/rollback fail-closed behavior; actual Manager pipe peer authentication before sensitive Context |
| P3 | 2 | Non-blocking future validation: WebContentsView geometry/responsiveness; real-world Feature ranking and Context matching |

These P2/P3 items are future implementation gates and design-validation work, not vulnerabilities in the current production Declarative Plugin system.

## Validation and final decision

- Cross-document review covered ManifestVersion versus Plugin API Major, Feature identity, Context source/type and gesture, clipboard privacy/transport, WASM inventory/CSP, network sequencing and grants, capacity labels, runtime/session lifecycle, Native process model, Manager lifecycle, projection authority, v1 compatibility and Phase 6D gates.
- Phase status cross-check retained Phase 6A COMPLETE and Phase 6B COMPLETE. Phase 6C-1 remains COMPLETE; Phase 6C-2 is APPROVED WITH DESIGN REVISIONS; Phase 6C-3 is COMPLETE; Phase 6D is NOT STARTED.
- Existing package scripts were reviewed; no Markdown/document lint command exists, so no dependency was added.
- Production code, Manifest parser, Plugin API implementation, Native IPC, WPF, Electron runtime, package dependencies, registry schema, user data and packages were not modified.
- No Phase 6D implementation task was started.
- Additional document checks: all reviewed documents have balanced fenced blocks, no trailing whitespace and resolving local Markdown links.
- Git whitespace validation: git diff --check passed with exit code 0. Git emitted LF-to-CRLF working-copy advisories for modified Markdown and the pre-existing Launcher files; no whitespace errors were reported.
- No commit, push, PR, merge, tag or release was created.

**PHASE 6C ARCHITECTURE FROZEN**
