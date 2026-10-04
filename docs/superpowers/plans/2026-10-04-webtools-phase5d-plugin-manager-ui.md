# Phase 5D — Manager Plugin Center and Declarative UI Plan

**Baseline:** `codex/shared-ai-translation-2.0` at `e1147f0b2ec7fca7fb3fc14ee864384e6cfee330`, clean and synchronized with `origin/codex/shared-ai-translation-2.0` after fetch. Phase 5C core/report are committed in that checkpoint.

**Goal:** Add a usable Manager plugin center and fixed Vue renderer for validated declarative plugin pages. Keep NativeHost-first architecture, Main permission checks and the no-plugin-code contract. Include a complete AI review UI backed by a Main-owned, one-use transaction; do not trust a renderer `confirmed` boolean.

**Scope:** Phase 5D only. No executable packages, SDK/packer/sample plugin (5E), or final security/Windows acceptance (5F). No NativeHost/pipe, installer, Website/AppData/SecretStore schema, Translation trigger, or broad Manager redesign changes.

## Verified Baseline and Reused Contracts

- `src/App.vue` uses a closed section union and `v-if` page switching; Favorites is the default, Translation is under Apps, Settings is bottom-pinned. There is no Vue Router or keep-alive.
- `window.desktop.plugins` already exposes typed `list`, Main-owned `installFromUserDialog`, `setEnabled`, `setGrants`, `getPages`, `invoke`, and `uninstall` methods. IPC validates the Manager main-frame sender and runtime argument shapes.
- Main `PluginManager` owns install/recovery/permissions and `DeclarativeRuntime`; package files contain only validated JSON and bounded PNG. Existing consent dialogs handle install/trust, grants, sensitive actions, uninstall and keep/delete data. The Phase 5D review found that replacement/downgrade consent did not yet summarize the old/new versions and capability delta; Task 6 closes that gap with a typed version-change summary.
- The current plugin DTO lacks summary author/description/API details, declared action key bindings, and safe settings values. No read/write settings form API is needed: expose bounded config values through the authorized `getPages` DTO and map config controls to already-declared `plugin.config.write` action IDs.
- Existing AI invoke opens a Main native consent dialog and rejects previews above 24,000 characters. Keep that path fail-closed for direct legacy invokes. The UI path will use Main-owned pending review transactions, described below.
- Translation auto-sends after approximately 450 ms when configured. Settings currently says MyMemory sends only after clicking Translate; this is the confirmed 5A copy mismatch.
- No Vue component test framework is configured. Add pure UI-contract/model tests with the existing Node test runner, source-level rendering safety assertions, and a real packaged Manager smoke. Do not add a dependency solely for test scaffolding.

## Interfaces and Safety Decisions

### Plugin presentation DTOs

- Enrich safe `PluginSummary` with manifest description, author name/optional HTTPS URL, API major/minimum host version, an explicit local/unsigned source label, and optional bounded icon data URL. Keep fields optional on input to the registry validator so a 5C registry remains readable; initialization fills metadata from the validated current package and atomically saves it. Recovery derives metadata from validated packages. If a package cannot be validated, show safe fallbacks and its stable error code.
- Enrich `PluginPageDTO` with a closed action descriptor (`id`, `type`, optional declaration-bound `key`), and safe persisted/default config values only when the plugin has `plugin.config.read`. Return manifest settings/defaults regardless, but never package paths or raw manifest objects.
- Require each rendered setting control to have a matching declaration-bound `plugin.config.write` action. Enforce this at manifest validation with a regression test; a control without a matching write action is invalid, not a dead UI control.

### Full AI request review transaction

Add narrow typed APIs: `prepareAIReview(request)`, `confirmAIReview(reviewId)`, and `cancelAIReview(reviewId)`. Preparation revalidates current Main-frame session, plugin/version/hash, action declaration, input, grant, package integrity and active state; it resolves the current selected provider/model and returns a DTO with the exact complete messages, character/message counts, plugin identity and opaque random `reviewId`. It returns no credential or provider identity fingerprint.

Main stores one pending review per plugin, bounded by a 120-second expiry, containing the immutable parsed action input, request digest, plugin/version/hash/action, Manager session, runtime identity and provider/model identity. A new review replaces that plugin's previous pending review. Cancel, expiry, page unmount, plugin disable/revoke/upgrade/uninstall, Manager reload and close remove it. Confirmation accepts only the opaque ID, consumes it before asynchronous work, then rechecks session/runtime/status/version/hash/grant/action/input digest and current provider/model identity before dispatch. It never accepts caller-supplied messages, provider identity or `confirmed: true`. The reviewed invocation reuses the normal AI concurrency/rate/output/timeout controls but skips the 5C native preview because the UI has shown the complete, bound content. Any failed check consumes the review and sends no provider request. Existing direct `invoke(sharedAI.complete)` remains on the 5C native-dialog path and remains limited to 24,000 characters.

This token is a one-use operation bound to the trusted, fixed Manager UI and its exact content, not an OS-level proof of physical input. The contract remains safe because package data is rendered only by host-owned Vue components, with no executable plugin code or arbitrary renderer API. This trust assumption and the Main rechecks must be documented and tested; if the fixed-renderer assumption changes, revisit the confirmation boundary before execution models change.

### UI state and trust

- Plugin center displays local unsigned status accurately; SHA-256 is an integrity digest, not publisher authentication. Existing Main dialogs remain authoritative; the renderer must not duplicate or claim those dialogs succeeded before the IPC result returns.
- Only active, compatible, enabled plugins with `manager.page` granted appear in the Apps submenu. The center remains reachable if all plugins are disabled or invalid. Disabling/removing the currently viewed plugin navigates back to the center.
- Declarative renderer handles only the seven 5C block types and uses normal Vue interpolation/attributes. It must not use `v-html`, Markdown, runtime component imports, plugin URLs, or untrusted file paths.
- Config edits map setting keys to declared write action IDs. Sensitive host actions show working/success/cancelled/stable error states, prevent duplicate submit, and reject late results when the active plugin/page generation changes.
- The AI review dialog shows every accepted message without clipping, with provider/model, plugin/capability, counts, data-transfer notice, explicit confirm/cancel and accessible focus/Escape handling. Long content scrolls; there is no “confirm truncated preview” path.
- MyMemory copy will say that when selected/configured, text is sent after about 450 ms of inactivity; changing the engine itself does not send text.

## Task Order and Verification

All tasks are implemented inline and serially; Task 4 waits for both UI components. Do not split Main review/lifecycle work across independent implementers.

### Task 1 — Shared DTOs, compatibility metadata, safe config projection, AI review API

**Files:** `src/shared/plugin-contracts.ts`, `src/shared/ipc.ts`, `electron/preload.ts`, `electron/ipc/plugin-handlers.ts`, `electron/ipc/plugin-handlers.test.mjs`, `electron/plugins/manifest.ts`, `electron/plugins/manifest.test.mjs`, `electron/plugins/plugin-registry.ts`, `electron/plugins/plugin-manager.ts`, `electron/plugins/plugin-manager.test.mjs`, `electron/plugins/declarative-runtime.ts`.

**Contracts:** Metadata-rich safe summaries; config/action details in `PluginPageDTO`; prepare/confirm/cancel review DTO/API; one pending Main transaction/plugin, TTL 120s, consume-once, bound identity/content/provider, async invalidation. Backwards-compatible registry optional fields and old 5C package/config handling.

**Steps:** Add RED tests first for old registry metadata migration, settings/action correspondence, summary trust text/metadata, safe config projection, token input forgery/expiry/consume-once, every identity/provider/session/state mismatch, and cancellation on plugin/session lifecycle. Implement the bounded Main manager operations and wire fixed invoke IPC/preload methods. Keep direct 5C native AI confirmation behavior intact. Add manifest validation to require a write action for each declarative form setting.

**Verification:** Focused manifest/registry/manager/IPC tests (RED→GREEN), `pnpm run typecheck`, then full `pnpm test` before Task 2.

### Task 2 — Plugin management center

**Files:** New `src/features/plugins/PluginManagerView.vue`, focused pure view-model/test files under `src/features/plugins/`; `src/styles/tokens.css` only if existing tokens need plugin-center-specific layout classes.

**Contracts:** Props/events pass safe summaries and navigation intents; all mutations await `window.desktop.plugins` and refresh from Main. No renderer paths, consent flags or direct storage.

**Steps:** Render empty/loading/error/retry states; plugin rows with icon/name/version/author/description/status; details with ID, local-unsigned warning, SHA digest (explicitly labeled integrity only), API requirement, requested/granted capabilities, versions and safe stable errors/recovery guidance. Add install/import, enable/disable, grant/revoke, uninstall and keep/delete outcomes using existing Main dialogs. Show busy/result/cancelled states; prevent duplicate submits; show form labels, focus and responsive layout. Uninstall uses the 5C native keep/delete confirmation.

**Verification:** Node test of status/capability/trust/action display model plus SFC rendering-policy test; focused `pnpm test -- ...`; `pnpm run typecheck`.

### Task 3 — Declarative page and settings renderer with review dialog

**Files:** New `src/features/plugins/DeclarativePluginView.vue`, `PluginAIReviewDialog.vue`, and focused pure display/input model tests under `src/features/plugins/`.

**Contracts:** Input is only `PluginPageDTO`; host dispatch receives action ID and closed input; AI flow uses prepare → display exact returned review DTO → confirm/cancel by opaque ID. Result states are scoped to plugin/page generation.

**Steps:** Exhaustively render heading, paragraph, text-input, select, checkbox, divider and button using Vue text bindings. Load safe config from DTO, validate setting bounds locally, save via the declaration-bound write action, and show pending/saved/error states. Prevent duplicate actions. Route AI actions to the review dialog; display all exact messages, provider/model, plugin/permission, counts and transfer warning in a scrollable accessible dialog with Escape/cancel and focus management. Cancel review on dialog close, component unmount/navigation, and ignore stale completions. Render safe action results as bounded plain text/JSON; map stable plugin error codes to user-oriented messages and recovery actions.

**Verification:** Test allowed block/action/status model and SFC has no `v-html`/dynamic import; focused tests and `pnpm run typecheck`; explicitly test AI confirm/cancel and stale-state behavior through manager tests from Task 1 plus UI state model.

### Task 4 — Manager navigation and lifecycle integration

**Depends on:** Tasks 2 and 3.

**Files:** `src/App.vue`, new `src/features/plugins/*` as needed, `src/styles/tokens.css`, tests under `src/features/plugins/`.

**Contracts:** Extend closed section model with `plugins` and one selected declarative plugin page. Favorites remains initial section; plugin center always available under Apps; plugin page nav derives only enabled/active summaries. Manager/native intents remain unchanged.

**Steps:** Add Plugins center to Apps and dynamic active plugin entries. Load safe summary snapshot from Main at Manager mount and after plugin mutations. Open active plugin page via `getPages`; on disabled/uninstalled/invalidated current plugin, return to center. Ensure loading failures stay recoverable and stale page loads cannot replace current navigation. Keep Translation submenu behavior and all Native intent routing intact.

**Verification:** Test nav/view-model routes, default Favorites, enabled plugin visibility, disabled/uninstalled fallback, and Native translation intents remain supported; typecheck and relevant existing navigation tests.

### Task 5 — MyMemory consent copy

**Depends on:** Task 4.

**Files:** `src/features/settings/SettingsView.vue`, focused existing/new copy assertion under `src/features/settings/`.

**Steps:** Correct only the stale MyMemory trigger text to match the configured auto-translate-after-pause behavior and explain that changing selection alone sends no text. Do not touch timers or Translation behavior.

**Verification:** Focused wording test and `pnpm run typecheck`.

### Task 6 — 5D integrated regression and code review

**Depends on:** Tasks 1–5.

**Files:** New or updated plugin UI/manager/API tests; `docs/webtools-phase5d-plugin-manager-ui.md`.

**Steps:** Cover list/detail/empty/error/permissions/config/block/action/AI/cancel/state changes/navigation fallback and accessibility contract. Verify existing Favorites, Settings, Translation/shared AI, Native intent and 5C security boundaries. Use fresh-context whole-change read-only review per executing-plan workflow. Fix Critical/Important findings in one RED→GREEN pass, then run full verification. Generate final report with evidence labels and known limits.

**Verification:** `pnpm install --frozen-lockfile` only if lock changed; `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `git diff --check`; no native stress rerun.

### Task 7 — Isolated packaged Manager smoke and closeout

**Depends on:** Task 6.

**Files:** Extend `scripts/verify-phase5c-plugin-smoke.mjs` into or add a 5D test-only packaged smoke script; update `docs/webtools-phase5d-plugin-manager-ui.md`.

**Steps:** Build win-unpacked to an external temporary evidence directory. Use a fresh temporary userData and test package, test-only host consent and mock AI (never a real credential/provider); exercise UI navigation/list/install/enable/page/basic action/disable/remove where safely automatable. Verify normal Manager close returns target Electron group to zero while isolated NativeHost remains, then cleanly exits test NativeHost. Do not write to `D:\webtools`, `%APPDATA%\Nook`, registry/startup or real secrets. Any visual/native-dialog step not actually automated is `USER MANUAL VERIFICATION REQUIRED`.

**Verification:** `pnpm exec electron-builder --win --x64 --dir` with external output; actual packaged smoke; final branch/status/commit/push checks. No installer, PR, merge, tag, release, 5E, or 5F.

## Risks and Rollback

- AI preview trust is the highest risk. Any request/provider mismatch, stale plugin/session or absent token must fail closed and consume the token; tests must prove no mock provider dispatch. If the Main-owned transaction cannot satisfy the exact-contents boundary, retain 24,000-character 5C native dialog cap for that path and report UI incomplete rather than weakening confirmation.
- Main and renderer metadata additions stay DTO-only; never pass package paths or secret/provider fingerprints.
- Optional registry fields preserve existing 5C profile compatibility. If validation/recovery becomes ambiguous, keep plugins disabled; do not clear user data.
- Rollback is per-task/source revert only before commit; test evidence stays outside the repo. Do not change production profile or installation.

## Acceptance Gate

Phase 5D is complete only when Manager UI covers install/list/detail/enable-disable/grants/config/declared actions/AI review/replace-downgrade/uninstall and status recovery; Main remains authoritative; declarative UI is exhaustive and non-executable; MyMemory copy is accurate; automated tests/build pass; packaged isolated smoke passes; and any actual native-dialog/manual visual gaps are clearly labeled. If the full review UI cannot be made secure, report `PHASE 5D INCOMPLETE — BLOCKING ISSUE` instead of bypassing 5C.

Expected closeout: `PHASE 5D COMPLETE — PENDING PHASE 5E SDK AND SAMPLE PLUGIN`. Do not start 5E or 5F.

## Execution Record — 2026-10-04

Tasks 1–7 were implemented in dependency order. Task 4 followed completion of the plugin center and declarative page/review UI; Task 5 followed navigation integration. No NativeHost C# or Named Pipe code, dependency/lockfile, installer, or user-data schema was changed.

### Review findings and fixes

The integrated read-only review initially identified five P2 issues. They were corrected before closeout:

1. Install/replace/downgrade consent lacked a clear version and requested-capability delta. Added a typed change summary and user-facing formatter, and corrected install/update feedback.
2. Expired Main-owned AI review requests could remain in memory until another confirmation. Added a bounded expiry timer and lifecycle cleanup, with expiry coverage.
3. Clipboard text controls accepted 50,000 characters although the native confirmation path caps previews at 24,000. The UI now applies the matching 24,000 limit and explains the bound.
4. A plugin page disappeared from navigation while its action was invoking. Active invoking pages remain reachable.
5. Packaged-smoke cleanup depended on its first PowerShell identity probe remaining available. Cleanup now closes that directly spawned helper, starts a fresh isolated identity probe regardless of the first probe's state, and performs exact path/PID/creation-time-checked graceful cleanup. It also fails the smoke if any isolated Manager process remains.

The final read-only review also found a P3 lifetime issue: AI review generation entries accumulated for unique plugin IDs. Generation state is now retained only while a review is pending or its preparation is in flight; targeted tests cover cancellation, cancelled imports, and invalidation during preparation. An additional regression found during integrated testing showed that Vue's reactive grants proxy could not be structured-cloned over IPC. The renderer now sends a plain grant array, with a regression test.

### Verification and evidence

- `pnpm run typecheck` — PASS.
- `pnpm test` — PASS, 193/193.
- `node --check scripts/verify-phase5d-plugin-ui-smoke.mjs` — PASS.
- `pnpm run build` — PASS (Electron Main, preload, and Vue Renderer).
- `git diff --check` — PASS; Git reports only the repository's existing LF-to-CRLF working-copy warnings.
- Windows `pnpm exec electron-builder --win --x64 --dir` — PASS, output outside the repository.
- Packaged isolated smoke — PASS, freshly rebuilt and rerun against the final reviewed code. It exercised the built Manager UI through an isolated test NativeHost and profile; Manager close returned the target Electron process group to zero while the isolated NativeHost remained, then the test NativeHost exited cleanly. A follow-up process scan found no process under the isolated evidence root. Evidence is stored outside the repository.

The smoke used test-only consent to seed its fixture and did not call a real provider or use a credential. Production native dialogs were not tested. Actual native picker/consent presentation, real install/replace/downgrade confirmation, uninstall keep/delete dialog flow, and visual/keyboard/focus/accessibility acceptance remain `USER MANUAL VERIFICATION REQUIRED`. The packaged smoke used `win-unpacked`; it was not an installer acceptance test.

The detailed closeout is in `docs/webtools-phase5d-plugin-manager-ui.md`. Phase 5E SDK/sample-plugin work and Phase 5F final security/Windows acceptance have not started.

The final smoke source/build identity is baseline `e1147f0b2ec7fca7fb3fc14ee864384e6cfee330` plus the dirty Phase 5D source under review. The Windows Manager package was rebuilt with `pnpm exec electron-builder --win --x64 --dir --config.directories.output="D:\系统缓存\WebTools Phase5D Final Review 20261004-193722\manager-build"`. Evidence directory: `D:\系统缓存\WebTools Phase5D Final Review 20261004-193722`; report: `D:\系统缓存\WebTools Phase5D Final Review 20261004-193722\phase5d-plugin-ui-smoke-report.json`. Final artifact hashes were recomputed and match the smoke report:

| Artifact | SHA-256 |
|---|---|
| `WebTools.NativeHost.exe` | `1d9c148ba6d8d20085e36625b2ed49c5e129f587008d00602a9c836f99d1a044` |
| NativeHost assembly | `ec880fb0bea214617c9ff144037a0d536dd56e3436527b1501b314314e76ca2a` |
| Manager executable | `1fb51dea54126b26956a543d5cc1067f2675125d4d83b0c212bfc2adae1c25e2` |
| Manager `app.asar` | `03df29d015e23e4616690cf2a28785dfaee841793e69b7df0d13c4568bd23ee6` |
