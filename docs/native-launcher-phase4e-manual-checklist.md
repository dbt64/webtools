# WebTools Native Launcher — Phase 4E Manual Acceptance Checklist

Acceptance package: `WebTools-Native-Phase4E-Setup.exe`<br>
Installer path: `release\native-phase4e-acceptance-20260929-233750\WebTools-Native-Phase4E-Setup.exe`<br>
Build timestamp: `2026-09-29 23:40:54`<br>
SHA-256: `74B32B081172F52FD78D5484F55E89D07CDC0B515AA737B992176833909A70FD`<br>
Test environment: record Windows version/build, display scale, installed path, and package version before testing.

## 2026-09-30 Closeout Status

The user confirmed the core Windows GUI checks listed below passed. Do not ask them to repeat those checks. `[x]` items identify **PASS (USER CONFIRMED)**, **PASS (ISOLATED PROFILE ACCEPTANCE)**, or **PASS (MEASURED; USER NORMAL EXIT)** as labeled. Five current-build cold-start resource samples are now complete. Real UI resource stress, OS reboot, app-by-app Win32/Store launch, and DPI/multi-monitor remain separate.

## Before You Start

- Use the Phase 4E acceptance installer. It is separate from the production installer and may show an unsigned-publisher prompt.
- Keep the current user profile intact. Section L records a temporary real-schema test fixture; never run migration against the live user profile.
- For process and memory checks, use one consistent tool and the same columns for every sample. Prefer Process Explorer columns for Private Bytes, Working Set, GDI Objects, USER Objects, Threads, PID, and Start Time.
- Do not use GC.Collect, EmptyWorkingSet, or SetProcessWorkingSetSize during measurements.

## A. Cold Start

- [x] **Native-only launch — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 从托盘菜单退出 WebTools；在任务管理器确认 NativeHost 和 WebTools/Electron 进程都结束；从 Phase 4E 快捷方式启动。

  **PASS：** `WebTools.NativeHost.exe` 存在；Electron/WebTools Manager 进程数为 0；托盘图标出现，Launcher 热键可用。

## B. Hotkey / IME

- [x] **Hotkey first character — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 按 `Ctrl+Alt+Space`，立即输入 `utools`。

  **PASS：** 第一个字符不丢失；输入框保持焦点；第一条结果自动选中；Enter 能打开所选结果。

- [x] **Chinese IME — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 快捷键唤出后立即切换中文输入法，输入多个中文应用名称。

  **PASS：** composition 不被打断；首字符不丢失；输入法候选框正常；结果随输入更新。

- [x] **Global hotkey behavior — PASS (USER CONFIRMED 2026-09-30)**

  **已确认：** 快捷键唤出与立即输入正常。

- [ ] **Escape / blur-hide**

  **操作：** 连续用快捷键开关窗口；再分别用 ESC、点击桌面和切换其他应用隐藏窗口。

  **PASS：** 开关状态正确；ESC 和失焦隐藏有效；点击 Launcher 内部控件不会提前隐藏。

## C. Search

- [x] **Native Launcher search — PASS (USER CONFIRMED 2026-09-30)**

  **已确认：** Native Launcher 搜索正常，搜索期间 Electron=0。全拼/首字母的核心搜索合同有自动化检查；最新用户确认没有逐项列出完整 query corpus。

- [ ] **Pinyin / initials installed UI corpus — NOT TESTED separately**

- [x] **Search commands — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 分别测试 `?query`、`/query` 和 `file:query`。

  **PASS：** `?` 使用当前搜索引擎；`/` 只搜索已保存网址；`file:` 搜索文件/文件夹；各模式的上下键与 Enter 正常。

## D. App Launch / Icons

- [ ] **App discovery and launch**

  **操作：** 搜索并启动开始菜单应用、用户桌面快捷方式、公共桌面快捷方式、普通 Win32 程序、`.lnk` 和至少 3 个已安装的 Store 应用。

  **PASS：** 名称能搜索到；Enter/鼠标点击启动正确应用；Launcher 按现有行为隐藏；普通搜索不启动 Electron。

- [ ] **Icons and fallback**

  **操作：** 检查 Win32、快捷方式、Store、网站、文件/文件夹、托盘和品牌图标，并观察快速修改 query 时的异步图标。

  **PASS：** 可解析图标显示正确；无法解析时显示通用图标；图标加载不改变结果顺序或键盘选择；无明显图标闪烁/错配。

## E. Website / Web Search

- [x] **Website CRUD and synchronization — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 打开 Manager 的 Entries，新增、编辑、删除一个测试网址；每次操作后返回 Launcher 搜索。

  **PASS：** Native Launcher 即时显示最新网站；按名称和 URL 片段搜索、打开都正确；重启 NativeHost 后设置仍在。

- [x] **Selected search engine — PASS (USER CONFIRMED 2026-09-30)**

  **已确认：** 更换 selected search engine、`?` 搜索、同步和重启持久化通过。Custom template editing was not separately enumerated in the confirmation.


## F. Everything

- [x] **`file:` / Everything search — PASS (USER CONFIRMED 2026-09-30)**

  **已确认：** `file:` 实际 Launcher 搜索可用。

- [ ] **Chinese filename/path and Everything unavailable failure variants — NOT TESTED separately**

  **后续步骤：** 如需验收不同故障路径，在测试环境关闭 Everything 并检查可理解的反馈；不要将该步骤写成已通过。

## G. Translation

- [x] **Cold handoff — PASS (USER CONFIRMED 2026-09-30)**

  **前置：** Manager/Electron 进程不存在。

  **操作：** 在 Native Launcher 对英文、中文、多行文本分别执行翻译入口。

  **PASS：** Manager 只启动一个进程组；Translation 页面打开；原文逐字一致；没有丢失第一次 handoff。翻译请求遵守当前自动翻译设置和所选 provider。

- [x] **Warm handoff — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** Manager 已打开时连续提交不同文本，包含 Unicode 和较长文本。

  **PASS：** 复用现有 Manager；最后一次请求显示对应原文；旧响应不覆盖新输入；切换新原文会清除旧结果和错误。

## H. Manager Lifecycle

- [x] **Navigation and normal close — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 从 Native 托盘依次打开 Search、Entries、Settings、Translation；正常点击 Manager 窗口关闭按钮 ×。

  **PASS：** 所有入口复用同一 Manager 窗口/进程组；关闭后 NativeHost 和托盘仍在；Electron Main、Renderer、GPU、Utility 进程最终都为 0；之后可重新打开 Manager。

- [x] **30 Manager cycles — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 重复打开 Manager、等待启动、正常点击 ×，共 30 次。

  **PASS：** 每次关闭后 Electron 进程最终归零；没有重复 Manager、orphan/zombie process 或启动失败；Native Launcher 始终可用。

## I. Settings Sync

- [x] **Hotkey transaction and persistence — PASS (USER CONFIRMED for settings sync/persistence, 2026-09-30)**

  **操作：** 更改为一个未占用快捷键并重启；再尝试一个已被系统/应用占用的快捷键。

  **已确认：** Settings runtime acceptance 和持久化通过。实际系统 hotkey 冲突事务另由 Native checks 使用真实 `RegisterHotKey` 自动验证通过；Settings 页面错误提示样式与冲突后 UI 未单独目测。

- [x] **Launcher settings persistence — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 修改 theme、search engine、网站、compact/expanded 模式；通过搜索打开应用以生成 app search memory；重启 NativeHost。

  **PASS：** Native Launcher 即时同步；重启后 hotkey、theme、engine、网站、app memory 和 launcher mode 与保存值一致。

## J. Theme / UI

- [ ] **Theme changes**

  **操作：** 分别选 Dark、Light、System；保持 System 设置运行时切换 Windows 主题。

  **PASS：** Native Launcher、托盘菜单和 Manager 主题一致；文字、hover、selected、滚动条、图标对比清楚，无遮挡。

- [ ] **Compact / expanded**

  **操作：** 测试 compact 和 expanded 默认模式；展开网站/应用区并滚动；点击卡片。

  **PASS：** 高度、内容、滚动和点击正确；无裁切/闪烁；设置重启后保持。

- [x] **Drag surface isolation — PASS (USER CONFIRMED 2026-09-30)**

  **操作：** 依次从 SearchBar 外部空白、TextBox 已有文字、TextBox 文字右侧空白处按下并移动；测试普通点击 caret、拖选文字、双击选词、结果行、快捷卡片、滚动条；最后从 TextBox 空白处拖动窗口并松开后立即输入 `visual`，再用中文输入法输入。

  **PASS：** SearchBar 空白和 TextBox 实际文字右侧空白越过系统拖动阈值后移动窗口；点击空白但未越过阈值仍只聚焦/移动 caret；文字区域能原生点选、拖选、双击选词且窗口不移动；结果、卡片、滚动条、按钮不启动窗口拖动；拖动结束 Launcher 仍可见，输入焦点恢复，`visual` 首字符和中文 IME composition 正常；拖动期间没有触发 blur-hide。

## K. DPI / Multi-monitor

- [ ] **Windows OS reboot — NOT TESTED (Phase 4G follow-up)**

  应用冷启动已由用户确认通过；本项专指重启 Windows 操作系统后的启动行为。

- [ ] **Display scale and monitor placement**

  **操作：** 在可用设备上测试 100%、125%、150% 缩放；双显示器时分别从每个屏幕唤出 Launcher，并检查任务栏/工作区边界。

  **PASS：** 无裁切、模糊布局或屏幕外窗口；Launcher 在预期显示器和工作区内；拖动位置正常。

## L. Existing-user Migration

- [x] **真实 schema 临时 profile migration — PASS (ISOLATED PROFILE ACCEPTANCE, 2026-09-30)**

  **已执行：** 检查 harness 从实际 Electron DataStore v2 字段构造 `nook-data.json`，使用临时目录和依赖注入执行生产 `LauncherStateStore.LoadOrMigrate`。真实 `%APPDATA%\Nook`、`%LOCALAPPDATA%\WebTools`、用户 `launcher-state.json`、SecretStore 和 credentials 均未触碰。

  **结果：** 首次导入保留 hotkey、theme、display mode、custom search engine/template、website projection 和 app search memory；第二次加载幂等且无重复；已有有效 Native state 优先；无效可选字段归一化；损坏 legacy/native 输入有确定回退并保留源文件；fake SecretStore/AI payload 未进入 Native state。

  这是一份真实 schema 形状的隔离 fixture 验收，不是对真实用户 profile 的原地升级测试。

## M. Memory / Resource

- [x] **Five independent cold starts — PASS (MEASURED; USER NORMAL EXIT, 2026-09-30)**

  **已执行：** 用户每轮通过 Native 托盘 Exit 正常退出；确认 NativeHost/Manager 均为 0 后正常启动安装版。分别等待约 30 秒，记录 Private Bytes、Working Set、GDI、USER、Handles、Threads、Electron 数量。五个不同 PID：26424、14184、25348、4680、18932；所有样本 NativeHost 存在、Electron=0。最后正常退出后两种进程均为 0；采样脚本 exit code 0。安装版 EXE 和 DLL 的 SHA-256 均与 acceptance staging 匹配。

  **Median：** Private Bytes 76,726,272 B（73.17 MiB）；Working Set 142,372,864 B（135.78 MiB）；GDI 22；USER 27；Handles 737；Threads 28；Electron 0。每项分别排序取第三值。两种内存口径与 Task Manager 分组读数不可混用；冷启动可重复性不证明压力后的无泄漏。

  **原始 CSV（Git 外）：** `external evidence archive\phase4e-resource-baseline-20260930-125515.csv`。完整逐轮数值和构建标识见 [报告资源基线](native-launcher-phase4e-parity.md#current-build-resource-baseline)。

- [x] **Search / show-hide resources — PASS (MEASURED; isolated A/B, 2026-09-30)**

  **A — No-UIA real WPF path：** 新鲜隔离 NativeHost PID 9148 通过 test-only current-user pipe 在 WPF Dispatcher 设置真实 `QueryBox.Text`，触发 `TextChanged`、实际搜索、Everything/结果绑定、可见图标加载及布局；没有使用 UI Automation。相同 PID 完成 3×1000 次固定混合查询，每轮后隐藏并静置 60 秒，再通过合成 `Control+Alt+Shift+F12` 输入触发真实注册热键处理路径 300 次显隐并静置 60 秒；这不是物理键盘手动测试。R1/R2/R3 settle Private Bytes 为 123.04/124.96/125.88 MiB，R2→R3 +0.93 MiB；热键 settle 114.82 MiB。GDI/USER/handles/threads 未呈现持续单调增长。

  **B — UIA 对照：** 另一个新鲜隔离 NativeHost PID 7796 使用 `ValuePattern.SetValue` 驱动同一个 WPF TextBox，完成相同 1000 次查询与 60 秒 settle。Private Bytes 从自身 idle 128.26 MiB 到 settle 278.23 MiB（+149.98 MiB）；托管堆从 8.87 MiB 到 149.04 MiB。A 首轮相对自身 idle 增加约 20.82 MiB；两组 workload 增长相差约 129.15 MiB。settle 值按最后 10 个采样点排序后取中间两值的均值计算；不同进程 idle baseline 不同，结论同时比较各自进程内增量。

  **归因判断：** 数据支持 UI Automation 在此受控运行中显著放大观测到的增长；不证明它解释了历史增幅的全部，也未识别具体保留对象或 GC root。A 的 R2/R3 已趋于平台，未触发额外 heap profiling 条件。没有 forced GC、working-set trim、缓存清理或产品运行时优化。

  **隔离与记录：** A/B 使用同一个 self-contained .NET 10 win-x64 NativeHost build（EXE SHA-256 `18BE0D1FB5B8FBEA9BD10BC59D2A8B04D8EAC487A38CE1C350CD26AA6C1E2E04`；DLL SHA-256 `11E9B7224D1F4BED4BFD79976D0F81096D99833DC13AFDE2B5E42BAB9E30270F`）、相同 profile/catalog 快照、查询语料和 1 秒 sampler。既有安装进程 PID 27632 未停止；测试样本 NativeHostCount=2（安装实例 + 测试实例），ElectronProcessCount 始终为 0。A/B 测试 Host 均通过 test pipe 正常退出。完整样本和 manifest 在 Git 外：`external evidence archive\run-20260930-155307`。旧 PID 23928 UIA-only 结果仍保留为历史记录，由本次隔离 A/B 归因结果取代。

  **Resource gate：PASS for this workload。** 该结论表示重复 No-UIA 搜索/热键 workload 达到合理平台且资源计数有界；不表示所有环境或长时间运行均无泄漏。Windows OS reboot、DPI/多显示器和长期稳定性仍是 P3 后续项。

- [ ] **Manager cycles resource metrics — NOT TESTED**

  **操作：** 完成 H 中 30 次 Manager 开关；记录开始、打开峰值、关闭并等待 Native 稳定后的 Private Bytes、Working Set、GDI、USER、Threads 和进程数。

  **已确认的功能结果：** Manager 关闭后 Electron process count 为 0，NativeHost 保留，5/30 周期功能正常且无 orphan。**资源 before/peak/after 指标没有采集。** 不要求关闭后 byte-for-byte 回到初始值。

  **证据范围：** GUI 控制工具未用于驱动 Manager cycles；五轮基线通过用户正常退出与代理正常启动配合完成。真实 WPF 搜索和热键资源 workload 已通过隔离 A/B 完成，见上方。Manager open/close 的 before/peak/after 资源指标仍未测；带强制清理的旧 smoke script 未使用。本轮没有强制结束安装版 WebTools、forced GC、working-set trimming 或由采样器修改用户配置。
