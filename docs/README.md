# WebTools Documentation

本文档索引按主题列出当前架构说明和重要阶段记录。Phase 报告保留了当时的实现范围与测量口径；阅读历史性能数据时，请同时查看报告中的构建版本和验证限制。

## 当前状态与累计提交

- [2026-10-21 累计变更与提交说明](2026-10-21-platform-consolidation.md)：以 2026-10-09 的 `707c567` 为上次源码提交基线，整理 Runtime、SDK、Super Panel、翻译与生命周期变更，列明验证范围和待验收项目。
- [窗口焦点与生命周期设计](superpowers/specs/2026-10-19-plugin-window-focus-lifecycle-design.md)：失焦隐藏/后台保留、召唤、Esc、显式关闭与 Runtime。
- [启动器会话内 Electron 预热设计](superpowers/specs/2026-10-20-electron-launcher-session-prewarm-design.md)：WPF 首帧后预热、业务请求 ownership、无窗口预热及正常空闲退出。设计时的旧实现观察保留为历史快照。
- [Translation 2.0 提供方页签设计](superpowers/specs/2026-10-18-translation-provider-tabs-design.md)、[旧能力清单](translation2-legacy-capability-inventory.md)与[设置纠正记录](translation2-settings-correction.md)：独立翻译窗口、网站页签、机器 API、共享 AI 和配置纠正。
- [MIT License](../LICENSE)：当前仓库源码协议；第三方声明继续保留。

## 架构与开发

- [插件开发指南](plugin-development.md)：本地 SDK、CLI、Manifest v1/v3、Feature Presentation 和 Host install-time authority。
- [Plugin Runtime 与 Surface 生命周期](plugin-runtime.md)：Launcher Feature discovery/projection、统一 Activation、独立插件窗口、Node Command、Runtime 2.0 与 Electron Host ownership。
- [插件配置](phase6f4d-plugin-configuration-development.md)、[窗口主题契约](plugin-window-theme-contract.md)与[SDK 开发工作流](phase6f5-sdk-developer-workflow.md)：配置读写、可选主题和仓库外项目开发。
- [Runtime 2.0 实施报告](phase6e7-plugin-runtime-2-implementation-report.md)与[开发体验实施报告](phase6e8-plugin-developer-experience-implementation-report.md)：Manifest v3、Web/Node Runtime、独立项目与开发会话。
- [Electron 首次激活与窗口显示调查](electron-cold-start-lifecycle-investigation.md)：首次隐藏的运行证据、Native 启动参数修正、回归口径及后续冷启动优化安排。
- [Native Super Panel](super-panel.md)：原生触发器、selection capture、声明式 context matching、固定功能与统一激活。
- [Phase 6E-3 Manifest v2 Host validator](phase6e3-manifest-v2-validator.md)：严格验证惰性 `.wtplugin` 包结构；不启用或执行 Web Plugin runtime。
- [Phase 6B 开发体验实施报告](webtools-phase6b-plugin-developer-experience.md) 与 [Phase 6C 能力 backlog](webtools-phase6c-capability-backlog.md)：自动化外部 author workflow 证据、人工验收状态和能力缺口记录。
- [项目架构与性能审计](performance-architecture-audit.md)：Electron/Vue 当前职责边界、窗口生命周期和重构前风险评估。
- [Launcher 开发边界](launcher-development-boundaries.md)：Launcher 的数据、IPC 与职责约束。
- [Native Launcher 架构审计（Phase 4A）](native-launcher-phase4a-architecture.md)：Native-first 的迁移目标和 parity 审计。
- [NativeHost 与 Electron Manager 集成（Phase 4D）](native-launcher-phase4d-integration.md)：Named Pipe、Manager 启动与设置/网址同步。
- [Phase 6 Master Plan](phase6-master-plan.md)：Phase 6A–6H 的目标边界和阶段门槛；未实施阶段仍需单独计划与批准。
- [Release Build & Version Contract](release-build.md)：产品/插件版本契约、Windows 发布构建、产物校验和数据保留约定。
- [Release Notes Template](release-notes-template.md)：填写特定版本发布说明的空白模板。

## Native Launcher 迁移

- [Native 搜索核心（Phase 4C）](native-launcher-phase4c-search.md)：应用目录、拼音搜索、网址、网页搜索与 Everything。
- [Phase 4D Acceptance 安装包](native-launcher-phase4d-acceptance-build.md)：独立 NativeHost + Manager 测试安装布局及限制。
- [Phase 4E 功能等价性与用户验收](native-launcher-phase4e-parity.md)：当前接受状态、已验证证据和进入 Phase 4F 前的 gates。
- [Phase 4E 人工验收清单](native-launcher-phase4e-manual-checklist.md)：冷启动、热键/IME、Manager 生命周期、设置同步、迁移和资源测量步骤。
- [Phase 4F Electron Launcher 移除与生产生命周期](native-launcher-phase4f-removal.md)：NativeHost 生产入口、Manager-only Electron 构建、安装器迁移和最终验收状态。
- Phase 4B PoC 和早期迁移历史：[WPF 最小 PoC](native-launcher-phase4b-poc.md)。

## 性能与生命周期

- [Launcher Phase 1](launcher-lightweight-phase1.md)：常驻 Launcher 状态与数据加载优化。
- [Launcher Phase 2A 审计](launcher-lightweight-phase2-audit.md) 与 [Phase 2B 验证](launcher-lightweight-phase2b.md)：搜索索引、生命周期和 A/B 测量记录。
- [Manager Phase 3A 审计](manager-lightweight-phase3a-audit.md) 与 [Phase 3B 优化](manager-lightweight-phase3b.md)：Manager 内存、生命周期和实验结果。

## 功能设计与实施记录

- [Quick Result Foundation](phase6g1-feature-quick-result-foundation.md)：在同一原生面板内显示命令结果与 AI 确认。
- [Super Panel 翻译预览](phase6g3-super-panel-translation-preview.md)：预览与完整翻译入口的演进记录；旧 Manager 路径描述应结合本次提交说明阅读。
- [Phase 6G-2 选中文本基础匹配与可靠性](phase6g2-selected-text-basic-parity.md)：本地链接匹配、真实浏览器动作示例、独立插件窗口和现有翻译路线的隔离验证，以及新增人工验收边界。
- [网址工作区与安装器回归修复](website-and-installer-regression-fixes.md)：收藏夹工作区交互与覆盖安装关闭/重试行为。
- [网址与更新安装设计](superpowers/specs/2026-09-30-websites-manager-and-update-install-design.md)、[网址工作区实施计划](superpowers/plans/2026-09-30-websites-workspace-management.md) 与 [安装器更新实施计划](superpowers/plans/2026-09-30-update-installer-auto-shutdown.md)：对应实现约束和阶段决策记录。
- [Launcher Search Discovery 实施计划](superpowers/plans/2026-09-27-launcher-search-discovery.md)：应用发现、图标、网址命令和翻译入口。
- [Translation Module 2.0 实施计划](superpowers/plans/2026-09-27-translation-module-2.0.md) 与 [Provider 调研](superpowers/research/2026-09-27-translation-provider-research.md)：翻译 Provider 架构和来源资料。
- [Phase 4D Acceptance 修复计划](superpowers/plans/2026-09-29-native-launcher-phase4d-acceptance-fixes.md)：Native Manager 集成验收中的定向修复。

更早的 UI 设计稿、搜索/主题设计和维护计划也保存在 `docs/superpowers/` 下，供查阅历史决策。
