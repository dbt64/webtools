# Phase 6G-3 — Super Panel Translation Preview

日期：2026-10-17。阶段：实现完成，自动化与隔离实际通路通过；人工 Windows 验收待执行。

## 产品行为与边界

- 在 Settings → Super Panel 新增“英文选区自动翻译预览”，默认关闭。启用并应用即允许符合条件的选区使用当前翻译服务，页面明确提示外部传输、额度和费用。
- 用户以既有手势唤出面板且捕获到适用文本后，自动在同一 Super Panel 显示“正在翻译…”及随后译文；无需再次点击翻译操作。操作列表继续保留。单纯选择文本不会打开面板或发起请求。
- 现有“翻译”操作仍走 Manager Translation 页面；搜索、打开链接、插件调用及通用 Node Quick Result 保持显式激活。没有增加翻译插件或 Native 翻译服务。
- 复用 Main 的 `TranslationService`、MyMemory / Shared AI / Qwen-MT、配置、凭据、启用权限、取消和超时。没有修改 SDK、Manifest、Product Version 或公开插件能力。

## 已落实的产品决策

1. 自动预览是单独的显式 opt-in，默认 OFF；原配置缺少字段时按 false 读取，不在启动时重写旧配置。
2. 首版使用有界英文/标识符形状启发式：至少一个 ASCII 字母，只接受 ASCII 字母、数字、空格/制表/换行、常用句子标点与弯引号/长短破折号。可接受 `capability`、`getUserName`、`selected_text`；中文、混合文字、Emoji、完整网址、邮箱、代码符号和纯数字不自动发送。这不是通用语言检测，其他拉丁语单词可能命中。
3. 保留现有选区 3,000 UTF-16 code units 上限；捕获明确标记为截断的选区不自动发送，显式操作仍可用。MyMemory 另沿用已有 500 UTF-8 bytes 限制；没有复制 uTools 的 500 字符阈值。
4. 使用当前目标语言。仅在来源设为 auto 时，将这条已通过英文启发式的预览请求设为 en；显式非英语来源不覆盖，显示设置提示而不请求。目标语言为英语时也不发送英文翻译请求。
5. 已启用的第一方预览使用现有内置翻译 admission，不借用插件 grant/gesture 或插件 AI confirmation。当前内置翻译没有逐次插件确认；专用开关的说明承担自动预览的 opt-in。未配置、停用或超限时不调用 provider、不降级到其他引擎、不自动重试。

## 实现通路

`既有触发/捕获 → Native 本地候选判断 → 当前 presentation generation 绑定 → 现有 Feature 队列与认证 Pipe → Main 内置 Translation preview adapter → 既有 TranslationService → 有界纯文本 result → 原 WPF QuickResultSurface`

加载状态由 Native 立即显示，成功、未配置、超限和 provider 错误由 Host adapter 转成现有有界纯文本合同，不新增通用状态协议。provider 原始错误不跨越面板边界，避免泄露输入或凭据细节；没有正文日志、projection/cache 存储或 replay 正文。

结果绑定在入队前建立，防止 warm Host 抢先响应。每个请求沿用 Main replay 的 at-most-once 保护；projection 刷新不重新请求。关闭、取消、新选区、尚未显示结果时的键鼠操作、原前台/焦点变化、预览设置变化都会取消或拒绝旧预览。已经显示的预览在正常 Electron idle exit 后继续留在 Native；provider/目标语言等配置变更另行撤销已显示结果。

与 uTools 的共同点是触发后在同一面板展示独立翻译预览和操作列表。WebTools 使用 C#/WPF、现有配置 provider 与认证 Pipe；不复刻 uTools 账户/会员接口、时间戳格式化分支、字符阈值或 renderer 实现。uTools 依据仍为 hash-matched `app.asar` 的静态 JavaScript，不是新的运行时 UX 证据。

## 本轮文件

- Settings / 候选策略：`src/shared/super-panel-settings.ts`、`src/shared/translation-preview.ts`、`src/features/settings/SuperPanelSettings.vue`、Native `SuperPanelStateStore.cs` / `SuperPanelSettingsController.cs`。
- Main：`electron/services/builtin-translation-preview.ts`、`electron/services/feature-invocation-service.ts`、`electron/main.ts`。
- Native：`SuperPanelTranslationPreview.cs`、`SuperPanelWindow.xaml` / `.xaml.cs`、`SuperPanelTriggerController.cs`、`CaptureInvocation.cs`、`SelectionContext.cs`、`SelectionCapturePayloads.cs`、`Services/ManagerController.cs`。
- 验证：`src/shared/translation-preview.test.mjs`、Host adapter 和 invocation focused tests、`Phase6G3TranslationPreviewChecks.cs` 与 Checks `Program.cs` 入口。
- 文档：本报告、6G-1 计划的 6G-3 执行附注、roadmap 当前 §U。

以上文件中多项在本轮前已经 dirty/untracked。修改按原文件增量进行；初始 Git 状态及预先保存的文件在下面的 D 盘 baseline 目录，不能把整个 HEAD diff 都归为本轮。

## 验证记录

测试、临时 Profile、构建产物和证据根目录：

`D:\SystemDefault\Desktop\webtoolstest\phase6g3-translation-preview\20261017-190402`

| 验证 | 当前结果与边界 |
|---|---|
| Host focused | 27/27 PASS；实际 TranslationService 配合免费隔离 adapter，覆盖三引擎、admission、配置、取消、迟到输出、输出上限和安全错误文案。不是实际外部 provider 验收。 |
| Native preview | 36/36 PASS；实际 WPF 控件，覆盖默认关闭、旧配置、截断禁止自动发送、同面板结果/操作列表、新选区、键盘操作、焦点变化、关闭、设置停用、短工作区长结果。触发通过控制 seam，不冒充物理选区验收。 |
| 原 Quick Result | 39/39 PASS。 |
| 原面板 presentation | 14/14 PASS，包括布局、虚拟化、scroll reset、旧结果与 built-in search/link；不是人工多 DPI 验收。 |
| TypeScript | PASS：`pnpm run typecheck`。 |
| Electron build / Native publish | PASS；运行产物只在 D 盘隔离目录，没有安装到真实目录。 |
| 全量 Node 回归 | 最终 `pnpm test`：646/646 PASS，见 `pnpm-test-complete.log`。 |
| 实际隔离 Main/Pipe/WPF | 6/6 PASS；自本轮源码构建 Native / packaged Electron，正式配置 API 保存隔离假凭据，仅访问本地免费 HTTP Stub。合成选区经现有控制 seam 注入，不能代替物理选区验收。 |

最终 machine-readable evidence：`runtime-evidence-1792236551683.json`，SHA-256 `59BFDD19F93D69134B586549FFAB9BA76B02AE2E402631EF6EBAEF6B680F14BE`，位于上述 D 盘根目录。

- 冷启动自动预览没有 Manager page target；同一 WPF 面板保留首个可见操作。正常 Electron idle exit 后 accepted result 继续显示。
- 无选区、URL、中文和混合文字不新增请求；provider 错误只显示固定安全文案；关闭加载面板后迟到结果不覆盖新的上下文。
- 在真实配置 API 修改目标语言后，已接受的旧预览被撤销。
- 本地 Stub 共收到 4 次请求（冷启动成功、错误路径、取消路径、warm 配置变更验证各一次）。没有调用真实外部 provider。
- 测试结束 exact-path / PID / creation-time 跟踪的进程组剩余 0。
- Native DLL SHA-256：`cba7e810e4c734ccea05a87868a6d55d9924a2cda38bb8d0f48f4f91e6ea0bc7`；Manager app.asar SHA-256：`96585812bafd3b8443e279c6e4fd50707b7dde161b1237d717dfedecbaa96dab`。
- `privacy-check.json` 对隔离 Native diagnostic CSV、最终 evidence、当前投影共 5 个文件核对：未发现本轮选区文本或原始 provider 错误标记。不是全文件系统或真实用户数据快照。

Native 构建仍显示已有 UIAutomationClient/UIAutomationTypes 引用冲突和旧 TextSelectionProvider nullable 警告；本轮未修改这些环境/引用设置。

### 审查与中间失败

- 独立 Sol 只读审查提出两项 P2：配置变更后已显示预览未撤销；截断选区仍可能自动发送。均已做针对性修正。截断问题先记录失败回归再修复；不通过字符串提示判断截断，而使用 Native-only 的结构化标记。
- 撤销已显示预览仅用于配置变化，正常 Host idle shutdown 不发送 clear，避免破坏 6G-1 已接受结果的本地所有权。
- 第一轮 runtime smoke 在测试工具的 Manager 退出等待（30 秒）超时；Native 日志显示随后正常退出。原失败 evidence 保留，补充的 `runtime-cleanup-followup.json` 记录了精确身份正常退出后剩余进程为 0。
- 第二轮尝试复用另一个隔离 Profile 的假凭据，未证明该密文可在新 Profile 解密；未收到本地 Stub 请求，不能当作有效 provider 配置的功能验证。原 FAIL evidence 保留，cleanup=0。后续改为在同一 Profile 通过正式 Manager API 保存假凭据并核对 configured 状态。

## 人工验收待办

1. 开关默认关闭时，英文选区只显示现有内容和操作；启用并应用后，以手势唤出英文选区，观察同面板加载/译文及保留的操作列表。
2. 浅/深主题、短/长英文、无选区、中文/混合文字/链接，以及较小屏幕高度或 DPI 缩放下，观察布局、滚动、第一操作项可见性。
3. 加载时取消、点击其他操作、输入、切换焦点、关闭及再次捕获；旧结果不得覆盖新状态。
4. 检查现有“翻译”操作仍进入 Manager；真实 provider 的访问和费用需由用户在实际配置下自行验收。本轮只使用隔离免费 Stub，没有读取或调用真实 Token。

不能依据本轮自动化标记人工 UX PASS；不会重新打开已关闭的 6G-1/6G-2 人工验收。

## Git 与阶段状态

Branch：`codex/shared-ai-translation-2.0`；起始 HEAD：`707c5673dff479285b34a5b441bec9d3b725c737`。本轮没有 stage、commit、push、安装器发布或真实安装操作。

Phase 6G-3：IMPLEMENTED — AUTOMATED / ISOLATED PACKAGED PASS — MANUAL WINDOWS ACCEPTANCE REQUIRED。已发现的两项 P2 已修正；当前没有已知 P0、P1 或 blocking P2。真实 UX、额外显示器/DPI 和用户实际 provider 行为尚未人工确认，不能声明完整产品验收完成。Phase 6G-4 未开始。

## 用户复测修正：翻译操作保留与中文字体（2026-10-17）

### 必须保持的产品行为

- 下方操作列表的“翻译”在自动预览加载中、成功、空结果或错误时始终保留，只要该 Feature 仍适用于当前选区且已启用。
- 点击该操作时取消/撤销当前预览并关闭面板，携带本次选区进入现有 Translation Manager。不能要求用户先等待预览结果，也不能用“预览已取消”状态代替 Manager 跳转。
- 预览完成后隐藏的仅是预览区域的“取消”控件；不得隐藏下方“翻译”操作。
- 用户此前报告其他验收操作通过；本次反馈涉及的可见性、字体及 Manager 跳转继续等待新安装包人工复测，不将它们提前标为 PASS。

### 确认的本地问题与修正

1. **结果变高后的窗口裁切。** 用真实 WPF、内置搜索操作和 Translation 投影复现：两项操作仍在 ItemsSource 中，结果返回后第二项底边为 321.5 DIP，窗口却仅为 307.5 DIP。窗口测量读取了加载态缓存的 desired size；下一次 WPF 布局才得到更高的文本结果，窗口高度没有同步。现在先完成内容布局，再测量窗口和操作视口；同一用例的窗口为 337.5 DIP，第二项完整可见。低可用高度时进一步限制结果/确认内容的滚动区，给操作列表保留完整首项及滚动能力，翻译可滚动到并完整显示。
2. **简体中文字体回退不合适。** 原窗口 `Segoe UI` / 默认 `en-US` 的实际 GlyphRun 显示，固定简体样例“免费翻译 / 寻找”混用 `YUGOTHM.TTC`（Yu Gothic）及 `MSJH.TTC`（Microsoft JhengHei）。现在声明 `zh-CN`，并为 Segoe UI 补充 Microsoft YaHei UI / Microsoft YaHei 回退；同一样例的中文 GlyphRun 使用 `MSYH.TTC`，英文仍使用 Segoe UI。没有改写译文字符，也没有做简繁转换。
3. **API 边界。** 本轮仅用公开样例 `Find` 请求 MyMemory `en|zh-CN`，当次返回“寻找”（U+5BFB U+627E）。这不能证明用户截图那次 API 返回的内容；可以确认本机字体回退问题，不将历史译文的简繁差异直接归因于服务。

### 本轮验证

- `--translation-preview-checks`：54/54 PASS。包含内置搜索 + Translation 两项共同显示、加载中/完成后的显式 Manager 调用、第二项完整可见、低高度下滚动到 Translation、简体样例的实际 GlyphRun 字体、原字符保持、取消及迟到结果拒绝。
- `--super-panel-hardening-checks --presentation-only`：14/14 PASS。覆盖复用窗口、虚拟化、滚动复位、投影刷新、九宫格及短工作区。不是多显示器或全 DPI 人工验收。
- 专项测试的临时 Profile 均通过进程 TEMP/TMP 放在 `D:\SystemDefault\Desktop\webtoolstest\phase6g3-translation-layout-fix`，没有修改真实配置、剪贴板或安装目录。没有运行安装器、commit 或 push。
- 本轮 EXE：`D:\SystemDefault\Desktop\webtoolstest\phase6g3-translation-layout-font-fix-20261017\WebTools-Phase6G3-Translation-Layout-Font-Preview-Setup-0.1.0.exe`；191,703,775 bytes；SHA-256 `7058B186C822E8DFBC1158BAE49B4419C6EC8AA889D0C833F54D9278581FB572`。正式 PreviewOnly 构建成功，复制后与构建产物哈希一致；未执行安装或安装版人工验收。
