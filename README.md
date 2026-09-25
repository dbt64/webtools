# WebTools

WebTools 是一款面向 Windows 的个人桌面启动器，使用 Electron、Vue 3 和 TypeScript 构建。

## 已包含的功能

- 扫描开始菜单快捷方式，以应用名称、拼音或拼音首字母搜索并启动。
- 搜索并打开手动维护的网址和本地工具。
- 输入 `?关键词` 用设置的 Google、百度或 Bilibili 平台搜索。
- 用收藏夹保存网址；自动获取网站 favicon，无法获取时显示域名首字母。
- 用 Google Translate 网页或 OpenAI 兼容 API 翻译文字。AI 地址可设置为 OpenAI、DeepSeek 等兼容服务。

本地网址、工具、收藏夹和偏好保存在 Electron `userData` 目录；AI API Key 使用 Windows DPAPI 加密保护，不放入普通设置文件。

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

安装包输出至 `release/`。应用扫描范围为当前用户和所有用户的 Windows 开始菜单 `Programs` 目录。

第一次使用 AI 翻译前，请在“设置”里填写兼容 API 的服务地址、模型和 API Key。OpenAI 常用地址为 `https://api.openai.com/v1`；DeepSeek 常用地址为 `https://api.deepseek.com`。点击“测试连接”会向服务发送一次简短请求。
