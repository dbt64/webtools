# WebTools Declarative Plugin Development

This guide describes the supported local author workflow for WebTools declarative plugins. It targets **Manifest v1 / Plugin API major 1** and the standalone **`@webtools/plugin-sdk` 1.1.0** package. The SDK is distributed as a local `.tgz`; it is not published to npm or a plugin marketplace.

Third-party plugins describe fixed pages, settings, and a closed set of host actions. They do not provide executable plugin code. WebTools' normal Plugin Center install-time validation, consent, grants, and lifecycle remain authoritative even after SDK validation succeeds.

## Requirements

- A supported WebTools host. The commands below use product version `0.1.0`; pass the version you actually target.
- Node.js `>=20.19`.
- pnpm `9.15.9`.
- The locally supplied `webtools-plugin-sdk-1.1.0.tgz` file from the matching WebTools developer build.

The local tarball contains the author CLI and public types. Its `yauzl@3.4.0` dependency and the generated starter's TypeScript compiler are resolved by pnpm during installation. TypeScript is author tooling only; it is not part of the WebTools runtime. Do not obtain the SDK with `pnpm add @webtools/plugin-sdk` from a public registry.

## Create and validate a basic plugin

Keep the SDK tarball in a local `artifacts` directory. Create a separate tooling project that depends on that exact tarball:

```text
plugin-workspace/
  artifacts/
    webtools-plugin-sdk-1.1.0.tgz
  tooling/
```

In `tooling/package.json`, add the local SDK and pnpm pin:

```json
{
  "name": "local-webtools-plugin-tools",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.9",
  "devDependencies": {
    "@webtools/plugin-sdk": "file:../artifacts/webtools-plugin-sdk-1.1.0.tgz"
  }
}
```

From `tooling/`, install the package and generate one basic project. The generated directory must be a relative descendant of the current directory; absolute, traversal, existing-target, and symlink/junction paths are rejected.

```powershell
pnpm install --no-frozen-lockfile --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec webtools-plugin --help
pnpm exec webtools-plugin create basic-plugin --host-version 0.1.0
```

The starter contains `manifest.json`, `manifest.typecheck.ts`, `package.json`, `README.md`, `.gitignore`, and an empty `dist/`. Its default capability is only `manager.page`; the starter does not include plugin storage, network, executable code, or assets. Review and edit the generated manifest fields and page content as needed.

The tooling project's `basic-plugin/` folder is also a separate pnpm project. Add the same local SDK tarball as its development dependency, then install its lockfile:

```powershell
Set-Location .\basic-plugin
pnpm add --save-dev --ignore-scripts file:..\..\artifacts\webtools-plugin-sdk-1.1.0.tgz
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run validate
pnpm run plugin:pack
pnpm run inspect
```

`pnpm run plugin:pack` writes the validated package to `dist/basic-plugin.wtplugin`. The script is named `plugin:pack` to avoid colliding with pnpm's built-in `pnpm pack`, which creates a Node package tarball.

The create command accepts these optional identity values:

```text
--id <id>
--name <name>
--description <text>
--author <name>
--min-host-version <version>
```

For example:

```powershell
pnpm exec webtools-plugin create my-weather-plugin --host-version 0.1.0 --id com.example.weather --name "My Weather" --description "A compact weather page" --author "Example Author"
```

An omitted ID is derived as `org.example.<directory-slug>`. If the directory name contains no ASCII slug characters, the SDK uses `plugin.<12-character stable SHA-256 suffix>` so different non-Latin names do not collide. The display name is derived from the directory name, and `minHostVersion` defaults to `--host-version`. A supplied minimum Host version cannot be newer than the selected target version. The command writes values as JSON data and never evaluates them as shell or plugin code.

## CLI reference

The CLI accepts one command and only that command's documented options. `--host-version` is required for every operation other than `--help`.

```text
webtools-plugin --help
webtools-plugin create <directory> --host-version <version> [--id <id>] [--name <name>] [--description <text>] [--author <name>] [--min-host-version <version>] [--json]
webtools-plugin validate <directory|file.wtplugin> --host-version <version> [--json]
webtools-plugin pack <directory> --out <file.wtplugin> --host-version <version> [--json]
webtools-plugin inspect <file.wtplugin> --host-version <version> [--json]
```

`validate` accepts either plugin source or a `.wtplugin` archive. `pack` never overwrites an existing output. `inspect` accepts only a `.wtplugin`, validates its bounded archive bytes in memory, and reports its identity/display metadata, manifest/API versions, minimum Host version, requested capabilities, byte length, SHA-256, and validation result. It does not extract files, install the package, prompt for consent, or execute content.

Exit codes are stable: `0` means the command succeeded; `1` means validation or an operation failed; `2` means command syntax/options are invalid. Append `--json` to get one JSON envelope on stdout. Success has the form `{ "ok": true, "command": "…", "result": { … } }`; failure has `{ "ok": false, "command": "…", "error": { "code": "…", "path": "…", "field": "…", "message": "…", "suggestion": "…" } }`. Unknown `field` values are omitted. Diagnostics use package-relative paths and do not print absolute author paths, source contents, or credential-like values.

Diagnostic codes are `INVALID_INPUT`, `INVALID_MANIFEST`, `INCOMPATIBLE_PLUGIN`, `INVALID_PACKAGE`, `SOURCE_IO`, `SENSITIVE_CONTENT`, `OUTPUT_EXISTS`, `OUTPUT_IO`, `CLI_USAGE`, and the non-fatal `GENERIC_ICON` warning.

## Manifest v1 contract

The SDK package root exports `PluginManifestV1`, fixed unions, validation/packing functions, diagnostics, and constants. The schema is available at `@webtools/plugin-sdk/manifest.schema.json`. The public API and schema help authoring; the Host runs its own validation when installing.

The manifest includes:

- `manifestVersion: 1` and a unique reverse-DNS-style `id`;
- display `name`, `description`, `author`, and semantic `version`;
- `api.apiMajor: 1` and `api.minHostVersion`;
- `type: "declarative-manager"` and an `entry` page reference;
- declared `requestedCapabilities`, `settings`, `pages`, `actions`, and PNG `assets`.

The current closed block types are:

- `heading` and `paragraph`, each containing plain text;
- `text-input`, `select`, and `checkbox`, each bound to a declared setting key;
- `divider`;
- `button`, bound to a declared action ID.

The closed setting types are bounded `text`, `enum`, `boolean`, and `number` values with the type-specific bounds/defaults in `PluginSettingV1`. The action types are config and plugin-private storage `read`/`write`, HTTPS `external.open`, `clipboard.write`, and host-mediated `sharedAI.complete`. Actions refer only to declared keys/actions and are checked against the requested capability set.

The current capabilities are `manager.page`, `plugin.config.read`, `plugin.config.write`, `plugin.storage.read`, `plugin.storage.write`, `external.open`, `clipboard.write`, and `sharedAI.complete`. Request only what the plugin needs. Host consent and grant decisions remain controlled by WebTools; unknown fields, capabilities, API majors, and manifest versions fail closed. `manager.page` is the only capability in a newly generated basic starter.

Plugin-private storage is namespaced to the plugin and does not expose other plugins' data, WebTools settings, filesystem paths, SecretStore contents, or AI credentials. Shared AI is mediated by the Host review/action flow; the plugin receives neither a credential nor direct provider access. External open and clipboard operations use the existing Host confirmation path. Disabling or uninstalling a plugin is controlled by the host, including its separate decision about retaining plugin-private data.

## Validation and installation authority

Use the workflow commands before sharing a package:

1. **Typecheck** checks the author-authored manifest value against the public TypeScript types. It does not establish that a package can be installed.
2. **Source validation** checks strict UTF-8/JSON, duplicate keys, manifest semantics, host compatibility, IDs, references, defaults, declared assets, sensitive content, and bounded source files.
3. **Pack** includes the manifest and only declared, validated files, then creates a deterministic `.wtplugin` without overwriting an existing destination.
4. **Inspect** validates the resulting archive and returns bounded metadata and a SHA-256; it does not unpack or install it.
5. **Plugin Center installation** uses the normal WebTools file picker, Host validation, integrity checks, user consent, capability grants, and plugin lifecycle. This is the final authority.

Host/SDK limits include a 20 MiB archive, 256 entries, 50 MiB expanded data, maximum compression ratio 100, a 64 KiB manifest, and a 256 KiB PNG bound with maximum 256×256 dimensions. Additional depth, page, block, action, setting, value, key, and storage quotas are exported in `LIMITS_V1` and enforced by the Host-compatible validator.

## Private Notes example

`examples/plugins/private-notes` remains a separately maintained official example with its own identity and plugin-private storage capabilities. It is not generated from the basic starter and those storage capabilities are not copied into new basic projects. To try it, create a starter project, replace its manifest/typecheck inputs with the files from that example while keeping the generated author `package.json`, then use the same `pnpm run typecheck`, `pnpm run validate`, `pnpm run plugin:pack`, and `pnpm run inspect` flow.

In Plugin Center, install the resulting `.wtplugin` with the normal local-file picker and review the declared capabilities. A local developer package is not a publisher signature, trust decision, or bypass of Host consent. The Native file picker, real consent UI, and uninstall/data-retention interaction require manual Windows acceptance.

## Compatibility and troubleshooting

- Pass the actual target WebTools product version to `--host-version`; the current repo product is `0.1.0`.
- `INCOMPATIBLE_PLUGIN` means the API major is unsupported or the manifest requires a newer minimum Host version.
- `INVALID_MANIFEST` means a field is missing, malformed, out of bounds, or unknown. Use `field` in JSON diagnostics when present.
- `INVALID_PACKAGE` means the archive, entry names, ZIP structure, declared files, compression bounds, or PNG assets failed Host-compatible checks.
- `SENSITIVE_CONTENT` means credential-like material was found in metadata or declared assets. Remove secrets; never put AI tokens in plugin manifests/assets.
- `OUTPUT_EXISTS` means the output is preserved. Choose another filename rather than deleting or overwriting it.
- `CLI_USAGE` means an unsupported/repeated/missing option or invalid create target was supplied. Run `webtools-plugin --help`.

The Phase 6B automated workflow uses the SDK 1.1.0 `.tgz` from a unique OS temporary directory, initializes a distinct external tooling project, creates a basic plugin outside the checkout, performs frozen pnpm installs and the full generated script workflow, and compares SDK public-API results with the Electron Host adapter. This test does not automate the real Plugin Center picker or consent UI; those remain manual acceptance.
