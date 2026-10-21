# Phase 6E-4C — Bounded Adversarial Acceptance and Phase 6E-4 Closure

## Decision

**Phase 6E-4 COMPLETE — Gate 1 isolated-runtime baseline ACCEPTED.**

**Repository cleanup note (2026-10-10):** The sanitized, checked-in Gate 1 evidence JSON and its shape-only test were retired as phase-specific evidence artifacts. This report preserves the historical decision and scope; it is not an active test input. Current packaged acceptance is provided by `scripts/verify-plugin-runtime-packaged.mjs`.

- Gate 1 isolated-runtime baseline: **ACCEPTED**; security assurance **BOUNDED / NON-EXHAUSTIVE**.
- Gate 4: **NOT CERTIFIED**.
- `network.mode: domains`: **UNSUPPORTED**.
- Phase 6E-5: **READY; NOT STARTED**.
- Known unresolved P0: 0; P1: 0; Blocking P2: 0; non-blocking P2: 0; P3: 0.

The packaged tests below use the actual production runtime. Under the user's final closure contract, acceptance requires meaningful evidence of the isolated offline baseline and no known unresolved production isolation blocker. It does not require exhaustive browser/URL/schedule certification. Unexercised cases remain honestly recorded; the earlier evidence-only Blocking P2 classification is superseded by this decision.

## Source and runtime identity

- Workspace: `D:\SystemDefault\Desktop\HomePage`.
- Branch: `codex/shared-ai-translation-2.0`.
- Starting HEAD: `1112dc1d873ccd9288113f83800ce463ddbf47cd`. The tested artifact was built from the current working tree, including the reviewed closure fixes; baseline HEAD alone does not contain the runtime.
- Product version: `0.1.0`.
- Electron: `44.4.5`; Chromium: `152.0.7977.130`.
- Tested runtime: the current Phase 6E-4B Main, actual packaged `app.asar`, Host Phase 6E-3 validator, immutable validated snapshot, custom protocol, non-persistent production Session, and production `WebContentsView`.
- The package fixture was a real `.wtplugin` generated for this test and passed through the authoritative Host validator before runtime use. The source archive was then deleted and the validator input buffer mutated; the live runtime continued to serve the exact retained snapshot bytes.
- Packaged runs used disposable TEMP installation/profile/fixture locations. The verifier checked the packaged executable path, PID/process group, and each Chromium process command line against its unique isolated profile. The production install and application user data were not touched, and no secret was read.
- **Environment disclosure:** an earlier probe before the explicit-profile enforcement wrote Electron's `DevToolsActivePort` marker under the default Chromium profile. The six recorded packaged adversarial executions used explicit isolated TEMP profiles. No application data or credentials were read. This incidental marker is not represented as a complete before/after profile snapshot.
- Final executable SHA-256: `283b4d3988f7eb51b239f4b6af755120f9a8bd81abc13eb189a61652a10da3e6`.
- Final `app.asar` SHA-256: `56348159d7530367573852ce06a8e924e6ef8bcb68bb04895c26214f7092129d`.
- Validated fixture SHA-256: `615545480cdc8525ee13fdcaa4e9928894326e433974ecd60f7a6698922323d8`.
- Hashes were recorded before successful disposable package cleanup. Raw logs and the failed-run TEMP tree remain outside Git; no profile, log, credential or packaged binary is included in the checkpoint.

## Packaged adversarial scenarios

The final bounded suite completed all six existing packaged scenario categories in one successful run, including crash and hang. All six ended with the exact packaged executable process count at **0**. A separate process inventory also found **0** disposable acceptance runtimes remaining.

| Scenario | Result | Direct runtime evidence |
|---|---|---|
| Security/protocol baseline | PASS | Real validator and snapshot; source archive deletion and input mutation; renderer isolation; CSP probes; protocol path probes; storage attempts/teardown; permission probes; loopback sink; one Manager layout; graceful Manager close. |
| Same-process Feature switch | PASS | New random origin; old target removed; declared WASM allowed for the declared Feature; stale-generation close ignored; navigation/popup attacks stayed denied; graceful Manager close. |
| Switch while loading | PASS after fix | A real delayed protocol response kept generation 1 in `LOADING`; a newer request revoked it before it could become `READY`; replacement reached `READY`; close returned the packaged process count to zero. |
| Manager close while loading | PASS | Manager close occurred while the actual `WebContentsView` was `LOADING`; cleanup and process exit completed within the 5-second close budget. |
| Renderer crash | PASS | CDP crashed the real plugin renderer; Main cleaned it up; the acceptance seam explicitly reinvoked the Feature after crash, reached READY with a new origin and removed the old target. Manager normal close returned process count to zero. Production does not automatically restart plugin code. |
| Hung renderer | PASS | A CDP console event proved entry into the infinite-loop fixture before unresponsiveness was asserted; trusted Manager close completed within the 5-second budget; process count returned to zero. |

These scenario results do not imply that every adversarial category in the next matrix passed.

## Gate 1 evidence matrix

| Requirement | Result | Evidence / gap |
|---|---|---|
| Snapshot authority and TOCTOU | PARTIAL | Packaged runtime used the real Host validator and retained validated bytes after archive deletion and caller-buffer mutation. Forged snapshot/hash rejection is focused-test evidence only; the complete A1–A12 packaged adversarial set was not run. |
| Canonical paths and protocol path attacks | PARTIAL | Packaged custom protocol probes covered unknown resource, encoded and double-encoded traversal, encoded slash/backslash, duplicate slash, dot segment, query, fragment, NUL, and forged origin. A packaged hostile-validator input matrix and every frozen canonical-path case remain unverified. |
| Active, forged, revoked, old runtime origins | PARTIAL | Active origin served declared resources; forged and previous origins were denied; switching destroyed the old target and generated a new origin. Case-variant and complete revoked/old-origin matrix remain unverified. |
| Renderer Node/Electron escape | PASS | Packaged Feature renderer observed `process`, `require`, `module`, `Buffer`, `ipcRenderer`, `electron`, `window.desktop`, and `window.require` as unavailable. |
| Manager DOM/preload isolation | PASS for Feature renderer isolation | Packaged Feature renderer could not find Manager DOM and had no preload bridge. A separate hostile Manager-renderer navigation/preload adversarial suite was not run. |
| CSP, inline, eval, Function, dynamic import, WASM | PARTIAL | Inline script, `eval`, `Function`, remote fetch, remote dynamic import, and undeclared WASM were blocked; same-origin dynamic import worked; declared WASM worked only for the declared Feature. Dedicated Worker matrix was not run. |
| Navigation and popup | PASS for exercised packaged matrix | Tried previous/forged origin, unknown route, `file:`, `javascript:`, `data:`, `blob:`, HTTP, HTTPS, and popup. Navigation remained on the active declared document; popup was denied. |
| `network.mode:none` and controlled sink | PASS for exercised path | Remote and loopback fetch were blocked. The controlled local TCP sink received **0 requests**. This does not certify Gate 4 or domains networking. |
| Permissions and downloads | PASS for exercised probes | Notification and geolocation requests were denied. A packaged download gesture emitted Main's `download-cancelled` event; the driver now asserts that event before writing evidence. |
| localStorage, IndexedDB, cookies, CacheStorage | PARTIAL | Fresh localStorage was empty; a localStorage write and IndexedDB write were attempted; custom-scheme cookie write was unavailable; CacheStorage rejected the custom scheme. Main logged teardown completion and zero remaining cookie entries. A post-close/reopen cross-generation residue check was not run. |
| Service Worker | PASS | Registration attempt was blocked and no Service Worker was observed. |
| Feature switch, stale generation, close while loading | PASS for exercised races | Packaged loading replacement, stale-generation close, and close-while-loading passed. |
| Load failure | NOT TESTED | No dedicated real packaged failed-load fixture was executed. |
| Renderer crash | PASS | Real packaged renderer crash caused runtime cleanup while Manager stayed available. |
| Hung renderer | PASS | Real packaged renderer hang did not prevent trusted Manager close or process cleanup. |
| Operation queue deadlock regression | PASS for exercised switches | Normal and loading replacement completed without deadlock. This is finite scenario evidence, not exhaustive schedule exploration. |
| Manager trust boundary and WebContentsView bounds | PARTIAL | Feature could not access Manager DOM or bridge; one real Manager layout/bounds sample passed. Hostile Manager-renderer navigation/preload matrix, resize, and repeated route-mount bounds were not tested. |
| Manager close and packaged process cleanup | PASS | Each of six runs used a normal Manager close path and exact executable process count returned to 0; NativeHost was not used as the exit mechanism. |

## Controlled network and storage observations

- Controlled sink request count: **0**.
- Remote `fetch`: blocked.
- Loopback `fetch`: blocked.
- Service Worker registration: blocked.
- Notification/geolocation permission requests: denied.
- Download: fixture gesture issued; packaged Main observed and canceled the download.
- Storage cleanup log: completed with zero remaining cookie entries. CacheStorage and cookies are unsupported for this custom scheme, so those write paths did not produce persisted data. IndexedDB write succeeded in the non-persistent runtime Session; cross-generation residue was not queried afterward.

## Issues found and fixes

### Previously resolved operation queue and stale unmount defects

As recorded in the original 6E-4B report, `openInternal()` previously queued `close()` on the queue it already occupied, causing a same-process deadlock. It now directly awaits teardown. An old Vue route unmount could also close its replacement; close IPC is now active-generation-bound and late old-generation route state is ignored. The existing Vue regression and packaged same-process/stale-generation assertions still pass.

### Production lifecycle defect found and fixed

The packaged `switch-while-loading` scenario initially showed that a replacement request queued behind an outstanding `loadURL()` could allow the superseded generation to continue loading instead of promptly entering close. This was a real production-runtime lifecycle defect.

The minimal fix adds a request-intent generation, preempts an active `CREATING`/`LOADING` runtime immediately, checks request currency around asynchronous Session creation, and waits for actual load completion/failure/crash events instead of waiting on an uncancellable `loadURL()` promise. Intentional close no longer publishes a late `FAULTED` state. The packaged switch-while-loading and close-while-loading cases passed after the fix. Focused tests and the full Node suite passed afterward.

### Final review: crash teardown and cleanup failure

Read-only Spec review found two concrete defects. Crash teardown revoked `active` before awaited Session cleanup, allowing immediate reinvocation to create a replacement while old cleanup still ran. A switch also checked `unavailable` only before closing the old runtime, so failed cleanup could still admit that switch's replacement.

Two focused tests reproduced both defects on the original runtime (0/2 passed). A shared `pendingTeardown` barrier now gates replacement creation and trusted close; availability is checked again after teardown. Both tests then passed (2/2), and the existing real packaged crash scenario now verifies explicit reinvocation reaches READY after old-runtime cleanup. Spec and Standards re-review found no substantive unresolved finding.

### Test-driver issues corrected

- A top-level-await fixture did not delay the document's `did-finish-load`; the close-while-loading test now holds the actual custom-protocol response so the WebContentsView is observably `LOADING`.
- A TOCTOU test deliberately removed its `.wtplugin`; the driver now regenerates the disposable fixture before subsequent lifecycle scenarios.
- Process-profile verification initially mishandled Unicode TEMP paths due to PowerShell output encoding; the verifier now transports process records through UTF-16LE/Base64 JSON and checks the full packaged process group.
- One prior isolated test process displayed a hidden startup error after the deleted fixture was reused. It was identified by exact disposable executable path and cleaned up. The corrected full run completed normally. No production installation was terminated or modified.
- The first final-pass hang attempt failed because fixed 500ms waiting did not prove entry into the scheduled infinite loop; the renderer still answered. The assertion was retained. The driver now waits for a specific console event immediately before the loop; the bounded suite rerun passed all six categories. The failed-run target process count was independently confirmed zero.
- Unused duplicate scheme registration, resolved-only `protocolReady`, stored origin, unused request helper/return fields, fixture Feature and driver arguments were removed. No new framework or adversarial category was added.
- Evidence is generated from current measured results rather than partially updating a prior result file. It labels baseline HEAD plus working-tree provenance and hashes the real artifacts before cleanup.

## Final regression

Executed after the runtime changes:

- `pnpm run typecheck` — PASS.
- `pnpm test` — **455/455 PASS**.
- Focused runtime snapshot/policy/acceptance tests — **14/14 PASS**.
- `pnpm run build` — PASS (Electron Main, preload, and Vue Renderer).
- NativeHost Checks — **72/72 PASS**.
- UpdateHelper Checks — **10/10 PASS**.
- Packaged runtime driver — **6/6 existing scenario categories PASS**, including the controlled sink and crash reinvocation.
- Evidence JSON test — PASS; bounded acceptance and unexercised assurance limitations are represented separately.
- Final `git diff --check` — **PASS** after report and evidence generation (Git printed only LF/CRLF normalization warnings for existing working copies).

The original 4B acceptance recorded 451 Node tests and 11 focused tests; the interim 4C pass recorded 453 and 12. This closure adds only two regressions for real teardown defects, yielding 455 and 14. Historical results are retained rather than relabeled.

## Security Findings

- P0: 0.
- P1: 0.
- Known unresolved Blocking P2: 0. The prior evidence-only classification is superseded; both concrete final-review production defects were reproduced and fixed.
- Non-blocking P2: 0.
- P3: 0.

## Security Assurance Limitations

The matrix remains non-exhaustive: additional snapshot/URL/origin permutations, uncommon browser APIs and dedicated Worker variants were not exercised. Exact inventoried-byte authority, no filesystem fallback, default-deny Session/CSP and the common packaged attacks provide meaningful bounded baseline evidence. Untested variants are not individually marked PASS and are not identified as vulnerabilities without a concrete defect.

Direct post-close enumeration of every storage backend was not performed. Fresh random invocation origins, a non-persistent Session, logged teardown and fail-closed Session reuse support the isolation boundary. Explicit failed-load injection and every timing schedule were not exercised; the loading/switch/crash/hang/close cases and deterministic cleanup-failure regression support lifecycle acceptance. These limits are not a new test TODO matrix.

Repeated resize/route permutations and scripting from an already-compromised trusted Manager were not exhaustively tested. The Feature has no Manager DOM/preload bridge, bounds have a real packaged layout observation, and narrow layout/close IPC validates the current Manager main frame. The controlled sink measures TCP connections (zero implies zero requests), not packets from every possible transport. Gate 4 and domains mode remain outside the accepted baseline. SDK bridge, Host capabilities and normal v2 installation remain unavailable.

## Machine-readable evidence

Sanitized evidence is at `tests/security/web-plugin-runtime-gate1/results/phase6e4c-gate1-evidence.json`. It records tested observations, six scenario results, sink count, artifact hashes and exact process cleanup. Assurance limitations are explicitly `tested: false`, `result: not-exercised`, `blocking: false`. It omits local absolute paths, profile contents, secrets and raw logs.

Final SHA-256: `AF647765C0960C9E284AED0493E4049AA97270C5DF171B2A10B8463BC16777A0`. The superseded interim evidence hash was `06DB4602C813CDAAD641B2BC871EE7C226EDE17D455C7EA75E03842986419AB5`.

## Worktree Audit and Checkpoint Scope

All current changes/untracked files were audited before editing; the initial staged area was empty. The following 25 files are Phase 6E-4 work:

| Class | Files |
|---|---|
| A — production integration | `electron/main.ts`, `electron/preload.ts`, `src/shared/ipc.ts`, `src/App.vue`, `src/features/plugins/WebRuntimeView.vue`, `src/styles/tokens.css` |
| A — authoritative snapshot | `electron/plugins/package-validator.ts`, `electron/plugins/validated-web-package-snapshot.ts`, `plugin-sdk/declarative-v1/runtime/package-v2.mjs`, `plugin-sdk/declarative-v1/runtime/package-v2.d.mts` |
| A/B — runtime and fixes | `electron/plugins/web-plugin-runtime.ts`, `electron/plugins/web-runtime-policy.ts` |
| A/C — guarded acceptance seam | `electron/services/web-runtime-acceptance-options.ts`, `electron/services/web-runtime-acceptance-options.test.mjs` |
| C — focused regressions | `electron/plugins/web-runtime-snapshot.test.mjs`, `electron/plugins/web-runtime-policy.test.mjs`, `electron/plugins/web-plugin-runtime.test.mjs`, `src/features/plugins/catalog-app-lifecycle.test.mjs`, `tests/phase4f-native-first-architecture.test.mjs` |
| C — packaged acceptance | `scripts/create-phase6e4b-runtime-fixture.mjs`, `scripts/verify-phase6e4b-packaged-runtime.mjs`, `tests/security/web-plugin-runtime-gate1/evidence.test.mjs` |
| D — report/evidence | `docs/phase6e4b-isolated-offline-web-runtime.md`, this report, `tests/security/web-plugin-runtime-gate1/results/phase6e4c-gate1-evidence.json` |
| E — excluded Launcher | `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`, `native/WebTools.NativeHost.Checks/Program.cs`, `docs/bugfix-launcher-app-search-after-autostart.md`; before/after content hashes match |
| F — unnecessary artifacts | No accidental/generated binary/profile/log is included; obsolete scaffolding was removed within the existing files listed above |

`src/App.vue` and the two existing JS test diffs are Web Runtime route/acceptance changes, not Launcher changes. The previous chat classification was incorrect. They belong in this checkpoint. The three actual Launcher files are excluded and remain preserved for independent handling.

The local checkpoint message is `feat(plugins): complete isolated web runtime baseline`. It consolidates 4B implementation, 4C bounded acceptance and the resolved defects. Actual commit SHA is reported from Git after commit; artifact provenance remains accurately labeled as the pre-checkpoint working-tree build.

## Final Closure Decision

- Phase 6E-4: **COMPLETE**.
- Gate 1 isolated-runtime baseline: **ACCEPTED**.
- Security assurance: **BOUNDED / NON-EXHAUSTIVE**; no exhaustive certification is claimed.
- Known unresolved P0: **0**; P1: **0**; Blocking P2: **0**.
- Gate 4: **NOT CERTIFIED**.
- `network.mode: domains`: **UNSUPPORTED**.
- Phase 6E-5: **READY; NOT STARTED**.

All essential bounded-baseline invariants have meaningful packaged evidence, the final regression passed, and both concrete final-review defects were fixed. Remaining permutations are disclosed assurance limits; they are not release blockers for this isolated baseline.

## Roadmap and Stop Boundary

- 6E-1 audit, 6E-2 frozen contract, 6E-3 validator and 6E-4 isolated runtime (4A probe, 4A.1 evidence, 4B runtime, 4C bounded gate): **COMPLETE**.
- Next architecture phase: **6E-5 Minimal SDK Bridge — READY, NOT STARTED**.
- Separate existing product work: Launcher search-after-reboot changes remain visible and uncommitted.
- No push, merge, tag, release, or new security subphase.

**STOP after the local Phase 6E-4 checkpoint. Do not push or start Phase 6E-5.**
