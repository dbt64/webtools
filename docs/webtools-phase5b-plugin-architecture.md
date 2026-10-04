# WebTools — Phase 5B Plugin Architecture & Security Design

Date: 2026-10-04
Phase: 5B — architecture and security-boundary design only
Source branch: codex/shared-ai-translation-2.0
Source HEAD reviewed: 7551a2c464d8a7bab09856b8071aa34a1b61bd0e — docs: complete phase 5a feature and plugin audit
Upstream: origin/codex/shared-ai-translation-2.0, synchronized 0 ahead / 0 behind after fetch
Initial worktree: clean

## Decision Summary

**Recommended v1: independently installable local declarative Manager plugins, rendered and executed by fixed WebTools host code.**

A plugin is a separately packaged, locally imported **.wtplugin** ZIP containing a strict JSON manifest, allowlisted declarative Manager page descriptions, bounded settings definitions, fixed action descriptions, and optional static PNG assets. WebTools validates, stores, lists, enables, disables, and removes the package. The Manager host renders the package through fixed Vue components and executes only a small, exhaustive set of host actions after checking plugin state, user grant, input schema, and user-gesture requirements.

The v1 package contains **no JavaScript, TypeScript, HTML, CSS, Vue component, Node module, executable, native library, or dynamic import**. It cannot register timers, background jobs, arbitrary IPC, arbitrary network requests, Native Launcher results, or process/file operations. That restriction is the security and lifecycle model; a Worker Thread or ordinary child process is not used as a substitute for a security sandbox.

This still provides a real local plugin system: an independently authored package can install a new Manager page, define its own settings and private data, and use the supported host action set without modifying WebTools source. It does not promise arbitrary computation or unrestricted UI. A future request for executable scripts or Native Launcher integration needs a separately approved threat model and Windows isolation proof.

**Phase 5B conclusion:** the architecture is implementable without changing the NativeHost-first product model. No product code was changed or runtime acceptance performed. The implementation and user-facing policy decisions below are proposals pending user approval; no Phase 5C work is authorized here.

## 1. Scope, Goals, and Non-Goals

### Goals

- Define an independently installable local package and strict manifest.
- Define safe package validation, installation, replacement, enablement, disablement, and uninstall.
- Keep Manager plugin UI and privileged work in the on-demand Electron Manager.
- Define a small versioned host interface and explicit, revocable capabilities.
- Reuse the existing SharedAIService without exposing API keys or creating a second credential system.
- Keep plugin-owned configuration and data separate from WebsiteEntry, AppData, SecretStore, and NativeHost state.
- Define testable Phase 5C–5F gates and preserve cold NativeHost behavior.

### Non-goals for v1

- Arbitrary JavaScript, Lua, WASM, native modules, shell commands, or executable plugin payloads.
- A plugin marketplace, account system, cloud synchronization, background updater, or remote catalogue.
- Native Launcher search/action extensions or any plugin work performed by NativeHost.
- Plugins reading full WebTools settings, saved websites, translation history, SecretStore, other plugins, arbitrary files, or the clipboard.
- General-purpose network fetch or custom AI credential/provider configuration owned by plugins.
- Per-plugin process isolation, because v1 has no plugin code process to isolate.

## 2. Source and Evidence Baseline

The code review used the current checkout, not filenames or the historical audit alone. Relevant implementation inspected:

| Area | Current implementation and evidence |
|---|---|
| Resident architecture | **native/WebTools.NativeHost/App.xaml.cs**, **MainWindow.xaml.cs**, **Services/ManagerController.cs**, **Services/ManagerProcessLauncher.cs**, and **Services/NativeManagerPipeServer.cs**. WPF NativeHost owns the resident launcher, tray, hotkey, startup integration, search, and one current-user pipe. |
| Manager process | **ManagerController** starts/reuses the tracked Manager process, queues page/translation intents until renderer readiness, and normally asks the Manager to close. **ManagerProcessLauncher** finds packaged **Manager/WebTools.exe**. Existing accepted lifecycle evidence is recorded in Phase 4G reports; this design task did not rerun it. |
| Electron window | **electron/main.ts** creates the Manager BrowserWindow only after Electron Manager starts. Its web preferences set **contextIsolation: true**, **nodeIntegration: false**, and **sandbox: true**; window-open requests are denied. Normal close destroys the window and quits Electron. |
| Preload and IPC | **electron/preload.ts** exposes a typed **window.desktop** through **contextBridge**; the current contract is declared in **src/shared/ipc.ts**. Existing handlers are separated under **electron/ipc/**. **electron/ipc/window-security.ts** provides current-window/main-frame validation. A plugin API must use a narrow typed contract and apply sender validation on every privileged plugin handler. |
| Manager UI | **src/App.vue** uses an explicit Section union / conditional views for Favorites, Settings, and Translation; there is no Vue Router or general plugin registry. Settings is loaded with **defineAsyncComponent**. Pages mounted under the conditional branches do not use a global keep-alive for these views. |
| User data | Electron sets **userData** to **%APPDATA%\\Nook** in packaged use. **DataStore** owns **nook-data.json** with AppData version 2; credentials use **SecretStore** in **secrets.json**, encrypted with Electron **safeStorage**. NativeHost separately owns **launcher-state.json** under the same profile. |
| Shared AI | **electron/services/shared-ai-service.ts** is a Main-process service used by Translation and registered through **electron/ipc/translation-handlers.ts**. **AIProviderCredentialStore** reads provider credentials through SecretStore. Renderer receives provider status and typed operation results, not the key value. |
| Packaging | **package.json** pins pnpm 9.15.9 and Electron 44.4.5. **electron-builder** builds the Manager payload; **scripts/build-native-production.ps1** stages the self-contained .NET NativeHost and Electron **win-unpacked** Manager. **scripts/native-production.nsi** installs the Manager under **Manager\\** and uses **WebTools.NativeHost.exe** for the product entry point. |
| Existing plugin mechanism | No manifest, plugin package discovery, dynamic feature registry, plugin permission broker, or third-party code loader exists in current source. Product sections and AI / translation providers use explicit static registration. |

### Phase 5A roadmap clarification

The Phase 5A report correctly describes the present source as lacking a dynamic plugin loader, but it recommends no plugin framework because no approved requirement had yet been identified. The current user request explicitly sets a real plugin system as the Phase 5 objective. That later instruction changes the roadmap decision; it does not change the observed source. The Phase 5A report is historical and remains unchanged.

The Phase 5A report also used the labels “Phase 5B” and “Phase 5C” for already completed Shared AI and Translation work. This design treats the current approved roadmap as: 5A feature audit, 5B plugin architecture, 5C plugin core, 5D Manager center, 5E SDK/example, 5F acceptance. It does not rewrite the older report.

### Architecture as it exists today

    Windows session
       │
       ├── WebTools.NativeHost.exe (.NET 10 / WPF, resident)
       │     ├── Native Launcher, search and app catalog
       │     ├── tray, hotkey and login startup
       │     ├── user profile projection / native state
       │     └── CurrentUserOnly Named Pipe
       │            └── on-demand start → Manager/WebTools.exe
       │                                  └── Electron Main
       │                                       ├── one Manager BrowserWindow
       │                                       ├── preload: typed window.desktop
       │                                       ├── one Vue renderer
       │                                       ├── DataStore + SecretStore
       │                                       └── Websites / Settings / Translation
       │
       └── No Electron process while NativeHost is idle (accepted architecture gate)

The Phase 5 design keeps every plugin concern below the on-demand Manager line. NativeHost does not scan, load, execute, or call a plugin, and plugin operations do not add messages to the Native Manager pipe.

## 3. Recommended v1 Module and Data Flow

### Manager-only plugin path

    User chooses local .wtplugin
       ↓
    Manager UI → narrow preload operation → Electron Main PluginManager
       ↓                                      ├── PackageValidator
    sanitized catalog/page DTOs               ├── SafeArchiveAdapter
       ↓                                      ├── PluginRegistry / PluginStore
    fixed Vue allowlist renderer               ├── PermissionBroker
       ↓                                      └── DeclarativeActionExecutor
    user clicks a declared action                      ├── external opener
       ↓                                               ├── scoped plugin storage
    plugin.invoke(id, actionId, boundedInput)           ├── clipboard write
                                                        └── SharedAIService

The host never imports a package path or evaluates package-provided code. Main parses a bounded manifest into a validated internal record and sends only a sanitized view model to the renderer. The renderer builds UI from a fixed list of host-owned controls. Plugin text is rendered as text, never as HTML or Markdown with embedded HTML. Package assets are constrained static PNGs and, if shown to the renderer, are returned as bounded data URLs; renderer APIs never return package paths.

### Recommended deep module seam

Keep the main plugin module deep: a small interface should hide archive validation, atomic writes, registry consistency, permission checks, cancellation, and action dispatch. The UI and preload should not each reimplement these rules.

    PluginManager.list(): Promise<PluginSummary[]>
    PluginManager.installFromUserDialog(): Promise<InstallResult>
    PluginManager.setEnabled(pluginId, enabled, grants): Promise<PluginSummary>
    PluginManager.invoke(pluginId, actionId, input): Promise<PluginActionResult>
    PluginManager.uninstall(pluginId, deletePrivateData): Promise<void>

These are design-level internal contracts, not existing methods. **installFromUserDialog()** opens the picker in Main; it accepts no renderer-supplied filesystem path. **PluginSummary** and action results contain no absolute paths, secrets, raw IPC handles, or NativeHost internals. Before implementing, Phase 5C should settle exact TypeScript types, error codes, permission consent screens, and limits in one shared contract.

### Why declarative execution is recommended

It satisfies package independence and meaningful Manager extension while confining behavior to a fixed host interpreter. Security work becomes validating data, binding known controls to known actions, mediating every capability in Main, and cleaning up ordinary asynchronous requests. The interface is versionable and testable without exposing Vue internals as an SDK.

It is not a sandbox *between arbitrary third-party programs*: the v1 package has no program to sandbox. All Manager UI runs in the existing trusted Manager renderer, and all capabilities are host operations. This is a smaller and more honest boundary than loading third-party code in a Node-capable context and trying to restrict it afterward.

## 4. Plugin-Type and Execution-Model Comparison

### Plugin extension types

| Type | Actual use | Required runtime | Main risks / NativeHost impact | v1 decision |
|---|---|---|---|---|
| Declarative plugin | New Manager page, labels, bounded settings, forms, and fixed host actions | Host-owned schema interpreter in Manager Main / Vue renderer | Malformed or deceptive content; requests still require capability checks. No NativeHost dependency. | **Include.** No executable package members. |
| Script plugin | Custom computation, dynamic workflows, background logic | JS runtime and broker, likely a utility or child process | Arbitrary-code escape, resource exhaustion, IPC abuse, same-user file/network access, process cleanup. Starting it with Manager is compatible with on-demand Electron, but does not by itself establish OS isolation. | **Exclude.** Revisit only with approved script use cases and a Windows isolation PoC. |
| UI extension | Custom Manager screen or widget | Host-rendered declarative schema or a separate web context | Arbitrary Vue/HTML/CSS can execute code, navigate, fetch, or exploit renderer assumptions; sharing one renderer does not isolate plugins from each other. | **Include only declarative page registration.** No imported Vue modules, webview, plugin HTML, JS, CSS, or URL-hosted resources. |
| Native Launcher extension | Search results and actions while Electron is absent | NativeHost registry/projection and a versioned Native pipe contract | Must operate while Electron=0; a synchronous call back into Manager would violate architecture. Dynamic code in WPF would expand the resident trusted base. | **Exclude from v1.** Future extension must be data-only and independently usable without launching Electron. |

### Execution and isolation choices

| Execution choice | Crash / blocking behavior | OS access and limits | Lifecycle / cost | Decision |
|---|---|---|---|---|
| Execute plugin module in Electron Main | A plugin exception or blocking CPU work can affect all Manager services and window lifecycle. | Main has Node/Electron privileges. No plugin restriction merely because it is packaged beside the app. | No extra process, but weakest fault/security separation and risks Manager responsiveness. | Reject executable plugins here. |
| Node Worker Thread | A worker separates JS execution and can have V8 resource limits; a worker is still in the same process and can share memory. | It does not change Windows token, filesystem ACL, network, or process identity. V8 limits do not bound every native/external allocation. | Can terminate worker, but cannot claim process-wide OOM or OS access containment. | Do not present as a malicious-code sandbox. Possible future trusted CPU-work option only. |
| Electron utilityProcess / Node child process | Separate process limits direct JS/main-thread fault propagation; utilityProcess has process lifecycle APIs. | It has Node integration. Separate address space does not itself remove same-user OS access. A process group / Job Object is useful for cleanup and accounting, not file/network isolation. | Extra process startup, memory, IPC, packaging and descendant-cleanup work; still on-demand if spawned only with Manager. | Best future process seam for trusted code, not sufficient proof for untrusted code. |
| Sandboxed renderer / isolated UI | Chromium renderer sandbox and context isolation reduce renderer privileges; fixed UI remains responsive within normal browser limits. | A narrow preload bridge is essential. A broad exposed API defeats much of the benefit. Same renderer plugins are not mutually isolated. | Uses existing Manager renderer; no plugin-specific child startup. | Use for the fixed host-owned UI only, never as a claim that plugin code is trusted automatically. |
| Restricted JS VM / Node Permission Model | Can constrain selected language/runtime operations, but cannot be treated as OS enforcement without a demonstrated boundary. | Node’s Permission Model documentation explicitly disclaims security guarantees against malicious code. | Easy to misrepresent as a sandbox and may still share host process resources. | Reject as the security boundary for third-party scripts. |
| Windows AppContainer / restricted token process | Stronger OS access isolation when correctly launched, configured, and given narrow capabilities. | Windows can restrict filesystem/registry, network, credentials, devices, and process access through AppContainer capabilities and ACL setup. Electron utilityProcess does not document a built-in per-plugin AppContainer switch. | Requires native launch/broker integration, packaging, compatibility PoC, capability policy, and process cleanup. | Future research only if arbitrary scripts become a product requirement. |
| Declarative host executor | No package code executes; the host interprets a finite data contract. | Every action still passes through Main validation and per-plugin grants. The package cannot directly address OS APIs. | Reuses the on-demand Manager process; no plugin process, timer, or resident memory while Manager is closed. | **Recommended v1.** |

The Electron security guidance favors sandboxed renderers, context isolation, narrow IPC, sender validation, navigation restrictions, and no exposure of raw Electron APIs. The current Manager already uses the first three webPreferences and denies new windows. The existing navigation policy still permits general local **file:** main-frame navigation; Phase 4F / G6 records this as deferred hardening. The plugin design does not load package files as documents and should keep package content in validated JSON/PNG only. A separate review should narrow the pre-existing navigation policy before any later feature intentionally introduces plugin-owned document navigation.

### Platform-source interpretation

The following conclusions are grounded in official documentation, not measured in this repository:

- Electron’s security checklist and sandbox/context-isolation guides support keeping privileged work in Main behind validated, narrow IPC and keeping renderer Node access disabled.
- **utilityProcess** is a separate Electron child process with Node integration and message-port communication; this provides a process seam, not a general promise that a same-user plugin cannot access OS resources.
- Node worker threads share the process and may share memory; the conclusion that they are not an OS security sandbox is an inference from the documented thread/process model and resource-limit scope.
- Node’s Permission Model is explicitly documented as not providing a security guarantee against malicious code.
- Windows AppContainer provides a stronger OS resource restriction model when deliberately configured; Job Objects provide process grouping/accounting/limits/termination, not equivalent file/network capabilities.

Official sources:

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)
- [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
- [Node.js Permission Model](https://nodejs.org/api/permissions.html)
- [Node.js Child Processes](https://nodejs.org/api/child_process.html)
- [Windows AppContainer Isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

These pages are platform guidance; Phase 5C must confirm the pinned runtime behavior in WebTools’ actual packaged Electron 44.4.5 build before using any process isolation API.

## 5. Package Format and Manifest

### Package envelope

- Extension: **.wtplugin**.
- Container: ZIP, imported from a file selected through an Electron Main-process dialog.
- Contents: exactly one root **manifest.json** and the manifest-declared **assets/** subtree. No other file types or undeclared entries.
- No installation hooks, scripts, DLLs, executable files, symlinks, archive nested inside archive, remote resources, or arbitrary plugin directory entry path.
- Package ID: reverse-DNS-like lowercase ASCII, for example **org.example.quick-note**; regex proposal: **[a-z0-9]+(?:[.-][a-z0-9]+)\***, length 3–128. Store IDs as data, never as unvalidated paths.
- Version: SemVer 2.0.0; prerelease versions are not automatically promoted over a stable install.
- Name is non-empty and at most 80 characters; description is at most 512; author name is at most 128; optional author URL must be HTTPS. All display strings are plain text.
- Manifest: UTF-8 JSON; strict object schema, **additionalProperties: false** at every level, duplicate JSON keys rejected, bounded string/array depth and lengths.
- API compatibility: integer **apiMajor** plus **minHostVersion**; API major mismatch or too-old host means incompatible, not a best-effort load.

### Manifest proposal

The following is a design example, not a currently supported file:

    {
      "manifestVersion": 1,
      "id": "org.example.help-links",
      "name": "帮助链接",
      "description": "将团队文档作为一个独立的 Manager 页面提供。",
      "version": "1.0.0",
      "author": {
        "name": "Example Team",
        "url": "https://example.org"
      },
      "api": {
        "apiMajor": 1,
        "minHostVersion": "0.1.0"
      },
      "type": "declarative-manager",
      "entry": {
        "pageId": "home",
        "label": "帮助链接",
        "icon": "assets/icon.png"
      },
      "requestedCapabilities": [
        "external.open"
      ],
      "settings": [
        {
          "key": "showCommunity",
          "label": "显示社区文档",
          "type": "boolean",
          "default": true
        }
      ],
      "pages": [
        {
          "id": "home",
          "title": "帮助链接",
          "blocks": [
            {
              "type": "paragraph",
              "text": "从此页面打开 WebTools 帮助资料。"
            },
            {
              "type": "button",
              "label": "打开文档",
              "actionId": "open-docs"
            }
          ]
        }
      ],
      "actions": [
        {
          "id": "open-docs",
          "type": "external.open",
          "url": "https://example.org/docs"
        }
      ],
      "assets": [
        {
          "path": "assets/icon.png",
          "type": "image/png"
        }
      ]
    }

Schema constraints:

- Manifest 64 KiB maximum; JSON nesting at most 16; reject duplicate properties and non-finite numeric values.
- At most 8 pages, 64 UI blocks/page, 32 actions, 64 settings, and 128 requested capability entries before deduplication.
- IDs use a strict lowercase ASCII grammar and are unique within the manifest.
- Page and action references must resolve within that manifest. Unknown block, action, field, capability, key, or property causes package rejection.
- Text values are plain text; no HTML, Markdown, CSS, expression language, or template evaluation.
- Supported first UI blocks: heading, paragraph, text input, select, checkbox, divider, and button. Each is rendered by an existing host-owned component.
- Settings fields support bounded text, enum, boolean, and number types with explicit ranges/options. Values are schema-checked on every read/write.
- Package icons are PNG only, at most 256 KiB and 256 × 256 pixels. No SVG, HTML, CSS, font, animation, or URL-based asset in v1.
- External URL action accepts only a literal HTTPS URL from the validated package. V1 does not interpolate user data into a URL or execute a URL template.
- Unknown future manifest versions and unsupported required capabilities fail closed with a visible reason.

These initial caps are conservative design proposals, not observed performance limits. Phase 5C should add fixture tests and adjust them only with a documented security/performance rationale.

### Archive validation and extraction

ZIP parsing is an attack surface. Phase 5C must choose a maintained archive-reading adapter after checking supported ZIP features, duplicate-entry behavior, symlink metadata, ZIP64 handling, and whether entries can be streamed with explicit byte limits. Do not implement a partial ZIP parser or call an unrestricted extract-all API. The archive adapter is behind a replaceable internal seam; the exact dependency decision is a Phase 5C gate, not a dependency added during this design task.

Before extracting any entry:

1. Reject a compressed archive above **20 MiB**.
2. Bound central-directory entry count to **256** and reject duplicate names under Windows case-insensitive comparison.
3. Normalize archive separators; reject rooted paths, drive prefixes, UNC paths, **..**, colon / alternate data-stream syntax, NUL/control characters, reserved device names, and trailing dot/space segments.
4. Reject symlink, hardlink, reparse-like, or special-file entries. The permitted archive entry set is only the manifest and its declared PNG assets.
5. Reject expanded total above **50 MiB**, any single asset above **256 KiB**, and a per-entry compression ratio above **100:1**. Enforce byte counts while streaming, not only from attacker-controlled header fields.
6. Extract to a newly created random staging directory under the plugin root. Canonicalize every resulting path and verify it remains under staging. Create files with no-overwrite semantics; do not follow pre-existing reparse points.
7. Validate manifest, file set, declared sizes/types, dimensions, and a cryptographic digest before making the package visible.
8. Atomically move the validated package directory to its versioned final location, then atomically update a versioned registry file. If either operation fails, roll back the partial install and keep the previous active version intact.
9. Retain an audit event with plugin ID, version, archive digest, outcome and error code. Do not persist raw archive paths in renderer-visible state or include user-specific paths in ordinary logs.

### Integrity, identity, conflicts, and trust

- Record SHA-256 for the imported archive and each installed package version to detect accidental post-install byte changes and incomplete copy. A local hash does **not** identify an author or prove package origin.
- No signatures or publisher verification are claimed in v1. UI must say “本地插件；发布者未经验证。此版本不包含可执行插件代码；启用的宿主能力仍会执行其声明操作。”
- Same ID + same version + same digest: report already installed; no rewrite.
- Same ID + same version + different digest: show a replacement warning and require explicit confirmation; preserve old package until new validation succeeds.
- Higher compatible SemVer: stage side-by-side; require explicit user confirmation; preserve private data; switch only after validation. Keep previous package available for rollback until the new version is accepted.
- Lower version: reject by default. An explicit local downgrade requires warning and preserves data; do not automatically run a downgrade migration.
- Different ID: different plugin, different permission record and private data. Renaming an ID never silently moves data.
- An incompatible, malformed, corrupt, over-limit, duplicate-file, or unsupported-capability package remains uninstalled and leaves the current package and registry unchanged.
- There is no automatic update check or remote catalogue in v1.

## 6. Discovery, Install, Enable, Update, and Uninstall

### Discovery

Only inspect WebTools’ own per-user plugin directory when the Manager process starts. Never scan arbitrary disks or plugin paths. The packaged app remains self-contained under the existing **Manager\\** layout; plugins live in user data, not inside **app.asar** or the installation directory. A disabled package may be listed as metadata, but its page/actions are not registered. No scan or work occurs in NativeHost while Electron is absent.

If registry metadata is invalid, rebuild only from validated package manifests under the managed package root, mark ambiguous entries disabled, and show a recoverable error. Never enable a package merely because a directory exists.

### Install flow

1. User chooses “安装本地插件” in the Manager plugin center.
2. Main opens a single-file picker restricted to **.wtplugin**; renderer does not pass a file path.
3. Main checks the raw size, streams into isolated staging, validates the package, manifest, asset set, API compatibility and permission requests.
4. UI displays name, publisher/source, version, API requirement, package digest, requested capabilities, whether the publisher is verified (v1: no), and that v1 contains no executable plugin code.
5. User can cancel or complete installation. Installation ends in **installed-disabled**; no requested capability is granted and the page is not exposed yet.
6. On first enable, show the capability explanations and grant toggles. User confirms. Unknown/unsupported required permissions block enablement.
7. Commit grants and enabled state atomically. Show the page after the registry state confirms success.

### Enable / disable

- Enable only if installed package digest still matches, the manifest remains valid, **apiMajor** and minimum host version are supported, and all required capabilities are explicitly granted.
- Disable immediately marks the package unavailable, rejects new invocations, aborts its active async requests, unregisters its Manager navigation item, clears page-local state, and persists **installed-disabled**. It preserves config and user data.
- Revoke one capability without uninstalling: block new calls immediately, cancel in-flight requests that depend on that capability, and show an actionable permission error in the plugin page.
- No plugin background event handler, interval, startup callback, or system listener exists in v1.

### Update / replacement

- Import is always user initiated. Validate new version in staging while the current version continues working.
- Do not execute package migrations. Host may apply explicit declarative config migrations (rename key, add default, narrow enum) only after validating the old and new settings schemas and retaining a backup.
- Keep previous version package and a config backup until new version passes host validation and can render its page.
- On any failure, restore the old registry pointer and settings snapshot. Do not auto-run or evaluate migration code.

### Uninstall

- Disable first and cancel in-flight actions; then remove only the package files for that plugin ID.
- Ask separately whether to delete plugin-owned configuration/data. Default recommendation: **keep private data** for future reinstall; show the exact logical amount/path label, not a raw path.
- If user opts in to deletion, remove only the validated data root for that plugin. Fail closed on path canonicalization/reparse anomalies; never recursively delete a path derived from a package-supplied string.
- Do not touch **nook-data.json**, **secrets.json**, Favorites, NativeHost **launcher-state.json**, another plugin ID, or the install folder.

## 7. Permissions and Host API

### Three permission states

1. **Requested:** manifest declares a known capability. This is a request, never a grant.
2. **Granted:** per-plugin user consent stored in a host-owned registry. First enable shows the capability meaning and risk; grants can be revoked later.
3. **Enforced:** every Main-process invocation checks identity, current enable state, compatible package digest, current grant, action declaration, schema, quota, and user-gesture context. Renderer visibility is not authorization.

Main is the capability broker. A plugin cannot invoke **ipcRenderer** or choose an arbitrary IPC channel. The preload exposes only typed methods such as list/install/set-enabled/invoke. Every plugin-specific IPC handler verifies current Manager main-frame sender and validates all input. It then passes a closed action union to the broker. It never forwards raw IPC, **shell**, filesystem, Electron objects, **WebContents**, Node modules, or pipe handles.

### Proposed capability matrix

| Capability | v1? | Grant and enforcement |
|---|---|---|
| **manager.page** | Yes, constrained | Page registration is a host-rendered declarative surface visible only after the user enables the plugin. No privileged data access. |
| **plugin.config.read** / **plugin.config.write** | Yes | Only that plugin’s schema-validated settings. Host owns form rendering and persistence. |
| **plugin.storage.read** / **plugin.storage.write** | Yes, quota-limited | Opaque JSON keys scoped to one plugin ID; no arbitrary path or other plugin access. |
| **external.open** | Yes | Only declared HTTPS literal URL, on an explicit user click, through a Main allowlist function; show external destination clearly. No **file:**, **javascript:**, custom protocol, executable launch, HTTP, or user-controlled template expansion. |
| **clipboard.write** | Optional, explicit grant | User-click only, bounded text length; no clipboard read. Confirm if the plugin attempts to write without a clear direct action. |
| **sharedAI.complete** | Optional, explicit grant | User action; preview prompt/input and disclose current provider/data destination; bounded messages/output, timeouts, concurrency and rate; cancelable; no key/config read. |
| **network.fetch** | No | No arbitrary network, host allowlist fetch, sockets, custom TLS, or hidden background requests. **sharedAI.complete** is the sole v1 managed network route. |
| Read full settings / websites / file system / SecretStore | No | No API. Only host-provided form state and explicit user-supplied input may be seen. |
| **clipboard.read**, selected text, arbitrary process launch, Native Launcher registration, Native pipe | No | Not available in v1. |

Suggested initial request bounds, to be finalized with Phase 5C tests: one active AI request per plugin; at most 5 AI calls per minute per plugin; maximum 50,000 input characters per message, 100 messages, 2,048 output tokens, and 60 seconds before cancellation. These are proposed host policy values, not observed budgets. Enforce request and result sizes in Main before invoking SharedAIService and before returning data to renderer. If the provider cannot abort, ignore late results after cancellation and do not resurrect a disabled/unloaded page.

The host should record capability name, plugin ID/version, action ID, success/denial/error class, timestamp and request correlation ID. Do not log API keys, full prompts, pasted source text, complete AI output, URLs with secrets/query credentials, or plugin private data. User-triggered AI disclosure may show the prompt locally but the ordinary audit log stores only counts and metadata.

### Shared AI path

    Plugin page action
       → preload desktop.plugins.invoke(pluginId, actionId, boundedInput)
       → Main sender/state/grant/schema/quota checks
       → explicit SharedAIService capability adapter
       → existing selected AI provider + existing credential store
       → bounded text result / provider metadata

**SharedAIService** owns provider selection and obtains credentials through **AIProviderCredentialStore** / **SecretStore**. The plugin sees only a result and non-secret metadata such as provider name and model. It cannot choose an arbitrary URL/provider, retrieve a key, change Shared AI settings, enumerate other provider configuration, or get a credential reference. Credential prompts and config stays in existing Settings.

AI call errors return stable error codes, not raw headers, HTTP response bodies, paths, or secret-bearing request objects. Cancel, disable, Manager close, or NativeHost-driven Manager shutdown aborts the request where supported. If the provider adapter does not honor cancellation, the broker rejects/discards late completion.

## 8. Lifecycle and Failure Model

### State model

    not-installed
        ↓ user import
    validating ── invalid / over limit ──→ rejected (no registry install)
        ↓ validated and atomically stored
    installed-disabled
        ↓ user grants required capabilities and enables
    enabled
        ↓ Manager discovers and registers data-only page
    active
        ↓ user action
    invoking ── success / bounded error / cancel ──→ active
        ↓ disable / revoke / uninstall / Manager close
    stopping
       ├── disable → installed-disabled
       ├── uninstall → not-installed (data preserved or explicitly deleted)
       └── Manager close → process exits; persistent package state remains enabled

**active** means the declarative page is registered in the open Manager; it does not mean a plugin-owned JavaScript runtime is executing. Additional inspectable states are **incompatible**, **invalid**, **needs-permission**, and **faulted**. No auto-restart loop exists. A validation or action failure is visible, scoped to the plugin, and does not crash the entire Manager; repeated identical host-action failures can temporarily block that action until the user retries.

### Startup and shutdown

- NativeHost startup: no plugin enumeration, process, timer, IPC, or filesystem operation; Electron remains zero.
- Manager startup: load plugin registry from the managed profile, validate stored package hashes/manifests, expose enabled compatible descriptors. No plugin code runs. Disabled/incompatible entries are not rendered as active.
- Plugin action: one bounded invocation at a time per plugin in v1; cancel token tied to Manager session and plugin generation. Requests include plugin ID, package digest, action ID, correlation ID; old-generation responses are ignored.
- Disable/revoke: deny new calls first, abort current operation, await bounded cleanup, unregister the page, retain data. No arbitrary plugin callback is called.
- Manager close: cancel all plugin-owned broker operations and timers (there are no plugin timers), clear in-memory plugin session state and exit the same Electron process group. The NativeHost remains running. Persistent plugin catalog/data remains.
- NativeHost exit: no plugin teardown is necessary; it never owns plugin runtime. Normal Manager shutdown remains through existing ManagerController.
- Installer update: keep plugins in the per-user profile, not the program install root or **app.asar**; check compatibility when the upgraded Manager next starts. Incompatible packages stay disabled and intact.

The normal Manager lifecycle contract remains authoritative: Manager is started only when NativeHost requests a Manager page and normal Manager close exits Electron. Phase 5C must not add a resident plugin service or detached child process.

## 9. Plugin Data and Configuration Layout

Root is under the existing **app.getPath('userData')**, normally **%APPDATA%\\Nook\\plugins**. It is separate from **nook-data.json**, **secrets.json**, and **launcher-state.json**.

    %APPDATA%\\Nook\\plugins\\
      registry.json                 host-owned ID/version/state/grant/digest records
      packages\\
        org.example.help-links\\
          1.0.0\\
            manifest.json
            assets\\icon.png
      config\\
        org.example.help-links.json host-validated settings values
      data\\
        org.example.help-links\\     plugin-private JSON blobs through broker
      cache\\
        org.example.help-links\\     disposable derived/cache data
      logs\\
        plugin-actions.jsonl         redacted, bounded host audit events
      staging\\                      removed after each install attempt

Rules:

- Package files are immutable after install; replace by installing a new version directory.
- Plugin ID and path components are independently validated and generated by the host.
- Plugin data API accepts opaque bounded JSON values/key names, never a path. Default initial quota proposal: 5 MiB total per plugin, 512 KiB per value, 200 keys; validate with tests in 5C.
- Config is host-owned and schema-validated. Secrets/API keys are not supported as plugin config.
- Disabled plugins retain config/data/cache; cache may be cleared by host. Uninstall preserves config/data by default; package files are removed. The UI offers an explicit separate deletion option.
- When a plugin is incompatible after host upgrade, its files remain and it is disabled; no automatic data rewrite occurs.
- Renaming an ID creates a different plugin namespace. A manual migration is possible only as an explicit future host workflow after user confirmation and backup.
- Errors never cause data deletion. Registry writes use temp-file + flush/atomic replace and retain a recovery copy.

These paths describe future design only; no plugin folders or test data were created in this Phase 5B review.

## 10. Manager Plugin Center

### Placement

Add “插件” as an item within the existing “应用” section in the Manager sidebar, beside Translation. Do not change the default Favorites home, Native tray routing, or Settings placement. The plugin center is a distinct Manager view; plugin pages appear as host-rendered items only while the plugin is enabled.

### Main list and detail

- Installed list: icon, name, version, author, enabled / disabled / incompatible / error status, last validation result.
- Details: source (local file), publisher verification status, API compatibility, package digest, requested vs granted capabilities, data-retention summary, change notes if the package includes plain-text release notes.
- Actions: install local package, enable, disable, revoke capability, open plugin page, edit schema-defined config, import replacement version, uninstall with separate keep/delete data choice.
- Security copy: explain that local package publisher is unverified. For v1, explicitly say package has no executable code, but granting **sharedAI.complete**, clipboard write, or external open lets it perform that specific operation when the user triggers it.
- Error states: unsupported host API, corrupt package, invalid manifest, permission revoked, resource limit, action failure, operation cancelled, data-store error. Include a safe retry or disable route.
- No marketplace, online discovery, rating, update polling, account, or cloud sync.

### Core flows

Install: choose file → validation progress → package summary and permission review → install disabled → user explicitly enables and grants → page appears.

Disable: user action → broker denies new calls → cancel active work → page disappears → package/data retained.

Uninstall: disable and cancel → choose whether to delete plugin data → remove package only → report preserved data state.

Update: choose replacement → validate beside existing version → explain version and capability changes → request only new grants → atomically switch → rollback on failure.

## 11. SDK and Versioned Extension Contract

For declarative v1, the public SDK is:

1. A versioned JSON Schema for **manifest.json**.
2. A documented allowlist of view blocks and action kinds.
3. A capability catalogue with data flow, user gesture, request/result limits, failure codes, and permission UX.
4. A portable package validator / pack command delivered in Phase 5E, independent of WebTools app source.
5. A sample **.wtplugin** source package built and tested separately from WebTools renderer/Main modules.

There is no JS lifecycle SDK, plugin **activate() / deactivate()** code, Node type definition, or access to Vue / Electron types in v1. **init** is the host’s parse/validate/register step; **dispose** is cancel/unregister at disable or Manager close. Keep host behavior behind API-major contracts; additions are optional within an API major, removed/changed action semantics require a major increment. **minHostVersion** supplies a clear host floor. Unknown optional display metadata may be ignored; unknown executable action or required capability fails closed.

Potential contract outline:

    PluginManifestV1
      ├── metadata: id, name, version, author, description
      ├── host compatibility: apiMajor, minHostVersion
      ├── entry: pageId, label, built-in icon id or declared PNG asset
      ├── requestedCapabilities: known capability IDs only
      ├── settings: schema-supported fields only
      ├── pages: known block union only
      └── actions: closed action union only

Do not ask plugin developers to import **src/shared**, reach into **electron/services**, compile against **window.desktop**, or depend on internal Vue component names. Publish the schema and behavior contract as versioned public artifacts with a compatibility test matrix.

## 12. Performance, Security, and Windows Acceptance Design

No Phase 5C–5F runtime test was run here. Numeric memory or latency targets are **not** invented in this design. Establish reproducible baselines first, then approve thresholds using real packaged builds.

### Performance baseline method

For each condition use the same source/build identity, isolated profile, Windows account / machine, settle period, measurement tool, and process-tree definition. Record raw samples and summarize median/range rather than comparing a single Task Manager snapshot:

1. NativeHost idle, no Manager, no plugin directory (Electron process count must be zero).
2. Manager opened with no plugins installed.
3. Manager opened with all example plugins installed but disabled.
4. Manager opened with one small enabled declarative plugin.
5. Manager opened with a small agreed set of enabled plugins.
6. Run repeated representative actions, then close Manager and verify Electron process group returns to zero.

Record NativeHost, Electron Main / renderer / utility / GPU processes, total process-group memory, CPU, JS heap and DOM when reliable, package scan time, Manager ready time, action duration, handle/thread count where available, and cancellation latency. Compare 2–5 against condition 2. Do not set an MB budget until this baseline exists. Disabled packages must not register pages or initiate network activity.

### Security / integrity matrix

| Test | Expected result |
|---|---|
| Valid minimal unsigned package | Clearly labeled unverified local author; install disabled; enable requires consent. |
| Absolute path, traversal, drive, UNC, ADS, reserved name, symlink, duplicate-case entry | Reject before registry change or files escape staging; no partial install. |
| Corrupt ZIP, duplicate manifest keys, unknown required schema field, invalid ID/SemVer/API | Reject with stable visible error; existing version unchanged. |
| Oversized archive, too many files, expansion limit / ratio limit | Streaming cap stops extraction; staging is removed; Manager remains responsive. |
| Same ID/version/same hash and changed hash | First is no-op; second requires explicit replacement; rollback retains old valid version. |
| Manifest requests unknown, ungranted or removed capability | Enable/action rejected fail-closed; no fallback to broader API. |
| Direct forged renderer IPC, wrong sender/frame, unknown action ID, oversized input | Main rejects; sender and structured error logged without sensitive payload. |
| Plugin tries to read filesystem, credentials, full Settings, Websites, clipboard, network, or Native pipe | No API exists; attempt cannot be expressed through supported manifest/action schema. |
| **external.open** with non-HTTPS or without direct user action | Rejected; no URL is opened. |
| **sharedAI.complete** without grant, over limits, cancelled, disabled mid-flight | Rejected/cancelled; no API key or provider config returned; late response ignored. |
| Disable / revoke / uninstall during active operation | New calls denied immediately; active work aborts or result discarded; package/data behavior follows explicit choice. |
| Profile recovery / registry corrupt / package modified after install | Invalid plugin disabled/quarantined; user data untouched; no automatic enable. |
| Electron normal close with an action active | Action cancellation initiated; Electron process group exits; NativeHost remains; no plugin child process exists. |

### Windows package acceptance

- Test only in a disposable account/profile and isolated install directory; never use the live install or real **%APPDATA%\\Nook** for destructive tests.
- Build with existing NativeHost-first pipeline. Check **.wtplugin** remains in the profile and the Manager stays under **Manager\\WebTools.exe**.
- Cold launch → NativeHost present, Electron count zero.
- Native Launcher search and tray work without reading plugin directory or starting Electron.
- Open plugin center → one existing Manager instance starts; import/install/enable; page renders without webview, navigation, or dynamic module.
- Close Manager normally → Electron process group zero, NativeHost/tray continue.
- Reopen Manager → package state is recovered and compatible plugin page returns.
- Upgrade/replace and uninstall on a disposable profile; verify package-only removal and explicit data-retention choice.
- Confirm a future installer upgrade does not silently delete incompatible plugin packages or user data.

## 13. Phases 5C–5F Implementation Roadmap

Each phase requires separate user approval. Do not automatically proceed when a phase finishes.

### Phase 5C — Plugin Core

**Inputs:** User approval of this Phase 5B architecture; exact v1 capabilities; initial quotas/limits; selected maintained ZIP reader; threat model and failure codes.
**Deliverables:** Versioned manifest/schema and TypeScript types; package validator/streaming safe extractor; registry and scoped package/data store; install/replace/uninstall transaction; permission broker; declarative action executor; typed Main/preload contract; lifecycle and cancellation; deterministic tests.
**Acceptance:** hostile archive fixtures; malformed and incompatible manifests fail closed; atomic replacement/rollback; no path to renderer; no capability without grant; SharedAI key remains inaccessible; no plugin work in NativeHost; NativeHost idle Electron=0; Manager close Electron group=0; test profile only.
**Prohibited:** executable plugin payloads, arbitrary network/filesystem/process APIs, Native Launcher changes, plugin UI redesign, new data schema in existing AppData, marketplace, unapproved dependencies.
**Stop conditions:** archive validation cannot prevent traversal/link/resource abuse; safe store path cannot be established; a required v1 feature needs arbitrary code or broad privilege; real profile would be needed for tests.

Suggested dependency order:

1. Contract / schema and threat-model tests.
2. Archive validator and hostile fixture tests.
3. Registry and atomic package/data store.
4. Permission broker and action union.
5. Shared AI adapter through existing service, only after capability review.
6. Install lifecycle, rollback and cancellation.
7. Main/preload contract integration and architecture tests.

Do not parallelize schema, archive, and broker implementations before their interfaces are approved. A read-only reviewer can check archive/security code after each step.

### Phase 5D — Manager Plugin Center

**Inputs:** Phase 5C tested contracts; user approval of UI flow and wording.
**Deliverables:** “插件” entry within the existing Apps navigation; installed list/details; permission review/revoke; local install, enable/disable, settings, replacement and uninstall/data-retention UI; error/recovery states; narrow MyMemory Settings wording correction from Phase 5A.
**Acceptance:** manager default home remains Favorites; explicit Settings/Translation navigation unchanged; form/schema render only allowlisted components; keyboard/focus/accessibility; install and destructive flows are explicit; revoked permission is visible; saved config and data survive app restart as specified.
**Prohibited:** marketplace, account/cloud features, arbitrary plugin HTML/JS, blanket Settings redesign, changes to Native Launcher UI.
**Stop conditions:** UI implies publisher authenticity or sandbox strength that does not exist; permission state and service registry can diverge.

### Phase 5E — SDK and Example Package

**Inputs:** Phase 5C–5D frozen API major and UI/action schema.
**Deliverables:** versioned manifest JSON Schema, developer contract/docs, pack/validate tool, independently authored sample package, compatibility fixtures, packaged Manager test of externally produced package.
**Acceptance:** sample is built outside WebTools application source; package opens a real host-rendered Manager page; validator output matches host validation; example works from installed Windows candidate; API compatibility rejection is clear; no internal-source imports.
**Prohibited:** publishing a public marketplace, signing infrastructure, remote update service, executable scripts without separate approval.
**Stop conditions:** sample needs a hidden host-only API; packer output cannot be validated by installed host; contract depends on private source types.

### Phase 5F — Final Acceptance

**Inputs:** Approved feature behavior; completed 5C–5E artifacts; locked source/build identity.
**Deliverables:** Functional/security/lifecycle/Windows acceptance report; isolated installer and upgrade evidence; known-issues and support boundary.
**Acceptance:** security matrix above; user-approved manual plugin import/grant/revoke/update/uninstall checks; NativeHost idle Electron=0; ordinary Manager close returns Electron process group to zero; Windows install/upgrade preserves profile data; no P0/P1/blocking P2; exact artifact/source identity.
**Prohibited:** long soak or memory optimization without evidence; production install modification; release/merge unless separately approved.
**Stop conditions:** any permission bypass, package path escape, secret exposure, data loss, Electron residency regression, NativeHost crash, or unsafe upgrade behavior.

## 14. Risks, Open Decisions, and Findings

### Findings

- **P0: 0.**
- **P1: 0.**
- **Blocking P2: 0 found in this Phase 5B design review.**
- **Inherited, non-blocking P2: 2 referenced from Phase 5A / 4G-6 and not changed here.**
  1. **electron/main.ts** currently allows general main-frame **file:** navigation. The G6 report deferred a separate review; no plugin package documents will be loaded in v1. Before any plugin feature that adds document navigation, narrow the policy and test it.
  2. The Native Manager pipe is CurrentUserOnly, but its initial peer PID is not bound to the NativeHost-launched process according to the G6 report. V1 plugin calls stay within Electron Main and do not extend this pipe. Do not treat same-user ACL as hostile same-user process isolation.
- **P3: 2 design/documentation limitations.**
  1. Phase 5A recommends no framework based on the then-known scope. The explicit Phase 5 objective now supersedes that product-direction conclusion; its historical record is preserved.
  2. The Phase 5A MyMemory Settings trigger wording is stale and remains a narrow Phase 5D task.

No package archive, plugin runtime, Manager page, IPC channel, dependency, schema, installer, user profile, registry key, startup setting, or production process was modified in this phase.

### Open decisions to confirm before Phase 5C

1. Accept v1 as declarative Manager plugins only, with no arbitrary executable scripts and no Native Launcher extension.
2. Confirm requested/granted capability UX, especially whether **clipboard.write** and **sharedAI.complete** require per-plugin consent once and a per-action confirmation every time. Recommendation: explicit per-plugin grant; each AI operation still requires a visible user click and prompt disclosure; clipboard write requires direct click and bounded content.
3. Confirm provisional archive / data quotas in sections 5 and 9, or have Phase 5C validate adjusted values with fixture-based abuse tests.
4. Select and pin a maintained ZIP reader only in Phase 5C after verifying secure streaming and Windows path/link handling. Do not write a custom partial ZIP parser.
5. Decide whether unsigned local plugin warnings are enough for the initial local-only release. Recommendation: no trust signature claim; prominently label publisher unverified and keep v1 non-executable.

These decisions are not implementation blockers for the design document, but Phase 5C should not proceed until the user approves the overall architecture and the first three capability/data/package policy choices.

## 15. Phase 5B Deliverables and Git Review

- Plan: **docs/superpowers/plans/2026-10-04-webtools-phase5b-plugin-architecture.md**.
- Architecture: this document.
- Product source, dependencies, lockfiles, app data, installer, and tests: unchanged.
- Current architecture facts are based on static source inspection and cited historical reports; this task did not claim Windows runtime behavior.
- Official security references are linked in section 4.
- Final documentation diff, whitespace validation, commit and push are recorded in the Phase 5B completion response after Git verification.

**PHASE 5B DESIGN COMPLETE — PENDING USER APPROVAL**

Stop here. Do not start Phase 5C.
