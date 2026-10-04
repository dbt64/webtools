# Phase 5G — Built-in Translation Lifecycle Migration Plan

## Git and Source Baseline

- Branch: `codex/shared-ai-translation-2.0`.
- Base: `a5d8522aac69b79a91951f4f952c9d4b8abea0d1` (`feat: unify Manager plugin catalog and navigation`).
- Upstream: `origin/codex/shared-ai-translation-2.0`; fetched and equal at planning time.
- Initial worktree: clean. No `AGENTS.md` was found under the repository.
- Phase 5F report and current code agree: the bundled Translation descriptor is always enabled, `canToggle:false`; `PluginCatalog` rejects builtin toggles; App routes its fixed builtin page to the existing `TranslateView`; translation IPC currently has no builtin enable gate; Native intents use one Main pending intent and the existing renderer acknowledgement.
- Protected data/paths: `D:\webtools`, `%APPDATA%\Nook`, production plugin/Favorites/Settings/SecretStore data, startup registration, and unrelated processes. All persistence, package, pipe and process smoke must use a newly created isolated profile/install root outside those locations.

## Authority and Constraints

The approved Phase 5E report is the binding design. Keep Translation ID `webtools.translation`, composite `(kind,id)` identity, Manifest v1/API major 1, existing declarative `PluginManager`, shared AI service and credential storage, NativeHost C# and Named Pipe contracts, and existing Translation providers/configuration. Do not start Phase 5H or 5I. Do not add dependencies or a second plugin registry. Native disabled handoff must acknowledge prompt presentation before waiting on user choice, retain only one exact-text Main-memory slot, and never call a provider before the user explicitly enables Translation.

## Current Translation and Native Handoff Paths

`electron/main.ts` creates one `TranslationService`, registers `electron/ipc/translation-handlers.ts`, and owns one `PluginCatalog` and `BrowserWindow`. `translate:run` and `translate:open-google` currently guard only the Manager main frame. `TranslationService.cancelAll()` is available, separate from `SharedAIService`, while the Main helper `cancelActiveAIRequests()` is broader and also cancels AI connection tests. `TranslateView.vue` owns its form/request gate and current 450 ms auto-translate behavior; it applies Native prefill exactly, invalidates prior results, and emits `prefillApplied` after the prop value reaches the input.

Native `open-page:translate` and `translation-prefill` arrive through `NativeManagerClient`, are held in `pendingNativeIntent`, and are delivered after `managerReady()`/Native renderer readiness. Ordinary page intents use `acknowledgeNativeManagerIntent`; prefill is currently acknowledged after `TranslateView` reports application. 5G will route both Translation intents through a Main-owned handoff state machine. The C# pipe schema and NativeHost remain unchanged.

## Interfaces and Ownership

- Add a bounded, strict `BuiltinPluginStateStore` at `<userData>/builtin-plugins/state.json`. It owns only schema-versioned state for fixed host IDs. Missing means first-run defaults (Translation enabled); invalid, unsupported, unreadable or unsafe data is a distinct unavailable state and is never overwritten by an ordinary enable/toggle.
- Add a Main-owned `BuiltinTranslationLifecycle` as the single admission/state authority. It serializes writes, closes admission synchronously at disable start, cancels only `TranslationService` work, generation-checks commits/results and supports explicit confirmed backup-and-repair for corrupt state.
- Keep `PluginCatalog` as the sole catalog projection/router. Extend only the builtin state/toggle/recovery contracts; declarative entries continue to delegate to `PluginManager` and cannot acquire builtin privileges by matching an ID.
- Translation IPC receives a narrow synchronous admission/generation port. Provider-info/settings remain available; `translate:run` and Google external-open are gated in Main. Translation results are rejected after lifecycle/session generation changes.
- Add a closed Main handoff API and renderer DTO. Main retains one request ID, Manager-process session, UI generation and exact text (bounded to 20,000 characters). Renderer may request projection and report fixed dispositions but cannot supply replacement text, plugin identity or enable authority.
- Keep `TranslateView.vue` and the 5F literal builtin component mapping. Add only lifecycle-ready acknowledgement if needed. Preserve existing provider behavior and auto-translate after an explicitly enabled page is opened.
- Add a small disabled/unavailable gate view, explicit enable-and-open/cancel actions, and a retained/resume/discard affordance if a pending handoff survives local navigation.

## Task 1 — State Store and Main Lifecycle Authority

**Depends on:** verified 5F baseline.

**Files:**

- Add `electron/plugins/builtin-plugin-state.ts` and `electron/plugins/builtin-plugin-state.test.mjs`.
- Add `electron/plugins/builtin-translation-lifecycle.ts` and focused lifecycle tests.
- Modify only the shared builtin status contract and Main construction/wiring required to create one lifecycle instance.

**Steps:**

1. Write store tests first for absent/default-enabled, valid disabled reload, malformed/unsupported/oversized state, safe path rejection, unknown inert IDs, atomic replacement, write failure and preserved recovery backup.
2. Implement the 16 KiB/depth-4/32-record closed schema, fixed known ID, absent-vs-invalid distinction, canonical/reparse checks, exclusive same-directory temporary file, file sync and atomic rename. Do not call `ManagedFs.initialize()` because that would create unrelated package directories.
3. Write lifecycle tests first for synchronous admission closure, translation-only cancellation, serialized rapid enable/disable, stale Manager session, failed write/faulted state and explicit confirmed recovery.
4. Implement fixed Translation runtime state, an intent generation and serialized persistence. A write failure never reports success and remains fail-closed until an explicit retry/recovery; successful re-enable never resurrects old requests.
5. Initialize the store once in Electron Main alongside the existing userData profile without delaying NativeHost-only operation (Electron is already Manager-only). Keep all paths Main-only.

**Verification:** focused state/lifecycle tests, then `pnpm run typecheck`.

## Task 2 — Catalog, IPC, Manager Center and Navigation

**Depends on:** Task 1 contracts and lifecycle implementation.

**Files:**

- Modify `src/shared/plugin-catalog-contracts.ts`, `src/shared/ipc.ts`, `electron/preload.ts`.
- Modify `electron/plugins/builtin-plugin-registry.ts`, `electron/plugins/plugin-catalog.ts`, `electron/plugins/plugin-catalog.test.mjs`.
- Modify `electron/ipc/plugin-catalog-handlers.ts` and its test.
- Modify `src/features/plugins/catalog-view-model.ts` and tests, `PluginManagerView.vue`, `src/App.vue` and navigation/lifecycle tests.
- Wire state store recovery confirmation through a narrow Main-only catalog operation.

**Steps:**

1. Add failing tests for ready/disabled/transitioning/unavailable DTO projections, builtin toggle, malformed/forged references, same-ID declarative isolation, expired session and failed-write refresh.
2. Implement real `canToggle`/state projection. Disabled builtin cannot open; declarative plugin behavior remains byte-for-byte at its existing authority. Never add builtin installation, replacement, uninstall, grant or generic invoke controls.
3. Expose status/toggle and confirmed backup-repair only through closed Manager main-frame IPC. Validate before and after awaited operations; no filesystem paths or raw errors cross preload.
4. Add builtin toggle/retry and state error/repair guidance in the existing plugin center. Translation nav is present only when Main reports enabled/ready; center and Settings remain available. Refresh without polling and return a now-disabled Translation route to the plugin center.
5. Preserve Favorites default, explicit Settings, same-active-Translation mount behavior and third-party plugin operations.

**Verification:** focused catalog/IPC/view-model/App tests, then `pnpm run typecheck` and relevant plugin smoke unit tests.

## Task 3 — Translation Admission and Native Handoff Gate

**Depends on:** Tasks 1–2; keep Main and App routing changes together.

**Files:**

- Modify `electron/ipc/translation-handlers.ts` and focused handler tests.
- Add `electron/services/builtin-translation-handoff.ts` plus unit tests.
- Add `src/shared/builtin-translation-contracts.ts` and the narrow handoff API to `src/shared/ipc.ts`/`electron/preload.ts`.
- Modify `electron/main.ts`, `PluginCatalog` only where projection requires it, `src/App.vue`, `BuiltinTranslationGate.vue` and tests. Modify `TranslateView.vue` only for necessary page-ready/lifecycle acknowledgements; keep its translation engine behavior unchanged.

**Steps:**

1. Write failing translation-handler tests for disabled rejection, disable-during-request cancellation/late response, Google-open gate, enabled provider behavior and unrelated shared-AI work continuing.
2. Gate translation execution in Main using captured lifecycle/session generations. Reject new work synchronously when disabled/transitioning; after awaits discard stale results. Do not cancel SharedAI connection tests or declarative AI requests.
3. Write handoff tests for enabled exact prefill, disabled gate presentation, >45-second user wait after presentation, bounded unpresented deadline, duplicate/superseding requests, reload with new UI generation, cancel, confirmed enable, failed persistence, close, stale session/ack, page-only intent and exact whitespace/punctuation/Unicode preservation.
4. Implement one Main-owned handoff slot. Generic `acknowledgeNativeManagerIntent` cannot settle Translation intents. Disabled transport is acknowledged only after the gate is mounted; enabled prefill is acknowledged only after the exact text is applied. Keep the Native pipe contract unchanged.
5. Reproject the Main-owned slot after renderer readiness/reload. Cancel/discard is terminal; close clears retained text; superseding Native intent invalidates older UI generations. No text is written to disk or logs.
6. Add explicit disabled/unavailable UI with enable-and-open and cancel; disclose the existing auto-translation behavior before confirmation. No provider runs before explicit enable. Local navigation preserves a resume/discard path.

**Verification:** focused handler, handoff, gate and TranslateView lifecycle tests, then `pnpm run typecheck` and `pnpm run build`.

## Task 4 — Regression, Isolated Windows Build/Smoke, Review and Report

**Depends on:** Tasks 1–3.

**Files:**

- Add `scripts/verify-phase5g-translation-plugin-smoke.mjs` and its structural/isolation test.
- Add `docs/webtools-phase5g-builtin-translation-migration.md`.
- Update existing Translation/catalog/handoff tests only where required; do not weaken 5F tests.

**Steps:**

1. Cover MyMemory, AI and Qwen-MT using fake transports/credentials; no real token/provider calls. Verify Google remains manual, provider info/settings remain accessible and existing 450 ms automatic behavior remains intact after explicit open.
2. Verify test profile includes only the new builtin state; existing DataStore, SecretStore, declarative registry/config/data, Favorites and NativeHost state are not rewritten by toggle/recovery. Verify corrupt recovery leaves a retained backup.
3. Use the existing isolated packaging/smoke harness patterns with unique profile, install root and pipe. Verify Native-only has Electron=0; Manager starts once; state disable survives restart; disabled Native Translation presents a gate and cancel causes zero provider/Google calls; explicit enable hands off exact text; a fixture declarative AI consumer remains independent; normal Manager close returns target Electron group to zero while NativeHost remains.
4. Run full `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm exec electron-builder --win --x64 --dir` (output outside repo), applicable NativeHost and UpdateHelper checks, smoke syntax/isolation checks and `git diff --check`.
5. Perform a separate whole-diff code review focused on state corruption/write failures, identity spoofing, translation admission, stale request/result handling, handoff timing/session reload and production data isolation. Fix only confirmed Phase 5G defects with test-first evidence.
6. Record actual automated, isolated packaged and user-manual gaps in the Phase 5G report. Never label Mock or programmatic DOM checks as physical Windows GUI acceptance.

**Task 4 execution record — 2026-10-04:** Complete. Final verification: typecheck PASS; Node tests 243/243 PASS; Electron build PASS; NativeHost Checks 55/55 PASS; UpdateHelper Checks 10/10 PASS; NativeHost `win-x64` self-contained publish PASS; electron-builder Windows unpacked Manager PASS; packaged Phase 5G NativeHost/Manager smoke PASS; PowerShell AST and Node syntax checks PASS; `git diff --check` PASS after removing a stray EOF blank line. The smoke ran from a Unicode/space TEMP root with a unique Native pipe and isolated profile, verified disabled gates, Settings/provider access, declarative AI independence, exact handoff/persistence, unrelated profile-file hashes, normal Manager close/reopen, and final process exit. It did not use physical input, real credentials, external providers, a graphical installer, the installed production app, or user data. See `docs/webtools-phase5g-builtin-translation-migration.md` for artifact hashes and evidence path.

**Review findings:** No P0, P1, or blocking P2 product issue. Two Phase 4F static tests asserted the old generic Translation page-intent shape; the assertions were updated to verify the new narrow intent and preserved Native command contract. The full regression passes after the update. Product code changes remain within approved Phase 5G boundaries; no NativeHost C# or pipe schema change.

**Checkpoint:** Implementation and verification are complete; the approved local checkpoint and normal upstream push are the final actions for this task.

**Commit/push:** after all gates and review, stage only Phase 5G plan/code/tests/report, inspect staged diff, commit with a specific Phase 5G message and normally push the current upstream. No force push, merge, PR, tag or release.

## Dependency Graph and Completion Gate

```text
G0 baseline → G1 plan → Task 1 state/lifecycle
                         ↓
                       Task 2 catalog/UI
                         ↓
                       Task 3 admission/handoff
                         ↓
                       Task 4 full regression, isolated smoke, review, report, commit/push
```

After Task 1 and Task 2, run `pnpm run typecheck` before dependent code. Task 3 also runs typecheck/build. Task 4 runs the full suite and isolated Windows verification. Do not declare completion if any blocker remains; record physical UI items as manual verification required. Stop at `PHASE 5G COMPLETE — PENDING PHASE 5H APPROVAL`; do not begin 5H/5I.
