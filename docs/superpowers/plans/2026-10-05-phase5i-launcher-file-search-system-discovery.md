# Phase 5I Launcher Improvement Pass Implementation Plan

> **For agentic workers:** execute this plan inline with the `superpowers:executing-plans` workflow. Product changes use test-driven development. The user authorized one final checkpoint commit and a normal push; do not create per-task commits.

**Goal:** Make `file:` search discoverable and purpose-built in the Native Launcher, add safe non-destructive file actions, and include Windows Start Apps/system tools in the existing searchable App Catalog without duplicate entries.

**Architecture:** Keep one NativeHost search pipeline and the existing `EverythingClient`; add one bounded File Search presentation that filters only its current capped results. File actions resolve opaque Everything result tokens inside NativeHost. Extend current Windows Start Menu/Start Apps discovery with typed AppFolder targets and launch identity reconciliation, then reuse `SearchCore` for localized names, aliases, pinyin, and initials.

**Tech Stack:** .NET 10 WPF NativeHost, C# NativeHost Checks, Vue/Electron package regression with pnpm, Windows Shell APIs.

**Spec:** User-provided brief at `C:\Users\zry\.codex\attachments\032e6f24-23e4-42a2-b6b5-237e63a0a545\已粘贴的文本.txt`.

## Global Constraints

- Preserve the current branch and all Phase 5I evidence.
- Do not touch `D:\webtools`, `%APPDATA%\Nook`, real secrets, startup registration, or the user's real profile.
- Do not scan all of `C:\Windows` or recursively enumerate `System32`.
- Keep file paths and shortcut paths inside NativeHost; UI references file results only by the existing host-owned Everything token.
- Use only bounded file results, cancellation, and latest-query-wins behavior from the current Everything pipeline.
- File actions are limited to Open, Show in Folder, Copy object, Copy path, and Copy parent path.
- Do not add dependencies or alter Electron IPC, Manager architecture, persistence schemas, or Phase 6 scope.
- One final commit for this pass, then push only the current branch normally; no PR, merge, tag, or release.

## Review Focus

- A result token from a superseded Everything query must not resolve to a different path or remain actionable after the row disappears.
- A path that disappears, becomes inaccessible, exceeds the supported bound, or is on a disconnected drive must return a bounded user-facing error without crashing the WPF host.
- A Windows AppFolder ID with malformed separators, extra command syntax, or an unsupported form must never become an arbitrary command or shell URI.
- Start Menu shortcut and Start Apps rows that resolve to the same effective application must merge aliases while preserving argument/working-directory distinctions.
- Category navigation, context-menu keyboard input, and ordinary result selection must not steal focus or change existing Escape/hide behavior.

---

### Task 1: Search Files contextual action

**Files:**
- Modify: `native/WebTools.NativeHost/Search/SearchModels.cs`
- Modify: `native/WebTools.NativeHost/Search/SearchCore.cs`
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`
- Modify: `native/search-contract/launcher-search-parity.json`

**Interfaces:**
- Consumes: existing `SearchCommand.Parse`, `SearchResult`, and `ResultAction` model.
- Produces: `SearchFilesAction(string Query)` for local-mode rows; normal results stay capped at 8, then Translation and Search Files actions are appended in a deterministic order. Search Files stores the exact original local query text, never a prefix or filesystem path; `file:` parsing retains its existing trimmed matching semantics.

- [x] Add NativeHost Checks for ordinary nonblank queries, whitespace-only, existing `?`, `/`, `file:` modes, coexistence with Translation, bounded deterministic order, and the exact `file:` transformation payload.
- [x] Run NativeHost Checks for the new Search Files contract coverage.
- [x] Add `SearchFilesAction` only for `SearchMode.Local`, preserve the exact original query text, and update parity fixtures.
- [x] Re-run NativeHost Checks and `pnpm test`; both pass with the added coverage.

### Task 2: File categories and safe host-side operations

**Files:**
- Create: `native/WebTools.NativeHost/Files/FileCategory.cs`
- Create: `native/WebTools.NativeHost/Files/FileResultOperations.cs`
- Modify: `native/WebTools.NativeHost/Files/EverythingClient.cs`
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`

**Interfaces:**
- Consumes: existing `OpenFileAction(Token)` and `EverythingClient.ResolvePath(token)`.
- Produces: `FileCategory` (`All`, `Folder`, `Application`, `Document`, `Image`, `Video`, `Audio`, `Archive`, `Other`), a single extension classifier, and `FileResultOperations.Execute(token, expectedKind, action)` using only a current host-owned token.

- [x] Add checks for every category, folder precedence, extension groups, unknown extension, Unicode names, bounded/long paths, and allowed context actions.
- [x] Add operation checks for current-token validation, vanished/wrong-kind paths, clipboard/shell failures, and the absence of destructive actions.
- [x] Implement the central classifier and filter only the already bounded current file result projection.
- [x] Implement host-owned shell, folder-select, FileDrop, and bounded path clipboard operations; no command shell or renderer-supplied path is accepted.
- [x] Run NativeHost Checks and confirm file operation failures return bounded results.

### Task 3: Windows Start Apps metadata, AppFolder launch, and identity merging

**Files:**
- Modify: `native/WebTools.NativeHost/Catalog/WindowsAppSource.cs`
- Modify: `native/WebTools.NativeHost/Catalog/AppCatalogService.cs`
- Modify: `native/WebTools.NativeHost/Catalog/AppCatalogSnapshotStore.cs` only if target validation requires it
- Modify: `native/WebTools.NativeHost/Services/ResultActionExecutor.cs`
- Modify: `native/WebTools.NativeHost/Services/NativeIconCache.cs` only if a verified icon fallback path requires it
- Modify: `native/WebTools.NativeHost/Search/SearchCore.cs`
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`

**Interfaces:**
- Consumes: existing Start Menu `.lnk`, `Get-StartApps`, App Paths, `AppCatalogService.Merge`, and `SearchCore` indexing.
- Produces: a typed `AppFolderTarget(AppId)` for validated non-package Start Apps; its launch is always fixed `explorer.exe` plus one validated `shell:AppsFolder\\<AppId>` argument. Localized Start Apps names merge as aliases by stable AppID/effective target. Pinyin and initials can match Chinese aliases as well as primary names.

- [x] Add pure checks for AppID grammar, AUMIDs, Windows IDs, malformed values, Start Menu/AppFolder identity, alias merging, and distinct shortcut arguments/working directories.
- [x] Add source parsing checks using schema-shaped Start Apps data, including Remote Desktop Connection, Windows tools, and unavailable entries.
- [x] Extend the fixed discovery script with bounded Shell AppsFolder target metadata and per-entry failure isolation; no query is interpolated or returned string executed.
- [x] Merge matching AppIDs/launch invocations with existing shortcut identity and preserve unmatched valid typed AppFolder records.
- [x] Extend catalog snapshot validation and launch handling for the new typed target, using a safe target icon path only when present.
- [x] Cover English, localized, pinyin, initials, deduplication, and launch identity.
- [x] Run NativeHost Checks and search parity; the live capability diagnostic distinguishes source failures from unavailable optional components.

### Task 4: WPF File Search Mode and keyboard/context-menu integration

**Files:**
- Modify: `native/WebTools.NativeHost/MainWindow.xaml`
- Modify: `native/WebTools.NativeHost/MainWindow.xaml.cs`
- Modify: `native/WebTools.NativeHost/Services/LauncherResultSelectionController.cs` only if required to preserve the shared selection model
- Modify: `native/WebTools.NativeHost.Checks/Program.cs` for isolated diagnostic assertions

**Interfaces:**
- Consumes: Tasks 1–3 (`SearchFilesAction`, `FileCategory`, `FileResultOperations`, and App Catalog results).
- Produces: a `file:`-specific left category list and right virtualized result list; category switches filter the current maximum 20 results without changing query. Context menu actions accept result tokens only. Enter opens selected result; Search Files rewrites the query to `file:<logical query>` and leaves Launcher open.

- [x] Add isolated checks for mode detection, category filtering without query mutation, result projection, action dispatch, and selection bounds.
- [x] Add a themed category sidebar and dedicated file presentation without changing the ordinary result presentation path.
- [x] Display fixed file-type glyphs, file/folder name, and parent path in a recycling-virtualized bounded list.
- [x] Add keyboard-accessible categories and WPF context-menu navigation while preserving existing Escape/hide behavior.
- [x] Keep Launcher open for Search Files, Show in Folder, and copy actions; Open uses the existing activation path.
- [x] Run NativeHost Checks, `pnpm run typecheck`, `pnpm test`, and `pnpm run build`.

### Task 5: Full review, isolated Windows candidate, report, and Git checkpoint

**Files:**
- Create: `docs/webtools-phase5i-launcher-improvement.md`
- Modify: only files produced by Tasks 1–4 and the report; no unrelated production files

**Interfaces:**
- Consumes: all prior tasks and current project scripts.
- Produces: automated evidence, an isolated Windows installer candidate path/hash, a concise USER MANUAL VERIFICATION checklist, and one pushed checkpoint on the current branch.

- [x] Review the complete branch diff with focus on path boundaries, stale tokens, AppID validation, identity collisions, selection/focus behavior, and optional Windows capabilities.
- [x] Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, NativeHost Checks, UpdateHelper Checks, `git diff --check`, and `pnpm run package:win`.
- [ ] Run packaged NativeHost/Manager GUI interaction with disposable profile, unique pipe, and exact executable identity. The isolated installer-layout smoke passed, but the available runtime driver was denied by execution policy; do not touch production install/profile.
- [x] Record bounded catalog observations; idle CPU and reliable packaged search/category timing were unavailable and are not inferred.
- [x] Record live Windows capability results and distinguish discovery status from optional component availability.
- [x] Write the manual checklist and evidence limitations in `docs/webtools-phase5i-launcher-improvement.md`.
- [ ] Stage only this pass's files, check the staged diff, commit once, push the current upstream normally, and verify clean status and ahead/behind `0/0`.

## Dependency order

`Task 1 + Task 3` can be developed independently. Task 2 consumes only Task 1's existing file result token contract. Task 4 depends on Tasks 1–3. Task 5 depends on all previous tasks and runs serially.

## Final acceptance

- `pnpm run typecheck`, `pnpm test`, `pnpm run build`, NativeHost Checks, and `git diff --check` pass.
- `pnpm run package:win` succeeds and the candidate installs only into a disposable isolated location if an install smoke is available.
- Native Launcher stays independent of Electron for local/file/system-app search; Manager close returns the isolated Electron process group to zero.
- `host` offers Search Files and enters exact `file:host` mode without hiding the Launcher.
- All nine file categories filter the same bounded result set; keyboard and context menus work and expose no destructive action.
- Current installed Start Apps/Windows Tools are discoverable through the existing catalog/search/pinyin pipeline; duplicates with the same effective launch identity merge aliases.
- Physical interaction, actual Explorer clipboard paste, external app launch, and edition-dependent system tools are labeled `USER MANUAL VERIFICATION` unless performed in this session.
- One final checkpoint commit is pushed to the current branch; no PR, merge, tag, release, or Phase 6 work occurs.
