# WebTools Native Launcher Phase 4A：架构与行为等价性审计

审计日期：2026-09-28
审计范围：当前工作树中的实际实现与后续 Native Launcher 迁移设计。
阶段边界：本报告只提供审计和架构建议；没有修改产品代码、依赖或数据结构，也没有进入 Phase 4B。

> 当前工作树含有 Phase 1–3 的未提交代码与审计文档。结论基于该工作树，不代表干净的 HEAD。用户提供的 Electron Launcher idle 98–105 MB、搜索后约 120 MB 是已有实测基线，本阶段没有重新测量。

## 1. Executive Summary

当前 WebTools 是一个单 Electron 主进程应用，最多有两个独立的 BrowserWindow：常驻、隐藏任务栏的 Launcher 和按需显示的 Manager。每个窗口各自有 WebContents、preload 和 Vue Renderer；Tray、全局快捷键、DataStore、应用目录、Everything、翻译和 AI 服务目前均由同一个 Electron Main 管理。Manager 关闭会销毁它的窗口和 Renderer，但 Launcher、Electron Main、Tray 仍然驻留。因此现状不符合目标中的“Electron process group 在 Manager 关闭后完全退出”。

目标路线建议采用并行迁移：现有 Electron Launcher 保留为可运行回退版本和行为参照；Phase 4B 先验证一个无真实搜索的 WPF .NET 10 LTS 原生窗口 PoC；通过门槛后再迁移搜索和功能。推荐 Native Host 单进程同时承载 WPF Launcher、托盘、热键和搜索服务，按需启动 Electron Manager；Manager 窗口关闭后 Electron 进程组退出。此建议需由 Phase 4B 实测验证，不能从框架宣传或 bundle 体积推算内存收益。

最大迁移风险不是把匹配函数翻译成 C#，而是保持拼音索引、排序、别名与记忆排序、命令行为和结果操作的精确兼容，同时解决 Launcher 与 Manager 的数据单一所有权、IPC 版本/崩溃恢复及启动时序。不要一次性替换 Launcher，也不要在 Phase 4A 改写搜索算法。

建议结论：**进入 Phase 4B 最小 UI PoC，不进入完整移植。** 当前机器没有 .NET SDK，Phase 4A 没有生成或运行任何 C# 程序；PoC 的实现与测量需要有 .NET SDK 的 Windows 开发环境。

## 2. Current Launcher Architecture

### 2.1 实际进程和窗口模型

    WebTools Electron Main（唯一 Electron 主进程）
    ├── Tray / GlobalHotkeyService
    ├── DataStore / SecretStore / AppCatalogService / LauncherDataService
    ├── EverythingClient / AppLauncher / WebsiteService
    ├── TranslationService / SharedAIService / AI credential adapters
    ├── Launcher BrowserWindow
    │   ├── Launcher WebContents + preload
    │   └── Launcher Vue Renderer（launcher.html / LauncherView）
    └── Manager BrowserWindow（未创建时为 0）
        ├── Manager WebContents + preload
        └── Manager Vue Renderer（index.html / App.vue）

项目没有使用 BrowserView。一个 Electron 实例至多创建 2 个 BrowserWindow、2 个对应的 WebContents/Renderer；Renderer 还会由 Chromium 使用的 GPU、Utility 等进程支持，实际子进程数由 Electron/Chromium 决定。Launcher 与 Manager 不是同一个 Renderer。冷启动参数 --hidden 用于登录启动路径；该启动初始只保留 Launcher，普通启动还会打开 Manager。Main 初始化当前服务和应用目录后继续驻留；window-all-closed 是 no-op。

createLauncherWindow() 创建 Launcher 一次并复用；hide 时不是销毁或 BrowserWindow.hide，而是保存 bounds 后把窗口移至 (-32000, -32000)、blur 并通知 Renderer。窗口和 Renderer 会继续驻留。Manager 关闭时拦截 close 并调用 destroy()；closed 回调重置翻译 readiness、取消活动 AI 请求并清空 Manager 引用，Manager Renderer 可释放，但 Electron Main 和 Launcher 仍在。Tray 退出菜单才会触发 app.quit 并释放进程。before-quit 释放快捷键与 Tray。

Main 没有 Manager hide IPC/显式 hideManager 路径；Manager 的窗口关闭路径会 destroy。系统最小化等非应用代码控制状态仍会保留 Manager BrowserWindow/Renderer；当前 app.activate 与 showManager 会重新显示它。启动时 DataStore、SecretStore、AI credentials、SharedAIService、TranslationService、AppCatalog、Everything、Website 服务均在 Main 侧建立；并在创建热键/Launcher 前 await appCatalog.refresh()。这解释了为什么“Launcher Renderer 独立”并不等于“Electron Main 仅承载 Launcher 所需服务”。

| 状态 | BrowserWindow / Renderer | 说明 |
|---|---:|---|
| 登录隐藏启动，Manager 未开 | 1 / 1 | Launcher 已建且在屏幕外；Electron Main/Tray 常驻 |
| 普通启动、Manager 打开 | 2 / 2 | Launcher 加 Manager |
| Manager 关闭 | 1 / 1 | Manager destroy；Launcher Renderer 没有销毁 |
| Tray 完全退出 | 0 / 0 | Electron app quit |

证据位置：electron/main.ts 的 createWindow、createLauncherWindow、hideLauncher、showManager、window-all-closed 与 before-quit（约第 50–115、190–240、350–445 行）。

当前技术栈为 Vue 3.5.43、Electron 44.4.5、electron-vite 5、electron-builder 26.15.3；Windows 目标是 electron-builder NSIS、per-user 安装。项目没有 C# solution/project，也没有自动更新器依赖。原生 Native Host 的进程启动、安装与升级要与当前 WebTools.exe NSIS 安装形态兼容，但 Phase 4B 不改 installer。

### 2.2 Launcher Behavior Contract

该契约是 Native Launcher 的参考行为，不要求复制 Electron 内部实现。

| 行为/配置 | 当前实现 | Native parity 要求 |
|---|---|---|
| 默认大小 | 850 × 128；不可 resize；无 OS frame，transparent，type 为 toolbar，置顶，跳过任务栏，透明背景 | 无边框、置顶、任务栏行为和紧凑初始尺寸一致；测试 Win11 桌面合成效果 |
| 后台策略 | backgroundThrottling 为 false；为了避免 Windows 透明窗 show/hide 淡入，窗口保持可见但移至屏幕外 | 不照搬 offscreen 策略；Native 显示/隐藏须无淡入、白闪、延迟和焦点跳变 |
| 创建时点 | 首次显示请求时创建并加载 Renderer；随后复用 | Native Host 启动时可直接创建轻量窗口或延迟创建；由 PoC 对比首次热键时延 |
| 初始位置 | 鼠标所在显示器 work area，水平居中、垂直约 18%；之后复用上次 bounds | 多屏坐标、任务栏 work area 与 DPI 缩放一致 |
| 显示/焦点 | 收到全局热键后恢复 bounds、调整高度、等待 Renderer ready 与当前 generation acknowledgement，再 focus | 热键后稳定显示并聚焦输入；不可要求第二次热键 |
| focusable / shadow | BrowserWindow 没有显式设置 focusable 或 hasShadow，采用 Electron/Windows 默认行为；必须记录为待测而不是假定关闭 | 对照 Windows 实际默认外观；显式配置 Native 可控项并测 Win11 compositor |
| 隐藏 | Escape、失焦、再次热键 toggle、成功打开结果等路径隐藏；Main 将窗口 park 到屏幕外，并发送 generation 化 hidden 事件 | ESC/失焦/切换行为一致；Native 无陈旧状态竞态 |
| 连续 toggle | Main 以 queued shouldShow intent 合并显示/隐藏操作，visibility generation 与 Renderer ack 防首次显示 race | 保持快速反复按键最终状态正确；Native 不必照搬协议 |
| 热键 | 默认 Control+Alt+Space，由设置持久化；替换时先注册新键，冲突不丢旧键 | 默认值、可配置、冲突提示/回退契约一致 |
| 拖动 | Renderer pointer 事件计算 delta，IPC 通知 Main 移动窗口；输入框选中文字不应被拖动吞掉 | 空白区域和输入区域可拖动；输入、选择、点击不被误判 |
| 紧凑/展开 | Compact 高 128；Expanded 基础 326；展开额外高度最多 300；有搜索结果时展开高度 466；窗口范围按当前显示器 work area clamp | 内容和高度规则可用行为测试固化，不必保留布局实现 |
| 失焦 | Window blur 调用 hide | 点击外部窗口/桌面即隐藏；内部正常操作不触发外部失焦逻辑 |
| 第一次热键 | LauncherVisibilitySequence、Renderer readiness 与 ack；修复过首次 show race | 必须通过冷启动后第一次按键测试 |

多显示器位置选择有实现依据（鼠标坐标定位显示器、work area 限制），但混合 DPI、动态更改显示器布局、热插拔后的视觉正确性需要实际 Windows 验证；当前静态审计不声称已验证。窗口参数位于 electron/main.ts 的 createLauncherWindow，位置与大小逻辑位于 showLauncher / resizeLauncher，drag 和快捷键 IPC 由 window handlers 连接。

### 2.3 Launcher UI Feature Inventory

| 功能 | 当前实现 / 状态持有者 | 数据来源 | 迁移难度 | 必须保持的行为 |
|---|---|---|---|---|
| 输入框、输入焦点 | Launcher Vue Renderer，query 为组件临时状态 | 用户键盘 | 中：Windows 原生 TextBox/IME | 热键显示即聚焦；中英文输入与清空逻辑 |
| Compact / Expanded | Renderer 显示网站与应用入口；Manager 设置保存 compact/expanded 默认值 | Main 配置/轻量 DTO | 低至中 | 默认模式和展开/收起、窗口 resize 协议 |
| 结果选择与键盘导航 | Launcher Renderer selected index，ArrowUp/Down 循环，Enter 激活 | 搜索结果 | 中 | 行顺序、回绕、当前选中滚动、点击 |
| 应用结果 | Main catalog DTO + Renderer 渲染 | Start Menu、桌面快捷方式、App Paths、Start Apps、系统应用 | 高 | 匹配顺序、别名、稳定 ID、真实启动 action |
| 应用图标 | Main 只对可见结果调用 app.getFileIcon；数据 URL 回 Renderer；按 catalog ID 缓存 | .lnk、目标 exe、系统路径；AUMID 失败回退通用图标 | 中 | 懒加载、错误回退、快速输入时不串图 |
| 收藏网站/图标 | Main 提供 lightweight WebsiteSearchEntry；Renderer 维护 query 和可见 icon state；网站 favicon 是 base64 持久化数据 | DataStore 网站记录 | 中 | 普通 local 混合搜索、/ 专用网站搜索、点击按 ID 打开 |
| Everything 文件结果 | Main 执行 ES CLI；Renderer 只见结果 ID、名称、位置标签、类型 | Everything index + Main 内的 opaque ID→path 映射 | 高 | file: 命令、选中启动、路径不传 Renderer |
| Web 搜索 action | Renderer 识别 ? 模式，Main 使用已选模板构建并 external open | Search engine settings | 低 | 查询编码与所选引擎一致，Renderer 不任意构造网址 |
| Translation action | 本地纯文本模式下附加一个翻译 action；Main queue 转交 Manager | 原 query 精确文本 | 中 | 键盘/鼠标可选、latest-wins handoff |
| App usage memory | Launcher query 的成功 launch 后记录；DataStore 保留最近最多 100 个归一化 query 映射 | DataStore appSearchMemory | 中 | 用户选择后同 query 将所选 app 提升 |
| Empty/loading/error | Renderer 状态与 Main IPC 返回值 | IPC、应用目录/Everything/Manager | 低 | 失败不隐藏有效结果；操作错误有可见反馈 |
| 拖动/Logo/Bookmark 对话框 | Renderer 控件加窗口 IPC；收藏对话框属于 Launcher UI | preload bridge / Manager website data | 中 | 不影响输入和点击、logo 打开 Manager、数据写入统一 |
| 主题/焦点/动效 | shared theme 设置与 Launcher focus/blur | DataStore + matchMedia | 中 | Light/Dark/System 跟随和无淡入窗口效果 |

Launcher 渲染入口独立于 Manager App.vue，但仍是 Vue + Lucide + shared CSS，并且通过共享搜索模块引入 pinyin 逻辑。它不挂载 Manager 页面或 Translation UI；Translation/AI 的 service 初始化仍在 Main，所以 Launcher window 轻，但当前 Electron Main 不是 Launcher 专属轻量进程。

## 3. Search Feature Contract

### 3.1 Search Dependency Graph

以下依赖图按当前运行时调用链绘制，而不是按文件名推测。

    LauncherView query
      → parseSearchCommand（共享纯逻辑）
      → local / saved-websites / web / files
      → local / saved-websites: searchLauncherEntriesLazy
      → shared search index（Map<catalog ID, normalized fields + pinyin>）
      → searchEntries: score then stable name sort
      → app + website union（local）或 website only（/）
      → app remembered-result promotion（仅 local）
      → 8 行上限
      → discriminated LauncherAction
      → application / website / file / translation handler

    web (?) → selected engine template → Main openSearch → shell.openExternal
    files (file:) → Renderer IPC → Main EverythingClient → es.exe → opaque result ID → Main validates/opens path
    translation → Launcher IPC → Main prefill queue → Manager Renderer → TranslateView

纯逻辑主要位于 src/shared/search-command.ts、search-normalization.ts、pinyin-index.ts、search.ts、app-search-memory.ts 和 features/search/launcher-results.ts。Vue 只负责输入、可见状态、选择与渲染；preload 通过 contextBridge 暴露明确 API；Main 承担 Windows 发现、启动、图标、Everything、外链、持久化与翻译 handoff。DataStore 是配置与网站数据的持久 owner。pinyin-pro 是索引构建依赖；Lucide 是 UI icon 依赖；Electron IPC 是 action 边界。

### 3.2 当前真实的输入到结果路径与 Query modes

| 输入示例 | 当前解析 | 搜索/执行行为 | native 等价要求 |
|---|---|---|---|
| visual / idm | local | app 与保存网站混合搜索，共用前 8 条；应用记忆可提升 app | 完全保留 |
| 文件 | local | 中文 name/alias；拼音由 pinyin-pro 索引支持 | 中文匹配、排序一致 |
| wenjian / wja | local | 全拼 / 拼音首字母 | 搜索词典的差异必须 fixture 化 |
| vsc | local | 多单词名称首字母匹配 | 保留 token-initial 与排序 |
| handbook | local | 网站 name、URL alias 与 description 可命中 | 普通查询仍可命中网站 |
| /google | saved-websites | 只筛选用户保存的网站；按 name/URL/description 搜索；记忆 app 不参与 | Enter 通过网站 ID 打开 |
| ?search | web | 用当前选择的搜索引擎模板替换 %s，再打开外部浏览器 | 引擎设置、URL 编码与外部打开契约不变 |
| file:notes | files | Everything ES CLI 查询；结果仅暴露 opaque ID 与展示信息 | Renderer 不接触磁盘路径 |
| 空串、仅前缀、空白 | 依各命令解析并可能无结果 | parser 要求前缀出现在 raw 的第一个字符；payload trim | 保留边界语义 |
| /anything（Manager Quick Search） | Manager parser 转为 local | Manager 输入斜线后不会变成 Launcher 网站命令 | Manager 搜索维持原行为 |

截至本审计，slash 前缀只在 Launcher 是 saved-websites；Manager 用 parseManagerSearchCommand 将其转回 local。问号前缀和 file: 在 Manager / Launcher 均有对应模式。

### 3.3 归一化、pinyin、评分

normalizeSearchText 执行 Unicode NFKD、去组合音标、转小写并删除非字母/数字字符。每条索引存储 normalizedName、normalizedText（名称、别名与 searchText）、normalizedAliases、名称 token、fullPinyin 和 initials。pinyin-pro 只用于构建拼音字段。

当前按每个 entry 的首个命中条件分配 rank，随后按 rank 升序、名称 zh-CN localeCompare 排序：0 name exact；1 name prefix；2 name substring；3 alias exact；4 alias prefix；5 query token 对齐名称 token / 首字母；6 full-pinyin prefix；7 full-pinyin substring；8 initials prefix；9 initials substring；10 normalizedText substring。rank 10 命中别名时 match 标为 alias。这里的 fuzzy 是归一化 substring、分词 initials 和拼音命中，不是编辑距离或通用 typo correction。记忆项在 local 结果截断前提升被用户成功打开过的 app；网站模式不应用 app 记忆。

应用目录 ID 是 launch identity 派生的 SHA-256 前 16 个十六进制字符。快捷方式同一个 targetPath + args + cwd 才合并；别名聚合重复 shortcut 名称。网站使用保存 ID。Everything 每次查询为路径生成临时 opaque ID，Main 保留 ID 到路径映射；路径不得成为跨 IPC 的 native result 数据。

### 3.4 Native Search Migration Boundary

| 类别 | 当前职责 | 迁移建议 |
|---|---|---|
| A：可迁移为 C# 纯逻辑 | normalize、rank、候选过滤、记忆提升、结果限额、query parser、action 分类 | 通过共享 JSON parity fixtures 移植；先冻结当前 TS oracle 与排序规则 |
| B：需找 .NET 等价实现 | 中文拼音、Unicode 标准化、区域化排序 | 保留 pinyin-pro 的 fixture 作为行为 oracle；自行构建稳定拼音词典/算法适配层，不依赖系统输入法或模糊推断 |
| C：Windows OS / 工具集成 | Start Menu/桌面 .lnk、App Paths、Start Apps/AUMID、程序图标与启动、快捷键、多显示器、Everything | 移入 Native Host 的 Windows-specific services；沿用现有 typed launch target 语义；Everything 仍以进程参数列表调用 ES |
| D：保留在 Electron Manager | Settings、网站/收藏夹管理 UI、Translation / SharedAI / Provider / SecretStore、Manager Quick Search | Manager 继续由 Electron/Vue 展示；Native 通过窄 IPC 操作或读取数据，不复制 AI/翻译实现 |
| E：可在 Launcher 迁移后删除的 glue | Launcher BrowserWindow/preload API、Launcher Vue entry、Renderer result/icon/search IPC、Launcher visibility generation/resize/drag IPC | 仅 Phase 4E parity 验收后在 Phase 4F 删除；在此之前留作 fallback |

### 3.5 Search Parity Strategy

已有 tests/fixtures/launcher-parity.json 与 src/features/search/launcher-contract.test.mjs 是不错的 oracle 基础：覆盖多个 rank、exact/prefix/substring/alias、大小写与重音归一化、拼音、首字母、网站 URL/description、local 混合、/ 网站筛选、8+1 行与 app-memory 提升。search-command tests 覆盖 Manager 与 Launcher slash 区别、空白和前缀位置；launcher-results tests 覆盖翻译 action 和空索引；Everything 有参数构建测试。

差距：当前 fixtures/test 不充分覆盖真实 Windows catalog 的 shortcut identity/arguments/cwd/AUMID launch，也不对 Electron 与未来 C# pinyin-pro 的全部具体文本做版本化对照。Phase 4C 开始前应在现有 fixture 增补且锁定预期顺序，再由 TS 和 C# 双向消费，禁止分别手写两套结果预期。

建议最小 fixture 行：

| Query | fixture 需要断言的预期 | Action |
|---|---|---|
| visual / VS Code | exact、alias、prefix 候选次序 | launch application ID |
| 文件 | 中文名称首位结果 | launch application |
| wenjian | full-pinyin 结果与 tie break | launch application |
| wja | 拼音 initials 结果 | launch application |
| vsc | 多 token 首字母候选顺序 | launch application |
| handbook | website URL fragment alias 命中 | open website ID |
| /handbook | 只出现 website，完全不混 app | open website ID |
| ?cats & dogs | command mode 和输入文本保真 | 使用设置的 web engine |
| file:notes | command mode；路径留在 owner process | open opaque file result ID |
| mixed query | 多 token、标点和英文/数字组合的 normalize / rank | 依 discriminant 分发 |
| empty / '?' / 'file:' / '/' | 空结果、帮助文案与前缀专用行为 | 无误触发 |
| 同分同名 | 输入顺序稳定，zh-CN sort 规则明确 | launch stable ID |

Phase 4B PoC 不接真实引擎。真实搜索 parity 放在 Phase 4C；fixture 必须记录应用/网站 ID、title/subtitle、rank、match/action kind 与顺序，不记录本机安装路径、快捷方式路径或机密。

### 3.6 Result DTO Contract

建议在 Native Host 边界采用带协议版本的结构化 DTO，不透传 TypeScript/Electron 对象：

| 字段 | 语义与限制 |
|---|---|
| protocolVersion | IPC schema 版本；不匹配时握手失败并返回可诊断版本号 |
| requestId | 请求/响应配对及取消用 ID |
| resultId | 稳定 catalog/site ID；Everything 查询可用本次结果 opaque ID |
| kind | application、website、file、translation 等闭合集合 |
| title / subtitle | Renderer/UI 纯展示文本 |
| matchKind | name、alias、pinyin、initials；可选，仅供一致性提示 |
| iconKey | 稳定资源 key 或空；不要内嵌整个 icon data URL |
| action | closed union：launchApp(appId)、openWebsite(websiteId)、openFile(resultId)、handoffTranslation(text) 等 typed action |
| score/rank | 可选，仅用于 parity diagnostics，UI 不应重新排序 |

禁止：Vue Proxy、BrowserWindow/WebContents、filesystem handle、快捷方式绝对路径、原生指针、任意命令字符串。DTO 附 JSON schema / discriminated union 并设置最大 message、字段长度和允许 action 列表；协议加版本，未来能平滑新增字段。

## 4. App Catalog Ownership

### 4.1 当前实现

electron/services/windows-app-source.ts 在 Windows 上扫描当前用户和公共 Start Menu Programs、app.getPath('desktop') 的 User Desktop 及 PUBLIC Desktop，递归找 .lnk；每条快捷方式独立 try/catch，使用 Electron shell.readShortcutLink 解析 target/args/cwd，并校验目标文件，损坏或不可访问的一条不会中断全目录。扫描还加入 PowerShell Get-StartApps 的 AUMID、HKCU/HKLM/WOW6432Node App Paths，并显式加入文件资源管理器、控制面板、设备管理器及中英别名。

AppCatalogService 生成稳定 catalog ID：AUMID 按 appId 去重；系统应用按类型去重；普通文件按路径去重；shortcut 按 effective invocation 的 targetPath + arguments + cwd 去重，同一启动 invocation 的不同显示名并入 aliases。无 args/cwd 的旧路径 ID 保持 path:<path> 形式。refresh 会清空重建 records 与 icon cache。Main 启动时 await refresh，再注册快捷键和创建 Launcher/Tray，因此冷启动与刷新成本包含 Windows/PowerShell 枚举。

启动 action 是 typed union：shortcut 走 shell.openPath(shortcutPath)，executable 走 shell.openPath(path)，AUMID 用 execFile explorer.exe 参数数组，三种系统 app 通过固定 executable/arguments 用 execFile；不把 query 拼入 shell 命令。

### 4.2 Native ownership 建议

Phase 1 数据缓存边界仍然有效：LauncherDataService 持有 apps/websites 两个 version；Renderer 传入已知版本，只有版本变化时 Main 才回传相应数组；Renderer 的 LauncherSearchIndexCache 比较 app 与 website search fields，只重建变化数据集的索引并重用未变索引。app icons 和 website favicons 都按当前可见 ID 请求。Native migration 应继承这种版本/分域失效语义，而不是每次唤出重载全部数据。

最终 Native Host 应拥有唯一 app catalog、刷新/版本计数、ID、dedup、alias、图标缓存与启动 action。Launcher 从 Host 查询；Electron Manager 通常不需要完整 catalog，除非未来 Manager 明确增加 app management UI。移除 Electron Launcher 后，appCatalog IPC 和 Electron AppCatalogService 可在 Phase 4F 删除。

现有 ID 基于 effective launch identity，未来 Native 迁移需保持相同 ID 派生逻辑，否则应用记忆、可见 icon 请求、选择结果和缓存会断裂。实现时把 canonical identity 定义成带 version 的 typed value，再由兼容层生成当前 SHA256 截断 ID；路径仅在 Host 内部存在。数据同步仅需版本/刷新事件，Manager 不成为第二份 catalog owner。

边界风险：不同 shortcut 相同 target 但参数或 cwd 不同必须保持不同结果；相同 target/args/cwd 不同 shortcut 名称必须合并 aliases。Windows 快捷方式解析失败须逐项隔离。Start Apps/AUMID 真实 icon 当前会失败回通用图标，这是可接受的当前 fallback，但未来原生图标体验需单独验证。

## 5. Website Data Ownership

### 5.1 当前存储事实

DataStore 将 version 2 JSON 存在 Electron userData 下的 nook-data.json（发布目录为 Nook；开发 profile 为 WebTools-Dev）。WebsiteEntry 持有 id、name、url、description、可选 favicon data URL、folderIds、createdAt；launcher DTO 去掉 favicon/description 中不需要的完整项，仅保留搜索需要字段。BookmarkFolder、settings、应用搜索记忆也在同一文件。DataStore 写入通过 promise queue 串行化，并先写 .tmp 后 rename；WebsiteService 是网站增删改的业务入口，Manager renderer 经 IPC 调用 Main。Renderer 没有文件写访问。

此外，secrets.json 独立保存由 Electron safeStorage 加密后的 AI 凭据；SecretStoreCore 也用串行写队列与临时文件 rename。AI key 不应传入 Native Host，也不应随 website JSON 搬运。

### 5.2 推荐单一 owner

建议分阶段采用“Manager/Electron Main 是 website/settings authoritative writer，Native Host 是只读 cache + 通知失效”的 C 路线：

1. Phase 4D Native Host 管 Launcher 查询时，仅通过 named pipe 向按需启动的 Manager/Electron Main 请求 lightweight websites/settings snapshot 和 version。
2. Manager 成功写完原子 DataStore 后发送 websites/settings changed + 新 version；Host 丢弃旧缓存并拉取新 snapshot。
3. Manager 关闭后 Host 保留最后一个有效只读 snapshot，因此 Launcher 仍可用；不需要让 Electron Main 常驻或共享写 JSON。
4. Manager 未启动时新增/改网站不可能发生；Launcher 可继续用最近已知 snapshot，失败时显示上次同步或空结果，不自行写文件。
5. appSearchMemory 是例外：native launcher 需要在 Electron 完全退出时更新使用记忆。进入 Phase 4D 前须选定 owner/migration，推荐将其迁到 Native Host 专属原子 sidecar；首次导入现有 DataStore 值，再由 Host 单写。Electron 如仍提供旧接口，需迁移期禁用写入或明确一次性导入/兼容机制，不能两方反复覆盖整个 JSON。

不建议 Native Host 和 Electron 同时修改同一整份 JSON，也不建议无必要引入共享 SQLite 或双写同步。若后续要允许 Launcher 直接编辑网站，需在架构评审中再将写请求经 IPC 委托给 Manager，或明确单一 Native owner 和一次性迁移；本报告不默认增加这种产品能力。WebsiteEntry schema 在 Phase 4A 不修改。

## 6. Everything Integration

当前链路是 Launcher/Manager Renderer → preload 的 searchEverything → everything:search IPC → Electron Main sender/Manager-only 校验 → EverythingClient → 已配置或自动发现的 ES CLI es.exe → 结果解析与 stat 校验 → Main 生成本次查询 opaque ID，并保存 ID→绝对路径 Map → Renderer 收到 name、locationLabel、kind、id → 用户选择时用 ID 回 Main → Main 再检查路径存在并调用 shell.openPath。

EverythingClient 通过 execFile + 参数数组，不经 shell；按 ES 版本选择 JSON/UTF-8 或 CSV 输出；有 query 长度、输出字节、timeout 和最多结果数限制。每次新搜索递增 sequence；旧异步搜索结束时返回空，避免旧结果覆盖新输入。绝对路径只留在 Main map，Renderer 获得位置标签，不得取得真实文件路径。

Native Host 可通过 ProcessStartInfo.ArgumentList 直接运行同一个 ES CLI；需复用现有 buildEverythingSearchArgs 和输出兼容用例语义，添加 Unicode 路径、中文文件名、参数转义、超时与并发搜索取消 parity。搜索与 path→opaque result 映射在 Host 内。未来 Electron everything:search、openEverything IPC handler 可以在 Phase 4F 从 Launcher 移除；Manager 如仍保留 file 搜索，则其所有权/界面需先决定，当前 Manager Quick Search 不应被悄悄改掉。

## 7. Icon Pipeline

| 图标类别 | 取得方 / 格式 / 当前 cache | Native 建议 |
|---|---|---|
| App | AppCatalogService 按需调用 Electron app.getFileIcon；NativeImage 转 data URL，经 IPC 回 Renderer；以 catalog ID 缓存 Promise；失败、AUMID-only 返回 null | Host 按 app ID 懒加载并持有 Windows bitmap/image cache；WPF 使用 BitmapSource/BitmapImage；避免转成 base64 给 Chromium |
| Website | favicon 抓取由 Main WebsiteMetadataService 执行和验证；base64 data URL 持久化在 WebsiteEntry；Launcher visible-only 获取所需 ID；Renderer Favicon 失败回退 hostname initial | Native WPF 用共享 image source/cache 解码现有 favicon base64；数据仍由 DataStore authoritative owner提供 |
| File | 当前 Launcher 使用 Folder/File 通用 Lucide icon，无 per-file OS icon 获取 | PoC 不做文件图标；后续决定是否用 Shell icon API，并按需加载；不得直接暴露 shell handles |
| Brand | Electron resources 下 PNG/ICO 用于窗口、Tray 等 | 原生安装包沿用正式 Logo 的 ICO/PNG 资源，保持资源源文件唯一并验证浅/深场景 |

图标不可读取时使用通用图标，不得阻塞列表搜索。Native 搜索只向可见行发 icon request，缓存 keyed by resultId，必须以 generation/current-ID 约束异步返回，避免快速输入时旧图标串到新结果。Native 内存占用需包含真实可见图标前后对照。

## 8. Translation Handoff

### 8.1 当前链路与正确性保证

当前路径：Launcher 的 translation action → Main 校验 sender 是当前 Launcher main frame、文本非空且不超过 20,000 字符 → TranslationPrefillQueue 接收 UUID request（latest wins）→ create/show Manager → Manager App.vue mounted 发送 ready → Main 发 pending request → Vue 切到 translate section、nextTick 后发送 matching request acknowledgement → Main 只清除 ID 一致的 pending request。Manager 新建、未 ready、已开、隐藏和 main-frame reload 有 readiness reset/重投递保护。Manager destroy 时取消当前 TranslationService / AI 连接测试。

TranslateView 对新 prefill 更新 sourceText，并通过 request gate 使旧异步响应失效。sourceText 变化以及 prefill watcher 都会调用 scheduleAutoTranslate；provider 已配置时约 450ms 后自动翻译，这是当前 Manager 的已实现交互。Phase 4A handoff 要求精确预填及可靠 ack，但没有要求抑制此行为；迁移默认应保留当前自动翻译交互。Phase 4D 应验证 handoff 后能正确触发一次当前配置 provider 的自动翻译、旧响应不会覆盖新输入；不要把旧“只预填”描述当成当前产品行为。

### 8.2 Native / Manager 新握手

Native Host 先确保 Manager Electron 进程启动，再通过命名管道握手 protocolVersion；Manager ready 不能由 BrowserWindow ready-to-show 替代，必须等 App.vue mounted/translation receiver 注册后发送 renderer-ready。Host 每次 handoff 生成 requestId、保存 latest pending request、携带精确原文本；Manager 对请求做 sender/长度校验、更新页面并在状态更新后 ack 同一 requestId。只有 Host 收到当前 Manager session 且 ID 相同的 ack 才清 pending。新请求替换尚未确认的旧请求。Manager reload 后发新的 renderer-ready，由 Host 重投 pending。重连/Manager crash 时保留至超时或用户关闭，并提供可观测错误，不默默丢请求。

推荐使用消息类型区分 launcher handoff 与管理命令，文本长度仍由 Main 再校验；不将 API key、翻译 provider 请求或 Native 窗口对象跨边界暴露。Translation、SharedAIService、Provider 与 SecretStore 留在 Electron Manager Main。

## 9. Native ↔ Electron IPC Comparison

Native Host 将作为拥有进程和本机 IPC server；Electron Manager 由 Native Host 按需启动并作为 client 连接。消息为带 protocolVersion、requestId、type、payload 的 JSON DTO；以 4 字节长度前缀 framing，设最大消息长度、连接超时和 request timeout。拒绝未知消息类型，校验每个 payload，所有操作采用 allowlist。

| 传输 | Windows / 安全 | 启动、重连、调试 | 评估 |
|---|---|---|---|
| Named Pipe | Windows 原生支持；可限定当前用户 SID 的 pipe ACL；不暴露 TCP 端口。要检查服务端 ACL、拒绝远程客户端、客户端身份和消息大小 | Native server 可在 Electron 启动前就绪；Manager 重启后重连；适合双向命令/事件；需实现 framing 与协议日志 | **推荐。** 最符合 Native Host 长驻、Manager on-demand、单机权限边界 |
| localhost TCP | 本机可用，但必须处理端口选择、抢占、监听端口扫描、跨用户进程连接与 token/secret；localhost 不等于安全 | 常见工具容易调试；启动时需分配端口和建立认证，重连简单 | 不推荐作为默认；只有后续跨语言/工具生态确有需要再选 |
| stdin/stdout child protocol | 只允许 Host 启动的子进程自然取得管道；单向/双向可实现，但子进程重启后要重建 | 直接绑定 ChildProcess 生命周期，日志与协议输出易冲突；Host 重启/Manager 多实例协调更繁琐 | 适合一次性子命令；不适合长期 UI 请求、状态变更通知与独立 Manager 再连接 |

Windows Named Pipe latency 对本应用的小型本地 JSON 消息不是瓶颈，真实值应在 Phase 4D 测；阶段选择依据主要是生命周期和安全，而不是未经测量的延迟宣称。建议把 Electron 启动作为 Native action，Manager Main 启动后主动连接 pipe；Native Host 不由 Electron 启动，也不受其退出影响。

## 10. Native UI Technology Comparison

以下为基于 Windows 桌面 API 能力和官方部署信息的架构判断；本项目未用任何框架做内存/时延 benchmark，故内存与启动成本均标为 **Unknown，Phase 4B 实测**。

| 技术 | 优势 | 风险/成本 | 建议 |
|---|---|---|---|
| WPF (.NET 10, net10.0-windows) | 成熟桌面窗口模型；无边框/透明/置顶/多屏控制成熟；TextBox、键盘焦点、IME、DataTemplate 和虚拟化成熟；适合一窗轻 UI；XAML 熟悉度和调试资料好 | WPF 不是“零运行时”；self-contained 会携带 runtime；现代 Fluent 样式需自行实现；DPI/透明组合仍需真机测试 | **Phase 4B 首选。** Windows-only、小型 Launcher、精确控制窗口与输入体验，PoC 风险最低 |
| WinUI 3 / Windows App SDK | Microsoft 对新 Windows app 的现代 UI 方案；Fluent controls、主题和系统风格较好 | Windows App SDK 依赖/部署方式、启动/运行时 footprint、窗口无边框/透明、全局热键和旧版本兼容都需验证；引入部署与打包复杂度 | 若用户把原生 Fluent 外观优先级提到性能之前，PoC 再做第二候选；当前不为样式先承担部署风险 |
| WinForms | 小型控制窗口和系统消息集成简单；调试和桌面成熟度高 | 默认控件观感陈旧；复杂搜索结果/定制透明 UI、IME 体验 polish 和视觉主题需要更多自绘 | WPF PoC 无法满足性能门槛时可作为轻量基准候选，不先选作最终 UI |

逐项覆盖需求维度：

| 维度 | WPF | WinUI 3 | WinForms |
|---|---|---|---|
| Idle memory / 冷启动 | Unknown；PoC 测量，不从框架类别估 MB | Unknown；Windows App SDK 依赖也纳入进程组 | Unknown；可作为后续对照 |
| 全局热键 | 可通过 Win32 RegisterHotKey；与窗口 input 需区分 | 同样可接 Win32 | 消息 loop / Win32 集成直接 |
| 透明、无边框、always-on-top | Window API 可控，组合行为必须真机测试 | 可实现，但自定义 title bar/透明与桌面合成需试验 | 可实现，复杂外观需更多手工控制 |
| 多显示器 / DPI | WPF per-monitor DPI API 可用；混合比例需 PoC | Windows app 模型支持，具体窗口 owner 与 work area 需验证 | WinForms per-monitor DPI 支持；缩放自绘列表风险较高 |
| 动画与 show/hide | 可直接控制 Storyboard，也可完全禁用；系统合成可能仍影响呈现 | Fluent 动效齐全，但更难控制为直切 | 可完全不做动画；系统窗口转换仍需检查 |
| 文本、中文 IME、焦点 | TextBox 成熟，必须测试 composition 与热键焦点竞态 | 原生控件支持 IME；无边框焦点恢复仍需实测 | 原生文本框可用；自绘结果不应抢输入法焦点 |
| 键盘导航 / 虚拟化 | Commands、ItemsControl、VirtualizingStackPanel 等成熟 | ItemsRepeater / controls 可用 | 需自行处理 custom list/virtualization |
| 图标、主题 | BitmapSource/ImageSource；theme 可手工映射现有 tokens | Fluent icon/theme 生态最佳 | 自绘或 Win32 icon；主题大多手工维护 |
| Packaging / runtime | self-contained .NET Desktop runtime；Windows-only publish | Windows App SDK deployment/依赖矩阵更复杂 | .NET runtime + WinForms 桌面栈，self-contained 可部署 |
| Windows compatibility / 开发复杂度 | Windows-only 易约束版本；窗口调优中等复杂 | 新平台能力多，但最低版本与 SDK 部署要核实 | API 熟悉、实现简单；满足定制 UI 的总体开发复杂度会上升 |

WPF PoC 必须实际验证 Windows 11 frameless transparent window、DPI、混合显示器、IME composition、focus-stealing policy、always-on-top、blur hide、drag、白闪与 30 次热键开关。WPF 官方文档描述其 Windows 桌面 UI 与窗口 API；WinUI 3 文档与 Windows App SDK deployment 文档用于评估另一方案的框架和部署模型。参见附录官方资料。

## 11. .NET Runtime Strategy

| 发布方式 | 特征 | Phase 4B 建议 |
|---|---|---|
| Framework-dependent | 包小；要求目标机器安装匹配 .NET Desktop Runtime；可用于开发基线 | 可做开发迭代，不适合作为轻薄本/测试机首次安装的唯一交付形态 |
| Self-contained win-x64 | 应用带所需 .NET runtime；部署兼容性可预测，无需用户预装；包更大 | **PoC 默认。** 主要比较启动与 idle 私有字节，不以 installer 大小作为是否通过标准 |
| NativeAOT | 可能减少部署组件，但受 UI 框架支持和反射/XAML 约束 | 暂不用于 WPF PoC。不能假设 WPF NativeAOT/trimming 完全受支持；增加未知构建和运行风险 |

环境检查显示此 Windows 安装了 .NET Host 6.0.2，但没有任何 .NET SDK；现有 runtimes 为 .NET Core 3.1、5.0、6.0（含 WindowsDesktop），已不应作为新产品目标。项目无 .csproj / .sln。Phase 4A 不安装 SDK/runtime。Phase 4B 开始前应在 Windows 开发机安装受支持的 .NET 10 SDK；当前官方支持策略应复核到实施时。计划用 net10.0-windows + self-contained win-x64 发布，后续再对比 framework-dependent；不把 AOT 当作首轮方案。

## 12. Future Process Model

### 12.1 目标进程树

Idle / 已登录自启动：

    WebTools.NativeHost.exe
      ├── WPF Launcher window（同进程）
      ├── Tray / RegisterHotKey / catalog / search / Everything / launch
      └── Named Pipe server

Manager 打开时：

    WebTools.NativeHost.exe
      ├── WPF Launcher / tray / hotkey / pipe
      └── WebTools.exe --manager
          ├── Electron Main + Manager BrowserWindow / Renderer
          └── GPU / Utility 等 Electron 子进程（按 Electron 实际运行情况）

Manager 关闭后，Native Host 收到 Electron child-process tree 退出事件并回到 Idle 单进程状态。需确认 Electron 的 Chromium 子进程均归属/退出；只看 Electron 主 exe 消失不足以验收。WPF Launcher 与 Host 同进程，避免额外 Native Launcher/Host IPC。

### 12.2 责任归属

| 当前 Main 责任 | Phase 4 目标 owner | 迁移时机 / 边界 |
|---|---|---|
| Launcher BrowserWindow、show/hide、blur、resize、drag、visibility ack | Native Host + WPF | Phase 4B dummy window；Phase 4C 搜索；Phase 4F 删除 Electron 实现 |
| globalShortcut / quickSearchShortcut 注册 | Native Host：RegisterHotKey 或经过 Windows 验证的方案 | 保留设置值与冲突语义；不要直接复制 BrowserWindow toggle queue |
| Tray、开机启动、single instance | Native Host | Host 成为唯一常驻进程；处理已有实例转发与登录静默启动 |
| WindowsAppSource、AppCatalogService、AppLauncher、app icons | Native Host | 按 Phase 4C 移植并保持 ID/alias/typed target |
| EverythingClient | Native Host | 移植参数/编码/取消/opaque ID 约束 |
| LauncherDataService、website search snapshot、缓存版本 | Native Host 有只读 snapshot；Manager Main 是网站/settings 写 owner | 通过 pipe 拉取和 invalidation；禁止双写 |
| website CRUD、BookmarkService、WebsiteMetadataService、DataStore | Electron Manager Main | 管理页继续单一持久化；需要 Launcher 编辑的后续需求走 IPC |
| appSearchMemory | Native Host | 单独 sidecar/一次性迁移策略；不可让 Electron 和 Native 同时覆盖 AppData |
| Settings | Electron Main 持久化；Native Host runtime consumer / cache | 热键、主题、display mode等写后通知 Host；是否将少数 launcher setting 转交 Native 持久化另作迁移决策 |
| Manager BrowserWindow、Vue、页面、Settings、Translation | Electron Manager | 按需启动；最后 Manager 窗口关闭后 Electron process group quit |
| TranslationService、SharedAIService、Provider adapters、SecretStore | Electron Manager Main | 仅供 Manager Translation / AI；不迁 Native，不把 secret 交给 Native |
| 现有 IPC handlers / preload | 分拆：Manager IPC 留 Electron；Native pipe protocol 只暴露所需操作 | 迁移完成且旧 Launcher 删除后移除专属 IPC，不扩大 Node renderer 权限 |

Future process control：Native Host 创建并持有 Electron child handle，启动唯一 Manager instance，监视退出码并判断用户正常关闭 vs crash；正常关闭不自动重启，崩溃可由用户再次打开时重启并保留待确认 translation request。Native Host 负责应用退出与单实例激活转发。当前 package.json 使用 electron-builder NSIS，并没有 auto-updater dependency/流程；升级和重启必须由现有安装器/未来明确的 updater 策略统一处理，不能让 Native 与 Electron 各自更新另一方。NativeHost 与 Manager 协议需校验同一产品版本与兼容范围。

## 13. Components That Should Stay Electron

Manager 是单独的 Electron Renderer，App.vue 通过条件渲染在 Search、Entries、Settings、Translate sections 间切换。Settings 用 defineAsyncComponent 做异步加载；页面以 v-if 切换，当前没有 keep-alive 导致所有页面长期挂载。DataStore 与 SecretStore、TranslationService、SharedAIService、provider adapters 都在 Electron Main 初始化，目前即使 Launcher-only 启动也会创建这些服务对象（且 app catalog 会在启动时完整 refresh）。

建议留在 Electron Manager：复杂管理 UI、Settings 页面、网站与收藏夹 CRUD、Translation UI、AI provider 选择与配置、AI credential 安全存储、所有 Translation / SharedAI provider 网络逻辑。Native Host 不应变成第二个巨型 Main，也不应实现 Provider、加密 API key、联网翻译或 Manager 各页面状态。只有 Launcher 真正需要的只读网站/热键/主题数据及翻译 handoff 通过窄协议流动。

**Translation contract discrepancy:** 当前 App.vue 使用 mounted-ready 与 ack；TranslateView 的 prefill watcher 会安排自动翻译（配置 provider 时）。跨 IPC 重做时必须确认要兼容此行为，或为 Launcher handoff 增加“只预填”的来源语义。这是必须在 4D 解决的产品/行为契约，不是 Phase 4A 静态审计可擅自调整的事项。

## 14. Phase 4B Minimal PoC

目标是验证 Native UI 和常驻模型是否可行，**不要接真实搜索、翻译、网站存储、Everything 或 Electron IPC**。

1. 新建独立 WPF .NET 10 Windows 项目及最小 native host，代码暂时不触碰 Electron Main / Renderer。
2. 申请 Windows single-instance mutex；同进程拥有 Window、托盘可先做最小退出 menu、RegisterHotKey 的启动/解除注册。
3. 用无边框、透明、置顶的固定宽度窗口；热键显示、focus 文本框；支持英文和中文 IME 输入。
4. 添加 3 条 dummy result；支持上下箭头、Enter dummy action、ESC hide、blur hide、鼠标拖动；连续 show/hide 30 次。
5. 在用户工作树中保留当前 Electron Launcher 作为对照，生成 self-contained win-x64 PoC；不替换 installer 或自启动入口。
6. 对同一台 Windows 机器、同一电源状态、同一分辨率/DPI重复采样；记录 PoC 与 Electron baseline，而不是混用另一台机器数据。

### Phase 4B 建议实现顺序

| Step | 范围 | 验证 |
|---|---|---|
| B1 | 项目 bootstrap、single instance、退出/异常退出 | 冷启动、多开转发、托盘退出、重复启动 |
| B2 | WPF window、透明/frameless、position/monitor | 白闪、窗体边界、显示器 work area、DPI |
| B3 | RegisterHotKey 与输入焦点 | 30 次热键 toggle、冲突键、首次唤起时延、中文 IME |
| B4 | dummy results / 键盘 / blur / ESC / drag | 输入、导航、鼠标操作、窗口隐藏契约 |
| B5 | release self-contained 构建和重复性能测量 | Native-only 与 Electron 旧版 A/B；无 installer 改动 |

B1–B4 各阶段保留纯 UI PoC；搜索 parity、应用发现、图标、网站存储和 Manager 管道分别属于 4C/4D，避免 PoC 变成半套重写。

## 15. Phase 4B Go / No-Go Metrics

当前只有用户之前提供的 Electron 参考值：idle 98–105 MB，使用一次 Launcher 搜索后约 120 MB。Phase 4A 没有本机 installed build/Task Manager 或 ETW 重新采样，不能给 Native 预测 MB。

建议同机对照采集：

| Metric | 采集要求 |
|---|---|
| Idle memory | 冷启动稳定 30 秒与 10 分钟；记每个 PID private bytes、working set、进程组总量；5 次重启的 median 和 p95 |
| Show / focus latency | 从 OS 热键回调到 window visible 与输入收到焦点；首次及后续各 30 次，记录 median/p95/max |
| Runtime shape | idle 时 Native PID 数；Manager open 时 Electron Main/Renderer/GPU/Utility PID；Manager close 后 Electron PID tree 完全退出 |
| Input behavior | 中文 IME composition、英文键入、焦点、不抢占其他桌面操作 |
| Window behavior | transparent/frameless、无 white flash / fade、置顶、多屏/DPI/位置无跳动 |
| Stability | 快速反复热键、ESC、blur、拖动、连续 30 次切换；无卡死、重复注册、窗口丢焦点 |

**Go:** Native-only idle process group 在同一机器多轮测试中稳定且明显低于 Electron baseline；冷启动首次和重复热键到 focused input 不劣于当前版本；IME、窗口绘制、焦点、透明、显示器和退出流程通过；无持续单调内存增长。
**No-Go / 暂停迁移：** idle 收益不稳定或不明显；热键/首次显示延迟明显变差；出现白闪、输入法、焦点、DPI/多屏问题且短期无法修复；或退出/多开造成残留进程。保留 Electron Launcher 做 fallback，不推进 4C。
**建议先量化“明显”：** 对同机 5 次冷启动的 idle process-group private bytes，建议中位数至少比 Electron idle 对照低 30%，且 Native p95 hotkey-to-focused 不比 Electron p95 慢超过 10%。这两个门槛是建议的预注册验收值，不是已有数据，也可在 PoC 开始前由用户调整。

不要仅用任务管理器的一次 Working Set 数值判泄漏。采样要区分 working set、private bytes、renderer JS heap；PoC 不含 Chromium 时 native 不适用 JS heap。连续 10 分钟和多个 show/hide 循环若走势有平台值，可能是缓存/分配器行为；只有 GC/清理后 private bytes 仍持续增加并能经重复测试复现，才认定泄漏。

## 16. Migration Risks

| 风险 | 等级 | 实际影响 | Phase 4B–4E 的验证/缓解 |
|---|---|---|---|
| 拼音 / initials / normalize / ranking 跨语言偏差 | **High** | 中文多音字、pinyin-pro 词库版本、Unicode 规范化和 zh-CN tie-break 可能让前几项次序不同，用户感觉像漏应用 | 固定 parity fixture、同输入逐项比对 IDs/rank/action；先纯逻辑 oracle 再接 Windows catalog |
| IME composition 与首次焦点 | **High** | Win32 热键后立刻 focus 可能打断中文组合输入；WPF TextBox 的 composition/focus 时序与 Chromium 不同 | PoC 真机测试中文 IME、输入中切窗、快速唤出；记录 first key，不只看窗口出现 |
| 透明无边框、blur hide、多屏 / DPI | **High** | Win11 compositor、置顶、焦点和显示器变更可能引入白闪、动画、窗口出界或失焦即关 | WPF PoC 覆盖 100/125/150/200% DPI、双屏不同缩放、Win+Tab/桌面点击、拖动 |
| Electron Manager 进程完全退出 | **High** | Electron 当前为 tray 常驻；简单销毁 Manager window 不会结束 main、Launcher 或 Electron children | Manager-only 命令行模式；closed 后没有 window/tray/hotkey 等保活资源时 app.quit；用 PID tree 验证 GPU/Utility 子进程全退出 |
| website/settings 与 Launcher 数据同步 / 应用记忆 | **High** | 共享整份 JSON 双写可能覆盖用户网址、设置或旧 schema；Native 无 Electron 时仍需记搜索记忆 | Manager Main 单写网站/设置；Native snapshot/version 更新；appSearchMemory 单独所有者和原子 sidecar迁移 |
| Pipe protocol / Manager readiness / reload | **High** | Manager 启动慢、renderer reload、Host/Manager 任一崩溃或版本错配可能导致 translation prefill 丢失或错误消息执行 | protocol handshake、renderer-ready、request ID + matching ack、latest-wins、版本协商、可重试队列与明确失败状态 |
| App catalog identity / shortcut enumeration | **Medium–High** | 不同 args/cwd 可能被误合并；中文、损坏 .lnk、PowerShell 不同输出与 AUMID 造成目录差异 | 保持 typed target；采集脱敏 fixture；真实用户目录验证数量、别名和启动目标 |
| Everything CLI 与文件路径保护 | **Medium** | 参数编码、ES 版本、中文结果/取消行为和 opaque ID 映射移植可能偏差；暴露路径扩大权限面 | ProcessStartInfo.ArgumentList；保持限长/timeout/output cap；path 仅 Host；复用现有参数/解析测试 |
| Host 单实例、托盘、自启动、升级/重启 | **Medium–High** | 多个 Native Host 竞争 hotkey/pipe；安装升级期间双版本并存；用户结束 Host 后启动项行为异常 | Windows mutex + secondary activation handoff；命名 pipe 带版本/实例；安装升级、重启、退出策略单独验收 |
| Manager 启动时延 | **Medium** | Native idle 内存下降，但打开管理器/翻译可能比原来多一次 Native→Electron 启动过程 | 不把“常驻性能”收益换成不必要的窗口延迟；分别测首次 Manager 与已启动切换，给出清晰加载反馈 |
| .NET runtime / Windows 兼容性 / installer | **Medium** | self-contained 提升独立部署但 package 大；WPF runtime 和电子安装包共存需升级、卸载与 per-user 安装验证 | self-contained PoC；最终复用现有 per-user NSIS 需评估双 exe、登录启动、卸载与 rollback |
| Native icon / 网站 favicon cache | **Medium** | 图像对象/bitmap lifetime 或 favicon 更新可能造成泄漏、旧图标、占用随目录增长 | 按可见结果惰性解码、ID cache、refresh version invalidation；长时间与大目录压力测 |
| Electron/Native 版本错配与崩溃恢复 | **Medium** | 新 Native Host 与旧 Manager 协议不同步可能导致启动失败、无窗口或重复实例 | 同安装版本发布；protocol major/minor；Host 检测 Manager exit code、可重启/回退并记录诊断 |
| 安全边界 | **Medium–High** | Named Pipe 若 ACL 过宽、action 类型开放任意命令，其他本地进程可请求启动程序或取数据 | 当前用户 ACL、拒绝远程、身份/协议校验、message limits、operation allowlist；不发 filesystem path/secret |
| 双架构长期并存的维护成本 | **Medium** | Electron Launcher 与 Native Launcher 并行时可能功能漂移 | 现有 parity fixtures 是 oracle；明确 4E 完成门槛与 4F 删除时点，避免无限双实现 |
| UI 自绘细节 | **Low–Medium** | Fluent 风格、hover、主题差异会带来 polish 工作，不影响搜索安全边界 | 先优先输入/窗口稳定与视觉一致，不在 PoC 追求完整主题系统 |

## 17. Recommended Architecture

推荐：**一个 Native Host 进程同时拥有 WPF Launcher、托盘、全局快捷键和 Native Search Core；Electron 是 Manager-only 按需子进程。** Native Host 是常驻进程及 named pipe server；Electron Main 不再因 Launcher 需要而常驻。Electron Main 继续拥有 Manager 的 DataStore、Settings UI、Website CRUD、SecretStore、TranslationService 与 SharedAIService。Native Host 仅持有应用 catalog、搜索结果与图标 cache、Everything 运行上下文、热键和只读 website/settings snapshot；网站写操作回 Manager Main。

分阶段所有权：

1. Phase 4B：独立 PoC，不改变产品入口或 installer。
2. Phase 4C：Native 搜索和 app/website/file actions，Electron Launcher 仍可单独 fallback；共享 fixture 是退出条件。
3. Phase 4D：Host 管 Electron Manager 生命周期和管道协议，单写数据 ownership、translation ready/ack、崩溃/重连。
4. Phase 4E：逐项 feature parity 与用户实际验收；两套 Launcher 同期可用。
5. Phase 4F：仅在 4E 通过后，删除 Electron Launcher、对应 window/preload/IPC 和 Electron 常驻保活；Manager 关闭后 Electron process tree 退出。
6. Phase 4G：同机比较 idle/show/hide/search/Manager-open 内存和时延，确认目标后收尾。

不推荐 Native Host + Electron Main 永久共驻的“半迁移”；也不推荐把 AI/翻译移入 C#，或允许两进程各自写完整 nook-data.json。

## 18. Phase 4B Codex Implementation Plan

本计划是后续实施建议，不在 Phase 4A 执行。执行时应先准备 .NET 10 SDK 的 Windows 开发环境。不要新增第三方 package 作为 PoC 前置，优先使用 WPF、BCL、Win32 P/Invoke；NativeAOT 与 installer 暂不纳入。

| Task | 交付 | 验收 |
|---|---|---|
| 0. 环境和测量 protocol | 记录 Windows build、CPU/内存、屏幕/DPI、Electron 版本；定义采集 PID tree、Private Bytes、Working Set、hotkey 计时方法 | Electron baseline 在同机重复至少 5 次 |
| 1. Native project skeleton | 新独立 WPF net10.0-windows 项目、self-contained win-x64 profile；Electron 仓库现有文件不改 | dotnet build/publish；发布目录可独立启动 |
| 2. Instance / host loop | 单实例 mutex、第二次启动激活第一实例、Tray 退出入口、关闭事件 cleanup | 不产生第二个托盘/快捷键；退出可完全终止 Host |
| 3. Launcher window contract | 固定宽度、无边框透明、置顶、monitor work area 定位、Compact dummy state | 不闪白/淡入；多屏和 DPI 位置正确 |
| 4. Hotkey + text focus | 默认 Ctrl+Alt+Space；注册/解除、冲突可见反馈；唤出时 focus input | 第一次和连续 30 次唤出；无丢键、中文 IME 可用 |
| 5. Dummy results interactions | 固定三行，up/down、Enter、ESC、blur-hide、drag；不实现 search engine | 快捷键 toggle、ESC、外部失焦、点击/拖动输入不冲突 |
| 6. Baseline report | Native-only 和 Electron Launcher 同机冷启动、idle 30 秒/10 分钟、首次/30次 toggle 的数据和视频/手测记录 | 达到建议 Go 门槛才提 Phase 4C；否则停留/回退 |

Phase 4B 不接 Start Menu、不接 Everything、不连 DataStore、不处理网站/图标、不调用 Translation、不建立 Manager IPC、不更换安装程序。若 Task 3–5 的窗口和输入风险无法稳定解决，应暂停而不是扩大 PoC。

## 19. 最终问题答复

### Q1. 当前 Launcher 哪些职责必须迁移 Native？

Launcher window 与输入/选择 UI、全局热键、显示隐藏/失焦/拖动、Tray/单实例/开机启动、应用目录发现/启动/图标、搜索解析与排序/pinyin、保存网站只读查询、Everything 查询与文件启动、appSearchMemory、必要的 Launcher settings cache/更新通知。Electron Launcher 被移除前必须保持可运行作 fallback。

### Q2. 哪些职责继续留在 Electron Manager？

Manager BrowserWindow 与 Vue 页面、Settings UI、网站与收藏夹 CRUD、DataStore website/settings 单一写入、Translation UI/Service、SharedAIService、provider adapters、API credential 与 SecretStore、安全存储及管理流程。复杂功能不得因 Native Launcher 常驻而迁入 Native Host。

### Q3. 推荐什么 C# UI 技术？为什么？

Phase 4B 推荐 WPF + .NET 10 LTS。目标 Windows-only、单个轻窗口，对置顶、frameless、transparent、键盘/IME/多屏的控制和实现成熟度比 WinUI 3 的 Fluent 外观优势更重要；对比数据尚无，PoC 要测实际 idle、first show 和输入法。若 WPF 内存/时延未达门槛，再比较 WinForms 或 WinUI 3，而不先假设赢家。

### Q4. Native Host 与 Electron Manager 推荐什么 IPC？为什么？

Windows Named Pipe，Native Host 创建 server，Electron Manager 主进程作为 client。使用当前用户 ACL、版本握手、4-byte length-framed JSON、request ID、有限消息大小和 allowlist。该设计对 Host 长驻、Manager 按需启动/重启较自然，不开放 localhost 端口；协议复杂度仍需 Phase 4D 验证。

### Q5. 最终 idle process tree 应是什么？

只有 WebTools.NativeHost.exe，内部包含 WPF Launcher、Tray、Hotkey、搜索和 pipe server；没有 WebTools Electron Main、Renderer、GPU 或 Utility。打开 Manager 才出现 NativeHost + Electron Manager 及其 Chromium children。

### Q6. Manager 关闭后能否 Electron process group 完全退出？需要改哪些生命周期？

可以，但当前不能做到。当前 window-all-closed no-op、Launcher BrowserWindow 常驻、Tray 与 GlobalHotkeyService 在 Electron Main 内，都会保活。迁移后 Electron 应有 manager-only mode；Native Host owns Tray/Hotkey/Login startup；Manager window 被关闭/销毁且无其他 Manager 窗口后执行 app.quit；取消 Electron 侧 Launcher/Tray/hotkey 常驻资源，刷新 DataStore 后退出，并用 OS PID tree 确认 Electron 主进程及 GPU/Utility 子进程均退出。考虑 Electron second-instance 只向 Native Host 激活 Manager 的协议。

### Q7. 当前 JS Search Engine 迁 C# 最大技术风险？

跨语言结果不等价：pinyin-pro 词典和多音字、中文归一化、拼音全拼/首字母、分词 token initial、tie-break localeCompare、别名合并及 memory promotion 会同时影响前 8 行。必须以当前 TS fixture oracle，而不是重新按“合理性”设计排名；Windows catalog 差异和异步图标状态是第二层风险。

### Q8. Phase 4B 最小 PoC 做什么？

独立 WPF Native Host，single instance、全局热键、透明无边框置顶窗口、自动 focus 输入框、中文/英文输入、三条 dummy results、上下键与 Enter、ESC/blur hide、drag、30 次 toggle。只测窗口/输入/稳定性/内存/时延；不连接真实搜索、Electron、Everything、网站、翻译、配置或 installer。

### Q9. 什么结果值得继续 / 应停止？

继续：同机多轮 Native-only idle 内存稳定并明显低于 Electron；first-hotkey 与 p95 focus latency 不劣；IME、透明窗、焦点、多屏/DPI、退出进程均通过。建议量化门槛见第 15 节（Native idle private bytes median 至少低 30%，hotkey-to-focus p95 回归不超过 10%，属于建议值）。停止：收益不明显/不稳定、首次唤出慢或丢键、IME/透明/焦点不可靠或残留 Electron 子进程无法收敛。停止时保留现有 Electron Launcher，不因架构目标强行重写。

## 20. 审计验证、限制与当前 Git 状态

### 20.1 自动检查

| 检查 | 结果 | 说明 |
|---|---|---|
| Typecheck | 通过（等价命令） | 当前终端直接启动 npm.cmd 曾返回 Access Denied；使用项目依赖中的 vue-tsc 和 tsc 分别执行 package script 的底层命令，均通过 |
| Tests | 通过：103 passed，0 failed | 使用当前项目声明的 Node test runner 与 strip-types 参数运行 |
| Build | 通过 | 使用项目本地 electron-vite 执行 production build |
| git diff --check | 报告写入后执行，结果见本报告提交状态核验 | 仅对当前工作树 whitespace 检查，不代表干净 HEAD |
| .NET SDK | 未安装 | dotnet --info 显示无 SDK；只列有 3.1/5/6 runtimes；没有 C# build 或 native GUI runtime test |
| npm run electron:dev / GUI | 未执行 | Phase 4A 是静态审计；没有验证真实 Windows 热键、IME、窗口、进程退出或 Native PoC |

Production bundle 中现有 Launcher 入口约 45.03 KB、Manager 入口约 88.41 KB、共享 chunk 约 660.63 KB（当前 build 输出所示）；这是 bundle 文件大小，不是 runtime heap / private bytes，不用于推算 Native 收益。

### 20.2 需要用户/Windows 人工验证

- 混合 DPI、多显示器热插拔、唤出位置和 Win11 透明窗合成。
- Native PoC 中文 IME composition、首键、焦点、ESC、失焦、拖动、30 次 toggle。
- Native Host/Manager 的真实 named pipe ACL、重启、崩溃与 PID tree 完全退出。
- Native catalog 在真实机器上的应用重复率、桌面/Start Menu 中文快捷方式、真实 icon 和启动结果。
- Everything es.exe 各版本的中文路径、老版本 CSV 编码和错误退出码。
- Launcher → TranslateView handoff 在 provider 已配置时是否保留当前约 450ms 自动翻译，并确认旧结果不会覆盖新输入。

### 20.3 工作树

本次只新增 docs/native-launcher-phase4a-architecture.md。已有的 Phase 1–3 未提交文件、测试、文档和 output/ 保持不变；未清理、未暂存、未 commit、未 push、未创建 PR。最终 branch 为 codex/shared-ai-translation-2.0，git diff --check 退出码为 0；Git 对一些既有 LF 文件提示未来可能转为 CRLF，这是 line-ending 提醒而非 whitespace error，既有文件没有被本次改写。

## 审计交付映射与官方资料

### 原要求的 23 项交付覆盖

| 要求章节 | 报告位置 |
|---|---|
| 1. Executive Summary | 第 1 节 |
| 2. Current Launcher Architecture | 第 2 节 |
| 3. Launcher Behavior Contract | 第 2.2 节 |
| 4. Search Feature Contract | 第 3.2–3.3 节 |
| 5. Search Dependency Graph | 第 3.1 节 |
| 6. Search Migration Boundary | 第 3.4 节 |
| 7. Search Parity Strategy | 第 3.5 节 |
| 8. App Catalog Ownership | 第 4 节 |
| 9. Website Data Ownership | 第 5 节 |
| 10. Everything Integration | 第 6 节 |
| 11. Icon Pipeline | 第 7 节 |
| 12. Translation Handoff | 第 8 节 |
| 13. Native ↔ Electron IPC Comparison | 第 9 节 |
| 14. Native UI Technology Comparison | 第 10 节 |
| 15. .NET Runtime Strategy | 第 11 节 |
| 16. Future Process Model | 第 12.1 节 |
| 17. Electron Main Responsibility Migration | 第 12.2 节 |
| 18. Components That Should Stay Electron | 第 13 节 |
| 19. Phase 4B Minimal PoC | 第 14 节 |
| 20. Go / No-Go Metrics | 第 15 节 |
| 21. Migration Risks | 第 16 节 |
| 22. Recommended Architecture | 第 17 节 |
| 23. Phase 4B Codex Implementation Plan | 第 18 节 |

### 官方技术资料

- [WPF desktop guide](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/)
- [WPF windows](https://learn.microsoft.com/dotnet/desktop/wpf/windows/)
- [WinUI 3](https://learn.microsoft.com/windows/apps/winui)
- [Windows App SDK deployment overview](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/deploy-overview)
- [.NET deployment modes](https://learn.microsoft.com/en-us/dotnet/core/deploying/)
- [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
- [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy)
- [WPF roadmap](https://github.com/dotnet/wpf/blob/main/roadmap.md)
- [NamedPipeServerStream API](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeserverstream)
- [Node.js net named pipes](https://nodejs.org/download/release/v24.20.0/docs/api/net.html)

文档范围映射：Launcher 架构/行为见第 2 节；搜索解析、依赖、迁移边界与 parity 见第 3 节；应用、网址、Everything、图标和翻译见第 4–8 节；IPC、UI 与 Runtime 选型见第 9–11 节；目标进程、责任迁移及 Manager 保留边界见第 12–13 节；PoC、门槛、风险与路线见第 14–18 节；问题答复及验证限制见第 19–20 节。
