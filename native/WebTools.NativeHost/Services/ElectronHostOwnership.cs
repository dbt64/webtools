namespace WebTools.NativeHost.Services;

internal sealed record ElectronHostRequestOwnership(string RequestId, string State);
internal sealed record ElectronHostOwnershipSnapshot(long Revision, string[] SessionIds, ElectronHostRequestOwnership[] Requests);
internal sealed record ElectronHostOwnershipSync(bool Synchronized, ElectronHostOwnershipSnapshot Snapshot);

// Accessed under ManagerController._sync, including the snapshot read during hello/reconnect.
internal sealed class ElectronHostOwnership
{
    private readonly HashSet<string> _sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _requests = new(StringComparer.Ordinal);
    public long Revision { get; private set; }
    public bool HasOwners => _sessions.Count > 0 || _requests.Count > 0;
    public void BeginSession(string id) { if (_sessions.Add(id)) Revision++; }
    public void EndSession(string id) { if (_sessions.Remove(id)) Revision++; }
    public void Acquire(string id) { if (_requests.TryAdd(id, "queued")) Revision++; }
    public void Delivered(string id) { if (_requests.TryGetValue(id, out var state) && state != "delivered") { _requests[id] = "delivered"; Revision++; } }
    public void Complete(string id) { if (_requests.Remove(id)) Revision++; }
    public void ClearRequests() { if (_requests.Count > 0) { _requests.Clear(); Revision++; } }
    public void PruneQueued(ISet<string> pending)
    {
        foreach (var id in _requests.Where(request => request.Value == "queued" && !pending.Contains(request.Key)).Select(request => request.Key).ToArray()) Complete(id);
    }
    public ElectronHostOwnershipSnapshot Snapshot() => new(Revision, _sessions.Order().ToArray(),
        _requests.Select(request => new ElectronHostRequestOwnership(request.Key, request.Value)).ToArray());
}
