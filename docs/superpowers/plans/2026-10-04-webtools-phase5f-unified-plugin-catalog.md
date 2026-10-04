# Phase 5F Unified Plugin Catalog Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task; use TDD and one independent final review.

**Goal:** Unify trusted built-in Translation and existing declarative plugin presentation without changing either execution model.

**Architecture:** Main owns a small catalog over a fixed built-in registry and the existing PluginManager's safe summaries. Manager consumes tagged identities for navigation and details. Translation stays always enabled through its existing `translate` section and literal bundled component map.

**Tech Stack:** Electron 44, Vue 3, TypeScript, Node test runner, pnpm 9.15.9.

**Spec:** `docs/webtools-phase5e-unified-plugin-architecture.md` and the user's Phase 5F authorization.

## Global Constraints

- Work in the existing `codex/shared-ai-translation-2.0` checkout; no production installation/profile/startup changes.
- Manifest v1/API major 1, third-party registry/grants/config and PermissionBroker remain authoritative and unchanged.
- No Translation disable, persistent built-in state, new handoff, SDK, dependencies, NativeHost or pipe changes.
- No polling, package rescan, extra service initialization, arbitrary component loading or raw IPC.
- Favorites home and independent Settings remain unchanged. Commit/push only reviewed 5F files after verification; no PR/release.

## Review Focus

1. Identical built-in/declarative IDs cannot share selection, navigation or authority (F1/F2 tests).
2. Reload/close and concurrent list/open must reject stale responses (F1/F2 tests).
3. Package-core failure leaves Translation available and shows the package failure, never a fake empty success (F1/F2 tests).
4. Disable/revoke/uninstall cannot resurrect a page from a late response (F2 tests).
5. Native Translation exact prefill and existing cancellation survive navigation integration (F3 smoke/regression).

## F0 — Verified Baseline

Branch `codex/shared-ai-translation-2.0`; HEAD `f0b1e18e3f9dc12026179db5ab7b416d17d31114`; clean tree; fetch successful; upstream divergence `0 0`. Read 5E report/plan and 5C/5D reports/plans; inspect actual Main, preload, plugin core, App/navigation/center and packaged smoke.

## Task F1 — Catalog Contracts, Main Projection and IPC

**Create:** `src/shared/plugin-catalog-contracts.ts`, `electron/plugins/builtin-plugin-registry.ts`, `electron/plugins/plugin-catalog.ts`, its test, `electron/ipc/plugin-catalog-handlers.ts`, its test.
**Modify:** `src/shared/ipc.ts`, `electron/preload.ts`, `electron/main.ts` only integration points.

**Contracts:** Tagged `PluginRef`, `CatalogEntryDTO`, `CatalogSnapshot`, `CatalogOpenDTO`, `PluginCatalogApi`. `PluginCatalog.list(session)`, `open(ref,session)`, `setEnabled(ref,enabled,session)`, `beginSession()`, `close()`. Fixed Translation record uses host version, bundled Languages icon, ready/enabled, `canToggle:false`; declarative records wrap existing safe summaries. Narrow preload `pluginCatalog.list/open/setEnabled`; list provides details and navigation projection inputs, so no duplicate endpoints.

Catalog has its own session and monotonically increasing list revision, even if core is unavailable. Main rotates it beside the existing once-only core reload/restore. Projection reads only `PluginManager.list`; open delegates existing `getPages` (and its full authorization/integrity checks). Check catalog and core session after each await. Built-in toggle rejects before touching core. IPC validates sender/main frame, exact arity and closed tagged references; return safe errors.

- [x] Write tests for fixed registry, same ID, disabled/permission/incompatible records, unavailable/throwing core, stale sessions, rejected malformed references and denied builtin toggle.
- [x] Run new tests RED (missing catalog/handlers), then implement minimal projection/handlers/wiring.
- [x] Run focused catalog/IPC/core tests GREEN and `pnpm run typecheck` before F2.

## Task F2 — Unified Navigation and Management Center

**Create:** `src/features/plugins/builtin-plugin-pages.ts`, `catalog-view-model.ts` and its test.
**Modify:** `src/App.vue`, `PluginManagerView.vue`, navigation tests/center tests; existing package view model stays package-specific.

**Consumes:** F1 tagged snapshots/open results. **Produces:** catalog key/ref/name/status/canOpen helpers, navigation projection and freshness predicates; closed literal Translation component resolver. App refreshes catalog on mount/reload and after mutations/errors, with refresh generation and snapshot revision checks. Page loads track tagged identity plus generation and latest package version/hash. Invalidation routes back to center.

Rename Applications to Plugins, order Translation then available declarative pages then always-reachable Plugin Management. Native `translate`/prefill bridge remains unchanged; both local builtin opens and Native aliases use the fixed component mapping. Center uses composite selection; built-in detail contains only bundled metadata/status/open, while the declarative branch retains all current package controls/consent paths. Partial package errors render alongside built-in content; mutations refresh even after safe errors.

- [x] Add RED identity/nav/status/stale-response/center rendering tests.
- [x] Implement App and center changes without TranslateView/Settings/provider edits.
- [x] Run focused view/navigation/Translation tests GREEN and `pnpm run typecheck` before F3.

## Task F3 — Regression, Isolated Package Smoke, Review and Checkpoint

**Create:** `scripts/verify-phase5f-plugin-catalog-smoke.mjs`, structural safety test, `docs/webtools-phase5f-unified-plugin-catalog.md`.
**Reuse:** 5D smoke identity/cleanup and fixture utilities. No public SDK or test hooks in production code.

- [x] Build Node/Main/preload/Renderer with `pnpm run typecheck`, `pnpm test`, `pnpm run build`; run `git diff --check`.
- [x] Package `win-unpacked` via existing electron-builder into a fresh external evidence directory. Reuse a verified Release Native artifact, fresh profile/unique resource-test pipe, exact executable/PID/creation identity and graceful cleanup.
- [x] Smoke Native-only Electron=0; Manager Favorites home; mixed nav/center; builtin opens; declarative config/enable/disable/revoke paths; exact Native Translation prefill using unconfigured AI (no provider); Manager close Electron=0/Native remains.
- [x] Perform a fresh read-only review of the complete 5F diff, patch only verified findings with regression tests, rerun affected checks.
- [x] Report exact source/artifact hashes, executed vs mock vs manual evidence, 5D dialog/visual gaps carried to 5I, and 5G prerequisites.
- [x] Stage only audited 5F files, inspect staged diff/check, commit `feat: unify Manager plugin catalog and navigation`, normal push current upstream, confirm clean/synchronized state.

## Rollback and Completion

Rollback source changes as a reviewed revert; no persistent format changes to reverse, no user data deletion. Built-in state/handoff remains 5G work. A core availability failure is visible and does not disable Translation. GUI dialogs/visual/accessibility not actually exercised remain manual, not claimed PASS. Complete when catalog/nav/center, existing safety boundaries, targeted/full tests, build and isolated package/lifecycle smoke pass and reviewed checkpoint is pushed; stop before 5G.

## Execution Record

F0–F3 executed serially. F1 new Catalog/IPC tests RED→GREEN/typecheck; F2 tests RED→GREEN/typecheck/full tests; F3 independently reviewed (one P2 Translation repeat-navigation mount regression fixed RED→GREEN), final 208/208/typecheck/build and packaged isolated Native/Manager smoke PASS. Existing 5D isolation driver extended behind opt-in 5F entry rather than copied. One list snapshot supplies metadata/details/navigation, preserving the approved narrow API. External evidence, hashes and manual gap labels are recorded in the 5F report. User-authorized checkpoint/push is the last operation after staged review; actual Git results are returned in the closeout. No 5G work.
