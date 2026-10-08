# Phase 6E-5C — Minimal SDK / Bridge Implementation

**Date:** 2026-10-08
**Status:** IMPLEMENTATION COMPLETE — READY FOR CODE REVIEW
**Boundary:** Phase 6E-5D/5E not started. No commit/push/installer/release. Gate 4 remains NOT CERTIFIED; `network.mode:domains` remains UNSUPPORTED.

## Repository identity and scope

- Branch: `codex/shared-ai-translation-2.0`.
- Starting and ending HEAD: `f3f0e0de5e905f3b84ef2ecf45513de60a7db640`.
- Upstream: `origin/codex/shared-ai-translation-2.0`; existing ahead count 8, unchanged by this task.
- SDK stays `@webtools/plugin-sdk@1.2.0`, private/local distribution, at `plugin-sdk/declarative-v1/`. No version/dependency/lockfile/workspace change.
- Frozen 6E-5A/5B documents were read and preserved, not rewritten.
- Protected pre-existing Launcher changes were excluded. Their SHA-256 values were captured before implementation and verified unchanged after implementation: `native/WebTools.NativeHost.Checks/Program.cs`, `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`, `docs/bugfix-launcher-app-search-after-autostart.md`.

## Files changed by 6E-5C

| Files | Responsibility |
|---|---|
| `plugin-sdk/declarative-v1/package.json` | Add only `./web` export and include `web` in packaged files. Existing root/CLI/dependencies/version remain. |
| `plugin-sdk/declarative-v1/README.md` | Supported browser connection example; no private facade/transport author API. |
| `plugin-sdk/declarative-v1/web/index.mjs`, `web/index.d.ts` | Public connection/readiness/close API and browser-safe types. |
| `plugin-sdk/declarative-v1/web/bridge-client.mjs` | Internal request adapter, safe local errors, AbortSignal cleanup, local terminal state, close subscription bound. Not a package export. |
| `plugin-sdk/declarative-v1/web/protocol.mjs`, `web/protocol.d.mts` | Shared browser-neutral bounded JSON wire implementation/types, used by SDK/preload/Main. No Node validator duplication. |
| `plugin-sdk/declarative-v1/tests/web-client.test.mjs`, `tests/web-protocol.test.mjs`, `tests/web-public-api.typecheck.ts` | Focused browser client/wire behavior and public export typing. |
| `electron/web-plugin-preload.ts` | Dedicated sandboxed Plugin preload; private facade only. |
| `electron/plugins/web-plugin-preload-client.ts`, `web-plugin-preload-client.test.mjs` | Trusted ID allocation, per-call cancel closure, response correlation, bounded local deadline, IPC listener cleanup. |
| `electron/plugins/web-plugin-bridge.ts`, `web-plugin-bridge.test.mjs` | Main transport admission, quotas/deadlines/pending state, ping, safe response, synchronous revocation. |
| `electron/plugins/web-plugin-bridge-routes.ts` | Two private fixed IPC route constants. |
| `electron/plugins/web-plugin-runtime.ts`, `web-plugin-runtime.test.mjs` | Attach Plugin preload/Bridge to the existing runtime authority; handshake-based READY and navigation/close cleanup. |
| `electron.vite.config.ts` | Add one preload input; output `out/preload/web-plugin.js`. |
| `scripts/verify-phase6e5c-bridge-runtime.mjs` | Bounded real Electron implementation acceptance with isolated SDK copy/profile/Host-validated package fixture. |
| This report | Implementation evidence, limitations and review scope. |

`electron/main.ts`, trusted `electron/preload.ts`, `src/shared/ipc.ts`, NativeHost source, production installer, and persisted schemas were not modified by 6E-5C.

## Browser SDK and private facade

The only public JavaScript export of `@webtools/plugin-sdk/web` is `connectWebTools()`. Its frozen connection exposes `ready: Promise<void>` and `onClose(callback): () => void`. Multiple public connections to one facade reuse the same SDK connection. The Phase 6E-2 local maximum of four live close subscriptions is enforced; unsubscribe releases a slot. No public method-string request, ID, runtime descriptor, channel, package hash, generation, capability, or timeout option is exposed.

The browser module graph is exactly SDK `web/index.mjs` → `web/bridge-client.mjs` → `web/protocol.mjs`. The real acceptance fixture resolves the package's `./web` export from an independent temporary SDK copy, and its Vite graph contains only those modules plus the fixture entry. Node/Electron/yauzl imports are rejected by the focused bundle check. No browser alias/polyfill is used.

The dedicated preload exposes a frozen implementation-private `__webtoolsPluginBridge` facade:

- `getReady()` returns a Promise of safe readiness outcome data.
- `submit(method, payload)` returns `{ response: Promise<safe outcome>, cancel: () => void }`. The cancellation function is the opaque per-call handle; the ID stays captured in the trusted preload closure.
- `onClose(callback)` returns a local unsubscribe function.
- `dispose()` clears local transport state/listeners. It is not a Main/Manager/process API.

Neither raw `ipcRenderer` nor generic send/invoke/listen nor `window.desktop` is exposed. Custom Error properties are not relied on across contextBridge: preload Promises return safe data, and the SDK creates its own stable local Error.

## Fixed IPC and Main ownership

```text
Web Plugin → public browser SDK → private Plugin preload
    → webtools:plugin-bridge:client (canonical JSON string)
    → Main WebPluginBridge owned by existing WebPluginRuntime
    → webtools:plugin-bridge:host (canonical JSON string)
    → preload correlation → internal SDK Promise
```

Route names are implementation-private and are not included in public types, author examples, response/error data, or Plugin callback data. The generic adapter used by the acceptance fixture is package-internal, not a supported package subpath.

The existing `RuntimeInstance` remains the lifecycle/identity authority. No second runtime descriptor, registry, grant store, Manager preload route, or Native pipe was created. Main derives identity from exact `event.sender`, exact live `senderFrame === contents.mainFrame`, current active runtime/generation/state, expected random custom host and canonical selected entry path, and the branded immutable Host-validated snapshot/selected Feature. Same-document query/fragment state does not change authority. Unrelated WebContents are ignored without charging or closing the real runtime; a current Plugin identity violation closes its own generation.

## Protocol, readiness and ping

Protocol major is 1, with no minor/fallback/downgrade. Client messages: hello/request/cancel. Host messages: ready/response/runtime-closed. Wire is canonical compact JSON string; exact schemas, valid scalar strings, dense arrays/plain objects, depth 16, dangerous-key rejection, ordinal nested-key sorting, finite numbers/-0 normalization and byte-equivalent canonicalization are enforced. A bounded UTF-8 counter runs before JSON parsing; oversized input is not scanned for an ID. Serialization counts fragments before joins and avoids repeatedly scanning an accumulated full-size container.

Main READY requires the actual document `did-finish-load` plus a compatible verified preload hello; either may arrive first. Main changes runtime state before accepted ready is sent. SDK readiness resolves only from that Host acceptance. The separate existing 15-second document-load timeout is unchanged; the Bridge's 10-second deadline starts at actual finish-load and is also checked with a monotonic clock.

`bridge.ping` alone accepts `null`, uses ordinary Main admission/correlation, rechecks current authority before dispatch/result, and returns correlated `null`. It has no grant/context/effect/application-data read. Syntactically valid unknown methods return NOT_AVAILABLE; malformed input returns a safe failure where a trustworthy request ID exists. No generic capability router was introduced.

## Correlation, cancellation and revocation

Trusted preload allocates decimal safe-integer IDs starting at 1, monotonically, without reuse/wrap, and never exposes IDs in the opaque handle. Main's pending map belongs only to this exact runtime generation. Duplicate pending requests close the violating generation rather than ambiguously settling its older Promise. Unknown/duplicate responses are ignored. At ID exhaustion, preload rejects new calls and issues a post-ready hello, which Main rejects and uses to close the generation; a new explicit invocation is required, with no ID reuse or additional wire type.

Pre-emission SDK abort settles locally and does not invoke preload submission. Post-emission abort settles locally and invokes the opaque cancel closure; preload emits best-effort cancel. Main cancellation only operates on a currently matching pending entry. Unknown/duplicate cancel is token-free and stateless, including cancel observed before request admission; a later same-ID request is evaluated normally. No tombstone or generation-crossing cancellation is retained. Late response cannot reopen/re-settle locally cancelled work. Cancellation does not roll back committed effects.

Close/replacement/navigation/reload/crash/unresponsive/Manager close revoke runtime and Bridge eligibility synchronously, then clear pending entries/controllers and IPC listener. Runtime-closed delivery is best-effort to the old exact view; correctness does not depend on delivery. Cooperative pending work gets at most two seconds; existing view/session teardown and its separate cleanup bounds then proceed. Replacement still waits for existing teardown and starts a fresh Bridge/preload map and random origin. Cleanup failure retains the existing fail-closed unavailable behavior.

## Frozen bounds and safe errors

| Mechanism | Implemented bound |
|---|---|
| Request/response envelope | Independently ≤532,480 UTF-8 bytes |
| Main concurrent pending | 4; no queue |
| General rate | Capacity 20, monotonic refill 10/sec, same bucket before readiness |
| Bridge ready | 10 seconds after actual main document load |
| Ordinary Main dispatch | 30 seconds; abort/drop late result |
| Preload local request | 30 seconds from emission; best-effort cancel on local expiry |
| Cooperative close/cancel | 2 seconds, without retaining authority/slots |
| Public close subscriptions | 4, inherited Phase 6E-2 local SDK limit |

After minimum sender authentication, the raw size gate precedes bounded parse. Only canonical exact-schema hello in pre-ready state or cancel in READY is free. Malformed/fake controls, invalid JSON/schema, unknown requests and oversized attempts consume the general token before further request processing/rejection. Valid unknown/duplicate cancel is free. No second abuse bucket or caller-selected timeout is added. Comprehensive quota/deadline permutations remain 6E-5D work.

Errors reuse the closed Phase 6E-2 code set. Host errors contain only `code` and `retryable:false`; no raw exception/message/stack/path/secret/pipe/channel is serialized. SDK-owned messages are stable local text, with no implicit retry.

## Validation results

| Command / evidence | Actual result |
|---|---|
| `node --experimental-strip-types --test electron/plugins/web-plugin-bridge.test.mjs electron/plugins/web-plugin-preload-client.test.mjs electron/plugins/web-plugin-runtime.test.mjs plugin-sdk/declarative-v1/tests/web-client.test.mjs plugin-sdk/declarative-v1/tests/web-protocol.test.mjs` | 20/20 PASS |
| `node --experimental-strip-types --test plugin-sdk/declarative-v1/tests/*.test.mjs` | 54/54 PASS; existing Node root/CLI/Manifest v1 tooling remain green |
| `pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext plugin-sdk/declarative-v1/tests/web-public-api.typecheck.ts` | PASS; supported subpath types resolve, generic request API is absent |
| `pnpm run typecheck` | PASS |
| `pnpm test` | 473/473 PASS, zero failures/skips/cancellations |
| `pnpm run build` | PASS; Main, trusted preload, separate Plugin preload and Vue renderer built |
| `node --check scripts/verify-phase6e5c-bridge-runtime.mjs` | PASS |
| `node --experimental-strip-types scripts/verify-phase6e5c-bridge-runtime.mjs` | ELECTRON_44_CONTEXT_BRIDGE_PASS; two bounded real runtime executions |
| `git diff --check` plus direct untracked-source whitespace scan | PASS |

Tests were introduced before their implementations and observed failing. The navigation and subscription findings below each have a deterministic RED→GREEN regression. No fuzzing, soak, full 6E-5D matrix, production installer or release workflow ran. Node's existing module-type/experimental strip-types warnings and Git LF/CRLF notices remain environment diagnostics, not failed tests; no unrelated package-mode/line-ending change was made.

### Actual Electron 44.4.5 implementation validation — PASS

The driver uses the current `pnpm build` output with installed Electron 44.4.5, actual Main, production WebPluginRuntime, real WebContentsView, custom protocol, isolated Session and dedicated compiled preload. Its validated immutable .wtplugin fixture contains a browser bundle resolving the real SDK export. This is **unpackaged focused implementation acceptance**, not packaged 6E-5E acceptance or a new Gate 1 certification.

Normal and same-process replacement executions independently passed public readiness, internal correlated ping, safe unknown/malformed method failure, pre-emission abort, opaque cross-context cancel closure/Promise outcome, and a succeeding later ping. Public keys were only ready/onClose; facade keys were only getReady/submit/onClose/dispose. `process`, `require`, `Buffer`, `ipcRenderer`, `electron`, and `window.desktop` were undefined. The Plugin view was actually closed while Manager remained; normal Manager close then ended each isolated process group. Final isolated process count: **0**.

Evidence: `C:\Users\admin\AppData\Local\Temp\WebTools-6E5C-Bridge erNjUr\bridge-evidence.json`
SHA-256: `6acedc2d585bbc96c841494b12bba067ae1eda984993f1b6e5fb6f837b40e7eb`
Built Main SHA-256: `7e30e40fc2c984541e285312eca9e200434cb66d88bc1102989ef6f933d32185`
Built Plugin preload SHA-256: `f72d2efb605479dbf073f33506a93f5c6fec6d163cf450f7757334dd4280d9ea`.

Raw initial/replacement logs and disposable profiles/SDK copy/package fixture are retained under that temporary root, outside Git. No production profile/credentials are present in the fixtures.

## Review findings and corrections

1. **P2, fixed — pre-ready navigation:** The first implementation revoked navigation only after document load. Independent read-only review reproduced hello → reload → finish becoming READY under the old generation. A regression first failed with “Missing expected rejection”; the fix distinguishes the initial Host navigation and synchronously revokes any later cross-document main-frame navigation even before finish-load. Focused/runtime/full regression then passed.
2. **P2, fixed — inherited close-subscription bound:** Final cross-check against Phase 6E-2 found its four-callback local bound absent from the first SDK implementation. The focused fifth-subscription test failed before the fix. Independent subscription registrations now count separately, reject the fifth with local LIMIT_EXCEEDED, and unsubscribe releases a slot. Final tests passed.

Test-infrastructure issues were also corrected: Vite's library result array was handled; replacement checks use a genuinely increasing generation rather than incorrectly assuming 1→2 (the preserved runtime close increments it, yielding 1→3); an initially unsettled SDK-negative-test fixture was made fail-fast and disposed, with only its verified owned Node test process cleaned up. Intermediate failing logs remain in ignored task scratch/temporary evidence. These were not production Electron failures.

Remaining findings: **P0=0, P1=0, blocking P2=0, non-blocking P2=0, P3=0**. The independent review's deliberately excluded full adversarial matrix, future grants/capabilities, normal v2 install, domains and unrelated Launcher work remain excluded by the approved phase boundary; they are not missing 5C deliverables.

## Production safety and concrete limitations

- `D:\webtools` and `%APPDATA%\Nook` were not used for execution, installation, writes, resets or shutdown.
- Only unique system-temporary profiles and validated disposable package fixtures were used. Acceptance options retain the existing protected-root checks; Chromium is launched with that exact user-data directory.
- Process sampling selects the known Electron executable plus exact isolated profile and verifies the spawned Main PID. Manager close addresses its isolated DevTools target. No production process or arbitrary process-name group was terminated.
- Main's trusted Manager preload and APIs remain inaccessible in the real Plugin renderer.
- No business capabilities, persisted v2 grants or normal Plugin Center v2 installation exist in this slice. Unknown capability methods fail unavailable; missing grants never imply authority.
- Close notification is best-effort when a renderer is already destroyed/hung. Unit tests verify local cleanup; live tests prove view/process exit. No claim of guaranteed Plugin callback delivery after destruction is made.
- Unpackaged Electron mechanical evidence does not replace packaged/runtime enforcement acceptance or exhaustive security proof. No new certification claim is made.

## Deferred work

- **6E-5D:** Focused identity/state/generation/quota/deadline enforcement review; bounded sender/stale-generation/teardown/timing acceptance. No new authority model implied.
- **6E-5E:** Real packaged Bridge acceptance using validated fixtures and the actual packaged preload/Session/WebContentsView, with exact process cleanup.
- **6E-6:** Separately approved necessary Host capabilities and live grant/pre-commit authority sources. No capability is enabled here.
- **6E-7:** Independent network policy/Gate 4 work; domains stays unsupported.
- SDK publication/framework/external-author finalization remains later 6E-8, not completed by this slice.

## Final Git state

No staging/commit/push. HEAD stayed unchanged. Full final `git status --short` is recorded below after report creation. The 6E-5A/5B untracked documents and three protected Launcher files predate this implementation and remain separate from its change set.

### Final git status --short

```text
 M electron.vite.config.ts
 M electron/plugins/web-plugin-runtime.test.mjs
 M electron/plugins/web-plugin-runtime.ts
 M native/WebTools.NativeHost.Checks/Program.cs
 M native/WebTools.NativeHost/Catalog/AppCatalogService.cs
 M plugin-sdk/declarative-v1/README.md
 M plugin-sdk/declarative-v1/package.json
?? docs/bugfix-launcher-app-search-after-autostart.md
?? docs/phase6e5-thin-sdk-package-boundary.md
?? docs/phase6e5b-plugin-bridge-contract.md
?? docs/phase6e5c-minimal-plugin-bridge-implementation.md
?? electron/plugins/web-plugin-bridge-routes.ts
?? electron/plugins/web-plugin-bridge.test.mjs
?? electron/plugins/web-plugin-bridge.ts
?? electron/plugins/web-plugin-preload-client.test.mjs
?? electron/plugins/web-plugin-preload-client.ts
?? electron/web-plugin-preload.ts
?? plugin-sdk/declarative-v1/tests/web-client.test.mjs
?? plugin-sdk/declarative-v1/tests/web-protocol.test.mjs
?? plugin-sdk/declarative-v1/tests/web-public-api.typecheck.ts
?? plugin-sdk/declarative-v1/web/
?? scripts/verify-phase6e5c-bridge-runtime.mjs
```

## Recommendation

**PHASE 6E-5C IMPLEMENTATION COMPLETE**
**READY FOR CODE REVIEW**
**PHASE 6E-5D NOT STARTED**
**NO COMMIT / NO PUSH**
