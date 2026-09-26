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
- `ToolEntry = { id: string; name: string; command: string; descri