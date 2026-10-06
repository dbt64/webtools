# WebTools Release Build & Version Contract

**Phase:** 6A — Release Engineering & Version Contract
**Current product version:** `0.1.0`
**Signing:** unsigned (Phase 6A does not add or simulate Authenticode signing).

## Version contract

The root `package.json` `version` is the single source for the WebTools product version. Electron Manager obtains its application version from Electron's packaged app version, which electron-builder derives from that same root manifest. The Windows build script injects that value into NativeHost and UpdateHelper assembly/informational versions and checks their PE version resources. .NET writes its `FileVersion` as `major.minor.patch.0` and `ProductVersion` as the exact product SemVer; electron-builder currently writes the Manager PE resources as `FileVersion=major.minor.patch` and `ProductVersion=major.minor.patch.0`. The build validates both Manager resource values against those allowed numeric forms while the app package version remains sourced from the root manifest. NSIS receives the same version, writes it to installer version resources, uses it in the installer filename and records it as the uninstall `DisplayVersion`. The release CLI verifies the source wiring before it starts a build.

The first Phase 6A audit found version drift: Manager/package was `0.1.0`; NativeHost and UpdateHelper used MSBuild defaults (`1.0.0`/`1.0.0.0`); NSIS had a hard-coded `WebTools-Setup-0.1.0.exe` name without the matching product/display version contract. Phase 6A makes the root manifest authoritative and adds build-time component checks; it does not bump the current product version.

| Version | Current value/source | Meaning |
|---|---|---|
| WebTools Product Version | `0.1.0`, root `package.json` | Version of the installed product and Manager/NativeHost/UpdateHelper/installer. |
| Plugin API major | `1`, published SDK constants, host runtime and registry checks | Compatibility boundary for host capabilities. It changes only for a breaking plugin API contract. |
| Plugin Manifest version | `1`, SDK/runtime/schema/types | Declarative manifest schema revision. It changes only when manifest compatibility requires it. |
| Plugin SDK version | `1.1.0`, `plugin-sdk/declarative-v1/package.json` | Authoring/validator SDK package SemVer, independently released from WebTools and distributed locally as a `.tgz`; not published to npm. |

Product releases do not implicitly change Plugin API or Manifest versions. The current host and SDK accept API major 1 and manifest version 1; unsupported future majors/manifest versions continue to be rejected (fail closed). `minHostVersion` is compared with the installed product version. A future API expansion must explicitly state backward compatibility and supported versions.

There is no dedicated About/diagnostics version panel in the current UI. Phase 6A does not add a settings page solely to display build identity; the release artifact's `metadata/build-info.json` is the read-only source for build support details.

### WebTools SemVer policy

- **PATCH:** compatible bug fixes, security fixes and packaging corrections that do not change a documented interface or user-data contract.
- **MINOR:** additive user-facing features (including a new built-in plugin or Launcher feature), compatible plugin/API expansion, and non-breaking installer behavior changes.
- **MAJOR:** breaking product behavior, persisted-data incompatibility, or a breaking installer/update contract after stable 1.0.0. A plugin API break also increments Plugin API major; it does not reuse the product version number as the API number. Before 1.0.0, a breaking change needs an explicit migration note and a product minor increment; it must not be hidden in a patch.
- **Prereleases:** SemVer prerelease identifiers order `alpha` → `beta` → `rc` → final for the same core version. The build foundation currently supports only `stable` and `beta` channels. Prerelease versions are accepted only on `beta`; alpha/rc delivery policy remains for a future release-channel design. Build metadata (`+...`) does not change precedence.
- Plugin API backward-compatible additions keep the same API major and are reflected in SDK/package versioning. Breaking capability or data contracts require a new API major and a compatibility/migration plan. Manifest changes increment Manifest version only when older schema readers cannot safely interpret the new representation.

## Build identity and metadata

Each release directory has a machine-readable `metadata/build-info.json` with schema version, product version, full Git commit SHA, source-dirty flag, UTC build timestamp, channel, target platform/architecture, Plugin API major, Manifest version, SDK version, candidate eligibility, and signing state. The schema is exact and bounded. It excludes absolute paths, usernames, machine identity, user profiles, tokens and secrets.

Clean source is required by default. An explicit `--allow-dirty` is accepted only with `--channel beta`; the metadata marks `sourceDirty: true` and `releaseCandidateEligible: false`. Dirty builds have a timestamped directory identity so they cannot overwrite a previous local test. A clean stable or beta build may be treated as a release candidate after all other gates pass; beta is not a claim of publication or signature.

## Toolchain contract

Build and installer smoke are Windows x64 operations. The current repository contract requires:

- Node.js `>=20.19` (the plugin SDK engine floor); use the installed Node release recorded by the build environment.
- pnpm exactly `9.15.9`, pinned in root `package.json` as `packageManager` and validated by the packaging script.
- .NET SDK 10 for NativeHost/UpdateHelper and their checks.
- Windows PowerShell 5.1 (`powershell.exe`) for the existing NSIS/native packaging orchestration.
- Electron, electron-vite, electron-builder, TypeScript and test dependencies as resolved in `pnpm-lock.yaml`; current lock resolves Electron `44.4.5`, electron-vite `5.0.0`, electron-builder `26.15.3`.
- The NSIS compiler cache provisioned by electron-builder. The build script currently locates its Windows `makensis.exe` from that cache.

Do not independently upgrade a tool or dependency to repair a release build without an approved dependency change. Use the lockfile and package-manager pin. The release preflight checks Windows x64, Node floor, .NET 10, PowerShell, lockfile format, dependencies, product/plugin versions, source state and output safety.

## Commands

From a clean checkout at the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm run release:preflight
pnpm run release:build
```

For an explicitly marked dirty local smoke build only:

```powershell
pnpm run release:preflight -- --channel beta --allow-dirty
pnpm run release:build -- --channel beta --allow-dirty
```

The build composes existing checks and packaging rather than replacing the Native/Electron pipeline. It runs TypeScript checks, Node tests, the Electron Manager build, NativeHost and UpdateHelper checks, self-contained NativeHost/UpdateHelper publishing, electron-builder's Windows `win-unpacked` output, NSIS compile, cover-install ordering smoke, isolated Unicode/space-path installation, Manager discovery and isolated self-uninstall. It does not launch or overwrite a production installation.

Verify a generated artifact directory by passing its path under repository `release/`:

```powershell
pnpm run release:verify -- release/WebTools-0.1.0-stable-<commit>
```

The verifier checks directory identity, exact metadata schema, required artifact list, relative-path safety, byte sizes and SHA-256 values. It rejects targets outside `release/`, symlink/reparse-like directory identity at the target, absent files and modified artifacts. `release/` is gitignored; generated binaries, intermediate output and evidence remain local.

The existing `pnpm run package:win` remains the timestamped package/install smoke entry point. Use `release:build` for a versioned artifact set with metadata and hashes.

## Artifact layout

For example, a clean beta build from commit `abcdef...` is stored under:

```text
release/
  WebTools-0.1.0-beta-abcdef123456/
    installer/WebTools-Setup-0.1.0-beta.exe
    components/
      native/WebTools.NativeHost.exe
      native/WebTools.NativeHost.dll
      update-helper/WebTools.UpdateHelper.exe
      manager/WebTools.exe
      manager/resources/app.asar
    metadata/build-info.json
    checksums/artifact-manifest.json
    evidence/verification.json
    release-notes.md
```

`artifact-manifest.json` lists slash-separated paths, byte size and lowercase SHA-256 for the installer, NativeHost EXE/DLL, UpdateHelper, Manager executable and packaged `app.asar`. Hashes are computed after packaging (and, in a future signed pipeline, after signing). The build refuses to overwrite an existing identity. A failed build may leave its uniquely named ignored work directory for diagnosis; no existing output is recursively removed.

## Build repeatability and reproducibility

The goal is a **repeatable build**: a clean checkout with the documented locked toolchain runs the same validation and packaging steps and produces a functionally equivalent installable artifact. Phase 6A does not claim byte-identical reproducibility. Native compiler metadata, Electron packaging/ASAR ordering, installer compression and timestamps can produce different bytes. No two-clean-build bitwise comparison was made for this implementation. The manifest proves the identity and hashes of one particular artifact set, not that another build will have identical hashes.

## Signing design

Phase 6A outputs and labels builds as `unsigned`. It does not create a self-signed certificate or request/store a real signing secret. A future signed pipeline should sign the distributed PE files (NativeHost executable and DLL, UpdateHelper executable, Manager executable and other shipped PE binaries) before installer compilation, sign the final installer after NSIS, then generate the final SHA-256 manifest and verify signatures/hashes. Certificate identity, timestamp service, secret provider and signing authorization must be separately approved. The manifest must never represent a signature that was not verified.

## Upgrade, uninstall and rollback contract

The installer keeps the established install path for an update and completes the old-uninstall/new-install sequence before replacing files. WebTools user state is under the user's `%APPDATA%\Nook`, outside the install tree. It includes Favorites/websites, settings, plugin registry/private plugin data, built-in plugin state, shared AI configuration and SecretStore. An upgrade must preserve these records and preserve the user's startup preference. The installer may replace app binaries and shortcuts; uninstall removes the selected installation's binaries, shortcuts, uninstall registration and startup registration, but must not recursively delete `%APPDATA%\Nook`. User-selected app uninstall is distinct from data retention; any future “remove my data” action must be explicit and separately confirmed.

Rollback policy for 6A is operational, not automated: retain the previous known-good installer outside the overwritten install directory; reinstalling an older version is allowed only when the on-disk data schema remains backward compatible. If a newer build migrated data incompatibly, do not claim downgrade safety; preserve a backup and use a forward fix or a schema-aware recovery plan. Failed/interrupted installation retry behavior remains governed by the existing installer/UpdateHelper protocol. An automatic rollback engine is deferred to Phase 6F.

## Release notes template

Use [release-notes-template.md](release-notes-template.md) for a specific release. Phase 6A does not invent user-facing release notes or announce publication.

## Current limitations

- Artifacts are unsigned; Windows SmartScreen/publisher identity is not addressed here.
- Stable/beta are build labels only. There is no online channel feed, update service or public release workflow.
- The package smoke validates installer ordering, isolated layout, Manager discovery and self-uninstall. It does not substitute for physical tray/hotkey/UI acceptance, a real-user upgrade, or verification against production user data.
- No About/Diagnostics UI surface currently exposes commit/channel; build support identity is in the artifact metadata.
- Bit-for-bit reproducibility is unknown and not claimed.
