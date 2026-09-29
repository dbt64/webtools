# WebTools Translation Provider 官方文档调研

**核验日期：2026-09-27**

**范围：** 仅依据服务商或 Electron 官方文档；未调用真实 API、未比较价格与翻译质量。服务地址、模型 ID、区域能力可能变化，落地时应以所选账号的控制台和模型列表为准。

## 结论摘要

- 大多数生成式 AI 厂商提供 OpenAI Chat Completions 兼容接口，但“兼容”只说明通用消息调用能复用，并不保证模型参数、思考内容、模型可用区域或流式事件都一致。首版若使用统一 OpenAI Chat adapter，仍需按 provider 做少量参数和输出处理。
- 推荐分开表示两类翻译服务：**LLM 翻译**（发送翻译指令和原文，便于语气、上下文和格式控制）与**机器翻译**（Google Cloud Translation、Qwen-MT，直接给源文和目标语言）。Google Cloud Translation 的 REST schema 与 Chat API 不同，不应伪装成 OpenAI provider。
- 对第一版，一个可控的起点是 OpenAI Chat-compatible adapter（OpenAI、DeepSeek、Gemini、Qwen、Kimi、GLM、MiniMax、OpenRouter 可按兼容程度配置）加 Claude Messages adapter；如果要提供专用机器翻译，优先验证 Qwen-MT。可先把选项收敛到用户已明确需要的 OpenAI、DeepSeek 和 Google 翻译，再根据产品范围增加 Gemini、Claude 或 Qwen-MT。此为维护成本与协议差异上的产品建议，不是厂商限制。
- **Google Cloud Translation 不能匿名、无凭证使用。** Basic v2 需要有 API 启用和计费的 Google Cloud 项目，并用 API key、OAuth 或服务账号等方式认证；Advanced v3 不接受 API key，只使用 IAM/OAuth 一类凭证。用户通常可以自行提供 Basic v2 key，但还要自行建立/配置 Google Cloud 项目和 billing；这和不需凭证的 Google 翻译网页不是一回事。
- WebTools 是本机桌面客户端，建议网络请求留在 Electron main process，renderer 只经窄 IPC 传入翻译参数/收到结果；只接收用户自己的 provider key，禁止把开发者 key 打包给全体用户。Windows 上 Electron `safeStorage` 用 DPAPI 加密磁盘数据，可保护其他 Windows 用户，但官方说明同一登录用户下的其他进程仍能解密，因此应说明本地 BYOK key 并非对该用户自己的恶意软件绝对保密。
- Google Cloud Translation Advanced v3 不适合把服务账号 JSON 私钥随桌面安装包分发。若要支持 v3，应设计用户 OAuth/ADC 身份授权，或通过服务端 broker 代理；首版可不支持。

## 官方接口矩阵

表内 `providerId` 是建议给 WebTools 内部配置使用的稳定标识，不是厂商指定字段。模型 ID 示例是接口模型标识而非长期固定清单。

| 建议 ID / 显示名 | 官方 endpoint、区域 | 认证与 OpenAI 兼容 | 输入、stream 与主要差异 |
|---|---|---|---|
| `openai` / OpenAI | Base URL `https://api.openai.com/v1`；Chat Completions `POST /chat/completions`。官方通用 API 文档展示标准 `v1` 服务，未提供此接口的用户可选区域 base URL。 | Bearer API key；也有短期 workload identity token。OpenAI 原生接口，不是第三方兼容层。 | Chat 输入为 `model` + `messages`（文本可用字符串）；`stream: true` 使用 SSE。OpenAI 当前同时提供 Responses API；若首版目标是跨厂商通用文本请求，Chat Completions 的消息格式更容易复用。官方明确提醒不要把 API key 放入 client-side app/browser。 [API overview/auth](https://developers.openai.com/api/reference/overview) · [Chat API](https://developers.openai.com/api/reference/resources/chat) |
| `anthropic` / Anthropic Claude | `https://api.anthropic.com/v1/messages`。直连 host 如上；AWS、Google Cloud、Azure 上的 Claude 是另一种云平台/IAM endpoint 集成。 | `Authorization: Bearer <token>` 或 `x-api-key`，并必须带 `anthropic-version`。不提供官方 OpenAI Chat 兼容层；使用 Messages 原生格式。 | 必填 `model`、`max_tokens`、`messages`。System prompt 用顶层 `system`；Messages 输入列表没有 `system` role。`stream: true` 是 Anthropic SSE 事件格式，需要专用解析器，不应按 OpenAI `choices[].delta` 解析。 [API overview/auth](https://platform.claude.com/docs/en/api/overview) · [Messages API](https://platform.claude.com/docs/en/api/messages/create) |
| `google-gemini` / Google Gemini API | OpenAI-compatible Base URL `https://generativelanguage.googleapis.com/v1beta/openai/`，Chat endpoint 为 `/chat/completions`。官方 Gemini Developer API 的常规 API 使用 Google Generative Language host；Vertex AI 是另一项 Cloud/IAM 产品。文档未给此 Developer API 兼容路径设置用户可选地区。 | OpenAI 兼容入口使用 `Authorization: Bearer <Gemini API key>`；native API 使用 `x-goog-api-key`。每个 key 关联一个 Google Cloud project。自 2026-05-28 起 AI Studio 新建 key 默认为 auth key；未受限的旧标准 key 会被拒绝。 | 兼容输入为 `model` + OpenAI `messages`（官方展示 system/user）；支持 `stream:true`。兼容层官方称适合受 OpenAI SDK/schema 限制的集成，建议一般场景直接使用 Gemini API；File API、部分原生能力及工具映射存在能力上限。模型可用性以账号及模型列表为准。 [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) · [API key and project behavior](https://ai.google.dev/gemini-api/docs/api-key) · [Partner integration trade-offs](https://ai.google.dev/gemini-api/docs/partner-integration) |
| `deepseek` / DeepSeek | `https://api.deepseek.com`，Chat endpoint `POST /chat/completions`；官方兼容资料使用同一个 base URL。官方文档未给常规 Chat API 提供地区 endpoint 选择。 | Bearer API key。官方明确支持 OpenAI API 格式，亦有 Anthropic 格式接口。 | 必填 `model`、`messages`，文本输入为常规 role/content。当前文档列举 `deepseek-flash`、`deepseek-v4-pro`（另有 V4 发布资料列出 `deepseek-v4-flash`）；模型 ID 应可配置或从模型目录更新。支持 SSE，末尾有 `data: [DONE]`；thinking/reasoning 字段和参数是 DeepSeek 扩展，纯翻译 UI 应只呈现最终文本。 [Chat Completion reference](https://api-docs.deepseek.com/api/create-chat-completion/) · [First API call / auth example](https://api-docs.deepseek.com/guides/harness) · [API key authentication](https://api-docs.deepseek.com/api/deepseek-api/) |
| `alibaba-qwen` / Alibaba Cloud Model Studio (Qwen) | 推荐使用 workspace-dedicated base URL：`https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`；官方列出的 region IDs 包括 `cn-beijing`、`ap-southeast-1`、`us-east-1`、`eu-central-1`、`ap-northeast-1`、`cn-hongkong`。Beijing/Singapore 等区域仍提供 DashScope legacy domain；官方建议生产环境迁移至专属域名，并说明 DashScope domain 自 2026-09-30 起不再支持新功能。 | Bearer API key（通常命名为 `DASHSCOPE_API_KEY`）。兼容 OpenAI Chat Completions；每个 region 有独立 endpoint、key、model list，不能跨区复用；专属 endpoint 的 key 还限定到 workspace。 | 通用聊天输入为 `model` + `messages`，内容可为普通文本；`stream:true` 使用分块/SSE。个别模型不支持该协议（官方举例 Qwen-Audio 仅支持 DashScope 协议），模型能力和地区需以控制台为准。Qwen-MT 是专用机器翻译 API，但使用兼容的 Chat Completions 外壳：`model` + 单条 user 原文，并传 `translation_options.source_lang/target_lang`。`qwen-mt-flash` / `qwen-mt-lite` 是增量流；`qwen-mt-plus` / `qwen-mt-turbo` 的流式 chunk 是非增量文本。 [Regions/endpoints](https://help.aliyun.com/en/model-studio/regions/) · [OpenAI-compatible Chat](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions) · [Qwen streaming](https://help.aliyun.com/en/model-studio/stream) · [Qwen-MT request/stream API](https://help.aliyun.com/en/model-studio/qwen-mt-api) · [API key](https://help.aliyun.com/en/model-studio/get-api-key) |
| `google-cloud-translation-v2` / Google Cloud Translation Basic v2 | `POST https://translation.googleapis.com/language/translate/v2`。此 REST method 没有 region path。 | 必须认证。Basic v2 支持 API keys，也支持服务账号/OAuth。key 关联 Google Cloud 项目，用于 billing/quota；官方 REST method 将 `key` 列为 query parameter。 | 直接翻译 schema：`q`（字符串或字符串数组，最多 128 项）、必填目标语言 `target`、可选 `source`（省略时自动检测）、可选 `format`。同步 JSON response；此 translate method 没有 `stream` 参数。需要 Cloud project、启用 API、有效 billing account、凭证。不能匿名无凭证调用。对 Windows 桌面 BYOK 相对可行，但用户的 GCP 建项、启用服务和 billing 步骤较重；query key 也需防止进入日志。 [Setup/project/billing](https://docs.cloud.google.com/translate/docs/setup) · [Authentication support](https://docs.cloud.google.com/translate/docs/authentication) · [v2 translate request](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate) |
| `google-cloud-translation-v3` / Google Cloud Translation Advanced v3 | `POST https://translate.googleapis.com/v3/projects/{project}/locations/{location}:translateText`；`parent` 可含 project 和 `global`/地区。EU 有 `translate-eu.googleapis.com` 区域 endpoint；其他服务/功能有 location 限制。 | **不支持 API key**。需 Google Cloud OAuth/ADC/service account 认证及 IAM 权限。 | `contents[]`、目标语言 `targetLanguageCode` 必填；`sourceLanguageCode` 可省略由系统检测。同步 JSON，没有 stream 字段。拥有 NMT、Translation LLM、Glossary/custom model 等 Advanced 功能。请求必须携带项目/位置。服务账号 JSON 私钥不应嵌入公开分发的桌面应用；首版若无用户 OAuth/ADC 流程，应延后。 [v3 TranslateText](https://docs.cloud.google.com/translate/docs/reference/rest/v3/projects/translateText) · [Basic → Advanced auth and regional differences](https://docs.cloud.google.com/translate/docs/migrate-to-v3) · [Authentication](https://docs.cloud.google.com/translate/docs/authentication) |

### 兼容厂商评估

| 建议 ID / 显示名 | 官方 endpoint、认证、模型输入与 stream | 首版评估 |
|---|---|---|
| `moonshot` / Moonshot Kimi | 官方 API 总览列出 OpenAI Chat base `https://api.moonshot.cn/v1`、Messages-compatible base `https://api.moonshot.cn/anthropic`；Bearer `MOONSHOT_API_KEY`。Chat 输入为 `model` + `messages`；模型列表 `GET /v1/models` 可查询可用 ID/能力。OpenAI Chat 兼容，stream 可随 Chat API 请求使用；thinking 等有 Kimi 自有扩展。官方模型列表文档特别提示平台 key 要匹配平台，`platform.kimi.com` 与 `platform.kimi.ai` 的 key 不可混用。文档所示 OpenAI API host 是 `.cn`。 [API overview](https://platform.kimi.com/docs/api/overview) · [Model list/auth](https://platform.kimi.com/docs/api/list-models) · [Chat API](https://platform.kimi.com/docs/api/chat) | **可做，建议第二批。** Chat 兼容性好且有模型目录；先确认目标用户能注册/访问对应 Kimi API 平台，避免把消费产品账号与 API key 混为一谈。 |
| `zhipu-glm` / Zhipu GLM | 中国站官方 OpenAPI server `https://open.bigmodel.cn/api/` + `/paas/v4/chat/completions`，即 `https://open.bigmodel.cn/api/paas/v4/chat/completions`；国际 Z.AI 示例 endpoint `https://api.z.ai/api/paas/v4/chat/completions`。Bearer API key。`model` + `messages`，官方 schema 有文本及多模态 variants；stream 返回 `text/event-stream`/SSE。主流 chat 结构 OpenAI-compatible；thinking 等是扩展。中国站与 Z.AI 国际站应作为不同区域配置，host、账号可用模型不应硬编码成一个 endpoint。 [China API OpenAPI spec](https://docs.bigmodel.cn/openapi/openapi.json) · [China OpenAI SDK guide](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) · [Z.AI streaming endpoint](https://docs.z.ai/guides/capabilities/streaming) | **可做，尤其适合中文用户，但需明确中国站/国际站切换。** 可以复用 OpenAI chat parser；不能共享假设所有模型均接受完全相同的参数。 |
| `minimax` / MiniMax | 中国文档 endpoint `https://api.minimax.cn/v1/chat/completions`，国际 endpoint `https://api.minimax.io/v1/chat/completions`；两者均有 Bearer API key / OpenAI-compatible chat。输入 `model` + `messages`，支持 `stream:true`。当前官方国际文档模型例子有 `MiniMax-M3`、`MiniMax-M2.7` 等。M3 默认开启 thinking，响应可能含思考内容；兼容层有 `thinking`、`reasoning_split`、`reasoning_content` 等特殊字段。官方还提供 Anthropic-compatible 接口。 [China Chat Completions](https://platform.minimaxi.com/docs/api-reference/text-chat-openai) · [International OpenAI SDK/API](https://platform.minimax.io/docs/api-reference/text-openai-api) · [Model invocation/endpoint guide](https://platform.minimax.io/docs/guides/text-generation) | **接口易接、建议延后。** 若直接作为纯翻译选项，必须确认只显示 `content` 最终译文、不把 `<think>` 或 reasoning 输出给用户；最好针对选定模型显式控制 thinking。 |
| `openrouter` / OpenRouter | 默认 base `https://openrouter.ai/api/v1`，`POST /chat/completions`；Bearer OpenRouter key；可用 `GET /models` 查看目录，model id 是 `provider/model`/slug。Chat Completions 格式近似 OpenAI，支持 SSE stream。具备 provider order/only/fallback 等路由选择；官方还提供 EU `https://eu.openrouter.ai/api/v1`、US `https://us.openrouter.ai/api/v1` 区域接入，但区域路由只适用于合格模型/端点，并需正确锁定 region/provider。默认 routing 可在不同上游间负载均衡/回退；可用 `data_collection`/`zdr` 过滤策略。 [Quickstart](https://openrouter.ai/docs/quickstart) · [API schema](https://openrouter.ai/docs/api_reference/overview) · [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) · [In-region routing](https://openrouter.ai/docs/guides/features/in-region-routing) | **第一版不建议默认提供。** 一个 key 能访问广泛模型是优点，但模型 ID、参数支持、数据处理和上游路由的选择/解释都会扩大设置和支持范围。适合作为之后的聚合服务选项，并在 UI 显示实际 model/provider/region policy。 |

## Google Cloud Translation：凭证与桌面应用结论

1. Google Cloud setup 要求 Cloud project、Cloud Translation API 已启用以及“credentials to make authenticated calls”；还明确要求启用 billing。Basic v2 的 API key 与 service account 只是认证方式，不是匿名免凭证。API key 将请求关联到项目用于计费和配额，但不代表调用者身份。 [Setup](https://docs.cloud.google.com/translate/docs/setup) · [Authentication](https://docs.cloud.google.com/translate/docs/authentication)
2. v2 方法公开了 query 参数 `key`，REST body/schema 是同步翻译。应用可由用户粘贴自己的 key，但需提示用户先完成 Cloud 项目、API enable、billing 和 key restriction；不能把 WebTools 自己的 Cloud key 发给所有安装用户。
3. v3 不接受 API key。Google 文档要求 service account/IAM 权限；支持本地 ADC 的用户凭证，但这会涉及用户身份授权流程。若为产品内置一个服务账号 JSON，任何拿到安装包的人都能提取凭证并消费项目配额，因此不应这么做。可选方向是做 OAuth/ADC 让用户授权自己的 project，或搭建服务端代理并承担密钥、账单及滥用治理。
4. v2 和 v3 的 API 响应均为一次请求完成后返回 JSON；没有 Cloud Translation translateText SSE/stream 参数。界面可显示加载状态，但不应宣称逐字流式翻译。

## WebTools Windows 桌面客户端建议

- 将外部 provider key 视为用户机密：renderer 仅使用有限 IPC，key 与请求由 Electron main process 管理。OpenAI、Gemini、Alibaba、Kimi 等文档都警告不能把 API key 暴露于客户端；Electron `safeStorage` 可借 DPAPI 加密磁盘状态，但按 Electron 文档，其安全边界是不同 Windows 用户，**同一登录用户下其他进程仍可解密**。因此它是本机静态加密，不是服务器级不可提取 secret。 [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
- 不要打包共用 developer API key。采用 BYOK，提供删除 key、错误诊断时遮盖 key、不得记录 Authorization/key/query secret 的规则。可说明文本会发送到用户选择的服务商，并提供区域信息/隐私链接。
- API key 在 URL query 中的供应商特别要避免完整 URL 日志；Google Cloud Translation Basic v2 文档以 `key` query 参数展示 key，WebTools 应确保不会把该完整 URL打印到 console/错误 UI。
- UI 保存稳定 `providerId`，不要仅依赖展示名；保存用户选择的 region/base URL 与 model ID。对 OpenAI-compatible 服务可以共享消息传输，但保留 provider-specific request knobs / response normalization；不能对所有 compatible provider 一律假设相同 SSE chunk、`max_tokens` 字段或思考输出。
- “翻译”逻辑应在 provider 之间区分 LLM 与机器翻译协议：LLM 通常要求预设 system instruction + 原文 user message，并从 assistant 文本中提取译文；Google v2 / Qwen-MT 则有 `source`/`target` 或 `translation_options` 字段。Qwen-MT 的 plus/turbo stream 是非增量消息，不能按普通 delta 拼接。

## 首版选择建议

### 可优先纳入

1. **OpenAI**：常见通用 LLM provider；Chat Completions 输入简单，可做基础互通路径。
2. **DeepSeek**：已在产品需求范围内，复用 Chat 兼容形态；针对 thinking 结果明确只取用户可见译文。
3. **Google Gemini Developer API**：OpenAI-compatible path 足以支持纯文本翻译，可以省去第一版单独 native schema；界面/文档注明兼容层只覆盖其一部分功能。
4. **Google Cloud Translation Basic v2**：如果产品需要“传统机翻”而非 LLM prompt 翻译，Basic v2 是 Google Cloud 侧最直接方案；但应明确它需要用户自己的 Google Cloud project/API key/billing。若产品定位希望低门槛、无 GCP 账户，则不要把它包装成免费/免凭证 Google 翻译。
5. **Alibaba Qwen-MT**：在中文用户市场可作为专用翻译服务试点。它仍用 OpenAI-compatible chat endpoint，但额外 `translation_options` 和模型输出流式差异值得独立 adapter/测试。

### 后续评估或暂缓

- **Claude**：适合面向用户提供更多语言质量选项，但要额外维护 Messages 原生 request/response/SSE adapter；若用户需要 Claude，再纳入。
- **Kimi / GLM**：两者 Chat API 都可复用 OpenAI 形态，工程上不难；将它们加入是否值得主要取决于用户地区/账号可用性和测试覆盖。GLM 要让用户选择中国站或 Z.AI 国际站，Kimi 的 key 必须对应正确 API 平台。
- **MiniMax**：可接入，但 thinking 输出需要稳定的模型特定处理，初次增加 provider 的低成本优势被输出清洗/验证部分抵消。
- **OpenRouter**：适合愿意使用聚合商、自己选择模型/上游的高级用户；路由、地区和数据策略可配置，但会增加产品解释成本，不建议默认作为“普通翻译”服务。
- **Google Cloud Translation Advanced v3**：首版不支持；除非同时做用户 OAuth/ADC/项目 location UI，不要嵌入服务账号 key。

## 建议编码前确认的外部契约

- 键值/持久化名使用本地稳定 id（上表 `providerId`），与用户显示名和服务商模型 id 分离。
- Provider 设置至少区分 `protocol`（OpenAI Chat、Anthropic Messages、Cloud Translation v2/v3、Qwen-MT）和可选区域 endpoint；“OpenAI 兼容”并不是完整 API 能力同一。
- 模型列表与 model ID 建议允许人工填入或可刷新；不可假设某个今日模型名会永久有效。Kimi 官方直接提供 models list endpoint。Google/DeepSeek/阿里等也会按账号、地域、模型生命周期变化。
- 流式开关可做统一能力属性，但各 provider parser 应有独立 fixture/测试：OpenAI Chat SSE 与 DeepSeek 类似；Claude 使用事件类型；Qwen-MT 有增量与非增量模型；Google Cloud Translation 是普通 JSON。
- 翻译完成提取不能简单显示整个响应对象。MiniMax / DeepSeek / GLM 等带 reasoning 字段；页面只显示最终译文，必要时为兼容模型做定向输出提取。

## 官方来源索引

- OpenAI: [API Overview & Authentication](https://developers.openai.com/api/reference/overview), [Chat Completions](https://developers.openai.com/api/reference/resources/chat)
- Anthropic: [API overview](https://platform.claude.com/docs/en/api/overview), [Messages API](https://platform.claude.com/docs/en/api/messages/create)
- Google Gemini API: [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [API keys](https://ai.google.dev/gemini-api/docs/api-key), [partner integration limitations](https://ai.google.dev/gemini-api/docs/partner-integration)
- DeepSeek: [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/), [first API call](https://api-docs.deepseek.com/guides/harness), [API key](https://api-docs.deepseek.com/api/deepseek-api/)
- Alibaba Cloud Model Studio: [regions and endpoints](https://help.aliyun.com/en/model-studio/regions/), [OpenAI-compatible Chat](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions), [streaming](https://help.aliyun.com/en/model-studio/stream), [Qwen-MT API](https://help.aliyun.com/en/model-studio/qwen-mt-api), [API keys](https://help.aliyun.com/en/model-studio/get-api-key)
- Google Cloud Translation: [setup](https://docs.cloud.google.com/translate/docs/setup), [authentication](https://docs.cloud.google.com/translate/docs/authentication), [v2 translate](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate), [v3 translateText](https://docs.cloud.google.com/translate/docs/reference/rest/v3/projects/translateText), [v2→v3 migration](https://docs.cloud.google.com/translate/docs/migrate-to-v3)
- Moonshot Kimi: [API overview](https://platform.kimi.com/docs/api/overview), [model list](https://platform.kimi.com/docs/api/list-models), [Chat API](https://platform.kimi.com/docs/api/chat)
- Zhipu / Z.AI: [BigModel official OpenAPI](https://docs.bigmodel.cn/openapi/openapi.json), [BigModel OpenAI SDK guide](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction), [Z.AI streaming](https://docs.z.ai/guides/capabilities/streaming)
- MiniMax: [China Chat Completions](https://platform.minimaxi.com/docs/api-reference/text-chat-openai), [international OpenAI SDK API](https://platform.minimax.io/docs/api-reference/text-openai-api), [model invocation](https://platform.minimax.io/docs/guides/text-generation)
- OpenRouter: [quickstart](https://openrouter.ai/docs/quickstart), [API reference](https://openrouter.ai/docs/api_reference/overview), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [in-region routing](https://openrouter.ai/docs/guides/features/in-region-routing)
- Electron: [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
