# Phase 6E Repository Cleanup

本报告记录已完成的历史验证工具清理，并区分清理改动与当前工作树中原有的 Phase 6E 产品/Launcher 修改。未修改产品运行架构；未 commit、push 或 stage。

## 清理内容

- 移除旧 Manager lifecycle evidence 生成器及其证据形状测试；Phase 4G-3 报告保留为历史记录。
- 移除独立 Phase 6E-4A.1 Electron probe、其一次性 Gate 1 evidence JSON/形状测试，以及重复的 probe policy 测试。Phase 6E-4A/4C 报告保留。
- 收敛当前工作树中的历史 Phase runner；正式入口保留为 `pnpm test`、`pnpm run typecheck`、`pnpm run build`、`pnpm run acceptance:plugin-runtime`、`pnpm run package:win` 和 release 命令。
- 保留 `verify-plugin-runtime-packaged.mjs` 作为通用产品级入口；保留 `verify-cover-install.mjs` 和 `verify-website-dialogs.mjs`，前者覆盖安装器覆盖升级顺序，后者覆盖收藏夹对话框焦点回归。
- 将 `measure-plugin-runtime-processes.ps1` 内部类型名改为通用名称；功能不变，PowerShell AST 检查通过。
- `.gitignore` 增加精确的 `/undefined/manager-package/` 规则。
- 未删除或削弱 Manifest v3、Plugin Runtime 2.0、Node/native/helper 支持、包校验、preload 校验、SDK/CLI、NativeHost、Launcher、Feature Registry 或用户功能。

## 计数

计数口径沿用本轮开始时的仓库 inventory：test/spec 文件；`scripts/` 与 `native/scripts/` 中的脚本/打包文件；路径或文件名带 fixture 的正式 source/test 文件。历史阶段 executable runner 只统计仍在当前 inventory 中、目标为已完成阶段的一次性入口。

| 项目 | 清理前 inventory | 清理后 | 说明 |
|---|---:|---:|---|
| Test/spec 文件 | 96 | 92 | 本轮移除 4 个阶段证据/重复测试；核心回归测试保留 |
| Script/installer 文件 | 17 | 11 | 不包含生成的 `out/` 或 `release/` 内容 |
| Fixture 路径/文件 | 4 | 4 | 长期 fixture 保留；未机械合并 |
| 活跃的一次性 Phase-specific validation entry | 2 | 0 | 两个历史入口由 durable tests / generic acceptance 取代 |
| Root package.json obsolete Phase scripts | 0 | 0 | 无需删除；正式脚本名保持不变 |
| 活跃源码中的固定 dirty-file SHA baseline | 0 | 0 | 未发现此类机制 |

本轮明确归属的清理 delta 删除 25 个 tracked obsolete 文件，其中 4 个是测试文件；另有 2 个一次性 Phase-specific runner 被退役。当前 Git diff 总共显示 62 个删除路径，其中包含本轮开始前已存在的 Phase 6E/Launcher 工作树改动，不能把 62 全部归因于本次 cleanup。没有移动文件，也没有删除正式 `package.json` 脚本。

## SHA-256 分类

未发现通过固定源码 SHA 管理 dirty files 的活动脚本、package command 或运行机制。Phase 历史报告中的旧 artifact/hash 记录保留，不将历史证据改写成当前产品基线。

保留的完整性校验包括：

- Plugin package / validated snapshot / runtime materialization / Node preload 内容校验：防止执行内容与已验证内容不一致。
- `scripts/release-contract.mjs` 中 release artifact 的动态 SHA-256 校验：验证 release manifest 对应的产物。
- NativeHost Manager peer token 的摘要校验：属于进程认证边界。

代码中另有用于稳定 ID 或 invocation 去重 fingerprint 的 SHA-256（App catalog、Everything item、SDK fallback ID、feature request fingerprint）；它们不是临时 acceptance hash baseline，也不承担 package integrity。通用 runner 中 SHA-1 用于 WebSocket 握手协议。

## 正式覆盖保留

保留 Manifest v3、package install/update/uninstall、Plugin Runtime web/Node、npm dependency/native addon/helper、Plugin Local Data/storage、SDK/CLI build/validate/pack/inspect、IPC role authorization、NativeHost peer authentication、Feature Registry、Launcher、Manager lifecycle、installer cover-install 以及真实 Renderer dialog regression 的现有测试。

Phase 6E-4A/4C 的旧单独 probe/evidence generator 和 Gate 1 evidence-shape test 已退役；历史报告保留为历史记录，不进入 build/test/runtime。

## Generated residue

检查确认以下路径均是 ignored generated residue，不属于产品源文件：

- `undefined/manager-package/win-unpacked/resources/app.asar`：34,634,260 bytes。
- `release/phase6e6-builder-path-error-20261009/`：73 files，385,151,516 bytes。
- `release/phase5h-test-native/`：1 个 4-byte 测试残留文件。
- `out/`：当前构建输出，15 files，1,025,302 bytes，已有 `/out/` ignore 规则。

**这些文件尚未物理删除。** Windows 文件删除命令被当前工具的自动审批策略拒绝；我没有改用其他 shell/runtime 绕过该拒绝。针对 `undefined/manager-package/` 已加入精确 ignore 规则以防误入 Git。需要后续由获准的清理工具/人工删除上述三处历史 residue；在删除前不要把本轮描述为 generated residue 已全部清干净。

## 验证

- `pnpm run typecheck` — PASS。
- `pnpm test` — PASS，541/541；Node 输出含既有 `MODULE_TYPELESS_PACKAGE_JSON` warnings。
- `pnpm run build` — PASS。
- NativeHost Checks — PASS，72/72。
- UpdateHelper Checks — PASS，10/10。
- `scripts/measure-plugin-runtime-processes.ps1` PowerShell AST — PASS。
- `git diff --check` — PASS；Git 输出工作树 LF→CRLF 提示，没有 whitespace error。
- 通用 packaged Plugin Runtime acceptance — **NOT PASS / fixture incompatibility**。使用当前工作树新发布的隔离 NativeHost、当前 `pnpm run build` 后新打包的 TEMP Manager，以及正式 fixture preparation/SDK validator 后，安装和普通 NativeHost→Manager 生命周期通过；打开 Node-runtime feature 时，预编译 fixture `.node` 导入 `electron.exe`，而 packaged executable 名为 `WebTools.exe`，Node preload 报 Windows module-load failure。测试最终通过 runner 的正常关闭路径退出，isolated NativeHost exit code 为 0。此前 E8 专用 acceptance 记录不替代本次 generic runner 结果。该失败来自历史测试 binary 与当前打包名的兼容性，尚未证明是 Plugin Runtime 产品缺陷；本轮未扩大为产品修复。

## Git 与剩余债务

- Branch：`codex/shared-ai-translation-2.0`。
- HEAD：`707c5673dff479285b34a5b441bec9d3b725c737`。
- 当前 staged diff 为空；无 commit/push。
- 工作树仍包含大量此前未提交的 Phase 6E/Launcher/产品修改，未重置、覆盖或混入本报告。
- Remaining debt：历史 generated residue 尚待删除；通用 packaged runner 所用 Node addon fixture 需更换为与当前 Electron/可执行文件名兼容的 native addon fixture 后，再重跑 Node packaged acceptance。

## 阶段边界

本次没有开始 Phase 6F。源码/历史 harness 清理已完成；generated residue 物理删除被工具策略阻止，通用 Node packaged acceptance 未通过，因此整体 repository cleanup 仍有上述两项未完成限制。
