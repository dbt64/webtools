# WebTools — Phase 5A Feature & Plugin Audit Report

Date: 2026-10-04

Phase: 5A — current feature, module and Provider audit

Source branch: `codex/shared-ai-translation-2.0`

Source HEAD at audit start: `d17b778c06d125f1f4fb083d1209fbaef5c42791` (`docs: close out phase 4g6 native launcher migration`)

## Executive Summary

The current product is NativeHost-first. A single WPF NativeHost owns the resident Launcher, Windows search, hotkey, tray and startup integration. It starts the Electron Manager only when a Manager page is requested. The Manager is one Electron process group/window with explicit Vue sections for Websites/Favorites, Translation and Settings.

The Phase 5 roadmap must not repeat work already present in the source:

- Shared AI configuration, provider selection, per-provider credential storage, a reusable Main-process completion service and Translation consumers are implemented and covered by isolated tests. **Phase 5B is already implemented; no duplicate development is recommended.**
- Translation 2.0 is implemented with the shared AI provider, MyMemory and Qwen-MT paths, a separate manual Google Translate browser action, request cancellation, stale-result protection and native-to-manager prefill. **Phase 5C is already implemented; no duplicate development is recommended.**
- There is no dynamic plugin loader, plugin marketplace or general feature registry. Existing product modules and AI/translation adapters use explicit, statically registered contracts. This is adequate for the current small set of first-party modules; the audit found no approved requirement that needs a runtime plugin framework.

No P0, P1 or newly discovered P2 product defect was found. One P3 Settings copy mismatch is recorded: Settings describes MyMemory translation as happening after clicking Translate, while the current Translation page automatically sends text after a 450 ms pause when the selected provider is configured. This is a small but concrete 5D usability/copy task. Live third-party Provider compatibility was not tested because that would require sending text and using credentials.

**PHASE 5A AUDIT COMPLETE**

## 1. Git and Source Baseline

- Branch: `codex/shared-ai-translation-2.0`.
- HEAD: `d17b778c06d125f1f4fb083d1209fbaef5c42791`.
- Upstream: `origin/codex/shared-ai-translation-2.0`; ahead/behind: `0 / 0` after fetch.
- Working tree was clean before creating the Phase 5A plan. During the audit, the only changes were the plan and this report.
- The HEAD commit closes Phase 4G-6. The G6 report says the pnpm, G5 and G4 checkpoints are in the branch and upstream. No product source change was made for this audit.

### Evidence classes used

| Class | Evidence used | What it supports |
|---|---|---|
| Current source | NativeHost, Electron, Vue, shared contracts and settings/data code at this checkout | Current wiring, behavior and persistence boundaries |
| Current automated | `pnpm run typecheck`, `pnpm test` run for this audit; existing focused tests | Type correctness and deterministic service/contract behavior |
| Historical automated/runtime | Phase 4F–4G6 reports and exact-source identity described by G6 | Previously accepted Windows, process lifecycle, installation and regression behavior where code is unchanged |
| Real Manager UI | Phase 4G-5/4G-6 documented packaged Manager acceptance | Website/Settings/Translation page interaction and Manager lifecycle as labeled in those reports |
| User confirmed | Phase 4G-5 M-A/M-B/M-C/M-D/M-G | The explicitly user-confirmed manual items; not recast as independent automated observation |

The initial Phase 4G-5 `environment-before.json` collector failure remains an evidence limitation in its original report. This audit does not claim that the missing snapshot was recreated. Historical Windows acceptance is reused only for the features and source paths those reports identify; no long stress, soak, installer, registry or production-profile test was repeated.

## 2. Current Architecture and Feature Inventory

```text
Windows login / user launch
          │
          ▼
WebTools.NativeHost.exe (WPF, resident, single-instance mutex)
├── Native Launcher and local search
├── app catalog, icons, saved-website projection and Everything client
├── hotkey, tray and login-startup integration
└── current-user Named Pipe ── starts on demand ──► Electron Manager
                                                     ├── one BrowserWindow / Vue renderer
                                                     ├── Websites (Favorites workspace)
                                                     ├── Translation
                                                     └── Settings
```

### NativeHost and Launcher

| Capability | Status | Source/evidence |
|---|---|---|
| Single-instance resident NativeHost, Launcher window, tray, hotkey and startup setting | COMPLETE | `native/WebTools.NativeHost/App.xaml.cs`; `MainWindow.xaml.cs`; G5 M-A/M-D and G6 architecture review |
| Native search modes | COMPLETE | `SearchModels.cs` parses normal local, `?` web, `file:` Everything and `/` saved-websites commands; `SearchCore.cs` routes indexed app/website results and appends Translation action in normal local mode |
| App search | COMPLETE | `Catalog/WindowsAppSource.cs`, `Catalog/AppCatalogService.cs`, `Services/ResultActionExecutor.cs`; typed executable, shortcut, packaged and system launch targets; aliases and deduplication |
| Chinese, pinyin, initials, fuzzy/case-insensitive matching and remembered app promotion | COMPLETE | `Search/SearchCore.cs`, `Search/PinyinConverter.cs`, Launcher checks in `native/WebTools.NativeHost.Checks/Program.cs` |
| Saved websites in Launcher and live projection from Manager | COMPLETE | `Data/WebsiteDataLoader.cs`, `NativeManagerPipeServer.cs`, `electron/main.ts` website projection update; G5 real UI/runtime acceptance |
| `file:` Everything integration | COMPLETE, optional external integration | Native `Files/EverythingClient.cs`, Settings controls, literal argument tests; requires the user’s Everything/ES installation and configuration |
| Search result icons and per-result dispatch | COMPLETE | `MainWindow.xaml.cs`, `Services/NativeIconCache.cs`, `Services/ResultActionExecutor.cs` |
| Launcher hide/show, drag, compact/expanded, theme and transient reset | COMPLETE | `MainWindow.xaml.cs`, palette/selection/gesture services and NativeHost checks; relevant G4 evidence is historical and was not rerun |

### Manager and first-party modules

| Capability | Status | Source/evidence |
|---|---|---|
| Default Websites/Favorites workspace and website/folder management | COMPLETE | `src/App.vue`, `src/features/favorites/FavoritesView.vue`, `features/entries/EntryEditor.vue`, `features/bookmarks/*`, `electron/services/website-service.ts`, `website-order.ts`; CRUD, folders, reorder and persistence tests |
| Settings | COMPLETE | `src/features/settings/SettingsView.vue`, `SearchEngineEditor.vue`, `electron/ipc/settings-handlers.ts`; search engines, themes, launcher display mode, hotkey, startup, Everything, shared AI and translation engine |
| Translation | COMPLETE | `src/features/translate/TranslateView.vue`, `electron/services/translation-service.ts`, translation IPC and adapters; details in section 4 |
| Explicit Manager page registration | COMPLETE | `src/App.vue`: `favorites`, `translate`, `settings`; Settings is async-loaded; no Vue Router or hidden Search page |
| Legacy Manager Quick Search | REMOVED as specified in Phase 4F | G6 regression checks assert there is no Search page or Search-only app API |
| Other implemented but unregistered UI components | NONE FOUND | Usage search found `EntryEditor`, `Favicon`, folder/delete dialogs and `SearchEngineEditor` imported by their active parent views |

### Persistence and cross-process state

- Electron `DataStore` owns the Manager’s `nook-data.json` and `AppData.version = 2`, including Websites, folders, order and Settings. It normalizes older v2 settings and has a v1-to-v2 migration path (`electron/services/data-store.ts`, `src/shared/domain.ts`).
- NativeHost owns the Launcher projection/state in its own Launcher state file. Manager settings and website mutations are projected over the existing Native Manager pipe. This is a deliberate reduced projection used for the native Launcher; `WebsiteEntry` persistence schema was not changed in Phase 5A.
- Secret values are stored separately in `secrets.json` through Electron `safeStorage` encryption; normal renderer settings contain only provider configuration/status, not the saved key. `secret-store-core.ts` serializes writes and `ai-credentials.ts` provides per-provider key mapping.

## 3. Modules, Providers and Plugin-System Audit

“Module”, “Provider” and “plugin” refer to different things in this repository:

| Term | Current meaning | Current registration model |
|---|---|---|
| Product module | A first-party Manager page/service such as Websites, Settings or Translation | Explicit `Section` union, navigation and conditional component in `src/App.vue`; explicit service and IPC registration in `electron/main.ts` |
| AI Provider | A supported remote AI endpoint/protocol | Static descriptors and exhaustive endpoint resolver in `electron/services/ai-provider-registry.ts`; provider IDs are a shared closed union |
| Translation engine/adapter | A translation route such as Shared AI, MyMemory or Qwen-MT | Closed `TranslationEngineId` union and exhaustive switch in `TranslationService`; adapters are injected from Main |
| Plugin | Independently installable/discoverable third-party module | No loader, manifest contract, marketplace, package discovery or dynamic runtime registration exists |

Current explicit module wiring spans the App section/navigation, Main service construction and IPC/preload contract. A new first-party UI module would need those purposeful registrations. The code does not provide a generic module manifest or permission model. No dangling registered-but-unrendered feature or unregistered UI component was found.

`SharedAIService.complete()` is reusable by other Main-process domain services. Renderer features do not receive a generic “send arbitrary prompt” API; instead, each feature has typed/domain-specific IPC. That is a useful security boundary for future AI consumers. The current source has one product consumer, Translation. This is enough for a small first-party extension, but it is not an independently loadable plugin API.

**Conclusion:** no dynamic plugin framework is justified by present usage. Keep 5E reduced to documenting the service/consumer contract and adding a narrowly scoped test when a second approved AI feature actually appears. Do not add a plugin marketplace, manifests or generic renderer AI endpoint as speculative infrastructure.

## 4. Shared AI and Translation 2.0

### Shared AI call chain

```text
SettingsView
  ├─ sharedAI config (default provider + per-provider model/config) ─► settings IPC ─► DataStore
  └─ API key input ─► provider-key IPC ─► AIProviderCredentialStore ─► SecretStore/safeStorage

TranslationView ─► typed translate IPC ─► TranslationService
                                      ├─ ai ─► SharedAIService ─► selected adapter ─► provider endpoint
                                      ├─ mymemory ─► MyMemoryAdapter (no local key)
                                      └─ qwen-mt ─► QwenMtAdapter + saved Qwen credential
```

| Requirement | Status | Evidence |
|---|---|---|
| Default AI provider can be selected and persisted | COMPLETE | `src/shared/ai-config.ts`, `SettingsView.vue`, `settings-handlers.ts`, `SharedAIService`; `ai-config.test.mjs` and `shared-ai-service.test.mjs` |
| Provider-specific model/config retained when switching | COMPLETE | Shared settings keyed by closed `AIProviderId`; settings draft keyed per provider; config tests cover switching and retention |
| Provider descriptors/endpoints/adapters | COMPLETE for currently registered providers | OpenAI-compatible adapter and Anthropic Messages adapter; fixed provider registry, HTTPS/custom loopback validation, Qwen region/workspace validation; isolated tests |
| API keys stored separately and not read into renderer | COMPLETE in the exposed API contract | `AIProviderCredentialStore`, `SecretStore`, `SecretStoreCore`, translation IPC; tests cover encryption abstraction, serialized writes and credential separation |
| Generic reusable Main-process AI completion service | COMPLETE for in-app consumers | `SharedAIService.complete()` reads current default provider/config and returns provider/model metadata; deterministic mock tests |
| Translation consumes shared default AI | COMPLETE | `TranslationService` `ai` branch calls `SharedAIService.complete()`; test verifies route and source/system separation |
| No-key free translation and dedicated machine-translation path | COMPLETE | MyMemory no-key path and Qwen-MT adapter; no silent fallback is tested |
| Real provider reachability/model entitlement | UNVERIFIED in this audit | Connection test is user initiated and may send text/use quota. No live key, user text or paid request was used. Model/endpoint availability can vary by account and change over time. |

### Translation behavior and lifecycle

- Launcher normal local search can produce a typed Translation action. NativeHost sends an exact text prefill through the existing manager pipe; App routes the request to Translation and acknowledges the matching request. The handoff request is bounded and correlated by request ID (`ManagerController`, `NativeManagerPipeServer`, `src/App.vue`, `translation-prefill.ts`).
- Translation page supports source/target language settings, configured engine/provider status, translation output, copy, a user-visible cancel action, manual Google Translate browser opening and navigation to Settings.
- Current approved UX automatically schedules a translation 450 ms after text/language changes when the selected provider reports configured. This includes an incoming prefill. It clears prior output/error/copied state, cancels prior work and uses a generation gate to reject stale responses. Unmount clears timers and cancels in-flight work. Tests cover pending initialization/unmount, auto-translation scheduling, cancellation and stale response invalidation.
- If no provider is configured, the view can retain the entered text and displays setup guidance; it does not silently switch to another engine. A configured provider receives text when the auto-translate timer fires. The UI’s page description states that text is sent after a short pause.
- MyMemory is a public no-key option; the Settings copy contains the only wording mismatch identified below. Qwen-MT uses the Qwen credential/config but is selected as a separate translation engine. Google Translate is a manual external-browser action and is not an automatic fallback.
- Engine/provider connection and output quality were not tested against real third-party accounts. Mocked adapter/service behavior is tested; live account behavior remains unverified.

### Translation requirement classification

| Capability | Status | Classification |
|---|---|---|
| Shared AI provider selection, key/config storage and reuse | COMPLETE | Previously requested and implemented; do not repeat as 5B |
| Translation prefill, result handling, clear/cancel and stale response guard | COMPLETE | Implemented and covered by isolated tests plus historical installed Manager evidence |
| Shared AI, MyMemory and Qwen-MT choices | COMPLETE | Current source supports the three engines; no real Provider request made in this audit |
| Automatic translation after typing pauses | COMPLETE | Later approved UX and current lifecycle test; supersedes the earlier manual-click-only behavior |
| Provider list/model lifecycle against live accounts | UNVERIFIED | No live credentials or network request used; not treated as a product defect |
| More engines, provider OAuth, translation history, streaming, or additional language UX | OPTIONAL | Not established as accepted requirements in the current source/plan set |

The original Translation 2.0 plan and an older G6 architecture sentence describe handoff as prefill-only/no automatic provider request. Current `TranslateView.vue` and the later Phase 3B record establish the approved automatic behavior. The Phase 4G-5 test used an unconfigured isolated provider, so its no-network observation is compatible with that scenario; the blanket G6 sentence should not be used to claim that configured handoff never sends a request. This audit does not rewrite historical acceptance records.

## 5. Settings and User Experience Findings

The current section/navigation arrangement is explicit: Websites is the primary workspace; Translation lives under the Apps expander; Settings remains in the fixed sidebar bottom group. This matches the prior user-requested organization. Settings includes the default AI Provider/model/credential workflow, and a separate Translation engine choice that explains when it uses Shared AI or Qwen credentials. Provider changes preserve per-provider draft settings and immediately persist the default selection. Saving shared settings and a newly entered key can result in a reported partial state if the key write fails; the UI explicitly says the settings saved but the key did not, so failure is visible rather than silent.

### P3 — MyMemory trigger wording in Settings is stale

- **Evidence:** `src/features/settings/SettingsView.vue` says “点击翻译后，原文会发送给 MyMemory”; `src/features/translate/TranslateView.vue` states that input is sent after a short pause and `scheduleAutoTranslate()` schedules the request after 450 ms when configured.
- **Current behavior:** automatic translation can occur without clicking the Translate button.
- **Impact:** the two screens describe the same text-transfer trigger differently. This may confuse a user reviewing MyMemory’s data flow, although the Translation page itself explicitly describes auto-send and Settings correctly says switching engines alone does not send text.
- **Reproduction:** configure/select MyMemory, enter text in Translation, pause; compare with the Settings MyMemory note.
- **Recommendation:** a narrow Phase 5D copy change should say that entering/pasting text and pausing sends it automatically; retain that merely switching engines does not send text. No code/copy was changed during Phase 5A.
- **Priority:** P3; non-blocking usability/documentation consistency issue.

No other reproducible Settings save/switch, module entry, page lifecycle or unregistered-component issue was found in the current source and available evidence. A full subjective visual redesign is not supported by audit evidence.

## 6. Findings and Risk Register

| ID | Priority/status | Finding | Evidence and impact | Recommendation |
|---|---|---|---|---|
| F-1 | P3, new | Settings MyMemory note says click-to-send while current configured Translation auto-sends after 450 ms | `SettingsView.vue`; `TranslateView.vue`; concrete user-flow wording mismatch | Narrow 5D copy correction and a focused UI assertion/manual check |
| F-2 | P2, inherited/non-blocking | Electron main-frame `file:` navigation is broader than the packaged renderer URL | Explicitly retained as deferred hardening in `docs/native-launcher-phase4g6-final-closeout.md`; this audit found no new exploitable path | Keep as a separate security-hardening review; not part of Phase 5A or plugin work |
| F-3 | P2, inherited/non-blocking | Same-user Native Manager pipe hello PID is not bound to the process launched by NativeHost | G6 architecture note; current pipe remains current-user ACL scoped; no cross-user or privilege escalation evidence | Consider exact peer binding only in a separately scoped IPC hardening task |
| F-4 | UNVERIFIED, not a defect | Live Provider endpoint/model acceptance has not been run in this audit | Would send user text and require credentials/quota; deterministic mocks and connection flow exist | If desired, use a disposable test key/account and non-sensitive text in a separately authorized test |
| F-5 | P3, inherited evidence limitation | Phase 4G-5 initial environment snapshot was not collected | Original report records the collector failure; this audit did not create or infer a full snapshot | Preserve its stated limitation; do not claim a complete registry/filesystem audit |

Counts: **P0 = 0; P1 = 0; newly found P2 = 0; inherited non-blocking P2 = 2; new P3 = 1; inherited evidence-limit P3 = 1.** No Phase 5A-blocking issue was found.

## 7. Phase 5B–5F Reassessment

| Phase | Revised status | Evidence-based recommendation |
|---|---|---|
| 5A — Audit | COMPLETE | This report and its plan record the source inventory, current evidence and remaining work. |
| 5B — Shared AI | **ALREADY IMPLEMENTED — NO DUPLICATE DEVELOPMENT** | Provider registry, default selection, model/config persistence, per-provider secret storage, Main-process SharedAI completion API and consumer separation are present and tested. Only live account interoperability remains unverified, not a missing implementation. |
| 5C — Translation 2.0 | **ALREADY IMPLEMENTED — NO DUPLICATE DEVELOPMENT** | Shared AI integration, MyMemory, Qwen-MT, prefill, auto-translate, cancellation/stale guards, provider status and settings are present with deterministic tests. No new Translation 2.0 feature is evidenced as approved but missing. |
| 5D — Manager UX | REMAINS THE NEXT USER-VISIBLE PHASE; KEEP NARROW | The only concrete new issue found is the MyMemory trigger-copy mismatch. If approved, fix this and test the Settings/Translation wording and configured/unconfigured flow. Do not start a broad redesign without specific reproducible friction. |
| 5E — Reusable module interface | REDUCE TO DOCUMENTATION/NEED-DRIVEN TEST; NO PLUGIN FRAMEWORK | `SharedAIService` and domain-specific typed IPC are enough for additional first-party Main-process consumers. No external plugin use case exists. Introduce an extension abstraction only after a second approved consumer exposes a concrete limitation. |
| 5F — Regression and Windows closeout | KEEP AS FINAL GATE, TARGETED | After approved 5D changes, rerun relevant Node tests/typecheck/build and targeted installed Windows acceptance. Reuse applicable G4–G6 evidence; do not repeat stress/soak without a relevant runtime change. |

**Recommended next task:** a small Phase 5D correction of the Settings MyMemory copy so it accurately says that configured MyMemory auto-translates after the user pauses input. Preserve the explicit distinction that changing the selected engine alone does not send text. This is the only directly evidenced new user-facing issue; broader UX scope should wait for the user’s next priority or a concrete reproduction.

## 8. Verification and Limits

### Run for this audit

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — 118/118; no failures. Node emitted existing `MODULE_TYPELESS_PACKAGE_JSON` warnings for TypeScript/ESM modules. |
| `git diff --check` | PASS — no unstaged whitespace errors. |
| `git diff --cached --check` | PASS — checked the exact staged plan/report diff. |

### Reused, not rerun

- `pnpm run build`: G6 exact-source build PASS; no product source/build configuration changed since that accepted source identity.
- NativeHost Checks: G6 reports 55/55 PASS.
- UpdateHelper Checks: G6 reports 10/10 PASS.
- Packaged Manager, Native-only process state, installed Windows acceptance, Manager open/close/reopen, Native/Manager synchronization, and Phase 4G stress/soak evidence: reused only within the original G5/G6 scope and labels.
- Frozen pnpm install and Windows package/isolated smoke: G6 records PASS; this audit made no dependency or lockfile change.

### Not executed in this audit

- No live AI Provider test, real token/key access or paid/free network translation request.
- No installer execution, live installation/profile access, real Favorites/Settings/SecretStore read, startup registry operation, tray/hotkey interaction, or long-running/stress test.
- No fresh Windows GUI test; Phase 4G-5/4G-6 evidence is historical and remains labeled accordingly.

These are deliberate audit boundaries, not inferred PASS results. Current automatic tests and historical acceptance are separated above.

## 9. Change Scope and Phase Decision

Only the approved Phase 5A plan and this audit report were changed. Product code, IPC/preload contracts, settings/data schemas, dependencies, package manager, build configuration, installed applications, user profile, secrets, startup registration and real runtime state were not changed.

**P0 = 0**

**P1 = 0**

**New P2 = 0**

**Phase 5A-blocking issue = 0**

**PHASE 5A AUDIT COMPLETE**

This audit does not start Phase 5B, 5C, 5D, 5E or 5F. Wait for the user to review the revised roadmap and authorize any next task.
