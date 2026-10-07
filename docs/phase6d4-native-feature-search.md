# Phase 6D-4 — Native Feature Projection Cache & SearchCore Integration

## Status

`PHASE 6D-4 NATIVE FEATURE SEARCH COMPLETE`
Implementation and automated regression are complete. This report does not authorize or start Phase 6D-5.

## Baseline and scope

- Branch: `codex/shared-ai-translation-2.0`
- Baseline HEAD: `eb375590134fcdc28fa5a6a8b6cf18d9b198a9ea`
- Expected upstream state at start and rechecked at closeout: ahead 3 / behind 0.
- No files were staged or committed. No installer, production installation, production profile, stress test, or real app launch was used for this phase.

At the start, the worktree already contained the four authorized, unrelated Launcher improvements:

- `docs/webtools-phase5i-launcher-improvement.md`
- `native/WebTools.NativeHost.Checks/Program.cs`
- `native/WebTools.NativeHost/MainWindow.xaml`
- `native/WebTools.NativeHost/MainWindow.xaml.cs`

A baseline diff snapshot was captured outside the repository at `D:\系统缓存\webtools-phase6d4-preexisting-native-diff.patch` (SHA-256 `25D555800A31C1FCDAB9817E5A03C289A07ECCF8D3E36A7882A6C28A0A12F708`). The current `MainWindow.xaml` blob hash is `cc18950a8c0ba220ee4fd0931ca429cec9a2e839`, identical to the captured pre-existing postimage. It has no Phase 6D-4 change. `MainWindow.xaml.cs` contains the earlier search-files/folder icon work and new 6D-4 Feature UI in the same `ResultRow` diff region; the earlier geometry/icon changes remain intact. `Program.cs` retains its earlier STA startup check; 6D-4 adds one separate `Phase6D4Checks.Run` registration. `docs/webtools-phase5i-launcher-improvement.md` remains unrelated and untouched by this phase. These mixed diffs remain unstaged for review.

## Implementation

### Projection v2 transport and compatibility

- The existing `hello` handshake now negotiates the exact `feature-projection-v2` capability. The Native Host advertises it only when the Manager offers exactly that capability. Missing, malformed, or extra capability values fail closed for v2.
- The new `features-update` message sends a complete Projection v2 snapshot. The existing `plugins-update` contract is unchanged.
- New Manager + old Native Host continues without enabling v2. Old Manager + new Native Host keeps the existing v1 path and cannot submit v2 updates.
- The publisher accepts success only when the Native acknowledgement's `hostSessionId` and `revision` match the submitted snapshot.

### Native parser and bounded cache

`NativeFeatureProjectionStore` is separate from the v1 shortcut projection store. It validates the closed schema independently: exact fields; projection version; UUID host session; bounded positive revision and diagnostic timestamp; unique composite FeatureRefs; valid plugin/feature IDs; Unicode-scalar text limits; command count, size and uniqueness; frozen accepted-context metadata; fixed icon tokens; feature kinds `declarative-compatibility | built-in`; fixed `plugin-features` group; and the 2,000 global / 16 per-plugin row limits. A malformed row rejects the entire snapshot.

The serialized v2 payload is bounded by actual UTF-8 size at 3 MiB. The existing pipe codec bounds an entire protocol frame at 4 MiB and validates its length prefix before allocating the body. The cache reader likewise checks file length before allocating its read buffer.

The cache file is `feature-projection-v2.json` beneath the Native Host's existing profile root (production profile convention: `%APPDATA%\Nook`; development uses its existing `WebTools-Dev` profile; isolated checks inject a temporary profile). It contains only bounded presentation and frozen context metadata, never package paths/assets, queries, context values, clipboard contents, secrets, grants, or executable code. It is rebuildable and is not Plugin or permission authority.

Cache writes use a unique same-directory temporary file, `WriteThrough`, asynchronous flush plus disk flush, then an overwrite move. Temporary files are cleaned on failure. Startup missing/corrupt/oversized cache resolves to an empty Feature index without crashing. Returned snapshots are defensive copies.

Revision behavior is:

- Same host session, higher valid revision: accept and atomically replace.
- Same host session, lower revision: reject and retain last known good.
- Same host session and revision, same canonical Feature content: idempotent; diagnostic timestamp differences do not create a content conflict.
- Same host session and revision, different Feature content: reject and retain last known good.
- New valid host session: accept the complete snapshot without comparing its revision to the previous session, so a restarted Manager can begin at revision 1.
- Any malformed new-session snapshot: reject before cache replacement.

### SearchCore and Launcher

Feature entries are added to the existing Native `SearchCore`; no second matcher or ranking service was introduced. Local Feature matching uses the existing normalization, aliases, pinyin/initial handling, and ranking over title, plugin name, and commands. FeatureRef remains attached to the result. At most six Feature rows are returned in their independent `plugin-features` group; the existing combined app/website cap and ordering are unchanged. `/`, `?`, and `file:` modes do not receive Feature rows. The expanded Launcher uses the existing Plugins section to show the first six cached Features for an empty local query; an empty snapshot shows an empty-state message. Fixed icon tokens map to fixed native glyphs with a generic fallback.

Replacing the full snapshot also removes Features no longer present in the authoritative Main projection. Search-index rebuilds use a generation check so an older asynchronous rebuild cannot replace the newest projection. Projection refresh rerenders only a local search; it does not restart special-mode searches.

Feature results currently carry `OpenPluginFeatureAction` and the exact FeatureRef, but activation only displays the controlled “插件功能将在后续阶段开放。” status. The action executor also explicitly rejects this action as unsupported. No Feature invocation, route dispatch, permission grant, or package execution is implemented.

### Translation deduplication

The built-in `(webtools.translation, translate-text)` Feature participates in ordinary Feature search. When that exact Feature result is already shown, SearchCore suppresses the equivalent contextual Translation row. For other meaningful non-empty local text, contextual Translation remains available, including arbitrary Unicode/mixed text. `?`, `/`, and `file:` keep their existing behavior. Translation provider and execution behavior were not changed.

### Manager-closed behavior and security boundary

An isolated real Named Pipe server check negotiates v2, accepts and persists a full snapshot, closes the Manager-side pipe stream, then searches from the same Native store/SearchCore without a connected Manager. A second Manager session can publish a new full snapshot at revision 1, replacing removed rows. This proves the cache/search contract independently of an active pipe connection; it is not an OS process-tree or packaged-app measurement.

The Named Pipe remains current-user-only. **Actual pipe peer authentication is not implemented**, and this phase does not claim Security Gate 2 complete. The only new transport is bounded presentation metadata. Sensitive Context values and clipboard contents are not transported. Authentication is still required before any future sensitive-value transport.

## Verification

All commands below were run on the current worktree after implementation:

| Command | Result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — 392/392. Existing Node module-type warnings appeared; a Vite WebSocket warning reported port 24678 already in use, but the suite completed with zero failures. |
| `pnpm run build` | PASS — Electron Main, preload, and Vue Renderer production bundles built. |
| `node --experimental-strip-types --test electron/services/native-manager-client.test.mjs electron/services/native-feature-projection-publisher.test.mjs` | PASS — 6/6, including exact capability negotiation and mismatched-ack rejection. |
| `dotnet run --project native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj --configuration Release` | PASS — 69/69, including Feature cache/parser/SearchCore boundaries, atomic failure preservation, isolated pipe negotiation, disconnected-cache search, and session replacement. |
| `git diff --check` | PASS at closeout. |

Coverage includes valid/empty and malformed snapshots, unknown/missing fields, duplicate FeatureRefs, invalid IDs/enums/contexts/icons, actual UTF-8 sizing with multibyte strings, global and per-plugin limits, corrupt/truncated/oversized caches, same/new session revision rules, idempotence/conflict/stale rejection, atomic replacement failure, reload persistence, app/site cap and ranking parity, Feature title/plugin/command/pinyin/initial matching, six-row Feature cap, empty-query discovery, Translation deduplication, unchanged `/`, `?`, and `file:` behavior, and the explicit unavailable invocation path.

Automated checks use temporary directories and an isolated test pipe. They did not access `D:\webtools`, `%APPDATA%\Nook`, real Favorites, Settings, SecretStore, tokens, the production tray/hotkey, or a production Manager process.

## Not performed / remaining manual acceptance

- No Windows installer or `package:win` build was run.
- No packaged NativeHost/Manager was launched, and no actual Electron process-count measurement was made.
- No interactive Launcher UI validation was performed for empty-query Features, Feature result selection, or the controlled not-yet-wired activation message.

These require the later isolated Windows acceptance flow. Automated isolated cache and pipe tests pass, but they are not a substitute for installed UI/process acceptance.

## Files changed by Phase 6D-4

- `electron/main.ts`
- `electron/services/native-feature-projection-publisher.ts`
- `electron/services/native-feature-projection-publisher.test.mjs`
- `electron/services/native-manager-client.ts`
- `electron/services/native-manager-client.test.mjs`
- `native/WebTools.NativeHost/Data/NativeFeatureProjectionStore.cs` (new)
- `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs`
- `native/WebTools.NativeHost/App.xaml.cs`
- `native/WebTools.NativeHost/Search/SearchModels.cs`
- `native/WebTools.NativeHost/Search/SearchCore.cs`
- `native/WebTools.NativeHost/Services/ResultActionExecutor.cs`
- `native/WebTools.NativeHost/MainWindow.xaml.cs` (minimal v2 Feature additions overlap the pre-existing `ResultRow` icon hunk)
- `native/WebTools.NativeHost.Checks/Phase6D4Checks.cs` (new)
- `native/WebTools.NativeHost.Checks/Program.cs` (one D4 check registration; pre-existing Launcher checks retained)
- `docs/phase6d4-native-feature-search.md` (this report)

`native/WebTools.NativeHost/MainWindow.xaml` and `docs/webtools-phase5i-launcher-improvement.md` are pre-existing dirty files and were not modified by Phase 6D-4. Build output remains ignored. No files are staged.

## Findings

- P0: 0
- P1: 0
- Blocking P2: 0
- P3: 2 known, non-blocking limits: actual same-user pipe peer authentication remains a later security phase; packaged/interactive Windows UI and OS process-count acceptance remain untested.

## Phase boundary

- Projection v2 Native consumer implemented.
- Native cached Feature search implemented.
- Feature invocation **NOT implemented**.
- Actual pipe peer authentication **NOT implemented**.
- Sensitive Context transport **NOT implemented**.
- Clipboard **NOT implemented**.
- Manifest v2 **NOT implemented**.
- Web Plugin Runtime **NOT implemented**.
- Super Panel **NOT implemented**.
- **Phase 6D-5 NOT started.**

## Final result

`PHASE 6D-4 NATIVE FEATURE SEARCH COMPLETE`
