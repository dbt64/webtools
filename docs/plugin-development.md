# WebTools Declarative Plugin Development

This guide describes the locally distributed WebTools SDK for declarative plugins. It targets **Manifest v1 / plugin API major 1**. It does not describe a JavaScript plugin runtime.

## Built-in and third-party plugins

Built-in plugins are first-party modules integrated with WebTools. The Translation page is built-in and remains managed by WebTools. Third-party packages use `type: "declarative-manager"`; they can describe fixed pages, settings and a closed set of host actions, but cannot provide or execute code.

Third-party packages cannot load JavaScript, Vue, HTML or modules; access Node/Electron, the filesystem or SecretStore; register a built-in identity; or invoke arbitrary IPC. A page is rendered by WebTools from the manifest's fixed block types.

## Obtain the SDK locally

The SDK is currently a local package tarball built with WebTools. It is not published to npm or a plugin marketplace. The isolated Phase 5H author workflow builds `webtools-plugin-sdk-1.0.0.tgz` and tested installing it into a separate project outside the checkout. Use the tarball supplied with the matching WebTools build.

Add the local tarball and the TypeScript compiler to the author project's `devDependencies`, then install with the pinned package manager. The tested author project used this shape:

```json
{
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.9",
  "devDependencies": {
    "@webtools/plugin-sdk": "file:../artifacts/webtools-plugin-sdk-1.0.0.tgz",
    "typescript": "5.9.2"
  }
}
```

From that project directory:

```powershell
pnpm install --no-frozen-lockfile --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts
```

The second command is the reproducibility check after the first has written the project's lockfile. The SDK package uses the already-hosted exact `yauzl@3.4.0` dependency for ZIP inspection. It does not add dependencies to the WebTools root project.

## Author contract

The SDK exports `PluginManifestV1`, the closed setting/block/action/capability unions, v1/API 1 constants, and `LIMITS_V1`. The JSON Schema is available from `@webtools/plugin-sdk/manifest.schema.json`.

The manifest declares:

- identity, display name, author, semantic version and API compatibility;
- an optional PNG icon, entry page, settings and declarative page blocks;
- requested capabilities and only the fixed actions those capabilities cover.

Capabilities include `manager.page`, plugin config read/write, plugin-private storage read/write, HTTPS external open, clipboard write and the reviewed Shared AI action. WebTools decides whether to grant them. New packages start disabled; enabling a package may request consent for its capabilities. External open and clipboard actions have host confirmation. Shared AI requests go through the host's review flow; the package does not receive an AI credential or direct provider access.

Storage keys are namespaced to the plugin. They do not expose other plugins' data or WebTools settings. Uninstall separately asks whether to remove private plugin data; keeping the data allows it to remain available if the plugin is installed again.

## Validation layers

Use the CLI before sharing a package. The commands below were exercised in the independent author project with the supplied sample:

```powershell
pnpm exec tsc --noEmit --strict --skipLibCheck --moduleResolution bundler --module ESNext --target ES2022 plugin/manifest.typecheck.ts
pnpm exec webtools-plugin validate ./plugin --host-version 0.1.0
New-Item -ItemType Directory -Force dist | Out-Null
pnpm exec webtools-plugin pack ./plugin --out ./dist/plugin.wtplugin --host-version 0.1.0
pnpm exec webtools-plugin validate ./dist/plugin.wtplugin --host-version 0.1.0
```

Replace `0.1.0` with the WebTools host version being targeted.

These layers are distinct:

1. **TypeScript and JSON Schema** help authors describe the public shape. The schema closes object fields, bounds values and lists supported unions, but JSON Schema does not establish that a package is installable.
2. **Source `validate`** checks strict UTF-8/JSON, duplicate keys, manifest semantics, version compatibility, IDs, path references, defaults, PNG assets, file limits and supported source contents.
3. **Archive `validate`** checks the actual ZIP and requires the exact declared files, safe paths, valid CRC/headers, bounded compression and valid declared PNGs.
4. **Installation** is still performed by the WebTools Main process. Its file picker, package integrity checks, consent, grants and plugin lifecycle are authoritative.

Host quotas include a 20 MiB archive, 256 entries, 50 MiB expanded data, a compression ratio limit of 100, a 64 KiB manifest, and a 256 KiB PNG bound with maximum 256×256 dimensions. Runtime contract constants expose the remaining depth, page, block, action, setting and private-storage limits; the SDK validator enforces the same values as the host.

## Diagnostics and compatibility

The CLI reports a stable diagnostic code and, when known, a package-relative file. It does not print absolute author paths or credential-like values. A generic plugin icon warning is non-fatal when no icon is declared.

The example and validator target Manifest v1 / API major 1 only. The host checks `minHostVersion` and rejects unsupported API or manifest versions. The Phase 5H compatibility workflow exercised existing generic host-generated v1 fixtures with and without a bounded PNG through both the SDK and Electron's host adapter. Those are fixture checks; they are not claimed to be archived 5C/5D package artifacts.

## WebTools example

`examples/plugins/private-notes` is a minimal independent sample. It uses the fixed page and plugin-private storage actions to save and load one note. It contains no custom code, network access, AI action, key or asset. Its README gives the exact CLI flow and the host install steps.

The native file picker and native consent dialogs are separate Windows UI steps. The Phase 5H packaged smoke verified the generated package, page, storage actions and Manager lifecycle with an isolated test profile and clearly identified test consent. It did not automate the production file picker or present real Windows consent dialogs.
