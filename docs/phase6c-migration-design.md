# Phase 6C — Manifest v2, Compatibility and Migration Design

**Status:** approved design; implementation not started. Manifest v1 and its parser remain frozen and unchanged.

## 1. Version boundaries

- Product Version remains unchanged.
- Plugin API Major remains 1 unless a later review identifies a breaking host-facing API semantic change.
- Manifest v1 remains an immutable, closed declarative schema.
- Manifest v2 is a new closed feature-bundle schema for Web Features.
- .wtplugin remains the package extension and ZIP container.
- SDK author validation is preflight. Electron Main's install-time Host validation is final authority.

ManifestVersion identifies package shape; apiMajor identifies host-facing bridge semantics. They are independent.

## 2. Manifest v2 shape

Top-level exact fields:

~~~json
{
  "manifestVersion": 2,
  "id": "org.example.quick-tools",
  "name": "Quick Tools",
  "description": "A small set of browser-based tools",
  "author": { "name": "Example Author", "url": "https://example.org" },
  "version": "1.0.0",
  "api": { "apiMajor": 1, "minHostVersion": "0.1.0" },
  "type": "feature-bundle",
  "requestedCapabilities": [],
  "features": [],
  "webBundle": { "files": [] },
  "assets": [],
  "network": { "mode": "none", "domains": [] }
}
~~~

Feature definition shape is specified in the [Feature/context contract](phase6c-feature-context-contract.md). V2 entry kind is web-bundle. Existing declarative pages are not recopied into a second v2 grammar; they use the read-time v1 compatibility adapter. This keeps the v1 schema frozen and avoids two declarative UI languages.

webBundle.files lists HTML, JavaScript module, CSS, JSON and package-local WebAssembly module files. A .wasm file is an executable browser-side module with the fixed application/wasm media type, not a native executable or general binary asset. assets lists image/font resources and their fixed MIME types. The ZIP inventory must be exactly manifest.json plus the union of those paths; there are no undeclared extras. Every Feature document, WASM module reference and icon path must point to exactly one listed file.

Top-level field policy:

| Field | Required | Rule |
|---|---|---|
| manifestVersion, id, name, description, author, version, api, type | Yes | Exact types and current canonical identity/version rules |
| requestedCapabilities | Yes | Unique bounded list; empty is valid |
| features | Yes | 1–16 unique Feature definitions |
| webBundle | Yes | Closed files inventory; entry documents must be in it |
| assets | No | Defaults to empty; every asset is part of the exact archive inventory |
| network | Yes | Explicit mode none or domains; omission is rejected |

author.url is optional. Feature fields follow the required/optional table in the Feature/context contract. Every object rejects keys outside its listed schema.

## 3. Required package examples

### 3.1 Minimal Web Feature

~~~json
{
  "manifestVersion": 2,
  "id": "org.example.word-count",
  "name": "Word Count",
  "description": "Count words in text",
  "author": { "name": "Example" },
  "version": "1.0.0",
  "api": { "apiMajor": 1, "minHostVersion": "0.1.0" },
  "type": "feature-bundle",
  "requestedCapabilities": [],
  "features": [
    {
      "id": "word-count",
      "title": "Word Count",
      "commands": ["count words", "word count"],
      "acceptedContexts": [
        { "type": "text", "sources": ["launcher-input"] }
      ],
      "entry": { "kind": "web-bundle", "document": "web/index.html" },
      "requiredCapabilities": []
    }
  ],
  "webBundle": {
    "files": [
      { "path": "web/index.html", "mediaType": "text/html" },
      { "path": "web/app.js", "mediaType": "text/javascript" },
      { "path": "web/app.css", "mediaType": "text/css" }
    ]
  },
  "assets": [],
  "network": { "mode": "none", "domains": [] }
}
~~~

### 3.2 Multi-Feature Web Plugin

~~~json
{
  "manifestVersion": 2,
  "id": "org.example.text-suite",
  "name": "Text Suite",
  "description": "Several focused text actions",
  "author": { "name": "Example" },
  "version": "1.2.0",
  "api": { "apiMajor": 1, "minHostVersion": "0.1.0" },
  "type": "feature-bundle",
  "requestedCapabilities": ["plugin.storage.read", "plugin.storage.write"],
  "features": [
    {
      "id": "word-count",
      "title": "Word Count",
      "commands": ["count words"],
      "entry": { "kind": "web-bundle", "document": "web/count/index.html" },
      "requiredCapabilities": []
    },
    {
      "id": "saved-snippets",
      "title": "Saved Snippets",
      "commands": ["snippet", "text snippet"],
      "acceptedContexts": [
        { "type": "text", "sources": ["launcher-input"] }
      ],
      "entry": { "kind": "web-bundle", "document": "web/snippets/index.html" },
      "requiredCapabilities": ["plugin.storage.read", "plugin.storage.write"]
    }
  ],
  "webBundle": {
    "files": [
      { "path": "web/count/index.html", "mediaType": "text/html" },
      { "path": "web/count/app.js", "mediaType": "text/javascript" },
      { "path": "web/snippets/index.html", "mediaType": "text/html" },
      { "path": "web/snippets/app.js", "mediaType": "text/javascript" }
    ]
  },
  "assets": [],
  "network": { "mode": "none", "domains": [] }
}
~~~

### 3.3 Network-enabled Web Plugin

~~~json
{
  "manifestVersion": 2,
  "id": "org.example.status-view",
  "name": "Status View",
  "description": "Read a public service status",
  "author": { "name": "Example" },
  "version": "1.0.0",
  "api": { "apiMajor": 1, "minHostVersion": "0.1.0" },
  "type": "feature-bundle",
  "requestedCapabilities": ["network.domains"],
  "features": [
    {
      "id": "service-status",
      "title": "Service Status",
      "commands": ["service status"],
      "entry": { "kind": "web-bundle", "document": "web/status/index.html" },
      "requiredCapabilities": ["network.domains"]
    }
  ],
  "webBundle": {
    "files": [
      { "path": "web/status/index.html", "mediaType": "text/html" },
      { "path": "web/status/app.js", "mediaType": "text/javascript" }
    ]
  },
  "assets": [],
  "network": {
    "mode": "domains",
    "domains": [
      { "host": "status.example.com", "protocol": "https" }
    ]
  }
}
~~~

### 3.4 No-privilege Web Plugin

The minimal Word Count package is also the no-privilege example: requestedCapabilities and all Feature requiredCapabilities are empty, network mode is none, no Host bridge effect is needed, and context may be Launcher text only. It still contains executable Web code; install/enable confirmation must identify it as a Web Plugin.

## 4. Closed-schema and bounds

| Item | First-release bound/policy |
|---|---|
| Unknown field | Reject at every object level; no extension bag |
| Manifest bytes | At most 64 KiB UTF-8 |
| Compressed .wtplugin | At most 20 MiB |
| ZIP entries | At most 256 total |
| Expanded archive | At most 50 MiB |
| Compression ratio | At most 100:1 |
| Per PNG icon | At most 256 KiB |
| Single HTML entry document | At most 1 MiB |
| Other JS/CSS/JSON/WASM file | At most 8 MiB each; WASM must be package-local and MIME-typed application/wasm |
| Total Web bundle files | Within the 50 MiB expanded archive cap |
| Features per Plugin | 1–16, unique Feature IDs |
| Feature ID | Lowercase ASCII, 1–64 chars |
| Feature title | 1–80 Unicode scalar values |
| Feature description | Optional, max 240 scalar values |
| Commands | 0–8 aliases, max 48 scalar values each |
| Context pairs | 0–4; only known type/source enums |
| Required capabilities | 0–12 unique; subset of requested capabilities and known capability set |
| Network hosts | 0–16 exact host/protocol entries |
| Asset entries | At most 128; bounded by archive entries and total bytes |

The 1–16 Features-per-Plugin limit, 2,000 global projected-Feature limit and 3 MiB projection limit are first-release engineering/safety bounds, not permanent Product Contract or public SDK ceilings. Future increases require measured validation and safe contract/projection evolution.

Archive limits inherit the current v1 safety envelope unless a stricter row above applies. File media types come from a closed extension/MIME map, not author headers. The map includes package-local .wasm as application/wasm; visual/font asset types are PNG, JPEG, WebP and WOFF2. SVG is excluded initially. Reject native PE/DLL files, native addons, package executables, inline script, source maps in release packages, undeclared files, external package imports, absolute URLs in feature entry, and references to entries outside the package inventory. WASM remains subject to sandbox, CSP, origin, lifecycle and byte limits, and does not grant Host capabilities or OS access.

String lengths are measured in Unicode scalar values for user-facing fields and UTF-8 bytes for serialized payloads. Validators must reject malformed UTF-8 and surrogate anomalies, normalize IDs/hostnames before duplicate checks, and account for JSON escaping when enforcing byte caps.

## 5. Capabilities and network declaration consistency

Existing capabilities may be requested as before: plugin config/storage read/write, external.open, clipboard.write and sharedAI.complete. Proposed addition: clipboard.read, restricted to the one-shot Native context flow. Proposed network capability: network.domains, which remains unavailable until its independent connection-level security gate passes. network.mode none remains a supported Web Runtime profile without network.domains.

Rules:

- non-empty network.domains requires requestedCapabilities to include network.domains;
- network.domains in requestedCapabilities with an empty domain set is invalid;
- a Feature using the network bridge must list network.domains in requiredCapabilities;
- all Feature requiredCapabilities are a subset of the package request;
- user grants are separately stored and enforced by Main;
- host execution type is shown separately from capabilities because every Web bundle executes code even if it has no Host privileges.

Manifest declares exact DNS host/protocol tuples only. HTTPS and WSS only; fixed port 443; no wildcards, IP literals, localhost, loopback or private addresses. Exact matching, redirects, DNS resolution/pinning and permission upgrade behavior are specified in the [Web runtime security design](phase6c-web-runtime-security-design.md). A runtime using network.mode none is not blocked while network.domains is unavailable. Until its security gate passes, a package requiring domains networking cannot activate; that does not disable packages using none.

## 6. Host-authoritative install pipeline

1. Main file dialog returns a user-selected archive as bytes; renderer never supplies a path.
2. Host detects manifest version from bounded manifest bytes and dispatches to the separate canonical v1 or v2 validator.
3. Host checks ZIP structure, exact inventory, path safety, size/ratio, file references, closed MIME allowlist including application/wasm, IDs, capabilities, network grammar and package content hash.
4. Host validates all contracts before mutating registry or package storage.
5. Host computes capability and network-scope delta versus installed version.
6. Manager confirmation states package type (declarative or executable Web), requested Host capabilities, exact network hosts/protocols and added permissions.
7. New privileges require explicit re-consent. Cancellation leaves the old package and grants intact.
8. Successful install stores original immutable bytes by content hash and updates current registry atomically.
9. Invalid package, unsupported Host/API/security profile or capacity failure leaves installed state unchanged. An unavailable network.domains profile does not prevent a valid network.mode none package from installing and running.

Local package hash is integrity identity, not publisher authenticity. V2 package is not signed unless a future separately approved trust/signing system is designed.

## 7. Registry and permission-scope migration

Current registry stores requested/granted capability names but does not encode a granted network-host snapshot. A network grant must not be represented as a blanket permanent approval of every future domain.

Proposed registry extension is versioned and optional for v1 records:

~~~json
{
  "registryVersion": 2,
  "plugins": [
    {
      "id": "org.example.status-view",
      "granted": ["network.domains"],
      "networkGrant": {
        "scopeHash": "sha256:...",
        "reviewedPackageHash": "sha256:...",
        "domains": [
          { "host": "status.example.com", "protocol": "https" }
        ]
      }
    }
  ]
}
~~~

Migration rules:

- v1 registry data is read without rewriting package files; absent networkGrant means no network authorization.
- Existing v1 capabilities and enable state retain current semantics.
- Registry upgrade is atomic and backup/recovery tested; failed migration keeps the old valid record.
- Network grant stores the exact canonical domain/protocol scope and its scope hash; the reviewed package hash is provenance, not a substitute for comparing the current manifest scope.
- Added host/protocol or new capability on update requires re-consent; removed scope is dropped immediately.
- A package hash change with unchanged network scope may preserve that exact grant under the existing package-upgrade consent flow. Main compares every request with the stored granted scope; code hash change never expands network scope.
- Downgrade/rollback restores only a prior grant snapshot that is still explicitly recorded and compatible; otherwise network remains denied.
- Secrets remain exclusively in existing SecretStore and never enter plugin registry or projection.

Registry v2 and networkGrant remain future implementation schema changes: this document freezes their design requirements but does not approve a production schema migration or modify the current registry.

## 8. Declarative v1 compatibility adapter

Every existing v1 package with a valid manager.page entry is projected to one deterministic synthetic Feature:

- featureId is the constant legacy-manager-page for every v1 Plugin; composite identity keeps Plugins distinct;
- title is the existing entry label;
- Plugin name and entry label are search aliases; current Manager page ID remains the authoritative route inside Main;
- entry kind is declarative-compatibility and references the original page ID in Main-only catalog state;
- required capability is manager.page;
- acceptedContexts is empty; no context is implicitly passed to old declarative actions;
- icon is the existing built-in/plugin token;
- the Native projection does not include page ID, filesystem path, package data or grants.

Invocation resolves through existing pluginCatalog.open and DeclarativePluginView. Do not change package bytes, require repacking, or reinterpret each declarative block/action as a Feature.

## 9. Compatibility matrix

| Case | Install/catalog behavior | Invocation behavior | Data safety |
|---|---|---|---|
| Old v1 Plugin + new Host | Validate with frozen v1 parser; synthesize one compatibility Feature | Existing declarative route and manager.page grant | Original bytes and settings remain |
| v2 Web Plugin + supporting Host | Validate full archive and permissions; disabled until confirmed/enabled | New isolated Web runtime only after Main revalidation | Main-owned PluginStore |
| v2 Plugin + old Host | Reject as unsupported Manifest version | No partial runtime or fallback parsing | Existing install remains unchanged |
| Disabled Plugin | Visible in Manager; omitted from active Native Feature projection | Reject with PLUGIN_DISABLED | Installed archive retained |
| Unsupported Manifest/API | Mark incompatible/invalid with stable code | No WebContents or action | Do not delete prior valid version |
| Unsupported bridge/API | Host compatibility check rejects before activation | No runtime | Package retained as incompatible |
| Corrupt projection | Native uses empty index and requests full sync | Main still validates if request arrives | Registry/package untouched |
| Stale projection | Native may present cached row during startup | Main rejects stale ref and refreshes | No path or permission is trusted |
| Web runtime crash | Mark runtime faulted, keep Plugin installed | Destroy failed WebContents; explicit retry only | PluginStore retained |
| Invalid update | Keep currently installed version active | Old runtime remains or is safely closed only after staged validation | No partial replacement |
| Valid update with new privilege | Show scope delta, require re-consent | New version stays disabled/restricted until consent | Old valid package available for rollback |

## 10. Rollback and recovery

- Stage validation and hash calculation before package/registry mutation.
- Write immutable package bytes to a new hash path; do not overwrite the old archive.
- Atomically switch registry current version only after validation and required consent.
- If registry commit fails, keep old version active and remove only the newly staged package through verified package identity.
- If Web runtime crashes, retain install and PluginStore, invalidate runtime state, and offer explicit retry.
- If registry v2 migration fails, continue with last valid registry format or fail plugin activation closed; never reset the user profile.
- If Native projection v2 is unsupported/corrupt, use v1/empty projection and rebuild; do not touch plugin storage or settings.
- On update/downgrade, stop and destroy the old runtime before package switch. Do not allow old-hash bridge calls after the registry changes.

## 11. Approved decisions and implementation checks

The architecture review approved v2 as Web Feature packages only; v1 Declarative packages keep their immutable parser and one deterministic read-time synthetic Feature. It also approved package-local browser-side WASM, with a closed application/wasm inventory entry and no Host capability; WASM bytecode is not native executable support. The Web Runtime supports network.mode none independently from the network.domains security gate. First-release limits are engineering/safety bounds, not permanent Product Contract or SDK limits. Exact network-grant scope, plugin-wide grants, one active runtime, Host install-time validation, and fail-closed migration behavior are frozen in the [architecture freeze](phase6c-architecture-freeze.md).

Phase 6D must verify worst-case Unicode, JSON escaping, framing, memory and search latency for the first-release bounds; a deterministic package-local WASM fixture; and that unavailable network.domains does not block a network.mode none package. No schema, parser, registry or runtime implementation is authorized by this design document.
