# Phase 6E-5D — Identity / Lifecycle / Quota Enforcement Report

**Date:** 2026-10-08
**Scope:** BOUNDED / REPRESENTATIVE / DETERMINISTIC enforcement review and focused acceptance. This is not a Bridge redesign, packaged acceptance, capability implementation, or security certification.

## Repository State

- Repository: `D:\SystemDefault\Desktop\HomePage`.
- Branch: `codex/shared-ai-translation-2.0`.
- Starting and ending HEAD: `70cd6cf793dfbd1ed91c942847e31a2c3c80c3de` (`feat(plugins): add minimal web plugin bridge`).
- Commit: NO. Push: NO. Nothing staged.
- Three pre-existing Launcher files remain separate and unchanged; see the hash table below.
- Environment: Windows, Node `24.21.0`, pnpm `9.15.9`, Electron `44.4.5`; SDK remains `1.2.0`.

## Scope

The existing Main-owned RuntimeInstance remains the only runtime authority. The only production change is local to `web-plugin-bridge.ts`; remaining changes are focused tests and this report. Frozen 6E-5A/5B documents, transport schemas, errors, numeric bounds, package versions and SDK implementation are unchanged.

No business capability, public generic request API, Manager preload widening, network change, normal v2 install, Projection v3, NativeHost modification, lockfile churn or installer change was introduced. Gate 4 remains **NOT CERTIFIED**; `network.mode:domains` remains **UNSUPPORTED**.

## Files Reviewed

- `docs/phase6e5-thin-sdk-package-boundary.md`
- `docs/phase6e5b-plugin-bridge-contract.md`
- `docs/phase6e5c-minimal-plugin-bridge-implementation.md`
- `electron/plugins/web-plugin-bridge.ts`
- `electron/plugins/web-plugin-bridge-routes.ts`
- `electron/plugins/web-plugin-bridge.test.mjs`
- `electron/plugins/web-plugin-preload-client.ts`
- `electron/plugins/web-plugin-preload-client.test.mjs`
- `electron/plugins/web-plugin-runtime.ts`
- `electron/plugins/web-plugin-runtime.test.mjs`
- `electron/web-plugin-preload.ts`
- `electron/main.ts` (Manager navigation, close and quit paths)
- `electron/plugins/package-validator.ts`
- `electron/plugins/validated-web-package-snapshot.ts`
- `electron/plugins/web-runtime-policy.ts`
- `plugin-sdk/declarative-v1/web/index.mjs`
- `plugin-sdk/declarative-v1/web/index.d.ts`
- `plugin-sdk/declarative-v1/web/bridge-client.mjs`
- `plugin-sdk/declarative-v1/web/protocol.mjs`
- `plugin-sdk/declarative-v1/web/protocol.d.mts`
- `plugin-sdk/declarative-v1/tests/web-client.test.mjs`
- `plugin-sdk/declarative-v1/tests/web-protocol.test.mjs`
- `scripts/verify-phase6e5c-bridge-runtime.mjs`
- Root and SDK `package.json` (existing commands, versions and exports)

## Files Changed

| File | Change |
|---|---|
| `electron/plugins/web-plugin-bridge.ts` | Trustworthy rejection correlation, malformed hello classification, terminal deadline precedence, authentication exception containment. |
| `electron/plugins/web-plugin-bridge.test.mjs` | Representative enforcement boundaries and concrete defect regressions, using the existing held-ping/clock seams. |
| `electron/plugins/web-plugin-preload-client.test.mjs` | Local deadline, one cancel, late-response rejection and dispose cleanup. |
| `electron/plugins/web-plugin-runtime.test.mjs` | Execute the production runtime class against controlled Electron boundary doubles; foreign sender, current subframe fatality, synchronous close and replacement/listener isolation. |
| `plugin-sdk/declarative-v1/tests/web-protocol.test.mjs` | Exact/+1 independent request/response byte bounds; prove oversized input never reaches JSON.parse; exact safe-integer ID acceptance. |
| This report | Evidence, findings, limits and deferred work. |

No new test harness, production delay/echo method or timer-injection API was needed. NativeHost Launcher changes are excluded.

## Main-derived Identity

**PASS / FIXED.** `WebPluginRuntime.authenticateBridge` derives authority from:

1. Exact `event.sender === runtime.view.webContents` (object equality also fixes the WebContents identity).
2. Existing exact live `event.senderFrame === contents.mainFrame`, not detached; live WebContents.
3. Exact active RuntimeInstance and current generation, with state LOADING/READY.
4. Both current frame and WebContents URL matching the selected `entryUrl`, after stripping permitted same-document query/fragment state. The entry itself is Main-built from the random runtime host and validated canonical entry path.
5. Host-branded immutable snapshot, selected Feature ID and exact Feature membership in its frozen manifest. Snapshot package hash, plugin identity/version and Feature are Main values, not wire fields.

Bridge accepts requests/cancel only in READY; a compatible hello is valid only before accepted readiness. Closed schemas cannot accept caller authority fields (`pluginId`, `featureId`, `runtimeId`, `origin`, `generation`, `packageHash`, `pluginVersion`, `grantRevision`, `contextId`). The representative added `pluginId` case is rejected without dispatch; a later valid ping works.

Authentication exceptions now produce identity failure and synchronous revocation, rather than escaping the IPC callback or asynchronous settlement. No future grant authority or installed v2 state is implied by ping.

## Foreign Sender

**PASS.** The runtime test sends a foreign WebContents request and a cancel targeting a legitimate pending ID, then 21 foreign attempts. They produce no Plugin response, do not cancel the real call, and leave runtime READY. Twenty legitimate charged calls still pass and the next is rate-limited. The identity check occurs before parsing, token accounting and pending lookup; foreign traffic cannot revoke the legitimate runtime.

This executes actual runtime/Bridge logic with Electron object doubles. It is not presented as a live spoofed-sender Electron matrix.

## Current Plugin Identity Violation

**PASS.** A current Plugin sender with a different subframe object, even one copying the expected URL, takes the identity-fatal path. Runtime authority becomes absent and the private IPC listener is removed synchronously while Session cleanup remains deliberately held. No correlated reply is sent to the violating frame; the old saved listener cannot admit another request.

## Generation Isolation

**PASS.** A held call in generation A is revoked; generation B uses the same ID text. A cannot admit more work, its foreign cancel cannot touch B, and releasing A's old work cannot send/settle B's response. B retains its own fresh token bucket and pending state. Runtime replacement removes A's listener, waits for cleanup, advances generation, and registers one current listener. Saved old listener delivery cannot affect B.

## Revocation

**PASS.** `performCloseRuntime` sets CLOSING and clears `active`, calls Bridge revoke and removes the IPC listener before its first await. Bridge sets `closed` before notification, abort or cooperative wait. Normal close/replacement, cross-document navigation/reload, renderer crash/unresponsive and Manager close all converge on this implementation.

Existing reload and crash tests are retained; new close/subframe tests hold cleanup to observe revoked authority before asynchronous completion. Manager close and before-quit code call `close()` before awaiting destruction/quit. The existing bounded real Electron verifier again confirms actual Plugin view close followed by Manager process-group exit. No new exhaustive close-path matrix was added.

## Pending / Exactly-once Settlement

**PASS.** Each admitted call owns one Map entry. `finish` accepts only that exact current entry, removes it and clears its timer before abort/reply. Terminal late work finds no entry and cannot respond again. Revocation aborts controllers and clears the whole pending map before awaiting work.

Representative tests cover success, explicit cancel (including duplicate cancel), timeout, runtime revoke and handler failure. Canonical duplicate pending ID still revokes the generation without dispatching the second call or ambiguously settling the first. A post-dispatch identity change is revalidated and cannot return a stale result. Timeout, cancellation and late result tests demonstrate slot recovery and one terminal response rather than asserting private counter implementation details.

## Concurrency

**PASS.** Calls 1–4 dispatch held work. Call 5 receives `LIMIT_EXCEEDED`, acquires no slot and has no queue. Canceling one call admits one replacement; another call is still rejected while four remain pending. Duplicate cancel and late completion do not free another slot. Both concurrency rejections consume ordinary request tokens, proven by the subsequent 20/21 accounting boundary.

## Rate Limit

**PASS.** Capacity remains 20; monotonic continuous refill remains 10 tokens/second, capped at 20. With no elapsed time, 20 ordinary requests pass and attempt 21 fails. At +100 ms exactly one request passes; the next again fails.

Canonical supported pre-ready hello is free; canonical READY cancel, including unknown/duplicate cancel, is free. Existing fake-cancel evidence plus new unknown-method/invalid-JSON/oversized-attempt cases show charged accounting. Malformed/unsupported/post-ready hello reaches the same `takeToken` branch before rejection/revocation; because such hello closes the generation, its accounting classification is also verified by code inspection rather than inventing a live post-fatal counter probe. There is no second bucket.

## Envelope / Parser Ordering

**PASS.** Independently constructed request and response envelopes of exactly **532,480 UTF-8 bytes** parse/encode successfully; **532,481** fail `LIMIT_EXCEEDED`. Instrumenting JSON.parse in the focused test records zero invocations for oversized input. Maximum safe ID `9007199254740991` parses; the existing +1 negative remains.

Main authenticates first, then `decodeRaw` bounds UTF-8 size before parsing. Its catch charges the active attempt and returns; there is no oversized canonicalization or ID recovery. Full request validation occurs after ordinary token accounting.

## Deadlines

**PASS / FIXED.** Ready remains 10 seconds after actual `did-finish-load`; no ready timeout starts on hello alone. Tests observe no readiness without both signals, and expiry at 10,000 ms without hello revokes admission.

Main ordinary dispatch remains bounded at 30 seconds. Completion before/at the deadline can settle if it wins before the timeout callback; completion after the deadline is TIMEOUT. Explicit cancel at/after deadline remains TIMEOUT. The local fix also applies the monotonic deadline to handler rejection/invalid result, so a delayed timer cannot let late failure settle as INTERNAL_ERROR. Timer expiry aborts once, releases the slot, ignores late work and leaves runtime READY.

Preload expiry remains 30 seconds from emission; at 29,999 ms the call is unsettled, at 30,000 it resolves TIMEOUT and sends one best-effort cancel. Late response/duplicate cancel cannot change it; a later call succeeds. Runtime revoke's cooperative grace remains at most 2 seconds: held work is still outstanding at 1,999 ms and close completes at 2,000 with authority already gone. All timing cases use mock timers/controlled monotonic time; no real 30-second sleeps.

## Cancellation

**PASS.** Existing SDK tests prove already-aborted/pre-emission cancellation sends no request and removes AbortSignal correlation. Accepted Main cancellation settles once and aborts its controller. Unknown cancel is stateless; cancel-before-admission creates no tombstone and later same-ID admission succeeds. Duplicate cancel and late response are ignored. Old-generation cancel cannot target B. No correctness assumption about IPC delivery ordering was introduced.

## READY Enforcement

**PASS.** Pre-ready requests acquire no dispatch slot. Hello alone and load alone are insufficient. The exact loaded document plus compatible current hello sets owner READY before publishing accepted ready. Post-ready hello cannot renegotiate/reset authority; it revokes. Existing reload-before-finish and reload-after-ready tests deny the old generation. Ready expiry also prevents later request admission. Real Electron readiness and immediate ping remain green.

## Error Sanitization

**PASS / FIXED.** Host errors contain only a frozen code and `retryable:false`. Handler failure with deliberate private path/secret text produces only INTERNAL_ERROR. Late failure produces TIMEOUT; authentication failure revokes; serialization/send failure closes. Raw exception, message, stack, username, path, IPC route, pipe, secret or Electron object is not returned. No implicit retry.

## 5C Non-blocking Findings and Other Defects Found

The four new defect regressions were run before changing production code: 4 failed and the four existing Bridge tests passed. After the local changes all eight passed; later representative coverage expanded the final focused suite.

| Finding | Severity / reproduction / root cause | Minimal fix and regression |
|---|---|---|
| A: duplicate requestId correlation trust | Non-blocking P2, FIXED. With ID 2 pending, raw JSON repeating requestId 1 then 2 caused runtime-closed instead of dropping ambiguous input. JSON.parse had lost uniqueness before pending lookup/error correlation. | Validate canonical requests before correlation; for schema-invalid input, permit recovery only when compact JSON.stringify of the already bounded parsed value exactly equals raw. Removed duplicate keys cannot reproduce their source bytes. Otherwise drop without correlated response or duplicate-ID fatality. No general JSON parser or wire/schema change. Regression also preserves the canonical duplicate-pending fatal behavior. |
| B: malformed major classification | P3, FIXED. String major `"1"` produced NOT_AVAILABLE. Comparison to supported major happened without proving schema validity. | NOT_AVAILABLE only for a validated canonical unsupported hello; malformed hello gets INVALID_REQUEST. One focused malformed/unsupported regression. |
| Late handler failure precedence | P2, FIXED. Held handler rejection at monotonic 30,001 ms, before timer execution, returned INTERNAL_ERROR. Only successful null completion checked the deadline. | `finish` applies the deadline to all terminal completion paths. Focused rejection regression plus exact/late/timer cases. |
| Authentication exception containment | P2, FIXED. Controlled authenticate exception escaped `receive`. Authentication was called without containment at receive/readiness/dispatch/settlement. | One local wrapper converts unexpected authentication exceptions to identity failure; existing fail-closed revocation handles it. Focused regression verifies no escaping error and synchronous close. |

The compact fallback is only for bounded schema-invalid input. Valid canonical requests keep the existing canonical serializer path, including nested numeric-key ordering. Whitespace, escaped alternate/duplicate-key input or other representations that cannot establish unambiguous correlation may be dropped; the local preload deadline then settles its Promise. This is an authorized conservative rejection, not successful dispatch.

## Resource Cleanup

**PASS.** Runtime removes its Main IPC listener synchronously on close. The existing navigation/WebContents listeners belong to the exact WebContents and disappear on its destruction; load listeners/timeouts are explicitly removed. Runtime replacement leaves one current IPC listener and final close leaves zero. Session cleanup failure remains unavailable and cannot admit a replacement.

Preload dispose removes its ipcRenderer subscription, settles pending calls, clears request timers and close listeners, and prevents later ready/response delivery from reopening it. Advancing mock time after dispose produces no new cancel. Dedicated preload pagehide/close handlers remove their counterpart listener. SDK removes AbortSignal listeners, pending cancellation entries and its facade close subscription; existing tests cover cleanup and the four-public-subscription bound. Canceled non-cooperative test work may resolve later but cannot retain authority/slots or send another response; interruption remains best-effort.

## Test Results

| Actual command | Result |
|---|---|
| `node --experimental-strip-types --test electron/plugins/web-plugin-bridge.test.mjs` (initial defect reproduction) | 4 PASS / 4 expected FAIL; concrete pre-fix observations above. |
| Same command after local fixes | 8/8 PASS. |
| `node --experimental-strip-types --test electron/plugins/web-plugin-bridge.test.mjs electron/plugins/web-plugin-preload-client.test.mjs electron/plugins/web-plugin-runtime.test.mjs plugin-sdk/declarative-v1/tests/web-client.test.mjs plugin-sdk/declarative-v1/tests/web-protocol.test.mjs` | Final 41/41 PASS, zero failures/skips/cancellations; baseline 20, added 21. |
| `node --experimental-strip-types --test plugin-sdk/declarative-v1/tests/*.test.mjs` | 55/55 PASS. SDK implementation unchanged. |
| `pnpm run typecheck` | PASS. |
| `pnpm test` | Final 494/494 PASS, zero failures/skips/cancellations; baseline 473, added 21. Earlier 492/492 run preceded the last two test-only assertions. |
| `pnpm run build` | PASS: Electron Main, Manager preload, dedicated Plugin preload and Vue renderer. |
| `node --experimental-strip-types scripts/verify-phase6e5c-bridge-runtime.mjs` | ELECTRON_44_CONTEXT_BRIDGE_PASS; reused unchanged bounded two-run driver. |
| `git diff --check` | PASS. |

Node's existing MODULE_TYPELESS_PACKAGE_JSON / experimental strip-types warnings and Git LF/CRLF notices remain diagnostics; no package-mode or line-ending cleanup was made.

### Real Electron regression evidence

Authentication exception behavior was changed, so the existing bounded real Electron verifier was rerun after build. No new Electron matrix, installation, packaged acceptance or certification was performed. Normal and replacement executions exercise actual built Main, production Runtime/WebContentsView/Session/protocol, dedicated preload and SDK fixture. Both pass readiness, ping, safe errors, local/cross-context cancellation, subsequent ping and actual Plugin close while Manager remains. Normal Manager close ends each isolated process group; **remaining isolated process count = 0**.

- Evidence: `C:\Users\admin\AppData\Local\Temp\WebTools-6E5C-Bridge u4k1J0\bridge-evidence.json`.
- Verified SHA-256: `0937d1308f662f4374a0c749907478cedefbca5082b98c8a1cbda5095a482d01`.
- Built Main SHA-256: `feae001b469ba47a074bdeda79a01b45769c949ff53d40236039f96a0de3a0f2`.
- Built Plugin preload SHA-256 (unchanged implementation): `f72d2efb605479dbf073f33506a93f5c6fec6d163cf450f7757334dd4280d9ea`.

The evidence retains the unchanged driver's `phase: 6E-5C` label. Here it is reused as a 6E-5D mechanical regression, not relabeled as 6E-5E packaged evidence.

### Final diff review

**Standards:** independent read-only review found zero actionable hard standard/security findings and zero refactor recommendations. The compact uniqueness fallback, safe hello classification, terminal deadline check and authentication containment preserve the frozen boundary.

**Spec:** independent read-only review found zero actionable missing requirements, incorrect behavior or scope creep. The last two test-only additions explicitly confirm canonical duplicate-ID fatality and post-dispatch identity revalidation. Main production changes remain restricted to one Bridge module.

## Production Safety

`D:\webtools` and `%APPDATA%\Nook` were untouched. No production plugins, Favorites, settings, tokens, credentials, registry entries or install/update operations were used. Tests use temporary fixtures; the real verifier uses isolated temporary SDK/profile/package data and selects only its exact Electron executable/profile processes. No broad process-name termination or reinstall occurred.

## Protected Launcher Files

These initial SHA-256 values were compared again at completion and match exactly:

| Pre-existing file | SHA-256 |
|---|---|
| `native/WebTools.NativeHost.Checks/Program.cs` | `1E0F46FA219277A061D5234E1EFC103120B63E5DED0AE1335BA6F4EE99AAC9D0` |
| `native/WebTools.NativeHost/Catalog/AppCatalogService.cs` | `EA2F84F917603FA6CE3D61DFFF0267E45EE7DA89973EBAE0A24DC1F4A73521FD` |
| `docs/bugfix-launcher-app-search-after-autostart.md` | `B5FB3AF4F618D927275ED3D3C07ACCC8F06FE55480902DCF0D2A0BABA1E2BBA8` |

## Deferred Work / Known Limitations

- **6E-5E:** real packaged Bridge acceptance; not started. Deterministic Electron doubles and an unpackaged mechanical verifier do not replace it.
- **6E-6:** separately approved Host capabilities with live grant/install authority; none implemented here.
- **6E-7:** network policy/Gate 4; domains remains unsupported and Gate 4 not certified.
- Best-effort runtime-close callbacks are not guaranteed after renderer destruction/hang. No fuzz, exhaustive sender/race matrix, soak, memory benchmark or indefinite stability claim was made.
- No genuinely unresolved enforcement defect was found. The two known 5C findings were locally fixed without reopening design.

## Git Status

Phase 6E-5D changes are the five changed source/test files plus this report. The separate Launcher release-blocker changes remain unstaged. Final `git status --short`:

```text
 M electron/plugins/web-plugin-bridge.test.mjs
 M electron/plugins/web-plugin-bridge.ts
 M electron/plugins/web-plugin-preload-client.test.mjs
 M electron/plugins/web-plugin-runtime.test.mjs
 M native/WebTools.NativeHost.Checks/Program.cs
 M native/WebTools.NativeHost/Catalog/AppCatalogService.cs
 M plugin-sdk/declarative-v1/tests/web-protocol.test.mjs
?? docs/bugfix-launcher-app-search-after-autostart.md
?? docs/phase6e5d-bridge-enforcement-report.md
```

## Severity Summary

Unresolved: **P0=0, P1=0, blocking P2=0, non-blocking P2=0, P3=0**. This phase fixed three P2 findings and one P3 finding; intermediate failures are retained in the report rather than hidden.

## Recommendation

**PHASE 6E-5D ENFORCEMENT COMPLETE**

**READY FOR CODE REVIEW**

**PHASE 6E-5E NOT STARTED**

**NO COMMIT / NO PUSH**
