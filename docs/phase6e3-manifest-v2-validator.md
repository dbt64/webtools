# Phase 6E-3 Manifest v2 Host Validator

## Status

**PHASE 6E-3 IMPLEMENTATION COMPLETE**
**INERT MANIFEST V2 PACKAGE VALIDATION PASS**
**READY FOR NEXT PHASE PLANNING**

This phase validates package bytes and metadata only. A package that passes 6E-3 has passed structural/package-integrity validation only; **validated package ≠ safe executed package**. It has not passed Gate 1, and no Web Plugin code may be executed on the strength of this result.

## Scope

Implemented a strict Manifest v2 parser, exact package inventory and bounded ZIP validation, immutable normalized results, a narrow Main install-entry adapter, and advisory SDK archive preflight. Manifest v1 parsing, bytes, authoring, packing, adapter and persisted registry remain v1.

No WebContentsView, plugin window/session/protocol/preload/bridge, runtime state machine, Gate 1, Gate 4, NativeHost changes, Projection v2 changes, dependency additions, or third-party execution were added.

## Repository Baseline

- Branch: `codex/shared-ai-translation-2.0`
- HEAD before implementation: `62b9774ad851f7c7159fbc6539f7d8771400d632`
- Upstream at baseline: 4 ahead, 0 behind
- Pre-existing work preserved: untracked `docs/phase6e1-web-plugin-runtime-audit.md` and `docs/phase6e2-web-plugin-runtime-contract.md`
- The repository had one Electron-side package validation layer and a separate standalone SDK package. Both already used `yauzl@3.4.0`; no ZIP dependency was added.

## Implementation

The existing package-validation seam now routes by the strictly read `manifestVersion`: v1 goes to the unchanged v1 validator; v2 goes to the new v2 validator; unsupported and malformed versions fail closed. A v2 validation error is never retried as v1. The v1 path still accepts its historical ZIP64 packages.

The Host-owned `validatePackageV2` adapter supplies Main's reserved Feature identities and maps parser categories to safe Main `PluginError` codes/messages. SDK validation reuses the pure parser/archive core but remains explicitly advisory.

The existing registry and lifecycle remain v1-only. The Main install entry validates a v2 candidate completely, then returns `INCOMPATIBLE_PLUGIN` before consent, package staging, grant changes, registry mutation, or Feature publication. This keeps v2 inert until the later registry/lifecycle phase; it does not create a parallel registry or claim v2 installation support.

## Manifest v2 Parser

`plugin-sdk/declarative-v1/runtime/manifest-v2.mjs` reuses the repository's strict JSON machinery for fatal UTF-8 decoding, duplicate-key rejection, JSON syntax and the 16-container nesting limit. It enforces the exact required/optional top-level fields and closed nested objects, primitive types, SemVer/Host compatibility, scalar-value text bounds, Plugin/Feature IDs, the `feature-bundle` literal, capability declarations/subsets, entry/icon/context declarations, and structurally valid network declarations.

The normalized descriptor and every nested record/array are frozen. It contains no raw ZIP object, bytes, absolute path resolver, grants, secret, or runtime object.

## Archive Validation

`plugin-sdk/declarative-v1/runtime/package-v2.mjs` validates one bounded in-memory snapshot without extracting it to disk. It checks a single-disk non-ZIP64 v2 envelope, exact EOCD/central-directory placement, entry metadata and supported flags/compression, and during strict v2 validation requires each local header's version-needed, flags, compression method, CRC, compressed size, uncompressed size, and filename to match the central directory. Data-descriptor bit 3 is unsupported and rejected; DOS directory, volume-label, and device entries are also rejected. It checks streamed data CRC and sizes, encryption/symlink/special/reparse/extra-field rejection, duplicate/case/NFC names, and exact equality between archive members and declared inventory. Non-strict version sniffing retains the legacy filename/method/flags checks and leaves the final acceptance decision to the existing v1 validator.

Each member is streamed and bounded before its content chunks are combined for that one member. The validator does not collect the fully expanded archive or retain bytes in its result. V1 ZIP64 is routed to and remains validated by the original v1 reader.

## Path Canonicalization

Manifest inventory and entry paths use one canonical POSIX-relative path validator. It rejects empty/dot/parent segments, leading slash, drive/absolute paths, backslash, control characters, query/fragment, malformed percent sequences, encoded/double-encoded traversal or separators, non-NFC strings, and prefix/case/NFC collisions. Archive names are decoded with strict UTF-8 when flagged; non-ASCII legacy-encoded names are rejected. Paths are compared as archive identities and never joined to a filesystem root during validation.

## Inventory Validation

The archive must contain exactly the reserved `manifest.json`, every declared `webBundle.files` entry, and every declared asset. `manifest.json` (case-insensitive) cannot also be declared as a bundle file, keeping the metadata member distinct from the payload inventory. Undeclared/missing entries, file/asset cross-list duplicates, source maps, unsupported extensions, MIME/extension mismatches and entries referenced by no valid inventory are rejected. Each Feature's entry must name a declared HTML document. Assets are restricted to PNG/JPEG/WebP/WOFF2; Web files to HTML/JS/MJS/CSS/JSON/WASM.

## Bounds

The validator enforces: compressed archive 20 MiB; 256 entries; expanded total 50 MiB; per-entry compression ratio 100:1; manifest 64 KiB; HTML 1 MiB; JS/CSS/JSON/WASM 8 MiB each; images 2 MiB; WOFF2 1 MiB; PNG Feature icon 256 KiB; 128 assets; 16 Features; 8 commands per Feature; 16 network host/protocol tuples; and the frozen text/scalar bounds. Tests accept each important reachable boundary and reject the first byte/item/scalar beyond it.

Two maxima are upper ceilings rather than reachable exact cardinalities under the frozen closed domains: there are nine known capabilities although the list ceiling is 12, and only three unique `(text, sources)` context pairs although the ceiling is four. Tests accept all nine capabilities/all three unique context pairs, reject unknown/duplicate values, and exercise 13 capabilities/five contexts as the first over-limit inputs.

## Reserved Identities

Third-party IDs in the exact `webtools` or `webtools.*` namespace are rejected. Main owns a separate closed composite `(pluginId, featureId)` reservation list, currently protecting `(webtools.translation, translate-text)`. The validator checks this general list instead of relying only on a Translation-specific namespace rule.

## Capability Validation

Only the frozen Manifest v2 capability set is accepted; v1-only `manager.page` is rejected. Values must be unique, known, and within the list bound. Feature `requiredCapabilities` must be a subset of top-level requests. These declarations remain metadata and never grant authority.

## Network Declaration Handling

`network.mode: none` requires an empty domain list and no `network.domains` capability. `domains` requires the capability and 1–16 unique tuples with canonical lowercase IDNA ASCII A-label hosts and only `https` or `wss`; wildcard, IP literal, userinfo/path/query/fragment, port syntax and unsupported protocols fail closed. A valid domains declaration returns `networkRuntimeSupport: unavailable`. It is not granted or executed; Gate 4 remains closed.

## WASM Declaration Handling

`executionRequirements` is either omitted (normalized to `{ wasm: false }`) or the exact `{ wasm: boolean }` object. `wasm: true` requires at least one declared `.wasm` web-bundle entry with `application/wasm`. The archive validator checks the WebAssembly version-1 magic header only. It does not compile, instantiate, or execute WASM; later runtime/CSP acceptance remains mandatory.

## Static Inspection Limits

The validator enforces source-map rejection from inventory/path metadata, local-only manifest entry paths, MIME/extension mappings, and explicit byte signatures for PE (`MZ`), ELF, Mach-O, WASM, PNG, JPEG, WebP and WOFF2 where applicable. It rejects recognizable HTML document prefixes when found in a non-HTML member.

This is not antivirus, a complete binary-format validator, or a JS/CSS/HTML parser. It does not claim that arbitrary JS/CSS contains no CDN URL, bare npm import, dynamic import, or remote reference. Such source analysis is deliberately not implemented with regex or a homemade parser; future runtime security must rely on exact inventory, isolated origin, CSP and request enforcement. The current runtime is absent and v2 is not installable.

## Mutation Safety

`PluginManager.install` now routes selected archives through version discrimination and full Host validation first. Invalid v2 packages reject without side effects. A structurally valid v2 package currently rejects as incompatible before any mutation because `PluginRegistry` and persisted plugin records are frozen to v1. Tests snapshot the installed v1 record, versions, grants, private data, registry/package storage, staging files and consent prompt count around invalid and valid-but-not-yet-installable v2 attempts. Both preserve the old package and perform no write/prompt. The v1 install/update path remains unchanged after routing.

## V1 Compatibility

The v1 validator, parser, schema, packer and adapter were not widened. Regression tests cover ordinary valid v1 package hash/manifest equivalence through routing, v1 semantic-invalid error-code equivalence, local-header CRC/version variants accepted identically by direct v1 validation and version routing, v1 ZIP64 routing/acceptance, v1 adapter/runtime behavior, v1 package/asset tests and existing install/update/permission behavior. V2 failures do not fall through to v1; unknown manifest versions reject.

## Phase 6E-2 Contract Deviations

**NONE** in Manifest v2 grammar, capabilities, Feature identities, package limits, or Projection v2. The later lifecycle matrix's “store valid v2 bytes/registry without starting code” operation is not claimed complete here: this validation phase keeps the current v1-only persisted registry unchanged and rejects an otherwise valid v2 install attempt before mutation. No v2 runtime or persisted record has been introduced.

## SDK Preflight

The standalone local package is now `@webtools/plugin-sdk@1.2.0` because a public v2 archive preflight and its public TypeScript types are additive SDK API. Product remains `0.1.0`, Plugin API major remains `1`, and the v1 authoring/packing schema stays Manifest v1. `validatePluginArchiveV2` returns an immutable metadata-only summary and closed safe diagnostics; Host validation remains final authority. No dependency or lockfile changed.

The existing external developer workflow was rerun from an OS temporary directory using the 1.2.0 tarball. The isolated basic v1 author project installed the local tarball, typechecked, validated, packed and inspected its plugin; Host and SDK accepted the same identity. A separate public SDK typecheck compiles the v2 types/API.

## Automated Tests

- `pnpm run typecheck` — PASS.
- `pnpm test` — PASS, 435/435 Node tests.
- Focused v2 parser/package tests: `pnpm exec node --experimental-strip-types --test electron/plugins/manifest-v2.test.mjs electron/plugins/package-v2.test.mjs` — PASS, 21/21.
- SDK public type contract: `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext plugin-sdk/declarative-v1/tests/public-api.typecheck.ts plugin-sdk/declarative-v1/runtime/manifest-v2.d.mts plugin-sdk/declarative-v1/runtime/package-v2.d.mts` — PASS.
- `pnpm exec node scripts/verify-phase6b-sdk-workflow.mjs` — PASS; SDK 1.2.0 local tarball was 28,251 bytes, SHA-256 `2bd6563cd2c97d17c759921585599b1575dcc70065a57261c6da23ae5e19cbdc`; external generated Manifest v1 package passed both SDK and Host validation.
- `pnpm run build` — PASS; Electron Main, preload and Vue renderer production bundles built.
- `git diff --check` — recorded in the final report after the documentation/final review.

No NativeHost checks were run because no NativeHost source or projection contract changed. No installer, GUI acceptance, Gate 1 or Gate 4 runtime test was run.

## Findings

Final read-only review found two blocking P2 validation gaps: ZIP local-header fields were not all compared with the central directory (and data-descriptor bit 3 was accepted), and a bundle inventory could reuse the reserved `manifest.json` identity. While correcting the first issue, review also found that applying the stricter metadata comparison during non-strict version sniffing would change which malformed-but-legacy-accepted v1 archives reached the frozen v1 validator. The v1 routing behavior is preserved by applying the new comparisons only during strict v2 validation. All three findings have focused regression coverage and are resolved before final verification. The current counts below are unresolved findings.

- **P0: 0**
- **P1: 0**
- **Blocking P2: 0**
- **Non-blocking P2: 1** — source-level remote/bare-import inspection is not performed; arbitrary source-code analysis needs a real parser and is not an execution security authority. Current v2 install/runtime is unavailable, and future CSP/request enforcement remains required.
- **P3: 2** — capability/context exact maxima are unreachable because their frozen unique domains contain only nine and three values respectively (documented above); current Windows/Electron packaged runtime gates remain deliberately deferred and do not affect inert validation.

## Deferred Runtime Work

No runtime acceptance was attempted. Phase 6E-2's outstanding packaged runtime blockers remain unresolved by this validator: sandboxed main-world `process` exposure; conditional WASM CSP behavior; exact custom-origin storage/cache cleanup; and adversarial Gate 1 acceptance. Network Gate 4 remains closed. V2 package install/registry/enablement and runtime lifecycle are not implemented. Native Feature Projection v2 remains unchanged.

## Phase 6E-4 Entry Criteria

The repository is technically ready for **next-phase planning** only. Any runtime implementation still requires explicit phase authorization and must first close the Phase 6E-2 packaged Electron evidence gates above. This report does not authorize or start Phase 6E-4.
