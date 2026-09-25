# WebTools Launcher Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造现有 Windows 桌面启动器为 WebTools：支持托盘常驻、Ctrl+Alt+Space 唤起搜索窗、可靠的应用发现与拼音／别名匹配、合并式网址收藏、自定义网页搜索引擎、可选 Everything 文件搜索和 Codex 风格 UI。

**Architecture:** Electron 主进程负责托盘、窗口、全局快捷键、Windows 应用扫描与启动、Everything 子进程、网页元数据抓取和本地迁移。搜索弹窗与管理界面使用分离的 BrowserWindow，共用 Vue 组件、领域搜索模块和受限 typed preload API；Everything 仅由 `file:` 显式触发。

**Tech Stack:** 现有 Electron 44、electron-vite、Vue 3、TypeScript、`pinyin-pro`、`@lucide/vue`、electron-builder；可选 Windows Everything 安装和官方 `es.exe` CLI。

**Spec:** `docs/superpowers/specs/2026-09-25-webtools-launcher-redesign-design.md`

## Global Constraints

- 目标平台仅为 Windows。
- 默认全局快捷键为 `Ctrl+Alt+Space`。
- 普通搜索只展示应用和 WebTools 保存的网址；Everything 文件搜索使用独立 `file:` 前缀。
- `?关键词` 使用当前默认网页搜索引擎并交由系统默认浏览器打开。
- Vue renderer 只经由最小化 typed preload API 访问桌面能力；保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 文件系统、程序启动、外部网页、Everything 子进程和网页元数据请求由主进程负责。
- 不捆绑或强制安装 Everything；AI 翻译和 Google Translate 功能继续可用。
- 改产品显示名和安装包名，但保留 Electron `appId` `dev.nook.launcher` 与原 userData 路径，迁移前备份原始数据文件。
- 不实现通用插件市场。
- 按已有批准的项目约束，不添加或运行自动化测试；每项用类型检查、生产构建和 Windows 手动验收验证。

## Review Focus

- v1 数据中同一个 URL 同时出现在网址和多个收藏夹、且旧设置缺字段时，迁移后应保留标题、图标、收藏夹归属、AI 配置和默认搜索平台；Task 1 使用 v1 样本副本手动检查迁移与备份。
- Windows 桌面快捷方式描述与文件名冲突、多个来源重复、UWP／MSIX 入口失效时，目录应使用明确显示名称、去重且跳过单项错误；Task 2 在 Windows 检查有效、无效、重复和 Store 应用入口。
- 多词首字母、别名、标点和中文拼音交错时，应用结果应仍命中正确应用且不暴露本机路径；Task 2 手动检查 `vs code`、`idm`、中文全拼和首字母。
- 快捷键被其他程序占用或设置更新失败时，已有热键必须继续有效并显示失败原因；Task 3 在 Windows 手动检查成功、冲突和改回。
- Everything 不存在、未运行、查询包含空格／引号、超时或返回大量结果时，WebTools 普通搜索应继续工作且 Everything 请求有上限；Task 7 覆盖这些手动场景。
- 标题／图标请求遇到私网重定向、慢响应、无图标或大响应时，网址仍可保存并显示首字母回退；Task 5 手动检查这些网络场景。

## File Map

- `src/shared/domain.ts`：v2 本地数据、网站、文件夹、引擎、设置及应用结果类型。
- `electron/services/data-store.ts`：v1→v2 原子备份和迁移；保留原 AI 设置。
- `src/shared/ipc.ts`、`electron/preload.ts`、`src/types/electron.d.ts`：弹窗、窗口、应用目录、网址和设置的 typed IPC 契约。
- `electron/services/app-catalog.ts`、新建 `electron/services/windows-app-source.ts`、`electron/services/app-launcher.ts`：Windows 应用来源适配、去重、主进程私有启动目标与启动。
- `src/shared/pinyin-index.ts`、`src/shared/search.ts`：拼音、别名、多词首字母和结果排序。
- `electron/main.ts`、新建 `electron/services/global-hotkey.ts`：托盘、主/搜索窗口生命周期、热键注册和应用设置。
- `electron.vite.config.ts`、新增 `launcher.html`、`src/launcher.ts`、新建 `src/features/search/LauncherView.vue`：独立搜索窗 renderer 入口。
- `src/App.vue`、`src/styles/tokens.css`、`src/features/search/SearchView.vue`、`src/features/search/SearchResult.vue`：管理导航、品牌与 Codex 色彩、搜索结果 UI。
- `electron/services/bookmark-service.ts`、`electron/services/favicon-fetcher.ts`、新建 `electron/services/website-metadata.ts`、`src/features/entries/EntriesView.vue`：统一网站和收藏夹数据、title/favicon 服务与网格/列表界面。
- `src/shared/search-command.ts`、`src/shared/search-providers.ts`、`src/features/settings/SettingsView.vue`：`?`、`file:` 命令解析及可维护搜索引擎和快捷键设置。
- 新建 `electron/services/everything-client.ts`：检测并调用 `es.exe`，解析限量结果并打开文件或文件夹。
- `package.json`、`README.md`、`resources/app.ico`：WebTools 安装包身份显示、使用说明和品牌图标；appId/userData 位置保持不变。

## Delivery Phases

Although app discovery, websites and Everything can be discussed separately, they share the v2 settings contract and the same launcher query/window boundary. Keep one ordered plan for a coherent WebTools release: Tasks 1–4 produce the resident launcher, Tasks 5–6 complete website and search-engine management, Task 7 adds the optional Everything adapter, and Task 8 packages the integrated product. Every phase ends with a usable build and does not make Everything a prerequisite.

## Interfaces and Data Contracts

Task 1 owns the v2 contracts; later tasks must use these names.

```ts
export interface WebsiteEntry {
  id: string
  name: string
  url: string
  description?: string
  favicon?: string
  folderIds: string[]
  createdAt: number
}

export interface SearchEngine {
  id: string
  name: string
  template: string
  builtIn: boolean
  enabled: boolean
  order: number
}

export interface AppSettings {
  searchEngines: SearchEngine[]
  defaultSearchEngineId: string
  quickSearchShortcut: string
  launchOnStartup: boolean
  websiteLayout: 'grid' | 'list'
  everythingEnabled: boolean
  everythingEsPath: string
  aiBaseUrl: string
  aiModel: string
}

export interface AppSearchEntry {
  id: string
  name: string
  aliases: string[]
  source: 'desktop' | 'packaged'
  icon?: string
}

export interface EverythingResult {
  id: string
  name: string
  locationLabel: string
  kind: 'file' | 'folder'
}
```

`AppData` version 2 contains `webEntries: WebsiteEntry[]`, `bookmarkFolders: BookmarkFolder[]`, and `settings: AppSettings`; it no longer exposes legacy `tools` or separate `bookmarks` arrays. The main process keeps app launch targets and Everything result paths private, returning only sanitized result data to renderer. `DesktopApi` adds explicit methods such as `showLauncher()`, `showManager()`, `getApps()`, `refreshApps()`, `launchApp(id)`, `searchEverything(query)`, `openEverythingResult(id)`, `listWebsites(folderId?)`, `saveWebsite(input)`, `deleteWebsite(id)`, `addWebsiteToFolders(id, folderIds)`, `listBookmarkFolders()`, `saveBookmarkFolder(input)`, `deleteBookmarkFolder(id)`, `fetchWebsiteMetadata(url)`, `getSettings()`, and `updateSettings(partial)`; result-changing IPC returns the existing `IpcResult<T>` union.

### Task 1: Versioned Data Model and v1 Migration

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `electron/services/data-store.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `electron/main.ts` (store bootstrap only)

**Interfaces:** Produces all v2 data types and website/folder/settings IPC signatures listed above. `migrateV1ToV2(input: unknown): AppData` validates input and returns v2; `DataStore.load()` backs up the v1 file before atomically writing v2.

- [ ] **Step 1: Define v2 types and defaults.** Replace provider enum settings with built-in `SearchEngine[]`; add shortcut, autostart, layout and Everything preferences; define a single `WebsiteEntry` with `folderIds` and timestamp.
- [ ] **Step 2: Implement deterministic v1 conversion.** Convert each old web entry and bookmark to a website keyed by normalized `new URL(url).toString()`; preserve an explicit website title/description when present, fill missing favicon from bookmark data, union folder IDs, preserve earliest creation time, and map the old selected provider to its built-in ID. Preserve AI base URL/model and leave encrypted key storage untouched. Keep legacy tool records only in the `.v1.bak` copy.
- [ ] **Step 3: Make migration safe and repeatable.** Copy source bytes to `.v1.bak` before migration, validate backup/write errors, write the converted JSON to a temp path and atomically rename. If v2 is already present, do not migrate again. If data is corrupt, preserve the existing corruption backup behavior and show a readable recovery status rather than overwriting the only source.
- [ ] **Step 4: Update initial IPC/preload types and verify.** Use fixed channel constants; expose no generic IPC. Run `npm run typecheck` and `npm run build`; inspect a copied v1 sample with duplicate URLs and multiple folder memberships.
- [ ] **Step 5: Commit.** `git add src/shared/domain.ts electron/services/data-store.ts src/shared/ipc.ts electron/preload.ts src/types/electron.d.ts electron/main.ts`; commit `feat: migrate WebTools data model to v2`.

### Task 2: Windows Application Sources and Search Ranking

**Files:**
- Modify: `electron/services/app-catalog.ts`
- Create: `electron/services/windows-app-source.ts`
- Modify: `electron/services/app-launcher.ts`
- Modify: `src/shared/pinyin-index.ts`
- Modify: `src/shared/search.ts`
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/ipc.ts`, `electron/preload.ts`, `electron/main.ts`

**Interfaces:** `WindowsAppSource.list(): Promise<CatalogRecord[]>`; `CatalogRecord` stays main-process-only and stores one discriminated `launchTarget` (`shortcut`, `executable`, or `aumid`); `AppCatalogService.refresh(): Promise<AppSearchEntry[]>`; `AppCatalogService.launch(id: string): Promise<void>`; `buildSearchIndex(entries: SearchableEntry[]): SearchIndex`; `searchEntries(query: string, entries: SearchableEntry[], index: SearchIndex): SearchResult[]`.

- [ ] **Step 1: Record ZTools source findings before implementing sources.** Retry read-only access to the upstream source tree. Inspect Windows app source discovery, shortcut labels, aliases, packaged-app launch and search ranking. Write a concise implementation note in the task ledger. If the source remains unavailable, use the already-reviewed release notes only as behavioral references and implement against Windows APIs below; do not block the app or copy code.
- [ ] **Step 2: Keep shortcut launch targets private and correct display names.** Derive canonical display name from `.lnk` filename; put shortcut description, executable basename and product metadata in aliases. Store resolved path/arguments privately in `AppCatalogService`; never return file paths to renderer. Skip individual invalid shortcuts.
- [ ] **Step 3: Add registered and packaged app sources.** Add an isolated source adapter that queries current-user Windows Start App names/AUMIDs with `Get-StartApps` and current-user/machine App Paths entries. Use `execFile`/argument-safe registry access, validate JSON and executable targets, and bound the scan timeout. Launch desktop entries through their stored target; launch packaged entries by passing `shell:AppsFolder\<AUMID>` as an argument to `explorer.exe` through `execFile` without a shell. Deduplicate by normalized executable path or AUMID. Microsoft documents `Get-StartApps` as returning names and AppIDs for installed apps on the current user's Start screen, and App Paths maps executable names to full paths ([Get-StartApps](https://learn.microsoft.com/en-us/powershell/module/startlayout/get-startapps), [App Paths](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration), [AUMID and AppsFolder](https://learn.microsoft.com/en-us/windows/configuration/store/find-aumid)).
- [ ] **Step 4: Extend aliases and multi-word matching.** Index display names, aliases and pinyin separately. Tokenize words while preserving a compact normalized query so `vs code` matches `Visual Studio Code`; maintain exact name, prefix, alias, token initials, pinyin and initials ranking in that order.
- [ ] **Step 5: Wire and manually verify app discovery.** Run `npm run typecheck` and `npm run build`. On Windows, check Word, Edge and installed ChatGPT; test a malformed shortcut, duplicate shortcut, invalid App Paths target, `vs code`, `idm`, Chinese full pinyin and initials. Confirm ordinary result payloads and visible UI contain no file path.
- [ ] **Step 6: Commit.** Commit `feat: improve Windows app discovery and search` with only app source, catalog, launch and search files.

### Task 3: Tray Lifecycle, Windows and Global Hotkey

**Files:**
- Modify: `electron/main.ts`
- Create: `electron/services/global-hotkey.ts`
- Modify: `electron/preload.ts`, `src/shared/ipc.ts`, `src/types/electron.d.ts`
- Modify: `src/shared/domain.ts`, `electron/services/data-store.ts`

**Interfaces:** `GlobalHotkeyService.register(accelerator: string, onTrigger: () => void): IpcResult<void>`; `.replace(next: string): IpcResult<void>` registers the new accelerator before unregistering the previous one; `.dispose(): void`. Window actions are narrow IPC methods `showLauncher()` and `showManager()`.

- [ ] **Step 1: Add safe BrowserWindow factories.** Extract manager and launcher window constructors from `electron/main.ts`, applying `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, local preload and external navigation denial to both.
- [ ] **Step 2: Add tray and window visibility lifecycle.** Create one tray icon and menu; closing manager hides it rather than quitting; tray Open shows/focuses manager; Quit closes windows, unregisters hotkeys and exits. Ensure a second app instance focuses the manager rather than starting duplicate tray/hotkey instances.
- [ ] **Step 3: Register and update the accelerator.** Register default `Control+Alt+Space` after `app.whenReady()`. Use Electron `globalShortcut`, surface registration failure, and preserve the active shortcut if replacing it fails. Persist the new setting only after successful registration. Unregister on app quit.
- [ ] **Step 4: Add optional login startup.** Apply `app.setLoginItemSettings({ openAtLogin })` from the persisted boolean, default false; do not require administrator privileges.
- [ ] **Step 5: Verify lifecycle and hotkey.** Run typecheck/build and manually test while another app is focused, accelerator conflict/replacement, close-to-tray, tray open/quit, second launch and login-startup off/on.
- [ ] **Step 6: Commit.** Commit `feat: add resident tray launcher and global shortcut`.

### Task 4: Search Window, Codex Visual System and WebTools Branding

**Files:**
- Modify: `electron.vite.config.ts`
- Create: `launcher.html`
- Create: `src/launcher.ts`
- Create: `src/features/search/LauncherView.vue`
- Modify: `src/features/search/SearchView.vue`, `src/features/search/SearchResult.vue`
- Modify: `src/App.vue`, `src/styles/tokens.css`
- Modify: `src/shared/search-command.ts`, `src/shared/search-providers.ts` as needed for shared query execution
- Modify: `package.json`, `README.md`, `resources/app.ico` if a WebTools-specific icon is generated from an existing checked-in vector source

**Interfaces:** `LauncherView` accepts typed app/site results and settings as props or through the same narrow `window.desktop` preload contract; it emits `selectApp(id)`, `openWebsite(id)`, `addWebsite(id)`, `submitSearch(rawQuery)`, and `openManager()` events. The main process creates the launcher BrowserWindow once and focuses it on each hotkey trigger.

- [ ] **Step 1: Configure the second renderer entry.** Add `launcher.html` as a second Vite renderer input; keep the manager entry unchanged. Verify both HTML outputs exist under `out/renderer` after `npm run build`.
- [ ] **Step 2: Implement the launcher window behavior.** Show a frameless, always-on-top search window sized for the input and short result list; center it on the active display, focus/select the input on show, clear query after dismissal or successful launch, hide on Escape, and open manager through the logo action.
- [ ] **Step 3: Build the compact search UI.** Render only the search input and WebTools logo when empty; expand ranked grouped suggestions while typing. Support ArrowUp/ArrowDown, Enter, Escape, mouse select, website open, `+` add-to-folder and `?` web search. Do not show app file paths.
- [ ] **Step 4: Apply Codex-style tokens to both windows.** Update `tokens.css` to layered graphite surfaces, fine separators, muted text and restrained green accent. Reuse same focus, selected-result, button, empty/error and typography tokens in launcher and manager. Keep enough contrast for text and keyboard focus.
- [ ] **Step 5: Rename visible product.** Change electron-builder `productName`, installer artifact name, window titles, sidebar brand, README and setup shortcut label to WebTools. Keep `appId` `dev.nook.launcher` unchanged and confirm current `app.getPath('userData')` remains the original directory.
- [ ] **Step 6: Verify popup manually and commit.** Run typecheck/build; check empty/input/result states, icon opens manager, `?` opens selected search platform, focus after repeated hotkey, Escape, keyboard selection, and branding. Commit `feat: add WebTools quick search window`.

### Task 5: Unified Website and Bookmark Manager

**Files:**
- Modify: `electron/services/bookmark-service.ts` or replace with `electron/services/website-service.ts`
- Modify: `electron/services/favicon-fetcher.ts`
- Create: `electron/services/website-metadata.ts`
- Modify: `src/features/entries/EntriesView.vue`, `src/features/entries/EntryEditor.vue`
- Modify/retire: `src/features/bookmarks/BookmarksView.vue`, `BookmarkFolderList.vue`, `BookmarkDialog.vue`, `MoveBookmarkDialog.vue`, `Favicon.vue`
- Modify: `src/App.vue`, `src/shared/domain.ts`, `src/shared/ipc.ts`, `electron/preload.ts`, `electron/main.ts`

**Interfaces:** `WebsiteMetadataService.fetch(url: string): Promise<{ title?: string; favicon?: string }>`; `WebsiteService.save(input: Omit<WebsiteEntry, 'id'|'createdAt'|'favicon'|'folderIds'> & { id?: string }): Promise<IpcResult<WebsiteEntry>>`; `.addWebsiteToFolders(id, folderIds): Promise<IpcResult<WebsiteEntry>>`; `.list(folderId?: string): WebsiteEntry[]`; `.open(id): Promise<IpcResult<void>>`.

- [ ] **Step 1: Add bounded title parsing to the existing safe fetch path.** Reuse redirect-by-redirect public-destination checks, timeout and byte caps in `favicon-fetcher.ts`; parse `<title>` from bounded HTML without executing page scripts; use the declared icon URL then `/favicon.ico`; return partial metadata on failure.
- [ ] **Step 2: Replace bookmark/web-entry duplicate persistence with WebsiteService.** Provide one stable website ID and folder ID list. Retain folder create/rename/delete and add/remove membership; deleting a folder removes that folder ID from its websites, preserving the websites themselves. Replace duplicate bookmark IPC with website ID APIs and remove the obsolete tool list/save/delete/open channels and corresponding `electron/main.ts` handlers.
- [ ] **Step 3: Update search result bookmark action.** A website result's `+` opens the existing folder picker; selecting folders updates the website membership; creating a folder adds it immediately. Also allow a pasted URL to save directly from the manager.
- [ ] **Step 4: Build website grid/list management.** Add a persistent layout switch; grid card content and list-row background open the website; edit/delete buttons do not trigger open. Use cached favicon or hostname initial fallback; remove open-arrow button and Tools tab.
- [ ] **Step 5: Remove duplicate top-level favorites navigation.** Remove `BookmarksView` as a standalone route and expose folder filters within the website view. Keep quick search, website management, translation and settings in manager navigation.
- [ ] **Step 6: Verify and commit.** Run typecheck/build; manually check duplicate legacy migration output, success/failure title/icon fetch, private redirect, grid/list click targets, multi-folder membership, folder deletion confirmation, pasted URL, plus action and restart persistence. Commit `feat: unify websites and bookmark management`.

### Task 6: Custom Search Engines and Settings UI

**Files:**
- Modify: `src/shared/domain.ts`, `src/shared/search-command.ts`, `src/shared/search-providers.ts`
- Modify: `src/features/settings/SettingsView.vue`
- Modify: `electron/main.ts`, `electron/services/data-store.ts`, `src/shared/ipc.ts`, `electron/preload.ts`
- Create: `src/features/settings/SearchEngineEditor.vue` if needed to keep settings UI focused

**Interfaces:** `parseSearchCommand(raw: string): { mode: 'local'; query: string } | { mode: 'web'; query: string } | { mode: 'files'; query: string }`; `buildSearchUrl(engine: SearchEngine, query: string): URL` validates enabled engine and safely substitutes `%s`; `normalizeSearchEngines(value: unknown): SearchEngine[]` validates settings before persist.

- [ ] **Step 1: Implement engine validation and template expansion.** Seed Google, Baidu and Bilibili with stable IDs; require a parseable HTTP(S) URL template with exactly one `%s`; encode query text as one URL component; reject user-info and non-web schemes.
- [ ] **Step 2: Implement `?` routing with default engine ID.** Resolve only enabled engines; preserve current default during migration; if the selected engine is hidden/deleted, choose the first enabled engine and update saved preference.
- [ ] **Step 3: Add engine management UI.** Keep current settings layout; show built-ins and user engines with default selection, reorder handles, hide toggles, add/edit dialog and delete confirmation for user-defined engines only.
- [ ] **Step 4: Complete keyboard/accessibility settings controls.** Add accelerator recorder showing `Ctrl+Alt+Space` by default and a startup toggle; call the typed settings API and report registration errors from Task 3 without losing previous state.
- [ ] **Step 5: Verify and commit.** Run typecheck/build; manually check built-in and custom engine URL encoding (spaces, Chinese, `&`, `%`, `#`), invalid URL, missing/multiple placeholders, hidden default fallback, drag ordering, hotkey save failure and restart persistence. Commit `feat: add custom search engines and launcher settings`.

### Task 7: Optional Everything Search Adapter

**Files:**
- Create: `electron/services/everything-client.ts`
- Modify: `src/shared/domain.ts`, `src/shared/search-command.ts`, `src/shared/ipc.ts`, `electron/preload.ts`, `electron/main.ts`
- Modify: `src/features/search/LauncherView.vue`
- Modify: `src/features/settings/SettingsView.vue`
- Modify: `README.md`

**Interfaces:** `EverythingClient.detect(configuredPath?: string): Promise<{ executablePath?: string; running: boolean; version?: string }>`; `.search(query: string, limit: number): Promise<EverythingResult[]>`; `.open(id: string): Promise<IpcResult<void>>`. Each query stores a bounded ID-to-path result map in main; renderer gets `id`, `name`, basename-only `locationLabel`, and `kind`, never an absolute path. Renderer passes query/ID only; main resolves and validates the configured executable path and result ID. Limit results to 20 and per-query runtime to 1500 ms; ignore stale responses.

- [ ] **Step 1: Add safe ES CLI detection.** Probe common Everything install paths and user-configured `es.exe`; use `execFile` with an argument array, no shell, bounded output and a short version query. Keep the feature disabled until the user enables it.
- [ ] **Step 2: Implement search and parsing.** Invoke ES in JSON or CSV mode supported by the detected CLI version with an explicit max-result flag; parse exact file path/name and determine file versus folder. Return a structured unavailable/not-running/timeout error without affecting ordinary app search.
- [ ] **Step 3: Add `file:` command flow.** Route `file:` away from app/site search, debounce queries, cancel/ignore stale results and show a distinct Everything status. Open a file via `shell.openPath`; open a folder via Explorer. Keep path in the specialized file result only.
- [ ] **Step 4: Add Everything settings.** Show enabled state, detected/running status, configured `es.exe` path, browse/auto-detect and short install/running hint. Do not bundle Everything or `es.exe`.
- [ ] **Step 5: Verify and commit.** Run typecheck/build; manually check Everything disabled, executable missing, client stopped, running results, path containing spaces, quoted query, timeout, empty results, file open, folder open and ordinary app query during failure. Commit `feat: add optional Everything file search`.

### Task 8: Final Windows Integration and User Documentation

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `electron/main.ts`, `src/styles/tokens.css`, all updated navigation/settings/search/website views as integration requires
- Modify: `resources/app.ico` if a WebTools-specific replacement is included

- [ ] **Step 1: Audit end-to-end integration.** Confirm appData schema initializes before app discovery and windows; renderer actions use only typed IPC; close hides manager; tray quit unregisters hotkey; no route still expects standalone bookmarks/tools; data migration runs once.
- [ ] **Step 2: Update user guide.** Document WebTools branding, Ctrl+Alt+Space, `?` and `file:` syntax, Everything optional prerequisite/configuration, adding websites/folders, AI settings and Windows packaging.
- [ ] **Step 3: Run release verification.** Run `npm run typecheck`, `npm run build`, then `npm run package:win`. On Windows manually execute the packaged install and verify existing userData is reused, tray/hotkey works, application search, website CRUD/migration, search engines, Everything status and AI/Google translation flows.
- [ ] **Step 4: Commit final docs and packaging adjustments.** Commit `chore: prepare WebTools Windows release` and report the installer path plus observed checks.

## Plan Self-Review

- **Spec coverage:** tray and windows (Tasks 3–4); app source discovery, aliases and ranking (Task 2); search popup and visual system (Task 4); website metadata, folder merge and layouts (Task 5); custom engines and shortcut controls (Task 6); optional Everything `file:` mode (Task 7); name, data compatibility and documentation (Tasks 1 and 8); existing translation preservation (Tasks 1 and 8 manual acceptance).
- **Placeholder scan:** no TBD/TODO or “similar to another task” steps. Upstream ZTools source access is an explicit bounded read-only inspection with a defined fallback, not an implementation dependency.
- **Interface consistency:** Task 1 defines v2 types and settings before consumers; Task 2 produces main-private launch records and safe `AppSearchEntry`; Task 3 owns window/hotkey lifecycle; Tasks 4–7 consume the typed contracts and preserve separation between `?`, local, and `file:` modes.
- **Review Focus:** data merge is assigned to Task 1; app source failures and aliases to Task 2; hotkey replacement to Task 3/6; metadata restrictions to Task 5; Everything CLI failures to Task 7. These checks are manual because the approved project constraint forbids adding/running automated tests.
- **Known dependency:** Everything `es.exe` output options differ by installed version; Task 7 must detect the CLI version and choose JSON only where supported, otherwise use a documented CSV mode with correct quoting. If neither mode can be parsed robustly, leave integration unavailable with a readable diagnostic rather than falling back to shell-constructed commands.
