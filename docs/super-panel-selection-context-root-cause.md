# Phase 6F-3 Selected Context Activation Root-Cause Audit

> 最新状态见文末 **Runtime Evidence Round 2** / **Universal Selection Compatibility Fix**。初次静态审计与 Diagnostic Preview 章节保留当时的代码、证据和未确认结论；其中行号与 `CaptureText` 引用属于历史快照。用户现已提供运行证据，确认两项兼容性根因；本轮修复仅完成源码开发，尚未编译或执行运行验收。

日期：2026-10-11\
范围：只读生产源码审计与根因分析；本轮只新增本报告。

> **ROOT CAUSE REQUIRES RUNTIME EVIDENCE**。静态源码揭示了文本和 Explorer 选择捕获的具体脆弱路径，也确认了一个 650 ms 超时后的异步焦点竞态可能性；但当前没有对应失败操作的 provider、阶段、耗时或返回值记录，无法证明哪条路径发生在用户实际操作中。

本轮没有运行应用、测试、typecheck、构建或打包；没有修改产品代码、测试、既有文档、配置或 evidence。NoContext 的 3×3 方格、Tile 和 Panel 几何不在调查范围内。

## A. User-Confirmed Symptom

用户已确认 NoContext 的 3×3 方格、正方形 Tile 和 Panel 比例正常。本轮剩余现象是：

- 鼠标触发后，选中文字没有进入 SelectedText Presentation。
- Explorer 中选中文件没有进入 SelectedFiles Presentation。
- Explorer 中选中文件夹没有进入 SelectedDirectories Presentation。
- ExplorerFolder、NoContext 等其他状态可以显示。

这是“捕获结果没有进入目标模式”与“有效模式未显示正确视觉根”两种故障层级的区分；目前没有实际 Capture 输出可判断用户操作落在哪一层。

## B. Complete Call Graph

| 顺序 | 生产代码 | 当前行为及可能失败/丢弃点 |
|---|---|---|
| 1 | [`MouseTriggerObserver.Observe`](../native/WebTools.NativeHost/SuperPanel/MouseTriggerObserver.cs#L49) | 低级鼠标 Hook 过滤注入事件。按下触发按钮时，press 模式直接调用 `_activate(bindingVersion)`；hold 模式先启动计时器，达到配置阈值后由 `HoldElapsed` 调用。Hook 不保存前台 HWND、PID 或 selection snapshot。 |
| 2 | [`SuperPanelTriggerController.CreateMouse`](../native/WebTools.NativeHost/SuperPanel/SuperPanelTriggerController.cs#L62) | 检查 observer/binding 后，通过 `Dispatcher.BeginInvoke` 将 `Toggle()` 排入 WPF Dispatcher。原鼠标事件与之后执行 `Toggle()` 之间存在异步间隔。 |
| 3 | [`SuperPanelTriggerController.Toggle`](../native/WebTools.NativeHost/SuperPanel/SuperPanelTriggerController.cs#L77) | `async void` 增加 `_intent`。如果窗口已显示则隐藏并返回；否则调用 `CaptureAsync()`。await 后若 disposed、intent 已变化或触发器禁用，则直接丢弃 capture；否则关闭 Launcher 并调用 `Present(context)`。 |
| 4 | [`SelectionCaptureService.CaptureAsync`](../native/WebTools.NativeHost/SuperPanel/SelectionCaptureService.cs#L13) | 在方法入口先同步读取当前 foreground HWND/PID。前台无效、属于 NativeHost、或已有捕获占用时直接返回 None。随后启动后台 STA Thread。 |
| 5 | [`CaptureExplorer` / `CaptureText`](../native/WebTools.NativeHost/SuperPanel/SelectionCaptureService.cs#L35) | Worker 先试 Explorer Shell；它返回 `null` 时才走 UI Automation 文本捕获。Explorer 的 COM 异常会被转换为 `null`，继而尝试 Text。Text 的 UIA 异常会被外层 catch 转成 None。 |
| 6 | [`NativeFeatureInvocationProtocol.IsValidRequest`](../native/WebTools.NativeHost/Services/NativeFeatureInvocationProtocol.cs#L38) | Capture 生成 payload 后以协议 validator 校验；无效内容转为 None。约束包含文本长度、项目数量、完整路径、字符和序列化大小。 |
| 7 | [`SelectionContext.Mode`](../native/WebTools.NativeHost/SuperPanel/SelectionContext.cs#L10) | 按 payload `Type` 映射 `text/files/directories`；无 payload 时，仅有效 ExplorerFolder 元数据映射为 ExplorerFolder，否则为 NoContext。 |
| 8 | [`SuperPanelWindow.Present`](../native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml.cs#L53) | 保存 Capture 返回的 context，按 Mode 准备视觉内容，随后 `Show()`、布局、定位、`Activate()`、`Focus()`。 |
| 9 | [`PresentContext` / `RefreshFeatures`](../native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml.cs#L78) | `PresentContext` 按 Mode 选择相应 context root；之后 `RefreshFeatures` 只匹配 Action 和填充列表，不改变 Mode/root。 |

应用启动期间已创建隐藏的 SuperPanel window 和触发器，见 [`App.OnStartup` 初始化片段](../native/WebTools.NativeHost/App.xaml.cs#L165)。捕获不负责创建窗口。

### 前台与焦点顺序

**常规成功路径：**`CaptureAsync` 在 `Toggle` 第一次 await 前同步采集 foreground HWND/PID；Worker 在设置 `TaskCompletionSource` 前完成 Explorer/UIA capture 和后置 foreground HWND 校验；`Toggle` 收到结果后才调用 `Present`，而 `Present` 才执行 `Show/Activate/Focus`。因此在成功完成且未超时的路径上，SuperPanel 不会先取得焦点再发起 UIA 查询。

**超时路径例外：**若 650 ms 到期，`CaptureAsync` 返回 None，`Toggle` 随后可以显示并聚焦 Panel，而后台 Worker 没有被取消、仍可能继续执行 UIA 查询或 Shell 调用。此时 Worker 后续读取的 `FocusedElement` 可能已不属于原应用，且最后的 foreground HWND 校验也会失败。源码证明此竞态路径存在，但没有 runtime timing 证据证明它是本次故障原因。

## C. Selected Text Audit

生产文本路径位于 [`SelectionCaptureService.CaptureText`](../native/WebTools.NativeHost/SuperPanel/SelectionCaptureService.cs#L35)：

1. `AutomationElement.FocusedElement` 在 STA Worker 中读取，而不是 Hook 的 mouse-down 回调中读取。
2. 只接受 focused element 的 `Current.ProcessId` 等于 capture 开始时记录的 foreground PID，且 `IsPassword` 为 false；PID 不匹配、密码控件或 focused element 为 null 都返回 None。
3. 只调用 focused element 自身的 `TryGetCurrentPattern(TextPattern.Pattern, ...)`。不查询 `TextPattern2` 或 `ValuePattern`，不向 parent/child/descendant 查找，也没有 bounded UIA tree traversal。
4. 当前焦点元素不直接暴露 `TextPattern` 时立即返回 None。对 Chromium、Electron、VS Code 或嵌套 UIA provider，这是一项源码确认的兼容性限制；但本轮没有记录用户实际焦点元素和 pattern 能力，不能确认它解释了用户的具体实例。
5. 仅使用 `TextPattern.GetSelection()`，最多取 8 个 range、每个调用 `GetText(3000)`；合并后为空或纯空白就返回 None。没有调用 `DocumentRange`。空 selection、range 读取异常都会失败。
6. 合并文本截到 3000 字符，并避免截断到孤立 high surrogate；协议 validator 再检查 payload 和最大请求字节数。验证拒绝会返回 None。
7. UIA/COM 异常没有细分原因；异常落入 Worker 的总 catch 并变成泛化 None。当前没有可关联某次触发的 CaptureAttemptId 或失败阶段日志。

所以，“focused element 自身不提供 `TextPattern`”是一个已确认的窄实现限制和 SelectedText 候选根因，不是本次实际故障已确认根因。

## D. Explorer Selected File Audit

生产 Explorer 路径位于 [`SelectionCaptureService.CaptureExplorer`](../native/WebTools.NativeHost/SuperPanel/SelectionCaptureService.cs#L50)：

1. 仅当前台 HWND 的窗口类名为 `CabinetWClass` 或 `ExploreWClass` 才尝试 Shell；否则转文本捕获。
2. 创建 `Shell.Application` 并最多枚举 64 个 `ShellWindows` 项。通过 `browser.HWND == foreground HWND` 匹配，命中后读取该 `browser.Document.SelectedItems()`。
3. 没有显式识别 Windows 11 Explorer 的活动 Tab、活动 ShellBrowser 或活动 FolderView，也没有在一个 HWND 对应多个候选时校验当前活动视图。源码只能确认 HWND 匹配策略及其不确定性，不能静态断言 Windows 11 实际会返回错误 Tab。
4. `SelectedItems.Count == 0` 才调用 `CaptureCurrentFolder(document)`。Count 大于 64 返回 None；正数时逐项检查 `IsFileSystem` 和完全限定路径，再用 Shell item 的 `IsFolder` 分类。代码中没有 `File.Exists`/`Directory.Exists` 过滤，所以不存在“存在性检查把有效项过滤成空列表”的路径。
5. 对普通单文件，正数 Count、可读 filesystem item、合格路径会生成 `Type="files"`、Kind=`file` 的 payload；协议再校验后返回 context。路径、文件名不合格或虚拟 Shell 项会直接返回 None。
6. `SelectedItems()`、Count、item 属性等 COM 调用异常会被 `CaptureExplorer` 最外层 catch 转为 `null`，随后尝试 `CaptureText`。它**不会**把异常直接当作 Count=0，也不会因该异常直接调用 ExplorerFolder fallback。

## E. Explorer Selected Directory Audit

目录与文件共用同一 Shell enumeration / `SelectedItems` / 路径校验流程。单个普通文件夹在 `IsFolder == true` 时会被标记为 Kind=`directory`；如果所有项都是 directory，payload type 为 `directories`，后续 Mode 才映射为 SelectedDirectories。若为混合选择（文件与目录同时存在），现有逻辑将 payload type 设为 `files`；它仍携带两类 item，UI 文件摘要可显示两种数量。这只是现有分类行为，本轮不建议重构。

因此单个目录无法进入 SelectedDirectories 的候选失败点与文件类似：Shell HWND/活动视图关联、Count/COM 读取、item 属性或路径校验、timeout/foreground 校验。没有运行时 Count 和项目分类记录，无法判定用户实际在哪一步失败。

## F. ExplorerFolder Comparison

- ExplorerFolder 的唯一创建点是 `SelectedItems.Count == 0` 后调用 `CaptureCurrentFolder(document)`。该分支读取 `document.Folder.Self`，要求 filesystem 对象、完全限定路径且长度不超过 2048，然后构造仅用于 UI 展示的 `ExplorerFolderMetadata`。
- Count 读取异常不会进入这个分支：异常被 catch 转成 `null`，再回退到 UIA Text Capture。
- Shell 窗口未匹配、Shell 对象不可用或 COM 异常同样返回 `null`，不会直接变成 ExplorerFolder。
- 若 HWND 命中了与真实选择不对应的 Shell `Document`/Tab，且该对象报告 `SelectedItems.Count == 0`，则可观察到 ExplorerFolder 而非所选文件/目录。这与用户描述相符，是需要 runtime 证据验证的 Windows 11 Tab/HWND 假设，不是当前已确认事实。

## G. Async / Timeout Audit

- Mouse Hook 的激活经 `Dispatcher.BeginInvoke` 排队；hold 模式在配置 hold threshold 到期时才激活。Hook 不把 mouse-down 时的 HWND/PID 带给 Controller，因此 Capture 取的是稍后 `Toggle` 执行时的 foreground。
- `CaptureAsync` 的 foreground HWND/PID 快照发生在其入口、创建 Worker 前。`WaitAsync(650ms)` 在 `thread.Start()` 后开始；650 ms 包含 STA Worker 调度/启动、Shell COM、UIA 与后置校验耗时，不包含前面的前台快照、Thread 构造和 `Start()` 调用耗时。
- timeout 只让等待方得到 None；没有 cancellation token、线程取消或 join。Worker 以后完成也没有回写 Panel 的路径；但 `_capturing` 直到 Worker 的 `finally` 才释放。若 Worker 长期卡住，之后的 Capture 会因 single-flight gate 直接返回 None。
- Worker 完成时再次读取 foreground HWND，必须仍等于开始时 HWND，否则即使 Provider 得到有效 payload 也被转换为 None。这里只比较 HWND，不保留 mouse-down 时的原始窗口，也不重新检查 PID。
- `_intent` 防止旧调用覆盖新的显示状态；若意图已变化，旧 Capture 被丢弃。它没有取消底层 Worker，也没有日志说明丢弃原因。
- 存在一个并发边缘路径：第一个 Toggle 正在等待 Capture 时，第二个 Toggle 可以拿到新 intent；第二次 Capture 因 `_capturing` 忙立即返回 None，第二次 intent 可先展示 NoContext；第一次结果随后因 intent 已过期而被丢弃。是否能由实际手势触发需运行时复现。
- 因此超时后不存在“迟到的有效 context 覆盖当前 UI”的回写竞态；存在的是 timeout 先返回 None、Panel 展示 NoContext、后台查询结果被忽略，以及后台查询可能在 Panel 焦点变化后才执行的路径。

## H. Failure Matrix

下表描述源码路径风险，不代表已观察到某次用户运行的内部结果。

| Stage | SelectedText | SelectedFile | SelectedDirectory |
|---|---|---|---|
| Trigger received | REQUIRES RUNTIME EVIDENCE | REQUIRES RUNTIME EVIDENCE | REQUIRES RUNTIME EVIDENCE |
| Original foreground preserved | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT |
| Provider located | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT |
| Selection returned | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT |
| Validation accepted | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT |
| SelectionContext created | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT | POTENTIAL FAILURE POINT |
| Correct Mode produced | CONFIRMED BY SOURCE | CONFIRMED BY SOURCE | CONFIRMED BY SOURCE |
| Correct Visual Root selected | CONFIRMED BY SOURCE | CONFIRMED BY SOURCE | CONFIRMED BY SOURCE |

`CONFIRMED BY SOURCE` 仅确认：**若**相应有效 payload 到达 `SelectionContext`，Mode 映射和视觉根选择是确定的。它不声称本次用户操作已到达该层。

## I. Top Root Cause Candidates

按源码与用户症状的匹配程度排序；这不是由样本测得的概率。

1. **UIA 只查焦点元素自身的 `TextPattern`。** 代码位置：`SelectionCaptureService.cs:37-42`。可解释 SelectedText，不能解释 Explorer file/directory。证明/排除：下一轮记录焦点元素的进程匹配、ControlType/FrameworkId、当前 TextPattern 可用性、selection range 数量与读取阶段结果；不记录文本。
2. **Explorer foreground HWND 与 Shell 当前活动 Tab/Document 关联不准确，命中的 Document 报告 Count=0。** 代码位置：`SelectionCaptureService.cs:61-73`。可解释文件和目录都落到 ExplorerFolder。证明/排除：记录匹配的 ShellWindows 项数量、候选 HWND 与活动视图/Tab 的安全关联标识、Count 是否成功及值；不记录路径/名称。
3. **Explorer Shell COM/item 属性访问异常被静默折叠为 `null`，之后 UIA fallback 也失败。** 代码位置：`SelectionCaptureService.cs:65-99`。可解释文件和目录都变成 None，但不会直接产生 ExplorerFolder。证明/排除：记录异常发生阶段、异常类型/HResult 与是否转 Text fallback。
4. **650 ms 等待超时，Panel 显示后 Worker 仍运行，产生焦点/前台校验失败并丢弃结果。** 代码位置：`SelectionCaptureService.cs:20-33`、`:24-28`；`SuperPanelWindow.xaml.cs:62`。可影响三种上下文。证明/排除：记录各阶段耗时、超时发生阶段、Worker 完成时间、timeout 后 UIA 开始时间与 foreground 变化；不增加 timeout 作为未经验证的修复。
5. **Hook → Dispatcher 延迟、hold threshold 或重复激活使 Capture 观察到不同前台，或 single-flight/intent 使一次结果被丢弃。** 代码位置：`MouseTriggerObserver.cs:77-103`、`SuperPanelTriggerController.cs:65-84`。可影响任一上下文。证明/排除：同一 attempt 关联 mouse-down、activation、Dispatcher 开始、Capture 快照、完成/intent-discard 时序，并记录按键模式；不记录选择内容。

## J. Root Cause Status

**ROOT CAUSE REQUIRES RUNTIME EVIDENCE**

源码已确认两个 provider 限制、Explorer 异常 fallback、650 ms 超时后无取消，以及有效 payload 到 UI 的映射逻辑。源码没有证明用户那几次具体触发时：Hook 是否触发、Explorer `SelectedItems.Count` 是否为 0、UIA 的 focused element/pattern 是否可用、是否触发超时，或 context 是否被 `_intent` 丢弃。因此目前不能把某一候选提升为用户问题的确定根因。

### 初次审计提出的 Diagnostic Preview 方案（历史记录）

建议做一轮仅诊断的 Preview，保持 selection 算法、超时值、UI routing 和九宫格不变。每次触发生成 `CaptureAttemptId`，记录有限、脱敏的阶段事件：

- Trigger：gesture/button、press/hold、mouse-down/hold elapsed 时间、Dispatcher 收到激活时间。
- Foreground：capture 开始时 HWND/PID、进程 basename（如有必要）、Worker 查询时和结束时 foreground 是否与起始一致；不要写完整窗口标题。
- Provider/stage：`ExplorerShell` 或 `UIAutomation`、`ShellWindows` 枚举结果、HWND 匹配数、当前可观察的活动视图标识、`SelectedItems.Count` 的成功/异常状态和值。
- Explorer 项目：只记项目数量、`IsFileSystem`、`IsFolder`、路径完全限定/长度/协议校验是否通过等类别和 reason code；不记文件名、完整路径或其散列。
- UIA：焦点元素是否为原 foreground process、ControlType/FrameworkId/IsPassword、当前 `TextPattern` 是否存在、`GetSelection` 是否成功/返回 range 数及字符数量类别；不记选中文本。可在单独审查后决定是否只探测 TextPattern2/ValuePattern 能力，避免诊断探测改变捕获行为。
- Lifecycle：每阶段耗时、650 ms timeout、timeout 后 Worker 是否继续、single-flight busy、foreground-changed、线程启动失败、sanitized exception type/HResult、`_intent` stale-discard。
- 结果：capture reason code、payload type（不记录 payload）、`SelectionContext.Mode`、最后选中的视觉 root 名称。
- 采集应有明确用户授权/诊断开关、记录数量上限和自动清理；不得记录选中文本、路径、文件名、凭据或 Secret。当前 `DiagnosticsService` 是有容量上限的内存事件集合，写入 `%TEMP%\WebToolsNativeHost-PoC` CSV；现有调用只覆盖触发器等事件，没有 selection capture 的逐阶段事件。

诊断结果应先回答失败发生在 Trigger、Provider、Selection、Validation、Context、Mode 还是 Presentation，再决定是否增加 UIA provider traversal、Explorer 活动 Tab 解析或调整超时。

## K. Fix（初次静态审计结论）

**NO PRODUCTION FIX APPLIED — DIAGNOSTIC PREVIEW REQUIRED**

本轮未确认唯一根因；没有修改 NativeHost、XAML、搜索、Feature matching、测试或既有文档。下一步应先由用户审核诊断字段与隐私范围，再单独授权 Diagnostic Preview；本轮不进入实现、测试或打包。

## 初次静态审计检查记录

- Branch：`codex/shared-ai-translation-2.0`
- HEAD：`707c5673dff479285b34a5b441bec9d3b725c737`
- 新增本报告前：工作区 219 个 dirty paths，staged 0；`git diff --stat` 显示 159 个 tracked files changed（3,219 insertions、13,154 deletions），另有 60 个 untracked paths。均为既存工作，本轮未清理、暂存或提交。
- 只读检查了相关 NativeHost 源码、诊断服务和现有 diagnostics 调用；未运行任何测试或构建命令。

## Diagnostic Preview Implementation

日期：2026-10-11\
Preview 标识：`WebTools-Phase6F3-Selection-Diagnostic-Preview`\
UX revision：`phase6f3-selection-diagnostic`

本节记录初次静态审计之后获准的诊断预览实现；前文的审计范围、根因候选和当时未实施状态是历史记录，不代表本轮没有实现预览。

### Diagnostic architecture

- `DiagnosticsService.BeginSelectionAttempt` 在 NativeHost 生命周期内为每次 Preview activation 分配递增 `SP-0001` 格式 ID；同一 attempt 传过 trigger、dispatcher、capture、context、intent 和 presentation。
- `App.xaml.cs` 仅当 `preview-build.json` 同时精确匹配指定 `previewName` 和 `superPanelUxRevision` 时启用 Selection diagnostics。普通 production metadata 不会打开 Selection 事件采集或 Footer。
- Selection events 复用既有 `DiagnosticsService` 内存队列及 `%TEMP%\WebToolsNativeHost-PoC` CSV；单事件 JSON 不超过 1,024 字符，Selection event 总量最多 512 条、每 attempt 最多 48 条，每个字段最多 80 字符。UI Copy trace 只包含当前 Attempt 的保留事件，显示长度有上限。
- 记录结构化 Stage、Result、ReasonCode、UTC timestamp、相对 Attempt 的 elapsed milliseconds 和白名单字段。诊断写入/observer 异常不会改变 Capture 或 Presentation。

### Observed stages

- Trigger：button、press/hold、触发 UTC、hold/dispatcher 时间及 `TriggerToDispatcherMs`；Tray activation 也使用相同链路。
- Foreground：HWND、PID、进程 basename、NativeHost 标记、窗口 class 和时间戳；不采集标题。
- Explorer：Shell enumeration 成败、候选总量/扫描量、匹配 HWND 数、采用的首个 candidate index、active tab identity 不可用状态、Document/SelectedItems 成败与 Count、处理/文件/目录/无效项计数、CurrentFolder metadata 可用状态。COM 失败只记阶段、异常类型和 HRESULT。
- UI Automation：focused element 是否存在及 PID 是否匹配、ControlType、FrameworkId、密码控件标记、TextPattern 结果、TextPattern2/ValuePattern capability（仅探测）、selection ranges 和字符数。不会调用额外 Pattern 读取选区内容。
- Lifecycle / validation / result：single-flight `CAPTURE_BUSY` 和阻塞 Attempt、650 ms timeout、Worker 继续/结束/总耗时、前台是否变化、协议接受/拒绝与安全 reason、Context 类型/计数、Mode、intent accepted/stale-discarded、最终 VisualRoot 和 matched feature count。

### Privacy and Capture behavior

- Selection diagnostic field采用 allowlist 与字符/长度限制；不记录选中文本、文件名、文件/文件夹路径、路径 hash、窗口标题、Secret 或 Token。`Copy Diagnostics` 只复制当前 Attempt 的这份脱敏 trace。
- Capture semantics、650 ms timeout、TextPattern-only selection、Explorer candidate 扫描与首个匹配项选择、路径形状预检查、protocol validation 和 presentation routing 没有改变；没有新增 UIA traversal/fallback、Explorer tab resolver、剪贴板读取/注入或 provider fallback。
- Explorer 在原有最多 64 个 ShellWindows candidate 扫描中，同时计数 HWND 匹配项并记录所采用的首个匹配 candidate index；诊断不会额外扫描候选或更改 document 选择。
- Footer 是唯一 UI 增量，只有上述 Preview 标识启用时显示：Attempt、Capture、Reason（失败时）、Mode、VisualRoot、匹配功能数及 Worker 仍运行状态。Copy Diagnostics 按钮复制脱敏 trace。Board/Tile 几何、context layouts 和触发体验未变。

### Build and package record

- Build command：`pnpm run package:win -- -PreviewOnly -PreviewName WebTools-Phase6F3-Selection-Diagnostic-Preview -PreviewUxRevision phase6f3-selection-diagnostic`
- Final fresh canonical stage：`release/phase6f3-selection-diagnostic-preview-20261011-143155/stage/application`
- NativeHost Release self-contained publish、Manager production build、NSIS compile 和 Portable ZIP 均完成。构建期间 .NET 报告既有 `UIAutomationClient` / `UIAutomationTypes` reference resolution warnings；NativeHost Release publish 最终成功。
- Portable ZIP：`D:\SystemDefault\Desktop\HomePage\release\phase6f3-selection-diagnostic-preview-20261011-143155\WebTools-Phase6F3-Selection-Diagnostic-Preview.zip`；237,610,228 bytes；SHA-256 `1E72D582B0A8A51458EB88E1514CC5B1E5577A11C491B419EC400EADB076F294`。
- Preview Installer：`D:\SystemDefault\Desktop\HomePage\release\phase6f3-selection-diagnostic-preview-20261011-143155\WebTools-Phase6F3-Selection-Diagnostic-Preview-Setup-0.1.0.exe`；191,653,172 bytes；SHA-256 `146AAC1560B895F4F412163A0FD9F61374A6B199366223225091A0B9DDEB71A6`。
- `preview-build.json`：`productVersion=0.1.0`、`previewName=WebTools-Phase6F3-Selection-Diagnostic-Preview`、`gitHead=707c5673dff479285b34a5b441bec9d3b725c737`、`dirty=true`、`buildTimestamp=2026-10-11T06:32:34.0298239Z`、`superPanelUxRevision=phase6f3-selection-diagnostic`。
- Static package consistency：stage 有 550 个文件；ZIP 有 550 个文件条目；逐项 SHA-256 mismatch 为 0。NSIS script 指向同一 `stage\application\*.*`，并保留 `Manager/` 相对目录与 `preview-build.json`。
- ZIP 解压根目录中的入口是 `WebTools.NativeHost.exe`；Manager 位于 `Manager\WebTools.exe`，资源位于 `Manager\resources\`。
- Automated tests / typecheck：未运行，按本轮授权明确禁止。
- Application / Installer launch、安装和人工 UX：未运行，留给用户用 Diagnostic Preview 收集 Selected Text、Selected File、Selected Directory、Explorer Empty Selection 四份 trace。
- 前两次构建的 ignored Preview 目录还留在 `release/`；仅第三次、与最终源码一致的目录是本报告交付对象。尝试移除第一次被替代的 ignored build directory 时，执行环境拒绝了递归删除请求；该目录不在 Git 状态中，也不影响最终包。
- 根因状态保持：**ROOT CAUSE REQUIRES USER DIAGNOSTIC TRACE**。

## Runtime Evidence Round 2

证据来源：用户本轮提供的 Diagnostic Preview 真实 Windows 运行结果摘要。以下是用户运行证据，不是 Codex 在本轮重新运行得出的结果；用户未提供的 AttemptId、应用版本、操作时间、完整 trace 文件与 hash 不作补写。

| 用户案例 | 已观察到的捕获链路 | 结论 |
| --- | --- | --- |
| Explorer Selected EXE | `CabinetWClass` → HWND 匹配 → SelectedItems.Count=1 → fileCount=1 → protocol accepted → SelectedFiles → FileContextRoot | CONFIRMED WORKING |
| Explorer Selected PNG | SelectedItems.Count=1 → fileCount=1 → SelectedFiles → FileContextRoot | CONFIRMED WORKING |
| Explorer Selected Directory | `CabinetWClass` → Document 可用 → SelectedItems.Count=1 → directoryCount=1 / invalidItemCount=0 → protocol accepted → SelectedDirectories → DirectoryContextRoot | CONFIRMED WORKING |
| Explorer Empty Selection | 用户明确确认原有空选择 / 当前文件夹路径正常 | CONFIRMED WORKING；本轮摘要未附该案例的逐事件原始 trace |
| Notepad Selected Text | `Notepad.exe` / `Notepad` → focused Document / Win32 → PID 匹配 → TextPattern available → rangeCount=1 / characterCount=4 → SelectedText → TextContextRoot | CONFIRMED WORKING |
| Chromium/Electron Selected Text | `ChatGPT.exe` / `Chrome_WidgetWin_1` → focused Group / Chrome → PID 匹配、非密码 → TextPattern unavailable → None → NoContext / BoardSurface；约 12 ms，没有 timeout / foreground change / stale intent / capture busy | ROOT CAUSE CONFIRMED：FOCUSED-ELEMENT-ONLY UIA PROVIDER RESOLUTION |
| Windows Desktop Filesystem Selection | `explorer.exe` / `Progman` → NOT_EXPLORER_WINDOW → 跳过 Shell selection → TextPattern unavailable → None / NoContext | ROOT CAUSE CONFIRMED：DESKTOP SHELL SELECTION PROVIDER MISSING |

这些证据确认了两个具体捕获入口缺口，并排除了这些已成功案例的 Mode / Presentation / protocol 路由故障。它们没有证明所有第三方应用都暴露可读选区，也没有证明未来修复的兼容性已通过验收。650 ms timeout 不是上述两个失败案例的根因，本轮不增加它。

## Universal Selection Compatibility Fix

### Provider responsibilities

生产链路现在是：

`SelectionCaptureService.CaptureAsync` → existing `CaptureExplorer` → `DesktopSelectionProvider` → `TextSelectionProvider` → existing foreground check / Complete → existing Controller intent check → existing Presentation。

- 普通 Explorer 保持原 class gate、ShellWindows 至多 64 项枚举、首个匹配 HWND 的 Document、SelectedItems 以及 Count==0 的 CurrentFolder 分支。只有正数选择的 classification / payload / validation 提取到 `SelectionCapturePayloads`，供 Desktop 复用。
- Desktop 仅负责获取真实桌面 FolderView 的选择，不创建新 Context Type。
- Text 独立负责有界 UIA provider resolution 和选区读取。
- `SelectionCapturePayloads` 统一构建与校验原有 text/files/directories payload；`NativeFeatureInvocationProtocol`、Feature matching、UI routing 和鼠标触发器未修改。

### Text provider resolution

1. 由捕获时 foreground HWND 获取 `AutomationElement.FromHandle`，校验其 NativeWindowHandle / PID 对应 foreground。读取 FocusedElement，并先证明它属于这个窗口层级且不在 password subtree。
2. 优先直接尝试 FocusedElement 的 TextPattern，保留 Notepad 的 provider 选择顺序。
3. direct 没有真实非空选择时，最多检查 8 层 ControlView ancestors；不会走出已验证的 foreground root。
4. 再搜索 focus subtree、两个最近包含 subtree，最后是已验证 foreground root 下的有界 subtree。使用 ControlView breadth-first traversal，单 scope 深度至多 4，所有 scopes 共享节点/候选预算与去重状态。不会搜索 Desktop root、其他窗口或全局 UIA tree。
5. TextPattern candidate 必须通过 `GetSelection()` 得到真实非空、非 whitespace 文本。空 range / caret / pattern 不支持 / candidate 异常允许在剩余 bounds 内继续；不读取 DocumentRange 或 ValuePattern.Value。
6. 每次读取最多处理 8 ranges，总结果最多 3000 UTF-16 code units；各次 GetText 使用剩余预算，结果再次裁剪，并避免尾部孤立 high surrogate。保留 protocol envelope / strict UTF-8 validation 与捕获结束的 foreground check。

| Bound | 当前源码值 |
| --- | --- |
| Ancestor provider depth | 8 hops |
| Descendant depth per scope | 4 |
| Unique candidate nodes probed | 96 across all strategies |
| Descendant queue nodes processed | 96 across all scopes |
| TextPattern candidates with selection calls | 12 |
| Raw ancestry ownership/password guard | 32 parent hops，ancestor-only |
| Selection ranges read | 8 |
| Embedded selected-range child checks | 32 per range；超出安全失败 |
| Result text | 3000 UTF-16 code units |
| Cooperative text-resolution budget | 500 ms，且受原捕获 650 ms budget 约束 |
| Existing outer WaitAsync timeout | 650 ms，未增加 |

这些时间检查在 UIA 调用之间生效；单次第三方 COM/UIA 调用仍可能阻塞。原有 STA Worker / single-flight / timeout 后 Worker 继续运行机制保持现状，没有借本轮实现强制线程取消。

### UIA research and application ownership

- [Microsoft TextPattern.GetSelection](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.textpattern.getselection?view=windowsdesktop-10.0) 区分实际 selection、caret 的 degenerate range 和不存在的 selection；provider 存在本身不代表选区有效。
- [Chromium AXPlatformNodeWin source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/accessibility/platform/ax_platform_node_win.cc) 的 TextPattern provider 条件包含 document / text field / text，而不是任意 Group。因此 generic ancestor/subtree resolution 与用户 Group 不提供 TextPattern 的 trace 相符。公开 source 是研究依据，不声称本轮已经测出用户具体版本的完整 accessibility tree。
- Chromium 同一 source 将 ProcessId 留给 UIA Core；不能从 Chromium 的 renderer process 模型直接推断某次 element 的 UIA PID。用户这次 focused Group 的 PID 已匹配 foreground。新实现校验顶层 HWND/PID，并以到同一 foreground root 的有界 parent chain 证明应用层级归属，不要求所有合法 descendants 的 PID 相同。
- 节点必须具有有效 PID，不能来自 NativeHost；它暴露的任何 NativeWindowHandle 必须位于 foreground HWND 下。异 PID 仅在该 hierarchy check 成立时接受，不通过 process name 或全局元素搜索扩大权限。
- focused node、candidate 及其 RawView ancestors 都检查 IsPassword；RawView 只用于有界 ancestor safety check，避免 ControlView 过滤了密码容器。选区 enclosing element 与 embedded children 同样先检查归属/密码标记，再调用 GetText。遇到 password selection 则停止该轮解析，不通过 ancestor/descendant fallback 绕过。
- 当前 `net10.0-windows` 项目使用 managed UIAutomationClient / UIAutomationTypes。本机 `Microsoft.WindowsDesktop.App.Ref/10.0.12/ref/net10.0` 的参考 XML 提供 TextPattern/GetSelection，没有 TextPattern2 包装类型。[Native TextPattern2](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nn-uiautomationclient-iuiautomationtextpattern2) 继承原 TextPattern，新增 caret / annotation 能力；本轮使用已有 GetSelection 语义，保留 capability-only probe。managed LookupById 无法解析时记录 unknown，不伪造 unavailable 或 selection。ValuePattern 同样只探测 availability。

### Desktop selection provider

- 识别 `Progman` / `WorkerW`，以及这些 root 下的 `SHELLDLL_DefView` / `SysListView32`；以 `GetShellWindow` 的 shell PID 校验 foreground 的 Shell 归属。
- 使用真实 `CLSID_ShellWindows` → `IShellWindows.FindWindowSW(CSIDL_DESKTOP, VT_EMPTY, SWC_DESKTOP, SWFO_NEEDDISPATCH)` → `SID_STopLevelBrowser` → `IShellBrowser.QueryActiveShellView`。不把 Progman 当作普通 Explorer browser HWND。
- 校验实际 view 为同一 Shell PID、`SHELLDLL_DefView`，位于 Progman/WorkerW root 并包含 SysListView32。再通过 `IShellView.GetItemObject(SVGIO_BACKGROUND, IID_IDispatch)` 获取 ShellFolderView automation，读取 `SelectedItems()`。
- 这条只读路线依据 [Microsoft 的 Desktop FolderView 示例](https://devblogs.microsoft.com/oldnewthing/20130318-00/?p=4933) 和 [Desktop automation object 示例](https://devblogs.microsoft.com/oldnewthing/20131118-00/?p=2643/)，以及 [FindWindowSW](https://learn.microsoft.com/en-us/windows/win32/api/exdisp/nf-exdisp-ishellwindows-findwindowsw) / [SWC_DESKTOP](https://learn.microsoft.com/en-us/windows/win32/api/exdisp/ne-exdisp-shellwindowtypeconstants) 的公开 API。没有使用写图标位置、选择项目或 ShellExecute 方法。
- COM references 在 finally 释放；没有建立 desktop listener、持续缓存、selection event subscription 或第二个 worker。
- 与 Explorer 共用 IsFileSystem、Path/IsFolder 分类、64 items / 1024-char path、mixed selection、duplicate/path/envelope validation。全部为目录时 type=directories；包含文件时 type=files。保留现有 source=`explorer-selection` compatibility contract，不引入 `desktop-files` / `desktop-directories`。
- .lnk 保持用户选中的快捷方式文件自身，不解析 target。虚拟项目没有 filesystem path 时，整次选择安全失败并记录 `DESKTOP_VIRTUAL_ITEM_UNSUPPORTED`。不制造 This PC / Recycle Bin / Network / Control Panel 的路径。
- Desktop empty selection 返回 None + `DESKTOP_SELECTION_EMPTY`，不把虚拟 Desktop 伪装为 Explorer Current Folder。

**EXPLORER SELECTION CAPTURE BEHAVIOR PRESERVED**（源码路径保持；本轮未执行回归，不声称修复后 Windows runtime PASS）。

### Diagnostics and privacy

- Text：增加 `TEXT_PROVIDER_RESOLUTION_STARTED`、`DIRECT_PATTERN_FOUND`、`ANCESTOR_PATTERN_FOUND`、`DESCENDANT_PATTERN_FOUND`、`TEXT_PROVIDER_CANDIDATE_REJECTED`、`TEXT_PROVIDER_RESOLVED`、`TEXT_PROVIDER_RESOLUTION_FAILED` 及 ownership 事件。
- 安全字段包含 strategy、depth、nodes/candidates、ControlType、FrameworkId、PID match、range/character counts、budget 与失败 reason。最多记录前 6 个详细 candidate 和前 2 个 subtree exception，剩余工作以 bounded counts 汇总，避免挤掉 terminal trace。
- Desktop：增加 started / view resolved or unavailable / SelectedItems call and count / classification / completed / provider exception，及 empty、virtual unsupported、invalid item、ownership failure reasons。
- DiagnosticsService 只扩展 Selection 字段 allowlist；512 Selection events / 48 per attempt / 1024-char event / 80-char field 等既有上限保持。原 Preview-only gate、Footer 和 Copy Diagnostics 保留。
- **No selected text, filename, complete path, folder/display name, window title, path hash, Secret/Token or plugin data in diagnostics.** UIA runtime IDs 仅保留于当次 resolution 的有界去重集合，不输出，也不跨 capture 缓存。
- 捕获没有 clipboard read/write、Copy command 或 synthetic keyboard extraction；用户主动点击原 Footer 的 Copy Diagnostics 行为没有修改。

### Scope, limitations and verification boundary

本轮修改文件：

1. `native/WebTools.NativeHost/SuperPanel/SelectionCaptureService.cs`：接入 provider pipeline，提取共享分类/校验。
2. `native/WebTools.NativeHost/SuperPanel/TextSelectionProvider.cs`：新增 bounded generic UIA selection resolution。
3. `native/WebTools.NativeHost/SuperPanel/DesktopSelectionProvider.cs`：新增真实 Desktop Shell provider 与必要只读 COM ABI。
4. `native/WebTools.NativeHost/SuperPanel/SelectionCapturePayloads.cs`：共用 filesystem classification / existing payload limits / validator。
5. `native/WebTools.NativeHost/Services/DiagnosticsService.cs`：扩展安全诊断字段白名单。
6. `docs/super-panel-selection-context-root-cause.md`：保存本轮用户 evidence、实现与边界。

**NO PRESENTATION CHANGES**。Board / context roots / geometry / Add / Remove / Drag / Pagination / placement / Mouse Trigger UX 未修改。

**DEFERRED — SELECTION CONTEXT FOUNDATION ONLY**。未来 Quick Translation 产品方向保留；本轮没有 Translation/AI/API 调用或第二套 NativeHost Translation Service。

不承诺 all Windows applications supported。未暴露可读 UIA selection、特殊 custom rendering、权限隔离、超出 traversal bounds 的树、未知/消失的 UIA owner、Shell view 不可用或不符合当前 Desktop hierarchy 的环境仍可能安全失败。第三方 provider 若错误暴露 password 标记/selection，不能由此源码证明其行为正确。编译、COM ABI runtime、Chromium/Electron/Firefox/WinUI/WPF 的实际选区、桌面 files/directories/mixed/virtual/.lnk，以及现有 Notepad / Explorer 回归均需下一轮授权后验证；没有把本轮源码实现写成 runtime PASS。

本轮只做公开 API/参考接口阅读、源码修改和静态源码范围复核；没有新增或修改 tests / fixtures / verification runner / evidence baseline，没有执行测试、typecheck、build、package 或启动任何应用/安装器。既有 Preview artifacts 未更新。没有操作真实安装、真实用户 profile、startup 或 Git stage/commit/push，既存 dirty working tree 保留。

**TESTING NOT RUN — USER HAS NOT AUTHORIZED TESTING**

**PACKAGING NOT RUN — USER HAS NOT AUTHORIZED PACKAGING**

## Universal Selection Preview Build

日期：2026-10-11。此节记录 Universal Selection Compatibility 源码的 Preview build/package；不会改写上方 Runtime Evidence Round 2 或把源码编译结果描述为运行时验收。

### A. Build result

**SUCCESS — BUILD AND PACKAGE ONLY.** 使用仓库现有 `package:win` / `PreviewOnly` pipeline。构建包含当前工作树的 TextSelectionProvider、DesktopSelectionProvider、共享 payload classifier 和 DiagnosticsService；没有运行 NativeHost、Manager、Installer、测试套件或安装 Smoke。

执行命令：

```powershell
pnpm run package:win -- -PreviewOnly -PreviewName WebTools-Phase6F3-Universal-Selection-Preview -PreviewUxRevision phase6f3-universal-selection
```

工具版本：Node `v24.21.0`，pnpm `9.15.9`，.NET SDK `10.0.401`，electron-builder `26.15.3`，Electron `44.4.5`。产品版本为 `0.1.0`。

### B. Compile fixes and warnings

**Compile blockers/fixes: NONE.** NativeHost、UpdateHelper、Manager build、Release publish、ZIP 和 NSIS Preview Installer 均成功。

NativeHost 构建输出 MSB3245（直接引用 UIAutomationClient / UIAutomationTypes 未找到）和 MSB3243（程序集引用冲突后选择带版本程序集）警告；相同的既有警告未阻止编译与 publish。electron-builder 另提示 `package.json` 缺少 author 元数据；Manager 打包继续成功。没有为这些既有警告改动项目依赖或构建设置。

### C. Diagnostic Preview identity gate

启动诊断开关现在精确接受以下两组已命名 Preview identity：

| previewName | superPanelUxRevision | Selection diagnostics |
|---|---|---|
| `WebTools-Phase6F3-Selection-Diagnostic-Preview` | `phase6f3-selection-diagnostic` | enabled |
| `WebTools-Phase6F3-Universal-Selection-Preview` | `phase6f3-universal-selection` | enabled |

其他名称、revision 不匹配或缺少 `preview-build.json` 时仍保持关闭；普通 production package 不会因此启用 diagnostics。新 Preview 的 footer 显示 Attempt、Capture、Reason（None 时）、Mode、VisualRoot、Matched features count，并提供 Copy Diagnostics。这个 gate 修改只允许新 Preview 使用上一轮已有的诊断 UI/trace，没有改变捕获行为或隐私字段。

### D. NativeHost and Manager build

- NativeHost：`net10.0-windows`，`win-x64` Release publish 成功，self-contained。入口为 `stage/application/WebTools.NativeHost.exe`，DLL、.NET runtime 与资源一并发布。
- UpdateHelper：`win-x64` self-contained Release publish 成功，位于本轮 stage 的 `updater/WebTools.UpdateHelper.exe`；不随 Portable application ZIP 打包。
- Manager：electron-vite production build 与 electron-builder `win32/x64`, Electron `44.4.5` `--dir` 成功，复制到 canonical application stage 的 `Manager/`。
- 这只是构建结果。没有启动 Manager / NativeHost，也没有声称 capture runtime、COM ABI 或 GUI 行为通过。

### E. Canonical stage and artifacts

Canonical release root：

`D:\SystemDefault\Desktop\HomePage\release\native-preview-20261011-154332`

Canonical application stage：

`D:\SystemDefault\Desktop\HomePage\release\native-preview-20261011-154332\stage\application`

Stage contains 550 files. Root `WebTools.NativeHost.exe`, `Manager/WebTools.exe`, `Manager/resources/app.asar`, `Manager/resources/`, and `preview-build.json` are present.

| Artifact | Path | Bytes | SHA-256 |
|---|---|---:|---|
| Portable ZIP | `D:\SystemDefault\Desktop\HomePage\release\native-preview-20261011-154332\WebTools-Phase6F3-Universal-Selection-Preview.zip` | 237,617,509 | `77E84C358518A101F841B6EF0E6A7B15BE2A91817F335DC12ED045D130E9BC04` |
| Preview Installer | `D:\SystemDefault\Desktop\HomePage\release\native-preview-20261011-154332\WebTools-Phase6F3-Universal-Selection-Preview-Setup-0.1.0.exe` | 191,612,099 | `8ADD7CC99AEF93BB1C083AE8899B309A32C78B6AF783859ACF0B2153ABAE212D` |

The ZIP contains 550 files. Static per-file SHA-256 comparison against `stage/application` found 0 missing entries, 0 extra entries and 0 hash mismatches. NSIS was compiled by the canonical script from this same `stage/application`; it was not independently rebuilt from another source tree. The prior `WebTools-Phase6F3-Selection-Diagnostic-Preview` artifacts and directories were not overwritten or reused.

### F. Preview metadata

```json
{
  "productVersion": "0.1.0",
  "previewName": "WebTools-Phase6F3-Universal-Selection-Preview",
  "gitHead": "707c5673dff479285b34a5b441bec9d3b725c737",
  "dirty": true,
  "buildTimestamp": "2026-10-11T07:44:05.8053785Z",
  "superPanelUxRevision": "phase6f3-universal-selection"
}
```

`dirty: true` records that the Git working tree was not clean when metadata was generated. It does not mean every dirty path is packaged, and it does not claim those changes are committed.

### G. User Runtime Validation Matrix

请运行 ZIP 中根目录的 `WebTools.NativeHost.exe`，通过 Super Panel 的 Copy Diagnostics 收集失败案例。诊断只用于说明受限 provider resolution 的阶段和结果；本次构建没有自行运行应用。

| Case | 操作 | 预期结果 |
|---|---|---|
| A — Notepad selected text | Notepad 选择普通文本并触发 Super Panel | `DIRECT_PATTERN_FOUND`；SelectedText / TextContextRoot |
| B — ChatGPT selected text | 在 ChatGPT 正文选择普通文本并触发 | FocusedElement 可以是 Group/Chrome；出现 ancestor 或 descendant pattern event、resolved、range≥1、character>0；SelectedText / TextContextRoot |
| C — Chrome / Edge selected text | 在普通网页正文选择文本并触发 | 成功时 SelectedText / TextContextRoot；记录 Copy Diagnostics |
| D — VS Code selected text | 在 editor 选择普通代码文本并触发 | provider 暴露有效 selection 时 SelectedText；不暴露时 diagnostics 应给出受限解析失败原因 |
| E — Desktop selected file | 桌面单击选择普通文件并触发 | Desktop view resolved、SelectedItems count≥1、fileCount≥1；SelectedFiles / FileContextRoot |
| F — Desktop selected directory | 桌面选择普通文件夹并触发 | directoryCount≥1；SelectedDirectories / DirectoryContextRoot |
| G — Explorer selected file | Explorer 选择普通文件并触发 | SelectedFiles / FileContextRoot |
| H — Explorer selected directory | Explorer 选择普通文件夹并触发 | SelectedDirectories / DirectoryContextRoot |
| I — Explorer empty selection | Explorer 当前文件夹内取消选择并触发 | ExplorerFolder / ExplorerContextRoot |

诊断导出不得包含 selected text、filename、path、folder name、display name、window title、path hash、Secret、Token 或 plugin data。Firefox、Windows Settings、WPF、WinUI 可选抽样，不属于本轮必须通过的矩阵。

### H. Product scope and status

本轮唯一产品源码调整是 `App.xaml.cs` 的 Preview identity allowlist，使上述新 Preview identity 开启既有诊断能力；没有修改 provider resolution、Desktop/Explorer capture、SelectionContext、presentation、feature matching、trigger、窗口几何、Launcher、Manager 或 Translation。

```text
SelectedText Chromium/Electron:
FIX IMPLEMENTED — AWAITING USER VALIDATION

Desktop Selection:
FIX IMPLEMENTED — AWAITING USER VALIDATION

Explorer:
PREVIOUS USER RUNTIME PASS — REGRESSION VALIDATION PENDING
```

本轮未安装 Installer、未启动任何打包程序，也未操作 `D:\webtools`、真实 profile、startup、settings 或 SecretStore。Portable ZIP、Installer 与 `preview-build.json` 是本轮 build artifacts；构建命令输出保留在本任务记录中，没有创建新的 runtime evidence 或宣称 runtime PASS。

**AUTOMATED TESTING NOT RUN — USER HAS NOT AUTHORIZED AUTOMATED TESTING**

**PLUGIN TESTING NOT RUN — DEFERRED BY USER**

**MANUAL UX REVIEW NOT RUN — AWAITING USER FIX PREVIEW**
