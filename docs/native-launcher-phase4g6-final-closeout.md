# WebTools — Phase 4G-6 Final Production Closeout

Date: 2026-10-04

## Final Decision

**PHASE 4G-6 COMPLETE**

**FINAL PRODUCTION CLOSEOUT PASS**

**NATIVE LAUNCHER MIGRATION COMPLETE**

This closes the Native Launcher migration acceptance using the already accepted Phase 4F–4G5 evidence and the exact 4G5 production candidate. It does not authorize or perform deployment, installation, upgrade, uninstall, release publication, or a new development phase.

## Git and Source Identity

- Branch: `codex/shared-ai-translation-2.0`.
- HEAD before this closeout: `4e9d326bab80153bf02a3d2be6925402e980bb24` (`test: complete phase 4g5 windows acceptance`).
- Phase 4G-4 checkpoint: `1f68fe0ccc916e33197a9ec19d42b58ef5da5161`.
- pnpm migration checkpoint: `9965f285207385085a3b3cb9f4ffed6f0226b1a5`.
- Phase 4G-5 checkpoint: `4e9d326bab80153bf02a3d2be6925402e980bb24`.
- Before creating the G6 documents, the worktree was clean and `HEAD...upstream` was `0 0`. The G4, pnpm, and G5 commits were present in the current branch and upstream.
- No files under `src/`, `electron/`, or `native/` changed between the candidate smoke's recorded source HEAD (`1f68fe0`) and the G5 checkpoint. The later pnpm commit changed package management/build-script documentation and invocation only; the G5 candidate's packaged runtime hashes match the retained smoke manifest.

## Final Architecture Review

The reviewed implementation matches the NativeHost-first production ownership model:

```text
WebTools.NativeHost.exe
├── WPF Launcher and native search
├── global hotkey and tray
├── login-startup registration
├── Launcher settings/catalog state
└── current-user Named Pipe server
        └── starts on demand → Electron Manager
                               ├── one Vue Manager window
                               ├── Websites/Favorites
                               ├── Settings
                               └── Translation
```

- `native/WebTools.NativeHost/App.xaml.cs` owns the normal single-instance mutex, Launcher, tray, hotkey, startup registration and Manager controller. The Resource/acceptance test modes use isolated pipes/profiles and do not enable production startup registration.
- `native/WebTools.NativeHost/Services/ManagerController.cs` queues page/translation requests until the Manager renderer reports ready, uses request IDs and acknowledgements, reuses the tracked Manager process and requests graceful Manager shutdown. Its forced process-tree termination is bounded to the exact child `Process` object after shutdown timeout; it is not a process-name sweep.
- `native/WebTools.NativeHost/Services/ManagerProcessLauncher.cs` resolves the packaged Manager beside the NativeHost at `Manager/WebTools.exe` and uses argument-list process launch. The explicit `WEBTOOLS_MANAGER_EXE` environment override is a diagnostic/test seam and is honored when present; ordinary packaged discovery uses the installed sibling path.
- `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs` scopes the production pipe with `PipeOptions.CurrentUserOnly`, validates protocol version, request IDs, payloads and bounded input, and serializes settings/website projection updates. The renderer is not given Node or filesystem APIs.
- `electron/main.ts` creates only the Manager `BrowserWindow`, with `contextIsolation`, `sandbox`, and `nodeIntegration: false`; window-open requests are denied. A normal Manager close destroys the window and quits Electron. The NativeHost remains the tray/Launcher owner.
- Translation handoff is typed, limits text to 20,000 characters, uses request IDs and acknowledgement, and applies the exact source text without submitting it to a provider. NativeHost disconnect closes Manager. Existing G4-3/G4-5 runtime evidence covers process exit/reopen and exact prefill.
- `scripts/native-production.nsi` uses the NativeHost executable as the finish-page, Start Menu and Desktop entry point. It stages NativeHost files under `$INSTDIR` and Electron under `$INSTDIR\Manager`; the user-data profile is not inside the install directory. The production uninstall section removes install files and startup registration, not `%APPDATA%\Nook`.
- Existing automated architecture tests confirm no production Electron Launcher entrypoint/control API, NativeHost startup ownership, Manager discovery layout, isolated installer smoke, and normal Manager-close behavior.

No production code was changed during Phase 4G-6.

## pnpm Migration Review

The migration remains within its approved boundary:

- One root Node package; no `pnpm-workspace.yaml`, workspace, or monorepo was added.
- `package.json` pins `pnpm@9.15.9`; the only manifest change is the `packageManager` field. Script names and dependency declarations are unchanged.
- `pnpm-lock.yaml` replaces the root npm lockfile. The production build script invokes the pinned pnpm version; Vite/electron-builder configuration and product architecture remain unchanged.
- The migration commit contains the six intended package-management files only: README, package manifest, old/new lockfiles, production build script, and a package-manager command comment in a verification script.
- Frozen installation passed in this closeout. No dependency upgrade, new dependency, hoist setting, or business-code modification was introduced.

## Production Candidate Identity

Candidate from the Phase 4G-5 accepted package run:

| Artifact | Location / installed relationship | Size | SHA-256 | Result |
|---|---|---:|---|---|
| Installer | `release/native-production-20261003-220039/WebTools-Setup-0.1.0.exe` | 191,374,341 bytes | `98C43D2235D44F98A0C7BC8E7D9DB208466368041CEF123DD94F001135C91547` | **MATCH** |
| NativeHost EXE | staged `stage/host/WebTools.NativeHost.exe`; installed at `$INSTDIR/WebTools.NativeHost.exe` | 162,304 bytes | `1D9C148BA6D8D20085E36625B2ED49C5E129F587008D00602A9C836F99D1A044` | **MATCH** |
| NativeHost DLL | staged `stage/host/WebTools.NativeHost.dll`; installed beside NativeHost | 532,992 bytes | `EC880FB0BEA214617C9FF144037A0D536DD56E3436527B1501B314314E76CA2A` | **MATCH** |
| Manager EXE | staged `stage/manager/WebTools.exe`; installed at `$INSTDIR/Manager/WebTools.exe` | 246,032,896 bytes | `6CC9ADF56A6FC709C3C718B72EFB740FEE923FD2C956DA9CE632937C1E222E6C` | **MATCH** |
| Manager archive | staged `stage/manager/resources/app.asar`; installed under Manager resources | 34,148,918 bytes | `4CE0632DCB30D985DB8EF80CE36F97DF48BAE734AEC0B208886DD7EE2DEBC309` | **MATCH** |

The installer hash and staged runtime hashes were recomputed in this closeout. The staged runtime hashes match the Phase 4G-5 isolated packaged-Manager smoke manifest. The NSIS source and retained stage establish the payload relationship and NativeHost entrypoint. A standalone NSIS extraction/list utility was not available, so the installer was not independently unpacked in this pass; the exact same installer hash was previously installed/covered by Phase 4G-5 acceptance, including the user's GUI upgrade and uninstall confirmation. No new installer run was performed.

The candidate is version `0.1.0`, built for the NativeHost-first layout. The installer is **unsigned**, as previously recorded. No signing configuration or release publication was added.

## Evidence Reused and Current Verification

Evidence classes remain distinct:

| Evidence class | Reused result | Scope |
|---|---|---|
| Historical phase evidence | Phase 4F upgrade/installer acceptance; Phase 4G-1 cold-start baseline; Hotkey System 2.0 acceptance; G4-2 stress; G4-3 Manager lifecycle; G4-4 three-hour Soak | Original sample values and historical decisions are unchanged; long tests were not repeated. |
| Current automated evidence | Phase 4G-5 NativeHost 55/55, UpdateHelper 10/10, package/isolated smoke and exact hashes | Reused because the relevant NativeHost, UpdateHelper, and accepted candidate payload identities are unchanged. |
| Real Manager desktop evidence | Phase 4G-5 real packaged Manager UI, settings/website persistence, exact Translation prefill, normal close/reopen/process-group checks | Retained under the labels in the G5 report; not claimed as new G6 interaction. |
| User-confirmed Windows evidence | Phase 4G-5 M-A/M-B/M-C/M-D/M-G | `USER CONFIRMED PASS`; not recast as independent Codex observation. |
| G6 checks run now | Frozen pnpm install, typecheck, Node tests, Manager build, hashes and source/layout review | Exact outputs summarized below. No installation or live-user-data operation. |

Commands executed in this closeout:

- `pnpm install --frozen-lockfile` — **PASS**, pnpm 9.15.9, lockfile unchanged/up to date.
- `pnpm run typecheck` — **PASS**.
- `pnpm test` — **PASS, 118/118**. Node emitted existing `MODULE_TYPELESS_PACKAGE_JSON` reparsing warnings for TypeScript/ESM test modules; no test failed.
- `pnpm run build` — **PASS**; Electron Main, preload and Vue renderer production bundles completed.
- `git diff --check` — **PASS**; no unstaged tracked diff remained.
- `git diff --cached --check` — the first staged check caught trailing Markdown hard-break spaces; those were removed, and the final staged check **PASS**.

NativeHost/UpdateHelper checks, Windows installer build, installed-runtime behavior, Manager UI, and stress/soak suites were not rerun because their source/artifact is unchanged and the accepted exact-candidate evidence remains applicable. This closeout did not execute `package:win`, start the installer, or claim a new runtime test.

## Production and User-Data Protection

This closeout did not start, stop, install over, update, uninstall, or otherwise operate on `D:\webtools`; did not access or modify `%APPDATA%\Nook`, Favorites, Settings, SecretStore, AI credentials, or startup registry; and did not terminate or inspect unrelated applications. No real token was read or used. The G5 report's retained production/process/profile observations remain historical evidence with their original scope.

## Findings and Deferred Items

- **P0: 0.**
- **P1: 0.**
- **Blocking P2: 0.**
- **Non-blocking P2: 2.**
  1. `electron/main.ts` still permits main-frame `file:` navigation generally, rather than only the packaged renderer URL. This is a pre-existing policy explicitly deferred in the Phase 4F report. No exploitable navigation path was demonstrated in this closeout. Review and constrain it as a separate Electron security-hardening change.
  2. The Native Manager named pipe is ACL-scoped to the current Windows user; its `hello` checks that the supplied PID is a positive integer but does not authenticate that PID against the NativeHost-launched Manager process. This is same-user IPC, not cross-user access or privilege elevation; exact peer binding would be defense-in-depth. No code change was made because this closeout found no reproducible acceptance failure and must not expand into architecture work.
- **P3: 3.**
  1. The installer is unsigned; signing remains a distribution/release consideration.
  2. Phase 4G-5's initial `environment-before.json` snapshot is absent because its collector failed. The original report preserves this; it is not repaired or represented as a complete environment audit.
  3. `WEBTOOLS_MANAGER_EXE` remains an environment override in the packaged Manager resolver for controlled test/diagnostic runs. Default production discovery selects the Manager beside NativeHost; deployments should avoid setting the override unintentionally.

The bounded tests and accepted Windows evidence establish the documented production behavior; they do not claim indefinite stability or a complete host filesystem/registry audit.

## Phase Status

Phase 4F, Phase 4G-1, Hotkey System 2.0, and Phase 4G-2 through Phase 4G-5 remain complete according to their respective reports. Their historical data was not rewritten. Phase 4G-6 closes the migration acceptance only; it does not deploy the installer or begin another phase.

**PHASE 4G-6 COMPLETE**

**FINAL PRODUCTION CLOSEOUT PASS**

**NATIVE LAUNCHER MIGRATION COMPLETE**
