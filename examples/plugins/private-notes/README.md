# Private Notes example plugin

This standalone example uses only the WebTools declarative page and the plugin-private key/value store. It contains no JavaScript plugin runtime, network action, Shared AI request, token, or asset.

## Requirements

- WebTools with Manifest v1 / API major 1 support.
- The local `@webtools/plugin-sdk` tarball and its documented `webtools-plugin` command (see [the plugin development guide](../../../docs/plugin-development.md)).
- A supported Node.js and pnpm installation for authoring and packaging.

## Build and install

From this directory in a third-party plugin project, after installing the locally supplied SDK tarball:

```powershell
pnpm exec tsc --noEmit --strict --skipLibCheck --moduleResolution bundler --module ESNext --target ES2022 manifest.typecheck.ts
pnpm exec webtools-plugin validate . --host-version 0.1.0
New-Item -ItemType Directory -Force dist | Out-Null
pnpm exec webtools-plugin pack . --out dist/private-notes.wtplugin --host-version 0.1.0
pnpm exec webtools-plugin validate dist/private-notes.wtplugin --host-version 0.1.0
```

Use the target host version for `--host-version`; `0.1.0` is the version used by this example's local tests. These checks are repeated in the repository Phase 5H report.

In WebTools, open **应用 → 插件管理**, choose **从本地文件安装**, select `private-notes.wtplugin`, review the requested `manager.page`, `plugin.storage.read`, and `plugin.storage.write` capabilities, grant only what you want, and enable the plugin. Open **Private Notes**, select **Save note**, enter text in the host-provided prompt, and use **Load saved note** to read it back.

## Disable, update, and uninstall

Disable or re-enable the plugin from Plugin Center. Its data remains scoped to the plugin and survives those state changes. Install an updated `.wtplugin` through the same host-owned picker and review any changed capability request. On uninstall, WebTools asks whether to delete the plugin's private data; choose keep or delete explicitly. This example does not access other plugins' data or WebTools settings.

## Limits

Only the fixed host UI and declared storage actions execute. The manifest cannot run custom code, load a Vue view, read files, inspect the Shared AI token, invoke Electron directly, or bypass host permission checks.
