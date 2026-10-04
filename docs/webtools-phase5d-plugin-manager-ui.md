# WebTools Phase 5D — Manager Plugin Center and Declarative UI

**Status:** `PHASE 5D COMPLETE — PENDING PHASE 5E SDK AND SAMPLE PLUGIN`

**Scope:** Manager-side management and rendering for the Phase 5C declarative plugin core. This report does not claim Phase 5F security/Windows acceptance. Phase 5E and 5F have not started.

## Source and Test Identity

- Branch: `codex/shared-ai-translation-2.0`
- Baseline HEAD: `e1147f0b2ec7fca7fb3fc14ee864384e6cfee330`
- Source was intentionally dirty during the isolated smoke because it included the Phase 5D changes under test.
- The final packaged smoke report and build output were written outside the repository under `D:\系统缓存\WebTools Phase5D Final Review 20261004-193722`.
- No installer was produced. The smoke used a packaged `win-unpacked` Manager and the isolated NativeHost test mode.

## Implementation

The Manager now has a reachable Plugins center and active declarative plugin pages under Apps. The plugin center shows safe metadata, compatibility/status, local unsigned provenance, integrity digest, requested and granted capabilities, and recoverable errors. It supports Main-owned install/import, enable/disable, grant/revoke, and uninstall/keep-or-delete flows. The UI only renders the closed set of Phase 5C block types with ordinary Vue bindings; it does not load executable plugin code or expose filesystem paths.

Declared configuration controls map to the plugin's declared write action. Sensitive actions have busy/result/cancel/error states and reject late results after navigation or page-generation changes. The AI review flow displays the complete Main-produced request, then confirms or cancels using an opaque, one-use Main-owned review ID. Main rechecks the session, plugin identity/version/hash, action, grant, input digest, runtime, and selected provider/model before dispatch. Credentials and provider fingerprints are not sent to Renderer. Existing direct Phase 5C AI invokes retain their native confirmation path and size limit.

Replacement, upgrade, and downgrade confirmation now identifies the operation, old/new versions, and capability additions/removals. The Settings MyMemory note now describes automatic sending after the configured pause and clarifies that switching engines alone does not send text.

Manager navigation keeps Favorites as the initial page, makes the plugin center reachable even when all plugins are disabled, exposes only active enabled pages granted `manager.page`, and returns to the plugin center when the current page becomes unavailable. Settings, Translation, Native intents, and existing Manager lifecycle behavior remain in their existing paths.

### Main files changed

- `src/shared/plugin-contracts.ts`, `src/shared/ipc.ts`, `electron/preload.ts`, and `electron/ipc/plugin-handlers.ts`: safe typed DTOs and narrow list/page/config/review APIs.
- `electron/plugins/plugin-manager.ts`, `manifest.ts`, `plugin-registry.ts`, `plugin-store.ts`, `permission-broker.ts`, `declarative-runtime.ts`, and `electron-plugin-host.ts`: projection, lifecycle, validation, consent detail, permission, config, and AI review behavior.
- `src/App.vue`, `src/features/plugins/*`, and `src/styles/tokens.css`: plugin center, declarative page, accessible review dialog, input/view models, and Manager navigation.
- `src/features/settings/SettingsView.vue`: MyMemory trigger wording correction.
- Focused tests in `electron/plugins/*test.mjs`, `electron/ipc/plugin-handlers.test.mjs`, `src/features/plugins/*test.mjs`, and `src/features/settings/settings-translation-copy.test.mjs`.
- `scripts/verify-phase5d-plugin-ui-smoke.mjs` and its structural test: isolated packaged smoke and cleanup safeguards.

There were no NativeHost C# or Named Pipe changes, dependency or lockfile changes, installer changes, or user data schema changes.

## Code Review

The integrated read-only review found no P0 or P1 issue. Five P2 findings were corrected before closeout:

1. Consent did not show the version/capability delta for replacement and downgrade; added a typed change model and clear consent summary.
2. Expired AI review transactions could remain retained until a later confirmation; added nearest-expiry cleanup and lifecycle cancellation.
3. Clipboard actions accepted more text than the native consent path permits; aligned the UI cap to 24,000 characters and surfaced that bound.
4. A page temporarily vanished while its plugin action was invoking; retained the page entry during invocation.
5. Packaged-smoke cleanup depended on its original PowerShell identity probe. Cleanup now restarts a fresh probe even if the original exits or stops responding, then closes only exact executable/PID/creation-time identities and checks the isolated Manager group is empty.

The review also found one P3 issue: review-generation entries accumulated for unique plugin IDs. They are now retained only while a review is pending or a preparation is in flight. Targeted tests cover cancelled reviews/imports and invalidation while preparation is active. An additional IPC regression test caught a Vue reactive grants proxy that could not be structured-cloned; the UI now sends a plain array. The final read-only review confirmed these fixes and reported no unresolved P0/P1/blocking P2.

## Verification

| Check | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — 193/193 |
| `node --check scripts/verify-phase5d-plugin-ui-smoke.mjs` | PASS |
| `pnpm run build` | PASS — Main, preload, Renderer |
| Windows `pnpm exec electron-builder --win --x64 --dir` | PASS — output outside repository |
| Packaged isolated Manager smoke | PASS — freshly rebuilt and rerun; report: `D:\系统缓存\WebTools Phase5D Final Review 20261004-193722\phase5d-plugin-ui-smoke-report.json` |
| `git diff --check` | PASS; only line-ending conversion warnings were printed |

Packaged artifact identity from the isolated smoke report:

| Artifact | SHA-256 |
|---|---|
| `WebTools.NativeHost.exe` | `1d9c148ba6d8d20085e36625b2ed49c5e129f587008d00602a9c836f99d1a044` |
| NativeHost assembly | `ec880fb0bea214617c9ff144037a0d536dd56e3436527b1501b314314e76ca2a` |
| Manager executable | `1fb51dea54126b26956a543d5cc1067f2675125d4d83b0c212bfc2adae1c25e2` |
| Manager `app.asar` | `03df29d015e23e4616690cf2a28785dfaee841793e69b7df0d13c4568bd23ee6` |

The actual packaged smoke was rebuilt with `pnpm exec electron-builder --win --x64 --dir --config.directories.output="D:\系统缓存\WebTools Phase5D Final Review 20261004-193722\manager-build"` and covered Manager navigation, seeded plugin listing/details, declarative page rendering, config writes, AI preview and cancellation without provider dispatch, disable/re-enable, permission revocation reflected in Main and navigation, reuse of the same Manager process, normal Manager close returning the target Electron process group to zero while the isolated NativeHost remained alive, and isolated NativeHost exit. Its result was `PACKAGED PHASE 5D PLUGIN UI / CONFIG / MANAGER LIFECYCLE PASS`. A follow-up process scan found no process whose executable path was under this isolated evidence root.

The smoke did **not** exercise production consent dialogs, the real file picker, real install/replace/downgrade consent, or the real uninstall keep/delete dialogs. It did not use an installer and did not use real credentials or provider requests. The final report is `D:\系统缓存\WebTools Phase5D Final Review 20261004-193722\phase5d-plugin-ui-smoke-report.json`; the unpacked Manager is under `D:\系统缓存\WebTools Phase5D Final Review 20261004-193722\manager-build\win-unpacked`.

## Manual Verification Required

These require a human Windows UI pass and are not claimed as automated passes:

- Visual layout, keyboard navigation, focus behavior, and accessibility of the plugin center, declarative settings/actions, and AI review dialog.
- Native file-picker and consent dialog presentation, including replacement/downgrade capability changes.
- Real uninstall keep-data/delete-data choice and its resulting UI feedback.
- Hands-on configuration and sensitive action feedback with a local test plugin.

Testing an actual provider request is not required for this phase; no real AI token or paid provider was used.

## Data and Production Safety

The smoke used a fresh isolated profile, isolated temporary package, test-only consent, mock AI behavior, and external evidence directory. It did not modify `D:\webtools`, `%APPDATA%\Nook`, production favorites/settings/secrets/tokens, startup registration, or registry state. An unrelated installed NativeHost was observed by the process-enumeration helper but was not opened, changed, or stopped; cleanup targeted only the isolated executable identity.

## Findings and Phase Boundary

- P0: 0.
- P1: 0.
- Blocking P2: 0 after targeted fixes.
- P3: 1 review finding, resolved by pruning AI review generation state when no review or preparation remains.
- Phase 5E SDK/sample plugin and Phase 5F final security/Windows acceptance remain future work.

The Phase 5C security boundary remains declarative: package data is validated and rendered by host-owned components; no plugin JavaScript is evaluated. The one-use AI review transaction is scoped to the fixed trusted Manager UI and its exact content, not a proof of physical user input.

## Final Status

`PHASE 5D COMPLETE — PENDING PHASE 5E SDK AND SAMPLE PLUGIN`

This implementation closeout does not authorize or start Phase 5E or Phase 5F. Manual Windows UI items above remain for user acceptance.
