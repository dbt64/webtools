# Phase 6C — Product Interaction Wireframes and Sequences

**Status:** low-fidelity design only; no production UI or XAML/Vue is included.

## 1. A — Launcher 2.0

~~~text
┌────────────────────────────────────────────────────────────────────┐
│  Search apps, websites, or Features…                         [W]   │
├────────────────────────────────────────────────────────────────────┤
│  APPLICATIONS AND WEBSITES                              existing  │
│  [icon] Visual Studio Code                                      ↵  │
│  [icon] vscode.dev                                               │
│  Existing behavior, rank and combined result cap are unchanged.   │
├────────────────────────────────────────────────────────────────────┤
│  PLUGIN FEATURES                                      up to 6 rows │
│  [◇] Word Count                                  Text Tools      ↵ │
│      Accepts text from this search                               │
│  [◇] Search Docs                                  Docs Plugin     ↵ │
│      Open a focused Web Feature                                  │
└────────────────────────────────────────────────────────────────────┘

Query: "word count"
The query is used for Feature matching. It is passed to a selected
Feature only if that Feature accepts launcher-input:text.
No query is broadcast to non-selected Features.
~~~

The Plugin Feature group is separately bounded and cannot displace current app/site rows. Query matching may use existing SearchCore normalization and pinyin behavior. Selecting a row is the explicit intent that binds the exact original query to a new invocation. The launcher itself does not execute plugin code.

Command modes remain isolated:

- local query: current app/site results plus separately bounded Feature group;
- /, ?, and file: preserve their existing routes and do not surface Web Feature actions in those modes;
- empty query: any Feature shortcuts require separate product approval; a projection row alone does not imply homepage visibility.

## 2. B — Super Panel

~~~text
┌───────────────────────────────────────────┐
│  CLIPBOARD CONTEXT                   [Close]│
├───────────────────────────────────────────┤
│  Source: Clipboard                         │
│  Type:   Text                              │
│  Preview: “Quarterly report: revenue ...”  │
│  Captured now · expires shortly            │
├───────────────────────────────────────────┤
│  MATCHING FEATURES                         │
│  [◇] Summarize          Notes Plugin    ↵  │
│  [◇] Translate          Built-in       ↵  │
├───────────────────────────────────────────┤
│  Native actions                            │
│  Copy text · Search web · Open Manager     │
└───────────────────────────────────────────┘
~~~

Super Panel is a context action surface, not a second global search Launcher. Opening it does not access the clipboard. The user explicitly chooses Clipboard Context; that Native-owned action creates an invocation ID, performs one bounded, one-shot capture, then shows the preview, eligible Features and built-in actions. It is the trusted gesture itself, so there is no duplicate confirmation. The snapshot remains local to Native during preview and matching, binds at most once to the Feature selected afterward, and is discarded on expiry if unused. A selected Web Feature receives it only after Main validates the current package, accepted context and plugin-wide clipboard.read grant, and the actual pipe peer authentication gate passes. There is no background monitor. A local text context may also be supplied from Launcher or another explicitly designed Native gesture. The v1 release has no generic screen selection, Explorer selection, image context or screen capture.

The panel may offer an optional action filter, but it is not a second plugin engine. It calls the shared Native Feature Matcher, then filters by accepted context pairs.

## 3. C — Manager Plugin Center

~~~text
┌──────────────────────────────────────────────────────────────────────┐
│ WebTools / Plugins                                      [Settings]   │
├──────────────────┬───────────────────────────────────────────────────┤
│ Installed        │ Text Tools                              Enabled   │
│                  │ Web Plugin · 2 Features · Host API 1               │
│ Declarative      │ Runs isolated Web code on explicit invocation      │
│   Private Notes  │                                                   │
│ Web Plugins      │ Permissions                                        │
│   Text Tools     │ [✓] Storage read/write                              │
│ Built-in         │ [ ] Network                                         │
│   Translation    │                                                   │
│                  │ Features                                            │
│                  │ Word Count      context: Launcher text              │
│                  │ Summarize       context: clipboard text              │
│                  │                                                   │
│                  │ Network scope: none                                 │
│                  │ Settings: [Open plugin settings]                    │
│                  │ [Disable] [Uninstall]                               │
└──────────────────┴───────────────────────────────────────────────────┘
~~~

Management-first hierarchy: Plugin identity/status, execution type, feature list, requested/granted capabilities, exact network scope and settings. Declarative Plugin, Web Plugin and Built-in Plugin are separate type labels. Install/upgrade confirmation summarizes executable code status, capabilities, exact domain scope and changed grants. Manager is the only permission management surface; Super Panel and Launcher never grant permissions.

## 4. D — Rich Web Plugin UI

~~~text
┌──────────────────────── Existing Manager BrowserWindow ─────────────┐
│ WebTools     Favorites   Websites   Settings   Plugins                │
├───────────────────────────────────────────────────────────────────────┤
│ Plugin runtime toolbar:  Text Tools / Word Count        [Close]      │
│ ┌──────────── Manager-owned boundary ──────────────────────────────┐ │
│ │                                                                 │ │
│ │      Isolated WebContentsView                                  │ │
│ │      app-owned unique origin                                   │ │
│ │      no Manager DOM/preload                                    │ │
│ │      narrow typed bridge only                                  │ │
│ │                                                                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ Host owns the shell, toolbar, permission indicators and close action. │
└───────────────────────────────────────────────────────────────────────┘
~~~

This is one Manager BrowserWindow with a child WebContentsView, not a new BrowserWindow or resident process. The plugin content cannot draw over or remove the host-owned toolbar. Host controls stay outside the plugin WebContents bounds. Layout geometry, resizing and close behavior require real installed-build tests.

## 5. Feature runtime state machine

~~~text
Dormant
  └─ valid user intent → Invoking
Invoking
  ├─ Main revalidation succeeds → Loading
  ├─ invalid/stale/denied → Failed
  └─ Manager startup fails → Failed
Loading
  ├─ correct origin + matching ready generation → Active
  ├─ load/CSP/protocol failure → Failed
  └─ close/disable/update/revoke/Manager close → Closing
Active
  ├─ user close → Closing
  ├─ disable/update/uninstall/revoke → Closing
  ├─ renderer crash → Failed, then Closing
  └─ Manager close → Closing
Closing
  ├─ bridge revoked, requests canceled, WebContents closed → Destroyed
  └─ bounded close timeout → Failed; do not create another runtime
Destroyed
  └─ a new explicit invocation → Invoking
Failed
  ├─ cleanup complete + explicit retry → Invoking
  └─ cleanup cannot be proven → retain host error; deny next Web runtime
~~~

There is no hidden pool transition. A state change invalidates the runtime generation before asynchronous cleanup begins. Update/revoke cannot leave an old bridge call authorized. If destruction is uncertain, fail closed and do not stack a second WebContents.

## 6. NativeHost window/process state machine

~~~text
Application: Running
  ├─ Launcher hidden/shown/focused  (window-only transition)
  ├─ Super Panel hidden/shown/focused (window-only transition)
  ├─ Manager absent/present (on-demand external process group)
  ├─ window close/dismiss → hide that window; Application remains Running
  ├─ Tray Exit → ExplicitExit → dispose services → exit
  ├─ fatal unrecoverable host error → FatalShutdown
  └─ Windows logoff/shutdown → OSShutdown
~~~

| Event | Launcher | Super Panel | Manager | NativeHost |
|---|---|---|---|---|
| Launcher Escape/outside click/close | Hide and clear transient UI | unchanged | unchanged | Continues |
| Super Panel dismiss/close | unchanged | Hide and clear context | unchanged | Continues |
| Both windows hidden | Hidden | Hidden | May be absent or running | Continues in tray |
| Manager close button | unchanged | unchanged | Destroy all BrowserWindow and plugin WebContents; Electron exits | Continues |
| Tray Exit | Hide/close | Hide/close | Request graceful close, await process exit | Explicitly exits |
| Windows shutdown/logoff | OS closes windows | OS closes windows | Graceful shutdown | Stops with OS/session |

Window.Close must never accidentally equal application shutdown.

## 7. Required sequence diagrams

### 7.1 Launcher → Declarative compatibility Feature

~~~mermaid
sequenceDiagram
    participant U as User
    participant L as Launcher
    participant N as NativeHost
    participant M as Main
    participant R as Manager Renderer
    U->>L: Select v1 compatibility Feature
    L->>N: FeatureRef + invocation ID
    N->>M: Open request over pipe
    M->>M: Resolve synthetic Feature to original v1 manager.page entry
    M->>M: Validate current version/hash/enabled/manager.page grant
    M->>R: Existing declarative catalog open
    R-->>M: Page mounted
    M-->>N: Accepted acknowledgement
~~~

### 7.2 Launcher → Web Feature and Launcher input context

~~~mermaid
sequenceDiagram
    participant U as User
    participant L as Launcher
    participant N as NativeHost
    participant M as Main
    participant V as WebContentsView
    U->>L: Type "word count", select Feature
    L->>N: FeatureRef + exact input snapshot + invocation ID
    N->>M: Intent + context ref + host session
    M->>M: Validate Feature, hash, grants, context source and replay state
    M->>M: Start/reuse Manager and create fresh Web runtime generation
    M->>V: Load validated package entry on unique app-owned origin
    V->>M: Ready(runtimeId, generation)
    M->>V: Deliver matching invocation-scoped context
    M-->>N: Invocation accepted
~~~

### 7.3 Clipboard text → Feature

~~~mermaid
sequenceDiagram
    participant U as User
    participant S as Super Panel
    participant N as NativeHost
    participant M as Main
    participant V as WebContentsView
    M->>N: Authenticate actual connected Manager peer (mandatory Gate 2)
    U->>S: Open Super Panel
    S->>N: Show panel; do not read clipboard
    U->>S: Choose Clipboard Context
    S->>N: Native-owned one-shot capture gesture
    N->>N: Read bounded text once; show local preview; match eligible Features
    U->>S: Select a matching Feature
    N->>M: FeatureRef + invocation ID + opaque contextRef (no value yet)
    M->>M: Revalidate package, grant, accepted context, invocation and runtime
    N->>M: Snapshot over authenticated connection only
    M->>M: Revalidate expiry, binding and runtime generation
    M->>V: Deliver to exact runtime generation
~~~

If Gate 2 has not passed, no sensitive context value is sent to Manager. Non-sensitive Feature projection and Launcher result presentation remain independent and do not acquire authority from the pipe.

### 7.4 Web Feature → Bridge → Host effect

~~~mermaid
sequenceDiagram
    participant P as Plugin Web renderer
    participant B as Minimal preload
    participant M as Main
    participant H as Host service
    P->>B: Typed bridge method + bounded payload
    B->>M: IPC request + correlation ID
    M->>M: Bind actual sender/frame/runtime and recheck grant/hash/generation
    M->>H: Authorized operation only
    H-->>M: Result or stable error
    M->>M: Recheck state before result/commit
    M-->>B: Bounded response envelope
    B-->>P: Value or stable error
~~~

### 7.5 Web Feature close → runtime destroy

~~~mermaid
sequenceDiagram
    participant U as User
    participant M as Main
    participant V as WebContentsView
    U->>M: Close Feature
    M->>M: Revoke generation and cancel bridge calls
    M->>V: Remove from contentView
    M->>V: webContents.close()
    V-->>M: destroyed/closed
    M->>M: Clear origin state and drop runtime descriptor
~~~

### 7.6 Manager close → all runtime destroy → Electron 0

~~~mermaid
sequenceDiagram
    participant U as User
    participant M as Electron Main
    participant V as Active plugin WebContents
    participant N as NativeHost
    U->>M: Close Manager window
    M->>M: Stop accepting Feature/bridge work
    M->>V: Revoke, remove and close every plugin WebContents
    V-->>M: All runtime cleanup completed
    M->>M: Destroy Manager BrowserWindow and quit Electron
    M-->>N: Manager exited
    Note over N: NativeHost, tray and hotkey continue; Electron group is zero
~~~

### 7.7 Disable while runtime active

~~~mermaid
sequenceDiagram
    participant U as User
    participant M as Main
    participant V as WebContentsView
    U->>M: Disable Plugin
    M->>M: Mark mutation generation; reject new invocations
    M->>V: Revoke bridge and cancel requests
    M->>V: Remove and close view
    V-->>M: Destroyed
    M->>M: Persist disabled state and publish projection without Features
~~~

### 7.8 Update while runtime active

~~~mermaid
sequenceDiagram
    participant U as User
    participant M as Main
    participant V as Old WebContentsView
    U->>M: Install update
    M->>M: Validate archive and compute grant delta before replacement
    M->>M: Block new old-version invocations
    M->>V: Revoke old hash/generation and close runtime
    V-->>M: Destroyed
    M->>M: Atomically commit validated new package/grants
    M->>M: Publish full new Feature projection
~~~

### 7.9 Plugin disable/update/uninstall/revoke common rule

Every mutation first advances the current plugin mutation generation and prevents new invocation. It revokes runtime bridge authority and cancels pending work. The old WebContents is removed/destroyed before package bytes or grants are changed. If destruction fails, do not commit an update that leaves executable old code active; show a failure and preserve the prior package state.

## 8. UX and error behavior

- Native search remains usable if Manager startup or plugin runtime fails.
- Stale projection returns a host-owned retry/refresh state; it does not reveal package paths.
- Permission denied and unsupported Feature errors are concise, stable and include no secret/context payload.
- A busy runtime close state prevents opening a second Web runtime.
- Context preview is truncated visually only; payload size limit is enforced before delivery. Never silently truncate the data sent to a Feature.
- Close, cancel and Manager exit are always host-owned controls outside plugin content.
