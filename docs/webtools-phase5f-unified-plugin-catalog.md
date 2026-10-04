# WebTools — Phase 5F Unified Plugin Catalog Implementation Report

Date: 2026-10-04

**PHASE 5F COMPLETE — PENDING PHASE 5G APPROVAL**

Plan: [Phase 5F implementation plan](superpowers/plans/2026-10-04-webtools-phase5f-unified-plugin-catalog.md). Phase 5E was approved by the user; its design-only historical report remains unchanged. This delivery implements registration/presentation/navigation only, not Phase 5G Translation lifecycle migration, Phase 5H SDK, or Phase 5I final Windows acceptance.

## 1. Git and Source Baseline

- Branch: `codex/shared-ai-translation-2.0`.
- Baseline HEAD: `f0b1e18e3f9dc12026179db5ab7b416d17d31114`, the committed Phase 5E design.
- Upstream: `origin/codex/shared-ai-translation-2.0`; initial fetch succeeded and divergence was `0 0`.
- Initial tree clean; no unknown changes or conflicts. Existing checkout retained in accordance with the user's established workspace preference.
- Read 5E report/plan, 5C/5D reports and plans; checked actual Main/session setup, plugin core/IPC/preload, App/navigation/center, Translation boundary and isolated smoke.
- Runtime build identity is baseline HEAD **plus reviewed uncommitted 5F source** during the smoke. Final checkpoint SHA and push synchronization are reported after executing Git; the runtime evidence does not pretend that HEAD already contained these changes.

## 2. Files and Responsibilities

| Files | Actual change |
| --- | --- |
| `src/shared/plugin-catalog-contracts.ts` | Host-only tagged references, safe entry/snapshot/open DTOs and narrow typed API. No external SDK. |
| `electron/plugins/builtin-plugin-registry.ts` | Fixed Translation descriptor: bundled source, host app version, Languages icon, ready/enabled, no toggle/uninstall/replacement/grants. |
| `electron/plugins/plugin-catalog.ts`, `plugin-catalog.test.mjs` | Independent catalog session/revision; safe concrete declarative projection; existing core open/toggle delegation and stale-await guards; explicit partial failure. |
| `electron/ipc/plugin-catalog-handlers.ts`, its test | Closed tagged-ref parser, arity/type/sender/main-frame/session checks, safe errors and handler disposal. |
| `src/shared/ipc.ts`, `electron/preload.ts` | Add only `pluginCatalog.list/open/setEnabled`; existing declarative API unchanged. |
| `electron/main.ts` | Construct catalog once after existing core initialization; rotate alongside the once-only core reload/restore; close/dispose alongside existing Manager cleanup. |
| `src/features/plugins/builtin-plugin-pages.ts` | Literal bundled Translation component map. No package-supplied component/module path. |
| `src/features/plugins/catalog-view-model.ts`, its test | Composite keys/ref, type-specific names/status, availability-filtered unified navigation and stale route/generation checks. |
| `src/App.vue`, `plugin-navigation.test.mjs` | Unified catalog refresh/open; tagged active identity, revision/generation guards, Plugins navigation, center fallback, preserve Favorites/Settings/Native aliases. Existing package-only navigation helper tests retained as compatibility coverage. |
| `src/features/plugins/PluginManagerView.vue` | Composite selection, separate builtin/package details, existing package controls, refresh after successful/failed mutations; mixed error plus available builtin display. |
| `src/features/plugins/catalog-app-lifecycle.test.mjs` | Actual Vue App setup with deferred IPC, real TranslateView lifecycle regression, late refresh and Native-route race checks. |
| `scripts/verify-phase5f-plugin-catalog-smoke.mjs`, its test | 5F entry using reviewed isolated 5D driver; structural safety assertions supplement runtime checks. |
| `scripts/verify-phase5d-plugin-ui-smoke.mjs` | Reuse isolation/probe/cleanup; update current center selector; opt-in 5F mixed catalog, repeat Translation navigation, exact Native prefill, reopen/persistence checks. |
| This report and the 5F plan | Scope, implementation, verification, risk and phase boundary. |

No dependency/lockfile, Manifest/API-major, registry/config/grant schema, TranslateView, Settings, provider/SharedAIService/SecretStore, NativeHost C#, Native Manager Pipe, launcher, installer or startup changes.

## 3. Catalog and Identity

```text
Main PluginCatalog (presentation authority)
  ├─ fixed bundled Translation descriptor
  └─ existing PluginManager.list() safe package summaries
       └─ existing validation, registry, permissions, runtime, private data
    ↓ narrow current-Manager IPC
preload.pluginCatalog
    ↓ tagged safe DTOs
App unified navigation / PluginManagerView separate detail branches
```

Identity is `(kind,id)`, including UI selection/key/open/toggle dispatch. A declarative package named or identified as `webtools.translation` remains local unsigned code-free package data, never the bundled identity. Main derives descriptors from fixed registration, not manifest fields. The package parser still rejects unknown trusted component/type fields.

`list(session)` returns one snapshot with entry metadata/details, revision and explicit declarative availability. Navigation is derived from that snapshot; separate list/detail/nav endpoints would duplicate this small data. No new package scan, polling, watcher, runtime map, initialization/recovery call or persistent catalog copy is added.

`open(builtin)` resolves only the known bundled key. `open(declarative)` delegates `PluginManager.getPages`, retaining grant/status/integrity/session enforcement. `setEnabled(declarative)` delegates the existing core transaction and consent. Builtin toggle rejects. Install/grants/actions/AI reviews/uninstall remain exclusively on the existing type-specific `desktop.plugins` API.

Catalog session exists even if core initialization fails. Core absence/list failure produces builtin entries **and an explicit unavailable package source**, never a fake successful empty package collection. A stale core/catalog session throws `SESSION_EXPIRED`; async responses are rechecked at Main IPC and again at App presentation. Core reload/restore still happens exactly once in the existing Main path.

## 4. Manager Navigation and Center

```text
工作区
  网址 (default Favorites home)
  插件 (expander)
    翻译
    available declarative pages, in existing package order
    插件管理 (always reachable)
设置 (independent bottom entry)
```

Enabled active/invoking packages with `manager.page` granted remain navigable. Disable, permission loss, unavailable/invalid state or uninstall removes the entry after mutation refresh and returns a now-invalid active package page to center. Refresh is on mount/reload and mutation/error, not polling. Refresh generations and snapshot revisions reject older list results; page responses must match tagged identity, route, generation, latest version and hash. Unmount invalidates pending UI work.

Builtin detail shows name, description, host version, bundled source, available state and Open Translation. It has no unsigned-publisher warning, package hash, grants, disable/replacement/uninstall control. Declarative detail retains all existing local install/version/hash/trust/grants/enable/revoke/replacement/uninstall/keep-data behavior. Busy list selection is blocked during mutation; completion triggers authoritative refresh even on error.

## 5. Translation 5F Bridge

Translation is **always enabled**, with `canToggle:false`; no builtin state file or disable admission gate exists. The component map is a literal import of the existing TranslateView. Both catalog navigation and the retained Native `translate`/prefill alias reach that same component and business implementation.

Existing engines, credentials/global settings, Shared AI, MyMemory, Qwen-MT, manual Google open, cancellation and exact prefill remain unchanged. Configured Translation still auto-translates after its existing 450 ms pause; this phase does not change that behavior. Runtime smoke uses an unconfigured AI profile, so it requires no provider/token/request.

## 6. Review Findings and Fixes

One independent read-only reviewer inspected the whole 5F diff under the executing-plans/requesting-code-review workflow. It found **one P2 regression**, corrected before checkpoint:

- Clicking already-active Translation routed through the temporary `plugin-page` loading section, unmounting TranslateView and clearing input/results/cancelling active work. Added an early same-builtin/current-Translation navigation return. A Vue lifecycle regression was observed RED (`plugin-page` instead of `translate`) then GREEN; it now verifies the same real TranslateView instance, retained input/result and zero cancellation during an in-flight fake provider response. Packaged DOM smoke also verifies the original textarea remains mounted on repeat navigation.

The reviewer found no additional actionable sender, identity, privilege, initialization, execution-loader or isolation findings. No further product fix/refactor was required. Current new findings: **P0=0, P1=0, unresolved/blocking P2=0, P3=0**.

Two smoke preparation issues were corrected without product changes: default center selection now starts at builtin (driver explicitly reselects its declarative fixture after remount); the existing Native search driver rejects newline/non-Translation-action text (final test uses an English phrase with whitespace/apostrophe/hyphen). Earlier failed-run reports remain outside Git, not presented as PASS.

## 7. Current Automated Verification

| Actual command | Result |
| --- | --- |
| `pnpm run typecheck` | PASS after F1, after F2, and final reviewed fix. |
| `pnpm test` | PASS **208/208**, zero failed/skipped; original 193 tests plus 15 new tests. |
| Catalog/core/IPC focused Node tests | PASS; include real manifest-v1 core, same-ID packages, disabled/revoked admission and unchanged registry bytes on projection. |
| Vue App/Translation lifecycle tests | PASS; deferred response ordering/partial source failure/Native navigation and retained translation mount. |
| `pnpm run build` | PASS: Electron Main, sandboxed preload, Vue Renderer; rebuilt after review fix. |
| `node --check` for both smoke entry/driver | PASS. |
| `pnpm exec electron-builder --win --x64 --dir --config.directories.output=...` | PASS; existing config, output outside repository. |
| 5D/5F smoke safety tests | PASS **4/4**, including exact-identity/fresh-probe failure cleanup. |
| `git diff --check` | PASS; only existing Git LF→CRLF normalization warnings. |

The Node typeless-package warning and builder missing-author warning are existing tooling limitations; no package type/dependency change was introduced to suppress them. Full Native stress/Soak and installer tests were intentionally not repeated because Native/installer code did not change.

## 8. Current Packaged Windows Smoke — Executed

**Evidence label: CURRENT PACKAGED ISOLATED UI / LIFECYCLE PASS.** This is actual packaged Electron/Vue DOM execution and real isolated Native/Manager processes, with test-only consent used only to pre-seed a fixture. It is not a user-installed or physical mouse/dialog acceptance.

- Build root: `D:\系统缓存\WebTools Phase5F Final 验证 20261004-210701`.
- Evidence: `D:\系统缓存\WebTools Phase5F Final 验证 20261004-210701\smoke-final\phase5f-plugin-catalog-smoke-report.json`.
- Evidence SHA-256: `CBE648361E06180768C9348BF3C74110C848B0F03647E1B682F91F07694BE1EC`.
- Native source reused without C# change: `release/native-production-20261004-194711/stage/host`, Release production artifact copied to the isolated test root.
- Native PID **22952** remained across all running checkpoints.

| Checkpoint | Native | Target Electron group |
| --- | ---: | ---: |
| Native-only | 1 | 0 |
| Mixed center/declarative config/enable-disable/revoke | 1 | 4 |
| Exact Native Translation handoff, same Manager | 1 | 4 |
| Ordinary Manager close | 1 | 0 |
| Reopened Manager, Favorites and persisted package status | 1 | 4 |
| Reopened Manager ordinary close | 1 | 0 |
| Final isolated Native graceful exit | 0 | 0 |

Executed DOM checks: Favorites default; Plugins expander; builtin detail/status/no forbidden controls; original Translation opens and repeat navigation retains input; package list/trust/details; config read/write; full AI review preview/cancel without dispatch; disable/re-enable; revoke config-write grant and remove package navigation; Native Translation action sends exact leading/trailing spaces and apostrophe/hyphen text; same Manager reuse; new Manager restores builtin and fixture's `needs-permission` status. Both normal closes were observed by process exit/identity, not by closing Native first. Final Native exit code was 0 and cleanup recorded no error.

Artifact hashes were independently recomputed and matched the smoke report:

| Artifact | SHA-256 |
| --- | --- |
| NativeHost EXE | `15EF470F3818624945F4EE0A95D315D68811ABB5F89D344B1ECA1BFE819AA714` |
| NativeHost assembly | `107E461DA4648B7CBD4BEA268F00D510BF213746D2892BC88D1DA298F3BAD063` |
| Manager EXE | `07C3EB3117DCE7C36342DB7D2E6E6E52306A50BFF4598E39FCD2A3531E4CF173` |
| Manager app.asar | `90E705DDFDA6A857D815672432992C121F0961038A4E4497970439BEC4B63E01` |

Manager Authenticode status: `NotSigned`. No installer or release was generated in 5F.

## 9. History, Manual Gaps and Protection

- Historical 5C/5D design/results were used to identify contracts, not relabeled as current execution. Their security/service tests were also rerun in the current 208-test suite.
- **USER MANUAL VERIFICATION REQUIRED:** native picker/install/replace/downgrade consent, uninstall keep/delete dialogs, physical keyboard/focus/accessibility and visual layout in light/dark/narrow windows. These existing 5D gaps carry into 5I; DOM/programmatic interaction is not a physical-input PASS.
- Unit tests of real core with mock consent/provider are not real Windows consent/provider evidence. No real paid provider, token or user plugin was used.
- All profiles/fixtures/logs/packages/process probes are outside Git under the temporary evidence root. No operation targeted `D:\webtools`, `%APPDATA%\Nook`, real favorites/settings/plugins/secrets or startup registry. The test uses unique resource pipe and precise executable/PID/creation-time guards; cleanup closes Manager before test Native and never bulk-kills by process name.
- No claim of an independent production filesystem/registry before/after snapshot is made. Protection is established by the reviewed isolated paths/test mode and constrained executed workflow.
- Existing separately deferred concerns from 5E (main-frame `file:` navigation policy, current-user pipe peer binding, unsigned packaging, historical missing environment snapshot) remain outside this scope; no new exploit/regression was found.

## 10. Phase 5G Prerequisites and Rollback

5G requires separate user approval. The temporary always-enabled descriptor and retained `translate` bridge must then be replaced coherently with the approved dedicated enable state and Translation-only lifecycle/handoff policy. SharedAIService stays independent. No draft 5G state/IPC/disable logic was added early.

Rollback is an audited source revert of this checkpoint; no persistent data schema, package identity, grants or provider data needs migration/deletion. Keep external evidence. No package update, SDK, executable plugin, native wire or production install architecture change is implicit in this delivery.

## Final Decision

Unified catalog, composite identity, mixed navigation/center, Translation bridge and package authority are implemented and reviewed; current typecheck, 208-test regression, build and isolated packaged UI/process smoke passed. No blocking security or core functionality issue remains. Checkpoint commit/push and final tree/upstream state are verified by the concluding Git commands and reported to the user; no PR/merge/tag/release is authorized.

**PHASE 5F COMPLETE — PENDING PHASE 5G APPROVAL**
