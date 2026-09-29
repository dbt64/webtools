# WebTools Performance Optimization — Phase 3B

日期：2026-09-28

范围：TranslateView initialization lifecycle guard；Settings-only async component experiment。没有改动 Search、Entries、Translation prefill protocol、Manager window lifecycle 或依赖。

## 1. TranslateView 生命周期竞态

TranslateView 现在以 `isMounted` 保护异步初始化。`getSettings()` 与 `getTranslationProviderInfo()` 完成后，只有页面仍挂载时才提交语言/provider 状态；错误处理与 `finally` 也会检查挂载状态。卸载时先清除 mounted 状态，再清除 debounce 并取消活动请求。自动翻译调度和 `translate()` 本身也检查 mounted 状态，防止已排队回调在卸载后发起请求。

450 ms 自动翻译、语言设置保存、翻译请求 gate、已有取消/Abort 行为均保留。没有使用固定延时解决生命周期问题。

新增 `translate-view-lifecycle.test.mjs`，通过 Vue 自定义 renderer 挂载真实 SFC，并用可控 Promise 覆盖：

- 初始化 pending 时卸载，随后 resolve：不再安排自动翻译，也不调用翻译 IPC。
- 正常挂载并 resolve：仍按 450 ms 调度一次翻译。

测试在修复前按预期失败：卸载后仍调用了一次翻译；加 guard 后通过。`settingsReady` 是组件私有变量，测试通过“没有生成 timer/翻译请求”验证它不会在卸载后产生可观察副作用。现有 translation request gate 与 Main cancellation 测试也继续通过。

## 2. Settings-only lazy loading

Manager 仍静态加载 Search、Entries、Translate。Settings 改为 `defineAsyncComponent(() => import(...))`。点击设置时由真实 async component 生命周期显示 `正在加载设置…`；加载失败显示有限错误状态。没有引入 timeout 或新依赖。

Settings 初始化增加局部 `isMounted` 检查：普通设置、Provider descriptors / translation info、Provider statuses、Everything detection 的异步结果只在组件仍挂载时写入 refs。没有改变 AI connection test 的既有请求取消契约。

构建产物检查确认 `SettingsView` 成为独立 JS/CSS chunk。A 初始 entry 含有设置专属文案“默认 AI 提供方”；B 初始 entry 不含该文案，而 Settings async chunk 含有，证明 Settings 页面代码已从 Manager 首始 entry 中移出。A/B 代码只在 Settings 是否动态加载及其加载/错误 UI 上不同；Translate lifecycle 修复和 Settings mounted guard 同时存在于两版。

## 3. Production bundle A/B

文件大小为未压缩的 production asset 字节数；KB 使用构建器显示的十进制 KB。它们反映首始加载的文件量，不等于 RAM，也没有被换算为内存收益。

| Asset | A：同步 Settings | B：异步 Settings | 变化 |
| --- | ---: | ---: | ---: |
| Manager initial JS entry | 136,296 B | 88,413 B | -47,883 B（-35.1%） |
| Shared `tokens` JS | 655,063 B | 660,632 B | +5,569 B |
| 初始 JS 合计（entry + shared） | 791,359 B | 749,045 B | -42,314 B（-5.35%） |
| Settings async JS chunk | — | 52,447 B | B 延迟加载 |
| Manager entry CSS | 3,539 B | 2,190 B | -1,349 B |
| Shared CSS | 49,941 B | 49,941 B | 无变化 |
| Settings async CSS chunk | — | 1,349 B | B 延迟加载 |

Settings 首次进入延迟、CPU parse/evaluate 时间、JS heap、Renderer 私有内存及进程组内存没有在本轮获得可靠实测值。构建差异支持“未访问 Settings 时少加载约 42.3 KB JS 和 1.35 KB CSS”的结论，不支持具体 RAM 或启动时间承诺。

## 4. Windows A/B installers

安装包使用 electron-builder NSIS，x64，版本 0.1.0；两个包使用相同的应用 ID，可顺序安装用于比较。

- A，同步 Settings：[WebTools-Phase3B-A-SyncSettings-0.1.0.exe](<D:/System default/Desktop/HomePage/release/phase3b-ab-a/WebTools-Phase3B-A-SyncSettings-0.1.0.exe>) — 111,622,622 B
- B，异步 Settings：[WebTools-Phase3B-B-LazySettings-0.1.0.exe](<D:/System default/Desktop/HomePage/release/phase3b-ab-b/WebTools-Phase3B-B-LazySettings-0.1.0.exe>) — 111,624,964 B

本机 PowerShell 能运行 Codex 提供的 Node，但 `npm.cmd` 进程启动被 Windows 拒绝，导致直接 electron-builder 尝试无法读取 npm 依赖树。为完成计划要求的安装包，使用了两个临时 staging manifest 和同版本 electron-builder，manifest 仅列出已编译的 `out`、品牌资源和固定 Electron 版本，不包含 Node dependencies；实际 `out/main/index.js` 只外部导入 Electron 与 Node 内置模块，Renderer 依赖已由 Vite 打包。安装包已成功生成，staging 文件已清理，项目 `package.json` 和依赖未修改。

## 5. 验证结果

- Typecheck：通过。使用项目 `vue-tsc` 与 `tsc` CLI 直接执行，与 `npm run typecheck` 两个子命令一致。
- Tests：103 passed / 0 failed。使用项目 `node --experimental-strip-types --test` 命令。
- Production build：A 与 B 均通过；最终 `out` 为 B 异步 Settings 版本。
- `git diff --check`：通过；输出仅含既有 LF/CRLF 转换提示。
- Windows installers：A、B 均成功生成。
- GUI runtime / 用户交互 A/B：未实测。Phase 3A 已记录当前 Codex 环境 Electron GPU 子进程以 `0xC0000135` 退出；本轮不虚构首开延迟、设置页面体验或内存数据。

## 6. 人工验证清单

请按顺序安装 A、记录、再安装 B 覆盖 A 后记录。建议使用同一台 Windows 机器和相同操作节奏：

1. Launcher 空闲后打开 Manager，仅停留快速搜索，等待 30 秒并记录整个 WebTools 进程组内存。
2. 第一次进入设置：确认 loading 状态短暂且清楚、无整页空白/闪白/无响应；检查普通设置、搜索引擎、AI Provider、API Key 保存/删除、Provider 状态、连接测试、Everything 检测及保存反馈。
3. 返回快速搜索，再次进入设置，确认已加载后无明显等待。
4. 关闭并重开 Manager，重复观察；进入翻译并完成一次翻译。
5. 从 Launcher 触发翻译预填，确认原文仍精确进入翻译页，且现有自动翻译/取消行为正常。
6. 快速进入翻译再离开，确认卸载后的初始化不发起翻译请求；必要时在网络面板观察请求。

可以只记录任务管理器中的 WebTools 进程组总内存；若方便，再记 Renderer 数字。请把 A/B 的等待与内存结果一并反馈，便于做最终保留决定。

## 7. 最终决定与阶段结论

- **3B-1：保留。** 已有自动测试复现并证明卸载后的自动翻译副作用被阻止。
- **3B-2：作为受控实验暂时保留在当前工作树。** 真实 bundle 已拆分，初始 JS 合计减少 42,314 B，加载 UI 很小；但首次设置 UX 和运行时内存收益仍 Unknown。A/B 安装包已提供，只有实机确认没有可感知回归后，才把 B 认定为最终产品行为；如首次设置等待明显或功能有回归，应撤回 Settings lazy loading，保留 3B-1。
- **Phase 3：代码实施和静态验证已完成，性能验收待 A/B 人工结果。** 本轮没有 commit、push 或 PR。
- **Phase 4：暂不建议立即开始。** 目前没有持续增长证据；先取得 A/B 实测结果，再决定是否有足够理由检查 Main / Service / Cache。

### Q1：Translate lifecycle race 是否彻底修复？

已按静态生命周期与自动集成测试修复：卸载后异步初始化不能恢复 settingsReady、安排自动翻译或发起请求。Windows GUI 网络面板仍建议人工确认。

### Q2：Settings 是否真正形成独立 async chunk？

是。B 有 52,447 B `SettingsView` JS chunk 和 1,349 B CSS chunk；Settings 专属文案不在 B Manager entry 中。

### Q3：Settings lazy loading 是否产生值得保留的实际收益？

已证实 Manager 初始加载文件更小，但 RAM、CPU 与用户等待收益未测量。当前保留为 A/B 候选，最终决定等用户实机结果。

### Q4：Phase 3 是否已经可以结束？

Phase 3B 实施可以暂停并交付；全局性能验收建议等 A/B 手测反馈后结束。Phase 4 目前不启动。
