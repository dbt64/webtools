# Windows 桌面启动器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建面向 Windows 的 Electron + Vue 3 + TypeScript 桌面启动器，提供拼音应用搜索、网址和工具管理、收藏夹、网页搜索指令及 AI/Google 翻译。

**Architecture:** Electron 主进程持有操作系统、网络和凭据能力，Vue 渲染进程仅经由严格限定的 typed preload API 访问这些能力。搜索逻辑、搜索平台、收藏夹、AI 翻译和本地持久化分为独立模块，避免业务规则堆进 Vue 页面或 Electron 主入口。

**Tech Stack:** Electron, Vue 3, TypeScript, Vite, electron-builder, pinyin-pro（或在依赖选择时确认等效拼音库），Electron safeStorage。

**Spec:** `docs/superpowers/specs/2026-09-25-windows-launcher-design.md`

## Global Constraints

- 目标平台仅为 Windows。
- Vue 渲染进程启用 `contextIsolation` 并关闭 `nodeIntegration`。
- 文件系统、启动程序、打开网页、网络请求和密钥存取只能由主进程完成，并通过最小化 typed preload API 暴露。
- 不实现通用插件市场；仅保留翻译能力的轻量扩展边界。
- AI 使用 OpenAI Chat Completions 兼容 API，可配置 base URL、模型名和 API Key，以支持 OpenAI 与 DeepSeek。
- API Key 不得写入普通设置文件或输出到日志。
- 网页搜索前缀固定为 `?`；支持 Google、百度、Bilibili，默认 Google。
- 本地应用目录第一版来源为用户和公共 Windows 开始菜单的 `.lnk` 快捷方式。
- 收藏 favicon 请求仅允许 HTTP/HTTPS，必须有超时和响应大小限制；失败不能阻止收藏。
- 不添加或运行自动化测试；按用户要求构建实现，完成后报告具体构建和手动检查结果。

## Review Focus

- 非常规中文应用名只匹配完整拼音：在拼音索引生成时覆盖汉字、多音字库默认读音、空白和标点规范化，并在最终运行时手动检查完整拼音与首字母检索。
- 快捷方式目标被移动或不可执行：启动失败时显示可读错误并保留可用目录结果，手动检查一个有效与一个失效快捷方式。
- 搜索 URL 参数编码或搜索前缀为空：每个平台都通过实现内审查和手动运行检查确认 URL 编码，`?` 单独输入不跳转。
- favicon 重定向到非 HTTP(S)、超时或返回大文件：抓取器验证最终 URL、限制超时/字节并回退首字母，手动检查有图标和不可达网站。
- AI 配置缺失、API 返回错误或密钥不可用：返回脱敏、可读错误且不记录密钥，手动检查未配置提示和有效服务调用。

---

### Task 1: Electron + Vue 项目脚手架与安全窗口

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `electron.vite.config.ts`（若选用 electron-vite）
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/styles/tokens.css`
- Create: `src/types/electron.d.ts`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- `window.desktop` 只暴露 `getVersion(): Promise<string>` 作为初始 IPC 示例；所有后续功能沿用该边界。
- 主窗口配置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，并使用本地 preload。

- [ ] **Step 1: 建立依赖与开发脚本**

定义 `dev`、`build`、`typecheck`、`package:win` 命令，添加 Vue、TypeScript、Vite、Electron、构建工具所需的依赖和 Windows 安装包配置。

- [ ] **Step 2: 建立最小主进程、preload 和 Vue 页面**

主进程创建固定尺寸、适合键盘操作的窗口；preload 暴露 typed `getVersion`；Vue 显示启动器基础布局和版本信息。

- [ ] **Step 3: 设定窗口安全策略和基础主题**

采用暗色桌面工具视觉、清晰焦点态和可读中文排版；将 Electron 安全开关设为约束并避免 renderer Node 权限。

- [ ] **Step 4: 补齐运行说明并构建桌面包**

README 记录 Windows 开发启动、构建和打包命令；运行 typecheck 和生产构建，修正脚手架问题。

### Task 2: 领域类型、本地仓库与安全 IPC 契约

**Files:**
- Create: `src/shared/domain.ts`
- Create: `src/shared/ipc.ts`
- Create: `electron/services/data-store.ts`
- Create: `electron/services/secret-store.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`

**Interfaces:**
- `AppEntry = { id: string; name: string; targetPath: string; sourcePath: string }`
- `WebEntry = { id: string; name: string; url: string; description?: string }`
- `ToolEntry = { id: string; name: string; command: string; description?: string }`
- `BookmarkFolder = { id: string; name: string; createdAt: number }`
- `Bookmark = { id: string; folderId: string; title: string; url: string; favicon?: string; createdAt: number }`
- `AppSettings = { defaultSearchProvider: 'google' | 'baidu' | 'bilibili'; aiBaseUrl: string; aiModel: string }`
- Renderer-safe settings omit secret values; secret store exposes `getSecret(key): Promise<string | null>` and `setSecret(key, value): Promise<void>` only to main-process services.
- `window.desktop` IPC methods and request/response payloads are all declared in `src/shared/ipc.ts` and mirrored in preload typings.

- [ ] **Step 1: 定义领域类型与 IPC 类型映射**

建立应用、网址、工具、收藏夹、收藏、设置及 IPC 请求结果类型；所有失败采用 `{ ok: false; error: { code: string; message: string } }`，不发送堆栈或敏感配置到 renderer。

- [ ] **Step 2: 实现 userData 本地仓库**

将数据存为带版本号的 JSON 文件于 `app.getPath('userData')`；加载时校验与默认值合并，写入时用临时文件加原子替换，损坏数据时备份损坏文件并恢复空默认数据。

- [ ] **Step 3: 实现主进程密钥存取**

用 `safeStorage` 加密 AI key 后存入 userData 独立密钥文件；检测加密不可用时不以明文降级，返回设置密钥不可用的可读错误。

- [ ] **Step 4: 接线最小化 preload API**

为每个 API 使用固定 IPC channel 名称和参数校验；preload 不暴露通用 `send`/`invoke`，渲染端类型与实现一致。

### Task 3: Windows 开始菜单扫描、拼音搜索与应用启动

**Files:**
- Create: `electron/services/app-catalog.ts`
- Create: `electron/services/app-launcher.ts`
- Create: `src/shared/search.ts`
- Create: `src/shared/pinyin-index.ts`
- Create: `src/features/search/SearchView.vue`
- Create: `src/features/search/SearchResult.vue`
- Create: `src/features/search/useSearch.ts`
- Modify: `src/App.vue`
- Modify: `src/shared/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- `scanStartMenuApps(): Promise<AppEntry[]>` reads user and public Start Menu `Programs` folders, resolves `.lnk` targets, skips per-file failures and de-duplicates by normalized target path.
- `launchApp(id: string): Promise<IpcResult<void>>` accepts a catalog ID only; main process resolves it from the latest scanned catalog before launching.
- `buildSearchIndex(entries): SearchIndex` stores normalized display name, full pinyin and pinyin initials for app entries.
- `searchEntries(query, entries, index): SearchResult[]` returns stable ranked results by exact name, prefix, substring, full pinyin and initials.

- [ ] **Step 1: Implement Start Menu shortcut discovery**

Find per-user and common Start Menu folders with Windows known-folder paths, recurse through `.lnk` files, resolve shortcut target/arguments in main process, tolerate inaccessible files, and merge duplicate targets.

- [ ] **Step 2: Implement app catalog refresh and constrained launch**

Keep an in-memory ID-to-target catalog refreshed on app start and explicit refresh. Launch by catalog ID using the OS shell; never accept an arbitrary renderer-supplied executable path.

- [ ] **Step 3: Implement searchable pinyin index and ranking**

Normalize case, spaces and punctuation; generate complete pinyin and initials for Chinese app names. Search display names, pinyin and initial strings; preserve deterministic order on equal scores.

- [ ] **Step 4: Build keyboard-first search screen**

Create focus-on-open search input, grouped result rows, Up/Down selection, Enter activation, Escape behavior and refresh affordance. Show type/name/subtitle for each result.

- [ ] **Step 5: Connect apps and verify Windows behavior manually**

Wire IPC and perform manual checks for installed Start Menu apps, Chinese full-pinyin query, initials query, no-result query, app launch and unavailable target feedback.

### Task 4: Website search providers, saved websites and tools

**Files:**
- Create: `src/shared/search-command.ts`
- Create: `src/shared/search-providers.ts`
- Create: `electron/services/external-opener.ts`
- Create: `src/features/entries/EntriesView.vue`
- Create: `src/features/entries/EntryEditor.vue`
- Create: `src/features/settings/SettingsView.vue`
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `electron/services/data-store.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/App.vue`

**Interfaces:**
- `parseSearchCommand(raw: string): { mode: 'local'; query: string } | { mode: 'web'; query: string }`; `?` alone yields empty web query and cannot be executed.
- `buildSearchUrl(provider: SearchProvider, query: string): string` returns an allowlisted HTTPS URL for Google, Baidu or Bilibili.
- `openExternalUrl(url: string): Promise<IpcResult<void>>` accepts validated HTTP(S) URLs and opens them through Electron shell.
- `window.desktop.entries` provides list/save/delete for `WebEntry` and `ToolEntry`; `window.desktop.settings` provides safe nonsecret settings get/update.

- [ ] **Step 1: Implement `?` command parser and provider URL builders**

Treat leading `?` as web search, trim the query and reject empty queries. Build HTTPS URLs using `URL`/`URLSearchParams`, with provider-specific query parameters and encoded search text.

- [ ] **Step 2: Implement validated external URL opening**

Parse URLs in main process, allow only HTTP and HTTPS, reject other protocols and open through Electron shell; send structured errors to renderer.

- [ ] **Step 3: Implement persistent website/tool CRUD**

Validate names, commands and URLs; generate stable unique IDs; persist through data-store; list, add, update and delete records.

- [ ] **Step 4: Add settings provider selector and management screens**

Add default-provider selector for Google/Baidu/Bilibili; add website/tool list forms. Include website records in search indexing and Enter activation.

- [ ] **Step 5: Connect command mode and perform manual URL checks**

When raw input starts `?`, show search mode, selected platform and query; on Enter call external opener. Manually inspect each generated platform URL including spaces, Chinese text, ampersands and empty query.

### Task 5: Bookmark folders and website favicon handling

**Files:**
- Create: `electron/services/bookmark-service.ts`
- Create: `electron/services/favicon-fetcher.ts`
- Create: `src/features/bookmarks/BookmarksView.vue`
- Create: `src/features/bookmarks/BookmarkFolderList.vue`
- Create: `src/features/bookmarks/BookmarkDialog.vue`
- Create: `src/features/bookmarks/Favicon.vue`
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `electron/services/data-store.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/features/search/SearchResult.vue`
- Modify: `src/App.vue`

**Interfaces:**
- `listBookmarkFolders(): Promise<BookmarkFolder[]>`
- `saveBookmarkFolder(input: { id?: string; name: string }): Promise<BookmarkFolder>`
- `deleteBookmarkFolder(folderId: string): Promise<void>`
- `addBookmark(input: { folderId: string; title?: string; url: string }): Promise<Bookmark>`
- `listBookmarks(folderId: string): Promise<Bookmark[]>`
- `deleteBookmark(bookmarkId: string): Promise<void>`
- `fetchFavicon(siteUrl: URL): Promise<{ dataUrl?: string; fallbackInitial: string }>`; it only returns a validated local data URL or fallback initial.

- [ ] **Step 1: Implement favicon retrieval with safe resource bounds**

Request candidate page using bounded timeout and response bytes; parse declared icon link and try same-origin `/favicon.ico` fallback. Follow redirects only while scheme remains HTTP(S), reject unsupported image MIME types and oversized files, convert accepted image bytes to a local data URL, and never execute page content.

- [ ] **Step 2: Implement bookmark/folder persistence and domain initial fallback**

Create, rename and delete folders; add/remove bookmarks; deleting a folder removes its contained bookmarks after UI confirmation. Derive fallback initial from normalized hostname's first alphanumeric character, uppercased, or `?` when no usable character exists. Store favicon result along with bookmark.

- [ ] **Step 3: Add `+` action to web result rows**

Show `+` on website search results, prompt for an existing folder or create a folder, and call add bookmark. Add bookmark by pasted URL from the bookmark screen as well.

- [ ] **Step 4: Build bookmark management UI**

List folders and their bookmarks; show favicon data URLs or initial fallback, open saved links, create/rename/delete folders and remove bookmarks. Ask for confirmation before destructive folder/bookmark removal.

- [ ] **Step 5: Verify favicon and bookmark behavior manually**

Check a site with favicon, a site without a favicon, invalid URL, unreachable host, slow response, and persistence after restarting the app. Confirm bookmark creation succeeds when icon retrieval fails.

### Task 6: Google Translate web handoff and AI translation

**Files:**
- Create: `electron/services/ai-translation.ts`
- Create: `electron/services/google-translate.ts`
- Create: `src/features/translate/TranslateView.vue`
- Create: `src/features/translate/TranslationSettings.vue`
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `electron/services/secret-store.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/services/data-store.ts`
- Modify: `src/App.vue`

**Interfaces:**
- `translateWithAi(input: { text: string; targetLanguage: string }): Promise<IpcResult<{ translation: string }>>`
- `testAiConnection(): Promise<IpcResult<{ model: string }>>`
- `saveAiSecret(apiKey: string): Promise<IpcResult<void>>`
- `openGoogleTranslate(input: { text: string; targetLanguage: string }): Promise<IpcResult<void>>`
- AI configuration (`baseUrl`, `model`) is nonsecret settings; API key remains main-process-only and is accessed through secret-store.

- [ ] **Step 1: Implement OpenAI Chat Completions-compatible client**

Validate base URL is HTTPS except loopback development addresses, append `/chat/completions` only when not already present, send configured model and translation prompt, apply request timeout, parse response choices, and map provider errors to concise sanitized messages.

- [ ] **Step 2: Implement secret setup and connection test**

Save API key only via secret-store, ensure request authorization header is never logged, send a small connection probe, and handle missing safeStorage/key/model/base URL without throwing uncaught errors.

- [ ] **Step 3: Implement Google Translate URL handoff**

Create a `translate.google.com` URL with encoded source text and target language and open using the validated external opener.

- [ ] **Step 4: Build translation page and settings**

Provide source textarea, target language selector, AI translate action, result display/copy, Google Translate action, and configuration fields for base URL/model/key with connection test status.

- [ ] **Step 5: Perform provider and privacy manual checks**

Check missing credentials feedback, malformed URL, network timeout, provider HTTP error, successful configured OpenAI-compatible request, DeepSeek base URL/model configuration, Google Translate handoff and logs for secret redaction.

### Task 7: Integration polish and Windows packaging

**Files:**
- Modify: `src/App.vue`
- Modify: `src/styles/tokens.css`
- Modify: `electron/main.ts`
- Modify: `package.json`
- Modify: `README.md`
- Create: `resources/app.ico` (or generate from a checked-in SVG source)

- [ ] **Step 1: Integrate navigation and global keyboard behavior**

Ensure navigation switches among search, bookmarks, entries, translation and settings without losing saved content; focus search entry on opening the app and keep keyboard operations predictable.

- [ ] **Step 2: Apply consistent loading, empty, error and success states**

Give scan, save, icon fetch and translation actions visible progress/feedback; preserve valid data when a secondary network task fails.

- [ ] **Step 3: Configure Windows installer and app identity**

Set product name, app ID, icon, installer target, shortcuts and output directories; do not require admin privileges for per-user install.

- [ ] **Step 4: Run final typecheck and Windows production packaging**

Run configured `typecheck`, production build and Windows package command. Perform a final manual pass for app launch, search modes, CRUD, bookmarks, favicon fallback, translation and persistent settings; report commands and observed results.

## Self-review checklist

- Spec coverage: Tasks 1–7 implement each architecture boundary, data flow, error mode, UI flow and acceptance criterion.
- Placeholder scan: all steps specify concrete modules, behavior and commands; no TBD/TODO remains.
- Interface consistency: domain types are introduced before consumers; IPC contract is centralized and extended across subsequent tasks.
- Review Focus coverage: manual checks are assigned to Tasks 3–6 for each listed failure class.
