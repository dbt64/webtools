# Private Notes example plugin

This standalone example uses only the WebTools declarative page and the plugin-private key/value store. It contains no JavaScript plugin runtime, network action, Shared AI request, token, or asset.

## Requirements

- WebTools with Manifest v1 / API major 1 support.
- The local `@webtools/plugin-sdk` tarball and its documented `webtools-plugin` command (see [the plugin development guide](../../../docs/plugin-development.md)).
- A supported Node.js and pnpm installation for authoring and packaging.

## Build and install

Start from a newly generated basic project using the local `@webtools/plugin-sdk` **1.1.0** tarball. Replace that project's `manifest.json` and `manifest.typecheck.ts` with the files from this example, while keeping the generated `package.json` scripts and adding the same SDK tarball as a local development dependency. This keeps Private Notes independent from the single basic starter and preserves this example's storage capabilities only in its own manifest.

From the generated project directory:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run validate
pnpm run plugin:pack
pnpm run inspect
```

Use the target host version in the generated scripts' `--host-version` values; `0.1.0` is the current product version used by the Phase 6B external workflow. `plugin:pack` writes the archive under `dist/` and never overwrites an existing package. The 1.1.0 local tarball is not published to npm.

In WebTools, open **应用 → 插件管理**, choose **从本地文件安装**, select `private-notes.wtplugin`, review the requested `manager.page`, `plugin.storage.read`, and `plugin.storage.write` capabilities, grant only what you want, and enable the plugin. Open **Private Notes**, select **Save note**, enter text in the host-provided prompt, and use **Load saved note** to read it back.

## Disable, update, and uninstall

Disable or re-enable the plugin from Plugin Center. Its data remains scoped to the plugin and survives those state changes. Install an updated `.wtplugin` through the same host-owned picker and review any changed capability request. On uninstall, WebTools asks whether to delete the plugin's private data; choose keep or delete explicitly. This example does not access other plugins' data or WebTools settings.

## Limits

Only the fixed host UI and declared storage actions execute. The manifest cannot run custom code, load a Vue view, read files, inspect the Shared AI token, invoke Electron directly, or bypass host permission checks.
