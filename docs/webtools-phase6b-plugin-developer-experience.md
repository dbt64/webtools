# WebTools Phase 6B — Plugin Developer Experience

**Scope:** one standalone declarative plugin SDK package and a supported external-author workflow. Phase 6C is not started by this work.

## Status

Implementation, automated verification, and the Task 7 review are complete. The real Plugin Center file picker, consent, enable/render, and uninstall flow still requires the user's manual Developer Workflow Acceptance; no UI pass is claimed here.

**Current result:** `AUTOMATED IMPLEMENTATION / WORKFLOW PASS — MANUAL DEVELOPER WORKFLOW ACCEPTANCE REQUIRED`

## Locked contract preserved

- One standalone `@webtools/plugin-sdk` package, version `1.1.0`, locally distributed as `.tgz`; no workspace/monorepo and no npm publication.
- One `basic` declarative starter. Private Notes remains a separate official example and retains its own plugin-private storage declaration.
- WebTools product version remains `0.1.0`; Plugin API major remains `1`; Manifest version remains `1`.
- No Host capability, permission, Manifest field, runtime privilege, product UI, dependency, or user-data schema was added.
- SDK validation and packaging are author feedback. The WebTools Host install-time validator, file picker, integrity checks, consent, grants, and lifecycle remain authoritative.
- Plugin source and package contents are never executed by the SDK CLI or by this workflow.

## Source and external workflow identity

- Source branch at start: `codex/shared-ai-translation-2.0`.
- Base commit at start: `f0a3d4278e725f2e88745205f2e1dd32d53bb46e`; Phase 6B was verified from the working tree on top of that source. The resulting checkpoint SHA is reported in the implementation closeout.
- Runtime: Node `v24.21.0`; pinned pnpm `9.15.9`; product Host `0.1.0`.
- SDK package: `@webtools/plugin-sdk@1.1.0`; SDK tarball `webtools-plugin-sdk-1.1.0.tgz`, 20,575 bytes, SHA-256 `ef5f4023c639479bb56fbf6ea4731406dc1ea2cadbe30a331fa903c7a9a9c264`.
- External project package: `org.example.author.project@1.0.0`, Manifest 1, API major 1, minimum Host `0.1.0`; archive `author-project.wtplugin`, 451 bytes, SHA-256 `ef2021a0f97dba1c3010d5aaaf016966db9423c97335dfdfb7db8d2c8c76bf25`.
- External workflow evidence: `D:\系统缓存\webtools-phase6b-sdk-workflow-Vnh02T\workflow-report.json`, outside the repository. The runner writes a unique isolated evidence directory for each run and retains it for review.

The workflow packed the SDK from the repository package into the temporary `artifacts/` directory, installed that local tarball as the only direct tooling dependency, invoked its installed public CLI to create the basic project, installed the same `.tgz` in the generated project, performed a frozen pnpm install, typechecked, validated source, packed, inspected, and validated the final archive through the installed SDK public API and Electron Host adapter. The dependency graph and lockfile contained no repository/workspace link or absolute local package source; the `file:` tarball resolved beneath the temporary evidence root. Child processes used pinned pnpm or the current Node executable with both `NODE_PATH` and `NODE_OPTIONS` removed.

### Recorded external commands

All commands completed successfully in the latest run:

```text
pnpm --version
pnpm pack --pack-destination <OS_TEMP>/artifacts
node --version
pnpm install --no-frozen-lockfile --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts
node <installed-tarball-cli> create author-project --host-version 0.1.0 --json
pnpm add --save-dev --ignore-scripts file:../../artifacts/webtools-plugin-sdk-1.1.0.tgz
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run validate
pnpm run plugin:pack
pnpm run inspect
pnpm list --depth 1 --json
```

The workflow records command durations as observations only; no performance threshold is used. SDK public API and Host adapter agreed on basic and PNG-bearing valid packages and rejected the representative unknown privileged field/capability, incompatible API/minimum Host, unsafe path/collision, and malformed ZIP cases.

## Implementation summary

- Added the SDK root authoring facade and type declarations for source validation, archive validation, and deterministic packing; added field-aware known Manifest diagnostics without changing validation rules.
- Added strict `create`, `validate`, `pack`, and `inspect` CLI behavior, safe human/JSON diagnostics, non-overwriting packaging, and a single safe basic starter.
- The generated starter README now uses the correct `../../artifacts/` path for the documented `plugin-workspace/{artifacts,tooling/basic-plugin}` layout. Non-Latin directory names receive a deterministic short hash in their derived default ID instead of colliding at `org.example.plugin`.
- Starter file creation rechecks target identity and resolved destination after opening each output file and before writing, and cleanup remains restricted to file identities created by this invocation.
- `inspect` accepts only `.wtplugin`, reads no more than the archive size limit plus a one-byte growth check, fully validates in memory, returns bounded metadata/size/SHA-256, and never extracts or executes content.
- Added an external workflow verifier with explicit temp-root/layout guards, subprocess allowlist, `NODE_PATH` and `NODE_OPTIONS` removal, dependency independence checks, SDK/Host parity checks, and retained report output outside the repository.
- Updated SDK and Private Notes instructions, the plugin development guide, root/docs discovery links, and the current SDK version in the release contract documentation.
- Added this Phase 6B report and a Phase 6C capability backlog that records no concrete gap identified by the workflow.

## Task 7 Verification

- Public SDK and TypeScript contract: focused tests and declaration compile passed during Task 1.
- CLI diagnostics/options and legacy pack compatibility: focused tests passed during Task 2.
- Starter creation/safety: 8/8 focused tests passed, including the documented tarball relative path and distinct deterministic IDs for non-Latin names.
- Archive inspection: 8/8 focused tests passed; corrupt, oversized, duplicate/colliding, credential-like, incompatible, and wrong-extension inputs were rejected without modification or extraction.
- Task 5 workflow guards plus runtime parity, inspect/CLI/API/create suites: 37/37 passed; `pnpm run typecheck` passed.
- `pnpm install --frozen-lockfile`: PASS.
- `pnpm run typecheck`: PASS.
- `pnpm test`: 359/359 PASS.
- `pnpm run build`: PASS (Electron Main, preload, and Vue Renderer).
- NativeHost Checks: 68/68 PASS. UpdateHelper Checks: 10/10 PASS.
- External local `.tgz` workflow: PASS, including frozen installs in the tooling and generated project, author TypeScript check, source validation, pack, inspect, external SDK public API validation, and Host validation.
- `pnpm run release:preflight -- --channel beta --allow-dirty`: PASS; build is a dirty development candidate and not RC eligible.
- `pnpm run release:build -- --channel beta --allow-dirty`: PASS. The current Phase 6A release path produced an isolated beta artifact set and passed same-directory cover-install ordering, Chinese/space path install, Manager discovery, and self-uninstall Smoke. It did not target `D:\webtools` or `%APPDATA%\Nook`.
- Release candidate directory: `D:\System default\Desktop\HomePage\release\WebTools-0.1.0-beta-f0a3d4278e72-dirty-20261006T060310787Z`; installer: `installer\WebTools-Setup-0.1.0-beta.exe`. This ignored build output is not a production release.
- Existing Node test runs emit the repository's `MODULE_TYPELESS_PACKAGE_JSON` warnings in TypeScript-backed tests and one test logged that WebSocket port 24678 was already in use; the test suite still completed successfully and these are outside Phase 6B scope.
- NSIS emitted warning 9100 because the Simplified Chinese installer version resource has no `LegalCopyright` key; packaging and Smoke passed. No Phase 6B release-script or installer changes were made.

## Files in scope

Phase 6B changes are limited to the SDK facade/types/parser/CLI/starter/inspection code and tests, the external workflow runner and tests, the SDK/Private Notes/developer documentation, root/docs links, release SDK version row, this report, and the Phase 6C backlog. Four pre-existing Launcher modifications are preserved separately and must remain unchanged and unstaged.

## Manual Developer Workflow Acceptance still required

- Obtain the SDK 1.1.0 `.tgz` from the reviewed test build/output.
- In a fresh directory outside the checkout, follow `docs/plugin-development.md` using only that tarball; verify create, frozen install, typecheck, validate, pack, and inspect.
- In a test WebTools profile, install the resulting `.wtplugin` through the normal Plugin Center file picker; review and grant the existing `manager.page` consent, enable it, confirm the basic page renders, and uninstall it.
- Confirm this declarative plugin does not execute plugin-supplied JavaScript and that the normal Host install-time validation/consent remains in effect.
- Private Notes UI/storage acceptance is optional for the basic starter flow; it remains a distinct example.

## Findings

- **P0:** 0.
- **P1:** 0.
- **Blocking P2:** 0.
- **P2 fixed during final review:** The generated README previously pointed one directory too shallow for the documented external layout; it now points to `file:../../artifacts/...` and has a regression assertion.
- **P3:** Same-user concurrent replacement of a verified directory with a junction in the final path-check/write interval is not fully preventable with portable path-based Node filesystem APIs. Static symlink/junction paths are rejected; creation now revalidates the opened file’s path and identity before writing and cleans only owned identities. The remaining race requires concurrent local filesystem mutation and grants no privilege; create starters in a directory not being modified concurrently.
- **P3:** Existing `MODULE_TYPELESS_PACKAGE_JSON` and NSIS warning 9100 remain informational; their commands completed successfully.

## Phase boundary

Phase 6B does not authorize capability expansion, npm publication, a product runtime change, or Phase 6C. Stop after the implementation checkpoint and wait for manual Developer Workflow Acceptance.
