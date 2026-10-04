# WebTools — Phase 5C Plugin Core Implementation Report

## Scope and Source

Phase 5C only: declarative Manager plugin core. Baseline `61e851315f7ecfed3d82a0b520426e7c231eed5d`, branch `codex/shared-ai-translation-2.0`, initially clean and synchronized. The user approved implementing/testing/checkpointing this scope after writing the 5C plan. No Phase 5D UI, 5E SDK or 5F final Windows acceptance is included.

Plan: `docs/superpowers/plans/2026-10-04-webtools-phase5c-plugin-core.md`. Design: `docs/webtools-phase5b-plugin-architecture.md`. Historical 5A/4F/4G6 reports remain unchanged.

## Files and Boundaries

| Area | Files | Responsibility |
| --- | --- | --- |
| Shared contract | `src/shared/plugin-contracts.ts`, `src/shared/ipc.ts` | Closed manifest/settings/block/action types, safe DTOs, nested plugin API and fixed IPC channels. |
| Validation | `electron/plugins/manifest.ts`, `package-validator.ts`, `png.ts`, `errors.ts` | Duplicate-aware bounded JSON, strict runtime schemas, ZIP metadata/streams/CRC/budgets, static PNG validation, safe errors. |
| Persistence | `electron/plugins/managed-fs.ts`, `plugin-store.ts`, `plugin-registry.ts` | Canonical managed paths, no links/junctions, serialized atomic writes, config/private data, registry identities and recovery. |
| Runtime and orchestration | `electron/plugins/permission-broker.ts`, `declarative-runtime.ts`, `plugin-manager.ts` | Consent, permissions, exact package/action identity, transaction sequencing, AI quotas and cancellation. |
| Electron adapter | `electron/plugins/electron-plugin-host.ts`, `electron/ipc/plugin-handlers.ts`, `electron/main.ts`, `electron/preload.ts` | Trusted picker/native consent, current-main-frame guards, SharedAIService adapter, reload/close wiring. |
| Tests | `electron/plugins/*.test.mjs`, `electron/plugins/fixtures.mjs`, `electron/ipc/plugin-handlers.test.mjs`, `scripts/verify-phase5c-plugin-smoke.mjs` | Deterministic negative-path tests, test-only package fixtures, short isolated packaged runtime check. |
| Dependency | `package.json`, `pnpm-lock.yaml` | Exact yauzl 3.4.0, @types/yauzl 3.4.0; transitive pend 1.2.0. No existing dependency version changed. |

NativeHost C#, Named Pipe production protocol, Launcher/hotkeys/tray/startup, AppData schema, DataStore, SecretStore, SharedAIService/Provider implementations, Vue pages and installer configuration are unchanged. The Main integration adds only Manager-owned plugin setup and cleanup.

## Manifest v1 and Runtime Schema

Raw JSON is `unknown`; only `parseManifest()` produces the branded internal `ValidatedManifest`. Renderer receives `PluginSummary` / `PluginPageDTO`, never raw package objects, paths, Node/Electron objects or secrets. Validation is implemented as a closed runtime schema; a distributable authoring JSON Schema/SDK is a later 5E deliverable.

Required root fields: `manifestVersion:1`, `id`, `name`, `description`, `author`, `version`, `api:{apiMajor:1,minHostVersion}`, `type:'declarative-manager'`, `entry:{pageId,label,icon?}`, `requestedCapabilities`, `settings`, `pages`, `actions`, `assets`. Unknown fields are rejected at every declared object level. Author is `{name,url?}` with HTTPS URL. SemVer 2 precedence includes prereleases and ignores build metadata for ordering; version strings remain distinct package identities.

- IDs: 3–128 lowercase characters with dot/hyphen separators; bounded logical page/action/setting/storage keys.
- Settings: text with min/max length/default, enum with bounded options/default, boolean/default, finite number with min/max/default.
- UI blocks: heading, paragraph, text-input, select, checkbox, divider, button. UI references resolve and match setting types; forms require config read/write capability declarations.
- Actions: bound setting/key config/storage reads/writes, a declared HTTPS literal external URL, clipboard text, or bounded AI messages. Extra input fields are rejected. No URL/path/key/provider/channel override is accepted.
- Plain text only. The host does not interpret plugin content as code, HTML, CSS, Markdown, templates or expressions.

Limits remain the approved values: archive 20 MiB; entries 256; total expanded 50 MiB; PNG 256 KiB and 256×256; ratio 100:1; manifest 64 KiB; JSON depth 16; pages 8; blocks/page 64; actions 32; settings 64; capability declarations at most 128 (duplicates rejected). Private JSON: 512 KiB/value, 200 keys, 5 MiB envelope. Depth includes the persisted key/value envelope. Configuration also cannot exceed its 5 MiB reader budget; registry writes cannot exceed their 1 MiB reader budget. A rejected write leaves the previous readable file intact.

## ZIP Reader and PNG Safety

Pinned [yauzl](https://github.com/thejoshwolfe/yauzl) 3.4.0 is a maintained Node ZIP reader; npm metadata checked on 2026-10-04 lists Node >=12 and modification date 2026-06-07. It provides lazy central-directory enumeration, entry streams, metadata and ZIP64 handling. The existing Node 24 / Electron 44 environment is compatible. This is not unrestricted extraction or a homegrown ZIP reader.

The host snapshots at most 20 MiB of compressed bytes so validation/digest/commit refer to identical content. Entries are streamed sequentially with reported and actual size/ratio/total checks, CRC32, local-header consistency and controlled errors. Host checks additionally reject Windows illegal/reserved/ADS/absolute/traversal names, case duplicates and file/directory prefix aliases, encryption, symlink/special/reparse attributes, missing/duplicate manifests, undeclared/non-PNG content and malformed ZIP64.

PNG validation checks signature, dimensions/depth/color, chunk length/order/CRC, bounded zlib output and filter bytes (including Adam7 row geometry), static images only; APNG is outside v1. Production performs an additional bounded Electron `nativeImage` decode. Data URLs are generated only from validated PNGs; no asset filesystem path reaches renderer.

## Managed Storage and Transactions

Root is derived from `app.getPath('userData')`, not hardcoded Nook:

```text
plugins/
  registry.json
  packages/<plugin-id>/<semver>/<sha256>.wtplugin
  config/<plugin-id>.json
  data/<plugin-id>.json
  cache/  logs/  staging/
```

Packages remain immutable archives; runtime reads only validated declarative records and bounded PNGs. No extraction creates executable/package-provided files. Registry tracks current version/hash, retained versions, enabled state, requested/granted capabilities, status/error/recovery code. Host-derived paths check containment and reject link/junction ancestors before reads, writes and deletions. This is application-level validation, not a sandbox against a same-user administrator who can rewrite host files.

Registry/config/data use temporary exclusive writes, fsync and atomic rename. Serialized queues prevent concurrent read-modify-write loss. Config applies schema defaults without executing migrations. Incompatible schema changes reject upgrade and retain old pointer/config; upgrades do not rewrite configuration, so failure rollback retains the original configuration directly. Prior archives remain available; reinstalling a retained archive goes through the same conflict/downgrade consent.

Install uses only Main's `.wtplugin` picker, then validation/staging/package commit/registry pointer. New plugins are disabled and ungranted. Same active identity/hash is idempotent. Same version/different hash and downgrade have additional native confirmation. Upgrade intersects grants; new requested capabilities produce needs-permission. Old runtime writes are stopped/drained and compatibility is rechecked before pointer commit; commit failure restores the prior runtime and cleans new package/staging content.

Uninstall prompts first, stops current operations, persists disabled state, removes only managed package files, then removes registry entry. Independent data deletion defaults to keep. Corrupt config/private data is rejected without overwriting it. Registry recovery reconstructs only validated managed archives, disabled with no grants; it never treats an archive hash as publisher authentication. Startup also reconciles crash-orphan archives with a valid registry: new identities stay disabled/ungranted; retained versions are indexed without changing an existing current selection or grants. The recovery diagnostic survives restart until successful explicit enablement.

## Permissions, Actions and Shared AI

Closed capabilities: `manager.page`, `plugin.config.read/write`, `plugin.storage.read/write`, `external.open`, `clipboard.write`, `sharedAI.complete`. Requested is not granted. Main checks enabled/runtime/active version/hash/declared action/closed input/capability/current session on every call and after asynchronous work. Disabled or needs-permission plugins register no page/action. Each storage action's key is fixed in its manifest, scoped to that plugin.

External open and clipboard write require a fresh trusted native confirmation displaying exact content; no renderer `userGesture:true` is accepted. AI displays full accepted preview and the selected shared provider/model, rechecks provider selection after consent, then calls existing SharedAIService with 2048 max tokens and AbortSignal. Only result text is returned. No key, headers, endpoint configuration, provider switch, raw provider error or full settings API is exposed.

AI limits: one request/plugin, five/minute, at most 100 messages and 50,000 characters/message, 2048 output tokens, 60-second deadline measured from provider dispatch, excluding human preview time. Mock providers/credentials only in tests. Cancellation races resolve promptly; noncooperative late responses are ignored and keep their concurrency slot until settling, preventing request stacking. A cancelled provider lookup cannot open a delayed consent prompt.

5C native dialog preview is capped at 24,000 characters for a reliable consent surface. Larger previews return `USER_CONFIRMATION_REQUIRED`, without calling a provider. This is a temporary conservative UI limitation, not an increase to approved quotas; 5D must supply a complete bounded request-preview view before larger requests become usable. No AI network or real credential was used during verification.

## Lifecycle / IPC

Runtime kinds are closed to `declarative-manager`. Validation/registry/store/permission/runtime/orchestration are separate seams; there is no generic module-path loader, worker, utility process, script execution or background plugin listener. NativeHost performs no plugin work.

Lifecycle covers installed-disabled, active/invoking, stopping and fault/incompatible/invalid/needs-permission states. Disable/revoke synchronously install a blocked lifecycle intent, abort current work and deny new calls. Pending upgrades, rollback and session restoration cannot reactivate across that intent; only the matching serialized mutation can clear it. Failed stop persistence stays fail-closed in the current session until a successful explicit enabling/grant operation. Manager reload rotates session and cancels current runtime operations; close/before-quit cancels all and removes owned IPC handlers. No plugin auto-restart timers. The only runtime timer is a bounded AI timeout, cleaned on completion/cancellation.

Preload exposes only `desktop.plugins.list/installFromUserDialog/setEnabled/setGrants/getPages/invoke/uninstall`. Every handler checks current Manager main frame, argument count/runtime types and session; result/error DTOs are stable and sanitized. IPC install accepts no path; grants/enabling/removal and sensitive effects are consented in Main. Formal Vue management/navigation/rendering is intentionally absent until 5D.

## Verification Evidence

- Frozen pnpm install: PASS after the two exact dependency additions; existing dependency versions unchanged.
- Manifest/package/store/runtime/IPC tests: 42/42 PASS after final-review fixes (6 manifest, 8 package, 8 store/registry, 16 manager/runtime, 4 IPC).
- Typecheck: PASS after each foundational task.
- Full Node suite: **160/160 PASS**, comprising the existing 118 tests plus 42 new substantive tests. An initial 155/155 pre-review run included a test-helper filename automatically counted by Node; helper renamed to `fixtures.mjs` so final counts exclude that empty helper execution.
- Production build: PASS (Main/preload/Vue); electron-builder `--win --x64 --dir` PASS with package reader dependencies included.
- Final short real packaged smoke: **PASS**, evidence `D:\系统缓存\WebTools-Phase5C-5174001f833a492bb67eee755c0f5afb\plugin-smoke-report.json`, SHA-256 `A602581FDBEDE974876D724939C31709D4DC72FC0E6563CCF26F215C826B7376`.
- Native artifact reused from accepted pnpm build `release/native-production-20261003-220039/stage/host`: EXE `1d9c148ba6d8d20085e36625b2ed49c5e129f587008d00602a9c836f99d1a044`, DLL `ec880fb0bea214617c9ff144037a0d536dd56e3436527b1501b314314e76ca2a`. Final Manager EXE `aabec81f3f7442143b4485b044bfca893cedc5e4299879b3fdaf7c5d16b26785`, ASAR `96ecf6e3216c3a8dbcd24a60c495c2cbd7ee34d783d296ba1b67955bbdfb3221`. Build source is baseline HEAD plus the reviewed final 5C implementation; evidence explicitly records dirtySource, rather than pretending the build was a pre-existing commit.
- Same isolated Native PID 19060: native-only Electron=0 → packaged Manager/plugin DTO active Electron=4 → ordinary WM_CLOSE Electron=0 while Native remains → Native normal exit code0, all isolated processes=0. Manager PID11756 was reused across Favorites → Settings → Translation with exact `don't stop` prefill. AI was unconfigured in the isolated profile, and no provider was invoked.
- Seed package installation/grants used TEST-ONLY mock consent outside product IPC; production native dialogs are NOT TESTED. DTO/preload/real nativeImage decoding and normal Manager close were actually executed. This is not a 5D UI or installed-installer acceptance.
- First smoke timed out because its test driver had not consumed the existing `ready` greeting; failure evidence retained at `D:\系统缓存\WebTools-Phase5C-7c2936f3b0884a54a2c0f9f4fbe9cec9\plugin-smoke-report.json`. Driver was corrected; product Native behavior was not changed.
- An expanded smoke used an invalid translation candidate containing digits and Chinese; unchanged Native search correctly refused it. Failed evidence retained at `D:\系统缓存\WebTools-Phase5C-be7f28bf485547578efc9897f5f133c6\plugin-smoke-report.json`. The driver now uses a supported English phrase and includes control error details. Final smoke uses the identical reviewed Manager artifact from that build.
- `node --check scripts/verify-phase5c-plugin-smoke.mjs`: PASS. `git diff --check`: PASS. Existing Node typeless-package and missing package-author builder warnings remain non-blocking; no unrelated package/build changes were made to silence them.
- No installer execution, large Native stress/soak rerun, production installation/profile operation, memory measurement or manual Windows claim.

## Phase 5D Integration / Remaining UI Acceptance

1. Add plugin management/navigation through host UI, rendering only the validated block union with Vue text bindings (never v-html or plugin code).
2. Present summaries, capabilities, enabled/invalid/recovery state, versions and action errors; use the existing narrow API.
3. Implement bounded settings/forms/results and dedicated complete AI preview/disclosure. Preserve Main grants and per-call enforcement; no confirmation bypass.
4. Test actual native install/trust/replace/downgrade/grant/uninstall/data-retention prompts and user cancellation/reload.
5. Perform plugin page/keyboard/accessibility/PNG UI checks and final Windows lifecycle/security acceptance in the approved later phase.

Executable plugins, arbitrary network/filesystem, background execution and Launcher extensions remain unsupported future work requiring separate authorization/threat model.

## Final Review and Decision

One fresh-context read-only reviewer checked the whole change against the approved spec; implementation remained inline. One fix pass followed with RED→GREEN regressions and the full suite:

| Finding | Priority | Resolution |
| --- | --- | --- |
| Queued upgrade could recreate a runtime after disable/revoke | P1 | Synchronous blocked generation intent; activation/current calls/rollback/restore honor it. |
| Value depth accepted before adding storage envelope | P2 | Validate complete persisted JSON before replacement; reject without losing earlier data. |
| Config could exceed its reader's total-byte limit | P2 | Validate complete config envelope against 5 MiB before atomic write. |
| Valid registry ignored committed crash-orphan packages | P2 | Reconcile verified packages without changing active selections; new identities disabled/ungranted. |
| Recovery diagnostic erased at initialization | P3 | Preserve REGISTRY_RECOVERED until successful explicit enablement. |
| Same envelope mismatch in registry byte budget (main-agent follow-up) | P2 | Registry save enforces its 1 MiB reader budget, preserving previous registry on rejection. |
| Cancelled AI lookup could open late preview; timer included human consent (main-agent follow-up) | P2 | Recheck validity before consent and start deadline at actual provider dispatch. |

All listed findings are fixed and covered. Remaining P0=0, P1=0, blocking P2=0. Deferred limits: actual native consent dialogs and plugin page/UI acceptance await 5D/5F; previews above 24k characters fail closed; the core is not an OS sandbox against a same-user filesystem attacker. Inherited main-frame file-navigation and native peer-binding concerns remain outside this change. No memory-benefit claim is made.

Execution rulings: Windows PowerShell ledger equivalents were used; the existing authorized clean codex checkout was retained; no independent implementers or second review round; test-fixture and smoke-driver errors were corrected without weakening production checks. Raw evidence remains outside Git. Historical Native checks/stress are not presented as newly executed results because Native source is unchanged.

The core implementation, runtime schema, archive validation, permissions, lifecycle, transaction/storage and narrow IPC gates meet Phase 5C. Final user workflows remain explicitly pending UI integration.

**PHASE 5C CORE COMPLETE — PENDING PHASE 5D UI INTEGRATION**

The reviewed code/tests/plan/report will be checkpointed together on `codex/shared-ai-translation-2.0` under `feat: add declarative manager plugin core`. Actual commit SHA and upstream status are reported after Git completes; no self-referential commit hash is fabricated inside this report. No Phase 5D/5E/5F work or PR/release is authorized by this closeout.
