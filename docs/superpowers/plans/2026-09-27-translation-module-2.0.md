# WebTools Translation Module 2.0 Implementation Plan

> 阶段：代码审核、官方 Provider 研究与实现计划。当前阶段不改产品代码、不改依赖、不迁移数据、不提交、不推送、不创建 PR。
> 基线：2026-09-27；实现时仍须重新 fetch，并以当时的 origin/main 和工作树为准。
> 研究记录：[Translation Provider 官方资料汇总](../research/2026-09-27-translation-provider-research.md)

## 1. Executive Summary

建议继续在现有 Manager 的“翻译”页面完成 Translation 2.0，不在本轮创建独立 BrowserWindow。保留 Launcher 的翻译 Action 与当前精确文本 handoff，先把 Provider、设置、翻译界面、取消/过期请求处理和安全边界做稳。

首版建议支持：

- AI：OpenAI、Anthropic Claude、Gemini、DeepSeek、Qwen-MT，以及 Custom / OpenAI-Compatible。
- 传统机器翻译：Google Cloud Translation Basic v2。
- 浏览器入口：继续保留“在 Google Translate 中打开”，并在 UI 文案上与 Google Cloud Translation API 明确区分。

AI Provider 的接口差异由 Main process 中少量 adapter 处理。OpenAI、Gemini、DeepSeek 和 Custom 使用 OpenAI-compatible Chat Completions adapter；Claude 使用 Messages adapter；Qwen 使用官方 Qwen-MT 专用参数；Google Cloud 使用独立的 Basic v2 adapter。无需引入官方 SDK 或其他 production dependency。

没有 API key/credential 的用户不能使用官方 Google Cloud Translation API。没有已配置 Provider 时，翻译页应保留输入能力、解释如何配置，并允许用户显式打开 Google Translate 网站。不要静默选择其他服务、自动上传文字或调用未公开的 Google Translate 网页接口。

## 2. Repository / Git Baseline

已检查项目结构、当前翻译代码与 Git 基线。此前 fetch 后，Launcher Behavior Contract 与 Everything 中文/路径修复都已进入 origin/main；当前工作位于 codex 工作分支，没有需要迁移的 Translation 变更。工作树当时没有 tracked 文件修改，但存在先前未跟踪的计划文档和 output Logo 目录；这些文件与本任务无关，实施时应保留且不得带入本任务。

本计划创建时未修改产品代码。实现任务开始前仍须重新运行 git status、git branch -vv、git remote -v、git log 并 fetch origin，确认 origin/main、当前分支和未跟踪文件状态；若基线不同，暂停并据新基线复核。

## 3. Current Translation Architecture

| Area | Current implementation |
|---|---|
| Launcher entry | LauncherView 将普通英文单词/短语添加为 discriminated translation action。Enter/click 调用 window.desktop.openTranslation(text)。使用搜索原文，不自动开始翻译。 |
| Handoff | Main 只接受当前 launcher WebContents 发起、非空且不超过 20,000 字符的文本；创建 request ID，放入只保留最新请求的 TranslationPrefillQueue，显示 Manager，并在 Manager renderer ready 后投递。 |
| Manager readiness | App.vue 先注册 onTranslationPrefill，再 managerReady。收到 prefill 后切换到 translate；nextTick 后发 matching acknowledgement。Renderer 重载时 Main reset readiness，未确认的 request 会重新投递。 |
| Translation UI | TranslateView 是 Manager 内按路由条件挂载的页面，不是独立窗口。当前含原文/译文、自动识别源语言、8 个目标语言、复制、AI 翻译、Google Translate 网页跳转和设置入口。没有来源语言选择、交换、清空、取消或 Ctrl+Enter。 |
| AI provider | electron/services/ai-translation.ts 只有一个通用 OpenAI-compatible Chat Completions 实现。endpoint 从 aiBaseUrl 推导，模型来自 aiModel；Main 使用 fetch、Bearer key、非流式请求、45 秒 timeout 和手动禁止 redirect。 |
| Google | google-translate.ts 只构造 translate.google.com 的外部跳转 URL；当前不是 Cloud Translation API，也不是内置翻译结果 Provider。 |
| Request location | 第三方 AI fetch 在 Electron Main 执行。Renderer 只通过 preload 暴露的 translateWithAi 发送文字和 targetLanguage，再接收翻译结果。 |
| Key storage | Electron Main 的 SecretStore 使用 Electron 44 safeStorage 异步加密，写入单独的 userData/secrets.json；不是写入 DataStore。当前仅有 ai-api-key。Renderer 可通过单独 IPC 发送待保存 key，但不会读取已保存 key；保存后 UI 清空输入框。 |
| Settings | SettingsView 中 AI 设置只有 Base URL、model、password input、连接测试、移除 key。测试连接前先分别保存 DataStore 设置和 key，因此可能发生部分保存。 |
| DataStore | AppData.version 为 2。Settings 包含 aiBaseUrl/aiModel；DataStore 的 v2 validator 要求它们是字符串，normalizeV2 当前只补 theme 与 launcherDisplayMode。当前支持 v1 到 v2 迁移。 |
| IPC | preload 通过 contextBridge 暴露窄 DesktopApi，BrowserWindow 启用 contextIsolation、nodeIntegration:false、sandbox:true。translation-handlers 中 key/translate/test/open-google handler 忽略 IpcMainEvent，没有像 Launcher handoff 那样验证当前 Manager sender。 |
| State / stale request | TranslateView 的 contentGeneration 只在收到新 Launcher prefill 时递增。用户在请求中编辑 source 或切换 target，旧 Promise 仍可能写回旧译文；没有 AbortController IPC 或 unmount cancel。 |
| Manager lifecycle | Manager 在 close 时 destroy BrowserWindow/renderer，以回收常驻内存。prefill 在 matching acknowledgement 后清除；已确认并进入 TranslateView 的 source/result 不会跨 Manager 销毁保存。 |
| Tests | 项目已有少量 Node built-in test 的 .test.mjs 文件，没有 npm test script，也没有 Vue component 测试依赖。可以沿用 node:test、mock fetch 与 fake response。 |

### Launcher → Translation 当前流程

Launcher input
→ Translation action
→ window:open-translation IPC
→ Main 验证 Launcher sender 与文本长度
→ request queue / showManager
→ Manager renderer 监听器 ready
→ App.vue 路由到 translate
→ TranslateView 精确预填并清理旧结果
→ App.vue 对 request ID acknowledgement
→ 用户手动点击 AI 翻译
→ Renderer IPC → Main service → selected Provider → result IPC

当前 handoff 不会自动请求第三方服务。Manager 销毁会丢弃翻译页内存状态；这是现有生命周期行为，本轮建议保持，不新增历史记录或持久化原文。

## 4. Current Problems and Risks

1. Provider 范围只有一个兼容 Chat Completions 服务；Claude Messages、Qwen-MT、Google Cloud API 的请求/响应格式未覆盖。
2. 常见 Provider 要用户自己找 Base URL；endpoint 配置、模型、测试逻辑耦合在 Settings 和 AI service。
3. “AI 翻译”及页面说明写死 OpenAI/DeepSeek，无法表达当前 Provider、传统机器翻译或未配置状态。
4. Google Translate 网页跳转与正式 Google Cloud API 容易被用户误认为同一项；Cloud API 的项目、启用 API、账单和 key 前置要求没有解释。
5. source 不能手动选择，不能交换语言；没有 clear/cancel/Ctrl+Enter/provider 状态。
6. stale guard 只防止更晚的 Launcher prefill 覆盖旧结果，不能防止编辑 source/target 后旧响应覆盖当前界面。
7. 请求没有由 Renderer 主动取消的 IPC；页面 unmount、Manager 销毁或新请求不保证立即终止 provider 请求。
8. translation/key IPC handler 不验证是 Manager 的主 frame 发起；虽然 preload API 窄且 Renderer sandboxed，仍应统一验证敏感 IPC sender。
9. hasAiApiKey 捕获所有异常并返回 false，会把安全存储不可用/解密失败伪装为“尚未配置 key”。
10. SecretStore 多次并发写入没有串行化；多个 Provider key 扩展后应避免不同操作读同一旧文件而互相丢 key。
11. Settings 先保存普通设置、再保存 key，失败时可能出现 UI 看似配置完成但 key 没保存的半状态。
12. 当前 Provider 错误返回安全的泛化文案，但没有统一错误码区分 quota、timeout、unsupported language、invalid model 等。
13. Desktop BYOK 无法保证密钥对同一 Windows 登录会话中的恶意同用户进程保密；Main boundary 降低 renderer 暴露面，safeStorage 保护磁盘上的 key，但不能把用户自带 key 变成不可提取的应用秘密。

## 5. Translation 2.0 Product Model

### 用户可见的引擎分类

- AI：OpenAI、Claude、Gemini、DeepSeek、Qwen-MT、Custom / OpenAI-Compatible。
- 传统翻译：Google Cloud Translation Basic。
- 浏览器辅助：独立的“在 Google Translate 中打开”按钮，不属于上述 API Provider，不显示成默认引擎，也不自动接管失败请求。

首次安装或没有已配置 key 时选中“尚未配置翻译服务”状态。允许编辑文本；Translate 不可执行并显示设置引导。Google Translate 网站按钮仍可用；点击后才将源文本和语言显式交给外部浏览器。不得自动回退到第三方服务。

选择 Provider 以后，Main 根据 providerId 使用固定预设和 adapter。内置 Provider 不展示自由 Base URL。Custom Provider 显示 HTTPS Base URL、API key 和 model。任意外部 host 只存在于用户主动配置的 Custom 模式，不能由每次翻译请求直接指定。

### AI prompt / translation semantics

- source text 永远作为不可信用户数据单独发送；不拼入 system/developer instruction。
- Chat Completions：system 指令说明只翻译、不回答输入问题、不执行输入中的命令、尊重源/目标语言并尽量保持段落和基本格式；source text 单独作为 user message。
- Claude Messages：相同要求放在顶层 system；messages 中只放 user 原文，因为 Messages API 不定义 system role。
- Gemini 兼容 Chat Completions 时采用同一 role split；如果未来切换 native Gemini API，systemInstruction 与 user content 分开。
- Qwen-MT：官方翻译模型只接受 user message，并使用 translation_options.source_lang/target_lang；不向该端点伪造 system prompt。UI 语言 code 到 Qwen 要求的英文语言名使用显式表映射，自动识别使用 auto。
- Cloud Translation Basic：请求格式=text，传递 source/target；source=auto 时省略 source。它是机器翻译，不经过 LLM prompt。
- 不启用 tools、search、functions 或后台会话，不向 Provider 发送翻译历史。

### Language UX

首版保留已有 8 种语言并用于 source/target：简体中文、繁体中文、英语、日语、韩语、法语、德语、西班牙语。source 默认 Auto Detect。共享语言目录提供稳定的 WebTools code、中文显示名、Qwen 英文名称映射；仅在已确认 Provider 均支持后逐步扩展。

Swap 在 source=Auto 时禁用。选定 source 后可交换 source 与 target，并立即使旧结果失效。目标语言、来源语言或 source 文本改变都使当前请求失效。

### Model UX

每个 Provider 定义一个集中维护的推荐 default model；用户可编辑 model ID，以便新模型不必等 WebTools 发版。Qwen-MT 公开支持模型是有限集合，可以显示小型官方选项并允许自定义输入。不要在 Renderer 或 DataStore 填入大量短期模型列表，也不要依赖运行时模型目录服务。

连接测试要明确提示可能消耗 Provider 用量。输入 key 仅在用户显式保存/测试时发送到 Main；测试响应不记录源文本或 key。

## 6. Provider Research

所有 endpoint、authentication 与格式以官方文档为准。端点和型号会变化；实际 implementation 开始时须再次核验官方文档，不把下面示例视为永久不变常量。

| Provider | 官方接口/认证 | 兼容性与格式 | 建议 |
|---|---|---|---|
| OpenAI | Chat Completions: https://api.openai.com/v1/chat/completions；Bearer API key | model/messages；非流式读取 choices[0].message.content。OpenAI 也有 Responses API；首版可继续使用项目已有的 Chat Completions shape，减少额外协议面。 | 内置；默认模型集中维护、允许编辑。 |
| Anthropic Claude | Messages API: https://api.anthropic.com/v1/messages；Authorization Bearer key 或 x-api-key，需 anthropic-version | 独立 Messages schema；system 是顶层字段，messages 只包含 user/assistant；响应 content 是 block 数组，不能按 Chat Completions 解析。 | 内置独立 adapter。 |
| Google Gemini Developer API | native GenerateContent: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent，x-goog-api-key；官方另提供 OpenAI-compatible base URL https://generativelanguage.googleapis.com/v1beta/openai/ | 兼容入口可归入 Chat Completions adapter，但需单独解析 Gemini error 与验证可用功能；不启用其余 Gemini 工具。 | 内置 OpenAI-compatible preset，避免多一个 native adapter。 |
| DeepSeek | OpenAI-compatible base URL https://api.deepseek.com，Chat Completions；Bearer key | model/messages 可共用 Chat adapter；有 thinking/reasoning 扩展，首版禁用推理模式，并只读取最终 message.content，不回显 reasoning_content。 | 内置 preset；由 preset 固定 endpoint，不暴露 Base URL。 |
| Qwen-MT / DashScope | 按官方 region/workspace endpoint；OpenAI-compatible chat/completions；Bearer DASHSCOPE_API_KEY | 专用 qwen-mt-* model；必须传 translation_options；仅 user message；region key、model list 和 workspace endpoint 有关联。 | 内置为 AI translation Provider；Settings 有 region 与必要的 Workspace ID 字段，不展示 URL。 |
| Google Cloud Translation Basic v2 | POST https://translation.googleapis.com/language/translate/v2；x-goog-api-key header；q/target/optional source | 简单 REST；省略 source 可检测语言；v2 API key 绑定 project 的 quota/billing。 | 内置 Traditional Provider。 |
| Google Cloud Translation Advanced v3 | v3 projects/locations:translateText；OAuth/ADC/service account/IAM；API key 不支持 | 需要 project/location 和 IAM 配置；高级模型、glossary/customization 功能不属于简单桌面文本翻译首发范围。 | 首版不做；不在客户端打包 service-account 私钥。 |
| Moonshot / Kimi | 官方 OpenAI-compatible base URL https://api.moonshot.cn/v1；Bearer key | Chat-like，但模型列表、区域/账号与额外参数由服务商管理。 | 暂缓；Custom 可连接兼容模式，后续确认用户需求与 endpoint 维护策略。 |
| Zhipu / GLM | 中国大陆 OpenAPI host 与国际 Z.AI host 分开；Bearer key | OpenAI Chat-compatible，地区与 host/key 组合需要 UI 与维护策略。 | 暂缓；Custom 可连接兼容 endpoint。 |
| MiniMax | 中国区与国际区 endpoint 不同；Bearer key，Chat Completions-compatible | 模型可能返回 reasoning/thinking 内容；只显示最终 content 的策略需逐模型验证。 | 暂缓；Custom 可接入。 |
| OpenRouter | https://openrouter.ai/api/v1/chat/completions；Bearer OpenRouter key | OpenAI-compatible，但 model 为 provider/model slug，且请求会经聚合器路由到上游。 | 暂缓；需单独告知数据会经 OpenRouter/上游传递并审查 model routing。 |

当前候选优先级为用户明确提出的 OpenAI、Claude、Gemini、DeepSeek、Qwen + Custom，再加 Google Cloud Basic。Kimi、GLM、MiniMax 虽然可以复用 Chat adapter，但首发同时增加官方端点/账户/地区/模型测试矩阵；OpenRouter 还改变文本数据的接收方，先不放进默认 Provider 列表。

### Qwen Region / Workspace 说明

Qwen-MT 的官方兼容接口示例使用 workspace-specific region base URL；URL 不能由用户任意输入。Settings 只显示 Region（例如 China Beijing、Singapore、Virginia）和 Workspace ID，并由 registry 拼装/选择被支持的 HTTPS host。API key 必须和 region/account 相匹配。若首版选择的官方 endpoint 要求 workspace ID，就应明确必填并提供“在哪里找到”说明；不能承诺 Qwen 只需 API Key。不要静默用一个地区 endpoint 接收其他地区的 key。

## 7. Recommended Built-in Providers and Preset Architecture

### 首发 Provider 清单

1. OpenAI — OpenAI Chat Completions adapter。
2. Anthropic Claude — Messages adapter。
3. Gemini — 官方 OpenAI-compatible adapter。
4. DeepSeek — OpenAI-compatible preset，不发送 thinking/reasoning 开关。
5. Qwen-MT — 官方专用翻译接口，带 region/workspace 配置与 language mapping。
6. Google Cloud Translation Basic v2 — Traditional provider，API key + 已启用的 Cloud project + billing。
7. Custom / OpenAI-Compatible — 保留现有能力，支持用户自定义 HTTPS base URL、model、API key。

不在首发增加 Moonshot、GLM、MiniMax、OpenRouter 内置配置；它们可从 Custom 模式试用，其中 OpenRouter 的跨上游处理需单独说明。

### Main-owned preset registry

新增一个小型 Main service 定义 Provider presets，不做完整 plugin registry 或 Applications Framework。每个 preset 至少包含：

- stable Provider ID、display name、engine kind（AI/Traditional/custom）、adapter style；
- 固定官方 endpoint 或 region → endpoint resolver、documentation URL；
- authentication header 规则；
- 一项推荐默认 model / 可选官方小列表；
- 支持/映射的 source/target language 规则；
- Provider-specific request builder / response parser；
- safe error mapping，不传原始错误 body；
- 是否允许用户编辑 model、是否有区域/Workspace ID。

Renderer 只收到安全的 Provider 定义视图（ID/name/default model/所需字段/配置状态），不接收任何 API key、内部错误堆栈。Built-in endpoint 以 Main registry 为唯一来源，不在 TranslateView、SettingsView 和 IPC 各写一份。

建议接口边界：

~~~ts
type TranslationRequest = {
  requestId: string
  text: string
  sourceLanguage: 'auto' | string
  targetLanguage: string
}

type TranslationResult = {
  text: string
  detectedSourceLanguage?: string
}

interface TranslationProviderAdapter {
  translate(
    request: TranslationRequest,
    configuration: ResolvedProviderConfiguration,
    credential: string,
    signal: AbortSignal,
  ): Promise<TranslationResult>
}
~~~

上述为实现边界示例，不要求机械复制类型名；request 不能含任意每请求 endpoint，providerId 从已验证设置读取，key 由 Main SecretStore 读取。

## 8. Custom Provider

- 仅 Custom / OpenAI-Compatible 展示 Base URL、API key、model。
- 保留当前规则：HTTPS；仅允许本机 loopback 使用 HTTP；禁止 URL 中 user/password/query/fragment；请求手动禁止 redirect。
- Main 对所有设置输入执行 schema validation；Renderer 不可用每次 request 覆盖保存的 URL。
- 连接测试说明会发出真实请求并可能收费；不在日志记录 URL 中的凭据、key、source text。
- Legacy aiBaseUrl/aiModel/ai-api-key 必须以 Custom provider 语义兼容，不能丢 key，也不能擅自把未知旧 URL 归类成 OpenAI 或 DeepSeek。
- Custom endpoint 可用于 localhost/self-hosted API。界面明确这是用户主动设置；不因内置 Provider 引入任意 endpoint。

## 9. Google Cloud Translation Strategy

首版选择 Basic v2，而不是 Advanced v3：目标是单段文本、自动检测 source、单一 target，Basic 能用受支持的 API key 直接请求，配置面小；v3 的 IAM/service account/project/location 对当前桌面工具过重。

Google 官方资料确认：

- Basic v2 translate/detect 支持 API keys；Advanced v3 不支持 API keys。
- 两种 Cloud Translation 都需要 Cloud project、开启 Translation API 与有效 credentials；Google Cloud 文档要求启用 billing。
- v2 endpoint 是 https://translation.googleapis.com/language/translate/v2，key 通过 x-goog-api-key header 传递；不要放 key query string，因为 Google 明确警告 URL 参数更容易被 URL scanning 泄露。
- v2 输入是 q、target，可选 source；source 未给时 API 会自动检测。
- 使用量按字符计费；UI 应告知用户由其 Google Cloud project 承担计费，费率/免费额度等信息不硬编码为永久承诺。

Advanced v3 暂缓到用户明确需要 glossary、自定义翻译模型或组织 IAM 时再评估。绝不把 WebTools 开发者的 Google key 或 service-account 私钥打包到桌面应用。

## 10. Zero-Configuration Translation Analysis

结论：NOT POSSIBLE WITH OFFICIAL GOOGLE CLOUD TRANSLATION。

Basic v2 虽接受 API key，但该 key 将请求关联到用户自己的 Cloud project，用于 quota/billing；Google Cloud 要求 API 已启用且项目启用 billing。因此它不能作为无 key、无凭证的默认 API Provider。Advanced v3 还要求身份认证/IAM，不能通过 API key 简化。

本次官方资料审核没有发现适合生产桌面应用、官方/公开支持、稳定合法、无需自有凭证且不需 WebTools 开发者 secret 的免费零配置 Provider。WebTools 不应把反向工程网页接口伪装成可靠默认能力，也不应把共享开发者 key 发给所有安装用户。

无 key UX：

1. 初次打开翻译页时显示“选择并配置翻译服务”状态及设置入口。
2. 文本可输入/粘贴，但 AI/Cloud Translate disabled，清楚说明启用服务要用户自备 key。
3. “在 Google Translate 中打开”仍可单独使用；用户点击以后才使用外部网站，不自动请求、不声称这是 Google Cloud API。
4. Provider 请求失败不自动回退、不重复发送到第二个 Provider。只展示统一错误和显式网页 fallback 按钮。

## 11. Google Translate Website Strategy

保留当前 External browser link，改为清晰 label“在 Google Translate 网页中打开”。当前 URL builder 对文字使用 URLSearchParams 编码；拓展 source selector 后传 source language（Auto 对应 auto），target 保持目标语言码，仍用 URL API 构造。

此项与 Google Cloud Translation Basic Provider 分开设置、分开计费说明。点击网页跳转会向 Google Translate 网站发送原文，因此在 UI 中应让用户知道这是外部网站；不得自动打开或拿它作为 silent fallback。

## 12. Translation UI Optimization

### Settings → Translation

- Engine 分区：AI / Traditional；Provider 选择单选/下拉，包含 Not configured。
- Built-in AI 展示 API Key、推荐/可编辑 Model；不显示 Base URL。
- Custom 展示 Base URL、API Key、Model。
- Qwen 显示 Region、按 region 要求的 Workspace ID、API Key、Model；helper 文案明确 API Key 与 region 匹配。
- Google Cloud Basic 显示 API Key、Google Cloud 项目/API/billing 配置说明、计费告知。
- Key 用 password input 与“已安全保存”状态；保存后清空，不回显原值；可替换、移除。
- 主按钮“保存 Provider”；“测试连接”旁明确可能产生 API 用量；保存失败、key 存储不可用与“未配置”须可区分。
- 保留现有 Quick Search、主题、Everything 等设置，不重构整页导航。

### Translation 页面

- Source Language：Auto Detect + WebTools 支持语言。
- Target Language：已有语言列表；默认保留 zh-CN。
- Swap：仅当 source 非 Auto 时可用。
- 输入：textarea + 20,000 字符限制；Clear；计数。
- 输出：translated text + Copy；Loading/Error/No provider 状态；提供显式 Cancel。
- Provider indicator：展示当前 Provider 与 model；传统 Google 显示“Google Cloud Translation Basic”。
- 按钮使用中性“翻译”，而不是所有 Provider 都标成 AI 翻译。
- “在 Google Translate 网页中打开”作为独立次级按钮。
- Ctrl+Enter 在输入框聚焦且可执行时提交；Ctrl+A/C 保持浏览器默认编辑语义；不注册全局快捷键。
- 从 Launcher handoff 的 prefill 精确填入原文；建议焦点置于 source textarea、光标在文本末尾，不自动发送请求。

## 13. Keyboard, Handoff, Concurrency and Timeout

- Ctrl+Enter 只处理 TranslateView 的 source textarea 事件；不要拦截 Ctrl+A/C。
- 开始新请求前取消同组件旧 request。
- 给每个请求创建 requestId + Renderer generation；Main registry 以 requestId 保存 AbortController，并绑定 Manager WebContents。
- source 文本、source/target language、provider 配置变化、clear、新 prefill、TranslateView unmount 时立即 invalidate generation 并发 cancel IPC；任何旧 response 只有当 requestId 与当前 generation 均匹配时才能改变 UI。
- Main 的 cancel handler 只能由登记该 request 的当前 Manager sender 取消；未知 ID 无副作用。
- 每个 Provider 请求使用有界 timeout；用户取消或 Manager destroyed 时 abort fetch 并清除 request registry。
- 确保 Provider 服务在 AbortSignal aborted 时抛统一 CANCELLED，不把它展示为网络失败。
- loading 只属于当前 requestId；旧请求 finally 不得清掉新 request 的 loading。
- targetLanguage 和 providerId 在 request 开始时快照并传给 Main，服务不会在 await 后静默读取新的 UI 值。

## 14. Error Model

新增共享、稳定错误类别，至少包括：

- NOT_CONFIGURED / MISSING_CREDENTIAL / SECURE_STORAGE_UNAVAILABLE
- INVALID_KEY / INVALID_MODEL / INVALID_CONFIGURATION
- RATE_LIMITED / QUOTA_EXCEEDED
- UNSUPPORTED_LANGUAGE / INVALID_REQUEST
- NETWORK_ERROR / TIMEOUT / PROVIDER_UNAVAILABLE
- CANCELLED / UNKNOWN_PROVIDER_ERROR

每个 adapter 将 HTTP status 和有限的 provider error.code/type 映射到安全的本地化文案；不把 provider 原始 response body、API key 或原文放入 Renderer error。开发日志只允许记录 provider ID、状态码、request ID 和 error category；不得记录 key、完整 source text、完整 request body。测试连接和正常翻译走同一 adapter parser，但测试使用非敏感固定短文本。

## 15. Data / Credential Compatibility Strategy

本轮不实际迁移 schema。后续实现优先用 AppData.version 2 的 additive normalization，而不增加版本号或重写现有 WebsiteEntry 数据：

- 新增 typed translation settings 可选字段；旧 v2 缺字段时由 normalizeV2 补安全默认值。
- 现有 aiBaseUrl/aiModel 与 ai-api-key 作为 legacy Custom Provider 数据保留；现有 URL 不丢失，也不猜它属于某个内置厂商。
- 新配置选择 Custom 时能继续读取现有 base/model/key；切换到新的 built-in Provider 不覆盖旧 Custom key。
- SecretStore 延续 userData/secrets.json，safeStorage 异步加密；按受限 Provider ID 存 key，并继续识别 legacy ai-api-key。
- Renderer 获得 has-key/configured/status，不获得已保存 plaintext。
- 未配置 provider 和 legacy 配置不完整都用明确 UI 状态；不要因为 hasSecret 解密失败就显示“未设置”。
- 先为历史默认设置、旧 key、空配置、损坏 secret file 写 deterministic test；执行的是向前兼容 normalize，不做破坏性或批量 key 迁移。

## 16. Recommended Implementation Tasks

每个 Task 完成后至少运行 npm run typecheck。测试使用 Node 内置 test + fake fetch/fake response，沿用现有 .test.mjs 习惯，不增加 testing dependency。基础接口完成后逐层推进；高耦合 Main/Renderer handoff 不拆给互不知情的实现者。

### Task 1 — Shared Translation contracts and additive settings defaults

**Goal**：为 AI/Traditional/custom 与 source/target 请求建立窄、可校验、兼容旧 v2 的类型。

**Files**：

- 修改 src/shared/domain.ts
- 修改 src/shared/ipc.ts
- 修改 electron/services/data-store.ts
- 修改 electron/ipc/settings-handlers.ts
- 新增 src/shared/translation-languages.ts（仅共享语言标识和显示/Provider 映射；如实现中证实没有跨层共享需求，可留在 Main registry）
- 新增 electron/services/translation-settings.test.mjs

**Interfaces/contracts**：

- TranslationProviderId 使用 closed union：none/openai/anthropic/gemini/deepseek/qwen-mt/google-cloud-basic/custom-openai-compatible。
- TranslationSettings 存 Provider ID、source/target language、各 Provider model、Qwen region/workspace 与 Custom base URL；不含 secret。
- TranslationRequest 包含 requestId/text/sourceLanguage/targetLanguage；不包含 API key 或 endpoint。
- 稳定 TranslationErrorCode / TranslationResult type。

**Implementation steps**：

1. 在 domain 定义共享 union 与默认状态，不把 Provider registry 放入 AppData。
2. DataStore v2 validator 接受老数据中缺少新增 translation 字段；normalizeV2 补 defaults，version 暂不变。
3. 保留 WebsiteEntry、app data 其他字段及 aiBaseUrl/aiModel 原值。
4. Settings IPC 对嵌套配置按字段、长度、allowed IDs/regions/URL shape 验证；不能直接 spread 任意 renderer payload。
5. 旧 aiBaseUrl/aiModel 保留在 Custom provider，不能猜 vendor。
6. 加测试覆盖新默认值、v2 无 translation 字段、legacy AI 配置和非法 provider/region。

**Dependencies**：无。
**Security**：只新增可公开的选择/配置字段；绝不新增 key 到 AppSettings。
**Verification**：新增 test；npm run typecheck。
**Risks**：AppSettings 是完整 SettingsView 类型；validator/default/IPC update 如果不一起改会在旧数据或设置保存时失败。
**Acceptance**：旧 AppData v2 可读取且数据不丢；新设置拒绝未知 provider；没有 secret 能经 getSettings 返回。

### Task 2 — Provider-scoped SecretStore API and legacy key compatibility

**Goal**：让 Main 能分别保存/删除每个 provider key，同时保留旧 Custom key。

**Files**：

- 修改 electron/services/secret-store.ts
- 新增/修改 electron/services/translation-credentials.ts
- 修改 electron/ipc/translation-handlers.ts
- 修改 src/shared/ipc.ts
- 修改 electron/preload.ts
- 新增 electron/services/translation-credentials.test.mjs

**Interfaces/contracts**：

- getCredentialStatus(providerId) 返回 configured/secureStorageAvailable/error category，不返回 plaintext。
- saveProviderCredential(providerId, plaintext)、removeProviderCredential(providerId) 是独立 IPC。
- Key name 只能从 closed TranslationProviderId 派生；Custom legacy 读取 ai-api-key。

**Implementation steps**：

1. 保留 safeStorage.isAsyncEncryptionAvailable 与 async encrypt/decrypt。
2. SecretStore 对 set/delete 写操作串行化，防止两个 provider 更新丢掉彼此字段。
3. safeStorage 不可用或解密失败返回明确错误，不降级明文写入。
4. handler 分离“未配置”和“凭证读取失败”；不要 catch 后返回 false。
5. 设置页覆盖/移除 provider key 不触碰其他 provider secret 与旧 Custom key。
6. 通过受信任 Manager sender 才能读状态/保存/移除 credential。

**Dependencies**：Task 1。
**Security**：Main 是唯一持有明文 key 的执行层；key 仅通过受控 IPC 一次性交给 Main；request/exception 不记 key。
**Verification**：fake encryption backend 或 test doubles 验证 encryption unavailable、旧 key 映射、多 key 并发写、删除与没有明文；npm run typecheck。
**Risks**：safeStorage 的 Windows DPAPI 加密主要隔离其他 Windows 用户，不能防止同一用户会话中的恶意进程。UI 文案不得承诺本地不可提取。
**Acceptance**：key 文件内容为 safeStorage 密文；Renderer 永远读不到旧值；老 key 能作为 Custom provider 使用。

### Task 3 — Provider preset registry, language mapping and translation prompt rules

**Goal**：集中定义 Provider endpoint、协议、默认 model、region、credential 状态和文档链接。

**Files**：

- 新增 electron/services/translation-provider-registry.ts
- 新增 electron/services/translation-languages.ts（如 Task 1 的 shared map 不适合 Main 则放这里）
- 新增 electron/services/translation-prompts.ts
- 新增 electron/services/translation-provider-registry.test.mjs

**Interfaces/contracts**：

- TranslationProviderDefinition: ID/name/engine/adapter/defaultModel/modelChoices/docsURL/requiredConfig。
- ResolvedProviderConfiguration 由 Main 从 typed settings + registry 派生，Built-in endpoint 不接受 Renderer 传入 URL。
- Qwen region → 官方 endpoint 的明确映射；Qwen language code → provider 要求的英文语言名称。

**Implementation steps**：

1. 每个 preset 只写一次 endpoint、auth style、adapter kind 和 model default。
2. Qwen preset 验证 Region、Workspace ID、key-region matched helper text；本轮只列官方已核验并计划支持的区域。
3. Gemini 使用官方 OpenAI-compatible base；DeepSeek/OpenAI 使用 Chat Completions；Claude 使用 Messages；Google Cloud Basic 使用 v2 endpoint。
4. 定义稳定的 multilingual translation prompt；将 source 原文保持为独立 user content。
5. 对 Qwen-MT 不构造通用 system prompt；只构造 official translation_options。
6. Registry 只暴露给 Settings 的 safe descriptor 不包含 secrets。

**Dependencies**：Task 1。Task 2 可并行，但无需强行并行。
**Security**：Built-in host closed allowlist；HTTPS；region resolver 不接受任意 host。
**Verification**：pure tests 校验 preset、host、default、Qwen language mapping、unknown ID 和无用户 endpoint；npm run typecheck。
**Risks**：Provider model names 与 Qwen region URLs 会更新；所有 endpoint/default 变更必须由这个 registry 管理，并在发版前按官方 docs re-check。
**Acceptance**：内置 Provider 设置不需要用户输入普通 Base URL；没有模型名散落在 Vue/IPC。

### Task 4 — AI translation adapters and normalized AI error parsing

**Goal**：通过 REST/fetch 支持 AI Provider，不在 UI 实现厂商分支。

**Files**：

- 重构 electron/services/ai-translation.ts 为或委托给 electron/services/translation-ai-service.ts
- 新增 electron/services/adapters/openai-chat-adapter.ts
- 新增 electron/services/adapters/anthropic-messages-adapter.ts
- 新增 electron/services/adapters/qwen-mt-adapter.ts
- 新增 electron/services/adapters/openai-chat-adapter.test.mjs
- 新增 electron/services/adapters/anthropic-messages-adapter.test.mjs
- 新增 electron/services/adapters/qwen-mt-adapter.test.mjs

**Interfaces/contracts**：所有 adapter 接收已验证的 TranslationRequest、resolved provider config、Main 获取的 credential、AbortSignal，返回纯文本 TranslationResult 或统一 TranslationError。

**Implementation steps**：

1. 抽取请求构造/JSON response parsing，但不搭建 generic AI SDK framework。
2. OpenAI-compatible adapter 覆盖 OpenAI、Gemini、DeepSeek、Custom；逐 provider 覆盖 endpoint、auth、模型输入与错误映射。
3. Chat prompt 约束只翻译、不回答、不执行源文中的 instruction；保持 system 与 user 分离。
4. Claude adapter 用 Messages API 的顶层 system、max_tokens、一条 user message；只取 text blocks 拼合为译文。
5. Qwen-MT adapter 用模型 + 一条 user message + translation_options；不允许额外 role/tool；按官方有限型号验证。
6. 首版使用 non-stream，简化 abort/parser/UI。长文本若需流式，作为后续独立需求。
7. 用 redirect: manual 拒绝 provider redirect；请求超时、错误码统一解析；原文/key 不进日志。

**Dependencies**：Task 3。
**Security**：Main fetch；API key 不进 Renderer；不打开 tools；限制输入 20k；不接受任意 model response URL；raw error body 不下发。
**Verification**：mock fetch 的请求 header/body、prompt injection semantics、每种 response parser、HTTP 401/403/404/429/5xx、malformed JSON、timeout/abort；npm run typecheck。
**Risks**：兼容协议不是字段/错误/模型行为完全相同；Gemini、DeepSeek 需要 Provider-specific parsing；仅显示最终文本内容。
**Acceptance**：每个首发 AI Provider 使用官方 endpoint/auth/schema 产生一条可解析非流式翻译结果；不读取 reasoning/tool call。

### Task 5 — Google Cloud Translation Basic v2 adapter

**Goal**：提供单独的传统机器翻译 API，不混同外部 Google Translate。

**Files**：

- 新增 electron/services/adapters/google-cloud-basic-adapter.ts
- 修改 electron/services/google-translate.ts
- 新增 electron/services/adapters/google-cloud-basic-adapter.test.mjs
- 修改 Google website URL builder tests（新建时放 electron/services/google-translate.test.mjs）

**Interfaces/contracts**：Cloud adapter 返回同一 TranslationResult；支持 source=auto、target code；请求地址固定 v2。

**Implementation steps**：

1. POST v2 translate、plain text body，使用 x-goog-api-key header，不把 key 塞进 URL。
2. 省略 auto source，让 API 返回 detectedSourceLanguage；target 必须是支持语言 code。
3. 检查响应结构、错误码、HTML/text parsing；超时/取消都走公共 request model。
4. Website URL builder 支持 source + target 参数，仍用 URL API 编码。
5. Provider 名称展示为 Google Cloud Translation Basic；网站按钮展示为 Google Translate 网页。

**Dependencies**：Task 3；可与 Task 4 分别实现，但共同遵循 Task 3 的 adapter contract。
**Security**：用户自有 Cloud API key；header 认证；不记录原文/key；清楚标注 Google Cloud project/billing。
**Verification**：mock fetch 断言 endpoint/header/body；auto source omitted；target validation；bad response/error mapping；URL 编码和 source/target 参数；npm run typecheck。
**Risks**：这是用户项目下的计费 API，不是免费的 Google 网页跳转；Basic v2 没有 Advanced v3 glossary/custom model features。
**Acceptance**：无 Cloud key 时显示未配置；有有效 key 时单次请求返回译文；Google Translate 网站跳转独立可用。

### Task 6 — Main translation orchestration, IPC validation and cancellation

**Goal**：把 Main 作为 Provider dispatcher、credentials owner、request lifecycle owner。

**Files**：

- 修改 electron/ipc/translation-handlers.ts
- 修改 electron/main.ts
- 修改 electron/ipc/window-handlers.ts（仅需要传入安全 sender/context 时）
- 修改 electron/preload.ts
- 修改 src/shared/ipc.ts
- 新增 electron/services/translation-request-registry.ts
- 新增 handler/request-registry tests

**Interfaces/contracts**：

- translate(request) 返回 IpcResult<TranslationResult>。
- cancelTranslation(requestId) 仅取消此 Manager sender 创建的 in-flight request。
- getTranslationProviderState() 不返回 key，提供 provider 状态与 safe descriptors。
- save/removeProviderCredential() 只接收闭 union providerId 和一次性 key。

**Implementation steps**：

1. 由 Main 从 DataStore 读取选中 provider/settings，再从 SecretStore 获取对应 key，选择 adapter。
2. translate、test、key save/remove/status IPC 检查 sender 是当前 managerWindow.webContents 的主 frame；检查窗口未销毁、payload bounded。
3. Main 为每个 request ID 登记 AbortController；禁止一个 requestId 由其他 window 复用或取消。
4. 设置最大文本长度、合法 source/target、provider-specific required fields；renderer 不能传任意 built-in URL。
5. 设置 timeout 与 cancellation；同 Manager 新 request/取消/manager closed 时 abort 并清理 registry。
6. 错误转成 IpcResult 的稳定错误 code/message；key/storage error 不冒充 missing credential。
7. Connection test 走当前选择的同一 adapter；发送固定、非敏感短句；不在测试中读取 textarea 内容。
8. 通过 dependency injection/test seam 让 IPC sender、DataStore、SecretStore、fetch 都可验证。

**Dependencies**：Task 2、Task 4、Task 5。
**Security**：保持 sandbox/contextIsolation；验证 sender、main frame 与 closed payload；禁止 Renderer 访问 Node、filesystem 或 decrypted key。
**Verification**：fake WebContents IPC tests、sender rejection、cancel ownership、max length、unknown provider、secret unavailable、timeout/redirect、Manager destroyed 清理；npm run typecheck 与 npm run build。
**Risks**：预加载 API 由 DesktopApi 类型约束但 IPC handler 仍需运行时验证；Manager close 与 promise finally 需避免僵尸 registry entry。
**Acceptance**：只有 Manager 可以翻译/改凭证；Main 是唯一请求第三方 API 和读取明文 key 的层；用户取消能结束 fetch。

### Task 7 — Settings → Translation Provider UX

**Goal**：在现有 Settings 风格中管理 Engine/provider/region/model/credentials。

**Files**：

- 修改 src/features/settings/SettingsView.vue
- 可新增 src/features/settings/TranslationProviderSettings.vue
- 修改 src/shared/ipc.ts / electron/preload.ts（若 Task 6 接口需要）
- 修改 src/styles/tokens.css（仅必要样式）

**Implementation steps**：

1. 将现有 AI settings group 改成 Translation group；其余设置组和页面结构保持。
2. 加 Engine/Provider 选择；built-in URL 不显示；Custom 才显示 Base URL。
3. 根据 Provider 显示 key 状态与 masked input；保存后清空输入；替换/移除 current key 不影响其它 Provider。
4. Qwen 显示 region 与 workspace ID；Google Cloud 显示 Cloud project/API/billing 配置步骤和计费提示。
5. Model 默认值来自 safe provider descriptor；用户能编辑；Qwen 展示官方允许模型选项。
6. Test connection 显示正在测试、通过/错误类别及“可能产生 API 用量”提示。
7. 区分“未配置”“无 key”“安全存储不可用”“key 保存失败”，不把异常收敛成无 key。

**Dependencies**：Task 1、Task 2、Task 3、Task 6。
**Security**：password autocomplete、key 不回显、不写 settings、错误文案不展示敏感内容。
**Verification**：npm run typecheck；dev UI 人工确认不同 Provider 条件表单、保存/替换/移除、旧 Custom 配置、无 key 与 safeStorage error 状态。
**Risks**：当前 Settings 保存设置与 key 分成两步；实现需让部分失败可见，绝不能报告整体成功。优先先验证/保存 key，再提交 provider settings；若后者失败，显示明确状态并保留旧配置，不悄悄切换 active provider。
**Acceptance**：内置 Provider 不要求用户找 API URL；Key 被遮罩；Custom/region-specific setup 要求仅在对应 provider 中显示。

### Task 8 — Translation page UX and stale-request handling

**Goal**：完善翻译工具操作并防止旧响应污染新输入。

**Files**：

- 修改 src/features/translate/TranslateView.vue
- 可能新增 src/features/translate/translation-ui-state.ts 及其 .test.mjs
- 修改 src/App.vue（仅 handoff 后 focus 所需）
- 修改 src/styles/tokens.css

**Implementation steps**：

1. 添加 source/target、Auto Detect、Swap、Clear、Translate、Copy、Loading、Cancel、Error、Provider indicator。
2. 调用同一个 window.desktop.translate() IPC，不按 provider 在 Vue 中分支。
3. 加 Ctrl+Enter；保留 Ctrl+A/C 默认输入操作。
4. Launcher prefill 原样填入并 focus source textarea，光标在文本末尾；不自动调用 translate。
5. 每次请求生成 UI generation + requestId；开始、编辑 source、source/target 改变、provider change、clear、新 prefill、unmount 都清空旧结果/错误/复制态并取消旧请求。
6. 仅当前 requestId 且 generation 匹配时写 result/error/loading；旧 Promise 结束不能覆盖新 result，也不能清除新 loading。
7. 对 missing provider/key、timeout、quota、invalid model 展示安全可操作文案。
8. 保留“在 Google Translate 网页中打开”；使用同一 source/target 状态且不触发 Cloud/AI provider。

**Dependencies**：Task 6、Task 7。
**Security**：textarea 原文只在用户按 Translate 时送 Main；Google 网站由显式 click 才外发；Launcher prefill 不请求网络。
**Verification**：state tests 覆盖 A→B 次序逆转、输入变化、target/provider 更新、cancel/unmount；npm run typecheck、npm run build；UI 人工测试。
**Risks**：条件渲染会销毁 TranslateView；取消 IPC 与 finally 状态管理必须按 requestId 绑定。
**Acceptance**：所有源/目标/Provider 变更使旧 request 失效；精准 prefill 不自动翻译；键盘/复制/清空正常。

### Task 9 — Deterministic provider, settings and compatibility test coverage

**Goal**：补足可重复验证，不调用任何真实 Provider。

**Files**：

- 新增各 adapter、DataStore/credential、request-registry、UI state 对应 .test.mjs
- 如需明确本项目测试入口，可小幅修改 package.json 增加 npm test script；不添加 dependency。

**Coverage**：

- Provider endpoint/auth/request body/model/response parse/error mapping。
- Chat/Claude/Qwen prompt 与 translation semantics；Qwen source/target language name mapping。
- Google Basic v2 header API key、请求体和 v2 响应。
- secret status/storage failure/key isolation/legacy ai-api-key compatibility。
- DataStore old v2 normalization、无 provider 默认、Custom legacy。
- unknown provider、非法 region/workspace/config validation。
- sender authorization；renderer 不接收 secret。
- timeout、abort、Manager cleanup、A finishes after B does not overwrite B。
- Google Translate website URL source/target/query encoding。
- 不使用真实 API keys、真实用户原文、真实外部 API。

**Dependencies**：Task 1–8 的对应能力；集成测试依赖 Task 8。
**Verification**：项目无 npm test script；在决定增加脚本后运行统一 command，或直接用 Node built-in test 执行新增 .test.mjs。npm run typecheck、npm run build、git diff --check。
**Risks**：没有 Vue Test Utils/Vitest；不要为了 UI tests 引入依赖。UI 关键交互靠 runtime manual checklist 验收。
**Acceptance**：所有核心 request/parser/state/security 路径可用 fake fetch deterministic 验证，0 real calls/keys。

### Task 10 — Final code review, regression and Windows runtime verification

**Goal**：确认与现有 Launcher、Manager 和数据兼容行为共存。

**Checks**：

1. npm run typecheck
2. npm run build
3. 所有相关 Node built-in tests
4. git diff --check
5. npm run electron:dev
6. Security review：sender、key、redirect、endpoint、logs、HTML output、IPC bounds。
7. 正式打包若用户之后要求；本 Implementation Plan 阶段不打包。

**Dependencies**：Task 1–9。
**Acceptance**：typecheck/build/test/diff check 通过；手动 checklist 只标真实执行项；未手动执行的 Windows GUI/provider 行为标 NEEDS MANUAL VERIFICATION。

## 17. Task Dependency Graph

~~~text
Task 1 Shared types + compatible DataStore
  ├─ Task 2 Provider-scoped credentials ─┐
  └─ Task 3 Provider registry/languages ─┼─ Task 6 Main IPC/orchestration/cancel
        ├─ Task 4 AI adapters ───────────┤             ├─ Task 7 Settings UX
        └─ Task 5 Google Cloud adapter ──┘             └─ Task 8 TranslateView UX
                                                           ↓
                                        Task 9 deterministic integration tests
                                                           ↓
                                        Task 10 code review + Windows verification
~~~

Task 2 与 Task 3 可以在接口冻结后分别工作，但都不需要为了并行强拆。Task 4 与 Task 5 使用同一个 adapter contract，先由主负责人固定 contract，再分别实现/审核更稳妥。Task 6、7、8 必须共享 Main IPC 与 state 上下文；不建议拆成独立代理。最终 Task 9/10 由主负责人统合，不能在未经完整 review 前声称完成。

## 18. Dependency Decision

本轮预计新增 production dependency：**No**。

原因：

- Electron Main 的 Node runtime 已有 fetch、AbortController、AbortSignal.timeout，可实现有限 HTTP adapter。
- REST 请求格式简单；项目已有使用 fetch 的 service。
- 使用 node:test 与 fake Response 测试，不需要 Vitest、SDK、Axios 或统一 AI SDK。
- 不新增 Provider SDK，避免 bundle、内存、依赖更新面和 Provider SDK 错误语义差异。

若 implementation 发现某 Provider 的官方协议无法安全地用 fetch 实现，再提交单独的依赖论证，不在本计划里预先增加依赖。

## 19. Behavioral Regression Contract

本轮必须保持：

- Launcher 英文翻译 action 仍在 application results 后显示；键盘选择、Enter/click 行为不变。
- Launcher handoff 传 exact query，只 prefill，不 auto translate。
- ?query web search、file:query Everything search、/query saved websites 与 normal local search 不变。
- Quick Search Manager 页面保留。
- Favorites / Apps、主题、Launcher Toggle/Escape/blur-hide/drag/compact-expanded 均不变。
- WebsiteEntry、bookmark、AppData version 2 的既有数据不丢失。
- Existing Google Translate website 跳转保留。
- Existing custom OpenAI-compatible 用户的 base URL/model/key 可继续使用。
- Manager close 仍 destroy renderer；不常驻创建 Translation BrowserWindow。

## 20. Acceptance Checklist

### Provider and Settings

- [ ] Built-in providers: OpenAI / Claude / Gemini / DeepSeek / Qwen-MT / Google Cloud Basic。
- [ ] 内置 Provider endpoints 由 Main registry 管理；用户不需要普通 Base URL。
- [ ] Qwen Region / required Workspace ID 和 matching key 提示正确。
- [ ] Custom 才显示 URL；只允许 HTTPS 或 loopback HTTP。
- [ ] 推荐 model 默认可用且 model field 可编辑。
- [ ] key 加密存在 safeStorage 文件，不进入 DataStore/renderer state/logs。
- [ ] legacy aiBaseUrl/aiModel/ai-api-key 作为 Custom Provider 保留。
- [ ] 无 key 状态与加密存储错误状态可区分。
- [ ] 连接测试提示潜在用量并使用 mock 验证 adapter。

### Translation UI and request lifecycle

- [ ] Source / Auto Detect / Target / Swap / Clear / Copy / Translate / Cancel / Error / provider indicator。
- [ ] Ctrl+Enter 翻译，Ctrl+A/C 正常。
- [ ] Launcher prefill exact query、聚焦 source、不自动调用 API。
- [ ] 原文、source/target、Provider 变化后旧 request abort/invalidate。
- [ ] A→B，B→A 响应顺序下最终 UI 保持 B；旧 finally 不改变 B loading。
- [ ] unmount/Manager destroy abort 当前请求并释放 request registry。
- [ ] Google Translate 网站只经显式 click 打开。
- [ ] no-provider 状态仍能输入文字并使用网页跳转。

### Google Cloud and compatibility

- [ ] Google Cloud Basic v2 明确需要用户项目、API 开启、billing 和 API key。
- [ ] key 通过 x-goog-api-key header；绝不进入 URL。
- [ ] Cloud auto source / target / response mapping 正确。
- [ ] Google Translate website 与 Google Cloud API 文案/设置可区分。
- [ ] 旧 AppData v2、WebsiteEntry、Launcher、搜索命令无回归。

### Final verification

- [ ] npm run typecheck
- [ ] npm run build
- [ ] Node built-in deterministic tests
- [ ] git diff --check
- [ ] npm run electron:dev
- [ ] Windows UI provider settings/state and Translation operation manual verification
- [ ] 真机/真实 Provider/API key 测试只在用户明确配置后进行；不在 automated test 中调用

## 21. Risks and Open Decisions

1. Cloud Translation Basic 是可收费 API；UI 需要如实说明 Google Cloud project 与 billing，不显示可能过期的价格承诺。
2. Qwen-MT 官方 endpoint 需要 region/workspace-specific 配置，不能承诺“仅输入 key”。必须先选定 v1 支持的 regions，使用 registry endpoint 映射。
3. API-compatible 不代表完全相同：Gemini/DeepSeek/Qwen 的 extensions/error schemas 必须用官方 API docs 和 fake response tests 分别验证。
4. safeStorage 降低磁盘明文风险，但 Windows DPAPI 不防同一用户权限内的恶意进程；不要宣传密钥绝对安全。
5. Provider model IDs、区域和价格会变化；维护集中在 registry 与官方 reference re-check。
6. 无 key 的零配置 Provider 未查到可信选项；如产品以后决定捆绑服务端代理，这会改变数据流、成本与隐私责任，应另开需求，当前计划不假设存在 WebTools backend。
7. Manager 已确认的 handoff 后，TranslateView source/result 随 Manager destroy 消失。首版建议保持当前隐私/内存生命周期；如果用户要求跨启动保留翻译历史，应单独决定是否保存敏感原文。

## 22. Manual Verification Expected

自动 fake tests 不能证明真实账号、网络区域、key 权限与收费状态。实现完成后至少需要 Windows 手动验证：

- 每个首发 Provider 的真实账号/API key/model/endpoint；key 与 region 不匹配时提示清楚。
- Google Cloud API 开启与 billing 未启用、无效/受限 key、超 quota 场景。
- 不同 provider 对中文/英文、Auto Detect、段落、换行、提问句和“忽略指令”文本的译文表现。
- Ctrl+Enter、Ctrl+A/C、Clear、Swap disabled、Cancel、复制和错误态 UI。
- 切换 source/target/input 后快速重复翻译，确认 stale result 不回来。
- Launcher 翻译 handoff 对 Manager 未创建、创建中、隐藏、已打开，以及 Manager reload/close 兼容。
- electron:dev 下 API key 不回显，关闭 Manager 后常驻内存行为仍符合已有生命周期。
- 安装版 Windows safeStorage 在覆盖安装与用户配置下仍能读取密钥；打包 Smoke test 如需要由后续实施阶段执行。

## 23. Official References

### OpenAI

- [OpenAI API reference overview](https://developers.openai.com/api/reference/overview)
- [OpenAI Chat API reference](https://developers.openai.com/api/reference/resources/chat)
- [OpenAI API key safety guidance](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)

### Anthropic Claude

- [Claude API overview](https://platform.claude.com/docs/en/api/overview)
- [Messages API create reference](https://platform.claude.com/docs/en/api/messages/create)
- [Claude authentication](https://platform.claude.com/docs/en/manage-claude/authentication)

### Google Gemini

- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Gemini generateContent API](https://ai.google.dev/api/generate-content)
- [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)

### DeepSeek

- [DeepSeek first API call / compatibility / endpoint / model](https://api-docs.deepseek.com/guides/harness)
- [DeepSeek Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek thinking behavior](https://api-docs.deepseek.com/guides/thinking_mode/)

### Alibaba Qwen / DashScope

- [Qwen-MT model and translation semantics](https://help.aliyun.com/en/model-studio/machine-translation)
- [Qwen-MT API reference, endpoints, params and response](https://help.aliyun.com/en/model-studio/qwen-mt-api)
- [Model Studio regions and endpoints](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/regions)
- [Model Studio base URL overview](https://www.alibabacloud.com/help/en/model-studio/base-url)
- [Model Studio API key requirements](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/get-api-key)

### Google Cloud Translation

- [Cloud Translation API overview](https://docs.cloud.google.com/translate/docs/api-overview)
- [Cloud Translation authentication](https://docs.cloud.google.com/translate/docs/authentication)
- [Basic v2 translate method reference](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate)
- [Basic and Advanced setup / billing](https://docs.cloud.google.com/translate/docs/setup)
- [Basic v2 to Advanced v3 migration differences](https://docs.cloud.google.com/translate/docs/migrate-to-v3)
- [Google Cloud API key REST header and query warning](https://docs.cloud.google.com/docs/authentication/api-keys-use)
- [Cloud Translation pricing and metering](https://cloud.google.com/translate/pricing)

### Other provider candidates

- [Moonshot / Kimi API overview](https://platform.kimi.com/docs/api/overview)
- [Zhipu API OpenAPI reference](https://docs.bigmodel.cn/openapi/openapi.json)
- [Z.AI streaming API](https://docs.z.ai/guides/capabilities/streaming)
- [MiniMax OpenAI-compatible Text Chat](https://platform.minimaxi.com/docs/api-reference/text-chat-openai)
- [MiniMax international OpenAI-compatible API](https://platform.minimax.io/docs/api-reference/text-openai-api)
- [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart)
- [OpenRouter API overview](https://openrouter.ai/docs/api_reference/overview)

### Electron safeStorage

- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage)
