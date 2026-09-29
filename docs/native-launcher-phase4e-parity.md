# WebTools Native Launcher — Phase 4E Feature Parity & User Acceptance

审计日期：2026-09-29
审计范围：当前工作树中的 Native WPF Launcher、Electron Manager/reference Launcher、NativeHost 与自动化检查。
结论状态：**拖动范围修复、自动化验证和独立 Windows acceptance 安装包已完成；完整 Windows UI acceptance 尚未完成。暂不建议进入 Phase 4F。**

本报告只记录 Phase 4E 结果。本轮仅收敛 Native Launcher 拖动起始区域，并新增回归检查、Phase 4E 专用 acceptance installer 脚本和人工清单；没有修改 Electron Launcher、正式 installer 配置或数据结构。Phase 4E acceptance 包已生成并完成隔离安装 smoke test。没有 commit、push、PR，也没有进入 Phase 4F。工作树中已有的用户修改均保留。

## 1. Executive Summary

当前实现已经具备 Native-only 空闲架构：NativeHost 持有托盘、全局快捷键、WPF Launcher、搜索、目录快照和 Manager Controller；Electron Manager 由页面导航或翻译 handoff 按需启动。此前进程样本只发现 NativeHost，没有 WebTools/Electron 进程；该样本中的 PID 9684 后来已退出，本轮没有重新启动它做内存测量。用户最近报告的 Task Manager 读数单独记录为人工观察，不与旧 Private Bytes/Working Set 样本混用。

本轮自动验证通过：TypeScript typecheck、Node 测试 109/109、Electron production build、NativeHost Release build、Native checks 39/39、真实 Windows 目录扫描 287 个 app、Win32 图标 100/100、真实临时快捷方式 launch smoke test、win-x64 self-contained publish，以及最新 Phase 4E 安装包在中文/空格路径的安装、Manager discovery 和卸载 smoke test。拖动回归检查使用真实 WPF TextBox 字符布局和 hit testing 验证文字区/空白区判定，但没有模拟真实鼠标或键盘焦点。自动化证据没有覆盖完整 UI 行为。

**没有发现已确认的 P0/P1 缺陷。** 这不代表 Phase 4E acceptance 完成：冷启动、热键/IME、Manager 冷暖 handoff、正常关闭后 Electron 归零、30 次 Manager 周期、实际设置同步、旧 Electron 用户档案迁移和 DPI/多屏都尚未完成 GUI/runtime 验收。Native 拖动现已限制到搜索栏和顶部指定拖动面；WPF 真实鼠标交互仍须按清单人工验收。

本轮 acceptance installer：`D:\System default\Desktop\HomePage\release\native-phase4e-acceptance-20260929-233750\WebTools-Native-Phase4E-Setup.exe`（2026-09-29 23:40:54 构建完成，167,637,148 bytes，SHA-256 `74B32B081172F52FD78D5484F55E89D07CDC0B515AA737B992176833909A70FD`）。它使用独立 Phase 4E NSIS 配置，安装入口为 `WebTools.NativeHost.exe`，Electron Manager 放在 `Manager\WebTools.exe`，由 Native ManagerController 按需发现/启动。测试安装到 `D:\System default\Desktop\HomePage\release\native-phase4e-acceptance-20260929-233750\smoke-install\Phase 4E 中文 空格验证`，检查通过后由该测试安装自身的卸载程序清理；没有触碰已有用户安装。

## 2. Current Architecture

```text
Windows startup / user launch
          │
          ▼
WebTools.NativeHost.exe  (.NET 10, WPF + WinForms tray)
 ├─ single-instance mutex, native tray, global hotkey
 ├─ WPF Launcher + SearchCore + app catalog/snapshot
 ├─ Everything client + launcher state + website projection
 └─ ManagerController / named-pipe protocol
          │ only on Manager navigation or Translation action
          ▼
Electron Manager-only process group
 ├─ Electron Main + preload + one Manager BrowserWindow/Renderer
 ├─ Search Manager / Entries / Settings / Translation views
 └─ named-pipe readiness, state synchronization, intent acknowledgement
```

- Native 启动路径设置 WPF `ShutdownMode=OnExplicitShutdown`，加载 Native state、建立 pipe/controller、创建 Launcher、注册 hotkey 和 tray，并异步初始化搜索。代码没有在启动时直接启动 Electron；Manager executable 由 `ManagerProcessLauncher` 在需要 Manager 时解析和启动。
- Manager 页面在一个 Electron Manager BrowserWindow/Renderer 内路由。Native Manager Controller 对页面请求复用现有 Manager，并用 renderer-ready / request acknowledgement 处理启动竞态；这些路径有自动化协议测试，但本轮没有在真实窗口中验证。
- 此前运行样本为 PID 9684 的 `WebTools.NativeHost`，MainWindowHandle 为 0；该进程现已退出。此前记录的 apphost SHA-256 为 `381CF80D7E8B6D7D2362B0F47CD01CFDAA29C29C90B533C63E4028EEB714C07E`。仅比较 apphost 文件不能证明随包托管的 DLL 版本相同。
- Native runtime 发布为 .NET 10 `win-x64` self-contained。NativeHost 项目没有 Node、Chromium、V8、WebView2 或 CefSharp 依赖；先前进程枚举只看到 NativeHost，本轮隔离安装 smoke test 没有启动 NativeHost/Electron 做 GUI 测试。

## 3. Phase 4D Baseline

| Evidence | Result | Scope / caveat |
|---|---:|---|
| 用户安装后的 idle 内存反馈 | 约 50 MB | 用户此前报告的任务管理器读数；具体列、采样方法和当时构建未与本轮样本对齐。 |
| 前轮 NativeHost idle Private Bytes | 中位数 113,635,328 B（108.37 MiB） | 同一已运行进程 7 次采样，22:06:58–22:07:28；不是当前 build，也不是 5 次独立冷启动的 median。 |
| 前轮 NativeHost idle Working Set | 中位数 194,523,136 B（185.51 MiB） | 与上项相同的单进程短时采样。与用户任务管理器反馈不能直接比较。 |
| Phase 4C 历史 fresh-launch median | 68.32 MiB | 更早构建和测试流程，不作为当前 Phase 4E baseline。 |
| 用户最近报告的 Task Manager 观察 | NativeHost 刚启动约 40 MB；使用后通常约 60 MB；曾短暂约 70 MB；重复搜索没有观察到持续单调上涨 | 用户实测、口径未严格控制；不是 Private Bytes benchmark。按同一 build/工具/列进行的 5 次冷启动 median、GDI/USER 时间序列仍待测。 |
| Phase 4E acceptance 包 | 167,637,148 bytes；SHA-256 记录于上方 | 本轮新建的独立安装包；已在中文/空格路径完成安装与 Manager executable discovery smoke test，并卸载清理。没有对真实用户配置做迁移测试。 |

Windows 任务管理器“应用分组”、Private Bytes 和 Working Set 是不同口径。当前读数与用户报告差异较大，需用同一列、同一安装版本和同一等待时间复测后再比较。

## 4. Feature Parity Matrix

状态按用户可观察行为记录。源代码/核心测试通过不等于完整 GUI parity 已通过。

| Feature | Electron reference | Native 当前实现 | 状态 | 严重级别 | 后续动作 |
|---|---|---|---|---|---|
| Native-only startup | Electron launcher 在旧架构作为入口 | NativeHost 启动托盘、hotkey、WPF Launcher；Manager 按需 | NOT TESTED（当前进程快照仅 Native） | — | 做全进程停止后的冷启动验收。 |
| Tray menu / double-click | Electron tray context menu and show action | WinForms NotifyIcon menu由 NativeHost 持有；双击请求显示 Launcher | NOT TESTED（菜单宽度/主题单测通过） | P3 | 实际点击各菜单项、双击图标，检查高 DPI 和菜单边缘。 |
| Global hotkey toggle / focus | Electron 主进程显示/隐藏并聚焦 Launcher | Native GlobalHotkeyService + WPF Show/Hide 路径 | NOT TESTED | — | 30 次真实快捷键切换、首字符和 IME。 |
| Immediate typing / Chinese IME | Electron renderer 聚焦搜索输入框 | WPF activation 后聚焦 QueryBox | NOT TESTED | — | 验证首字符、中文 IME composition 和输入法切换。 |
| Escape / blur hide | Launcher renderer/window hide | Native WPF Escape、Deactivated hide | NOT TESTED | — | 实机验证外部点击和内部控件不会误隐藏。 |
| Search languages / ordering | shared app/website search and aliases | Native SearchCore、拼音映射、8 条结果合同 | PASS（核心自动化）；GUI 未测 | — | 真实 Launcher 复测键入、结果、Enter。 |
| Saved websites | website search/open and saved cards | Native website projection、`/`、HTTP(S) open | PASS（数据/合同测试）；CRUD/open GUI 未测 | — | Manager CRUD、即时同步、重启持久化。 |
| `?query` web search | selected/custom search engine | Native command action uses selected engine/template | PASS（核心合同）；外部浏览器未测 | — | Settings 修改后实际搜索并重启复测。 |
| `file:` / Everything | Everything query, latest result, path open | Native EverythingClient、latest-generation gate、typed path actions | PASS（参数/压力 harness）；UI 未测 | — | 有/无 Everything、文件夹/文件打开和错误提示。 |
| Win32 / `.lnk` launch | Electron app catalog and launch | Native typed launch targets; one real temporary `.lnk` smoke test | PARTIAL | — | 真实安装 app、开始菜单和桌面快捷方式验收。 |
| Packaged app launch/icon | Electron catalog icon fallback | Native packaged AUMID icon resolver and typed target | PASS（12 个图标样本的自动检查）；真实启动未测 | — | 测试若干 Store app 的实际启动。 |
| Win32 icons | async Electron icon lookup | Native lazy bounded cache; 100/100 sampled icons resolved | PASS（自动化样本） | — | 观察真实 UI 中异步图标和排序。 |
| Website/file/folder/fallback icons | renderer/IPC icons | Native favicon reader, shell icon extraction and fallback | PARTIAL | — | 真实 URL、文件、文件夹和 fallback GUI 检查。 |
| Translation handoff | Launcher to Manager Translation prefill | Native request queue → Manager intent → TranslateView prefill | NOT TESTED（协议单测通过） | — | Cold/warm、Unicode、多行、快速重复请求实测。 |
| Manager pages and reuse | Manager route/window | 一个 Manager-only Electron window，页面请求应复用 | NOT TESTED（静态/协议测试通过） | — | 连续打开 Search/Entries/Settings/Translation。 |
| Normal Manager close | close Manager and release Electron | Electron managerOnly close/quit path + Native remains | NOT TESTED | — | 点击 × 后确认 BrowserWindow destroy、Electron=0。 |
| Settings sync | Electron settings persistence | Native launcher state + Manager named-pipe projection/update | PARTIAL（迁移/协议自动化通过） | — | UI 改 hotkey/engine/theme/site 后即时及重启验证。 |
| Theme | Light/Dark/System | WPF palette + system preference listener + tray palette | PARTIAL（palette 自动化通过） | P3 | 实际切换系统主题，目测 Launcher 与 Manager。 |
| Compact/expanded and shortcut cards | Electron compact/expanded shortcuts | WPF compact/expanded sizing and website/app sections | NOT TESTED | — | 两种模式布局、滚动、展开和状态持久化。 |
| Drag | Electron search-bar drag surface | Native drag gesture only begins from designated search-bar/top strip surfaces; interactive descendants are rejected | PARTIAL（源码 + 回归测试通过；真实拖拽未测） | — | 用真实鼠标确认指定区域可拖动，结果/卡片/滚动/输入选择不触发拖动。 |
| Internal click / blur boundary | Renderer controls remain interactive while launcher focused | WPF Deactivated hides after focus moves away; drag no longer captures the whole Window | NOT TESTED | — | 验证点击品牌、卡片、结果和滚动不会意外隐藏/抢拖动。 |
| DPI / multi-monitor | Electron monitor placement | Native monitor work-area placement and DPI conversion code | NOT TESTED | — | 100/125/150%、多屏和任务栏位置。 |
| Visual details | Chromium launcher reference | WPF styles/palette/layout approximate same visual language | NOT TESTED（无本轮 GUI 对照） | P3 | 人工对比字体栅格、hover、selection、滚动条和圆角。 |
| Existing-user migration | Electron profile persistence | one-time legacy Nook state import + Native state persistence | PARTIAL（fixture test pass） | P2 gate | 使用真实旧用户档案副本验证 hotkey/theme/engine/sites/app memory。 |

## 5. P0 / P1 / P2 / P3 Differences

| Severity | Confirmed issue count | Findings |
|---|---:|---|
| P0 | 0 confirmed | 本轮自动化/源码范围内没有发现无法启动、数据损坏或关键功能完全不可用的确定问题。GUI 验收不足，因此不是对所有运行环境的绝对保证。 |
| P1 | 0 confirmed | 未确认日常必然遇到的严重退化；高风险 Manager 流程仍需实机验证，不能据此宣称已达到 release gate。 |
| P2 | 0 source-confirmed differences + 1 migration acceptance gate | 拖动范围差异已按 Electron 搜索栏交互收敛并有回归覆盖；真实旧用户 profile 尚未端到端迁移验证。后者是验收缺口，尚未证明迁移失败。 |
| P3 | 2 visual/runtime acceptance gaps | WPF/Chromium 字体栅格与托盘菜单可能存在平台差异；主题视觉、compact/expanded 和 DPI 没有截图/实机对照。 |

## 6. Hotkey / Window Behavior

源码路径具备 Native hotkey toggle、WPF focus、Escape hide、失焦隐藏和拖动处理。自动检查覆盖 hide reset、selection 状态、拖动阈值和拖动来源范围；没有通过本轮 GUI 操作验证注册的真实快捷键、冷启动首次响应、立即输入、中文 IME、ESC、blur、真实拖拽和 30 次切换。

拖动修复：移除了 Window 级 Preview 鼠标手势；只在搜索栏和顶部指定拖动面接收手势，helper 沿 WPF visual/logical/content tree 检查来源，并拒绝 TextBox、按钮、滚动条/滚动区、ListBoxItem 等交互目标。搜索栏品牌按钮不启动拖动。真实 WPF 鼠标拖动、IME 和文本选区仍是人工验收项；自动检查不等于 GUI PASS。

## 7. Search

本轮 Native SearchCore 检查通过冻结 Electron top-eight fixture、pinyin/initial fixture、`?`、`/`、`file:` 解析、alias merge 和最新查询 generation。当前系统 catalog 检查发现 287 个应用。它证明搜索核心和索引样本可运行，不证明真实 WPF Launcher 的 IME、实际键入时延或所有真实 catalog 顺序与 Electron 完全一致。

## 8. Selection / Keyboard

自动化覆盖默认首项、查询更新重选首项、Arrow Up/Down 环绕、Enter 选中状态、空查询，以及 icon-only 更新不重置键盘选择。Electron 历史序列 u → ut → uto → utoo → utool → utools 已由已有 parity fixture 保留。真实键盘事件、滚动定位和 Everything 异步 UI 到达时的手感未进行人工 GUI 验收。

## 9. App Launch

当前目录 catalog 包含 Start Menu、User/Public Desktop、Win32/App Paths、Start Apps 和固定系统应用目标。`.lnk` identity 依据有效启动 invocation 合并 aliases；不同参数/working directory 的启动命令保留为不同 target。自动检查运行了真实临时 `.lnk`，并观察到 marker 创建且没有启动 Electron。没有从 Native Launcher UI 实际启动 VS Code、微信、QQ 或 Store 应用；真实外部 app launch 仍需人工验证。

## 10. Icons

- app catalog 的 icon 请求按当前显示结果惰性加载，不在启动时扫描整个目录提取图标；Native cache 有 64 项容量上限。
- 本轮 Win32 icon harness 为 100/100；缓存满载 64 项；估算缓存位图字节 65,536。GDI 在首次提取时 11→48，重复读取维持 48，符合首次资源分配后稳定的样本，不构成持续泄漏证据。
- 本轮检查覆盖 packaged icon resolver 的精确 App ID、主题/尺寸 asset 选择、路径边界、损坏 manifest、安全 fallback 和按主题缓存。Phase 4E 前序检查曾得到抽样 Store icon 12/12；仍没有真实 Launcher UI 图标显示和 app launch 验收。
- Website favicon、文件夹、文件和品牌/tray 图标需要人工目测，不能从图标服务测试推断像素观感。

## 11. Website

Native 读取现有 website 数据并形成轻量投影，WebsiteEntry persistence schema 未变。自动测试覆盖只读 loader、选择搜索引擎、favicon 不进入 website projection、对象 envelope 同步和 launcher state website validation。没有在 Manager 实际新增、编辑、删除网站后观察 Native 即时刷新及重启持久化。不要把此项标成端到端 PASS。

## 12. Web Search

`?query` 在 Native command parser 与 frozen search contract 测试通过。settings state 中保存 selected engine/template，Native 使用投影的引擎设置。当前没有实际发起外部浏览器搜索，也没有通过 Manager UI 增改 custom template 后复测，因此外部打开与用户配置传播仍需人工验收。

## 13. Everything

Native `file:` 使用 EverythingClient，把 query 作为单独 literal argument 传递，并使用 latest-generation 防止旧响应覆盖。1,000 次 harness 中含 50 次 Everything 查询，median 170.441 ms、P95 183.485 ms；本地 950 次查询 median 0.030 ms、P95 0.127 ms。该延迟包含当前测试机 Everything 服务路径，不等于 Launcher 完整呈现时延。未验证安装缺失、服务停止、快速真实输入、空结果、文件/目录双击和图标的 UI 错误反馈。

## 14. Translation

自动化覆盖 Native request queue、Manager renderer readiness/ack、过期 waiter、新生命周期重试以及 TranslateView 的 stale request gate。当前 TranslateView 还保留既有输入后 debounce 自动翻译设置；handoff 本身不直接调用 provider，但预填是否触发用户当前配置的自动翻译，需按实际设置和 UI 测试确认。本轮没有完成 cold/warm Manager handoff、精确原文显示、多行 Unicode、快速重复请求、翻译清空和是否产生网络请求的人工验收。故稳定性答案为 **未知**，不是协议单测通过即可推定稳定。

## 15. Manager Navigation

Native tray actions分别请求 Search、Entries、Settings、Translation。Manager executable discovery 的自动化检查支持包含空格和中文的路径；Manager launcher 使用同一运行门和意图队列。未实际点击托盘菜单验证四个入口是否落到正确页面、Manager 是否复用同一窗口/进程组。

## 16. Manager Lifecycle

Electron 的 manager-only 模式有窗口复用、正常关闭时 destroy、关闭后 quit，以及 pipe disconnect 退出路径。Native 端有 renderer-ready / acknowledgement 协议测试。本轮没有执行用户点击 Manager × 后检查 Renderer/GPU/Utility 全部退出，也没有跑 30 次 open/close。不能回答“Electron 稳定归零”或“没有 orphan”为 PASS；两项都需手测/运行时日志。

## 17. Settings

| Setting | Owner / persistence | Native runtime update | Restart behavior / evidence |
|---|---|---|---|
| Global hotkey | Native Launcher State；Manager Settings 经 pipe 请求修改 | Native 先尝试注册新 hotkey，成功才提交状态；失败保留旧 hotkey | State store fixture/reload 通过；真实注册、冲突和重启未测。 |
| Theme | Native Launcher State | Native Launcher/Tray 接收设置并更新；System 监听 Windows preference event | palette 单测通过；真实主题切换未测。 |
| Search engine/template | Launcher settings projection sourced through Manager sync | Manager sync 后替换 Native state | parser/loader 测试通过；修改后即时搜索/重启未测。 |
| Websites | Manager/Electron DataStore 为内容编辑入口；Native 使用同步的轻量 projection/state | pipe website replacement 更新 Native | 序列化 envelope 测试通过；CRUD UI/重启未测；没有在本轮改 schema。 |
| Compact/expanded mode | Native Launcher State / Manager projection | settings sync 后更新 Launcher state | default/expanded UI 与重启持久化未测。 |
| App search memory | Native Launcher State | app activation 后 Native 写入 bounded memory | memory ordering fixture 通过；真实打开、重启复测未做。 |
| Launch on startup | Native State + Windows startup registration | Native 设置事务更新登录启动 entry | source 有失败隔离；设置 UI 和系统启动验证未测。 |

## 18. Hotkey Transaction

源码实现先测试替换 hotkey 注册，再保存新的 Launcher state；不能注册时抛出 `HOTKEY_UNAVAILABLE` 并保持旧设置。Phase 4D 检查覆盖 malformed/oversized application memory IPC，不包含完整 Windows hotkey 冲突过程。本轮没有制造真实系统快捷键冲突、确认旧热键仍可用或重启后新热键仍生效。

## 19. Theme

Native palette 与 Electron token 的基础颜色匹配：canvas `#0b0c0e`、surface `#18191b`、raised `#202124`、line `#2c2d30`、text `#f4f4f5`、accent `#e4e4e7`；light theme 基础 surface/text/accent 也映射一致。Dark/Light/System 解析及 tray palette 有自动化测试。Native 监听系统 preference 变化；运行中改变 Windows 系统主题的端到端响应未测。

## 20. Visual Parity

Native 使用 WPF 的 850 DIP 宽窗口、无边框透明顶层、约 128 DIP compact 初始高度、键盘结果列表、shortcut sections 和自绘滚动条；Electron reference 用 Vue/CSS。Theme tokens 有意复用相近色值，不意味着控件尺寸、文字抗锯齿、hover/selected、滚动条、圆角、鼠标 hover 和 brand icon 已逐项目测一致。当前无本轮 Native/Electron 对照截图，视觉 parity 标为 NOT TESTED。

## 21. DPI / Multi-monitor

Native 有 work-area/monitor placement 和 device/DIP conversion 实现，但没有在本轮切换 100%、125%、150% DPI 或双屏、任务栏边缘、主副显示器和鼠标所在屏幕进行检查。全部标记 USER MANUAL VERIFICATION。

## 22. Cold Boot

代码路径表明 NativeHost 启动自身不要求 Electron；搜索、快捷键、tray、catalog 初始化均位于 Native。当前可见进程样本只有 NativeHost；但该实例早于本轮启动，不能作为“停止所有 WebTools 进程后 fresh launch”的 cold boot 证据。冷启动快捷键、中文/拼音、website、`?`、`/`、`file:` 和 Electron=0 需人工执行。

## 23. Snapshot

Native checks 39/39 包含 catalog snapshot reload、损坏快照安全拒绝/回退以及拖动来源范围、TextBox 字符命中回归；源实现使用校验、文件大小边界与临时文件替换。机器上可看到 app catalog snapshot 文件。缺失快照后的真实完整扫描恢复与刷新原子性没有在用户安装实例中实测；完整 scan harness 本轮为 287 app / 15,287 ms，不作为 cold startup readiness 时间。

## 24. Existing-user Migration

`LauncherStateStore` 从 Nook `nook-data.json` 做一次性旧状态迁移到 `launcher-state.json`；当前测试覆盖迁移一次、reload、非法状态校验和损坏 catalog snapshot。当前用户 profile 在安装环境已存在 Native state 与旧 Nook 数据文件，但本轮没有在 profile 副本中模拟升级、比较迁移前后 hotkey/theme/search engine/sites/app memory，也没有验证损坏 Native state 时所有旧 Electron 数据能完整恢复。迁移 **通过 fixture，不代表真实旧用户迁移已可靠验收**。这是进入 4F 前必须完成的 gate。

## 25. Error Handling

检查通过的自动化路径：损坏 snapshot 安全回退、malformed state 拒绝、packaged icon 失败隔离、Everything 参数安全、固定 typed launch targets、Manager 路径解析、热键注册失败保留旧配置。没有 GUI 注入 Manager 缺失/启动失败、pipe 中断、Everything 不可用、URL/template 无效、应用卸载和 corrupt state 后的实际反馈。次级功能错误时 Native UI 能否继续工作需手测。

## 26. Native Memory

前轮完整 NativeHost 隐藏 idle 实例于 22:06:58–22:07:28 采 7 次、间隔约 5 秒：Private Bytes 前 6 次为 113,635,328 B，第 7 次为 113,754,112 B；Working Set 前 6 次为 194,523,136 B，第 7 次为 194,633,728 B。样本中位数分别 113,635,328 B（108.37 MiB）、194,523,136 B（185.51 MiB）；GDI 68→68、USER 40→40，线程 16→17。此为 **一个旧 build 的运行实例 30 秒短期采样**，不是当前 build 或要求的 5 轮独立冷启动 median。最后一次内存小幅增加，单个增量不足以判断趋势。用户最近报告 Task Manager 中启动约 40 MB、常用约 60 MB、短暂峰值约 70 MB，重复搜索未见持续单调增长；该观察与本段不同口径，不能直接比较。

没有为了采样终止用户已有单实例进程，也没有生成 5 次 cold-launch 样本。Phase 4F readiness 不能引用这组数据宣称冷启动稳定值。

## 27. Post-search Memory

SearchCore stress harness 完成 1,000 次查询后，该 harness process Private Bytes 从 38,449,152 B 降至 38,412,288 B；一次记录的 Working Set 为 107,307,008 B；GDI 9→9、USER 13→14、threads 23。它是独立 harness，而非 WPF Launcher renderer/window 的显存或完整 NativeHost memory 测量；起止快照不能证明 1,000 次真实 UI 查询后的长期 plateau。没有执行 100 query → hide → wait 或 1,000 次 mixed UI search。

## 28. Manager Memory Lifecycle

此前 process sample 没有 Electron；不能代表打开再关闭 Manager 的流程。本轮未测 Native-only → Manager open → 正常 Manager close → Native settle，也未多轮重复。Renderer/GPU/Utility 进程清零及 Manager reopen 可用性都标为 USER MANUAL VERIFICATION。

## 29. GDI / USER

Win32 icon cache 测试首次读取 100 个图标时 GDI 11→48，缓存上限 64，重复读取仍为 48；这显示缓存填充带来一次性资源上升后样本稳定。Search stress harness GDI 9→9、USER 13→14。没有执行 300 次 WPF show/hide、1000 次实际 UI 搜索、主题切换和 Manager cycles 后的 GDI/USER 采样序列。因此结论是 **自动化样本未显示单调增长；完整 Launcher 的 leak/plateau 状态未知**。

## 30. Startup Performance

本轮没有停止现存实例以测 process start → hotkey ready、snapshot search-ready、first show、first query。287 app 完整扫描在独立 harness 花费 16,091 ms；这是 full scan 工作量，不等价于读取快照的启动时间。Phase 4C 文档中的旧快照/索引路径测量约 61–62 ms、首次 query 约 11 ms 属于早期构建的历史数据，不作为当前版本数据。

## 31. Native Dependency Audit

NativeHost 使用 .NET 10 Windows Desktop self-contained `win-x64` 发布；项目引用未引入 Electron/Node/Chromium/V8/WebView2/CefSharp。NativeHost 的 Windows process sample 只看到 `WebTools.NativeHost`。Native search/actions harness 不启动 Manager。此结论来自项目引用、发布布局和当前进程快照；没有对任意未来外部插件/第三方 app 做依赖扫描。

## 32. Automated Tests

本轮复核实际执行：

- Vue/renderer TypeScript：`vue-tsc --noEmit -p tsconfig.web.json`，通过。
- Main/preload TypeScript：`tsc --noEmit -p tsconfig.node.json`，通过。
- Node tests：109/109 通过。测试入口通过当前 workspace bundled Node 直接调用，因为本执行 shell 没有可用的 `npm` 命令；这不是声称运行了字面上的 `npm test`。
- Electron production bundle：直接运行 `electron-vite build`，Main、preload、Launcher 和 Manager bundles 通过。
- NativeHost Release build：通过，0 warning / 0 error。
- NativeHost checks：39/39 通过，包括指定拖动区域、TextBox 实际文本 hit test、文字区拒绝拖动、右侧空白区允许拖动并通过阈值的回归检查。
- Native SearchCore stress：287 app catalog；本地 query n=950，中位数 0.030 ms / P95 0.127 ms；Everything n=50，中位数 170.441 ms / P95 183.485 ms。
- Icon check：100/100 Win32 sample resolves；64-entry bounded cache；repeat pass GDI 48→48。Phase 4E earlier packaged icon sample resolved 12/12。
- Launch action check：真实临时 `.lnk` 启动产生预期 marker，没有启动 Electron。
- Self-contained publish：`win-x64`, `UseAppHost=true`, `PublishSingleFile=false`, `PublishTrimmed=false`，通过；本轮没有把测试包安装到真实用户默认 profile，也没有声称它与既有安装的 payload 一致。
- Phase 4E acceptance installer：Electron Manager production payload + NativeHost Release self-contained payload；默认安装/快捷方式入口为 `WebTools.NativeHost.exe`，Manager 位于 `Manager\WebTools.exe`。独立 NSIS test build 成功；在包含中文和空格的隔离路径安装后，Native Manager discovery 校验通过；使用该临时安装的 Uninstall.exe 清理后目录已消失。
- `git diff --check`：报告和清单最终更新后再次运行；只出现 Git 关于既有文件 LF/CRLF 转换的提示，没有 whitespace error。

当前 shell 不提供可用 `npm` 命令，因此通过同一 workspace 中已安装的 Node 程序直接调用 package scripts 对应入口：执行了 `vue-tsc --noEmit -p tsconfig.web.json`、`tsc --noEmit -p tsconfig.node.json`、Node test runner 和 `electron-vite build`，均成功；这不是声称运行了字面上的 `npm run ...` 命令。测试过程产生的既有 `MODULE_TYPELESS_PACKAGE_JSON` 警告没有导致失败。

## 33. Manual Verification Required

以下项目本轮没有真实 UI 验收，不标 PASS：

- [ ] 停止全部 WebTools 进程后安装版冷启动；首次快捷键打开、第一字符、中文 IME、30 次 toggle。
- [ ] ESC、blur hide、内部控件交互、拖动区域，以及 100 次 query 后 hide/reopen。
- [ ] 英文、中文、全拼、首字母、alias、substring、`?`、`/`、`file:` 的输入、选择、Enter、点击和错误态。
- [ ] 从 Native Launcher 启动常见 Win32、桌面 `.lnk`、多个真实 Store app；确认启动后窗口隐藏。
- [ ] Win32、packaged、网站、文件夹/文件和 fallback 图标在真实窗口呈现，图标加载不影响选择。
- [ ] 网站 CRUD、搜索引擎/custom template 更新后即时生效和 NativeHost 重启后保持。
- [ ] Everything 有效、不可用、快速输入、空结果、打开文件/目录。
- [ ] Translation cold/warm handoff，Unicode/多行/长文本/快速重复，精确原文和 provider 调用行为。
- [ ] Search / Entries / Settings / Translation 页面复用 Manager；点击 × 后 Electron 主/renderer/GPU/utility 全部退出；Manager reopen；30 次开关无 orphan。
- [ ] 新/冲突 hotkey 事务，系统主题运行时变化，默认 compact/expanded，真实旧 Electron profile migration。
- [ ] 100/125/150% DPI、多显示器、鼠标当前屏幕、任务栏位置、visual hover/selection/scrollbar。
- [ ] 5 轮独立冷启动 30 秒 Private Bytes/Working Set median；100 搜索后 hide/wait；1000 mixed UI searches；300 show/hide；主题/图标/Manager cycles 后 GDI/USER 时间序列。

使用上述 Phase 4E acceptance 包做 GUI 验收。TextBox 文字区/空白区真实鼠标拖动、拖后第一字符和中文 IME 仍未执行。不要用强制结束 NativeHost 的方式推断普通 Manager close。Phase 4E 的 Manager-close 验收必须是在 NativeHost 留存、用户正常点击 Manager × 的条件下记录 Electron 进程归零。

## 34. Remaining Differences

1. **P2 acceptance gate：旧数据迁移** — 迁移测试 fixture 通过，但旧 Electron profile 的实际升级保留尚未验证。Phase 4F 前需用 profile 副本对照所有 Launcher 相关设置和记忆数据。
2. **未分级 acceptance gaps** — Translation/Manager 生命周期、热键实际注册、Everything 错误 UI、冷启动、主题视觉、DPI/多屏尚未实测。不能把这些未知项当成通过或缺陷已修复。
3. **P3 视觉差异** — WPF 与 Chromium 字体栅格、系统托盘菜单和控件原生渲染预计存在轻微平台差异；应确认不影响可读性和操作，再作为 intentional difference 接受。
4. **catalog labels** — 当前真实扫描有两个同名“火绒安全软件”记录，IDs 不同。它们可能对应不同有效启动命令，现有 identity 设计不会错误合并；本轮没有进一步验证它们是不是用户可见重复项。

## 35. Phase 4F Readiness

**当前不建议进入 Phase 4F。** 自动化检查通过，但 4F 的进入条件还缺运行时证据。优先完成：

1. Phase 4E Windows GUI checklist，尤其 cold boot、Translation cold/warm handoff、Manager 正常关闭后 Electron=0 和 30 次重开。
2. 使用隔离的真实旧用户 profile 副本验证 migration、hotkey 冲突事务、website/search engine/theme/app memory 保存与重启。
3. 按人工清单验证修复后的拖动区域；结果区和快捷卡片不得因为拖动手势失去交互。
4. 采集 5 轮独立 cold-start 30 秒 baseline 和完整 WPF UI 的 search/show-hide/GDI/USER 时间序列。

在这些项目验证完成前，Native 可称为 **可继续验收的 replacement candidate**，但还不能称为已通过 Phase 4E 的 production replacement，也不能建议删除 Electron Launcher。

## Phase 4E Final Acceptance

本节按用户提供的最终验收门槛记录当前证据。`USER MANUAL VERIFICATION` 表示本轮没有真实 Windows GUI 操作证据，不能按代码或单元测试推断通过。

### SearchBox Drag UX

- **代码行为：** SearchBar 的指定空白拖动面继续支持窗口拖动；QueryBox 只有在 WPF hit test 表明指针下方没有实际文字字符时才可成为拖动候选。文字内部点击、caret、拖选和双击选词仍由 TextBox 处理。手势必须越过系统拖动阈值才启动窗口拖动，按钮、结果、卡片和滚动条不会触发窗口拖动。拖动结束且 Launcher 仍可见时，代码会重新激活窗口并恢复 QueryBox 键盘焦点。
- **自动验证：** Native checks 39/39 通过；新增回归检查使用已加载 WPF TextBox 的实际字符布局、`GetCharacterIndexFromPoint` 与视觉命中源区分字符和右侧空白，并验证拖动来源和系统阈值。Microsoft API 对空白点返回无字符索引的行为见 [TextBox.GetCharacterIndexFromPoint](https://learn.microsoft.com/en-us/dotnet/api/system.windows.controls.textbox.getcharacterindexfrompoint?view=windowsdesktop-10.0)。
- **人工验收：** 真实鼠标拖动、caret/拖选/双击、拖动后第一字符、中文 IME composition、blur-hide 与拖动的交互仍为 **USER MANUAL VERIFICATION**；没有把自动 hit-test 结果当成 GUI PASS。

### Acceptance gates

| Gate | Current evidence | Status |
|---|---|---|
| A. Cold boot / Native-only | 源码和既有 harness 支持 Native-only 启动；本轮没有从完全退出状态启动安装包并检查进程组。 | USER MANUAL VERIFICATION |
| B. 30 次 hotkey、首字符、中文 IME | 没有真实键盘交互。 | USER MANUAL VERIFICATION |
| C. English / Chinese / 拼音 / initials / alias / substring / `?` / `/` / `file:`，搜索时 Electron=0 | 既有 SearchCore 自动检查通过；完整 Native GUI 和逐模式进程计数未测。 | USER MANUAL VERIFICATION |
| D. Win32 / `.lnk` / Store app 启动、图标及 Launcher hide | 既有 287 app catalog、100/100 图标和真实临时 `.lnk` launch smoke 通过；当前安装版的 GUI 端到端验收未测。 | USER MANUAL VERIFICATION |
| E. SearchBox drag 与 TextBox 原生交互 | WPF hit-test/threshold 回归自动检查通过；鼠标、选区、拖后焦点/IME 未实测。 | 自动检查通过；GUI 为 USER MANUAL VERIFICATION |
| F/G. Translation cold/warm handoff | 协议、队列和 acknowledgement 自动测试通过；Native Launcher 到实际 Manager/Translation 页面和原文交接未实测。 | USER MANUAL VERIFICATION |
| H/I. Manager 正常关闭归零、重开、30 cycles | 本轮没有点击 Manager 关闭按钮并跟踪 Main/Renderer/GPU/Utility，也没有执行 30 轮。 | USER MANUAL VERIFICATION |
| J. Settings sync 与重启持久化 | 数据/协议相关自动测试通过；hotkey/theme/engine/website 的 GUI 即时同步和重启持久化未实测。 | USER MANUAL VERIFICATION |
| K. Hotkey conflict transaction | 自动逻辑检查覆盖有限；与系统/其它进程实际冲突场景未测。 | USER MANUAL VERIFICATION |
| L. Existing-user migration | 只存在 fixture/代码路径验证；真实旧 Electron profile 副本迁移未做。 | USER MANUAL VERIFICATION |
| M. DPI / 多显示器 | 本轮未运行 100%/125%/150% 缩放或双屏 GUI 验收。 | USER MANUAL VERIFICATION |

### Memory and resources

- **USER-REPORTED Task Manager observations:** NativeHost fresh start approximately 40 MB; typical use approximately 60 MB; occasional short peak approximately 70 MB; repeated searches have not shown sustained monotonic growth. These are user-reported observations, not this turn's measurement and not a controlled Private Bytes/Working Set benchmark.
- 本轮没有对最新 acceptance build 进行 5 次独立冷启动采样，也没有按同一工具/指标完成 100/1000 次真实搜索、300 次 show/hide、30 次 Manager cycle 的 Private Bytes、Working Set、GDI、USER、Threads 时间序列。
- 因此本轮不能判定标准化 memory plateau 或 GDI/USER 无单调增长；也没有发现需要因此启动新内存优化的证据。当前不做内存优化。

### Remaining severity and final gate

- **P0：0 个已确认。**
- **P1：0 个已确认。** UI、Manager lifecycle 和迁移尚未完成运行时验收，因此这不是完整风险关闭结论。
- **P2：** Native-only cold boot、Translation cold/warm、Manager normal close 与 30 cycles、设置同步、旧用户 profile migration、drag/focus/IME 和一致口径内存/GDI/USER 采样仍是 Phase 4E gate。
- **P3：** DPI、多显示器及 Native/Electron 视觉差异仍待验收。

**NOT READY FOR PHASE 4F** — 尚未证明 Native-only cold boot / 搜索期间 Electron 为 0、Translation cold/warm、Manager 正常关闭后 Electron 归零及 30 次无 orphan、设置同步、旧用户数据迁移、真实 SearchBox/TextBox 鼠标和焦点/IME 行为，以及标准化内存 plateau/GDI/USER 无持续增长。测试安装包已准备好供人工完成这些 gate；本阶段不进入 Phase 4F。

## Q1–Q16

**Q1. Electron Launcher 有哪些用户可见能力 Native 仍然缺失？**
源码/核心检查没有确认缺失的 search command、app/site action 或 Manager 页面入口。拖动区域已收敛到搜索栏指定非交互表面；IME、完整 mouse/keyboard、错误 UI、视觉及设置即时同步还未实机验收，不能宣称行为全等。

**Q2. P0 数量？**
本轮已确认 0 个。该数字受未完成 GUI acceptance 的范围限制。

**Q3. P1 数量？**
本轮已确认 0 个。Manager/Translation 等关键流程仍有未知项，需完成测试后才能关闭风险。

**Q4. P2 中哪些必须在删除 Electron Launcher 前修复？**
真实旧用户数据迁移必须通过 profile-copy 验收。拖动代码已修复，但仍要用 checklist 做真实鼠标验收；其他 GUI acceptance gaps 也必须完成，但目前它们是未知项，不是已确认产品缺陷。

**Q5. Native-only cold boot 是否完全不需要 Electron？**
实现路径不在 Native startup 或普通 SearchCore 中启动 Electron；此前进程样本为 NativeHost only。但本轮隔离安装 smoke test 没有启动 NativeHost GUI，也没有做停掉全部程序后的 cold boot，因此当前 build 的运行时答案尚未确认。

**Q6. 普通搜索是否仍然完全不启动 Electron？**
SearchCore、catalog、icons 和 `.lnk` action harness 不启动 Electron；此前 idle 进程样本也没有 Electron。真实 Launcher GUI 的所有搜索前缀与当前 build 的进程数尚未端到端验证。用户报告基础搜索正常，但未提供每种模式的进程记录。

**Q7. Translation cold/warm handoff 是否稳定？**
未知。队列、ready、ack 和 stale request 自动化测试通过，但 cold/warm UI 和 provider 调用没有实测。

**Q8. Manager 正常关闭后 Electron 是否稳定归零？**
未知。本轮没有执行正常点击关闭按钮的 Electron process-tree 观察。

**Q9. 30 次 Manager open/close 是否存在 orphan？**
未知；没有执行 30 轮。

**Q10. 当前完整 Native Launcher 30 秒 idle Private Bytes median 是多少？**
当前 build 的 5 次独立 cold-start median 未测。前一 build 运行实例的 7 个间隔样本 median 为 113,635,328 B（108.37 MiB）；该 PID 现已退出。用户报告当前安装版 Task Manager 约 40 MB 启动，不是同一测量口径。

**Q11. 1000 searches / 300 show-hide 后资源是否 plateau？**
独立 SearchCore harness 的 1,000 查询起止 Private Bytes 没有增长（下降 36,864 B），GDI 9→9；这不是 WPF UI 查询。300 次 show/hide 未做，完整资源 plateau 未知。

**Q12. GDI/USER 是否有可复现的单调增长？**
此前样本未显示可复现的 GDI/USER 单调增长：NativeHost idle 30 秒样本 GDI 68→68、USER 40→40；icon cache harness 首轮 GDI 11→48，重复读取维持 48；SearchCore harness GDI 9→9、USER 13→14。用户报告重复搜索没有持续单调增长，但没有统一工具的 GDI/USER 时间序列。真实 Launcher 300 次 show/hide 与 Manager cycles 未测；不能据此前采样给当前 build 下最终无泄漏结论。

**Q13. Dark/Light/System 与 Electron 的主要视觉差异是什么？**
基础主题色值按源代码映射一致；WPF 与 Chromium 的字体抗锯齿、控件/托盘菜单、尺寸和 hover/selection 渲染可能不同。没有本轮运行时截图对照；System 动态主题切换也未手测。

**Q14. 旧 Electron 用户的数据迁移是否可靠？**
迁移 fixture 和 reload 自动测试通过，代码有一次性导入路径；真实旧用户 profile 升级和故障恢复未验证，因此目前不能判定已可靠。

**Q15. 当前是否已经达到 Native Launcher = production replacement candidate？**
还没有足够 acceptance 证据。可以作为持续验收的候选实现，但 Manager lifecycle、migration 和 Windows UX gates 尚未通过。

**Q16. 是否已经具备进入 Phase 4F — Remove Electron Launcher 的条件？**
否。Blockers：完成 cold/warm translation、Manager 正常关闭及 30 次重开；真实旧 profile migration；冷启动与快捷键/IME/拖动/视觉/DPI 实测；完整 Native UI 内存和 GDI/USER 测量。Phase 4E acceptance 安装包已可供人工测试；Electron Launcher、preload、Vue entry、Main paths 和 production installer 均保留。

## Git / Delivery State

当前分支：`codex/shared-ai-translation-2.0`。工作树含用户此前未提交的源码修改，以及 Native/docs/output/scripts 等未跟踪内容；本轮另外修改 Native 拖动区域与 Native checks，并新增 Phase 4E acceptance installer builder/NSIS 文件和人工验收清单、更新本报告。`git diff --check` 已运行；只出现 Git 关于现有文件 LF/CRLF 的提示，没有 whitespace error。没有 commit、push、PR 或 merge。
