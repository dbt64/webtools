# WebTools Documentation

本文档索引按主题列出当前架构说明和重要阶段记录。Phase 报告保留了当时的实现范围与测量口径；阅读历史性能数据时，请同时查看报告中的构建版本和验证限制。

## 架构与开发

- [项目架构与性能审计](performance-architecture-audit.md)：Electron/Vue 当前职责边界、窗口生命周期和重构前风险评估。
- [Launcher 开发边界](launcher-development-boundaries.md)：Launcher 的数据、IPC 与职责约束。
- [Native Launcher 架构审计（Phase 4A）](native-launcher-phase4a-architecture.md)：Native-first 的迁移目标和 parity 审计。
- [NativeHost 与 Electron Manager 集成（Phase 4D）](native-launcher-phase4d-integration.md)：Named Pipe、Manager 启动与设置/网址同步。

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

- [网址工作区与安装器回归修复](website-and-installer-regression-fixes.md)：收藏夹工作区交互与覆盖安装关闭/重试行为。
- [网址与更新安装设计](superpowers/specs/2026-09-30-websites-manager-and-update-install-design.md)、[网址工作区实施计划](superpowers/plans/2026-09-30-websites-workspace-management.md) 与 [安装器更新实施计划](superpowers/plans/2026-09-30-update-installer-auto-shutdown.md)：对应实现约束和阶段决策记录。
- [Launcher Search Discovery 实施计划](superpowers/plans/2026-09-27-launcher-search-discovery.md)：应用发现、图标、网址命令和翻译入口。
- [Translation Module 2.0 实施计划](superpowers/plans/2026-09-27-translation-module-2.0.md) 与 [Provider 调研](superpowers/research/2026-09-27-translation-provider-research.md)：翻译 Provider 架构和来源资料。
- [Phase 4D Acceptance 修复计划](superpowers/plans/2026-09-29-native-launcher-phase4d-acceptance-fixes.md)：Native Manager 集成验收中的定向修复。

更早的 UI 设计稿、搜索/主题设计和维护计划也保存在 `docs/superpowers/` 下，供查阅历史决策。
