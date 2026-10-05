# WebTools Phase 5I — Final Regression, Security Review & Windows Release Acceptance

## Context and authority

Phase 5I verifies the Phase 5H plugin SDK/tooling checkpoint at `4903ac22cabdda50605464bd6b23c00aea3bb8db` and creates a fresh, isolated Windows release candidate. The accepted product architecture remains NativeHost-first: NativeHost owns Launcher, tray, hotkey, native search and Manager lifecycle; Electron Manager runs only on demand.

Authoritative request/specification: the user-provided attachment `C:\Users\zry\.codex\attachments\6658241f-d369-474f-a538-15bb8bc47605\已粘贴的文本.txt` (Phase 5I final regression, security review and Windows release acceptance).

This plan is bounded to final acceptance, evidence, and minimum fixes for reproduced blocking defects. It does not authorize Phase 6, product redesign, dependency changes, plugin runtime execution, release publishing, signing, or changes to production installation/data.

## Global constraints

- Preserve the current working tree and history; no reset, clean, rebase, force push, merge, PR, tag, GitHub Release, or upload.
- The production installation at `D:\webtools`, `%APPDATA%\Nook`, startup registration, user Favorites/Settings/plugin state, SecretStore, real AI tokens, and unrelated processes are out of scope and must remain untouched.
- Every destructive check must use a unique isolated install root, profile, and pipe identity; target processes only by validated executable path, PID, and creation time.
- Never use real paid AI providers. Mock providers only.
- Physical keyboard/mouse/visual acceptance must be labeled `USER MANUAL REQUIRED` unless actually operated by a human or an equivalent physical-input UI session. DOM automation is not physical GUI acceptance.
- Historical evidence is reference only, not current execution. Label evidence `HISTORICAL EVIDENCE`, `CURRENT AUTOMATED PASS`, `CURRENT PACKAGED PASS`, `CURRENT PHYSICAL GUI PASS`, `USER MANUAL REQUIRED`, or `NOT TESTED`.
- No test output, measurements, signatures, process identity, or user data details may be inferred or fabricated.
- Candidate output and temporary profiles/evidence must be outside source control. Final commit contains only the Phase 5I plan/report, narrowly required test evidence scripts, and any reproduced minimum fix plus regression test.

## Baseline

- Expected branch: `codex/shared-ai-translation-2.0`.
- Expected source checkpoint: `4903ac22cabdda50605464bd6b23c00aea3bb8db` (`feat: add declarative plugin SDK and packer`).
- Expected upstream: `origin/codex/shared-ai-translation-2.0`, synchronized at start.
- Phase 5H historical report and plan, Phase 5C–5G reports, package/build scripts, README, and plugin SDK documentation were inspected before execution. Recheck details against actual files as each task runs.

## Evidence matrix (initial state before Phase 5I execution)

| Area | Automated | Packaged | Physical GUI | Result | Historical reference | Remaining gap |
|---|---|---|---|---|---|---|
| NativeHost | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 5G/5H checks and smoke | Current build/process evidence |
| Launcher | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 4G/5H smoke | Physical key/mouse/visual behavior |
| Manager lifecycle | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 4G-3/4G-4 lifecycle | Current packaged bounded cycle |
| Favorites | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | Earlier phase UI checks | Current isolated packaged state |
| Settings | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | Earlier phase checks | Current isolated persistence |
| Translation | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 5G lifecycle | Current mocks, disabled/restart behavior |
| Shared AI | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 5G historical tests | Current mock/authorization gates |
| Plugin Catalog | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 5F/5G historical checks | Current typed identity/security tests |
| Plugin install | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 5H packaged smoke | Current isolated package install |
| Plugin permissions | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 5D–5H test-only flows | Physical consent/keyboard behavior |
| SDK | NOT TESTED | N/A | N/A | NOT TESTED | 5H workflow | Current independent author workflow |
| Plugin pack | NOT TESTED | NOT TESTED | N/A | NOT TESTED | 5H workflow | Current external `.wtplugin` hash and validation |
| Installer | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 4F/5H smoke | Fresh isolated RC install |
| Upgrade | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 4F historical evidence | Current isolated upgrade/data preservation |
| Uninstall | NOT TESTED | NOT TESTED | USER MANUAL REQUIRED | NOT TESTED | 4F/5H smoke | Current isolated uninstall/no orphan |

## Task order and dependencies

### Task 1 — Baseline, source map, and evidence ledger

**Files:** this plan; eventual `docs/webtools-phase5i-final-acceptance.md`; ignored `.superpowers/sdd/.../progress.md`.

**Contracts:** branch/HEAD/upstream and production-safety boundary are the immutable test preconditions. Capture test/build tool versions and locate current verifier scripts before invoking them.

**Steps:** verify actual Git baseline; read/check Phase 5C–5H reports and plans; inspect package scripts, installer, NativeHost/UpdateHelper checks, SDK/Plugin Center verifiers; inventory available evidence and distinguish history from current results; record unknowns without changing source.

**Verification:** `git status --short`, branch/HEAD/upstream checks, relevant file presence and source paths. Stop only on unexplained dirty state, missing Phase 5H source checkpoint, or inability to isolate tests.

### Task 2 — Current automated regression

**Depends on:** Task 1.

**Files:** no product changes expected; temporary logs outside repo.

**Contracts:** use only commands that exist in the repository. Record exact command, suite count, pass/fail/skip/warnings. Diagnose changed test count rather than assuming regression.

**Steps:** run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, NativeHost Checks, UpdateHelper Checks, and targeted plugin validator/SDK/pack/catalog/IPC/Translation/Shared AI/lifecycle tests through the project’s actual runner. Run `git diff --check` after plan/report edits.

**Verification:** all relevant current suites pass or failures are classified with evidence; no product behavior changes.

### Task 3 — Plugin boundary and adversarial package verification

**Depends on:** Task 2.

**Files:** current validator/catalog/store/permission code and tests; add only a focused regression test/fixture if existing coverage leaves a concrete gap; final report.

**Contracts:** third-party packages remain declarative-only; identity is `(kind,id)`; package validation is fail-closed; rejected inputs do not mutate registry/data/grants or installed/built-in state.

**Steps:** trace ZIP/manifest/PNG validation and all privileged capability boundaries; verify absence of executable plugin code, arbitrary file/Node/Electron/native-pipe/secret access; verify `webtools.translation` cannot spoof a built-in; run existing malicious fixture tests across traversal/absolute/duplicate/case/normalization/size/count/PNG/manifest/API/permission/action/config/symlink/corrupt/truncated cases. Extend tests only where a specific missing case is proven.

**Verification:** targeted test is observed RED before any necessary minimal test/security fix, then GREEN; all rejection/state-isolation assertions pass.

### Task 4 — Translation, Shared AI, and native handoff

**Depends on:** Task 2; Task 3 for authorization/identity contracts.

**Files:** existing Translation lifecycle, Shared AI, prefill/handoff services and tests; isolated verifier only if an existing path is reusable.

**Contracts:** no real token/provider; provider requests require host authorization; plugin cannot read token/raw IPC; disabled/revoked/uninstalled consumers are rejected; handoff preserves exact text in bounded, single-slot, nonpersistent memory. Preserve Translation's documented 450 ms auto-translation behavior on prefill; verify the delay and provider dispatch only with mocks.

**Steps:** verify enabled/disabled/restart/corrupt-state fail-closed behavior with a temporary isolated profile; mock MyMemory/Qwen/SharedAI/Google-open paths; test provider cancellation isolation and disabled gates; hand off Unicode text including whitespace/apostrophe/hyphen/Chinese/Japanese/emoji/punctuation through repeated/superseding/reload cases and verify stale acknowledgement handling; verify prefill preserves exact text, clears stale UI state, and only schedules the existing 450 ms auto behavior.

**Verification:** focused automated tests pass; isolated data only; no provider network/credential access.

### Task 5 — Independent SDK author and packaged plugin workflow

**Depends on:** Task 2 and Task 3.

**Files:** existing SDK workflow and packaged Plugin Center smoke scripts; temporary author/evidence directories outside repo.

**Contracts:** sample plugin begins outside source tree and uses public SDK only; install/grant/enable/open/use/disable/enable/reinstall-or-upgrade/uninstall keep/delete data are host-controlled; no arbitrary code execution.

**Steps:** execute Phase 5H SDK workflow to create/validate/pack external `.wtplugin`; verify SHA-256; use fresh isolated NativeHost/Manager/profile to exercise supported install and lifecycle path via current packaged smoke; include revoke and both uninstall-data choices where supported.

**Verification:** author tree has no WebTools source modifications; SDK/host schemas agree; package install and cleanup evidence is captured outside repo.

### Task 6 — Isolated Windows Release Candidate and lifecycle/installer checks

**Depends on:** Tasks 2–5.

**Files:** existing package scripts/config only unless an isolated test-only verifier addition is necessary; final report; artifact outside tracked source.

**Contracts:** production install/profile/registry/shortcut/startup and unrelated apps remain untouched. Use a fresh unique output root/profile/pipe and verified process identities. Never terminate by process name.

**Steps:** run existing `pnpm run package:win` after reviewing its exact side effects; confirm current `native-production` script writes to a unique release root, uses `/PHASE4FTEST`/test identity, and uninstalls only its smoke target. Record candidate path/size/hash/source commit/build time/platform/tool versions, NativeHost EXE/DLL, Manager EXE/app.asar, UpdateHelper hashes and Authenticode states. Verify fresh install, NativeHost-only idle, Manager open/close (Electron group returns to zero), restart, ten bounded Manager open/close cycles, isolated data preservation on supported upgrade, and uninstall/no orphan. Collect bounded Working Set/private memory/idle CPU/handles only as observations, without arbitrary threshold or soak.

**Verification:** exact identity path/PID/start time is validated on every close; NativeHost=1 and Electron=0 while idle; no production path touched; package and installer checks succeed. Mark GUI-only behaviors `USER MANUAL REQUIRED`.

### Task 7 — Final report, whole-change review, checkpoint, and push

**Depends on:** Tasks 1–6.

**Files:** `docs/webtools-phase5i-final-acceptance.md`, this plan, narrowly required Phase 5I tests/scripts, minimum reproduced fixes only.

**Contracts:** no evidence inflation; classify P0/P1/P2/P3. Use `PHASE 5I ENGINEERING ACCEPTANCE COMPLETE — USER MANUAL GUI ACCEPTANCE REQUIRED` only when all required automated and packaged gates (including current upgrade/uninstall evidence) pass and only physical-input/visual checks remain. If a required current install/upgrade/data-retention gate lacks evidence, use `PHASE 5I INCOMPLETE — MANUAL VERIFICATION REQUIRED`. Only proceed with checkpoint when no P0/P1/blocking P2 and all claims are evidence-backed.

**Steps:** populate all required report sections and evidence labels; compare every claim to logs, tests and hashes; run final `pnpm run typecheck`, `pnpm test`, `pnpm run build`, NativeHost Checks, UpdateHelper Checks, `git diff --check`; perform fresh whole-branch read-only review; stage only Phase 5I files, inspect staged diff and check; create a precise Phase 5I checkpoint and normal-push current upstream; verify clean worktree and sync.

**Verification:** no PR, merge, tag, release or upload; report states remaining manual checklist and exact candidate path.

## Physical Windows acceptance checklist (must remain pending unless actually completed)

1. Use the isolated Phase 5I candidate, never `D:\webtools` or the production profile. Cold-launch: tray/native Launcher appears, exactly one NativeHost, zero Electron processes until Manager is requested.
2. Use a physical hotkey and mouse to show/hide the Launcher; test query focus, Escape/blur, English/Chinese/pinyin/initials, website and special search modes; confirm transient search state clears after hide.
3. Open Manager from tray and physically navigate Favorites/Websites, Settings, Translation, and Plugin Center; test keyboard Tab/Enter/Space/Escape, resize, narrow/normal layouts, focus/labels and visible error/disabled states.
4. In Plugin Center use the actual file picker to install the external `.wtplugin`; perform install, permission consent/rejection, replace/upgrade/downgrade where offered, disable/enable, uninstall keep-data and delete-data. Confirm visible state and dialogs.
5. Check both Light and Dark themes; long plugin name/description, permission list, error message and disabled controls.
6. Close Manager normally and confirm its Electron process group exits while NativeHost/tray remain; reopen Manager.
7. Installer physical acceptance: install the isolated RC, verify shortcut/icon and Manager path, perform the supported isolated upgrade preserving test data, then uninstall and verify only the test installation was removed.

For each item record PASS/FAIL, build identity, path, time, and observed behavior. Do not supply production credentials or enable real AI requests.

## Final decision rules

- `PHASE 5I INCOMPLETE — BLOCKING ISSUE` if a P0/P1/blocking P2 remains or automated/packaged gates fail.
- `PHASE 5I ENGINEERING ACCEPTANCE COMPLETE — USER MANUAL GUI ACCEPTANCE REQUIRED` if all automated and packaged gates pass, production data is untouched, P0/P1/blocking P2 are zero, and any physical GUI item remains.
- `PHASE 5I INCOMPLETE — MANUAL VERIFICATION REQUIRED` if a required current install/upgrade/uninstall or data-retention acceptance gate lacks evidence, even when the automated product checks pass.
- `PHASE 5I COMPLETE — RELEASE CANDIDATE ACCEPTED` only after the user confirms required physical Windows acceptance and no blocker remains.
- Stop after this phase. No Phase 6 or publishing actions.

## Execution record — 2026-10-05

The initial matrix above is retained as the plan's pre-execution snapshot. Current outcomes:

| Area | Current automated / packaged result | Physical GUI | Final result |
|---|---|---|---|
| NativeHost | Current packaged lifecycle pass; one isolated host, Electron zero at idle/after Manager close | User-visible tray/hotkey behavior pending | MANUAL REQUIRED |
| Launcher | Search/reset contracts covered by existing current checks; packaged run uses isolated runtime control | Physical typing, focus, hide, visual behavior pending | MANUAL REQUIRED |
| Manager lifecycle | Current packaged normal close/reopen and 10 open/close cycles pass | Physical navigation/keyboard pending | MANUAL REQUIRED |
| Favorites | Current isolated Manager state/persistence covered | Physical CRUD/layout pending | MANUAL REQUIRED |
| Settings | Current automated persistence/handoff-related checks pass | Physical controls/apply/cancel pending | MANUAL REQUIRED |
| Translation | Current focused lifecycle/provider-mock/handoff tests and packaged page open pass | Physical controls/visual behavior pending | MANUAL REQUIRED |
| Shared AI | Mocked authorization/consumer-isolation tests pass; no real provider call | Real provider is optional and not required | PASS (mocked authorization scope) |
| Plugin Catalog | Current identity/manifest/security tests pass | Physical navigation/visual state pending | MANUAL REQUIRED |
| Plugin install | Isolated packaged install contract and plugin lifecycle pass with test-only mocked consent | Native picker and dialogs pending | MANUAL REQUIRED |
| Plugin permissions | Automated fail-closed, revoke and data-isolation coverage passes | Actual consent/rejection dialogs pending | MANUAL REQUIRED |
| SDK | Independent author install/typecheck/validate/pack workflow passes | N/A | PASS |
| Plugin pack | External `.wtplugin` validates with SDK and host; hashes recorded | N/A | PASS |
| Installer | Candidate built; isolated fresh smoke, exact Manager discovery, self-uninstall pass | Interactive installer pending | MANUAL REQUIRED |
| Upgrade | Delayed-uninstaller fixture passes; no current real app-to-app upgrade/data-preservation test | Current candidate upgrade must be tested in disposable environment | MANUAL REQUIRED |
| Uninstall | Isolated candidate self-uninstall and no smoke-target residue pass | Interactive current app uninstall/data policy pending | MANUAL REQUIRED |

- Tasks 1–6: complete. See the Phase 5I report for commands, evidence roots, hashes, and limitations.
- Task 7: final review found two P2 acceptance-tool/evidence gaps; both were fixed in one bounded review-fix pass with targeted regressions. Scoped re-review confirmed both addressed, no new Critical/Important findings, and all 12 evidence hashes match. Final staged-diff inspection, checkpoint, push and post-push synchronization verification remain the closeout steps.
- Final automated regression after all current test/driver changes: typecheck PASS; Node 278/278 (0 failures/skips); build PASS; NativeHost 55/55; UpdateHelper 10/10; PowerShell 5.1 AST/Unicode PASS; focused CDP probe tests 11/11; `git diff --check` PASS after final report edits.
- The current candidate's real old-version → current-version application upgrade and plugin-data retention were not run; Phase 4F history predates the plugin data model and is not sufficient evidence. Final phase state therefore remains `PHASE 5I INCOMPLETE — MANUAL VERIFICATION REQUIRED` until the isolated manual upgrade and physical GUI gates are confirmed. The candidate is not a published release.
