# Phase 6E-6 — Only Necessary Host Capabilities Implementation

Status: PHASE 6E-6 FINAL BLOCKING FIX PASS — FRESH-CONTEXT FINAL REVIEW PASS — READY FOR CHECKPOINT COMMIT. No checkpoint commit or push.

## Repository and approved baseline

- Repository: `D:\SystemDefault\Desktop\HomePage`
- Branch: `codex/shared-ai-translation-2.0`
- Starting / current HEAD: `5d56309ac3bf4529352b7da64db07f8a5457c500`
- Ending HEAD: identical. Upstream: origin/codex/shared-ai-translation-2.0; ahead 11, behind 0 (existing commits; this task created none).
- Design authority: [approved and frozen Phase 6E-6 design](phase6e6-capability-boundary-design.md), including the existing Phase 6E-2 consent and quota contract.
- Only the four approved capability families are implemented. No generic public request/send/invoke, external.open, model selection/listing, streaming, tools/agents, filesystem, shell or Plugin network capability.

## Persisted Manifest v2 production authority

The existing PluginManager, PluginRegistry and PluginStore are reused. Registry version 1 remains readable; an explicit optional manifestVersion discriminator distinguishes new v2 records from old v1 records. V1 Manifest bytes/parser/capability allowlist are unchanged.

Install validates and owns package bytes before asynchronous work, writes the exact version/hash archive and registry atomically, records requested capabilities, and starts disabled with no grants. Web package identity cannot inherit v1 grants. The trusted Manager's existing grant/enable controls obtain Host confirmation and persist user grants.

Every Web Feature opening re-reads and validates its recorded archive through the authoritative production validator, creates an immutable runtime snapshot, and issues a Main-only branded ticket for the exact installed record, version/hash and Feature. Each operation checks enabled/compatible state, declarations, current grants, Feature required capabilities and the live Runtime/WebContents/frame/origin/generation. Neither Renderer identity nor namespace availability authorizes an effect.

- Update revokes old tickets immediately after identifying an installed replacement, before Host confirmation awaits. It revalidates the captured record/version/hash/enabled state, operation intent and installed archive after confirmation and guards registry commit. Same-format grants retain only still-requested, currently grantable permissions. Expansion never silently grants additional permissions; cross-format replacement discards old grants.
- Disable and v2 grant mutations revoke live tickets synchronously before queue/persistence awaits.
- Uninstall revokes synchronously, persists disabled state before removing archives, removes authority/grants and follows existing user choice for retaining/deleting PluginStore data.
- Restart validates archive/registry binding before reconstructing authority. Missing/corrupt registry recovery is disabled and ungranted. Corrupt/mismatched/incompatible records fail closed.
- Metadata follows v2 Unicode scalar bounds; v1 bounds remain unchanged.
- `network.domains` remains recognized/requested but cannot be granted. Main refuses attempted grants with a bounded INCOMPATIBLE_PLUGIN error. Registry validation strips stale v2 network grants on load/save; initialization persists that sanitization. Domains packages remain incompatible and cannot run.

## Public SDK and private Bridge

The existing `@webtools/plugin-sdk/web` entry adds context, storage, optional AI and optional clipboard namespaces. ready/onClose and the canonical Bridge envelope remain unchanged. No new generic SDK export or package dependency was added; SDK package version remains 1.2.0.

| Public API | Private closed method | Main gate |
|---|---|---|
| context.current() | context.current | Exact invocation, accepted context, lifetime and current ticket |
| storage.get(key) | storage.get | plugin.storage.read and selected Feature |
| storage.set(key,value) | storage.set | plugin.storage.write and commit-time revalidation |
| storage.delete(key) | storage.delete | plugin.storage.write and commit-time revalidation |
| ai.complete({prompt}) | ai.complete | sharedAI.complete, foreground input, per-call Host confirmation and quotas |
| clipboard.writeText(text) | clipboard.write | clipboard.write, foreground input, Host confirmation and final OS-effect check |

AI/clipboard namespace availability is supplied to the dedicated sandboxed preload by Main-owned additionalArguments. Only namespace names are exposed; no ID, hash, grant revision, generation or runtime descriptor. Forging or bypassing this informational surface does not bypass Main checks.

Closed request/result schemas reject extra authority/provider fields, invalid keys/JSON and byte excess. Existing rate/pending accounting, safe error codes, canonical serialization and cancellation remain. Ordinary calls keep 30 seconds; AI uses its frozen 60-second limit in Main and preload. All capability errors are sanitized; no provider error body, endpoint, secret, path or stack is sent to Plugin code.

## Capability behavior

### Context

The authenticated existing Feature invocation path gains only a bounded optional Launcher text context with capture time, exact FeatureRef and the existing fixed source. Native captures query text before hide clears it and retains the original timestamp while Manager starts. No arbitrary payload bag or clipboard read was added.

Launcher text is limited to 300 UTF-16 units and a 16 KiB envelope. Main rejects stale/invalid data and checks acceptedContexts. Public context contains only type/source/text. Delivery expires at 30 seconds; active context has a maximum ten-minute lifetime. Expiry, replacement, revoke, crash/hang and Manager close erase context and revoke old authority. The Plugin-visible value is immutable; its Host-owned lifetime remains revocable.

Native queues retain the original capture age and use one bounded monotonic expiry timer to drop queued text at its remaining 30-second deadline, even while Manager startup waits longer. Completion/clear cancel that timer; no-context requests create no timer and retain their previous behavior. Native captures text only for a projected accepted launcher-input pair. Main replay records hold SHA-256 fingerprints rather than retaining plaintext query text.

Frozen Native Projection v2 is unchanged (`declarative-compatibility | built-in`). Phase 6E-2 reserves Web discovery for separately negotiated Projection v3. Installed Web Features therefore open through the trusted Manager catalog; this implementation does not mislabel Web Features as v1/v2 Native discovery entries. Native typed context plumbing is ready without widening the projection.

### Storage

Existing Main-owned PluginStore namespaces, strict JSON/prototype rules, 200-key / 512 KiB-value / 5 MiB-document bounds and serialized atomic writes remain. New single-key delete is idempotent. One rolling 60-operation/minute quota covers get/set/delete. A commit predicate rechecks runtime/package/Feature/grant and abort state immediately before write. No list/path/migration/settings/cross-plugin access.

### Shared AI

Uses the existing SharedAIService and configured default provider/model with a single user prompt and 1,024-token output request. Returns text only. Prompt/output UTF-8 limits are 32 KiB; one active request and five calls per rolling minute per runtime. Trusted foreground input and Host-owned preview/confirmation are required for every call; no auto invocation/retry. No approved consent UX amendment was implemented.

AbortSignal stays local and maps to existing Bridge cancel. Main aborts on cancel/revoke/close and discards late results. Remote billing cancellation remains best effort. The three accepted AI tracks remain separate; remote Plugin-owned AI still waits for Phase 6E-7 / Gate 4.

An optional internal output-token observer in the existing OpenAI-compatible / Anthropic adapters and SharedAIService passes only provider-reported output usage to the Web capability binder. Web calls reject usage over 1,024 with LIMIT_EXCEEDED and missing/malformed usage with NOT_AVAILABLE; no token estimate or truncation. Neither token usage nor provider metadata enters the public result. Existing built-in/Translation/v1 callers omit the observer and keep their previous behavior. Confirmation cancellation is forwarded into Electron MessageBoxOptions.signal, so its modal/preview can close on cancel, timeout or revoke.

### Clipboard write

64 KiB UTF-8 maximum; five consent evaluations per rolling minute. A fresh foreground input and bounded Host-owned preview/confirmation are required. Main rechecks authority synchronously immediately before the clipboard write. Denial/cancel/stale generation has no effect. No ambient read, monitoring/history, image/file/rich clipboard or background write.

## Runtime and Manager integration

The existing single WebContentsView, custom protocol, non-persistent isolated Session and dedicated preload are reused. Registry tickets revoke Runtime authority before cleanup awaits; runtime close aborts capabilities, removes private IPC listeners and clears context. Manager catalog presents Web packages explicitly and opens only a validated eligible Feature. No new window/process or second manager/permission/store framework.

## Prior bounded packaged acceptance (before final two-blocker fix)

Historical execution: 11/11 PASS, including all five earlier code-review fixes and AI token overflow. Two normal Manager closes; exact acceptance-owned process count 0 after each. Main PIDs 2488 and 8776 were OS-observed at their respective launches; restart is intentional for persisted-authority validation. Current post-two-blocker evidence is recorded under Final Blocking P2 Fix Pass below.

Actual electron-builder win-unpacked Manager, app.asar, dedicated preload, production protocol/Session/WebContentsView, production validator and persisted v2 registry/grants were exercised. SDK was packed to a local .tgz, installed outside the repository and bundled through its real public `/web` entry into the validated .wtplugin fixture.

Evidence boundary: confirmation decisions, AI provider final effect and clipboard final effect are narrow TEMP-only deterministic seams. No real AI credential/network or real clipboard read/write was used. The context fixture substitutes Native transport/gesture capture and invokes the actual FeatureInvocationService and runtime; it does not claim fresh physical Native UI or Named Pipe acceptance. Existing Gate 2 is unchanged. Foreground Plugin input uses the production Electron input-event path with CDP mouse events.

The effect seams require explicit CLI and environment flags, a real packaged executable under TEMP without reparse points, an independently validated TEMP fixture, and an exact isolated userData match. Normal production launches cannot activate them. Private command processing is limited to fixed fixture operations and 16 sequences; cleanup only closes exact owned processes normally. Packaged profiles, fixtures, tarball and process evidence remain outside the repository; task command logs/ledger are in the ignored `.superpowers` workspace. The misplaced generated artifact exception is documented below.

### Prior artifact and machine evidence

- Windows: build 10.0.26100 (electron-builder report); Node v24.21.0; pnpm 9.15.9; .NET SDK 10.0.401; Electron 44.4.5; electron-builder 26.15.3.
- Packaged executable: `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E6 Acceptance da2ac4f0943d4e0b838f0dfc1a9b48b9\manager-package\win-unpacked\WebTools.exe`
- Executable SHA-256: `4482de03f8643a66134211ba3c0cf9921507dcb1ebfe05107607adcb64cea319`
- app.asar SHA-256: `282f98e970cecbb1cfcb2203e586356ced2da20d7e277bab9794fb9eaabdc96d`
- SDK local tarball version 1.2.0 / SHA-256: `aa28af9225b0bc0941b0795885a92f08db1573096d5425ff281bf02da339c225`
- Validated fixture SHA-256: `493aba4beafd1ba3e41832ab188cab913d996655a038e07a4c441dd76109b3ca`
- Design SHA-256: `9fbc6f82ef945b5d786aca75f2c00d1a86b15c587ff3b93663930d487a0d76b7`
- Source-file identity manifest SHA-256: `4261f3171bb988b3de019a223b5ce49e1b98e21ce6b7aad335d6f539bd13901e`; final per-file mismatch count: 0.
- Machine evidence: `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E6 Acceptance da2ac4f0943d4e0b838f0dfc1a9b48b9\phase6e6-packaged-evidence.json`
- Evidence SHA-256: `44b0fc1c7d0e28f45bcc82c04b58827244ba550898a642393b8d40ace7efb862`
- Raw packaged process log: same TEMP root, `packaged-manager.log`.
- D/E effect sample: 6 confirmation evaluations, 2 denied; 3 deterministic AI dispatches (success, over-token rejection, canceled request), 1 observed abort; 1 clipboard-seam write and no second write on denial. These counters are sampled after D/E, before later revoke/restore/disable commands.

| Packaged case | Result |
|---|---|
| A1 exact validated install identity; install/request is not grant | PASS |
| C public SDK storage write/read/delete and durable sentinel | PASS |
| G1 normal Manager close and zero exact processes | PASS |
| A2 restart reconstructs exact hash/grants and durable data | PASS |
| B exact safe invocation context and forged identity denial | PASS |
| D AI foreground event/confirmation, text-only result, denial/config/token overflow/cancel | PASS |
| E bounded confirmed clipboard Host seam; denial has no effect | PASS |
| F1 replacement gets fresh origin; per-Feature namespace/handler denial | PASS |
| F2 grant revoke removes old runtime and rejects new invocation | PASS |
| F3 disable revokes active generation | PASS |
| G2 ordinary final Manager close and zero exact processes | PASS |

## Prior verification (before final two-blocker fix)

| Command / scope | Final result |
|---|---|
| pnpm run typecheck | PASS |
| pnpm test | 527/527 PASS |
| Focused Node test invocation over 16 changed/new .test.mjs files | 134/134 PASS |
| pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --lib 'ES2022,DOM' --skipLibCheck plugin-sdk/declarative-v1/tests/web-public-api.typecheck.ts | PASS |
| pnpm run build (Main / Manager preload / dedicated Plugin preload / Renderer) | PASS |
| pnpm exec electron-builder --win --x64 --dir --publish never --config.directories.output='<TEMP root>\manager-package' | PASS |
| node --experimental-strip-types scripts/verify-phase6e6-packaged-capabilities.mjs --manager-exe '<TEMP root>\manager-package\win-unpacked\WebTools.exe' --acceptance-root '<TEMP root>' | 11/11 PASS; process count 0 |
| dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj -c Release | 72/72 PASS |
| dotnet run --project native/WebTools.UpdateHelper.Checks/WebTools.UpdateHelper.Checks.csproj -c Release | 10/10 PASS |
| node scripts/verify-phase6e6-native-context-queue.mjs | 4/4 actual CLR queue checks PASS |
| Node syntax check of both new acceptance scripts | PASS |
| git diff --check | PASS |
| Protected task-start SHA-256 comparison | 3/3 identical |

Native queue probe source/project/logs are retained outside the repository under `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E6 Native Queue T1OFHm`. It references the actual NativeHost project; no protected Check Program was edited. No soak, broad fuzz, memory benchmark or forced GC was performed.

## Findings and fixes

1. V2 Unicode scalar metadata hit inherited v1 UTF-16 registry limits. Reproduced valid exact-limit metadata failure; corrected only v2 metadata validation; focused regression RED→GREEN.
2. Closing a Manager-opened Web Feature restored its transient declarative loading route. Reproduced in actual Vue App lifecycle; record Plugin Center as the return route; regression RED→GREEN, 11/11 App lifecycle PASS.
3. Tool-only ASAR extraction expected platform separators: confirmed actual archive files; corrected test reader before any application launch.
4. Tool-only offline SDK install lacked the cached yauzl tarball. Pinned the disposable external author's pnpm version and used ordinary dependency installation. Root dependencies/lockfiles unchanged.

### Final read-only code review and bounded fix pass

One fresh-context read-only reviewer (phase6e6_final_review) found P0=0, P1=0 and five blocking P2s. All five were reproduced with failing focused tests and fixed in one bounded pass:

| Finding | Minimum correction and regression |
|---|---|
| READY replacement did not synchronously revoke A | Actual replacement closes/revokes before operation-queue await; immediate old-ticket/listener assertions GREEN |
| Canceled confirmation retained modal/preview | Composed AbortSignal reaches Host confirm and Electron MessageBoxOptions.signal; service cancel and production Host option-wiring tests GREEN |
| Token overflow below the byte cap could succeed | Existing adapters observe output usage internally; Web validates usage and fails closed; adapter/relay/boundary tests and packaged 1,025-token case GREEN |
| Replay fingerprint retained plaintext context | SHA-256 fingerprint preserves exact at-most-once discrimination without retained query text; retention/replay test GREEN |
| Queued Native context outlived 30 seconds | One monotonic queue timer retains original capture age and drops expired text; actual CLR fake-clock deadline/cleanup/capacity tests 4/4 GREEN |

Final expanded regression is 527/527; no second broad review/test campaign was substituted for these focused fixes. Reviewer explicitly excluded protected Launcher work and accepted the deferred Projection v3 / deferred capability boundaries. Paid-provider and real clipboard effects, physical Native gesture/pipe, and final command execution remain evidence-boundary limitations rather than fabricated independent acceptance.

### Tooling-only residue

After an interrupted continuation, a transient tool variable was lost and one builder invocation wrote to `undefined/manager-package`. A focused-runner PowerShell argument-grouping error then selected non-test files; its failures were tooling failures, not the product suite. Corrected absolute TEMP output and a flat .test.mjs list produced the final results above.

Most misplaced artifacts were preserved in ignored `release/phase6e6-builder-path-error-20261009`. Automatic policy rejected recursive deletion; checked literal-path moves preserved the outputs, but the final 34,634,260-byte `undefined/manager-package/win-unpacked/resources/app.asar` remains locked by Codex App PID1548. Read-only Windows Restart Manager confirmed its owner. Codex was not closed/killed. This generated binary is untracked and must never be staged; close/restart Codex later to release the handle and complete cleanup. It is a nonblocking P3 tooling/hygiene item and does not affect the tested TEMP candidate.

Intermediate failure/success logs are preserved in the ignored task workspace. No failing result is presented as a product PASS.

## Scope and changed files

- Existing install/authority: src/shared/plugin-contracts.ts; electron/plugins/plugin-manager.ts; plugin-registry.ts; permission-broker.ts; plugin-store.ts; plugin-consent-view.ts; electron-plugin-host.ts; electron/ipc/plugin-handlers.ts.
- New Main-only tickets and handlers: electron/plugins/web-feature-authority.ts; web-host-capabilities.ts.
- Internal AI usage observation: electron/services/openai-compatible-adapter.ts; anthropic-messages-adapter.ts; ai-provider-errors.ts; shared-ai-service.ts, with corresponding adapter/service focused tests. Existing callers retain prior behavior.
- Bridge/Runtime/preload: electron/plugins/web-plugin-bridge.ts; web-plugin-preload-client.ts; web-plugin-runtime.ts; electron/web-plugin-preload.ts; electron/main.ts.
- SDK: plugin-sdk/declarative-v1/web/bridge-client.mjs; index.d.ts; capability-methods.mjs; capability-methods.d.mts; README.md; tests/web-client.test.mjs; web-public-api.typecheck.ts; web-capabilities.test.mjs.
- Trusted Manager Web Feature entry: src/shared/plugin-catalog-contracts.ts; electron/plugins/plugin-catalog.ts; electron/ipc/plugin-catalog-handlers.ts; src/features/plugins/catalog-view-model.ts; plugin-view-model.ts; PluginManagerView.vue; src/App.vue.
- Typed context route: src/shared/feature-invocation-contracts.ts; electron/services/feature-invocation-service.ts; native/WebTools.NativeHost/Services/NativeFeatureInvocationProtocol.cs; NativeFeatureInvocationQueue.cs; ManagerController.cs; native/WebTools.NativeHost/MainWindow.xaml.cs.
- Focused tests: electron/plugins/web-plugin-authority.test.mjs; web-host-capabilities.test.mjs; web-host-confirmation.test.mjs; plugin-manager.test.mjs; plugin-catalog.test.mjs; web-plugin-bridge.test.mjs; web-plugin-runtime.test.mjs; electron/services/feature-invocation-service.test.mjs; src/shared/feature-invocation-contracts.test.mjs; src/features/plugins/catalog-app-lifecycle.test.mjs.
- Isolated acceptance tooling: electron/services/web-capability-acceptance.ts; web-capability-acceptance.test.mjs; scripts/verify-phase6e6-packaged-capabilities.mjs; verify-phase6e6-native-context-queue.mjs.
- Report: this document. Approved design was already untracked and remains unchanged by implementation.

## Final Blocking P2 Fix Pass

The Final Post-Fix Review found two further Blocking P2s. This bounded pass addresses those two only. Earlier five fixes remain intact; the duplicate eligibility predicate is DEFERRED P3. No SDK, Native, provider, network enforcement, dependency, installer or Launcher implementation was changed in this pass.

### P2 #1 — replacement confirmation ordering

Root cause: install awaited install/replace/downgrade confirmation before stopping the installed Web Runtime; merely stopping before replacement file I/O left old tickets and privileged effects usable during the modal wait.

Fix: once a different validated package is bound to an installed target, the existing intent mechanism synchronously blocks that identity and stops/revokes its Runtime/tickets. Only then can confirmation wait. Each answer is followed by session, record-object identity, expected version/hash/enabled-state and own intent-generation checks. The old archive is revalidated after approval; registry atomic commit receives the same current-target predicate. Disable, grant mutation or uninstall can supersede the update immediately and force INTENT_SUPERSEDED without installing the replacement. Concurrent installs remain serialized and each binds its then-current target.

Denied confirmation keeps the existing persisted installation, enabled state and grants, but never restores the old Web ticket or generation. Clearing only the update's own intent permits a later legitimate invocation to validate the still-installed package and construct fresh authority. A superseding intent is never cleared. Web failure paths also never resurrect tickets. The pre-existing v1 failed-write rollback still constructs a fresh verified DeclarativeRuntime; it does not restore a Web ticket or run on denied consent.

Regression: unresolved confirmation invalidates the old ticket; new capability calls fail; an already-pending clipboard effect cannot commit; denial does not revive the ticket; a later invocation creates fresh authority; approval installs the exact new hash/version. Deterministic tests cover update/disable, update/grant mutation, update/uninstall, two queued updates, and archive identity substitution while confirmation waits. The actual WebPluginRuntime class reaches READY and becomes ABSENT with its private IPC listener removed before the confirmation promise resolves. Two existing v1 concurrency tests now expect the specified superseded-update rejection and retained old version; the existing failed-write rollback test remains PASS.

### P2 #2 — requested is not grantable

Root cause: the full Manifest-v2 declaration vocabulary was also used as the grant allowlist, and Manager checkboxes did not distinguish unavailable capabilities.

Fix: keep network.domains in the declaration vocabulary and frozen validator. Main setGrants rejects an attempted network grant with INCOMPATIBLE_PLUGIN before consent, intent or persistence work. V2 registry validation accepts structurally valid old records but strips network.domains from grants; authoritative initialization writes the sanitized state back. Replacement retention also excludes it. This changes no registry version and creates no second grant store. Manager shows it as unavailable with a disabled, unchecked checkbox; local selection and draft initialization exclude it.

Regression: a structurally valid domains package installs as incompatible; direct Main grants fail; approved storage grants still persist. A deliberately injected network grant in the stopped disposable registry is removed on restart and from the persisted file; Feature authorization and enable remain denied. A rendered actual Vue PluginManagerView proves the network checkbox is disabled/unchecked even with a stale grant, while the storage checkbox remains selectable. Network:none tests remain PASS; Session/CSP/network policy is unchanged. Gate 4 remains NOT CERTIFIED.

### Current verification

| Command / scope | Result |
|---|---|
| Initial focused RED reproductions | Expected authority/supersession/grantability failures; raw logs retained |
| Initial focused GREEN scope, six files | 72/72 PASS |
| Final focused Node invocation, 19 files | 166/166 PASS |
| pnpm run typecheck | PASS |
| pnpm test | 537/537 PASS |
| pnpm run build | PASS: Main, both preloads and Renderer |
| node --check scripts/verify-phase6e6-packaged-capabilities.mjs | PASS |
| pnpm exec electron-builder --win --x64 --dir --publish never --config.directories.output='<current TEMP root>\manager-package' | PASS |
| node --experimental-strip-types scripts/verify-phase6e6-packaged-capabilities.mjs --manager-exe '<current TEMP root>\manager-package\win-unpacked\WebTools.exe' --acceptance-root '<current TEMP root>' | 14/14 PASS; final exact process count 0 |
| NativeHost / UpdateHelper / actual CLR queue checks | Prior 72/72, 10/10 and 4/4 reused; Native code unchanged, not rerun in this pass |

The 19-file focused command covers authority, Runtime, capabilities, confirmation, PluginManager/catalog/registry projection, provider adapters/SharedAIService, invocation context/replay, SDK clients and rendered permission UI. Native queued-context expiry remains unchanged; its prior actual CLR evidence is reused.

Exact final focused command (repository root):

```powershell
node --experimental-strip-types --test electron/plugins/web-plugin-authority.test.mjs electron/plugins/web-host-capabilities.test.mjs electron/plugins/web-host-confirmation.test.mjs electron/plugins/plugin-manager.test.mjs electron/plugins/plugin-catalog.test.mjs electron/plugins/web-plugin-bridge.test.mjs electron/plugins/web-plugin-runtime.test.mjs electron/plugins/feature-registry.test.mjs electron/services/openai-compatible-adapter.test.mjs electron/services/anthropic-messages-adapter.test.mjs electron/services/shared-ai-service.test.mjs electron/services/feature-invocation-service.test.mjs electron/services/web-capability-acceptance.test.mjs src/shared/feature-invocation-contracts.test.mjs src/features/plugins/catalog-app-lifecycle.test.mjs src/features/plugins/plugin-manager-view.test.mjs src/features/plugins/plugin-view-model.test.mjs plugin-sdk/declarative-v1/tests/web-capabilities.test.mjs plugin-sdk/declarative-v1/tests/web-client.test.mjs
```

The first RED run also exposed two test-setup errors (missing Runtime capability dependencies and an incomplete catalog icon DTO); corrected setups then independently failed on the intended authority and rendered-checkbox assertions before production fixes. The first broad run was 536/537: the existing Feature authority event test caught an extra notification for a canceled new install. The final correction limits cleanup notifications to an owned replacement intent; final full regression is 537/537. Earlier failed logs are preserved, not relabeled PASS. No stress, fuzz, soak or memory run was performed.

### Current bounded packaged authority acceptance

The existing 11 bounded cases remain PASS. Three additional cases use the actual current packaged Main/Manager, production validator/immutable snapshot, Session/protocol/WebContentsView and persisted registry:

- U1: READY plugin and held deterministic AI request; begin replacement; observe unresolved confirmation, old WebContentsView disappearance and the pending AI abort before any answer. Deny update; old installation remains; a later invocation receives a fresh origin and storage works.
- U2: approve replacement; exact validated 2.0.0 package hash persists and old generation is removed.
- N1: structurally valid 3.0.0 domains fixture remains incompatible; direct network grant fails and is absent from disk. After normal Manager close, inject a stale grant only in the disposable profile; real packaged restart sanitizes it on disk and continues denying Feature execution.

Three ordinary Manager closes observed exact packaged-process count zero. OS-observed Main PIDs: 11720, 21072 and 2944; creation times are retained in evidence. Restarts intentionally test persistence; no process was killed. The second round records four deterministic AI dispatches, two aborts and one clipboard seam effect. Third-round counters are separately retained so restart does not erase earlier effect evidence.

Additional acceptance controls are fixed to two named TEMP fixture files, exact reserved fixture identity/versions and authoritative validator results. The held-update confirmation has an event-driven decision, a bounded rejection deadline and disposal cancellation. It does not expose an arbitrary archive path or production effect. Real paid AI, real clipboard and physical Native UI/Named Pipe remain outside this bounded acceptance.

- Current TEMP root: `C:\Users\admin\AppData\Local\Temp\WebTools Phase6E6 FinalFix 09394d1b362c4d43a4a9a16995b8cf8e`
- Executable: `<current TEMP root>\manager-package\win-unpacked\WebTools.exe`
- Executable SHA-256: `08224c2c720218da1a09efc57b6af348e42e16cfa68ea36c400d97ad15f408b3`
- app.asar SHA-256: `79f7f68b5dcdca19ca343405158ed0b3fa7858909f342a4300392db1e18c138a`
- Base / replacement / domains fixture SHA-256: `493aba4beafd1ba3e41832ab188cab913d996655a038e07a4c441dd76109b3ca` / `868c3628e110a54c4c5fcf177ceba5c8a933c8ea2132ff53f6d7013df21fab18` / `55b1c127731977fae86ae3adece211adae29bd300f5d0f7e7e50844177f2e291`
- SDK tarball SHA-256 remains `aa28af9225b0bc0941b0795885a92f08db1573096d5425ff281bf02da339c225` (SDK unchanged).
- Machine evidence: `<current TEMP root>\phase6e6-packaged-evidence.json`
- Evidence SHA-256: `99c5bf0768eab05aad18d8fcc06eca35391465aa74bf8ba9f533fbb5f0db1f79`
- Source identity SHA-256: `6b5a1c4903f02774ecde38b3ea8b108038be8211c8fd8fe5580fe9690293e574`; independently rehashed source mismatch count 0.
- Raw commands/results: focused-red.log, focused-red-runtime-ui.log, focused-green.log, focused-final.log, full-tests.log, full-tests-final.log, typecheck-final.log, build.log, package.log, packaged-acceptance.log and packaged-manager.log under the current TEMP root.

This pass changed only: electron/plugins/plugin-manager.ts, plugin-registry.ts, plugin-manager.test.mjs, web-plugin-authority.test.mjs, web-plugin-runtime.test.mjs; src/features/plugins/plugin-view-model.ts, PluginManagerView.vue, plugin-view-model.test.mjs, plugin-manager-view.test.mjs; electron/services/web-capability-acceptance.ts; scripts/verify-phase6e6-packaged-capabilities.mjs; and this report.

### Fresh-context final review

One new reviewer, phase6e6_blocking_fix_final_review, independently inspected the actual current diff, frozen design/contracts, implementation report, source identities, raw regression logs and packaged evidence without editing or executing programs/tests. Result: final read-only review PASS; P0=0, P1=0, Blocking P2=0, Non-blocking P2=0, product P3=1 (duplicated eligibility predicate, DEFERRED). Both final blockers and all previous five fixes passed review. The reviewer independently matched all 59 packaged source identity hashes and the evidence SHA-256, and verified the protected hashes/index/diff check. No additional product fix followed this review.

Known tooling residue was separately rechecked: exclusive read was refused by Windows sharing rules; the 34,634,260-byte ASAR remains untracked, unstaged and not ignored. Its current owner was not reidentified. No process was killed and no residue was moved/deleted. EXCLUDED FROM CHECKPOINT.

## Production-data and Launcher safety

No D:\webtools installation, real %APPDATA%\Nook profile, startup setting, real plugin registry, AI token or clipboard was modified. No broad process-name termination. Test data, profiles, .tgz/.wtplugin artifacts and raw logs are disposable isolated outputs.

Protected start hashes (final comparison: all three identical; none edited/formatted/staged):
- native/WebTools.NativeHost.Checks/Program.cs: 1E0F46FA219277A061D5234E1EFC103120B63E5DED0AE1335BA6F4EE99AAC9D0
- native/WebTools.NativeHost/Catalog/AppCatalogService.cs: EA2F84F917603FA6CE3D61DFFF0267E45EE7DA89973EBAE0A24DC1F4A73521FD
- docs/bugfix-launcher-app-search-after-autostart.md: B5FB3AF4F618D927275ED3D3C07ACCC8F06FE55480902DCF0D2A0BABA1E2BBA8

## Git state and severity

- Branch/HEAD unchanged; ahead 11 / behind 0; index empty; no commit/push.
- Dirty tree contains the Phase 6E-6 source/tests/SDK/report, the pre-existing untracked frozen design, the three protected independent Launcher files, and the generated locked ASAR residue described above.
- No dependency, lockfile, SecretStore, non-plugin user-data format, installer, startup or production-install changes. The plugin registry alone has the approved minimal v2 authority evolution described above.
- Final fresh-context review: P0=0; P1=0; Blocking P2=0; Non-blocking P2=0; product P3=1 (duplicate Web Feature eligibility, DEFERRED). The prior seven implementation P2 fixes are preserved and the two final blockers are resolved. The generated locked ASAR is a separate tooling/hygiene limitation, untracked/unstaged and excluded from checkpoint.

## Deferred and recommendation

Gate 4 NOT CERTIFIED; network.mode:domains UNSUPPORTED; network.mode:none remains supported. external.open, streaming, tool calling and the AI consent amendment remain deferred. Projection v3 and a deliberate Native clipboard-context action are not implemented here.

Known limitations: Web Native discovery awaits Projection v3; no new Native clipboard-input action; real paid-provider/clipboard/native modal/physical Native UI were not exercised by this bounded fixture; providers without valid output-token usage cannot complete Web Shared AI. Test seams and physical transport substitution are explicitly labelled above.

```text
PHASE 6E-6 FINAL BLOCKING FIX PASS
BOUNDED PACKAGED ACCEPTANCE PASS
FRESH-CONTEXT FINAL REVIEW PASS
READY FOR CHECKPOINT COMMIT
PHASE 6E-7 NOT STARTED
GATE 4 NOT CERTIFIED
network.mode:domains UNSUPPORTED
NO COMMIT
NO PUSH
```

Stop for the Human Checkpoint decision. No checkpoint was created. The tooling-only locked binary must be excluded from any future commit; no production release is authorized.
