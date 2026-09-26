# WebTools

WebTools 是一款面向 Windows 的个人桌面启动器，使用 Electron、Vue 3 和 TypeScript 构建。

## 已包含的功能

- 扫描开始菜单快捷方式，以应用名称、拼音或拼音首字母搜索并启动。
- 搜索并启动 Windows 应用，支持拼音、首字母和别名匹配；使用 `Ctrl+Alt+Space` 唤出独立搜索框。
- 搜索并打开手动维护的网址，支持网格/列表排布和收藏夹整理。
- 在“网址与工具”中添加网址，WebTools 会尝试读取网页标题和图标；可建立收藏夹、切换网格/列表显示。
- 输入 `?关键词` 使用当前选中的网页搜索引擎；内置 Google、百度、Bilibili，也可在设置中添加自定义引擎。
- 输入 `file:关键词` 使用可选的 Everything 索引搜索本机文件和文件夹。
- 自动获取网站标题与 favicon；图标无法获取时显示域名首字母。
- 用 Google Translate 网页或 OpenAI 兼容 API 翻译文字。AI 地址可设置为 OpenAI、DeepSeek 等兼容服务。

本地网址、收藏夹和偏好保存在原有 Electron `userData` 目录；首次启动会备份并迁移旧版数据。AI API Key 使用 Windows DPAPI 加密保护，不放入普通设置文件。

关闭主窗口会将 WebTools 收到系统托盘。可在设置中修改全局快捷键，并选择是否在登录 Windows 时启动。

## 开发

```powershell
npm install
npm run dev
```

## 检查与打包

```powershell
npm run typecheck
npm run build
npm run package:win
```

安装包输出至 `release/`。应用目录来自当前用户/所有用户的开始菜单快捷方式、Windows 注册应用和 App Paths。

### Everything 文件搜索

Everything 是可选依赖。先安装并启动 [Everything](https://www.voidtools.com/)，然后在 WebTools“设置 → Everything 文件搜索”中启用功能并自动检测或选择 `es.exe`。在快速搜索框输入 `file:` 前缀，例如 `file:meeting notes`。WebTools 不会下载、捆绑或自动安装 Everything。

第一次使用 AI 翻译前，请在“设置”里填写兼容 API 的服务地址、模型和 API Key。OpenAI 常用地址为 `https://api.openai.com/v1`；DeepSeek 常用地址为 `https://api.deepseek.com`。点击“测试连接”会向服务发送一次简短请求。
