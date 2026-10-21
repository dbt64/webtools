# Phase 6F-5 — SDK / Developer Workflow Synchronization

## Goal

Ship the already-reviewed Phase 6F-4D configuration and Phase 6F-4E optional theme contracts through repeatable local SDK/creator tarballs, then prove the documented author workflow from outside the WebTools checkout.

## Frozen boundaries

- Keep one `@webtools/plugin-sdk` package, the standalone `create-webtools-plugin`, the declarative v1 generator, and the existing Private Notes v1 example.
- Keep the Host install-time validator as the final package authority. SDK and creator checks are author feedback only.
- Theme remains optional. Add one static CSS subpath, `@webtools/plugin-sdk/theme.css`, that explicitly consumes the frozen `--webtools-color-*` tokens. No JS theme API, permission, manifest field, UI kit, or forced plugin migration.
- Generated Manifest v3 front ends may import the stylesheet; plugin authors retain control over layout and component styling. v1 declarative pages remain Host-rendered.
- Local tarballs only. No npm/Marketplace publication, product version change, Manifest/API-major change, Phase 6G, installer build, commit, or push.
- Preserve all pre-existing dirty worktree content; make no broad Git staging or cleanup changes.

## Implementation sequence

1. Add focused regression assertions for SDK package export/inventory, optional theme stylesheet behavior, and generated Web/Node × Vanilla/Vue/React/Svelte starters.
2. Add the CSS helper and export it from the single SDK package; update all v3 creator entries to import it and retain author-owned feature CSS.
3. Version the additive SDK and creator package changes; update current author instructions and Private Notes references without rewriting historical phase reports.
4. Pack SDK and creator tarballs into ignored `release/phase6f5-developer-tools/`; record package metadata, inventory, size, and SHA-256.
5. Install only those tarballs in a fresh external temporary author directory. Generate starter projects, frozen-install, typecheck, build, validate, pack, inspect, and pass representative `.wtplugin` output through the production Host validator.
6. Record commands, results, evidence limits, and the user-facing manual Developer Workflow acceptance checklist in the Phase 6F-5 report.

## Acceptance

- Package tarballs contain exactly the declared SDK/creator source surfaces, with matching package identity/version.
- External author projects resolve the local tarballs without importing monorepo paths or using a workspace link.
- All four frameworks and both Web/Node starter modes can be generated and built; SDK validation, packing, inspection, and Host validation pass for representative output.
- The CSS helper is opt-in, only consumes documented color semantics, and does not impose layout/component rules.
- P0/P1/blocking P2 are zero; any user-only manual step remains explicitly `MANUAL VERIFICATION REQUIRED` until the user confirms it.
