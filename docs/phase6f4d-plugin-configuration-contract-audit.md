# Phase 6F-4D — Plugin Configuration Contract Audit & Implementation Plan

**Document type:** PRE-IMPLEMENTATION SOURCE AUDIT / IMPLEMENTATION PLAN
**Status:** USER APPROVED — IMPLEMENTATION AUTHORIZED
**Date:** 2026-10-14
**Repository:** `D:\SystemDefault\Desktop\HomePage`
**Branch / HEAD observed:** `codex/shared-ai-translation-2.0` / `707c5673dff479285b34a5b441bec9d3b725c737`
**Working tree before this report:** 254 modified, deleted, or untracked paths. Findings below describe the current working-tree source where noted; no existing changes were staged, changed, or discarded.

## 1. Purpose and boundary

This document advances the approved plugin-platform roadmap to the next step: a formal audit and reviewable implementation plan for **Phase 6F-4D — Plugin Configuration Contract**.

The user explicitly directed that Phase 6F-4C does not need another review before proceeding. This instruction is treated as a sequencing waiver. It does not rewrite 6F-4C's historical verification record or claim that its previously unverified Windows/runtime checks passed.

This is not the 6F-4D production implementation. No product code, tests, fixtures, SDK implementation, package manifest, evidence, build output, or user data was changed. No tests, typecheck, build, runtime smoke, or packaging were run. The contract choices below are proposals for review; implementation should start after they are accepted or revised.

## 2. Executive finding

WebTools already has a useful v1 precedent: a closed set of typed settings descriptors, Host-side value validation, atomic persistence, and a separate `config` namespace from plugin private `data`. The current v3 surface is not end-to-end:

- v3 accepts the capability names `plugin.config.read` and `plugin.config.write`, but has no v3 configuration descriptor.
- The Web runtime method allowlist and dispatcher have no config read/write methods; `IMPLEMENTED_WEB_CAPABILITIES` excludes both capabilities. Node Command reuses the same capability dispatcher and also has no config API.
- Plugin Center has no Host-owned v3 configuration-management endpoint. Its Web plugin detail currently says that no configuration UI is available.
- SDK Web/Node public APIs do not expose typed configuration methods.

The existing runtime eligibility gate keeps these unimplemented capabilities from becoming usable. This is a planned capability gap, not evidence that arbitrary configuration access is currently available. 6F-4D should add one Host-owned configuration authority with two separate entry paths: Manager management for any currently installed package, including disabled plugins without starting Runtime; and a Runtime capability bridge gated by the active package, session, generation, requested capability, grant, and Host implementation.

## 3. Evidence scope and limits

This audit is a read-only static review of the current checkout. Source identity and the large pre-existing dirty state make this a working-tree snapshot, not a clean-commit audit. No dynamic behavior is certified here.

The uTools 7.8.0 reverse-engineering reports remain mechanism references only. They support centralized Host discovery, identity routing, and lifecycle ownership, but do not establish a configuration-security contract that should be copied. This plan does not copy uTools fields, IPC, runtime preferences, or legacy Electron security settings.

## 4. Current-state audit

| Area | Current evidence | Finding |
|---|---|---|
| v3 manifest and install validator | `plugin-sdk/declarative-v1/runtime-v3/manifest-v3.mjs:20-25,313-366`; `manifest.schema.v3.json:8-21,53-54`; Host wrapper `electron/plugins/manifest-v3.ts:1-27`; `electron/plugins/package-validator.ts:49-78` | The capability enum contains config read/write. The strict v3 top-level field list has no configuration descriptor. Host package validation routes through the v3 package validator and creates an immutable validated snapshot. SDK validation/packing is not the install authority. |
| Feature eligibility and grants | `electron/plugins/web-feature-authority.ts:5`; `electron/plugins/plugin-manager.ts:250-285,370-390`; `electron/plugins/plugin-registry.ts:8-12`; `src/features/plugins/plugin-view-model.ts:90-101`; `src/features/plugins/PluginManagerView.vue:378-388` | Config is not in the implemented Web capability set, so a Feature requiring it is unavailable. However, the current permission view marks config capabilities `grantable: true` while `implemented: false`; a user can persist a grant after seeing the “not implemented” warning. 6F-4D must make the grant's future meaning explicit and preserve the existing grant model unless a reviewed product decision changes it. |
| Runtime bridge | `plugin-sdk/declarative-v1/web/capability-methods.mjs:4-44`; `electron/plugins/web-host-capabilities.ts:105-150`; `electron/plugins/node-command-execution.ts:56-92` | The closed request protocol includes context, storage, AI, and clipboard methods only. Host dispatch has no config method. Node Command is temporary and uses the same Host capability dispatcher, so one shared config seam can serve both runtimes. |
| Existing v1 config behavior | `plugin-sdk/declarative-v1/runtime/manifest-v1.mjs:182-251`; `electron/plugins/manifest.ts:20-30`; `electron/plugins/plugin-store.ts:18-60`; `electron/plugins/declarative-runtime.ts:32-61` | v1 has text/enum/boolean/number values; descriptor/default checks are Host-side; unknown keys or incompatible saved values fail rather than being silently rewritten. Writes use the serialized store queue and atomic write path. |
| Config/data storage | `electron/plugins/plugin-store.ts:18-75` | Existing files are logically separated as `config/<pluginId>.json` and `data/<pluginId>.json`. A v3 format must not reinterpret or overwrite the v1 file merely because the same plugin ID is upgraded across manifest families. |
| Manager API and UI | `electron/plugins/plugin-catalog.ts:20-110`; `electron/ipc/plugin-handlers.ts:1-90`; `src/shared/ipc.ts:80-125`; `src/shared/plugin-contracts.ts:1-120`; `src/features/plugins/PluginManagerView.vue:35-40,390-410` | Current `getPages` and `DeclarativePluginView` are v1 compatibility paths tied to an active Declarative Runtime. There is no separate disabled-plugin configuration management endpoint. The v3/Web detail uses an explicit unavailable message. |
| Package identity and runtime lifecycle | `electron/plugins/validated-plugin-package-snapshot.ts:1-50`; `electron/plugins/web-feature-authority.ts:9-42`; `electron/plugins/plugin-manager.ts:250-390`; `electron/plugins/plugin-runtime-session.ts:1-130` | Existing validated snapshot, current package hash, runtime session, revocation, and generation/currentness checks provide the right seams. Config writes must use these checks for Runtime calls and a separate Manager package-identity check for management calls. |
| Secrets and platform settings | `electron/services/shared-ai-service.ts`; `electron/ipc/settings-handlers.ts`; Phase 6F-4C report §§I–M | AppSettings, Shared AI configuration, and SecretStore already have platform owners. Plugin config must not be an alternate route to global settings, provider credentials, raw tokens, or SecretStore. |

### 4.1 Severity summary

- **P0: 0 confirmed.** This static review found no evidence of arbitrary config/filesystem/SecretStore access through the current v3 bridge.
- **P1: 0 confirmed.** No active configuration capability path was found; the runtime capability set excludes config.
- **P2: 3 design risks to close in 6F-4D.** (1) v3 config capability declarations currently lack a descriptor and runtime API; remain unusable until the full contract ships. (2) old v3 config grants are persistable while inert; decide whether the existing explicit user grant remains authoritative once the capability is implemented. (3) reusing the flat v1 config file for v3 could mix formats for a reused plugin ID; use a separate v3 namespace and preserve v1 data.
- **P3: 1 implementation/documentation concern.** Keep user-facing capability status honest and ensure new IPC/DTO documentation stays synchronized with the SDK contract.

These are roadmap findings, not newly reproduced production defects. No severity is being downgraded to claim 6F-4D complete.

## 5. Proposed configuration contract

The following is the recommended contract for implementation-plan review. It is not yet a frozen public API.

### 5.1 Manifest v3 descriptor

Add one optional, closed top-level `configuration` object to Manifest v3:

```json
{
  "configuration": {
    "schemaVersion": 1,
    "settings": [
      { "key": "locale", "label": "Language", "type": "enum", "options": ["en", "zh-CN"], "default": "en" },
      { "key": "compact", "label": "Compact mode", "type": "boolean", "default": false },
      { "key": "endpoint", "label": "Service URL", "type": "text", "minLength": 0, "maxLength": 2048, "default": "" },
      { "key": "limit", "label": "Result limit", "type": "number", "min": 1, "max": 100, "default": 20 }
    ]
  }
}
```

Recommended rules:

- Reuse only the v1 closed value kinds: `text`, `enum`, `boolean`, and finite `number`. Do not add password/secret, arbitrary JSON, nested schema, executable defaults, or custom UI code.
- Require `schemaVersion` to be a positive bounded integer and `settings` to be bounded (recommend 64 entries). Require unique safe keys, bounded labels, unique bounded enum options, valid finite number ranges, and defaults that pass the exact same value validator used for writes.
- Reuse the proven v1 per-field bounds where sensible; review tighter v3 text length limits against the 256 KiB Manifest limit and product need before freezing. Descriptor-level values must also obey the existing PluginStore aggregate key/document quotas.
- If the field is absent, preserve existing v3 manifest compatibility. Any declared config capability remains unsupported unless the package has a valid descriptor and all runtime gates pass. A malformed descriptor is rejected by the Host install-time validator.
- The Host validator remains final authority. SDK schema, creator, packer, type declarations, and Manager DTOs are mirrors, not substitutes.

### 5.2 Separate persisted v3 namespace and compatibility

Use a dedicated logical namespace such as `config/v3/<pluginId>.json`; do not reinterpret `config/<pluginId>.json`, which is the existing v1 flat map. Continue using the existing PluginStore managed filesystem, serialized writes, quotas, strict JSON parsing, and atomic replacement.

Recommended v3 persisted envelope:

```json
{ "storageVersion": 1, "schemaVersion": 1, "values": { "locale": "en" } }
```

- Persisted config belongs to stable plugin ID and configuration schema version, not the package archive hash; ordinary package upgrades with compatible schema should retain values.
- Runtime authorization still binds every operation to the current validated package hash/snapshot and current session/generation.
- Missing values resolve from validated defaults without an implicit write. Unknown keys, invalid values, malformed envelopes, and incompatible schema versions fail closed; they must not truncate or overwrite the existing file.
- A descriptor/schema change does not trigger automatic value migration. The Manager must show a bounded incompatibility state and offer an explicit, user-confirmed recovery action before replacing values. The proposed recovery should preserve the old v3 file as a bounded backup; retention/overwrite policy must be finalized before implementation.
- Disable, runtime close, and package replacement preserve config. Explicit “delete plugin data” removes v1 config, v3 config, and plugin data through the existing Host-owned deletion path. Uninstall default retention stays consistent with current product policy.

### 5.3 Two independent authority paths

**Manager management authority**

- New typed Manager IPC operations read/update the configuration for the currently installed plugin identity (`pluginId`, current `version` and `hash`). The Renderer sends identity and values only; it never supplies authoritative descriptors or filesystem paths.
- Main reloads/validates the installed package snapshot and derives descriptors from that snapshot. It accepts installed-disabled packages, does not require runtime/grant/enablement, and never starts a Runtime to display or save configuration.
- Every write rechecks Manager session and expected installed identity after awaits and immediately before atomic commit. A stale package edit fails instead of writing into a replacement package's config.
- Main returns a sanitized DTO containing only display descriptors, bounded current values/defaults, schema/error status, and safe identity metadata. It never returns a raw manifest, local path, SecretStore value, or runtime authority object.

**Web/Node Runtime capability authority**

- Expose only typed, declared-key operations through the existing public `webtools` API, with matching Web and Node type declarations. Proposed shape: `config.get()` for the declared config object and `config.set(key, value)` for one declared key; do not expose generic IPC or path access.
- A `get` requires `plugin.config.read`; `set` requires `plugin.config.write`. Each operation must verify the current validated snapshot, feature/plugin identity, active runtime/session/generation, manifest request, persisted grant, Host implementation, and descriptor/key/value. Recheck authority before committing a write.
- Manager management does not use or acquire Runtime authority. Revoking Runtime config capability stops subsequent Runtime calls but does not prevent the user from repairing settings in Manager.
- Node Command remains an ephemeral Utility Process; it gets only the same mediated methods and capability subset as the active command authorization. No resident plugin process is added.

### 5.4 Capability and compatibility behavior

- Keep capability dimensions separate: manifest-declared/requested, user-granted, package-specific implemented, and current runtime-authorized.
- Until the full v3 descriptor + Host store + Web and Node bridge + SDK + Manager UI is present, `plugin.config.read/write` remains unusable and cannot make a Feature available. The current UI allows these grants to be persisted while showing an unsupported warning; the implementation plan must decide whether that explicit grant remains authoritative once the capability is implemented.
- Minimal recommendation: preserve existing persisted grants under the current grant model. The user explicitly selected them and the UI disclosed that they were not yet implemented. Do not add a grant-version registry migration unless the product decision is that the disclosure invalidated consent; if re-consent is selected, scope it only to the two config capabilities and preserve all other grants/data.
- Existing v3 packages that omit `configuration` must remain loadable. Config capabilities on such packages remain unavailable; do not invalidate an otherwise valid existing package solely because the new optional field is absent.
- Existing v1 manifests, declarative pages, `config/<id>.json`, and actions remain unchanged. No automatic v1→v3 conversion and no DataStore or SecretStore schema migration.
- Raw API keys, provider credentials, AI endpoints/default-provider control, AppSettings, and SecretStore are out of scope. Plugin config is ordinary plugin-owned preference data, not a secure secret vault.

### 5.5 Error contract proposal

Expose stable bounded codes through existing safe error mapping; do not return filesystem or JSON parser details. Candidate codes to align with existing errors before implementation:

| Condition | Proposed result |
|---|---|
| No descriptor / key not declared | `CONFIGURATION_NOT_DECLARED` / `CONFIGURATION_KEY_NOT_FOUND` |
| Invalid value or malformed request | `INVALID_INPUT` |
| Capability not requested/granted/implemented | `PERMISSION_DENIED` or `NOT_AVAILABLE` according to existing bridge semantics |
| Expired Manager session / Runtime generation | `SESSION_EXPIRED` / `STALE_RUNTIME` |
| Saved data incompatible with current schema | `CONFIG_INCOMPATIBLE` |
| Quota exceeded | `LIMIT_EXCEEDED` |
| Unexpected store error | sanitized `INTERNAL_ERROR` |

Keep existing v1 `CONFIG_INCOMPATIBLE` semantics. Do not disclose saved values in diagnostics, logs, crash reports, or error strings.

## 6. Implementation work plan after contract approval

1. **Freeze the contract:** descriptor JSON/type definitions, bounds, capability-without-descriptor behavior, storage envelope/namespace, schema incompatibility recovery, and stable error codes.
2. **Extend the canonical v3 schema/parser and SDK declarations:** optional descriptor; strict positive/negative validation; preserve absent-descriptor legacy compatibility. Packer remains advisory.
3. **Implement one Host configuration service:** normalize defaults, validate reads/writes, enforce quotas, version persistence, retain incompatible files, serialize atomic commits. Keep config and data namespaces separate.
4. **Add Manager management DTO/IPC:** derive metadata from the current Host-validated package; allow disabled packages without Runtime activation; bind each save to current package identity and Manager session.
5. **Add Runtime capability methods:** extend the closed Web request protocol and common Main dispatcher; expose matching Web/Node SDK methods; check requested + granted + implemented + current runtime identity on every call.
6. **Add Plugin Detail editor:** render only Host-validated typed descriptors with built-in controls; add loading, validation, save, stale-package, and incompatible-schema recovery states. Never execute plugin UI code for settings.
7. **Add focused tests:** cover the matrix in §7, including real Host/package-snapshot seams where practical; do not use SDK-only unit tests as evidence for Host install acceptance.
8. **Document API/data/version behavior:** update plugin author and runtime docs. Decide public SDK semver for the additive API; proposed minor increment is `@webtools/plugin-sdk` 1.5.0, while actual local tarball/external-author sync remains the later 6F-5 gate.

No task above is executed by this report.

## 7. Required verification and acceptance matrix for implementation

| Requirement | Required evidence |
|---|---|
| Manifest contract | Host validator accepts each valid descriptor and rejects unknown fields, duplicate/unsafe keys, invalid defaults, invalid bounds/options, malformed schema version, excess counts/size, and config capability misuse without invalidating legacy absent-descriptor packages. |
| Host final authority | Invalid `.wtplugin` is rejected by actual Host package install validation even if SDK preflight/packer is bypassed. |
| Defaults and persistence | Missing file returns defaults without write; valid Manager/Runtime writes persist atomically and survive reopen; malformed/incompatible data is preserved and never silently replaced. |
| Namespace separation | v3 config never reads/overwrites a v1 config file with the same plugin ID; config writes never touch plugin storage/data or AppSettings. |
| Disabled Manager configuration | Configure installed-disabled v3 package; prove no WebContentsView, Web Runtime, Node Utility Process, or feature activation starts. |
| Stale identity and races | Package replacement/hash change, session close, overlapping edits, disable/revoke, and stale generation between validation and commit all prevent stale writes. |
| Web authority | Missing request, missing grant, unsupported capability, disabled plugin, wrong feature, stale snapshot/session/generation, and undeclared key are denied; authorized get/set work and remain bounded. |
| Node authority | Same allow/deny matrix and type semantics as Web; Utility Process remains temporary and cannot receive raw Host secrets/environment. |
| Manager authority independence | Manager editing remains available when Runtime disabled or config grant revoked; Manager methods cannot invoke Runtime-only APIs or arbitrary plugin actions. |
| Secret boundary | Config DTO, SDK, Web/Node bridge, logs and errors contain no SecretStore/raw key/provider credential; no plugin config can mutate global AppSettings. |
| Compatibility and recovery | v1 behavior and stored values remain unchanged; config schema mismatch displays recoverable UI, retains old bytes until explicit user-confirmed recovery, and can be tested without real profile data. |
| UI/accessibility | Typed controls only, labels and keyboard focus are accessible, loading/error/save states are clear, and the view works for enabled and disabled plugin states. |
| Final regression | Focused SDK/Host/IPC/UI tests, typecheck, full Node tests, build, NativeHost checks if touched, and a packaged Manager smoke are run in the separately authorized verification round. |

Tests in this matrix have **not** been run as part of this audit.

## 8. Non-goals

- Arbitrary React/Vue/HTML/JS configuration pages or JSON Schema execution.
- Plugin access to `AppSettings`, AI provider management, API endpoints, SecretStore, or raw credentials.
- v1→v3 automatic migration, broad DataStore migration, or config/data unification.
- New runtime process, worker, IPC bypass, filesystem API, or persistent Node daemon.
- Marketplace, online install/update, AI Tools, Agent, MCP, Translation migration, Theme contract (6F-4E), or SDK tarball/external author acceptance (6F-5).
- Copying uTools implementation details not directly supported by its evidence.
- Any Launcher, Super Panel, NativeHost, translation, installer, or unrelated architecture changes.

## 9. Review decisions requested

Please review these concrete recommendations before 6F-4D implementation:

1. Accept the optional `configuration: { schemaVersion, settings }` descriptor and the four existing primitive field types only.
2. Accept preserving old config capability grants as explicit user grants by default; choose a targeted re-consent rule only if the existing unsupported warning is not considered sufficient disclosure.
3. Accept a separate persisted v3 config path/envelope so a v1 config for the same plugin ID is never reinterpreted or overwritten.
4. Accept no automatic schema migration; incompatible values stay intact and Manager offers an explicit, user-confirmed recovery/reset while preserving the prior file as a bounded backup.
5. Accept Manager configuration authority independent from Runtime enablement/grants, while Runtime `get` and `set` remain separately capability-gated.
6. Accept leaving old v3 packages without the optional descriptor loadable, with config capabilities still unavailable for them.
7. Accept a public SDK minor version increment (proposed 1.5.0); defer generating/distributing the local tarball and external-author workflow to Phase 6F-5.

If these are accepted, the next task can freeze the final implementation sequence and then implement 6F-4D. Until then, no production implementation has started.

## 10. Phase boundary and Git

- Phase 6F-4D status: **AUDIT COMPLETE — IMPLEMENTATION PLAN PROPOSED — AWAITING USER REVIEW**.
- Phase 6G: **NOT STARTED**.
- No source/test/SDK changes, no test/build/package, no staging, commit, push, PR, merge, tag, or release.
- Existing branch, HEAD, and dirty work were left untouched. This document is a new untracked planning artifact only.

## 11. User approval and implementation handoff — 2026-10-14

The user reviewed this document and confirmed “审核完毕没有问题”. The recommendations in §9 are accepted, including preserving prior explicit grants, separating v3 persistence, confirmed backup/reset, disabled-plugin management authority, absent-descriptor compatibility, and SDK source 1.5.0. Production implementation proceeds in the authorized current checkout; prior audit statements remain the record of the audit round. The current implementation status and evidence are maintained separately in `phase6f4d-plugin-configuration-development.md`.

Frozen execution choices: maximum 64 fields; schemaVersion 1–2147483647; existing v1 field bounds; 512 KiB aggregate values; one latest raw-byte recovery backup; Manager optimistic config revision; no automatic migration. Full regression/build, packaged runtime, and manual UI acceptance remain the separately authorized verification round. No Git checkpoint or packaging is authorized by this handoff.
