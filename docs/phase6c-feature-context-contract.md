# Phase 6C — Feature and Context Contract Draft

**Status:** approved design contract; examples only, not a production schema or Plugin API change.

## 1. Design goals

- Make Feature the stable invocation unit while preserving Plugin identity and lifecycle.
- Keep display/search metadata separate from authority and executable package data.
- Keep Context type distinct from its acquisition source.
- Make defaults explicit: omitted command/context/capability lists mean empty lists.
- Bound all author-controlled strings, collection sizes and payloads before indexing or transport.
- Let Main re-resolve the current package and grants for every invocation.

## 2. Field contract

| Field | Required? | Meaning / default | Bounds and localization | Authority |
|---|---|---|---|---|
| id | Required | Stable identity within this Plugin | Lowercase ASCII [a-z0-9]+(?:-[a-z0-9]+)*, 1–64 chars | Host-validated manifest; immutable identity after release |
| title | Required | User-facing Feature label | 1–80 Unicode scalar values; author-provided single string | Host-validated manifest |
| description | Optional | Short explanation in Manager/Super Panel details | Up to 240 Unicode scalar values; author-provided single string | Host-validated manifest |
| commands | Optional | Search aliases; omitted means [] | At most 8 strings, each 1–48 Unicode scalar values; trim and Unicode-normalize before indexing | Host-validated manifest; Native receives bounded derived text |
| icon | Optional | Small host token or declared PNG asset; omitted means generic plugin token | Host token from closed allowlist; asset path must be in exact validated archive inventory | Main validates; Native receives token only |
| acceptedContexts | Optional | Eligible context type/source pairs; omitted means no context is passed | At most 4 pairs; current type is text; sources are launcher-input or clipboard | Host-validated manifest, not a grant |
| entry | Required | Runtime kind and package-local entry reference | Closed tagged union; paths are normalized archive paths, never filesystem paths | Host parser/package validator |
| requiredCapabilities | Optional | Feature's requested subset; omitted means [] | At most 12 unique capability IDs, capped by the known v2 capability set | Host validates subset of Plugin request and separately checks user grant |
| pluginId | Derived | Owner from the enclosing manifest | Existing Plugin ID contract | Main registry |
| version/hash | Derived | Exact installed package content identity | Existing semver/content hash rules | Main registry and package validator |
| enabled/granted status | Derived | Current state, never accepted from the manifest | Not copied from author payload | Main registry and permission broker |

Titles and descriptions are not locale maps in v2. They are author-supplied strings displayed as-is; WebTools-owned labels remain localized by the Host. This avoids an open-ended locale object in the first schema. A later localization feature would require an explicit bounded schema revision.

The limit of 16 Features per Plugin is a first-release engineering/safety bound, not a permanent Product Contract or public SDK ceiling. A future increase requires measured validation and a safely versioned contract/validator update; SDK documentation must describe the applicable version's current bound without promising that the platform is permanently limited to 16.

Feature identity is always the composite (pluginId, featureId). A Feature id is stable across releases; changing it is a new Feature and may break saved shortcuts or invocation references. Name, title, aliases, icon and description can change without changing identity.

## 3. TypeScript draft

~~~typescript
type FeatureId = string
type PluginCapabilityId = string

export interface FeatureRef {
  pluginId: string
  featureId: FeatureId
}

export type ContextType = 'text'
export type ContextSource = 'launcher-input' | 'clipboard'

export interface AcceptedContext {
  type: ContextType
  sources: ContextSource[]
}

export type FeatureIcon =
  | { kind: 'host'; key: 'sparkles' | 'document' | 'globe' | 'translate' }
  | { kind: 'asset'; path: string }

export type FeatureEntry =
  | { kind: 'web-bundle'; document: string }

// Internal catalog entry: the v1 adapter synthesizes this without rewriting
// or reparsing any v1 archive. It is not a Manifest v2 entry kind.
export type ResolvedFeatureEntry =
  | FeatureEntry
  | { kind: 'declarative-compatibility'; pageId: string }

export interface FeatureDefinition {
  id: FeatureId
  title: string
  description?: string
  commands?: string[]
  icon?: FeatureIcon
  acceptedContexts?: AcceptedContext[]
  entry: FeatureEntry
  requiredCapabilities?: PluginCapabilityId[]
}

export interface ValidatedFeature extends FeatureDefinition {
  ref: FeatureRef
  packageVersion: string
  packageHash: string
}

export interface ResolvedFeature extends Omit<FeatureDefinition, 'entry'> {
  ref: FeatureRef
  entry: ResolvedFeatureEntry
  packageVersion: string
  packageHash: string
}

export interface ContextRef {
  invocationId: string
  contextId: string
}

export interface ContextSnapshot {
  invocationId: string
  contextId: string
  capturedAtUnixMs: number
  expiresAtUnixMs: number
  type: 'text'
  source: ContextSource
  text: string
}

export interface FeatureInvokeRequest {
  protocolVersion: 1
  hostSessionId: string
  requestId: string
  invocationId: string
  feature: FeatureRef
  expectedProjectionRevision: number
  contextRef?: ContextRef
  gesture: 'launcher-selection' | 'super-panel-selection' | 'clipboard-context-selection'
}

export type FeatureInvokeResult =
  | { status: 'accepted'; invocationId: string; runtimeGeneration: number }
  | { status: 'rejected'; code: FeatureInvokeErrorCode }

export type FeatureInvokeErrorCode =
  | 'STALE_FEATURE'
  | 'PLUGIN_DISABLED'
  | 'PLUGIN_INCOMPATIBLE'
  | 'CAPABILITY_NOT_REQUESTED'
  | 'PERMISSION_REQUIRED'
  | 'CONTEXT_NOT_ACCEPTED'
  | 'CONTEXT_EXPIRED'
  | 'INVOCATION_REPLAYED'
  | 'RUNTIME_BUSY'
  | 'RUNTIME_UNAVAILABLE'
  | 'PROJECTION_REFRESH_REQUIRED'
  | 'INVALID_REQUEST'
~~~

The actual implementation must use the repository's existing result/error envelope conventions. The draft carries expected identity/revision values for race detection, but Main resolves authority from its live registry instead of trusting these values.

## 4. C# contract draft

~~~csharp
public sealed record FeatureRef(string PluginId, string FeatureId);

public enum FeatureEntryKind
{
    WebBundle
}

public enum ResolvedFeatureEntryKind
{
    WebBundle,
    DeclarativeCompatibility
}

public enum FeatureContextType
{
    Text
}

public enum FeatureContextSource
{
    LauncherInput,
    Clipboard
}

public sealed record AcceptedContextDto(
    FeatureContextType Type,
    IReadOnlyList<FeatureContextSource> Sources);

public sealed record FeatureDefinitionDto(
    string Id,
    string Title,
    string? Description,
    IReadOnlyList<string> Commands,
    string IconToken,
    IReadOnlyList<AcceptedContextDto> AcceptedContexts,
    FeatureEntryKind EntryKind,
    IReadOnlyList<string> RequiredCapabilities);

public sealed record ResolvedFeatureDto(
    FeatureRef Ref,
    FeatureDefinitionDto Definition,
    ResolvedFeatureEntryKind ResolvedEntryKind,
    string? CompatibilityPageId,
    string PackageVersion,
    string PackageHash);

public sealed record FeatureProjectionRow(
    FeatureRef Ref,
    string PluginName,
    string Title,
    IReadOnlyList<string> Commands,
    IReadOnlyList<AcceptedContextDto> AcceptedContexts,
    string IconToken,
    string FeatureKind);

public sealed record FeatureInvokeRequestDto(
    int ProtocolVersion,
    Guid HostSessionId,
    Guid RequestId,
    Guid InvocationId,
    FeatureRef Feature,
    long ExpectedProjectionRevision,
    string? ContextId,
    string Gesture);
~~~

C# DTOs are proposed transport records. NativeHost validates their exact fields, enum values, lengths, uniqueness and byte count; it does not trust Main merely because the pipe is current-user-only. Main still owns authorization.

## 5. Manifest example

~~~json
{
  "manifestVersion": 2,
  "id": "org.example.text-tools",
  "name": "Text Tools",
  "description": "Small text utilities",
  "author": { "name": "Example Author" },
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
      "entry": { "kind": "web-bundle", "document": "web/word-count/index.html" },
      "requiredCapabilities": []
    }
  ],
  "webBundle": {
    "files": [
      { "path": "web/word-count/index.html", "mediaType": "text/html" },
      { "path": "web/word-count/app.js", "mediaType": "text/javascript" },
      { "path": "web/word-count/style.css", "mediaType": "text/css" }
    ]
  },
  "network": { "mode": "none", "domains": [] }
}
~~~

acceptedContexts is discoverability/matching metadata. It does not grant clipboard access. requiredCapabilities can only narrow requestedCapabilities; the example has no host privilege. The plugin still runs author JavaScript in the isolated Web runtime, and install/enable UX must say so.

## 6. Context contract

Context **type** answers “what data shape is this?” Context **source** answers “where did it come from?” Do not collapse them into one string such as clipboard:text.

Initial pairings:

| Type | Source | Capture owner | Trigger | First-release bound |
|---|---|---|---|---|
| text | launcher-input | Native Launcher | User selects a matching Feature row | Existing Native input guard is 300 UTF-16 code units; context envelope also caps at 16 KiB UTF-8. Query normalized only for matching; original exact text passed |
| text | clipboard | NativeHost OS clipboard API | User explicitly chooses the Native-owned “Clipboard Context” action; opening Super Panel alone does not capture | 32 KiB UTF-8; oversized content is rejected, never silently truncated |

The snapshot includes request/invocation ID, opaque context ID, capture time, expiry, type, source and bounded value. For Clipboard Context, Native creates the invocation ID when the user explicitly selects the context action; the local pending snapshot can be bound at most once to the Feature selected afterward. If no Feature is selected, discard it at expiry. The selected Feature request reuses that invocation ID and carries only a ContextRef until the authenticated sensitive transport is ready. The proposed TTL is 30 seconds for receipt by Main; once accepted, the active runtime may read the snapshot only for that invocation until the Feature closes, with a hard maximum of 10 minutes. Closing, cancellation, timeout, plugin state change, runtime crash or Manager exit invalidates it.

Context is data, not authority. It cannot name a package path, grant a capability, choose an arbitrary URL or bypass a host dialog. The same invocation ID cannot attach a different snapshot later.

## 7. Clipboard contract

Capabilities are distinct:

- clipboard.read permits the approved one-shot text-capture flow. It does not enable polling or general clipboard API access.
- clipboard.write permits a Main-mediated write after explicit confirmation. It cannot silently replace clipboard content.

The Web bridge has no ambient clipboard.readText() method. Choosing Clipboard Context is the explicit Native-owned gesture: NativeHost reads one bounded snapshot, presents a bounded preview and matches eligible Features. This local capture does not itself grant a Plugin permission. A Plugin can receive the snapshot only after the user selects a Feature, Main validates that Plugin’s existing clipboard.read grant and accepted context, and the actual NativeHost/Manager peer-authentication gate passes. No second confirmation button is required.

Clipboard rules:

1. Text only in the first version. Images and file-drop payloads are deferred.
2. Read at most 32 KiB of UTF-8. If exceeded, return CLIPBOARD_TOO_LARGE; do not truncate.
3. Super Panel opening never captures. The explicit Clipboard Context action captures at most one local snapshot and shows a bounded preview; this action is the user gesture, not a Plugin grant.
4. Feature matching may use the local snapshot, but delivery to a Web Feature requires that the selected Plugin requested and was granted clipboard.read and that the accepted-context pair includes text/clipboard. Main revalidates these conditions.
5. No clipboard value crosses NativeHost ↔ Manager transport until the actual connection peer is authenticated. CurrentUserOnly ACL and a self-reported PID are not sufficient.
6. Capture once for the user action, bind to at most one selected Feature/invocation, and deliver at most once. No polling, history, delayed capture, synthetic Ctrl+C or retries that reread silently.
7. Expire an undelivered snapshot after 30 seconds. Destroy the value on delivery completion, cancellation or invocation close.
8. Never persist or log clipboard value, include it in diagnostics, crash reports, analytics or error strings.
9. On access failure return a stable error code and leave clipboard contents unchanged.
10. Writing requires clipboard.write, exact sender/session validation and a host-owned confirmation immediately before the write.

## 8. Context and matching semantics

- A Feature with no acceptedContexts can still be invoked from a direct shortcut or Manager; it receives no context.
- Search aliases help locate a Feature; they are not the context payload.
- For launcher-input:text, the exact user-entered string is captured after row selection. Search normalization must not mutate the delivered text.
- A Super Panel may list only Features that accept its current context type/source, plus built-in actions that handle that context. Metadata matching is not permission authority.
- Context source mismatch means the Feature is not eligible, even if its type matches.
- Context acceptance does not imply clipboard.read, external.open, storage, network or AI authority.
- Context payloads are excluded from Native search projection; only command/title metadata is projected.

## 9. Storage, external open and AI bridge draft

The narrow bridge should contain only APIs that require Host authority. Browser APIs and npm libraries remain the default for UI, formatting, parsing and local computation.

~~~typescript
export interface WebToolsPluginBridge {
  context: {
    current(): Promise<ContextSnapshot | null>
  }
  storage: {
    get(key: string): Promise<PluginJson | null>
    set(key: string, value: PluginJson): Promise<void>
    remove(key: string): Promise<void>
  }
  external: {
    open(url: string): Promise<void>
  }
  clipboard: {
    writeText(text: string): Promise<void>
  }
  sharedAI: {
    complete(input: SharedAIRequest): Promise<SharedAIResult>
  }
  lifecycle: {
    onClose(callback: () => void): () => void
  }
}
~~~

No dialog or permissions.request method is included. Permission changes remain a Manager action. clipboard.read is the Native context-capture and delivery policy, not a renderer API; the explicit Native gesture permits one local capture but does not grant Plugin access. sharedAI.complete is optional, lazy and gated by the existing sharedAI.complete capability, request limits, provider configuration and current host review/consent behavior. It must never expose tokens or provider credentials.

| Namespace | Why Host is needed | Browser/npm alternative | Gate / owner | Request scope / lazy |
|---|---|---|---|---|
| context.current | Deliver the exact selected invocation snapshot | No ambient browser source exists | Main validates invocation; for clipboard, clipboard.read grant and authenticated Native/Manager peer are also required | Current invocation only; lazy |
| storage.* | Durable per-plugin data and safe path/quota handling | IndexedDB/localStorage are browser-local but not the formal backup/migration contract | Main → existing PluginStore; plugin.storage.read/write | Key/value request; lazy |
| external.open | Open a URL in the user's default browser | window.open is deliberately denied | Main validates scheme, capability and user confirmation | One click/request; lazy |
| clipboard.writeText | Write to OS clipboard safely | Browser Clipboard API permissions are not an accepted host policy | Main plus explicit host confirmation; clipboard.write | One user-approved call; lazy |
| sharedAI.complete | Use configured provider without disclosing token | Direct browser API would expose credentials | Main → existing shared AI service; sharedAI.complete | One bounded request; lazy |
| lifecycle.onClose | Notify UI before runtime destruction | Browser pagehide is best-effort and does not cover Host-driven revoke | Main pushes close event to exact runtime | Runtime lifetime only |
| permissions | Runtime request/grant management is not needed | Manager owns permissions | No public bridge; Manager is authority | Not exposed |
| dialog | Host-owned confirmation is required for sensitive effects | HTML dialog cannot establish trusted consent | Main/Manager-owned UI only | Not exposed |

The bridge contract is draft-only. Actual API details must be reconciled with the existing PluginApi, PluginStore, permission broker and shared AI limits before implementation.

For durable key/value storage, the current PluginStore is the only Host persistence path. Its current v1-derived limits are 200 keys, 512 KiB per value and 5 MiB for the serialized document. The Web bridge should reuse those limits without increasing them in this phase; quota behavior and atomic-write/session checks remain Main-owned.

## 10. Bridge message envelope and errors

~~~typescript
interface BridgeRequestEnvelope<T> {
  protocolVersion: 1
  requestId: string
  runtimeId: string
  runtimeGeneration: number
  feature: FeatureRef
  method: 'context.current' | 'storage.get' | 'storage.set' | 'storage.remove'
    | 'external.open' | 'clipboard.writeText' | 'sharedAI.complete'
  payload: T
}

interface BridgeResponseEnvelope<T> {
  protocolVersion: 1
  requestId: string
  runtimeId: string
  runtimeGeneration: number
  ok: true
  value: T
}

interface BridgeErrorEnvelope {
  protocolVersion: 1
  requestId: string
  runtimeId: string
  runtimeGeneration: number
  ok: false
  error: {
    code: 'INVALID_REQUEST' | 'PERMISSION_REQUIRED' | 'SESSION_EXPIRED'
      | 'CONTEXT_EXPIRED' | 'STORAGE_LIMIT' | 'USER_CANCELLED'
      | 'NETWORK_DENIED' | 'RUNTIME_CLOSED' | 'HOST_UNAVAILABLE'
    retryable: boolean
  }
}
~~~

The preload creates request IDs, but those IDs are correlation only. Main binds identity from Electron's actual sender and current runtime descriptor, not from payload claims. Extra fields are rejected. Error messages returned to plugin content are stable and do not contain filesystem paths, secret values, stack traces or proxy internals.

Cancellation uses an explicit request ID and an AbortSignal-like host token. Closing or invalidating a runtime aborts all its pending work. Main revalidates after each asynchronous boundary and before committing a write/effect. Late results are discarded if runtime generation, package hash, enabled state or grant revision changed.

## 11. Manifest to Feature validation

At install:

1. Host parser checks exact top-level and nested keys, field types, canonical IDs and string bounds.
2. Package validator validates archive bytes and exact file inventory; every entry/icon reference must name an allowed package entry.
3. Host checks Plugin requested capabilities, network declaration syntax and all Feature required-capability subsets.
4. Main stores immutable original archive bytes/content hash and a normalized internal representation.
5. User confirms execution type and requested capabilities/network domains; new privileges on update require re-consent.

At invocation:

1. Resolve (pluginId, featureId) in current Main-owned registry.
2. Check installed version/hash still matches current catalog and runtime.
3. Check enabled/compatible state and current user grant.
4. Check Feature capability subset and invocation context acceptance.
5. Check request ID, host session, expiry, replay cache and gesture kind.
6. Create/reuse Manager, then create a fresh runtime generation if entry kind is Web.
7. Return typed result or safe error.

Neither requiredCapabilities nor acceptedContexts is an authority by itself.

## 12. Implementation verification

The first-release limits in this contract are approved engineering/safety bounds, not permanent Product Contract or public SDK ceilings. Phase 6D must verify them with worst-case Unicode and JSON escaping, and keep serialized traffic below the existing Native pipe frame cap. Any future increase requires measured validation and safe contract/projection evolution; no additional product decision is open here.

No production code was changed to produce this design.
