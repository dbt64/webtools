# Phase 6G-1 — Feature Quick Result Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking. Delegation requires separate explicit authorization.

**Goal:** 让已授权的 Manifest v3 Node Command 在用户点击 Selected Text Feature 后，通过真实 Main/Pipe/WPF 通路返回一个有界纯文本结果，同时支持生产包与有效开发 session。

**Architecture:** Utility Process 返回正文，Main 暂存到 `execute()` 与 cleanup 成功后复核来源并发送；Native 接受后独立拥有 presentation state。开发态使用当前已确认 build 的独立 authority 和内存投影，Shared AI 确认通过当前 invocation 的 Host adapter 呈现在同一面板内。

**Tech Stack:** TypeScript、Node Utility Process、现有 Electron Main/Named Pipe、C#/.NET 10 WPF、现有单包 Plugin SDK、pnpm。

**Spec:** `docs/superpowers/specs/2026-10-16-phase6g0-feature-quick-result-design.md`，2026-10-16 USER APPROVED。

**Status:** QUICK RESULT FOUNDATION COMPLETE — AUTOMATED REGRESSION PASS — MANUAL WINDOWS ACCEPTANCE USER CONFIRMED PASS. Tasks 1–7 已实现，Task 8 最终回归及真实通路 18/18 通过，证据见独立执行报告。用户随后确认所要求的人工验收无问题；此状态是用户确认，不是逐项机器记录。该完成状态只覆盖 Quick Result foundation，不代表 Translation Plugin 2.0 完成。

**Plan-authoring baseline:** `codex/shared-ai-translation-2.0` / `707c5673dff479285b34a5b441bec9d3b725c737`，包含大量已有 tracked/untracked 修改；当时 SDK 为 `@webtools/plugin-sdk@1.6.0`，Product Version 为 `0.1.0`。Phase 6G-1 实际执行使用 SDK `1.7.0`，包身份和 tarball hash 见独立执行报告；不要将计划起草时的 SDK 版本当作当前版本。

## Global Constraints

- 首版只为 Selected Text + Manifest v3 Node `presentation.type: command` 提供 Quick Result；用户点击 Feature 才调用；Web Window、Launcher、Manager、No Context 和文件/目录上下文保持原有完成语义。
- 公共返回值严格为 `{ kind: 'text', text }` 或 void；最多 8,192 Unicode scalar values、32,768 UTF-8 bytes；正文 envelope 最多 65,536 bytes。拒绝未配对 surrogate、NUL、TAB/CR/LF 以外的 C0、空白正文、getter 和额外字段。只把 CRLF/CR 转 LF，不截断结果。
- 请求仍最多 16 KiB，既有状态回执仍最多 256 bytes，Pipe frame 仍最多 4 MiB；requestId 使用现有 UUID v4，Native 只使用本地 generation，不新增 presentationId。
- 保留 30 秒 Command 执行预算、最多 8 个活动 Command、每个 Pipe session 最多 2,048 个 replay entries；正文不进入 replay map、磁盘、projection、普通日志。
- 未完成调用依赖当前 Pipe session；Native 已接受的文本跨正常 Electron idle exit、Pipe 断开及重连保留。正常 cleanup 不等于外部撤权；无结果显示 TTL。
- Main 是唯一执行及发送授权者。开发 session 必须经过现有用户确认、Host validator 和 snapshot/hash/revision 检查。开发工具源码目录、UI 投影和插件返回身份均不能授予权限。
- Shared AI consent policy 独立于 Quick Result；user gesture 只消费一次；确认绑定当前 invocation/provider；不承诺远端已接收请求可以停止计费。不得把凭据交给插件或 Native。
- 不新增权限名、Manifest 字段、FeatureRef 格式、持久化 schema、公开 Pipe、常驻插件服务、Native 翻译服务或通用 receipt/activity/epoch 框架。
- 所有测试 Profile、插件、tarball、日志和 evidence 放在 `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\<run-id>\`。需要 TEMP 隔离门时，只为测试子进程设置该目录下的 TEMP/TMP，不修改系统环境变量或放宽现有安全校验。
- 保护 `D:\webtools`、真实 `%APPDATA%\Nook`、SecretStore、Token、Favorites、Settings、启动项和无关进程。仅清理已核对 executable canonical path、PID、creation time 的测试进程。
- 执行前 inventory 当前 dirty diff；已有 Launcher/Panel 修复逐段保留。无自动 stage、commit、push、PR、tag、release 或历史 soak/资源压力重跑。

## Review Focus

1. `execute()` 的 finally 会 `authority.revoke()`；正常完成后不能再用这个已释放 authority 的 `isCurrent()` 判断可否提交。Task 3 必须验证“正常释放可提交，外部停用/替换不可提交”。
2. Result 与 completed ACK 的到达顺序不能让 UI 把正文覆盖成普通完成提示；Task 5 验证两种顺序和紧接着的 Pipe 关闭。
3. 已安装插件与开发项目可能有相同 FeatureRef；Task 4 要绑定调用开始时选定的来源，授权失败或 reload 后不能转而运行另一来源。
4. 已返回的文本仍可能在 cleanup 失败、取消或换页后失效；Tasks 2、3、5 覆盖这些 race，不能只测成功 handler。
5. 用户停留在 AI 确认期间 provider 可能改变，面板也可能关闭；Task 6 验证拒绝旧决定、取消后不发送、reader/operation queue 不等待用户。

## Phase Boundary and Translation Entry Gate

本计划是 **6G-1 的 Quick Result 基础通路工作包**，不声称它已经完成整个 Translation Plugin 2.0。6G-0 已通过设计审核；本计划通过审核后才进入实现。

Translation 业务实现前必须另行完成并审核 Legacy capability parity matrix：MyMemory、Shared AI Translation、Qwen-MT、source/target language、engine/model/provider 偏好、credentials ownership、参数、限制、取消/超时、错误、metadata、现有 settings 及 exact-prefill/no-auto-translation handoff。Qwen-MT 若缺少可保持能力的公共接口，先提出最小 Translation-specific Host adapter；本计划不实现该 adapter、不以 Shared AI 替代其他 engine、不移除 Legacy。

## File Structure

| Responsibility | Files |
| --- | --- |
| 有界结果与私有消息合同 | 新建 `src/shared/feature-quick-result-contracts.ts`、对应 `.test.mjs`；修改 `src/shared/feature-invocation-contracts.ts`、对应 tests；C# 新建 `native/WebTools.NativeHost/Services/NativeFeatureQuickResultProtocol.cs` 并修改同目录现有 `NativeFeatureInvocationProtocol.cs`。 |
| Node 返回与独立 SDK 类型 | 修改 `electron/plugins/plugin-command-entry.ts`、`node-command-execution.ts`、`plugin-sdk/declarative-v1/node.d.mts`；新建 `electron/plugins/node-command-execution.test.mjs` 与 `plugin-sdk/declarative-v1/tests/command-result-public-api.typecheck.ts`。 |
| Main 调用、发送与取消 | 修改 `electron/services/feature-activation.ts`、`feature-invocation-service.ts`、`native-manager-client.ts`、`native-manager-commands.ts`、`native-manager-protocol.ts`、`electron/main.ts` 及相应现有 tests；新建 `electron/services/feature-activation.test.mjs`。 |
| 来源复核及开发态桥接 | 修改 `electron/plugins/plugin-manager.ts`、`plugin-development.ts`；新建或扩展其 focused tests；Main 和 Native Pipe 增加只在内存中的开发 Feature overlay。生产 Feature Registry/cache schema 不扩展。 |
| Native slot、展示及确认 | 新建 `native/WebTools.NativeHost/SuperPanel/SuperPanelQuickResultState.cs`、`native/WebTools.NativeHost.Checks/Phase6G1QuickResultChecks.cs`；修改 `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs`、同目录 `ManagerController.cs`、`native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml` 和 `.xaml.cs`；`native/WebTools.NativeHost.Checks/Program.cs` 只添加本轮检查入口。 |
| Shared AI presentation adapter | 新建 `electron/services/feature-quick-result-consent.ts` 与 `.test.mjs`；局部修改 `electron/plugins/electron-plugin-host.ts`、`web-host-capabilities.ts` 及其 tests，保留其他调用的原有确认路径。 |
| 作者说明与真实包验证 | 修改 SDK `package.json`、`README.md`、相关 public-api tests 和 `docs/plugin-development.md`；新建 `scripts/verify-super-panel-quick-result.mjs`、`docs/phase6g1-feature-quick-result-foundation.md`。原始证据保留在指定 D 盘测试目录。 |

仅在本表职责需要时修改对应文件；不得因为文件已 dirty 就把整段重写。新建 focused module 只承载本功能，不建立通用运行框架。

## Task 1: Closed Result and Negotiated Transport Contracts

**Interfaces:** Host `FeatureTextResult = { readonly kind: 'text'; readonly text: string }`；`parseFeatureTextResult(value: unknown): FeatureTextResult | null`；`FeatureQuickResultPayload = { resultVersion: 1; requestId: string; ref: FeatureRef; text: string }`；`FeatureResultControl = { requestId: string; ref: FeatureRef }`。C# mirror 使用 `NativeFeatureTextResult` 与相同边界。

- [x] 在新合同 tests 与 `Phase6G1QuickResultChecks.cs` 加入相同有效/无效向量：8192/8193 scalars、32768/32769 UTF-8 bytes、合法 Emoji、surrogate、NUL/control、空白、换行归一化、64 KiB envelope、getter、未知字段和错误 requestId/ref。
- [x] 为现有请求 parser 加入唯一可选 `quickResult: { version: 1 }`。只有 Super Panel selected-text 才可携带；版本未知、字段多余、Launcher/files/none 均拒绝。旧请求与旧 ACK 字节合同保持可用。
- [x] 为 `feature-result-v1`、`feature-result-cancel-v1`、`feature-result-clear-v1` 记录严格 payload parser。原始 JSON 的重复 key（包括转义后的相同 key）必须拒绝；Node 的 `JSON.parse` 已覆盖重复字段，因此在新消息类型进入对象 parser 前进行有界 token 检查。C# 枚举 JsonElement 属性检查重复。只作用于本轮新消息，不重写整个 frame codec。
- [x] 运行 `pnpm exec node --experimental-transform-types --test src/shared/feature-quick-result-contracts.test.mjs src/shared/feature-invocation-contracts.test.mjs`，确认新增要求先失败，再实现最小 parser，最终失败数为 0。
- [x] 添加 `--quick-result-checks` routing 后运行 `dotnet run --project native/WebTools.NativeHost.Checks -c Release -- --quick-result-checks`；确认 TS/C# 边界一致。之后各 Native task 使用同一 focused 入口扩充检查。

## Task 2: Optional Node Command Text Return

**Interfaces:** `CommandInvocation.resultTarget?: 'super-panel'`，`defineCommand` 接受 `void | FeatureTextResult | Promise<void | FeatureTextResult>`。Host 内部 `NodeCommandOutcome = { status: 'completed'; result?: FeatureTextResult } | { status: 'cancelled' }`。`NodeCommandExecutionAdapter.execute(authority, context?, options?: { resultTarget?: 'super-panel'; signal?: AbortSignal }): Promise<NodeCommandOutcome>`。

- [x] 新增 tests：旧 void handler、合法单次 text、非法返回、额外字段、重复 completed、超限、取消和 cleanup failure；断言 cleanup 未完成前没有下游发送。测试使用真实 adapter 与最小受控 child port，实际 Utility Process 留到 Task 8。
- [x] 更新 worker `start` 处理：只消费 Main 设定的 resultTarget；冻结 invocation；合法返回通过现有 completed 消息携带可选结果。Main 再独立校验；插件返回的身份字段不能用于关联。
- [x] 修改 adapter 只在 invocation 栈中有界暂存结果，完成原 finally/Utility Process cleanup 后返回 outcome。timeout/cancel/cleanup failure 丢弃正文；保留现有 30 秒、8 个活动命令与环境凭据过滤。不要移除已存在的 owned-child cleanup 行为。
- [x] 修改 router 接收 outcome。未提供结果目标时，合法 text 可完成但正文丢弃；有目标却返回 void 时显示“执行完成，未返回快速结果”。不生成新窗口或 Clipboard effect。
- [x] 在独立 SDK Node 类型中声明相同结构，避免 SDK 引用 monorepo 内部 TS；ESM/CJS 的 `defineCommand` 继续保持原来的函数包装行为。新增类型样例同时证明 void 和 text handler 可用，旧 Host guard 通过 `resultTarget` 返回 void。
- [x] 运行 `pnpm exec node --experimental-transform-types --test electron/plugins/node-command-execution.test.mjs plugin-sdk/declarative-v1/tests/developer-public-api.test.mjs`、`pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM --skipLibCheck plugin-sdk/declarative-v1/tests/command-result-public-api.typecheck.ts` 和 `pnpm run typecheck`，记录先失败和修复后的实际结果。

## Task 3: Main Ownership, Source Revalidation and Final Delivery

**Interfaces:** `FeatureActivationRequest` 增加仅供 Main 使用的可选结果目标和 AbortSignal；`FeatureActivationOutcome` 的 completed 分支可带 Task 2 的 result。`FeatureInvocationService.cancel(requestId: string, ref: FeatureRef): boolean`；`clearSession(): void` 取消 pending 并清空 replay。最终正文经 dependency `publishQuickResult(payload: FeatureQuickResultPayload): Promise<void>` 发送，invoke 返回值仍只有既有状态 ACK。

- [x] 为 `FeatureInvocationService` 和新 `feature-activation.test.mjs` 增加 tests：正常 cleanup 后可提交、停用/撤权/替换不可提交、session 变化、hide 取消、重复 replay 不重复发送、取消不等待 command 完成、ACK 前 idle ownership 不释放、正文不留在 replay promise/result 中。
- [x] 复用 `PluginManager.authorizeWebFeature` 现有 `current()` source predicate：Main 内部 dispatch 回调可接收第二个参数 `isSourceCurrent: () => boolean`。这个闭包检查 live record、enabled/grant、snapshot/hash/intent；它不受本次 authority 正常 release 位的影响，也不能发起 Host effect。现有只接收 authority 的调用保持兼容。开发来源在 Task 4 提供同等 predicate。
- [x] 保留外部撤权和 AbortSignal 的取消检查。`execute()` 返回后使用 source predicate、当前 invocation record、FeatureRef、同一 Pipe peer/session 和未取消状态复核；不得再次依赖必已 revoke 的 runtime authority，也不新增 grant epoch/通用 receipt。
- [x] 在现有 replay entry 上附加 pending cancellation metadata；不新增无界 map。完成后只保留原有状态/指纹。当前展示来源若需要 clear，仅保留一个不含正文的 requestId/ref/source binding，随新调用、clear 或断连释放。
- [x] 协商 `super-panel-quick-result-v1`，扩展现有 request/command 分派。先 await 最终结果消息的普通 Pipe ACK，再返回既有 feature-invoke completion；沿当前 `nativeManagerReply(..., afterAcknowledgement)` 释放 activation ownership。没有 candidate/commit 消息和额外 candidate ACK。
- [x] cancel/clear 使用当前已认证连接快速处理，不能进入等待 Feature 的 intent queue；session 清理只取消 pending，不发送“清除所有已提交结果”。clear 必须匹配原 requestId/ref，旧 clear 不能删除新结果。
- [x] 运行 `pnpm exec node --experimental-transform-types --test electron/services/feature-activation.test.mjs electron/services/feature-invocation-service.test.mjs electron/services/native-manager-client.test.mjs electron/services/native-manager-commands.test.mjs electron/services/native-manager-protocol.test.mjs electron/plugins/plugin-manager.test.mjs`；新增要求先失败，修复后失败数为 0。

## Task 4: Authorized Development Feature Bridge

**Interfaces:** `PluginDevelopment` 提供 Main-only 的当前开发 Feature 列表与 `authorizeFeature(ref, dispatch): Promise<{ completion: Promise<void> }>`；dispatch 与 Task 3 使用相同 authority/source-predicate 形状。开发 overlay 使用现有 FeatureProjectionV2 row 结构，通过协商后的私有 `feature-development-overlay-v1` 消息发送；清除使用同类型空 features，Native 仅在内存保存。

- [x] 在 `plugin-development.test.mjs` 加入已确认/未确认、断开、旧 revision、snapshot/hash 替换、同 ref 的 installed/development 并存、正在运行时 reload 的 tests。明确选中来源后失败只返回拒绝，不能 fallback 到另一来源。
- [x] 从当前 Host-validated snapshot 派生 Node Command selected-text Features；保持 FeatureRef/Manifest/API major 不变。开发列表和授权都读取现有 sessionId/revision/snapshot，不接受 Renderer 提供的 project path 作为 authority。
- [x] overlay 只供 Super Panel Quick Result 使用，已有生产 FeatureRegistry、`features-update`、生产 cache 文件和 Launcher 搜索保持原路径。相同 FeatureRef 的当前已批准开发来源在该 Super Panel 列表中优先，显示 Host 生成的“开发”来源标识；调用在入站时绑定选定来源，后续失效不回落到已安装版本。
- [x] Native 收到 overlay 时仍验证当前认证 peer、row 合同和总数量/字节限额；连接结束撤掉可调用开发入口，已接受正文的保留仍遵守 spec。Main 仍在线时的外部开发断开/reload 清除匹配结果；Electron 正常 idle shutdown 不被当作开发者撤权。
- [x] 开发会话关闭后重新启动 Host 不得从磁盘恢复开发入口；无新 sourceKind、持久化记录、grant 字段或公开 Native API。
- [x] 运行 `pnpm exec node --experimental-transform-types --test electron/plugins/plugin-development.test.mjs electron/services/feature-activation.test.mjs` 与 Native `--quick-result-checks`，确认开发 session 与 Manager Pipe session 的断开测试分别覆盖。

## Task 5: Native Result Slot and WPF Presentation

**Interfaces:** `SuperPanelQuickResultState.Begin(requestId, ref, localGeneration)`、`TryAccept(result, visibleGeneration)`、`TryClear(requestId, ref)`、`OnTransportDisconnected()`、`Dismiss()`；保存最多一个 pending/accepted slot。`ManagerController` 转发严格校验后的结果/clear，并提供直接 cancel 路径；窗口仍负责 UI thread、可见 generation 和原 context 生命周期。

- [x] 在 `Phase6G1QuickResultChecks.cs` 增加状态 tests：错 requestId/ref/generation、重复结果、结果先于/后于 completed 状态、hide/reopen、新 capture/Feature、断连发生在 pending 或 accepted 状态、旧 clear、来源撤权、长文本有界滚动。
- [x] 在 `NativeManagerPipeServer` 协商后增加结果/clear/开发 overlay 接收，reader 不等待用户或异步 UI。最终结果先验证，再 dispatch 到当前窗口；拒绝的结果不能触发面板自动重开。
- [x] 在现有 Selected Text 布局中加入纯文本结果与 Host 来源，布局有界并使用现有主题/density tokens。不修改 Copy capture、约 50ms 首轮检查、真实紧凑首帧、non-activating 配置、HWND 复用、动作列表虚拟化。
- [x] Command 点击在当前 generation 登记 slot；只有 source/context/command/协商均符合才请求 Quick Result。completed feedback 不清除 accepted result；void 有固定提示，失败有固定短错误，无原始 stack、富文本、按钮或自动重试。
- [x] dismiss/Escape/outside click/Launcher/new capture/another invocation 立即清空本地 slot，并尽力取消 pending；transport disconnect 只废除 pending 接收权，不清除已接受正文。后续新 Pipe session 不恢复旧 pending，也不抹掉 inert result。
- [x] 运行 `dotnet run --project native/WebTools.NativeHost.Checks -c Release -- --quick-result-checks`；记录实际断言，不把非可见状态测试记成鼠标/视觉验收。捕获/剪贴板路径未改动时不重复真实复制测试。

## Task 6: Shared AI Consent Presentation Adapter

**Interfaces:** Main 的 `FeatureQuickResultConsent.confirm(requestId, ref, consent, signal): Promise<boolean>`，通过 `feature-ai-confirm-v1` 登记当前同窗确认；Native 用 `feature-ai-decision-v1` 发送 `{ requestId, ref, consentId, approved }`。两者受同一协商能力、当前 peer 和 invocation 限制。provider identity 仅在 Host 中复核，Native 只收到安全标识/名称和有界 preview。

- [x] 在新 consent tests 与既有 Host capability tests 覆盖：点击 Feature 尚未发送；approve 一次发送；cancel/timeout/hide 不发送；重复/旧 consentId、provider change、grant revoke 和断连拒绝；同一个 user gesture 没有被确认前后各消费一次。
- [x] 为当前 Quick Result invocation 传入 `confirm` adapter，复用现有 Shared AI service 与 capabilities。现有 MessageBox 在其他调用继续使用；不把所有插件确认重构成平台框架。
- [x] Native 确认请求快速 ACK 后在 reader 外显示固定文案“确认发送至当前共享 AI 服务？”，以及 Host 生成的身份、preview、“取消”“确认发送”。decision 同样快速 dispatch；UI 不提供任意回调/标签。
- [x] Host 将决定绑定同一 provider identity，并在真正发送前重新检查当前 provider/authority/signal。provider 改变必须重新调用；确认等待计入原 30 秒预算。Native 不接收 raw key、SecretStore DTO 或带凭据 endpoint。
- [x] provider acceptance stub 只用于隔离验证；无真实付费请求。取消断言限于阻止尚未发送、AbortSignal、本地停止等待和丢弃迟到结果。
- [x] 运行 `pnpm exec node --experimental-transform-types --test electron/services/feature-quick-result-consent.test.mjs electron/plugins/web-host-capabilities.test.mjs` 与 Native `--quick-result-checks`，验证等待确认期间 cancel/clear 仍可完成，operation queue 无互等。

## Task 7: SDK Tarball and External Author Workflow

**Deliverable:** 使用同一个 SDK Node public subpath 的 repo 外示例。SDK 新增返回类型是向后兼容 API，实施版本计划为 `1.7.0`；Product Version、Plugin API Major、Manifest Version 和无代码变动的 creator 保持当前值。仅生成本地测试 tarball，不发布到 registry。

- [x] 更新 SDK public-api/package inventory tests，保证 `.tgz` 包含 Node 类型、ESM/CJS 入口，且不依赖 checkout 私有文件。作者文档解释 optional `resultTarget`、void 兼容、未协商时的 fallback、限额、生命周期和 Node 当前用户代码信任模型。
- [x] 从 `plugin-sdk/declarative-v1` 执行 `pnpm pack --pack-destination <run-root>\sdk`；记录包名、版本、文件大小与 SHA-256。tarball 和原始包不入 Git。
- [x] 在 `<run-root>\author` 仅安装该 local tarball，创建 Selected Text Node Command 示例；使用公开 `defineCommand` 和既有 capabilities，不引用 monorepo/private IPC。示例用固定合成文本或本地纯计算，不伪称真实 Translation。
- [x] 在该外部项目用 local tarball 建立 lockfile 后执行 `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run build`、`pnpm exec webtools-plugin validate . --host-version 0.1.0 --json`、`pnpm exec webtools-plugin pack . --out <run-root>\fixtures\quick-result.wtplugin --host-version 0.1.0 --json`、`pnpm exec webtools-plugin inspect <package> --host-version 0.1.0 --json`，再通过真实 Host validator。
- [x] 同一示例分别连接 development workflow 和经验证安装的 packaged workflow，结果分别标记 `DEVELOPMENT WORKFLOW PASS` / `REAL PACKAGED PASS`。新增 optional 能力不能用虚构的 minHostVersion 区分同为 0.1.0 的旧/新 Host；作者必须 guard 协商结果，真正的发布版本门留给 Translation/package release 决策。
- [x] 修改 `docs/plugin-development.md` 和 SDK README 中的现行作者说明，保留历史验收数值和 Phase 6F-5 证据。

## Task 8: Regression, Packaged Acceptance and Report

- [x] 创建一次性的 `verify-super-panel-quick-result.mjs` runner，参数为 `--root <run-root> --native-root <isolated-native> --manager-root <isolated-manager> --package <validated-package>`。使用现有明确 opt-in、隔离 Profile/Pipe 和真实 Release NativeHost/packaged Manager/Utility Process；仅做测试所需接线，不给产品添加公共测试 IPC。
- [x] 运行 `pnpm run typecheck`、`pnpm test`、`pnpm run build`、`dotnet run --project native/WebTools.NativeHost.Checks -c Release`、`dotnet run --project native/WebTools.UpdateHelper.Checks -c Release`；记录实际测试数量与失败数。只因新增失败或改动重跑受影响部分。
- [x] 执行一次 `pnpm run package:win` 生成隔离 acceptance candidate，记录源 commit + dirty 状态、构建时间、Native/Manager/app.asar/SDK/插件 SHA-256；不覆盖真实安装。构建与运行子进程的 TEMP/TMP 均位于指定 D 盘目录。
- [ ] 使用 runner 验证真实 Node return → cleanup → Main live revalidation → authenticated Pipe → WPF accepted result；测试 void、无协商、超限/非法结果、取消、cleanup failure、来源替换、开发 reload、Pipe pending disconnect、accepted disconnect/reconnect、clear race。中途失败保留 evidence，不把 fixture 单测记作真实 packaged PASS。
  - 最终 18/18（16 REAL PACKAGED、2 DEVELOPMENT WORKFLOW）通过；无协商/边界/clear race 与 cleanup refusal 分支另有 focused 回归。未人为制造真实 OS cleanup refusal，不将 fake-child 单测写成该情景的真实运行 PASS，故此整项不作无保留勾选。
- [x] 关闭隔离 Manager/Plugin Window，观察 exact-path Electron/Utility 进程归零而 Native 保留已接受正文；再次调用仍可工作。最终正常退出测试 Native。清理只针对已验证身份；绝不按名称批量结束。
- [x] 真实鼠标与视觉 sanity — `USER CONFIRMED PASS`：用户确认所要求的人工测试无问题，包括此前报告的面板高度问题。确认覆盖 Selected Text 操作、同窗 AI 确认、长正文滚动、Escape/外部点击、主题、旧内容清理及首帧/捕获行为等本计划列出的人工检查；没有逐项截图、时间戳或运行日志，因此不标记为独立机器验证。
- [x] 生成 sanitized evidence JSON 于 `<run-root>\evidence\quick-result-acceptance.json`；记录 case/status、产物身份、进程身份与清理结果，正文/提示词/凭据不写证据。仓库报告只引用 evidence 路径、SHA-256、实际结果和局限。
- [x] 更新 `docs/phase6g1-feature-quick-result-foundation.md`，逐项对照 spec §12。P0/P1/blocking P2 或必需 manual 项未关闭时保持 INCOMPLETE；全部满足才能记录 `QUICK RESULT FOUNDATION COMPLETE`。这不等于 `PHASE 6G-1 TRANSLATION PLUGIN 2.0 COMPLETE`。
- [x] 运行 `git diff --check`，检查新增文件 whitespace，报告本轮 diff 和全部剩余 dirty files；不 stage/commit/push。停止在本工作包，不开始 Legacy migration/removal。

## Plan Review and Execution Gate

本计划已经覆盖已批准设计的公共返回类型、TS/C# 限额、生产与开发授权、最终结果排序、pending/accepted 两种生命周期、同窗 AI consent、外部 SDK、真实打包通路、用户数据保护及证据标签。

本计划已由用户审核并授权实施，按 Task 1 → Task 8 执行。Translation parity review 及其后的业务方案仍需按前述 entry gate 独立审查，本计划不提前批准 Qwen-MT adapter 或 Legacy 迁移。

## Execution annotations — 2026-10-16

执行报告：`docs/phase6g1-feature-quick-result-foundation.md`。既有 dirty checkout 和 Launcher/Panel 工作逐段保留；没有 stage/commit/push。

- Legacy hello 的能力列表是闭合集合，因此 Quick Result 通过当前已认证 Pipe 的 post-hello 请求协商；旧 hello 不增加未知 capability。
- 原计划较长的 runtime 目录使开发包的 cwd 超过 Windows 限制。运行证据确认普通及 namespaced `chdir` 均返回 ENAMETOOLONG，尝试的产品 cwd 改动已撤回。最终 runtime/author/profile 改放用户指定 D 盘目录内的短路径 `D:\SystemDefault\Desktop\webtoolstest\qr6g1-1016`；完整日志、tarball、baseline、旧失败记录仍在 `D:\SystemDefault\Desktop\webtoolstest\phase6g1-quick-result\20261016-152813`。只调整测试子进程 TEMP/TMP，未放宽安全校验或改系统环境。
- 为真实 WPF/Node 通路补充 opt-in 控制接线、现有 packaged acceptance 的固定开发项目 chooser；不新增公开测试 IPC。原 resource-test exit 在显式 shutdown 模式下只关闭窗口，已改为测试进程显式 WPF shutdown；清理先等待 Manager 进程组退出。
- 真实运行发现 Utility 入口必须使用 `process.parentPort`；已做最小修复和先失败后通过的回归。最终合同复核补充 BOM/NEL 跨语言一致性和开发来源名称 surrogate 边界。
- 失败用例还揭示通用错误路径会在面板反馈之外弹出 Native MessageBox，影响 transient 行为与退出。Quick Result 的执行/transport/startup 错误改由当前面板反馈，保留普通 Launcher 错误行为；真实 runner 增加逐项 Native 错误弹窗为零断言。
- 重连后停用原插件的真实回归发现旧 Main 的 displayed metadata 已释放，无法清除 Native 保留文本。私有、幂等协商回执最小增加 accepted requestId/ref（无正文、无 pending）；相关插件/开发来源变更时查询并发送既有 exact-binding clear，不重建旧执行、replay 或新增持久化/epoch/receipt。正常断连/重连本身仍不清除文本。
- Task 8 必须分别报告单测、真实 packaged 和 development 证据。实际 OS cleanup refusal 未强行制造；其拒绝结果的分支使用 fake-child 回归，不冒充真实 OS failure 验收。
- 后续用户确认：本计划要求的人工检查测试通过、未发现问题，并包括先前报告的面板高度问题。人工证据标签为 `USER CONFIRMED PASS`；未提供逐项截图、时间戳或机器日志。该确认关闭 Quick Result foundation 的人工验收，不证明真实翻译、词典、内容匹配或 Translation Plugin 2.0 已实现。

## Product Alignment Addendum — 2026-10-16

This addendum records the evidence comparison and forward plan. The user-confirmed manual acceptance recorded above closes the Phase 6G-1 Quick Result foundation only; it does not rewrite the historical Phase 6G-0 specification, change historical automated evidence, authorize implementation, or mark Translation Plugin 2.0 complete. The product decision below records a narrowly scoped Phase 6G-3 exception for the built-in translation preview; generic Feature invocation remains subject to the Phase 6G-0 explicit-activation rule.

### Evidence Rules and Current Comparison

The comparison below uses the current WebTools source and the supplied local uTools 7.8.0 analysis. No application was launched and no runtime behavior was newly verified for this planning revision.

| Area | Finding | Evidence status |
|---|---|---|
| uTools selected-text commands | Static excerpts show selected-text matching populating searchResult. This is an available-action list, not proof that an action has already run. | [已由代码/官方资料证实（静态）] |
| uTools fixed panel menu | panelMenus / panelMenuCmds is separate state from text-matched searchResult. Do not treat pinned panel shortcuts as selected-text matches. | [已由代码/官方资料证实（静态）] |
| uTools translation preview | Static matchSearch has a distinct translateResult path, gated by _useTranslate, a text-length limit, and timestamp/English-oriented heuristics; the renderer can display it alongside searchResult. This is not the generic plugin-command Quick Result and does not establish a general dictionary implementation. Trigger timing and runtime behavior remain unverified. | [已由代码/官方资料证实（静态）] [待运行验证] |
| uTools screenshot | The supplied image shows an action list, a definition-like preview, and a selected-text footer in one frame. It does not establish what triggered the preview, when it appeared, or whether it came from a plugin or built-in service. | [仅由截图观察] |
| uTools action routing | Static source distinguishes plugin entry (enterPlugin) from local/native action routes. Selection is passed through applicable command routes, but not every action opens a plugin window or displays its result in the panel. | [已由代码/官方资料证实（静态）] [待运行验证] |
| WebTools selected-text matching | SuperPanelFeatureMatcher.MatchesSelection checks text context type and source; it does not inspect selected text, language, keywords, or feature-specific content. File/directory rules additionally check source, kind, count, and declared extensions. Current text discovery is capability/context matching, not text-content matching. | [已由代码/官方资料证实（静态）] |
| WebTools selected-text preview | TextContextRoot displays a bounded preview of the captured source text. This is context presentation only; it is not a translation, dictionary definition, or Feature result. | [已由代码/官方资料证实（静态）] |
| WebTools Quick Result | A user-clicked selected-text Node Command can return bounded plain text through the existing Main/Utility cleanup, authenticated Manager Pipe, and Native/WPF path. QuickResultSurface and ActionList are distinct visual elements; receiving a result reveals the result surface without hiding the action list. Source supports coexistence; the user subsequently reported the requested visual checks passed, without per-case machine evidence. | [已由代码/官方资料证实（静态）] [USER CONFIRMED PASS] |
| WebTools built-in Translation | FeatureInvocationService routes built-in Translation separately and rejects the Node Quick Result option for it. A selected-text Super Panel invocation sends text through the existing Manager Translation handoff. TranslateView assigns the prefill and schedules translation after 450 ms when mounted, settings-ready, configured, and eligible. This is not an in-panel Quick Result. Packaged UI/provider behavior is not established by source inspection. | [已由代码/官方资料证实（静态）] [待运行验证] |
| WebTools independent plugin Window context | Static code passes context through FeaturePresentationRouter → PluginWindowManager → WebPluginRuntime / WebHostCapabilities; SDK context.current() exposes the validated current context to an eligible Feature. The path exists and should be runtime-verified with the packaged application; it is not a missing-code item by default. | [已由代码/官方资料证实（静态）] [待运行验证] |
| WebTools list/layout reliability | Native checks cover selected-text refresh, pinned Translation ordering, action-list scroll reset, and a small-work-area first-item case. These are automated state/control checks, not real mouse-driven visual acceptance. | [已由代码/官方资料证实（静态）] [待运行验证] |
| IDA target boundary | IDA inspected `D:\SystemDefault\Desktop\rea\uTools-7.8.0.exe`; searches for `voicePanelTriggerEvent\|stopVoicePanelTriggerEvent\|translate` returned zero. That target/search does not establish renderer translation behavior. The translation-path evidence here comes from hash-matched `app.asar` JavaScript excerpts and static analysis. | [已由代码/官方资料证实（静态）] |

Sources checked:

- WebTools: native/WebTools.NativeHost/SuperPanel/SelectionContext.cs, SuperPanelFeatureSelection.cs, SuperPanelWindow.xaml, SuperPanelWindow.xaml.cs, SuperPanelPresentationChecks.cs, electron/services/feature-activation.ts, electron/services/feature-invocation-service.ts, electron/services/builtin-translation-handoff.ts, native/WebTools.NativeHost/Services/ManagerController.cs, src/features/translate/TranslateView.vue, electron/plugins/plugin-window-manager.ts, electron/plugins/web-plugin-runtime.ts, electron/plugins/web-host-capabilities.ts, and plugin-sdk/declarative-v1/web/invocation-context.mjs.
- uTools: D:\SystemDefault\Desktop\rea\utools-superpanel-analysis.md, D:\SystemDefault\Desktop\rea\utools-superpanel-evidence\utools-superpanel-source-excerpts.json, D:\SystemDefault\Desktop\rea\uTools-7.8.0-analysis\analysis\webtools_comparison.md, analysis/plugin_platform_comparison.md, analysis/features/plugin_platform.md, and evidence/app_asar_feature_excerpts.json.

Static code paths establish implementation structure only. They do not prove focus, selection capture, automatic trigger timing, window switching, clipping, scrolling, or successful real-plugin execution. Those require runtime evidence.

### Phase 6G-1 Boundary and Acceptance Status

Phase 6G-1 is the provider-neutral transport and same-panel presentation foundation. It establishes that a selected-text Node Command can be explicitly invoked and return bounded plain text to the existing Super Panel. WebTools already displays a bounded preview of the selected source text; that is not a translated or dictionary result. Phase 6G-1 does not deliver real translation, a dictionary, automatic translation preview, uTools parity, or final user UX.

The initial execution report was written before the user supplied manual results. The user has since confirmed that the requested manual checks passed without issues; record that only as `USER CONFIRMED PASS`, not as independent machine verification. Synthetic Quick / Synthetic Long are isolated test-fixture commands, not normal user-facing actions: they verify that an explicitly invoked Node Command can return bounded plain text to the same panel, that a longer payload remains readable/scrollable, and that the action list remains present. They do not test Translation, dictionary lookup, automatic translation, selected-text content matching, or the intended production action list.

Keep the report's automated counts, package identities, and evidence references unchanged. The Phase 6G-1 Quick Result foundation is now complete based on the automated evidence plus the user's manual confirmation. That result does not close real translation, dictionary, selected-text content matching, or broader parity work; those remain separate follow-on scope.

### Approved Product Boundary

The Phase 6G-0 explicit-activation rule remains authoritative for generic Features: capturing text, matching actions, or showing the panel does not invoke an arbitrary Feature. The user must explicitly activate an applicable action before that Feature runs.

**Narrow Phase 6G-3 product decision:** after the existing Super Panel gesture opens the panel and capture returns selected text, the built-in Translation service may automatically produce a preview in that same panel when the user has enabled the preview setting and the text passes the approved eligibility rules. This is not a popup on text selection alone, does not invoke a plugin Feature, and does not remove explicit activation for other actions. The selected text may leave Native only for this opted-in, eligible translation request, through the existing Main/provider ownership and authenticated result-delivery boundaries; matching alone remains local and must not disclose or persist the text. This planned exception does not rewrite the 6G-0 specification or authorize implementation before the revised plan is approved.

The separate Translation action remains available and keeps its existing Manager handoff in this plan. The new preview is a distinct same-panel result path; it is not a standalone translation window and is not a replacement for the Manager Translation page. The Manager page's existing auto-translate-after-prefill behavior is not evidence that the Super Panel preview already exists.

The current TranslateView auto-schedules a provider request after prefill when runtime prerequisites are met. The older roadmap's “prefill-only” statement therefore does not describe the current source path. The planned 6G-3 behavior keeps the Manager handoff and same-panel preview as separate routes; verify each independently and do not treat the Manager's prefill timer as proof that the Super Panel preview exists. This remains a source/design discrepancy, not evidence that a provider request was observed at runtime.

### Proposed Dependency-Ordered Follow-on Work

The user authorized implementation of revised Phase 6G-3 on 2026-10-17. The execution note below records that work. Phase 6G-4 remains a separate unstarted decision; approval of 6G-3 does not authorize it.

#### Phase 6G-1 Closeout — Real UI Acceptance

- **User-visible goal:** Confirm the implemented Quick Result foundation in the actual packaged Super Panel.
- **Current code:** Existing selected-text Node Command → Main → authenticated Pipe → WPF path, action list, and bounded result surface.
- **Planned code scope:** None unless acceptance finds a reproducible defect; then propose only affected files and focused checks.
- **Acceptance:** Real mouse activation; result and action list co-present; short/long fixture payload readability; bounded scrolling; Escape/outside dismissal; theme and low-height behavior; no stale result after a new selection or dismiss. Record fixture checks only as Quick Result transport/presentation evidence. They are not the expected selected-text product flow and cannot establish real Translation or dictionary behavior.
- **Automation / manual:** Reuse existing 18/18 packaged evidence and Native checks where applicable. Human checks cover actual pointer/keyboard and visual behavior automation did not exercise.
- **Assumptions / risk:** Existing evidence is isolated-runtime evidence, not live-install evidence. Do not repeat unrelated 6G-1 protocol tests just to create a new timestamp.
- **Classification:** Basic foundation closeout.

#### Phase 6G-2A — Selected-Text Content Matching (Basic Parity)

- **User-visible goal:** Show actions that fit both the selected-text context and the selected content; an action list should not be only a generic set of every text-capable Feature.
- **Current code:** acceptedContexts and SuperPanelFeatureMatcher select by context type/source. No text-content, keyword, or shape matching exists.
- **Planned code scope:** Treat content-aware matching as a basic selected-text capability. Matching runs locally in NativeHost against the transient in-memory `SelectionContext`. Main/Electron may project only bounded, validated declarative rule metadata and Feature identity; the projection/cache must never contain the selected-text value. First approve the smallest closed rule contract grounded in actual first-party actions and external-search use cases, then update the authoritative Manifest/projection validators and NativeHost matcher. Candidate files: SelectionContext.cs, SuperPanelFeatureSelection.cs, Feature projection and Manifest contracts/validators, plus focused checks and docs. No executable plugin matcher, unbounded rule engine, or copied uTools schema.
- **Data boundary:** Discovery must not send selected text to Electron/Main, persist it, or write it to logs/diagnostics. A later explicit user activation may pass the selected context only through the existing authorized Feature invocation path; that operation handoff is separate from matching. Keep the contract scoped to preventing disclosure/storage for discovery, not to suppressing the intentional context transfer required by an activated action.
- **Acceptance:** Establish a behavior table for free text, English, Chinese, mixed/long text, URL-shaped text and any other explicitly supported input. Confirm which actions match each input, that non-matching content-specific actions are absent, and that actions declared as general text actions remain available. Matching must be deterministic, bounded, language-safe and independent of display truncation. No selection still shows the existing general shortcut board. Verify the serialized projection contains only allowed matcher metadata, and that matching alone produces no selected-text IPC, persistence, or diagnostic/log content.
- **Automation / manual:** Automated tests cover each approved rule, normalization, bounds, empty/malformed input and backward compatibility. Instrument the discovery path and assert that the selected-text sentinel is absent from IPC/pipe payloads, persisted projection/cache, and diagnostic/log output before activation. Separately verify an explicitly activated action receives only its intended context through the existing authority path. Manual packaged checks confirm the actual action list for representative input and no-context states.
- **Assumptions / risk:** uTools app.asar excerpts provide static evidence of content-oriented command matching, but do not establish that WebTools should copy its exact regex/heuristic semantics. The rule vocabulary is a contract gate before implementation, not a reason to postpone content matching to a differentiated phase.
- **Classification:** Basic product capability and parity gate.

#### Phase 6G-2B — Real Text Actions and Selected-Context Handoff

- **User-visible goal:** Clicking the real built-in Translation action or an eligible plugin action sends selected text to the intended existing workflow.
- **Current code:** Built-in Translation uses the Manager prefill route; Web Feature Windows already receive context through the router/runtime/capability path.
- **Planned code scope:** First add isolated packaged acceptance around FeatureInvocationService, ManagerController / translation-prefill, TranslateView, FeaturePresentationRouter, PluginWindowManager, WebPluginRuntime, WebHostCapabilities, and SDK context.current(). Change production code only after a reproducible failure or approved behavior mismatch.
- **Acceptance:** Verify exact text reaches Manager Translation and establish whether/when configured translation starts; verify an eligible packaged plugin Window reads its selected-text context and that a later invocation replaces it. No selected text in logs/diagnostics. No paid provider or real secret.
- **Automation / manual:** Use isolated stubs/controlled results. Manual Windows acceptance checks the packaged app and window transitions; report provider invocation separately from prefill.
- **Assumptions / risk:** Static source schedules translation 450 ms after prefill when configured. Reconcile this with the older prefill-only roadmap promise before accepting behavior.
- **Classification:** Basic real-operation integration. Manager handoff is not in-panel Quick Result.

#### Phase 6G-2C — Panel Result, List, and Lifecycle Reliability

- **User-visible goal:** Keep selected-text actions usable while a Quick Result is shown, without stale or clipped content.
- **Current code:** WPF has separate QuickResultSurface and ActionList; ReceiveQuickResult reveals the result surface without removing the list. RefreshFeatures resets action-list scroll. Existing checks cover portions of refresh, scroll reset, truncation, and constrained-height layout.
- **Planned code scope:** Acceptance-first. If reproducible gaps remain, candidate files are SuperPanelWindow.xaml, SuperPanelWindow.xaml.cs, SuperPanelPresentationChecks.cs and the existing focused verification entrypoint. Do not change capture budgets or add fixed waits without evidence.
- **Acceptance:** First short selection, long selection, repeated same selection, previous list scroll then new context, projection refresh while open, no-selection board, low available height/DPI, late result after input/context switch, empty/void result, error, duplicate trigger, cancel, Escape, outside click, and close. No old text flashes or overwrites newer state; first eligible action is reachable and the list remains independently scrollable.
- **Automation / manual:** State/generation/scroll/bounds assertions are automated. Real capture, mouse visibility, visual clipping, focus, and dismissal remain manual packaged checks.
- **Assumptions / risk:** Existing checks make some scroll/clipping assumptions testable but do not prove every monitor/DPI combination. Separate reproducible defects from screenshot-only observations.
- **Classification:** Basic reliability/correctness gate.

#### Phase 6G-3 — Real Translation Quick Result

- **User-visible goal:** After the user opens Super Panel with the existing gesture and selected-text capture succeeds, automatically show a real translation preview in that same panel when the user-enabled setting and bounded text-eligibility rules allow it. No second click on the Translation row is required for the preview. The eligible action list remains visible. This is not an automatic panel popup merely because text was selected.
- **Pre-6G-3 baseline:** 6G-1 provides generic Node Command Quick Result and same-panel presentation. Built-in Translation followed the separate Manager handoff and rejected the generic Quick Result option. `TranslationService` owns the existing configured providers; the Manager `TranslateView` schedules translation after eligible prefill, but that route opens/uses the Manager page and is not a Super Panel preview. There was no equivalent Super Panel auto-preview preference; the 6G-3 execution note records the newly implemented adapter and preference.
- **Planned code scope:** Add a minimal user-controlled Super Panel preview preference and a Host-owned adapter that accepts only the current captured context generation, passes bounded eligible text to Electron Main only after the setting and local eligibility checks pass, invokes the existing `TranslationService`, then returns bounded loading/result/unavailable/error state over the authorized Main/Native path into WPF's same-panel result surface. Reuse the configured provider, source/target language, credentials, provider-specific limits, existing consent/permission checks, cancellation, timeout, and error ownership. Keep the existing Translation action → Manager handoff intact. Do not add a second translation service in Native, a translation plugin, a new provider or credential store, a plugin API/Manifest field, or a generic automatic Feature invocation mechanism. This phase does not implement Translation Plugin 2.0 migration or its legacy capability-parity matrix.
- **Eligibility and privacy boundary:** Matching and eligibility evaluation stay in Native and use only transient in-memory selection data. The text is transmitted to Main/provider only when the panel has been triggered, capture succeeded, the preference is enabled, the approved text heuristic accepts it, and the selected provider's configuration/consent rules permit a request. Do not put selected text in logs, diagnostics, projection/cache, or persistent settings. Do not bypass Shared AI or provider confirmation, cost, quota, or permission gates. Do not retry automatically.
- **uTools evidence and limits:** The supplied local uTools 7.8.0 analysis identifies the analyzed `app.asar` as SHA-256 `16a9f407bd886ae5a2a2b3c1c313248ef95cb2e37aaa9375e3b9d37003a853d5`. Static excerpts show a `translateResult` path separate from the matched action list: with the translation setting enabled, text under uTools' own 500-character condition is checked by timestamp and English/identifier-oriented heuristics, then `window.services.voice.translate(text)` is called and the preview can render alongside `searchResult`. The package path routes through uTools' own preload/main service to a configured remote translation URL, so this is not evidence of a local-only dictionary or a generic plugin Quick Result. The threshold and heuristics are uTools-specific references, not WebTools requirements. IDA inspected `D:\SystemDefault\Desktop\rea\uTools-7.8.0.exe`; searches for `voicePanelTriggerEvent|stopVoicePanelTriggerEvent|translate` returned zero. This does not establish the renderer translation path. The decisive evidence for that path is the hash-matched `app.asar` static JavaScript. These are static-source findings, not runtime verification of trigger timing, focus, or UX.
- **Acceptance:** No automatic-preview request for ordinary text selection without the Super Panel gesture, failed/empty capture, disabled preference, or text rejected by the approved heuristic. The automatic-preview path issues at most one request per eligible capture generation; an intentional click on the separate Manager Translation action is tested as a distinct existing route. Show explicit loading, translated result, provider-not-configured/permission-required, and provider-error states without hiding the action list. A new capture, close, Escape/outside dismissal, cancellation, or superseding request must cancel or invalidate the old preview. Long, unsupported, or provider-over-limit input must not be silently truncated or sent. Existing Manager Translation handoff must still work independently. Verify selected text is absent from logs, diagnostics, persisted settings, and feature projections; only the opted-in, eligible translation request may carry it to Main/provider.
- **Automation / manual:** Automated tests use a free local translation stub to cover the setting, eligibility, one-request-per-generation, provider admission, bounded result, cancellation, stale-result rejection, no-text logging, and action-list/result coexistence without real credentials or network calls. Manual packaged acceptance covers opting in/out, representative eligible English text, Chinese/mixed/non-matching and over-limit text, no selection, loading/result/error states, close/new-selection races, action-list usability, and the unchanged Manager handoff. A configured real provider may be tested only with the user's explicit acceptance of external transmission/cost; never capture credentials or selected text in evidence.
- **Assumptions / risk:** The execution rulings below define the default-off opt-in, first-party admission, English-oriented grammar and provider-specific bounds. The grammar is not general language detection and can also accept other Latin-language words. The uTools 500-character bound is not a WebTools constant. Runtime evidence must distinguish controlled local-stub execution from actual provider, physical selection and visual acceptance.
- **Classification:** Basic selected-text product capability and same-panel translation preview, after 6G-2 matching/integration/reliability. It is distinct from the already-existing Manager Translation page and from generic plugin Quick Result.

#### Phase 6G-4 — Differentiated Text Intelligence

- **User-visible goal:** Consider dictionary/definition preview or adaptive action ranking only after the basic selected-text matching, real operations, same-panel translation preview, and lifecycle/layout reliability are accepted.
- **Current code:** The supplied WebTools source does not establish a general dictionary provider/result path. The uTools screenshot shows a definition-like preview, but does not establish its source, trigger, or implementation. The static uTools translation path is already assigned to 6G-3 and is not a dictionary guarantee.
- **Planned code scope:** No automatic translation preview work remains in 6G-4. Any dictionary/definition capability requires a separate decision on a real source/provider, trigger, setting, privacy/external-service impact, cancellation, bounds, accessibility, and coexistence with the action list. Adaptive ranking also needs a concrete user problem and measurable rule before scope is approved. This section does not authorize implementation or introduce an open-ended intelligence framework.
- **Acceptance:** For each separately approved capability, define no-selection behavior, supported language/content/length, opt-in, external cost/privacy, empty/error state, cancellation, stale-result handling, and action-list interaction before implementation.
- **Automation / manual:** Use isolated provider stubs and focused packaged runtime/UI acceptance. Synthetic Quick/Long samples are transport fixtures only and cannot be presented as real translation or dictionary results.
- **Assumptions / risk:** uTools static source establishes a translation-specific heuristic route, not a general dictionary guarantee; screenshots do not establish trigger timing or product policy.
- **Classification:** Deferred differentiated capability; not a prerequisite for 6G-3 basic translation preview.

### Product Decisions Still Open

1. **Translation preview trigger — resolved for planning:** The built-in preview is planned to start automatically only after the existing Super Panel gesture, successful selected-text capture, enabled preference, and approved eligibility checks. It appears in the same Super Panel. Text selection alone does not open the panel, and other Feature actions remain explicitly activated.
2. **Preference UX/default — execution ruling, 2026-10-17:** Implemented as “英文选区自动翻译预览” in existing Super Panel Settings, default OFF, with external transmission/cost notice and Apply/Cancel. Its explicit opt-in authorizes this first-party automatic route; existing TranslationService admission/configuration still applies. Plugin per-invocation consent is neither reused nor bypassed to authorize built-in Translation.
3. **Eligibility and bounds — execution ruling, 2026-10-17:** Implemented a bounded English/identifier shape heuristic using ASCII letters/digits, whitespace and common sentence punctuation/typographic quotes/dashes. Chinese/mixed/Emoji, URL/email/code-symbol shapes, and pure numbers are excluded. The existing 3,000 UTF-16 capture cap applies; an explicitly truncated capture is never automatically sent. MyMemory's existing 500 UTF-8 byte cap is separate from the uTools 500-character reference. Other provider bounds remain owned by existing TranslationService/adapters. An auto source resolves to English for this eligible preview only; explicit non-English source is not overridden. This heuristic is not general language detection.
4. **Translation result surface — resolved for planning:** The automatic preview is a same-panel result that coexists with the applicable action list. The existing Translation action and Manager page remain separate; this plan does not convert the action into a standalone-window replacement or label Manager prefill as a panel result.
5. **Dictionary/definition preview:** Defer as differentiated work until a real source/provider, trigger, settings, and privacy behavior are selected. The screenshot alone is insufficient evidence.
6. **Text-content matching:** Keep the smallest bounded declarative matching contract in 6G-2A as basic action discovery. Approve its vocabulary from real first-party use cases; do not add executable matchers or an open-ended rule engine.

### Phase 6G-3 Execution Note — 2026-10-17

The revised 6G-3 has entered implementation under the user's instruction to execute this plan. The Host-owned adapter reuses existing TranslationService providers and the authenticated Quick Result envelope, with Native loading state and bounded result/error copy; no new plugin return type or public capability was introduced. Generic Node Quick Result remains explicitly activated. The existing Manager Translation action remains a distinct route.

The implementation report and exact verification limits are maintained in [Phase 6G-3 report](../../phase6g3-super-panel-translation-preview.md). Automated checks do not replace real physical selection, mouse, monitor/DPI, or paid-provider acceptance. No stage/commit/push is authorized by this execution note; 6G-4 remains unstarted.
