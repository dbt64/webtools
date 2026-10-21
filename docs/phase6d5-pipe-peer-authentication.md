# Phase 6D-5 — Actual NativeHost ↔ Manager Pipe Peer Authentication

**Status:** `PHASE 6D-5 PIPE PEER AUTHENTICATION COMPLETE`
**Security Gate 2:** `COMPLETE` for the implemented peer-authentication boundary and focused automated checks. No installer or live production smoke was run.
**Phase 6D-6:** `NOT STARTED`.

## Scope

This phase authenticates the process connected to the NativeHost Manager Named Pipe. It does not implement Feature invocation, clipboard or other sensitive-context transport, Manifest v2, a Web Plugin Runtime, SDK v2, WASM, `network.domains`, or Super Panel.

No package, installer, production installation, `%APPDATA%\\Nook`, or `D:\\webtools` was used or modified. No files were staged, committed, or pushed.

## Baseline and working-tree boundaries

- Branch: `codex/shared-ai-translation-2.0`
- Committed baseline / HEAD: `eb375590134fcdc28fa5a6a8b6cf18d9b198a9ea`
- Upstream: `origin/codex/shared-ai-translation-2.0`
- Baseline divergence: ahead 3, behind 0.

The working tree already contained three separate categories before the 6D-5 implementation:

1. **Pre-existing Launcher improvement:** `docs/webtools-phase5i-launcher-improvement.md`, `native/WebTools.NativeHost.Checks/Program.cs`, `native/WebTools.NativeHost/MainWindow.xaml`, and `native/WebTools.NativeHost/MainWindow.xaml.cs`.
2. **Uncheckpointed Phase 6D-4:** Feature Projection v2, Native projection/search integration, Electron publication/client integration, D4 tests, and `docs/phase6d4-native-feature-search.md`. Several D4 files are also touched by this phase.
3. **Phase 6D-5:** the process identity service, Manager launch/controller/pipe authentication integration, focused checks and this report.

The overlapping D4/D5 files are `native/WebTools.NativeHost/App.xaml.cs` and `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs`. `native/WebTools.NativeHost.Checks/Program.cs` also contains pre-existing Launcher and D4 registrations plus the single D5 check registration. These files were not staged or committed.

## Previous trust model

The server already used `PipeOptions.CurrentUserOnly`. That restricts pipe access to the current Windows user, but does not identify which same-user process connected. The previous handshake accepted a positive `hello.processId` supplied by the client as the process identity. A same-user process could therefore claim another PID.

## Implemented trust model

### OS-observed pipe client identity

`WindowsManagerProcessIdentityApi` calls `GetNamedPipeClientProcessId` on the connected server-side `SafePipeHandle`. The returned PID is the authentication input. A failed API call, invalid PID, process-open failure, or later identity-inspection failure rejects the connection; there is no fallback to the JSON hello value.

The implementation pins a process handle opened with query-limited-information and synchronize rights, then observes:

- process ID;
- process creation FILETIME from `GetProcessTimes`;
- current process image from `QueryFullProcessImageNameW`;
- liveness through a zero-timeout wait on the retained process handle.

Expected executable paths are canonicalized through a file handle and `GetFinalPathNameByHandleW`, normalized for Windows path semantics, and compared case-insensitively. The retained `Process.StartTime` FILETIME must match the OS process creation time captured for the launched root.

### Packaged mode

The current NativeHost-launched Manager identity is retained for that Manager generation. A pipe client is accepted only when its OS-observed PID, creation identity, canonical image path, and liveness match that retained packaged Manager process. Matching a filename or merely running as the same user is insufficient.

### Development mode

The audited development launch is NativeHost → configured `node.exe` → `electron-vite dev` → Electron. The Electron executable is resolved from the external development root's `node_modules/electron/path.txt`; rooted paths, traversal outside the package distribution, and missing targets are rejected. NativeHost pins that executable using `ELECTRON_EXEC_PATH`.

Because the pipe client is Electron rather than the retained Node launch root, development mode creates a private Windows Job Object, assigns the NativeHost-launched Node process to it, and requires the OS-observed Electron process to have the expected image and belong to that exact Job. Job creation, assignment, membership inspection, or process-image failures reject authentication. There is no development-mode same-user or self-reported-PID fallback. The Job uses kill-on-close so the retained launch-chain boundary is released with its identity.

Focused tests exercise accepted/rejected membership decisions with deterministic process-identity fakes. A real development GUI launch was not performed in this phase, so actual electron-vite child Job inheritance remains a runtime verification item; if the runtime process is not in the Job, development connection fails closed.

### Session, generation, and replacement races

Every accepted connection owns a peer object tied to the retained launch identity and generation. `hello.processId` is retained only as a consistency field and must equal the OS-observed PID. It is not an authentication authority.

Each message checks that its peer remains current. Hello, acknowledgements, and requests acquire an operation lease before state-changing work. Manager replacement waits for existing authenticated operations to drain (bounded to 30 seconds), so an old Manager operation cannot continue mutating state after the new identity becomes current. Replacing or clearing a launch identity makes its prior sessions stale; reconnects must authenticate again against the new retained identity.

The retained process handle, process creation time, image path, liveness check, and launch generation prevent PID equality alone from allowing a recycled PID or stale Manager to reconnect.

### Pre-authentication policy and projection protection

Before a valid hello, the only permitted message is `hello`. The server obtains the pipe PID and authenticates it before protocol messages are processed. Both `plugins-update` (v1) and `features-update` (v2) are rejected before their update callbacks can run. Focused tests verify that rejected updates leave the last-known-good v1/v2 caches unchanged and that the NativeHost pipe server remains available.

After successful OS-observed authentication and capability negotiation, an isolated real Named Pipe integration check successfully publishes a valid Feature Projection v2 snapshot. Existing D4 checks continue to cover projection semantics and search integration. `CurrentUserOnly` remains an additional same-user ACL boundary, not proof of Manager identity.

## Focused security checks

The NativeHost checks cover:

- valid packaged launch identity;
- OS PID differing from the retained PID;
- same-user/different executable;
- PID reuse with a different creation FILETIME;
- expected PID with wrong image;
- retained process exit and exit during inspection;
- identity API failure;
- stale Manager A versus replacement Manager B, including an in-flight operation lease;
- development expected Electron in the current Job;
- unrelated Electron, unrelated Node, failed Job assignment, failed Job membership API, and exited launch root;
- safe development Electron path resolution and rejection of absolute/traversal `path.txt` values;
- actual isolated Named Pipe client PID observation, hello mismatch/malformed rejection, and server survival;
- pre-authentication v1/v2 update rejection and cache preservation;
- valid authenticated v1 and v2 update paths.

The OS integration test uses a random temporary pipe and the current isolated check process as the retained/connected process. It exercises the production Windows PID/image/creation-time APIs, but does not connect to the production pipe or launch the installed Manager.

## Verification

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — 392/392 |
| `pnpm run build` | PASS — Electron Main, preload, and Vue renderer production build |
| `dotnet build native/WebTools.NativeHost/WebTools.NativeHost.csproj --configuration Release` | PASS — 0 warnings, 0 errors |
| `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release` | PASS — 70/70, including the OS Named Pipe peer check |
| `git diff --check` | PASS — no whitespace errors; Git emitted only existing LF-to-CRLF working-copy warnings |

No Windows installer, packaged runtime, production smoke, stress test, or GUI acceptance was run. No real packaged Manager connection or actual Node → Electron development launch was manually exercised.

## Limitations and security claims

This is process identity validation, not code-signing validation, file-hash pinning, cryptographic attestation, or protection against code injection into an already trusted process. The report makes no claim of those properties. Authentication is scoped to the process observed by Windows on the current pipe connection and the NativeHost-retained launch identity.

## Findings

- **P0:** 0
- **P1:** 0
- **Blocking P2:** 0
- **P3:** 1 — real packaged Manager and actual development Job inheritance were not exercised in GUI/runtime acceptance; the development policy fails closed if Job membership cannot be proven.

The runtime limitation does not weaken the authentication policy or automated acceptance result. It should be checked during a future isolated Windows runtime acceptance before relying on development-mode pipe connectivity.

## Phase boundary

`PHASE 6D-5 PIPE PEER AUTHENTICATION COMPLETE`

`Security Gate 2: COMPLETE` for the implemented and automatically verified pipe peer-authentication contract.

`Phase 6D-6 NOT STARTED.` Feature invocation, sensitive-context transport, clipboard, Manifest v2, Web Plugin Runtime, and Super Panel remain unimplemented.
