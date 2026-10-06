# Phase 6D-3 — Main Derived Feature Registry & Feature Projection v2 Producer

- **Date:** 2026-10-06
- **Branch:** `codex/shared-ai-translation-2.0`
- **Baseline HEAD:** `8072d9590d6a6208aa12504da6211be4f0ab3bc88`
- **Upstream:** `origin/codex/shared-ai-translation-2.0` (`2 ahead / 0 behind`)
- **Status:** `PHASE 6D-3 FEATURE REGISTRY / PROJECTION COMPLETE`

## Phase C projection clarification

The frozen 6C projection document declared `featureKind` as `declarative-compatibility | web`, while the frozen platform architecture and 6D-2 contract assign built-in Translation the identity `(webtools.translation, translate-text)`. Phase 6D-3 must project that built-in Feature, and its scope does not implement Web Features. Following the user's approved clarification, the Projection v2 enum is now exactly `declarative-compatibility | built-in`. The illustrative row in the 6C projection document now shows the existing built-in Translation metadata. This is a narrow consistency correction; it does not add a built-in plugin system, Manifest field, Plugin API, persistence schema, or other source kind.

## Ownership and source mapping

`FeatureRegistry` is a process-scoped, Main-owned, derived and non-persistent view. It does not become an authority and does not write a Feature registry file. Current authority remains in `PluginManager` / `PluginRegistry`, validated package contents and grants, plus `BuiltinTranslationLifecycle` for Translation enablement.

- **Declarative v1:** `PluginManager.listFeatureCandidates()` serializes the read through its existing mutation queue, requires the current package to pass its existing hash and package validation, checks persisted enabled state and the current `manager.page` request/grant, and maps the still-valid page through `adaptDeclarativeV1Feature`. It returns only the plugin display name and Main-only Feature metadata. It does not start a runtime or return archive bytes, filesystem paths, assets, grants, or package records.
- **Built-in Translation:** when `BuiltinTranslationLifecycle.isEnabled()` is true, the registry adds the existing `(webtools.translation, translate-text)` Feature. The Host-owned label is `翻译`, with stable English aliases `Translate` and `Translation`. Lifecycle state remains owned by `BuiltinTranslationLifecycle`.
- **Composite identity:** a same-ID declarative package can coexist with built-in Translation because `legacy-manager-page` and `translate-text` are distinct Feature IDs under the same plugin ID.
- **Resolution:** `resolve(ref)` returns a defensive Main-only `{ pluginName, feature }`, including a declarative `pageId` only inside Main. The public projection is separately constructed and never contains `pageId`.

Feature eligibility does not mean that a Plugin runtime has started. The candidate read only validates and adapts current metadata. A tampered or inaccessible current package is excluded. Main must still revalidate live authority before any future invocation; invocation is not implemented here.

## Projection v2 and bounds

The shared closed DTO contains only:

`projectionVersion`, `hostSessionId`, `revision`, diagnostic `generatedAtUnixMs`, and `features[]` rows with `ref`, `pluginName`, `title`, `commands`, `acceptedContexts`, `iconToken`, `featureKind`, and `group`.

The parser reconstructs a defensive normalized DTO and rejects unknown/missing fields, accessors or custom shapes, invalid/duplicate composite refs, invalid enums, invalid identity/session/revision/time, invalid text and context metadata, duplicate aliases, and over-capacity collections. Allowed icon tokens are `plugin`, `sparkles`, `document`, `globe`, and `translate`; Feature kinds are exactly `declarative-compatibility` and `built-in`; group is `plugin-features`. Current sources project empty accepted-context metadata; no query, clipboard value, or other context value is transported.

First-release bounds are enforced as safety limits:

- 16 Features per plugin;
- 2,000 Features globally;
- at most 8 aliases per Feature, each at most 48 Unicode scalar values;
- plugin display name and title at most 80 Unicode scalar values;
- at most one accepted `text` context metadata item with unique sources from `launcher-input` and `clipboard`;
- 3 MiB maximum serialized UTF-8 DTO size, measured with `TextEncoder` over the exact JSON serialization.

Any duplicate identity, invalid row, or exceeded bound fails the complete derivation; rows are never truncated. `generatedAtUnixMs` is diagnostic only and is excluded from content identity.

## Ordering, session and content revision

Every Main Feature Registry instance creates a random UUID `hostSessionId`. Its initial complete empty snapshot uses revision 1. Rows are sorted by ordinal `pluginId`, then ordinal `featureId`; this is deterministic serialization order, not search ranking.

After DTO normalization, canonical content identity is the JSON serialization of the ordered Feature rows with fixed parser-owned property order. It excludes timestamp, host session and revision. Repeated reads or normalization-equivalent source text preserve the revision; changed projected content increments it monotonically within the session. The registry coalesces concurrent refreshes and discards a derivation made stale by a newer invalidation. Snapshots and resolved entries are defensive copies.

## Mutation invalidation and publisher

`PluginManager` exposes a narrow Feature-authority change subscription. It notifies after authoritative initialization, committed install/enable/disable/grant changes, uninstall's persisted disable and final removal, integrity failure, and Manager-session restoration. A cancelled or failed pre-commit install does not notify. `BuiltinTranslationLifecycle` notifies derived readers after stable successful state changes and after a fail-closed transition to faulted state; it does not publish its temporary enabling/stopping state.

Main owns one `FeatureRegistry`, subscribes to both authorities, refreshes once after startup, and disposes the subscriptions and registry at shutdown. Refresh failures are logged and cannot turn an already-committed authoritative mutation into an IPC failure. Existing `plugins-update` v1 behavior is unchanged.

`NativeFeatureProjectionPublisher` is a transport-independent full-snapshot queue. It validates and serializes a complete v2 DTO, serializes queued work, permits a later retry after a queue failure, and suppresses work that has not yet been enqueued when closed. **It is intentionally not connected to NativeManagerClient or the current v1 pipe:** current NativeHost does not recognize Projection v2, so this phase sends no v2 message and changes no NativeHost code. Transport negotiation, Native cache parsing and publication activation belong to 6D-4.

## Compatibility and scope boundaries

- Manifest v1 parser, package validation, package bytes, and `PluginRegistry` persistence schema are unchanged.
- Existing `PluginCatalog`, v1 launcher projection/publisher, `plugins-update` message semantics, Translation handoff/providers and Manager navigation remain unchanged.
- No Feature registry file or other persistent state was introduced.
- No preload/renderer API or IPC handler was added.
- NativeHost product code was not modified. Four pre-existing Launcher edits remained untouched and unstaged.
- No dependency, package script, or lockfile was changed.
- Tests use isolated temporary directories; `D:\webtools` and `%APPDATA%\Nook` were not accessed.
- No Windows installer, production smoke test, stress test, or Native pipe runtime test was run; v2 transport is intentionally inactive in 6D-3.

## Files changed for Phase 6D-3

- `src/shared/feature-contracts.ts` — Projection v2 DTO, closed parser, limits, and canonical row-content identity.
- `src/shared/feature-contracts.test.mjs` — closed schema, normalization, enum, duplicate, size-boundary and content-identity tests.
- `electron/plugins/feature-contracts.ts` — safe candidate contract and Host-owned Translation aliases.
- `electron/plugins/plugin-manager.ts` — validated eligible v1 candidate read and narrow authority-change notifications.
- `electron/plugins/builtin-translation-lifecycle.ts` — stable state-change subscription for derived readers.
- `electron/plugins/builtin-translation-lifecycle.test.mjs` — lifecycle notification regression.
- `electron/plugins/feature-registry.ts` — Main-only registry, candidate aggregation, deterministic ordering, revision, defensive snapshot and refresh coalescing.
- `electron/plugins/feature-registry.test.mjs` — registry behavior, real isolated PluginManager eligibility, install/enable/update/disable/uninstall projection changes, integrity exclusion, invalidation and non-persistence tests.
- `electron/services/native-feature-projection-publisher.ts` — transport-independent full-snapshot queue.
- `electron/services/native-feature-projection-publisher.test.mjs` — serialization order, failure recovery, validation and close-race tests.
- `electron/main.ts` — registry construction, authority subscriptions, startup refresh and shutdown disposal.
- `docs/phase6c-native-feature-projection.md` — only the approved built-in enum/example consistency correction.
- `docs/phase6d3-feature-registry-projection.md` — this implementation report.

## Verification

| Check | Result |
|---|---|
| `pnpm test` | **PASS — 390/390** |
| Focused Projection v2 + FeatureRegistry tests | **PASS — 21/21** |
| Focused Feature Projection publisher tests | **PASS — 3/3** |
| `pnpm run typecheck` | **PASS** |
| `pnpm run build` | **PASS** — Main, preload and Renderer production bundles built |
| `git diff --check` | **PASS** — only Git LF-to-CRLF working-copy notices |

The full Node test run printed a port-in-use message from an existing Translation test (`24678`); that test passed and the suite completed 390/390. No additional runtime or package build was needed for the v2 transport boundary because no Native message was activated.

## Review findings

- Read-only review identified that the earlier integration assertions did not verify projection removal on active disable/uninstall or changed metadata after package update. The isolated PluginManager + FeatureRegistry test now checks the complete snapshot and content revision through enable, same-ID version update, disable with `manager.page` still granted, re-enable, and uninstall.
- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 0

The Phase 6C enum/example mismatch was corrected as described above. No unresolved implementation defect was found in the automated checks. Native v2 transport and Native-side acceptance remain intentionally unimplemented work in 6D-4, not a 6D-3 blocker.

## Git boundary and phase decision

The implementation baseline remains `8072d9590d6a6208aa12504da6211be4f0ab3bc88`; no files were staged or committed and no push was made. The pre-existing protected Launcher changes remain separate from this report's 6D-3 modifications.

**6D-3 implementation complete. 6D-4 NOT started.**

Manifest v1 unchanged. `PluginRegistry` persistence unchanged. NativeHost product code unchanged. Feature invocation NOT implemented. Pipe authentication NOT implemented. Web Plugin Runtime NOT implemented. Clipboard NOT implemented.
