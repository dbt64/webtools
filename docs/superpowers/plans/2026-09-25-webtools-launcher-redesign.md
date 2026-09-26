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
- 新建 `electron/services/everything-client.ts`：检测并调用 `es