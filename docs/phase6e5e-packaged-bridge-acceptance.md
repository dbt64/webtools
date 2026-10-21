# Phase 6E-5E Minimal End-to-End Packaged Acceptance

Date: 2026-10-08
Result: **PHASE 6E-5E PACKAGED ACCEPTANCE PASS**

This is bounded packaged end-to-end evidence for the Phase 6E-5 Web Plugin SDK and Bridge. It is not exhaustive security certification.

## Repository State

- Repository: `D:\SystemDefault\Desktop\HomePage`
- Branch: `codex/shared-ai-translation-2.0`
- Starting HEAD: `9335026353afb1c1f83e3e951ae841bcd26204a7`
- Ending HEAD: `9335026353afb1c1f83e3e951ae841bcd26204a7`
- Commit: none
- Push: no
- The three pre-existing Launcher files remained separate and unchanged.

## Acceptance Classification

**PACKAGED / END-TO-END / BOUNDED / REPRESENTATIVE / DETERMINISTIC**

## Packaged Artifact

The actual `electron-builder` Windows `win-unpacked` output was used. No installer was run and no installation was performed.

- Package command: `pnpm exec electron-builder --win --x64 --dir --publish never --config.directories.output="<TEMP>\manager-package"`
- Build output: `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E5E Packaged 265af1a6ce4a4e65b7095a91c0c14f6b\manager-package\win-unpacked`
- Acceptance copy with a fresh profile: `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E5E Packaged 6fd3eb780e7549a3a5b192927dd53957\manager-package\win-unpacked`
- Executable: `...\win-unpacked\WebTools.exe` (246,032,896 bytes)
- Executable SHA-256: `6c5dc1aefda0617a8459a6c8ce560bec7a29967fe28f0a20fa42945c54b6c7f9`
- `resources\app.asar` SHA-256: `fd1e2e975c84466bfbc623e8ffc2023de51236b0f00b4bc8c08c4f092b3dabb5`
- Product version: `0.1.0`; Electron: `44.4.5`; Node: `24.21.0`; electron-builder: `26.15.3`
- Isolation profile: `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E5E Packaged 6fd3eb780e7549a3a5b192927dd53957\isolated-user-data`
- Production installation touched: **no**
- `%APPDATA%\Nook` touched: **no**

The runner verified the packaged executable path, `app.asar` version, packaged Main hash, dedicated Plugin preload hash, and packaged Renderer entry. The observed Manager target loaded from `resources/app.asar/out/renderer/index.html`; the packaged Main and preload hashes matched the current build outputs. The runtime resolves its preload from `join(__dirname, '../preload/web-plugin.js')` in [web-plugin-runtime.ts](../electron/plugins/web-plugin-runtime.ts).

## Fixture

- Plugin: `org.webtools.phase6e4b.runtime-test`
- Feature IDs: `offline-demo`, `offline-demo-wasm`, `offline-demo-delayed`
- Manifest: v2
- Entry: `web/index.html`
- Network mode: `none`
- `.wtplugin` SHA-256: `f1530b02b36a0c58c192a1f835d796be689399d7ad1a6aaf7128d9c1e5b26a71`
- Validated snapshot hash: same as package hash
- SDK browser bundle SHA-256: `4d1c2d07c5bf728e982b086628e1d952ce5fbf3bed7d90ced998557526e0b277`

The runner copied the published SDK browser entry into a disposable external developer directory, bundled the fixture through Vite, and used the existing package-fixture encoder to create the archive. It did not hand-edit ZIP bytes or expose private Bridge calls in fixture source. The fixture imports only `connectWebTools()` from `@webtools/plugin-sdk/web`; the bundled graph includes the SDK `web/index.mjs`, `web/bridge-client.mjs`, and `web/protocol.mjs` modules.

The runner passed the package bytes through `validateWebPackageForRuntime()`. The packaged Main then read the fixture from the isolated TEMP path, ran the same production validator again, and passed the returned immutable snapshot to `WebPluginRuntime.open(snapshot, featureId)`. Package and snapshot hashes matched.

Machine-readable final evidence:

- JSON: `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E5E Packaged 6fd3eb780e7549a3a5b192927dd53957\evidence\phase6e5e-packaged-bridge-evidence.json`
- JSON SHA-256: `c3bf437560e2acad24fe2c35d2c76a7b15ede77f5febad6b4cd17a20bfcc0fee`
- Packaged Manager log: `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E5E Packaged 6fd3eb780e7549a3a5b192927dd53957\evidence\packaged-manager.log`
- Log SHA-256: `d5571e55de3930d30be779f544775404931c771b1611180b909fd76df7d2f08a`

## Packaged Runtime Chain

Verified in the packaged application:

- compiled production Main inside `resources/app.asar/out/main/index.js`
- dedicated Plugin preload at `resources/app.asar/out/preload/web-plugin.js`
- packaged Manager Renderer at `resources/app.asar/out/renderer/index.html`
- production `WebPluginRuntime`, `WebContentsView`, isolated non-persistent Session, and `webtools-plugin://` protocol
- actual validated Manifest v2 `.wtplugin` and browser bundle
- public `@webtools/plugin-sdk/web` READY handshake and private Bridge transport

The acceptance-only switch signal and held-ping dispatch are gated by the existing explicit acceptance launch/environment flags. Normal launches do not enable them. No SDK `request()` API or new Host capability was added.

## Scenario Results

| Scenario | Result | Evidence |
|---|---|---|
| Cold start | PASS | Packaged Main PID `19016`; exact executable/profile matched; Manager target loaded from `app.asar`. NativeHost was not started. |
| Security surface | PASS | Public SDK keys were only `onClose` and `ready`; `process`, `require`, `Buffer`, `ipcRenderer`, `electron`, and `window.desktop` were `undefined`. Private preload facade was present with only the expected internal keys; no public `request` key. |
| Safe failure | PASS | Unknown internal method returned `{ok:false,error:{code:"NOT_AVAILABLE",retryable:false}}`; raw details were absent; a following ping succeeded. |
| Cancellation | PASS | A Host-accepted ping started, AbortSignal was observed, one `CANCELLED` terminal settled, and a subsequent ping succeeded. |
| Replacement | PASS | Runtime A ping succeeded before switching. A’s origin was `c3314196b923fec62256383394c2a314`, generation 1. Runtime B used fresh origin `72967a5f6960b51b19ac0eaaa4bec20b`, generation 3, and ping succeeded. A’s WebContents target was destroyed before B use; Bridge listeners followed 1 → 0 → 1; Manager Renderer was reused; B did not inherit A’s cancellation state. |
| Manager close / process cleanup | PASS | Plugin runtime and Manager were closed through their exact DevTools targets. Packaged Main exited with code 0; all six observed exact executable/profile process identities exited; final process count was 0. No process was killed. |

The controlled fixture made no external network requests. `network.mode: none` remained in effect.

## Security Surface

| Surface | Observed value |
|---|---|
| `require` | `undefined` |
| `Buffer` | `undefined` |
| `ipcRenderer` | `undefined` |
| `electron` | `undefined` |
| `window.desktop` | `undefined` |
| `process` | `undefined` |
| Public SDK methods | `onClose`, `ready` |
| Public generic `request()` | not exposed |

The private facade is supplied by the packaged dedicated preload and is not exported as public SDK API.

## Artifact Verification

- Compiled Main SHA-256: `16b03416eaaec1abeb6a6fb75c049dfc0b770d3b07addf71f5658ca539cb7e87`
- Dedicated Plugin preload: `resources/app.asar/out/preload/web-plugin.js`
- Dedicated Plugin preload SHA-256: `f72d2efb605479dbf073f33506a93f5c6fec6d163cf450f7757334dd4280d9ea`
- Packaged Renderer: `resources/app.asar/out/renderer/index.html`
- Manager executable SHA-256: `6c5dc1aefda0617a8459a6c8ce560bec7a29967fe28f0a20fa42945c54b6c7f9`
- `app.asar` SHA-256: `fd1e2e975c84466bfbc623e8ffc2023de51236b0f00b4bc8c08c4f092b3dabb5`

The packaged Renderer target resolved under `resources/app.asar`; packaged Main and Plugin preload hashes matched the repository build outputs. No repository-source fallback was observed.

## Defects Found

No production Web Plugin Runtime, SDK, Bridge, preload, protocol, or process-cleanup defect was observed in the final packaged run.

The first acceptance-driver iterations exposed and corrected test-only issues before final PASS: Windows ASAR path lookup, Vite’s `.mjs` output naming, a post-spawn baseline race, selecting a target list instead of its matching target, unreliable GUI-process stdin signaling, and a JSON assertion that compared omitted `undefined` fields. The driver now reads ASAR entries by validated header offsets and SHA-256, triggers replacement through a marker file in the isolated profile, and begins exact process capture before waiting for DevTools. These corrections did not alter product behavior outside the explicit acceptance-only gates.

## Validation

- `node --check scripts/verify-phase6e5e-packaged-bridge.mjs`: PASS
- Focused `web-plugin-runtime` tests: **9/9 PASS**
- `pnpm run typecheck`: PASS
- `pnpm test`: **495/495 PASS**
- `pnpm run build`: PASS
- `pnpm exec electron-builder --win --x64 --dir --publish never ...`: PASS; actual Windows `win-unpacked` produced
- Packaged acceptance runner: PASS
- NativeHost checks: not run; NativeHost code was not part of this phase’s acceptance change
- `git diff --check`: see final review result

Node emitted existing module-type/experimental warnings during tests; no test failed or was skipped.

## Production Safety

- `D:\webtools`: untouched
- `%APPDATA%\Nook`: untouched; acceptance used only the isolated TEMP profile
- Launcher files remained untouched. Their final SHA-256 values matched the starting values:
  - `native/WebTools.NativeHost.Checks/Program.cs`: `1e0f46fa219277a061d5234e1ec103120b63e5ded0ae1335ba6f4ee99aac9d0`
  - `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`: `ea2f84f917603fa6ce3d61dfff0267e45ee7da89973ebae0a24dc1f4a73521fd`
  - `docs/bugfix-launcher-app-search-after-autostart.md`: `b5fb3af4f618d927275ed3d3c07accc8f06fe55480902dcf0d2a0baba1e2bba8`

## Scope Boundaries and Limitations

- Normal persisted Manifest v2 installation/grant acceptance: **not included**
- New Host capability: **not added**
- Exhaustive security certification: **not performed**
- Gate 4: **NOT CERTIFIED**
- `network.mode:domains`: **UNSUPPORTED**
- Marketplace, performance, and long-running acceptance: **not performed**
- Phase 6E-6: **NOT STARTED**
- Phase 6E-7: **NOT STARTED**

## Git Status

The Phase 6E-5E source, focused test, acceptance driver, and this report remain unstaged and uncommitted. The three unrelated Launcher changes remain separate and uncommitted. No commit, push, installer, or release was created.

## Severity Summary

- P0: 0
- P1: 0
- Blocking P2: 0
- Non-blocking P2: 0
- P3: 0 open

## Recommendation

**PHASE 6E-5E PACKAGED ACCEPTANCE PASS**
**PHASE 6E-5 READY FOR FINAL CHECKPOINT REVIEW**
**PHASE 6E-6 NOT STARTED**
**NO COMMIT / NO PUSH**
