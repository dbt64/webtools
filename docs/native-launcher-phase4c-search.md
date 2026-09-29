# WebTools Native Launcher Phase 4C：搜索核心与应用目录

## 1. Executive Summary

Phase 4C 在独立 WPF Host 中加入实际应用目录、搜索/排序、拼音、收藏网址、`?` 网页搜索、`file:` Everything 和按需图标。搜索路径不启动 Electron、Node、Chromium 或 V8。Electron Launcher 保留为参考与回退；本阶段没有接入 Manager、安装程序或数据写入。下面的自动化证据支持继续做人工验收，但不能替代用户机器上的启动、输入法和长时间运行检查。

## 2. Phase 4B Baseline

同机 Phase 4B 空壳 WPF 五轮 30 秒冷闲置 Private Bytes 中位数为 **48.01 MiB**，Electron 为 **225.26 MiB**。当时没有真实目录、索引、网址、文件或图标；[Phase 4B 报告](native-launcher-phase4b-poc.md)中的值不是完整 Launcher 成本。

## 3. Electron Search Contract

以现有 `parseSearchCommand`、共享搜索索引、Launcher 结果模型、App Catalog 与 `Everything` IPC 的当前代码为 oracle。空查询无结果；普通查询将应用和网址合并排名，最多 8 条，符合条件的英文词或短语另加翻译行；`/` 只筛网址；`?` 使用选定搜索引擎；`file:` 使用 Everything。应用选择记忆提升同一 query 的选中应用。未修改 Electron 搜索实现来迁就 Native。

## 4. Native Search Architecture

`WindowsAppSource → AppCatalogService → SearchCore → SearchResult → MainWindow`。网址是只读 snapshot，Everything 是异步独立路径，图标只针对可见结果请求。Hotkey 与托盘先注册，再异步读取网站、扫描目录、构建索引。目录未就绪时窗口仍可显示并给出加载提示。没有在每次键入时扫描磁盘、读取 JSON 或执行 PowerShell。

## 5. App Catalog

应用目录在后台一次扫描；本机检查得到 **286 条合并后应用，约 15.4–15.8 秒**。较早 WPF smoke 的 Host hotkey/tray ready 为启动后 **437.576 ms**，catalog ready 为 **15,567 ms**；最终压力 smoke 在输入后等到真实目录结果约 **16.19 秒**。目录按有效调用目标去重：相同 exe 但不同参数或工作目录不会合并，重复快捷方式名称进入 aliases；catalog ID 用稳定 SHA-256 前 16 位。这个扫描耗时值得后续实机关注，但未阻挡首个热键。没有新增目录 watcher 或周期轮询。

本机目录快照中可见 Visual Studio Code、微信、QQ 和 Google Chrome 等实际安装程序；它们的真实启动和图标效果仍需在用户机验收。

## 6. Catalog Sources

递归读取用户/公共 Start Menu、用户/公共 Desktop 的 `.lnk`，用 WScript.Shell COM 解出目标、参数、工作目录；逐条隔离坏链接。另读取 Windows Start Apps 的 packaged AUMID、App Paths 注册表，以及固定的文件资源管理器、控制面板、设备管理器记录。系统应用同时有明确中文名与英文 aliases。`Get-StartApps` 只在目录构建时执行一次；运行时普通查询不调用 PowerShell。

## 7. SearchResult Contract

结果含 `Id / Kind / Title / Subtitle / Rank / Match / Action / IconReference`。Action 是类型化的应用、网址、文件或翻译动作，不带 WPF 控件、HWND 或 HICON 所有权。文件打开动作通过 `EverythingClient` 内的路径 token 解析；同进程 WPF 的图标引用仍可持有文件路径。翻译动作已能显示，但 Manager handoff 明确留到 Phase 4D，点击时给出提示而不假装成功。

## 8. Core Matching

Native 与 TS 对照实现 Unicode NFKD、大小写/附加符处理、name/alias/word initials/full pinyin/pinyin initials/combined text 的匹配层级。普通应用和网址共享 Top 8；翻译作为第 9 行。`SearchCore` 是不依赖 WPF 的内存索引。查询模式改变或隐藏时结果和选择重建/清空。

## 9. Ranking

按匹配层级、`zh-CN` 名称排序、稳定原始顺序打破并列；命中搜索记忆的应用提升到首行。冻结 fixture 与同输入的 Electron oracle 均比较结果种类、ID、标题、动作和 Top 8 顺序，不要求数值分数 bit-for-bit 一致。

## 10. Unicode / Locale

使用 .NET `CompareInfo` 的 `zh-CN` 排序与 Rune 级归一化。它不保证与 JavaScript ICU 在所有 Unicode 字符上完全相同，因此以实际 fixture/corpus 对比判断；未宣称全 Unicode 等价。英文翻译判断包含常见扩展 Latin 字母、空格、撇号和连字符，排除中英混合及命令模式。

## 11. Pinyin

`pinyin-pro` 只在构建时生成 20,935 个 Han 读音映射，Native 运行时读嵌入资源，不运行 JS。常见多音词有有限的短语覆盖。当前本机 **286 个应用名的拼音表示与 Electron 生成结果 0 差异**；冻结 fixture 覆盖中文、全拼、首字母、多音词及中英混合。生成数据附带 `pinyin-pro` MIT license。未声称任意新词的多音字都完全一致。

## 12. Search Memory

Phase 4C 只在 Host 生命周期内保存 query→app ID 的有限记忆（最多 100 条）；跨重启权威状态和旧 Electron 记忆迁移留到 Phase 4D。网址配置只读，索引只构建/刷新，不在 hide→show 时重扫。隐藏清理临时 query、结果行和快捷按钮，保留目录和索引。

## 13. Website Search

只读 `%APPDATA%\Nook\nook-data.json` v2 的必要网址、搜索引擎和开关字段；无写回。当前本机读取 3 条收藏网址。普通查询保留应用+网址混合结果；名称、URL 片段和搜索说明参与索引。网站打开交给 Windows 默认浏览器。

## 14. Web Command

`?query` 读取当前选定且启用的引擎模板，将 query URL 编码后通过系统 shell 打开。本机 v2 配置含自定义默认引擎；合成快照断言验证选中百度时生成对应 URL。UI 自动化验证 `?` 输入和提示；浏览器实际打开仍需人工检查。

## 15. Website Command

`/query` 仅搜索已保存网址，匹配名称与 URL 片段；不由 renderer 根据输入拼任意网址。窗口自动化通过 `/name` 和 `/URL-fragment`，键盘选择使用公共结果模型。实际默认浏览器打开待人工检查。

## 16. Everything

`EverythingClient` 从配置、安装目录或 PATH 寻找 `es.exe`，通过 `ArgumentList` 传字面 query，按版本选 JSON/UTF-8 或 CSV，运行与状态检测有超时。异步 debounce、取消 token 和递增 generation 防止旧结果覆盖新查询。当前机器直接返回 `codexLogin` 文件夹与 `.lnk`，UI 自动化看到真实文件夹结果；未借用 Electron。

## 17. Icon Pipeline

`SHGetFileInfoW` 获取可见结果图标，转冻结的 WPF BitmapSource 后立刻 `DestroyIcon`；失败使用通用结果图标。按引用做最大 64 项 LRU，未预扫全目录图标。100 个应用图标的独立检查解析 100/100，cache 64；GDI 句柄初轮 0→41，第二轮仍 41。打包应用的 AUMID 若无可用文件引用仍可走通用图标，需实机目视评估。

## 18. Action Execution

独立 `ResultActionExecutor` 按类型调度普通 exe、`.lnk`、packaged app、固定系统应用、网址及文件/目录。启动使用 `ProcessStartInfo` 与 Windows shell；固定系统动作不插入用户输入，网址仅允许无凭据的 HTTP(S)。文件 token 只由 Everything 客户端解析。静态 action 检查通过；隔离测试还创建临时 `.lnk` 并执行其目标和参数，成功写出预期标记，确认真实快捷方式启动路径无需 Electron。第三方应用、packaged app、网址、文件及目录的真实外部启动仍需人工验收。

## 19. Parity Fixtures

`native/search-contract/electron-oracle.mjs` 从现有 Electron pure functions 生成 20 个冻结 query；`WebTools.NativeHost.Checks` 读取同一 JSON。另用本机 Native 的 286-app catalog + 3-site snapshot 输入 Electron pure functions，比较 20 个 query 的结果。此测试证明**同一输入上的搜索核心**，不证明两侧原始 catalog 枚举逐条相等。

## 20. Parity Differences

冻结 fixture：**0 个 Top 8 ID/顺序差异**；本机同输入 20 个 query：**0 个结果差异**；本机 286 个应用名拼音 corpus：**0 个差异**。潜在差异：未对两个独立 catalog 做全量来源/ID 对比；多音词未覆盖的未来名称、ICU 极端排序和 AUMID-only 图标仍可能不同。没有把这些未知项记作通过。

## 21. Search Latency

最新 1,000 次控制台搜索，950 个内存查询 median **0.031 ms**、p95 **0.170 ms**；50 个 Everything 查询 median **166.572 ms**、p95 **180.361 ms**。Everything I/O 单独统计，不能混入内存搜索结论。最终 1,000 搜索 + 300 toggle 窗口 smoke 首个热键到可见约 **65.63 ms**，300 次 show median **31.14 ms**、p95 **47.11 ms**；这是本机 UIAutomation 读数，不代表用户轻薄本。

## 22. Memory Checkpoints

主指标为进程组 Private Bytes，1 MiB = 1,048,576 bytes。历史 Phase 4B 空壳 30 秒中位数 **48.01 MiB**；Phase 4C 完整冷闲置 5 轮依次为 **68.32、68.43、68.29、75.37、77.28 MiB**，中位数 **68.32 MiB**，1 个 PID。合并增量约 **20.31 MiB**；分阶段单次测量的环境波动不足以精确归因给目录、拼音或图标中的某一项。三轮长闲置中，第一轮从 30 秒 **67.81 MiB / GDI 15** 到 600 秒 **99.24 MiB / GDI 62**；第二轮 **68.22→66.13 MiB / GDI 15→15**；第三轮 **68.06→67.40 MiB / GDI 15→15**。第一次增长未在后两轮复现，原因仍未知。没有使用强制 GC、working set trim 或人为减功能。

| 10 分钟轮次 | 30 秒 Private MiB | 120 秒 | 300 秒 | 600 秒 | GDI 30→600 |
|---|---:|---:|---:|---:|---:|
| 1 | 67.81 | 未采 | 未采 | 99.24 | 15→62 |
| 2 | 68.22 | 66.29 | 66.17 | 66.13 | 15→15 |
| 3 | 68.06 | 67.55 | 67.44 | 67.40 | 15→15 |

各 C2–C7 checkpoint 未保留同一条件下的独立发布物与可靠 30 秒测量，因此**不能提供逐模块增量归因**。这是本轮测量缺口，Q9 记录为 Unknown；不得由最终 20.31 MiB 差值推测“拼音最大”或“图标最大”。

## 23. Stress Results

控制台 1,000 次查询 Private Bytes 30,081,024→29,024,256 bytes，GDI 0→0、USER 5→6。最终同一 WPF 进程完成 **1,000 次混合 UI 查询 + 300 次 toggle**：首次显示前 **79.55 MiB / GDI 15 / USER 25**，1,000 次查询后 **113.32 MiB / GDI 57 / USER 49**，隐藏后 **114.91 MiB**，30 次 toggle 时 **133.24 MiB / GDI 59**，100 次 **125.12 MiB / GDI 72**，300 次 **119.96 MiB / GDI 69 / USER 43**。同一轮后段 Private Bytes 回落，没有持续单调增长；GDI 比初始高，但在 1,000 次查询后至第 300 次只从 57 到 69，USER 从 49 降到 43。另一轮纯 300-toggle 的 GDI 在第 100 次 91、第 300 次回到 59，Private Bytes 从 111,935,488 降到 102,686,720 bytes。有限次数的回落不构成“无泄漏”的证明。

合并压力脚本先有一次输入被清空的失败，根因未确认；另一次固定等待 18 秒时应用目录仍未 ready，诊断日志证实是测试脚本的就绪假设错误。脚本改为等待真实应用结果并保留文本/可见性断言后，完整 1,000+300 运行通过，目录就绪等待 **16.19 秒**。这项修改只涉及测试脚本，不改变产品的 hide/focus 行为。

## 24. Electron vs Native Final A/B

同机独立五次 30 秒冷闲置：Native Phase 4C Private Bytes 中位数 **68.32 MiB / 1 PID**；Electron `release/win-unpacked/WebTools.exe --hidden` 中位数 **224.71 MiB / 4 PIDs**。差 **156.38 MiB，Native 低约 69.6%**。这是进程组 Private Bytes 对比，不是 Task Manager 的“内存”列；Electron 的 Working Set 求和还会重复计入共享页。Electron 首次搜索和压力阶段没有同口径 A/B，故只比较 idle，不声称这些阶段的收益。

| 平台 / 轮次 | PID | Private MiB | Working Set MiB | Root GDI | Root USER | Root threads |
|---|---:|---:|---:|---:|---:|---:|
| Native 1 | 1 | 68.32 | 124.05 | 15 | 25 | 26 |
| Native 2 | 1 | 68.43 | 124.46 | 15 | 25 | 26 |
| Native 3 | 1 | 68.29 | 123.98 | 15 | 25 | 25 |
| Native 4 | 1 | 75.37 | 145.52 | 22 | 41 | 28 |
| Native 5 | 1 | 77.28 | 149.45 | 21 | 41 | 27 |
| Electron 1 | 4 | 224.71 | 347.84 | 34 | 52 | 51 |
| Electron 2 | 4 | 227.02 | 406.11 | 34 | 51 | 49 |
| Electron 3 | 4 | 224.40 | 402.23 | 34 | 52 | 51 |
| Electron 4 | 4 | 221.57 | 411.03 | 34 | 52 | 51 |
| Electron 5 | 4 | 227.92 | 414.46 | 34 | 51 | 50 |

## 25. Known Limitations

- 当前 Native 是独立发布物，未接入 installer、Manager、设置写入或跨重启搜索记忆；翻译 action 只显示提示，Phase 4D 才做 handoff。
- 网址和搜索引擎设置只在 Host 启动时读取一次；Electron 中途修改数据后的同步留给 Phase 4D。
- 目录初扫本机约 15.8 秒；首热键可用，目录未完成时应用结果仍未就绪。
- 当前只读兼容 loader 要求 v2 JSON；损坏/旧版本给出错误，应用目录搜索仍可继续。
- 图标只取有文件引用的可见结果；packaged-only 可能回退通用图标。
- 当前自动化已覆盖隔离的真实 `.lnk` 启动，但没有覆盖用户实际第三方/packaged app 启动及默认浏览器交付；UI polish 不属于 Phase 4C。
- 一次 10 分钟纯闲置样本的 Private Bytes 与 GDI 句柄高于 30 秒时；另两轮未复现。原因尚无法静态确认，应继续观察是否与 Windows 会话活动、平台延迟初始化或资源保留相关。

## 26. User Manual Validation Required

请在用户机器用独立 `native/WebTools.NativeHost/publish/WebTools.NativeHost.exe` 验证：首个热键、英文/中文/全拼/首字母/alias/模糊搜索及结果顺序；第三方 exe、快捷方式和 packaged app 的 Enter/点击启动；收藏网址与 `?` 在默认浏览器打开；`file:` 文件和文件夹打开；真实应用图标与回退；中文 IME 输入；多显示器/DPI；托盘退出；长闲置后第一次热键及 300 次切换。Phase 4D 之前不要把这个独立 Host 与现有 Electron 安装版设为同时抢占同一热键。翻译跳转目前明确不可用。

手测前先从托盘退出安装版 Electron WebTools，再启动独立 Native Host；首次目录加载在本机约需 16 秒，期间热键可显示窗口但应用结果会提示目录加载中。该 `publish` 当前是 framework-dependent 构建，测试机需已安装相应 .NET 10 Windows Desktop Runtime；它不是 NSIS 安装包。

- [ ] 首次热键、长闲置后首次热键、连续唤出/隐藏
- [ ] 英文、中文、全拼、拼音首字母、alias、模糊/子串搜索与排序
- [ ] 普通 exe、桌面 `.lnk`、packaged app 的键盘 Enter 与鼠标点击启动
- [ ] 收藏网址普通搜索、`/name`、`/URL-fragment` 与默认浏览器打开
- [ ] `?query` 采用当前选定引擎并打开浏览器
- [ ] `file:` 文件和文件夹搜索与打开
- [ ] 真实程序图标、无法提取图标时的通用回退
- [ ] Arrow Up/Down、Enter、Escape、blur-hide、拖动、紧凑/展开
- [ ] 中文 IME composition、粘贴、多显示器与混合 DPI
- [ ] 托盘退出、长时间 idle 与压力操作后的资源占用

## 27. Phase 4C Completion Decision

**实现与自动化验收：通过；用户实机验收：待完成。** Native 已在 Electron 不启动的条件下完成实际目录搜索、网址、Everything、键盘/鼠标和图标的核心路径，同机内存优势明显。但实际外部启动、中文 IME、长期闲置和另一台硬件上的交互仍要由用户确认，故不把整个替换迁移宣告完成。

## 28. Phase 4D Readiness

可把本阶段代码和测量作为 Phase 4D 的输入；**不自动进入 Phase 4D**。优先在用户机确认外部 action、真实 IME、图标、目录初扫和长闲置响应。Phase 4D 仍须设计 Native↔Electron Manager 通信、状态归属、设置同步、跨重启应用记忆、翻译 handoff 和 renderer 生命周期；本阶段未实现这些工作。

## Validation and evidence

- x64 .NET 10.0.401 `restore`、`build -c Release`（0 warning/0 error）、`publish -c Release -r win-x64` 通过；`dotnet test` 执行但项目不含标准测试发现，实际断言由 Checks 控制台运行，**14/14 通过**，另有独立真实 `.lnk` action 集成检查通过。
- Electron 回归：web `vue-tsc`、node `tsc`、Node **103/103** tests、`electron-vite build` 均通过。
- 最新 WPF smoke：实际 Launcher 窗口与焦点、中文/拼音、`/`、`file:`、`?`、翻译候选、展开/收起、ESC、拖动、失焦及同一进程 1,000 次搜索 + 300 次 hotkey toggle 均通过；原始样本在 `%TEMP%\WebToolsNativeHost-PoC\interaction-memory-20260929-123251-4404.csv`。
- 五轮 30 秒 Native / Electron 原始 CSV 分别为 `%TEMP%\WebToolsNativeHost-PoC\memory-20260929-010058.csv` 与 `memory-20260929-010614.csv`。
- 三轮 10 分钟 Native 闲置 CSV 为 `%TEMP%\WebToolsNativeHost-PoC\memory-20260929-013547.csv`、`memory-20260929-014627.csv` 与 `memory-20260929-015642.csv`。

## Q1–Q12 quick answers

1. **Q1** 本机 Native 目录覆盖 Electron 当前实现的四类来源，286 条合并记录；尚无两侧独立完整目录逐条比较，因此缺项为 Unknown。
2. **Q2** 同输入英文查询的 Top 8 oracle 差异 0；独立来源可能造成的差异仍需验收。
3. **Q3** fixture 的中文/全拼/首字母通过，本机 286 名称拼音差异 0；未覆盖所有未来多音词。
4. **Q4** 20 个同输入 query 的 Top 8 差异 0；未观察到排序原因差异。
5. **Q5** 网站、`?`、`/` 的搜索/模板/窗口显示路径通过；真实浏览器 action 待人工。
6. **Q6** `file:` 使用 Native `es.exe` 集成，已在 Electron 不启动时返回真实文件夹与快捷方式。
7. **Q7** Native 查询运行时没有 Electron、Node、Chromium 或 V8 依赖；构建时用 JS 生成静态拼音数据。
8. **Q8** 48.01 MiB → 68.32 MiB（五轮冷闲置中位数，+20.31 MiB）。
9. **Q9** 无法可靠拆分最大增量来源，**Unknown**。
10. **Q10** 同一进程 1,000 搜索 + 300 toggle 后 Private Bytes 比第 30 次 toggle 峰值低约 13.28 MiB；GDI 57→69、USER 49→43（从搜索结束到第 300 次），未见持续单调增长；仍需重复长时测试。
11. **Q11** 核心搜索可独立日用，但翻译/Manager 入口尚待 Phase 4D，外部启动需人工验证。
12. **Q12** 可在人工验收后计划 Phase 4D；当前不自动继续。

本阶段没有 commit、push 或 PR。
