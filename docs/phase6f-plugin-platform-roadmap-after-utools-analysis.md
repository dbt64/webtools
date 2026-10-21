# WebTools 插件平台路线图修订
## 对照 uTools 7.8.0 逆向报告与当前源码

**文档类型：** 路线规划、架构分析与阶段状态；原始分析保留为历史快照。
**状态：** 6G-1 COMPLETE；6G-2 可选示例人工通过，基础搜索/链接已调整为 NativeHost 内置，内置交付的打包人工项待确认。
**源码快照：** branch codex/shared-ai-translation-2.0，HEAD 707c5673dff479285b34a5b441bec9d3b725c737
**范围：** 原始 6F-4D 规划和后续路线；当前状态见 §U，本文件不单独授权未来阶段。

> **当前路线状态（2026-10-17）：** 第 A、F、G、J、K–N 节保留原始分析/计划快照；第 P、R、S、T 节及第 U 节记录后续路线。Phase 6G 当前状态以第 U 节及专项执行报告为准。6G-0 已批准；6G-1 foundation 已完成，人工验收 **USER CONFIRMED PASS**，不要重开。6G-2 最小 `http-url` 合同、内置搜索/打开链接交付和 6G-2 功能验收已通过；自动化/隔离证据详见专项报告，用户另确认功能与搜索引擎切换无问题。6G-3 进入聚焦设计审核；6G-4 尚未开始。

---

## A. Original Executive Summary — Historical Snapshot

本次将早期插件平台计划与当前 WebTools 源码、已批准的 Phase 6F-4A 架构基线、Phase 6F-4B/4C 报告，以及本机 uTools 7.8.0 插件平台分析对照。

实质结论：

> 本节结论记录本文初次编写时的路线快照，不代表当前阶段或下一步工作。请以 §U 的当前状态和顺序为准。

1. **6F-4D 仍是正确的下一阶段。** WebTools 已有 Declarative v1 的受限配置描述、Host 校验和 config 存储；Manifest v3 已允许声明 config capabilities，但目前没有对应的 v3 descriptor 和 Web/Node Runtime bridge。Manager 也没有 v3 配置管理路径。
2. **uTools 值得借鉴的是 Host 对 Feature 元数据、搜索索引、身份路由和生命周期的统一管理。** uTools 插件业务 UI 仍由插件自己编写 HTML/CSS/JS 并由 BrowserView 承载。这支持“统一 Host 壳和能力契约，保留插件业务 UI 自主性”，不支持把所有插件页面改成 Host 固定模板。
3. **WebTools 的 Feature / Host Runtime 基础已经存在。** 已有稳定 FeatureRef、独立 Plugin Window、WebContentsView、插件隔离 Session、Host-owned Runtime authority、临时 Node Command Utility Process、Main 侧能力桥。后续应补齐配置与主题契约，不另造常驻插件进程或第二个 Electron Host。
4. **6F-4E 应补上 Plugin Window 的 Host/UI 体验契约。** 当前窗口几何、标题、图标、生命周期和 bounds 已由 Host 统一；但没有发现主题信息或共享插件 UI CSS 进入 Plugin Window。先定义可选主题/token 接口，不强迫所有插件采用同一 UI。
5. **6F-5 应是 SDK / Developer Workflow 同步和 dogfood gate，而不是推倒重做 Phase 6E-8。** 当前已有 SDK 1.4.0、单独的 Manifest v3 creator、Vanilla/Vue/React/Svelte 与 Web/Node starter、Private Notes v1 示例；但本机没有可供核对的当前 SDK tarball，Private Notes 文档仍写 SDK 1.2.0。6G 前应验证“当前源码 → 本地 tarball → 仓库外开发者项目 → Host 安装校验”一致。
6. **6G 必须先通过 Quick Result 设计门，再实现 Translation Plugin 2.0。** 迁移 Legacy Translation 前还必须处理用户已接受的“handoff 只预填、不自动翻译”与当前 TranslateView 自动触发路径之间的源码差异。

本文不修改冻结的 Feature identity、Host authority、Web/Node Runtime、NativeHost、Shared AI 或 SecretStore 架构。uTools 只用于产品机制参考，不作为字段、代码或安全配置的复制模板。

---

## B. Current Source Reality

### B.1 审核范围与证据等级

WebTools 结论来自当前工作树的只读源码/文档检查，不代表本轮新运行、编译或打包。工作树开始时已含大量修改、删除和未跟踪文件；本报告不清理这些内容。

uTools 资料：

- D:/SystemDefault/Desktop/rea/uTools-7.8.0-analysis/analysis/plugin_platform_comparison.md
- D:/SystemDefault/Desktop/rea/uTools-7.8.0-analysis/analysis/features/plugin_platform.md
- D:/SystemDefault/Desktop/rea/uTools-7.8.0-analysis/analysis/evidence_index.md

报告记录 app.asar SHA-256 为 16a9f407bd886ae5a2a2b3c1c313248ef95cb2e37aaa9375e3b9d37003a853d5，选中归档成员有 integrity hash。证据来自本机安装的 uTools 7.8.0 静态 JavaScript。报告明确指出没有证明该 app.asar 与目标安装器 overlay 中的归档字节级一致；安装/更新协议和原生 addon 内部实现也没有被完整验证。因此本文只采用报告可支持的静态结论，不推断未知实现。

### B.2 Phase 状态和文档冲突

- docs/phase6f4b-plugin-center-development.md 记录 Phase 6F-4B USER ACCEPTED / COMPLETE。
- docs/phase6f4c-platform-settings-development.md 记录 6F-4C 源码已实现、验证已进行，但末尾仍为 VERIFICATION COMPLETE — AWAITING USER MANUAL ACCEPTANCE。报告记录 focused checks 22/22、全量测试 486/507、NativeHost Checks 70/72；Translation 页面因隔离路径问题未能 runtime verify。
- docs/phase6f4-manager-platform-architecture.md §19 仍写 6F-4B/4C NOT STARTED，并称下一阶段为 6F-4B。这与后续独立阶段报告冲突，是文档状态漂移。本轮不修改历史文件；以专门的 4B/4C 报告为状态证据。

因此，**规划方向上 6F-4D 是下一项；开始 4D 产品实现前，应确认 6F-4C 人工验收已完成，或显式记录用户接受的遗留限制。** 这不否定 4C 已完成的源码工作。

### B.3 当前插件平台和管理界面

当前 Feature identity 为 {pluginId, featureId}；入口面（Manager / Launcher / Super Panel）与呈现方式（Window / Command）相互独立。Manifest v3 Window 通过 Main-owned PluginWindowManager 打开；Node Command 使用临时 Utility Process。

Plugin Center 有安装、详情、权限、启停、替换、卸载 UI。v3 配置区目前显示无可用配置界面；v1 兼容配置通过旧 Declarative 页面打开，并要求插件启用和页面权限。6F-4D 的目标是让 Manager-owned 路径能够配置 installed-disabled plugin 且不启动 Runtime。来源：docs/phase6f4-manager-platform-architecture.md:140-154,164-169；src/features/plugins/PluginManagerView.vue:35-36,399-403；electron/plugins/plugin-window-manager.ts:18-32,50-107。

### B.4 当前配置与 capability seam

Declarative v1 Manifest 有闭合且带 bounds 的 settings descriptors：text、enum、boolean、number。Host 的 validateSettingValue、PluginStore.readConfig/writeConfig 负责默认值、描述符、键值和持久化校验：

- plugin-sdk/declarative-v1/runtime/manifest-v1.mjs:182-250
- electron/plugins/plugin-store.ts:42-70
- electron/plugins/declarative-runtime.ts:32-61
- src/features/plugins/DeclarativePluginView.vue:52-78

PluginStore 分离 config/<pluginId>.json 与 data/<pluginId>.json；后者是受限 JSON 私有数据。它们不是 DataStore 的 AppSettings，也不是 SecretStore。

Manifest v3 的 capabilities enum 和 Feature.requiredCapabilities 可以接受 plugin.config.read/write，但 v3 Manifest 没有 config descriptor 字段。Web IMPLEMENTED_WEB_CAPABILITIES 只含 plugin storage、Shared AI 和 Clipboard；Web bridge dispatch 没有 config case；Node Command 复用该 capability dispatcher，启动时只传递 Shared AI / Clipboard 子集：

- plugin-sdk/declarative-v1/runtime-v3/manifest-v3.mjs:20-23,232-257,313-366
- plugin-sdk/declarative-v1/manifest.schema.v3.json:18-21,53-54
- electron/plugins/web-feature-authority.ts:5
- electron/plugins/web-host-capabilities.ts:105-150
- electron/plugins/node-command-execution.ts:56-92

因此，“Manifest 可声明 config capability”不等于“Runtime 有 config API”。6F-4D 必须让 schema、validator、能力 eligibility、SDK Web/Node 类型、Manager UI 和 Host 执行路径一致；不完整支持的能力必须继续标为 unsupported，不能描述成已经可用。

### B.5 Runtime 窗口、主题与 SDK

PluginWindowManager 已标准化 Feature Window 的默认/最小尺寸、resizable、标题、图标、等待 Runtime READY 后显示、resize 后更新 WebContentsView bounds、重复调用复用、关闭时一并关闭 Runtime。Web Runtime 使用 WebContentsView、插件隔离 protocol、受控 Session、独立 preload、拒绝窗口打开和导航拦截：

- electron/plugins/plugin-window-manager.ts:50-107,109-148
- electron/plugins/web-plugin-runtime.ts:185-191,292-390
- electron/plugins/plugin-runtime-session.ts:20-51

当前 Plugin Window 背景色有固定深色值；没有发现将 Manager 的 data-theme、nativeTheme 或共享 CSS tokens 传入插件页面的正式 theme contract。Manager tokens 位于 src/styles/tokens.css，不由 Plugin Runtime 自动加载。

当前开发源代码包身份为 `@webtools/plugin-sdk@1.8.0`（6G-2 的增量契约，见 `plugin-sdk/declarative-v1/package.json`）。历史证据分层记录，不互相替代；1.8.0 的验证单独记录在 6G-2 执行报告：

- **Phase 6F-5 专项结项：** `docs/phase6f5-sdk-developer-workflow.md` 记录 SDK `1.6.0`、creator `1.1.0` 的 tarball 身份及 hash，Vanilla/Vue/React/Svelte × Web/Node 的 8/8 外部工作流、Host validator、focused checks 16/16 均通过，并把 Phase 6F-5 结论记录为 COMPLETE。该结论来自该阶段自己的验收报告，不是从之后的 SDK 版本推导出来的。
- **后续 SDK 1.7.0 验证：** `docs/phase6g1-feature-quick-result-foundation.md` 记录外部 tarball `webtools-plugin-sdk-1.7.0.tgz`，66,100 bytes，SHA-256 `7251C9EF51557527CE1035EB812EB6FD27555838F941240AE6AB3F7937D92D70`，以及 frozen install、typecheck、build、validate、pack、inspect 和 Host validation 的外部作者流程。报告记录的 tarball 位于 `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\20261016-152813\sdk\webtools-plugin-sdk-1.7.0.tgz`。

因此无需仅为复核 SDK tarball 工作流而重复 Phase 6F-5；同时，6G-1 对 1.7.0 的验证只证明报告列出的 SDK 包及该外部作者流程，不能单独证明或重开整个 Phase 6F-5 的范围。Phase 6F-5 整体状态以其专项结项报告为准；该报告未列出剩余验收 blocker。本次路线修订不据 1.7.0 新增全阶段结论。SDK Web/Node API 的实际公开面、typed config 和各框架 starter 范围也应以该结项报告与当前 package manifest 为准，不沿用本节早期版本快照中的 1.4.0/1.0.0 描述。

### B.6 Translation 与未来 Quick Result

当前 Translation 仍是 Manager 内置业务页，设置保存在 AppSettings.translation，请求由 Main-owned TranslationService 管理；Shared AI provider/key 属于平台，raw credential 留在 SecretStore。Legacy Translation 有 MyMemory、SharedAI 和 Qwen-MT 路径；Qwen-MT 使用专用 Host adapter。来源：

- src/features/translate/TranslateView.vue
- src/features/translate/LegacyTranslationSettings.vue
- electron/services/translation-service.ts:129-174
- docs/phase6f4-manager-platform-architecture.md:203-233

Super Panel 的“选择文本后提供快速翻译结果”仍是明确未来产品方向，需由真实 Translation Feature/Plugin 提供结果；没有授权 NativeHost 第二套翻译服务或伪造结果。见 docs/super-panel.md:209-211,267。

已有源码差异：历史 Windows acceptance 要求 Launcher handoff 只预填文本、不自动翻译；当前 TranslateView 在输入、设置或 Provider 状态变化后会调用自动调度路径。已批准架构要求 6G 移除 Legacy Translation 前处理此差异。这是规划约束，不是本轮修复授权。

---

## C. uTools Reference — Lessons Worth Adopting

1. **声明式 Feature metadata 便于统一发现。** 插件的 feature identity、可读说明和 commands 被 Host 汇总进搜索索引；命中携带 plugin identity 和 feature code，再回到 Host 路由。这与 WebTools 的 FeatureRef + Native projection / Main activation authority 方向相容。
2. **统一的是平台入口和 Host 路由，不是全部业务页面。** uTools 允许插件用 React/Vue 等技术构建 UI，由 BrowserView 承载。WebTools 可统一 Feature discoverability、Host Window、主题变量、capability bridge 和生命周期，同时让插件保留业务 UI 自主权。
3. **Main 持有插件身份与 API 分发。** 静态摘录显示受控 preload/service API；Main 根据 webContents 对应的 plugin identity 分发。WebTools 应继续每次基于 validated package、FeatureRef、session/generation 和 capability authority 校验，而不是相信 renderer 发来的 pluginId。
4. **Host 复用窗口并管理生命周期。** WebTools 的 PluginWindowManager 已在同一架构方向，不需再引入额外 Host 进程。
5. **搜索使用已校验元数据投影。** Native projection 只传递可搜索的安全摘要，真正激活仍回 Main 验证。
6. **插件自有 UI 是正常扩展点。** Host 不需知道 React/Vue 业务组件内部。WebTools SDK 只应暴露小而受控的 Host interface。

证据定位：plugin_platform_comparison.md:38-63,91+；features/plugin_platform.md:9-19,33-38。它支持结构和调用关系；安装器 overlay 是否含完全相同 app.asar 仍未知。

---

## D. uTools Concepts We Should NOT Copy Directly

- 不复制 plugin.json 字段、code/explain/cmds identity、目录布局或兼容逻辑。WebTools 保留自己的 Manifest v3、FeatureRef、FeatureProjection 和 capability contract。
- 不以“统一 UI”为由让 Host 渲染所有业务界面。只有小型声明式配置等适合 Host 根据受限 descriptor 渲染。
- 不复制 uTools 静态观察到的旧 Electron 安全偏好：报告列出 sandbox=false、contextIsolation=false、webSecurity=false。它只证明该构建出现这些配置，不证明其安全。WebTools 当前隔离/CSP/navigation/session/authority 设计应独立维持。
- 不把 Node plugin 描述成操作系统沙箱。Node Runtime 使用当前用户权限；Host capability mediation 不是 Windows OS-level containment。
- 不推导 uTools 安装/自动更新/Marketplace/原生 addon 内部实现或内存效果；报告没有可验证这些结论的证据。
- 不把 WebTools 全部移到 Electron。NativeHost Launcher/Tray/Super Panel 与按需 Electron Manager/Plugin Window 的进程所有权保持独立。

---

## E. Frozen WebTools Architecture

1. WPF NativeHost 继续独立负责 Launcher、全局热键、托盘、本机 App/Website/Feature 搜索入口和 Super Panel；未打开 Manager 时不因插件搜索启动 Electron。
2. Electron Main 是插件安装校验、package snapshot、Registry、capability authority、PluginStore、Feature activation、Plugin Window 和 Shared AI 的最终 Host authority。
3. Feature identity 保持 {pluginId, featureId}；入口面（Manager / Launcher / Super Panel）与 presentation（Window / Command）相互独立。
4. v1 declarative 页面继续作为闭合、安全、向后兼容路径；不是 v3 新插件的默认页面架构。
5. v3 Web 页与 Node Runtime 分开：Web 使用 isolated WebContentsView + Host preload bridge；Node Command 经临时 Utility Process。
6. SDK validation 只提供作者反馈，安装时 Host validator 始终最终裁决；Native Feature Projection 仅供发现，Main 激活重新验证。
7. plugin config、plugin data、平台 AppSettings、SecretStore 是不同存储/权限域；插件 config 不可存 raw API key。
8. Shared AI 是平台能力；插件调用必须经过授权/consent/policy，普通插件不要求 AI/MCP。
9. installed plugin 用户数据和 Legacy Translation 在新路径验收前不能删除。
10. 不引入常驻插件 daemon、第二个 Electron Host、隐藏 BrowserWindow 命令执行、特权 IPC 或第二份 Feature identity。

---

## F. Original Gap Analysis — 20 个 Source Findings (Historical Snapshot)

> 本表最初基于早期源码快照。第 1–18 项仅作为当时的架构分析记录；第 19–20 项是 2026-10-16 更新的当前发现。此表不用于判断当前 6G 阶段或安排下一步，当前顺序以 §U 为准。

| # | 问题 | 当前源码结论 |
|---:|---|---|
| 1 | 精确的配置基础设施 | v1 settings descriptors + validateSettingValue + DeclarativeRuntime actions + PluginStore config namespace + ManagedFs atomic writes。 |
| 2 | declarative-v1-only 的部分 | v1 settings schema、Host 固定表单/页面、按 action key 读写；不能证明 v3 public runtime config 已实现。 |
| 3 | Manifest v3 配置支持 | 只有 plugin.config.read/write capability 声明、Feature.requiredCapabilities 和 allowlist；没有 config descriptor/value contract。 |
| 4 | 声明但没有桥接的能力 | plugin.config.read/write 不在 IMPLEMENTED_WEB_CAPABILITIES；Web dispatch 无对应 case，Node command 的启动 capability 子集也未包含它们。 |
| 5 | PluginStore 数据分区 | config/<id>.json 为描述符校验设置；data/<id>.json 为受限 JSON；AppSettings 在 DataStore；SecretStore 由 Main 管理。 |
| 6 | Manager 能否离线配置 disabled 插件 | 当前不能作为通用 v3 管理路径。v1 兼容设置依赖启用/页面权限；v3 暂无可用配置 UI。4D 目标为 Manager management authority 可配置 disabled plugin，不启动 Runtime。 |
| 7 | Web Runtime config authority | 当前无 plugin.config API；storage 属于 plugin private data，能力调用受当前 WebFeatureAuthority/session/generation/request/grant 检查。 |
| 8 | Node Command config authority | 当前无 plugin.config API；复用 WebHostCapabilities，仅有当前桥接的能力，不绕过 PluginStore。 |
| 9 | 当前 SDK 暴露面 | root: Manifest parse/validate/pack/create；/web: context、storage、AI、clipboard、ready/onClose；/node: context、storage、AI、clipboard 和 path helper；/manifest: v3 类型/解析。没有 typed config methods。 |
| 10 | 当前分发 SDK 是否与源码同步 | 未找到可比较的当前 tarball/hash，无法独立验证，结果 UNKNOWN；6F-5 补源包身份、hash和外部项目验证。 |
| 11 | 保留的 templates/examples | Declarative v1 basic starter；create-webtools-plugin Vanilla/Vue/React/Svelte × Web/Node；独立 Private Notes v1。它们覆盖不同契约，不合并成强制单一新模板。 |
| 12 | PluginWindowManager 已统一的 shell | 按 FeatureRef/package identity 复用；Host 控制标题/icon/default/minimum bounds/resizable；Runtime READY 后显示；resize 同步 child view；close 同步关闭 Runtime。 |
| 13 | Theme 到 Plugin Window 的路径 | 未发现 theme bridge/token export；Manager token 不会自动加载进 plugin page，BrowserWindow background 还有固定深色值。 |
| 14 | 共享插件 UI CSS/components | 未发现通用跨插件组件/CSS包；starter 有本地 style.css，Manager tokens 不是 plugin SDK 共享资源。 |
| 15 | v1 declarative 战略价值 | 兼容、安全无插件 JS 的固定 Host UI/配置表单和低权限样例；继续作为兼容和小表单路径，不取代 v3 自有业务页。 |
| 16 | 6F-4D 最小工作 | v3 typed descriptor；Host validator/default/store；独立 Manager management 与 runtime capability 两条 API；Web/Node SDK bridge 对齐；disabled config；数据与 Secret 分区；v1兼容。 |
| 17 | 等待 6F-4E 的内容 | Plugin Window theme propagation、可选 theme token/CSS contract、Host shell 可视行为和跨框架验收；不扩大 4D config schema。 |
| 18 | 等待 6F-5 的内容 | SDK/creator/source/tarball 对齐、仓库外 author workflow、public docs/exports、框架 starter验证和 SDK 分发版本决定。 |
| 19 | 当前基础选区体验缺口 | 6G-1 通用 Quick Result transport 已实现；selected-text Feature matching 仍只看 context type/source，不看文本内容；内置 Translation 仍走 Manager handoff，真实同面板 Translation Quick Result 尚未实现。按 §U 先完成 6G-2 基础匹配、真实操作接入与可靠性，再审查真实翻译结果适配。 |
| 20 | Legacy Translation 后续迁移边界 | 保留 AppSettings.translation、现有 provider/limit/cancel/error、Native→Manager handoff 及 SecretStore 所有权，直到 §U 的真实 Translation 路线通过验收且有可回滚迁移方案。Legacy migration 不是当前下一步。 |

---

## G. Original Revised Roadmap — Historical, Superseded by §U

> 下表保留本文初次编写时的阶段顺序。它把 6G-1 写为 Translation Plugin 2.0，现已过时；不得按此表启动工作。当前路线见 §U。

| 顺序 | 阶段 | 交付 | 进入条件 |
|---:|---|---|---|
| 0 | 6F-4C acceptance closeout gate（不新编号） | 确认用户验收，或明确接受报告中的未验证项 | 用户确认 4C manual acceptance |
| 1 | **6F-4D Plugin Configuration Contract** | v3 Host、Manager、Web/Node 和 SDK config contract | 4C 状态结清；用户审核 4D implementation plan |
| 2 | **6F-4E Plugin Host/UI Experience Contract** | Plugin Window theme/token 与 shell 行为；保留插件业务 UI 自主性 | 4D 回归完成 |
| 3 | **6F-5 SDK / Developer Workflow Synchronization** | Source/tarball/creator/starter/docs 外部一致 | 4D/4E contract 固定 |
| 4 | **6G-0 Feature Quick Result design gate** | 为 Super Panel 定义最小 Host-owned、Feature-backed result | 6F public contracts 稳定 |
| 5 | **6G-1 Translation Plugin 2.0** | 首个真实第一方 v3 Web Feature，消费 config/Shared AI/Quick Result | 6G-0 审核通过；Qwen-MT 与 handoff 路径已审查 |
| 6 | **6G-2 Legacy Translation migration/removal** | 数据/入口迁移、回滚可用后移除旧 Manager page | 新 Translation parity 与用户接受 |
| 7 | **6G-3 First-party dogfood/stabilization** | 依据 Translation + 小型非 AI plugin 改善实际 SDK 痛点 | 6G-1/2 closeout |
| 8 | **6H Distribution / Update / Trust** | 包信任、兼容、升级、分发和恢复 | 单独架构审核 |
| 9 | **AI Tool capability** | 用户调用 Feature 与 AI-callable Tool 分开建模 | 有明确需求，单独威胁建模 |
| 10 | **MCP integration** | 与 WebTools Plugin UX/Feature 系统互补的 interop | Tool authority 与授权模型成熟 |
| 11 | **6I Performance / Memory / UX** | 按明确目标测 Launcher、Manager、Plugin Window 等 | 功能架构稳定 |
| 12 | **6J Final Product Acceptance** | NativeHost、Manager、Plugin、Translation、安全、安装、性能全验收 | 产品阶段完成 |

uTools 报告不要求重排 WebTools 架构。它使 6F-4E/6F-5 更明确地承接统一 discovery、Host shell 和 SDK tokens，同时保留插件业务 UI 自主性和安全边界。

---

## H. Phase 6F-4D — Plugin Configuration Contract

**GOAL**
为 Manifest v3 建立可由 Host 校验、持久化、由 Manager 管理并可经 Web/Node Runtime capability 使用的 typed plugin configuration。

**WHY NOW**
配置是 v3 插件和 Translation 迁移的前置能力。当前 capability 已在 Manifest allowlist，但没有 descriptor/API；过早开放会造成声明和运行结果不一致。

**CURRENT SOURCE BASELINE**
复用 v1 text/enum/boolean/number 与 bounds、PluginStore config namespace、DataStore/SecretStore 分区、PluginCatalog safe DTO、Manifest snapshot、WebFeatureAuthority 和 Node Utility Process bridge。

**PRODUCTION CHANGES EXPECTED**

1. 在 4D implementation plan 冻结 additive、闭合、版本化 descriptor schema、defaults、类型/bounds 和不兼容行为；不是 arbitrary JSON schema、脚本或自定义表单。
2. 建立单一 Host config module：descriptor/default/value validation、compatible read/write、bounded DTO。Web、Node、Manager 是调用同一 Host seam 的 authority adapters，不重复规则。
3. Manager management path 只针对当前安装包 identity，能够管理 installed-disabled plugin；不启动 Runtime、不要求启用、不开放配置以外 authority。
4. Runtime path 独立检查 active plugin、session、package identity/hash、generation、requested + granted + implemented capability。Web/Node SDK API 一致；Node command 仍临时执行。
5. config 与 storage/data 保持不同；SecretStore、AppSettings、credential、AI provider endpoint 不加入 plugin config 读取路径。
6. Host install-time validator 始终最终 authority。Manifest、SDK、catalog DTO、grant UI、Runtime bridge 不同步时，能力必须拒绝或标 unsupported。
7. descriptor 更新不兼容时失败关闭且保留旧值，不静默清空。

**SDK CHANGES EXPECTED**
Manifest v3 descriptor types/parser/schema、typed Web/Node config methods、错误类型和文档。不得暴露 generic IPC、arbitrary filesystem、SecretStore 或全局设置。SDK version number 留待 implementation plan 基于真实分发合同决定。

**DOCUMENTATION CHANGES EXPECTED**
Descriptor types/bounds、defaults、grant、disabled config、migration/error、data retention、Host authority 和 secret separation。

**TEST / ACCEPTANCE STRATEGY**

- Descriptor 正负边界、未知/重复键、defaults 和规模限制；
- Host install validation 拒绝非法 Manifest；
- Manager 配置 disabled plugin，证明 Runtime 未启动；
- Web/Node 缺 request/grant、禁用、stale generation/session/hash 时拒绝；
- storage 与 config 互不覆盖；
- 旧值不兼容时保留；
- SDK type 与 bridge 对齐；
- 不读取或报告真实 SecretStore/AI token。

**DEPENDENCIES**
4B Plugin Detail；4C Shared AI/SecretStore ownership；Runtime snapshot、identity、generation、grant。

**NON-GOALS**
任意插件 HTML/React/Vue 配置页、插件访问全局 Settings、raw API key、v1→v3自动转换、AI Tool/MCP、@webtools/plugin-ui。

**EXIT CRITERIA**
Manager 可配置 enabled/disabled v3 插件而不启动 Runtime；Web/Node config 仅在完整 authority 条件下工作；Host/SDK/Manifest/UI同步；v1兼容；无阻塞缺陷；回归证据通过。

**NEXT PHASE GATE**
用户审核 4D closeout 后进入 6F-4E。若 4C manual acceptance 仍待确认，不将其写成自动验收 PASS。

---

## I. Phase 6F-4E — Plugin Host/UI Experience Contract

**GOAL**
统一 Host 插件窗口外壳、主题表达和基础可访问性契约，同时保留插件自己的业务 IA 和框架选择。

**WHY NOW**
窗口几何、标题、图标和生命周期已统一；主题信息尚无正式 contract。uTools 表明统一平台不等于 Host 渲染全部插件页面。

**CURRENT SOURCE BASELINE**
复用 PluginWindowManager/runtime preferences；Manager tokens 属于 Manager Renderer，Plugin Window 没接收这些 tokens；starter 各有 CSS。

**PRODUCTION CHANGES EXPECTED**

- 定义 Host theme 来源、默认值、切换通知和 system/light/dark 语义；
- 定义可选稳定 CSS custom properties/color-scheme contract；
- 明确 Host BrowserWindow chrome、focus/keyboard 和 accessibility 职责；
- 业务布局/组件仍由插件作者决定；
- 不改 FeatureRef、Window/Command、Runtime authority。

**SDK CHANGES EXPECTED**
本阶段冻结调用语义/token名/生命周期；public helper 或可复用基础 CSS 延后 6F-5统一出包。不要立即另建 UI package。

**DOCUMENTATION CHANGES EXPECTED**
Theme/shell contract、opt-in tokens、四框架示例、回退和 accessibility 约定。

**TEST / ACCEPTANCE STRATEGY**
外部 Vanilla/Vue/React/Svelte project 验证 theme/system、窗口尺寸/DPI、复用和 reload；采用与不采用 token 的插件均可运行；人工检查 Host 没强改业务 UI。

**DEPENDENCIES**
6F-4D config contract 和稳定 Plugin Window shell。

**NON-GOALS**
固定 Dashboard、强制插件同 UI、Host 改写 DOM、Manager redesign、迁往 WPF/Electron、当场发布 UI package。

**EXIT CRITERIA**
主题来源和变化可观察；跨框架 Host shell 语义一致；未接入 tokens 的 v1/v3 页面仍兼容。

**NEXT PHASE GATE**
把已冻结的 config/theme/runtime contracts 交给 6F-5 SDK synchronization。

---

## J. Phase 6F-5 — SDK / Developer Workflow Synchronization (Original Plan Snapshot)

> 本节是 6F-5 执行前的计划快照，其中的 SDK `1.4.0`、creator `1.0.0` 和“未找到 tarball”是当时基线，不是当前状态。实际阶段结果见 `docs/phase6f5-sdk-developer-workflow.md`；其结项报告记录 6F-5 COMPLETE。之后的 SDK `1.7.0` 外部 tarball/author workflow 结果另见 6G-1 执行报告。不要用 1.7.0 的一次验证替代 6F-5 全阶段证据，也不要因本节旧版本信息重复启动已记录完成的工作。

**GOAL**
证明正式 SDK/creator 可作为外部分发工具，独立产出与 Host install-time validator 兼容的 v1/v3 packages，并同步 config/theme contract。

**WHY THEN**
平台一致性依赖作者看到的 Manifest/types/CLI 与 Host 实际接受的内容一致。撰写本计划时的基线为 SDK 1.4.0、独立 creator 和 Private Notes 旧版文档；tarball hash 尚未核对。后续实际交付以 6F-5 结项报告为准。

**SOURCE BASELINE AT PLAN TIME**
SDK root/web/node/manifest exports、v1 basic starter、v3 creator（Vanilla/Vue/React/Svelte × Web/Node）、Private Notes v1、Host validator final authority。

**PRODUCTION CHANGES EXPECTED**

- 建立 SDK+creator 可重复打包和 source/package identity；
- 为 local tarball 记录 version、file inventory、hash；不发布 npm/Marketplace；
- 确认 package files/types/schemas/CLI 来自 reviewed source；
- 仓库外临时开发目录用 tarball 执行 install/build/validate/pack/inspect；
- 校正 Private Notes 与 docs 的 SDK version/commands；
- Host install-time validator 始终复验。

**SDK CHANGES EXPECTED**
只添加已审核的 4D/4E public config/theme surfaces；保留单一 @webtools/plugin-sdk、独立 create-webtools-plugin、v1 generator和v1 example。先由外部 workflow 找断点，再决定版本号。

**DOCUMENTATION CHANGES EXPECTED**
独立开发环境、tarball identity、支持矩阵、config/theme API、Host final validation、错误诊断。

**TEST / ACCEPTANCE STRATEGY**

- source 与 SDK/creator tarball file list/package identity/hash 比较；
- 外部项目无 monorepo private imports；
- 四框架/Web/Node starter 抽样 build/typecheck/validate/pack/inspect；
- Host authoritative validator 验证生成的 .wtplugin；
- v1 Private Notes 和 v3 config capability 代表性样例；
- 用户 Developer Workflow Acceptance 不被 repo tests 替代。

**DEPENDENCIES**
6F-4D/4E public contracts 固定；Node/pnpm authoring toolchain。

**NON-GOALS**
重做 6E-8、npm/online Marketplace 发布、breaking API rewrite、强制 UI framework、开始 Translation。

**EXIT CRITERIA**
reviewed source 能生成 hash 可记录 local tarball；仓库外作者路径可工作；Host 再验证包并拒绝非法内容；文档和 package version 一致。

**NEXT PHASE GATE**
通过 external workflow 后审核 6G-0 Feature Quick Result contract。

---

## K. Phase 6G-0 — Feature Quick Result Design Gate (Historical Plan)

> 本节是 6G-0 审核前计划记录。6G-0 现已批准，6G-1 foundation 也已实现；本节中的“Quick Result 未实现”只描述当时快照。当前状态见 §U。

**GOAL**
在 Translation Quick Result 实现之前定义已授权 Feature 到 Super Panel 的最小 typed result/preview contract。

**WHY NOW**
“选中英文后面板显示快速翻译结果”是保留的产品方向。NativeHost 面板和 Electron Plugin Feature 之间需要 Host-owned、可校验、会过期的传递合同。

**CURRENT SOURCE BASELINE**
FeatureRef/invocation authority 已存在，Super Panel 可展示 selection/context；Quick Result 未实现，也没有 Feature→Panel result contract。

**PRODUCTION CHANGES EXPECTED**
默认只做 design/threat review，不实现翻译。确定调用者身份、request/result关联、bounded payload、timeout/cancel/close/revoke、隐私和 AI 是否需要用户操作。不要公开 Native pipe/private IPC。

**SDK CHANGES EXPECTED**
无 runtime code；设计 public Feature result API 需关联现有 Main authority，不绕过 activation。

**DOCUMENTATION CHANGES EXPECTED**
独立 contract、threat boundary、payload limits、错误/取消/撤权。

**TEST / ACCEPTANCE STRATEGY**
设计 gate 审核；6G-1 才以隔离数据验证真实 Feature result、关闭/撤权、失败路径。

**DEPENDENCIES**
6F-4D、6F-4E、6F-5。

**NON-GOALS**
NativeHost 第二翻译服务、伪造结果、无用户动作 AI 请求、OCR、AI-callable Tool。

**EXIT CRITERIA**
结果源来自经 Main 验证的 FeatureRef/current authority；边界明确；NativeHost 只展示，不执行 provider 请求；单独设计审核通过。

**NEXT PHASE GATE**
审核通过后进入 6G-1。

---

## L. Phase 6G-1 — Translation Plugin 2.0 (Historical Plan, Superseded)

> 此处的 6G-1 Translation Plugin 2.0 已不再是当前 6G-1 定义。当前 6G-1 是已完成且人工验收 USER CONFIRMED PASS 的 Quick Result Foundation；真实 Translation Quick Result 安排在 §U 的 6G-3。不要按本节启动实现。

**GOAL**
将 Translation 做成使用 public Feature/SDK/config/Shared AI 的第一方 v3 plugin，并按 6G-0 contract 提供 Super Panel Quick Result。

**WHY NOW**
Translation 是验证 typed config、Shared AI、Feature Window 和 Quick Result 是否够用的完整业务消费者。

**CURRENT SOURCE BASELINE**
Legacy Manager Translation、TranslationService、MyMemory/SharedAI/Qwen-MT、language settings、request limits/cancel/errors/handoff。Secrets 由 Host 持有；Qwen-MT 有专用 Host adapter。

**PRODUCTION CHANGES EXPECTED**

- Translation UI/workflow 作为 v3 Web Feature；
- engine/language/preference 属 plugin config，provider/credential 属平台 AI/Host；
- Shared AI 经授权 capability；如保留 Qwen-MT 专用模式，先设计最小 Host-mediated service，不暴露 key；
- 复用既有 limits/cancel/errors 语义；
- Quick Result 只走 6G-0 public contract；
- handoff 准确预填；维持已接受的 prefill-only，不隐式发 provider 请求。

**SDK CHANGES EXPECTED**
仅消费已冻结 public methods；真实 dogfood 可以提出 bounded SDK refinement，不可调用 Manager preload/private pipe。

**DOCUMENTATION CHANGES EXPECTED**
Provider/language behavior、consent、Quick Result privacy、limits/cancel/errors、未配置状态、Legacy co-existence。

**TEST / ACCEPTANCE STRATEGY**
隔离 profile/synthetic credentials；provider path、limits/cancel/errors、config restart、handoff exact prefill/no auto translation、Quick Result、theme、Runtime reopen/close；不让 secret 出现在 DTO/log/page。

**DEPENDENCIES**
6F-4D/4E/5、6G-0、Host secret ownership。

**NON-GOALS**
移除 Legacy、改全局 provider ownership、raw key、NativeHost 翻译实现、隐式 AI。

**EXIT CRITERIA**
Legacy 常用功能和设置有映射；只用 public APIs；用户桌面验收通过；失败路径明确；Legacy 可回滚直至 6G-2。

**NEXT PHASE GATE**
用户接受后才迁移/移除旧页。

---

## M. Phase 6G-2 — Legacy Translation Migration / Removal (Historical Plan, Superseded)

> Legacy migration/removal 不再是当前 6G-2。按 §U，先完成基础选区匹配、真实操作 handoff 和面板可靠性；Legacy 保留至真实 Translation 路线被验收并具备回滚方案。

**GOAL**
迁移 Translation 偏好和入口；确认新插件接管后再移除旧 Manager page/service routes。

**WHY NOW**
旧设置在 AppSettings.translation，handoff 仍导向旧 Manager 页。未经迁移删除会丢失偏好或入口。

**CURRENT SOURCE BASELINE**
AppSettings.translation、TranslationService provider/limits/cancel、built-in catalog state、NativeManagerIntent/handoff、Main SecretStore/provider map。

**PRODUCTION CHANGES EXPECTED**
non-secret settings 做明确映射、备份/恢复、幂等迁移；入口重定向；确认新插件覆盖必要场景后再删除旧 page/不再使用路径。Secret 保留在 Host SecretStore。迁移失败保留原值和恢复路径。

**SDK CHANGES EXPECTED**
不新增合同；只有 dogfooding 证实的 public API 缺口另行审核。

**DOCUMENTATION CHANGES EXPECTED**
field mapping、backup/rollback、删除语义、upgrade 和支持指引。

**TEST / ACCEPTANCE STRATEGY**
迁移前后对照、幂等、损坏配置保留旧值、升级/reopen、新旧入口、prefill-only、无 secrets输出、回滚可用。

**DEPENDENCIES**
6G-1 user acceptance 和 6F-4D config contract。

**NON-GOALS**
修改 Shared AI/SecretStore schema、改变全局默认 provider、删除用户偏好。

**EXIT CRITERIA**
迁移能回滚；新页面/入口稳定；用户确认；无剩余入口依赖旧页后才能删除。

**NEXT PHASE GATE**
进入 6G-3 bounded stabilization。

---

## N. Phase 6G-3 — First-Party Dogfood / Stabilization (Historical Plan, Superseded)

> 本节的 dogfood/stabilization 不再是当前 6G-3。当前 6G-3 用于真实 Translation Quick Result；dogfood 如仍有需要，必须在后续阶段单独排序与授权。

**GOAL**
用 Translation 与至少一个小型非 AI plugin 检查平台抽象是否足够。

**WHY NOW**
单一复杂 plugin 易把专属需求误做成通用 API；第二消费者帮助验证复用价值。

**CURRENT SOURCE BASELINE**
已有 Private Notes v1 与多框架/runtime v3 creator starter；没有共享 UI kit。

**PRODUCTION CHANGES EXPECTED**
只修实际重复或第二消费者证实的 contract 问题；插件特有逻辑留在 Translation adapter；保持 FeatureRef/authority/storage/config/security不变。

**SDK CHANGES EXPECTED**
bounded types/errors/docs refinements；SDK tarball与source同步；无需要不新增 UI package。

**DOCUMENTATION CHANGES EXPECTED**
记录作者工作流、错误诊断、theme adoption、config ergonomics 的实测体验。

**TEST / ACCEPTANCE STRATEGY**
外部 SDK workflow、v1 compatibility、多框架抽样、Plugin Window lifecycle/disable/revoke、regressions 和人工作者验收。

**DEPENDENCIES**
6G-1/2 closeout、有效 local tarball workflow。

**NON-GOALS**
通用化所有 UI 控件、Marketplace、AI Tools、MCP。

**EXIT CRITERIA**
无阻塞 SDK usability 问题；抽象有多个真实调用者支持；版本、包、文档一致；回归通过。

**NEXT PHASE GATE**
另行设计 6H；不暗含进入 AI Tool 或 MCP。

---

## O. Later 6H / AI Tool / MCP / 6I / 6J Boundaries

### 6H — Distribution / Update / Trust
以后独立定义 package trust/identity、兼容、升级、rollback、删除数据策略和用户确认。本地 package hash 只证明 integrity，不等于作者认证。

### AI Tool capability
“用户调用 Feature”不等于“AI 能调用 Tool”。未来独立建模 allow/ask/unavailable、参数、副作用、确认、审计和撤权。没有需求不提前塞进 Manifest/config。

### MCP
MCP 提供外部 Tools/Resources/Prompts interop，补充而不替代 Plugin UX、Window、config、Feature search/context。待 Tool authority 成熟后再单独设计。

### 6I — Performance / Memory / UX
功能合同稳定后按目标测量 NativeHost idle、Launcher latency、Super Panel first-use、Manager startup、Plugin Window/Utility cleanup。uTools 静态插件分析没有提供 WebTools 内存目标或优化数字的证据。

2026-10-19 补充：用户报告的首次点击只启动 Electron、不显示 Translation，已通过真实 HWND 与隔离单变量对照定位为打包 GUI 进程的 `SW_HIDE` 启动状态。正确性修复当期处理；后续把冷/暖启动分段计时、插件数量对首屏的影响、关键路径按测量惰性化及关闭后 Electron=0 纳入 6I。详见 [首启生命周期调查与优化安排](electron-cold-start-lifecycle-investigation.md)。当前不宣称系统性能验收完成。

### 6J — Final Product Acceptance
最终覆盖 NativeHost、Manager、Plugin、Translation、config/data/SecretStore、安装更新、安全、性能和真实 Windows 环境；依据正式证据决定，不提前宣称完成。

---

## P. Current Dependencies and Ordering

    6G-0 explicit-action design (approved)
                    │
                    v
    6G-1 Quick Result foundation (implemented; manual UI gate open)
                    │
                    v
    6G-2A basic selected-text content matching
                    │
                    v
    6G-2B real Translation / plugin context handoff acceptance
                    │
                    v
    6G-2C Super Panel result/list/lifecycle reliability
                    │
                    v
    6G-3 real Translation Quick Result
                    │
                    v
    6G-4 differentiated text intelligence
                    │
                    v
    6H distribution/trust (separate gate)

- 6G-1 remains incomplete until the remaining real UI acceptance is recorded; synthetic result fixtures do not substitute for it.
- 6G-2A is foundational: content-aware action matching is included, with its minimal declarative rule contract approved before implementation.
- 6G-2B verifies the already-existing Manager Translation handoff and independent Plugin Window context path before adding any new route.
- 6G-2C reuses existing generation, scroll reset, virtualization, and layout checks; fix only reproducible failures.
- 6G-3 must preserve Main/Host provider and secret ownership and requires a focused design review for built-in Translation → same-panel Quick Result.
- Automatic preview, dictionary/definition preview, adaptive ranking, 6H, AI Tool, MCP, 6I, and 6J each require their own product/architecture gate.

---

## Q. Risk Register

| 风险 | 严重性 | 影响 | 缓解 |
|---|---|---|---|
| v3 config capability 已声明但未 bridge | High | Manifest/request/grant/runtime 不一致 | 4D 同步 Host validator、SDK、capability eligibility、Manager、Web/Node bridge |
| Manager 与 Runtime config authority 混为一条 | High | enabled 才能配置或 Runtime 获得管理权 | 两个 authority adapters，共用 Host validator/store |
| descriptor 改版静默清除用户值 | High | 用户数据丢失 | 版本化兼容、原子写、失败保留旧值 |
| Shared AI credential 混入 plugin config | High | Secret 泄漏 | Store/DTO separation 与安全回归 |
| 当前 SDK tarball/source sync 未知 | Medium-High | 外部 author 使用陈旧 schema/types | 6F-5 hash/package identity/external workflow |
| 6F-4A 文档状态陈旧 | Medium | 阶段顺序/授权误判 | 本新计划声明状态来源；后续单独做文档收口 |
| 6F-4C manual acceptance pending | Medium | 将未验证误标完成 | 4D实现前确认或明确接受限制 |
| Plugin Window 缺主题契约 | Medium | 多框架外观不一致 | 4E opt-in tokens 与回退行为，不强制 UI |
| 复制 uTools 静态安全偏好 | High | 隔离策略弱化 | 不复制其旧 webPreferences；保留 WebTools security contract |
| Translation 私有绕过或 handoff 回归 | High | Secret exposure/行为差异 | 6G-0 gate、6G-1 parity、6G-2 rollback |
| Node plugin 被称为 OS sandbox | High | 用户信任误解 | 清楚表述当前用户权限和 Host API mediation |
| 单一 Translation 用例导致过度抽象 | Medium | SDK/API 膨胀 | 第二消费者验证后再普遍化 |

---

## R. Explicit Non-Goals

> 本节原始边界仍有效；其中 6G Quick Result 状态已按当前路线更新。

- 重写 Launcher / Super Panel / Manager Shell；
- 全平台迁往 Electron 或 WPF；
- 改 Feature identity、Native projection authority；
- 复制 uTools Manifest 或 IPC；
- 强制插件同 UI、框架或 dashboard；
- 任意 HTML/script 设置页；
- plugin 读取 SecretStore/raw credential；
- 常驻 plugin daemon、第二 Electron Host、隐藏 renderer 命令；
- 自动 v1→v3 转换；
- Marketplace/online install/auto update；
- AI Tool、Agent、MCP 当前实现；
- NativeHost 第二套 Translation；
- 不重复实现已完成的 6G-1 通用 Quick Result Foundation；本路线不在当前工作包实现真实内置 Translation Quick Result（§U 的 6G-3）；
- 无关性能优化或 soak；
- 本轮修改代码、测试、fixture、SDK、package manifest、installer 或用户数据；
- stage/commit/push/PR/tag/release/package。

---

## S. Recommended Immediate Next Action

1. 6G-1 的真实鼠标/视觉人工验收已由用户确认通过，入口 gate 已关闭。Synthetic Quick/Long 仍仅证明 foundation 的对应场景，不推定为真实翻译或完整产品 parity。
2. 审核并批准 6G-2 详细计划，冻结 6G-2A 的最小文本内容匹配规则，并安排 6G-2B/2C 的真实打包验证。
3. 按批准范围完成基础匹配、真实文本操作 handoff 和面板可靠性；不提前迁移 Legacy Translation。
4. 基础路径通过后，单独审核 6G-3 的真实 Translation Quick Result 方案；之后才评估 6G-4 差异化能力。

本路线修订本身只更新计划，不自动开始产品实现、测试或打包。

---

## T. Open Questions That Truly Require User Product Decisions

> 以下为当前 6G 产品决策；原始 6F-4D/4E 问题已属于历史规划，不再是本路线的下一步。

- **6G-2A:** 批准哪些最小、有限、声明式的选中文字内容匹配条件；规则需由实际 first-party action 和用户场景支撑，不引入插件可执行 matcher。
- **6G-2B:** 明确 Super Panel 的显式 Translation 点击如何与当前预填后 450 ms 自动调度相容；分别验收 Super Panel handoff 和通用 Manager handoff。任何改变旧 prefill-only 约定的行为先审核。
- **6G-3:** 选择真实内置 Translation 的同面板结果适配路径；保留 6G-0 的显式点击，不在捕获或匹配时自动请求。
- **6G-4:** 是否需要自动翻译预览、词典/释义数据源及其设置、隐私、成本、取消和空/错结果行为。
- **Legacy migration:** 只有真实 Translation 路线通过 parity 和用户验收后，再决定迁移范围、回滚与旧入口移除。

---

## Source Inventory

### WebTools
- docs/phase6f4-manager-platform-architecture.md
- docs/phase6f4b-plugin-center-development.md
- docs/phase6f4c-platform-settings-development.md
- docs/plugin-runtime.md
- docs/plugin-development.md
- docs/super-panel.md
- src/shared/plugin-contracts.ts
- electron/plugins/plugin-store.ts
- electron/plugins/declarative-runtime.ts
- electron/plugins/plugin-manager.ts
- electron/plugins/plugin-catalog.ts
- electron/plugins/plugin-registry.ts
- electron/plugins/web-feature-authority.ts
- electron/plugins/web-host-capabilities.ts
- electron/plugins/web-plugin-runtime.ts
- electron/plugins/plugin-window-manager.ts
- electron/plugins/node-command-execution.ts
- electron/plugins/plugin-runtime-session.ts
- src/features/plugins/PluginManagerView.vue
- src/features/plugins/DeclarativePluginView.vue
- src/features/translate/TranslateView.vue
- electron/services/translation-service.ts
- electron/services/shared-ai-service.ts
- plugin-sdk/declarative-v1/package.json
- plugin-sdk/declarative-v1/runtime/manifest-v1.mjs
- plugin-sdk/declarative-v1/runtime-v3/manifest-v3.mjs
- plugin-sdk/declarative-v1/web/index.d.ts
- plugin-sdk/declarative-v1/node.d.mts
- plugin-sdk/create-webtools-plugin/README.md
- examples/plugins/private-notes/README.md

### uTools reference
- D:/SystemDefault/Desktop/rea/uTools-7.8.0-analysis/analysis/plugin_platform_comparison.md
- D:/SystemDefault/Desktop/rea/uTools-7.8.0-analysis/analysis/features/plugin_platform.md
- D:/SystemDefault/Desktop/rea/uTools-7.8.0-analysis/analysis/evidence_index.md
- D:/SystemDefault/Desktop/rea/uTools-7.8.0-analysis/evidence/app_asar_feature_excerpts.json

---

**Original snapshot status:** Phase 6G and its product implementation had not started when this roadmap was first written. See §U for the current 6G status and planning sequence.

**TESTING NOT RUN — PLANNING TASK ONLY**

**PACKAGING NOT RUN — USER HAS NOT AUTHORIZED PACKAGING**

## U. Current Selected-Text Super Panel Track — 2026-10-16

**Status (2026-10-17):** 6G-1 and 6G-2 COMPLETE / USER CONFIRMED PASS. Revised 6G-3 same-panel automatic translation preview is in implementation/verification under the user's subsequent authorization; evidence and remaining manual acceptance are in the [6G-3 report](phase6g3-super-panel-translation-preview.md). 6G-4 remains NOT STARTED.

This section is the current authority for the forward Phase 6G selected-text roadmap. It supersedes the prospective 6G-1/6G-2/6G-3 assignments in the original §§L–N, which were written before the Quick Result Foundation was implemented. Those sections remain as historical planning context; do not use them to infer that Translation Plugin 2.0 or Legacy migration has started.

### U.1 Verified Current Boundary

- [已由代码/官方资料证实（静态）] No-rule Features retain context type/source matching without language filtering. The 6G-2 working tree adds the approved selected-text-only `textMatch: 'http-url'` URL-shape predicate in NativeHost, metadata-only projection and activation revalidation. It does not add arbitrary keywords, regex, a language classifier or full IDNA/DNS validation. Verification status is recorded separately in the 6G-2 report.
- [已由代码/官方资料证实（静态）] WebTools already displays a bounded preview of the captured source text. This is not a translation, dictionary definition, or Quick Result.
- [已由代码/官方资料证实（静态）] Phase 6G-1 added an explicit-click, bounded plain-text result path for selected-text Node Commands. The WPF result surface and action list are separate and can coexist in the current layout.
- [已由代码/官方资料证实（静态）] The built-in Translation action is routed to the existing Manager prefill path, not to the generic same-panel Quick Result path. Current TranslateView source schedules a request 450 ms after eligible prefill when its settings/provider prerequisites are met.
- [自动化/隔离证据边界] 6G-2 的打包证据使用控制 seam 注入的合成选区；它本身不证明物理选区和真实鼠标交互，实际系统浏览器效果也由 stub 替代。用户另行确认了本阶段功能验收与搜索引擎切换无问题，见下一条。详见专项报告。
- [用户确认 PASS] 用户确认 Phase 6G-2 功能验收无问题，并确认在 Settings 切换搜索引擎正常。该确认关闭本阶段人工功能验收；没有逐项机器记录、构建身份或 DPI 实测值，不将其描述为独立验证。
- [仅由截图观察] The uTools screenshot shows an action list and a definition-like preview together. It does not identify the preview's provider, trigger, or timing.
- [已由代码/官方资料证实（静态）] The supplied uTools app.asar excerpts distinguish fixed panelMenus, text-matched searchResult, and a separate translateResult. They show different plugin and local/native action routes; they do not establish runtime timing or a universal separate-window behavior.
- [已由代码/官方资料证实（静态）] The corrected IDA target was `D:\SystemDefault\Desktop\rea\uTools-7.8.0.exe`; searches for `voicePanelTriggerEvent|stopVoicePanelTriggerEvent|translate` returned zero. It does not establish renderer translation behavior. The decisive translation-path evidence is the hash-matched `app.asar` static JavaScript, not PE string evidence.
- [已由代码证实（静态）] Current discovery runs in NativeHost against its in-memory `SelectionContext` and the validated feature projection. The projection/cache contains Feature metadata and accepted-context descriptors, not the selected-text payload. Future content matching must keep the selected value local to NativeHost for discovery; only bounded, validated matching-rule metadata may be projected. Sending selected text to Electron/Main is reserved for a user-activated operation through its existing authorized invocation path, not for deciding which actions to list. Matching, projection/cache, and diagnostic tests must prove the text is not sent, persisted, or logged for discovery.

See the Phase 6G-1 plan addendum for the detailed source map, evidence labels, and limitations. Generic Features retain the Phase 6G-0 explicit-action contract. The separately approved 6G-3 built-in translation preview is an opt-in exception after panel triggering and successful eligible capture; matching alone still never discloses selection data.

### U.2 Dependency-Ordered Plan

| Order | Work package | User-visible goal and current seam | Planned scope / acceptance | Classification |
|---|---|---|---|---|
| 1 | 6G-1 real UI closeout — COMPLETE | Implemented same-panel result and action-list behavior accepted by the user. | Preserve 18/18 historical packaged evidence and USER CONFIRMED PASS; no remaining 6G-1 manual gate. This does not establish real translation or dictionary results. | Basic foundation |
| 2A | 6G-2 selected-text discovery and built-in actions — COMPLETE / USER CONFIRMED PASS | Ordinary text keeps applicable generic actions and receives Host Search; a complete HTTP(S) URL shape additionally receives Host Open Link. | The user confirmed Phase 6G-2 functional acceptance and search-engine switching. The user confirmation is not an independent per-case machine record. The approved `http-url` metadata remains local to NativeHost; search and link are Host-owned explicit-click actions. | Basic matching and product delivery |
| 2B | 6G-2 real action handoff — COMPLETE / USER CONFIRMED PASS | Clicking built-in Translation sends exact selected text to the existing Manager route; eligible plugin Window receives context through existing router/runtime/SDK path. | Automated and isolated packaged details remain in the 6G-2 report; the user has confirmed the phase's functionality. This does not change the separate route for same-panel Translation. | Basic operation integration |
| 2C | 6G-2 panel reliability — COMPLETE / USER CONFIRMED PASS | Keep actions usable alongside results and prevent stale/clipped states. | Preserve the recorded automated checks and the user's overall functional acceptance; do not invent separately measured DPI/display evidence. | Basic reliability |
| 3 | 6G-3 real Translation preview — IMPLEMENTATION / VERIFICATION | With the dedicated setting enabled, eligible captured English selection automatically receives a real translation in the same triggered panel; actions remain available. | Reuse existing TranslationService/providers, Host authority and authenticated result channel. Default OFF; local eligibility, existing provider limits, cancellation/stale-result guards; no request on selection alone. Local-stub runtime and manual acceptance are recorded separately; the Manager Translation action remains available. | Basic selected-text product capability |
| 4 | 6G-4 differentiated text intelligence — NOT STARTED | Consider dictionary/definition preview or adaptive action ranking after 6G-3 acceptance. | Separate real-source/provider and product decisions are required. Automatic translation preview belongs to 6G-3; no duplicate work or open-ended intelligence framework. | Deferred differentiated capability |

For every work package, automated checks cover deterministic contracts and state transitions; packaged/manual checks cover actual capture, mouse interaction, focus/window changes and visual layout that automation cannot prove. Detailed candidate file scopes and scenario matrices are in the Phase 6G-1 plan addendum. Candidate files are not authorization to edit them.

### U.3 Product Decisions and Guardrails

1. **Explicit activation:** Keep the Phase 6G-0 rule for generic Feature actions. The panel lists applicable actions after capture and invokes them when the user chooses one. The narrowly scoped, separately enabled built-in translation preview is the exception defined in item 2; it does not automatically invoke other Features.
2. **Automatic translation preview:** The user approved the revised 6G-3 plan and authorized implementation. It requires existing panel triggering, successful eligible capture and the dedicated enabled setting; default OFF with remote-service/cost notice. It uses existing configured TranslationService providers. This is not automatic panel activation on text selection, a generic plugin invocation or uTools runtime-parity certification.
3. **Text-content matching and data boundary:** The user approved one bounded declarative `http-url` rule in 6G-2A. Matching runs locally in NativeHost; only validated rule metadata is projected. The selected-text value is transient discovery input and must not be sent to Electron/Main, persisted, or logged for matching. A later explicit action may send the context only through its existing authorized invocation route. Do not introduce plugin-executable matching or an open-ended matcher engine.
4. **Dictionary / definition preview:** Defer as differentiated work. The screenshot alone does not justify a provider, automatic trigger, or product contract.
5. **Translation surfaces:** The Manager handoff and new same-panel preview are distinct. The existing TranslateView schedules translation after eligible prefill; 6G-3 reuses its underlying TranslationService without opening that page for an automatic preview. Other operations still require explicit activation. Manager prefill behavior is not rewritten by 6G-3.
6. **Evidence:** Preserve the 6G-1 report's historical counts and artifact identity. Its latest manual result is **USER CONFIRMED PASS**, recorded from the user's confirmation without per-case machine records. Do not reopen it or relabel it automated. That acceptance covers the foundation, not real translation, dictionary, new 6G-2 actions, or full uTools parity.

**Current work:** Phase 6G-3 implementation/verification is tracked in its [report](phase6g3-super-panel-translation-preview.md). Preserve prior 6G-1/6G-2 evidence and user acceptance; do not reopen those gates or imply 6G-4 has started.
