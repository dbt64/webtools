# Phase 6G-2 — Selected-Text Basic Parity & Reliability Implementation Plan

**Status:** BUSINESS ADJUSTMENT IMPLEMENTED IN SOURCE — focused Native checks PASS. The original optional example passed the user's manual test; the new built-in delivery still requires a packaged manual check. Phase 6G-2 remains IN PROGRESS; the completed 6G-1 manual gate is not reopened. Execution evidence and exact scope: [6G-2 report](../../phase6g2-selected-text-basic-parity.md).

**Roadmap authority:** `docs/phase6f-plugin-platform-roadmap-after-utools-analysis.md` §U.

**Design authority:** `docs/superpowers/specs/2026-10-16-phase6g0-feature-quick-result-design.md`. The explicit user activation rule remains in force.

## Goal

Complete the selected-text foundation before differentiated text intelligence:

1. Match actions against the selected-text context and, where a user-approved finite rule applies, against the transient selected text itself.
2. Verify the existing built-in Translation Manager handoff and independent plugin-window context handoff as separate routes.
3. Close reproducible Super Panel list, result, capture and lifecycle reliability gaps with focused fixes only.

The work does not implement same-panel real Translation Quick Result, automatic translation, a dictionary, a new translation provider, or a general executable matcher engine. Those remain outside 6G-2.

## Entry Gates

### Gate 0 — Close 6G-1 real UI acceptance

**CLOSED — USER CONFIRMED PASS.** The user confirmed that the requested 6G-1 manual tests, including the reported panel-height fixes, had no remaining issues. See `docs/phase6g1-feature-quick-result-foundation.md`. Synthetic Quick/Long results remain foundation-fixture evidence; this does not establish real translation, dictionary, or text-content matching. Do not reopen this manual gate during 6G-2.

### Gate 1 — Approve the content-match contract

**CLOSED — APPROVED.** The user selected “采用最小链接匹配与真实示例（推荐）” before metadata implementation. The single `http-url` shape rule and optional real Selected Text Actions example are the approved first contract. The Task 1 inventory/proposal below preserves the decision context; it is not an unapproved new gate.

### Gate 2 — Confirm safe test isolation

**CLOSED for the recorded automated run.** run07 used canonical-path/PID/creation-time ownership, separate profile/pipe and disposable builds under the requested D-drive test root. The production installation/profile was not used. See the execution report for exact artifact identities and evidence.

Use `D:\SystemDefault\Desktop\webtoolstest` for disposable packages, test profiles and evidence when practical. Before running the packaged app, identify a supported profile/pipe isolation mechanism. Do not use `%APPDATA%\Nook`, `D:\webtools`, real credentials, or the user's installed plugin data. If a reliable isolated profile and identity cannot be established, stop packaged acceptance and report the blocker.

## Frozen Boundaries

- Selected text used for discovery stays transient and local to NativeHost. Do not send it to Electron/Main, add it to projection/cache, or include it in diagnostics/logs for matching.
- Electron/Main may project only bounded, validated matcher metadata and Feature identity. An explicit user activation may pass context only through the existing authorized invocation route.
- Keep `acceptedContexts` as the context type/source gate. Content rules refine a selected-text match; they do not grant invocation authority or runtime capabilities.
- No plugin-provided JavaScript, regex execution, arbitrary expressions, external matcher process, or unbounded rule list.
- Do not automatically invoke Translation during capture or matching. Keep explicit user activation. Any proposal to add automatic preview requires a separate product decision covering trigger, settings, external-service/privacy impact, cancellation and acceptance.
- Existing built-in Translation Manager handoff and same-panel Quick Result are different routes. Do not silently migrate one to the other.
- Keep test artifacts under `D:\SystemDefault\Desktop\webtoolstest`; do not place temporary profiles/evidence in C-user cache directories.
- Preserve all pre-existing working-tree changes. Do not stage, commit, push, reset, clean, or stash as part of this plan.

## Current Code Seams (Static Source Map)

- `native/WebTools.NativeHost/SuperPanel/SelectionContext.cs`: current text matcher checks context type/source; current file/directory matcher checks types, sources, extensions and item limits.
- `native/WebTools.NativeHost/SuperPanel/SuperPanelFeatureSelection.cs`: performs local projection traversal and separates pinned/general/selection results.
- `native/WebTools.NativeHost/Data/NativeFeatureProjectionStore.cs`: strict Native projection parser/cache; unknown fields are rejected.
- `src/shared/feature-contracts.ts`: shared projection schema and parser.
- `electron/plugins/manifest-v3.ts` and the canonical `plugin-sdk/declarative-v1/runtime-v3/manifest-v3.mjs` implementation (re-exported through `plugin-sdk/runtime-v3/manifest-v3.mjs`): production Manifest v3 validation surfaces; keep Host install-time validation authoritative.
- `plugin-sdk/declarative-v1/manifest.schema.v3.json`: published authoring schema must match runtime validation.
- `electron/plugins/feature-registry.ts`: constructs the live Native projection, including the built-in Translation row.
- `electron/plugins/plugin-development.ts`: creates the in-memory development overlay; apply the same matcher metadata rules if selected-text development Features are in scope.
- `native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml.cs` and `SuperPanelPresentationChecks.cs`: action/result rendering, projection refresh, scroll and constrained-height seams.
- `electron/services/feature-invocation-service.ts`: explicit Feature activation. Built-in Translation uses `openTranslation(..., selectedText)`; selected-text Quick Result remains a separate Node Command route.
- `electron/services/feature-activation.ts` (`FeaturePresentationRouter`), `electron/plugins/plugin-window-manager.ts`, `electron/plugins/web-plugin-runtime.ts`, `electron/plugins/web-host-capabilities.ts`, and SDK `web/invocation-context.mjs`: existing independent plugin-window context path; runtime verification is still required.

Source presence proves a static path only. It does not prove packaged capture, focus, translation scheduling, renderer behavior, or window handoff at runtime.

## Phase 6G-2A — Selected-Text Content Matching

**Classification:** Basic product capability / basic parity.

### Task 1 — Freeze the smallest useful matcher contract (review gate; no code)

**Purpose:** Define match behavior from actual WebTools actions and supported user scenarios, without inventing parity semantics.

1. Inventory every currently selectable selected-text Feature and its real operation. Distinguish built-in Translation, plugin Window actions, Node Commands, generic text actions, and any actual first-party search action. Do not count fixture-only `Synthetic` actions as product capabilities.
2. Produce a behavior table for ordinary English, Chinese, mixed-language text, punctuation/empty text, URL-shaped text, and bounded long text. Identify which real action should appear for each case.
3. Record that the current code checks accepted context type/source but not selected-text content.
4. Propose a closed, bounded, declarative rule vocabulary only for action scenarios that exist and are approved. Define normalization, matching semantics, maximum rule count/length, case handling, malformed input behavior, and how features with no content rule behave.
5. Decide whether a projection version change is required or whether an optional strict extension can safely preserve old-cache compatibility. Unknown fields must remain rejected.
6. Confirm that selected text stays out of the projection, IPC/Pipe discovery messages, persistence, and diagnostics.

**Deliverable:** A behavior matrix and a compact schema proposal appended to this plan or a short linked design note. Obtain user approval before Task 2.

**Stop condition:** If no non-fixture content-specific action exists to ground the rules, do not add speculative matcher types. Report the product gap and propose the smallest real action needed before freezing its rule.

### Task 2 — Add failing contract and privacy tests first

**Candidate files:**

- `src/shared/feature-contracts.test.mjs`
- `plugin-sdk/runtime-v3/manifest-v3.test.mjs`
- `plugin-sdk/declarative-v1/tests/runtime-parity.test.mjs`
- `electron/plugins/package-validator.test.mjs` (if Host validator integration needs additional coverage)
- new focused Native checks, e.g. `native/WebTools.NativeHost.Checks/Phase6G2ASelectedTextChecks.cs`
- `native/WebTools.NativeHost.Checks/Program.cs`

**Tests to specify from the approved Task 1 contract:**

- valid rule parses and round-trips identically through SDK feedback, Host validation, shared projection validation, and Native parsing;
- malformed, unknown, oversized, duplicate, excessive, or incompatible rule metadata is rejected;
- old Manifest/projection without content rules retains the explicitly approved legacy behavior;
- selection content changes match outcome only for the declared supported rule; general text actions remain available according to the approved table;
- selected text is absent from serialized projection/cache, discovery Pipe payloads, and diagnostic strings; use a sentinel value and assert it never appears;
- matching does not activate a Feature, invoke Translation, or cause provider/network activity.

Tests must fail before implementation and must use synthetic input only; synthetic tests are not real UI acceptance.

### Task 3 — Extend authoring and Host validation contracts

**Candidate files:**

- `plugin-sdk/declarative-v1/runtime-v3/manifest-v3.mjs`
- `plugin-sdk/declarative-v1/runtime-v3/manifest-v3.d.mts`
- `plugin-sdk/declarative-v1/manifest.schema.v3.json`
- `plugin-sdk/declarative-v1/README.md`
- `plugin-sdk/declarative-v1/types.d.ts`
- `electron/plugins/manifest-v3.ts`
- `src/shared/plugin-contracts.ts`
- `docs/plugin-development.md` and `docs/super-panel.md`
- matching Manifest SDK/Host tests and author docs.

Keep declarations metadata-only. Align author SDK and schema error behavior where practical, but treat installed Host validation as the final authority. Preserve Manifest v1/v2 compatibility unless the approved contract explicitly requires a versioned change; do not silently broaden old versions.

### Task 4 — Project only bounded rule metadata

**Candidate files:**

- `src/shared/feature-contracts.ts`
- `electron/plugins/feature-registry.ts`
- `electron/plugins/plugin-development.ts` if approved development Features use the same match path
- `native/WebTools.NativeHost/Data/NativeFeatureProjectionStore.cs`
- associated shared, publisher, cache, and Native parser checks.

Project the minimum normalized rule metadata required by the Native matcher. Keep the selected value out of the projection. Preserve projection session/revision semantics and exact-field rejection. Test cache load, update, restart, backward compatibility and invalid projection behavior with an isolated temporary profile.

### Task 5 — Implement local bounded NativeHost matching

**Candidate files:**

- `native/WebTools.NativeHost/SuperPanel/SelectionContext.cs`
- `native/WebTools.NativeHost/SuperPanel/SuperPanelFeatureSelection.cs`
- focused Native checks from Task 2.

Evaluate approved rules against the original bounded in-memory selection text (not the shortened UI preview). Keep the existing type/source gate, deterministic ordering, pinned Translation behavior, no-context shortcut board, and file/directory rules. Matching must not call Main, write the cache, invoke a Feature, or emit selection text to logs.

Do not introduce rankings or fuzzy matching unless Task 1 explicitly includes a bounded rule and expected ordering.

### Task 6 — Verify end-to-end action discovery and data boundary

**Automation:**

- English, Chinese, mixed text, URL-shaped, empty/whitespace and maximum-length cases from the approved matrix.
- repeated context changes and projection replacement while the panel is open.
- no-context still returns the existing general board.
- pinned Translation remains visible for selected text and follows its existing explicit Manager route.
- selected-text sentinel does not appear in discovery transport, projection/cache, or diagnostic output.
- a matching result alone does not invoke a Feature or trigger any translation request.

**Manual packaged acceptance:**

- use the real isolated app in `D:\SystemDefault\Desktop\webtoolstest` and a real selected-text source;
- compare actual visible actions against the approved matrix for representative text and no-selection;
- click an action only in the separate Task 7 handoff acceptance; do not infer invocation from visibility.

## Phase 6G-2B — Real Text Actions and Selected-Context Handoff

**Classification:** Basic operation integration; acceptance-first.

### Task 7 — Verify existing built-in Translation Manager handoff

**Code seam:** `FeatureInvocationService` → `openTranslation` → Native Manager intent/prefill → `TranslateView`.

**Acceptance:** From a real packaged Super Panel, explicitly click built-in Translation. Verify the selected text reaches the existing Manager Translation surface, then record separately whether and when the configured TranslateView prerequisites schedule a provider request. Use an isolated free stub for automated provider assertions; never use a paid provider or real credential. Preserve the approved 6G-0 explicit activation rule.

The current source has an eligible 450 ms auto-schedule after prefill. Treat this as a behavior to verify and reconcile with the older prefill-only statement; do not change the behavior without a user-approved product decision.

### Task 8 — Verify the existing independent plugin-window context handoff

**Code seam:** FeaturePresentationRouter → PluginWindowManager → WebPluginRuntime/WebHostCapabilities → SDK `context.current()`.

**Acceptance:** Install a real validated isolated test package, explicitly activate its selected-text Window Feature, and verify exact context in `context.current()`. Verify a later invocation replaces stale context and that close/disable/revoke behavior remains generation-bound. Static source tests do not substitute for packaged runtime evidence. Keep selected text out of logs.

No new context bridge is planned unless a reproducible packaged failure identifies a missing link.

## Phase 6G-2C — Super Panel Reliability

**Classification:** Basic correctness/reliability; acceptance-first.

### Task 9 — Reuse existing state and layout checks

Review existing generation checks, list scroll reset, virtualization, bounded previews, and constrained-height layout checks before adding any new tests. Add a test only for a missing or failing requirement.

Acceptance matrix:

- first English short selection and long selection;
- same text selected again;
- open after the action list was scrolled;
- projection refresh while visible;
- no-selection default board;
- lower available work area and a scaled-DPI display;
- action list and Quick Result remain separately usable;
- empty/void result, command error, repeated invocation, cancellation, Escape, outside click and close;
- late result after newer selection, user input, dismissal or context switch is discarded;
- no old text or stale result flashes/overwrites the current state.

### Task 10 — Minimal evidence-backed fixes only

Candidate files depend on the reproduced failure and may include `SuperPanelWindow.xaml`, `SuperPanelWindow.xaml.cs`, `SuperPanelPresentationChecks.cs`, or the existing capture/controller implementation. Do not change capture budgets, insert fixed waits, or redesign the panel based only on static suspicion. Every fix must name the failing scenario, expected/actual behavior and focused regression.

### Task 11 — Isolated packaged acceptance and closeout report

Build/package only after automated checks pass and only into the isolated acceptance workflow. Use `D:\SystemDefault\Desktop\webtoolstest`; verify executable path, PID/creation time and isolated profile/pipe identity before interacting with the process. Never modify or close `D:\webtools` or the real `%APPDATA%\Nook` profile.

Report evidence labels separately: automated pass, isolated packaged pass, user-confirmed manual pass, not tested, and inconclusive. Preserve historical 6G-1 evidence and counts. Do not call the 6G-2 package complete if a required real action or UI item remains unverified.

## Verification Commands (approved implementation)

Run relevant focused tests first, then the required regression set:

```powershell
pnpm test
pnpm run typecheck
pnpm run build
dotnet build native/WebTools.NativeHost/WebTools.NativeHost.csproj -c Release
dotnet run --project native/WebTools.NativeHost.Checks -c Release -- --selected-text-matching-checks
git diff --check
```

The Native check switch is implemented and passes 4/4 focused checks. The full command outcomes and separate existing reliability suites are recorded in the execution report. The task did not change installer inputs; unrelated long soak/resource stress phases were not rerun.

## Out of Scope / Later Work

- **6G-3:** Real built-in Translation → same-panel Quick Result. Requires a separate focused design review defining provider ownership, Main/Host path, Shared AI confirmation, empty/error/cancel and result coexistence. Do not start under this plan.
- **6G-4:** Dictionary/definition preview, automatic translation preview or other differentiated text intelligence. Each requires its own trigger, source, setting, privacy/cost, cancellation and acceptance contract.
- Translation provider redesign, second NativeHost translation service, SecretStore changes, automatic invocation during selection, new permissions, broad matcher framework, and unrelated Super Panel/UI refactors.
- Commit, push, PR, merge, tag and release.

## Completion Criteria

6G-2 may be proposed complete only when:

- 6G-1 entry gate is closed with correctly labeled evidence;
- the minimal content matcher contract is user-approved and all validators agree;
- selected text stays local to discovery and is absent from projection, storage and diagnostics;
- approved action match behavior is deterministic and verified on real packaged UI;
- built-in Translation and plugin-window handoffs are verified as separate routes;
- required reliability cases pass or are explicitly classified as unresolved/non-blocking;
- automated and packaged results are recorded without upgrading synthetic or static evidence into user acceptance.

Until those criteria are met: **PHASE 6G-2 IN PROGRESS**.

## Execution status — 2026-10-16

| Task | Recorded status |
|---|---|
| 1 — Inventory / contract | Complete; user approved the closed URL-shape rule and real optional example. |
| 2 — Focused regression | Implemented; common 42-case corpus, strict parser/projection tests and Native 4/4 PASS; full Node 631/631 PASS. |
| 3 — SDK / Host validation | Implemented; SDK 1.8.0, no Product/API/Manifest version change, Host remains install-time authority. |
| 4 — Projection | Implemented; metadata only, authenticated optional peer negotiation, conditional rows omitted for unsupported peers. |
| 5 — Native matching | Implemented; local original bounded selection, no language filter on ordinary text, no discovery invocation/network. |
| 6 — Discovery | Automated and isolated packaged PASS, including Native-only Electron=0. New physical selection/mouse matrix remains manual. |
| 7 — Translation handoff | Existing route verified with exact Manager prefill and one local-stub request after explicit activation; no business behavior change. Physical new-build click observation remains manual. |
| 8 — Plugin Window | Real installed public-SDK Web plugin verified exact/replacement context, target reuse and disable/close. No production bridge reimplementation. |
| 9 — Reliability | Existing WPF presentation 12/12 and result state 33/33 PASS; 6G-1 manual result retained; additional real DPI combinations remain unverified. |
| 10 — Minimal fixes | Fixed optional example's missing deployed SDK import by bundling before official SDK build/pack. Fixed external Web fixture's relative resource base and test-driver readiness; no speculative capture/layout refactor. |
| 11 — Packaged/report | 10/10 isolated packaged PASS, exact remaining process count 0; failures retained. New action/browser manual checks still pending; phase is not marked COMPLETE. |

No stage, commit, push or release; no Phase 6G-3 implementation. The [execution report](../../phase6g2-selected-text-basic-parity.md) separates automated, isolated packaged, historical user confirmation and unverified new manual evidence.

## Task 1 — Source Inventory and Minimal Contract Proposal

### Verified inventory

Source baseline: branch `codex/shared-ai-translation-2.0`, HEAD `707c5673dff479285b34a5b441bec9d3b725c737`, with the existing dirty checkout preserved. This inventory reads repository source and official examples; it does not inspect the user's installed plugin data or real profile.

| Existing operation | Source | Current selected-text behavior | Evidence |
|---|---|---|---|
| Built-in Translation | `electron/plugins/feature-registry.ts`, `electron/services/feature-invocation-service.ts` | Accepts selected text regardless of language/content and sends it to the existing Manager handoff only after activation. | [已由代码/官方资料证实（静态）] |
| Independent Window Feature | `electron/services/feature-activation.ts`, `electron/plugins/plugin-window-manager.ts`, SDK `web/invocation-context.mjs` | Validates context type/source and passes it to the active eligible plugin window; no content-specific rule exists. | [已由代码/官方资料证实（静态）] [待运行验证] |
| Node Command | Same router and `electron/plugins/node-command-execution.ts` | Runs only after explicit activation. Accepted text has no content-specific rule; an optional bounded result can return to the panel. | [已由代码/官方资料证实（静态）] |
| Private Notes official example | `examples/plugins/private-notes/manifest.json` | Declarative v1 page; it is not a selected-text operation and cannot ground a content matcher. | [已由代码/官方资料证实（静态）] |
| Synthetic Quick/Long and acceptance packages | Existing 6G-1 runner/fixtures | Test-only results, not real Translation, dictionary, or browser-search features. | [已由代码/官方资料证实（静态）] |

No repository-shipped non-fixture content-specific selected-text action was found. The existing `external.open` capability can support a real browser action, but the capability alone is not a user-visible action. Do not describe a generic matcher framework as completed product functionality.

### Recommended first real content-specific action

Propose one optional official **Selected Text Actions** example with two explicit Node Commands, using only the public SDK and existing `external.open` capability:

- **Search selected text:** a general non-empty selected-text action; URL-encode the original text into a documented HTTPS search URL.
- **Open selected link:** present only for a complete HTTP(S) URL; after activation, revalidate and use the existing external-open Host route.

This was the pre-implementation proposal: a real optional example, not an automatically installed built-in or a Synthetic result fixture. The user approved it below, and the execution section records its implementation and isolated installation. Source, capabilities, Bing destination and opt-in installation remain explicit.

### Proposed closed metadata

Add only the optional `textMatch: 'http-url'` value to a Manifest v3 accepted context whose type is `text` and whose sources are exactly `['selected-text']`. Absence keeps the existing type/source matching. No language guess, keyword list, regex, plugin callback, ranking, or general rule engine is proposed.

```json
{
  "type": "text",
  "sources": ["selected-text"],
  "textMatch": "http-url"
}
```

Semantics: evaluate the original bounded in-memory selection, trimming only leading/trailing ECMAScript whitespace for URL recognition; require one absolute HTTP(S) URL shape with a non-empty syntactically supported host; reject embedded whitespace/control characters, backslashes, or credentials. Preserve the original selected text in the context passed after explicit activation. The shared JS/C# corpus pins accepted/rejected shapes, case, Unicode labels, IPv4/IPv6 and ports. This finite shape rule is not full IDNA/A-label validation or DNS reachability; invocation and the browser retain their existing URL/security checks. Empty/whitespace-only input is not a usable selected-text payload and must not create an invocation.

| Input | General Translation / general selected-text plugin | Search selected text (proposed example) | Open selected link (proposed example) |
|---|---|---|---|
| English, Chinese, mixed language, punctuation, bounded long non-empty text | Applicable under existing type/source rules | Applicable | Absent |
| Complete valid HTTP(S) URL, including surrounding whitespace | Applicable | Applicable | Applicable |
| Unsupported scheme, partial URL, credentials, embedded whitespace/control, malformed host | Applicable if still a valid non-empty text context | Applicable | Absent |
| Empty/whitespace-only or no selection | No selected-text operation; keep the existing general shortcut board | Absent from selected-text actions | Absent |

The schema adds bounded metadata only: accepted context count remains four, and the new value is a single closed enum. Existing no-rule packages keep their behavior. Manifest v1/v2 remain unchanged. Projection v2 can carry the optional field only after explicit peer support is established; rule-bearing rows must be omitted for older peers rather than stripping the condition and broadening discovery. Preserve strict unknown-field rejection and test cache upgrade/downgrade behavior. The exact optional negotiation uses the current authenticated connection, outside the legacy closed hello list.

Discovery evaluates the rule entirely in NativeHost. Projection/cache/diagnostic data contains only the enum and Feature metadata. After explicit activation, Main rechecks the same rule against the authorized invocation context; that intended handoff is distinct from discovery and does not permit selection disclosure during matching.

### Gate 1 decision

**APPROVED — 2026-10-16:** the user selected “采用最小链接匹配与真实示例（推荐）”. Implement the single `http-url` matcher plus the optional real Selected Text Actions example. The generic `external.open` capability and a test fixture do not themselves satisfy the missing real-action requirement.

Implementation clarification: the existing external-open OS effect and capability name existed, but the Node Command SDK/bridge did not expose them. The example therefore requires a small `webtools.external.open(url)` adapter through the existing Host capability path, with declared/granted capability, current authority, HTTP(S)-only validation and one-use explicit activation. No new permission name or raw OS fallback is added. The additive public contract is SDK 1.8.0; Product Version, Plugin API Major, Manifest and Projection versions remain unchanged. Legacy Manifest v1/v2 behavior is retained.

## 2026-10-17 Product Delivery Adjustment — Built-in Search and Link Actions

The user completed the optional example's manual workflow and reported no functional issue. That result is recorded as **USER CONFIRMED PASS** for the example only. The user then approved a product-boundary change: search and opening a selected HTTP(S) link are baseline WebTools operations and should not require installing the example plugin.

The resulting implementation boundary is:

1. NativeHost contributes `搜索选中文字` for a non-empty bounded `text / selected-text` context.
2. NativeHost additionally contributes `打开选中链接` when the already-approved local `http-url` rule matches.
3. These Host rows precede projected Feature rows in the existing vertical action list. They do not enter the No Context board and cannot be pinned as plugin Features.
4. Search resolves `LauncherStateStore.Snapshot.ToWebsiteSnapshot()` at click time and uses the same enabled/default engine and `%s` template validation as Launcher search. It does not introduce a second setting or a fixed search provider.
5. Both operations retain the 6G-0 explicit-click rule. Discovery does not open a browser, contact a search provider, start Electron, or send selected text across the Pipe.
6. Activation rechecks the live context and the 30-second selection lifetime. URL activation repeats the finite HTTP(S) rule and the existing shell URL validation before launching.
7. The official Selected Text Actions package remains an optional SDK example. WebTools does not silently remove an installed copy; therefore an author/test profile that keeps it installed can show conceptually duplicate example actions until the user uninstalls that package.

This adjustment does not change the `textMatch` contract, SDK 1.8.0, external capability bridge, built-in Translation handoff, independent plugin-window context route, or Quick Result design. It does not add automatic search, automatic translation, dictionary output, a new Manifest field, or a new permission.

Focused source acceptance:

- Native selected-text matching and Host-action contract: **6/6 PASS**.
- Real WPF presentation, deterministic ordering, click routing, dismissal and No Context isolation: **13/13 PASS**.
- Packaged physical-selection/browser acceptance for the built-in delivery: **MANUAL VERIFICATION REQUIRED**.
