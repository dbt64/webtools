# Phase 6E-7 — Bounded Connection-Egress Feasibility

**Status: INCONCLUSIVE**
**Gate 4: NOT CERTIFIED**
**network.mode:domains: UNSUPPORTED**
**Production implementation: NOT STARTED**

## 1. Repository and exact build identity

| Field | Observed value |
|---|---|
| Repository | `D:\SystemDefault\Desktop\HomePage` |
| Branch | `codex/shared-ai-translation-2.0` |
| Source HEAD | `707c5673dff479285b34a5b441bec9d3b725c737` |
| Product version | `0.1.0` |
| Node / pnpm | `v24.21.0` / `9.15.9` |
| Runtime | Electron `44.4.5`, Chromium `152.0.7977.130` (the frozen Phase 6E-7 design identity) |
| OS used for the packaged smoke | Windows 11 Pro |
| Packaged executable | `C:\Users\admin\AppData\Local\Temp\WebTools-6E4B-验收 GNDhOn\packaged\win-unpacked\WebTools.exe` |
| Packaged executable SHA-256 | `08224c2c720218da1a09efc57b6af348e42e16cfa68ea36c400d97ad15f408b3` |
| Packaged `app.asar` SHA-256 | `79f7f68b5dcdca19ca343405158ed0b3fa7858909f342a4300392db1e18c138a` |

The package was built from the stated source HEAD. The only tracked worktree differences observed before this feasibility report were the separately protected Native Launcher changes; there were no Electron production-code changes. The package is a disposable `win-unpacked` test build, not an installer or production release.

## 2. Frozen design references

Read and followed:

- `docs/phase6e7-network-gate4-design.md` — frozen Network / Gate 4 design and ten feasibility questions.
- `docs/phase6e2-web-plugin-runtime-contract.md` — Web Plugin runtime, Session and Gate 4 contract.
- `docs/phase6e6-capability-boundary-design.md` and `docs/phase6e6-capability-implementation-report.md` — Main authority, capability and production boundary.
- Current runtime and authorization implementation in `electron/plugins/web-plugin-runtime.ts`, `electron/plugins/plugin-registry.ts`, `electron/plugins/plugin-manager.ts`, and `electron/plugins/web-feature-authority.ts`.

No frozen design document, product code, manifest schema, SDK, production grant, or user data was changed.

The Electron API observations below are limited to the versioned official documentation and do not substitute for runtime acceptance: [Session API, Electron v44.4.5](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md), [webRequest API, Electron v44.4.5](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-request.md), and [proxy configuration, Electron v44.4.5](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/proxy-config.md).

## 3. Scope and non-goals

This was a bounded feasibility review and isolated packaged lifecycle smoke. It was not Gate 4 certification, a network implementation, production permission enablement, an SDK API change, or Phase 6E-8. No public egress was enabled, and no arbitrary Internet host was probed.

The following remained unchanged:

- `network.mode:none` remains the only executable Web Plugin network profile.
- `network.mode:domains` remains recognized as a declaration but is not grantable, persisted as an effective grant, or executable.
- Gate 4 remains not certified.
- No `sdk.fetch`, `sdk.http`, generic Host request API, proxy SDK, or renderer-supplied network identity was added.
- No registry schema, persisted grant revision, extra resident process, NativeHost, installer, or Manager architecture was changed.

## 4. Experimental architecture and candidate comparison

The current supported path remains:

```text
validated immutable package snapshot
  → Main-owned WebPluginRuntime generation
  → WebContentsView in the existing Manager window
  → dedicated in-memory Session: webtools-web-plugin-runtime
  → random webtools-plugin:// origin serving listed package assets
  → network.mode:none policy
```

No candidate egress authority was implemented or attached to this path.

| Candidate | Feasibility observation | Runtime network experiment |
|---|---|---|
| A. Session / `webRequest` only | A request callback can decide using URL/request metadata, but the documented API evidence does not bind that decision or a separate DNS result to Chromium's actual destination socket. It is insufficient evidence for Gate 4 by itself. This does not prove that no other design can work. | Not run; no controlled public endpoint or connection instrumentation was available. |
| B. Fresh Session per runtime | A new Session could reduce cross-generation reuse, but Session lifecycle alone does not pin a resolved address to a socket or authenticate the request identity at connection admission. The production contract currently reuses its dedicated partition across sequential invocations. | Not run; changing production Session lifecycle was out of scope. |
| C. Main-owned loopback CONNECT guard | Remains a hypothesis only. A CONNECT authority/port does not, by itself, carry the originating scheme, exact WebContents/Feature, package hash, grant tuple, or captured runtime/authority epoch. No trustworthy request-to-CONNECT correlation, DNS pinning, bypass exclusion, or revocation behavior was established. | No broker or listener was created. |

The official API documentation describes URL-oriented request hooks, `resolveHost()` results, proxy configuration and connection cleanup, but does not document a pre-connect hook that both authorizes and pins Chromium's actual destination IP. In particular, a successful URL callback or a DNS lookup alone is not socket evidence. This is an evidence limitation, not a proof of impossibility.

## 5. Test environment and isolation

The only packaged runtime experiment used the existing `switch-while-loading` acceptance scenario with:

- Exact packaged `WebTools.exe` and `app.asar` hashes listed above.
- The real Electron `WebContentsView`, dedicated production Web Plugin Session, custom protocol, dedicated preload, and a validated offline Phase 6E-4B `.wtplugin` fixture.
- An isolated temporary user-data profile under `C:\Users\admin\AppData\Local\Temp\WebTools-6E4B-验收 GNDhOn\profiles\lifecycle-switch-while-loading-1`.
- The existing explicit acceptance CLI/environment gates.
- Temporary package and fixture paths. No normal grant was written.

The same packaged scenario was run twice: the first exploratory run passed but its temporary package was cleaned up; the second run retained the exact package identity and machine-readable evidence listed below. The retained scenario switched from a delayed-loading Feature to another Feature, rejected the old loading operation, reached `READY` for the new Feature, and verified that the exact packaged executable process count returned to zero after close. Neither run generated a public network request or started an egress broker. This is a **PACKAGED ACCEPTANCE PASS for the offline runtime lifecycle smoke only**, not network or Gate 4 evidence.

Sanitized machine-readable smoke evidence:

- JSON: `C:\Users\admin\AppData\Local\Temp\WebTools-Phase6E7-Evidence-fc6ae3e309a04a4fb576de81721ad126\packaged-runtime-evidence.json`
- JSON SHA-256: `08E4B8A40A053A8D8AC842FC3E5A85E6E8F0B6286388706E7828DF2F87384CA9`
- Log: `C:\Users\admin\AppData\Local\Temp\WebTools-Phase6E7-Evidence-fc6ae3e309a04a4fb576de81721ad126\packaged-runtime.log`
- Log SHA-256: `E6144304DE64C48BEC18B3A7466DC51A4E7503D9196037913CE654E1B8C8B9F3`
- Evidence records `productionInstallTouched=false`, `productionUserDataTouched=false`, and `originalGate1EvidenceWritten=false`.

The temporary evidence directory and package are outside the repository. They were retained for review and were not added to Git.

## 6. Public endpoint, DNS and TLS methodology

No controlled public hostname, DNS authority, trusted-certificate HTTPS endpoint, WSS endpoint, or endpoint-side socket/request log was supplied or configured for this task. Therefore no positive endpoint was selected and no public DNS, HTTPS, WSS, redirect, CORS, or actual destination-socket probe was run.

Using localhost, loopback, a private address, a self-signed certificate, or an uncontrolled public service would not satisfy the frozen positive-evidence requirements. No such substitute was reported as a positive result. No cloud metadata or sensitive local service was probed.

A valid future positive run must use a public hostname with controlled DNS and trusted TLS, independently record the expected public A/AAAA result and the actual remote socket destination, and exercise ordinary browser CORS for HTTPS and WSS without weakening TLS, CORS, mixed-content, or `webSecurity` behavior.

## 7. Authority identity model

Current Main-side code binds Web Feature operations to validated package/runtime state and a live WebContents/runtime generation. The Session partition is `webtools-web-plugin-runtime`; its current request policy is the `network.mode:none` package-origin/inventory allow rule. `web-plugin-runtime.ts` configures sandboxing, context isolation, `nodeIntegration: false`, and `webSecurity: true`.

No numeric Main-only `authorityEpoch` currently exists, and no network admission record captures a tuple of runtime generation, plugin ID/version, package hash, FeatureRef, exact manifest host/protocol set, and user grant. Renderer/plugin claims cannot be used as connection authority. The feasibility-approved epoch idea was not implemented or experimentally exercised.

## 8. Main-only authority epoch experiment

**INCONCLUSIVE — NOT RUN.** No test-only authority epoch or connection-admission harness was added. The required A/epoch-17 request → synchronous revoke → B/epoch-18 → late A request denial sequence could not be observed at a real connection boundary. No result is inferred from the existing Feature lifecycle generation checks.

## 9. HTTPS results

**INCONCLUSIVE — NOT TESTED.** No public HTTPS request was made from the packaged plugin runtime. There is no evidence here for allowed/denied HTTPS grants, destination socket identity, valid public TLS, or ordinary CORS behavior.

## 10. WSS results

**INCONCLUSIVE — NOT TESTED.** No public WSS connection was attempted. HTTPS/WSS distinction, handshake policy, revocation close, and reconnect behavior remain unverified. CONNECT host/port alone does not encode the scheme; no trusted request-to-connection correlation was demonstrated.

## 11. DNS/IP binding evidence

**INCONCLUSIVE — NOT TESTED.** No controlled A/AAAA set, mixed public/private answer, DNS rebinding transition, selected numeric destination, or actual socket destination was captured. Electron `resolveHost()` is not treated as proof that a later Chromium socket uses the returned address. Private/local address-classification fixtures and fail-closed enforcement were not run in this feasibility pass.

## 12. Redirect evidence

**INCONCLUSIVE — NOT TESTED.** No public-to-private, allowed-to-undeclared-public, or cross-scheme redirect was exercised. The current package navigation checks apply to document navigation; they are not evidence that every subresource redirect is authorized at a pinned connection boundary.

## 13. CORS behavior

**INCONCLUSIVE — NOT TESTED.** No endpoint observed an actual `webtools-plugin://<random-runtime-host>` Origin, preflight, allowed CORS response, denied CORS response, or WSS handshake. No CORS header spoofing or bypass was used.

## 14. Alternate transport and bypass findings

Static code confirms the current offline runtime sets `disable_non_proxied_udp`, denies workers through its existing runtime policy, uses direct proxy mode, and cancels non-package network requests in the dedicated Session. These are current `network.mode:none` defenses only. They do not prove that a future proxy policy controls QUIC/HTTP3, UDP, WebRTC, DNS prefetch, preconnect, speculative connections, pooling/coalescing, system/PAC fallback, or every Worker/ServiceWorker path.

**INCONCLUSIVE — NOT TESTED** for bypass exclusion under a domains-enabled candidate. No packet/socket observation or controlled positive egress was performed, and production remains in no-network mode.

## 15. Runtime A → B revocation race

**INCONCLUSIVE — NETWORK ADMISSION NOT TESTED.** The packaged offline `switch-while-loading` smoke observed the old Feature load being rejected when a replacement Feature became active. Evidence reports `loading-switch=PASS oldLoadRejected=true`. It did not queue a network admission, hold DNS/CONNECT, stream a response, maintain a WebSocket, reuse a pooled connection, or test a captured A authority against B. This lifecycle smoke cannot certify the required egress race.

## 16. Manager and Session isolation

Static code and the existing contract show the Web Plugin view uses its dedicated partition rather than Manager's default Session. The packaged lifecycle smoke exercised the real view/session in offline mode. No candidate proxy was installed, and no Manager-owned request or unrelated Electron Session was used as an isolation witness while egress was enabled.

**INCONCLUSIVE** for candidate egress isolation. No effect on Manager or other Sessions was observed because candidate egress was not started.

## 17. Process and listener teardown

**PACKAGED ACCEPTANCE PASS — EXISTING OFFLINE LIFECYCLE ONLY:** after the tested Manager/runtime close, the exact packaged executable remaining-process count was `0`. The acceptance JSON records this value.

No broker/listener was created, so its ownership, teardown, bound socket disappearance, and behavior during Manager close were **NOT TESTED**. There is no evidence that an additional process is required; there is also no prototype evidence proving an in-process design meets the connection-security requirements without one.

## 18. Ten mandatory questions

Each outcome below is for the proposed future domains-enabled connection authority, not a claim that the current `network.mode:none` behavior failed.

| Question | Outcome | Evidence and remaining gap |
|---|---|---|
| Q1. Can Chromium be forced through one trusted authority for fetch, XHR, WebSocket, redirects, preflight, reuse and preconnect? | **INCONCLUSIVE** | Session/webRequest-only evidence is URL-level; candidate C was not installed. No all-request/socket observation or bypass proof. |
| Q2. Can direct, system, PAC, implicit bypass and fallback routes be excluded and observed? | **INCONCLUSIVE** | No candidate proxy or controlled network environment was exercised; no packet/socket evidence. |
| Q3. Can DNS be validated and the actual connection use the validated numeric IP without a second uncontrolled lookup? | **INCONCLUSIVE** | No controlled DNS or actual remote socket evidence. `resolveHost()` alone does not document socket pinning. |
| Q4. Can HTTPS and WSS grants remain distinct with trusted request-to-connection correlation? | **INCONCLUSIVE** | Neither scheme was tested; no correlation mechanism was demonstrated. CONNECT host/port alone is insufficient identity evidence. |
| Q5. Can exact WebContents, FeatureRef, plugin/version/hash, manifest tuples, grant, generation and Main authority epoch bind to a connection? | **INCONCLUSIVE** | Existing Main runtime identity is visible in code, but no connection-bound identity record or authenticated transport was tested. |
| Q6. Does synchronous revocation deny every late A admission after B becomes current, including active/pending channels? | **INCONCLUSIVE** | Feature switch while loading passed, but no network admission/DNS/CONNECT/stream/socket race was run. |
| Q7. Can QUIC/UDP/WebRTC, speculative paths, pooling/coalescing, fallback, Worker and ServiceWorker paths be controlled? | **INCONCLUSIVE** | Existing offline restrictions are not a domains-enabled bypass test; no packet/socket evidence. |
| Q8. Can ordinary fetch/XHR/WebSocket keep normal CORS, TLS and mixed-content protections? | **INCONCLUSIVE** | No public HTTPS/WSS request or custom-origin CORS exchange was observed. |
| Q9. Is candidate egress isolated from Manager and other Sessions? | **INCONCLUSIVE** | Current dedicated Session is established, but no candidate proxy/egress was enabled to test isolation. |
| Q10. Can the design avoid an additional resident process/platform component and tear down fully? | **INCONCLUSIVE** | The proposed broker was not prototyped. Existing packaged Manager close returned its Electron process count to zero, but broker listener ownership/teardown was not exercised. |

## 19. Findings by severity

| Severity | Count | Findings |
|---|---:|---|
| P0 | 0 | No product security defect was found in the currently supported offline profile by this bounded pass. |
| P1 | 0 | No reproducible production regression was found. |
| Blocking P2 | 2 | (1) No controlled public DNS + trusted HTTPS/WSS + actual destination-socket evidence was supplied/configured. (2) Candidate C's request/CONNECT identity correlation, DNS pinning, alternate-path exclusion and A→B network revocation are unproven. These block feasibility acceptance; they are evidence gaps, not confirmed product defects. |
| Non-blocking P2 | 0 | — |
| P3 | 0 | — |

## 20. Limitations

- This is a bounded feasibility assessment, not a penetration test or exhaustive network matrix.
- Candidate C was not implemented, even as a prototype; no loopback listener was opened.
- No public endpoint, DNS control, packet capture, actual remote-socket evidence, CORS exchange, TLS/WSS request, redirect, or scheme-correlation evidence exists.
- The retained packaged evidence covers only offline runtime switching and process cleanup.
- The report does not conclude that connection-bound egress is impossible. It concludes that current evidence cannot establish feasibility under the frozen requirements.

## 21. Final feasibility decision

The available code and official Electron API documentation do not establish a connection-bound security primitive. Candidate A and B, as described, do not by themselves supply actual socket pinning or authenticated connection identity. Candidate C remains untested, and the critical positive/public endpoint and runtime-race evidence is absent. Therefore the correct result is **INCONCLUSIVE**, not PASS and not a claim of fundamental impossibility.

There is no authorization to implement a broker or enable domains mode. A future feasibility attempt would first need an isolated controlled public DNS/TLS HTTPS+WSS environment with actual socket observability, then prove connection identity/correlation and fail-closed A→B revocation against the real packaged runtime without changing CORS/TLS or affecting Manager Sessions. If that controlled environment cannot be provided, Gate 4 remains blocked.

## 22. Git and worktree safety state

- Branch remained `codex/shared-ai-translation-2.0`.
- HEAD remained `707c5673dff479285b34a5b441bec9d3b725c737`.
- Index was empty before this report; no files were staged.
- The following protected files retained their starting SHA-256 values:
  - `native/WebTools.NativeHost.Checks/Program.cs` — `1E0F46FA219277A061D5234E1EFC103120B63E5DED0AE1335BA6F4EE99AAC9D0`
  - `native/WebTools.NativeHost/Catalog/AppCatalogService.cs` — `EA2F84F917603FA6CE3D61DFFF0267E45EE7DA89973EBAE0A24DC1F4A73521FD`
  - `docs/bugfix-launcher-app-search-after-autostart.md` — `B5FB3AF4F618D927275ED3D3C07ACCC8F06FE55480902DCF0D2A0BABA1E2BBA8`
- Existing `undefined/` residue and `undefined/manager-package/win-unpacked/resources/app.asar` were left untouched and unstaged. The ASAR SHA-256 remained `282F98E970CECBB1CFCB2203E586356CED2DA20D7E277BAB9794FB9EAABDC96D`.
- No production install, `%APPDATA%\Nook`, registry, startup entry, real credential, or persistent grant was accessed or modified.
- No commit or push was performed.

## Verification performed

| Command / check | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — 537/537 |
| `pnpm run build` | PASS — Electron Main, preloads and Vue Renderer built |
| Focused runtime tests: `pnpm exec node --experimental-strip-types --test electron/plugins/manifest-v2.test.mjs electron/plugins/web-runtime-policy.test.mjs electron/plugins/web-feature-authority.test.mjs electron/plugins/web-plugin-runtime.test.mjs` | PASS — 27/27 |
| Packaged `switch-while-loading` acceptance smoke | PASS — offline lifecycle only; exact packaged executable remaining process count 0; not egress evidence |
| `git diff --check` | PASS — exit 0; new report also passed a separate trailing-whitespace scan |

## Final status

**PHASE 6E-7 BOUNDED CONNECTION-EGRESS FEASIBILITY — INCONCLUSIVE**
**GATE 4 — NOT CERTIFIED**
**network.mode:domains — UNSUPPORTED**
**PRODUCTION IMPLEMENTATION — NOT STARTED**
