# Launcher Lightweight Optimization — Phase 2A Audit

日期：2026-09-28。范围：当前工作树中的 Phase 1 修复版 Launcher、其 preload 和与之共享的构建产物。本报告只审计，不修改产品代码、窗口生命周期或默认设置。

## 结论先行

- **未发现 Launcher 意外加载 Manager、Translation、Settings 或 AI Provider 的 Renderer JS。** Manager 有独立入口和 chunk；Launcher 共享的是 Vue、`pinyin-pro`、实际使用的 Lucide 图标和搜索工具等。
- 约 655 KB 的共享 JS 主要是 `pinyin-pro` 的字典/实现和 Vue。该数字是构建后的未压缩文件字节数，**不能换算成任务管理器中的内存占用**。
- 能从代码确认的两个可避免成本是：空查询也会建立拼音索引；搜索后由主进程失焦/快捷键隐藏时，结果 DOM 和当前查询仍留在离屏 Launcher 中。两者都值得进入 Phase 2B 测量和小范围 A/B，但目前无法确认能节省多少常驻内存，也不能牺牲首次输入速度。
- 没有证据表明 Phase 1 的 version 检查变成后台轮询，也没有发现确定的持续泄漏。`backgroundThrottling` 保持原值，先做 A/B 测试。

## 证据与测量口径

1. 阅读 `launcher.html`、`src/launcher.ts`、Launcher 的直接/间接源码、`electron.vite.config.ts`、preload、IPC、Main 生命周期及相关 Git 提交。
2. 用现有 `electron-vite build --sourcemap --outDir <临时目录>` 生成独立分析产物，没有安装 analyzer。下表“模块贡献”按 source map 相邻生成映射段归因；压缩器合并代码及未映射片段会产生误差，**不是精确的模块计量，也不是内存计量**。
3. 在隔离的 `WebTools-Dev` 配置中以 `--hidden` 启动构建后的 Electron，通过本机 CDP 只读采集 `Runtime.getHeapUsage`、`Memory.getDOMCounters` 和 `Performance.getMetrics`。该实例当时约有 285 个应用、1 个网址，设置为默认展开。采样改变了调试环境；不能直接代表用户安装版或长期稳定值。
4. 用户在同一机器上的任务管理器读数：Phase 1 前空闲/Manager 关闭约 135 MB、Manager 打开约 175 MB；Phase 1 修复后约 111 MB、152 MB；使用 Translation 后约 175 MB，关闭 Manager 后约 125 MB。用户未观察到连续操作后持续单调增长。这些是**用户实测进程组读数**，不与下述单个 Renderer 的 JS heap 相减或等同。

需要区分：磁盘 bundle 字节、V8 已解析代码、JS heap、Vue/DOM 对象、Chromium Renderer/GPU/Utility 固定开销、NativeImage/图片与缓存。当前只直接测到第一项以及隔离实例的部分 JS heap/DOM 指标；其他分项需要后续进程级 profiling。

## 1. Launcher dependency graph

```text
launcher.html
└─ src/launcher.ts
   ├─ vue: createApp
   ├─ src/shared/theme.ts: applyTheme, system media-query listener
   ├─ src/styles/tokens.css
   └─ src/features/search/LauncherView.vue
      ├─ vue: ref/computed/watch/nextTick/lifecycle
      ├─ @lucide/vue: Launcher 所用图标
      ├─ src/features/search/launcher-results.ts
      │  ├─ src/shared/search.ts + search-normalization.ts
      │  └─ src/shared/app-search-memory.ts
      ├─ src/features/search/launcher-search-index-cache.ts
      │  └─ src/shared/pinyin-index.ts
      │     └─ pinyin-pro: pinyin() + 字典/分词实现
      ├─ src/shared/search-command.ts + theme.ts
      ├─ use-app-result-icons.ts + use-website-icons.ts
      ├─ SearchResultName.vue → shared/search.ts
      ├─ BookmarkDialog.vue + Favicon.vue
      └─ logo-dark.svg + logo-light.svg

单独的 preload: electron/preload.ts → IPC_CHANNELS (src/shared/ipc.ts)
Manager: index.html → src/main.ts → src/App.vue → Search/Entries/Settings/Translate 页面
```

`LauncherView.vue` 对 `AppSearchEntry`、`WebsiteSearchEntry`、设置等使用的 `import type` 在输出中被擦除；`src/shared/domain.ts` 的类型定义并不意味着整个设置/翻译模块进入 Launcher。Launcher 内的“翻译”仅是搜索结果 action 和 Manager 导航入口，不是 `TranslateView.vue`、翻译 Provider 或 SharedAIService。source map 中的 Manager 入口 chunk 没有被 `launcher.html` 引用；Manager 专用 `index-S1CnedOF.css` 也没有被引用。共享的 `tokens-CTe298EE.css` 含 Launcher 与 Manager 的全局样式规则，因此 Launcher 会解析部分用不到的 CSS。

## 2. Bundle composition

`electron.vite.config.ts` 用 Rollup 的 `index.html`、`launcher.html` 双入口构建，未配置自定义 `manualChunks`。本次临时 sourcemap 构建结果如下（未压缩磁盘字节）：

| 产物 | 字节 | Launcher 加载？ | 说明 |
| --- | ---: | --- | --- |
| `launcher-*.js` | 43,926 | 是 | Launcher 页面与局部逻辑 |
| `tokens-*.js` | 655,107 | 是，modulepreload | Vue、拼音库、共享搜索代码/图标 |
| `tokens-*.css` | 49,941 | 是 | 共用样式，含 Manager 规则 |
| `index-*.js` | 135,780 | 否 | Manager 页面与功能组件 |
| `index-*.css` | 3,539 | 否 | Manager 入口样式 |
| `preload/index.js` | 7,043 | 是，独立隔离世界 | Electron bridge + IPC channel 常量 |

Launcher 的两个 JS 文件合计 699,033 B，另有约 49,941 B CSS；这不是解析后 heap 大小。对 655,107 B 共享 JS 的 sourcemap 归因：

| 来源 | 映射归因字节（约） | 说明 |
| --- | ---: | --- |
| `pinyin-pro` | 404,801 | 主要是 `dict1`、`dict2`、`dict4` 等字典及分词实现 |
| Vue packages | 194,044 | runtime core、reactivity、runtime DOM、shared |
| 项目共享代码/资源 | 13,401 | 搜索工具、对话框/Favicon、主题、Logo 等 |
| `@lucide/vue` | 8,071 | 实际引用图标和基础 Icon 组件 |
| 未归因的压缩器/模块包装代码 | 34,790 | 不能可靠分配给单一包 |

Launcher 自身 43,926 B chunk 中，约 37,701 B 映射到项目 Launcher 代码，约 644 B 映射到其额外 Lucide 图标，其余未映射。最大的共享单一源文件是 `pinyin-pro/dist/esm/data/dict1.mjs`（映射归因约 249,752 B）。这说明优先调查拼音依赖合理，但**不能由 405 KB 推断能节省几 MB 内存**。

## 3. `pinyin-pro`

`src/shared/pinyin-index.ts` 只调用 `pinyin(entry.name, { toneType: 'none', type: 'array' })`，再生成完整拼音、首字母、标准化名称/别名等索引。源码使用包根目录的 ESM 命名导入；`pinyin-pro@3.29.4` 的 `package.json` 声明 ESM 入口和 `sideEffects: false`。构建 source map 包含其约 20 个 ESM 模块，未看到导出表中的 `match`、`html`、`convert` 等整套 API 全部进入输出；说明 tree shaking 已生效。保留下来的大字典属于当前 `pinyin()` 调用路径，直接改成深层路径导入未必减少它们，且会耦合包内部结构。

运行时行为比文件大小更重要：`dict1.mjs` 在模块求值时创建 `FastDictFactory` 并填充字典；`common/segmentit/index.mjs` 在模块求值时调用 `scheduleAcBuild()`，若 `requestIdleCallback` 可用便**一次性**预建分词树。`ensureAcBuilt()` 在真正调用拼音时也会保证构建。它不是周期性轮询，但可能让隐藏的 Launcher 在空闲回调中产生一次 CPU/heap 峰值。现有代码未测出字典、树各自占用的 heap，不能把整个 6.5 MB Renderer heap 归因给拼音。

另有一条确定的空查询计算链：`useAppResultIcons()` 的 immediate watcher 读取 `visibleAppIds` → `launcherActions` → `searchRows` → `index.value`；`searchRows` 在调用 `searchLauncherEntries()` 前无条件读取索引。即使 `searchEntries()` 随后对空查询返回 `[]`，初次加载应用列表时仍会建立索引。Phase 1 的分数据集 cache 能避免以后未变更数据的重复建立，但不阻止第一次空查询建立。这是启动 CPU/索引对象候选，不等同于 `pinyin-pro` 模块本身的常驻成本。任何延后索引方案都必须测量首次输入延迟并回归中文、全拼、首字母、模糊匹配及排序。

| 方案 | 潜在内存 | 延迟/启动 | 复杂度与 IPC | 搜索正确性风险 | 本阶段判断 |
| --- | --- | --- | --- | --- | --- |
| A 保持现状 | 已知稳定；具体拼音 heap 未分离 | 模块/字典常驻，首次查询已有索引 | 最低，无新增 IPC | 最低 | 默认基线 |
| B 更精确 import | 当前已经是 ESM 命名导入；收益可能很低 | 可能不变 | 深层路径受包内部变更影响 | 中 | 先用产物证明差异，不直接改 |
| C lazy initialize / import | 未查询前可能推迟字典、树和索引 | 首次中文/拼音查询可能变慢 | 中；需处理并发首查与缓存 | 中高 | 仅做受控实验并设延迟门槛 |
| D 其他执行上下文建索引 | Renderer 可少留部分对象，整体进程组未必下降 | 初始化/传输时机改变 | 高，额外序列化/生命周期 | 高 | 不作为短期默认方案 |
| E Main 预生成可搜索表示 | 可能避免两个 Renderer 各持有拼音字典，但 Main 需常驻数据 | Main 启动/IPC 成本增加 | 高，需保持排序和数据版本一致 | 高 | 先做跨进程内存归因，再决定 |
| F Worker | 可隔离/终止时释放一部分对象，也可能增加固定开销 | Worker 启动及通信影响首查 | 高，消息传输与停止时机复杂 | 中高 | 当前无证据支持引入 |

## 4. Vue runtime、组件与隐藏 DOM

Launcher 是一个独立 Vue app，没有 Vue Router 或 keep-alive。静态代码中 `LauncherView.vue` 约有 23 个 `ref`（包括元素 ref）、12 个 `computed`、7 个 `watch`；两个图标 composable 各有一个 watcher。按功能可见的本地组件是根 `LauncherView`、`Favicon`、`SearchResultName` 和条件渲染的 `BookmarkDialog`；Lucide 图标另产生组件实例。搜索结果和收藏卡片按当前数据量重复实例化。

隔离实例的动态快照（1 个收藏网址，查询 `visual` 命中 9 行；Vue 内部 vnode 遍历得到的实例数只用于相对比较）：

| 状态 | Vue 实例数 | CDP DOM nodes | CDP JS event listeners | JS heap used |
| --- | ---: | ---: | ---: | ---: |
| 隐藏、空查询、启动 30 秒后 | 约 5 | 75 | 13 | 6,510,828 B |
| 展开、空查询 | 约 12 | 124 | 24 | 6,821,000 B |
| `visual` 结果可见 | 约 20 | 332 | 51 | 7,633,796 B |
| 结果页直接由 Main 离屏隐藏 | 约 20 | 332 | 51 | 7,637,156 B |

数字不是同一次 GC 后的严格对照，且 DevTools 会影响测量。它只证实：紧凑空闲 DOM 很小；**Main 的 hotkey/blur 隐藏只把窗口移到屏幕外，不通知 Renderer 清空 query**，因此最近一次搜索的结果组件、图标状态和 DOM 可以继续留在隐藏窗口，直到下次 show 事件重置 query。Renderer 自己的 Escape/打开结果路径会先清空 query；两种隐藏路径不同。此驻留会影响“使用后空闲”，但不解释“从未搜索过时约 111 MB”的全部占用。

`ResizeObserver` 只在快捷区域存在时观察其容器/卡片；`IntersectionObserver` 只针对当前快捷网址/结果可见区域，切换内容时会 disconnect，组件卸载时也 disconnect。`useWebsiteIcons` 清除离开可见区域的 data URL；`useAppResultIcons` 保留当前查询结果图标，Main 的 `AppCatalogService` 另按 app ID 缓存成功或失败的 icon Promise。两者目前没有被证实会持续泄漏；多次不同查询后的缓存规模需运行时测量。

## 5. preload 与安全边界

Launcher 和 Manager 共享 `electron/preload.ts`，输出约 7.0 KB，source map 只有该文件和 `src/shared/ipc.ts`。它向隔离的 Renderer 暴露完整 `DesktopApi`，含 Launcher 不会用到的 Manager 设置、翻译、AI 与网址编辑 wrapper；这些只是 IPC 函数，不会加载 Manager/Provider 业务实现。`onTranslationPrefill` 仅在调用时注册 `ipcRenderer.on` 并返回注销函数，Launcher 不调用它；preload 无 timer、轮询、大型 cache。

Main 的 `settings:get`、`settings:update`、翻译和 Launcher data 等关键 handler 分别校验 Manager/Launcher frame；因此“暴露了 wrapper”不等于 Launcher 获得相应权限。Phase 2B 不应为了极小的 preload 字节收益破坏 `contextIsolation: true`、`sandbox: true` 或 sender 校验。独立 Launcher bridge 可作为安全边界整理议题，但当前内存收益未知且预期低。

## 6. hidden runtime activity 与 Phase 1 version

- `loadLauncherData()` 只在 `onMounted`、`webtools-launcher-show` 和成功修改收藏夹后调用；`LauncherDataService` 仅在成功刷新应用或更改网址/收藏夹时增加 version。没有后台 version timer、重复 IPC polling 或全量 show reload。
- `file:` 搜索使用一次性 160 ms debounce timer 和 sequence 防旧结果；普通隐藏空闲没有长期搜索 timer。`theme.ts` 的 system 模式有一个 `matchMedia` change listener，重新应用主题前移除旧 listener。
- 拖动使用 pointermove/up/cancel listener，仅在按下搜索栏时注册，并在 pointerup/cancel 时移除；组件卸载时可清理的 observer 和 show event listener 均已清理。若拖动中途发生异常窗口/页面卸载，pointer listener 没有单独在 `onBeforeUnmount` 移除；Launcher 常驻使实际影响有限，仍可在后续生命周期检查中验证。
- 从隐藏 0 秒到 30 秒，隔离实例的 `TaskDuration` 从约 0.0001 秒到 0.0179 秒，未观察到持续的 JS 定时任务负载；这是一次短采样，不能证明 10 分钟内绝无周期活动。上文 `pinyin-pro` 的一次性 idle 回调可能在启动早期执行。

## 7. `backgroundThrottling`：只设计 A/B，不改现值

`electron/main.ts` 为 Launcher 设置 `backgroundThrottling: false`。Git commit `8959340` 同时引入离屏常显、`showInactive()` 和此选项，提交目的是改善 Launcher 启动/去掉 Windows 透明窗口 show/hide 淡入淡出；没有专门注释或独立实验说明 `backgroundThrottling: false` 对热键延迟必不可少。代码里也没有持续动画或依赖后台高频 timer 的逻辑。**其必要性需要运行时验证，不能凭静态代码删除。**

后续 A/B：只改变此标志，其余代码/配置/数据相同。每组冷启动后等待 30 秒、10 分钟，分别测第一次与连续 30 次 hotkey 唤出到首帧/输入框可交互的中位数和 P95、隐藏空闲 CPU 与进程组内存；重复紧凑/展开、搜索、失焦、ESC、拖动和全局快捷键测试。保留 Windows 透明窗口无淡入效果的验收。记录 Main/Renderer/GPU/Utility 各自内存和 JS heap；如差异小于运行噪声或出现交互回归，维持 `false`。

## 8. 候选、风险与 Phase 2B 顺序

| Candidate | Current Cost | Expected Benefit | Risk | Complexity | Recommendation |
| --- | --- | --- | --- | --- | --- |
| 空查询仍建立拼音索引 | 确认存在；285-app 样本的索引/CPU 单独成本未知 | Unknown | 首次输入延迟、排序回归 | Low–Medium | P2：先量首查，再尝试延迟索引建立 |
| Main 隐藏后保留查询/结果 DOM | 样本 332 nodes/51 listeners；隐藏空白基线 75/13；heap 未作 GC 对照 | Low–Medium，需同口径复测 | 隐藏/重唤状态及竞态 | Low–Medium | P2：实验性清理隐藏结果，保留热键交互 |
| `pinyin-pro` eager module/idle trie | 共享 JS 约 405 KB 映射归因；独立 runtime heap 未测 | Unknown | 首查拼音延迟与功能正确性 | Medium–High | P2：先拆分 heap/启动 trace，再做可回滚 A/B |
| 搜索过的 app icon cache | Main 按 ID 缓存 Promise；实际字节和增长未知 | Unknown | 重查图标速度 | Medium | P2：若压力测试显示持续增长，再考虑上限/LRU |
| 共用 CSS | 49,941 B 文件，部分 Manager 规则对 Launcher 无用；CSSOM 内存未知 | Low | 样式遗漏、维护重复 | Medium | P3：仅在 CSS profiling 有收益时拆分 |
| 共用 preload API | 7,043 B 文件；Manager-only wrapper 无业务逻辑 | Low | IPC 合约/权限回归 | Medium | P3：不为内存单独拆分 |
| Lucide 图标 | 共享 JS 约 8 KB 映射归因，已只包含实际用到的图标 | Low | 自定义 SVG 维护成本 | Low–Medium | P3：保持现状 |
| Vue runtime | 共享 JS 约 194 KB 映射归因；单独 heap 未测 | Unknown | 框架替换会高风险 | High | 禁止框架迁移；仅优化状态/DOM 使用 |
| `backgroundThrottling` | runtime 影响未知 | Unknown | 唤出延迟、焦点/视觉回归 | Low for test | 只做 A/B，当前不修改 |
| Manager-only JS | Launcher 静态依赖图与 HTML 均未引用 | None | 无 | None | 无需处理 |

**风险等级：**没有确认的 P0 持续泄漏，也没有可凭现有数据断言的 P1 高收益改造。已确认但收益待测的空查询索引、隐藏结果 DOM、拼音预建归 P2；CSS/preload/图标等归 P3。这里的“收益”是相对判断，不对应具体 MB。

建议 Phase 2B 串行顺序：

1. 建立同机同口径基线：冷启动/空闲 30 秒与 10 分钟、首次输入与反复热键、搜索后隐藏、Manager 开关；同时记录进程组和各进程内存、Renderer heap/DOM、CPU 与首帧延迟。区分普通缓存、GC 波动和持续增长。
2. 在隔离分支做**单项** A/B：先评估隐藏结果清理，再评估空查询索引延迟建立。每项均回归 `?`、`file:`、`/`、中文/拼音/首字母、排序、图标、热键/ESC/blur/drag；任何首查延迟明显变差则撤回。
3. 只有当进程级/heap profiling 指向拼音字典或 idle trie 是主要可控成本时，再试 lazy import 或执行上下文方案，并独立测试首次查询及整体进程组内存。避免把字典从 Renderer 搬到 Main 后仅转移内存。
4. 独立进行 `backgroundThrottling` A/B；不与其他实验混合。图标 cache、CSS 与 preload 只有在测量指向它们时再处理。

**Phase 1 后确定值得继续调查的项目：**空查询的提前索引构建、搜索后隐藏仍保留的结果 DOM，以及 `pinyin-pro` 的一次性字典/分词树初始化。前两项是代码确认的可避免工作；第三项是最大 bundle 来源，但其任务管理器内存收益仍未确认。

**理论上可优化但当前不应修改的项目：**用内部路径替代现有 ESM 导入、移动索引到 Main/Worker、拆 preload/CSS、替换 Vue/Lucide、修改 `backgroundThrottling`、改窗口常驻策略。现有证据不足以证明这些改动能在保持 Launcher 即时响应和搜索正确性的同时降低总内存。
