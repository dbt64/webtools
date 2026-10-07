namespace WebTools.NativeHost.Services;

public enum NativeFeatureInvocationEnqueueResult { Enqueued, InvalidRequest, DuplicateRequest, QueueFull }

/// <summary>Small, process-local FIFO for Launcher Feature clicks while the Manager starts.</summary>
public sealed class NativeFeatureInvocationQueue
{
    public const int MaximumCount = 4;
    private readonly Queue<NativeFeatureInvocationRequest> _items = new();
    private readonly HashSet<string> _requestIds = new(StringComparer.Ordinal);

    public int Count => _items.Count;

    public NativeFeatureInvocationEnqueueResult TryEnqueue(NativeFeatureInvocationRequest request)
    {
        if (!NativeFeatureInvocationProtocol.IsValidRequest(request)) return NativeFeatureInvocationEnqueueResult.InvalidRequest;
        if (_requestIds.Contains(request.RequestId)) return NativeFeatureInvocationEnqueueResult.DuplicateRequest;
        if (_items.Count >= MaximumCount) return NativeFeatureInvocationEnqueueResult.QueueFull;
        _items.Enqueue(request with { Ref = request.Ref with { } });
        _requestIds.Add(request.RequestId);
        return NativeFeatureInvocationEnqueueResult.Enqueued;
    }

    public NativeFeatureInvocationRequest? Peek() => _items.TryPeek(out var request)
        ? request with { Ref = request.Ref with { } }
        : null;

    public bool Complete(string requestId)
    {
        if (!_items.TryPeek(out var request) || !StringComparer.Ordinal.Equals(request.RequestId, requestId)) return false;
        _items.Dequeue();
        _requestIds.Remove(request.RequestId);
        return true;
    }

    public void Clear()
    {
        _items.Clear();
        _requestIds.Clear();
    }
}
