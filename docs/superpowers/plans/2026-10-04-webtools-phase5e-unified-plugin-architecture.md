# Phase 5E — Unified Plugin Architecture and SDK Contract Plan

**Goal:** Audit current Phase 5C/5D and Translation source; deliver an approval-ready unified registration/navigation/lifecycle design and file-level 5F–5I implementation sequence. Complete only design and its authorized documentation checkpoint now.

**Architecture:** Recommend a Main-owned `PluginCatalog` above the existing declarative `PluginManager`, with fixed bundled metadata/lifecycle and a concrete declarative projection. Tagged identities and separate stores preserve trust, data and package contracts. SharedAIService stays independent. No general code loader or adapter framework.

**Tech stack:** Existing .NET 10 WPF NativeHost; Electron 44.4.5 Main/sandboxed preload; Vue 3 closed-section Manager; TypeScript; pnpm 9.15.9; Node test runner; current yauzl archive validator and Native-first packager.

**Design spec:** [Phase 5E architecture report](../../webtools-phase5e-unified-plugin-architecture.md), especially §§6–12. The user's revised roadmap supersedes the older SDK-in-5E/acceptance-in-5F schedule without rewriting historical reports.

## Global Constraints

- This task changes only this plan and the report. No product implementation, package/SDK tooling/sample, dependency/lockfile, user-data schema, Native code or installer change.
- Protect `D:\webtools`, `%APPDATA%\Nook`, installed plugin archives/config/data, Favorites, Settings, secrets/tokens and startup registration. Read repository source only; no real profile inspection needed.
- NativeHost remains resident owner; Manager remains on-demand, one window/process group, normal close returns Electron=0. No Native plugin scan, new daemon or Electron Launcher restoration.
- Manifest v1/API major 1 and installed declarative registry/grants remain valid. No executable plugin variant, dynamic untrusted import/require, worker/child-process/utilityProcess host.
- Phase 5F–5I below are future tasks requiring separate approval at each phase. No automatic execution after design approval, no automatic future Git/release operation.
- The current user explicitly authorizes committing/pushing **only the two reviewed 5E docs**. Normal current-upstream push; no force/merge/PR/tag/release.

## Review Focus

Identity/type cannot promote a local package to bundled code; catalog cannot duplicate package authority; disable cannot dispatch Translation through retained preload APIs; handoff cannot wait for user input on the 45 s transport deadline; state-write/reload/cancel races must be testable. Existing automatic Translation UX and global AI configuration must remain intact. Historical tests and manual gaps retain their original evidence labels.

## Current Source Baseline

- `codex/shared-ai-translation-2.0` at `b5612be6dd85cd7a5a83411631ee971d16c4dbed`.
- Upstream `origin/codex/shared-ai-translation-2.0`; fetched, synchronized `0 0`, initial worktree clean.
- 5D committed/pushed, 5C checkpoint `e1147f0b2ec7fca7fb3fc14ee864384e6cfee330`.
- Current SFC `TranslateView` schedules configured automatic translation at 450 ms, including prefill. Keep this code-grounded behavior; do not adopt the overbroad historical “prefill never submits” wording.
- Current `PluginManager` is a declarative package manager; `PluginSummary` is not a built-in DTO. Its `ManagedFs.initialize` creates package subdirectories, so use a dedicated bounded built-in state file implementation instead of broad filesystem refactoring.

## Phase 5E Execution Record — Design Only

### E1 — Baseline and Historical Scope

**Files read:** Git; Phase 5A–5D reports; 5B/5C/5D plans; 4F removal; 4G-6 closeout.

**Contract:** Source is actual current committed 5D, new roadmap explicit, production protected.

- [x] Verify branch/HEAD/status/log, fetch and left/right upstream count.
- [x] Confirm no unknown modifications and no repository AGENTS.md found in inspected workspace/parents.
- [x] Preserve historical reports, measurements and remaining manual gaps.

### E2 — Actual Core, IPC and UI Audit

**Files read:** `electron/plugins/*`, `electron/ipc/plugin-handlers.ts`, `electron/main.ts`, `electron/preload.ts`, shared contracts/ipc, `src/App.vue`, `src/features/plugins/*`, relevant tests/5C–5D smokes.

**Contract:** Identify reusable package validation/runtime, lifecycle/session ownership, safe DTOs and navigation seams.

- [x] Trace strict Manifest/ZIP validation, immutable archive identity and registry recovery.
- [x] Trace enable/grants/replace/uninstall intents and pending AI review invalidation.
- [x] Trace sender/argument/session checks and Manager close/reload.
- [x] Confirm fixed declarative Vue blocks and UI-generation guards; distinguish page unmount from stopping every Main operation.

### E3 — Translation, Settings and Native Intent Audit

**Files read:** TranslateView and lifecycle tests; translation contracts/request gate; Settings; translation/AI/credential/secret/data services and handlers; Native ManagerController/PipeServer and Electron native command/client/preload/App paths.

**Contract:** Preserve exact text, global settings/credentials, providers, configured auto UX and current Native transport/readiness.

- [x] Trace all three engine paths and manual Google external-open.
- [x] Check timers/unmount/stale requests and Main cancellation.
- [x] Verify Native transport envelope request identity, 60 s readiness and 45 s ack deadline.
- [x] Design explicit disabled handoff reception/application separation rather than silently losing text or increasing timeouts.

### E4 — Architecture and Contracts

**Files created:** This plan and the report only.

- [x] Compare A/B/C; recommend B with two concrete projections, no public adapter loader.
- [x] Define tagged DTO/ref, fixed trusted page mapping and type-specific management.
- [x] Define Translation ID/version/default/disable option B; separate bounded enable-state file.
- [x] Keep host AI independent and manifest/API major unchanged.
- [x] Define future file-level tasks, tests, blockers, rollback and 5D manual gap carryover.

### E5 — Documentation Review and Checkpoint

**Allowed files:**

- `docs/superpowers/plans/2026-10-04-webtools-phase5e-unified-plugin-architecture.md`
- `docs/webtools-phase5e-unified-plugin-architecture.md`

**Verification:** Review contradictions/unsafe generality/current-source anchors; `git diff --check`, exact staging path list, `git diff --cached --check`, staged diff review. Commit `docs: design unified plugin architecture and SDK contracts`; normal push configured upstream; verify actual SHA/synchronization/worktree. Git completion is recorded in the final response after commands succeed, not presumed here.

**No tests rerun:** Product tests, build/package, stress/Soak, GUI or real provider requests are unnecessary for these documentation changes. 5D 193/193 and packaged smoke remain historical results.

---

## Future Implementation Dependencies

```text
5E design approval
  F1 → F2 → F3 → 5F acceptance + 5G approval
  G1 → G2 → G3 → 5G acceptance + 5H approval
  H1 → H2 → 5H acceptance + 5I approval
  I1 → I2 → final Phase 5 acceptance
```

F1/F2 share the contract/nav context; G1/G2 share Main/session/handoff state and must be integrated serially by one owner. Do not force parallelism. If user later authorizes subagents, read-only review or an SDK parity review may be independent; mutations with shared lifecycle remain with the primary implementer.

The following files are **proposed future additions**, not files created in Phase 5E. Every foundation ends with typecheck before its dependent task. Use existing Node tests; no new test/dependency framework required. Write meaningful failing tests before each behavior change when implementation is authorized.

## Phase 5F — Unified Registration and Manager Navigation

### F1 — Catalog Contract and Main Projection

**Prerequisite:** User approves 5E report and separately starts 5F. Recheck current Git/source and unknown changes.

**Create:**

- `src/shared/plugin-catalog-contracts.ts`
- `electron/plugins/plugin-catalog.ts`
- `electron/plugins/builtin-plugin-registry.ts`
- `electron/plugins/plugin-catalog.test.mjs`
- `electron/ipc/plugin-catalog-handlers.ts`
- `electron/ipc/plugin-catalog-handlers.test.mjs`

**Modify:** `src/shared/ipc.ts`, `electron/preload.ts`, `electron/main.ts`; type-only use of existing plugin contracts as needed. Existing `PluginManager` behavior/schema stays authoritative and unchanged.

**Interfaces:** `PluginRef`, `CatalogEntryDTO`, `CatalogSnapshot`, `CatalogOpenDTO` from report §6. `PluginCatalog.list/open/setEnabled`, Main session lifecycle; new `desktop.pluginCatalog.list/open/setEnabled`. Keep current `desktop.plugins` type-specific operations. Fixed Translation presentation descriptor uses version `app.getVersion`, bundled icon/entry, legacy always-enabled bridge, `canToggle:false` until G1/G2 complete.

**Steps:**

- [ ] Add compile-time tagged builtin/declarative unions, exhaustiveness tests and closed IPC ref parser; no executable type or component path.
- [ ] Adapt safe `PluginManager.list()` once per requested snapshot; no second initialize/recover scan and no package registry copy.
- [ ] Add fixed Main built-in descriptor lookup; separate catalog session/revision survives declarative core initialization failure.
- [ ] Dispatch declarative open/toggle to existing manager with its session and recheck catalog session; builtin open returns only fixed entry/generation. Reject unsupported builtin toggle during bridge stage.
- [ ] Wire Main creation/reload/close and narrow preload handlers; guards validate current Manager main-frame, arity, exact kind+ID and session before/after awaits.
- [ ] Keep actual page-mount state in App; coordinate Main lifecycle so core session rotation/stop happens once, not once per adapter and once again in Main.
- [ ] Preserve existing declarative install/grants/invoke/review/uninstall APIs. No bare ID polymorphism or new trusted invoke channel.

**Tests:** Same string ID in both kinds cannot collide/promote; forged source/kind/path/extra field denied; builtin uninstall/grants cannot reach core; failed core still lists/open known built-in; stale open/list/toggle after reload rejected; no repeated service initialization or Native changes.

**Verification:** `node --experimental-strip-types --test electron/plugins/plugin-catalog.test.mjs electron/ipc/plugin-catalog-handlers.test.mjs`; current core/IPC tests; `pnpm run typecheck`.

### F2 — Unified Nav and Center

**Depends:** F1 typecheck/tests pass.

**Create:** `src/features/plugins/builtin-plugin-pages.ts`, `src/features/plugins/plugin-catalog-view-model.ts`, `src/features/plugins/plugin-catalog-view-model.test.mjs`.

**Modify:** `src/App.vue`, `src/features/plugins/{plugin-navigation,plugin-view-model}.ts`, `PluginManagerView.vue`, related `plugin-navigation.test.mjs`, `plugin-manager-view.test.mjs`. Touch styles only for minimal existing layout alignment, not redesign. `TranslateView.vue`, provider/services/Settings business remain unchanged in 5F.

**Interfaces:** Tagged active selection/request identity; snapshot refresh generation/revision; exhaustive center details and `openPlugin(ref)` event. Literal bundled-page mapping bridges existing Translation route with no duplicate nav.

**Steps:**

- [ ] Rename Apps label to 插件; list Translation and available declarative pages from one projection; center last and always reachable.
- [ ] Keep Favorites initial/home, Settings independent, `entries` alias and explicit Native `translate` routing intact.
- [ ] Use `(kind,id)` keys; preserve declarative order and active/invoking access. Match latest ref/version/hash/generation on page response.
- [ ] Show builtin metadata without package hash/unsigned warning/grants/uninstall/replace; scope global install to local declarative packages.
- [ ] Refresh catalog after mutations/errors/mount; unavailable current page unmounts to center. No new timer/store/Router/keep-alive.
- [ ] Keep literal Translation component bridge always enabled and document disable is intentionally not implemented until 5G.

**Tests:** Mixed nav, disabled/incompatible packages hidden, invoking package retained, same-ID two rows separate, stale snapshot/page can't override Settings or Native route, no trusted page path from package, builtin unavailable actions absent and Main denial still enforced.

**Verification:** Focused plugin UI/nav tests, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `git diff --check`.

### F3 — Compatibility Smoke, Review and 5F Gate

**Depends:** F2 passes.

**Create:** `scripts/verify-phase5f-plugin-catalog-smoke.mjs`, structural safety test; `docs/webtools-phase5f-unified-plugin-registration.md`.

**Reuse:** `electron/plugins/fixtures.mjs` and existing isolated 5D smoke/environment identity helpers. Fixture `org.example.phase5funified` remains a manifest v1/api1 declarative package with page/config actions, not a formal SDK example.

**Steps:**

- [ ] Seed fresh isolated profile using existing core, no real plugin directory; test disabled→enabled/config/page/grants/disable and mixed built-in metadata.
- [ ] Build packaged Manager outside repo via existing builder; run isolated NativeHost with unique pipe, exact executable/PID/creation-time identity guards. Evidence outside repo.
- [ ] Exercise default/explicit nav, core-init failure, Manager close/reopen and Native-only Electron=0; distinguish mocked consent from native dialog acceptance.
- [ ] Review whole phase diff for boundary/data/schema/dependency changes and session/race safety; fix only attributable defects.
- [ ] Record manual gaps and phase source/build identity. Stop before 5G approval.

**Completion:** Mixed center/nav functional, old packages/grants/data unchanged, test/build PASS, no trusted promotion, no duplicate initialization, process gate PASS. Native dialogs/visual keyboard checks can remain explicitly carried to 5I; no claim they passed.

**Blockers:** Need for core schema rewrite, package type relaxation, dependency, trusted dynamic loader, new Native protocol, lost existing functionality or unresolved P0/P1/blocking P2.

**Rollback:** Remove catalog presentation seam coherently; retain all packages/data and existing Translation route. No reset/cleanup of real profile.

## Phase 5G — Translation Built-in Lifecycle Integration

### G1 — Built-in State and Main Admission

**Prerequisite:** 5F accepted; separately authorized 5G. **Depends:** F3.

**Create:** `electron/plugins/builtin-plugin-state.ts`, `builtin-plugin-state.test.mjs`; `electron/ipc/builtin-translation-lifecycle.test.mjs`.

**Modify:** builtin registry/catalog/tests, `electron/main.ts`, `electron/ipc/translation-handlers.ts`. Keep TranslationService routing/provider/settings schemas intact; dependency-inject enable/generation checks at handler boundary instead of cloning service logic.

**Interfaces:** State v1/fixed known ID; Main enable-intent generation; translation-only cancellation port. State file `<isolated userData>/builtin-plugins/state.json` as report §12; no registry/DataStore migration.

**Steps:**

- [ ] Implement bounded strict reader/writer, missing vs invalid distinction, canonical/reparse containment, exclusive temp/fsync/rename, serialized session-checked commits.
- [ ] Invalid/unsupported data preserves bytes and faults unavailable; valid absence defaults enabled. Retain bounded unknown future IDs inert on downgrade.
- [ ] Provide non-destructive retry/repair guidance; any explicit reset requires Main confirmation and retained backup. Native intent is never repair consent, and faulted data cannot be overwritten by ordinary enable.
- [ ] On disable intent block new work, abort Translation controllers only, and persist; failure reports unsaved fault without resurrecting operations. Enable succeeds only after persistence.
- [ ] Gate `translate:run` and `translate:open-google` before dispatch/after awaits against enabled/generation; permit Settings/provider-info access while disabled.
- [ ] Keep SharedAI requests/connection tests and global Settings alive; no generic builtin service invocation API.
- [ ] Make metadata `canToggle` true only when full G2 integration can safely handle disabled routes; until then keep bridge hidden from external use during development.

**Tests:** Missing/valid disabled/restart/corrupt/unknown-version/unsafe ancestor/oversize/write failure/stale-session cases; disable during pending provider resolution; fake AI/Qwen/MyMemory/Google calls zero while disabled; independent declarative AI still completes; no token/config/grant file changes.

**Verification:** New store/handler tests, existing translation/shared-AI/config/secret/plugin tests, `pnpm run typecheck`.

### G2 — Bounded Native Handoff and Fixed Page Lifecycle

**Depends:** G1 tests/typecheck pass; same primary owner as G1.

**Create:** `electron/services/builtin-translation-handoff.ts`, `builtin-translation-handoff.test.mjs`, `src/shared/builtin-translation-contracts.ts`, `src/features/plugins/BuiltinTranslationGate.vue`, `builtin-translation-gate.test.mjs`.

**Modify:** main/catalog/builtin registry, catalog IPC handler, preload/shared IPC, App.vue, bundled page map and navigation tests. TranslateView may receive only minimal lifecycle-bound props/events if necessary; preserve its form/layout/provider/timer business. Existing Native C#/protocol unchanged.

**Interfaces:** One Main-owned exact-text slot/request ID/session/generation; `getTranslationHandoff`, `resolveTranslationHandoff` closed dispositions `gate-presented|enable-and-open|applied|cancel`. See report §9 for transport/application distinction and failure handling. Other Native page acks remain existing API; generic ack must not settle this slot directly.

**Steps:**

- [ ] Resolve existing `translate` wire alias and translation-prefill to fixed builtin ID in Main.
- [ ] Enabled flow renders literal existing TranslateView and settles matching transport after exact apply; no component path or source text supplied by resolver.
- [ ] Disabled flow renders host gate first; matching presented disposition settles transport within existing deadline and retains bounded slot in Main.
- [ ] Use the closed slot/payload DTO from report §9 for both page-only and prefill intents. Faulted state shows recovery/cancel and denies enable-and-open until safely repaired.
- [ ] Explain automatic behavior; explicit enable-and-open writes state then mounts/applies retained original text; cancel discards without network/enable.
- [ ] Preserve/resume pending text across renderer reload/local navigation; explicit discard/replacement notices; new intent supersedes old generation. No disk persistence/logs/text retention after Manager close.
- [ ] Recheck generation/session after each await so late enable/cancel/ack cannot act on a replacement. Reload reprojects settled slot without replaying old wire ack.
- [ ] Add bounded failure deadline for unpresented slot and recoverable load error; no indefinite wait, arbitrary setTimeout race mask, or increased Native wait.
- [ ] Remove temporary 5F always-enabled route bridge; no duplicate translation nav/registration and no redundant service initialization.

**Tests:** Manager absent/creating/unmounted/open/hidden/reload; exact whitespace/punctuation/Unicode, max length; stale sender/session/id/generation; disabled gate held longer than45s using fake clock with settled transport; enabled apply ack; newer page/translation replacement; local navigation keep/discard; write fail; disable between open/apply; close cancellation; late provider response after new prefill. Fake counters verify no provider or Google action before explicit enabled path.

**Verification:** New handoff/gate tests, existing native command/client/request-gate/TranslateView lifecycle tests, `pnpm run typecheck`, `pnpm run build`.

### G3 — Translation Migration Regression and Gate

**Depends:** G2.

**Create:** `scripts/verify-phase5g-translation-plugin-smoke.mjs`, structural isolation test; `docs/webtools-phase5g-translation-builtin-plugin.md`.

**Modify/tests:** Existing service/config/provider/TranslateView tests add relevant lifecycle cases without deleting old auto-translate tests or relaxing their assertions.

- [ ] Verify MyMemory/AI/Qwen-MT with injected fake network/credentials; language/model/default-provider behavior unchanged and Google still manual.
- [ ] Compare isolated old/new DataStore, secret and declarative registry/config/data semantics; no one-time translation migration needed.
- [ ] Packaged isolated mixed plugins: Translation enabled/disabled/persisted/re-enable, Native exact prefill, reload/cancel, Settings still accessible, another plugin unaffected.
- [ ] Verify normal Manager close clears runtimes/handoff and all target Electron exits, Native continues; reopen restores disabled state.
- [ ] Full source review and `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `git diff --check`; record actual results and manual gaps.

**Completion:** Fixed Translation adapter/nav/lifecycle, current business behavior/config preserved, transport/generation/disable tests PASS, no unintended provider dispatch, host AI independent, isolated process gate PASS. Stop for 5H approval.

**Blockers:** Silent lost prefill, disabled dispatch, >45s unsettled user prompt, lost config, inability to bound state, need for Native wire/schema change, unresolved serious regression.

**Rollback:** Revert G1/G2 together to legacy Translation route; retain unused state file/all user data. Older source will not honor the new disabled choice; disclose that limit. Do not partially rollback handler gate while leaving incompatible handoff.

## Phase 5H — Formal Declarative SDK, Tooling and Independent Example

### H1 — Author-facing Contract and Validation Parity

**Prerequisite:** 5G accepted + explicit 5H authorization. **Depends:** G3.

**Create:** `sdk/declarative-v1/manifest.schema.json`, `types.d.ts`, `README.md`; `scripts/plugin-sdk-contract.test.mjs`.

**Contract:** Existing closed v1/schema/api1/capability/UI/action/settings rules. Host catalog/BuiltinPlugin interfaces are not author SDK. No public JS lifecycle/event callback, `window.desktop`, service imports or credential API.

- [ ] Document every required/optional field, type/reference/identity rule, default/state/consent/input/output/error behavior and actual quotas.
- [ ] Implement offline author type/schema views and a parity corpus against existing runtime parser; explain duplicate-key/archive/ref/PNG checks outside JSON schema.
- [ ] Keep old5C/5D packages valid; unknown property/type/capability still rejected. No apiMajor/minor/version inference change.
- [ ] Explain lifecycle states are host status, SHA hash not publisher authentication, usable clipboard/AI consent surface bounds.

**Verification:** Old valid manifest corpus + invalid cases; compile author example types using existing tsc; targeted Node tests, `pnpm run typecheck`. Any schema/type/parser discrepancy blocks SDK publication until corrected without weakening runtime.

### H2 — Packer, Validator and Independent Example

**Depends:** H1.

**Create:** `scripts/validate-wtplugin.mjs`, `pack-wtplugin.mjs`, `plugin-sdk-tools.test.mjs`; `examples/plugins/help-links/{manifest.json,README.md}` and optional bounded PNG asset; `docs/webtools-phase5h-plugin-sdk.md`.

**Contract:** Offline local archive creation/validation only; no package installer, network catalog, signature/updater or workspace. Reuse actual validator behind a testable CLI seam; do not expose Electron host to authors. Avoid public dependence on internal host TS module paths. Packaging writer must emit only declared file set and checked ZIP metadata; existing hostile-test ZIP helper is test-only, not the production packer.

- [ ] Validate source paths and bytes before writing; reject links/traversal/undeclared files/limits; stable deterministic file order/timestamps and explicit output path/no overwrite by default.
- [ ] Implement the explicit source/archive, output and host-version CLI contract in report §11; failures leave no partial archive and never recursively clean the destination.
- [ ] Use existing dependency/toolchain or simple bounded ZIP writing approach separately reviewed; if a new dependency becomes necessary, stop and seek approval rather than add silently.
- [ ] Example authored using SDK docs/types only; declare page/config/HTTPS help action, no AI required, no token. Generated `.wtplugin` goes outside Git; source committed only when authorized later.
- [ ] Import/enable/use/uninstall example through unchanged host workflow in isolated profile; no host source modification/hidden pre-grants required.
- [ ] Verify corrupt/oversize/malicious/unknown executable manifests rejected consistently by tooling and host; full typecheck/test/build/diff review.

**Completion:** Usable versioned docs/types/tooling and independent example, unchanged v1 compatibility, package host authority preserved. Stop for 5I approval.

**Rollback:** Remove unreleased SDK/tooling/example source; retain user archives/data and all host security contracts. Do not “fix” example by bypassing consent or importing trusted components.

## Phase 5I — Integrated Security, Regression and Windows Acceptance

### I1 — Whole-source Review and Automated Matrix

**Prerequisite:** 5H accepted + explicit5I authorization. **Depends:** H2.

**Files:** Existing core/IPC/UI/provider tests plus catalog/state/handoff/SDK tests from F–H; new `docs/webtools-phase5i-plugin-final-acceptance.md`.

- [ ] Capture actual branch/source/build hashes and uncommitted diff; preserve unknown work, do not reset/stash over it.
- [ ] Review all F–H changes, not final commit only: scope/schema/dependency/native ownership/sender safety/cancellation/exact prefill.
- [ ] Test composite identity spoofing, package builtin/executable fields, arbitrary paths, invalid/session-expired/replayed reviews, revoked/disabled/upgrade/uninstall state, store corruption/atomicity, provider changes/secret redaction, noncooperative late response slots.
- [ ] Use fake AI/network and isolated packages/profiles; no production profile/token access, no arbitrary process-name termination.
- [ ] Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `git diff --check`.
- [ ] Run `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj -c Release` and equivalent `native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj` only as necessary current integration/package regression; no large historical stress rerun.
- [ ] Record actual counts, explain meaningful additions; do not remove tests to reach PASS.

**Blockers:** P0/P1/blockingP2, incompatible valid old packages, confused trusted dispatch, token exposure, data reset, disabled network, Manager group retained, Native unexpectedly starts Manager.

### I2 — Real Windows UI and Packaged Acceptance

**Depends:** I1 PASS; safe isolated environment available.

**Files:** Reuse current `scripts/build-native-production.ps1`, `scripts/native-production.nsi` and isolated smoke helpers without changing installer architecture; targeted new final plugin smoke/checklist and report evidence references outside repo.

- [ ] `pnpm run package:win` when building final combined plugin payload; identify actual NativeHost/Manager/asar/installer hashes. This is acceptance candidate only, not release/deployment.
- [ ] Verify isolated installed layout/Manager discovery and Native-only Electron0, open/reuse/normal-close0/reopen; exact path/PID/creation-time cleanup and independent unrelated-install witness.
- [ ] Real native picker/install/new-enable/grant-revoke/replace/upgrade/downgrade, uninstall keep/delete, cancelled transactions and recoverable failures. Mark mock-based paths separately.
- [ ] Mixed-type UI labels/actions/nav/fallback; keyboard/focus/Escape/accessibility; no built-in hash/uninstall; default Favorites/explicit Settings preserved.
- [ ] Translation default/state-persist/disable-in-flight; disabled Native gate/long wait/explicit re-enable/cancel/reload; original text; automatic UX after explained enabled open. No real paid AI required; provider dispatch proofs remain mock tests.
- [ ] Settings/default shared AI remain usable when Translation disabled; test local example host actions with explicit consent.
- [ ] Installer upgrade/uninstall history reused when target/source behavior unchanged; only isolated affected-path sanity, no Phase4 long tests or real installed profile operation.
- [ ] Merge evidence as historical/current automated/real packaged desktop/user-confirmed/manual required, never turn source assertions/mock consent into real UI PASS.

**Completion:** All necessary real UI checks performed/confirmed, automated matrix clean, no unresolved blocking issue, current candidate identity and Native architecture gates audited. Only then final Phase5 COMPLETE; no automatic future feature/release.

**Rollback:** Stop candidate acceptance, preserve evidence and valid old packages/profile. Minimal attributable fix plus affected regression, not broader code cleanup/installer redesign. If safe isolated UI is unavailable, retain incomplete manual gate.

## Global Test Cases and Gates

| Area | Required proof |
|---|---|
| Trust | Local package can never become built-in through type/name/ID/path. Fixed renderer never evaluates package content. |
| Compatibility | Manifest v1/api1 old packages remain valid with same grants/config/data/current identity. |
| State | Missing defaults vs malformed/unreadable preserved, disabled persists, write failure visible, no token/translation config move. |
| Navigation | Mixed projection, invoking page retained, unavailable current page returns to center, stale loads rejected, Favorites/default and Native explicit routes unchanged. |
| Handoff | Exact source, bounded one slot, envelope correlation and sender guards, prompt transport settled independently, reload/cancel/close/supersession safe. |
| Translation | 450ms current automatic UX while enabled, all engines/current config, cancel/stale guard, Google manual, disabled prevents dispatch. |
| AI | Other plugins and host config/tests independent; third-party broker/review/caps preserved, no secrets sent. |
| Runtime | Native idle Electron=0, no plugin scan/service there, one Manager, close target group=0, no background plugin process. |

Inherited file-navigation/pipe-peer-auth hardening is separate and remains deferred unless a newly demonstrated regression makes it blocking. No fabricated MB budget, startup speed claim or resource measurement. Do not repeat Phase4 stress/Soak as an acceptance timestamp exercise.

## Final Phase 5E Decision

All design audit sections E1–E4 are completed. The two documents define a concrete recommended architecture; implementation and product choices remain subject to user approval. E5 Git verification is executed at documentation closeout and its actual outcome is returned to the user.

**PHASE 5E DESIGN COMPLETE — PENDING USER APPROVAL**

Stop after the documentation checkpoint. Phase 5F–5I are not started.
