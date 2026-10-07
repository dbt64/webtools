# Phase 6D-6 — Feature Invocation & Main Live Revalidation

## Status

`PHASE 6D-6 FEATURE INVOCATION COMPLETE`

Automated implementation checks pass. This phase does not perform installed-app, Electron GUI, installer, or production smoke acceptance. Phase 6D-7 remains `NOT STARTED` and requires separate human review.

Security Gate 2 remains `COMPLETE`; this phase uses the existing authenticated Manager pipe and does not replace or weaken that gate.

## Baseline and working-tree layers

- Branch: `codex/shared-ai-translation-2.0`
- Committed HEAD remains the authorized baseline: `eb375590134fcdc28fa5a6a8b6cf18d9b198a9ea`.
- Upstream: `origin/codex/shared-ai-translation-2.0`; the branch is ahead 3 / behind 0. Those three commits predate this phase.
- No files were staged, committed, or pushed.

The working tree remains layered:

1. **Pre-existing Launcher improvement:** `docs/webtools-phase5i-launcher-improvement.md`, `native/WebTools.NativeHost.Checks/Program.cs`, `native/WebTools.NativeHost/MainWindow.xaml`, and `native/WebTools.NativeHost/MainWindow.xaml.cs`. The latter two C# files also contain later phase-specific additions; no earlier Launcher changes were replaced.
2. **Phase 6D-4:** projection publisher/cache/search integration, D4 checks, and `docs/phase6d4-native-feature-search.md`. The D4 `NativeFeatureProjectionStore` needed its FeatureRef validators in the type that owns them and `[JsonIgnore]` on the computed `IsValid` member so the closed JSON contract compiles and does not serialize a derived property. The D4 executor check was aligned with its generic “must not bypass ManagerController” refusal after invocation became implemented.
3. **Phase 6D-5:** actual Manager peer identity/authentication, process launch identity, authenticated pipe integration, D5 checks, and `docs/phase6d5-pipe-peer-authentication.md`.
4. **Phase 6D-6:** invocation contract/service, live revalidation and dispatch, Main/Native pipe correlation, Manager feature queue, App.vue route acknowledgement, D6 tests, and this report. `ManagerController.cs`, `MainWindow.xaml.cs`, `Program.cs`, and `ResultActionExecutor.cs` contain incremental D6 hunks layered over earlier D4/D5 or Launcher work.

No attempt was made to stage or commit overlapping phase layers.

## Invocation contract and authority

The closed Native → Manager request is:

```ts
{ requestId: UUID, ref: { pluginId, featureId }, source: 'launcher' }
```

The shared parser accepts only those exact own fields, a version-4 UUID, the existing bounded `FeatureRef` grammar, and the fixed `launcher` source. The UTF-8 JSON request limit is 1,024 bytes. The result is a closed discriminated contract (`accepted | rejected | failed`) with bounded machine-readable reason codes and a 256-byte UTF-8 limit. Native additionally verifies that the result request ID matches the queued invocation and rejects unknown response keys or invalid status/reason pairs.

Feature invocation uses the existing current-user-only, OS-peer-authenticated Manager Named Pipe. It is unavailable before the current Manager completes the existing OS PID/image/process-creation identity handshake. No second pipe or unauthenticated invocation path was added. The protocol never includes `pageId`, package/handler/runtime paths, grants, permissions, enablement state, or free-form source values.

The **Electron Main process remains the only execution authority**. Native sends a `FeatureRef`; the projection cache and search row are presentation-only. Projection revision is not treated as authorization.

## Live revalidation and mutation ordering

For declarative v1 compatibility Features, Main invokes `PluginManager.authorizeAndDispatchFeature` under the existing PluginManager serialized mutation queue. Before dispatch it checks the current Manager session, plugin/runtime identity and package hash, enabled/active state, requested and granted `manager.page` capability, current immutable package/integrity, exact FeatureRef and supported declarative entry kind, and that the resolved page still exists in the current manifest. It repeats mutation-sensitive checks after package loading. The synchronous Main-owned dispatch callback is the linearization point while the PluginManager queue is held; the asynchronous renderer acknowledgement is awaited after releasing that queue.

Disable, revoke, uninstall, package-integrity failure, feature mismatch, stale session, and permission changes during package revalidation reject without dispatch. No repair, enablement, grant, or stale-route fallback occurs. Main maps internal errors to bounded result codes and does not return paths, stack traces, package details, or secret values to Native.

For built-in Translation `(webtools.translation, translate-text)`, Main checks the current `BuiltinTranslationLifecycle.isEnabled()` state before opening the existing trusted Translation handoff. The Feature discovery query is not supplied as translation text. The separate existing contextual Translation action keeps its established explicit-text handoff behavior.

## Manager wake, readiness, and queue

`ManagerController.InvokeFeature` enqueues a copied, validated request into a FIFO with a maximum of **4** pending invocations. Duplicate in-flight request IDs and overflow are rejected. It reuses the existing serialized Manager startup gate and current process identity; rapid clicks while one startup is underway do not start another Manager. Dispatch waits on the existing renderer-ready task, not a fixed sleep. The production renderer-ready deadline remains **60 seconds**. Each pipe request has a **45-second** deadline, while Main’s renderer navigation acknowledgement has its existing **40-second** deadline.

The Native pipe correlates each transport acknowledgement to the pipe envelope; the invocation result separately correlates to the Feature request ID. Only the matching FIFO head completes. A timeout, disconnect, malformed response, or invalid acknowledgement returns a concise safe Launcher message. Delivery is not blindly retried after an uncertain response, because the feature may already have opened.

The Main service keeps an independent, bounded replay map of at most **2,048 unique invocation IDs per authenticated Manager session**, without eviction. Identical in-session replay returns the original pending/terminal promise; conflicting reuse is rejected as stale; overflow fails closed with `queue-full`. The map resets when the authenticated Manager session disconnects. This is a Main invocation budget, not the Native pipe server’s opposite-direction inbound-message limit.

## Declarative route and Translation handoff

After Main has resolved the current declarative feature, it submits only the FeatureRef through the existing narrow `open-feature` Main → App.vue intent. The renderer refreshes the current plugin catalog, confirms the supported declarative Feature identity, uses the existing catalog page opener, and acknowledges the exact request ID from the current main-frame sender. Native never selects a page ID or arbitrary route.

The built-in Translation Feature uses the existing Translation section/handoff with a `null` text context. Searching for “translation” or “翻译” therefore opens the existing Translation experience without translating the discovery query. Existing plugin/Translation provider implementations and contextual Translation behavior were not replaced.

## Replay, timeout, disconnect, and error behavior

- Same request ID and same body in one authenticated Manager session: return the original in-flight or terminal result without executing twice.
- Same request ID with a different body: reject as `stale-request`.
- New authenticated Manager session: starts a fresh replay namespace.
- Native queue capacity: 4; additional requests fail closed.
- Renderer readiness: bounded by 60 seconds in production; no arbitrary delay is used for readiness.
- Native pipe request: bounded by 45 seconds; Main page-intent acknowledgement: existing 40 seconds.
- Transport uncertainty: do not retry an invocation automatically.
- Native UI uses fixed concise messages for startup/readiness, plugin disabled, permissions, unavailable feature, timeout, disconnect, queue-full, and generic dispatch failure. Launch exceptions are logged by type only in the Launcher-facing branch; exception messages containing paths are not shown.

## Verification

The isolated NativeHost checks launch a disposable copy of the checks apphost through the real `ManagerProcessLauncher`, with a temporary test profile and random pipe. The test pipe uses the same `ManagerPeerIdentityService` as the launcher and verifies the OS-observed child PID, executable image, and process creation identity. The fixture never loads the production Manager or profile.

Checks cover:

- valid declarative and built-in Translation dispatch, including null search-query context;
- disable, uninstall, grant revoke, integrity failure, wrong Feature kind/ref, stale Manager session, and mutation during package revalidation;
- strict request/result schemas, byte limits, correlation, duplicate replay, conflicting IDs, replay cap, session reset, and fail-closed errors;
- unauthenticated Feature-shaped input rejection and Phase 6D-5 identity/authentication regression;
- an already-running Manager path, renderer readiness, two rapid FIFO dispatches, correlated acknowledgements, queue drain, and process reuse;
- a cold Manager launch with two rapid requests, exactly one fixture Manager process, authenticated hello, renderer readiness, and invocation on that same PID;
- a bounded renderer-ready timeout and a rejected hello PID, both with no feature dispatch;
- existing D4 search/projection, D5 peer authentication, NativeHost behavior, and Plugin Catalog route validation.

The Main replay entry is recorded synchronously before dispatch starts. This also makes a synchronous re-entrant duplicate from the authority callback resolve to the already registered invocation instead of authorizing twice; a focused regression test asserts one authorization and one dispatch.

`ManagerController` has an internal-only renderer timeout injection used by checks (500 ms / 2 seconds); the production default remains 60 seconds and the injected range cannot be non-positive or exceed 60 seconds.

Fresh verification for this closeout:

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — 410/410 (Node emitted existing `MODULE_TYPELESS_PACKAGE_JSON` warnings) |
| `pnpm run build` | PASS — Electron Main, preload, and Vue Renderer |
| `dotnet build native/WebTools.NativeHost/WebTools.NativeHost.csproj -c Release` | PASS — 0 warnings, 0 errors |
| `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj -c Release` | PASS — 71/71 |
| `git diff --check` | PASS — run after the final report edit |

No Windows installer, installed WebTools, production tray/profile, real Electron Manager, GUI interaction, or Manager process-group close was used. Automated checks executed the current source/build logic with isolated protocol and disposable process/profile fixtures; they did not exercise an installed production app or its user profile. These checks are not packaged-app acceptance.

## Security self-review

- Cached Native metadata can authorize execution: **No**.
- Native can choose a `pageId` or route: **No**.
- A disabled, uninstalled, integrity-invalid, or ungranted declarative Feature can dispatch from a stale result: **No; Main revalidates current state**.
- An unauthenticated or stale Manager peer can invoke: **No; the existing authenticated current peer is required**.
- A duplicate invocation can execute twice in one session: **No; replay state is at-most-once**.
- A search query becomes Plugin or Translation context: **No**.
- Invocation makes Electron permanently resident: **No lifecycle policy change**.

## Findings and remaining acceptance

- P0: 0
- P1: 0
- Blocking P2: 0
- P3: 0

No unresolved automated verification blocker remains. Packaged Windows E2E, actual `.wtplugin` user workflow, real Manager close → Electron process-group zero, persistent projection refresh after restart/uninstall, actual packaged peer authentication, and development Node → Electron Job inheritance remain for Phase 6D-7 manual/runtime acceptance. These are untested acceptance paths, not claims of product failure.

## Proposed Phase 6D-7 manual E2E checklist — not executed

1. Install a test `.wtplugin` through Plugin Center, approve only its declared `manager.page` capability, and verify it appears in the Manager catalog and Native Launcher.
2. Invoke it from a cold NativeHost with Manager closed. Verify one Manager starts, the current page opens, and repeated feature clicks reuse that Manager.
3. Disable the plugin while a previously projected Launcher row is still visible; invoke the stale row and verify a safe rejection, no page opens, and the next projection removes it. Repeat after grant revoke and uninstall.
4. Close Manager normally and verify the Electron process group returns to zero while NativeHost and cached local search remain available. Reinvoke the cached Feature to verify cold wake again.
5. Restart NativeHost and verify installed/enabled plugin state and the rebuilt Feature projection. Uninstall and confirm the Feature disappears after the next full projection.
6. Verify built-in Translation appears with enabled plugins, opens the existing Translation section with no discovery query prefilled, and disappears/rejects after Translation is disabled.
7. On the packaged acceptance build, verify the real NativeHost ↔ Electron peer authentication and invocation path. In a separate authorized development run, verify the Node → Electron child belongs to the expected Windows Job and can authenticate.

This checklist is proposed for review only. It is not Phase 6D-7 execution or a claim of manual acceptance.

## Explicitly outside this phase

Sensitive Context, Clipboard integration, Manifest v2, Web Plugin Runtime, SDK v2, and Super Panel are not implemented by Phase 6D-6.

## Files changed by Phase 6D-6

- `src/shared/feature-invocation-contracts.ts` and focused tests
- `src/shared/ipc.ts`
- `src/shared/native-manager-intent.ts` and focused tests
- `electron/services/feature-invocation-service.ts` and focused tests
- `electron/services/native-manager-commands.ts` and tests
- `electron/services/native-manager-client.ts` and tests
- `electron/plugins/plugin-manager.ts` and tests
- `electron/main.ts`, `electron/preload.ts`, `electron/ipc/window-handlers.ts`
- `src/App.vue` and Plugin Catalog lifecycle tests
- `native/WebTools.NativeHost/Services/NativeFeatureInvocationProtocol.cs` (new)
- `native/WebTools.NativeHost/Services/NativeFeatureInvocationQueue.cs` (new)
- `native/WebTools.NativeHost/Services/ManagerController.cs` (D5 lifecycle plus D6 invocation additions; internal timeout seam for checks, production remains 60 seconds)
- `native/WebTools.NativeHost/Services/ResultActionExecutor.cs` (generic execution remains fail-closed)
- `native/WebTools.NativeHost/MainWindow.xaml.cs` (small D6 activation addition layered over prior Launcher/D4 hunks)
- `native/WebTools.NativeHost.Checks/Phase6D6Checks.cs` (new)
- `native/WebTools.NativeHost.Checks/Program.cs` (D6 check registration and gated child-fixture entry point, layered over Launcher/D4/D5 registrations)
- `docs/phase6d6-feature-invocation.md` (this report)

`docs/webtools-phase5i-launcher-improvement.md`, the earlier Launcher geometry/icon changes, the D4 files, and the D5 files remain unstaged and uncommitted.
