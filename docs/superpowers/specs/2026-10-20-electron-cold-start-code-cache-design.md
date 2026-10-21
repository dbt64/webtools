# WebTools Electron 冷启动代码缓存设计

**日期：** 2026-10-20\
**状态：** 待审核设计方案\
**目标：** 在 Electron Host 每次使用后正常退出的前提下，评估并验证跨进程磁盘代码缓存是否能缩短 Manager 与普通插件的冷启动。\
**范围：** Electron 主进程 Node 编译缓存、Chromium/Blink Renderer 代码缓存、分段测量与有限 A/B 验收。本文只提出设计，不修改运行时代码。

## 结论先行

VS Code 的代码缓存路线**与 WebTools 的目标兼容**：缓存可以留在磁盘，Electron 进程退出；下次再创建新 Electron 进程时读取缓存。这不是后台常驻，也不要求预热 Electron。

但它只减少 JavaScript 编译/解析的一部分工作，不能缩短 Windows 创建进程、启动 Electron/Chromium、Native Pipe 通信、应用初始化、页面数据请求等全部耗时。因此，现有证据支持“值得做一次受控验证”，不支持“它一定能解决冷启动”，也不支持承诺 500 ms。

建议先验证 **Node 内置模块编译缓存**，再单独验证 Renderer 的 Blink 代码缓存。当前 VS Code 源码使用 Node 的内置 `node:module` 编译缓存实现，并单独配置 Chromium Code Cache；不应把它简化成“加一个 `v8-compile-cache` npm 包”。WebTools 实际 Electron 主进程是 Node 24.21.0，API 存在，但上游 Node 文档标明该功能到 Node 25.4 才转为稳定，因此应把它作为可撤销的性能实验，不直接视作已经成熟的产品开关。[VS Code Node 编译缓存实现](https://github.com/microsoft/vscode/blob/main/src/vs/base/node/nodeCompileCache.ts) · [VS Code Electron 主进程配置](https://github.com/microsoft/vscode/blob/main/src/vs/code/electron-main/app.ts#L3036-L3065) · [Node 编译缓存文档](https://nodejs.org/api/module.html#module-compile-cache)

## 用户目标与硬约束

- 用户从 WPF 搜索框或面板打开 Manager、普通插件、Translation 时，尽快看到并操作目标页面。
- Electron Host 在最后一个窗口/任务结束后退出；下次打开是新进程冷启动。磁盘缓存可跨进程存在。
- 不采用常驻 Electron、隐藏 Electron 预热、隐藏 Renderer 预热或保留后台进程来换取后续快速打开。
- 不在 WPF 显示一个加载阶段后，再在 Electron 显示第二个加载阶段；不增加空壳窗口作为额外等待门槛。
- 必须测“目标页面可操作”，不能只测启动提示、外壳首帧或 Electron 窗口创建。
- 本次研究、缓存、测试 profile、日志和截图均放在 `D:\SystemDefault\Desktop\webtoolstest` 下；不得把研究或验收副本写进 C 盘用户缓存。
- 设计阶段不改源码、不运行项目测试、不生成新安装包。

## 对 VS Code 做法的核实

当前 VS Code 主分支能确认两层独立缓存：

1. **Node 主进程/Node 子进程模块编译缓存。** VS Code 的 `nodeCompileCache.ts` 调用 `node:module` 的 `enableCompileCache()`，按进程类型分目录；缓存生成阶段和正常读取阶段分开处理，随后记录缓存启用状态。它并非简单导入历史 npm 包 `v8-compile-cache`。该实现还会检查当前 Node 运行时版本对应的缓存目录，避免盲目复用不同运行时的产物。[VS Code 实现](https://github.com/microsoft/vscode/blob/main/src/vs/base/node/nodeCompileCache.ts)
2. **Chromium/Blink Renderer 代码缓存。** VS Code 在 `session.defaultSession` 上设置 `setCodeCachePath(...)`，把 Chromium 生成的 JavaScript Code Cache 放到指定持久目录。[VS Code 主进程](https://github.com/microsoft/vscode/blob/main/src/vs/code/electron-main/app.ts#L3036-L3065) Electron 文档将它定义为 Renderer 生成的 V8 JS Code Cache；默认目录在应用 userData 下的 `Code Cache`。默认只保证 HTTP(S) URL 使用，custom protocol 需注册 `codeCache: true` 与 `standard: true`。[Electron Session API](https://www.electronjs.org/docs/latest/api/session#setcodecachepath)

VS Code 采用这些机制，是因为它自己的启动关键路径中有较大的 Workbench JavaScript 需要被加载和编译。这个案例证明该技术对 Electron 冷启动有效果的可能性，但不能直接推导 WebTools 会得到同等收益：WebTools 主进程已由 electron-vite 打成单一入口，Renderer 页面也不是 VS Code 那种 Workbench；必须用本项目数据判断编译成本占比。

还要把 Electron 框架自身和 WebTools 应用代码分开：Electron 43 已对框架 bundle、sandbox preload 等路径加入了构建期/磁盘 V8 字节码缓存；WebTools 使用 Electron 44.4.5，已经包含该批框架层改进。因此本方案验证的是 WebTools 自己的 Main/Renderer 脚本是否还有可观的可编译成本，不能把 Electron 框架从进程创建到启动的全部时间都算成可由 `NODE_COMPILE_CACHE` 缩短。[Electron 43 启动优化](https://www.electronjs.org/blog/electron-43-0) · [对应实现 PR](https://github.com/electron/electron/pull/51792)

## WebTools 当前路径与适用范围

当前源码中的主启动链路大致为：

```text
WPF 用户确认
  → NativeHost Process.Start(Electron)
  → Electron Main/Node 加载 out/main/index.js
  → app.whenReady 与 DataStore 初始化
  → Native Pipe 连接、网址投影同步
  → 插件/Feature 服务初始化与 Host Ready
  → BrowserWindow 创建、加载 file:// 页面
  → 页面 Renderer 首帧、Native 窗口交接
  → Manager 或目标插件可操作
```

源码观察：

- Electron 依赖版本为 `^44.4.5`；当前实际运行时已核实为 Electron 44.4.5、Node 24.21.0、V8 15.2.124.28-electron.0。
- `electron.vite.config.ts` 将 Electron Main 输出为 `out/main/index.js` 单一入口。入口文件当前静态导入了较多服务；Node 编译缓存只有在 Electron 启动前启用，才有机会覆盖这个入口本身。若等 `electron/main.ts` 开始执行才调用 `enableCompileCache()`，入口已被解析/编译，可能错过最希望覆盖的部分。
- `ManagerProcessLauncher` 在 `Process.Start` 前设置 Electron 子进程环境变量，因此有一个不增加窗口/加载阶段的配置位置，可用于验证 `NODE_COMPILE_CACHE` 是否被打包 Electron 接受。
- Manager 使用 `file://` 页面，BrowserWindow 没有显式设置 `v8CacheOptions`，所以目前使用 Electron 默认的 Blink `code` 启发式策略。官方文档没有给出 WebTools 这个 `file://` 组合的缓存命中保证，需要用打包产物确认。
- 普通插件使用 `webtools-plugin://`；协议已声明 `standard: true`，但没有声明 `codeCache: true`。运行时响应目前还带 `cache-control: no-store`。Electron 文档要求 custom protocol 同时声明 `codeCache` 和 `standard` 才启用该类 URL 的 Blink Cache；是否与现有响应策略、插件授权和包更新行为兼容，要在单独实验中确认，首轮实验保留现有 `no-store`。
- 当前启动路径在首窗前有 DataStore、Native Pipe 和应用服务初始化；这些时间不由代码缓存消除。已有研究记录的 host-ready、窗口首显和页面可用时长来自不同探针与测试轮次，不可混作一个精确基准；仍需对同一打包版本、同一入口重新进行 A/B。
- 既有交付记录曾有一轮从 Electron 启动到插件画面约 1,681 ms 的单次记录：WPF 交接提示约 97 ms，host-ready 约 +643 ms，BrowserWindow 创建约 +833 ms，shell 显示约 +1,513 ms，插件画面约 +1,681 ms。它不是当前版本的统计基线，但说明总时长横跨 Main/Native 交接与页面显示；编译缓存只会覆盖其中的脚本编译部分。[既有冷启动记录](../../../../webtoolstest/electron-startup-research.md)
- 当前本地 Renderer 产物中可见的主要初始/页面 chunk 是约 112 KB 的入口、约 218 KB 的通用 token chunk、约 75 KB 的 PluginManager chunk。它们只是静态文件大小，不代表真实 parse/compile 时间，也不含所有外部模块；但相比 VS Code Workbench，WebTools 有更少证据支持“Renderer 巨型脚本解析是主瓶颈”的假设。

本项目参考：[`electron/main.ts`](../../../electron/main.ts)、[`ManagerProcessLauncher.cs`](../../../native/WebTools.NativeHost/Services/ManagerProcessLauncher.cs)、[`electron.vite.config.ts`](../../../electron.vite.config.ts)、[`plugin-runtime-session.ts`](../../../electron/plugins/plugin-runtime-session.ts)、[既有冷启动生命周期调查](../../electron-cold-start-lifecycle-investigation.md)。

## 候选方案可信度

| 候选 | 对 WebTools 的匹配 | 预计能影响什么 | 可信度与限制 | 结论 |
| --- | --- | --- | --- | --- |
| Node 内置 Module Compile Cache，通过 `NODE_COMPILE_CACHE` 在 NativeHost 启动 Electron 前启用 | 技术兼容性较好：Electron 实际 Node 为 24.21.0，入口为 Node 加载的单一 JS 文件；缓存可留在磁盘，进程仍退出 | Main 入口及 Node 模块的解析/编译成本 | **端到端收益可信度中等偏低，需实测。** 第一次生成缓存可能变慢；Node 24 中 API 仍处于上游稳定前状态；它不减少应用初始化等待，Electron 框架自身已另有启动缓存 | 第一优先的隔离实验；只有打包 Electron 确认启用、跨正常退出有缓存命中后，才测端到端收益 |
| Blink `v8CacheOptions: 'bypassHeatCheck'` + `session.setCodeCachePath()` | Manager `file://` 是否实际命中尚未确认；普通插件 custom protocol 需额外 `codeCache: true` | Renderer JS 的解析/编译工作 | **低到中等。** 默认 `code` 已会按启发式缓存；bypass 可能让首次使用更早生成缓存，但不减少网络、DOM、Vue 初始化或主进程等待。`bypassHeatCheckAndEagerCompile` 可能把更多编译工作前置，当前不建议 | 先做可观测性小实验，确认当前/强制策略真实生成且读取缓存，再进入 A/B |
| 安装 npm `v8-compile-cache` | 不如 Node 内置路线 | 主要是 Node 模块编译缓存 | **低。** 当前 VS Code 已使用 Node 内置 API；WebTools Electron Node 自带该 API。再引入旧式 monkey-patch 会增加维护面，且没有证据说明能覆盖更多入口 | 不采用，除非内置 API 在 WebTools 打包运行时被证明不可用且独立基准证明第三方库明显更好 |
| 进程常驻、隐藏窗口预热、启动后再切换窗口 | 与目标冲突 | 下次调用的启动时间 | 通过保留资源避开冷启动，不是冷启动优化；会重新引入后台 Electron 内存占用与退出复杂度 | 排除 |

Electron 的 Blink `v8CacheOptions` 取值包括默认启发式 `code`、`bypassHeatCheck`（仍采用 lazy compilation）和 `bypassHeatCheckAndEagerCompile`（eager）。本设计只允许把 `bypassHeatCheck` 作为 Renderer 的 A/B 候选，不把 eager 设为默认方案。[Electron WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences#v8cacheoptions)

## 设计方案

### A. Node 编译缓存验证

1. NativeHost 在启动 Electron 的 `ProcessStartInfo` 上设置仅对子进程生效的 `NODE_COMPILE_CACHE`，不要更改机器级/用户级全局环境变量。
2. 测试目录使用 `D:\SystemDefault\Desktop\webtoolstest\electron-cold-start\node-cache`。产品目录另行使用 WebTools 自己的稳定数据目录；不得将本机测试路径写入发布版。
3. 先做一个最小的打包运行时探针，确认 Electron 实际读取到指定目录；再确认正常关闭后目录出现可复用条目，下一次进程 ID 全新时能够读取。只核对目录存在不等于命中，需结合缓存 API 状态/启动日志及成对 A/B。
4. 让 Electron 正常执行既有退出逻辑，观察 Node 缓存写入是否增加关闭耗时。不得为强制 flush 增加新的退出等待，除非单独数据证明必要且代价可接受。
5. 缓存不可用、目录无权限、版本变化或缓存 miss 时，照常编译并启动；缓存只是优化，不得成为启动依赖。

Node 文档明确说明，compile cache 会在模块首次加载时生成数据、通常在 Node 进程退出时落盘；首次加载可能更慢，后续内容未变化的模块图可能更快，缓存通常不能跨 Node 版本复用。[Node Module Compile Cache](https://nodejs.org/api/module.html#module-compile-cache) 因此 A/B 必须区分首次 cache miss 与缓存已生成、Electron 进程已退出的 cache hit。

### B. Blink Renderer 缓存验证

1. 先在 Manager 默认 `file://` 页面验证，不改 URL scheme、不改响应 header、不改窗口显示/Native 交接过程。
2. 对照 Electron 默认 `code` 与 `bypassHeatCheck`，检查 Chromium Code Cache 是否在首轮生成、正常退出后保留，第二个新 Electron 进程加载同一页面时实际读取。
3. 只有 Manager 验证得到实际命中且端到端收益明显时，才单独评估 `webtools-plugin://`。测试如确需加 `codeCache: true`，先保持 `standard: true` 与 `cache-control: no-store`，观察不违反现有安全与更新行为；如果要改 `no-store` 或迁移到其他协议，必须另开设计与证据，不包含在本方案授权内。
4. Translation 作为回归目标单独测其本地 UI ready；远端供应商网页、翻译 API 响应时间单列，不把网络变化归因于 Blink Cache。

### C. 测量和 A/B 方法

一次用户操作的时间轴至少记录：

```text
confirm-input
→ Process.Start / electron-process-start
→ Electron main entry
→ app.whenReady
→ DataStore ready
→ Native Pipe connected
→ electron-host-ready
→ BrowserWindow created
→ ready-to-show
→ Native handoff complete / window presented
→ manager-renderer-ready 或 plugin runtime/page usable
```

验收记录保存到 `D:\SystemDefault\Desktop\webtoolstest\electron-cold-start\`。需要统一关联 ID；分别保留 WPF `Stopwatch` 与 Electron `performance.now()` 的本地单调时长，跨进程用 UTC 时间和关联事件对齐，不能直接相减两个进程的单调时钟。

每个条件使用同一个打包构建、同一设备、同一安装路径、同一 profile 数据与同一目标页面；A/B 顺序交替，至少 7 组有效样本：

| 条件 | Electron 进程状态 | Node 缓存 | Blink 缓存 | 目的 |
| --- | --- | --- | --- | --- |
| A：基线 | 每次启动前确认 Electron 主/子进程均不存在 | 关闭 | 当前默认策略 | 冷进程基线 |
| B：Node 首次生成 | 每次启动前确认进程均不存在 | 目录为空后首次运行 | 与 A 相同 | 测生成成本和首次打开回归 |
| C：Node 命中 | 正常退出后再次启动，仍确认无残留进程 | 保留 B 生成的磁盘缓存 | 与 A 相同 | 测 Node cache 跨进程收益 |
| D：Blink 命中 | 与 C 相同 | 关闭或固定一致 | 仅对照默认 `code` 与 `bypassHeatCheck` | 测 Renderer cache 的独立收益 |
| E：组合 | 与 C 相同 | 启用 | 选定的 Blink 策略 | 仅在 B/C/D 单项有效后测组合 |

“冷启动”指 **Electron 进程不存在**；cache-warm 条件允许磁盘代码缓存存在。测试不清空或假称清空 Windows 文件页缓存。每轮先确认上一次 Electron 主进程和其 Electron 子进程已完全退出；仅在正常关闭未退出时，由测试清理步骤结束遗留进程，并把该轮标为退出失败、重新执行。Native/WPF Host 可持续运行，这是产品架构本来就常驻的部分。

主指标是从确认操作到 Manager / 插件实际可交互的总时长。过程时间点用于归因，`ready-to-show`、外壳首帧和加载提示都不能替代目标页面可操作。分别报告 P50、P90 与每一轮样本；插件网络加载单列。当前的 `WindowStartupTrace` 可作为基础，但须补齐 Main/Native 关键节点，并统一关联 ID。

### D. 采用门槛与停止条件

建议将“值得进入产品实现”的最低结果定义为：

- cache-warm、Electron 进程冷启动的目标页面可操作时间，P50 同时至少改善 **10% 且 100 ms**；
- P90 不比基线差超过 5%，首轮 cache miss 不出现明显启动/退出退化；
- Manager、普通本地插件都没有新增 WPF/Electron 加载阶段、内容重叠或首次打开功能回归；
- 关闭目标页面后 Electron 进程仍按既有生命周期退出；缓存目录不是依赖运行中的后台进程生成/保活。

如果缓存正确命中但节省未达门槛，停止推广该缓存方案，不为了“用上 VS Code 的做法”继续堆代码。回到同一时间轴上找真正的大段：若 pre-window Main/Native Pipe/数据初始化占主导，下一项应针对实测占时的 await、同步 I/O 或重复工作做最小关键路径调整；若 Renderer 占主导，再评估页面首屏依赖和 bundle。每一项单独 A/B。**不重新加入常驻进程、额外加载壳或串行的 WPF/Electron spinner。**

本设计不设 500 ms 成功承诺。若目标页面当前主要受 Electron/Chromium 自身启动固定成本或串行 IPC 等待影响，compile cache 可能只是几十毫秒甚至不可测；只有真实结果能决定是否保留。

## 方案边界与待确认的事实

- Node 24.21.0 运行时确认存在 `module.enableCompileCache()`；但产品采用前仍要从打包 Electron 验证环境变量生效、正常退出落盘、下一次新进程复用，并关注 Node 24 上该 API 的实验性状态。
- Manager 的 `file://` 页面是否获得 Blink code cache 的实际收益尚未确认。只因为 API 存在，不代表 URL scheme 已命中缓存。
- `webtools-plugin://` 的 Blink cache 目前不是开启状态；协议调整与当前 `no-store` 策略必须单独验证。
- 编译缓存不缓存 Vue 组件实例、DOM、应用状态或 API 数据，也不能绕过 Electron/Chromium 进程启动；这些属于不同优化对象。
- 现有加载外壳/交接行为保持固定，不作为缓存优化的一部分。A/B 若在测试过程中改变外壳、窗口 handoff、Native 启动参数或插件内容，就不能用于归因。

## 一手资料

- [VS Code：Migrating VS Code to Process Sandboxing](https://code.visualstudio.com/blogs/2022/11/28/vscode-sandbox) — 启动优化背景及 V8/Workbench 编译缓存的历史解释。
- [VS Code：`nodeCompileCache.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/base/node/nodeCompileCache.ts) — 当前主分支 Node 编译缓存实现。
- [VS Code：Electron Main Code Cache 配置](https://github.com/microsoft/vscode/blob/main/src/vs/code/electron-main/app.ts#L3036-L3065) — `session.defaultSession.setCodeCachePath(...)`。
- [Electron：Session API](https://www.electronjs.org/docs/latest/api/session#setcodecachepath) — Code Cache 路径与 URL scheme 要求。
- [Electron：WebPreferences `v8CacheOptions`](https://www.electronjs.org/docs/latest/api/structures/web-preferences#v8cacheoptions) — Renderer 缓存策略及 lazy/eager 区别。
- [Node.js：Module Compile Cache](https://nodejs.org/api/module.html#module-compile-cache) — `NODE_COMPILE_CACHE`、首次生成成本、退出落盘和版本兼容边界。
- [V8：Code caching for JavaScript developers](https://v8.dev/blog/code-caching) — V8 代码缓存机制说明。
