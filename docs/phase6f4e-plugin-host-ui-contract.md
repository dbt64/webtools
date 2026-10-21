# Phase 6F-4E — Plugin Host/UI Experience Contract

## Decision

Implementation, automated regression and real packaged acceptance are complete for Vanilla, Vue, React, Svelte and a page which does not consume theme variables. The user has also confirmed the remaining Windows manual acceptance passed; details and evidence limits are recorded in the final closeout below.

**PHASE 6F-4E COMPLETE — PLUGIN HOST/UI EXPERIENCE ACCEPTANCE PASS**

**READY FOR PHASE 6F-5** — Phase 6F-5 has not started.

## Scope and ownership

Plan: [approved implementation plan](superpowers/plans/2026-10-15-phase6f4e-plugin-host-ui-contract.md).

- Host-rendered Launcher/search/results/Feature entries, Manager management surfaces and Plugin Window shell stay Host-owned.
- Plugin HTML/CSS/JS, layout, spacing, controls, icons and page accessibility stay plugin-owned.
- The Host publishes exactly one `:root` rule with nine fixed optional `--webtools-color-*` properties. It does not inject element/component rules or the actual CSS `color-scheme` property.
- A plugin must consume the variables to follow WebTools. A page which ignores them remains valid and retains its own styles; visual parity is not promised.
- Saved `light`/`dark` overrides and `system` resolution use one Main-owned controller. No global `nativeTheme.themeSource` override, parallel persistence, plugin API, permission, Manifest field, SDK helper or UI library was added.

The frozen names, values, framework examples and compatibility rules are in [Plugin Window Theme and UI Contract](plugin-window-theme-contract.md).

## Implementation

| Task | Result |
| --- | --- |
| 1 — Pure resolver | Fixed palettes; deterministic root-variable-only CSS; shared resolved scheme and shell background. |
| 2 — Saved/system theme | Successful settings-save notification; system listener resolves the last accepted preference; listener disposal. Failed/rolled-back writes cannot publish a temporary Native mirror value. |
| 3 — Runtime styling | Initial insertion is awaited before bridge READY/window reveal; live replacements are serialized; the old key is removed after successful replacement. Runtime identity/generation and authority guard every completion. |
| 4 — Window shell | Initial/live outer background follows the same provider; Feature identity, bounds, title/icon, reuse, focus and close behavior are retained. |
| 5 — Author contract | Host/content ownership, optional variables, explicit control-scheme consumption, fallbacks and four framework examples documented. |
| 6 — Packaged acceptance | Five real validated pages pass; isolated timeout/interruption cleanup is tested. The user later confirmed the Windows personalization and physical interaction checklist passed. |
| 7 — Regression/report | Commands below pass; final closeout records the user-confirmed manual result and installer candidate. No stage, commit or push. |

Theme insertion is optional presentation: an initial failure emits a fixed sanitized warning and permits plugin fallback; a failed live replacement retains the previous styling. The warning is not a successful-theme claim. Close/revocation removes subscriptions/styles; a late insertion cannot restyle another runtime.

## Source and build identity

- Repository: `D:\SystemDefault\Desktop\HomePage`.
- Branch: `codex/shared-ai-translation-2.0`.
- HEAD: `707c5673dff479285b34a5b441bec9d3b725c737`; this is a dirty-checkout build, not a new checkpoint.
- Windows 11 Pro x64, `10.0.26100`; Node `24.21.0`; invoked pnpm `12.5.1`; packaged Electron `44.4.5`.
- `package.json` continues to declare `pnpm@9.15.9`; this phase did not change package management or dependencies.
- All evidence, external author projects, disposable profiles, screenshots and unpacked binaries are under:

```text
C:\Users\admin\AppData\Local\Temp\WebTools-Phase6F4E-ddaab7c29f52409285a763b1643014eb
```

The following paths are relative to that evidence root unless stated otherwise:

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Packaged Manager | `packaged\win-unpacked\WebTools.exe` | `98cf85408e7a2cacfd99cd74ee9f7d032ea7cbec0822aa7037ecb32a1639c8f0` |
| Application payload | `packaged\win-unpacked\resources\app.asar` | `95578c9b1891c38418ba8b43409779f28430ded90637a352552c271a9bd0ebf0` |
| Five-page theme package | `theme-acceptance.wtplugin` | `207ec5e3f68df33a91c6611c77f0722ab0a020c850119eb8cda3d3c20e08a390` |
| SDK-client regression package | `regression-vanilla.wtplugin` | `ed419a3fbe3df138f1ba50ab75edd2f021c8d953642504e21708f66da67a5fad` |
| Final theme evidence | `run-3\theme-acceptance.json` | `24cc73c2f7931cfb65911b2dc1c6360db188922773f2e4b29bf2eece8bc1fe04` |
| General runtime regression | `runtime-regression\runtime-web-packaged-acceptance.json` | `f2692a39c8e061b21ae28e9e9c0a7e689211776575c13be6378a8034eaf13fcd` |

The reused Release NativeHost is at `C:\Users\admin\AppData\Local\Temp\WebTools-Phase6F4D-ConfigAcceptance-828cc57464bb4e0ea07eba9505ffa510\binaries\native`:

- `WebTools.NativeHost.exe`: `f920539c3a119e943cf9cb12f17549f30fbe311fc4959f60db01da272375ab3e`.
- `WebTools.NativeHost.dll`: `0e47f0fa3f579dfd110dad6f990e6a265db057cba34af93c6c3b596ccedc55fd`.

No C# source was changed by the original implementation phase; its real isolated NativeHost/Manager lifecycle was exercised, not as a new certification of unrelated Native features. A separate installer candidate was generated during the final closeout below. It was not installed over the production installation.

## External fixtures and Host authority

The external author project builds real Vanilla/Vue/React/Svelte bundles using ordinary Vite/CSS imports, plus a fixed-style no-token page. The current official `webtools-plugin` CLI validates the source, packs the archive, and validates the final archive. Production install/enable/open uses the existing trusted Manager preload, authoritative Host package validator, immutable snapshot, custom protocol, Session and `WebContentsView`.

The SDK-client regression reuses the earlier external Vanilla output, changes only its disposable acceptance ID to the existing accepted fixture ID, then officially validates/packs it again. Its actual SDK `ready` promise resolves in the packaged Host. No SDK implementation, starter or tarball was changed. The temporary framework dependencies are not project dependencies.

## Packaged results

Final theme run: **AUTOMATED PACKAGED PASS**; NativeHost PID `26280`, created `2026-10-15T08:22:51.033409Z`.

| Page | Initial light | Live dark | Saved system resolution | Narrow/wide | Input, reuse, close/reopen |
| --- | --- | --- | --- | --- | --- |
| Vanilla | PASS | PASS | PASS | PASS | PASS |
| Vue | PASS | PASS | PASS | PASS | PASS |
| React | PASS | PASS | PASS | PASS | PASS |
| Svelte | PASS | PASS | PASS | PASS | PASS |
| No-token | Variables present; own colors retained | Own colors/layout unchanged | Variables follow system; own styling retained | PASS | PASS |

- Opted-in pages: light background/text `rgb(243,245,248)` / `rgb(27,38,51)`; dark `rgb(11,12,14)` / `rgb(244,244,245)`; explicit plugin CSS sets the actual control scheme to light/dark.
- No-token page: background/text stay `rgb(248,238,221)` / `rgb(68,40,17)`; fixed content width remains unchanged by theme switching; actual `color-scheme` stays `normal`.
- HWND reuse and single target per Feature pass. Actual native resize produces viewport widths `587` and `1067` CSS px. Observed window DPI is `192`; a second display scale was not tested.
- Simulated CDP keyboard insertion reaches the input; this is not physical keyboard acceptance.
- All 29 recorded theme/READY events satisfy initial `theme-applied` before `runtime-ready` for the corresponding generation. This establishes lifecycle ordering, not a high-speed capture of every DWM frame.
- Cross-document reload retains the existing policy: revoke/close the old runtime. Fresh activation applies the current theme.
- Screenshots for all five pages are outside Git; Vue and no-token screenshots were visually inspected. They show different plugin-owned layouts/styles as intended.
- Native-only Electron count: `0`. After normal Manager close: Electron `0`, NativeHost remains. After explicit isolated NativeHost exit: both `0`; final owned-process inventory `[]`.

General runtime regression: **PLUGIN_RUNTIME_EXTERNAL_PACKAGED_PASS**, separate NativeHost PID `22888`. The real SDK page renders, closes, survives Manager restart and reopens. Both normal Manager closes return Electron to `0`, NativeHost remains until explicit exit, final NativeHost/Electron counts are `0/0`.

This web-mode regression does not re-certify the broader historical Node/native-addon/network/storage adversarial matrix.

## Review findings and corrections

An independent final review identified three substantive issues. All were accepted and corrected in one fix pass:

1. **P2 — transient setting publication:** an OS event could read the Native mirror during an unfinished combined settings save. The controller now stores the accepted preference separately; only the successful-save callback replaces it. A regression first reproduced the failed assertion, then passed after the fix.
2. **P2 — process ownership in cleanup:** executable identity alone did not establish ownership by this run after a preflight refusal. A test-only ownership ledger now acquires only the launched Native PID/parent identity and current authenticated descendants. Tests cover pre-existing processes, unrelated paths/parents and PID reuse.
3. **P2 — interrupted/failed startup cleanup:** cleanup now handles signals and startup before Pipe connection, including interruption before the first identity observation. Graceful close is attempted first; any failure-only forced cleanup rechecks captured path/PID/creation time against an acquired OS process handle. Unknown or remaining processes make the result fail.

Directed real-process fault runs `failure-before-pipe`, `interrupt-after-native` and `interrupt-before-identity` each intentionally exit `1`, preserve the failure record, and leave owned process inventory `[]`. No forced cleanup was needed in these runs. These are expected test failures, not product acceptance PASS records.

The generic external-package runner also needed test-only adaptation from obsolete Plugin Center selectors/embedded Feature toolbar to the existing Manager preload and independent page lifecycle. Its web-mode command passes against the final build. No production bypass/API was added.

Earlier `run-1` failed because the debugger endpoint had not started listening; the polling wrapper was corrected. `run-2` passed before final review. Both records remain preserved; `run-3` is the final product-build evidence. The later startup-interrupt tooling refinement is verified by the directed failure runs rather than repeating all five page cases.

### Findings at this report

- P0: **0**.
- P1: **0**.
- Blocking P2: **0**.
- Three P2 findings above: **resolved**.
- Non-blocking P2: **0**.
- P3: **1** documented palette limitation. The inherited light accent/foreground contrast is about `4.19:1`, below `4.5:1` for normal-size text. The approved palette is retained; authors must choose accessible composition. There is no blanket WCAG guarantee or silent Manager color redesign.

## Regression commands and results

| Command | Result / evidence |
| --- | --- |
| `pnpm test` | **590/590 PASS**, `pnpm-test-final.log` (earlier pre-review result: 586/586). |
| Focused resolver/controller/settings/runtime/window/ownership tests | **29/29 PASS**, `focused-final.log`. |
| `pnpm run typecheck` | **PASS**, `typecheck-final.log`. |
| `pnpm run build` | **PASS** — Main, preload, renderer and sandbox preload, `build-reviewed.log`. |
| `pnpm exec electron-builder --win --dir --config.directories.output=<TEMP root>\packaged` | **PASS**, `package-reviewed.log`; only disposable unpacked acceptance output. |
| `node --check scripts/verify-phase6f4e-plugin-theme.mjs` and generic runner syntax | **PASS**. |
| `pnpm run acceptance:plugin-runtime` with arguments below | **PASS**, `runtime-regression.log`. |
| Theme runner with arguments below | **5/5 PASS**, `theme-run-3.log` / `run-3\theme-acceptance.json`. |
| `git diff --check` plus new-file whitespace checks | **PASS**. |

The commands used the evidence root above as `$evidenceRoot` and the reused Native directory above as `$nativeRoot`:

```powershell
node --experimental-transform-types scripts/verify-phase6f4e-plugin-theme.mjs --root "$evidenceRoot\run-3" --native-root "$nativeRoot" --manager-root "$evidenceRoot\packaged\win-unpacked" --package "$evidenceRoot\theme-acceptance.wtplugin"

pnpm run acceptance:plugin-runtime --root "$evidenceRoot\runtime-regression" --native-root "$nativeRoot" --manager-root "$evidenceRoot\packaged\win-unpacked" --http-port 19374 --mode web --framework vanilla --plugin-name 'Phase 6E-8 vanilla external' --feature-title Home
```

Each invocation requires a fresh root/profile; the recorded directories must not be reused. Existing Node transform/module-type warnings and electron-builder's missing-author warning do not change the successful exit results; no unrelated package/config changes were made to suppress them.

## Isolation and Git

- Executables, fixtures and profiles are canonical strict TEMP descendants. Links/reparse paths and existing profiles are rejected. A unique isolated Pipe and existing acceptance opt-in are used.
- Process operations require run ownership plus exact executable path, PID and creation time. No process-name termination or production NativeHost connection is used.
- No operation targets `D:\webtools`, the real `%APPDATA%\Nook`, real Tokens/SecretStore, registry or startup registration. This is a path/operation-boundary statement, not a claim that a full before/after production filesystem or registry snapshot was captured.
- The pre-existing dirty tree is preserved. Before execution there were 274 short-status entries; the final count is 285. No original status entry disappeared. Existing Launcher, Manager, SDK and other phase work was not reset, cleaned, stashed or staged.
- HEAD/branch remain as listed above, 12 commits ahead of the configured upstream. Staged diff is empty. No commit, push, PR or phase advance.
- The external `final-source-file-hashes.json` inventories the 18 scoped files below; `git-status-before.txt` / `git-status-after.txt` retain the complete working-tree inventory. Pre-existing content in shared integration files is not claimed as newly authored work.

### Files changed by this execution

- New `electron/plugins/plugin-window-theme.ts` and `.test.mjs`.
- New `electron/plugins/plugin-theme-controller.ts` and `.test.mjs`.
- New `electron/ipc/settings-theme.test.mjs`; successful-save notification in `electron/ipc/settings-handlers.ts`.
- Wiring in `electron/main.ts`.
- Theme readiness/update/cleanup in `electron/plugins/web-plugin-runtime.ts` and focused additions in `.test.mjs`.
- Shell subscription in `electron/plugins/plugin-window-manager.ts`; new `.test.mjs`.
- New `scripts/verify-phase6f4e-plugin-theme.mjs` and `scripts/lib/plugin-theme-acceptance-ownership.mjs` / `.test.mjs`.
- Scoped external-mode/identity updates in `scripts/verify-plugin-runtime-packaged.mjs`.
- New `docs/plugin-window-theme-contract.md`, this report, and a short link/summary in `docs/plugin-runtime.md`.

The approved plan itself was already present and is unchanged. Some listed integration files already contained earlier uncommitted work; the entire HEAD diff of those files is not attributed to 6F-4E.

## Manual Windows acceptance checklist

Use an isolated build/profile and the validated theme fixture; do not install it into the production profile for this check.

1. Set WebTools to **system**. Open an opted-in Theme Feature. Change Windows **app mode** light → dark (or dark → light) once. Confirm the already-open page and window background update without reopening. Restore the original Windows setting afterward.
2. Check one explicit WebTools light/dark override while Windows uses the opposite scheme. The opted-in page should follow WebTools. Open **Theme plain**; its beige/brown page and its controls should keep their own style.
3. Use the physical keyboard to focus/type/tab in the page; resize, close and reopen the native Plugin Window normally. Check that there is no visible wrong-theme flash or unexpected focus/close behavior. If another display scale is available, check it once; otherwise record unavailable.

The checklist above was pending when the initial implementation report was written. Its eventual result is recorded separately below; it is not inferred from automated CDP input, computed styles or the mocked system-theme event test.

## Final Acceptance Closeout

### Manual Windows acceptance

**USER CONFIRMED PASS** — On 2026-10-15, the user reported that the current manual tests all passed. This confirmation is recorded for the required checklist above:

- System theme change updates an already-open opted-in plugin page and window shell.
- An explicit WebTools theme override works against the opposite Windows theme; the page that does not consume theme variables retains its own appearance.
- Physical keyboard interaction, resizing, normal close and reopen work without an observed theme or focus regression.

This is user-confirmed acceptance, not independent machine verification. No screenshot, exact test timestamp, PID, or event log was supplied. A second display-scale result was not reported; that optional check is not treated as a blocking gate.

### Windows installer candidate

Built after the manual confirmation with `pnpm run package:win`:

| Property | Result |
| --- | --- |
| Product version | `0.1.0` (stable candidate) |
| Installer | `D:\SystemDefault\Desktop\HomePage\release\native-production-20261015-184200\WebTools-Setup-0.1.0.exe` |
| Size | 191,665,821 bytes |
| SHA-256 | `3c4d618943af2deccf019095b8b0398d1e59d6cde0fbfab493d6d0faeaffbc64` |
| Authenticode | Not signed; this is a local acceptance candidate. |
| Source | `707c5673dff479285b34a5b441bec9d3b725c737` plus the existing dirty working tree |
| Installation smoke | PASS — isolated Chinese/space path, Manager discovery and self-uninstall |

Fresh build verification: `pnpm run typecheck` PASS; `pnpm test` 590/590 PASS; `pnpm run build` PASS; NativeHost Checks 72/72 PASS; UpdateHelper Checks PASS; NSIS installer compile PASS; isolated cover-install and install/uninstall smoke PASS. The Node test output included the repository's recurring WebSocket port `24678` in-use message; the suite still reported zero failures, and no listener remained after the build. The build also emitted .NET UIAutomation reference resolution and NSIS version-resource warnings; they did not fail the build or checks.

The installer candidate was not launched or installed by this task. The build's smoke install used the isolated `release\native-production-20261015-184200\smoke-install\WebTools Phase 4F 中文 空格` path and the dedicated Phase 4F test registry identity; both the smoke install directory and test registry entry were absent after completion. The real `D:\webtools` installation was not targeted. Build outputs remain under the ignored `release/` directory.

### Git and phase boundary

- Branch: `codex/shared-ai-translation-2.0`.
- HEAD remains `707c5673dff479285b34a5b441bec9d3b725c737`; no commit or push was made.
- The pre-existing dirty working tree was preserved; no files were staged, reset, cleaned or stashed. The installer is ignored under `release/`.
- P0: 0; P1: 0; blocking P2: 0. The previously documented non-blocking P3 palette contrast limitation remains.
- Phase 6F-5 has not started.

**PHASE 6F-4E COMPLETE**

**PLUGIN HOST/UI EXPERIENCE ACCEPTANCE PASS**

**READY FOR PHASE 6F-5**
