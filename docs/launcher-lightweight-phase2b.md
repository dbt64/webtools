# Launcher Lightweight Phase 2B

日期：2026-09-28。基于 `docs/launcher-lightweight-phase2-audit.md`，仅处理 Launcher 隐藏生命周期、空查询索引实验以及两项测量。没有修改 Manager、Translation、Provider、窗口架构、数据 schema 或拼音算法。当前工作树在本阶段开始前已经包含未提交的 Phase 1 文件；本阶段没有提交、推送或创建 PR。

## 测量口径

用户安装版基线：Launcher 空闲/Manager 关闭约 111 MB；Manager 打开约 152 MB；使用 Translation 后约 175 MB；随后关闭 Manager 约 125 MB。用户未观察到持续单调增长。下面的进程数据来自独立的构建后 Electron 开发实例，`WebTools-Dev` 配置，CDP 调试端口开启；`PrivateMemorySize64` 是各进程私有内存之和，**不能直接与 Windows 任务管理器安装版读数相减**。JS heap 通过 CDP `Runtime.getHeapUsage` 采集。每组仅一次冷启动，数据用于识别明显差异，不足以证明几 MB 的稳定收益。

## 2B-1：统一 Launcher hide 生命周期

修改前：Renderer 自己的 Escape/结果打开路径清理 query 后调用 Main hide；Main 的全局快捷键和 blur 路径仅将常显透明窗口移到屏幕外。搜索结果 DOM、图标和查询继续留在离屏 Renderer。

修改后：Main 的所有实际 hide 共用递增 generation 的 `launcherVisibility` IPC；只有 `launcherShown` 从 true 转为 false 时发送 `hidden`。`shown` 也走同一有序通道。Renderer 忽略过期/重复 generation；hidden 清理 query、结果展示、文件搜索与记忆查询的异步序号、当前结果图标与临时对话框，保留 app/website 数据、versions 与索引 cache。窗口高度 IPC 带 generation，Main 拒绝隐藏/过期请求。Main 在当前 `shown` 被 Renderer 确认处理后才完成焦点唤出；新 intent 会释放旧确认等待。Renderer reload 后的 ready 通知会重新发送当前 show 状态。未使用固定延时掩盖竞态。

代码审查和运行测试发现一个额外竞态：仅靠 generation 过滤仍可能在 Renderer 尚未处理最新 `shown` 时输入，迟到的旧 `hidden` 或新 `shown` 清掉文字。于是移除 `shown` 的重复 query 清理，并增加当前显示事件的 Renderer acknowledgement。修复后的构建版 CDP 交错调用 `show→hide→show` 10 轮，10/10 保留新输入且获取焦点；通过相同 Main show/hide IPC 入口连续 50 次均获得焦点，最终 query 为空。输入 `visual` 得到 9 行，Main hide 后 query 为空且结果 0 行，再 show 仍为空。该循环不是 Windows 全局按键事件测试。generation/ack 单测和原有 Phase 1 version 测试通过。

## 2B-2：空查询索引实验

UI 原本读取 `index.value` 后才让搜索函数判断空查询，导致 `visibleAppIds` 的 immediate watcher 可以提前建索引。现增加窄的 lazy-index 调用：空查询、`?` 和 `file:` 模式不读取 index；有内容的 local 或 `/` 查询才读取现有 cache。没有 lazy import `pinyin-pro`，没有改变搜索算法或排序。

一次冷启动后的 CDP 输入到两个动画帧后结果出现的采样（毫秒；含 Vue 渲染与帧调度，并非纯索引耗时）：

| 查询 | 修改前 | 修改后 | 修改后结果行 |
| --- | ---: | ---: | ---: |
| `文件`，首次中文 | 18.5 | 25.1 | 5 |
| `wenjian`，全拼 | 11.9 | 13.1 | 2 |
| `wja`，首字母 | 11.9 | 12.1 | 1 |
| `visual`，英文 | 12.2 | 13.3 | 9，含翻译 action |
| `vsc`，缩写 | 9.6 | 10.3 | 2 |
| `file:notes` | 10.4 | 12.1 | Everything 异步搜索，采样时 0 |
| `?search` | 16.2 | 21.5 | 网页搜索提示 |
| `/google` | 12.1 | 11.8 | 该测试配置中无匹配收藏网址 |

首次中文采样增加约 6.6 ms；单次样本不适合断定普遍延迟，但未达到一个明显可感知的交互停顿。第二次查询及英文、全拼、首字母、缩写/模糊查询仍在约 10–13 ms 范围。构建版还用当前唯一的收藏网址验证了 `/名称` 与 `/URL 片段` 各返回一条。现有搜索/排序自动测试通过。此实验暂时保留，首次输入体验仍需要用户在目标轻薄本上验证；若明显变慢，应撤回此改动。

## 2B-3：`pinyin-pro` runtime profiling

独立冷启动 Renderer 在数据已加载、空查询、强制 GC 后，第一次输入 `文件` 前后的 CDP 读数：JS heap used 6,311,924 → 6,756,936 B（+445,012 B）；total heap 6,799,360 → 7,323,648 B（+524,288 B）；embedder heap 735,232 → 1,577,008 B（+841,776 B）；DOM nodes 117 → 193；`TaskDuration` 0.024548 → 0.057019 秒（+32.471 ms）。查询到结果两个帧的时间约 22.8 ms。

这些变化**包含索引建立、搜索、Vue 结果 DOM/图标与 CDP/GC 扰动**，不能归因给索引本身。当前 Launcher 静态导入 `pinyin-pro`，采集前模块已经求值且可能完成一次性 idle trie 建立；本次无法在同一 Renderer 中可靠分离 import 前、模块求值后和 trie 完成后三个状态。字典/模块/trie 的独立 runtime MB 为 **Unknown**；索引独立 runtime MB 也为 **Unknown**。不能由约 405 KB bundle 映射推断运行内存。本阶段没有足够证据提出 Phase 2C lazy import 实施。

## 2B-4：`backgroundThrottling` 独立 A/B

从同一份 `npm run build` 输出复制 A/B；逐文件 SHA-256 比较仅 `out/main/index.js` 不同，且 B 只将唯一的 `backgroundThrottling: false` 替换为 `true`。正式源码和最终 `out` 保持 `false`。两个 Windows NSIS 包均成功构建；从各自 `app.asar` 提取 Main bundle 核实 A 为 false、B 为 true。两组共用同一测试目录位置、开发资料目录与机器，顺序冷启动。最终交付包在 `release/phase2b-delivery`（A）和 `release/phase2b-ab-true`（B）。

| 状态 | A：false | B：true |
| --- | ---: | ---: |
| 冷启动后首次采样，总私有内存 | 197.52 MB（约 45 秒） | 181.95 MB（约 56 秒） |
| 空闲约 5 分钟，总私有内存 | 192.23 MB | 188.15 MB |
| 空闲约 10 分钟，总私有内存 | 192.45 MB | 188.87 MB |
| 10 分钟时 Main / Renderer / GPU / Utility 私有内存 | 67.13 / 35.86 / 78.18 / 11.28 MB | 67.62 / 31.96 / 77.99 / 11.30 MB |
| 空闲约 10 分钟，Renderer JS heap used | 6,121,080 B | 6,106,832 B |
| 10 分钟后第一次 Main show IPC 完成 | 17.4 ms | 19.6 ms |
| 30 次 Main show/hide IPC，中位 / p95 | 1.4 / 3.0 ms | 1.7 / 4.1 ms |

上述 show/hide IPC 数字是 Renderer 调用到 Promise 返回的时间，**不是物理快捷键到画面首帧或输入可交互的时延**。A 版空闲期间总私有内存 197.52 → 192.23 → 192.45 MB，没有持续单调增长。B 版为 181.95 → 188.15 → 188.87 MB；后段增幅小于前段，单次三点样本不能判定持续泄漏，但也不足以证明稳定节省。两版 JS heap used 几乎相同；进程组差异主要来自 Native/GPU/Renderer 私有内存，可能随 Chromium 内部缓存和系统状态波动。首次采样因命令启动与权限审批开销晚于严格的 30 秒时点，因此表中标注实际时刻。操作后缓存/渲染进程内存会上升；B 版搜索与多次显示/隐藏后强制 GC，DOM nodes 从 1,306 回落到 92，不能仅据未 GC 的单点读数判断泄漏。

两版均在 CDP 中通过中文、全拼、首字母、英文缩写、`file:` 命令 UI、`?` 提示、`/` 收藏网址匹配、紧凑/展开切换、Escape、Manager 抢焦点触发的 blur，以及 10 轮快速交错；新输入 10/10 保留。A 版另外完成 50 次 show/hide IPC 循环。外部 Everything 结果实际打开、浏览器跳转与鼠标拖动没有自动执行。

**决策：保留正式默认 `backgroundThrottling=false`。** B 版在此开发实例中 10 分钟时约低 3.58 MB，但样本只有一轮、初始读数出现较大波动，首次显示和 IPC p95 略慢；尚无安装版任务管理器复测、物理快捷键到首帧及 Win11 透明窗口淡入的可靠证据。`true` 仅作为独立实验安装包供人工 A/B，不合入源码默认值。

当前系统有已安装的 WebTools 正在运行，占用全局 Ctrl+Alt+Space；给系统发送该按键未使本次独立开发实例取得焦点。因此物理快捷键、Windows 透明窗口淡入、拖动和点击桌面的真实失焦需在安装版上人工测试。

## 变更与验证

产品代码：

- `electron/main.ts`：带 generation/ack 的 shown/hidden 生命周期，Main 只在 Renderer 确认当前显示状态后聚焦；正式 `backgroundThrottling` 仍为 false。
- `electron/ipc/window-handlers.ts`、`electron/preload.ts`、`src/shared/ipc.ts`：窄的 Launcher 可见性通知与 acknowledgement；窗口高度 IPC 校验 sender 和 generation。
- `src/shared/launcher-visibility.ts`、`src/shared/launcher-visibility.test.mjs`：可见性序号与确认等待及单测。
- `src/features/search/LauncherView.vue`：hide 时清理临时状态、保留 Phase 1 数据与索引；显示后确认和防迟到焦点。
- `src/features/search/launcher-results.ts`、`src/features/search/launcher-results.test.mjs`：空查询不读取索引和对应单测。

本阶段开始前工作树已经包含未提交的 Phase 1 修改和报告，本阶段没有重写那些改动，也没有 commit/push/PR。测量脚本和中间打包目录已在完成测量后清理。Windows 安装包在 `release/phase2b-delivery/WebTools-Setup-0.1.0.exe`（正式）与 `release/phase2b-ab-true/WebTools-Setup-0.1.0.exe`（仅实验）。

### 自动验证

- `npm run typecheck`：通过。
- `npm test`：通过，101 项测试（含本阶段新增测试）。
- `npm run build`：通过。
- `git diff --check`：通过；Git 仅报告工作树行尾转换提示。
- Windows 构建版 Electron：可以启动；通过 CDP 验证上述 Launcher 输入、窗口交错、结果 DOM 清理与模式切换。NSIS A/B 安装包构建成功，并核对 `app.asar` 的 flag。

### 仍需用户在安装版手测

1. 先退出旧 WebTools，再测试新正式包第一次 Ctrl+Alt+Space、空闲 10 分钟后第一次唤出、连续至少 30 次快捷键 toggle；确认不需按第二次才显示。
2. 在紧凑与默认展开模式分别检查输入框可交互时间、透明窗口无淡入/延迟、鼠标拖动、点击桌面或其他程序触发 blur-hide、Escape、点击结果后隐藏。
3. 实际启动应用/打开收藏网站；`file:` 在 Everything 中搜索并打开文件、`?` 浏览器跳转、`/` 收藏网站 Enter 打开；检查中文、全拼、首字母和排序。
4. 若想继续评估实验 flag，在同机同配置下分别安装 A/B，按相同顺序测任务管理器整个 WebTools 进程组、首次唤出和视觉效果。B 包会覆盖同版本安装，测试完请重新安装正式 A 包。

**保留：**2B-1 生命周期统一和 2B-2 空查询索引延后。**没有实施：**2B-3 的任何拼音库架构修改。**未进入正式配置：**2B-4 的 `backgroundThrottling=true`。本阶段到此停止，不进入 Phase 2C。
