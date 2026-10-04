# WebTools — Phase 5E Unified Plugin Architecture Report

Date: 2026-10-04

**PHASE 5E DESIGN COMPLETE — PENDING USER APPROVAL**

This is a source audit and proposed contract, not an implemented unified registry or a new SDK release. Phase 5F must receive separate approval. The revised roadmap is 5F unified registration/navigation, 5G Translation integration, 5H SDK/packer/example, and 5I final acceptance. References to SDK in 5E or acceptance in 5F in older reports describe the previous roadmap; those historical documents remain unchanged.

## 1. Git, Scope and Evidence

- Branch: `codex/shared-ai-translation-2.0`.
- Audited HEAD: `b5612be6dd85cd7a5a83411631ee971d16c4dbed`, `feat: add Manager plugin center and declarative UI`.
- Phase 5C checkpoint: `e1147f0b2ec7fca7fb3fc14ee864384e6cfee330`.
- Upstream: `origin/codex/shared-ai-translation-2.0`.
- Initial tree clean; fetch completed; `HEAD...upstream` returned `0 0`. Thus 5D is committed and pushed, rather than inferred from its report's baseline SHA.
- Read Phase 5A–5D reports, the 5B/5C/5D plans, Phase 4F removal and Phase 4G-6 closeout, and the source paths below.
- Only this report and [the Phase 5E plan](superpowers/plans/2026-10-04-webtools-phase5e-unified-plugin-architecture.md) are new deliverables. No product code, dependency, lockfile, installed application, profile, registry or startup state was changed.

Evidence labels: **CURRENT SOURCE AUDIT** means code inspected in this task; **HISTORICAL AUTOMATED PASS** means a retained earlier result; **PROPOSED** means future work requiring approval; **MANUAL VERIFICATION REQUIRED** means unobserved UI acceptance. No runtime behavior is claimed as newly tested here.

5D records typecheck/build PASS, Node **193/193**, and a real packaged `win-unpacked` Manager smoke at `D:\系统缓存\WebTools Phase5D Final Review 20261004-193722\phase5d-plugin-ui-smoke-report.json`. That smoke used test-only seed consent and no provider request; native file picker, install/replace/downgrade/uninstall dialogs and visual/keyboard/accessibility checks remain manual. They carry forward into 5I. It was not an installed-upgrade test. This task did not rerun those checks or independently rehash that smoke's files.

## 2. Current Plugin Core and Navigation — Actual Source

| Location | Verified behavior | Treatment |
|---|---|---|
| `electron/plugins/manifest.ts:112` | `parseManifest` is the producer of branded `ValidatedManifest`. Closed root/child fields, duplicate-key/prototype/depth checks, SemVer and references. Only `declarative-manager`, manifest v1/API major 1; `manager.page` required. | Reuse unchanged; no built-in type in package schema. |
| `electron/plugins/package-validator.ts` | Bounded yauzl ZIP iteration; CRC/local-header/size checks; no extraction of code; declared PNG validation and archive SHA-256. | Reuse unchanged. |
| `electron/plugins/plugin-manager.ts:17` | Install/recovery/identity/grants/config/integrity, serialized mutation intents, runtime maps and one-use AI reviews. `initialize` revalidates packages and recovers verified orphan versions. | Remains declarative package authority. |
| `electron/plugins/plugin-registry.ts` | `registryVersion: 1`, records identified by ID/current version/hash, retained identities, enable/grants/status; optional 5D metadata accepted on old 5C records. | No built-in records or registry migration. |
| `electron/plugins/plugin-store.ts`, `managed-fs.ts` | Private config/data per ID; defaults and schema validation, quotas, serialized atomic writes; host-derived contained paths, reject symlink/junction ancestors. | No third-party access to new built-in state. |
| `electron/plugins/declarative-runtime.ts` | Data interpreter, safe page DTO/PNG data URL; closed action switch, cancellation controllers and bounded AI work. No loader/module path. | Preserve execution model. |
| `electron/plugins/permission-broker.ts` | Main enforces declared + granted + available; AI concurrency/rate reservation and host effects. | No built-in bypass through this broker. |
| `electron/ipc/plugin-handlers.ts` | Current Manager main-frame sender, closed arguments, session checks before/after async operations, safe errors; disposal removes plugin handlers. | Keep existing API; add narrow catalog API beside it. |
| `src/shared/plugin-contracts.ts:39`, `electron/preload.ts` | `PluginSummary` is specifically a local unsigned package with hash/grants; `PluginPageDTO` is sanitized data. `desktop.plugins` has no paths/raw IPC. | Wrap safe summaries, do not broaden their meaning. |
| `src/App.vue:16` | Closed section union, Favorites initial section, separate Translation import/section. Async Settings/plugin center/declarative views; no Router or keep-alive. | Local navigation integration only. |
| `src/features/plugins/plugin-navigation.ts`, `plugin-view-model.ts` | Enabled active/invoking + `manager.page` granted determine nav; request identity includes section/ID/generation. Mutation refresh returns unavailable pages to center. | Extend projection to a discriminated reference. |
| `PluginManagerView.vue`, `DeclarativePluginView.vue` | Center assumes every item has package hash/grants/uninstall. Fixed Vue block renderer; stale page/action presentation rejected; Main-owned AI review confirm/cancel. | Center needs separate built-in/declarative detail branches. |
| `electron/main.ts:180,189,335` | Reload rotates plugin session and restores enabled runtimes; close/quit stops them and cancels translation. Core init failure does not prevent existing Manager pages. | Catalog must preserve this failure isolation. |

Current package storage is **an immutable archive**, not the extracted manifest directory proposed early in 5B:

```text
<userData>/plugins/
  registry.json
  packages/<id>/<version>/<sha256>.wtplugin
  config/<id>.json
  data/<id>.json
  cache/  logs/  staging/
```

Limits currently enforced: archive 20 MiB, 256 entries, expanded 50 MiB, ratio 100:1, manifest 64 KiB/depth 16, PNG 256 KiB/up to 256×256, 8 pages/64 blocks per page/32 actions/64 settings. Private values 512 KiB, 200 keys/5 MiB envelope; registry 1 MiB. These are source policies, not memory measurements.

Lifecycle distinctions matter: `active` in the declarative core means an available interpreter, not that Vue is mounted. Page unmount cancels pending AI review and invalidates presentation; it does not currently cancel every dispatched Main action. Disable/revoke/replace/uninstall/reload/Manager close stop runtimes and invalidate requests. The new common model must preserve those semantics rather than invent identical execution hooks for both types.

## 3. Translation 2.0 Dependency Audit

```text
App.vue (route + exact prefill)
  → TranslateView (input/languages/result/error/copy state)
      → sandboxed preload translation methods
          → translation-handlers (sender + shape validation)
              → TranslationService (request IDs, abort, timeout, routing)
                  ├─ MyMemoryAdapter (fixed public endpoint; no key)
                  ├─ SharedAIService → OpenAI/Anthropic adapters
                  └─ QwenMtAdapter → Qwen credentials/endpoint config
Settings → DataStore settings.translation / settings.sharedAI
AIProviderCredentialStore → SecretStore → Electron safeStorage
```

Verified files: `src/features/translate/TranslateView.vue`, `src/shared/translation-contracts.ts`, `translation-request-gate.ts`, `src/features/settings/SettingsView.vue`, `electron/ipc/translation-handlers.ts`, `electron/services/{translation-service,translation-prompt,mymemory-adapter,qwen-mt-adapter,google-translate,shared-ai-service,ai-provider-registry,ai-credentials,secret-store,data-store}.ts`, and associated tests.

| Concern | Current behavior | Migration contract |
|---|---|---|
| Form/output | Source input, languages, result/error/loading/copied are page-local. | Preserve existing SFC and layout; unmount releases page-local state. |
| Automatic translation | Configured page sends after 450 ms; source/language/prefill changes invalidate and schedule. Initialization schedules only if mounted and settings ready. | Preserve approved automatic behavior when enabled. |
| Engines | `mymemory`, `ai`, `qwen-mt`; MyMemory default/no key/500 UTF-8 byte cap; AI uses current default host provider; Qwen-MT uses Qwen credentials/workspace independently of default provider. | Keep existing routing, models and language settings. No provider replacement. |
| Google | Explicit manual external-open URL action, never automatic API fallback. | Keep existing validated Main URL construction and behavior. |
| Requests | Request gate rejects stale results; Main validates ≤20,000 source characters, 45 s timeout, cancellation, ≤100,000 output characters. | Add enable/generation admission around existing IPC, not a second service. |
| Unmount | Clears language-save/auto timers, invalidates request and cancels active translation; async initialization checks mounted. | Retain; disable additionally cancels Main translation requests immediately. |
| Settings | Global translation engine/source/target/Qwen model, independent shared AI provider/model settings. | Keep in `nook-data.json` v2. |
| Credentials | Main-only provider credentials in `secrets.json`; Custom retains legacy key lookup. | No migration or plugin-readable keys. |
| Navigation | Hard-coded `translate` section and Native `translate` alias. | Resolve through known built-in registration; retain wire alias. |

Existing tests include real Vue lifecycle with a custom renderer (`translate-view-lifecycle.test.mjs`), service/provider/config/prompt/request-gate tests, native commands and packaged Manager lifecycle checks. Source-assertion tests alone do not prove focus, accessibility or visual layout.

**Historical wording discrepancy:** 4G-6 says applying prefill does not submit to a provider. Current `TranslateView.vue:77` and the mounted lifecycle test explicitly schedule 450 ms automatic translation when configured. Earlier no-network smoke used an unconfigured AI profile. 5E follows the current code and later user-approved automatic UX; it does not rewrite historical measurements or promise “prefill never auto-translates.” Disabled Translation must not mount or dispatch. Re-enabling with retained text must explain the existing automatic behavior before user confirmation.

## 4. Options and Decision

| Option | Change/typing/state | Compatibility/security | Test cost and SDK effect |
|---|---|---|---|
| A: make PluginManager own both | Add branches throughout package loading, registry/recovery, grants, runtimes, install/uninstall. Many package invariants become conditional. | Risks package/built-in state pollution; needless registry migration. | Highest regression cost; SDK coupled to trusted host internals. Reject. |
| B: catalog projection above existing manager | One Main-owned catalog: fixed built-in descriptors/state + adapter from safe declarative summaries. Small discriminated DTO; mutation calls routed to existing authorities. | No manifest/registry change; separate persistent state/trust. Catalog derives, never duplicates package authority. | Focused projection/session/navigation tests; external SDK unaffected. **Recommend.** |
| C: general adapter registry | Separate providers, discovery, lifecycle dispatch and extension registration interfaces. | Can be safe, but a generic runtime registration hook is unnecessary for two known types. | More indirection, premature lifecycle/SDK abstraction. Defer generality. |

B has two concrete adapter functions, as in the user's responsibility diagram, without a public adapter registration framework. There is one catalog source of presentation truth, not a second persisted declarative registry. It can become more extensible only after a real third execution model receives its own threat model and approval.

## 5. Recommended Architecture and Trust Boundary

```text
NativeHost (resident; no plugin scan)
  → existing fixed Manager page/translation intent
Electron Main (only while Manager exists)
  PluginCatalog
  ├─ Built-in descriptors + BuiltinPluginState
  │    └─ fixed Translation lifecycle policy → existing TranslationService
  └─ Declarative summary adapter → existing PluginManager
       └─ package validator / registry / store / runtime / PermissionBroker
  ↓ narrow catalog DTO/API + existing type-specific APIs
Preload
  ↓ no paths, tokens, module names, raw IPC
Manager App.vue
  ├─ unified nav/center
  ├─ literal bundled Translation component mapping
  └─ existing fixed DeclarativePluginView
```

No manifest may register a bundled component, Main service or trusted adapter. `kind`/`source` for a built-in are created by the compile-time host registry, never copied from package input. Current manifest parser already rejects a built-in type, unknown fields and executable entries. Package type remains `declarative-manager`.

Use **composite identity `(kind,id)`** throughout catalog/UI keys/selection/dispatch. Built-in `webtools.translation` and an existing declarative package with the same string are separate identities. Do not retroactively reserve an ID namespace and break valid installed packages. The local package remains visibly “本地导入、发布者未经验证”; a copied display name does not confer the built-in badge, route or privilege. Every IPC revalidates the tagged reference against its own authority. No bare-ID fallback to a built-in lookup.

Shared: metadata projection, availability checks, catalog list/open/toggle, navigation fallback, Manager-session invalidation, safe errors. Separate: package install/grants/version/hash/storage/AI consent and built-in code/service lifecycle/configuration. Future executable plugins are a design consideration only: no placeholder runnable variant, no loader API, no worker/process host, no code path accepted from a package.

## 6. Proposed Internal Type Contracts

These are host-only drafts; not new manifest fields and not the public third-party SDK. `PluginSummary`/`PluginPageDTO` retain their existing package semantics. Proposed file: `src/shared/plugin-catalog-contracts.ts`.

```ts
type PluginRef =
  | { kind: 'builtin'; id: 'webtools.translation' }
  | { kind: 'declarative'; id: string }

type PluginIcon =
  | { kind: 'host'; key: 'translation' }
  | { kind: 'png'; dataUrl: string }
  | { kind: 'fallback' }

type BuiltinState =
  | { status: 'ready' | 'invoking'; enabled: true }
  | { status: 'disabled' | 'stopping'; enabled: false }
  | { status: 'faulted'; enabled: false; errorCode: string }

type BuiltinEntryDTO = {
  kind: 'builtin'; id: 'webtools.translation'; source: 'bundled'
  name: string; description: string; version: string; icon: PluginIcon
  compatibility: { status: 'compatible' }
  state: BuiltinState
  entry: { kind: 'builtin-page'; key: 'translation' }
  hostUsage: readonly ('translation' | 'shared-ai' | 'external-open' | 'clipboard')[]
  management: {
    canToggle: boolean; canManageGrants: false
    canUninstall: false; canReplacePackage: false
  }
}
type DeclarativeEntryDTO = {
  kind: 'declarative'; id: string; source: 'local-unsigned'
  package: PluginSummary // includes compatible/error status and exact identity
  icon: PluginIcon
  entry: { kind: 'declarative-page' }
  management: {
    canToggle: boolean; canManageGrants: true
    canUninstall: true; canReplacePackage: true
  }
}
type CatalogEntryDTO = BuiltinEntryDTO | DeclarativeEntryDTO
type CatalogSnapshot = {
  revision: number
  entries: CatalogEntryDTO[]
  declarativeAvailability:
    | { status: 'available' }
    | { status: 'unavailable'; errorCode: string }
}
type CatalogOpenDTO =
  | { kind: 'builtin'; id: 'webtools.translation'; key: 'translation'; generation: number }
  | { kind: 'declarative'; page: PluginPageDTO }
```

`canOpen(entry)` is derived from authoritative state: built-in ready/invoking; declarative `pluginCanOpen(package)`. An entry descriptor is not permission to open; Main `open(ref)` rechecks. Compatibility/error information for packages comes from existing status/API metadata; do not infer trust from compatibility. DTO icon data remains host-owned literal icon or validator-produced bounded PNG. A built-in detail never has package hash/grant/version-list fields. Actual Vue mount state is derived from App's active tagged reference and component lifecycle, not persisted or falsely inferred from a successful Main open response.

Main `PluginCatalog` small public interface: `list(session)`, `open(ref, session)`, `setEnabled(ref, boolean, session)`, `beginSession()`, `close()`, plus a private fixed built-in lifecycle port. New narrow `desktop.pluginCatalog.{list,open,setEnabled}`; existing `desktop.plugins` retains install/grants/actions/reviews/uninstall for declarative only. No generic `invokeBuiltin(action, args)` API.

The private Translation lifecycle port exposes enabled/generation admission and Translation-only cancel; Main handler work enters/leaves invoking state, while bundled Vue mount/unmount uses existing local cleanup. `beginSession` invalidates catalog/open/builtin generations and rotates the declarative core session exactly once through Main's existing reload path; `close` cancels built-in work and delegates the existing core stop once. No package supplies lifecycle callbacks, and projection does not invent a second runtime or duplicate initialization.

Use current Manager main-frame guard, exact arity/closed object validation, session and generation rechecks after awaits. Catalog session exists even if declarative initialization fails; it coordinates with, rather than borrows ownership from, `PluginManager.session`. Main authoritative rechecks deny unavailable opens even when renderer holds an old snapshot. Snapshot revisions and App refresh generations reject old list/open completions. Refresh after each mutation/IPC availability error and at mount/reload; no filesystem watcher or polling service needed.

## 7. Navigation and Management Center

```text
工作区
├─ 网址 (default)
└─ 插件 (collapsible)
   ├─ 翻译 (only when available)
   ├─ enabled declarative entries
   └─ 插件管理 (always reachable)
设置 (existing bottom entry)
```

Built-ins have fixed order first (Translation first); declarative entries retain their current relative registry order, avoiding an unrelated new sorting policy. Plugin center last. No persisted “last page” behavior: ordinary open defaults to Favorites; explicit Native pages override default. `entries` remains the Favorites alias; `translate` becomes an internal resolver to the known built-in ID. Keep existing explicit section switching and no Router/keep-alive.

App stores a tagged active reference plus open-generation/page DTO, not a bare package ID. Opening a page checks Main and latest catalog identity; package responses also match version/hash. A type/state change invalidates the generation and unmounts the page, returning to center. Busy declarative `invoking` remains navigable as now. Settings/Favorites remain independent. Translation pending state is coordinated by Main (§9), not discarded merely by clearing a component prop.

Center renders exhaustive type branches:

| Built-in | Declarative |
|---|---|
| Bundled label, host version, fixed icon/name/description, available/disabled/faulted, open and allowed toggle. | Current author/API/version/hash/local-unsigned label, permission rows, install/replace/upgrade/downgrade/enable/disable/uninstall/data choices. |
| No uninstall/replace/third-party trust warning/hash or editable capability grants. | All existing Main confirmation and review transactions unchanged. |

Global “安装本地插件” remains an install command for declarative packages; it is not an action on the selected built-in. Never render a misleading built-in “replace” control. Main rejects forged built-in grants/uninstall even if UI omits buttons. Keyboard/focus/error/loading treatment follows existing tokens/components; no UI redesign.

**5F staging boundary:** register Translation's presentation descriptor and bridge its existing `translate` route, with `canToggle: false` and current always-enabled behavior. This permits real mixed-type nav/center tests without migrating business lifecycle. 5G activates persisted disable policy and replaces the temporary route bridge with the fixed built-in lifecycle adapter. There is no placeholder executable plugin or duplicate Translation entry during staging.

## 8. Translation Identity, Disable Policy and Lifecycle

**PROPOSED:** ID `webtools.translation`; name `翻译`; description `使用当前翻译服务理解文字`; literal host `Languages` icon; source `bundled`; version `app.getVersion()` (currently 0.1.0). “Translation 2.0” is a feature generation, not invented semver 2.0.0. Registration at `electron/plugins/builtin-plugin-registry.ts`; renderer component mapping at `src/features/plugins/builtin-plugin-pages.ts`, using literal imports only. Keep files in `src/features/translate/` and Main services in place.

| Disable option | Implication | Decision |
|---|---|---|
| A always enabled | Least work; does not provide actual disabling, only hiding an entry. | Suitable only as temporary 5F bridge. |
| B disabled + explicit re-enable route on Native intent | Respects saved state, discoverable recovery, no silent network dispatch. | **Recommend final behavior**, pending design approval. |
| C auto-enable on Native intent | Defeats disable choice, can send source to configured provider unexpectedly. | Reject. |

Default enabled only when state file is genuinely absent/entry absent in a valid supported document. Disable hides nav, blocks new translate/Google-open work in Main, immediately cancels `TranslationService.cancelAll()` and unmounts TranslateView. Keep provider-info/settings APIs readable for Settings. Do not call the broad `cancelActiveAIRequests` helper to disable Translation: it also cancels host AI connection tests; other plugins/host services must remain usable.

After disabling, late service/provider responses cannot restore UI or execute a new external action: check built-in enable-intent generation before dispatch and after awaits, in addition to existing request gate. Page unload still uses its current timer/request cleanup. Enable restores availability only after safe persistence succeeds; no page or network request created by enabling alone. Reopening mounts the existing SFC and reloads saved settings, with no retained translation result. Manager close/reload invalidates lifecycle generation and outstanding built-in operations. Shared AI service stays alive only with Manager, independent of Translation state.

## 9. Native Translation Intent and Disabled Handoff

Current source: Native `Services/ManagerController.cs` queues latest intent, starts/reuses Manager, waits for renderer-ready (60 s), then sends fixed `open-page`/`translation-prefill` (45 s acknowledgement). `NativeManagerPipeServer` uses current-user pipe/protocol validation. Main parses fixed commands, validates exact text ≤20,000, keeps one pending intent and sends only after renderer-ready. Preload filters shape; App routes; TranslateView acknowledges exact applied ID after nextTick. Main accepts only current Manager main-frame + matching request ID. Native request correlation uses the transport envelope ID; payload intent ID is not permission or identity.

**Important constraint:** waiting indefinitely for a user to re-enable Translation would hit the 45 s transport timeout. Do not solve it with a longer arbitrary timeout or Native plugin scanning. Introduce a Main-only `TranslationHandoff` state machine in `electron/services/builtin-translation-handoff.ts`:

```text
validated intent (one slot, exact text, requestId, Manager session/generation)
  ├─ enabled → render fixed Translation → exact applied acknowledgement → clear
  └─ disabled/faulted → present recoverable host gate
       → matching gate-presented acknowledgement settles transport reception
       → retain one bounded Main-owned text slot while Manager exists
       ├─ enable-and-open → persist enable → exact prefill → applied → clear
       └─ cancel/discard → clear, remain disabled, no provider call
```

Transport reception is distinguished from final text application. In enabled flow keep existing apply-before-ack behavior. In disabled flow `gate-presented` settles the existing transport Promise; wire format/version need not change because Native currently discards a successful ack's result. The host gate must display “翻译已停用”、the retained text/length, explicit **启用并打开翻译** and **取消**. It discloses that opening a configured Translation page follows the existing automatic-after-pause behavior. No auto-enable, hidden translate invocation, or indefinite pending pipe request.

Narrow Manager-only methods proposed: `getTranslationHandoff()` returns current safe slot; `resolveTranslationHandoff({requestId, generation, disposition})` accepts only `gate-presented`, `enable-and-open`, `applied`, `cancel`. Main derives the target, enable state and original text; Renderer cannot supply replacement text, plugin ID, source privilege or enable-confirmed boolean. `enable-and-open` is the explicit trusted host UI command, not package author code. Before `applied` accept, require current slot/session/generation and previously issued enabled-page delivery. Existing `acknowledgeNativeManagerIntent` remains for other page intents; it must not bypass the built-in handoff state machine. The handler validates sender both before and after asynchronous state writes.

In `src/shared/builtin-translation-contracts.ts`, the safe slot DTO is a closed union: `none`; `blocked` with requestId/generation and a `disabled|state-unavailable` reason; or `ready` with requestId/generation. Each nonempty variant contains a separate payload union `page-only|prefill(text)` so a no-text tray intent is not represented by an optional/fake string. These are host bridge contracts, not SDK exports. Faulted/unreadable state shows repair guidance and Cancel, not an enabled page; `enable-and-open` is rejected until a successful safe state reload/repair. A state error cannot overwrite corrupt bytes merely because a Native intent arrived.

Race/recovery rules:

- Keep only one slot, at most 20,000 characters, no disk persistence/logging. Newer native page/translation intent replaces the slot and invalidates old UI commands; show an explicit replaced/discard notice where a gate was visible.
- Local navigation away before application does not silently clear it: show explicit keep/discard choice or retained-text banner with resume/cancel. Keep retains the Main slot without mounting Translation. Applied text does not remain queued after leaving the page.
- Renderer reload retains the slot in Main and reprojects it after Manager readiness; **do not resend or acknowledge an already-settled pipe request a second time**. Reissued delivery has a new UI generation. Delayed old-session acknowledgements do nothing.
- Normal Manager close clears/rejects any unsettled transport and clears all text/state; cancellation is terminal. NativeHost remains running. No request survives Manager process exit or is saved as plugin data.
- If state/page loading fails before prompt/prefill is shown, return a stable failure through existing transport and a recoverable error; never acknowledge an unseen prompt or pretend text applied. Generation checks prevent late enable-after-cancel.
- Bounded handshake deadline no later than existing 45 s pipe wait; a testable deadline releases an unpresented request. It is failure handling, not a delay used to hide races. A presented gate may remain while Manager is open, without provider work or a pending transport wait.
- Native `open-page: translate` without text resolves the same disabled gate and enable policy, with no fake text or automatic request.

No C# or Named Pipe schema change is planned. Existing current-user hello PID trust is not upgraded by this design; it is an inherited separately deferred boundary. Tests must cover Main-absent/starting/ready/hidden, reload, disabled, supersession, cancel, close, state-write failure and late acks. A need for a wire change or peer-auth redesign is a stop-and-report condition, not implicit authorization.

## 10. Shared AI Remains a Host Service

`SharedAIService` depends on host shared-AI settings/credential port/adapters, not TranslateView or plugin enablement. `TranslationService` calls it for generic AI and accesses Qwen credentials for MT. Declarative runtime accesses only `PermissionBroker.host.ai`, with requested/granted checks, exact preview transaction, provider recheck, cancellation, 1 concurrent/5 dispatches per minute/plugin, 2048 output tokens and 60 s provider timeout. Noncooperative requests keep their slot until settle.

Do not move SharedAIService, provider registry, credentials or SecretStore into a built-in plugin. Disable Translation cancels Translation's controllers only; a separate declarative AI request and host connection test continue. No third-party API exposes provider tokens, whole DataStore, bundled page hooks or unrestricted `desktop.translate`. The fixed host renderer is the trusted action surface; untrusted package data never becomes executable JS. Adding executable plugins would invalidate that assumption and require a separate SDK, isolation/security design and authorization.

## 11. SDK Boundary and Compatibility

| Contract | 5H disposition |
|---|---|
| Manifest v1/API major 1, ID/version/minHostVersion, pages/entry/actions/settings/assets | Publish external JSON schema and types matching **actual** parser; no change needed for catalog unification. |
| 8 capabilities; seven UI blocks; closed action inputs | Document exact request/grant/host-consent semantics and quotas. No direct runtime hook. |
| Package ZIP+manifest+declared PNG/closed paths/CRC/hash/limits | Independent offline packer/validator; hash integrity not publisher trust. No new signing/updater requirement. |
| Existing error codes and safe `IpcResult`, cancelled/success | Document closed known codes + unknown-code recoverable UI fallback; never raw exceptions/paths/provider body. |
| Plugin lifecycle status | Host display states, not JS callbacks a plugin may register. |
| Catalog/built-in TS, desktop bridge, runtime instances/session/provider identity | Internal host APIs; not exported as author SDK. |
| Future executable API | Separately versioned namespace/SDK after threat model; not an API major 1 extension or an accepted manifest type now. |

No apiMajor bump, manifest addition, installed package rewrite, grant reset or package ID remapping is necessary. Parser rejects unknown properties today; SDK must not promise they are ignored. Any future additive schema change still needs an explicit compatibility policy and tested host version support. `minHostVersion` remains the existing host SemVer check, not invented apiMinor negotiation.

The current plugin error vocabulary in `electron/plugins/errors.ts` includes validation/compatibility (`INVALID_MANIFEST`, `INVALID_PACKAGE`, `INCOMPATIBLE_PLUGIN`, `INVALID_INPUT`), storage/integrity (`STORAGE_INVALID`, `STORAGE_LIMIT`, `UNSAFE_PATH`, `INTEGRITY_FAILED`, `CONFIG_INCOMPATIBLE`), lifecycle/permission (`NOT_INSTALLED`, `PLUGIN_DISABLED`, `SESSION_EXPIRED`, `PERMISSION_DENIED`, `ACTION_NOT_DECLARED`, `USER_CONFIRMATION_REQUIRED`, `DOWNGRADE_DENIED`), and execution (`AI_BUSY`, `AI_RATE_LIMIT`, `AI_TIMEOUT`, `ACTION_FAILED`, `OPERATION_FAILED`). Document these safe host outcomes separately from Translation service errors; do not promise arbitrary provider exceptions are passed through. New internal builtin/handoff errors can use a separate namespace and must not silently alter the existing package API's meaning.

Config supports bounded text/enum/boolean/number. UI blocks currently support text-input/select/checkbox; declared controls require matching config-write actions and read/write caps. The 5D fixed host editor can expose additional settings, but arbitrary layout/schema expressions are not allowed. Invocation inputs: read/external `null`; config/storage write `{value}`; clipboard `{text}` (host UI/native preview limit 24,000 even though validator accepts 50,000); AI `{messages}` bounded 100 × 50,000, full UI review/one-use ID, native direct invoke preview capped 24,000. SDK must explain the usable consent surface limits.

5H proposed artifact paths: `sdk/declarative-v1/{manifest.schema.json,types.d.ts,README.md}`, `scripts/{validate-wtplugin,pack-wtplugin}.mjs`, and independent `examples/plugins/help-links/`. They are ordinary directories in the existing single package, no workspace/monorepo/new dependency. JSON schema cannot catch duplicate keys, CRC, PNG decode, cross references or every resource constraint; host remains authority. Offline tooling must share/compare the existing validation contract and parity fixtures without coupling external authors to `electron/main.ts` or requiring modification of host source. A valid 5C/5D package must install unchanged after 5F/5G/5H.

Proposed CLI contract: `node --experimental-strip-types scripts/pack-wtplugin.mjs <source-directory> --out <archive.wtplugin> --host-version <semver>` and the validator equivalent `<archive.wtplugin> --host-version <semver>`. Host version is explicit for compatibility; no network/default latest lookup. Exit 0 means validated output, nonzero means safe diagnostics and no partially published archive. An explicit overwrite flag may replace only the verified output file; there is no recursive destination cleanup. These commands are drafts for 5H, not tools created or run in 5E.

## 12. Persistence, Migration and Recovery

| Data | Policy |
|---|---|
| `nook-data.json` v2 Websites/Favorites/settings.translation/settings.sharedAI/legacy fields | Same location/schema/normalization. No migration for this design. |
| `secrets.json` and AI key names/fallback | Same Main-only storage, never copied into plugin data. |
| `plugins/registry.json`, archives/config/data | Keep v1 reader/recovery/atomic writes/grants/current hash; no built-in entries. |
| Nav/page/result/draft | Session-local; Favorites default; no last-route migration. |
| Native launcher-state/pipe | Existing fixed intent/projection, no plugin enable state copied to Native. |
| Built-in enabled choice | New independent `<userData>/builtin-plugins/state.json`, only trusted fixed IDs. |

Proposed state document:

```json
{
  "stateVersion": 1,
  "plugins": { "webtools.translation": { "enabled": false } }
}
```

No text, provider config, grants, package hash, tokens or active-page state. Bounds: 16 KiB document, depth 4, 32 records, closed record shapes/fixed ID validation. For a future downgrade, bounded unknown built-in IDs may be retained as inert booleans but never registered or interpreted as code; unknown state version is read-only/faulted. Valid absent known ID uses bundled default. Missing file is distinct from malformed/unreadable/unsafe file: only missing enables defaults. Invalid/unsupported data preserves original bytes and makes affected built-ins unavailable with repair guidance; do not overwrite with enabled defaults.

Implementation is a small dedicated `BuiltinPluginState` with serialized bounded read/write, ancestor reparse/canonical containment checks, same-directory exclusive temp file + fsync + atomic rename, session/intent check before commit. Existing `ManagedFs.initialize()` creates the full six-directory package layout, so do not mechanically instantiate it as a built-in store or refactor the general filesystem framework solely for this task. Reuse the already-small SerialQueue and validation principles; test the new narrow store independently.

Disable intent blocks admission immediately and cancels requests while persistence runs. Success commits the displayed saved state; failed save reports failure and keeps a faulted unavailable session state until explicit retry, without resurrecting cancelled work or claiming persistence. Restart reads the last successfully saved state; the UI must explain an unsaved change. Repair/reset is explicit host confirmation with retained backup, never automatic destructive reset. No same-user file ACL is claimed as protection against a malicious process running as that user.

Rollback to pre-migration source leaves the new file untouched/inert and preserves all existing data. That older build does not enforce the new disable choice; disclose this functional downgrade rather than moving/deleting user data. Reverting newer source should be separately authorized, not a git reset over dirty work.

## 13. NativeHost-first and Startup Cost

Catalog exists only in Electron Main; built-in metadata is a fixed small list and bounded enable-state read. NativeHost never scans packages, knows general plugin IDs, loads Vue, handles AI or starts Electron for app/website/`?`/`/`/`file:` searches. No daemon, background watcher, new BrowserWindow, hidden plugin renderer or persistent SDK process.

Existing PluginManager initialization already validates/recover-scans installed packages, including disabled records. Unified projection must reuse its result, not reinitialize, rescan archives or build a second registry per list. This proposal makes no startup speed/MB claim. Maintain core-init failure isolation so broken declarative storage does not make Translation/Favorites/Settings disappear. Lazy literal Translation loading in 5G is permissible at the route seam, with loading/error UI and readiness gating; no broad bundle/library overhaul.

Manager close remains destroy + Electron quit; catalog sessions, builtin slot/controller state, existing declarative runtimes/reviews all clean up. Acceptance must observe Electron group=0 with NativeHost still running, not infer it from service tests.

## 14. File-Level Implementation Roadmap and Dependencies

The executable task/checklist detail is in the paired plan. All later phases are **NOT STARTED / REQUIRE APPROVAL**.

| Phase/task | Main paths/contracts | Depends on | Completion and rollback |
|---|---|---|---|
| 5F F1: catalog types/projection/handlers | New shared catalog contracts, Main catalog/builtin registry, catalog handlers; existing main/preload/ipc. | 5E approval | Composite identity, session guards, mixed/faulted source; no manifest/registry delta. Remove catalog seam to roll back; keep package data. |
| 5F F2: nav and center | App.vue, plugin-navigation/view-model/PluginManagerView, literal built-in page map. | F1 | “插件”, mixed nav/details, legacy Translation bridge with no disable yet, default/explicit routes. Revert presentation without touching Translation/data. |
| 5F F3: compatibility smoke/review | Existing fixtures and tests; new isolated mixed-catalog smoke/report. | F2 | Unchanged v1 test package, permission lifecycle/nav/Manager close. No formal SDK or package installer redesign. |
| 5G G1: state and Main enable lifecycle | New builtin state/store + tests; catalog/main/translation handlers. | 5F accepted + 5G approval | Persistent disable, Main generation/abort gate, no SharedAI cancellation. Rollback code only, leave new state intact. |
| 5G G2: handoff and bundled page | New Main handoff + shared safe contract, App/preload/ipc, narrow TranslateView boundary if needed. | G1 | Exact text, bounded disabled gate, reload/cancel/late ack protection, existing automatic UX preserved. Wire unchanged; rollback entire handoff seam together. |
| 5G G3: provider/config/installed acceptance | Existing translation tests, focused new handoff/lifecycle tests + isolated smoke. | G2 | All engines with fake transports; no token migration; Manager cleanup, enabled/disabled Native entry. Stop on prefill/request regressions. |
| 5H H1: author contract | SDK docs/schema/types, compatibility fixtures. | 5G accepted + 5H approval | Closed v1 schema/type/runtime parity; internal APIs excluded. Remove tooling only, packages unaffected. |
| 5H H2: offline validator/packer/sample | scripts and independent example paths in §11. | H1 | Build/install unchanged-package example without modifying host source; reproducible file set, hostile package tests. No new loader/dependency. |
| 5I I1: integrated security/regression | Core/catalog/state/handoff tests and final report. | 5H accepted + 5I approval | Final source/build identity, sender/ref spoofing/session/storage/AI tests; all meaningful existing tests retained. |
| 5I I2: Windows acceptance | Existing production packager and isolated smoke, real dialog checklist. | I1 | 5D manual gaps + mixed plugins/Translation/persistence + Native idle/close Electron=0. Installer only where changed payload warrants isolated smoke. No production install operation. |

Dependency spine: `F1 → F2 → F3 → approval → G1 → G2 → G3 → approval → H1 → H2 → approval → I1 → I2`. Do not independently delegate F1/F2 or G1/G2: their session/routing/handoff state is coupled. After explicit delegation authorization, a read-only reviewer or independent SDK schema/document review can assist; primary implementer owns final integrated review. No subagents were needed for this design audit.

## 15. Risk Matrix, Verification and Recovery

These are prospective design risks, not newly observed product failures.

| Risk / condition | Impact | Prevention and targeted test | Recovery |
|---|---|---|---|
| Generalize package manager for built-ins | Broad regressions, authority duplication | B projection; unchanged archive/registry fixtures and package diff review | Revert catalog adapters, retain core/data. |
| Manifest ID/type/name spoof reaches trusted page | Privilege escalation | Tagged refs, closed manifest/sender parsing, fixed lookup; same-ID package test and forged built-in uninstall/action | Fail closed; no fallback by bare ID. |
| Built-in state written into package grants/config | User data/grant loss | Independent file; before/after registry/config hashes using isolated data | Preserve old bytes; abort migration. |
| Disabled Native intent calls service | Unexpected network/text disclosure | Main gate + disabled prompt; fake provider/external counters zero | Block/open recoverable center, never auto-enable. |
| Late catalog/page response navigates after disable | Stale UI/state | Revision/ref/version/hash/open generation; deferred-response test | Invalidate/unmount/refetch center. |
| Handoff prompt consumes 45 s pipe wait | Timeout/redelivery/lost text | Reception vs application; one Main slot, deadline, reload and >45 s prompt test with fake clock | Reject unseen prompt; explicit retained text/discard. |
| Enable finishes after cancel or supersession | Wrong source/network | Request/session/generation checks before commit/delivery and terminal transition tests | Consume old token, no retry without user action. |
| Disable cancels global SharedAI | Other tools break | Translation-specific controllers; concurrent fake declarative AI/host-test unchanged | Remove incorrect shared cancellation coupling. |
| SDK exports internal TS/paths or schema loosens | Frozen insecure public API/incompatible packages | Separate author schemas/types, v1 parity corpus and closed fields | Stop release; correct author contract without changing package schema. |
| Catalog doubles startup scans/keeps Electron alive | Performance/lifecycle regression | List from initialized core; bounded store; isolated Manager close and Native-only gate | Remove duplicate initialization/background work. |

Inherited deferred items remain: broad Main-frame `file:` navigation and current-user Native pipe hello PID not bound to the launched Manager process. Neither is silently fixed or claimed hardened here. A newly demonstrable exploit during integration is a blocker requiring a separate minimal security response. Unsigned installer and missing historical environment snapshot remain limits, not manufactured proof.

P0/P1/new blocking P2 found in this read-only architecture audit: **0**. Architectural proposals above require tests in later phases; that count is not a security certification of unimplemented code. Existing 5D manual gaps remain open. Approval choices: recommendation B catalog, final disable option B, separate state file, composite identity and reception/application split. They are concrete proposals for user review, not already shipped behavior. No dependency/API major/schema/wire expansion is required by the recommended path.

## 16. Acceptance and Review Gates

For each implementation foundation run `pnpm run typecheck` before dependent work; relevant Node tests before integration. Phase end: `pnpm test`, `pnpm run build`, `git diff --check`; isolate all packages/profiles/pipes/evidence outside production. Do not rerun earlier search stress/Soak for timestamps.

5I manual checks: mixed navigation/default Favorites/explicit Settings; native picker and install/replace/downgrade/grant/revoke/uninstall keep/delete; actual review confirm/cancel/focus; built-in badge/actions; disable/restart/re-enable; Native disabled prefill prompt/cancel/reload/exact source; existing automatic translation after explicit open using a safe agreed service/test; other plugin AI unaffected; normal Manager close/reopen; Native idle Electron=0. Real paid AI/credentials are not acceptance prerequisites; use mock transport for all automatic network/secret assertions. If testing a real service is later authorized, record it separately.

Stop on product-data risk, executable-package requirement, need to alter manifest/apiMajor/schema/Native wire, unclear trusted dispatch, production install overlap, or reproducible P0/P1/blocking P2. Label unperformed real UI checks MANUAL VERIFICATION REQUIRED, and do not close 5I based on mock consent alone.

## 17. Phase 5E Closeout

Completed: code-level audit, three-option comparison, recommended typed projection/trust boundary, navigation/center design, Translation identity/disable/prefill contract, host AI independence, compatible SDK boundary, state recovery, file-level 5F–5I plan and risk/acceptance gates.

Verification in this task is documentation/source/Git review and whitespace checks only. Historical 193/193/build/package smoke are explicitly historical, not new execution. No product code or production data changed. Only the two Phase 5E documents may enter the authorized documentation checkpoint; actual SHA/push/synchronization are reported after Git commands complete.

**PHASE 5E DESIGN COMPLETE — PENDING USER APPROVAL**

Stop. Phases 5F, 5G, 5H and 5I have not started.
