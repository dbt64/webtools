# Phase 6E-8 — Plugin Developer Experience 2.0

Date: 2026-10-10
Result: implementation and automated acceptance evidence recorded; no Phase 6F work started.

## 1. Repository state

- Repository root: `D:\SystemDefault\Desktop\HomePage`
- Branch: `codex/shared-ai-translation-2.0`
- Source HEAD: `707c5673dff479285b34a5b441bec9d3b725c737`
- The worktree contains pre-existing uncommitted Phase 6E-7 Runtime 2.0 work and separate Launcher changes. They were preserved. No files are staged; no commit, push, PR, tag, or release was created.
- The protected Launcher files retain their recorded SHA-256 values. `undefined/manager-package/win-unpacked/resources/app.asar` remains present at 34,634,260 bytes with its recorded SHA-256. These files were not restored or rewritten.
- Acceptance profiles, projects, packages, logs, and evidence JSON remained under `%TEMP%`; `D:\webtools` and `%APPDATA%\Nook` were not used.

## 2. SDK and CLI architecture

The public authoring package is `@webtools/plugin-sdk@1.4.0`. It provides package-root types and authoring/validation/packing APIs, `@webtools/plugin-sdk/web`, `@webtools/plugin-sdk/node`, Manifest v3 types/schema, runtime target metadata, and the `webtools-plugin` CLI. The package is versioned independently from the old repository directory name `plugin-sdk/declarative-v1`; that path is an implementation/compatibility location, not a concept plugin authors need to import.

The separate `create-webtools-plugin@1.0.0` package generates standalone projects. The conventional command is `pnpm create webtools-plugin`; this checkout distributes the SDK as a matching local `.tgz`, rather than claiming either package has been published to the public npm registry.

The SDK stays limited to WebTools-specific typed APIs. Standard browser and Node APIs remain the plugin's direct platform interfaces. Host install-time validation, package integrity checks, consent, and capability grants remain authoritative; SDK validation is a preflight only.

## 3. Project templates and developer workflow

The creator generates Vanilla, Vue, React, and Svelte projects for either `web` or `node` runtime. Projects are independent of the WebTools repository. Node projects contain `preload/`, a TypeScript CommonJS preload build, a minimal `contextBridge` example, and the public `getPluginPaths()` helper. The Node template installs the SDK as a production dependency so its preload can resolve `@webtools/plugin-sdk/node` after installation; Web projects use the SDK during frontend build.

Generated project commands:

```sh
pnpm dev
pnpm build
pnpm validate
pnpm run pack
pnpm run inspect
```

The explicit `pnpm run pack` avoids confusion with pnpm's built-in `pnpm pack`, which emits a Node package tarball.

`dev` starts a loopback Vite preview with HMR and watches source, manifest, preload, and assets to rebuild `dist/`. The running packaged Host Feature is not automatically replaced by the rebuilt output; reopening the Feature is currently required to load updated package bytes. The CLI says this explicitly. The preview can be used to iterate on frontend layout without reinstalling a plugin, but does not supply the real WebTools Host bridge. This is a documented fast-feedback limitation, not represented as in-Host HMR.

## 4. Build, validation, pack, and inspect

- `build` emits a consistent `dist/` tree. Vite builds browser assets; Node runtime builds emit CommonJS `dist/preload/index.cjs`, resource files, and a generated runtime inventory. Symlinks and unexpected paths are rejected.
- `validate` accepts source/build directories or `.wtplugin` files and emits package-relative diagnostics with code, field/path, likely cause, and next step. It checks Manifest v3 references, host compatibility, dependency graph, runtime inventory, sensitive content, path safety, native target architecture, and build-output consistency.
- `pack` materializes production, optional, and peer dependency content into a self-contained archive; it resolves pnpm virtual-store links rather than shipping development symlinks. It inventories CommonJS, package exports, nested/scoped dependencies, JSON, native `.node`, DLL/library/resource, and helper executable files. Output is deterministic where practical and is not overwritten.
- `inspect` validates without extracting or executing the archive and reports identity, Manifest/API versions, runtime, features, capabilities, compatibility, dependencies, native addons, helpers, resources, size, and SHA-256.
- Native addons are not categorically blocked. The pack/validation path checks the supported target architecture and declared Electron Node ABI where available. An AnyCPU .NET DLL is treated as managed code, not rejected as a mismatched native PE image.

## 5. Dependency, native addon, helper, and local data handling

External Node acceptance used ordinary and nested/scoped packages, package exports, CommonJS and JSON resources, `@napi-rs/canvas` native addon, an AnyCPU DLL resource, and a bundled helper executable. The packaged helper executed and returned the expected output. The final `.wtplugin` included these resources without requiring npm/pnpm on the end user's machine.

Node plugins can use ordinary Node APIs and `child_process` as local code running under the current Windows user; Host capabilities are not an OS sandbox. `getPluginPaths(preloadDirectory)` returns the installed package directory and per-plugin writable local-data directory; `WEBTOOLS_PLUGIN_DATA` is also set for Node preloads. The external acceptance confirmed local data survived a Manager restart.

## 6. Diagnostics and security boundaries

The SDK maps authoring failures to stable diagnostics rather than a bare `INVALID_MANIFEST`, including exact Manifest fields and missing build/preload references. Build/preload TypeScript and Vite failures identify the source/config location and suggested remedy. Native addon target mismatch has a specific diagnostic. Normal Host UI does not expose internal stacks.

Node preload integrity/execution failure is closed with a stable `NODE_PRELOAD_FAILED` signal; the Host does not run a hash-mismatched preload. Detailed stack capture exists only in the isolated acceptance trace. The normal Plugin Center currently does not expose a developer-only detailed runtime stack view. This remains a diagnostics limitation for Q21.

Manager IPC registrations are routed through role-checked registrars. Tests exercise rejection of plugin and subframe senders before service access, inspect the production registrations across settings, translation, plugin/catalog, website, Everything, handoff, and window handlers, and verify there are no direct `ipcMain.handle/on` bypasses in Main.

The real external Node plugin attempted the isolated privileged NativeHost Manager pipe. Its direct attempt did not connect or exchange bytes while the authenticated Manager owned the single pipe instance; the evidence records `probe-timeout`, `connected=false`, `receivedBytes=0`, and a connected/renderer-ready Manager. This is accurately a blocked connection attempt, not an authentication handshake performed by that plugin process. Separately, NativeHost checks exercise OS-observed launched-Manager peer authentication and rejection paths.

Runtime content is validated into an immutable snapshot. Runtime materialization compares the exact full inventory against validated snapshot bytes, rejects extra/missing files and unsafe junctions, and re-verifies content before activation. The Node bootstrap checks the preload hash before `require()`. Automated tests cover snapshot ownership, materialized-file tampering, undeclared content, junction redirection, and preload descriptor/hash tampering. The verifier applies to every declared runtime inventory role; tests do not separately mutate an installed `.node`, DLL, and helper file one by one.

## 7. External project and packaged acceptance

All projects were created outside the repository with the standalone creator package and local SDK tarball, then dependency-installed, typechecked/built, validated, packed, inspected, Host-validated, installed, and launched through an isolated packaged WebTools Manager. Evidence is in TEMP, not the repository.

Packaged identities:

| Runtime / framework | Acceptance evidence | `.wtplugin` SHA-256 | Result |
|---|---|---|---|
| Web / Vanilla | `%TEMP%\E8WV\phase6e8-web-packaged-acceptance.json` | `532028c01ddc037a535101711b4e30f7dcb0a7d54ee21f65fbfe6b6f28d35a3d` | PASS |
| Web / Vue | `%TEMP%\E8WU\phase6e8-web-packaged-acceptance.json` | `23df36afe6cbfadde1779891f84a5014615eb6c343b549c5c18b1bc9a949ee13` | PASS |
| Web / React | `%TEMP%\E8WR\phase6e8-web-packaged-acceptance.json` | `7f6c273e35e315a4f8bba458dc59818ca1d93c2904eb3405a4ec22b51883012b` | PASS |
| Web / Svelte | `%TEMP%\E8WS\phase6e8-web-packaged-acceptance.json` | `d334495e69887525b7476059b29a6315ee1889807c97fad4972d0e8329eb3268` | PASS |
| Node / Vanilla | `%TEMP%\E8N7\phase6e8-node-packaged-acceptance.json` | `22ddab93895daa0372d3a71188ce02718323c3bcb49706a97b3b363e40df0d78` | PASS |

The five runs used the same current source HEAD and identified isolated NativeHost/Manager binaries by executable path and SHA-256. Each started NativeHost-only with Electron count 0, started Manager on demand, closed Manager normally twice with Electron count returning to 0 each time, and finally exited the isolated NativeHost with both process counts at 0. These are isolated packaged acceptance results, not an installer/release certification.

Shared acceptance runtime identity:

- Release NativeHost: `%TEMP%\W6E7Native20261009B\WebTools.NativeHost.exe`; SHA-256 `6B34A7E78D1FC006C84DEDF431056EE2EB0520B4118CC3138E931AD02C5EFADF`.
- Packaged Manager: `%TEMP%\WebTools-Phase6E8-CurrentManager-20261010-001\win-unpacked\WebTools.exe`; SHA-256 `B975517060D59449BCEAE170258BE92287A50E204F816702BF0B52C4DE76B47D`.
- Manager `resources/app.asar`: SHA-256 `9DA001D52E6E2BF3DEE35D8A14814CFE4E35B2277C7758B69FD1F3D884FCB045`.
- SDK tarball used by external projects: 57,356 bytes; SHA-256 `132FC6B7982349A20849D27185A87889098C0202FD310EC78FF0E1D305C21BA1`.
- Creator tarball used by external projects: 7,601 bytes; SHA-256 `24F2C4EA08A11E8708EDC07A98BADBA2631E1E35DCA4B3359D2773B7C4A7D089`.
- External Node `.wtplugin`: 48,798,949 bytes; SHA-256 `22ddab93895daa0372d3a71188ce02718323c3bcb49706a97b3b363e40df0d78`.

The Node acceptance confirmed typed WebTools API readiness, plugin-owned `contextBridge` API, local data persistence, ordinary/nested/scoped dependencies, package exports, JSON resources, native addon execution, helper execution, DLL resource access, Manager IPC denial, page Node/Electron escape denial, and process cleanup.

## 8. Phase 6E-7 regression/security closeout

- Manager-only IPC role tests: PASS.
- Plugin-side privileged pipe probe: PASS for the observed blocked connection while the authenticated single Manager session was connected; no handshake bytes were sent. NativeHost OS peer-auth checks: PASS.
- Runtime snapshot/materialization and Node preload integrity tests: PASS. Scope is described above; there is no separate installed-byte mutation run for each resource category.
- The production runtime and its standard Web/Node capability model were retained. No `network.mode`, `network.domains`, `Gate 4`, `webtools.fetch`, `webtools.fs`, or `webtools.exec` API was reintroduced. Network, storage, worker, WASM, native addon, helper, and Node APIs were not removed as a DX workaround.
- No background plugin process, daemon, or second Electron host was added. The development watcher exists only while an author runs `pnpm dev`.

## 9. Automated verification

Final results for this worktree:

| Command/check | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | 595/595 PASS, 0 skipped |
| `pnpm run build` | PASS; Main, preloads, sandboxed Web Plugin preload, and Renderer built |
| NativeHost checks | 72/72 PASS |
| UpdateHelper checks | 10/10 PASS |
| `node --check scripts/verify-phase6e7-runtime-packaged.mjs` | PASS |
| External framework/Node packaged acceptance | 5/5 PASS |
| `git diff --check` / staged check | PASS; no staged files |

During development, an initial full Node run was 592/595 because three assertions still expected the old Vanilla starter, old inspect result shape, and SDK 1.3.0. The assertions were updated to the implemented outputs; the final full run above passed 595/595. External test setup also caught and fixed a Node starter SDK production-dependency omission, a stale candidate Manager binary, an incorrect test-pipe selection, and a long temporary path that prevented a helper spawn. Final acceptance used the corrected creator/SDK packages and current Manager binary. These failures were not hidden or counted as passing runs.

## 10. Remaining limitations

1. `pnpm dev` performs automatic source rebuild and browser-preview HMR, but does not replace an already-running Host Feature. Developers must reopen the Feature to load rebuilt package bytes; preview mode does not reproduce the Host bridge. This is not full in-Host hot reload.
2. Runtime preload exceptions fail closed and have a stable error signal, but the Plugin Center has no developer-only detailed runtime stack view. Full stack capture is limited to isolated acceptance diagnostics.
3. The creator and SDK are separate package artifacts and were exercised from external projects, but this task did not publish them to a public package registry. The SDK is currently supplied as a local tarball with the matching developer tools.
4. This was packaged `win-unpacked` acceptance, not final installer/NSIS release certification or Phase 6F presentation acceptance.

No known P0/P1 defect was found by the recorded tests. Limitations 1–2 are developer-experience gaps to consider before claiming the entire stated DX target is fully closed; they do not invalidate the completed external create/build/validate/pack/install/run evidence.

## 11. Files changed

Phase 6E-8 deliverables in the current dirty tree are grouped as follows:

- `plugin-sdk/create-webtools-plugin/` — standalone creator package, framework/runtime templates, creation tests.
- `plugin-sdk/declarative-v1/` — public SDK metadata/exports/types, Manifest v3 schema and runtime metadata, developer CLI, diagnostics, build/dev/pack workflow, and focused tests.
- `plugin-sdk/runtime-v3/` — public Manifest v3/package contract modules and tests.
- `electron/plugins/` and `electron/` — existing Phase 6E-7 Runtime 2.0 Host integration, Node preload and package integrity/security checks already present in this worktree and used by 6E-8 packaged acceptance.
- `scripts/verify-phase6e7-runtime-packaged.mjs` — isolated packaged acceptance scenarios and Phase 6E-8 external Node boundary evidence.
- `docs/plugin-development.md` — third-party author workflow, SDK/runtime instructions, commands, and limitations.
- Root `package.json` and focused Node test sources were updated for the SDK/CLI workflow and current package version.
- `docs/phase6e8-plugin-developer-experience-implementation-report.md` — this closeout report.

The full dirty file list is the authoritative `git status --short` output. It also contains pre-existing Phase 6E-7 and unrelated Launcher work; this report does not claim those files originated in Phase 6E-8.

## 12. Protected-work verification and final Git state

Fresh SHA-256 checks matched the historical protected values:

- `native/WebTools.NativeHost.Checks/Program.cs`: `1E0F46FA219277A061D5234E1EFC103120B63E5DED0AE1335BA6F4EE99AAC9D0`
- `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`: `EA2F84F917603FA6CE3D61DFFF0267E45EE7DA89973EBAE0A24DC1F4A73521FD`
- `docs/bugfix-launcher-app-search-after-autostart.md`: `B5FB3AF4F618D927275ED3D3C07ACCC8F06FE55480902DCF0D2A0BABA1E2BBA8`
- `undefined/manager-package/win-unpacked/resources/app.asar`: 34,634,260 bytes; `282F98E970CECBB1CFCB2203E586356CED2DA20D7E277BAB9794FB9EAABDC96D`

Final state before this report was added: branch `codex/shared-ai-translation-2.0`, HEAD `707c5673dff479285b34a5b441bec9d3b725c737`, no staged changes. Final post-report `git status --short` and `git diff --check` are reported in the task response. No cleanup or Git mutation was performed.

## 13. Q1–Q33

| ID | Answer |
|---|---|
| Q1 | Yes. External projects were created and accepted outside the repository. |
| Q2 | `pnpm create webtools-plugin` (the separate creator package is currently distributed with developer artifacts; public registry publication was not part of this task). |
| Q3 | Yes — Vanilla, Vue, React, and Svelte external Web projects all passed packaged acceptance. |
| Q4 | Yes — Web or Node is selected during project creation. |
| Q5 | Yes — SDK declarations cover public Web/Node APIs, Manifest/runtime contracts, and generated preload/page globals; TypeScript checks passed. |
| Q6 | `@webtools/plugin-sdk@1.4.0`. |
| Q7 | `pnpm dev`. |
| Q8 | Automatic rebuild and Vite HMR are supported for the loopback preview. The active Host Feature is not auto-reloaded; reopen it to load rebuilt package bytes. |
| Q9 | `pnpm build`. |
| Q10 | `pnpm validate`. |
| Q11 | `pnpm run pack` (not pnpm's built-in `pnpm pack`). |
| Q12 | `pnpm run inspect` or `webtools-plugin inspect <file.wtplugin> --host-version <version>`. |
| Q13 | Yes — declared production runtime dependencies are materialized into the package. |
| Q14 | Yes — nested/scoped packages and pnpm virtual-store layouts are materialized; symlinks are not shipped as the runtime graph. |
| Q15 | Yes — compatible native addons passed external build, pack, Host validation, and packaged execution. Architecture/ABI must match. |
| Q16 | Yes — a packaged helper executable was launched and returned the expected output. |
| Q17 | No. End users do not need Node, npm, or pnpm installed. |
| Q18 | No. Plugin authors use the public SDK and generated preload example, not the internal bootstrap implementation. |
| Q19 | `getPluginPaths(preloadDirectory)` returns `packageDirectory` and `localDataDirectory`; `WEBTOOLS_PLUGIN_DATA` is also set in a Node preload. |
| Q20 | Yes — Manifest/build/package diagnostics identify a code and field/path with cause and corrective guidance. |
| Q21 | Partial — preload integrity/execution errors fail closed with a stable error signal and safe Host status. A detailed developer-only runtime stack view is not yet exposed in Plugin Center. |
| Q22 | Yes — external project acceptance passed in isolated packaged Manager runs. |
| Q23 | Yes — Vanilla, Vue, React, and Svelte all passed. |
| Q24 | Yes — external Vanilla Node project passed. |
| Q25 | Yes — external native addon ran in the packaged Manager. |
| Q26 | Yes — external helper executable ran successfully. |
| Q27 | No regression observed in tested Runtime 2.0 capabilities; no capability/API removals were made to simplify DX. |
| Q28 | Yes — role-checked Manager IPC tests and production registration checks passed; the external Node probe was also denied on a Manager-only route. |
| Q29 | Yes, with qualification — the real plugin-side pipe attempt could not connect or exchange bytes while the authenticated Manager occupied the isolated single-instance pipe. It did not send a handshake; OS-observed peer-authentication behavior is covered by NativeHost checks. |
| Q30 | Yes for the validated snapshot/materialization invariant — generic inventory byte tampering and preload hash/descriptor tampering are rejected before use. Individual mutation was not separately run for every resource role. |
| Q31 | Yes — normal Manager closes returned Electron process count to 0 in each packaged run; NativeHost remained until explicit isolated exit. |
| Q32 | No. The watch process runs only during author-invoked `pnpm dev`; no product background daemon or second Electron host was added. |
| Q33 | No source-repository/internal-API dependency. The SDK and creator are supplied as external package artifacts. Current limitations are local artifact distribution and the explicitly documented in-Host reload/runtime-diagnostic gaps. |

**Phase boundary:** No Phase 6F, launcher redesign, marketplace, plugin presentation redesign, installer release, or production profile testing was performed.
