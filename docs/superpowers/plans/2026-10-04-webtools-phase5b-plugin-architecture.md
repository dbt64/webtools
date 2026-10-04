# WebTools Phase 5B Plugin Architecture Design Plan

> **Status:** Complete. This plan records the Phase 5B read-only audit and design work. It is not an implementation plan for Phase 5C.

**Goal:** Produce a code-grounded plugin architecture and security design for WebTools without changing product code.

**Architecture:** Audit the current NativeHost / Electron Manager seam, compare extension and execution models against official platform documentation, select a bounded v1 that uses independently installable declarative packages interpreted by the Manager host, then record package, capability, lifecycle, storage, UI, and acceptance contracts.

**Tech Stack:** WPF / .NET 10 NativeHost; Electron 44.4.5 Main and sandboxed preload / renderer; Vue 3; Node.js; pnpm 9.15.9; electron-builder and the existing NSIS NativeHost-first installer.

**Source:** User-authorized Phase 5B design request dated 2026-10-04, plus the current repository and the Phase 5A / 4F / 4G-6 records.

## Global Constraints

- NativeHost remains the only resident launcher, tray, search, hotkey, and login-startup owner.
- Electron Manager remains on-demand and must be absent while NativeHost is idle.
- Phase 5B may change only this plan and the Phase 5B architecture report.
- Do not implement a loader, registry, IPC, permission broker, UI, or sample plugin in Phase 5B.
- Do not add dependencies, alter data schemas, or modify real profiles, installation, registry, or startup state.
- Do not begin Phases 5C–5F; they remain subject to separate approval.
- No force push, merge, PR, tag, or release.

## Review Focus

- Native Launcher remains independent from Electron and never evaluates plugin content.
- No package content can become JavaScript, HTML, CSS, a Vue component, a Node module, or an arbitrary file path.
- Renderer receives only sanitized plugin descriptors and uses a narrow typed bridge; it never receives Node APIs, credentials, or filesystem paths.
- Shared AI access is brokered through the existing SharedAIService; plugin code never reads SecretStore.
- Plugin discovery and execution do not keep Electron, NativeHost tasks, child processes, or background listeners alive after Manager close.

---

## Task 1: Verify Git and Source Baseline

**Files:** Read-only inspection of Git state and existing documentation.

**Interfaces:** Establish current branch, source identity, upstream, and whether the design can safely proceed.

- [x] Confirm the current branch is codex/shared-ai-translation-2.0.
- [x] Confirm HEAD is the Phase 5A checkpoint 7551a2c464d8a7bab09856b8071aa34a1b61bd0e.
- [x] Fetch origin and confirm HEAD and upstream are synchronized.
- [x] Confirm the initial working tree is clean.
- [x] Read the Phase 5A report and plan, Phase 4F removal record, and Phase 4G-6 closeout.
- [x] Record that Phase 5A’s earlier “no plugin framework needed” recommendation is superseded by the user’s explicit Phase 5 objective; preserve the historical report unchanged.

**Verification:** git status is empty; branch/upstream are correct; HEAD...upstream is 0/0.

## Task 2: Trace the Current Runtime and Persistence Seams

**Files:** Read-only review of electron/main.ts, electron/preload.ts, src/shared/ipc.ts, electron/ipc/*, electron/services/*, src/App.vue, native Manager controller / launcher / pipe, and build scripts.

**Interfaces:** Document what owns resident work, which renderer exists, how on-demand Manager launch works, where privileged APIs are exposed, and which files own user data.

- [x] Trace NativeHost startup, single-instance behavior, tray/search ownership, and Manager process discovery.
- [x] Trace the typed Main → preload → renderer API and sender-validation helper.
- [x] Trace DataStore, SecretStore / safeStorage, SharedAIService, TranslationService, and native pipe use.
- [x] Confirm Manager pages are explicit Vue sections in one renderer, with Settings async-loaded.
- [x] Confirm packaged Manager layout and the NativeHost-first installer entry point.
- [x] Search for a dynamic plugin loader, manifest, plugin folder, or general feature registry; none exists.
- [x] Separate verified current-source facts from historical Windows evidence and unknown runtime facts.

**Verification:** The report names the inspected files and does not claim a runtime behavior that was not executed in this design-only task.

## Task 3: Compare Plugin Types and Execution Choices

**Files:** Architecture report only.

**Interfaces:** Decide a v1 package capability envelope and an execution model that can be reviewed before implementation.

- [x] Compare declarative packages, executable scripts, Manager UI extensions, and Native Launcher extensions.
- [x] Compare Electron Main, Worker Threads, Electron utility processes / child processes, Windows OS isolation, and a declarative host interpreter.
- [x] Distinguish process / crash isolation from an operating-system security sandbox.
- [x] Cross-check Electron, Node.js, and Windows claims against official primary documentation.
- [x] Recommend a v1 that can be delivered without keeping Electron resident or granting arbitrary Node / OS access.

**Verification:** Every rejected or deferred option includes its benefit, limitation, architecture impact, and reconsideration condition.

## Task 4: Define Package, Manifest, and Installation Contracts

**Files:** Architecture report only.

**Interfaces:** Specify a portable local package format, a strict schema, conflict behavior, and a safe install transaction.

- [x] Define the .wtplugin ZIP envelope and the files allowed inside it.
- [x] Draft a strict manifest and a package example that contains no executable entry point.
- [x] Define identifier, version, API compatibility, asset, capability, and settings constraints.
- [x] Define safe staging, archive validation, path containment, resource caps, conflict, upgrade, downgrade, rollback, and unsigned-package messaging.
- [x] Mark resource caps as proposed policy to validate in Phase 5C, not as measured product limits.
- [x] Distinguish a package digest used for local integrity from publisher authenticity.

**Verification:** Malformed, corrupt, path-traversal, duplicate-entry, resource-bomb, unsupported-capability, and incompatible-version cases have explicit expected outcomes.

## Task 5: Define Host API, Permission, Lifecycle, and Data Isolation

**Files:** Architecture report only.

**Interfaces:** Specify the smallest future service seam through which the Manager can list, install, enable, invoke, and uninstall a plugin without giving the renderer raw IPC or paths.

- [x] Separate manifest-requested, user-granted, and per-invocation host-enforced capabilities.
- [x] Define v1 deny-by-default capabilities and prohibit arbitrary filesystem, process, network, secret, and NativeHost APIs.
- [x] Define Shared AI mediation, user action / disclosure, request bounds, cancellation, errors, and rate limiting.
- [x] Define the declarative plugin state machine and Manager-close cleanup.
- [x] Define plugin package, configuration, private data, cache, and redacted diagnostic locations below the existing user profile.
- [x] Define data retention and delete-data consent separately from package uninstall.

**Verification:** A plugin cannot read another plugin’s data, full DataStore, SecretStore, AI key, or NativeHost pipe through any v1 interface.

## Task 6: Define Manager UI, SDK, and Phases 5C–5F

**Files:** Architecture report only.

**Interfaces:** Turn the architecture decision into independently reviewable, separately approved implementation phases.

- [x] Place the future plugin center under the existing Apps navigation; keep Favorites as the default Manager home.
- [x] Define install, inspect-permissions, enable, revoke / disable, configure, update / replace, and uninstall flows.
- [x] Define the v1 SDK as a versioned JSON schema and declarative action contract, not an unnecessary JavaScript SDK.
- [x] Plan an independently authored example package and packaged-Windows compatibility coverage.
- [x] Give Phases 5C, 5D, 5E, and 5F inputs, deliverables, acceptance gates, prohibited work, and stop conditions.
- [x] Include the existing MyMemory Settings wording issue as a narrow Phase 5D copy task only.

**Verification:** No later phase is authorized by this plan; every phase has an explicit user-approval gate.

## Task 7: Define Security, Performance, and Windows Acceptance

**Files:** Architecture report only.

**Interfaces:** Establish reproducible test scenarios without inventing performance results or thresholds.

- [x] Define a no-plugin baseline, all-disabled case, and small enabled-package case.
- [x] Specify measurements and repeatable before / after method; defer numeric budgets until an agreed baseline exists.
- [x] Define hostile package, denied permission, AI-secret, cancellation, resource cap, cleanup, and profile isolation tests.
- [x] Preserve NativeHost idle Electron=0 and normal Manager-close Electron=0 as hard architecture gates.
- [x] Define Windows installer / upgrade smoke with a disposable install and profile only.

**Verification:** The report labels runtime and GUI work as future tests and does not mark any Phase 5C–5F acceptance as already passed.

## Task 8: Write and Self-Review the Deliverables

**Files:**

- Create: docs/superpowers/plans/2026-10-04-webtools-phase5b-plugin-architecture.md
- Create: docs/webtools-phase5b-plugin-architecture.md

**Interfaces:** The report is the architecture decision record; this plan documents how Phase 5B was audited and completed.

- [x] Add an architecture diagram, comparison tables, strict manifest sample, capability matrix, lifecycle chart, storage layout, and later-phase gates.
- [x] Include official primary source links for platform-security claims.
- [x] Review the report for stale claims, assumptions presented as facts, unresolved placeholders, unsafe sandbox claims, and scope creep.
- [x] Preserve Phase 5A and historical acceptance documents unchanged.
- [x] Confirm only the two approved documents differ.

**Verification:** git diff --check and git diff --cached --check pass; staged path list contains exactly the two Phase 5B documents.

## Task 9: Create and Push the Phase 5B Documentation Checkpoint

**Files:** Only the two files listed in Task 8.

After review, stage only those two paths; run git diff --cached --check; inspect the staged file list and diff; commit as **docs: design phase 5b plugin architecture**; push normally to the configured current-branch upstream; then verify commit SHA, upstream synchronization, and worktree state. Do not force push, merge, create a PR, tag, or release.

**Verification:** git status -sb, git log -1 --oneline, and left/right HEAD...upstream count are reported from command output.

## Phase 5B Completion

Phase 5B is design-only. Stop after the documents are reviewed and the documentation checkpoint is pushed. The next action requires the user to review and approve the architecture; do not start Phase 5C in this task.
