# Phase 6C — Native Feature Projection v2

**Status:** approved design; implementation is not started and current projection v1 remains unchanged.

## 1. Purpose and authority boundary

Projection v2 lets Native SearchCore present Plugin Features without loading the Plugin Registry or starting Electron for ordinary search. It is a rebuildable cache produced by Electron Main and transported through the existing current-user pipe.

NativeHost owns presentation, matching and user intent only. Main remains authority for package identity, enabled state, grants, version/hash, entry, context delivery and runtime. A cache row can be stale or forged on disk and still cannot authorize execution.

Current facts: Launcher projection v1 contains ref, displayName and icon; is capped at 2 MiB and 1,001 rows; and fails closed to empty on invalid data. The Native pipe frame cap is 4 MiB. Projection v2 is a distinct schema version; do not reinterpret v1 rows.

The first-release v2 limit is a 3 MiB cache cap, an explicit bounded increase over the current 2 MiB v1 cache. The v1 limit remains unchanged. The v2 limit is an engineering/safety bound for the first release, not a permanent Product Contract or SDK promise. Raising it requires measurements and, where wire compatibility changes, a new projection version.

## 2. Projected data

Allowed fields:

- projection version, host session ID and monotonically increasing revision within that session;
- composite FeatureRef;
- display-only Plugin name and Feature title;
- bounded command aliases;
- accepted context type/source metadata, without context values;
- small icon token and Feature kind;
- grouping metadata needed for Plugin Features presentation;
- optional projection timestamp for diagnostics, never as authority.

Forbidden fields:

- package/archive path, filesystem path or file URL;
- raw manifest, archive bytes, HTML, JavaScript, CSS, WASM or arbitrary asset data;
- permission request/grant state or authorization decisions;
- PluginStore path/config/data, SecretStore, tokens or credentials;
- context snapshot or query text;
- runtime preload/bridge details or an executable command.

## 3. TypeScript wire draft

~~~typescript
export interface FeatureProjectionV2 {
  projectionVersion: 2
  hostSessionId: string
  revision: number
  generatedAtUnixMs: number
  features: FeatureProjectionRowV2[]
}

export interface FeatureProjectionRowV2 {
  ref: { pluginId: string; featureId: string }
  pluginName: string
  title: string
  commands: string[]
  acceptedContexts: Array<{
    type: 'text'
    sources: Array<'launcher-input' | 'clipboard'>
  }>
  iconToken: 'plugin' | 'sparkles' | 'document' | 'globe' | 'translate'
  featureKind: 'declarative-compatibility' | 'built-in'
  group: 'plugin-features'
}
~~~

The projection omits description by default to keep the index small. A future need for description requires a new bounded field/version and a maximum-payload measurement.

## 4. C# DTO draft

~~~csharp
public sealed record FeatureProjectionV2(
    int ProjectionVersion,
    Guid HostSessionId,
    long Revision,
    long GeneratedAtUnixMs,
    IReadOnlyList<FeatureProjectionRowV2> Features);

public sealed record FeatureProjectionRowV2(
    FeatureRef Ref,
    string PluginName,
    string Title,
    IReadOnlyList<string> Commands,
    IReadOnlyList<AcceptedContextDto> AcceptedContexts,
    string IconToken,
    string FeatureKind,
    string Group);
~~~

Native JSON parsing is closed-schema: exact fields, bounded strings/collections, canonical IDs, no duplicate composite identity, known enums only and strict UTF-8. Deserialization must not preserve unknown extension fields.

## 5. Bounds and capacity

First-release engineering/safety limits, not permanent Product Contract or SDK limits:

- maximum 16 Feature definitions per package;
- maximum 2,000 enabled/projected Feature rows across all packages;
- maximum 8 command aliases per Feature, each at most 48 Unicode scalar values;
- maximum title 80 scalar values and Plugin display name 80 scalar values;
- no description in the Native projection;
- maximum serialized projection payload 3 MiB, leaving framing headroom under the existing 4 MiB pipe message cap.

The byte cap is authoritative even if row and field counts are below their limits. Main measures UTF-8 serialized bytes before publishing; Native independently checks payload bounds. A catalog update that would exceed capacity fails atomically with FEATURE_INDEX_LIMIT; it must not silently truncate arbitrary Features or partially update Native. Manager may show a package as installed but unable to enable/index it, with a clear capacity reason. Future capacity increases require representative benchmarks and safe protocol evolution; the SDK must not document these first-release limits as permanent platform ceilings.

Before implementation, test worst-case Unicode and JSON escaping, pipe framing, memory and search latency. Context values use the bounds in the [Feature and Context contract](phase6c-feature-context-contract.md), including the separate Launcher text and clipboard byte limits.

Matching strings are normalized for search using existing SearchCore normalization/index rules. Preserve original title/alias strings for display. The query itself is never part of this projection.

## 6. Pipe message draft

Use the existing framed, current-user-only pipe and request/ack correlation pattern. Add versioned message types rather than changing the meaning of plugins-update.

The hostSessionId and projection revision identify a catalog snapshot, not a user identity or authorization token. Native WPF retains a local pending-gesture record for a user action. Choosing Clipboard Context creates a local one-shot Native snapshot for preview and matching; opening Super Panel alone never reads the clipboard. Matching may use the local snapshot, but it does not grant Plugin access or send the value to Main.

Important current-code boundary: NativeManagerPipeServer creates a CurrentUserOnly pipe and accepts the Manager hello processId as a payload value; the reviewed source does not verify that PID against the connected pipe client or canonical Manager executable. CurrentUserOnly is a user ACL, not executable authentication. Before any sensitive Context value (especially clipboard text) crosses this channel, implementation must authenticate the actual connected peer and bind it to the expected packaged Manager executable and launched process lifecycle using OS-observed identity, or use another handoff that proves peer identity. Do not trust a self-reported PID, hostSessionId or pipe ACL as executable proof. This is a mandatory Phase 6D security gate. Ordinary non-sensitive Feature metadata projection remains a separate display/cache path and does not depend on clipboard peer authentication; Main still revalidates every invocation and effect.

~~~json
{
  "protocolVersion": 1,
  "requestId": "7efdc769-0c92-49c1-8fd4-b50af33ca657",
  "type": "feature-projection-update-v2",
  "payload": {
    "projectionVersion": 2,
    "hostSessionId": "2e83e777-81e5-47bb-8a5e-1f52e5d7bd34",
    "revision": 19,
    "generatedAtUnixMs": 1791296400000,
    "features": [
      {
        "ref": { "pluginId": "webtools.translation", "featureId": "translate-text" },
        "pluginName": "翻译",
        "title": "翻译",
        "commands": ["Translate", "Translation"],
        "acceptedContexts": [],
        "iconToken": "translate",
        "featureKind": "built-in",
        "group": "plugin-features"
      }
    ]
  }
}
~~~

The successful acknowledgement includes the accepted hostSessionId and revision. Main treats only a matching acknowledgement as committed. On transport loss, retry the same revision; equal session/revision plus equal canonical payload hash is idempotent. Same revision with different payload is a protocol error.

## 7. Revision, atomic cache, stale and rollback behavior

### Session and revision

- Main creates a random hostSessionId when its plugin catalog session starts.
- Within that session, revision strictly increases for every complete catalog projection change.
- Native accepts a greater revision in the current session; duplicate exact revision/hash is idempotent success; lower revision is ignored and acknowledged as stale.
- A new hostSessionId is accepted only from the current handshake-complete Manager pipe session and must carry a complete snapshot, not a delta. It is a catalog session marker, not process authentication.
- Revision numbers are not compared across sessions.
- Main sends a full snapshot after Manager startup, pipe reconnect or Native cache corruption.

### Atomic update

1. Main builds a complete snapshot from current authoritative catalog state.
2. Main validates its normalized DTO and measures serialized byte length.
3. Main sends the update with request ID, session and revision.
4. Native validates exact schema, bounds, IDs, duplicate keys, revision and size before writing.
5. Native writes a temporary file in the existing safe profile cache location, flushes, then atomically replaces the cache.
6. Only after replacement does Native acknowledge success and publish the immutable in-memory index snapshot.
7. On failure, old in-memory and on-disk snapshots remain unchanged; no partial rows are shown as current.

No fixed delay is used as an ordering guarantee.

### Startup and stale cache

Native can load the last valid cache while Manager is closed. It may use rows to display/search and start Manager, but treats them as cached. The first invocation is always revalidated by Main. On a stale row Main returns STALE_FEATURE or PROJECTION_REFRESH_REQUIRED, sends a complete snapshot and Native refreshes; it never routes to a stale path.

If Main is absent, Feature invocation can start Manager on demand. If startup fails, Native displays a safe retryable error and leaves app/site search available.

### Corrupt or unsupported cache

- Missing file: empty Feature index.
- Malformed JSON, unknown projection version, oversized cache, duplicate refs or unsafe cache path: ignore the whole cache and use empty Feature index.
- Main reconnect: request or receive a complete current snapshot.
- Do not partially salvage rows from corrupt bytes.
- V1 remains parsed only by the v1 reader; v2 uses a new closed parser. Cache migration may discard/rebuild projection data without touching PluginRegistry or package bytes.

### Rollback

An older Main process cannot publish a v2 message to an older Native parser. Pipe negotiation identifies supported projection versions. If no common v2 version exists, keep the v1 path and disable new Feature entries with explicit incompatibility. Do not send v2 under a v1 type.

Within one session, an old revision cannot overwrite a newer one. Across a new handshake-complete session, a full snapshot replaces prior cache even if revision starts lower. If binaries roll back, Native rebuilds a v1/empty projection or receives a v2 full snapshot from rolled-back Main; package data and v1 archives remain untouched.

## 8. SearchCore integration

SearchCore remains the only Native search engine. Add a Feature index beside existing app/site indexes, not a separate fuzzy-search implementation.

1. Existing local application/site rows keep current matching, ordering and combined cap unchanged.
2. A separate Plugin Feature group has an independent result cap, proposed as 6 rows.
3. Feature results cannot displace or reorder app/site rows.
4. /, ?, and file: continue to bypass Feature matching and preserve current behavior.
5. Empty query may show a small pinned/most-recent Feature shortcut group only if separately approved; projection alone does not imply every Feature appears on Launcher home.
6. Query aliases, title and Plugin name are searchable. Use existing normalization, pinyin and initials only if SearchCore already applies them to generic display strings; do not add another pinyin implementation.
7. Context-aware Super Panel matching uses the same Feature candidate index, then filters by exact accepted context type/source.

Feature selection emits only FeatureRef, projection revision, invocation ID, host session ID and typed context reference/gesture. It never emits a package path, JS code or permission decision.

## 9. Invocation authority and race handling

Main validates in this order:

1. Request schema and current Native pipe session.
2. Request ID replay cache and hostSessionId.
3. FeatureRef exists in current catalog and current manifest.
4. Package version/hash still matches the current installed immutable archive.
5. Plugin is enabled and API/Host versions are compatible.
6. Feature required capabilities are a subset of requested capabilities.
7. Every required capability is currently granted.
8. ContextRef belongs to this invocation, is unexpired, has matching type/source and is accepted by this Feature.
9. Plugin/Feature is not being disabled, updated, uninstalled or permission-revoked.
10. Allocate a new runtime generation and invoke.

Serialize plugin mutations and invocation commit through the existing Main-owned mutation queue. For asynchronous user confirmation or host effect, recheck a captured mutation generation before commit. Disable/update/uninstall/revoke invalidates pending invocation IDs and bridge calls before changing/deleting the package. A completed response from an older runtime generation is discarded.

Replay IDs are bounded and expire after maximum context/invocation lifetime. HostSessionId changes invalidate all prior requests and snapshots. These controls complement, not replace, the current-user pipe.

## 10. Failure policy

| Failure | Native behavior | Main behavior |
|---|---|---|
| Pipe unavailable | Keep search working; offer retry/open Manager | No invoke accepted without live validation |
| Projection over limit | Keep last good cache; show catalog capacity error in Manager | Do not publish partial snapshot or enable over-limit Feature |
| Stale ref | Show refresh/retry message | Rebuild projection and reject stale identity |
| Corrupt cache | Use empty Feature index | Send full snapshot after reconnect |
| Unknown v2 version | Use v1/empty index; do not execute | Return incompatible protocol error |
| Duplicate revision, changed payload | Keep last good cache | Treat as protocol failure, send full sync |
| Main validation rejects capability/context | Preserve app/site results | Return typed rejection; no side effect |

## 11. Cross-check and future verification

Before implementation, confirm current-user pipe session identity/reconnect behavior, serializer Unicode byte accounting, atomic cache replacement/reparse-point checks, catalog publication ordering, SearchCore index/routing behavior and capacities with worst-case multilingual strings.

Future tests include corrupt/truncated cache, oversize payload, stale/duplicate/out-of-order revision, process restart, pipe reconnect, wrong session, duplicate composite FeatureRef, update/disable race, replay, and proof that existing app/site or /, ?, file: results are unchanged.
