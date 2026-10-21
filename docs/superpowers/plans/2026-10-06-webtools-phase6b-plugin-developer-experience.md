# WebTools Phase 6B — Plugin Developer Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Keep the pre-existing Launcher changes listed in the design spec untouched and unstaged. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a supported external-author workflow for the existing declarative plugin contract: bootstrap the local SDK tarball, create one basic starter, validate, pack, inspect, and hand a package to WebTools for normal installation.

**Architecture:** Extend the existing standalone `@webtools/plugin-sdk` package and its `webtools-plugin` CLI. The CLI will call only public facade functions, while the canonical Manifest/PNG/ZIP validators remain shared with Electron Host and the Host continues to revalidate every install. Documentation and tests will prove the workflow from a clean temporary directory outside the repository.

**Tech Stack:** Node.js ESM, existing Node built-ins, pnpm `9.15.9`, TypeScript `5.9.2` in generated author projects only, existing SDK Manifest v1 / Plugin API major 1 runtime, existing Electron Host validator.

**Spec:** `docs/superpowers/specs/2026-10-05-webtools-phase6b-plugin-developer-experience-design.md`

## Global Constraints

- Keep one standalone, non-workspace package: `@webtools/plugin-sdk`.
- Bump only the SDK SemVer from `1.0.0` to `1.1.0`; keep WebTools `0.1.0`, Plugin API major `1`, and Manifest version `1` unchanged.
- Distribute the SDK only as a local `.tgz`; do not publish it or add it to product release artifacts.
- Generate one `basic` declarative starter; retain Private Notes as an independent official example.
- Add no dependencies, workspace, monorepo, executable plugin code, capability, permission, API/Manifest field, Host bypass, or product UI change.
- Keep Host installation-time validation and consent authoritative.
- Never execute plugin contents or generated author scripts from the Host/CLI.
- Keep tests, generated plugin projects, `.wtplugin`, SDK tarballs, profiles, and evidence in OS temporary directories outside the repository unless the existing ignored `release/` output is explicitly required for packaging.
- Do not alter the four pre-existing Launcher worktree changes identified in the design spec; never stage or commit them.
- Run `pnpm run typecheck` after each foundational implementation task, then run the scoped tests for that task.
- Create exactly one final Phase 6B checkpoint commit and push it normally to the current branch only after the review and verification gates pass; no force push, merge, PR, tag, release, npm publication, or Phase 6C work.

## Review Focus

- **Untrusted create paths:** rooted, traversal, Unicode, existing, and symlink/reparse targets must fail without writing outside the requested parent or leaving a partial starter. Pin in Task 3.
- **Unsupported CLI syntax and malformed input:** repeated/unknown options, absent host version, malformed versions, and `--json` failures must return stable exit codes and bounded diagnostics without stack/path/secret leakage. Pin in Task 2.
- **Damaged or hostile archives:** truncated, oversized, duplicate/colliding, credential-like, or invalid `.wtplugin` input must fail closed without extracting files. Pin in Task 4.
- **SDK/Host disagreement:** a package accepted by SDK author feedback must also pass the independent Host validator, and representative hostile v1 packages must remain rejected by both. Pin in Task 5.
- **External-install assumptions:** the workflow must work outside the checkout using only the supplied SDK tarball, with no workspace link, absolute checkout path, `NODE_PATH`, or private import. Pin in Task 5.

---

## File Map

| File | Responsibility in Phase 6B |
|---|---|
| `plugin-sdk/declarative-v1/index.mjs` | Public runtime facade for source validation, archive inspection/validation, packing, constants, and safe diagnostics. |
| `plugin-sdk/declarative-v1/types.d.ts` | Public author types plus typed result/diagnostic contracts. |
| `plugin-sdk/declarative-v1/package.json` | SDK version `1.1.0`; preserve package identity, private/local distribution, exports, dependencies, and package-manager pin. |
| `plugin-sdk/declarative-v1/runtime/manifest-v1.mjs` and `.d.mts` | Add optional logical `field` metadata at known parser failure sites without changing validation rules or codes. |
| `plugin-sdk/declarative-v1/src/diagnostics.mjs` | Safe relative-path normalization, stable field-aware records, human/JSON output helpers. |
| `plugin-sdk/declarative-v1/src/cli.mjs` | Strict command/option parser and public-facade dispatch for `create`, `validate`, `pack`, `inspect`, and help. |
| `plugin-sdk/declarative-v1/src/create.mjs` | Deterministic, noninteractive, safe single-basic-template creation. |
| `plugin-sdk/declarative-v1/src/inspect.mjs` | Bounded safe metadata projection from fully validated archive bytes. |
| `plugin-sdk/declarative-v1/tests/public-api.test.mjs` / `.typecheck.ts` | Public import/runtime and declaration contract. |
| `plugin-sdk/declarative-v1/tests/cli.test.mjs` | Existing validate/pack compatibility and new CLI/JSON/diagnostic/help behavior. |
| `plugin-sdk/declarative-v1/tests/create.test.mjs` | Starter contents, derivation, path rejection, no-overwrite and failure cleanup. |
| `plugin-sdk/declarative-v1/tests/inspect.test.mjs` | Valid metadata and hostile/invalid archive behavior. |
| `plugin-sdk/declarative-v1/tests/runtime-parity.test.mjs` | Public SDK facade and Host parity cases. |
| `scripts/verify-phase6b-sdk-workflow.mjs` / `.test.mjs` | Isolated external-author tarball workflow, its safety guards, dependency graph, hashes, timings, and SDK/Host comparison. |
| `examples/plugins/private-notes/README.md` | Update the independent example to the verified 1.1.0 SDK workflow; keep its manifest/content independent from the starter. |
| `plugin-sdk/declarative-v1/README.md` | Short SDK package entry point and public API/CLI pointer. |
| `docs/plugin-development.md` | Complete supported external developer guide and command/reference/troubleshooting material. |
| `README.md`, `docs/README.md` | Link the developer guide where maintainers/authors can find it. |
| `docs/release-build.md` | Update current SDK version row to `1.1.0`; retain historical Phase 6A source/measurements as history. |
| `docs/webtools-phase6b-plugin-developer-experience.md` | Final implementation/verification report and manual acceptance limits. |
| `docs/webtools-phase6c-capability-backlog.md` | Small evidence-based backlog; explicitly state “none identified” if the 6B workflow raises no concrete missing capability. |

## Interfaces Locked by This Plan

The package root (`@webtools/plugin-sdk`) exposes these async authoring calls from `index.mjs`; they wrap the current canonical validators/packer rather than reimplementing them:

```ts
export type PluginDiagnosticCodeV1 =
  | 'INVALID_INPUT' | 'INVALID_MANIFEST' | 'INCOMPATIBLE_PLUGIN' | 'INVALID_PACKAGE'
  | 'SOURCE_IO' | 'SENSITIVE_CONTENT' | 'OUTPUT_EXISTS' | 'OUTPUT_IO'
  | 'CLI_USAGE' | 'GENERIC_ICON'

export interface PluginDiagnosticV1 {
  code: PluginDiagnosticCodeV1
  path: string // safe package-relative path only
  field?: string // logical Manifest field when the parser can identify one
  message: string
  suggestion: string
}

export interface PluginValidationResultV1 {
  valid: true
  manifest: PluginManifestV1
  warnings: PluginDiagnosticV1[]
}

export interface PluginArchiveSummaryV1 {
  valid: true
  manifest: PluginManifestV1
  size: number
  sha256: string
}

export interface PluginPackResultV1 extends PluginArchiveSummaryV1 {}

export declare function validatePluginSourceV1(
  sourceDirectory: string,
  hostVersion: string,
): Promise<PluginValidationResultV1>

export declare function validatePluginArchiveV1(
  bytes: Uint8Array,
  hostVersion: string,
): Promise<PluginArchiveSummaryV1>

export declare function packPluginV1(
  sourceDirectory: string,
  outputFile: string,
  hostVersion: string,
): Promise<PluginPackResultV1>

export declare class PluginValidationError extends Error {
  readonly code: PluginDiagnosticCodeV1
  readonly path: string
  readonly field?: string
  readonly suggestion: string
}
```

These result objects contain manifest metadata and bounded summary values only; they do not return archive bytes, extracted assets, source paths, absolute author paths, filesystem handles, or Host internals. `PluginValidationError` remains the thrown error contract with stable `code`, safe relative `path`, optional `field`, and safe `suggestion`.

CLI command contract:

```text
webtools-plugin --help
webtools-plugin create <directory> --host-version <version> [--id <id>] [--name <name>] [--description <text>] [--author <name>] [--min-host-version <version>] [--json]
webtools-plugin validate <directory|file.wtplugin> --host-version <version> [--json]
webtools-plugin pack <directory> --out <file.wtplugin> --host-version <version> [--json]
webtools-plugin inspect <file.wtplugin> --host-version <version> [--json]
```

`--json` emits one bounded JSON envelope per invocation: success `{ "ok": true, "command": "…", "result": { … } }`; failure `{ "ok": false, "command": "…", "error": { "code": "…", "path": "…", "field": "…", "message": "…", "suggestion": "…" } }`. Omit `field` when unknown. Human output remains the default. Usage errors exit `2`; validation/operation failures exit `1`; success exits `0`. Preserve existing human-mode `validate` and `pack` syntax and outcomes. Generated scripts use `pnpm run validate`, `pnpm run plugin:pack`, and `pnpm run inspect`; `pnpm pack` remains pnpm's SDK tarball command.

---

## Task 1: Public SDK Authoring Facade and 1.1.0 Contract

**Files:**
- Modify: `plugin-sdk/declarative-v1/index.mjs`
- Modify: `plugin-sdk/declarative-v1/types.d.ts`
- Modify: `plugin-sdk/declarative-v1/runtime/manifest-v1.mjs`
- Modify: `plugin-sdk/declarative-v1/runtime/manifest-v1.d.mts`
- Modify: `plugin-sdk/declarative-v1/package.json`
- Create: `plugin-sdk/declarative-v1/tests/public-api.test.mjs`
- Create: `plugin-sdk/declarative-v1/tests/public-api.typecheck.ts`

**Dependencies:** None.

**Produces:** The exact public facade/result/error types above; package version `1.1.0`.

- [ ] **Step 1: Add failing public API tests.** Assert that the package root still exports current Manifest/API constants and now exports the three functions and `PluginValidationError`; valid source/archive metadata is correct and includes `valid: true`; pack remains no-overwrite; returned summaries contain no raw archive/assets/source root; sensitive content still rejects; error code/path remain stable and known parser failures expose a logical field.
- [ ] **Step 2: Run focused tests and the type-contract compile; confirm the new exports fail before implementation.** Run `node --test plugin-sdk/declarative-v1/tests/public-api.test.mjs` and `pnpm exec tsc --noEmit --strict --skipLibCheck --moduleResolution bundler --module ESNext --target ES2022 plugin-sdk/declarative-v1/tests/public-api.typecheck.ts`.
- [ ] **Step 3: Export the facade from `index.mjs`.** Implement `validatePluginSourceV1`, `validatePluginArchiveV1`, and `packPluginV1` by wrapping `readPluginSource`, `validatePackageV1`, existing credential-content checks, and existing `packPlugin`; project return data to the locked summary shapes and do not expose underlying byte/asset collections.
- [ ] **Step 4: Add field metadata without changing validation semantics.** Extend `PluginValidationError`/`failValidation` with an optional logical field. Add field values at high-value, unambiguous top-level checks (`manifestVersion`, `id`, `api.apiMajor`, `api.minHostVersion`, `requestedCapabilities`, `entry`, `settings`, `pages`, `actions`, `assets`); leave low-level parser failures without a field when location cannot be known.
- [ ] **Step 5: Declare facade and error/result types; bump only SDK package version to `1.1.0`.** Do not change root package/lockfile or any API/Manifest constants.
- [ ] **Step 6: Run focused tests and typecheck; then run `pnpm run typecheck`.** Expect all existing SDK and Host contract tests plus the new API tests to pass.

## Task 2: Safe Diagnostics, Strict CLI Contract, Help, and JSON Mode

**Files:**
- Modify: `plugin-sdk/declarative-v1/src/diagnostics.mjs`
- Modify: `plugin-sdk/declarative-v1/src/cli.mjs`
- Modify: `plugin-sdk/declarative-v1/tests/cli.test.mjs`
- Modify: `plugin-sdk/declarative-v1/index.mjs` only if a diagnostic helper must be publicly exposed; prefer not exposing CLI formatting internals.

**Dependencies:** Task 1.

**Produces:** Stable field-aware diagnostics and the CLI grammar in “Interfaces Locked by This Plan”.

- [ ] **Step 1: Add failing CLI tests before refactoring.** Pin `--help`; exact option validation; repeated, unknown, missing-value, and missing-host-version failures; existing validate/pack human syntax; `--json` success/failure envelopes; exit codes `0/1/2`; Unicode relative paths; absolute/traversal path suppression; and no stack, source text, or secret in either output stream.
- [ ] **Step 2: Run `node --test plugin-sdk/declarative-v1/tests/cli.test.mjs`; confirm new cases fail.** Keep existing CLI tests passing as the compatibility baseline.
- [ ] **Step 3: Replace permissive pair parsing with an explicit command option schema.** Permit only the options listed for each command, reject duplicates/unknowns/missing values, require explicit host version where specified, and route help without error output.
- [ ] **Step 4: Route validate/pack through the Task 1 public facade.** Remove direct CLI imports of canonical runtime/parser/packer modules. Keep source/archive validation and credential rejection behavior unchanged.
- [ ] **Step 5: Normalize diagnostics to safe slash-separated package-relative paths.** Preserve valid Unicode filenames; suppress absolute, rooted, control-character, and traversal paths; add `field` only when known; never print stack traces or input content.
- [ ] **Step 6: Implement the bounded JSON envelope and human formatter.** Print exactly one JSON object in JSON mode (no prefixed warnings/info); preserve stable code and exit mappings.
- [ ] **Step 7: Run CLI/API focused suites and `pnpm run typecheck`.** Confirm old `validate`/`pack` command invocations remain compatible.

## Task 3: Deterministic and Safe `create` Basic Starter

**Files:**
- Create: `plugin-sdk/declarative-v1/src/create.mjs`
- Create: `plugin-sdk/declarative-v1/tests/create.test.mjs`
- Modify: `plugin-sdk/declarative-v1/src/cli.mjs`

**Dependencies:** Task 2.

**Produces:** `webtools-plugin create <directory> --host-version <version>` plus the approved identity options; one minimal declarative `basic` starter.

- [ ] **Step 1: Add failing create tests.** Assert exact files and valid `manifest.json`; default ID slug under `org.example.`, humanized name, explicit overrides, default `minHostVersion` equal to selected host, valid empty settings/actions/assets, one manager page and `manager.page`; generated scripts are named `validate`, `plugin:pack`, `inspect`; TypeScript is author-only at exact version `5.9.2`; Private Notes-only storage behavior is absent.
- [ ] **Step 2: Add safety tests.** Reject rooted paths, `..`, drive/UNC paths, empty/dot names, invalid IDs/versions, `minHostVersion` newer than `--host-version`, pre-existing file/directory, symlink/junction/reparse ancestors, and unsafe author-supplied manifest strings; assert no path outside the working parent changes and no partial final starter remains after failure.
- [ ] **Step 3: Run `node --test plugin-sdk/declarative-v1/tests/create.test.mjs`; confirm failures.**
- [ ] **Step 4: Implement target resolution as a safe relative descendant of the CLI working directory.** Reject absolute/traversal paths and any symlink/reparse component, require a non-existing final target, and create without overwrite. On failure, clean only files/directories created by this invocation.
- [ ] **Step 5: Render the starter deterministically.** Create only `manifest.json`, `manifest.typecheck.ts`, `package.json`, `README.md`, `.gitignore`, and empty `dist/`; validate derived/overridden manifest values through the canonical SDK parser before reporting success. Do not execute shell commands or generated content.
- [ ] **Step 6: Connect `create` to the strict CLI and JSON/human output.** Include plugin id, host compatibility, and created relative directory only; do not leak absolute paths.
- [ ] **Step 7: Run create/CLI/API suites and `pnpm run typecheck`.**

## Task 4: Bounded `inspect` for `.wtplugin`

**Files:**
- Create: `plugin-sdk/declarative-v1/src/inspect.mjs` (only if a projection helper keeps the CLI focused; otherwise keep the small projection in `cli.mjs`)
- Create: `plugin-sdk/declarative-v1/tests/inspect.test.mjs`
- Modify: `plugin-sdk/declarative-v1/src/cli.mjs`

**Dependencies:** Tasks 1–2.

**Produces:** `webtools-plugin inspect <file.wtplugin> --host-version <version>` with human and JSON output.

- [ ] **Step 1: Add failing tests for valid metadata.** Assert id/name/description/author, plugin version, Manifest version, API major/minimum host, declared capabilities, byte count, SHA-256, and a successful validation status.
- [ ] **Step 2: Add failing rejection tests.** Cover wrong extension, empty/truncated ZIP, oversized archive, malformed central/local records, undeclared or duplicate/colliding entries, credential-like manifest/asset content, and host incompatibility. Verify the file remains byte-for-byte unchanged and no extraction directory is created.
- [ ] **Step 3: Run `node --test plugin-sdk/declarative-v1/tests/inspect.test.mjs`; confirm failures.**
- [ ] **Step 4: Implement archive inspection over bounded in-memory bytes.** Use `validatePluginArchiveV1`; project only safe manifest metadata, capabilities, size, hash and validity. Never extract, install, prompt for consent, or execute content.
- [ ] **Step 5: Add `inspect` to command-specific option parsing and output.** Require explicit `--host-version`, preserve stable diagnostics, and ensure JSON remains a single envelope.
- [ ] **Step 6: Run inspect/CLI/API suites and `pnpm run typecheck`.**

## Task 5: External Tarball Workflow and SDK ↔ Host Parity Gate

**Files:**
- Create or minimally extend: `scripts/verify-phase6b-sdk-workflow.mjs`
- Create: `scripts/verify-phase6b-sdk-workflow.test.mjs`
- Modify: `plugin-sdk/declarative-v1/tests/runtime-parity.test.mjs`
- Reuse unchanged: `scripts/verify-phase5h-sdk-workflow.mjs` only as a pattern/reference; do not relabel its historical report as Phase 6B evidence.

**Dependencies:** Tasks 1–4.

**Produces:** Repeatable proof that the shipped local tarball supports create → typecheck → validate → pack → inspect → Host validation entirely outside the checkout.

- [ ] **Step 1: Add runner guard tests.** Require a unique OS temp root; validate that all generated files, profile/package outputs and report paths remain beneath it; assert no production profile, `D:\webtools`, registry, startup, real plugin store, or arbitrary process operation is present. Restrict subprocess execution to pinned pnpm/Node commands and repository-owned validators.
- [ ] **Step 2: Add parity cases.** Compare SDK public `validatePluginArchiveV1` with `electron/plugins/package-validator.ts` for a valid starter archive and representative hostile fixtures (unknown privileged field/capability, incompatible API/min-host, unsafe paths/collisions, and malformed archive). Assert equal accept/reject outcome and matching plugin identity/version contracts.
- [ ] **Step 3: Run the focused runner tests and parity suite; confirm new conditions fail before implementation.**
- [ ] **Step 4: Implement an external-author runner.** Pack SDK with pinned pnpm `9.15.9` to a unique temp `artifacts/`; bootstrap a separate tooling directory from only that tarball; invoke `create`; add the same tarball as the generated project's local devDependency; perform install + frozen install, typecheck, validate, pack, inspect, and final archive validation.
- [ ] **Step 5: Enforce independence.** Inspect `pnpm list --depth 1 --json` and lockfile for checkout/workspace/absolute-source links; ensure no `NODE_PATH`; copy only generated external author inputs; compare tarball/plugin byte sizes and SHA-256; record versions/commands/durations in a report under temp, with no arbitrary time threshold.
- [ ] **Step 6: Validate final `.wtplugin` through both the public SDK API and Host adapter.** Store no package/profile/report in the repository or production directories.
- [ ] **Step 7: Run `node --test scripts/verify-phase6b-sdk-workflow.test.mjs plugin-sdk/declarative-v1/tests/runtime-parity.test.mjs` and `pnpm run typecheck`.**

## Task 6: Author Documentation, Example Flow, and Capability Backlog

**Files:**
- Modify: `docs/plugin-development.md`
- Modify: `plugin-sdk/declarative-v1/README.md`
- Modify: `examples/plugins/private-notes/README.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/release-build.md`
- Create: `docs/webtools-phase6c-capability-backlog.md`
- Create: `docs/webtools-phase6b-plugin-developer-experience.md` (implementation results filled during Task 7)

**Dependencies:** Tasks 1–5.

**Produces:** Discoverable, runnable external author guide and phase-scoped evidence documents.

- [ ] **Step 1: Update SDK and Private Notes instructions from the passing external workflow.** Document local tarball selection/version, `pnpm` bootstrap, generated starter, adding the tarball as local devDependency, frozen install, typecheck, `pnpm run validate`, `pnpm run plugin:pack`, `pnpm run inspect`, and manual Plugin Center install. Keep Private Notes a separately maintained sample with its storage capabilities and do not copy those capabilities into `basic`.
- [ ] **Step 2: Complete `docs/plugin-development.md`.** Add prerequisites, folder map, exact CLI grammar/options/exit codes/JSON envelope, Manifest v1 reference, all current closed blocks/settings/actions/capabilities, local storage and consent semantics, compatibility, limits, package-vs-install authority, security boundary, safe diagnostics, and troubleshooting. Make clear local SDK tarball is not npm-published and does not change product runtime.
- [ ] **Step 3: Add root README and docs-index links.** Keep existing project README content; add only a discoverable developer-doc link in the appropriate development section.
- [ ] **Step 4: Update current SDK version in `docs/release-build.md` to `1.1.0`.** Do not rewrite Phase 6A historical report data, `docs/webtools-phase5h-plugin-sdk-tooling.md`, or old SDK hashes.
- [ ] **Step 5: Create the Phase 6C capability backlog.** Add entries only for concrete capability gaps observed during external workflow; otherwise record explicitly that none were identified in Phase 6B and that Phase 6C remains unstarted/unapproved.
- [ ] **Step 6: Create/update the Phase 6B report.** Record source identity, changed files, SDK tarball identity/hash, external workflow report path outside repo, parity/verification, security review, manual Plugin Center acceptance still needed, P0–P3, and phase boundary. Do not claim physical UI acceptance or publish/release.
- [ ] **Step 7: Check docs commands against the recorded passing workflow and run `git diff --check`.**

## Task 7: Final Review, Regression, and Single Git Checkpoint

**Files:** All Phase 6B files from Tasks 1–6; no unrelated production files.

**Dependencies:** Tasks 1–6, in order. Do not parallelize Tasks 1–5 because public facade, CLI, create/inspect, and external acceptance depend on each other's locked contracts.

- [ ] **Step 1: Review full diff against the design spec.** Verify no Phase 6C feature, Host authorization bypass, product UI change, API/Manifest change, root dependency/lockfile change, or unrelated refactor.
- [ ] **Step 2: Review archive/path/diagnostic security boundaries.** Confirm no shell interpolation, plugin execution, archive extraction in `inspect`, absolute/source paths in diagnostics, or raw buffers/assets in public results.
- [ ] **Step 3: Run Node syntax checks for changed `.mjs` files and focused SDK/create/inspect/CLI/parity/external-workflow tests.**
- [ ] **Step 4: Run full regressions:**
  - `pnpm install --frozen-lockfile`
  - `pnpm run typecheck`
  - `pnpm test`
  - `pnpm run build`
  - `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release`
  - `dotnet run --project native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj --configuration Release`
  - Windows product/package acceptance required by current release contract, only if the existing Phase 6A candidate/release path remains compatible; never target the live `D:\webtools` install or `%APPDATA%\Nook`.
  - `git diff --check`
- [ ] **Step 5: Verify SDK tarball and generated plugin.** Confirm SDK tarball is `@webtools/plugin-sdk@1.1.0`; generated `.wtplugin` is accepted by SDK and Host; no test artifacts enter Git; note manual Plugin Center installation as user verification if not actually performed.
- [ ] **Step 6: Confirm repository state and protect pre-existing user work.** Re-run `git status --short`, inspect every staged path, compare the four preserved Launcher files with their recorded baseline hashes, and ensure they remain unstaged and unchanged by Phase 6B.
- [ ] **Step 7: Stage only reviewed Phase 6B implementation/tests/examples/docs, run `git diff --cached --check`, inspect staged diff, create one checkpoint commit, then normal-push the current branch upstream.** Do not commit the preserved Launcher work or generated artifacts; do not force-push, merge, PR, tag, release, publish, or begin Phase 6C.
- [ ] **Step 8: Verify commit, upstream synchronization, and clean status.** Report exact commit hash, push result, test results, and any manual Plugin Center acceptance still needed.

## Dependency Order

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7
```

This sequence is intentional: the facade types precede CLI use; the strict CLI precedes create/inspect command integration; external acceptance consumes all four operations; documentation is written from verified behavior; and final review/checkpoint occurs only after the complete implementation. No subagent split is recommended because the CLI/API contract, validation trust boundary, tests and author workflow are tightly coupled.

## Manual Acceptance Checklist

The implementation worker must stop for user review/acceptance rather than claim these as automated passes if no physical Plugin Center UI run is performed:

- [ ] Obtain the `1.1.0` local SDK tarball from the test build; it is not published to npm.
- [ ] In a new external project directory, follow the documented create/bootstrap steps and confirm no WebTools checkout path is required.
- [ ] Run the generated TypeScript typecheck, validation, `plugin:pack`, and inspection scripts.
- [ ] In a test WebTools profile only, use Plugin Center's normal local-file picker to install the generated `.wtplugin`; inspect requested permissions and enable it using the existing consent flow.
- [ ] Confirm basic page renders; no generated or plugin-provided JavaScript executes; uninstall through Plugin Center.
- [ ] Repeat with the independent Private Notes example only if the package is included in the reviewed manual acceptance set; verify its plugin-private storage remains scoped to that plugin.

Automated CLI/package validation is not a substitute for the Native file picker, real consent dialog, or physical Windows UI acceptance.
