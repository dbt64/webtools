# Phase 6F-4D — Plugin Configuration Contract Development Report

**Date:** 2026-10-14

**Status:** IMPLEMENTATION COMPLETE — CONFIGURATION WRITE FIX / TARGETED PACKAGED REACCEPTANCE PASS (see §11; full phase closeout is not declared by this task)

**Plan:** [approved configuration contract audit](phase6f4d-plugin-configuration-contract-audit.md)

**Repository:** `D:\SystemDefault\Desktop\HomePage`

**Branch / unchanged HEAD:** `codex/shared-ai-translation-2.0` / `707c5673dff479285b34a5b441bec9d3b725c737`

## 1. Authorization and source boundary

The user approved the 6F-4D contract and implementation plan with “审核完毕没有问题”. This report records implementation against the existing dirty working tree, rather than against a clean release commit. An external per-file baseline and copies of affected source were retained before editing. The implementation began with 255 Git status entries; the audit round had reported 254 before adding its plan.

Only configuration contract, Host persistence/authorization, its Manager/Runtime entry paths, typed UI, SDK declarations, focused tests and documentation were changed in this task. `src/App.vue` required a narrow navigation integration so normal sidebar and page changes respect the new editor's unsaved/busy state. Its pre-existing content was hash-checked and backed up before this edit.

This is source implementation evidence. It does **not** establish packaged Windows acceptance, actual Web/Node runtime execution, a distributed SDK tarball or Phase 6F-4D final acceptance. Prior 6F-4C evidence is preserved; the user's sequencing waiver is not recorded as an invented acceptance PASS.

## 2. Implemented contract

### Manifest and public SDK

- Manifest v3 accepts optional `configuration: { schemaVersion, settings }` metadata. It is validated and frozen by the canonical parser used by the Host package validator.
- Fields are closed text, enum, boolean or number descriptors, with safe unique keys, labels, defaults and type-specific bounds. Arbitrary HTML/components/scripts and password/secret field types are not supported.
- Maximum 64 settings; schemaVersion is an integer from 1 to 2147483647. Existing v1 per-field bounds are retained; aggregate resolved values are limited to 512 KiB. v3 strings must contain valid Unicode scalars, consistent with the current closed runtime transport.
- Existing v3 packages without the descriptor remain loadable. Their config capabilities remain unavailable. Existing explicit config grants are preserved; absence of metadata is not converted into runtime authority.
- Web and Node SDKs expose `config.get()` and `config.set(key, value)`. Results are bounded primitive preference values; `set` returns void. No generic IPC, raw files, AppSettings or SecretStore API is added.
- SDK source version is 1.5.0, increased from the pre-task source's 1.4.0. Product version, manifestVersion and API major are unchanged. No tarball was built; distribution/external-author synchronization remains Phase 6F-5.

### One Host store, separate authority paths

| Caller | Authority and behavior |
|---|---|
| Manager configuration | Trusted Manager main frame/session plus current installed plugin ID/version/hash. Metadata comes from actual Host package validation. Disabled or ungranted plugins can be configured without activating a Feature. |
| Web/Node `config.get` | Active Feature declaration, requested/granted/implemented `plugin.config.read`, current validated snapshot and runtime/session/generation. |
| Web/Node `config.set` | Corresponding write capability plus declared key/value and current authority at atomic commit. |

Manager IPC accepts identity, values and Host-issued revision, never an authoritative descriptor or filesystem path. A stale package identity, ended session, invalidated sender or changed revision prevents a write. Runtime authority is independent of Manager configuration permission; revocation prevents runtime writes without preventing the user from editing disabled-plugin preferences.

Node Command uses the same dispatcher through its existing temporary Utility Process. No additional daemon, window ownership model or lifecycle mechanism is introduced. The implemented tests exercise the common Host dispatcher and SDK facade; they are not evidence of an actual packaged Utility Process run.

### Persistence and explicit recovery

The managed namespace is `config/v3/<pluginId>.json`, containing `{ storageVersion: 1, schemaVersion, values }`. It does not reinterpret `config/<pluginId>.json` from v1 or plugin private data. Writes share the existing serialized PluginStore queue and atomic filesystem path.

Missing files resolve validated defaults without a write. Corrupt values, unknown keys or schema incompatibility preserve original bytes and reject normal runtime/update operations. There is no automatic schema migration. Manager shows incompatibility and offers Host-confirmed reset, writing one latest raw-byte backup before defaults. The consent text discloses that the previous backup is replaced. A failed backup prevents reset. Explicit private-data deletion includes v1 config, v3 config and its backup; ordinary disable, close and replacement retain configuration.

Manager uses an optimistic revision (`missing` or SHA-256 of current config bytes) to reject concurrent edits. Preferences are not a secret vault; raw AI credentials, provider configuration, shared AI settings and SecretStore are outside this contract.

## 3. Manager UI

The detail view renders the Host-provided descriptor using existing built-in typed controls and responsive design tokens. It provides loading/read errors, per-field validation, save, cancel, reload, stale-edit feedback and explicit recovery. It works for disabled plugins and does not execute plugin UI code to render configuration.

The editor retains local draft state after a rejected/conflicting save. Generation checks discard late read/save responses after selection change or disposal. Actual sidebar, Websites, Settings, overview and Native Manager navigation requests consult a shared leave check. Busy/loading configuration prevents navigation; unsaved preferences require discard confirmation. This is scoped to the new plugin configuration draft, not a general redesign of Manager routing or window close policy.

## 4. Failures found and fixes

| Finding | Reproduction / correction | Evidence |
|---|---|---|
| Sender invalidated during an asynchronous IPC write | A focused test initially returned an IPC failure while the new config value had already been written. The Manager sender guard is now passed to the store and rechecked at atomic commit. | Manager configuration IPC regression verifies defaults remain unchanged after sender invalidation. |
| Actual sidebar/section navigation bypassed draft confirmation | Independent review found that the original overview-card-only guard did not cover App's sidebar selection prop or unmounting on section change. The new regression reproduced silent draft loss. App navigation now consults the exposed editor leave check before changing route/selection. | Four actual Vue setup/lifecycle tests cover cancelled/confirmed sidebar selection, page/overview navigation, in-flight save and Native requests. |
| Config accepted an unpaired surrogate rejected by runtime transport | Review found a default such as `"\ud800"` could validate but runtime `get` would fail. v3 descriptor/value normalization now rejects malformed Unicode; v1 parsing is unchanged. | Parser and store tests reject high/low unpaired surrogates, preserve saved bytes, and accept Chinese/Emoji. |
| Existing SDK facade expectations excluded the newly approved config family | Two existing exposure-key assertions failed after adding the API. Expected public keys were updated, with additional config calls and closed input rejection coverage. | Existing Web client/capability tests. |
| Existing v3 UI server-render fixture had no desktop API | Expanded regression first reported 121/122, with `window is not defined` in the new child editor. The server-render test now supplies the new typed Host configuration read dependency and restores its prior global afterward. No product behavior was changed to accommodate SSR. | Initial failure log retained; final result recorded below. |

One independent final read-only reviewer reported no Critical issue, one Important navigation issue and one Minor Unicode issue. Both were addressed in this final focused fix pass. This review covers the task delta, not the hundreds of pre-existing changes or packaged behavior. No remaining blocking finding was identified in this implementation scope.

## 5. Verification performed

| Check | Actual result |
|---|---|
| New descriptor/store/navigation fix regressions | 15/15 PASS after meaningful RED → GREEN runs. |
| Expanded affected-module Node tests | 122/122 PASS, 0 failed/cancelled/skipped, exit 0. This is a focused file list, not full `pnpm test`. |
| `pnpm exec vue-tsc --noEmit -p tsconfig.web.json` | PASS, exit 0, after navigation integration. |
| `pnpm exec tsc --noEmit -p tsconfig.node.json` | PASS, exit 0. |
| Public SDK config TypeScript consumer | PASS, exit 0, strict NodeNext / ES2022 / ES2022,DOM. |
| `git diff --check` | PASS, exit 0. |
| Task delta whitespace, including new files | PASS; 0 findings against retained per-file baseline/empty baseline for new files. |
| Task boundary | 48 task-delta files; 0 protected-path changes; 0 original baseline files removed; 0 staged files. |

Environment observed: Node v24.21.0, pnpm 9.15.9. Node's existing experimental transform/module-type warnings were visible, not hidden. Concurrent pre-existing Vite tests also emitted an HMR port-in-use diagnostic; the new in-memory navigation test disables HMR. Such messages are not treated as packaged runtime evidence.

The expanded focused command:

```powershell
pnpm exec node --experimental-transform-types --test plugin-sdk/runtime-v3/configuration.test.mjs electron/plugins/plugin-configuration.test.mjs electron/plugins/plugin-configuration-manager.test.mjs src/features/plugins/plugin-configuration-editor-model.test.mjs src/features/plugins/plugin-configuration-navigation.test.mjs plugin-sdk/runtime-v3/manifest-v3.test.mjs plugin-sdk/runtime-v3/package-v3.test.mjs electron/plugins/plugin-store.test.mjs electron/plugins/plugin-manager.test.mjs electron/plugins/web-host-capabilities.test.mjs electron/ipc/plugin-handlers.test.mjs plugin-sdk/declarative-v1/tests/web-protocol.test.mjs plugin-sdk/declarative-v1/tests/developer-public-api.test.mjs plugin-sdk/declarative-v1/tests/web-capabilities.test.mjs plugin-sdk/declarative-v1/tests/web-client.test.mjs src/features/plugins/catalog-app-lifecycle.test.mjs src/features/plugins/plugin-manager-view.test.mjs

pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --lib 'ES2022,DOM' plugin-sdk/declarative-v1/tests/configuration-public-api.typecheck.ts
```

### Evidence location

Implementation baseline, source copies, ledger and regression logs are outside the repository:

`C:\Users\admin\AppData\Local\Temp\WebTools-6F4D-20261014-182158`

`focused-before-ssr-fixture-fix.log` retains the 121/122 intermediate failure. `focused-final.log` records the final expanded run; its SHA-256 is `74E19BCF339E14FABBF9D3B6DC60F20436C700F98D6DAC9E479E0742F5FF2931`. The external ledger records decisions and earlier RED/GREEN results. No test profile, credentials, binary package or raw evidence was staged.

## 6. Remaining verification

The verification round completed full Node regression, typecheck, production build steps and creation plus structural validation of a PreviewOnly Windows candidate. The candidate installer and portable ZIP were **not installed or launched**. Therefore these actual packaged/manual acceptance items remain open:

- Actual packaged Host install rejection when author preflight is bypassed.
- Real Manager controls, keyboard/focus, enabled/disabled state, save/cancel/navigation, reopening, schema conflict and native reset consent.
- Actual Web and Node window/temporary Command `config.get` / `config.set` with allowed and denied capabilities, revoke/disable/replacement and stale-generation behavior.
- Runtime close/reopen, persistence, profile separation and Electron process lifecycle with the actual packaged build.

No runtime or manual PASS is inferred from source tests or a successful package build. No installer was executed, no application was launched, and no live profile or startup state was accessed. Use an isolated test profile/install for the remaining acceptance.

## 7. Task file delta

The external baseline distinguishes this task's edits from existing dirty files. The complete delta is:

- Docs: `docs/phase6f4d-plugin-configuration-contract-audit.md`, `docs/phase6f4d-plugin-configuration-development.md`, `docs/plugin-development.md`, `docs/plugin-runtime.md`.
- Host: `electron/plugins/plugin-configuration.ts`, `plugin-store.ts`, `plugin-manager.ts`, `plugin-development.ts`, `web-feature-authority.ts`, `web-host-capabilities.ts`, `plugin-command-entry.ts`, `electron-plugin-host.ts`, `permission-broker.ts`, `errors.ts`; `electron/ipc/plugin-handlers.ts`; `electron/preload.ts`.
- Shared/UI: `src/shared/plugin-contracts.ts`, `src/shared/ipc.ts`, `src/App.vue`; `src/features/plugins/PluginConfigurationEditor.vue`, `plugin-configuration-editor-model.ts`, `PluginManagerView.vue`, `PluginSettingEditor.vue`.
- SDK schema/types: `plugin-sdk/declarative-v1/runtime-v3/configuration.mjs`, `configuration.d.mts`, `manifest-v3.mjs`, `manifest-v3.d.mts`; `plugin-sdk/declarative-v1/manifest.schema.v3.json`, `types.d.ts`, `node.d.mts`, `package.json`, `README.md`.
- SDK bridge: `plugin-sdk/declarative-v1/web/bridge-client.mjs`, `capability-methods.mjs`, `capability-methods.d.mts`, `protocol.mjs`, `protocol.d.mts`, `index.d.ts`.
- Tests: `plugin-sdk/runtime-v3/configuration.test.mjs`; `electron/plugins/plugin-configuration.test.mjs`, `plugin-configuration-manager.test.mjs`; `src/features/plugins/plugin-configuration-editor-model.test.mjs`, `plugin-configuration-navigation.test.mjs`, `plugin-manager-view.test.mjs`; `plugin-sdk/declarative-v1/tests/configuration-public-api.typecheck.ts`, `developer-public-api.test.mjs`, `web-capabilities.test.mjs`, `web-client.test.mjs`.

## 8. Phase and Git result

Implementation, automated verification and preview packaging are recorded separately from real packaged/manual acceptance. Phase 6F-4D is **INCOMPLETE — WINDOWS CONFIGURATION ACCEPTANCE REQUIRED**; this report does not declare full phase acceptance.

No Launcher/Super Panel/NativeHost/installer/Translation/SecretStore or shared AI source changes were made by this task. Pre-existing changes remain preserved. Live `D:\webtools`, `%APPDATA%\Nook` and startup state were not accessed or modified.

No staging, commit, push, PR, merge, tag or release. Branch and HEAD remain unchanged. The worktree has 272 modified/deleted/untracked entries, including preserved work from prior tasks; this is not a 272-file task delta. The worktree remains dirty by design. Phase 6F-4E and Phase 6G were not started.

## 9. Verification round — 2026-10-14

### Automated regression and build

| Command / check | Result |
|---|---|
| `pnpm run typecheck` | PASS, exit 0. |
| `pnpm test` | First run: 569/570, with the repository release-contract test still expecting SDK 1.4.0. The approved 6F-4D contract is SDK 1.5.0, so only that stale assertion in `scripts/release-contract.test.mjs` was updated. Fresh rerun: 570/570 PASS, exit 0. |
| `pnpm run package:win -- -PreviewOnly -PreviewName WebTools-Phase6F4D-Configuration -PreviewUxRevision phase6f4d-config -OutputDirectory release\.phase6a-work\phase6f4d-20261014` | PASS, exit 0. The script ran `pnpm run build`, published the Release NativeHost and UpdateHelper, packaged the Electron Manager, and created the preview installer and ZIP. PreviewOnly explicitly skips test suites and installation smoke. |
| ZIP structure/integrity | PASS: 550 entries and 600,673,936 expanded bytes read; required NativeHost, `Manager/WebTools.exe`, and `Manager/resources/app.asar` present; 0 corrupt entries. |
| `git diff --check` | PASS, exit 0. |

The NativeHost publish emitted existing environment/reference warnings for `UIAutomationClient` / `UIAutomationTypes` and `CS8604` at `native/WebTools.NativeHost/SuperPanel/TextSelectionProvider.cs:89`. They are outside the 6F-4D source delta and did not fail the publish. Electron Builder also reported that `author` is missing from the root package metadata; packaging completed.

### Preview artifact identity

- Source HEAD: `707c5673dff479285b34a5b441bec9d3b725c737`; branch: `codex/shared-ai-translation-2.0`; dirty working tree: yes.
- Product version: `0.1.0`; channel: `stable`; `preview-build.json` records `dirty: true` and the preview label `phase6f4d-config`.
- Preview installer: `release/.phase6a-work/phase6f4d-20261014/WebTools-Phase6F4D-Configuration-Setup-0.1.0.exe`; 191,668,448 bytes; SHA-256 `0870E95A5D53650EBE2F4C631C607166B4A7E96AD1650BC0413E944C94B7FE3B`.
- Portable ZIP: `release/.phase6a-work/phase6f4d-20261014/WebTools-Phase6F4D-Configuration.zip`; 237,671,868 bytes; SHA-256 `1C4273E7FFB03913BC8427DD3E25F3FDB8CFCBFF7C9B5E64F80AC7FF89F4A80E`.
- Staged executables: `stage/application/WebTools.NativeHost.exe` (SHA-256 `F920539C3A119E943CF9CB12F17549F30FBE311FC4959F60DB01DA272375AB3E`) and `stage/application/Manager/WebTools.exe` (SHA-256 `B52D03C18A0FB61A2E98A40897BA673FFCA607CA000FA0351D83BDE52B51744A`); packaged `app.asar` SHA-256 `308FFB4B7618740AB152A6D538708B75AAF8A69C3F1DD1405CE7AF74D726B8F0`.

This is a dirty-tree **preview candidate**, not a production release. It was not installed or launched, so this report makes no claims about real Manager UI/runtime acceptance, install behavior, or preservation of user data after installation.

### Task delta and Git boundary

This verification round changed only the stale SDK version assertion in `scripts/release-contract.test.mjs` and this report. Product implementation files were not changed during verification. The generated package output is under ignored `release/`. There are 272 dirty entries in the shared worktree, 0 staged entries; branch and HEAD are unchanged. No commit, push, PR, merge, tag, release, installer execution or Phase 6F-4E/6G work occurred.

**Current decision:** `PHASE 6F-4D INCOMPLETE — USER MANUAL / PACKAGED CONFIGURATION ACCEPTANCE REQUIRED`.

## 10. User-confirmed configuration smoke — 2026-10-15

The user subsequently completed the configuration workflow described in chat and reported that it worked without issues. Record this as user-reported manual evidence only; no independent machine log, package hash, PID, or test timestamp beyond the chat date was supplied.

| Manual check | Result |
|---|---|
| Runtime configuration write through Host | **USER CONFIRMED PASS**. The supplied screenshot also shows `CONFIG_WRITE_PASS` and the Host result JSON. |
| Replacing a saved value with a later value | **USER CONFIRMED PASS**. |
| Closing and reopening the runtime entry and retaining the saved value | **USER CONFIRMED PASS**. |
| Manager configuration cancel, save, navigation away/back, and Manager reopen | **USER CONFIRMED PASS**. |
| Permission-denial behavior | **NOT TESTED**. The user did not encounter a permission denial; this does not verify the denied-capability path. |
| Configuration-conflict/schema-recovery behavior | **NOT TESTED**. No conflict occurred, so conflict detection and recovery were not exercised. |

The exact preview package used for this manual run was not identified, so this evidence is not bound to a verified artifact hash. It closes only the reported positive configuration smoke path. Host install-time rejection, Web and Node allowed/denied capability cases, revocation/replacement/stale-generation handling, schema-conflict recovery, profile isolation, and packaged process lifecycle remain unverified unless separately evidenced. The Phase 6F-4D overall status therefore remains **INCOMPLETE — WINDOWS CONFIGURATION ACCEPTANCE REQUIRED**.

## 11. Configuration write failure fix and targeted packaged reacceptance — 2026-10-15

### Observed failure and correction

The user delegated the remaining negative configuration checks, then authorized fixing the failed cases and retesting. In the original preview's actual packaged Web runtime, `config.get` succeeded but the initial `config.set` returned `INTERNAL_ERROR`; stored values remained unchanged. A prior Node regrant attempt also exhibited this error. The SDK message `WebTools bridge unavailable` is a generic sanitized error, not proof that the bridge was absent.

A separate, explicitly diagnostic TEMP copy of the original `app.asar` recorded the underlying Host exception: Windows returned `EPERM` from `rename(.write-<uuid>.tmp, config.json)`. Both initial and regrant writes reproduced the error there. The diagnostic artifact is not the accepted fixed candidate. The identity of the process holding the file was not established; this report does not attribute it to antivirus or a particular application.

`ManagedFs.atomicJson` now tolerates short Windows replacement contention: only `EPERM`/`EBUSY` are retried, at most six attempts with 250 ms total scheduled waits. It retains the same flushed temporary file, never deletes the destination, and revalidates both paths and commit authority before every attempt. Persistent failure still rejects and cleans up. Real Windows file-handle tests reproduced the original rename error before the change, then verified successful replacement after release, authority revocation during retry, and bounded failure with original bytes intact.

The prior positive-reset coverage gap was in the isolated acceptance consent override, which always rejected `reset-config`. Its control file now supports a strict optional `resetConfig` boolean: omitted/false denies, and explicit true approves only the two existing fixed fixture IDs under the unchanged packaged/TEMP opt-in guards. Normal production confirmation is unchanged. The rebuilt packaged tests drive the real Manager reset action and Host store, supplying the consent outcome through this isolated test seam.

### Fresh verification

| Verification | Actual result |
|---|---|
| Real Windows atomic-replacement regressions | RED: 0/3; after fix GREEN: 3/3. No mock filesystem/rename was used. |
| Explicit isolated reset-consent regressions | RED: 5/7; after fix GREEN: 7/7. |
| `node --experimental-transform-types --test electron/plugins/managed-fs.test.mjs electron/plugins/plugin-configuration.test.mjs electron/plugins/plugin-configuration-manager.test.mjs electron/services/plugin-runtime-acceptance-options.test.mjs` | 27/27 PASS. |
| `pnpm test` | 575/575 PASS, 0 failed/cancelled/skipped; five additional regressions relative to 570. |
| `pnpm run typecheck` | PASS, exit 0. |
| `pnpm run build` | PASS, exit 0. |
| `pnpm exec electron-builder --win --dir --config.directories.output=<TEMP evidence root>/packaged` | PASS, exit 0; actual win-unpacked candidate. |
| Independent final review of this task delta | No actionable P0/P1/P2/P3 findings. |

Initial sandbox invocations of pnpm and the Windows process probe were denied before their intended checks ran. They were repeated with the authorized external process access; these setup failures are not recorded as product test failures. Existing Node experimental/module-type warnings and builder missing-author warning remain visible. NativeHost source was not changed or rebuilt; the verified original Release executable was reused.

### Actual packaged results

Both runs used the rebuilt `WebTools.exe`/`app.asar`, a real Release NativeHost, SDK-packed Web/Node fixtures, authoritative Host install validation, separate fresh TEMP profiles, unique pipes, and exact executable path/PID/creation-time process checks.

| Check | Web | Node |
|---|---|---|
| Initial allowed get and four set operations, persisted values | PASS | PASS |
| Revoke write, close active Feature, preserve bytes; regrant and read/write | PASS | PASS |
| Missing capabilities deny read/write without creating config | PASS | PASS |
| Disabled/ungranted Manager configuration, cancel/save/type checks | PASS | PASS |
| Concurrent revision conflict preserves draft and current bytes | PASS | PASS |
| Invalid configuration descriptor rejected by Host before consent | PASS | PASS |
| Incompatible schema: denied reset preserves bytes; approved reset restores defaults with exact raw-byte backup | PASS | PASS |
| Schema-v2 package replacement retains config; denied reset retains config/backup; approved reset adopts v2 defaults and replaces backup exactly | PASS | PASS |
| Configuration and backup survive Manager reopen | PASS | PASS |
| Native idle Electron=0; normal Manager close Electron=0 with Native retained | PASS | PASS |
| Final normal Native exit; exact test process count | 0 | 0 |

Web run Native PID: `13268`; Node run Native PID: `3144`. Both report `PLUGIN_CONFIGURATION_PACKAGED_ACCEPTANCE_PASS`, clean Native/probe exit codes, and no leftover exact-path test process in the final independent OS scan. The driver now hard-fails initial or regrant write errors; it no longer accepts an `INTERNAL_ERROR` as a successful allowed-capability case.

### Artifact and evidence identity

External evidence root: `C:\Users\admin\AppData\Local\Temp\WebTools-6F4D-ConfigFix-7b1b7f28abcd43acb22c8116d86b682b`.

| Artifact / evidence (relative to that root unless noted) | SHA-256 |
|---|---|
| `packaged/win-unpacked/WebTools.exe` | `1468947AE22967635EC45027D0FB7E03B1DA65BE5758C79FCA918DFBC5DA8D95` |
| `packaged/win-unpacked/resources/app.asar` | `13420AF0F4E3F254FE06C23B4B9AFB5BF7E0FD981F92A7C79255DE28463813F1` |
| Reused original Release `WebTools.NativeHost.exe` | `F920539C3A119E943CF9CB12F17549F30FBE311FC4959F60DB01DA272375AB3E` |
| `fixed-web/runtime-web-packaged-acceptance.json` | `727A18FF3914EB1287B5EAAF346F0C618D5A8FF4100B613269FFCFC44E1B29A5` |
| `fixed-node/runtime-node-packaged-acceptance.json` | `C41DE98776A1FEE7B5D4C2A17752A9AA95DB2579BB548448968BB81F1206D47E` |
| `fix-reacceptance-summary.json` | `CE8A1F59B8B5EA0025CCD1D90764D65817A176DF8FA855164AD64AE92505FF70` |

`verify-config-fixed.mjs` retains the exact TEMP-only driver; `pnpm-test.log`, `typecheck.log`, `build.log`, `manager-package.log`, and `final-process-check.json` retain command/process evidence. Original failing evidence remains in the preceding `WebTools-Phase6F4D-ConfigAcceptance-828cc57464bb4e0ea07eba9505ffa510` directory. No raw profiles, packages, or logs were added to Git.

### Scope and decision

This fix changes `electron/plugins/managed-fs.ts`, adds `electron/plugins/managed-fs.test.mjs`, narrowly updates `electron/services/plugin-runtime-acceptance.ts` and its existing options tests, and updates this report. Source/build identity remains branch `codex/shared-ai-translation-2.0`, HEAD `707c5673dff479285b34a5b441bec9d3b725c737`, with the pre-existing dirty tree preserved. The original 272 status entries become 273 solely because of the new regression file; nothing is staged.

The previously observed blocking configuration-write failure is resolved in the targeted real packaged reacceptance: **P0=0, P1=0, blocking P2=0 in this fix scope**. All cases in the table above passed. This does not turn the test seam's consent answers into independent native message-box visual/mouse acceptance. It also does not claim a new packaged Node Command run, NSIS install, or full phase closeout. Those broader historical/remaining requirements are not silently declared complete.

No Launcher/Super Panel/NativeHost, installer, Translation, AI or SecretStore code was changed. No operation targeted `D:\webtools`, the real Nook profile, real tokens, startup settings, or unrelated applications. No staging, commit, push, PR, release, new installer, or phase advancement occurred.
