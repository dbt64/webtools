# Phase 6F-5 — SDK / Developer Workflow Synchronization

## Status

**PHASE 6F-5 COMPLETE**
**EXTERNAL DEVELOPER WORKFLOW ACCEPTANCE: PASS — AGENT EXECUTED AT USER REQUEST**

This phase synchronizes the reviewed Phase 6F-4D configuration and Phase 6F-4E optional theme contracts with the local SDK and starter workflow. It does not change the Host install-time validation authority, Plugin API major, Manifest version, or WebTools product version.

## Scope delivered

- Added the optional static SDK entry `@webtools/plugin-sdk/theme.css`. It consumes the Host's `--webtools-color-scheme`, `--webtools-color-text`, and `--webtools-color-background` tokens. It does not provide layout, controls, or a component library.
- Published this additive SDK surface as `@webtools/plugin-sdk` **1.6.0**.
- Updated the standalone `create-webtools-plugin` tarball to **1.1.0**. All Vanilla, Vue, React, and Svelte Web/Node starter combinations can import the optional theme stylesheet while retaining author-owned feature CSS.
- Updated current author instructions and Private Notes SDK-version references. The Host remains the final authority at installation; SDK/creator validation is developer feedback only.
- Added a focused optional-theme package test and synchronized the repository version-contract test with SDK 1.6.0.
- Updated the disposable external-author workflow runner to perform final Host validation through the packaged Electron runtime. Running the Host adapter under ordinary Node uses that Node executable's ABI, which is not the packaged Electron ABI for Node plugins.

No WebTools Host, Electron Main/Preload, Renderer, NativeHost, manifest contract, permission, or product-runtime implementation was changed specifically for Phase 6F-5. No WebTools application installer was produced.

## Package artifacts

Artifacts are in the ignored `release/phase6f5-developer-tools/` directory and are not tracked by Git.

| Artifact | Package identity | Size | SHA-256 |
|---|---|---:|---|
| `release/phase6f5-developer-tools/webtools-plugin-sdk-1.6.0.tgz` | `@webtools/plugin-sdk@1.6.0` | 65,548 bytes | `070ECFA0B898CF8C407D38B87F6148542EA2F6D04798CA13170793315895D896` |
| `release/phase6f5-developer-tools/create-webtools-plugin-1.1.0.tgz` | `create-webtools-plugin@1.1.0` | 7,977 bytes | `65B6DB9F237D4C0E7B0822A0C33729940E85DF2514CAB8F898E5599997E3A4BD` |

The archives were inspected after packing. The SDK archive includes `web/theme.css` and the `./theme.css` export. The creator archive contains its declared CLI, source, and package metadata.

## External author workflow evidence

- Toolchain: Node.js 24.21.0, pnpm 9.15.9, Electron 44.4.5.
- Packaged Electron runtime identity observed by running its executable in Node mode: `win32 / x64`, Node 24.21.0, modules ABI **149**. The SDK `runtime-target.json` declares ABI 149.
- Isolated external run root: `%TEMP%\WebTools Phase6F5 author workflow 3c1c6ad8caaf4d678d4c3bb6cf939434`.
- Both local tarballs were copied to that run's `artifacts` folder. The creator was installed from its tarball in a tooling project; generated projects installed the SDK tarball by a named `file:` dependency, with no monorepo import or workspace link.
- Matrix completed: Vanilla, Vue, React, and Svelte × Web and Node. All **8/8** projects generated, frozen-installed, typechecked, built, validated, packed, and inspected successfully.
- Final production Host validator: **8/8** generated `.wtplugin` archives accepted when run with Electron 44.4.5 / ABI 149. A malformed archive was rejected as expected.
- An earlier direct invocation of the Host validator under system Node 24.21.0 used that executable's modules ABI rather than Electron's ABI and rejected Node packages as incompatible. This was a test-driver runtime mismatch, not a plugin or product defect. The corrected Electron-runtime wrapper was syntax-checked and exercised against all eight already-generated archives.
- Focused Phase 6F-5 tests: **16/16 PASS**.

External files and packages remain outside the repository's tracked source. The disposable validation driver and logs are under the ignored release directory; generated sample projects are under the temporary run root.

### User-selected external test folder

At the user's request, the developer workflow was also executed in the dedicated folder `D:\SystemDefault\Desktop\webtoolstest`, outside the WebTools checkout. The user folder contained no pre-existing files when prepared for this run.

- Local package inputs: `artifacts\webtools-plugin-sdk-1.6.0.tgz` and `artifacts\create-webtools-plugin-1.1.0.tgz`, copied from the reviewed Phase 6F-5 package outputs. Their sizes and SHA-256 values match the package table above.
- A private tooling project installed the Creator from its local tarball. Two generated projects then installed the SDK using a named local `file:` dependency, without a workspace link or monorepo import. Frozen lockfile installation passed during setup.
- `acceptance-vue-web`: Vue + Web starter. `pnpm run typecheck`, `pnpm run build`, `pnpm run validate`, `pnpm run pack`, and `pnpm run inspect` passed.
- `acceptance-node-vanilla`: Vanilla + Node starter. The same five commands passed. The expected `NODE_LOCAL_CODE` warning states that Node plugins execute with the current Windows user's OS permissions; no elevated WebTools capability is implied.
- Host authority was rechecked against both packages by loading `electron/plugins/package-validator.ts` in the packaged Electron 44.4.5 runtime (`Node 24.21.0`, ABI 149, `win32/x64`). Both valid packages were accepted and a malformed archive was rejected.
- The existing output names already contained earlier successful packages. The packer refused to overwrite them (`OUTPUT_EXISTS`), so this recheck used new `*-recheck.wtplugin` output names; the original packages were left intact.

| External output | Size | SHA-256 | Host result |
|---|---:|---|---|
| `D:\SystemDefault\Desktop\webtoolstest\tooling\acceptance-vue-web\acceptance-vue-web-recheck.wtplugin` | 28,511 bytes | `7C2013FE942C1961FE51DB042ED5A8759E0C0B1D9CF13AF93034C277B289E575` | PASS — Web runtime |
| `D:\SystemDefault\Desktop\webtoolstest\tooling\acceptance-node-vanilla\acceptance-node-vanilla-recheck.wtplugin` | 137,755 bytes | `2698DCD8F1B027FF0E5BEA2C045EEF544F7CD3F775F5F40636E2F0EA37A373EE` | PASS — Node runtime |

This was an agent-executed external CLI/developer workflow acceptance, not a claim that the user personally performed each command. No package was installed into WebTools Plugin Center, no production installation was touched, and no WebTools user profile was used.

## Automated regression

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — 591/591 |
| `pnpm run build` | PASS — Electron Main, Preload, Renderer, and sandbox preload |
| Focused SDK/creator/external-tarball tests | PASS — 16/16 |
| PowerShell AST parse of external workflow runner | PASS |
| Electron-runtime Host validation | PASS — 8/8 valid archives; malformed archive rejected |
| `git diff --check` | PASS |

The first full `pnpm test` run reported 590/591 because `scripts/release-contract.test.mjs` still expected SDK 1.5.0. The expected value was updated to 1.6.0; the subsequent full run passed 591/591. Node emitted its existing experimental type-stripping and typeless-module warnings. A test also reported that port 24678 was already in use, but the affected test completed successfully; no Phase 6F-5 assertion failed.

## Developer Workflow acceptance

**PASS — AGENT EXECUTED IN `D:\SystemDefault\Desktop\webtoolstest` AT USER REQUEST.** The local tarball install, generated project builds, CLI validation/pack/inspect, and production Host validator were exercised as recorded above. No user-operated Plugin Center installation was part of this developer-tool acceptance and none is claimed.

## Findings and boundary

- P0: 0
- P1: 0
- Blocking P2: 0
- P2/P3: 0
- Remaining blocker: none for Phase 6F-5 acceptance.
- Product/SDK behavior changed by this external test run: none; test artifacts remain in the user-selected external directory.
- User-confirmed GUI/plugin-install acceptance: not claimed and not required by this CLI developer workflow acceptance.
- Phase 6F-5 decision: complete.
- Phase 6G: not started.
- Commit/push/release: none.
