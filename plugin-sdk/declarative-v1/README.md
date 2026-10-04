# WebTools Declarative Plugin SDK v1

This is a local authoring SDK for WebTools Manifest v1 / plugin API major 1. It publishes TypeScript author types, a JSON Schema, a strict validator and a deterministic `.wtplugin` packer. The same manifest, PNG and ZIP validation runtime is used by WebTools Main.

The package is currently distributed as a local `.tgz` from a WebTools build. It is not published to npm or a marketplace. Add the tarball as a development dependency in a plugin project; the package provides the `webtools-plugin` executable.

```powershell
pnpm exec webtools-plugin validate ./plugin --host-version 0.1.0
pnpm exec webtools-plugin pack ./plugin --out ./dist/plugin.wtplugin --host-version 0.1.0
pnpm exec webtools-plugin validate ./dist/plugin.wtplugin --host-version 0.1.0
```

Use the actual target host version in place of the example's `0.1.0`. Source validation and archive validation do not install a plugin. WebTools still owns the file picker, consent prompts, permissions, runtime actions and uninstall/data-retention decisions.

Only the fixed declarative page blocks and declared capabilities are supported. Plugins cannot provide executable JavaScript, Vue or HTML, invoke Electron or Node, access arbitrary files or SecretStore, register built-ins, or call arbitrary IPC.

See the WebTools `docs/plugin-development.md` guide for the complete contract and author workflow.
