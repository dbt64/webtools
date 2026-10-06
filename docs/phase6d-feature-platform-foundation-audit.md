# Phase 6D-1 — Feature Platform Foundation Implementation Audit

**Audit date:** 2026-10-06

**Scope:** Source audit, source mapping, dependency analysis, test mapping, and a precise implementation plan only.

**Production implementation:** NOT STARTED

**Phase 6D-2:** NOT STARTED

## 1. Executive Summary

The current implementation has a clear Main-process authority for installed declarative packages, grants, enablement, runtime state, and package integrity. `PluginCatalog` safely presents that state and merges the built-in Translation plugin, but it is not a Feature registry and its revision is a list-call counter. Native currently caches v1 plugin shortcuts for the expanded Launcher home surface; it does not search or invoke Features.

The Phase 6C freeze can be implemented without changing Manifest v1 bytes or adding another persistent authority. The lowest-disturbance design is a Main-owned, derived Feature registry over `PluginManager`, `PluginCatalog`, and built-in Translation lifecycle state; a separate closed Feature Projection v2 schema/cache; and a bounded Feature index within the existing Native `SearchCore`. Existing app/site search and its eight-row cap remain intact, while Features receive their own six-row cap.

One security prerequisite needs to move earlier than the proposed phase order: the Native named-pipe server currently uses `CurrentUserOnly` and a self-reported `hello.processId`, but does not authenticate the actual connected process. Because a Feature invocation must arrive over this existing channel and be bound to the launched Manager, implement and verify peer authentication before enabling invocation. No sensitive context payload is part of Phase 6D.

Focused current plugin/IPC/projection tests passed 59/59. This was an audit-targeted run, not full regression. No production source was edited.

## 2. Repository / Git State

State captured before creating this report:

| Item | Value |
|---|---|
| Branch | `codex/shared-ai-translation-2.0` |
| HEAD | `76e6e9a5c69ae3d0774c53eb5a3c37e6be9ef6a5` |
| Upstream | `origin/codex/shared-ai-translation-2.0` |
| Ahead / behind | `0 / 0` |
| `git diff --check` | PASS; only Git LF-to-CRLF notices for existing edited files |

The following changes were already present at audit start and were not edited, formatted, restored, staged, or committed by this task:

```text
 M docs/phase6-master-plan.md
 M docs/webtools-phase5i-launcher-improvement.md
 M docs/webtools-phase6c-capability-backlog.md
 M native/WebTools.NativeHost.Checks/Program.cs
 M native/WebTools.NativeHost/MainWindow.xaml
 M native/WebTools.NativeHost/MainWindow.xaml.cs
?? docs/phase6c-architecture-freeze.md
?? docs/phase6c-feature-context-contract.md
?? docs/phase6c-migration-design.md
?? docs/phase6c-native-feature-projection.md
?? docs/phase6c-plugin-platform-audit.md
?? docs/phase6c-plugin-platform-design.md
?? docs/phase6c-product-interaction-wireframes.md
?? docs/phase6c-web-runtime-security-design.md
```

The existing Launcher files are specifically preserved. The Phase 6C freeze and design documents are also present in the working tree. Git history cannot establish who authored the uncommitted changes or their complete provenance; their observed source/status is the current dirty worktree. The initial tracked diff stat was 216 insertions and 57 deletions across six files. The only file created by this audit is this report.

## 3. Current Plugin Authority Map

| Authority/data | Actual owner and behavior |
|---|---|
| Installed package identity, version/hash, enabled state, grants and status | `electron/plugins/plugin-manager.ts` — `PluginManager`, `initialize`, `install`, `setEnabled`, `setGrants`, `uninstall`, `invoke`; loads and validates registry/package state, serializes mutations, and revalidates integrity/current runtime before actions. |
| Persisted plugin registry | `electron/plugins/plugin-registry.ts` — `PluginRecord`, `RegistryData`, `validateRegistry`; registry v1 caps declarative records at 1,000 and validates package identity/grants. |
| Plugin private data | `electron/plugins/plugin-store.ts` — PluginStore; separate from Feature presentation and not suitable for Native projection. |
| Manifest/package validation | `electron/plugins/manifest.ts`, `electron/plugins/package-validator.ts`, and frozen `src/shared/plugin-contracts.ts` — strict Manifest v1/package validation. There is no Feature field in Manifest v1. |
| Declarative page/action runtime | `electron/plugins/declarative-runtime.ts` — runtime exposes declared pages and gated declarative actions; it does not execute arbitrary plugin JavaScript. |
| Capability effects | `electron/plugins/permission-broker.ts` — PermissionBroker checks granted capabilities for effects. |
| Safe plugin presentation/opening | `electron/plugins/plugin-catalog.ts` — `PluginCatalog.list`, `open`, `launcherProjection`; explicitly presents existing authorities and owns no package, grant, or runtime authority. |
| Renderer-facing API | `src/shared/ipc.ts`, `electron/preload.ts`, and `electron/ipc/plugin-handlers.ts` / `plugin-catalog-handlers.ts`; narrow typed APIs, main-frame sender checks, and disposer-based event listeners. No raw Node or filesystem API is exposed. |
| Native shortcut projection | `electron/services/native-plugin-projection-publisher.ts` plus Main wiring in `electron/main.ts`; publishes presentation-only plugin shortcuts to Native. |

**Recommendation:** add a non-persistent `FeatureRegistry` as a derived, Main-only layer above the existing authorities. It should resolve enabled/installable declarative compatibility Features and built-in Features on demand, and delegate actions/opening back to the current PluginManager/PluginCatalog/built-in lifecycle. Do not make it a second persisted registry or copy grant/runtime/package authority into it. A small content-generation/invalidation seam is needed; `PluginCatalog.revision` is not suitable because `list()` increments it on every listing rather than only when catalog content changes (`electron/plugins/plugin-catalog.ts`, `PluginCatalog.list`).

## 4. Current Catalog / Built-in Map

`electron/plugins/builtin-plugin-registry.ts` defines Translation as a built-in Plugin record (`webtools.translation`); `electron/plugins/builtin-translation-lifecycle.ts` and `builtin-plugin-state.ts` own its enable/recovery/session behavior. `PluginCatalog.list()` combines these built-in records with summaries derived from `PluginManager`; `PluginCatalog.open()` resolves the tagged `PluginRef` to either the built-in Translation route or current declarative pages.

`src/shared/plugin-catalog-contracts.ts` uses a tagged `PluginRef` (`builtin` versus `declarative`) because equal textual plugin IDs can refer to distinct sources. `electron/plugins/plugin-catalog.test.mjs` covers disabling/re-enabling the built-in Translation record without disabling a declarative package that has the same textual ID. `PluginRegistry` uniqueness is within its own declarative list; the built-in is separate.

Native `LauncherPluginProjection` is not this catalog. It is a bounded home-surface shortcut list applied by `MainWindow.ApplyPluginProjection` / `RefreshPluginShortcuts`; it is not consulted by the current search result index.

## 5. v1 Synthetic Feature Adapter Plan

Frozen mapping for each valid declarative v1 package that declares `manager.page`:

| Feature property | Proposed deterministic source |
|---|---|
| `pluginId` | Existing validated Manifest/registry plugin ID. |
| `featureId` | Constant `legacy-manager-page`; not a Manifest field and not persisted back into package bytes. |
| `title` | Existing declared entry/page label exposed by `DeclarativeRuntime.pages()`; fall back only according to an explicit contract if missing (the current validator should normally reject missing required presentation fields). |
| aliases/commands | Normalized, deduplicated plugin name and declared entry label; do not invent aliases by parsing labels or infer unsupported commands. |
| icon | Existing small presentation token from the validated package/catalog; Native receives only the closed icon token, never an archive path or package bytes. |
| manager route | Existing declared `pageId` retained only in Main’s resolved Feature entry and passed to the existing page-opening path. Do not project `pageId` as Native authority. |
| eligibility | Package is current, valid, enabled, runtime-ready, and has the frozen `manager.page` capability/grant required for launch projection. Main checks again at invocation. |

Place a pure deterministic adapter at the boundary between validated package/catalog records and the derived `FeatureRegistry`, not in the Manifest parser, package validator, or persisted registry. It must not add v1 fields, alter existing package bytes, turn every declarative block/action into a Feature, or create a second alias source of truth.

## 6. Feature Contract Placement

Keep four contracts separate:

1. **Author Manifest:** existing `src/shared/plugin-contracts.ts` and package validator; frozen v1, unchanged.
2. **Resolved Feature:** new Electron Main-only internal type, carrying `FeatureRef`, source kind, title/aliases/icon token, and the private resolver to the built-in action or declarative page. Never serialize private resolver details.
3. **Projection DTO:** a closed wire DTO shared by Electron/Node TypeScript and a separately mirrored closed C# DTO in Native. It contains only presentation/search fields, host session/revision, and bounded context-acceptance metadata if required by the freeze; no package/page path, grants, archive, secrets, or context values.
4. **Invocation DTO:** a narrow protocol value containing `FeatureRef`, request/invocation IDs, `hostSessionId`, `expectedProjectionRevision`, and gesture kind. `contextRef` remains absent or explicitly rejected in 6D; no clipboard data.

Use the existing tagged-reference style from `src/shared/plugin-catalog-contracts.ts`; do not reuse `PluginRef` as Feature identity. TypeScript IPC contracts do not replace the closed C# wire model.

## 7. Projection v1 Evidence

`native/WebTools.NativeHost/Data/LauncherPluginProjectionStore.cs` defines `LauncherPluginProjection` v1 with exact keys, version 1, 2 MiB maximum, at most 1,001 rows, allowed icon tokens, and unique tagged plugin refs. `Load` checks actual file stream length, parses and returns empty/status on invalid or corrupt data. `SaveAsync` serializes UTF-8, checks actual byte length, reparses, writes a temporary file, flushes, and replaces the cache. `App.xaml.cs` loads the cache at startup and applies it to the window. `NativeManagerPipeServer.cs` handles `plugins-update`; Main’s `NativePluginProjectionPublisher` serializes sends and recovers its queue after transport errors.

Important implementation detail: the current `Parse(JsonElement)` size check uses `GetRawText().Length` (UTF-16 character count), while load/save boundaries use actual byte length. For v2, enforce the frozen 3 MiB limit on serialized UTF-8 bytes at every ingress/persist boundary, with overflow-safe counting. Do not reuse the v1 parser for v2 or silently change v1 semantics.

The current v1 cache is presentation only, separate from app/site index data, and rebuildable from Main. The current server handshake has per-connection request-ID replay protection (up to 2,048 IDs), but that does not authenticate the OS process or provide projection revision semantics.

## 8. Projection v2 Implementation Plan

Add a distinct `LauncherFeatureProjection` store and a distinct pipe message (for example `features-update-v2`) so existing `plugins-update` and its v1 cache retain exact semantics. Main authors the complete snapshot from the derived registry. Native validates exact schema, strings, icon token, unique `FeatureRef`, maximum 2,000 rows, and serialized UTF-8 size at most 3 MiB; Native treats it only as a rebuildable search/display cache.

Use a new Host session ID and monotonically increasing content revision. Same session/revision/hash is idempotent; lower revision is rejected; same revision with different payload is rejected; a new session requires a complete snapshot; malformed/truncated/corrupt cache becomes empty and never authorizes action. Persist atomically. The projection publisher must coalesce or serialize updates, recover after a failed send, and suppress late updates after disposal, matching the existing publisher’s lifecycle pattern without conflating v1/v2 state.

`PluginCatalog.revision` must not be reused: it increments on each `list()` call, not on content changes. Introduce a feature-content revision at the derived-registry/publisher seam and increment it only when normalized serialized Feature content changes.

## 9. SearchCore Integration Plan

`native/WebTools.NativeHost/Search/SearchCore.cs` currently builds immutable app and website `IndexedEntry` arrays, including normalized names/aliases, pinyin syllables, initials, remembered app rank, and input ordering. Local mode merges app + website candidates, sorts by existing rank/name/order, and takes eight. `/` searches only saved websites. `?` and `file:` bypass local `SearchCore`; local contextual Translation and SearchFiles actions are appended outside the app/site eight-row cap. `MainWindow.xaml.cs` presents a flat selectable result array through the existing selection controller.

Add a bounded Feature index using the same normalization/matching primitives; do not introduce a second search engine or change app/site matching, ranking, remembered-app behavior, eight-row cap, or command parsing. In local mode, append an independently top-six Feature group after current app/site results. Preserve `/, ?, file:` behavior and do not displace/reorder app/site results. Keep Feature selection identity as `FeatureRef`, not row index or display label.

The XAML presentation can add a subtle group caption while retaining one contiguous actionable selection model. If a visual header is represented in the collection, selection/keyboard indices must map only to actionable results; a non-actionable header must never become the selected/activated `SearchResult`. Empty query must not cause needless pinyin index work. Add tests for Latin, CJK, full pinyin, initials, fuzzy matching, aliases, ordering, empty query, result limits, and mode parity.

## 10. Invocation Protocol Plan

Add a typed `FeatureInvokeRequest` over the existing versioned bidirectional Native Manager pipe session; do not add a second IPC transport. Native sends Feature identity plus request ID, unique invocation ID, current host session, expected projection revision, and a trusted gesture enum (`launcher-selection`). Do not send `contextRef` values or clipboard payloads in 6D.

After authenticating the connected Manager process (recommended before this step; see §12), Main verifies exact closed schema, active pipe/session, request and invocation replay, session/revision, unique live `FeatureRef`, package/built-in current status, package version/hash, enabled state, API compatibility, required requested/granted capabilities, and mutation generation. Native’s cached row is never authorization.

For the v1 synthetic Feature, map to the existing `manager.page` route/page ID in Main and use existing manager-on-demand startup, renderer-ready handshake, and navigation acknowledgement. Built-in Translation routes to its current Translation manager handoff. Return bounded result codes aligned with existing IPC errors (`INVALID_INPUT`, `NOT_FOUND`, `DISABLED`, `PERMISSION_DENIED`, `STALE_PROJECTION`, `REPLAYED_REQUEST`, `SESSION_EXPIRED`, `BUSY`, `INTERNAL_ERROR`); do not echo package paths or secrets. Never invoke a translation provider merely because its Feature was selected.

## 11. Mutation / Race Model

`PluginManager` already serializes install/update, enable/disable, grant changes, uninstall, and related intent through its `SerialQueue`; it marks stop/block intent before queued deactivation and checks runtime identity, session, current hash, enabled state, and generation around an invocation. `DeclarativeRuntime` also uses generation/cancellation checks for late async completion. `PluginCatalog` has session/generation invalidation on Manager reload.

Reuse these guards. FeatureRegistry is a derived snapshot, not a new lock/authority. Every package mutation completes in its current queue, invalidates/rebuilds Feature projection, and changes content revision only when serialized content changes. Invocation captures current source identity and revision, then resolves again immediately before dispatch. Disable/revoke/update/uninstall must make invocation fail closed even if an old Native row is visible. Reject replayed request/invocation IDs and wrong host session. A late acknowledgement from a replaced Manager session cannot clear or complete a newer request.

Built-in Translation enable/session generation remains owned by `BuiltinTranslationLifecycle`; Feature resolution delegates to it and must not persist a duplicate Translation enabled flag.

## 12. Actual Pipe Peer Authentication Alternatives

Current evidence: `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs` creates a `NamedPipeServerStream` with `PipeOptions.CurrentUserOnly`, then accepts a positive `hello.processId` and records it. The PID is self-reported; the server does not compare it with the OS-observed client PID or `ManagerController`’s launched `Process`. Same-user ACL limits users, not executables. This is not proof of Manager identity.

| Option | Assessment |
|---|---|
| A. OS-observed pipe client PID + retained launched process identity | **Recommended smallest robust option.** P/Invoke `GetNamedPipeClientProcessId` using the server pipe `SafePipeHandle`; compare with the retained launched process, `HasExited`, captured start time/creation identity, and canonical executable path. Fail closed on inaccessible or mismatched identity. Retain the Process handle to reduce PID reuse ambiguity. Windows exposes the API since Vista; .NET 10 `NamedPipeServerStream` exposes `SafePipeHandle`, and `Process.MainModule` exposes process module path (subject to access failure). |
| B. One-time launch secret + OS PID | Stronger binding only if secret is transferred over a private inherited handle/channel. Passing it in command line or environment is observable by same-user processes and is not a robust secret boundary. Adds lifecycle complexity. |
| C. Per-launch authenticated IPC handoff | Can be robust with a private inherited handle, but introduces another transport/state path and more test burden than needed for Phase 6D. |
| D. CurrentUserOnly + self-reported PID | **Reject.** It authenticates the Windows user, not the client executable; `hello.processId` is attacker-controlled. |

For packaged mode, compare against the exact Manager executable path resolved by `ManagerProcessLauncher`, PID and start identity. Do not trust `hello.processId`. Development mode launches via a Node/electron-vite wrapper and may connect from a child Electron process; its allowed process identity must be explicitly modeled/tested or the development path must fail closed. Do not silently weaken packaged checks. Handle PID reuse, manager restart/reconnect, process-exit races, path canonicalization, access denied, and same-user arbitrary clients in tests.

References: [GetNamedPipeClientProcessId — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid), [.NET 10 NamedPipeServerStream](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeserverstream?view=net-10.0), [Process.MainModule](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.mainmodule?view=net-10.0).

## 13. Built-in Translation / Feature Registry Decision

The architecture freeze says Plugin owns Features, Native Launcher intent targets a Feature, and current source already represents Translation as a built-in Plugin. Therefore the derived registry should include a built-in Translation FeatureRef so the model is complete; this is a routing/presentation adapter only and must delegate to the existing Translation lifecycle and manager handoff. It must not move Translation service/provider/business state into the new registry.

One user-visible choice remains: current local `SearchCore` may append a contextual Translation action while the new Feature index may also return the Translation Feature for queries such as `翻译`. Decide whether both rows may appear, whether the built-in Feature is launcher-searchable, or whether the contextual action is suppressed only when an equivalent Feature result is present. This is a Phase 6D product acceptance choice; do not silently create duplicate-looking rows.

The current source permits built-in and declarative Plugin records with the same textual plugin ID by using the `PluginRef.kind` tag. `FeatureRef` is `(pluginId, featureId)`, so the built-in must receive a stable distinct `featureId`; future Manifest v2 must reserve/reject collision with that built-in composite identity. Current Manifest v1 cannot author a featureId, and the frozen synthetic ID is `legacy-manager-page`, so there is no demonstrated v1 collision if the built-in chooses a different stable ID. Do not change v1 validation in 6D.

## 14. Test Coverage Map

| Existing coverage | Source/tests |
|---|---|
| Plugin install, mutation serialization, permissions, package integrity, disable/revoke, stale async result | `electron/plugins/plugin-manager.test.mjs` |
| Catalog refs, built-in Translation enable state, same-ID built-in/declarative distinction, session and v1 launcher projection eligibility | `electron/plugins/plugin-catalog.test.mjs` |
| Registry persistence/validation and compatibility | `electron/plugins/plugin-registry.test.mjs` |
| Manifest v1 strict schema/package validation | `electron/plugins/manifest.test.mjs`, package validator tests |
| Sender validation and plugin/catalog IPC behavior | `electron/ipc/plugin-handlers.test.mjs`, `electron/ipc/plugin-catalog-handlers.test.mjs` |
| Existing v1 publisher order, recovery, no late publish | `electron/services/native-plugin-projection-publisher.test.mjs` |
| Pipe protocol, request/ack, commands, client behavior | `electron/services/native-manager-protocol.test.mjs`, `native-manager-commands.test.mjs`, `native-manager-client.test.mjs` |
| Renderer catalog navigation/lifecycle | `src/features/plugins/catalog-app-lifecycle.test.mjs` and plugin navigation tests |
| Native search parity, app/site cap, projection bounds, selection, memory/pinyin | `native/WebTools.NativeHost.Checks/Program.cs` |

Future focused tests: deterministic adapter and duplicate-ref behavior; registry eligibility; projection exact schema, byte cap, row cap, corruption/truncation, atomic replace, duplicate revision/hash, same revision/different payload, stale revision, reconnect/new host session; feature alias/pinyin/initial/fuzzy and six-row cap; unchanged app/site top-eight/order; `/`, `?`, `file:` parity; keyboard selection with group label; Main stale FeatureRef/version/hash/grant/session/replay; disable/update/uninstall/revoke races and late ack; actual peer PID/path/start identity, arbitrary same-user process, PID reuse, wrong executable, manager restart, packaged and development launch paths.

## 15. Performance / Memory Guardrails

Phase 6D should retain only bounded Feature display/search metadata, normalized aliases/index fields, small icon tokens, and cache revision/session state in Native. Do not copy package archives, plugin store records, JavaScript, WASM, page bundles, full icon files, credentials, or context values into Native.

In 6D-7, use synthetic isolated projections at 0, 100, 500, 1,000, and 2,000 Features. Record payload UTF-8 bytes, parse/index duration, managed allocation/heap before and after indexing, representative search latency, and row/result counts. Verify hard row/byte limits and monotonic bounded data structures. This is a bounded correctness/performance guard, not Phase 6I benchmarking; do not establish an arbitrary MB gate or touch production profile data.

## 16. Exact File Change Map by 6D Subphase

Only the audit report is changed now. The following is a proposed future implementation map.

### 6D-2 — Contract + v1 Adapter

| File | Symbol/change | Why / risk | Tests |
|---|---|---|---|
| `src/shared/feature-contracts.ts` **new** | Closed FeatureRef, projection and invocation DTO types used by Main/IPC; do not alter Manifest types. | Cross-layer type drift; medium. | Type-level/runtime schema validation tests. |
| `electron/plugins/feature-contracts.ts` **new** | Main-only resolved Feature union, private route resolver, provenance. | Must never leak private resolver into projection; medium. | Resolver serialization boundary tests. |
| `electron/plugins/declarative-feature-adapter.ts` **new** | Pure v1 record/page → one `legacy-manager-page` resolved compatibility Feature. | Wrong alias/eligibility mapping; low/medium. | Determinism, eligibility, no manifest mutation, duplicate alias tests. |
| `electron/plugins/declarative-feature-adapter.test.mjs` **new** | Adapter-focused tests. | Test fixture drift; low. | `node:test`. |
| `src/shared/plugin-contracts.ts` | **Must not change in 6D-2.** | Frozen Manifest v1 contract. | Existing strict manifest suite remains PASS. |

### 6D-3 — Main Registry + Projection v2

| File | Symbol/change | Why / risk | Tests |
|---|---|---|---|
| `electron/plugins/feature-registry.ts` **new** | Derived `FeatureRegistry`; resolves declarative and built-in sources, generation/content revision; no persisted authority. | Stale/duplicate authority; high. | Built-in/declarative identity, mutation invalidation and deterministic snapshot tests. |
| `electron/plugins/feature-registry.test.mjs` **new** | Derived snapshot tests. | Medium. | Enable/grant/session/current-hash changes. |
| `electron/services/native-feature-projection-publisher.ts` **new** | Serialized v2 snapshot publication, failure recovery and close semantics; leave v1 publisher intact. | Update race; medium. | Order, coalescing/recovery, stale send and disposal tests. |
| `src/shared/feature-contracts.ts` | Projection DTO validator/closed keys and limits. | Schema mismatch; medium. | Oversize, unknown keys, invalid ref/icon/name tests. |
| `electron/main.ts` | Construct/invalidate registry and publisher; sync complete v2 snapshots after startup/mutations/session restart. | Wiring/lifecycle errors; high. | Main service wiring and close/reload tests. |
| `electron/ipc/plugin-handlers.ts`, `plugin-catalog-handlers.ts` | Invalidate/publish only after successful existing mutations, using existing sender/session checks. | Missed update or duplicate send; medium. | Mutation-to-projection integration tests. |
| `native/WebTools.NativeHost/Data/LauncherFeatureProjectionStore.cs` **new** | Closed v2 store, 2,000 row/3 MiB UTF-8 limits, session/revision/hash checks, atomic cache, corrupt→empty. | Cache corruption/stale snapshot; high. | Native checks for byte boundary, stale/equal revision, session reset, corruption and atomic replace. |
| `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs` | Add distinct v2 update message and acknowledgement path; retain `plugins-update` v1. | Protocol compatibility; high. | Pipe protocol/ack/reconnect tests. |
| `native/WebTools.NativeHost/App.xaml.cs` | Load/apply v2 cache and update callback without coupling to v1 plugin home shortcuts. | Startup or profile cache regression; medium. | Startup, corrupt cache, replacement tests. |

### 6D-4 — Native Cache + SearchCore

| File | Symbol/change | Why / risk | Tests |
|---|---|---|---|
| `native/WebTools.NativeHost/Search/SearchModels.cs` | Add Feature result identity/action cases and FeatureRef DTO. | Exhaustive action handling/selection mismatch; medium. | Result action and identity checks. |
| `native/WebTools.NativeHost/Search/SearchCore.cs` | Bounded Feature index, local-only matching, max six Features after current app/site rows. | Search parity/latency; high. | CJK/pinyin/initial/fuzzy/alias/order/limit/mode parity. |
| `native/WebTools.NativeHost/MainWindow.xaml.cs` | Apply/cache Features, append results, route selection, keep app/site ordering. | Selection/reset and cache UI races; high. | Selection identity and mode transition checks. |
| `native/WebTools.NativeHost/MainWindow.xaml` | Minimal Feature group presentation in existing result surface. | UI/keyboard index mismatch; medium. | Group/selectable-row checks plus manual launcher smoke. |
| `native/WebTools.NativeHost.Checks/Program.cs` | Add targeted assertions; preserve existing dirty Launcher edits. | Existing user work conflict; medium/high coordination. | NativeHost Checks. |

### 6D-5 — Actual Pipe Peer Authentication (recommended moved earlier)

| File | Symbol/change | Why / risk | Tests |
|---|---|---|---|
| `native/WebTools.NativeHost/Services/ManagerPipePeerAuthenticator.cs` **new** | Bind connected pipe client PID to retained launched process, exact canonical path, start identity; packaged/dev policy. | Security boundary and OS races; high. | Fakeable API seam plus Windows integration checks. |
| `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs` | Authenticate before accepting hello, state updates, or future invocation; never trust claimed PID. | Existing protocol compatibility; high. | Wrong PID/path, arbitrary same-user, reconnect, exit/PID reuse. |
| `native/WebTools.NativeHost/Services/ManagerController.cs` | Expose retained expected process identity safely to authenticator; no new process owner. | Process lifetime race; medium/high. | Manager restart/closed/exited checks. |
| `native/WebTools.NativeHost/Services/ManagerProcessLauncher.cs` | Supply canonical packaged identity and explicit dev wrapper/child policy. | Dev/package mismatch; medium. | Packaged and development executable identity tests. |
| `native/WebTools.NativeHost.Checks/Program.cs` | Authentication boundary checks without touching live install. | Preserve pre-existing edits; medium. | NativeHost Checks. |

### 6D-6 — Feature Invocation + Main Revalidation

| File | Symbol/change | Why / risk | Tests |
|---|---|---|---|
| `src/shared/feature-contracts.ts`, `src/shared/ipc.ts` | Closed request/result and a narrow `open-feature` renderer intent if required by current pipe route. No context values. | TS/protocol contract drift; medium. | Exact schema and rejection tests. |
| `native/WebTools.NativeHost/Services/ManagerController.cs` | Queue/replace latest Feature intent through existing on-demand Manager and readiness/ack lifecycle. | Readiness, stale ack and instance reuse; high. | Absent/starting/ready/reload/hidden Manager cases. |
| `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs` | Send Feature invoke request on the authenticated active session and correlate request/ack. | Replay/session race; high. | Replay, wrong session/revision, timeout/reconnect. |
| `native/WebTools.NativeHost/Search/SearchModels.cs`, `MainWindow.xaml.cs` | Exhaustive Feature result activation routing by kind/ref. | Accidental URL/shell path or wrong result kind; medium. | Keyboard/click dispatch and invalid ref tests. |
| `electron/services/native-manager-commands.ts`, `native-manager-client.ts` | Parse the closed incoming request and bind it to active pipe session. | Parser/replay risk; high. | Protocol schema, session and request-ID tests. |
| `electron/main.ts`, `electron/plugins/feature-registry.ts` | Re-resolve Feature and check authority immediately before opening. | Stale projection or bypass of PluginManager; high. | Stale, disabled, updated, removed, revoked and built-in cases. |
| `electron/app` routing files (current App.vue owner identified by symbol `onNativeManagerIntent`) | Navigate to exact declared page or built-in Translation only after Main approval and renderer acknowledgement. | Renderer readiness and duplicate navigation; high. | Route/page ack, reload and late-ack integration checks. |

### 6D-7 — Integration / Security / Lifecycle Acceptance

| File | Symbol/change | Why / risk | Tests |
|---|---|---|---|
| `native/WebTools.NativeHost.Checks/Program.cs` | End-to-end bounded checks for projection/search/invocation lifecycle. | Cross-layer drift; medium. | .NET NativeHost Checks. |
| `electron/plugins/*` focused test files; `electron/services/native-manager-*.test.mjs` | Integration/security/race coverage for registry, projection publisher, protocol and lifecycle. | Missing cross-component regressions; medium. | Focused tests then full `pnpm test`. |
| `docs/native-launcher-phase6d-validation.md` **new** | Record build identity, exact automated/manual evidence and acceptance status. | Evidence overclaim; low. | Review against actual command output. |
| `docs/phase6d-feature-platform-foundation-audit.md` | Update audit’s proposed plan status only after implementation evidence exists; do not rewrite this audit’s baseline. | Historical evidence clarity; low. | Documentation diff review. |

## 17. Compatibility Risks

- Keep Manifest v1 parser and package bytes unchanged. The adapter is read-time only.
- Keep existing plugin registry v1 persistence unchanged; Feature state is derived and projection cache is separately versioned.
- Keep `plugins-update` v1 and `LauncherPluginProjectionStore` behavior intact while adding a distinct v2 message/cache.
- Keep app/site local search merge, ranking, remembered-app behavior, top-eight cap, keyboard behavior and existing `/`, `?`, `file:` command routes unchanged.
- Do not change Manager on-demand lifecycle: no Electron start during ordinary Native search, and Manager remains a single reused process/window with existing readiness/ack semantics.
- `PluginCatalog.revision` is unsuitable as a content revision. Reusing it could incorrectly mark unchanged content as new and makes stale/equal-revision protocol behavior nondeterministic.
- The current Native result and selection model is flat; adding a non-actionable group heading without explicit mapping could make keyboard selection index an invalid row.

## 18. Security Risks

1. **Connected peer is not authenticated (P2).** `CurrentUserOnly` plus a positive self-reported PID does not prove the peer is the launched Manager. An arbitrary same-user process could connect first or submit manager commands accepted by the current pipe protocol. Implement OS-observed identity before treating pipe-originated Feature requests/acks as Manager-authorized, and test failure-closed behavior.
2. **Projection is non-authoritative.** A cached Feature can be stale or locally corrupt; it may show a row, but Main must reject execution if live plugin state, hash, grant, session, or revision changed.
3. **No sensitive context in 6D.** Do not read/serialize clipboard contents or any future Context value. Peer authentication is a foundation, not authorization to start Super Panel work.
4. **Keep renderer boundary narrow.** Native requests carry identity/gesture only. Do not expose archive paths, executable paths, grants, package bytes, filesystem access or Node APIs to renderer.
5. **Avoid process/path confusion.** Authenticate exact launched instance and start identity; never close, kill, or use another installation’s process as proof.

## 19. P0 / P1 / P2 / P3

These ratings describe current implementation evidence and future 6D acceptance gates; they do not claim a newly observed crash or data-loss event.

| Rating | Count | Finding |
|---|---:|---|
| P0 | 0 | No confirmed critical failure found in the audited source. |
| P1 | 0 | No confirmed severe production defect found in this audit scope. |
| P2 | 2 | (1) Pipe peer identity is unverified; must be solved before treating requests as a trusted Manager session. (2) Projection v1 is not reusable for v2 because it has different schema, no session/content-revision protocol, and a character-count parse bound; v2 must independently enforce exact UTF-8 byte limits and stale/equal-revision rules. |
| P3 | 2 | (1) Built-in Translation may appear beside the existing contextual Translation action; product behavior needs an explicit choice. (2) Future Manifest v2 must reserve a stable built-in FeatureRef namespace/ID so a package cannot collide with built-in identity. |

## 20. Recommended 6D-2 through 6D-7 Boundaries

Recommended sequence, with one dependency-order change from the proposal:

```text
6D-2 Contract + v1 Synthetic Adapter
  → 6D-3 Main Derived Feature Registry + Projection v2
  → 6D-4 Native Cache + SearchCore Feature Group
  → 6D-5 Actual Pipe Peer Authentication
  → 6D-6 Feature Invocation + Main Revalidation
  → 6D-7 Integration / Security / Lifecycle Acceptance
```

Move peer authentication ahead of invocation because the current pipe accepts a self-reported PID and 6D-6 depends on an authenticated live Manager session. Keep 6D-2 through 6D-4 sequential: their contract, snapshot and Native index are tightly coupled. Keep 6D-5 and 6D-6 sequential for the same transport boundary. No subagent split is recommended for the cross-process registry/protocol work; independent code ownership would increase contract and race risk. Phase 6D-7 is only after the implementation tasks.

Suggested gates: `pnpm run typecheck` after each TypeScript contract/registry/IPC foundation task; targeted `pnpm exec node --test ...` after each relevant testable slice; NativeHost Checks after C# store/search/auth slices; `pnpm run build` after cross-process contracts and again at final integration. Full final regression belongs in 6D-7, not this audit.

## 21. Final Phase 6D Acceptance Criteria

Phase 6D is complete only when all of the following have evidence:

- Manifest v1 validation and existing package bytes are unchanged and remain compatible.
- Every valid v1 declarative package with the required `manager.page` capability resolves to exactly one deterministic `legacy-manager-page` Feature.
- Main owns the live Feature authority; PluginManager/PluginCatalog/built-in state remain the underlying authorities; no competing persistent Feature registry exists.
- Main publishes complete bounded Projection v2 snapshots; Native validates/caches them separately from v1 and rejects stale/corrupt/oversize input fail-closed.
- Native searches Feature metadata through the existing SearchCore; Feature rows are independently limited to six and do not displace or reorder existing app/site top-eight rows.
- App/site search, Chinese/pinyin/initial matching, selection, `/`, `?`, and `file:` behavior pass parity checks.
- Native cache can display/search Features while Manager is closed; cache cannot authorize an invocation.
- Feature invocation uses an authenticated live Manager pipe session, rejects replay/stale session/revision/identity, and Main revalidates current package/hash/enabled/API/grants/runtime immediately before dispatch.
- Disable/update/uninstall/revoke and late-response races fail closed; Manager stays on demand, and normal Manager close returns Electron process group to zero while NativeHost stays resident.
- Actual pipe peer authentication rejects arbitrary same-user clients and validates packaged identity plus explicitly tested development identity behavior.
- No Manifest v2 package, web runtime, WebContentsView, plugin preload, WASM, network broker, clipboard read/transport, or Super Panel was introduced.
- Bounded synthetic 0/100/500/1,000/2,000 projection checks satisfy row/UTF-8 byte limits without retaining package/runtime payloads.
- Final typecheck, focused and full tests, NativeHost Checks, build, and `git diff --check` pass; Windows manual items are labeled by actual evidence, not inferred from source.

## 22. Open Human Decisions

1. **Built-in Translation visibility in Native local search:** Should it be a searchable Feature row in addition to the current contextual Translation action, or should equivalent rows be de-duplicated/suppressed? Recommendation: model Translation as a built-in FeatureRef, then explicitly avoid duplicate-looking rows while preserving the current translation handoff.
2. **Built-in Feature identity reservation for future Manifest v2:** Choose a stable built-in `featureId` and reserve that composite identity under `webtools.translation` for future author manifests. Recommendation: reserve the built-in namespace/ID in the v2 validator; do not alter Manifest v1.
3. **Development-mode pipe identity:** Packaged Manager has an exact executable identity, while development launch begins through Node/electron-vite. Decide whether tests will authenticate a specifically tracked launched child process or whether development mode should fail closed for Manager pipe features. Recommendation: specify and test a narrow child-identity policy; never weaken packaged-mode validation.

## Audit Checks

- Focused plugin, catalog, registry, Manifest, IPC, publisher and Native Manager protocol/client tests: **PASS, 59/59**.
- Command:

  ```text
  pnpm exec node --experimental-strip-types --test electron/plugins/plugin-manager.test.mjs electron/plugins/plugin-catalog.test.mjs electron/plugins/plugin-registry.test.mjs electron/plugins/manifest.test.mjs electron/ipc/plugin-handlers.test.mjs electron/ipc/plugin-catalog-handlers.test.mjs electron/services/native-plugin-projection-publisher.test.mjs electron/services/native-manager-protocol.test.mjs electron/services/native-manager-commands.test.mjs electron/services/native-manager-client.test.mjs
  ```

- `git diff --check`: **PASS** at audit start; CRLF conversion notices only.
- Full typecheck/build, full test suite, NativeHost Checks, installer and Windows runtime acceptance were intentionally not run; this was an implementation audit, not an implementation/acceptance phase.

## Final Gate

**Branch:** `codex/shared-ai-translation-2.0`

**HEAD:** `76e6e9a5c69ae3d0774c53eb5a3c37e6be9ef6a5`

**Upstream:** `origin/codex/shared-ai-translation-2.0` (`0 ahead / 0 behind`)

**Working tree:** existing pre-audit changes preserved; this report is the only new file.

**Files changed by this task:** `docs/phase6d-feature-platform-foundation-audit.md` only.

**P0 / P1 / P2 / P3:** `0 / 0 / 2 / 2`.

Recommended next sequence: **6D-2 → 6D-3 → 6D-4 → 6D-5 peer authentication → 6D-6 invocation → 6D-7 acceptance**.

Human decisions still required: Translation search visibility/deduplication; stable built-in Feature identity reservation; development-mode peer identity policy.

**Production implementation NOT started.**

**Phase 6D-2 NOT started.**

**等待人工审核。**

**PHASE 6D-1 FEATURE FOUNDATION AUDIT COMPLETE**
