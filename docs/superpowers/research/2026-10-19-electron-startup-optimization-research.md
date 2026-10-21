# Electron 启动优化：成熟应用做法与 WebTools 对照

日期：2026-10-19\
范围：只整理 Electron 官方资料、应用团队一手文章与自有源码；未改产品代码，未运行测试或性能基准。

## 结论

“打开慢”至少要拆成四段：Electron 进程冷启动、Host 初始化、窗口/Renderer 首帧与可交互、目标 Manager 页面或插件功能就绪。已运行的 Electron Host 打开新窗口，和 WPF 冷启动 Electron，是不同路径；插件目标页面的网络加载也不能算成进程启动。

成熟应用的共同做法是先拆分并测量这些阶段，缩短首屏关键路径，再把不影响当前操作的初始化和数据加载后移。预热进程或隐藏窗口可以缩短后续打开时间，但会以常驻内存和额外运行状态为代价；它不能证明真正的冷启动变快。

## 一手资料中的做法

| 来源 | 已公开的具体做法 | 对 WebTools 的启发与边界 |
| --- | --- | --- |
| [Electron 性能指南](https://www.electronjs.org/docs/latest/tutorial/performance) | Electron 建议先 profile 再优化；重型模块按需加载、延后非关键磁盘/网络操作、Main 使用异步 I/O、CPU 密集任务移出 UI 线程，并打包代码以减少模块查找。指南特别提到 Windows 上模块加载可能很贵。 | 先找出是哪一个 `await`、模块导入、文件操作或 Renderer 工作占了空白期；不要仅凭“Electron”归因。 |
| [VS Code 1.72 启动优化记录](https://code.visualstudio.com/updates/v1_72) | 团队把窗口打开/恢复附近的同步 `fs` 改成异步；打包总是最先运行的 Electron Main 与 Renderer bootstrap，减少启动时的文件查找；把非关键 workbench contribution 推到编辑器打开之后。 | 和 WebTools 最接近的可迁移手法是减少首次窗口前的阻塞等待、静态入口的加载开销，以及把非当前页面所需工作后移。VS Code 的编辑器与扩展宿主架构不能整套照搬。 |
| [VS Code 性能工具](https://github.com/microsoft/vscode/wiki/%5BDEV%5D-Perf-Tools-for-VS-Code-Development) 与[性能标记清单](https://github.com/microsoft/vscode/wiki/Inventory-of-performance-marks) | Startup Performance 将主进程、Renderer、代码加载、workbench 恢复和扩展激活分别计时；`--prof-startup` 可采集 Main、Renderer 和 extension host profile。跨进程标记配对记录 `will/did` 阶段。服务可以延迟实例化，首次真正使用或空闲时才构造。 | 重点借鉴“分段计时与定位”，而不是只记录“Electron 已启动”。功能初始化是否能后移要看 Manager/插件当前操作的依赖。 |
| [Slack 的 Incremental Boot](https://slack.engineering/getting-to-slack-faster-with-incremental-boot/) 与 [Gantry](https://slack.engineering/gantry-slacks-fast-booting-frontend-framework/) | Slack 先显示当前会话所需内容，再并行补全完整模型；启动 API 与剩余代码下载并行；按需取数据和代码拆分减少首屏必须处理的内容。团队将“内容可见”和“完全可交互”分别计时，文章报告当时内容可见约从 7 秒降到不足 5 秒，完全加载约从 7 秒降到 6 秒。数据来自 Slack 的 Web 客户端，文章发表于 2016/2019，适合证明启动流程方法，不代表当前 Slack 或 WebTools 的耗时。 | Manager 可先呈现稳定的 Host 外壳，再让不影响当前页的目录、设置或其他插件信息在首帧后继续加载；用户正要打开的插件本身仍应优先。远程供应商网页需单独统计网络导航。 |
| [GitHub Desktop 主进程](https://github.com/desktop/desktop/blob/development/app/src/main-process/main.ts) 与[窗口实现](https://github.com/desktop/desktop/blob/development/app/src/main-process/app-window.ts#L1517-L1667) | 将页面 `did-finish-load` 与 Renderer 主动报告 `renderer-ready` 分开计时，二者齐备才发出 did-load；窗口以隐藏状态加载后显示。这是可靠的分段测量与防止未完成页面闪现的例子，不是“隐藏窗口让启动更快”的证据。 | WebTools 也应把首次绘制与首次可操作分开；`ready-to-show` 不能代替 Manager ready 握手。Electron 文档说明，复杂页面等 `ready-to-show` 可能使窗口显得慢，可用匹配的 `backgroundColor` 先显示窗口；这改善观感，不会减少页面初始化本身。 |

Slack 的另一项经验与预热取舍有关：[其内存文章](https://slack.engineering/reducing-slacks-memory-footprint/)说明每个工作区的完整 Web 应用/WebView 带来显著内存成本，因此不活跃工作区会换成只保留通知与未读状态的轻量客户端。这个例子支持“后台保留需要有资源账本”，但不是 WebTools 必须照搬的机制。

## 与当前 WebTools 的代码路径对照

以下是**静态源码观察，不是运行时耗时证据**：

1. Native Host 通过 [`ManagerProcessLauncher`](../../../native/WebTools.NativeHost/Services/ManagerProcessLauncher.cs#L30-L45) 的 `Process.Start` 启动打包 Electron。
2. Electron 进入 [`app.whenReady()`](../../../electron/main.ts#L540-L567) 后读取本地数据，并在 Native 管理模式下连接 Native pipe、同步网址投影。之后还会初始化内置翻译、插件管理器、Feature Registry，并发布插件/Feature projection（[`main.ts`](../../../electron/main.ts#L658-L664)、[`main.ts`](../../../electron/main.ts#L868-L941)）。
3. Host 在这些步骤之后才发送 `electron-host-ready`，非 host-only 启动随后才创建 Manager BrowserWindow（[`main.ts`](../../../electron/main.ts#L1032-L1040)）。窗口再等 `ready-to-show` 才显示；Renderer 另有 `manager-renderer-ready` 握手（[`main.ts`](../../../electron/main.ts#L429-L495)、[`main.ts`](../../../electron/main.ts#L525-L530)）。因此源码中存在几个可测的前窗等待段，但**目前不能据静态代码断定哪一段是用户空白期的主因**。
4. 插件页面启动还有自身授权、Runtime 创建和页面加载阶段。它与 Manager 窗口的首次 Renderer 启动应分别计时；若加载的是远程站点，还应把网络等待单列。
5. 当 Manager、Translation 和插件 surface 都关闭后，Electron Host 会因没有可见任务而 `app.quit()`（[`main.ts`](../../../electron/main.ts#L423-L426)）。所以大多数“重新召唤”会重新冷启动 Electron；若插件窗口留在后台，则属于 Host 已运行的另一种情形。

项目已经通过 [`electron.vite.config.ts`](../../../electron.vite.config.ts) 将 Electron Main 代码构建为单个入口文件，因此 VS Code 的“减少启动文件查找”不能直接当成本项目的优先项；仍需测量主入口求值、初始化等待和 Renderer 工作各自的耗时。

这也解释了为什么只优化窗口动画或更换 uTools 的窗口形态不一定有效：WebTools 的 WPF→Electron 启动与 Host 初始化路径不同；需要从其实际阶段数据定位。

## 建议的测量与优化顺序

1. 给一次带关联 ID 的用户操作记录这些时间点：Native 发起、Electron 进程启动、`app.whenReady`、Native pipe 连接、`electron-host-ready`、BrowserWindow 创建、首帧显示、`manager-renderer-ready`、目标插件 Runtime ready、页面可操作。用单调时钟记录各段耗时；网络页面加载单列。
2. 至少比较 Electron 进程不存在时的冷开、Host 已运行时开 Manager、同一 Host 中首次/再次开目标插件。用重复样本的中位数和高分位数，不把探针轮询时间误当精确首帧。
3. 先处理实测占时最长的关键路径：减掉首屏前不必要的 await/同步 I/O、并行化互不依赖的准备、延后当前页面用不到的初始化、先绘制基本外壳再填充非关键数据。每项都检查首次实际功能是否仍可用。
4. 若用户常用场景主要是“Host 已退出后的冷开”，才评估保留 Electron 主进程或预热轻量 Renderer；同时测量后台私有内存、退出/取消、插件关闭后的进程回收。不要默认预热全部插件页面。

工作区已有 [`verify-translation-cold-start.mjs`](../../../scripts/verify-translation-cold-start.mjs)，可通过实际 Native Launcher 冷启动打包 Electron，覆盖 Manager、内置翻译和插件入口。它目前用 Node `tmpdir()` 创建临时用户数据；按此前约定，正式测量前应把测试根目录改到 `D:\SystemDefault\Desktop\webtoolstest`。本次只做源码审阅，没有运行该脚本。

这份调研没有提出毫秒目标，也没有判断应立即重构。先取得 WebTools 自身分段数据，才能区分 Electron 固定冷启动、Host 初始化等待、窗口首帧和插件页面加载。
