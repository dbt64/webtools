# Launcher Search Discovery Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Do not run dependent tasks in parallel.

**Goal:** Extend the Windows launcher with broader application discovery, lazy native icons, saved-website search through the slash prefix, and a keyboard-accessible translation action that safely hands text to the existing manager translation page.

**Architecture:** Reuse WindowsAppSource and AppCatalogService for shortcut discovery, deduplication, launch, and icon caching. Keep all Windows paths and icon extraction in Electron main; add only narrow typed preload APIs. Preserve the existing local result behavior and add discriminated launcher actions for apps, websites, files, and translation. Queue translation handoffs in main until the manager renderer registers its listener and acknowledges delivery.

**Tech Stack:** Vue 3, TypeScript, Electron 44.4.5, electron-vite, existing pinyin search utilities, Electron contextBridge/IPC. Add no dependencies.

**Spec:** docs/superpowers/specs/2026-09-27-launcher-search-discovery-design.md (the requested docs/specs path does not exist; this is the matching design file reviewed against the current code).

## Global Constraints

- Windows remains the only supported platform for app discovery.
- Keep the existing WebsiteEntry and persisted settings schemas unchanged.
- Do not add dependencies.
- Do not expose Node APIs, filesystem paths, or shortcut paths to the renderer.
- Keep app icon extraction lazy; never extract icons while loading the full catalog.
- Preserve ?query web search, file:query Everything search, ordinary local search, manager Quick Search, website persistence, and translation providers.
- Preserve Launcher hotkey toggle, Escape, blur-hide, drag, compact/expanded mode, Favorites/Apps UI, and theme behavior.
- Do not automatically call a translation provider after handoff.

## Review Focus

1. A missing, inaccessible, malformed, or relative-target .lnk must not prevent other shortcut roots and catalog sources from loading. Task 1 verifies this by isolating failures per root and shortcut and checking both Desktop roots on Windows.
2. Duplicate shortcuts for one effective launch target must retain all useful display names and aliases, while shortcuts to the same executable with different arguments must not collapse into one record. Task 1 checks both cases.
3. An empty or failed icon lookup and an AUMID-only record must fall back without failing search; earlier query icon promises must never decorate a different current result. Tasks 2 and 5 cover fallback and request identity.
4. Translation eligibility must accept Latin phrases and common apostrophe/hyphen forms, reject mixed scripts or disallowed punctuation, and stay disabled in command modes. Task 5 checks positive examples and command prefixes.
5. A translation handoff during manager creation, renderer startup/reload, or while hidden must survive until the manager handles it; an older asynchronous translation result must not reappear after a newer prefill. Tasks 4 and 5 cover readiness, acknowledgement, and stale-result guards.

---

### Task 1: Extend the Windows application catalog

**Files:**
- Modify: electron/services/windows-app-source.ts
- Modify: electron/services/app-catalog.ts
- Modify: src/shared/domain.ts

**Interfaces:**
- Extend LaunchTarget with the system-app variant: kind system, app one of file-explorer, control-panel, or device-manager.
- Extend AppSearchEntry.source and CatalogRecord.source with the value system.
- Keep all launch paths and icon paths inside Electron main-process records.

- [ ] Add the current-user Desktop root using Electron app.getPath('desktop') and the Public Desktop root using the Windows PUBLIC environment root plus Desktop. Skip missing roots and deduplicate equivalent root paths case-insensitively.
- [ ] Reuse the existing recursive .lnk traversal and shell.readShortcutLink parsing for both new roots. Resolve relative targets against shortcut working-directory information when available; isolate directory access and shortcut parsing failures so other roots and records continue.
- [ ] Preserve launch through the original shortcut path. Build shortcut identity from the normalized resolved target, arguments, and working directory so equivalent invocations merge but links to the same executable with different arguments remain distinct. For exact duplicate invocations, add the duplicate display name and aliases to the surviving record's aliases so names are searchable.
- [ ] Add three stable built-in records with explicit data. Keep the Chinese display names and English aliases explicit; the existing shared index supplies pinyin and initial matching from the Chinese display name:
  - Display name 文件资源管理器; aliases File Explorer, Explorer, explorer.exe.
  - Display name 控制面板; aliases Control Panel, control.exe.
  - Display name 设备管理器; aliases Device Manager, devmgmt.msc.
- [ ] Launch the closed system-app union through fixed executable/argument arrays using execFile: explorer.exe with no arguments, control.exe with no arguments, and mmc.exe with devmgmt.msc. Never interpolate search text into a process command.
- [ ] Keep current Start Menu, Start Apps, and App Paths collection. Preserve per-source and per-shortcut fault isolation.
- [ ] Run npm run typecheck. Review the final catalog records to confirm IDs remain stable, aliases merge, and list() contains no filesystem paths.

### Task 2: Add cached, lazy application icon lookup

**Depends on:** Task 1.

**Files:**
- Modify: electron/services/app-catalog.ts
- Modify: electron/ipc/app-handlers.ts
- Modify: src/shared/ipc.ts
- Modify: electron/preload.ts

**Interfaces:**
- AppCatalogService.getIcon(id: string): Promise<string | null>.
- DesktopApi.getAppIcon(id: string): Promise<IpcResult<{ dataUrl: string | null }>>.
- IPC channel: apps:get-icon.

- [ ] Implement icon lookup by catalog ID and cache the in-flight or completed result so simultaneous requests share work. Resolve the icon only when requested; do not change refresh() to extract catalog-wide icons.
- [ ] Use the installed Electron app.getFileIcon(path, { size: 'normal' }) API, NativeImage.isEmpty(), and NativeImage.toDataURL(). For shortcut records, try the shortcut's system-resolved icon and then its declared icon path or resolved target; use the known executable path for built-in system targets. AUMID-only records may return null.
- [ ] Treat errors and empty NativeImage results as null. Keep the renderer fallback as the existing generic Command icon. Return only a data URL or null; never return an icon path.
- [ ] Validate the catalog ID in the IPC handler using the existing 16-character lowercase hexadecimal ID format. Return a typed IpcResult and do not let icon failure reject normal search.
- [ ] Add the explicit preload bridge method; do not expose ipcRenderer or filesystem APIs.
- [ ] Run npm run typecheck. Confirm the service cache is keyed by catalog ID and only getAppIcon requests can trigger extraction.

### Task 3: Add the saved-websites search command

**Depends on:** Task 1. This task edits a separate shared parser file and can run independently of Task 2 after Task 1, but parallel work is optional rather than required.

**Files:**
- Modify: src/shared/search-command.ts

**Interfaces:**
- Extend ParsedSearchCommand with a saved-websites mode and query string.

- [ ] Extend parseSearchCommand so a leading slash selects saved-websites mode and the text after the slash is trimmed.
- [ ] Keep the existing ? and case-insensitive file: parsing and ordinary local query behavior unchanged.
- [ ] Keep URL matching in the existing search index; Task 5 will pass each saved website's full URL as an alias rather than create a new search implementation.
- [ ] Run npm run typecheck. Check parser outputs for /name, /URL-fragment, bare /, ?query, file:query, and normal local input.

### Task 4: Add a reliable launcher-to-manager translation handoff

**Depends on:** Task 2, because this task extends the shared DesktopApi and preload boundary.

**Files:**
- Modify: electron/main.ts
- Modify: electron/ipc/window-handlers.ts
- Modify: electron/preload.ts
- Modify: src/shared/ipc.ts
- Modify: src/App.vue
- Modify: src/features/translate/TranslateView.vue

**Interfaces:**
- DesktopApi.openTranslation(text: string): Promise<IpcResult<void>>.
- DesktopApi.managerReady(): void.
- DesktopApi.onTranslationPrefill(handler: (request: { id: string; text: string }) => void): () => void.
- DesktopApi.acknowledgeTranslationPrefill(id: string): void.
- TranslateView receives a nullable prefill value containing an ID and text.

- [ ] Add a main-process pending handoff with one latest request containing an ID and text. A newer request replaces an older pending request. Validate the sender is the launcher WebContents and the original text length is between 1 and 20,000 characters; reject invalid input with IpcResult.
- [ ] Queue before calling showManager(). Support a missing manager window, an existing window, a hidden window, and a renderer that has not mounted yet.
- [ ] Track manager-renderer readiness separately from BrowserWindow ready-to-show. Reset readiness when the manager is created, closed, or begins a main-frame reload. Do not deliver until App.vue has registered the listener and reported managerReady().
- [ ] Deliver the queued request with an ID, and clear it only when the matching manager acknowledgement arrives. Validate that readiness and acknowledgement messages came from the current manager WebContents. Keep pending data across a renderer reload so it can be delivered again.
- [ ] In App.vue, register the preload listener before reporting readiness; on receipt, retain the request in Vue state, route to translate, then acknowledge it. Remove the listener on unmount.
- [ ] In TranslateView, watch the prefill request ID, copy its text exactly into sourceText, and clear translation, error, and copied state without calling AI or Google. Guard any older in-flight translate/open-provider response so it cannot repopulate stale output after a new prefill.
- [ ] Run npm run typecheck. Verify the API remains context-isolated and manager Quick Search behavior is untouched.

### Task 5: Integrate typed results, URL aliases, icons, and translation action in LauncherView

**Depends on:** Tasks 2, 3, and 4.

**Files:**
- Modify: src/features/search/LauncherView.vue
- Modify: src/shared/search-command.ts only if integration uncovers a parser contract gap

**Interfaces:**
- Define a discriminated launcher action union with explicit application, website, file, and translation variants. Each variant carries only the fields its action needs.
- Keep normal local results at the existing limit of eight combined app and website entries; append Translation as a possible ninth row.

- [ ] Build the saved-website search entries with name and full URL in aliases, retaining description search text, favicon, and stable website ID. In saved-websites mode, search websites only and open the selected item only through openWebsite(id).
- [ ] Keep normal local search mixed across applications and saved websites, in the existing rank order and existing eight-row limit. This preserves the current behavior confirmed during review. Do not change ?query or file:query actions.
- [ ] Add a Translation action for trimmed text containing at least one Latin-script letter and otherwise only Latin letters, spaces, common apostrophe forms, and common hyphen forms. Support test, hello world, Visual Studio Code, don't stop, and state-of-the-art. Do not add it for web, files, or saved-websites command modes.
- [ ] Append Translation after the existing local result rows even when no application matches; the row remains an additional ninth result when eight local rows exist.
- [ ] Use the same selectable result list for click, Enter, Arrow Up/Down, hover selection, and selected-row scrolling. Recompute or clamp selection whenever the mode or result list changes, including when apps/websites finish loading asynchronously.
- [ ] Dispatch actions with an exhaustive kind switch: app calls launchApp(id), website calls openWebsite(id), file calls openEverythingResult(id), and translation calls openTranslation(rawQuery). Show IpcResult errors in the current launcher error area.
- [ ] Request icons only for app IDs in the current rendered local results. Store images by catalog ID, not row index. Use a request generation and current-ID check before applying each asynchronous response; discard stale generations and clear obsolete mappings. Null/error renders Command.
- [ ] Keep file results, web-search hint/Enter, existing website bookmark action, and all existing launcher lifecycle behavior unchanged.
- [ ] Run npm run typecheck. Manually inspect the discriminated switch and verify the Translation row receives keyboard selection and scroll-into-view behavior.

### Task 6: Integrated static verification and final code review

**Depends on:** Task 5.

**Files:**
- Review all files changed in Tasks 1–5; do not add unrelated files.

- [ ] Review the full diff for stable catalog identities, shortcut isolation, safe fixed system launch arguments, no filesystem paths in renderer contracts, lazy icons, IPC sender validation, queue/ack lifecycle, and stale icon/translation response guards.
- [ ] Confirm no change to WebsiteEntry persistence, translation providers, manager Quick Search, ?/file: behavior, or completed launcher lifecycle features.
- [ ] Run npm run typecheck.
- [ ] Run npm run build.
- [ ] Run git diff --check.
- [ ] Confirm there is no test or lint script in package.json; do not add a dependency just to create a test harness.

### Task 7: Windows runtime verification

**Depends on:** Task 6. Run npm run electron:dev and verify in the Windows application.

- [ ] User Desktop shortcut can be searched and launched.
- [ ] Public Desktop shortcut can be searched and launched.
- [ ] File Explorer can be searched and launched by 文件资源管理器, File Explorer, Explorer, and explorer.exe.
- [ ] Control Panel can be searched and launched by 控制面板, Control Panel, and control.exe.
- [ ] Device Manager can be searched and launched by 设备管理器, Device Manager, and devmgmt.msc.
- [ ] A Win32 app result shows its real icon.
- [ ] An unavailable/empty icon uses the generic Command icon.
- [ ] Rapidly changing the query never applies an old icon to a different result.
- [ ] /name searches a saved website.
- [ ] /URL-fragment searches a saved website using its stored URL.
- [ ] Arrow Up/Down selects results in local, saved-websites, and translation-containing result sets.
- [ ] Enter opens the selected saved website through its saved ID.
- [ ] ?query retains the current web-search action.
- [ ] file:query retains the current Everything-search action.
- [ ] test displays Translation.
- [ ] An unmatched English phrase still displays Translation.
- [ ] An application-matching English phrase shows matching app results and Translation together.
- [ ] Translation can be selected by keyboard, activated with Enter, and activated by click.
- [ ] Translation opens the manager on the Translation section.
- [ ] TranslateView receives the exact original launcher input, preserving case and internal spacing.
- [ ] Handoff does not automatically start AI or Google translation.
- [ ] Handoff works when the manager has not been created.
- [ ] Handoff works while a new manager renderer is still starting.
- [ ] Handoff works when the manager is already open.
- [ ] Handoff works when the manager exists but is hidden.
- [ ] A new prefill clears an old translation and prevents an older pending provider result from returning.
- [ ] Launcher hotkey toggle is unchanged.
- [ ] Escape hide is unchanged.
- [ ] Blur-hide is unchanged.
- [ ] Window dragging is unchanged.
- [ ] Favorites/Apps shortcuts, compact/expanded layout, and theme behavior are unchanged.
- [ ] Existing manager Quick Search and explicit AI/Google translation actions still work.
- [ ] Ordinary local app search and saved-website search still work, and saved websites persist after restart.

## Task Dependencies and Delegation

- Required order: Task 1 → Task 2 → Task 4 → Task 5 → Task 6 → Task 7.
- Task 3 depends only on Task 1 and must also finish before Task 5.
- Tasks 2 and 3 have disjoint files and may be delegated independently after Task 1. Parallel execution is optional; Task 3 is small, so serial execution is the default.
- Task 1 can be delegated only with its exact launch-target and alias contracts above; the primary agent should verify Windows shortcut behavior before Task 2.
- Task 4 and Task 5 should remain with the primary agent because they coordinate manager window lifetime, renderer readiness, IPC acknowledgement, Vue routing, query selection, and async result races.
- A read-only reviewer may check Task 6 after implementation; the primary agent owns final typecheck/build/diff verification and Task 7 coordination.

## Review Outcome and Known Limitations

- The design file reviewed is under docs/superpowers/specs, not the docs/specs path supplied in the request.
- Current LauncherView limits the mixed app-plus-website result set to eight. The user confirmed that ordinary search must retain this behavior and that slash is an additional website-only mode.
- Current shortcut deduplication keys .lnk records by executable path only, ignoring shortcut arguments and working directory; distinct launch actions can collapse. It also merges aliases but not duplicate display names. Task 1 uses effective target identity and makes duplicate names searchable as aliases.
- Electron 44.4.5 provides app.getFileIcon(path, { size }) and NativeImage.isEmpty()/toDataURL(). Its FileIconOptions has no iconIndex field. Try the OS-resolved .lnk icon, then the declared icon path and target. If a DLL/EXE requires a non-default icon resource index that Electron cannot select, use the target icon or generic fallback; do not add a dependency or expose paths.
- The repository has no configured test or lint script. Validation is typecheck/build plus the specified Windows runtime checks.
