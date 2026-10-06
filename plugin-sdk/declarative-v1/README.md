# WebTools Declarative Plugin SDK 1.1.0

This standalone local authoring SDK targets WebTools Manifest v1 / Plugin API major 1. It provides the public TypeScript contract and JSON Schema, canonical source/archive validation, deterministic `.wtplugin` packing, safe metadata inspection, and the `webtools-plugin` CLI. The SDK is distributed as a local `.tgz`; it is not published to npm or a plugin marketplace.

From the tooling project that has the tarball installed:

```powershell
pnpm exec webtools-plugin --help
pnpm exec webtools-plugin create basic-plugin --host-version 0.1.0
```

Then, from `basic-plugin/`, install the same local SDK tarball and use the generated scripts:

```powershell
pnpm add --save-dev --ignore-scripts file:..\..\artifacts\webtools-plugin-sdk-1.1.0.tgz
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run validate
pnpm run plugin:pack
pnpm run inspect
```

The generated project uses pnpm `9.15.9`. Use the actual target Host version for `--host-version`. Validation and inspection are author feedback only: neither installs a plugin, prompts for consent, nor executes plugin content. WebTools Plugin Center's install-time validation, consent, grants, and lifecycle remain authoritative.

Third-party packages support only the fixed declarative page blocks and capabilities. They cannot provide executable JavaScript, Vue/HTML, Node/Electron access, arbitrary filesystem access, SecretStore access, or arbitrary IPC.

See the complete author setup, CLI reference, manifest contract, troubleshooting, and manual install steps in [the plugin development guide](../../../docs/plugin-development.md).
