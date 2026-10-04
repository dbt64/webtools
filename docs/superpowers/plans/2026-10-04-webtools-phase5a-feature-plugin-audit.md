# WebTools Phase 5A — Feature & Plugin Audit Plan

> **Status:** Complete. Audit and documentation only; no Phase 5B–5F implementation was started.

**Goal:** Establish an evidence-based inventory of the current NativeHost, Manager, AI, Translation, settings, and module/provider implementations, then revise the Phase 5 roadmap to avoid duplicate work.

**Baseline:** `codex/shared-ai-translation-2.0` at `d17b778c06d125f1f4fb083d1209fbaef5c42791`; upstream `origin/codex/shared-ai-translation-2.0`; clean and synchronized at audit start.

## Guardrails

- Read current implementation, registration paths, tests, package/build config and historical acceptance records. Do not infer completion from a feature name or old roadmap.
- Do not modify product code, runtime configuration, dependencies, schemas, IPC contracts, user data, credentials, startup registration, or installed applications.
- Reuse Phase 4G-6 and prior acceptance evidence only for unchanged code paths. Do not rerun stress, lifecycle, Soak, installation or credential-backed Provider tests.
- Use mocks/isolated tests if an additional low-risk test is necessary. Never use a real AI credential or incur provider charges.
- Create only this plan and `docs/webtools-phase5a-feature-plugin-audit.md`; review, commit and push these Phase 5A documents only.
- Stop after the Phase 5A report. Do not start 5B–5F.

## Tasks

### Task 1 — Git and acceptance baseline

- Confirm branch, HEAD, clean status, upstream sync, G6 commit publication and G4/G5 ancestry.
- Read Phase 4G-6 closeout, prior AI/Translation decisions and applicable acceptance reports.
- Record which historical evidence still applies and its evidence class.

### Task 2 — Inventory current product surfaces

- Trace NativeHost startup, Launcher/search, hotkey/tray/startup, app catalog, websites, Manager handoff and Everything integration.
- Discover Manager routes/default page, navigation, settings sections, website/favorites UI, translation UI, and any additional visible or registered features.
- Identify persisted models and main/preload/renderer contracts without changing them.
- For each feature, record concrete implementation paths and relevant tests/evidence.

### Task 3 — Audit modules, Providers and shared AI

- Trace Settings → AI config → Provider/model → credential store → shared service → consumers.
- Identify the distinction between product modules, AI providers, translation adapters and infrastructure services.
- Check configuration persistence/switching, missing credentials/model/error behavior, lifecycle/cancellation and tests.
- Search for implemented-but-unregistered modules, dead settings, duplicate configuration, or visible-but-unavailable entries.

### Task 4 — Audit Translation 2.0 and user workflows

- Trace exact Native Launcher handoff, prefill/acknowledgement, translation request state, provider selection, cancellation/stale-response handling, result/error display and persistence.
- Verify which requirements are approved and which are only possible future ideas.
- Review Manager entry discoverability and settings usability using observable workflows and current UI code, not subjective redesign preferences.

### Task 5 — Evidence and roadmap classification

- Assign `COMPLETE`, `PARTIAL`, `NOT IMPLEMENTED`, `UNVERIFIED`, or `OPTIONAL` to every audited capability.
- Assign P0–P3 only to evidenced issues; missing tests are coverage gaps, not assumed product defects.
- Reassess 5B–5F, merge/skip completed work, and define the smallest next approved scope with acceptance evidence.

### Task 6 — Report, review and checkpoint

- Write `docs/webtools-phase5a-feature-plugin-audit.md`, including a completion matrix, evidence locations/classes, issues, priorities, and revised roadmap.
- Ensure no historical results are rewritten and no product/runtime file is staged.
- Run `git diff --check` and `git diff --cached --check`; inspect exact staged paths/diff.
- Commit and push only the approved Phase 5A plan/report to the current upstream; verify clean status and synchronized commit.

## Acceptance

Phase 5A is complete only when every conclusion is tied to current code, a test, or labeled historical/user evidence; the report separates confirmed gaps from optional ideas; all 5B–5F recommendations avoid duplicate implementation; no product/user environment changes occurred; and the documentation checkpoint is pushed.

## Execution Record

- Confirmed the branch and G6 source baseline at `d17b778c06d125f1f4fb083d1209fbaef5c42791`; upstream was synchronized (`0 0`). The only task-created changes were this plan and the Phase 5A audit report.
- Inspected NativeHost startup, Launcher/search, hotkey/tray/startup, catalog, result dispatch, Manager named-pipe synchronization and lifecycle; inspected Manager page registration, website/folder UI, Settings, Shared AI, credentials, translation services, IPC/preload and tests.
- Reused applicable Phase 4F–4G6 Windows and process evidence without rerunning installation, lifecycle, stress, soak or real-user-profile tests.
- Ran `pnpm run typecheck` — PASS; `pnpm test` — PASS, 118/118. The Node test runner emitted the already-recorded `MODULE_TYPELESS_PACKAGE_JSON` warnings; no tests failed.
- Reused the G6 exact-source evidence for `pnpm run build`, NativeHost Checks (55/55), UpdateHelper Checks (10/10), packaging and installed Windows acceptance. No live AI Provider call or test credential was used.
- Findings: P0 0, P1 0, newly found P2 0, P3 1 (Settings copy says click-to-translate while the current configured translation page auto-submits after typing pauses); two inherited non-blocking G6 P2 observations remain referenced as deferred architecture/security notes.
- No product code, build/runtime configuration, dependency, lockfile, IPC contract, data, credential, installation, tray, global hotkey, or startup-registration changes were made.
- The report is `docs/webtools-phase5a-feature-plugin-audit.md`. Only this plan and that report are approved for the Phase 5A documentation checkpoint.

Stop after Phase 5A and wait for the user's review before any later phase.
