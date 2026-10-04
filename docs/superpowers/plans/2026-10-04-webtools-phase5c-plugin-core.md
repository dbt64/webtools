# Phase 5C — Declarative Plugin Core Implementation Plan

**Goal:** Implement the approved Manager-only declarative plugin core, with no plugin code execution and no Phase 5D management UI.

**Architecture:** Trusted Manager Main owns package validation, immutable managed archives, registry/config/private data, permission enforcement, lifecycle and fixed host actions. Preload exposes only typed DTO operations. NativeHost is unchanged. The only runtime kind is `declarative-manager`.

**Tech stack:** Existing Electron 44 / Node 24 / TypeScript / pnpm 9.15.9; pinned yauzl 3.4.0 and its type definitions for ZIP reading. Existing SharedAIService remains the sole provider/credential boundary.

**Spec:** `docs/webtools-phase5b-plugin-architecture.md` and the user's Phase 5C authorization. Baseline: `61e851315f7ecfed3d82a0b520426e7c231eed5d`, clean `codex/shared-ai-translation-2.0`, synchronized upstream. Phase 5A and 4F/G6 evidence is historical, not new runtime evidence.

## Global Constraints

- No NativeHost/C# changes, Launcher extension, executable plugin runtime, arbitrary IPC, network, filesystem, shared settings or secret access.
- No production installation/profile/startup operations; tests use disposable directories and mock AI/host adapters.
- No 5D UI, 5E SDK/packaging tools, or 5F acceptance. No dependency upgrades besides minimum ZIP reader additions.
- Main native dialogs provide explicit local-package trust, conflict/downgrade, capability, sensitive-action and independent data-deletion consent. Renderer booleans never prove consent.
- Keep existing package/build scripts, renderer architecture and AppData schema.
- Commit/push only after final review and green verification, to current upstream, no force/PR/release.

## Contract and Security Decisions

1. Shared `src/shared/plugin-contracts.ts` defines closed capabilities, settings/blocks/actions, safe summaries/pages, invocation input/results and nested API. Internal validation brands the manifest; raw JSON is `unknown`.
2. Manifest v1 follows 5B: strict fields `manifestVersion,id,name,description,author,version,api,type,entry,requestedCapabilities,settings,pages,actions,assets`. Unknown fields/duplicate JSON keys/depth >16 rejected. API major 1; SemVer 2 comparison includes prerelease. IDs 3–128 lowercase identifier characters with dot/hyphen separators. All references resolve. Static HTTPS URLs only. No expressions, templates, HTML rendering or plugin imports.
3. Setting types: bounded text, enum, boolean, bounded number; fixed UI blocks heading/paragraph/text-input/select/checkbox/divider/button. Fixed actions config.read/write, storage.read/write, external.open, clipboard.write, sharedAI.complete. Action targets (setting/key/URL) are declaration-bound; input has closed per-action shapes.
4. Limits: archive 20 MiB, entries 256, total expanded 50 MiB, PNG 256 KiB and 256x256, ratio 100:1, manifest 64 KiB, pages 8, blocks 64/page, actions 32, settings 64, capability entries 128; private JSON value 512 KiB, 200 keys, total 5 MiB.
5. yauzl uses lazy central-directory enumeration, strict names, validated sizes and sequential entry streams. ZIP64 metadata accepted only within limits. Host additionally checks encryption/attributes/CRC/Windows names/case collisions/actual byte budgets, undeclared entries and PNG structure/decompression; Electron nativeImage performs an additional production decode check. No unrestricted extraction. A bounded compressed archive snapshot prevents picker-source mutation during validation/hash/copy.
6. Immutable archive layout: `<userData>/plugins/packages/<id>/<version>/<sha256>.wtplugin`. Runtime never loads code from it. Staging is random and owned by host; registry references are derived identities, never supplied paths. Every managed read/write/delete checks canonical containment and rejects symlink/junction ancestors. Registry corruption reconstructs only revalidated managed archives, disabled with no grants; ambiguous versions never auto-enable.
7. Registry temp-write/fsync/rename and serialized transactions. Content is committed before registry pointer; failure leaves old pointer/config unchanged and cleans new staging/package. Crash-orphan validated packages recover disabled. Same ID/version/hash no-op; differing hash or downgrade requires native consent. Upgrade retains old archive/config, intersects grants, checks config compatibility (incompatible changes reject rather than execute migrations), new capabilities leave needs-permission. Uninstall stops first, deletes managed packages only, retains private data unless separately confirmed.
8. PermissionBroker distinguishes requested/granted/enforced. Runtime checks enabled/active identity/hash/action/input/grant/session at every call and after awaits. Disable/revoke/upgrade/reload/close invalidate generation and abort operations; late responses cannot write or return stale success. AI: 1 concurrent/plugin, 5/minute, 100 messages, 50k chars/message, 2048 tokens, 60s timeout. Preview lists exact input and selected provider; no credential/endpoint/raw error DTO.
9. Main frame sender check on every IPC, closed runtime input validation, no renderer-supplied path or consent token. Reload rotates Manager session; all dialogs and actions are rechecked after async consent. DTOs use bounded PNG data URLs and pure text, not package paths. Disabled plugins expose no pages/actions.

## Task Dependencies

`1 Baseline/plan → 2 Manifest → 3 Package validator → 4 Store/registry → 5 Broker/runtime/manager → 6 IPC/integration → 7 Review/report/checkpoint`.

Execute inline in this branch. One fresh read-only whole-change reviewer after implementation, as required by executing-plans; no independent implementers splitting coupled lifecycle/transaction code.

## Task 1 — Baseline and Plan

**Files:** this plan; ignored execution ledger under `.superpowers/sdd/2026-10-04-webtools-phase5c-plugin-core/`.

- [x] Verify branch/HEAD/status/history/upstream and fetch without replacing work.
- [x] Inspect 5B contracts and actual Main/preload/IPC/SharedAI/build/test structure.
- [x] Check Node/pnpm and maintained ZIP reader primary documentation/npm metadata.
- [x] Write plan and proceed under the existing authorization.

## Task 2 — Manifest and Shared Contracts

**Files:** `src/shared/plugin-contracts.ts`; `electron/plugins/{errors,manifest}.ts`; `manifest.test.mjs`.

**Interfaces:** `parseManifest(bytes, hostVersion): ValidatedManifest`, strict JSON parser, SemVer comparison, setting value validator, safe DTO types.

- [ ] Write failing tests for valid draft, malformed/duplicate JSON, fields, identities, versions, bounds, capabilities, blocks/actions/references/config.
- [ ] Implement closed schemas and plain-data parsing without executable interpretation.
- [ ] Run targeted tests and `pnpm run typecheck`; expected all PASS before Task 3.

## Task 3 — ZIP/PNG Package Validator

**Files:** package.json/pnpm-lock.yaml; `electron/plugins/{package-validator,png}.ts`; package tests and test-only ZIP fixture builder.

**Interfaces:** `validatePackage(bytes,hostVersion,pngDecoder?): Promise<ValidatedPackage>` returns validated manifest, SHA-256 and declared PNG bytes; no disk writes.

- [ ] RED tests for traversal/Windows names/collision/attrs/ZIP64/corruption/CRC/encryption/undeclared content/PNG/bomb limits.
- [ ] Pin reader + types; implement bounded sequential stream validation and safe errors.
- [ ] Targeted tests, frozen install and typecheck; expected PASS.

## Task 4 — Managed Store, Registry and Transactions

**Files:** `electron/plugins/{managed-fs,plugin-store,plugin-registry}.ts`; store/registry tests.

**Interfaces:** derived managed paths, atomic JSON writes, scoped quota storage/config, registry read/write/recovery; no AppData dependency.

- [ ] RED tests for safe paths/symlinks/atomic failure/corruption/quota/isolation/defaults/compatible config upgrades.
- [ ] Implement directories, bounded JSON, recovery and serialized persistence primitives.
- [ ] Targeted tests and typecheck; expected PASS. Task 5 owns cross-module install/upgrade/uninstall transaction integration.

## Task 5 — Permission, AI, Runtime and Lifecycle Manager

**Files:** `electron/plugins/{permission-broker,declarative-runtime,plugin-manager}.ts`; manager/runtime tests.

**Interfaces:** closed PluginRuntime; injected trusted host effects and consent; install/setEnabled/revoke/list/pages/invoke/uninstall; session begin/close; requested/granted state; action result union.

- [ ] RED tests for first install/no-op/conflict/downgrade/rollback/recovery/tamper/concurrent mutations.
- [ ] RED tests for forgery, permission revocation, sessions/close/disable/uninstall cancellation, quotas, timeout and late responses; mock AI only.
- [ ] Implement safe transactions and lifecycle; disabled runtimes register no page/action.
- [ ] Run all plugin tests and typecheck; expected PASS.

## Task 6 — Typed IPC, Preload and Production Wiring

**Files:** `electron/ipc/plugin-handlers.ts` + tests; `electron/plugins/electron-plugin-host.ts`; `electron/{main,preload}.ts`; `src/shared/ipc.ts`; isolated packaged smoke script if necessary.

**Interfaces:** `desktop.plugins.list/installFromUserDialog/setEnabled/setGrants/getPages/invoke/uninstall`; safe DTOs and stable IpcResult; trusted Main picker/dialog adapters.

- [ ] RED tests for all sender/argument/session checks and cancelled dialogs.
- [ ] Wire PluginManager once after SharedAIService initialization; cancel at renderer reload/window close/before-quit. No new window/process/native task.
- [ ] Native dialogs supply consent and AI request preview. No formal plugin navigation/rendering UI in 5C.
- [ ] Typecheck/full Node tests/build; inspect packaged dependency inclusion and run an isolated packaged Manager smoke, no production installer operation.

## Task 7 — Final Review, Report and Checkpoint

**Files:** `docs/webtools-phase5c-plugin-core.md`, this plan's execution record; approved files above only.

- [ ] Fresh-context read-only reviewer examines full change and spec, especially failure paths not covered by tests.
- [ ] Fix important findings with targeted RED→GREEN tests; record rulings/minor limits.
- [ ] Run typecheck, Node suite, build, `git diff --check`; Native C# is unchanged (no stress reruns).
- [ ] Write report distinguishing unit/integration/packaged smoke from pending 5D UI/5F Windows acceptance; no invented memory or manual results.
- [ ] Review paths/diff, stage approved files, cached check, commit and normal push upstream, verify SHA/0-0/clean.
- [ ] Stop at `PHASE 5C CORE COMPLETE — PENDING PHASE 5D UI INTEGRATION` only if security/core gates pass.

## Review Focus

Check ZIP metadata/actual bytes/duplicate names/PNG decoding, fail-closed filesystem containment, registry recovery and orphan packages, partial transaction/config rollback, async consent races, disabled/revoked/session-stale actions, quotas and late AI writes, sanitized DTOs/errors, current-main-frame IPC, close/reload cleanup, real credential isolation and packaged reader dependency resolution. No generic executable runtime seam is permitted.

## Risks and Rollback

Local same-user administrator tampering is not an OS sandbox boundary; digest validation detects managed content changes and disables it. Registry crash recovery always disables reconstructed entries. No plugin schema migration code runs: incompatible config changes reject upgrade and retain the old pointer. Package import is bounded but consumes up to 20 MiB compressed snapshot while validating. Future UI integration must render only the closed host controls and obtain native/host consent. Rollback of this feature is reverting the scoped plugin wiring/modules; existing user AppData and NativeHost remain untouched. Keep private plugin data by default.
