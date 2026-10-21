# Electron 首次激活与窗口显示调查

日期：2026-10-19。范围：Translation 2.0 首次入口、共享 Electron 启动参数、窗口关闭后的 Host 生命周期；服务弹窗恢复竖向分类网格。未改用户配置、凭据、安装目录或 IDA 数据库。

## 用户现场与根因

- 用户确认：Electron 不存在时，从搜索框首次点击翻译，等待 10 秒仍无窗口；再次点击才出现。
- 实际观察：Electron Main、Translation Renderer 和标题为 `WebTools 翻译` 的 HWND 已存在，但 `IsWindowVisible` 为 false；窗口没有最小化，也不在前台。
- 正常托盘退出后生成的 Native 日志 `run-20261019-000403-27452.csv` 显示，首次请求从 `15:59:36.013Z` 入队，到 `15:59:37.136Z` 返回 accepted，约 1.12 秒。Host ready 在 `15:59:36.915Z`。隐藏状态持续数分钟。因此本次失败不是请求未交付，也不是等待服务翻译或纯初始化超过 10 秒。
- 隔离打包复现：仅发一次真实 Native 请求，Translation DOM 与输入已就绪，但 Windows 可见窗口数为 0；第二次激活后为 1。证据：`%TEMP%/webtools-translation-cold-start-T3vG85/report.json`。
- 单变量对照：只将 `ManagerProcessLauncher.CreatePackagedStartInfo` 的 `WindowStyle.Hidden` 改为 `Normal`，同一份 Electron ASAR 首次请求即显示，Windows 可见窗口数为 1。证据：`%TEMP%/webtools-translation-cold-start-D4CAlY/report.json` 的 presentation；该轮退出状态探针碰到 Process 释放竞争，整轮标为 FAIL，不能算完整生命周期通过。

**根因：Native 用 `SW_HIDE` 启动 GUI Electron，影响其第一次窗口显示。** Windows 的首次 `ShowWindow` 会采用启动方提供的 STARTUPINFO 显示状态；后续显示调用才采用调用方参数。参见 [Microsoft ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow) 和 [STARTUPINFO](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-startupinfoa)。官方规则为静态依据；本项目的因果依据为上述红色复现及单变量运行对照。

这不是 Translation 独有的启动参数。它用于 Native 启动整个打包 Electron Host，会影响第一个 GUI Surface。普通插件之前没有报告相同症状，不代表该参数对它们安全；不同窗口的显示调用次数与创建次序可能掩盖问题，具体历史原因未确认。

## 修正

1. 打包 GUI Electron 使用 `WindowStyle.Normal`。保留 `UseShellExecute=false` 和 `CreateNoWindow=true`；窗口自身继续 `show:false`，加载后由其 Owner 显示。不通过启动 Manager、重复 show、自动重发用户操作或固定 sleep 掩盖问题。开发时 Node 控制台辅助进程的 Hidden 设置保持原用途。
2. `openTranslation2Window` 成功交付窗口后释放初始 Host 激活保护。原代码只有 Feature acknowledgement 或创建 Manager 才释放；直接 `translation-prefill` / translate-page 路径可能把无窗口 Electron 保留至 60 秒启动租约超时。隔离基线已经复现关闭最后一个 Translation 后 5 秒仍有 Host；修正后需通过正常 Translation close 验证。
3. 服务选择弹窗：AI、机器 API 分类上下排列；每类内部两列网格，窄屏退为一列；操作文案小于服务名，内容区限定高度并采用主题滚动条。
4. 仅测试模式增加 `launcher-feature` 控制指令，经过实际搜索结果与 `ActivateResult`，不直接绕过 Native 的激活通路。

## 验证口径

`scripts/verify-translation-cold-start.mjs` 使用全新 TEMP profile、自有 Native/Manager 管道和调试端口。没有真实 API Key，没有外部翻译调用，不安装至用户目录。每轮先确认 Electron 不存在，只激活一次，检查对应 Renderer、输入一致、Windows HWND 实际可见及无 Manager 页面；最后关闭并确认 Electron 子进程退出。

重要限制：`document.visibilityState` 或 Renderer 就绪不能证明窗口在 Windows 中可见。Electron 官方明确指出，`show:false` 创建的窗口初始页面可见性仍可能是 visible。参见 [BrowserWindow 的页面可见性说明](https://www.electronjs.org/docs/latest/api/browser-window)。早期仅 DOM 成功的 5 轮结果不计为此次显示回归通过；当前验收使用 Win32 `IsWindowVisible`。

打包矩阵和最终产物身份在本文末尾追加。用户真实鼠标、视觉与安装后体验仍待新包验收；不重开此前用户已经接受的 6G-1/2/3 功能验收。

## 首次加载优化安排

依据 [Electron 官方性能指南](https://www.electronjs.org/docs/latest/tutorial/performance)，先测瓶颈，再减少关键路径工作。当前 Electron 承载 Web 插件 UI，启动它是此架构的正常依赖；一次用户操作应完成启动与窗口交付。长期保持 Electron 常驻不作为这次修复或性能方案。

| 顺序 | 用户可见目标 | 现有代码与计划范围 | 验收与证据边界 |
| --- | --- | --- | --- |
| 本次正确性修复 | 首次点击直接显示插件，关闭后能再次冷启动 | Native `ManagerProcessLauncher`；Main 初始 Host 租约；Translation 窗口 Owner；实际 Native 搜索/面板入口 | 打包单次激活的 Win32 可见性、输入、无 Manager、关闭后 Electron=0；含本地 Web 插件抽样。真实人工体验由用户确认。 |
| 后续性能任务 1：分段基线 | 区分进程启动、Host 就绪、首屏、远程网站加载耗时 | 对 `ManagerController` 的已有元数据事件、`electron/main.ts` bootstrap、PluginManager.initialize、FeatureRegistry.refresh、Window load/show 加时间段记录；只记阶段与时长 | 相同构建、相同目录数据，区分进程冷启动与暖启动、空插件与多插件；记录中位数/尾部与设备环境。当前 CDP+CIM 探针带轮询/采样成本，所得可见时间为观测上界，不当作准确绘制时间或优化倍率。 |
| 后续性能任务 2：减少关键路径 | 保持首次点击可靠，同时降低首屏等待 | 静态检查发现 Main 在 Host ready 前等待 PluginManager 初始化及 FeatureRegistry 刷新；`initialize` 扫描恢复包后还校验当前包。先测这些步骤，只有实际占比显著时再计划惰性加载不相关服务、减少重复验证或缓存安全元数据 | 前后同样矩阵比较；保持包完整性、权限、会话、更新/禁用失效检查，不能为了速度跳过真实插件验证。不存在“已经证明这些步骤就是当前慢启动根因”的结论。 |
| 后续性能任务 3：产品验收 | 用户感知更快，窗口焦点与资源释放可靠 | 沿用共享 Plugin Window、Translation、Native 生命周期；纳入 roadmap 6I | 实际点击、冷/暖切换、连续启动、退出/取消、不同显示缩放、多插件、内存回收；网站网络延迟单独归因。指标在基线后确定，不用无数据的毫秒承诺。 |

后续性能任务尚未实施；本次已解决的无限等待与首次加载的正常有限成本分别记录，不将修好“第一次隐藏”宣称为全部启动性能优化完成。

## 本次最终结果与产物

证据目录：`release/native-preview-20261019-000852/cold-start-evidence/`。TEMP 为驱动的隔离执行目录；需保留的报告与无账户信息截图另归档至 `D:/SystemDefault/Desktop/webtoolstest/translation-cold-start-20261019/`。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 修复前翻译首次隐藏 → 第二次显示 | FAIL，准确复现用户症状 | `baseline-hidden.json`；未修改旧包以制造失败。 |
| 单变量 Normal 显示参数对照 | 首次窗口可见；整轮因退出状态探针竞争为 FAIL | `flag-only-visible-diagnostic-race.json`，仅作为显示因果证据。后续以 Win32 进程清单核对退出，避开已释放 Process 对象的诊断读取竞争。 |
| 修复前直接入口关闭后 Host 滞留 | FAIL | `baseline-close-lease.json`；独立于首次隐藏。 |
| prefill、Launcher Feature、面板 Translation、translate-page | 8/8 PASS，各 2 次真实进程冷启动 | 首次显示、源文一致、无 Manager 页面；正常 Translation close 后 Electron 进程数 0。面板选区为隔离注入，未模拟物理鼠标取词。 |
| 服务弹窗与额外 Feature 首启 | 1/1 PASS | `service-grid.json`、`service-grid.png`：分类上下排列、每类两列、操作文字更小、overflow auto；截图人工查看无截断。未单独验证深色/高 DPI/大量服务的实际拖动滚动。 |
| 本地 Runtime v3 Web 插件窗口 | 新包 2/2 PASS；旧包 1/1 也 PASS | `plugin.json`、`baseline-plugin.json`；未复现普通插件旧包失败。源码中 PluginWindowManager 在 READY 与 open 完成后均可能显示/聚焦，静态上可解释旧参数为何被多次显示掩盖，但未追踪历史每次 ShowWindow。未覆盖任意第三方/Node 插件。此抽样用 Browser.close 结束 Host，不冒充通用插件自然关闭验收。 |
| Node 定向回归 | 14/14 PASS | TranslationWindow、Native routing/client、PluginWindow、Feature activation；未重跑完整 Node 套件。 |
| Native 检查 | 72/72 PASS | 含新增打包 GUI 启动参数断言；既有 UIAutomation 引用和 nullable 警告仍存在，编译成功。 |
| typecheck、Electron build、Native publish、Preview installer/ZIP | PASS | PreviewOnly 未执行安装/卸载与 cover-install smoke；未修改真实安装。 |

四入口 8 次观测：CDP 页面目标约 420–822 ms 出现；DOM/输入加 Win32 可见性采样完成约 1.885–2.797 s。这包含 CDP 连接和 CIM 进程枚举开销，不能当作精确首帧耗时；“冷”表示 Electron 进程初始不存在，未清空操作系统文件缓存。真实用户失败现场 Host 接受请求约 1.12 s；此前无限隐藏并不代表框架加载要十秒以上。

新包：`WebTools-Translation-Cold-Start-Preview-Setup-0.1.0.exe`，同目录有 portable ZIP。`preview-build.json`：HEAD `707c5673dff479285b34a5b441bec9d3b725c737`、dirty=true、revision=`translation-cold-start-grid`。这是当前未提交工作树的构建，单独 HEAD 不能重建所有更改。

- installer SHA256：`7BCCBBC080329110374F936D0ABF1E77ACE818989364A709E3C0B89A1DD9A471`
- ZIP SHA256：`C5CE852CE102154A887D38C79FB4DAD9F414E843D560F505266F03142FDED110`
- NativeHost DLL：`F225762506BBDEA29874D9407A16CD62A1A2F587080143C1D616520EBE56B3FD`
- ASAR：`FAF5303C49DB3ECA2D24343BE46BE01DE9668A3000E70C5760969E2FAF156C91`

运行回归的 TEMP 副本与 stage 的 Native DLL、Electron EXE、ASAR 哈希一致；ZIP 中 Native DLL/ASAR 与 stage 一致。ASAR 中 `out/main/index.js` 及本次 Translation CSS 与当前构建输出逐字节相等。用户原包已按要求正常退出，未替用户启动新包或把新包标记为用户已验收。

新包人工复核：正常退出旧版，确认 Electron 不存在；从搜索框首次只点击一次翻译，应直接显示 Translation；关闭后确认 Electron 退出，再从选区面板只点击一次翻译，源文正确且无 Manager。最后查看添加服务弹窗网格与滚动。真实账户翻译、网站网络速度及广义性能优化不计为本次已验证。
