# 插件窗口焦点、标题栏与生命周期设计

**日期：** 2026-10-19

**状态：** 设计定稿；实现已打包，待用户人工验收

**范围：** WPF 搜索框、Electron Manager、普通插件窗口、Translation 2.0 的焦点与生命周期。本次新增普通插件的 Host 自绘标题栏、独立窗口模式、退出到后台与结束运行操作。

## 1. 目标与术语

WPF NativeHost 持有搜索框和全局快捷键。Electron 持有 Manager、第三方插件窗口和内置 Translation 2.0 窗口。此前约定的焦点循环已经由用户测试通过；本次补充普通插件窗口的 uTools 式外观和分离操作，不重做已验收的焦点逻辑。

普通插件有两种由用户在插件界面切换的展示方式：

- **临时面板模式：** 普通插件的默认模式。失焦后隐藏，召唤快捷键恢复同一个插件；按 Esc 返回空搜索框并关闭该临时插件 Runtime，防止隐藏 Runtime 累积。
- **独立窗口模式：** 用户从插件菜单选择“分离为独立窗口”或按 Ctrl+D 后进入。WebTools 的 Feature 本来就运行在 Electron `BrowserWindow` 中，因此分离复用当前 BrowserWindow、WindowEntry、WebPluginRuntime 和页面状态，不创建第二个窗口或重新加载页面。分离会将窗口调整为当前显示器工作区内更大的居中尺寸，并切换为独立窗口标题栏；失焦后它留在普通桌面窗口层级中，只被其他窗口遮挡。召唤快捷键恢复并聚焦同一个窗口。

插件菜单另提供两个明确动作：“退出到后台”只隐藏插件界面并保留 Runtime；“结束运行”关闭该插件身份对应的全部窗口并结束 Runtime。独立窗口模式下按 Esc 等同“结束运行”，标题栏 X 也执行相同的结束操作；“退出到后台”只由菜单触发。没有自动超时。退出到后台后的插件可通过再次调用该插件功能恢复；结束运行后再次调用会创建新 Runtime。

Manager 继续采用已验收的临时面板焦点循环，并在 Electron Host 窗口顶部使用与普通插件一致的自绘标题栏。标题栏保留 WebTools 标识，菜单只导航 Manager 自身的页面；最小化、最大化/还原和关闭都作用于 Manager。关闭仍经过 Manager 原有 `closeManagerWindow` 生命周期，只清理 Manager 自己的运行时，不关闭普通插件或 Translation 2.0。

Translation 2.0 继续是独立内置窗口，失焦后留在后台；按 Esc 时取消当前翻译并关闭 Translation 窗口，不显示 WPF 搜索框，也不禁用 Translation。它继续使用自己的供应商页签与窗口按钮，不进入 Manager，也不创建第三方 WebPluginRuntime。

## 2. uTools 观察与开发 API 对照

本地逆向记录保存在 `D:/SystemDefault/Desktop/webtoolstest/utools-window-focus-lifecycle-analysis-20261019.md`。IDA MCP 当前打开的 `uTools-7.8.0.exe.i64` 是启动外壳；插件窗口的直接实现位于 Electron `app.asar` JavaScript。以下静态证据来自本地提取的 uTools 7.8.0 bundle，配合用户提供的运行界面截图和实机观察。

### 普通插件和分离窗口

- uTools 插件菜单提供“分离为独立窗口 Ctrl+D”“关于插件应用”“插件应用设置”“退出到后台”“结束运行”等操作。插件页顶部的图标、名称、关闭按钮、菜单和插件图标由 Host 界面绘制。
- 主进程 `detachPlugin` / `detachPluginLogic` 将当前插件 `BrowserView` 放入新的独立 `BrowserWindow`，并继续使用原来的运行池条目；分离动作本身不要求重新创建插件运行实例。
- 独立窗口失焦处理没有自动隐藏窗口的逻辑。它保持为普通桌面窗口，失焦后位于其他前台窗口后方。窗口关闭与“退出到后台”是不同路径：前者处理仍挂载的插件视图并结束该视图；后者先移除窗口中的视图，再关闭窗口并保留插件运行实例。
- 菜单的“结束运行”走显式结束路径；“退出到后台”走保留运行实例的路径。uTools 还有自动分离和退出后台时自动结束的偏好设置。本设计只借鉴可见交互和两种明确操作，不复制这些偏好配置，也不新增开发者的 Feature 生命周期开关。
- 用户实测普通插件失焦后会恢复当前插件，Esc 才回到搜索框；Manager 页面与普通插件使用相同的焦点循环。uTools 的自动退出计时仅作为实现观察，不进入 WebTools 目标。

### 聚合翻译

- 聚合翻译是独立内置插件，使用自绘供应商页签和窗口操作区，失焦后保留窗口。它是翻译自己的界面设计，不是本次普通插件标题栏的实现依据。
- uTools 公开窗口 API 可创建和控制独立窗口，但没有提供一个 Feature 配置项让开发者直接启用聚合翻译完整生命周期。本次不增加对应 SDK API 或配置字段。

## 3. 当前实现状态

- 用户反馈此前约定的焦点与生命周期功能已经完成测试。本次变更不撤销这些已验收行为。
- 本次实现范围：普通插件 Host 自绘标题区；插件操作菜单；Ctrl+D 分离为独立窗口；分离时同一 BrowserWindow 扩大并居中；独立窗口失焦后留在后台；Esc / X / “结束运行”结束插件身份对应的全部窗口与 Runtime；“退出到后台”隐藏并保留 Runtime；独立窗口拖动和自绘窗口控件。
- WebTools 的插件由 Electron `BrowserWindow` 管理，不需要把插件渲染架构改为 uTools 的 `BrowserView`。分离应复用现有插件运行实例和 WindowEntry，不得因窗口模式切换额外启动一个相同插件 Runtime。

## 4. WebTools 目标行为

### Manager 临时循环

Manager 页面打开后成为当前临时目标。失焦时隐藏但保留页面；召唤快捷键恢复同一个 Manager BrowserWindow；按 Esc 显示空 WPF 搜索框、清除目标并销毁 Manager BrowserWindow。再次打开 Manager 时创建新窗口。Electron Host 在 Manager 页面上方绘制标题栏，显示 WebTools 标识、Manager 页面导航菜单、最小化、最大化/还原和关闭按钮；关闭按钮只走 Manager 自己的关闭路径。

### 普通插件的两种模式

#### 临时面板模式

- 普通 `window` Feature 默认从搜索框打开为临时插件窗口。
- 插件窗口失焦时隐藏并保留页面状态；召唤快捷键恢复同一个 WindowEntry。
- 按 Esc 或点标题区的 X，调用现有已验收的临时插件关闭路径：先显示空 WPF 搜索框，再关闭 Runtime 和 BrowserWindow 并清除当前目标。
- 菜单“退出到后台”隐藏插件界面、清除当前临时目标但保留 Runtime。用户再次调用该插件功能时恢复同一运行实例。菜单“结束运行”则关闭所有属于该插件的窗口和 Runtime。

#### 独立窗口模式

- 用户点击“分离为独立窗口”或按 Ctrl+D 后，当前插件变为独立桌面窗口。保留当前页面、WebPluginRuntime、安装版或开发版身份和 WindowEntry，不重新加载插件、不重复创建 Runtime。
- 独立窗口失焦时不隐藏、不最小化、不结束运行；它留在正常窗口层级中，被其他前台窗口遮挡。召唤快捷键恢复并聚焦同一个独立窗口。
- 独立窗口收到 Esc 时执行“结束运行”：请求 WPF 显示空搜索框，再关闭该插件身份对应的所有窗口并结束 Runtime。这个行为与菜单“结束运行”和标题栏 X 一致。
- “退出到后台”是菜单中的单独操作：请求 WPF 显示空搜索框后隐藏当前窗口、清除当前恢复目标并保留 Runtime。之后从搜索框再次调用该插件时恢复原运行实例与页面状态。
- 不设置自动超时。用户没有选择“退出到后台”或“结束运行”时，普通失焦只改变前后层级，不改变窗口和 Runtime 状态。

分离动作对当前 BrowserWindow 的宽、高分别按原尺寸的 120% 计算，并额外至少增加 160 px 宽、120 px 高；尺寸不超过当前显示器工作区。窗口以原中心为基准居中，超出工作区的部分向内收拢。若窗口原本已占满工作区，仍切换独立标题栏与窗口控件，页面和 Runtime 不变。

### 普通插件标题区与菜单

插件窗口采用 frameless Electron 窗口，由 Host 在 Electron 窗口内绘制标题区；不显示 Windows 默认标题栏。样式按用户本轮提供的 uTools 截图实现：

- 临时面板模式左侧显示胶囊形标题区（完整圆角）内的插件图标、插件名称和 X；右侧依次显示竖向更多操作按钮及独立的插件图标。插件图标只承担插件标识，不取代更多操作菜单。
- 临时面板模式的更多操作按钮使用竖向三点；独立窗口模式使用三条横线的菜单图标（☰）。点击后显示 Host 菜单，包含“分离为独立窗口 Ctrl+D”“关于插件应用”“插件应用设置”“退出到后台”“结束运行”。独立窗口菜单中隐藏分离项，并在“结束运行”旁标出 Esc；“退出到后台”不绑定 Esc。
- 独立窗口顶部左侧显示插件图标和名称；右侧显示操作菜单、置顶、最小化、最大化/还原和 X。置顶、最小化、最大化/还原通过 Host 控制当前 BrowserWindow；X 结束插件运行。分离后窗口尺寸变大并居中，且不创建新 BrowserWindow。
- 标题区空白区域可以拖动窗口。标题、拖动区和每个可点击控件分开布局；菜单、置顶、最小化、最大化/还原、X 等控件不得触发拖动。
- 菜单、标题区和窗口操作属于 WebTools Host，不由第三方插件自行绘制，也不向插件页面暴露 Electron `BrowserWindow` 权限。

### 后台 Feature 与 Translation 2.0

- 已声明 `blurBehavior: background` 的第三方 Feature 失焦后继续留在其他窗口后方；它仍使用自身页面结束入口或 Manager 停止操作结束 Runtime。普通插件的“分离为独立窗口”是用户在 Host 菜单中的展示模式，不要求新增 Manifest 字段。
- Translation 2.0 继续是独立内置窗口，失焦后留在后台；Esc 和翻译窗口自己的关闭按钮都会取消当前工作并关闭窗口，但不会禁用该内置功能。它不进入 Manager，不创建第三方 WebPluginRuntime。
- Manager、Translation 2.0 和普通插件的模式状态互不串扰。打开它们不能误结束另一个插件 Runtime。

### Host 原生模态对话框

临时插件或 Manager 通过 Host 打开并以其 BrowserWindow 为 owner 的系统模态对话框时，owner 的 blur 不应收起当前临时界面。对话框 Promise 结束后复核 owner 的最终焦点：已聚焦则保持显示；仍失焦则临时模式隐藏但保留目标。多个对话框并存时，只有最后一个结束后才复核焦点。对话框前台收到的 Esc 由对话框自身处理；回到宿主界面后再次按 Esc 才执行该模式的退出操作。

### 搜索查询

Launcher 打开 Manager、插件或 Translation 前沿用现有隐藏和清空查询语义。临时界面按 Esc 返回时显示空搜索框，不保存或恢复旧查询。退出到后台后再次调用插件时，沿用现有插件输入语义，不恢复已清空的搜索查询。

## 5. 交互矩阵

| 事件 | Manager | 普通插件临时模式 | 普通插件独立窗口模式 | Translation 2.0 |
|---|---|---|---|---|
| 失焦 | 隐藏，页面保留 | 隐藏，页面与 Runtime 保留 | 留在桌面窗口层级，被其他窗口遮挡 | 留在后台 |
| 召唤快捷键 | 恢复同一 Manager | 恢复同一 WindowEntry | 恢复并聚焦当前独立窗口 | 只按现有 WPF 搜索框逻辑工作 |
| Esc | 返回空搜索框并销毁窗口 | 返回空搜索框并关闭 Runtime / 窗口 | 返回空搜索框并结束插件身份对应的全部窗口与 Runtime | 取消当前翻译并关闭 Translation 窗口；不显示搜索框 |
| 标题区 X | 关闭 Manager 窗口与其自身运行时 | 关闭 Runtime / 窗口 | 结束该插件 Runtime 和全部窗口 | 取消工作并关闭翻译窗口 |
| 退出到后台 | 不适用 | 隐藏界面，保留 Runtime；可再次调用 | 隐藏窗口，保留 Runtime；可再次调用 | 不适用 |
| 结束运行 | 不适用 | 关闭插件全部窗口和 Runtime | 关闭插件全部窗口和 Runtime | 不适用 |
| 窗口拖动 | 不适用 | 拖动 Host 标题区空白处 | 拖动 Host 标题区空白处 | 使用翻译窗口自己的拖动区 |
| 自动超时 | 无 | 无 | 无 | 无 |

## 6. WPF 与 Electron 协调

WPF 继续持有搜索框和全局快捷键；Electron 持有 Manager、插件窗口、Translation 窗口和插件 Runtime。认证 Named Pipe 继续用于 WPF 与 Electron 的搜索框显示及当前目标协调，不增加另一套通信服务。

- 当前临时目标使用现有精确 WindowEntry 身份，包含安装版或 development session、pluginId 和 featureId。普通失焦时保留目标，快捷键恢复对应实例。
- WPF 搜索框重新取得焦点时只收起临时目标；若当前目标为独立窗口则保留目标身份，使召唤快捷键仍能恢复该窗口。显式“退出到后台”会先清除该目标，因此之后快捷键继续遵循搜索框原有行为。
- 用户选择“分离为独立窗口”时，在当前 WindowEntry 上切换展示模式，并对同一个 BrowserWindow 调整尺寸和位置；不创建第二个窗口、第二个 Runtime 或重载插件页面。窗口 resize 继续通过已有监听更新当前 WebPluginRuntime 的 WebContentsView bounds。
- 独立窗口退出到后台时，隐藏其窗口并清除前台恢复目标；再次从搜索框调用该插件时，复用已有运行实例。结束运行时先清除匹配的前台目标，再通过现有 Runtime.close 和窗口关闭路径结束该插件的全部 UI / Runtime。
- 关闭非目标后台窗口不得清除当前目标。插件停用和 development session 重载按安装版或 session 身份清理对应窗口，不影响相同 pluginId / featureId 的另一种身份。
- Host 标题栏控件由 Electron Host 处理。插件页面不能直接关闭宿主窗口或调用任意 BrowserWindow 方法。
- 插件标题栏菜单操作经现有 Host preload IPC 交给 Electron 主进程，由 PluginWindowManager 对当前 BrowserWindow 所属的 WindowEntry 执行。IPC 返回失败或拒绝时，菜单保持打开并显示“操作未完成，请重试。”，不能静默关闭菜单。
- Named Pipe 重连后，WPF 不恢复旧目标身份；下一次快捷键由 Electron 核验当前目标。Host 已退出或目标已关闭时，沿用无目标后的 WPF 搜索框逻辑。

## 7. Feature 声明

不为“分离为独立窗口”新增 Manifest 字段、开发者选择项或插件 SDK API。它是普通插件窗口上的 Host 用户操作，默认模式与之前验收的临时面板一致。

现有 `presentation.blurBehavior` 继续只服务于第三方 Feature 已声明的临时 / background 失焦行为。用户主动分离普通插件时，当前 WindowEntry 切换到独立窗口展示状态；该状态不会写回插件 Manifest，也不会形成另一套插件平台。

相关实现位置：

- Schema：`plugin-sdk/declarative-v1/manifest.schema.v3.json`
- V3 运行时类型：`plugin-sdk/declarative-v1/runtime-v3/manifest-v3.d.mts`
- V3 校验与规范化：`plugin-sdk/declarative-v1/runtime-v3/manifest-v3.mjs`
- Electron 窗口管理：`electron/plugins/plugin-window-manager.ts`

## 8. 人工验收场景

1. **既有临时焦点循环不回退：** 普通插件失焦后隐藏，快捷键恢复相同页面；按 Esc 返回空搜索框并关闭临时 Runtime。
2. **临时插件标题区：** 窗口无 Windows 默认标题栏；左侧显示胶囊形（完整圆角）插件标识、名称和 X，右侧显示竖向三点操作菜单及独立插件图标。X、菜单按钮均可点击。
3. **标题区拖动：** 在空白拖动区按住可移动窗口；拖动不能由菜单、图标或窗口操作按钮触发。
4. **插件菜单：** 显示分离窗口、关于、设置、退出到后台和结束运行。临时插件模式下分离项显示 Ctrl+D。
5. **分离复用实例：** 点击分离或按 Ctrl+D 后，插件页面与运行状态连续；没有创建重复 Runtime、重复 WindowEntry 或第二个相同插件运行实例。
6. **独立窗口失焦：** 切换到 WPF、外部应用或其他窗口后，独立插件窗口不被隐藏、不最小化、不结束；它留在其他窗口后方。快捷键恢复并聚焦同一独立窗口。
7. **分离时的可见变化：** 点击分离或按 Ctrl+D 后标题栏切换为独立窗口样式，当前 BrowserWindow 扩大并居中；输入内容、滚动位置和页面状态连续，未创建第二个窗口或 Runtime。
8. **退出到后台：** 在菜单选择退出到后台后，WPF 搜索框显示、插件窗口隐藏但 Runtime 仍为运行状态；从搜索框再次调用该功能后恢复原运行实例和页面。Esc 不执行此操作。
9. **结束运行：** 独立窗口按 Esc、点击 X 或菜单选择结束运行后，WPF 搜索框显示；该插件身份对应的所有窗口关闭，Runtime 被结束，WindowEntry 与临时目标清理。其他插件和 Translation 窗口不受影响。
10. **独立窗口控件：** 三条横线菜单图标（☰）、置顶、最小化、最大化/还原、X 工作正常；Esc 提示显示在“结束运行”旁；标题区仍可拖动，操作控件区域不可拖动。
11. **不会累积隐藏 Runtime：** 反复打开普通临时插件并按 Esc 退出，不留下隐藏的临时 WindowEntry 或 Runtime；显式选择退出到后台才保留实例。
12. **Manager 与 Translation 边界：** Manager 保持已验收的临时焦点循环；标题栏菜单只操作 Manager 页面，关闭只清理 Manager 自己的运行时。Translation 仍是独立窗口、失焦后留在后台；Esc 取消工作并关闭窗口，但不禁用功能。
13. **模态对话框与 NativeHost：** 现有系统对话框焦点恢复和 Named Pipe 搜索框行为不回退。
14. **安装版与开发版身份：** 同时打开相同 pluginId / featureId 的安装版和开发 session Feature，分离、退出后台、结束运行只影响精确 WindowEntry。
15. **无超时：** 独立窗口可长时间处于后台而不自动隐藏或结束 Runtime；只有用户动作、插件停用、开发 session 关闭 / 重载等既有生命周期操作会结束它。

## 9. 非目标

不把 WPF 搜索框改为 Electron；不把普通插件改为 uTools BrowserView；不重做 Manager 或 Translation 2.0 的窗口架构；不重做翻译服务或供应商 API；不新增插件 SDK 的原生窗口权限、Manifest 生命周期字段或开发者模式选择；不复制 uTools 的自动分离 / 自动结束偏好设置；不设置自动超时；不增加插件历史栈或另一套窗口管理平台；不把所有普通窗口都强制改为独立窗口。普通插件通过 Host 自绘标题栏提供清晰的拖动、分离、退出后台和结束运行操作。
