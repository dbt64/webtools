# WebTools Phase 6B — Plugin Developer Experience Design

**Status:** Draft for user review

**Date:** 2026-10-05

**Phase boundary:** Phase 6B only. Phase 6C is not started.

## Goal

Make the existing declarative WebTools plugin SDK usable by a third-party author outside the WebTools repository. An author should be able to obtain the local SDK tarball, create a small plugin project, validate and pack it, inspect the resulting `.wtplugin`, and install it manually through WebTools Plugin Center.

Phase 6B improves authoring tools and documentation. It does not expand what a plugin can do.

## Audited Current State

The implementation was inspected in the current Phase 6A worktree, rather than inferred from historical plans:

- `plugin-sdk/declarative-v1/package.json` defines a separate, non-workspace `@webtools/plugin-sdk` package at version `1.0.0`, marked `private`, with a `webtools-plugin` bin, public type/schema exports, and exact `yauzl@3.4.0` dependency.
- `plugin-sdk/declarative-v1/index.mjs` exports Manifest/API constants and limits. The CLI currently has `validate` and `pack`; both take an explicit `--host-version`. There is no `create`, `inspect`, help command, or JSON diagnostic output.
- The SDK runtime performs strict Manifest v1, PNG, ZIP, path, collision, size, compatibility, and credential-like-content validation. The packer includes only `manifest.json` and declared assets, writes without overwriting, and revalidates the result.
- Electron Main adapters in `electron/plugins/manifest.ts`, `package-validator.ts`, and `png.ts` call that canonical runtime. `PluginManager.install` remains the install-time authority and separately validates package bytes before storing or enabling a plugin.
- `examples/plugins/private-notes` is source-independent: it uses the public `PluginManifestV1` type and current declarative page/storage API, with no plugin JavaScript or repository-private import. The Phase 5H workflow has previously packed the SDK tarball, installed it in a temporary external project, validated/packed the example, and compared SDK and Host validation. That is historical evidence; Phase 6B must run its own expanded author workflow.
- `docs/plugin-development.md` documents the existing tarball workflow and security constraints, but is not linked from the root README or docs index. The guide does not yet provide a complete command reference, generated project workflow, or full Manifest/API reference.
- The smallest useful valid source is a closed `manifest.json` with required identity, author, version, API compatibility, declarative-manager type, entry, `manager.page`, at least one page, and explicit arrays for settings/actions/assets. The optional arrays can be empty. Existing blocks, settings, storage and actions remain the only available author surface.

The current Plugin API already includes `manager.page`, config/storage read and write, HTTPS external open, clipboard write, and reviewed Shared AI completion. Its page blocks and actions are closed unions defined by the SDK/runtime and Host. No new capability is needed for the 6B workflow.

## Approved Architecture

### One SDK package and CLI

Extend the existing `@webtools/plugin-sdk` package and its `webtools-plugin` executable. Do not introduce a competing CLI package. The CLI will call stable public SDK operations exposed from the package entry point; it will not duplicate manifest, archive, credential, or packing validation.

The public authoring surface will cover:

- validate a source directory against a selected WebTools host version;
- validate/inspect bounded `.wtplugin` bytes and return safe package metadata;
- pack a source directory through the existing no-overwrite packer.

The CLI will expose `create`, `validate`, `pack`, and `inspect`, plus `--help`. The existing `validate` and `pack` flags and behavior remain compatible. `--host-version` remains explicit for operations whose compatibility result depends on a target WebTools product version. The deterministic scaffold form is `webtools-plugin create <directory> --host-version <version>` with optional `--id`, `--name`, `--description`, `--author`, and `--min-host-version`; omitted identity fields derive from the directory name, and `minHostVersion` defaults to the selected host version. A supplied minimum host version must not exceed the selected host version.

The package does not expose Electron, NativeHost, Store, SecretStore, or private install APIs. Host install continues to revalidate packages independently.

### Local distribution and external author flow

Keep the package private and distribute it as a local pnpm `.tgz` artifact. Do not publish to npm. The SDK package version becomes `1.1.0` for these compatible authoring additions. The following remain unchanged:

| Contract | Phase 6B value |
|---|---|
| WebTools Product Version | `0.1.0` from root `package.json` |
| Plugin API Major | `1` |
| Manifest Version | `1` |
| Declarative Plugin SDK | `1.1.0` |

No `workspace:` dependency or absolute WebTools checkout path may appear in the external author project. The documented bootstrap installs the supplied tarball into an isolated author-tooling directory to invoke `create`; the generated project then adds that same tarball as a local `devDependency`. Exact pnpm commands will be verified from an outside-repository acceptance directory before being called supported.

Generated project scripts will provide `pnpm run validate`, `pnpm run plugin:pack`, and `pnpm run inspect` after the local tarball is installed. The explicit `plugin:pack` script name avoids colliding with pnpm's built-in `pnpm pack` command, which creates the SDK's Node package tarball. TypeScript is author tooling only; it does not become a WebTools runtime dependency. The SDK tarball remains a local authoring artifact and is not added to the Phase 6A product artifact manifest or release pipeline.

### Safe `create` command and starter content

`create` will be deterministic and noninteractive. It will create one current-API `basic` declarative page template. The example default ID uses the `org.example.` namespace plus a normalized directory slug and is documented as a placeholder for an author's own namespace. The default display name is a humanized directory name. The existing Private Notes project remains the independent official example of the supported private-storage actions; it will not be multiplied into several near-identical templates.

The command will derive a valid example ID and display name from the requested child directory unless explicit values are supplied. The target must be a safe relative child path under the invocation directory. Rooted paths, traversal, invalid manifest values, reparse/symlink targets, and any already-existing file or directory are rejected. The command creates only fixed template files and validates the generated manifest with the canonical SDK parser before publishing the new directory. It does not invoke a shell or run generated content.

The starter contains only declarative manifest data, a TypeScript type-check description against the public SDK types, author scripts, a short README, `.gitignore`, and a `dist` output directory. The packer continues to include only manifest-declared files; TypeScript, package metadata, `node_modules`, `.git`, secrets, and `dist` are not packaged.

### Validation, packing, and inspection

- `validate` continues accepting source directories or `.wtplugin` files, checks the canonical SDK rules, and returns nonzero on failure.
- `pack` keeps the existing bounded source read, no-overwrite placement, final archive revalidation, and identity output (plugin ID/version, API major, path relative to the current directory, bytes, SHA-256). It does not claim byte-identical determinism beyond the existing same-input tests.
- `inspect` accepts only a `.wtplugin`, performs full bounded validation in memory, and reports the plugin ID, display metadata, versions, declared capabilities, size, SHA-256, and validation result. It does not extract files, install the package, or execute content.
- Stable error codes and exit behavior remain machine-usable. A JSON-output option will expose a bounded diagnostic/result record, and human diagnostics will include a safe relative file and logical Manifest field where the canonical parser can identify them. Raw source text, absolute author paths, stack traces, credentials, and arbitrary binary content are not emitted.
- Existing unknown privileged-field rejection, strict Manifest/API compatibility checks, package quotas, path rules, credential-like-content rejection, and no-overwrite semantics remain authoritative. Diagnostics must not weaken or bypass these checks.

## SDK ↔ Host Trust Boundary

The SDK is author feedback, not installation authorization:

```text
External author
    ↓
SDK public API / CLI validation and packing
    ↓
.wtplugin
    ↓
WebTools Main PluginManager revalidates
    ↓
Host consent, capability broker, declarative renderer
```

Keep the Host's independent install-time validation and consent flow. Add contract tests that compare acceptance/rejection of representative valid and hostile v1 fixtures through the SDK package and Host adapter. A package passing SDK checks must also pass Host validation; SDK-side acceptance must never create a bypass around Host validation.

## Declarative Security Boundary

Third-party packages remain declarative. They cannot ship or run arbitrary JavaScript, Node.js modules, Vue components, executable HTML, `eval`, Workers, child processes, raw filesystem access, raw Electron IPC, NativeHost pipes, or SecretStore access. A plugin declares a request; WebTools validates it and performs only supported host-owned actions under the existing permission/consent rules.

No new capability, permission, manifest field, API major, manifest version, runtime loader, product endpoint, or developer-mode bypass is introduced.

## Documentation and Capability Backlog

Expand `docs/plugin-development.md` as the complete developer entry point, preserving that existing path for compatibility. Add obvious links from the root README and `docs/README.md`. Cover local SDK acquisition, project structure, Manifest v1, declarative blocks/actions/capabilities, permissions and private storage, validation/pack/inspect, local installation, version compatibility, diagnostics, security, and troubleshooting. Update the Private Notes README to use the verified author flow and distinguish author tooling from host runtime behavior.

Create a small Phase 6C capability backlog artifact. It will record only capabilities that a concrete 6B developer workflow actually requests, with use case, current API gap, and likely permission/security sensitivity. Existing Shared AI, HTTPS open, and clipboard write support are not incorrectly listed as missing. If no new capability need emerges, the artifact will say so explicitly; Phase 6C design and implementation remain out of scope.

## Versioning, Dependencies, and Release Engineering

- Bump only `plugin-sdk/declarative-v1/package.json` from `1.0.0` to `1.1.0`.
- Keep root WebTools product version, Plugin API Major, and Manifest Version unchanged.
- Add no dependency, workspace, monorepo layout, product capability, or runtime package.
- Update documentation that states the current SDK version; preserve Phase 6A historical measurements and release evidence.
- Keep `release:preflight`, `release:build`, and `release:verify` behavior intact. Do not add the local SDK tarball to product release contents or publish it.

## Verification and Acceptance

Phase 6B verification will include:

1. Focused SDK, CLI, packer, diagnostics, create-safety, inspect, and SDK↔Host contract tests.
2. A clean external author directory installed from the SDK `.tgz`, with dependency resolution checked for absence of repository/workspace links or `NODE_PATH` reliance. Run create → install local SDK dependency → frozen pnpm install → typecheck → validate → pack → inspect → final archive validate.
3. Verify the external package's filename, byte count, and SHA-256; confirm SDK validate/inspect and Host validation agree on plugin ID, version, API major, and manifest version. Record create/validate/pack/inspect duration as observations only, without adding an arbitrary performance threshold.
4. Existing negative coverage plus focused cases for invalid IDs/versions/unknown fields, unsafe create target, corrupt/truncated/duplicate archive inputs, collisions, size/count bounds, missing/invalid PNG, and invalid inspection input.
5. `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, NativeHost Checks, UpdateHelper Checks, SDK/package acceptance, `git diff --check`, and the release-contract checks required by current repository acceptance.
6. A short user-facing manual developer checklist for installation through Plugin Center using an isolated/test plugin. The CLI must never install into the user's production profile.

Do not repeat long NativeHost stress/soak tests unless product lifecycle code changes or a concrete regression requires them. Phase 6B must not modify `D:\webtools`, `%APPDATA%\Nook`, credentials, real favorites, settings, or production plugins.

## Out of Scope

- Phase 6C and all new plugin capabilities.
- Executable plugin code or unrestricted developer mode.
- npm publication, marketplace publication, product release, or SDK inclusion in release artifacts.
- WebTools product/API/Manifest version changes.
- Host install authorization changes or product UI redesign.
- New dependencies, package workspaces, monorepo conversion, or unrelated refactors.

## Git Closeout

After engineering verification and review, create one Phase 6B checkpoint commit and normally push the current branch. Stage only Phase 6B implementation, tests, examples, and documentation. Preserve the four pre-existing Launcher-task modifications identified at the Phase 6A baseline; never stage or include them. Do not force-push, merge, create a PR, tag, GitHub Release, npm publication, or begin Phase 6C.

## Open Review Notes

- The exact public function signatures and argument parser structure will be locked in the implementation plan after this design is approved.
- The local tarball bootstrap commands must be exercised with the pinned pnpm version before documentation claims they work.
- Windows manual GUI installation remains user acceptance; automation must not claim physical UI verification.
