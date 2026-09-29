# Native Launcher Phase 4B：WPF 最小 PoC

## 结论

**当前结论：INCONCLUSIVE。** WPF Native Host 已经能在真实 Windows 环境启动，并通过本次自动化交互检查。两种版本均完成五次 30 秒冷启动采样；五轮中位数显示 Native idle Private Bytes 约 48.0 MiB、Electron 约 225.3 MiB。10 分钟采样目前各只有一轮。Native PoC 也没有包含搜索索引、应用目录、图标和网站状态，因此不能据此判断完整 Launcher 的最终内存占用，也不能据此启动 Phase 4C。

本阶段只验证独立 WPF Host 的基本窗口、热键、焦点和测量路径；本阶段未修改 Electron 源码。没有实现真实搜索或正式迁移。

## 1. 测试环境

| 项目 | 本机记录 |
|---|---|
| Windows | Windows 11 build 22631.4249（NT 10.0.22631） |
| CPU | Intel Core i5-13600KF |
| 逻辑处理器 | 20 |
| RAM | 约 15.9 GiB |
| 显示器 | 1 台，2560×1440，工作区 2560×1392，96×96 DPI |
| .NET SDK | 10.0.401（另装有 6.0.406） |
| .NET runtime | Microsoft.NETCore.App / WindowsDesktop.App 10.0.12 |
| Electron | 44.4.5 |

SDK 位于 `C:\Program Files\dotnet`。当前 Codex 进程继承的 PATH 仍将 x86 dotnet 排在前面，所以验证明确调用 x64 SDK 路径；`C:\Program Files\dotnet\dotnet.exe --list-sdks` 能列出 10.0.401。未安装或修改系统级依赖。

## 2. Native 项目结构

```text
native/
├── .gitignore
├── scripts/
│   ├── Invoke-Phase4BSmoke.ps1
│   └── Measure-Phase4BMemory.ps1
├── WebTools.NativeHost/
│   ├── App.xaml(.cs)
│   ├── AssemblyInfo.cs
│   ├── MainWindow.xaml(.cs)
│   ├── WebTools.NativeHost.csproj
│   ├── app.manifest
│   ├── Interop/NativeMethods.cs
│   ├── Models/DummyLauncherResult.cs
│   ├── Models/LauncherInteractionState.cs
│   └── Services/
│       ├── DiagnosticsService.cs
│       ├── GlobalHotkeyService.cs
│       ├── MonitorPlacement.cs
│       └── TrayIconService.cs
└── WebTools.NativeHost.Checks/
    ├── Program.cs
    └── WebTools.NativeHost.Checks.csproj
```

Native Host 使用 WPF、Windows Forms 托盘 API、.NET BCL 和 Win32 P/Invoke，没有新增 NuGet 依赖。PoC 位于独立 `native/` 目录，没有为它修改 Electron Renderer、Main、preload 或现有 Launcher 行为。

## 3. 窗口和 Host 行为

- 无边框、透明、置顶、跳过任务栏、不可调整大小；宽约 850 DIP，默认紧凑高度约 128 DIP。
- 启动时窗口保持隐藏，Host 留在托盘；托盘只有 Exit 菜单项。
- 根据鼠标所在显示器工作区居中定位，垂直位置约为工作区高度的 18%，并受工作区边界限制。
- 专用标题区域可拖动；文本框和结果行不使用拖动区域。
- TextBox 根据非空 query 展示三条固定 dummy results；不读取文件、快捷方式、注册表或 Everything。
- Arrow Up/Down 循环选择，Enter 记录 dummy action 并隐藏，Escape 隐藏并清除临时 query/selection；失焦自动隐藏。
- Named Mutex 防止第二个实例注册重复热键或托盘；第二实例退出。
- Ctrl+Alt+Space 通过 RegisterHotKey 注册；冲突会抛出包含 Win32 错误的可诊断启动消息。关闭时注销热键、释放托盘图标并释放 Mutex。
- 诊断 CSV 写入 `%TEMP%\WebToolsNativeHost-PoC`，记录启动、显示器/DPI、热键和窗口事件。程序不记录搜索内容。

## 4. 构建与自动化验证

### Native

- x64 .NET SDK 10.0.401：Debug 与 Release `dotnet build` 均成功，0 warnings / 0 errors；Release `dotnet publish`（包含 restore）成功。
- Release self-contained `win-x64` `dotnet publish` 成功；未启用 trimming 或 AOT。
- 发布目录 252 个文件、合计 161,643,159 bytes（约 154.2 MiB）；主 exe 162,304 bytes。该值是落盘发布体积，不是运行内存。
- Console behavior checks：4/4 通过，覆盖空 query、三条 dummy results、上下循环选择、hide 后清空 query/selection。
- Windows UI smoke 脚本通过：单实例、首个热键唤出、文本框焦点、直接键入英文、结果出现、点击选择、键盘选择与 Enter、Escape、专用拖动区域、30 次热键开关/焦点、激活 Notepad 后 blur-hide、窗口关闭后进程退出。

### Electron 回归

- `vue-tsc --noEmit -p tsconfig.web.json` 通过。
- `tsc --noEmit -p tsconfig.node.json` 通过。
- `node --experimental-strip-types --test`：103 tests passed，0 failed。Node 输出了既有 `MODULE_TYPELESS_PACKAGE_JSON` 警告。
- `electron-vite build` 通过。
- electron-builder 生成 `release/win-unpacked`，用于本次 Electron Launcher 同机基线测量；本阶段没有生成 NSIS 安装包。
- `git diff --check` 通过；Git 仅提示现有文件的 LF/CRLF 转换警告。

因 Codex 进程 PATH 顺序问题，Electron 项目的 npm 脚本用其本地 CLI 等价命令执行；Native 构建明确调用 x64 dotnet SDK。

## 5. Native 运行时验证与人工验证边界

| 检查 | 结果 |
|---|---|
| 首次 Ctrl+Alt+Space 显示窗口并聚焦 TextBox | 自动化通过；Host 内部首样本从热键回调开始到 TextBox focus 为 70.288 ms；UI harness 的 SendInput 到可见窗口读数跨运行差异较大，不能作为精确端到端数字 |
| 快速重复唤出、30 次 Toggle | 自动化通过；见下方延迟说明 |
| 首次唤出后直接输入英文 | 自动化通过 |
| 三条 dummy results、鼠标选中、上下选择、Enter | 自动化通过 |
| Escape 隐藏 | 自动化通过 |
| 外部应用激活后的 blur-hide | 30 次 smoke 中自动化通过（Notepad）；300 次压力运行未观察到 blur 事件，未能确认新版 Notepad 是否成功切到前台，因此不计作通过；桌面点击未单独测 |
| 专用区域拖动 | 自动化通过；没有拖动文本框或结果行 |
| 置顶、窗口句柄存在 | 自动化检查通过 |
| 第二实例 | 自动化通过，未创建第二个 Host |
| Native 关闭后进程清理 | 通过关闭消息验证进程退出；托盘 Exit 菜单点击路径未单独自动化 |
| 透明窗口白闪/淡出、位置跳变的主观视觉检查 | **Not tested**：当前 smoke 采集的是窗口状态和交互，不采集桌面图像供逐帧视觉判断 |
| 中文 IME composition、立即输入中文、切换输入法、粘贴、Ctrl+A | **Not tested**：脚本发送英文键盘输入，未验证真实 IME composition |
| 10 分钟 idle 后第一次热键响应 | **Not tested**：10 分钟采样未在采样末尾触发热键 |
| 多显示器、混合 DPI、跨屏 | **Not tested**：当前环境只有一台 96 DPI 显示器 |
| Tray Exit 菜单实际点击 | **Not tested**：自动化通过 WM_CLOSE 验证清理路径；未通过系统托盘 UI 点选 Exit |

最近一次 30 个连续 show 周期的 smoke harness 记录：median **9.35 ms**、p95 **43.44 ms**、max **48.48 ms**（SendInput 到可见窗口）。Host 自身日志对首 30 个热键回调到 TextBox focus 样本记录 median **8.214 ms**、p95 **13.178 ms**、max **70.288 ms**；该组含首次焦点，起点在 Win32 热键消息已送达之后。不同 smoke 中首次窗口可见读数出现约 **55.71–297.75 ms** 差异，说明当前 UI harness 无法稳定测出按键注入到窗口可见的全端到端延迟。冷启动进程开始到 Host ready 约 **332.479 ms**。因此 Native internal timing 很快，但与 Electron 的端到端焦点延迟 p95 仍需用同一套可靠输入/观测方式补测。

第一次拖动 smoke 失败经诊断是测试输入问题：旧脚本在按住鼠标时只调用 `SetCursorPos`，未实际注入移动事件；WPF 收到了 MouseDown 并完成 `DragMove()`，但鼠标位置没有变化。脚本现用 Win32 `SendInput` 注入真实 absolute mouse-move，再释放按键；最终完整 smoke 的拖动位置断言通过，未改 WPF 拖动产品逻辑。

测试机器不是用户的 i7-1165G7 轻薄本；该机器的负载和响应结果仍需用户实机确认。

## 6. 内存采样方法与结果

`native/scripts/Measure-Phase4BMemory.ps1` 对启动进程及其 Windows 子进程树采样 Private Bytes、Working Set、PID 数。它不测 JS Heap、DOM、GPU/Utility 分类明细或 idle CPU；Native Host 没有 JS Heap。单位统一使用 MiB（bytes ÷ 1,048,576）。

当前 Electron 基线以 `release/win-unpacked/WebTools.exe --hidden` 启动，避免打开 Manager；Native 使用 self-contained WPF exe。两者在同一台机器、Windows session、单显示器下测量。每种程序分别完成五次独立进程冷启动的 30 秒样本，以及一次独立冷启动的 600 秒样本。600 秒目前各只有一轮，不等同于完整的五轮 10 分钟 benchmark。

### 30 秒：五次冷启动

| 平台 | Run | PID 数 | Private Bytes | Working Set |
|---|---:|---:|---:|---:|
| Native WPF | 1 | 1 | 47.72 MiB | 91.91 MiB |
| Native WPF | 2 | 1 | 48.27 MiB | 92.43 MiB |
| Native WPF | 3 | 1 | 48.10 MiB | 92.36 MiB |
| Native WPF | 4 | 1 | 48.01 MiB | 92.30 MiB |
| Native WPF | 5 | 1 | 47.90 MiB | 92.16 MiB |
| Electron | 1 | 4 | 224.14 MiB | 346.86 MiB |
| Electron | 2 | 4 | 227.27 MiB | 347.94 MiB |
| Electron | 3 | 4 | 223.74 MiB | 401.03 MiB |
| Electron | 4 | 4 | 225.85 MiB | 403.50 MiB |
| Electron | 5 | 4 | 225.26 MiB | 403.20 MiB |

### 10 分钟：各一次冷启动

| 平台 | Run | PID 数 | Private Bytes | Working Set |
|---|---:|---:|---:|---:|
| Native WPF | 1 | 1 | 47.36 MiB | 91.89 MiB |
| Electron | 1 | 4 | 198.87 MiB | 323.01 MiB |

30 秒五轮中位数：Native Private Bytes **48.01 MiB**、Working Set **92.30 MiB**；Electron Private Bytes **225.26 MiB**、Working Set **401.03 MiB**。Electron 各进程 Working Set 求和会重复计入共享页，且本轮波动明显；因此主要比较指标使用进程组 Private Bytes。

一次带搜索交互的 Native smoke 记录（独立于 idle benchmark）：

| 阶段 | Private Bytes | Working Set |
|---|---:|---:|
| 首次显示前 | 73.21 MiB | 98.87 MiB |
| 首次显示并聚焦 | 79.50 MiB | 118.27 MiB |
| 输入 `visual` | 82.15 MiB | 121.33 MiB |
| 展示三条 dummy results | 82.81 MiB | 121.95 MiB |
| Enter 隐藏 | 82.92 MiB | 121.96 MiB |
| 连续 1 次 Toggle 后 | 83.42 MiB | 122.52 MiB |
| 连续 10 次 Toggle 后 | 85.05 MiB | 123.84 MiB |
| 连续 30 次 Toggle 后 | 90.96 MiB | 133.74 MiB |
| 连续 100 次 Toggle 后 | 79.34 MiB | 145.31 MiB |
| 连续 300 次 Toggle 后 | 79.55 MiB | 147.26 MiB |

此 300 次压力 smoke 的 Private Bytes 在第 30 次样本达到 90.96 MiB，第 100 次降至 79.34 MiB，第 300 次为 79.55 MiB；该单次数据没有持续单调增长，符合运行时分配/回收后趋稳的表现，但不是泄漏结论。Working Set 到第 300 次约 147.26 MiB。该 300 次脚本在 Toggle 断言通过后未观察到 blur 事件，无法确认外部应用成功取得前台，因此后续 blur 检查记为未验证；30 次完整 smoke 的 blur 检查通过。原始交互采样 CSV 在 `%TEMP%\WebToolsNativeHost-PoC\interaction-memory-*.csv`。

Native 原始 CSV：`%TEMP%\WebToolsNativeHost-PoC\memory-20260928-231148.csv`、`memory-20260928-233513.csv`；Electron 原始 CSV：`memory-20260928-232235.csv`、`memory-20260928-233255.csv`。启动脚本的单个 2 秒测量曾记录 71.3 MiB Private Bytes / 98.6 MiB Working Set，只用于验证采样脚本，不纳入 idle 对比。

用户此前报告 Electron 托盘 idle 约 98–105 MB，是历史参考值，不与这里测得的 Private Bytes 总和或 Working Set 求和直接等同。Task Manager 的分组显示和进程计数口径也可能不同。

## 7. 稳定性和限制

- 本次自动化 30 次 Toggle 无显示状态或焦点失败；没有出现二次热键要求或 stale toggle。
- 一次 Native idle 序列从 30 秒到 10 分钟，Private Bytes 从 50,036,736 降至 49,659,904 bytes，Working Set 从 96,378,880 降至 96,350,208 bytes；没有观察到该样本内单调增长。只有一次样本，不能得出无泄漏的广泛结论。
- dummy results 只是 UI 测试数据；无实际应用搜索、中文拼音、网站、Everything、图标或 Manager 通信。
- 发布物是独立 Native PoC，不是 WebTools 安装程序，也没有替换当前 Electron Launcher。
- WPF framework self-contained 发布体积约 154.2 MiB；仅发布主 exe 的 0.15 MiB 不代表完整分发大小。

## 8. A/B 判定

五轮 30 秒 Private Bytes 中位数为 Electron **225.26 MiB**、Native WPF **48.01 MiB**，减少 **177.25 MiB（78.7%）**。10 分钟各一轮的 Private Bytes 为 Electron **198.87 MiB**、Native **47.36 MiB**，单轮差值 **151.51 MiB（76.2%）**。这显示 PoC 在当前机器/这个精简范围中有显著的进程组内存差异。

最终结论仍为 **INCONCLUSIVE**，而非 GO：10 分钟数据尚未重复五轮；冷启动到 focused TextBox 的 p95 需要与同机 Electron 的对应分布作公平比较；真实中文 IME、视觉效果、长时间闲置后的首次响应，以及用户 i7-1165G7 机器尚未验证。另 Native 不含真实 Search/App Catalog/pinyin/icons/website state，当前数值不代表功能等价后的完整 Native Launcher 成本。达到这些条件后再依据 Phase 4A 门槛决定是否推荐 Phase 4C。

本阶段停止于 Phase 4B；没有开始 Phase 4C，没有 commit、push 或创建 PR。
