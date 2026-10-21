# 2026-10-21 累计变更与提交说明

## 提交范围

- 仓库：`dbt64/webtools`；目标分支：`main`。
- 上次本地源码提交：`707c5673dff479285b34a5b441bec9d3b725c737`，2026-10-09，`feat(plugins): complete host capability authority`。
- 本次汇总该提交以后长期保留在工作区的源码、测试、示例和文档，覆盖 2026-10-09 至 2026-10-21 的开发。另保留此前尚未推送的分支提交，不压平或改写历史。
- PR 分支：`codex/webtools-platform-update-20261021`；已先合入远端 `main` 的最新历史。远端的 `LICENSE` 原为一个空行，本次补全 MIT 正文。
- 产品版本仍为 `0.1.0`，SDK 为 `1.8.0`，creator 为 `1.1.0`，Plugin API major 为 `1`。这是源码整合提交，不创建版本标签、正式发行或发布安装包。

本文件为本次提交的永久说明。阶段报告中的“未提交”“下一阶段”与计数描述保留其当时口径；当前功能入口与架构以更新后的 [README](../README.md)、[Runtime 文档](plugin-runtime.md)和本说明为准。

## 1. 从上次提交走到了哪里

| 模块 | 上次源码基线 / 早期路径 | 本次累计状态 |
| --- | --- | --- |
| 插件执行 | 早期 Web bridge 与能力 authority | Manifest v3、Runtime 2.0、Web/Node 路径、独立窗口与 Node Command |
| 插件开发 | 早期声明式 SDK 和受限 Web 原型 | SDK 1.8、独立 creator、四种前端、仓库外 tarball 工作流、开发连接/重载/诊断 |
| 插件管理 | 基础安装和管理 | 插件中心、权限/启停/替换/卸载、Host-owned 配置、主题与公开开发契约 |
| 系统入口 | 主要是 Launcher → Manager | WPF Launcher + Super Panel，统一 Feature 激活与独立目标窗口 |
| 选区操作 | 未形成完整原生面板路径 | Copy Capture、上下文匹配、内置搜索/开链接、Quick Result、AI 确认和可选翻译预览 |
| 翻译 | Manager 内 Legacy 翻译与 handoff | 独立 Translation 2.0、提供方页签、网站视图、机器 API 与共享 AI 配置 |
| 窗口与 Host | Manager 就绪承担较多入口协调 | Host-ready 与 Renderer-ready 分离、焦点行为、会话内预热、完整 ownership 同步和业务请求去重 |
| 文档与许可 | README 仍描述 Manager 承载翻译；无有效协议正文 | 重写 README，补充提交说明、当前文档导航及 MIT 许可 |

### Plugin Runtime 2.0 与安全边界

- 新增 Manifest v3 与 Host 端严格校验，覆盖 Web/Node Runtime、文件/依赖清单、兼容性和包内容一致性；以验证快照绑定运行资源。
- Web 页面使用隔离的 `WebContentsView` 与受控能力桥；Node 路径采用独立 preload/Command 执行适配，允许声明的依赖、native addon 和 helper。
- 恢复正常 Chromium 网络、持久化插件 Session、Worker/WASM 等标准 Web 能力；这些能力不代表网络出口被操作系统沙箱隔离。
- Host 继续管理插件存储、Shared AI、剪贴板、确认、调用上下文和权限撤销。Manager IPC 与插件桥按发送方角色、当前 authority 和 generation 区分。
- Node 插件采用用户信任的本地代码模型，可使用当前用户权限；不是低权限 OS 沙箱。旧 Gate/probe 的历史结论不改写为新的认证结果。

主要文件：`electron/plugins/manifest-v3.ts`、`package-validator.ts`、`validated-plugin-package-snapshot.ts`、`web-plugin-runtime.ts`、`node-plugin-preload-bootstrap.ts`、`node-command-execution.ts`、`electron/ipc/window-security.ts`、`plugin-sdk/runtime-v3/`。

### SDK、配置、主题和开发会话

- `create-webtools-plugin` 生成独立的 Vanilla/Vue/React/Svelte Web 或 Node 项目，不依赖作者导入宿主私有模块。
- SDK 提供 v3 build/validate/pack/inspect、Web/Node 公共 API、配置描述与读写、选区上下文和 Quick Result 契约。
- 开发连接复用现有 Host，通过验证过的开发快照、明确会话、重载与断连清理更新 Runtime；与已安装插件来源区分。
- 插件中心提供配置编辑；配置、私有数据与安全凭据各自保留现有所有权。主题是可选 Host token / SDK CSS，不强制插件业务布局。
- 示例新增 Selected Text Actions，并更新 Private Notes 和公开 SDK 使用说明。

主要文件：`plugin-sdk/create-webtools-plugin/`、`plugin-sdk/declarative-v1/`、`electron/plugins/plugin-development.ts`、`plugin-configuration.ts`、`plugin-theme-controller.ts`、`src/features/plugins/PluginConfigurationEditor.vue` 与 `PluginDevelopmentPanel.vue`。

### Native Launcher 与 Super Panel

- 新增原生鼠标手势触发、Copy 选区获取、剪贴板恢复与取消/迟到结果处理；修复过早显示、失焦和重复调用问题。
- NativeHost 本地匹配 Feature 声明和选区规则；内置搜索选中文字及打开完整 HTTP(S) 链接，无需安装示例插件。
- Quick Result 在原面板显示受限文本，AI 确认使用同一面板；接受的静态结果与待完成执行分别处理。
- 新增可配置翻译预览，进入完整翻译时保留动作并结束对应预览；加载中与完成后都能点击翻译进入完整窗口。
- 修复开机启动后应用目录/搜索刷新，完善菜单、显示位置、图标、展开面板和焦点处理。

主要文件：`native/WebTools.NativeHost/SuperPanel/`、`AppCatalogChangeMonitor.cs`、`MainWindow.xaml(.cs)`、`NativeFeatureQuickResultProtocol.cs`、`src/features/settings/SuperPanelSettings.vue`、`electron/services/feature-quick-result-consent.ts` 与 `builtin-translation-preview.ts`。

### Translation 2.0 与共享 AI

- Translation 使用新架构内的独立窗口，移除旧 Manager `TranslateView`、Gate 页面与旧 handoff 服务路径。
- 提供 WebTools 翻译和独立网站页签，支持拖动排序、显示开关、网站视图与设置持久化。
- WebTools 翻译支持约 500 ms 防抖自动调用、手动翻译、取消和过期结果过滤；支持 MyMemory、Shared AI、DeepL API 与高级接口定义。
- 平台 AI 与翻译 AI 使用相同模型/凭据配置服务，保留翻译单独选择服务。配置将模型与密钥字段分开，密码框支持粘贴，保存后清空，不回读既有密钥；配置完整与连接测试结果分开表达。
- 修复网站显示/隐藏、排序、重复配置入口、密钥误入模型字段、最大化/还原图标以及首次打开与退出问题。
- 最近一次首次打开修复同时处理：bootstrap 等待完整 open 造成的循环；Pipe 信封 ID 与 payload 业务请求 ID 混用；加载期间关闭窗口仍悬挂打开 Promise。

主要文件：`electron/plugins/builtin-translation-window.ts`、`translation2-website-host.ts`、`electron/ipc/translation2-handlers.ts`、`electron/services/translation2-*.ts`、`src/features/translation2/`、`src/features/settings/SharedAISettings.vue` 与 `src/translation-main.ts`。

### 窗口焦点、会话预热与退出

- Feature Window 声明 `blurBehavior`，Host 区分临时隐藏、后台保留、手动最小化、显式关闭与 Runtime 结束；处理 Host 模态对话框、停用和开发重载。
- WPF 保留搜索框与全局快捷键；Electron 持有精确当前 WindowEntry。召唤可恢复临时目标，Esc 按当前模式返回空搜索框或结束对应运行；WPF 不缓存插件窗口身份。
- NativeHost 启动本身不预热 Electron。WPF 首帧/输入焦点交付后，才异步为可见会话准备不含页面的 Host。
- NativeHost 持有完整版本化 session/request ownership；初连、重连在执行和退出前同步。请求先取得 ownership 再隐藏 WPF，Electron 用业务 ID 去重，丢失交接确认时可恢复呈现而不重复执行。
- Manager、插件、Translation 是同一 Host 下的不同目标。没有永久后台 keep-warm 或隐藏窗口自动销毁计时器；有效窗口（包括隐藏保留的窗口）、会话或任务会阻止正常退出。
- 实测普通 Web 插件可有主进程、GPU、Network Service、标题栏 renderer 和插件 renderer 五个进程；未为减少数字改造进程模型。

主要文件：`electron/plugins/plugin-window-manager.ts`、`electron/renderer/`、`electron/services/electron-host-ownership.ts`、`window-startup.ts`、`native/WebTools.NativeHost/Services/ElectronHostOwnership.cs`、`ManagerController.cs`、`NativeManagerPipeServer.cs` 和 `NativeWindowHandoff.cs`。

## 2. 清理与兼容性

- 删除被新路径替代的旧 Translation 代码、独立安全 probe、阶段专用 runner 和旧证据形状测试；保留历史报告和现用核心回归/通用验收入口。具体来源见[清理记录](repository-cleanup-phase6e.md)。
- `.gitignore` 排除本机 `Microsoft/` PowerShell cache、空测试 ZIP、`zip5gwSm` 临时 ZIP 与生成的 `electron.def`；不删除这些本机文件，不提交二进制包或用户配置。
- v1 声明式插件保留；早期 v2 Web 插件不能视为当前 v3 Runtime 包，需要按当前 SDK 重新打包。Node/native 兼容性仍受 Electron ABI 与平台约束。
- Translation 的默认交互已从旧版“完整页面手动点击”演进为当前 WebTools 页签防抖自动翻译；旧计划中的手动触发限制是当时快照。
- 旧设置的兼容读取和敏感字段处理继续沿用已有实现。Git 回退不能逆转已写入用户目录的数据或已分发的开源许可；合并不代表承诺任意旧版本都可直接读取新数据。

## 3. 文档与 MIT 协议

- 重写根 README：以 WPF + Electron Host 的真实分工说明入口、插件、Super Panel、独立翻译、开发工具和生命周期。
- 更新文档索引、Runtime 当前契约、Super Panel 历史状态提示和发布文档中的 SDK/Manifest 信息，保留各阶段原始证据与限制。
- 完整 MIT 许可：Copyright (c) 2026 dbt64；同步根 package 与 SDK 的 license 字段，并将许可正文随 SDK/creator 源目录保留。
- 第三方依赖和已有版权声明保留，不把第三方内容重新许可为项目自有代码。

## 4. 验证记录与边界

本次任务是整理、提交和创建 PR，未要求重新执行完整测试，因此不将历史结果冒充本次重新跑出的全仓库通过。

最近一次独立 Translation 修复在本会话已执行的记录：

- `pnpm run typecheck` 与 Electron build、NativeHost self-contained publish：通过。
- 8 个相关测试文件：57/57，包括 Translation 生命周期、IPC、业务请求身份、Pipe 客户端、ownership、窗口启动/管理和视图 generation。
- 真实 Windows 打包入口：搜索框、Super Panel、Manager，冷启动/会话预热各 4 次，共 24 次打开/关闭检查完成。
- 最终整段验收 PASS：独立空白翻译、选区原文、每次只触发一次本地翻译接口、关闭/Esc、无目标会话取消、普通 SDK Vue 插件与正常进程退出。这里使用隔离配置和本地无密钥接口，不替代真实在线服务验收。
- 当轮 Build ID：`WebTools-Translation-FirstOpen-20261021-R1`。日志、截图和机器报告保存在本机 `D:\SystemDefault\Desktop\webtoolstest\translation-first-open-20261021\`，不把本机路径当作 GitHub 可下载的公开附件。

其他阶段的历史测试计数、SDK 外部工作流、Native 检查和用户验收分别见对应报告，不将它们相加为同一版本的全量结果。历史通用 Node addon fixture 与打包可执行文件名兼容性问题见清理记录；不据一次小范围通过宣称整个插件矩阵均已重新验收。

本次提交整理的静态检查结果：

- 暂存差异为 460 个文件（相对合入远端历史后的本地源码基线；不等于 PR 含历史未推送提交后的总量）。
- `git diff --cached --check` 通过；将新增历史文档的两空格硬换行改为等效 Markdown 反斜杠换行，并规范两处文件尾空行，未改动历史测量值。
- 六份本轮编辑的入口/说明文档共 74 个本地相对链接有效。
- 根目录、SDK、creator 的 MIT 正文一致，三个 package manifest 均声明 MIT。
- 暂存内容未含上述本机生成文件，无大于 2 MiB 的新增/修改文件；凭据特征命中的三处均为合成测试样例，未打印或复制用户真实密钥。

本次不计算包哈希，不重新发布上次测试 ZIP，也未重新执行完整测试套件。

## 5. 合并范围与后续

本 PR 同时影响 NativeHost、Electron Host、插件 Runtime/SDK、Manager 设置、Super Panel 和 Translation，属于较大的累计整合。建议按上面六个模块阅读。阶段编号只是演进记录，不能代表整个产品已经最终完成。

用户仍需在真实环境核对快捷键/焦点、原有插件、网站布局与代理、真实 AI 配置和安装更新体验。Distribution/Update/Trust、AI Tool authority、MCP 与最终系统性性能/产品验收仍是后续方向，未在本次提交中宣布完成。
