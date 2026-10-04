# WebTools — Phase 5H Plugin SDK, Tooling and Example Plugin

Date: 2026-10-05 (Asia/Hong_Kong)

## Status

Phase 5H implementation and automated/package acceptance are complete. No Phase 5I work was started. The SDK is a local package/tarball and has not been published. Native file picker and real Windows consent-dialog interaction remain untested; they are explicitly separated from the isolated packaged smoke.

## Source and Contract Audit

- Baseline: `bc2b429808bdd91c8414cb39f85572bfd591c97c` (`feat: migrate Translation into built-in plugin lifecycle`), branch `codex/shared-ai-translation-2.0`; `origin/codex/shared-ai-translation-2.0` was synchronized at H0.
- Host contract: Manifest v1, API major 1, and `type: declarative-manager` only. Root/child records are closed. Capabilities are manager page, plugin config/storage read/write, HTTPS external open, clipboard write and reviewed Shared AI completion. Pages render only the fixed host block union.
- The parser additionally enforces strict UTF-8/JSON, duplicate and prototype-key rejection, nested bounds, version compatibility, IDs, defaults and cross-references. Those semantic rules are not reducible to JSON Schema shape checks.
- Package validation additionally checks ZIP central/local metadata, CRC, compression and expanded-size bounds, safe declared path membership, duplicate/case/NFC collisions and bounded PNG content. The host PNG decoder and Main-owned install/permission flow remain later checks.
- New third-party packages remain local unsigned packages. The Main-owned picker, `PluginManager`, host consent, grants, runtime actions and private `PluginStore` remain authoritative. No new JavaScript/Vue/HTML execution, Node/Electron/filesystem API, SecretStore access, built-in registration or arbitrary IPC was added.

At baseline, authors had no independently installable SDK types/schema, standalone validator/packer or external author workflow. The host ZIP validator compared paths case-insensitively but did not normalize Unicode NFC before collision checks; the new canonical runtime rejects those ambiguous names while retaining the existing valid v1 archive format and validation quotas.

## Implementation

- Added standalone private `@webtools/plugin-sdk@1.0.0` with `pnpm@9.15.9`, exact existing `yauzl@3.4.0`, author TypeScript types, JSON Schema, canonical manifest/PNG/ZIP validator, CLI, deterministic packer and package README. No root dependency, workspace, monorepo or external runtime dependency was added.
- Electron's manifest, PNG and package-validator modules are typed adapters over that canonical runtime. Host error-code behavior and existing call signatures are retained.
- The CLI reads only the manifest and declared PNGs. It validates source/archive with host rules, reports safe relative diagnostics, rejects credential-like content, writes a deterministic `.wtplugin` without overwriting an existing output, then re-reads and revalidates the final bytes.
- Added the standalone `Private Notes` sample using only `manager.page` and plugin-private storage read/write. It contains no executable plugin code, network action, Shared AI request, secret or bundled asset.
- Added the external pnpm author workflow, security/compatibility tests and isolated packaged Windows smoke. The H9 smoke consumes the SDK-generated sample and writes its report outside the repository.

## Verification

### Independent SDK / author workflow

- Result: **PASS**, latest evidence at `D:\系统缓存\webtools-phase5h-sdk-workflow-Sc3qYv\workflow-report.json`.
- Source commit used as base: `bc2b429808bdd91c8414cb39f85572bfd591c97c`; working-tree changes were included in the built SDK.
- Node: `v24.21.0`; pnpm: `9.15.9`.
- SDK tarball after review fixes: `webtools-plugin-sdk-1.0.0.tgz`, SHA-256 `29b609f4e9a482bee6cbabd764416e53e009e76175e7f2c80448e04fdd3228f5`.
- A separate project outside the checkout installed the tarball, completed a frozen pnpm install, typechecked the example through the published SDK package name, validated its source, packed it and validated the resulting archive.
- Generated `private-notes.wtplugin`: 618 bytes, SHA-256 `88ee02383a13794c3651843e0c66cfbe040b88cbac03766d0a4087222e383710`; accepted by both SDK validator and Electron host adapter.
- The public guide and example README commands were run in separate temporary author projects with the SDK tarball installed. Their typecheck, source validation, pack and archive validation commands passed.
- Two generic existing host v1 fixtures (one without assets and one with a bounded PNG) passed the host adapter, SDK validator and CLI. No archived historical 5C/5D `.wtplugin` file was available or claimed as tested.

### Isolated packaged Windows smoke

- Result: **PASS**, report: `D:\系统缓存\WebTools Phase5H Acceptance Final2 20261005\phase5h-plugin-smoke-report.json`.
- Source base HEAD: `bc2b429808bdd91c8414cb39f85572bfd591c97c`; report marks `dirtySource: true` because this was a Phase 5H working-tree build.
- NativeHost Release source: `D:\System default\Desktop\HomePage\release\phase5h-native-20261005`; copied to the unique report root `D:\系统缓存\WebTools Phase5H Acceptance Final2 20261005\Native\WebTools.NativeHost.exe`.
- Manager build: `D:\系统缓存\WebTools Phase5H Acceptance 20261005\manager-build\win-unpacked\WebTools.exe` with `resources\app.asar`; produced with `pnpm exec electron-builder --win --x64 --dir`.
- Package input: `D:\系统缓存\WebTools Phase5H Acceptance Final2 20261005\private-notes.wtplugin`, SHA-256 `88ee02383a13794c3651843e0c66cfbe040b88cbac03766d0a4087222e383710`.
- Native-only checkpoint: isolated NativeHost PID `29676`, Electron group `0`.
- Manager open: one Electron Main with one renderer and GPU/Utility children, parented to that NativeHost. Plugin metadata, requested/granted storage capabilities and host trust presentation matched the generated manifest. Packaged UI wrote and read a private note, and disable/re-enable removed/restored the plugin navigation entry.
- Translation page and AI provider-descriptor/provider-info IPC remained available. No connection check, provider completion, translation request or paid AI call was made.
- Ordinary Manager close returned Electron to zero while NativeHost remained. Manager reopened under a new Main PID and restored the enabled sample. A second normal close again returned Electron to zero; identity-checked isolated NativeHost shutdown left no test processes.
- Uninstall semantics were exercised against the actual `PluginManager` in that isolated profile with test-only consent: declining delete-data retained the note; reinstall could read it; accepting delete-data removed it.
- The package install was seeded through the real `PluginManager` contract with a clearly recorded test consent because the native picker/consent dialogs are not automated by this smoke. The production picker path was source-reviewed, but native file selection, native dialogs, physical mouse/keyboard interaction and normal NSIS installation were **NOT TESTED**.

### Automated regression

- `pnpm run typecheck` — PASS.
- `pnpm test` — **262/262 PASS**. The runner emitted a transient WebSocket-port-in-use warning during one otherwise passing test; no listener remained afterward and no test failed.
- `pnpm run build` — PASS (Electron Main, preload and Vue renderer production bundles).
- NativeHost Checks — **55/55 PASS**.
- UpdateHelper Checks — **10/10 PASS**.
- `pnpm exec electron-builder --win --x64 --dir --config.directories.output="D:\系统缓存\WebTools Phase5H Acceptance 20261005\manager-build"` — PASS; isolated Windows `win-unpacked` Manager used by H9.
- NativeHost Release publish (`dotnet publish ... -c Release -r win-x64 --self-contained true`) — PASS; isolated source under `release/phase5h-native-20261005`.
- H9 runner, extended smoke runner and SDK runtime/CLI modules passed Node syntax checks; isolated runner path guard tests passed.
- H7/author documentation commands — PASS as described above.
- `git diff --check` and final independent review are recorded after this draft is completed.

## Security and Compatibility Findings

- P0: 0.
- P1: 0.
- Blocking P2: 0 after final review fixes. Credential-like content is rejected by both source and archive `validate` paths, and temporary cleanup verifies the inode/device identity before unlinking.
- P3: one non-blocking test-output warning: transient WebSocket port conflict from `pnpm test`; the current 264-test run passed and no listener remained after the run.
- No root `package.json` or lockfile change, new dependency, product UI feature, user data migration or privilege expansion was made. Only the existing host validator implementation was moved behind the SDK-owned pure runtime and thin typed adapters.

## Evidence and Data Protection

All H7/H9 profiles, archives, SDK tarballs and JSON evidence were created under `D:\系统缓存` (Node TEMP) or the ignored repository `release` build directory, not under `D:\webtools` or `%APPDATA%\Nook`. The smoke uses a unique Native pipe, exact temporary executable paths, PIDs and creation times; it never enumerates or terminates processes by product name. No real credentials, startup/registry settings, Favorites, SecretStore, production plugins or unrelated application processes were used or changed. Generated packages, tarballs, build output and process reports are not intended for Git.

## Review / Git Closeout

Independent final review found two actionable P2 issues; both were fixed test-first and the focused tests passed. It also noted that the SDK CLI's `pack` success row prints the resolved absolute output path although the implementation plan asked for a relative output path. This remains a deferred minor diagnostic difference; it does not expose source internals or secrets. Existing 5C/5D fixture-generator packages pass the host adapter, SDK validator, and CLI. No archived historical `.wtplugin` binary was present, so no claim is made about testing a separate archived binary.

P0: 0; P1: 0; blocking P2: 0; deferred minor: 1. The reviewed changes remain limited to the approved Phase 5H SDK/runtime adapter, tests, example, workflow, and documentation files. The approved checkpoint target is a single Phase 5H commit on `codex/shared-ai-translation-2.0`, pushed normally to its existing upstream; no PR, merge, tag, release or Phase 5I work is part of this checkpoint.

## Final Verification Re-run — 2026-10-05

All commands below were executed in this final closeout turn against the Phase 5H working tree:

- `pnpm run typecheck` — PASS.
- `pnpm test` — 264/264 PASS (0 failures; Node emitted existing `MODULE_TYPELESS_PACKAGE_JSON` performance warnings for TypeScript modules).
- `pnpm run build` — PASS (Electron Main, preload, and Vue Renderer).
- `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj -c Release` — 55/55 PASS.
- `dotnet run --project native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj -c Release` — 10/10 PASS.
- `node --check` — 19 Phase 5H SDK/runtime/CLI/smoke modules PASS.
- Independent author workflow rerun after review fixes — PASS. Evidence: `D:\系统缓存\webtools-phase5h-sdk-workflow-Sc3qYv\workflow-report.json`; SDK tarball SHA-256 `29b609f4e9a482bee6cbabd764416e53e009e76175e7f2c80448e04fdd3228f5`; generated plugin SHA-256 remains `88ee02383a13794c3651843e0c66cfbe040b88cbac03766d0a4087222e383710`. Both existing fixture-generator package variants were accepted by the host adapter, SDK validator, and CLI.
- `pnpm run package:win` — PASS. Installer: `D:\System default\Desktop\HomePage\release\native-production-20261005-011308\WebTools-Setup-0.1.0.exe`, size 191,430,169 bytes, SHA-256 `5921476B91CBEA0B93FDF4010A693BFFA10193E9186701B6D642AC4A025D06C8`. The script completed its isolated Unicode/space-path installation, Manager discovery check, and self-uninstall. The local installer is unsigned (`Get-AuthenticodeSignature`: `NotSigned`); this is a test build, not a published release.
- Focused review-fix tests — PASS: CLI and packer suites, 10/10. They cover rejecting credential-like content in source and archive inputs and preserving a replacement file when cleanup no longer owns the temp-file identity.
- Isolated packaged Manager/NativeHost smoke rerun — `PACKAGED PHASE 5H SDK PLUGIN / MANAGER LIFECYCLE PASS`. Evidence: `D:\系统缓存\WebTools Phase5H Final Smoke 118f74c81b6c4ed18c5246bfd6b67110\phase5h-plugin-smoke-report.json`. It used the same source base (`bc2b429808bdd91c8414cb39f85572bfd591c97c`) and the same NativeHost, Manager, and app.asar hashes recorded above. NativeHost-only Electron count was 0 (NativeHost PID 23296); Manager Main PID 27664 opened, normal close returned Electron to 0, reopen PID 27796 restored the plugin, second normal close returned Electron to 0, and the isolated NativeHost exited with code 0. Final process checkpoint was empty. Test profile, package, and report remained under the unique `D:\系统缓存` root.
- `git diff --check` and `git diff --cached --check` — PASS after review-fix and closeout documentation updates.

The H9 packaged smoke uses programmatic DOM and test-only consent in a disposable profile. Physical mouse/keyboard operation and native file picker/consent dialogs remain `NOT TESTED`. The separate `package:win` step did exercise a real NSIS silent install, exact Manager-path discovery, and self-uninstall in its disposable smoke directory; it did not exercise interactive installation UI or modify the user's production installation.
