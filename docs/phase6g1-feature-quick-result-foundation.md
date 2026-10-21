# Phase 6G-1 — Feature Quick Result Foundation

## Status and scope

**QUICK RESULT FOUNDATION COMPLETE — USER CONFIRMED MANUAL ACCEPTANCE PASS.** Implementation, automated regression and isolated packaged verification passed against the approved [6G-0 design](superpowers/specs/2026-10-16-phase6g0-feature-quick-result-design.md) and [eight-task plan](superpowers/plans/2026-10-16-phase6g1-feature-quick-result-foundation.md). The user subsequently confirmed that the requested manual checks had no observed issues, including the previously reported panel-height issue. This is user-reported acceptance, not independently recorded per-case machine evidence. Final artifact/evidence identities are recorded below.

This is the provider-neutral Quick Result foundation. It does not complete Translation Plugin 2.0. Translation parity review, Qwen-MT adapter decisions, Legacy migration/removal and Phase 6G-2 have not started.

Source baseline: `codex/shared-ai-translation-2.0`, HEAD `707c5673dff479285b34a5b441bec9d3b725c737`, with substantial pre-existing tracked and untracked work. No stage, commit, push, PR or release was performed.

## Implemented path

1. An explicit Selected Text Super Panel click requests an optional Quick Result for a Manifest v3 Node Command.
2. Main authorizes the current installed package or approved development snapshot. The worker receives Main's optional `resultTarget: 'super-panel'` and can return void or `{ kind: 'text', text }`.
3. The real Utility Process uses `process.parentPort`. Main validates its terminal message and retains text only in the active execution stack until owned-child cleanup succeeds.
4. Main rechecks the existing live source predicate, cancellation, request and connection before sending one final private result. The ordinary Feature completion ACK remains status-only. Main waits for the result's transport ACK before releasing the existing invocation ownership.
5. The reused WPF panel accepts only its current request/ref/local generation. The result is plain text with a bounded scroll area. Normal Utility/Electron exit or Pipe reconnection leaves already accepted inert text in Native; pending work is cancelled on disconnect.

No new Manifest field, permission, public Pipe, FeatureRef format, persistent result schema, presentation ID, TTL, candidate/commit protocol or activity framework was added. Main/Renderer/Launcher/Window Features keep their existing presentation paths. No capture or clipboard algorithm, 50 ms initial check, compact first frame, HWND reuse or action-list virtualization was changed.

### Limits and negotiation

- Text: 8,192 Unicode scalars **and** 32,768 UTF-8 bytes; CRLF/CR become LF. Reject unpaired surrogates, whitespace-only text, unsupported C0 controls, accessors and extra fields. Native uses the same ECMAScript whitespace definition as Main, including BOM/NEL behavior.
- Final payload: 65,536 bytes. Invocation input remains 16 KiB, existing completion ACK 256 bytes, frame 4 MiB.
- Existing 30-second command budget, eight active commands and 2,048 replay entries remain. Replay retains status/fingerprint/cancellation metadata, never result text. A bounded cancelled entry prevents cancel-before-dispatch replay.
- The legacy hello has a closed capability list. Quick Result is therefore negotiated by an authenticated **post-hello** request. Older Native peers can reject that request while remaining connected. Authors guard the optional result target; no fabricated minimum product version separates old/new 0.1.0 Hosts.
- Raw new-message JSON rejects duplicate fields before object parsing, including escaped aliases. C# mirrors strict payload/envelope checks.

### Development authority

The existing SDK session ticket, project confirmation, Host archive validator, immutable snapshot, hash, revision and authority remain in use. A memory-only selected-text command overlay is marked “开发”; it does not enter the production Launcher cache. Main selects the current approved development source before execution and does not fall back to an installed source when that selected authority fails. Reload/disconnect clears a matching result while Main/Pipe are available. Normal Electron shutdown does not turn an accepted result into a revoked presentation.

Development evidence is labelled separately from installed packaged evidence. The automated controller calls the **installed tarball's same `startDevSession` implementation used by the CLI**, supplies orderly shutdown, and uses the real SDK/Host development Pipe and build validation. Plugin code imports only `@webtools/plugin-sdk/node`; no monorepo private API or workspace link is used by the author project.

### Shared AI confirmation

Quick Result supplies an invocation-specific presentation adapter to the existing Host capabilities. Native displays fixed confirmation wording, safe source/provider labels and a bounded preview in the current panel. The reader ACKs promptly; neither the operation queue nor reader waits for the user. The independent decision is single-use and tied to the same request/ref/consent/provider. Main checks the provider again before the existing effect executes. Existing grants, gesture consumption and other-surface confirmations stay in force.

Acceptance uses the existing isolated free provider stub. No real AI request or credential read was used. Cancellation prevents unsent requests and discards late output; this does not promise remote billing cancellation.

## Test environment and identities

- Windows x64; pnpm `9.15.9`, TypeScript `5.9.3`, Electron `44.4.5`, .NET SDK `10.0.401`.
- Product `0.1.0`; SDK `1.7.0`; Plugin API Major `1`; Manifest `3` for the test plugin. The creator package is unchanged.
- Logs, baseline copies, tarball and failed attempts: `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\20261016-152813`.
- Final isolated runtime/author/profile: `D:\SystemDefault\Desktop\webtoolstest\qr6g1-1016`.
- All runtime paths are canonical non-reparse D-drive paths. TEMP/TMP overrides apply only to test/build children. Real `D:\webtools`, `%APPDATA%\Nook`, tokens, settings, startup and unrelated processes are protected by the existing guards.

**Execution-path refinement:** the originally planned verbose runtime path put a development command's working directory beyond Windows' current-directory limit. Both ordinary and namespaced Node `chdir` reproduced `ENAMETOOLONG`. An attempted CWD workaround was tested and withdrawn; final command CWD semantics remain unchanged. Only the disposable runtime path was shortened, within the user's designated D-drive test directory. Original evidence remains at its original location. The short author project regenerated its own local lockfile, then passed frozen install; copying a relative local-tarball lockfile between directories was not treated as a valid frozen workflow.

### Final artifacts

Final candidate: `D:\SystemDefault\Desktop\HomePage\release\native-production-20261016-171147\WebTools-Setup-0.1.0.exe` — **191,786,426 bytes**, SHA-256 `9FAADB343F56959CA93C38731D3795DC0EFE1B1088D353AFBF402809FA22C809`.

| Artifact | SHA-256 |
| --- | --- |
| Staged/tested `WebTools.NativeHost.exe` | `F920539C3A119E943CF9CB12F17549F30FBE311FC4959F60DB01DA272375AB3E` |
| Staged/tested `WebTools.NativeHost.dll` | `7A8A3828AFF40EFEA406C285C34FF3290564199B6A691197DDE673CC3AC1C51D` |
| Staged/tested `Manager\WebTools.exe` | `2F74FBCE3DA28E0FC15DC957EB2B5BF876A94A3573EE643E4CBEC2762FCEB5D5` |
| Staged/tested `Manager\resources\app.asar` | `7E14DB883C44894528CAAF55764A4DE3D0BC7F49A14ED84A16AE098E06123459` |
| SDK `webtools-plugin-sdk-1.7.0.tgz` (66,100 bytes) | `7251C9EF51557527CE1035EB812EB6FD27555838F941240AE6AB3F7937D92D70` |
| Plugin `final-quick-result.wtplugin` (136,332 bytes) | `912DF537329AA2D6A40A7F66F4ABDA3B536E8780DD76C250266965C99D92D4AF` |
| Sanitized `quick-result-acceptance.json` | `28B13CC2144C817B9993FAD655BE2B1DBE2098F399F0230F4C754ACB35BDF2BA` |
| `final-source-manifest.json` | `29360C70E7465D9464FE0408274322514145D2B53687EAE0B13F9538B76D7E62` |

SDK location: `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\20261016-152813\sdk\webtools-plugin-sdk-1.7.0.tgz`.

Validated test plugin: `D:\SystemDefault\Desktop\webtoolstest\qr6g1-1016\final-quick-result.wtplugin`; id `org.webtools.acceptance.runtime`, version `1.0.0`, Manifest `3`, API Major `1`, declared capability `sharedAI.complete`. It returns synthetic local text; it is not a Translation implementation. The authoritative Host validator accepted the archive before installation in the isolated profile.

Machine evidence: `D:\SystemDefault\Desktop\webtoolstest\qr6g1-1016\evidence\quick-result-acceptance.json`. Source manifest: `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\20261016-152813\final-source-manifest.json`. All **484** recorded source/config/resource entries still match the final package input; report/plan closeout text is separate from that build identity. All four staged runtime hashes match the actual isolated runtime evidence. This identifies the tested dirty source, rather than claiming HEAD alone describes the candidate.

## Verification against design §12

| Requirement | Evidence and boundary |
| --- | --- |
| Pure contract | AUTOMATED PASS: TS and Native boundary, normalization, duplicate key, strict field and binding tests. BOM/NEL and a development-label surrogate boundary were added after a failing review reproduction. |
| Authorization | Real installed validated package execution, disable and replacement; real authorized SDK development connection/reload. Existing focused tests cover source predicates, revoked authority, missing grant/Feature, stale revision and no fallback. |
| Development Quick Result | Real external tarball/session/snapshot/Node/WPF path; real rebuild clears the old result and executes revised code; explicit disconnect clears the source. Recorded as DEVELOPMENT WORKFLOW PASS separately. |
| Existing behavior | Void and bad/absent result behavior run in the packaged Host. Window/Legacy/Manager/Launcher and old-peer compatibility remain covered by regression/focused tests; not described as a new full manual retest. |
| Result ordering | Adapter tests hold cleanup open, inject duplicate/invalid terminal messages and fail owned cleanup. Main tests exercise final delivery/replay/source and clear races. Real final WPF body hash is checked after execution with command Utility count zero. |
| Lifetime | Real dismiss, new invocation, disable, replacement, development reload/disconnect, normal Electron idle exit/reconnect and pending peer loss. Slot checks distinguish pending from accepted, old clear and late output. Physical Escape/outside-click/Launcher/capture presentation remains manual. No result TTL. |
| Cancel races | Focused queue pre-cancel, session loss, abort, cleanup-failure and consent tests plus real pending cancel/switch/peer-loss cases. An actual OS cleanup refusal was **NOT TESTED**; the failure branch is fake-child tested, not relabelled a real runtime failure. |
| AI consent | Real same-panel confirmation visible, cancel sends zero stub calls, approve sends exactly once, repeated decision sends no second call. Provider-change/revocation/abort semantics use focused tests. No paid service. |
| Native UI | Actual WPF result/consent controls and scroll bounds are observed by the isolated control seam. Real mouse, visual themes/scroll/width, physical dismissal and compact first frame are **USER CONFIRMED PASS**; the confirmation is not backed by per-case machine records. |
| Runtime ownership | Exact executable path + PID + creation-time ownership. Real Utility cleanup, Electron group zero while Native retains accepted text, reconnect and final all-zero exit. Forced isolated Main exit is an intentional peer-loss case, not a normal-close claim. |
| External author | Local 1.7.0 tarball, frozen install, public typecheck, build, validate, pack, inspect and authoritative Host validation/install. No manual ZIP, private author import or workspace link. |
| Translation parity | NOT TESTED / NOT STARTED; explicit entry gate for later business implementation. No claim of Translation parity. |
| Data protection | Disposable D-drive runtime/profile/Pipes and bounded test identities only. No real clipboard capture was exercised. Existing isolated installer smoke uses its private registry identity and self-uninstalls. |
| Regression | Actual final commands/results and raw log paths recorded below. No historical soak or resource stress rerun. |

## Failures and fixes retained in evidence

1. **Utility bootstrap:** `electron.parentPort` was undefined in the actual runtime, causing exit 1 before the handler. A boot-only diagnostic and red/green entry test reproduced it. Corrected to `process.parentPort`; real packaged command tests then executed.
2. **Void lifecycle:** a completed void command initially left a pending Native binding. Its matching slot now clears while retaining the fixed “未返回快速结果” feedback.
3. **Unicode consistency:** .NET whitespace differed from Main for BOM/NEL; the Native mirror now uses Main's exact set. Development label truncation now counts scalars and cannot cut a valid surrogate pair. Both defects have failing-before/passing-after tests.
4. **Collector readiness:** install/enable returns before asynchronous Native projection; the runner waits for the exact row condition. SDK readiness now requires its current process's ready signal, rather than an old marker file.
5. **Collector cleanup:** the old resource-test exit only closed a window under explicit application shutdown. The test-only exit requests WPF application shutdown; failure cleanup waits for the actual Manager group to exit first. Earlier exact-identity forced cleanup and NOT VERIFIED records are retained; they are not overwritten with PASS.
6. **Fixture/tool maintenance:** a misspelled declared capability was rejected and corrected; a missing output directory was fixed after OUTPUT_IO; package-version and authenticated-client source assertions were updated for the approved API changes. Initial concurrent timeout failures passed in the serialized production packaging regression. No limit or assertion was relaxed to turn them green.
7. **Duplicate native modal error:** a later 18-case run passed functional assertions but failed final exit. The captured exact-path Native process still owned a `#32770` window titled `WebTools`; the controller's old generic failure path called the native error dialog as well as the new panel feedback. Quick Result status/transport/startup failures now go through the current panel only. Legacy Launcher failures retain their dialog. Focused checks cover both branches and pending-queue startup failure; the packaged runner now asserts zero native error dialogs after every case.
8. **Invalidation after reconnect:** a real run preserved text after normal Electron exit/reconnect, then reproduced a timeout when disabling that source without first invoking another Feature. Main's old in-memory displayed binding had ended with its session. The idempotent private negotiation reply now exposes only Native's **accepted requestId/ref**, never text or a pending slot. On a targeted installed/development source mutation, Main queries that metadata and sends the existing exact-binding clear only for the affected plugin. This does not recover execution/replay authority, persist results or clear on reconnection itself. Query is sent at the mutation event before awaiting other work; an old clear still cannot erase a new request's result. The real regression now checks preserve-on-reconnect followed by source-disable clear.

One intermediate packaging run reached smoke-install discovery while the new focused check file was missing its `System.IO` import. That candidate's packaging command failed; it was not promoted. The import was corrected, and the known private smoke installation was removed through its own verified self-uninstaller before rebuilding. This was test/build overlap during investigation, not a passing package result or a production-install operation.

No result or prompt body, key, ticket token or raw user data is included in the sanitized evidence. The synthetic result is checked through length/hash. Original failed-attempt logs/profiles remain outside Git.

## Regression and packaged results

The final `pnpm run package:win` completed with exit code **0**. Its regression, build, installer and isolated smoke results are in `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\20261016-152813\logs\accepted-final-package.txt`.

| Actual command/check | Final result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm test` | **622/622 PASS** |
| `pnpm run build` | PASS: Electron Main, Preload and Vue Renderer |
| `dotnet run --project native/WebTools.NativeHost.Checks -c Release` | **72/72 PASS** |
| `dotnet run --project native/WebTools.NativeHost.Checks -c Release -- --quick-result-checks` | **33/33 PASS**, `logs\final-native-quick-result.txt` |
| `dotnet run --project native/WebTools.UpdateHelper.Checks -c Release` | **10/10 PASS** |
| `pnpm run package:win` | PASS; cover-install/uninstall ordering and Unicode/space isolated install, Manager discovery and self-uninstall PASS |
| External SDK workflow | PASS: local tarball install/frozen lockfile, public typecheck, build, official validate/pack/inspect and Host validation |
| `node scripts/verify-super-panel-quick-result.mjs` with final isolated roots/package | **18/18 PASS**: 16 REAL PACKAGED + 2 DEVELOPMENT WORKFLOW |

The command adapter/worker, source metadata and Unicode regressions are included in the final Node total; their focused runs are supplementary, not additional full-suite cases. Final Native checks and UpdateHelper checks retain the original command paths. Existing UIAutomation reference/nullable warnings, Node module-type warnings, electron-builder metadata notices and NSIS `LegalCopyright` warning remain visible in logs; no warning was hidden or converted into a test PASS. No historical cold-start, soak or search-resource workload was repeated.

### Final real runtime matrix

Final runtime log: `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\20261016-152813\logs\accepted-final-runtime.txt`. Recorded interval: `2026-10-16T09:16:18.990Z`–`09:17:46.864Z` (UTC). The same isolated NativeHost **PID 24540** was retained throughout.

| Case | Evidence label | Result |
| --- | --- | --- |
| Cold Native-only, Electron zero | REAL PACKAGED | PASS |
| Text reaches WPF after owned Utility cleanup | REAL PACKAGED | PASS |
| Void returns no result and clears pending | REAL PACKAGED | PASS |
| Invalid result rejected | REAL PACKAGED | PASS |
| Extra result field rejected | REAL PACKAGED | PASS |
| Handler failure returns no result | REAL PACKAGED | PASS |
| Child exits before completion, no result released | REAL PACKAGED | PASS |
| Long result uses a bounded WPF scroll area | REAL PACKAGED | PASS |
| Dismiss cancels pending result without reopening | REAL PACKAGED | PASS |
| New invocation rejects old late result | REAL PACKAGED | PASS |
| Disable clears the matching accepted source | REAL PACKAGED | PASS |
| Same-panel AI cancel/approve/single-use decision | REAL PACKAGED | PASS |
| Validated package replacement clears old source | REAL PACKAGED | PASS |
| External SDK session/snapshot/Node result | DEVELOPMENT WORKFLOW | PASS |
| Development reload executes revised code; disconnect clears | DEVELOPMENT WORKFLOW | PASS |
| Normal Electron idle exit/reconnect preserves text; subsequent source disable clears | REAL PACKAGED | PASS |
| Cold headless command returns to Electron zero | REAL PACKAGED | PASS |
| Pending Pipe peer loss discards late output and cleans Utility | REAL PACKAGED | PASS |

Every case recorded **zero Native error dialogs**. The headless case recorded Manager window count **0**, renderer count **0**, then idle Electron count **0**, while the result remained in Native. AI cancel made no send, approval made exactly **1 stub call**, repeated approval made no second call; real provider calls **0**, clipboard writes **0**. Final exact-path Native/Manager/Utility process count: **0**. Final cleanup used normal exit and required no forced cleanup. Earlier failed and 17-case evidence remains available but is not substituted for this final candidate.

### Review and remaining evidence

Author review found no open P0, P1 or blocking P2 after the documented fixes and final regressions. This is not an independent multi-agent review. The remaining required work is the physical/visual checklist below; automatic WPF state assertions do not stand in for mouse or visual acceptance. A real OS cleanup refusal was not manufactured; only that failure branch's fake-child coverage is claimed.

The original test profile/installation guards and exact process identity checks were used. No before/after full snapshot of the real user profile or registry was collected, so no independent filesystem-wide or registry-wide immutability claim is made. The private installer smoke self-uninstalled; it did not cover-install the live production installation.

Final `git diff --check`: **PASS (exit 0)**. Supplementary inspection found no whitespace additions across 21 changed baseline files or the 14 newly added untracked files. A broad scan also found existing whitespace in four pre-existing untracked files; those unrelated lines were left intact. Logs: `final-diff-check.txt`, `final-scoped-whitespace.json` and the full broad-scan `final-whitespace-summary.json` in the run ledger.

## Files changed in this work package

Existing pre-task files are compared against copies in the D-drive baseline, not against HEAD alone (HEAD omits substantial earlier approved work).

- Contracts: `src/shared/feature-quick-result-contracts.ts` and tests; invocation contracts/tests; Native invocation/Quick Result protocols and frame codec; Native Quick Result checks and the single Program routing addition.
- Execution: Node command entry/adapter and tests; Feature activation/service and tests; PluginManager source predicate; PluginDevelopment overlay/authorization and tests.
- Transport: Native Manager client/command/protocol and tests; Main wiring; ManagerController and bounded invocation queue.
- Presentation: SuperPanelQuickResultState; SuperPanelWindow XAML/code; consent adapter/tests.
- Test-only seams: opt-in resource control commands/exit; canonical packaged-acceptance development chooser; its focused test; `scripts/verify-super-panel-quick-result.mjs`.
- SDK/docs: 1.7.0 package metadata/Node types, public tests, README/development guide, this report and execution annotations in the approved plan. Version/authentication assertions in release/IPC tests match those approved changes.

No build configuration, installer/update implementation, Translation/provider implementation, renderer UI, capture algorithm, user data schema or startup registration was changed by this work package.

## Manual acceptance checklist

Use the final candidate and the validated synthetic test plugin identified above. `failure`, `invalid`, `extra` and `childexit` are deliberately negative automation fixtures; they are not ordinary demo features.

1. Select harmless text, invoke Super Panel and **actually click Synthetic quick**. It should display `Synthetic local result: …` in the same panel, with a readable Host source and no focus steal/new window.
2. Click **Synthetic long**. Scroll the bounded result, check a narrow display and light/dark themes. Actions and panel controls must remain accessible; old content must not flash back.
3. Exercise physical Escape, first outside click, opening Launcher, new selected text and another Feature. Previous result/confirmation should clear; a pending result must not reopen or overwrite the new state.
4. Check same-panel AI confirmation visually **with the isolated free stub**. Before approve there must be no send; cancel/dismiss sends nothing. Automated accept/reject/one-use semantics already use that stub. Do not enter or disclose a real token just for this check.
5. Check normal selected-text capture and no-selection compact-to-board behavior remains unchanged. This round did not recopy the real clipboard or rerun its historical compatibility matrix.

The automated test run exits its isolated application. It does not install the candidate into the real installation or leave an acceptance daemon running.

### Manual acceptance result — 2026-10-16

**USER CONFIRMED PASS.** The user confirmed that the requested manual tests passed without issues, including the previously reported panel-height problem. This confirmation closes the manual acceptance checklist above for the Phase 6G-1 Quick Result foundation.

The confirmation is not an independent machine-recorded run: no per-case timestamps, screenshots, process IDs, paths, or runtime logs were supplied. Do not label these checks `CODEX AUTOMATED PASS` or `INDEPENDENTLY VERIFIED`. Synthetic Quick/Long remain test fixtures for the bounded result transport and panel presentation; their acceptance does not establish real translation, dictionary lookup, text-content matching, or Translation Plugin 2.0.

## Final decision

**IMPLEMENTATION COMPLETE — AUTOMATED REGRESSION PASS.**

**MANUAL WINDOWS ACCEPTANCE — USER CONFIRMED PASS.** The requested mouse/keyboard and visual checks were reported as passing without observed issues. There is no open P0, P1 or blocking P2 in the verified implementation scope.

**QUICK RESULT FOUNDATION COMPLETE.** This closes the Phase 6G-1 foundation acceptance only. Translation Plugin 2.0, real translation/dictionary results, selected-text content matching, and broader uTools parity remain outside this work package and are not represented as complete.

Git remains on `codex/shared-ai-translation-2.0`, HEAD `707c5673dff479285b34a5b441bec9d3b725c737`, ahead 12 / behind 0 from its configured upstream. There are no staged changes. The substantial pre-existing dirty checkout remains; full final status is recorded outside the repository at `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\20261016-152813\final-git-status.txt`. Final whitespace verification is recorded alongside it. No stage, commit, push, PR or release. No Phase 6G-2, Translation business implementation or Legacy removal was started.
