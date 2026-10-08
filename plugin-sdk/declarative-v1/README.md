# WebTools Declarative Plugin SDK 1.2.0

This standalone local authoring SDK authors Manifest v1 / Plugin API major 1 and provides bounded, non-authoritative Manifest v2 archive preflight. It provides the public TypeScript contract and v1 JSON Schema, canonical v1 source/archive validation, deterministic v1 `.wtplugin` packing, safe metadata inspection, and the `webtools-plugin` CLI. Manifest v2 preflight does not install, grant, or execute a package; Electron Main remains the install-time authority. The SDK is distributed as a local `.tgz`; it is not published to npm or a plugin marketplace.

From the tooling project that has the tarball installed:

```powershell
pnpm exec webtools-plugin --help
pnpm exec webtools-plugin create basic-plugin --host-version 0.1.0
```

Then, from `basic-plugin/`, install the same local SDK tarball and use the generated scripts:

```powershell
pnpm add --save-dev --ignore-scripts file:..\..\artifacts\webtools-plugin-sdk-1.2.0.tgz
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run validate
pnpm run plugin:pack
pnpm run inspect
```

The generated project uses pnpm `9.15.9`. Use the actual target Host version for `--host-version`. Validation and inspection are author feedback only: neither installs a plugin, prompts for consent, nor executes plugin content. WebTools Plugin Center's install-time validation, consent, grants, and lifecycle remain authoritative.

Third-party packages support only the fixed declarative page blocks and capabilities. They cannot provide executable JavaScript, Vue/HTML, Node/Electron access, arbitrary filesystem access, SecretStore access, or arbitrary IPC.

See the complete author setup, CLI reference, manifest contract, troubleshooting, and manual install steps in [the plugin development guide](../../../docs/plugin-development.md).

## Browser connection entry

`@webtools/plugin-sdk/web` is a browser-only entry for the isolated Web Plugin runtime. Its current public API provides readiness and runtime-close notification:

```js
import { connectWebTools } from '@webtools/plugin-sdk/web'

const webtools = connectWebTools()
await webtools.ready
const unsubscribe = webtools.onClose(() => {
  // Stop plugin-local work when the runtime closes.
})
```

The callback subscription can be removed with `unsubscribe()`. Connection readiness rejects outside a compatible WebTools runtime. This entry does not provide Host capabilities or a generic request API. Normal Manifest v2 installation remains unavailable; the current Web runtime is exercised through Host-validated isolated acceptance fixtures. The existing package root and CLI continue to provide Node-based authoring tools.
