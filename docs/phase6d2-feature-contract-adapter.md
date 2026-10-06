# Phase 6D-2 — Feature Contract & Declarative v1 Compatibility Adapter

**Date:** 2026-10-06
**Branch:** `codex/shared-ai-translation-2.0`
**HEAD at implementation:** `76e6e9a5c69ae3d0774c53eb5a3c37e6be9ef6a5`
**Upstream:** `origin/codex/shared-ai-translation-2.0` (0 ahead / 0 behind)
**Status:** `PHASE 6D-2 FEATURE CONTRACT COMPLETE`

## Scope

Phase 6D-2 adds a closed shared Feature identity contract, a Main-only resolved Feature contract, built-in Translation identity metadata, and a deterministic read-time adapter from validated Declarative Manifest v1 metadata. This does not add registry persistence, Feature invocation, Native projection/search, or a Web Plugin Runtime.

## Implementation

### Shared identity and bounded text

`src/shared/feature-contracts.ts` defines `FeatureRef` separately from `PluginRef` and Manifest v1. The accepted identity has exactly the own data properties `pluginId` and `featureId`; arrays, custom prototypes, accessor properties, extra string or symbol keys, and invalid IDs are rejected. A Feature ID follows `[a-z0-9]+(?:-[a-z0-9]+)*` and is limited to 64 characters. Text normalization uses NFC, trims and collapses whitespace, rejects malformed surrogate input, and checks limits by Unicode scalar value. The shared constants define an 80-scalar title limit, at most eight command aliases, and a 48-scalar limit per command.

### Main-process resolved Features

`electron/plugins/feature-contracts.ts` defines a discriminated union for declarative compatibility Features and built-in Features. The built-in Translation metadata identity is `(webtools.translation, translate-text)`, with a safe `translation` icon token and no accepted contexts or required capabilities. It is metadata only: the existing `BuiltinTranslationLifecycle` remains authoritative for Translation lifecycle and enablement.

### Declarative v1 compatibility adapter

`electron/plugins/declarative-feature-adapter.ts` maps one already-validated v1 manifest to at most one deterministic Feature with ID `legacy-manager-page`. It requires a valid plugin identity, usable entry label, bounded page ID that exists in the manifest, and the declared `manager.page` capability. The resulting Feature contains only the Main-owned page identifier and safe metadata; it does not mutate the manifest or make install, enablement, grant, or invocation decisions.

Command aliases are derived from the plugin name and entry label, normalized with the shared text rules, deduplicated case-insensitively, and bounded to eight entries. An unusable optional plugin name drops only that alias; it does not suppress an otherwise valid page Feature. The icon is the fixed generic `plugin` token, never a path, data URL, or manifest-provided asset. Accepted contexts are empty.

The synthetic Feature ID is scoped by `pluginId`, so two distinct plugins may both produce `legacy-manager-page` without identity collision. A plugin whose ID equals the built-in Translation plugin ID remains distinct because the Feature IDs differ.

## Tests and review

Focused tests cover the closed FeatureRef boundary, ID and Unicode limits, deterministic adaptation, page/capability guardrails, source immutability, normalized and deduplicated aliases, safe icon selection, and identity scoping.

Final verification:

| Check | Result |
|---|---|
| Targeted Node tests (shared Feature contract, adapter, Manifest, package validator, PluginManager, PluginCatalog) | **57/57 passed** |
| `pnpm run typecheck` | **PASS** |
| `git diff --check` | **PASS**; Git emitted only existing LF-to-CRLF working-copy notices |

A read-only code review identified one P2 edge case: a valid Manifest v1 page was suppressed if its optional plugin name could not be normalized as a command alias. The adapter was corrected so only that alias is omitted, and a regression test now covers it. No unresolved P0, P1, P2, or P3 findings remain from this implementation review.

## Compatibility and scope boundaries

- Manifest v1 schema and bytes remain unchanged. `src/shared/plugin-contracts.ts`, `electron/plugins/manifest.ts`, and `plugin-sdk/declarative-v1/runtime/*` were not modified.
- No Feature registry, persistence, install-state, grant-state, invocation route, preload API, or IPC handler was added.
- No NativeHost code was changed as part of Phase 6D-2.
- No native Feature projection, native search/index, authorization flow, or invocation was implemented.
- No Web Plugin Runtime was implemented.
- No dependency, package script, or package-manager configuration was changed.
- No full package/build/installer run was performed; verification was limited to the targeted tests, typecheck, and diff hygiene required for this contract/adapter task.

## Repository state and hygiene

The branch was `codex/shared-ai-translation-2.0` at `76e6e9a5c69ae3d0774c53eb5a3c37e6be9ef6a5`, tracking `origin/codex/shared-ai-translation-2.0` with no ahead/behind commits. These files were already modified or untracked before Phase 6D-2 began and were preserved without editing, staging, or cleanup:

```text
 M docs/phase6-master-plan.md
 M docs/webtools-phase5i-launcher-improvement.md
 M docs/webtools-phase6c-capability-backlog.md
 M native/WebTools.NativeHost.Checks/Program.cs
 M native/WebTools.NativeHost/MainWindow.xaml
 M native/WebTools.NativeHost/MainWindow.xaml.cs
?? docs/phase6c-architecture-freeze.md
?? docs/phase6c-feature-context-contract.md
?? docs/phase6c-migration-design.md
?? docs/phase6c-native-feature-projection.md
?? docs/phase6c-plugin-platform-audit.md
?? docs/phase6c-plugin-platform-design.md
?? docs/phase6c-product-interaction-wireframes.md
?? docs/phase6c-web-runtime-security-design.md
?? docs/phase6d-feature-platform-foundation-audit.md
```

Phase 6D-2 adds the three implementation files and their two focused test files listed below, plus this report. No pre-existing dirty file was staged or committed. No commit or push was made.

## Phase boundary

**Phase 6D-2: COMPLETE.**
**Phase 6D-3: NOT STARTED.**
