# WebTools Native Launcher — Phase 4E Feature Parity & User Acceptance

审计日期：2026-09-29
Closeout 更新：2026-09-30
审计范围：当前工作树中的 Native WPF Launcher、Electron Manager/reference Launcher、NativeHost 与自动化检查。
结论状态：**Phase 4E 核心 GUI、隔离迁移、hotkey 冲突、五轮冷启动基线及资源归因通过。独立 No-UIA 真 WPF 3000-query workload 在首轮增长后趋于平台；UIA 对照显著放大了观测到的增长。P2 资源归因 blocker 已关闭。Phase 4E 完成并 READY FOR PHASE 4F；Phase 4F 尚未开始。**

2026-09-29 的原始实现轮只收敛 Native Launcher 拖动起始区域，并新增回归检查、Phase 4E 专用 acceptance installer 脚本和人工清单；没有修改 Electron Launcher、正式 installer 配置或数据结构。2026-09-30 closeout 增加了临时 profile migration、真实 hotkey conflict checks，以及隔离 A/B 资源归因测试驱动。Phase 4E acceptance 包已生成并完成隔离安装 smoke test。没有 commit、push、PR，也没有进入 Phase 4F。

## 2026-09-30 Acceptance Update

用户确认已安装的 Phase 4E acceptance build 通过核心 GUI 验收：Native 应用冷启动、普通搜索期间 Electron=0、全局快捷键/首字符/中文 IME、`?`/`/`/`file:` 命令、SearchBox TextBox 与指定空白拖动、Translation cold/warm handoff、Manager 正常关闭后 Electron 归零、NativeHost 保留、Manager reopen、5/30 次 Manager cycles 无 orphan/duplicate，以及 Settings 使用、同步和持久化。以上只按用户明确确认的范围记为 **PASS (USER CONFIRMED)**；Windows OS reboot 单独仍为 **NOT TESTED**。另完成真实 DataStore v2 schema 的临时目录迁移验收、真实 `RegisterHotKey` 冲突事务、五轮独立冷启动基线，以及新的隔离 A/B 资源归因。此前安装版 PID 23928 的 UIA 1000-query/300-toggle 结果保留为历史观测；新的同 build、新 PID、隔离 profile 对照表明 UIA 显著放大了测量到的增长，No-UIA workload 则在 R2/R3 趋平。本轮没有进入 Phase 4F。

## 1. Executive Summary

当前实现已经具备 Native-only 空闲架构：NativeHost 持有托盘、全局快捷键、WPF Launcher、搜索、目录快照和 Manager Controller；Electron Manager 由页面导航或翻译 handoff 按需启动。2026-09-30 用户确认了本报告开头列出的核心安装版 GUI 行为。当前 build 五轮资源基线已使用同一采样器采集；此前 process sample 与用户 Task Manager 读数仅作为历史记录，不混用口径或据此宣称优化收益。

本轮 fresh automated verification：TypeScript typecheck、Node 测试 109/109、Electron production build、NativeHost Release build、Native checks 46/46，以及真实 Windows `RegisterHotKey` 冲突事务。新增迁移覆盖基于真实 DataStore v2 字段并只使用临时 profile；没有访问或修改用户真实 profile/credentials。资源归因驱动通过显式参数启动隔离 NativeHost，profile 和 catalog snapshot 位于临时目录，named pipe 限制为当前用户；不启动 Manager、不调用 SearchCore 代替 UI、不激活结果。A/B 的 NativeHost 与 managed DLL SHA-256 一致；原已安装 PID 27632 在整个测试期间保持运行，采样期 NativeHostCount=2（原实例+隔离测试实例）、Electron=0。A/B 测试 Host 都经测试管道正常退出。此前的目录扫描、图标、临时 `.lnk` 和 acceptance installer 隔离安装结果仍作为 2026-09-29 历史证据保留，本轮没有重跑。拖动回归检查覆盖 WPF TextBox hit-test，真实鼠标和键盘焦点行为则由用户确认通过。

**没有发现已确认的 P0/P1 缺陷。** 核心 GUI/lifecycle、隔离迁移和真实 hotkey 冲突检查通过。五次冷启动 Private Bytes median 76,726,272 B（73.17 MiB），Working Set median 142,372,864 B（135.78 MiB），每轮 Electron=0。新的隔离 A/B 中，No-UIA 真 WPF workload 同一 PID 连续 3×1000 次查询，Private Bytes settle 为 123.04→124.96→125.88 MiB，R2→R3 +0.93 MiB；随后 300 次注册热键显隐后 settle 为 114.82 MiB。UIA 对照在另一新 PID 上以相同语料执行 1000 次查询，settle 为 278.23 MiB；相对自身 idle 的增长约 +149.98 MiB，而 No-UIA 首轮 settle 相对自身 idle 增长约 +20.82 MiB。两者 workload 增长相差约 129.15 MiB，托管堆也表现出显著差异。证据支持 UI Automation 显著放大了此前增长；它不证明 UIA 解释 100% 的历史增幅，也没有识别具体保留对象或 GC root。No-UIA R2/R3 已趋于平台，未触发 profiling 条件，资源 P2 gate 关闭。Win32/Store app 实际启动、图标呈现、Theme 视觉、DPI/多屏和 OS reboot 的剩余验证仍单独列出；没有把源码推断成 runtime PASS。

本轮 acceptance installer：`release\native-phase4e-acceptance-20260929-233750\WebTools-Native-Phase4E-Setup.exe`（2026-09-29 23:40:54 构建完成，167,637,148 bytes，SHA-256 `74B32B081172F52FD78D5484F55E89D07CDC0B515AA737B992176833909A70FD`）。它使用独立 Phase 4E NSIS 配置，安装入口为 `WebTools.NativeHost.exe`，Electron Manager 放在 `Manager\WebTools.exe`，由 Native ManagerController 按需发现/启动。测试安装到 `release\native-phase4e-acceptance-20260929-233750\smoke-install\Phase 4E 中文 空格验证`，检查通过后由该测试安装自身的卸载程序清理；没有触碰已有用户安装。

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

下方原始审计各节（第 4–32 节）保留 2026-09-29 当时的证据快照；第 33 节和文末 Final Acceptance 已按 2026-09-30 用户确认更新。旧节中的“未测”状态不代表当前状态；当前有效状态以 Final Acceptance 矩阵为准。

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

以下是初始代码/设计审计的风险快照；当前验收状态以文档后部的 **Phase 4E Final Acceptance** 为准。

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

初始审计时，SearchCore stress harness 完成 1,000 次查询后，该 harness process Private Bytes 从 38,449,152 B 降至 38,412,288 B；一次记录的 Working Set 为 107,307,008 B；GDI 9→9、USER 13→14、threads 23。它是独立 harness，而非 WPF Launcher renderer/window 的显存或完整 NativeHost memory 测量。后续完整 WPF UI 自动化时间序列见本报告 Resource Stress 节；该 harness 结果不能替代 UI 样本。

## 28. Manager Memory Lifecycle

此前 process sample 没有 Electron；不能代表打开再关闭 Manager 的流程。本轮未测 Native-only → Manager open → 正常 Manager close → Native settle，也未多轮重复。Renderer/GPU/Utility 进程清零及 Manager reopen 可用性都标为 USER MANUAL VERIFICATION。

## 29. GDI / USER

Win32 icon cache 测试首次读取 100 个图标时 GDI 11→48，缓存上限 64，重复读取仍为 48；这显示缓存填充带来一次性资源上升后样本稳定。Search stress harness GDI 9→9、USER 13→14。**截至初始审计**尚无 300 次 WPF show/hide 或 1000 次真实 UI 搜索后的 GDI/USER 序列；后续完整 workload 数值见本报告 Resource Stress 节。Manager cycles 的资源指标仍未采集。

## 30. Startup Performance

本轮没有停止现存实例以测 process start → hotkey ready、snapshot search-ready、first show、first query。287 app 完整扫描在独立 harness 花费 16,091 ms；这是 full scan 工作量，不等价于读取快照的启动时间。Phase 4C 文档中的旧快照/索引路径测量约 61–62 ms、首次 query 约 11 ms 属于早期构建的历史数据，不作为当前版本数据。

## 31. Native Dependency Audit

NativeHost 使用 .NET 10 Windows Desktop self-contained `win-x64` 发布；项目引用未引入 Electron/Node/Chromium/V8/WebView2/CefSharp。NativeHost 的 Windows process sample 只看到 `WebTools.NativeHost`。Native search/actions harness 不启动 Manager。此结论来自项目引用、发布布局和当前进程快照；没有对任意未来外部插件/第三方 app 做依赖扫描。

## 32. Automated Tests

2026-09-30 fresh-run results：

- Vue/renderer TypeScript：`vue-tsc --noEmit -p tsconfig.web.json`，通过。
- Main/preload TypeScript：`tsc --noEmit -p tsconfig.node.json`，通过。
- `npm test`：109/109 通过；Node 输出既有 `MODULE_TYPELESS_PACKAGE_JSON` 警告。
- `npm run build`：Electron Main、preload、Launcher 和 Manager production bundles 通过。
- `dotnet build native/WebTools.NativeHost/WebTools.NativeHost.csproj --configuration Release --runtime win-x64`：通过，0 warning / 0 error。
- NativeHost checks：本次最终重跑为 46/46；新增 Phase 4E resource-driver 参数隔离检查。另覆盖指定拖动区域、TextBox hit test、迁移边界与真实 `RegisterHotKey` 冲突回滚。
- `git diff --check`：最终 closeout diff 检查通过；Git 只提示既有 LF/CRLF 转换，不存在 whitespace error。

本轮已实际运行字面的 `npm run typecheck`、`npm test` 和 `npm run build`；Node tests 为 109/109，Node 输出既有 `MODULE_TYPELESS_PACKAGE_JSON` 警告。另完成 NativeHost Release build、46 项 Native checks、A/B real-WPF workload 与 PowerShell 脚本解析验证。

## 33. Remaining Manual / Environment Checks (historical snapshot)

用户已于 2026-09-30 确认核心 GUI/lifecycle 项目通过；不要要求重复。仍未取得当前轮真实证据的细项如下：

- [ ] 从安装版启动具体 Win32、桌面 `.lnk` 和多个 Store app；逐个确认目标应用与窗口隐藏。
- [ ] 真实 UI 中核对 Win32/Store/site/file/fallback 图标及快速 query 时没有错配。
- [ ] 单独执行系统已占用 hotkey 的 Settings UI 流程，检查 UI 错误提示和未保存行为；真实 RegisterHotKey 冲突以及旧注册保留已由本机自动检查覆盖。
- [ ] 100/125/150% DPI、多显示器、鼠标当前屏幕、任务栏边缘及主题视觉对照。
- [ ] Windows OS reboot（应用冷启动已通过，不降级）。
- [x] 当前 acceptance build 5 次独立冷启动约 30 秒资源指标 — PASS (MEASURED; USER NORMAL EXIT)。
- [x] 隔离 A/B No-UIA 真实 WPF 搜索与 300 次注册热键 show-hide 资源门槛 — **PASS (MEASURED)**；见 `Resource Attribution — isolated A/B`。旧 UIA-only 样本后续完成归因，不能再作为当前 blocker。

五轮基线通过用户正常托盘 Exit、代理正常启动和只读采样完成，逐轮确认进程退出；没有使用带强制清理的旧 smoke script。此历史快照中的 UIA-only 压力结果已由后续隔离 A/B 归因及 No-UIA 平台测试取代。Manager 正常关闭、Electron 归零、NativeHost 留存、reopen 与 5/30 周期功能仍依据用户此前确认。

## 34. Remaining Differences

1. **Historical snapshot — P2 resource attribution was unresolved at this point.** See the later `Resource Attribution — isolated A/B` section, which supersedes this snapshot and closes the resource gate.
2. **NOT TESTED：具体 app launch / icon presentation** — 当前轮没有安装版 Win32/Store app UI launch 和图标视觉证据；已有目录、图标和临时 `.lnk` 自动检查仍有效，但不替代安装版 UI。
3. **P3 / Phase 4G follow-up：** Windows OS reboot、额外 DPI/多显示器组合、长时间稳定性与 WPF/Chromium 视觉细节。应用冷启动已单独通过。
4. **catalog labels** — 此前真实扫描有两个同名“火绒安全软件”记录，IDs 不同，可能对应不同有效启动命令；没有观察证据表明这是用户可见问题。

## 35. Phase 4F Readiness

**Historical decision superseded by the later Resource Attribution section.** Windows OS reboot、DPI/多显示器和视觉细节仍按 Phase 4G/P3 follow-up 保留。Electron Launcher、preload、Vue entry、Main paths 和 production installer 均保留。

## Phase 4E Final Acceptance

本节为 2026-09-30 当前 closeout 的权威状态，覆盖并取代上方截至 2026-09-29 的 GUI 状态快照。状态严格区分用户确认、自动化证据和未测试项目。

### SearchBox Drag UX

- **代码行为：** SearchBar 的指定空白拖动面继续支持窗口拖动；QueryBox 只有在 WPF hit test 表明指针下方没有实际文字字符时才可成为拖动候选。文字内部点击、caret、拖选和双击选词仍由 TextBox 处理。手势必须越过系统拖动阈值才启动窗口拖动，按钮、结果、卡片和滚动条不会触发窗口拖动。拖动结束且 Launcher 仍可见时，代码会重新激活窗口并恢复 QueryBox 键盘焦点。
- **自动验证：** 当前 Native checks 46/46 通过，包含 SearchBox 字符 hit-test/拖动范围回归；真实鼠标交互另由用户本轮确认通过。Microsoft API 对空白点返回无字符索引的行为见 [TextBox.GetCharacterIndexFromPoint](https://learn.microsoft.com/en-us/dotnet/api/system.windows.controls.textbox.getcharacterindexfrompoint?view=windowsdesktop-10.0)。
- **用户验收：** 用户确认文字区维持 TextBox 行为、指定空白处拖动正常，拖动后立即输入可用。

### Acceptance gates

| Gate | Current evidence | Status |
|---|---|---|
| Native application cold start / Electron=0 | User-confirmed on installed acceptance build. | PASS (USER CONFIRMED) |
| Windows OS reboot | No reboot evidence. | NOT TESTED — Phase 4G follow-up |
| Global hotkey / immediate typing / first character / Chinese IME | User-confirmed. A specific count of 30 hotkey toggles was not recorded. | PASS (USER CONFIRMED) |
| Escape / blur-hide | Not included in this closeout's explicit confirmation list. | NOT TESTED |
| Normal search / Electron=0 | User-confirmed for Native Launcher. | PASS (USER CONFIRMED) |
| Pinyin / initials search contract | SearchCore fixtures cover full pinyin and initials; installed UI query corpus was not separately enumerated in the latest confirmation. | PASS (AUTOMATED); UI detail NOT TESTED |
| Saved website search and `/` | User-confirmed actual Launcher search; website synchronization/persistence also passed. | PASS (USER CONFIRMED) |
| `?` web search | User-confirmed actual Launcher search. | PASS (USER CONFIRMED) |
| `file:` / Everything | User-confirmed actual Launcher search. Detailed failure-path variants were not listed separately. | PASS (USER CONFIRMED); failure variants NOT TESTED |
| Win32 / installed `.lnk` / Store app launch | No installed app launch was included in this confirmation. Existing temporary `.lnk` action smoke test is separate. | NOT TESTED (installed UI) |
| Temporary `.lnk` launch action | Real temporary shortcut created its marker using typed launch action without starting Electron. | PASS (AUTOMATED) |
| App icon rendering / fallback in installed UI | Extraction/cache checks passed earlier; current installed UI rendering was not confirmed. | PASS (AUTOMATED); UI NOT TESTED |
| SearchBox drag / TextBox interaction | User-confirmed text behavior, designated blank-area drag, and typing after drag. | PASS (USER CONFIRMED) |
| Translation cold handoff | User-confirmed. | PASS (USER CONFIRMED) |
| Translation warm handoff | User-confirmed. | PASS (USER CONFIRMED) |
| Manager normal close / Electron process group=0 / NativeHost remains | User-confirmed using normal × close. | PASS (USER CONFIRMED) |
| Manager reopen / 5-cycle / 30-cycle / no orphan or duplicate | User-confirmed. | PASS (USER CONFIRMED) |
| Settings sync and restart persistence | User-confirmed. The closeout scope included hotkey, selected search engine, and website add/edit/delete sync. Custom-template editing was not separately enumerated. | PASS (USER CONFIRMED) |
| Hotkey conflict transaction | Hidden-WPF-HWND test used real Windows `RegisterHotKey`: occupied chord was rejected, old service chord remained registered, and temporary registrations were released. Settings error surface was not separately tested. | PASS (AUTOMATED) |
| Existing-user migration | Temporary profile used the actual legacy Electron DataStore v2 shape and production migration path; no real user profile was touched. | PASS (ISOLATED PROFILE ACCEPTANCE) |
| DPI / multi-monitor / theme visual comparison | No 100/125/150% or multi-monitor UI session in this environment. | NOT TESTED — ENVIRONMENT LIMITATION (P3) |
| Current-build five-run resource baseline | Five distinct PIDs; ~30-second idle samples; Electron=0 in all five; user tray Exit and actual process exit verified each round. | PASS (MEASURED; USER NORMAL EXIT) |
| Historical installed-process UIA run: 1000 UI search / 300 UI show-hide | PID 23928, 352 samples; SEARCH-100 171.89 MiB → SEARCH-1000 310.39 MiB; UIA attribution was then unknown. | Historical observation; superseded for resource attribution by the isolated A/B below |
| Isolated no-UIA real WPF repeat: 3000 queries + 300 toggles | Fresh PID 9148, 545 samples; R1/R2/R3 settle 123.04/124.96/125.88 MiB; Electron=0. | PASS — plausible plateau after first-round warm-up |
| Isolated UIA real WPF control: 1000 queries | Fresh PID 7796, 230 samples; settle 278.23 MiB; Electron=0. | Attribution control; materially higher workload growth than A |

### Existing-user migration acceptance

- Built an isolated `nook-data.json` v2 fixture from the actual legacy `DataStore` field names and exercised the production `LauncherStateStore.LoadOrMigrate` path with temporary test paths.
- First launch created Native state and preserved hotkey, theme, launcher display mode, selected/custom search engine template, saved website projection, and app search memory.
- Second launch loaded Native state without duplication or source rewrite; a valid existing Native state took precedence over legacy settings.
- Invalid optional website description normalized to an empty value while other fields migrated. Malformed legacy JSON fell back deterministically without changing the source. Corrupt Native state was retained under a `.corrupt-*` copy and did not trigger a legacy overwrite.
- A fake isolated SecretStore fixture and fake AI settings were excluded from `launcher-state.json`; the legacy file and fake secret file remained byte-for-byte unchanged. No real `%APPDATA%\Nook`, `%LOCALAPPDATA%\WebTools`, `launcher-state.json`, SecretStore, or credentials were accessed or modified.
- Result: **PASS (ISOLATED PROFILE ACCEPTANCE)** using a real schema-shaped temporary fixture; this is not an in-place migration test against a disposable Windows account.

### Current-build resource baseline

**PASS (MEASURED; USER NORMAL EXIT, 2026-09-30).** The user exited normally through the Native tray after each round. Before the next normal launch, NativeHost and WebTools Manager process counts were verified as zero. The sampler recorded each new PID after approximately 30 seconds idle and completed with exit code 0. After the fifth tray Exit, both process counts were again zero. No forced termination, forced GC, working-set trimming, debugger attachment, profile changes by the sampler, or cache disabling was used.

Environment: Windows 11 Pro 10.0.22631, build 22631, x64; timestamps below use UTC+08:00. Installed executable: isolated Phase 4E install\WebTools.NativeHost.exe. Its EXE and managed DLL match the acceptance staging directory under release/native-phase4e-acceptance-20260929-233750/stage/host:

- EXE SHA-256: 381CF80D7E8B6D7D2362B0F47CD01CFDAA29C29C90B533C63E4028EEB714C07E
- DLL SHA-256: 7580FC3094277FB494BA2208737552DE5641133868AA2E0288F5280C4FB71343
- Sampler: native/scripts/Measure-Phase4EResources.ps1, Baseline mode. CSV is saved after every round.
- Raw evidence (outside Git): external evidence archive\phase4e-resource-baseline-20260930-125515.csv

All rows are ProcessName=WebTools.NativeHost and ProcessPresent=True. Memory values are raw bytes.

| Run | PID | Sample time (UTC+08) | Wait | Private Bytes | Working Set | GDI | USER | Handles | Threads | Electron |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 26424 | 12:57:32.2871596 | ~30 s | 76,492,800 | 142,184,448 | 22 | 27 | 737 | 27 | 0 |
| 2 | 14184 | 13:00:20.0204091 | ~30 s | 76,808,192 | 142,577,664 | 22 | 27 | 734 | 28 | 0 |
| 3 | 25348 | 13:02:44.7644330 | ~30 s | 76,726,272 | 142,225,408 | 22 | 27 | 737 | 28 | 0 |
| 4 | 4680 | 13:04:49.4424087 | ~30 s | 76,558,336 | 142,462,976 | 22 | 27 | 730 | 27 | 0 |
| 5 | 18932 | 13:10:19.2903398 | ~30 s | 76,869,632 | 142,372,864 | 22 | 27 | 737 | 28 | 0 |
| Median per metric | — | — | — | 76,726,272 | 142,372,864 | 22 | 27 | 737 | 28 | 0 |

Each median is the third value after independently sorting five samples. Private Bytes median is **73.17 MiB**, Working Set median is **135.78 MiB** (1 MiB=1,048,576 bytes). These are distinct counters and do not equal Task Manager's grouped/private-working-set display. Similar cold-start values establish a repeatable idle baseline, not a same-process workload plateau or a no-leak conclusion. Historical Phase 4C/4D samples are not used to claim improvement.

### Historical resource stress

| Workload | Before | Peak | After / plateau | Status |
|---|---|---|---|---|
| Historical UIA-only 1000 mixed real WPF UI queries | Existing PID: IDLE-START last-10 median 155.10 MiB Private Bytes | 323.20 MiB Private Bytes / 364.17 MiB Working Set across full run | Search settle: first-10 median 309.24 MiB; last-10 309.08 MiB, 60 seconds | Historical result: attribution was unresolved then; superseded by the isolated A/B below |
| 300 Launcher show/hide | After search settle ~309.08 MiB Private Bytes | HOTKEY checkpoints 311.48–321.23 MiB; full-run peak shown at left | Hotkey settle: first-10 median 320.98 MiB; last-10 321.19 MiB, 60 seconds | Workload complete; no continued monotonic rise within final settle, but plateau is materially above pre-query state |
| Manager open/close resource metrics | — | — | — | NOT TESTED — lifecycle pass is USER CONFIRMED, but no resource samples were taken |

The existing SearchCore harness is not a substitute for WPF UI stress. Earlier partial manual data is retained below as historical evidence; the completed run and its instrumentation limits are documented after it.

### Historical partial real UI resource stress — ended by user, 2026-09-30

The user explicitly chose to end high-count manual stress and leave this gate incomplete. No acceptance thresholds were relaxed. Product runtime was not changed. The sampler and usage instructions received small fixes: Stress attaches to an existing single NativeHost; search batches total 1000 rather than 100 + 1000.

Both sessions sampled NativeHost PID **23928** at approximately one-second intervals using the same installed acceptance build and current user state. NativeHost was not restarted or terminated; no debugger, forced GC, working-set trimming, profile modification by the sampler, or cache clearing was used. Raw files remain outside Git:

- First CSV: external evidence archive\phase4e-resource-stress-20260930-133834.csv — 856 samples, 13:38:35.3790256–13:53:00.5205668 UTC+08. The user confirmed batches 1–5, totaling **500 real WPF query updates**, with search functioning. The script does not independently count queries; checkpoints are based on explicit user confirmation.
- SEARCH-BATCH-05 recorded 11 nonzero Electron samples, 13:50:16.6977874–13:50:26.7383950, count 1 then 4 then 0. The user confirmed opening Manager/Translation and closing it. This is workload-control interruption, not evidence that ordinary query input unexpectedly starts Electron. The CSV cannot pass the all-Native/Electron=0 stress criterion.
- Second CSV: external evidence archive\phase4e-resource-stress-20260930-135325.csv — 223 samples, 13:53:26.3527934–13:57:10.9815492 UTC+08. Only the sampler was restarted; NativeHost was preserved. Every sample has Electron=0. No completed batch was explicitly confirmed in this session; the user ended it while waiting for batch 1.
- All 1079 samples show the same NativeHost PID present and NativeHostCount=1. Both samplers were intentionally interrupted using their stop signal and console cancellation; exit code 1 represents cancellation, not a completed PASS. NativeHost PID 23928 remained running and Manager count was 0 afterward.

First-session checkpoints (memory in MiB; 1 MiB=1,048,576 bytes):

| Observation | Private Bytes | Working Set | GDI | USER | Handles | Threads |
|---|---:|---:|---:|---:|---:|---:|
| Before (last initial idle sample) | 72.83 | 135.10 | 22 | 27 | 734 | 27 |
| SEARCH-100 | 114.35 | 188.28 | 71 | 41 | 826 | 23 |
| SEARCH-200 | 132.51 | 201.20 | 65 | 41 | 848 | 20 |
| SEARCH-300 | 126.52 | 195.64 | 68 | 41 | 837 | 21 |
| SEARCH-400 | 130.06 | 196.93 | 65 | 40 | 860 | 23 |
| SEARCH-500 | 134.79 | 202.26 | 67 | 41 | 853 | 23 |
| Whole CSV peak (metrics independently maximized) | 144.61 | 212.38 | 73 | 48 | 875 | 29 |

The peak row independently maximizes each metric over the entire first CSV, including Manager navigation and waits; it is not a clean Native-only workload peak. Each checkpoint is its latest actual sample after user confirmation. Pauses between confirmations, including an interrupted conversation, are part of the recording; elapsed stage duration does not independently prove query count.

**Resource assessment: INCONCLUSIVE FOR THE FULL GATE.** Private Bytes after initial growth fluctuates across checkpoints (114.35, 132.51, 126.52, 130.06, 134.79 MiB). GDI (71, 65, 68, 65, 67), USER (41, 41, 41, 40, 41), handles (826, 848, 837, 860, 853), and threads (23, 20, 21, 23, 23) are not strictly monotonic in this limited sequence. This is neither a reproduced sustained-leak finding nor enough evidence for a stable plateau. Working Set is auxiliary evidence. No After-1000, SEARCH-FINAL-SETTLE, hotkey checkpoint, or HOTKEY-FINAL-SETTLE exists; those remain incomplete/not tested. Manager resource before/peak/after remains separately unmeasured.

### Historical UIA-only automated real WPF resource stress — 2026-09-30

After the user ended repetitive manual input, a test-only automation path was added to the existing sampler. A smoke run confirmed UI Automation reaches the installed WPF `QueryBox`, that `ValuePattern.SetValue` triggers the real `TextChanged`/`RenderQuery` flow and renders actual result rows, and that the configured global hotkey shows and hides the actual window. An additional `file:codex` smoke waited for the real asynchronous Everything search to finish. The full driver then completed the planned workload without clicking/opening any result or starting Manager.

- Installed build: `isolated Phase 4E install\WebTools.NativeHost.exe`; existing NativeHost PID **23928** was reused. The process was not restarted or terminated, and the sampled 5-run cold-start baseline belongs to different PIDs, so it is not a like-for-like before measurement.
- Workload: 1,000 actual WPF TextBox value replacements in a repeated ten-query mix (`visual`, Chinese, pinyin, initials, saved website, `/`, `?`, and two `file:` searches); each update waited for the current WPF presentation, and file queries waited until the Everything busy status ended. Then 300 show/hide cycles used Win32 `keybd_event` for the configured `Control+Alt+Space`; Windows dispatched the real registered hotkey to the NativeHost. This is synthesized keyboard input, not a claim of 300 physical keyboard presses.
- Sampling: one-second NativeHost Private Bytes, Working Set, GDI, USER, Handles, Threads, PID/process presence, Electron count, NativeHost count, and workload driver. **352 samples** covered 14:40:26–14:46:21 UTC+08. Every sample had PID 23928 present, NativeHostCount=1, ElectronProcessCount=0; all 1,000-query and 300-cycle checkpoints were captured. Launcher ended hidden; Manager remained absent.
- Raw CSV (outside Git): `external evidence archive\phase4e-resource-stress-20260930-144026.csv`.

Checkpoint trend (MiB; 1 MiB=1,048,576 bytes):

| Search updates | Private Bytes | Working Set | GDI | USER | Handles | Threads |
|---:|---:|---:|---:|---:|---:|---:|
| IDLE-START first-10 median | 131.51 | — | — | — | — | — |
| IDLE-START last-10 median | 155.10 | — | — | — | — | — |
| 100 | 171.89 | 217.77 | 64 | 50 | 800 | 28 |
| 200 | 198.52 | 243.07 | 64 | 50 | 798 | 28 |
| 300 | 208.45 | 253.74 | 64 | 49 | 792 | 27 |
| 400 | 229.28 | 273.89 | 64 | 49 | 787 | 25 |
| 500 | 242.93 | 287.43 | 64 | 50 | 799 | 28 |
| 600 | 260.44 | 304.64 | 64 | 50 | 793 | 26 |
| 700 | 279.98 | 323.66 | 64 | 51 | 795 | 27 |
| 800 | 287.20 | 330.59 | 64 | 49 | 794 | 26 |
| 900 | 309.89 | 352.79 | 64 | 49 | 796 | 25 |
| 1000 | 310.39 | 353.34 | 64 | 49 | 794 | 25 |
| Search 60-second settle, first-10 median | 309.24 | — | 64 | — | — | — |
| Search 60-second settle, last-10 median | 309.08 | — | 64 | — | — | — |
| Hotkey 300 checkpoint | 320.98 | 361.29 | 86 | 42 | 770 | 20 |
| Hotkey 60-second settle, first-10 median | 320.98 | — | 86 | — | — | — |
| Hotkey 60-second settle, last-10 median | 321.19 | — | 86 | — | — | — |

The **workload completed, but the resource acceptance did not pass**: the search checkpoints rise at every 100-query checkpoint from 171.89 to 310.39 MiB Private Bytes. The first 30-second idle window also rises from a first-10 median of 131.51 to a last-10 median of 155.10 MiB. Private Bytes is nearly flat during each final 60-second settle, while hotkey toggles add a further ~12 MiB relative to the search-settle median and GDI settles at 86 versus 64 during search. These observations establish an allocation increase under this run, not a product leak diagnosis.

The driver calls the actual WPF `TextBox` and goes through its event/search/result/icon path, but `ValuePattern.SetValue` is not identical to physical key-by-key typing. Repeated UI Automation tree queries can also instantiate/cache accessibility peers in the measured process. We cannot separate those costs from normal WPF query allocations using this run. No forced GC, working-set trim, debugger, cache clearing, profile edits, application restart, or product runtime change was performed. Because the cause is not isolated and the query checkpoints show sustained upward growth, no automatic product fix was attempted. Preserve this as **P2 / resource acceptance unresolved**; do not mark the gate PASS based only on the final 60-second flat samples.

### Resource Attribution — isolated A/B (2026-09-30)

This section is the current resource source of truth. It supersedes the earlier PID 23928 UIA-only run and the prior `INCONCLUSIVE` resource status above.

**Build and process isolation**

- NativeHost was published from the current source as .NET 10, `win-x64`, self-contained, with the non-single-file release layout. Both experiments used the exact same published files:
  - EXE SHA-256: `18BE0D1FB5B8FBEA9BD10BC59D2A8B04D8EAC487A38CE1C350CD26AA6C1E2E04`
  - managed DLL SHA-256: `11E9B7224D1F4BED4BFD79976D0F81096D99833DC13AFDE2B5E42BAB9E30270F`
- Existing installed NativeHost PID **27632** was preserved throughout. A and B used fresh isolated PIDs **9148** and **7796**, respectively. Each sampled row intentionally reports NativeHostCount=2 (installed instance + test instance), ElectronProcessCount=0, and the expected target PID.
- A/B used separate temporary profiles copied from the same user-state/catalog snapshot and the same exact ten-query corpus: `visual`, `微信`, `weixin`, `wx`, `bilibili`, `/bili`, `?test`, `file:codex`, `file:测试`, `控制面板`.
- One shared sampler collected one-second Private Bytes, Working Set, GDI, USER, Handles, Threads, PID/presence, ElectronProcessCount, NativeHostCount, scenario, checkpoint, and driver fields. Both test processes closed normally through the explicit current-user-only test pipe. No process was force-terminated; no forced GC, working-set trim, cache clear, debugger, or user profile mutation was used.
- Test-only mode created a real WPF `MainWindow` and `QueryBox`, omitted the test process tray to avoid colliding with the installed tray, and used an isolated random hotkey `Control+Alt+Shift+F12`. Normal NativeHost startup and tray behavior remain behind the unchanged non-test path.
- For stages with ten settle samples, reported medians are the conventional median: the mean of the two center values after sorting; MiB values are rounded to two decimals. The B-1000 row is its latest checkpoint sample.

**Experiment A — No-UIA real WPF**

The driver set the real `QueryBox.Text` on the WPF Dispatcher. This raised the normal `TextChanged` event and ran the real `RenderQuery`, SearchCore/Everything, result collection/binding, visible icon loading, and WPF layout path. The driver did not import or call UI Automation APIs. Each query waited for real WPF presentation and asynchronous Everything/icon work. After 30 seconds idle it ran 3 consecutive rounds of 1000 queries in the same PID; each round hid the Launcher and settled for 60 seconds. It then drove 300 registered `WM_HOTKEY` show/hide cycles using synthesized Ctrl+Alt+Shift+F12 input and settled 60 seconds.

| Checkpoint | Private Bytes MiB | Working Set MiB | GDI | USER | Handles | Threads | Electron |
|---|---:|---:|---:|---:|---:|---:|---:|
| A idle, last-10 median | 102.22 | 161.03 | 54 | 41.5 | 853 | 29 | 0 |
| Round 1 settle, last-10 median | 123.04 | 181.88 | 54 | 40 | 846 | 23 | 0 |
| Round 2 settle, last-10 median | 124.96 | 183.07 | 54 | 39.5 | 839.5 | 23 | 0 |
| Round 3 settle, last-10 median | 125.88 | 183.13 | 55 | 35 | 829 | 16 | 0 |
| Hotkey 300 settle, last-10 median | 114.82 | 172.33 | 60 | 35 | 818 | 17 | 0 |

Round 1→2 adds 1.92 MiB Private Bytes; Round 2→3 adds 0.93 MiB. The latter two settles are approximately flat rather than a repeated workload-sized increase. GDI varies between 54 and 55 during search and between 56 and 61 at hotkey checkpoints, then settles at 60; USER, handles, and threads stay bounded and do not rise monotonically. Managed heap samples (`GC.GetTotalMemory(false)`, no forced collection) are non-monotonic: idle 8.87 MiB; R1 settle 8.50 MiB; R2 18.12 MiB; R3 11.06 MiB; hotkey settle 9.07 MiB. The icon cache remains bounded at 32 entries / 21,504 bitmap bytes during query rounds.

**Experiment B — UI Automation control**

A separate fresh NativeHost process, same build/profile snapshot/corpus/sampler and settle durations, used the existing `UIAutomationClient` `AutomationElement`/`ValuePattern.SetValue` path on the real WPF QueryBox for 1000 updates. It then hid the window and settled for 60 seconds. No result was activated.

| Checkpoint | Private Bytes MiB | Working Set MiB | GDI | USER | Handles | Threads | Electron |
|---|---:|---:|---:|---:|---:|---:|---:|
| B idle, last-10 median | 128.26 | 193.40 | 54 | 44 | 869.5 | 31 | 0 |
| Query 1000, latest checkpoint | 279.57 | 343.86 | 54 | 42 | 862 | 24 | 0 |
| B settle, last-10 median | 278.23 | 341.69 | 54 | 36 | 855 | 20 | 0 |

Managed heap was 8.87 MiB at idle, 148.83 MiB at query 1000, and 149.04 MiB after settle. The B workload increased Private Bytes by about 149.98 MiB over its own idle value. A Round 1 increased by about 20.82 MiB over its own idle; the workload-growth difference is about 129.15 MiB. Idle baselines differ between independent processes, so the attribution compares within-process deltas in addition to absolute checkpoints.

**Attribution and profiling decision**

- **UIA attribution: SUPPORTED (substantial contribution in this controlled run).** The large B managed-heap and Private-Bytes increase, compared with A's first-round growth and subsequent plateau, supports that UI Automation provider/tree activity materially amplified the previous UIA-only observation. This does not prove UIA explains 100% of the historical 171.89→310.39 MiB increase, does not prove every UIA allocation remains live, and does not identify an object type or GC root.
- **Product plateau: PASS for this workload.** A completed 3000 real-WPF queries in the same PID plus 300 registered-hotkey toggles; all sample rows kept the target process present, NativeHostCount=2 as expected, Electron=0; search/render/icon work returned; Windows GUI resource counts stayed bounded; the R2→R3 settle delta was 0.25 MiB. The no-UIA run shows first-round warm-up/allocation followed by a plausible plateau. It does not claim Private Bytes returns to cold baseline.
- **Profiling: NOT REQUIRED.** R2→R3 did not show meaningful sustained growth, so the conditional profiling trigger was not met. No `dotnet-gcdump`, `dotnet-dump`, PerfView, forced-GC diagnostic, heap snapshot, or retention-root claim was produced. Exact object-level UIA/product retention remains unknown.
- No product runtime redesign or memory fix was made. The only runtime-source additions are strictly opt-in test instrumentation; regular startup does not enter this mode.

**Artifacts outside Git**

- Run directory: `external evidence archive\run-20260930-155307`
- A process CSV: `phase4e-resource-stress-A-1-20260930-155309.csv` (545 samples)
- A managed checkpoints: `phase4e-managed-A-1-20260930-155309.csv`
- B process CSV: `phase4e-resource-stress-B-1-20260930-160731.csv` (230 samples)
- B managed checkpoints: `phase4e-managed-B-1-20260930-160731.csv`
- `run-manifest.json` records PIDs, hashes, preserved process IDs, hotkey, and final experiment status. No dumps/traces were generated.

The workload and both test Hosts completed and exited normally. The first report invocation exposed two post-workload reporting defects (numeric sorting of `A-Rn-count` labels and a missing `endedAt` manifest field); neither affected sampling or workload. The scripts were fixed, then the saved A/B CSVs were revalidated without rerunning either experiment. The final resume/validation command completed with exit code 0.

### Remaining severity and final gate

- **P0：0 个已确认。**
- **P1：0 个已确认。** 核心 GUI/lifecycle、隔离迁移和真实 hotkey 冲突检查通过；没有发现明确严重缺陷。
- **P2：0 个已确认/未关闭。** 唯一资源归因 blocker 已由独立 A/B 关闭；没有通过强制 GC 或屏蔽真实搜索/icon/Everything 工作负载来降低指标。
- **P3 / follow-up：** Windows OS reboot、DPI、多显示器、WPF/Electron 视觉细节和长时间稳定性；它们不阻止此 Phase 4E resource closeout。
- **仍建议人工验收但非本次阻塞：** 安装版具体 Win32/Store app launch、图标呈现、Theme 视觉、Escape/blur-hide 与 Settings 冲突错误 UI 没有在本次资源驱动中逐项验证；不将其推断为 PASS。

**PHASE 4E COMPLETE — READY FOR PHASE 4F.** No-UIA repeated real-WPF workload reached a plausible plateau; the isolated UIA control substantially amplified observed growth; process safety and the required Windows resource counters remained bounded. Profiling was not triggered. **Phase 4F has NOT started.** Electron Launcher source, preload, Vue entry, legacy Main paths, and production installer remain intact. P3 OS/DPI/multi-monitor/visual/long-duration items remain follow-up work and do not reopen this Phase 4E gate.

## Q1–Q16

以下问答保留初始审计版本；其中旧的验收状态已由上述 2026-09-30 Final Acceptance 矩阵取代。

**Q1. Electron Launcher 有哪些用户可见能力 Native 仍然缺失？**
源码/核心检查没有确认缺失的 search command、app/site action 或 Manager 页面入口。拖动区域已收敛到搜索栏指定非交互表面；IME、完整 mouse/keyboard、错误 UI、视觉及设置即时同步还未实机验收，不能宣称行为全等。

**Q2. P0 数量？**
本轮已确认 0 个。该数字受未完成 GUI acceptance 的范围限制。

**Q3. P1 数量？**
本轮已确认 0 个。Manager/Translation 等关键流程仍有未知项，需完成测试后才能关闭风险。

**Q4. P2 中哪些必须在删除 Electron Launcher 前修复？**
真实旧用户数据迁移必须通过 profile-copy 验收。拖动代码已修复，但仍要用 checklist 做真实鼠标验收；其他 GUI acceptance gaps 也必须完成，但目前它们是未知项，不是已确认产品缺陷。

**Q5. Native-only cold boot 是否完全不需要 Electron？**
用户于 2026-09-30 确认：退出 NativeHost 后重新启动已安装 acceptance build，启动成功且 Electron 进程数为 0。该项覆盖应用冷启动，不代表 Windows OS 重启；普通搜索期间 Electron=0 仍需另测。

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
**Historical result, superseded by the isolated A/B section above.** The PID 23928 UIA-only run completed 1000 searches and 300 registered-hotkey show/hide cycles. Its Private Bytes checkpoints rose from 171.89 to 310.39 MiB; attribution was unknown at that time. The later controlled A/B supports UI Automation as a substantial contributor and the repeated No-UIA workload reached a plausible plateau. Do not treat this earlier row as the current resource gate decision.

**Q12. GDI/USER 是否有可复现的单调增长？**
**当前 A/B 样本：** No-UIA 搜索 settle 的 GDI 为 54–55、热键 settle 为 60；USER 从 42 降至 35，handles 从 854 降至 818，threads 从 30 降至 17。没有观察到重复 workload 或 settle 中持续单调增长。UIA control settle 的 GDI/USER/handles/threads 分别为 54/36/855/20。Manager cycles 的资源指标仍未采集；这些数据不用于声称所有场景无泄漏。

**Q13. Dark/Light/System 与 Electron 的主要视觉差异是什么？**
基础主题色值按源代码映射一致；WPF 与 Chromium 的字体抗锯齿、控件/托盘菜单、尺寸和 hover/selection 渲染可能不同。没有本轮运行时截图对照；System 动态主题切换也未手测。

**Q14. 旧 Electron 用户的数据迁移是否可靠？**
迁移 fixture 和 reload 自动测试通过，代码有一次性导入路径；真实旧用户 profile 升级和故障恢复未验证，因此目前不能判定已可靠。

**Q15. 当前是否已经达到 Native Launcher = production replacement candidate？**
还没有足够 acceptance 证据。可以作为持续验收的候选实现，但 Manager lifecycle、migration 和 Windows UX gates 尚未通过。

**Q16. 是否已经具备进入 Phase 4F — Remove Electron Launcher 的条件？**
资源 gate 已完成，Phase 4E 结论为 **READY FOR PHASE 4F**；Phase 4F 尚未开始。Windows OS reboot、额外 DPI/多显示器、长时间运行和视觉细节仍是 P3 follow-up，不是本次阻塞。Electron Launcher、preload、Vue entry、Main paths 和 production installer 均保留。

## Git / Delivery State

当前分支：`codex/shared-ai-translation-2.0`，HEAD `9dbbace29f5f92e2729826be27e467dd9528ba19`，upstream `origin/codex/shared-ai-translation-2.0`。本轮改动限于本验收报告、人工清单、Native checks harness 和只读资源采样脚本；CSV 保存在 Git 外。没有修改产品代码、README 或 4A–4D 内容。没有 commit、push、PR、tag、release 或 merge。
