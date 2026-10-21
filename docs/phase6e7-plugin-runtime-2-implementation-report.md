# Phase 6E-7 — Plugin Runtime 2.0 Production Implementation Report

Date: 2026-10-09

Repository: `D:\SystemDefault\Desktop\HomePage`

Branch: `codex/shared-ai-translation-2.0`

Source HEAD used for implementation and packaged acceptance: `707c5673dff479285b34a5b441bec9d3b725c737`

## Result

**Phase 6E-7 implementation and isolated Windows packaged-runtime acceptance: PASS.** The real NativeHost launched the real packaged Electron Manager on demand, and the packaged fixtures exercised the new Web and Node runtime paths. Manager close returned the Electron process count to zero while NativeHost remained alive.

This is an implementation/acceptance result for the isolated `win-unpacked` candidate. It is not a signed production release, an NSIS installer upgrade test, or a public plugin marketplace certification. Phase 6E-8 was not started. No commit, push, PR, merge, tag, or release was created.

The working tree was already dirty. This task preserved that work and the old `undefined/` package residue; it did not reset, clean, or stash anything. `D:\webtools` and the real `%APPDATA%\Nook` profile were not used. All Phase 6E-7 packaged scenarios used a disposable profile under `%TEMP%`.

## Implemented Runtime Architecture

### Manifest, validation, and package integrity

- Added Manifest v3 to the public SDK contract and advisory JSON schema. The contract carries plugin identity/version, API compatibility, runtime kind (`web` or `node`), feature entries, runtime-file inventory, dependency inventory, platform/architecture/Node ABI compatibility, and requested WebTools capabilities.
- The WebTools Host remains the final install-time authority. It validates archive paths, normalized/colliding names, inventory, references, dependencies, hashes, and compatibility before committing an install. Node modules, `.node`, `.exe`, `.dll`, and resources are accepted as declared runtime assets rather than rejected by file type.
- Installation is transactional. Runtime files are materialized into a staging directory and renamed only after validation. Existing materializations are checked against the validated inventory and exact resource bytes; symlinks, junctions, special nodes, undeclared files, and hash/size mismatches fail closed.
- A branded, immutable in-memory package snapshot binds manifest, package hash, inventory, and copied resource bytes. The production `webtools-plugin:` protocol serves only resources from that validated snapshot. Node preload loading rechecks the preload hash and canonical package containment before requiring it.
- The SDK packer is a developer preflight tool; Host validation remains authoritative. Existing declarative v1 support remains. The old Web Manifest v2 contract is a breaking migration and Web packages must be repacked as v3; no automatic v2 conversion was added.

### Web and Node runtime separation

- Web features run in a Manager-owned `WebContentsView` with `nodeIntegration: false`, context isolation, web security enabled, no webview tag, and a typed bridge. The plugin page receives no `process`, `window.process`, or `window.require`.
- Node features use a separate Node-capable preload. A Main-generated descriptor binds plugin id, package hash, exact preload path/hash, per-plugin local-data path, and runtime generation. The Node preload is required only after descriptor validation; Node is available to that preload without enabling Node integration in the page world.
- Runtime activation verifies current enabled package/version/hash and runtime generation. The runtime is closed/replaced on lifecycle changes; no runtime pool or background plugin service was added.
- Runtime files include dependency trees and declared helper/native resources. Package dependencies preserve nested and scoped package paths; normal CommonJS, JSON, package exports, Electron-compatible `.node` assets, and bundled helper executables are supported subject to the target Windows architecture and Electron Node ABI.

### Session, origin, networking, storage, Workers, and WASM

- Web features use the persistent plugin Session and a stable per-plugin `webtools-plugin://` origin. Different plugin ids map to distinct origins, separating browser storage while preserving a plugin's storage across Manager restarts and package updates.
- Runtime 2.0 restores Chromium networking: standard `fetch`, XHR, Axios, HTTP/HTTPS, WebSocket, EventSource/SSE, CORS, and TLS. Node networking uses Node APIs and is not subject to browser CORS. The production path does not use a WebTools fetch wrapper, `network.mode: none`, domain allowlisting, forced proxy, or cancel-all `webRequest` policy.
- The v3 CSP permits packaged code, normal styles, HTTP(S)/WS(S) connections, local assets, workers, Blob, and WASM. It does not authorize remote script sources; runtime executable code is expected to be shipped and validated in the plugin package.
- Dedicated and Module Workers, WebAssembly, Blob URLs, and modern CSS were exercised in the packaged Vanilla fixture. Vue, React, and Svelte fixtures also rendered in the packaged Manager and completed a CORS fetch.
- Plugin Local Data is stored per plugin under the isolated profile and exposed to Node preload through its dedicated data path. PluginStore remains separately available through the typed Host API. Upgrade preserves plugin local data and Web storage; uninstall with delete-data removes the package/local data and clears the tested browser stores.

### Host API, consent, permissions, and trust boundaries

- Main owns PluginStore, Shared AI calls, clipboard, context, consent, runtime identity, and capability revocation. Plugin APIs return bounded operation results; no raw Shared AI provider token or SecretStore API is exposed.
- Node plugin attempts to call a Manager-only settings IPC route are rejected by sender authorization (`UNAUTHORIZED_MANAGER_IPC`). Plugin renderer access to arbitrary Main services is not granted by Node availability.
- Downloads initiated by the active v3 plugin are paused and require a user-selected save path. Notifications require a user prompt. Clipboard browser permissions require the corresponding current capability and a focused, recent user gesture. Unrecognized browser permissions are denied.
- Node runtime activation and version changes that alter runtime trust require explicit confirmation. A Node plugin can use its granted runtime's Node APIs and execute code with the current Windows user's authority; it is not an OS-level low-integrity sandbox. This is a trust consequence of the approved desktop-plugin capability model and must remain clear in install UX.

### IPC and NativeHost pipe authentication

- Manager IPC handlers now authorize sender WebContents against the expected Manager role before invoking private services. Web Plugin bridge routes have separate identity/generation/capability checks and cannot inherit Manager IPC authority merely by running in a Manager-owned process tree.
- NativeHost obtains the pipe peer PID using Windows `GetNamedPipeClientProcessId`, then binds requests to the current launched Manager identity: PID, process creation time, executable image, and launch generation. The `hello.processId` must match the OS-observed pipe PID; current identity is rechecked before operations.
- Packaged Manager requires the exact launched Manager process. Development mode additionally requires membership in the retained launch Job, the expected Electron image, and a 256-bit random handshake token verified in constant time. NativeHost removes the pipe name/token from Main's environment before creating windows. Targeted NativeHost checks exercise forged/stale identities, hello PID mismatch, wrong/missing development token, and operation/session replacement.

### Gate 4 and migration contract

The previous Gate 4 report remains historically `INCONCLUSIVE / NOT CERTIFIED`; it was not rewritten as PASS. Per the approved Runtime 2.0 product direction, Gate 4 is no longer a release gate for normal trusted plugins. Normal v3 Web networking uses Chromium behavior; the former `network.mode`, `network.domains`, and WASM capability-declaration contract is not carried forward into v3. This does not claim that network egress is sandboxed: Node plugins can use Node networking and child processes with the current user authority.

## Files Changed

The tracked diff at review time was 65 files, 1,467 insertions and 405 deletions. The implementation files are grouped below; full per-file changes are available in the current unstaged Git diff.

### Main, IPC, and runtime implementation

- `electron.vite.config.ts`, `electron/main.ts`
- `electron/ipc/builtin-translation-handoff-handlers.ts`, `electron/ipc/everything-handlers.ts`, `electron/ipc/plugin-catalog-handlers.ts`, `electron/ipc/plugin-handlers.ts`, `electron/ipc/settings-handlers.ts`, `electron/ipc/translation-handlers.ts`, `electron/ipc/website-handlers.ts`, `electron/ipc/window-handlers.ts`, `electron/ipc/window-security.ts`
- `electron/plugins/electron-plugin-host.ts`, `electron/plugins/fixtures.mjs`, `electron/plugins/managed-fs.ts`, `electron/plugins/package-validator.ts`, `electron/plugins/permission-broker.ts`, `electron/plugins/plugin-catalog.ts`, `electron/plugins/plugin-consent-view.ts`, `electron/plugins/plugin-manager.ts`, `electron/plugins/plugin-registry.ts`, `electron/plugins/web-feature-authority.ts`, `electron/plugins/web-plugin-bridge-routes.ts`, `electron/plugins/web-plugin-bridge.ts`, `electron/plugins/web-plugin-runtime.ts`, `electron/plugins/web-runtime-policy.ts`
- `electron/services/native-manager-client.ts`, `electron/web-plugin-preload.ts`
- New: `electron/ipc/manager-ipc-authorization.test.mjs`, `electron/node-web-plugin-preload.ts`, `electron/plugins/manifest-v3.ts`, `electron/plugins/node-plugin-preload-bootstrap.ts`, `electron/plugins/node-plugin-preload-bootstrap.test.mjs`, `electron/plugins/phase6e7-acceptance-trace.ts`, `electron/plugins/plugin-package-installer.ts`, `electron/plugins/plugin-package-installer.test.mjs`, `electron/plugins/validated-plugin-package-snapshot.ts`, `electron/plugins/web-plugin-preload-registration.ts`, `electron/plugins/web-plugin-preload-registration.test.mjs`, `electron/services/plugin-runtime-acceptance-options.ts`, `electron/services/plugin-runtime-acceptance-options.test.mjs`, `electron/services/plugin-runtime-acceptance.ts`

### SDK, plugin UI, and package contract

- `package.json`, `src/shared/plugin-contracts.ts`, `src/features/plugins/PluginManagerView.vue`
- `plugin-sdk/declarative-v1/README.md`, `plugin-sdk/declarative-v1/index.mjs`, `plugin-sdk/declarative-v1/package.json`, `plugin-sdk/declarative-v1/src/cli.mjs`, `plugin-sdk/declarative-v1/src/create.mjs`, `plugin-sdk/declarative-v1/src/diagnostics.mjs`, `plugin-sdk/declarative-v1/types.d.ts`
- New: `plugin-sdk/declarative-v1/manifest.schema.v3.json`, `plugin-sdk/declarative-v1/src/pack-v3.mjs`, `plugin-sdk/declarative-v1/runtime-v3/`, `plugin-sdk/runtime-v3/`
- `docs/README.md`, `docs/plugin-development.md`, `docs/release-build.md`

### Tests, build support, and acceptance

- Updated focused tests: `electron/plugins/plugin-catalog.test.mjs`, `electron/plugins/plugin-manager.test.mjs`, `electron/plugins/plugin-store.test.mjs`, `electron/plugins/web-host-capabilities.test.mjs`, `electron/plugins/web-plugin-authority.test.mjs`, `electron/plugins/web-plugin-runtime.test.mjs`, `electron/plugins/web-runtime-policy.test.mjs`, `electron/services/native-manager-client.test.mjs`, `src/features/plugins/plugin-manager-view.test.mjs`, `tests/phase4f-native-first-architecture.test.mjs`
- Updated SDK compatibility tests/workflow: `plugin-sdk/declarative-v1/tests/cli.test.mjs`, `plugin-sdk/declarative-v1/tests/create.test.mjs`, `plugin-sdk/declarative-v1/tests/inspect.test.mjs`, `plugin-sdk/declarative-v1/tests/public-api.test.mjs`, `plugin-sdk/declarative-v1/tests/public-api.typecheck.ts`, `scripts/release-contract.test.mjs`, `scripts/verify-phase6b-sdk-workflow.mjs`, `scripts/verify-phase6b-sdk-workflow.test.mjs`
- New: `plugin-sdk/declarative-v1/tests/external-tarball-workflow.test.mjs`, `plugin-sdk/declarative-v1/tests/pack-v3.test.mjs`, `scripts/build-sandbox-preload.mjs`, `scripts/prepare-phase6e7-runtime-fixtures.mjs`, `scripts/verify-phase6e7-runtime-packaged.mjs`, `electron.def`
- Native identity coverage: `native/WebTools.NativeHost/Services/ManagerPeerIdentity.cs`, `native/WebTools.NativeHost/Services/ManagerProcessLauncher.cs`, `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs`, `native/WebTools.NativeHost.Checks/Phase6D5Checks.cs`

The following dirty paths were protected and not changed by this implementation: `native/WebTools.NativeHost.Checks/Program.cs`, `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`, and `docs/bugfix-launcher-app-search-after-autostart.md`. Their current SHA-256 values match the pre-implementation preservation values recorded for this task. The existing `undefined/manager-package/win-unpacked/resources/app.asar` residue was also preserved with its original size and hash. The three prior Phase 6E-7 research/alignment documents remain separate from this implementation report.

## Automated Regression and Build Results

| Command / check | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — 582/582 |
| `pnpm run build` | PASS — Electron Main, both preloads, and Vue Renderer built |
| Focused `electron/plugins/web-plugin-runtime.test.mjs` | PASS — 14/14 |
| Focused `electron/plugins/plugin-store.test.mjs` | PASS — 9/9 |
| NativeHost Checks (`dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release`) | PASS — 72/72 (rerun for closeout) |
| UpdateHelper Checks (`dotnet run --project native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj --configuration Release`) | PASS — 10/10 (rerun for closeout) |
| `node --check scripts/verify-phase6e7-runtime-packaged.mjs` | PASS |
| NativeHost self-contained Release `win-x64` publish | PASS |
| `pnpm exec electron-builder --win dir --x64 --publish never ...` | PASS — produced actual packaged `win-unpacked` Manager; no NSIS installer was produced |
| `git diff --check` | PASS (exit 0; Git emitted only LF-to-CRLF working-copy notices) |

Full Node tests, typecheck, and build were run after the final bridge-race fix. NativeHost and UpdateHelper checks were rerun during this closeout. No test or build result is inferred from package size.

## Real Packaged Acceptance — Run 21

Machine-readable raw result:

`C:\Users\admin\AppData\Local\Temp\W6E7Acceptance21_20261009\phase6e7-packaged-acceptance.json`

SHA-256: `65B914C065B658733FF0C486F441B160ABB9FDE0AFFD04DE46C84298FDDD10D2`

The acceptance used the real self-contained Release NativeHost, a real `electron-builder` packaged Manager (`WebTools.exe` + `app.asar`), Host-validated `.wtplugin` fixtures, the production custom protocol/Session, and the production `WebContentsView`. The isolated root, pipe, loopback sinks, and profile were under `%TEMP%`.

| Artifact | Path | SHA-256 |
|---|---|---|
| NativeHost | `C:\Users\admin\AppData\Local\Temp\W6E7Native20261009B\WebTools.NativeHost.exe` | `6B34A7E78D1FC006C84DEDF431056EE2EB0520B4118CC3138E931AD02C5EFADF` |
| Manager | `C:\Users\admin\AppData\Local\Temp\W6E7Manager20261009I\win-unpacked\WebTools.exe` | `461162F9C933E3E79A5E7A5372DA6A8C99FAA046E6CA567A8E6E008835C0BC5F` |
| `app.asar` | `C:\Users\admin\AppData\Local\Temp\W6E7Manager20261009I\win-unpacked\resources\app.asar` | `3ED0ABAC96301DE8F4B23EEEE487C2F504778F455CBF19F3D8522BD44A2FC50E` |

Acceptance identity: repository source HEAD `707c5673dff479285b34a5b441bec9d3b725c737`; branch `codex/shared-ai-translation-2.0`; NativeHost PID `23068` remained the same through the run. Versions reported by the packaged runtime: Electron `44.4.5`, Node `24.21.0`, Chromium `152.0.7977.130`.

The validated fixture packages were isolated from the repository and real user profile:

| Fixture | Size | SHA-256 |
|---|---:|---|
| `phase6e7-runtime-fixture.wtplugin` | 1,392,367 bytes | `AD4F60ADC47BC579827FA6D1548A6901C9C9D0B97EF828B2FA0156ADEBC5936D` |
| `phase6e7-runtime-update.wtplugin` | 1,392,369 bytes | `1D3DC11E935D95379098A5A815B9B8FCE1236AB177DB159580842DE7DF061CF1` |
| `phase6e7-runtime-isolation.wtplugin` | 24,177 bytes | `16F06B05688205837312D76603223671D8964DCCB03EDEE67861ECCCA14C8C4D` |

### Acceptance matrix

- **Native-only startup:** one isolated NativeHost; Electron count `0` before Manager launch.
- **Web feature:** packaged fetch, XHR, Axios, CORS allow/deny, SSE, WebSocket, Dedicated Worker, Module Worker, WASM, Blob URL, package-local assets, modern CSS, and HTTPS/TLS checks passed. The controlled sinks recorded 39 HTTP requests and 3 socket connections over the complete scenario set.
- **Frameworks:** Vanilla checks passed; Vue, React, and Svelte each rendered in the packaged runtime and completed the controlled CORS fetch.
- **Node feature:** actual packaged preload used Node built-ins (`fs`, `path`, `os`, `crypto`, `buffer`, `stream`, `http`, `https`, `net`, `child_process`), Axios, `yauzl`, nested dependency, CommonJS and JSON; a scoped native addon returned `native-addon-loaded`; the bundled Windows helper returned `phase6e7-helper:acceptance`.
- **Page isolation and Host API:** page world had no Node globals; PluginStore, mock Shared AI, clipboard, context, and plugin-local-data checks passed. Direct `settings:get` from the Node plugin preload was rejected. No real AI provider or secret was configured or read.
- **Persistence:** localStorage, IndexedDB, PluginStore, stable origin, and Node local data survived Manager restart. Upgrade to fixture version `2.0.0` preserved the stable origin and data after explicit Node upgrade confirmation.
- **Cross-plugin isolation:** the second plugin had a different origin and observed no first plugin localStorage, IndexedDB, or PluginStore value.
- **Uninstall:** package and plugin-local data were removed; reinstall observed empty browser storage.
- **Lifecycle:** Manager launched on demand, reused the isolated NativeHost, and normal close returned Electron count to `0` twice. NativeHost remained alive until explicit test cleanup; final cleanup reached NativeHost `0`, Electron `0`. No acceptance path process remained after the script.
- **Data safety:** test profile and data were under `C:\Users\admin\AppData\Local\Temp\W6E7Acceptance21_20261009\profile`; mock-only AI was used. No real token or user profile was accessed.

## Issues Found and Fixed During This Phase

1. **Managed filesystem removal timed out on a real installed runtime tree.** A focused test showed repeated whole-path safety checks for every entry (266 full checks for a 128-file tree), and packaged Run 17 left uninstall in `stopping`. Removal now validates the root once, then checks each entry with `lstat`/`realpath`, rejects symlink/special nodes, and removes directories non-recursively. The focused store tests passed 9/9 and Run 21 completed uninstall/delete-data.
2. **Framework acceptance was incomplete.** An earlier packaged run launched only Vanilla while the fixtures contained Vue/React/Svelte. The packaged harness now opens each framework and requires its DOM marker and successful CORS fetch. Run 21 recorded all three as passing.
3. **A stale Phase 4F source-contract assertion blocked the full suite.** Updated that test to match the explicit current standalone-vs-legacy Web runtime mode; the full suite then passed.
4. **A real first-navigation race appeared in Run 20.** Chromium can invoke the authenticated preload while both reported frame URLs are temporarily empty, after the exact expected main-frame navigation has started but before the URL is committed. The runtime now accepts that empty URL only in the `LOADING` state, for the exact main frame, after the expected navigation-start event, and before document-loaded; empty URLs before navigation and after commit remain rejected. A regression test failed before the fix and passed after it. The full 582-test suite and Run 21 passed after the fix.

These earlier failures are retained in the task's temporary logs/evidence; the final report does not recast them as passes. Run 21 is the final packaged acceptance result.

## Findings and Remaining Limitations

| Severity | Count | Finding |
|---|---:|---|
| P0 | 0 | No confirmed critical defect. |
| P1 | 0 | No confirmed high-severity implementation defect. |
| Blocking P2 | 0 | No remaining blocker to the Phase 6E-7 implementation/packaged acceptance scope. |
| Non-blocking P2 | 2 | (1) Run 21 used the actual packaged `win-unpacked` Manager but did not run a final NSIS installer/upgrade or user-installed manual acceptance. (2) Runtime 2.0 has no package publisher signature/authenticity system: hashes establish package integrity/identity, not who authored it. This is acceptable for the isolated local acceptance, but a public marketplace distribution needs a separate trust/signing decision. |
| P3 | 3 | (1) Camera, microphone, geolocation, and other unrecognized browser permissions are currently denied; notifications are prompt-based and clipboard is capability/gesture-gated. (2) Embedded frames are blocked and remote script sources are not authorized; apps must bundle executable code in the validated package. (3) Node native addons must match the declared Windows architecture and Electron Node ABI. |

Gate 4 remains historically `INCONCLUSIVE / NOT CERTIFIED`, but per the approved product direction it is not a normal trusted-plugin release gate. Run 21 validated controlled browser CORS behavior and TLS, not the full historical DNS pinning, proxy, UDP/QUIC/WebRTC bypass matrix. Normal Node runtime networking is intentionally not egress-sandboxed. This report does not claim otherwise.

## Final Answers — Q1–Q27

| Question | Answer |
|---|---|
| Q1. Is Manifest v3 production usable? | **PASS for the implemented candidate and tested contract.** Host validation, install, activation, update, and packaged execution passed. This is not a final signed installer release approval. |
| Q2. Can a Web Plugin use normal fetch/XHR/Axios? | **Yes.** All three passed in the packaged Vanilla fixture. |
| Q3. Are WebSocket/SSE available? | **Yes.** Both passed against the controlled sink. |
| Q4. Are CORS/TLS Chromium-standard? | **Yes in the tested Web path.** Allowed and denied CORS cases and HTTPS/TLS passed. The Node path uses Node networking, outside browser CORS. |
| Q5. Do localStorage/IndexedDB persist across restart? | **Yes.** Both persisted across Manager restart in the same plugin origin. |
| Q6. Is browser storage isolated between plugins? | **Yes in packaged acceptance.** Different plugin origins and empty cross-plugin localStorage/IndexedDB/PluginStore observations. |
| Q7. Do Dedicated/Module Workers work? | **Yes.** Both passed in packaged Vanilla. |
| Q8. Is WASM usable without a separate declaration? | **Yes in Manifest v3.** Packaged WASM instantiated successfully; it is not a Host capability permission. |
| Q9. Can a Node Plugin preload use Node.js? | **Yes.** Packaged preload executed with Electron's Node runtime while the page world stayed Node-free. |
| Q10. Does `fs` work? | **Yes.** Real packaged Node preload read and wrote plugin-local data. Node mode is not an OS filesystem sandbox. |
| Q11. Does `child_process` work? | **Yes.** The packaged helper process executed and returned the expected output. |
| Q12. Do ordinary npm dependencies work? | **Yes.** Axios and `yauzl` loaded and executed in the packaged fixture. |
| Q13. Do nested/scoped dependencies work? | **Yes in the fixture.** A nested `pend` dependency and scoped native-addon package were materialized and executed. |
| Q14. Did a native `.node` addon execute in the packaged app? | **Yes.** It returned `native-addon-loaded` in the packaged Node preload. |
| Q15. Can a bundled executable/helper run? | **Yes.** The packaged Windows helper returned `phase6e7-helper:acceptance`. |
| Q16. Does Plugin Local Data persist through restart/upgrade? | **Yes.** Its count/path persisted through Manager restart and v1-to-v2 fixture update. |
| Q17. Does WebTools PluginStore still work? | **Yes.** Read/write and persistence passed in the packaged acceptance. |
| Q18. Is the raw Shared AI token still withheld? | **Yes.** Host API returns the mock operation result; no token getter/raw SecretStore API is exposed. Run 21 configured no real provider or secret. |
| Q19. Can the Node preload call Manager-only IPC? | **No.** The packaged direct `settings:get` probe was rejected as unauthorized. |
| Q20. Can a plugin renderer authenticate to the privileged NativeHost pipe? | **The implemented identity boundary rejects it.** NativeHost uses OS-observed pipe PID plus exact launched process identity; targeted checks cover PID/hello mismatch and stale/forged peers. Development also requires a 256-bit launch token. Run 21 did not add a separate malicious plugin pipe-client probe, so this answer is based on the production authenticator and NativeHost adversarial checks rather than that specific packaged attack attempt. |
| Q21. Does package integrity remain enforced at runtime activation? | **Yes for the validated activation path.** Installed archive hash, manifest identity, runtime inventory/materialization, and preload hash are checked before activation/use; snapshot-backed Web resources are served from validated bytes. |
| Q22. Did Vue/React/Svelte/Vanilla fixtures pass? | **Yes.** Vanilla's full API matrix passed; Vue/React/Svelte rendered and completed CORS fetches. |
| Q23. Did packaged Electron acceptance pass? | **Yes.** Run 21 status is `PACKAGED_RUNTIME_ACCEPTANCE_PASS` using the actual packaged Manager and NativeHost. |
| Q24. Does Manager close return Electron process count to zero? | **Yes.** Two normal close/reopen cycles recorded Electron `0`; NativeHost remained alive. |
| Q25. Was any resident daemon/process added? | **No.** NativeHost remains the sole resident host; Manager is on demand and the helper child is transient. No acceptance process remained after cleanup. |
| Q26. Is Gate 4 removed as a normal plugin release gate? | **Yes, per the approved Runtime 2.0 direction.** Historical Gate 4 remains `INCONCLUSIVE / NOT CERTIFIED`; it was not converted to PASS. |
| Q27. Are there remaining limitations that can reduce platform capability? | **Yes, explicitly:** no background plugin runtime when Manager is closed and only one active runtime feature at a time; no embedded frames or remote script execution; camera/microphone/geolocation and unspecified browser permissions are denied; Node native addons are ABI/architecture-specific; package publisher authenticity/signing is not implemented. Node-mode plugins otherwise have ordinary Node/npm/native/helper/network capability with the current user's authority, and standard Web networking is restored. These are concrete product/trust boundaries, not a reintroduction of the former blanket Node/network restrictions. |

## Git and Protected Work Verification

- Branch: `codex/shared-ai-translation-2.0`
- HEAD: `707c5673dff479285b34a5b441bec9d3b725c737`
- No staged changes at closeout; no commit or push.
- The tracked diff was 65 files, `1,467 insertions(+), 405 deletions(-)` before adding this report. Untracked files are not included in that Git diff statistic.
- Protected file hashes still match the recorded starting values:
  - `native/WebTools.NativeHost.Checks/Program.cs` — `1E0F46FA219277A061D5234E1EFC103120B63E5DED0AE1335BA6F4EE99AAC9D0`
  - `native/WebTools.NativeHost/Catalog/AppCatalogService.cs` — `EA2F84F917603FA6CE3D61DFFF0267E45EE7DA89973EBAE0A24DC1F4A73521FD`
  - `docs/bugfix-launcher-app-search-after-autostart.md` — `B5FB3AF4F618D927275ED3D3C07ACCC8F06FE55480902DCF0D2A0BABA1E2BBA8`
  - Preserved `undefined/manager-package/win-unpacked/resources/app.asar` — 34,634,260 bytes; `282F98E970CECBB1CFCB2203E586356CED2DA20D7E277BAB9794FB9EAABDC96D`
- Final `git diff --check`: PASS (exit 0).
- Current worktree remains dirty, with implementation changes, previously preserved Launcher/research work, the old `undefined/` residue, and this new report. No dirty work was discarded or staged.

## Phase Boundary

**Phase 6E-7 implementation and isolated packaged acceptance are complete for this task. Phase 6E-8 was not started.** Await review of the diff/report before any checkpoint or next phase.
