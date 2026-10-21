# Translation 2.0 Provider Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary Manager translation page with a first-party Translation 2.0 plugin window that hosts the WebTools native translator, user-selectable website-provider tabs, and bounded user-configured translation services. Live website behavior has a separate verification status; that status does not disable the user's show/hide controls.

**Architecture:** Keep Translation as a compile-time built-in plugin in the existing catalog and lifecycle, but give it a dedicated BrowserWindow and narrow preload instead of mounting it inside Manager. Electron Main owns provider configuration, credentials, API calls, remote website views, cancellation, and stale-result authority; the Translation renderer owns only presentation and user intent. The 2026-10-18 packaged-review correction directly cuts all full-translation entry points over to this window and removes the Legacy Manager UI/handoff, as explicitly directed by the user.

**Tech Stack:** Electron 44, TypeScript 5.9, Vue 3, Electron WebContentsView, Node test runner, existing DataStore/SecretStore/SharedAI/TranslationService.

**Spec:** `docs/superpowers/specs/2026-10-18-translation-provider-tabs-design.md`

## Implementation Status — 2026-10-18

- Tasks 1–5 and 7 are implemented and covered by focused plus full Node regression tests.
- Task 6 has one current verified provider slice: Google. Its current HTTPS query handoff produced a visible result in a live Chromium page, while the WebTools `WebContentsView` policy/lifecycle is covered by automated tests. Packaged WebTools visual and interaction acceptance remains pending.
- The implementation uses `electron/plugins/translation2-website-host.ts` and `electron/services/translation2-imported-api.ts`; these names replace the provisional filenames listed below without changing the planned ownership boundaries.
- Task 8 source cutover and Legacy UI/handoff removal are implemented under the user’s explicit packaged-review instruction. The corrected installer and isolated install/uninstall checks are complete; installed Native-entry human verification remains pending. Shared services and existing user data are preserved.
- Sanitized evidence is stored outside the repository under `D:\SystemDefault\Desktop\webtoolstest\translation2`.
- Historical pre-review development verification: `pnpm typecheck` PASS, `pnpm build` PASS, and `pnpm test` 689/689 PASS. No package or installer was produced in this development round.

## Packaged-review correction — 2026-10-18

The first installed review exposed real defects and omitted service-configuration UI; earlier automated results did not certify those controls. See `docs/translation2-settings-correction.md` for causes, scope, evidence and remaining limits.

- Provider controls work with reactive Vue state and serialized updates; settings rows and tabs follow saved order. All declared website tabs are user-selectable; the historical release-status metadata is not an enable/disable gate or a certification of live translation.
- Add the previously approved provider/key form: existing-registry AI configuration/test and named DeepL API Free/Pro instances. Keep JSON import under advanced settings.
- Reject credential-like model values and credentials embedded in imported metadata. Never project stored API keys into the form or provider labels.
- Select website tabs without awaiting network navigation and reuse unchanged website views. Keep load errors visible.
- Native search, Super Panel full Translation and Plugin Center open the independent Translation window. Remove Legacy Manager translation presentation/handoff; keep shared and preview-used services/settings.
- Correction verification: typecheck PASS, build PASS, Node **682/682 PASS**, isolated real Electron **9 scenarios PASS**, controlled API **3 requests**, NativeHost **72/72 PASS**, UpdateHelper **10/10 PASS**, corrected EXE/cover-install/install/self-uninstall PASS. Also fix restore-defaults website deactivation and stale service-test settings writes. Artifact paths and remaining human/live-service limits are recorded in the correction report; this does not mark user acceptance complete.

## 2026-10-19 首次入口修正与性能后续

用户实际首次点击等待 10 秒仍无窗口，推翻了此前“仅路由正确即可交付”的验证假设。已定位为 Native 启动打包 GUI Electron 的 `WindowStyle.Hidden` 抑制首次显示；本次改为 Normal，并释放直接 Translation 入口成功交付窗口后的初始 Host 租约。服务选择恢复分类纵向排列、分类内多列网格。

真实窗口可见性和关闭重启使用 Native → 打包 Electron 的隔离回归，不能仅由 DOM 就绪推定。证据、构建身份和后续分段计时/关键路径优化任务统一记录在 [首次激活调查](../../electron-cold-start-lifecycle-investigation.md)。这项正确性修复当期交付；广义启动性能优化、真实网站/账户与新包人工体验分别记录，不改写历史测试结果。

## Global Constraints

- Translation 2.0 is a first-party built-in plugin in its own window/surface; it is not a Manager page.
- Reuse the existing plugin catalog, built-in lifecycle, Shared AI registry, DataStore, and SecretStore.
- Website pages, dedicated machine-translation APIs, and AI providers remain separate identities and execution routes.
- Remote provider pages receive no WebTools preload, credentials, or shared session; navigation, popup, download, and permissions default to deny.
- User-imported definitions are bounded data only and never execute code or install a plugin package.
- Qwen-MT is an inventory decision only; this plan does not add a new Qwen-MT adapter.
- Follow the user’s 2026-10-18 explicit cutover instruction: remove Legacy Manager UI, gate/handoff and its translation IPC. Preserve services still used by the separate Super Panel preview and shared AI; do not erase user data.
- Preserve all pre-existing working-tree changes. Do not reset, clean, checkout, stash, commit, push, or create a PR during implementation.
- Put generated acceptance fixtures and evidence under `D:\SystemDefault\Desktop\webtoolstest`, never the C-drive user cache.

## Review Focus

- Opening Translation repeatedly with newer selected text must focus one window and prevent an older handoff or provider response from replacing the newest source.
- Closing, disabling, or switching away from native translation must abort active requests and suppress late results.
- Missing credentials, invalid imported definitions, and provider errors must remain visible and must never fall back across service categories.
- A remote website view must not gain Manager/Translation preload APIs, shared cookies, popup/download/permission access, or navigation outside its reviewed origin set.
- Existing users with only Legacy settings must get deterministic defaults without losing or silently reinterpreting credentials.

---

### Task 1: Freeze the Legacy capability inventory and Translation 2.0 contracts

**Files:**
- Create: `docs/translation2-legacy-capability-inventory.md`
- Create: `src/shared/translation2-contracts.ts`
- Create: `src/shared/translation2-contracts.test.mjs`

**Interfaces:**
- Produces: `Translation2WorkspaceSettings`, website/provider descriptors, service references, validation and normalization functions used by every later task.

- [x] Write failing contract tests for defaults, normalization, category separation, bounded names/order, unsupported definition rejection, and retained Legacy mappings.
- [x] Run the focused test and confirm it fails because the new contract module is absent.
- [x] Implement the minimal pure contract module and capability inventory.
- [x] Run the focused test and confirm it passes.

### Task 2: Persist provider tabs and native service selection

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `electron/services/data-store.ts`
- Create: `electron/services/translation2-settings.ts`
- Create: `electron/services/translation2-settings.test.mjs`

**Interfaces:**
- Consumes: `normalizeTranslation2WorkspaceSettings` from Task 1.
- Produces: Main-owned read/update operations for website order/visibility, active tab, dedicated service selection, and AI provider selection.

- [x] Write failing migration and update tests proving old v2 data gains safe defaults and restore-defaults preserves user-created service records.
- [x] Run focused tests and verify the expected failures.
- [x] Add the settings field and serialized update service with strict validation.
- [x] Run focused tests and the existing DataStore tests.

### Task 3: Create the built-in Translation plugin window and narrow IPC boundary

**Files:**
- Create: `electron/plugins/builtin-translation-window.ts`
- Create: `electron/plugins/builtin-translation-window.test.mjs`
- Create: `electron/translation-preload.ts`
- Create: `src/shared/translation2-ipc.ts`
- Modify: `electron.vite.config.ts`
- Modify: `src/shared/plugin-catalog-contracts.ts`
- Modify: `electron/plugins/plugin-catalog.ts`
- Modify: `electron/plugins/plugin-catalog.test.mjs`
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: built-in lifecycle admission and Task 1/2 settings.
- Produces: `BuiltinTranslationWindow.open(source?)`, `close()`, `isMainFrame()`, and a catalog open result that explicitly identifies a separate built-in window.

- [x] Write failing tests for single-window reuse, newest-source wins, close cleanup, disabled admission, and catalog dispatch.
- [x] Run focused tests and verify the failures.
- [x] Implement the window owner, narrow preload registration, and catalog callback.
- [x] Integrate with Host idle ownership and lifecycle cancellation. The packaged-review instruction supersedes the original Legacy rollback requirement.
- [x] Run focused tests and typecheck.

### Task 4: Build the Translation 2.0 native tab and service-management shell

**Files:**
- Create: `translation.html`
- Create: `src/translation-main.ts`
- Create: `src/features/translation2/TranslationApp.vue`
- Create: `src/features/translation2/translation2-view-model.ts`
- Create: `src/features/translation2/translation2-view-model.test.mjs`
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Consumes: Translation window preload and Task 1/2 projections.
- Produces: peer provider tabs, native source/result UI, grouped `机器翻译 API` / `AI 翻译` selector, service list/catalog shell, and visible loading/error/cancel states.

- [x] Write failing view-model tests for tab order, category grouping, default labels, source replacement, request generations, and action availability.
- [x] Run focused tests and verify failures.
- [x] Implement the renderer entry and accessible responsive UI using shared theme tokens.
- [x] Add component lifecycle tests for stale-result suppression and close/unmount cancellation.
- [x] Run focused tests and typecheck.

### Task 5: Route the retained native services through Translation 2.0

**Files:**
- Modify: `electron/services/translation-service.ts`
- Modify: `electron/services/shared-ai-service.ts`
- Create: `electron/ipc/translation2-handlers.ts`
- Create: `electron/ipc/translation2-handlers.test.mjs`
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: selected direct service or AI provider identity from Task 2.
- Produces: explicit provider invocation, request cancellation, provider metadata, and visible errors for the new window.

- [x] Write failing tests proving MyMemory and Shared AI are explicit routes, the selected AI provider is honored, and failures never cross-fallback.
- [x] Run focused tests and verify failures.
- [x] Add the new-window authorization and request route. Legacy Manager translation IPC was subsequently removed under the packaged-review instruction.
- [x] Run focused tests and the full translation service suite.

### Task 6: Add one verified website-provider vertical slice

**Files:**
- Create: `electron/plugins/translation-website-runtime.ts`
- Create: `electron/plugins/translation-website-runtime.test.mjs`
- Create: `electron/plugins/translation-website-providers.ts`
- Modify: `electron/plugins/builtin-translation-window.ts`
- Modify: `src/features/translation2/TranslationApp.vue`

**Interfaces:**
- Produces: lazy provider view creation, isolated ephemeral sessions, bounded navigation, default-deny popup/download/permission policy, source handoff, and explicit destruction.

- [x] Write failing policy/lifecycle tests before runtime code.
- [x] Implement one provider only after its current source-fill and visible-result strategy is verified; otherwise keep every website disabled with an explicit unsupported state.
- [x] Store sanitized runtime evidence under `D:\SystemDefault\Desktop\webtoolstest`.
- [ ] Run focused tests and packaged/manual acceptance for that provider.

### Task 7: Add bounded imported dedicated-API definitions

**Files:**
- Create: `src/shared/translation-api-definition.ts`
- Create: `src/shared/translation-api-definition.test.mjs`
- Create: `electron/services/custom-translation-api.ts`
- Create: `electron/services/custom-translation-api.test.mjs`
- Modify: `src/features/translation2/TranslationApp.vue`
- Modify: `electron/ipc/translation2-handlers.ts`

**Interfaces:**
- Produces: data-only definition validation, endpoint review, named instance configuration, secret references, test/save/select/delete, cancellation, and bounded response extraction.

- [x] Write failing schema/security tests for supported JSON/form request mappings, response paths, auth placement, redirects, timeouts, response limits, and rejection of scripts/arbitrary transforms.
- [x] Implement the data-only parser and Main-owned executor.
- [x] Add the import/configure/test/select UI without returning stored secrets to Renderer.
- [x] Run focused tests, typecheck, and a local controlled-endpoint acceptance.

### Task 8: Direct entry-point cutover and Legacy removal (packaged-review instruction)

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/services/feature-invocation-service.ts`
- Modify: `src/App.vue`
- Remove under the immediate-cutover instruction: `src/features/translate/TranslateView.vue`, Legacy-only handoff/IPC/service code proven unreferenced. Keep shared and preview-used configuration/services.
- Update: Translation 2.0 implementation and acceptance docs.

**Interfaces:**
- Consumes: accepted Translation 2.0 window from Tasks 3-7.
- Produces: Launcher, Plugin Center, and Super Panel full-translation entry points that focus Translation 2.0 with exact source text.

- [x] Add source wiring regression for Native open-page/selection/Feature routes and isolated Plugin Center → dedicated-window runtime acceptance; remove the obsolete Manager gate contract.
- [ ] Confirm installed Native search and Super Panel entry points during preview loading/success/error, plus newest-source handoff, in the corrected package's human matrix.
- [x] Switch entry points under the user’s explicit immediate-cutover instruction in the packaged review; no Legacy Manager route remains.
- [x] Run the full Node suite, typecheck, build, NativeHost/UpdateHelper checks, and isolated package cover-install/install/self-uninstall checks. Confirm packaged compiled output matches the current build.
- [ ] Complete the corrected installer's human UX matrix and real-account/live-website checks.
- [x] Remove Legacy UI, gate/handoff and Manager translation IPC; retain deliberately adopted shared/preview functionality and existing user data.
