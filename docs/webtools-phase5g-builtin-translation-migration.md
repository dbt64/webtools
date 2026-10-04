# WebTools — Phase 5G Built-in Translation Migration

## Decision

The Translation 2.0 feature now uses the built-in plugin lifecycle and the unified plugin catalog. The implementation preserves the existing Translation providers, provider settings, shared AI service, and NativeHost protocol.

**PHASE 5G COMPLETE — PENDING PHASE 5H APPROVAL**

Phase 5H and 5I were not started. No installer, release, or production install was created or changed.

## Implemented

- `webtools.translation` is a fixed built-in entry. Missing state defaults to enabled; a valid disabled state persists across Manager restarts.
- Main owns the bounded state file at `<userData>/builtin-plugins/state.json`, enable authority, fail-closed recovery, and Translation-only request cancellation. Corrupt or unsupported files are preserved until the user confirms backup-and-recovery.
- The catalog uses `(kind, id)` identity. Built-in Translation controls do not change declarative plugin grants, packages, config, or runtime authority.
- Translation execution and Google external-open are rejected while the built-in entry is disabled. Provider information, AI provider settings, and declarative Shared AI remain available.
- Native Translation requests use a Main-owned, exact-text handoff slot. The disabled gate acknowledges Native transport only after presentation, does not expose the text, and waits for explicit enable. Enabled handoff supplies the exact text; the existing 450 ms automatic behavior remains unchanged after enable.
- The renderer receives only fixed status projections and request tokens. It cannot select a state path, substitute handoff text, or authorize enablement. Handoff text is not persisted or logged.

## Source and Build Identity

- Branch: `codex/shared-ai-translation-2.0`.
- Source base used by the isolated build: `a5d8522aac69b79a91951f4f952c9d4b8abea0d1`; the working tree contained the Phase 5G implementation.
- Windows: `10.0.22631` x64.
- Node: `v24.21.0`; pnpm: `9.15.9`; .NET SDK: `10.0.401`.
- Electron: `44.4.5`; electron-builder: `26.15.3`.
- NativeHost publish: `dotnet publish native\WebTools.NativeHost\WebTools.NativeHost.csproj --configuration Release --runtime win-x64 --self-contained true -p:UseAppHost=true -p:PublishSingleFile=false -p:PublishTrimmed=false -o release\native-phase5g-f16db31762ca4c73823a6485c5c70b0c` — PASS.
- Manager: `pnpm run build` and `pnpm exec electron-builder --win --x64 --dir --config.directories.output="D:\系统缓存\WebTools Phase5G 验收 20261004 f16db31762ca4c73823a6485c5c70b0c\manager-build"` — PASS. This produced the real unpacked Manager and `resources\app.asar`; no installer was generated.

SHA-256 from the packaged smoke report:

| Artifact | SHA-256 |
| --- | --- |
| `WebTools.NativeHost.exe` | `5786c2ed455ac0a093d835815920a1dfaddf000258c5b361d0fa06b4f100132d` |
| `WebTools.NativeHost.dll` | `89649a12e27b8f294f9c5c015291771d03d5cf59195ddfe51a3993bd283d6754` |
| `WebTools.exe` | `b8cc939a47e61e71810e56a11071a0c4a806c7a5ffc292a3c29871082c51d71e` |
| `resources\app.asar` | `ff6c1f6f8bce82dd93c341f072822060a873398f07a45b466f0d599734f50109` |

## Automated Regression

- `pnpm run typecheck` — PASS.
- `pnpm test` — PASS, 243/243.
- `pnpm run build` — PASS (Electron Main, preload, and Vue Renderer).
- NativeHost Checks — PASS, 55/55.
- UpdateHelper Checks — PASS, 10/10.
- `node --check scripts/verify-phase5d-plugin-ui-smoke.mjs` — PASS.
- `node --check scripts/verify-phase5g-translation-plugin-smoke.mjs` — PASS.
- PowerShell AST parse of `native/scripts/Measure-Phase4G3Processes.ps1` — PASS.
- `git diff --check` — PASS after removing one extra blank line at EOF found during review.

The Node test runner reports its existing `MODULE_TYPELESS_PACKAGE_JSON` warning when importing TypeScript under `--experimental-strip-types`; all tests pass. No dependency or module-mode change was made for that warning.

## Isolated Packaged Windows Smoke

**PACKAGED PHASE 5G BUILTIN TRANSLATION LIFECYCLE / HANDOFF / MANAGER LIFECYCLE PASS**

- Evidence JSON: `D:\系统缓存\WebTools Phase5G 验收最终 20261004 c483997dfa9e41c19032fbc4771cf864\phase5g-translation-plugin-smoke-report.json`.
- NativeHost ran from that isolated root with a unique resource-test Named Pipe and a disposable profile. Manager used the real electron-builder `win-unpacked` output and `--phase4g-manager-test`; the profile was under the current user's TEMP tree, separate from `%APPDATA%\Nook` and all installed product paths.
- Source, artifact paths, PID, process creation time, role, parent PID, and final exit were recorded by the existing identity-checked driver.

| Checkpoint | NativeHost PID | Manager main PID | Electron group |
| --- | ---: | ---: | ---: |
| Native-only launch | 640 | — | 0 |
| Built-in disabled / declarative AI available | 640 | 23380 | 4 |
| Translation gate and exact prefill | 640 | 23380 | 4 |
| Plugin UI operations | 640 | 23380 | 4 |
| Normal Manager close | 640 | — | 0 |
| Manager reopened | 640 | 19332 | 4 |
| Reopened Manager normal close | 640 | — | 0 |
| Isolated NativeHost closed | — | — | 0; all isolated processes exited |

Observed packaged behavior:

- First-run catalog shows exactly one built-in Translation and the isolated declarative fixture; built-in state defaults to enabled.
- Disabling through Plugin Center stores `enabled: false`, removes Translation navigation, leaves the declarative fixture active, and keeps Settings reachable.
- While disabled, Translation and Google IPC return `TRANSLATION_DISABLED`; provider info, Translation settings, AI provider descriptors/status, and declarative Shared AI review preparation remain available.
- A Native Translation request presents the disabled gate without exposing the original text to renderer DOM, and the Native request is acknowledged after gate presentation. Cancel clears the request and leaves Translation disabled.
- A second request enables Translation only after the explicit button click. The exact Latin-Unicode text, whitespace, apostrophe, and hyphen arrive in the input; acknowledgement clears the handoff. The isolated AI provider has no credential, no translation result appeared after 700 ms, and no provider completion was invoked.
- The built-in state file contains no handoff text. Hashes of the test DataStore, SecretStore, Native launcher/catalog state, declarative registry/config, and declarative data were unchanged across Translation disable/enable and handoff.
- Normal Manager close returned the Electron process group to zero while NativeHost remained. Reopen reused the same NativeHost, created one new Manager main process, restored the enabled built-in state, and normal close returned Electron to zero again.
- Test-only declarative AI preview/cancel was exercised; no paid AI request, external provider call, or real credential was used.

## Code Review and Findings

- **P0: 0. P1: 0. Blocking P2: 0. P3: 0.**
- The review found two obsolete Phase 4F static assertions that still expected Translation to be carried as a generic Main page intent. The implementation now routes it through the dedicated handoff state machine; the assertions were updated to check the narrowed page intent, preserved Native command contract, and renderer-ready delivery. Their owning regression file now passes.
- The isolated smoke was extended to snapshot unrelated persistent files around built-in state changes. The final packaged run passed that comparison.
- No NativeHost C# product code, Named Pipe schema, installer, or production data format changed. No new dependency was added.

## Manual Verification and Limits

- Physical mouse/keyboard interaction, actual tray menu operation, real provider network translation, and a graphical installer run were not part of this isolated packaged smoke. No manual Windows acceptance is claimed for those actions.
- Provider behavior and cancellation are covered by mock-backed automated tests; the packaged test intentionally had no AI key and invoked no translation provider.
- Corrupt-state backup/recovery is covered by focused unit tests, not exercised against a real user profile.
- The smoke ran a real packaged NativeHost/Manager pair but did not install into Windows. `D:\webtools`, `%APPDATA%\Nook`, startup registration, real favorites/settings/secrets, and unrelated processes were not accessed or changed.

## Files Changed

The implementation changes are limited to the Phase 5G state/lifecycle/handoff, unified catalog/Manager UI, Translation admission, tests, isolated smoke driver, approved plan, and this report. The only Native-first regression test edit updates assertions for the new Translation handoff boundary. The SDD progress ledger is local/ignored and is not part of the Git checkpoint.

## Final Phase Status

**PHASE 5G COMPLETE — PENDING PHASE 5H APPROVAL**

Stop here. Phase 5H/5I, PR, merge, tag, release, and installer publication were not started.
