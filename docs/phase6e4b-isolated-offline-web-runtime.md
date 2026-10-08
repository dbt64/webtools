# Phase 6E-4B — Isolated Offline Web Runtime

## Status

**IMPLEMENTATION AND PACKAGED OFFLINE ACCEPTANCE PASS — PHASE 6E-4B COMPLETE.**

This records the original 6E-4B implementation and acceptance. The overall phase is now closed by [the final 6E-4C bounded acceptance report](phase6e4c-gate1-adversarial-acceptance.md): **Phase 6E-4 COMPLETE; Gate 1 isolated-runtime baseline ACCEPTED; BOUNDED / NON-EXHAUSTIVE assurance**. Normal Manifest v2 installation and domains networking remain unavailable. Phase 6E-5 is ready but has not started.

## Original 6E-4B Baseline

- Workspace: `D:\SystemDefault\Desktop\HomePage`
- Branch: `codex/shared-ai-translation-2.0`
- Starting and ending HEAD: `1112dc1d873ccd9288113f83800ce463ddbf47cd`
- Phase 6E-4A checkpoint: `88cf3a9d356b13eb8fdae94cdef02a1a3af5806d`
- Migration portability fix: `1112dc1 test(sdk): handle cross-volume external paths on Windows` (already committed separately)
- Phase 6E-4B changes remain unstaged and uncommitted. The branch was 7 commits ahead of `origin/codex/shared-ai-translation-2.0`; nothing was pushed in this task.

The pre-existing Launcher changes in `native/WebTools.NativeHost.Checks/Program.cs`, `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`, and `docs/bugfix-launcher-app-search-after-autostart.md` were preserved and are not part of this phase. The `src/styles/tokens.css` positioning change is included in 6E-4B because the native `WebContentsView` needs a bounded Manager content surface.

## Validated Runtime Snapshot

- **Implementation:** `validateWebPackageForRuntime` calls the same Phase 6E-3 validation core as the existing Manifest v2 validator, with resource collection enabled during the authoritative archive walk.
- **Single validation authority:** ZIP parsing, canonical path checks, inventory/MIME checks, collision checks, signatures, and all Phase 6E-3 size/ratio bounds remain in the existing validator implementation.
- **Immutable bytes:** the runtime snapshot privately owns copies of validated resource bytes; inventory and metadata are frozen; `getResource` returns defensive byte copies.
- **Package hash binding:** SHA-256 is computed from the exact archive byte snapshot consumed by validation and retained alongside those validated resources. Runtime serving reads only that snapshot.
- **TOCTOU protection:** the runtime does not reopen the original archive or resolve a package path. Mutating the caller's archive after validation does not change the snapshot.
- **Memory bounds:** existing 20 MiB archive, 256-entry, 50 MiB expanded, 100:1 ratio, and per-resource limits remain unchanged. No unbounded extraction path was added.
- **Public API changed:** no SDK public entry point, preload resource-byte API, Renderer API, NativeHost/pipe, projection, or PluginStore API exposes snapshot bytes. The runtime validator helper is Host-internal and not re-exported by the SDK package entry.
- **V2 installation enabled:** no. Normal `PluginManager` installation rejection remains unchanged.

## Production Runtime

- **Host:** one Main-owned `WebContentsView`, attached inside the trusted Manager window; no pool or spare view.
- **Session:** dedicated non-persistent partition, not the Manager default session. Permissions deny by default; downloads are canceled; cache is disabled; teardown closes connections and clears storage and HTTP cache.
- **Random origin:** each runtime receives 16 cryptographically random bytes encoded as 32 lowercase hexadecimal characters under `webtools-plugin://`. It is independent of plugin identity, feature identity, hash, user, and path.
- **Protocol:** serves only GET/HEAD resources present in the active validated snapshot at the exact active origin. Unknown paths, queries, fragments, other origins, and revoked generations fail closed; there is no filesystem, archive, Manager-resource, or network fallback.
- **CSP:** restrictive per-response policy denies inline/eval scripts, workers, frames, and remote sources. `wasm-unsafe-eval` is added only for a validated Feature declaring WASM and having a declared WASM resource.
- **Network:** only `network.mode: none` is executable. Session request filtering and the Host protocol both deny out-of-inventory/external requests. `network.mode: domains` is explicitly unsupported and is not certified.
- **Navigation:** only exact resources on the active runtime origin are allowed. Window opening, webview attachment, cross-origin navigation, and unknown paths are denied.
- **Storage:** no persistent plugin storage is provided. The non-persistent Session is cleared on teardown. Packaged renderer evidence confirms no pre-existing localStorage value in a fresh runtime; storage cleanup implementation is exercised by close/switch, but persistent cross-session behavior is intentionally not offered.
- **Service Workers:** unavailable in the packaged runtime probe.
- **Lifecycle:** `ABSENT → CREATING → LOADING → READY → CLOSING → CLOSED`, with failures moving through `FAULTED`. Main owns generations, revokes the active runtime before asynchronous cleanup, and bounds load/cleanup waits. Feature replacement closes the old runtime before creating the new one. Close requests from the Manager renderer carry the generation and are accepted only when it matches the active runtime, preventing an unmount from an old view from closing its replacement. Final 6E-4 review added immediate loading preemption, a pending-teardown barrier before replacement/Manager close, and an availability recheck after cleanup. Failed security cleanup blocks Session reuse; renderer crashes never automatically restart plugin code.
- **Manager close:** Manager window close waits for runtime cleanup, then destroys the window; Electron quits after the Manager closes. The packaged test confirmed the packaged executable process count returns to zero.

## Controlled Invocation Seam

The only current invocation seam is a controlled acceptance fixture that requires both `--phase6e4b-web-runtime-acceptance` and `WEBTOOLS_WEB_RUNTIME_ACCEPTANCE=1`. It accepts only the fixed fixture filename from a verified disposable TEMP tree, requires a separate TEMP profile, rejects reparse points and overlap with the user profile/install root, validates the real `.wtplugin` through the Host validator, and checks the fixed fixture identity, version, and `network.mode: none` before opening its exact Feature.

This seam does not expose an arbitrary package-opening API, does not make v2 installation available, and does not alter Native Projection or Feature invocation dispatch. Packaged execution is run with an isolated TEMP profile and disposable `win-unpacked` output; the production installation and `%APPDATA%\Nook` are not used.

## Security Boundary

- Plugin preload / SDK bridge: **none**.
- `ipcRenderer`, Node globals, `process`, `require`, `Buffer`, Electron globals: **not available** to the Web Feature renderer in packaged evidence.
- Manager DOM: **not available** to the Web Feature renderer.
- Filesystem paths and package archive paths: **not exposed** to the Web Feature renderer or runtime protocol.
- Host capabilities, clipboard, AI, PluginStore, and Native pipe: **not exposed**.

The preload additions belong only to the trusted Manager renderer and carry bounded bounds, close-generation, and runtime-state messages. Main validates the sender as the current Manager main frame. No runtime invocation or package bytes are sent through preload.

## Original 6E-4B Tests (Historical)

- `pnpm run typecheck`: **PASS**.
- `pnpm test`: **451/451 PASS**.
- `pnpm run build`: **PASS** (Electron Main, preload, and Vue Renderer).
- Focused snapshot/policy/acceptance-option tests: **11/11 PASS**.
- NativeHost Checks: **72/72 PASS** (regression only; no NativeHost product code was changed for 6E-4B).
- UpdateHelper Checks: **10/10 PASS**.
- Packaged Electron runtime acceptance: **PASS**. The official driver generated a real validated fixture, built an isolated `win-unpacked` Electron Manager under a Unicode/space TEMP path, and launched it twice with separate disposable profiles. The first run verified renderer isolation, strict CSP/eval behavior, blocked external fetch, same-origin module and image loading, denied Service Worker, and Manager layout. The second run switched Features within the same Manager process from generation 1 to generation 3; the previous runtime target was revoked, the new runtime remained visible in the trusted Manager route, and a stale old-view close did not close the new runtime. Both Manager closes ended the packaged executable process group. The successful driver removed its unique TEMP root after confirming exit.
- `git diff --check`: **PASS** (Git emitted only line-ending normalization warnings for working copies).

During packaged acceptance, the first switch attempt exposed a real same-process serialization deadlock in `openInternal()` and a stale view-unmount close race. The deadlock was fixed by closing the existing runtime directly from the already-serialized operation; close IPC was then generation-bound. A focused route regression test and the real packaged same-process switch acceptance now pass.

## Findings

- P0: **0**
- P1: **0**
- Blocking P2: **0**
- Non-blocking P2: **0**
- P3: **0**

Known scope limitations are deliberate: domain-network execution, normal v2 installation and Native Feature invocation are not enabled. Final 6E-4C acceptance and its current assurance limitations are recorded in the final closure report; original test counts above remain historical.

## Gate Status

- Gate 1 at original 4B acceptance was not yet accepted. The subsequent final 4C report now records **isolated-runtime baseline ACCEPTED**, with bounded/non-exhaustive assurance; no exhaustive security certification is claimed.
- Gate 4 (`network.mode: domains`): **NOT CERTIFIED**; domains mode remains rejected by this runtime.

## Original 6E-4C Entry Criteria (Historical)

Phase 6E-4C may begin with this implementation as its testable baseline. It should independently challenge snapshot authority, protocol/origin revocation, request and navigation policy, renderer isolation, storage teardown, runtime failure paths, and Manager-close process exit. It must not treat the 6E-4B packaged pass as Gate 1 certification.

## Original 6E-4B Git State (Historical)

- HEAD unchanged: `1112dc1d873ccd9288113f83800ce463ddbf47cd`
- 6E-4B staged: **no**
- 6E-4B committed: **no**
- Push: **no**
- Pre-existing Launcher work: **preserved; not staged or committed**

At the original 4B stopping point, 4C/5 had not started. This historical state is superseded by the final Phase 6E-4 closure report and local checkpoint. **Phase 6E-5 has not started; do not start it as part of closure.**
