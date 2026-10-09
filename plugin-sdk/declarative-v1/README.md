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

Manifest v1 packages support fixed declarative page blocks and capabilities. Installed Manifest v2 Web bundles run browser JavaScript in the isolated Host runtime. Neither format grants raw Node/Electron, arbitrary filesystem, SecretStore or IPC access.

See the complete author setup, CLI reference, manifest contract, troubleshooting, and manual install steps in [the plugin development guide](../../../docs/plugin-development.md).

## Browser connection entry

`@webtools/plugin-sdk/web` is a browser-only entry for the isolated Web Plugin runtime. It provides readiness, runtime-close notification and four typed capability families:

```js
import { connectWebTools } from '@webtools/plugin-sdk/web'

const webtools = connectWebTools()
await webtools.ready
const unsubscribe = webtools.onClose(() => {
  // Stop plugin-local work when the runtime closes.
})
const context = await webtools.context.current() // Readonly invocation text or null.
await webtools.storage.set('note', { text: 'Hello' })
const note = await webtools.storage.get('note')
await webtools.storage.delete('note')
// Optional namespaces exist only for the declared, currently granted active Feature.
// Call from an explicit foreground user action; Host confirmation is required each time.
const abortController = new AbortController()
const answer = await webtools.ai?.complete({ prompt: 'Summarize this text' }, { signal: abortController.signal })
await webtools.clipboard?.writeText('Copied text')
```

The callback subscription can be removed with `unsubscribe()`. Connection readiness rejects outside a compatible runtime. Main validates installation, package identity, grants, Feature eligibility and live generation on every Host call; declarations and SDK possession are not grants. Storage uses the plugin's Main-derived namespace. Context contains only `type`, `source` and `text`; its immutable value has a revocable Host-owned lifetime. All methods accept an optional `{ signal }` for local cancellation; provider billing cancellation is best effort.

Shared AI returns text only and never exposes credentials, endpoints, model override or provider metadata. External open, networking, model listing, streaming and tool calling remain unavailable. There is no public generic request/send/invoke API. Web Features can be opened in Manager; Native Web Feature discovery awaits the separately versioned future projection contract. The package root and CLI remain Node-based authoring tools, and Host install-time validation is authoritative.

Web Shared AI requires valid provider-reported output token usage to enforce the 1,024-token limit. Missing or malformed usage fails closed; an over-limit output is rejected, never truncated. This requirement does not change existing built-in Translation or other Shared AI callers.
