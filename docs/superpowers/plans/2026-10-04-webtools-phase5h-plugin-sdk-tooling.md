# WebTools Phase 5H Plugin SDK & Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use tests-first for all runtime changes.

**Goal:** Ship a locally distributable, independently usable SDK/toolchain and example for the host's existing declarative `.wtplugin` v1 contract, without adding executable plugin support.

**Architecture:** Keep Manifest v1/API major 1 and the current Main-owned install/permission/runtime authority. Move the existing pure manifest, PNG and package validation rules behind an SDK-owned runtime module that both Electron Main and the standalone CLI call; ship author types and a JSON Schema beside that validator, and prove parity with the host parser. The CLI will read only `manifest.json` and its declared PNGs, make deterministic ZIP bytes, validate the finished archive with the same host validator, and install only as a local package with no overwrite by default.

**Tech Stack:** Node.js ESM, TypeScript declarations, JSON Schema 2020-12, existing `yauzl@3.4.0`, Node built-ins, pnpm, existing Electron/Vue and WPF NativeHost test harnesses.

**Spec:** User-provided `WebTools — Phase 5H：正式插件 SDK、打包工具与独立示例插件` in `C:\Users\zry\.codex\attachments\9f24a055-8999-4b30-9b36-574c4c43351c\已粘贴的文本.txt`.

## Global Constraints

- Manifest format remains v1 and plugin API remains major 1; existing 5C/5D packages and installed plugin data remain compatible.
- The SDK targets declarative `.wtplugin` only; no JavaScript, Vue, HTML, Electron Main, Node, Worker, subprocess, filesystem, SecretStore, or arbitrary IPC runtime is exposed.
- The host's actual parser and ZIP validator remain authoritative; the CLI must call the same implementation and never accept a broader package.
- Do not add a new third-party dependency or change the root dependency graph; SDK's isolated package may declare the already-used exact `yauzl@3.4.0` needed by its validator.
- Do not create a pnpm workspace or monorepo. The SDK is a standalone local package and is not published to npm or a plugin marketplace.
- Package input validation is read-only. Packing includes only the root manifest and explicitly declared, validated PNG assets; output is deterministic and never overwrites an existing file.
- All package/Manager/NativeHost/profile/pipe tests use unique temporary locations and do not access `D:\webtools`, `%APPDATA%\Nook`, production plugin data, real credentials, startup registration, or unrelated processes.
- No paid AI call, release, installer publication, PR, merge, tag, or Phase 5I work is authorized beyond the isolated acceptance build needed here.

## Review Focus

1. A declared asset is a Windows junction/symlink or swaps to one during reading: reject it before following it and prove an outside sentinel is never packaged.
2. Two ZIP/manifest paths differ only by case or Unicode NFC form: reject the collision in both CLI and host validation.
3. A malformed, encrypted, highly compressed, oversized, duplicated, or path-traversing archive: host and CLI report failure without modifying source, output, or installed state.
4. A source directory contains `.git`, `node_modules`, environment files, unrelated binaries, or undeclared files: no such content may appear in `.wtplugin`.
5. A developer installs the SDK from a local packed tarball outside the WebTools repository: typecheck, CLI validation, and packing must work without importing host source paths.

---

## Task 1 (H1) — Verify Git Baseline and Freeze the Host Contract

**Files:** Read-only audit of `docs/webtools-phase5b-plugin-architecture.md` through `docs/webtools-phase5g-builtin-translation-migration.md`, the corresponding plans, `src/shared/plugin-contracts.ts`, `electron/plugins/manifest.ts`, `package-validator.ts`, `png.ts`, `permission-broker.ts`, `declarative-runtime.ts`, `plugin-manager.ts`, IPC/preload, and their tests.

**Interfaces:** Produces the capability, manifest, action, setting, page-block, archive, permission, persistence, and lifecycle constraints consumed by H2–H10.

- [x] Verify current branch, Phase 5G commit/upstream, clean baseline, and fetched upstream relation.
- [x] Record existing accepted fields, discriminated unions, parser/archive quotas, actual installation/consent flow, and unsupported executable surfaces.
- [x] Record in the Phase 5H report the current gaps and distinguish JSON-shape checks from host semantic, PNG, ZIP, and installation checks.

**Verification:** H0 Git commands; compare each published type/rule to current source and its tests. No product change in this task.

## Task 2 (H2) — Public Author Types and Machine-readable Schema

**Files:** Create `plugin-sdk/declarative-v1/package.json`, `types.d.ts`, and `manifest.schema.json`; create a type-contract test fixture.

**Interfaces:** `PluginManifestV1`, `PluginSettingV1`, `PluginPageV1`, `PluginBlockV1`, `PluginActionV1`, `PluginCapabilityV1`; SDK constants include manifest version 1, API major 1, exact capability/block/action names, and published package limits. The package exposes types/schema/CLI only, not runtime host services.

- [x] Write tests for a valid literal example, missing/extra fields, bad unions, invalid permissions, and rejection of internal catalog/registry/path/builtin fields.
- [x] Publish the current closed type unions and schema shape, including `additionalProperties: false`, field bounds, SemVer/ID patterns, supported PNG declaration, and explicit v1/api1 constants.
- [x] Mark cross-field/version/path-reference/default checks as host semantic validation; mark archive/PNG and installation/permission checks as later layers. Schema success alone must never be described as install acceptance.
- [x] Make the SDK a standalone non-workspace package with a pinned SDK version and the already-used `yauzl@3.4.0`; do not add any root dependency.
- [x] Run the type-contract fixture with the repository TypeScript compiler; parse the schema as JSON and test its declared closed-field, enum, pattern, and quota contract against the literal host-accepted corpus without adding a runtime dependency.

**Verification:** focused Node tests and `pnpm run typecheck`.

## Task 3 (H3) — One Canonical Host/SDK Validation Runtime

**Files:** Create `plugin-sdk/declarative-v1/runtime/manifest-v1.mjs`, `png-v1.mjs`, and `package-v1.mjs` with declaration files. Convert `electron/plugins/manifest.ts`, `png.ts`, and `package-validator.ts` into typed host adapters over those modules. Add runtime parity tests and extend `electron/plugins/package-validator.test.mjs` for normalized collision rejection.

**Interfaces:** The shared runtime exports `parseManifestV1(bytes, hostVersion)`, `validatePackageV1(bytes, hostVersion, optionalPngDecoder)`, `validatePngV1(bytes)`, frozen `LIMITS_V1`, and `PluginValidationError` with safe code/relative path/message/suggestion. Existing Electron exports and `PluginError` result codes remain unchanged.

- [x] First add red tests proving host and SDK accept/reject the same literal Manifest v1 and hostile archive corpus, including duplicate JSON keys, unknown fields/types/capabilities, cross-references, API mismatch, malformed PNG/ZIP, entry/size/ratio bounds, and case/NFC path collisions.
- [x] Move the current parser, PNG check, and `yauzl` streaming package validator into the SDK-owned runtime module; Electron adapters translate only safe SDK error codes into current `PluginError` codes.
- [x] Keep every current host helper signature used by IPC/store/registry; preserve missing/invalid input codes and API incompatibility behavior.
- [x] Normalize ZIP collision identity with NFC plus case-insensitive comparison; do not alter valid existing package format or loosen any host check.
- [x] Prove old 5C/5D fixtures still pass through the new shared runtime and that SDK runtime has no Electron/Vue/host-source import.

**Verification:** focused host/plugin tests and `pnpm run typecheck` after the adapter conversion.

## Task 4 (H4) — Standalone Read-only `webtools-plugin validate`

**Files:** Create `plugin-sdk/declarative-v1/bin/webtools-plugin.mjs`, `src/cli.mjs`, `src/diagnostics.mjs`, and CLI tests.

**Interfaces:** `webtools-plugin validate <directory-or-wtplugin> --host-version <semver>` returns exit 0 only when the canonical parser/package validator succeeds. It prints `ERROR`, `WARNING`, and `INFO` rows with stable code, relative field/file, reason, and repair hint; it never prints user absolute paths, source text, or credentials.

- [x] Run against directory and archive inputs using the canonical parser/package validator, not an independent permissive parser.
- [x] Validate required manifest, strict UTF-8/JSON, references, exact declared file set, safe relative paths, file/entry/archive/expanded/ratio limits, PNG dimensions, and host API compatibility.
- [x] Return field/file-level diagnostics where known and a safe `manifest.json` diagnostic where the host semantic parser cannot identify one field; add a non-fatal generic-icon warning only when applicable.
- [x] Verify input bytes and tree are unchanged on success and failure, and errors do not contain canonical source/profile/user paths.

**Verification:** CLI child-process tests for valid/invalid manifests, host mismatch, bad ZIPs, and no source mutation.

## Task 5 (H5) — Deterministic `.wtplugin` Packer

**Files:** Create `plugin-sdk/declarative-v1/src/pack.mjs` and packer tests; only use existing Node built-ins and the canonical validator.

**Interfaces:** `webtools-plugin pack <directory> --out <file.wtplugin> --host-version <semver>` produces a validated ZIP containing only `manifest.json` and declared PNG files. Default behavior is no-overwrite; no force flag is supplied.

- [x] Resolve the source root and read only validated regular files beneath it; reject symlink/junction/reparse ancestors for declared inputs, traversal, unsupported path components, case/NFC collisions, and source limits.
- [x] Emit UTF-8 entry names, forward slashes, stable byte-order, fixed ZIP timestamps/attributes, and only host-supported ZIP methods/metadata; enforce host archive limits before output.
- [x] Re-validate generated bytes with `validatePackageV1`; after writing, re-read and re-validate the exact output before reporting success.
- [x] Write through a unique same-directory temporary file and no-overwrite atomic placement; clean up only the tool-owned temporary file after errors. Existing outputs remain byte-for-byte unchanged.
- [x] Print plugin ID/version/API major, relative output path, size, SHA-256 and validation status. Same inputs and tool version must produce identical bytes/hash.

**Verification:** RED→GREEN tests for stored/deflated host compatibility, deterministic hash, Unicode, omitted unrelated files, existing output, unwritable target, symlink escape, and partial failure cleanup.

## Task 6 (H6) — Independent Example Plugin

**Files:** Create `examples/plugins/private-notes/manifest.json`, `README.md`, and `manifest.typecheck.ts`.

**Interfaces:** Example is a third-party `org.example.webtools.private-notes` declarative plugin with a fixed page, plain-text actions `plugin.storage.write/read`, no assets/token/AI/network/custom code, and only `manager.page`, `plugin.storage.read`, and `plugin.storage.write` requested.

- [x] The page explains the example and offers Save note / Load note through existing host buttons and private storage actions.
- [x] Typecheck its exact JSON manifest through `PluginManifestV1` without importing WebTools source.
- [x] Validate and pack through the installed SDK CLI; output package remains outside Git.
- [x] Example README documents install, permission review, enable/use, disable, re-enable, and uninstall/data-retention choices using tested commands.

**Verification:** example typecheck, CLI validate, CLI pack, and canonical host package validation.

## Task 7 (H7) — Independent Developer Workflow

**Files:** Create `scripts/verify-phase5h-sdk-workflow.mjs` and `scripts/verify-phase5h-sdk-workflow.test.mjs`; evidence root is a unique temporary directory outside the repository.

**Interfaces:** The verifier packs the standalone SDK locally, installs that tarball plus TypeScript into an unrelated temporary author project, copies only the example source, and invokes only documented public package types/bin commands. It returns a structured result and leaves no artifact in Git.

- [x] Run external project typecheck, `validate`, `pack`, and `validate` on the resulting `.wtplugin`.
- [x] Cross-check the result with the same validator imported by the host and run existing 5C/5D package fixtures through both paths.
- [x] Assert the external project/tool dependency graph contains no WebTools host package/source import and no package code beyond declarative JSON/PNG.
- [x] Record that SDK is distributed as a local package/tarball and is not yet on npm; never print API keys or access real user data.

**Verification:** run the workflow from a temp cwd outside the repo and inspect its report/exit code.

## Task 8 (H8) — Security and Compatibility Matrix

**Files:** SDK tests from H2–H5 plus new focused cases in `electron/plugins/package-validator.test.mjs` and `electron/plugins/manifest.test.mjs`.

**Interfaces:** Every negative case is run against the canonical tool/host validator where applicable; host installation checks remain authoritative.

- [x] Cover absent/malformed/oversized/duplicate-key JSON; unknown field/type; invalid ID/version/API/capability/page/action/setting/default/reference; builtin spoofing; path traversal/absolute/drive/ADS/reserved paths; case/NFC/file-directory conflicts; symlink/reparse; undeclared JS/binary; encrypted/corrupt/duplicate ZIP; PNG corruption; file-count/size/ratio/expanded limits.
- [x] Cover output exists, output path invalid, write failure and no partial final archive; include a secret-pattern manifest fixture and prove it is rejected without echoing secret bytes.
- [x] Verify shared AI action remains permission-gated and previewed by unchanged host; third-party package cannot read SecretStore, invoke built-in Translation, claim host identity, or execute code.
- [x] Verify existing 5C/5D package fixtures and API major 1 behaviors remain compatible; do not weaken validator to pass the sample.

**Verification:** targeted Node tests, then full suite in H11.

## Task 9 (H9) — Isolated Windows Packaged Plugin Smoke

**Files:** Create `scripts/verify-phase5h-plugin-smoke.mjs` and structural/isolation tests; reuse current build and safe process-identity smoke helpers without changing NativeHost, Named Pipe, startup, installer, or production lifecycle.

**Interfaces:** The smoke consumes an isolated published NativeHost, electron-builder `win-unpacked` Manager, packed example `.wtplugin`, unique profile and unique pipe. Process actions are limited by canonical executable, PID, creation time, parent/role, and isolated root.

- [x] Build NativeHost Release and Manager with the existing commands into unique temporary paths; assert Native-only Electron=0.
- [x] Start/reuse Manager from NativeHost, verify Plugin Center and Translation/Shared AI remain available, install the generated example through the host's real `PluginManager` contract using clearly labeled test consent if native dialog UI cannot be automated, and inspect the unchanged production picker path separately.
- [x] Verify metadata, permissions/grant, enabled page, storage write/read, disable/re-enable, uninstall and keep/delete prompt semantics; no paid AI call.
- [x] Verify ordinary Manager close reaches Electron=0 while isolated NativeHost remains; reopen once; then identity-check graceful isolated shutdown.
- [x] Mark programmatic DOM/mock consent as isolated automation, not physical Windows picker/keyboard/mouse acceptance. Keep the real production install/profile/startup/registry untouched.

**Verification:** packaged result JSON records build and file hashes, source base, exact paths, PIDs/creation times, process gates, steps, cleanup, and evidence limitations.

## Task 10 (H10) — Developer Guide and Implementation Report

**Files:** Create `docs/plugin-development.md` and `docs/webtools-phase5h-plugin-sdk-tooling.md`; update `examples/plugins/private-notes/README.md` only after running documented commands.

**Interfaces:** Guide targets an author who does not have the WebTools checkout; every command uses the actual SDK tarball/bin names verified in H7.

- [x] Cover built-in vs declarative distinction; manifest/API versions; fields/schema/semantic/ZIP/install validation layers; limits; capabilities/consent; pages/actions/config/private data; controlled Shared AI preview; local SDK acquisition; validate/pack/install/update/uninstall; compatibility; diagnostics; unsupported execution APIs.
- [x] Report actual H0 baseline, files, contract classifications, commands/results, 5C/5D compatibility, independent workflow, packaged smoke, security test matrix, human GUI gaps, risks, rollback, and 5I prerequisites.
- [x] Separate current automated, isolated packaged, historical and user-manual evidence; do not state physical UI or native file picker passed if only programmatic DOM was used.
- [x] Record no production profile/install, real secret, registry, startup setting, release, or unrelated process was modified.

**Verification:** execute every listed guide command in the independent temporary author environment; `git diff --check`.

## Task 11 (H11) — Independent Review, Regression, Commit and Push

**Files:** Whole Phase 5H diff. Only Phase 5H SDK/runtime adapters/tool/tests/example/docs may be staged.

**Interfaces:** Reviewer compares merge-base with the verified Phase 5G checkpoint `bc2b429808bdd91c8414cb39f85572bfd591c97c` and the user-provided Phase 5H task.

- [x] Review contract parity, validator single-source structure, ZIP/source path safety, no-overwrite cleanup, secret handling, SDK package independence, host security boundary, compatibility, and scope. Independent standards/spec review completed; actionable P2 findings were fixed test-first and the review-fix tests passed.
- [x] Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, SDK/security tests, Node syntax, applicable NativeHost and UpdateHelper Checks, isolated Windows pack/smoke, and `git diff --check`.
- [x] Fix only confirmed Phase 5H defects test-first; rerun affected tests and full required regression. Temporary cleanup now verifies owned file identity; CLI source/archive validation rejects credential-like content.
- [x] Review staged file list/diff; exclude generated `.wtplugin`, SDK tarball, temp profiles, logs, credentials, release outputs and evidence JSON. Staged list contains the 41 approved SDK/runtime adapter, tests, example, workflow and docs files only.
- [x] Create a clear Phase 5H checkpoint commit and normal push to `origin/codex/shared-ai-translation-2.0`; verify SHA, upstream count and clean worktree.
- [ ] Stop at `PHASE 5H COMPLETE — PENDING PHASE 5I APPROVAL`; never start Phase 5I.

**Completion gate:** SDK and tools work from a separately installed local package; schema/types match the existing v1/api1 implementation; the generated sample passes the actual host package validator and isolated Manager lifecycle; no P0/P1/blocking P2 remains; automated/build checks pass; commit/push/worktree state is verified. Physical native file-picker and manual UI items are reported accurately.

## Dependency Graph and Rollback

```text
H0/H1 audit → H2 public types/schema → H3 shared validator adapter
                                      ↓
                           H4 validate CLI → H5 pack CLI
                                                ↓
                                   H6 sample + H10 guide
                                                ↓
                              H7 independent author workflow
                                                ↓
                              H8 security matrix + H9 package smoke
                                                ↓
                                      H11 review/checkpoint
```

If a host/SDK discrepancy appears, preserve the current host rejection behavior and adjust SDK/schema first. If a required SDK feature needs a broader host privilege, executable code, API major, breaking archive format, or new third-party dependency, stop and report instead of expanding scope. Rollback is a revert of the single Phase 5H checkpoint; no user schema/data migration is planned. Temporary packages and profiles live outside Git and may be removed only by their own isolated verifier after its result has been recorded.
