# WebTools Native Launcher — Phase 4E Manual Acceptance Checklist

Acceptance package: `WebTools-Native-Phase4E-Setup.exe`<br>
Installer path: `D:\System default\Desktop\HomePage\release\native-phase4e-acceptance-20260929-233750\WebTools-Native-Phase4E-Setup.exe`<br>
Build timestamp: `2026-09-29 23:40:54`<br>
SHA-256: `74B32B081172F52FD78D5484F55E89D07CDC0B515AA737B992176833909A70FD`<br>
Test environment: record Windows version/build, display scale, installed path, and package version before testing.

## Before You Start

- Use the Phase 4E acceptance installer. It is separate from the production installer and may show an unsigned-publisher prompt.
- Keep the current user profile intact. Use the migration procedure in section L for a disposable profile only.
- For process and memory checks, use one consistent tool and the same columns for every sample. Prefer Process Explorer columns for Private Bytes, Working Set, GDI Objects, USER Objects, Threads, PID, and Start Time.
- Do not use GC.Collect, EmptyWorkingSet, or SetProcessWorkingSetSize during measurements.

## A. Cold Start

- [ ] **Native-only launch**

  **操作：** 从托盘菜单退出 WebTools；在任务管理器确认 NativeHost 和 WebTools/Electron 进程都结束；从 Phase 4E 快捷方式启动。

  **PASS：** `WebTools.NativeHost.exe` 存在；Electron/WebTools Manager 进程数为 0；托盘图标出现，Launcher 热键可用。

## B. Hotkey / IME

- [ ] **Hotkey first character**

  **操作：** 按 `Ctrl+Alt+Space`，立即输入 `utools`。

  **PASS：** 第一个字符不丢失；输入框保持焦点；第一条结果自动选中；Enter 能打开所选结果。

- [ ] **Chinese IME**

  **操作：** 快捷键唤出后立即切换中文输入法，输入多个中文应用名称。

  **PASS：** composition 不被打断；首字符不丢失；输入法候选框正常；结果随输入更新。

- [ ] **Toggle / Escape / blur**

  **操作：** 连续用快捷键开关窗口；再分别用 ESC、点击桌面和切换其他应用隐藏窗口。

  **PASS：** 开关状态正确；ESC 和失焦隐藏有效；点击 Launcher 内部控件不会提前隐藏。

## C. Search

- [ ] **Search parity**

  **操作：** 测试英文、中文、全拼、首字母、alias、substring，以及快捷键序列 `u`、`ut`、`uto`、`utoo`、`utool`、`utools`。

  **PASS：** 结果相关、无旧 query 结果覆盖；默认选择第一项；上下键、Enter、鼠标点击和选中项滚动正常。

- [ ] **Search commands**

  **操作：** 分别测试 `?query`、`/query` 和 `file:query`。

  **PASS：** `?` 使用当前搜索引擎；`/` 只搜索已保存网址；`file:` 搜索文件/文件夹；各模式的上下键与 Enter 正常。

## D. App Launch / Icons

- [ ] **App discovery and launch**

  **操作：** 搜索并启动开始菜单应用、用户桌面快捷方式、公共桌面快捷方式、普通 Win32 程序、`.lnk` 和至少 3 个已安装的 Store 应用。

  **PASS：** 名称能搜索到；Enter/鼠标点击启动正确应用；Launcher 按现有行为隐藏；普通搜索不启动 Electron。

- [ ] **Icons and fallback**

  **操作：** 检查 Win32、快捷方式、Store、网站、文件/文件夹、托盘和品牌图标，并观察快速修改 query 时的异步图标。

  **PASS：** 可解析图标显示正确；无法解析时显示通用图标；图标加载不改变结果顺序或键盘选择；无明显图标闪烁/错配。

## E. Website / Web Search

- [ ] **Website CRUD and synchronization**

  **操作：** 打开 Manager 的 Entries，新增、编辑、删除一个测试网址；每次操作后返回 Launcher 搜索。

  **PASS：** Native Launcher 即时显示最新网站；按名称和 URL 片段搜索、打开都正确；重启 NativeHost 后设置仍在。

- [ ] **Selected/custom search engine**

  **操作：** 在 Settings 更换默认搜索引擎；如有自定义模板，再修改一次；使用 `?test` 搜索，随后重启 NativeHost 重测。

  **PASS：** 外部浏览器使用新引擎/模板；重启后选择保持；普通本地搜索不受影响。

## F. Everything

- [ ] **Everything search and failure path**

  **操作：** 输入 `file:` 搜索中英文文件名；快速连续修改查询；分别打开文件和文件夹。然后在测试环境关闭 Everything，再试一次。

  **PASS：** 新 query 的结果优先；文件/文件夹打开方式正确；Everything 不可用时 Launcher 不崩溃并显示可理解的反馈。

## G. Translation

- [ ] **Cold handoff**

  **前置：** Manager/Electron 进程不存在。

  **操作：** 在 Native Launcher 对英文、中文、多行文本分别执行翻译入口。

  **PASS：** Manager 只启动一个进程组；Translation 页面打开；原文逐字一致；没有丢失第一次 handoff。翻译请求遵守当前自动翻译设置和所选 provider。

- [ ] **Warm / rapid handoff**

  **操作：** Manager 已打开时连续提交不同文本，包含 Unicode 和较长文本。

  **PASS：** 复用现有 Manager；最后一次请求显示对应原文；旧响应不覆盖新输入；切换新原文会清除旧结果和错误。

## H. Manager Lifecycle

- [ ] **Navigation and normal close**

  **操作：** 从 Native 托盘依次打开 Search、Entries、Settings、Translation；正常点击 Manager 窗口关闭按钮 ×。

  **PASS：** 所有入口复用同一 Manager 窗口/进程组；关闭后 NativeHost 和托盘仍在；Electron Main、Renderer、GPU、Utility 进程最终都为 0；之后可重新打开 Manager。

- [ ] **30 Manager cycles**

  **操作：** 重复打开 Manager、等待启动、正常点击 ×，共 30 次。

  **PASS：** 每次关闭后 Electron 进程最终归零；没有重复 Manager、orphan/zombie process 或启动失败；Native Launcher 始终可用。

## I. Settings Sync

- [ ] **Hotkey transaction and persistence**

  **操作：** 更改为一个未占用快捷键并重启；再尝试一个已被系统/应用占用的快捷键。

  **PASS：** 成功时新快捷键生效、旧快捷键退出，重启后保留；冲突时提示失败、旧快捷键仍工作且无效设置未保存。

- [ ] **Launcher settings persistence**

  **操作：** 修改 theme、search engine、网站、compact/expanded 模式；通过搜索打开应用以生成 app search memory；重启 NativeHost。

  **PASS：** Native Launcher 即时同步；重启后 hotkey、theme、engine、网站、app memory 和 launcher mode 与保存值一致。

## J. Theme / UI

- [ ] **Theme changes**

  **操作：** 分别选 Dark、Light、System；保持 System 设置运行时切换 Windows 主题。

  **PASS：** Native Launcher、托盘菜单和 Manager 主题一致；文字、hover、selected、滚动条、图标对比清楚，无遮挡。

- [ ] **Compact / expanded**

  **操作：** 测试 compact 和 expanded 默认模式；展开网站/应用区并滚动；点击卡片。

  **PASS：** 高度、内容、滚动和点击正确；无裁切/闪烁；设置重启后保持。

- [ ] **Drag surface isolation**

  **操作：** 依次从 SearchBar 外部空白、TextBox 已有文字、TextBox 文字右侧空白处按下并移动；测试普通点击 caret、拖选文字、双击选词、结果行、快捷卡片、滚动条；最后从 TextBox 空白处拖动窗口并松开后立即输入 `visual`，再用中文输入法输入。

  **PASS：** SearchBar 空白和 TextBox 实际文字右侧空白越过系统拖动阈值后移动窗口；点击空白但未越过阈值仍只聚焦/移动 caret；文字区域能原生点选、拖选、双击选词且窗口不移动；结果、卡片、滚动条、按钮不启动窗口拖动；拖动结束 Launcher 仍可见，输入焦点恢复，`visual` 首字符和中文 IME composition 正常；拖动期间没有触发 blur-hide。

## K. DPI / Multi-monitor

- [ ] **Display scale and monitor placement**

  **操作：** 在可用设备上测试 100%、125%、150% 缩放；双显示器时分别从每个屏幕唤出 Launcher，并检查任务栏/工作区边界。

  **PASS：** 无裁切、模糊布局或屏幕外窗口；Launcher 在预期显示器和工作区内；拖动位置正常。

## L. Existing-user Migration

- [ ] **安全迁移对照（只用 profile 副本）**

  **操作：** 不要在当前真实账户的 `%APPDATA%\Nook` 上做破坏性测试。创建 disposable Windows 用户或 VM 快照；将旧 Electron profile 复制到该测试账户的 `%APPDATA%\Nook`。记录副本中的 hotkey、theme、search engine、websites、app search memory、launcher mode。若要模拟首次迁移，只能在副本中将已存在的 Native `launcher-state.json` 改名备份，然后首次启动 Phase 4E NativeHost。迁移前后逐项比较；保留原始 profile 和副本备份。

  **PASS：** 测试账户 NativeHost 首启后六类数据均保留或按设计默认迁移；修改后重启仍一致；原账户 profile 的文件时间/内容不变。出现差异时停止并保留副本供排查，不要覆盖原用户数据。

## M. Memory / Resource

- [ ] **Five independent cold starts**

  **操作：** 完全退出所有 WebTools 进程；分别冷启动 5 次，每次只运行 NativeHost 并等待 30 秒。每轮记录同一 PID 的 Private Bytes、Working Set、GDI、USER、Threads。

  **PASS：** 5 轮都没有 Electron；记录完整；对每个指标单独排序取第 3 个值作为 median。不要把 Working Set 与 Private Bytes 混用。

- [ ] **Search / show-hide resources**

  **操作：** 记录 idle 基线；执行 100 次真实 UI 搜索后隐藏并等待 60 秒；执行 1000 次 mixed UI searches；执行 300 次热键 show/hide。分别记录操作前后 Private Bytes、Working Set、GDI、USER、Threads。

  **PASS：** 搜索和窗口始终可用；重复样本最终趋于稳定，无持续单调增长。一次上涨或 V8/.NET 未回收不能单独判定为 leak。

- [ ] **Manager cycles resources**

  **操作：** 完成 H 中 30 次 Manager 开关；记录开始、打开峰值、关闭并等待 Native 稳定后的 Private Bytes、Working Set、GDI、USER、Threads 和进程数。

  **PASS：** 每次 Manager 关闭后 Electron process count 为 0；NativeHost 保留；资源没有跨周期持续单调增长。不要要求关闭后 byte-for-byte 回到初始值。
