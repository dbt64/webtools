# Phase 6G-2 — Selected-Text Basic Parity & Reliability

**Date:** 2026-10-16

**Development:** IMPLEMENTATION COMPLETE — AUTOMATED REGRESSION PASS — ISOLATED PACKAGED PASS (10/10).

**Phase:** COMPLETE — USER CONFIRMED PASS (2026-10-17). The report's original implementation-time manual gate is retained below as historical context.

**Entry gate:** Phase 6G-1 manual acceptance remains **USER CONFIRMED PASS**; it is not reopened.

**Scope authority:** [approved implementation plan](superpowers/plans/2026-10-16-phase6g2-selected-text-basic-parity.md). The user approved “采用最小链接匹配与真实示例（推荐）”. Phase 6G-3 implementation has not started.

## Source and build identity

- Repository: `D:\SystemDefault\Desktop\HomePage`.
- Branch: `codex/shared-ai-translation-2.0`.
- HEAD: `707c5673dff479285b34a5b441bec9d3b725c737`; upstream `origin/codex/shared-ai-translation-2.0`, ahead 12 / behind 0 when checked.
- The build includes this task's changes on top of a substantial pre-existing dirty checkout. HEAD alone is not its complete source identity. Pre-task status, tracked diff and touched-source copies are preserved at `D:\SystemDefault\Desktop\webtoolstest\phase6g2-20261016\baseline`.
- Node 24.21.0, pnpm 9.15.9, .NET SDK 10.0.401, Electron 44.4.5, Windows x64. Product Version remains 0.1.0; API Major remains 1, Manifest v3 and Projection v2 remain unchanged.
- SDK source/package is **1.8.0**, an additive author contract for the selected-text condition and optional Node external-open adapter. The SDK is still a local tarball, not an npm publication.

All runtime paths below are disposable isolated test paths under `D:\SystemDefault\Desktop\webtoolstest\phase6g2-20261016`. No installer was run against the real installation. No release or installer distribution was performed.

| Artifact | Identity / SHA-256 |
|---|---|
| `runtime\native\WebTools.NativeHost.exe` | `6B34A7E78D1FC006C84DEDF431056EE2EB0520B4118CC3138E931AD02C5EFADF` |
| NativeHost DLL beside it | `8AAD249909E6BBC773B5DCFD45B7C7D04917B9F7DC4399DF0B82D0CF52E3D75A` |
| `runtime\manager-build\win-unpacked\WebTools.exe` | `274FDE73E56D2104E5AFDF347FE8F4B979C69B1BD3588D583CB9328C67EFCDEE` |
| Manager `resources\app.asar` | `C1EF0EA401AA1F354F6F5DDF11EEECBDC88F966950F32BF16FB112BB6537FE23` |
| `sdk-final\webtools-plugin-sdk-1.8.0.tgz` — 67,845 bytes | `D33B3B5C512983A34E10A346D6C80D0F0A17FF414213DECAA097EE8FF436A765` |
| `author-final\selected-text-actions.wtplugin` — 3,155 bytes | `5C9C5D65459284EDBE62B61F7C19209A28C9B7809C495C12659F001990BD75ED` |
| `window-author-final\context-window.wtplugin` — 4,498 bytes | `8A915137E1F994CDA4DF99E98B9815BB0361EB29B830EEB090B00B68188288E7` |

## Implemented behavior

### Local content matching

`acceptedContexts` may add only `textMatch: 'http-url'`, only for `type: 'text'` with sources exactly `['selected-text']`. SDK feedback, the authoritative Host Manifest parser, JSON schema, shared projection parser and Native parser agree on this closed field. Unknown rules, executable patterns and incompatible contexts are rejected. Manifest v1/v2 are unchanged.

NativeHost applies the condition to the original transient bounded selection, not its shortened visual preview. No-rule actions retain their existing type/source behavior: English, Chinese, mixed language and punctuation still offer ordinary text operations such as Translation. A matching HTTP(S) URL shape additionally offers Open Selected Link. Empty/no selection retains the default shortcut board. File/directory rules and deterministic pin order are unchanged.

The shared JS/C# corpus contains 42 cases plus explicit 3,000-unit and malformed-Unicode checks. Recognition trims only outer ECMAScript whitespace and checks bounded host/IP/port syntax. It rejects credentials, internal whitespace/controls, backslashes, partial URLs, unsupported schemes and the documented unsupported IP spellings. This is a **URL-shape filter**, not full IDNA/A-label validation or a DNS/reachability guarantee. Activation and the eventual browser still apply their own URL/security checks. It does not use a language classifier, plugin code, author regex, DNS or network.

### Projection and privacy

Main projects only rule metadata and Feature identity. Native evaluates discovery locally; selected values are not projected, cached or added to diagnostic snapshots. The existing authorized context handoff is used only after explicit activation, then Main rechecks the rule and current authority.

Support is negotiated on the existing authenticated pipe with the exact optional `selected-text-match-http-url-v1` capability, outside the closed legacy hello list. Both installed and development projections omit the entire condition-bearing row for an unsupported peer. They never strip the condition and broaden eligibility. Old no-rule rows remain available; strict parsers/cache behavior remain in force.

### Real optional browser actions

The [Selected Text Actions example](../examples/plugins/selected-text-actions/README.md), ID `org.webtools.selected-text-actions`, version 1.0.0, contains two real Node Commands:

| Action | Eligibility | Effect after explicit activation |
|---|---|---|
| 搜索选中文字 | Ordinary non-empty selected text | Encode the original selection into a Bing HTTPS search query. |
| 打开选中链接 | Approved `http-url` shape | Open the selected HTTP(S) URL, trimming outer whitespace only. |

The example is optional, not installed automatically, and uses only public SDK imports/tooling. The build bundles its public Node adapter with fixed esbuild 0.25.12 before official SDK build/validate/pack/inspect. The deployed Commands do not depend on the author's `node_modules`.

The existing `external.open` capability/OS effect existed, but was not exposed to Node Commands. This task adds the minimal optional `invocation.webtools.external?.open(url)` adapter through the existing Host capability dispatcher. It requires declared/granted capability, live authority, a bounded credential-free HTTP(S) URL and a one-use explicit activation gesture. Main calls the existing `shell.openExternal` effect. No new permission, arbitrary shell fallback or new process owner is introduced. Manifest v2 does not acquire the capability. Node plugin code retains its previously documented ordinary Windows-user permissions; Host capabilities are not an OS sandbox.

### Built-in product delivery adjustment — 2026-10-17

The user manually exercised the optional Selected Text Actions package and reported no issue. That is **USER CONFIRMED PASS** for the example's behavior, not independent machine evidence. Product delivery was then changed so the example is no longer required for baseline search/link actions.

NativeHost now adds `搜索选中文字` to every valid selected-text action list and adds `打开选中链接` when the existing bounded `http-url` predicate matches. These rows appear before projected Translation/plugin Features and remain explicit-click operations. Search reads the current Launcher search-engine snapshot at activation time and uses the same default/enabled-engine selection and template validation as Launcher web search. Link opening revalidates the selection and uses the existing HTTP(S)-only shell start contract. Neither discovery path starts Electron, sends selection through the Pipe, opens a browser or persists the text.

The optional package remains a public SDK example and is not automatically installed or silently removed. A test profile that keeps it installed can therefore show both the Host action and its example counterpart. This adjustment does not change Translation, Quick Result, plugin Window context, Manifest/Projection versions, permissions or SDK APIs.

Focused post-adjustment results: Native selected-text contract **6/6 PASS**; real-WPF presentation/integration **13/13 PASS**. These checks cover ordinary text, valid URL, current custom search engine, action ordering, explicit activation, panel dismissal, and No Context isolation. A new packaged physical-selection/system-browser observation has not yet been run.

### Existing routes verified separately

- **Built-in Translation:** Native Super Panel activation → existing Main invocation service → Manager Translation prefill. Exact selected text reached the existing textarea. With eligible isolated settings, the existing 450 ms scheduling code sent one request to a free local stub; the observation was 582 ms from activation through the test's checks, not a precision timer benchmark. No request occurred during discovery. This task preserves that behavior and does not claim that Manager prefill is request-free.
- **Independent plugin Window:** existing router → PluginWindowManager → production protocol/Session/WebContentsView → public SDK `context.current()`. A real packaged Web plugin received exact selection, reused its target for a second invocation, received replacement context, and closed on disable. No second context bridge was implemented.
- **Same-panel result:** the 6G-1 bounded plain-text Quick Result path remains separate. Synthetic Quick/Long are still foundation fixtures. No real same-panel Translation, dictionary or automatic preview was implemented.

## Verification

### Automated regression — AUTOMATED PASS

Commands were run with process-local `TEMP`/`TMP` under `D:\SystemDefault\Desktop\webtoolstest`.

| Command / suite | Actual result |
|---|---|
| `pnpm test` | **631/631 PASS**, baseline 622/622. Final log `logs\node-tests-closeout.log`. |
| `pnpm run typecheck` | PASS — `logs\typecheck-closeout.log`. |
| `pnpm run build` | PASS — Electron Main, preload, Vue renderer and sandbox preload; `logs\build-final.log`. |
| Focused Manifest/projection/pipe/authority/matching tests | **38/38 PASS** — `logs\integration-green.log`. Later corpus refinements also passed the final full suite. |
| NativeHost default checks | **72/72 PASS** — `logs\native-checks.log`. |
| Native selected-text matching checks | Historical 4/4; **current 6/6 PASS** after adding the built-in Host-action contract — `dotnet run --project native/WebTools.NativeHost.Checks -c Release -- --selected-text-matching-checks`. |
| Existing real-WPF presentation checks | Historical 12/12; **current 13/13 PASS** after adding built-in ordering/click/No Context integration — `--super-panel-hardening-checks --presentation-only`. |
| Existing Quick Result checks | **33/33 PASS** — `--quick-result-checks`; `logs\native-quick-result.log`. |
| UpdateHelper checks | **10/10 PASS** — `logs\update-helper.log`. |
| Self-contained NativeHost Release publish | PASS — `logs\native-publish-final.log`. |
| `pnpm exec electron-builder --win --x64 --dir ...` | PASS — real win-unpacked Manager, `logs\manager-package-final.log`; no installer/release. |
| Repository-external SDK workflows | Local 1.8.0 tgz install, frozen install, real Command bundling, SDK build/validate/pack/inspect PASS. Separate Web context fixture used the public SDK and official packing path. |
| Runner syntax / whitespace | `node --check scripts/verify-selected-text-parity.mjs` and `git diff --check` PASS. |

The 12 WPF checks include first/repeated short and long selected text, pinned Translation first row, reset after scrolling, visible projection refresh, constrained work area, virtualization, icon cancellation, same HWND and concealed pre-layout presentation. The 33 result checks cover bounded text and generation/session/clear state. Historical 6G-1 user acceptance covers its own mouse/keyboard/result checks and remains closed. No capture budget, capture algorithm, focus behavior or production layout was changed here. Real clipboard compatibility, three-hour soak and historical stress suites were not rerun.

Pre-existing Native build warnings remain: UIAutomation reference resolution/conflicts and the nullable TextSelectionProvider argument. The first full Node run failed three stale assertions (two SDK version expectations and one constructor-source assertion); they were corrected to the additive 1.8.0/current negotiation contract. The final 631-test run has zero failures.

### Isolated packaged acceptance — 10/10 PASS

Runner: `scripts/verify-selected-text-parity.mjs`. Final run: `run07`, UTC 13:48:56–13:49:32. Actual Release NativeHost, real Electron app.asar, authoritative archive validation, real Named Pipe, WPF, Node Utility and plugin WebContentsView were used. Selection entered through an existing opt-in test seam; it was **not physical selection/mouse acceptance**. The final run needed no preview re-presentation.

| Case | Observed result |
|---|---|
| Cold NativeHost | Electron = 0. |
| Seven English/Chinese/mixed/punctuation/long/URL/credential-URL selections | General Translation/search remained available; link action followed the condition; first row visible, offset 0; no provider/external effect or Command Utility. |
| No selection | NoContext board; selected-text action count 0; no old result. |
| Discovery after Manager close | Link matched locally with Electron = 0 and translation requests = 0. |
| Real installed search Command | Public SDK entry ran; exact encoded URL hash; one Host external-open effect. |
| Real installed open-link Command | Correct selected URL hash; second Host external-open effect; Utility cleanup. |
| Disable/enable projection refresh | Conditional actions removed/restored correctly; scroll offset 0. |
| Independent Window | Exact and replacement selected-text hashes; same target reused; disabled window closed. |
| Built-in Translation | Exact Manager prefill; one local-stub request after explicit activation; no Native Quick Result. |
| Discovery privacy | Sentinel absent from persisted projection and diagnostic metadata. |

The actual system-browser OS effect was stubbed at the Host boundary, so no real browser/search destination was contacted by these checks. The local Translation stub used a fake isolated key, never a real provider credential. Each case observed zero Native error dialogs. Manager close returned its exact process group to zero while NativeHost remained responsive; final normal Native exit left **0 exact-path processes**.

Machine-readable evidence:

`D:\SystemDefault\Desktop\webtoolstest\phase6g2-20261016\run07\evidence\selected-text-parity.json`

SHA-256: **`1E834B1A2EC3A0EFF0D5D7077B6A3633684B39A449B57922D43FE4C97C23D3AC`**.

### Intermediate failures retained

Evidence and logs for run01–run06 remain beside run07. They are not hidden or relabeled PASS.

1. **run01, driver readiness:** discovery began before the asynchronous installed projection arrived. The driver now waits for the exact installed Feature identity before assertions.
2. **run02/03, real example defect:** deployed entry points imported an SDK module absent from the package. The installed Command failed before its Host effect. Fixed the example build by bundling the public SDK and local helper; run04 onward executed both real commands successfully. The first bundling attempt also exposed esbuild's default `.js` extension; the build now explicitly emits `.cjs` matching the Manifest.
3. **run04/05, external Web fixture:** its Vite configuration emitted `/assets/...`, but the archive inventoried `web/assets/...`. The public page script did not load; preload/runtime readiness alone did not prove plugin-page readiness. The first context was not read, then its existing 30-second TTL revoked the runtime. Rebuilt the fixture with the official starter's `base: './'`, preserved the original archive, and aligned the driver with existing `Runtime.enable` initialization. No production Window/context bridge fix was needed.
4. **run06, transient preview dismissal:** the diagnostic state was hidden/cleared, so this was not evidence of a visible clipped row. Its cause was not independently established. The driver now permits at most two re-presentations of an already hidden/cleared synthetic preview; a visible clipped list remains a hard failure, and actions are never retried. run07 used **zero** such retries.
5. **IDNA review hypothesis:** the reviewer initially assumed `xn--a.com` would fail the example's URL constructor. Actual Node 24.21.0 accepted it. Experimental JS URL/.NET IdnMapping validation produced inconsistent results and was removed; the reviewer withdrew the proposed P2. The shared shape rule and its limitations are explicit; there is no per-address exception or new IDNA dependency.

All failed runtime attempts also recorded final exact-path process count 0 through graceful cleanup. No blind name-based termination was used.

## Manual checks listed at report creation

At the time this report was first written, these items were **MANUAL VERIFICATION REQUIRED**, not a reopened 6G-1 gate or known product failures. The later user acceptance below supersedes that pending phase status; no build identity or per-case measurements are inferred from it.

| Item | Steps and expected result |
|---|---|
| Built-in physical selection and mouse activation | Use a build containing the 2026-10-17 Host adjustment; no plugin installation or permission grant is required. Select ordinary harmless text, then a complete `https://example.com/` link. Ordinary text offers the built-in Search row plus applicable projected Features; the link also offers built-in Open Link. No browser/provider starts just by displaying the list. |
| Built-in actual system-browser open | Set a recognizable default search engine in existing WebTools settings. Click Search on harmless text and verify that configured engine receives the encoded query; click Open Link on `https://example.com/` and verify the intended page. Each click should perform one action without starting a plugin Window or requiring the example package. |
| Additional DPI/work-area visual combinations | On the user's available display/scaling, open a long selection and scroll the action list, dismiss, select again and refresh a plugin. First action and result/actions stay usable; no stale content, accidental clipping or wrong context. Existing constrained-height WPF automation and 6G-1 manual evidence are preserved; arbitrary physical displays were not fabricated. |

At report creation, the optional example's earlier manual workflow was **USER CONFIRMED PASS**, while the replacement built-in delivery still awaited user confirmation. The conclusion below records the later user acceptance without converting it into independent machine evidence.

## Review, scope and safety

Final scoped review closed the example dependency finding; no other reproducible blocker was found. **Open P0 = 0; open P1 = 0; blocking P2 = 0 in the verified implementation scope.** One P1-class integration finding was fixed in the optional example. The withdrawn IDNA hypothesis is not an open P2. URL-shape/IDNA scope and physical/DPI/browser evidence limits remain explicitly documented limitations, not invented defects.

This task changed the finite matching contract and its validators/parsers; projection negotiation/filtering; the minimal existing external-open Node adapter; the optional real example; the later NativeHost built-in search/link delivery; focused tests and test-only diagnostic/seam/runner metadata; SDK version expectations and author/status documentation. It did not modify Translation business behavior, Shared AI/SecretStore ownership, the production capture/layout/keyboard paths, installer/update scripts or the independent Launcher changes.

The live `D:\webtools` installation, real `%APPDATA%\Nook`, startup registration and unrelated apps were not operated on. Test profiles, fake data, packages and evidence remain outside Git under the user-selected D-drive folder. The runner verifies executable canonical path, PID and creation time, uses isolated profile/pipe identity, and cleans up only its owned processes.

No stage, commit, push, PR, merge, tag or release. The pre-existing dirty checkout is preserved. Current Git status is saved as `final-git-status.txt` under the external acceptance root. `phase6g2-source-identity.json` lists the 58 reviewed task-scope files and SHA-256 identities, compares tracked diffs/source copies with the pre-task baseline, and records incremental whitespace findings. It is not a new Git checkpoint; prior untracked work remains uncommitted.

## Original report decision (historical)

**PHASE 6G-2 IMPLEMENTATION COMPLETE**

**AUTOMATED REGRESSION PASS — ISOLATED PACKAGED PASS 10/10**

**PHASE 6G-2 IN PROGRESS — NEW ACTION MANUAL VERIFICATION REQUIRED**

The optional example workflow is USER CONFIRMED PASS. The replacement built-in delivery is implemented and focused checks pass, but its packaged physical-selection/browser check is still required before Phase 6G-2 closeout.

Phase 6G-1 remains COMPLETE / USER CONFIRMED PASS. The next product work is the separately planned 6G-3 real same-panel Translation route, after the new 6G-2 acceptance and its own focused design decision. No real dictionary, automatic preview or Translation Plugin 2.0 was implemented by this work.

## User acceptance closeout — 2026-10-17

**Current decision: PHASE 6G-2 COMPLETE — USER CONFIRMED PASS.**

The user confirmed that the Phase 6G-2 functional tests passed without issues and that switching the configured search engine in Settings continued to work. This is user-reported acceptance of the delivered 6G-2 functionality. The confirmation did not include a build hash, per-case machine log, or separately recorded physical-display/DPI measurements; none are inferred here. The automated and isolated packaged evidence above remains unchanged and is not relabeled as user or independent runtime evidence.

This acceptance closes the 6G-2 manual gate. It does not establish real same-panel Translation, dictionary/definition preview, automatic translation, or complete uTools parity. Those remain outside 6G-2 and are handled by their separately scoped roadmap items.
