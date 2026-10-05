# WebTools Phase 6 Master Plan

**Purpose:** guide the next product cycle after the Native-first migration and declarative plugin foundation. This file defines phase boundaries and gates; only Phase 6A has an approved, implemented scope at this checkpoint. The later phases are planning placeholders, not completed designs or implementation authorization.

## Phase map

| Phase | Goal | Status / dependency |
|---|---|---|
| 6A — Release Engineering & Version Contract | Establish a canonical product version, traceable Windows build identity, safe artifact layout, hash verification and documented release process. | Complete at this checkpoint; 6B planning requires separate user approval. |
| 6B — Plugin Developer Experience | Improve the workflow for authoring, validating and testing declarative plugins with the public SDK. | Planned; depends on 6A contracts and a separately reviewed plan. |
| 6C — Plugin Capability Expansion | Evaluate any proposed declarative capability against least privilege, consent, validation and compatibility boundaries. | Planned; depends on the 6B workflow and an explicit capability design. |
| 6D — First-party Plugin Expansion | Add first-party functions only where plugin contracts provide a safe fit and existing product behavior remains covered. | Planned; depends on 6C decisions and per-feature acceptance. |
| 6E — Launcher 2.0 | Consider a separately designed next iteration of the Native Launcher and its discovery experience. | Planned; requires product/UI design and compatibility review. |
| 6F — Update & Release Channels | Design stable/beta delivery and update behavior using the build identity and upgrade contract from 6A. | Planned; depends on 6A and a dedicated update/security design. |
| 6G — Performance & UX | Address measured performance or UX issues after the relevant baselines and product requirements are approved. | Planned; requires evidence and a bounded optimization plan. |
| 6H — Final Acceptance | Integrate approved Phase 6 work and perform release, security, upgrade and Windows acceptance. | Planned; depends on the scopes actually approved for earlier phases. |

## Phase 6A — Release Engineering & Version Contract

### Goal

Make a Windows build traceable to a canonical product version and source revision, and make the output set verifiable without claiming a signed or bit-for-bit reproducible release.

### In scope

- Canonical product version from the root `package.json`.
- Explicitly independent Plugin API major, plugin manifest version and SDK package SemVer.
- Stable/beta release-channel metadata and dirty-source development-build labeling.
- Windows component/installer version propagation and checks.
- Safe, non-overwriting release output under ignored `release/`.
- Build-info JSON, SHA-256 artifact manifest and a verification command.
- Release build documentation, a release-notes template and regression/package smoke.

### Out of scope

- Online updates or release servers, automatic rollback engine, public distribution, GitHub Release, PR/merge/tag, npm publication, certificate purchase or signing secrets.
- Plugin DX/capability work, new built-ins, Launcher 2.0, product architecture changes or unrelated performance work.

### Security boundaries

- Release CLI arguments and package version are validated before they reach MSBuild, NSIS or filesystem paths; child processes are invoked without shell interpolation.
- Output is derived beneath repository `release/`, refuses an existing identity, and never deletes an unknown directory.
- Metadata is bounded and excludes local paths, usernames, credentials and user profiles.
- Builds are unsigned in 6A. Dirty source is allowed only by explicit beta development mode and cannot be marked candidate-eligible.
- Installer smoke uses the existing isolated temporary profile/registry identity; it must not target `D:\webtools` or `%APPDATA%\Nook`.

### Acceptance criteria

1. Product version has one declared source and Manager, NativeHost, UpdateHelper and installer metadata agree with it.
2. Plugin API, manifest and SDK versions are validated independently; unsupported plugin contracts continue to fail closed.
3. Stable/beta, clean/dirty and Windows x64 build identity are explicit.
4. A release directory contains the installer, required component files, build metadata, release notes, verification evidence and SHA-256 manifest.
5. Verification rejects changed, absent, duplicated or unsafe artifact paths.
6. Typecheck, Node tests, Electron build, NativeHost/UpdateHelper checks and isolated Windows package/install smoke pass.
7. Code-signing integration is documented without manufacturing a signing pass.
8. No online update system or Phase 6B implementation is started.

### Expected artifacts

- `docs/phase6-master-plan.md`
- `docs/release-build.md`
- `docs/release-notes-template.md`
- `scripts/release-contract.mjs` and tests
- `scripts/release-build.mjs`
- A local, ignored release artifact directory when a candidate build is generated.

### Transition gate

Phase 6A may be closed only after its regression and isolated package smoke pass, the metadata and artifact hashes verify, and its checkpoint is reviewed. This does not approve Phase 6B implementation; Phase 6B requires its own design and authorization.

## Future phase boundaries (not approved for implementation)

### Phase 6B — Plugin Developer Experience

- **Goal:** make the existing declarative SDK workflow easier to discover and operate.
- **In scope:** plan and evaluate authoring, local validation, examples and diagnostics around the existing contract.
- **Out of scope:** publishing to npm, executing JavaScript plugins, adding host capabilities or changing Manifest/API contracts by implication.
- **Dependencies:** Phase 6A release/version contract; separate approval.
- **Security:** keep packages declarative, validate before install and preserve least privilege.
- **Acceptance:** a future plan must define the developer workflow, compatibility and security tests.
- **Expected artifacts:** to be decided in the 6B plan.
- **Transition gate:** reviewed 6B criteria pass before considering 6C.

### Phase 6C — Plugin Capability Expansion

- **Goal:** decide whether the declarative host needs additional bounded capabilities.
- **In scope:** capability-specific threat models, contracts and tests.
- **Out of scope:** arbitrary code execution, raw Node/filesystem/IPC access, unreviewed secret access.
- **Dependencies:** Phase 6B workflow and explicit capability proposal.
- **Security:** every new capability must be host-mediated, validated and consented where appropriate; unknown capability/API versions remain rejected.
- **Acceptance:** each capability needs negative tests and compatibility rules.
- **Expected artifacts:** only those approved by its future plan.
- **Transition gate:** explicit security/product review before 6D.

### Phase 6D — First-party Plugin Expansion

- **Goal:** evaluate additional built-in experiences on the established plugin foundation.
- **In scope:** individually specified built-in modules and migration/rollback decisions.
- **Out of scope:** migrating existing features merely for architectural uniformity or changing persistence without a separate decision.
- **Dependencies:** 6C contract decisions, where relevant, and per-feature product approval.
- **Security:** preserve host ownership of built-ins, user data and shared AI/secret services.
- **Acceptance:** feature parity, settings/data compatibility and disable/restore behavior must be specified per module.
- **Expected artifacts:** future feature plans and acceptance evidence.
- **Transition gate:** only completed, approved modules can enter 6E integration.

### Phase 6E — Launcher 2.0

- **Goal:** explore a next Launcher iteration based on explicit usability requirements.
- **In scope:** separately approved search, layout and interaction design.
- **Out of scope:** changing established hotkey, hide, drag or NativeHost lifecycle behavior without dedicated approval.
- **Dependencies:** product design and an implementation plan; no automatic dependency on plugin changes.
- **Security:** retain Main/NativeHost ownership of privileged discovery and launch actions.
- **Acceptance:** a future plan must include existing Launcher parity and Windows UI checks.
- **Expected artifacts:** design, implementation plan and acceptance report.
- **Transition gate:** parity and regression acceptance before integration.

### Phase 6F — Update & Release Channels

- **Goal:** design stable/beta delivery and update behavior using 6A build identity.
- **In scope:** future channel discovery, package validation, upgrade UX and rollback implementation decisions.
- **Out of scope:** online update service in 6A, silent background updates without approval, or installer changes without a dedicated threat model.
- **Dependencies:** 6A version/build contract and a separate updater design.
- **Security:** verify origin and integrity, target only the owning installation and preserve user data.
- **Acceptance:** future tests must cover downgrade, interrupted updates, retry, isolation and data preservation.
- **Expected artifacts:** dedicated 6F design/plan and later implementation artifacts.
- **Transition gate:** update threat model and isolated Windows upgrade tests pass.

### Phase 6G — Performance & UX

- **Goal:** improve measured performance or UX with bounded evidence.
- **In scope:** only individually approved findings with reproducible baselines.
- **Out of scope:** speculative optimization, weakening functionality or changing architecture without evidence.
- **Dependencies:** measurement and product-specific approval.
- **Security:** preserve IPC, plugin and filesystem boundaries while optimizing.
- **Acceptance:** compare before/after using the same scenarios and retain functional regression coverage.
- **Expected artifacts:** findings, targeted changes and measurements.
- **Transition gate:** no unresolved regression or sustained resource issue before 6H.

### Phase 6H — Final Acceptance

- **Goal:** verify the approved Phase 6 release candidate as a whole.
- **In scope:** documented build, plugin compatibility, installer/update, data preservation, security and Windows manual acceptance.
- **Out of scope:** adding new features during acceptance or declaring tests that were not run as passing.
- **Dependencies:** only the Phase 6 work formally included in the candidate.
- **Security:** isolated test install/profile, exact process/path identity and no real secrets.
- **Acceptance:** a future matrix must identify source/build identity and distinguish automated, real-installed and user-confirmed evidence.
- **Expected artifacts:** final acceptance report and release decision.
- **Transition gate:** explicit release approval; no automatic publication.
