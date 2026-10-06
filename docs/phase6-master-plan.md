# WebTools Phase 6 Master Plan

**Purpose:** guide the product cycle after the Native-first migration and declarative plugin foundation. This file preserves the original Phase 6A history and tracks the current phase status. Phase 6A and 6B are complete; Phase 6C architecture is frozen as design only; Phase 6D is not started and requires separate implementation authorization.

## Phase map

| Phase | Goal | Status / dependency |
|---|---|---|
| 6A — Release Engineering & Version Contract | Establish a canonical product version, traceable Windows build identity, safe artifact layout, hash verification and documented release process. | COMPLETE; historical acceptance record retained below. |
| 6B — Plugin Developer Experience | Improve the workflow for authoring, validating and testing declarative plugins with the public SDK. | COMPLETE; see the Phase 6B report. |
| 6C — Plugin Platform Architecture | Audit and freeze the Feature, Context, Manifest v2, projection and sandboxed Web Plugin runtime design. | Phase 6C-1 COMPLETE; 6C-2 APPROVED WITH DESIGN REVISIONS; 6C-3 COMPLETE. Design only. |
| 6D — Web Plugin Runtime & Feature Integration | Implement the frozen Web Feature architecture in the approved dependency order. | NOT STARTED; requires separate implementation authorization and all mandatory security gates. |
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

Historical Phase 6A transition gate: 6A was closed only after its regression and isolated package smoke passed, metadata and artifact hashes verified, and its checkpoint was reviewed. That gate did not itself authorize Phase 6B; Phase 6B was later separately designed, approved and completed as recorded below.

## Phase 6B–6D status and boundaries

### Phase 6B — Plugin Developer Experience

- **Status:** COMPLETE. The standalone SDK 1.1.0 workflow, starter, pack/inspect path, external author workflow and manual acceptance are recorded in [the Phase 6B report](webtools-phase6b-plugin-developer-experience.md).
- This completed phase did not authorize a runtime implementation. Preserve the independent Product Version, Plugin API major, Manifest version and SDK package version domains.

### Phase 6C — Plugin Platform Architecture

- **Status:** architecture frozen, design only. Phase 6C-1 audit, 6C-2 specification and approved 6C-3 revisions are linked from [the architecture freeze](phase6c-architecture-freeze.md).
- **Frozen scope:** Plugin/Feature separation, shared Native Feature registry/projection/matcher/context model, immutable Manifest v1 with one synthetic compatibility Feature, Manifest v2 Web Feature packages, one NativeHost process, on-demand Manager and sandboxed one-at-a-time Web runtime.
- **No Phase 6C production implementation is included in this checkpoint.** WASM remains browser-side computation, not a Host capability. Business algorithms remain in plugins. The freeze report is authoritative for capacity, clipboard, network, compatibility and security-gate details.

### Phase 6D — Web Plugin Runtime & Feature Integration

- **Status:** NOT STARTED. This is the implementation phase for the frozen Web Feature platform, not a first-party feature migration.
- **Authorization:** Phase 6C-3 freezes design only. Phase 6D production work requires a separate explicit approval.
- **Dependency order and acceptance:** follow the 17-step order and four mandatory security gates in [phase6c-architecture-freeze.md](phase6c-architecture-freeze.md). network.mode none may proceed independently; network.domains remains disabled until its connection-level enforcement gate passes.
- **Boundary:** no new resident helper process, no Web runtime in the Launcher, no hidden runtime pool, no expanded Host business-algorithm API, and no change to existing search command behavior.

## Future phase boundaries

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
