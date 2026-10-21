namespace WebTools.NativeHost.Services;

public enum NativeFeatureInvocationEnqueueResult { Enqueued, InvalidRequest, DuplicateRequest, QueueFull }

/// <summary>Small, process-local FIFO for Launcher Feature clicks while the Manager starts.</summary>
public sealed class NativeFeatureInvocationQueue
{
    public const int MaximumCount = 4;
    private sealed record Pending(NativeFeatureInvocationRequest Request, long EnqueuedAt, TimeSpan? ContextLifetime);
    private readonly Queue<Pending> _items = new();
    private readonly HashSet<string> _requestIds = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private readonly TimeProvider _clock;
    private ITimer? _expiryTimer;

    public NativeFeatureInvocationQueue() : this(TimeProvider.System) { }
    public NativeFeatureInvocationQueue(TimeProvider clock) => _clock = clock ?? throw new ArgumentNullException(nameof(clock));
    public int Count { get { lock (_gate) { if (ExpireLocked()) ScheduleExpiryLocked(); return _items.Count; } } }
    internal string[] RequestIds { get { lock (_gate) { if (ExpireLocked()) ScheduleExpiryLocked(); return _requestIds.ToArray(); } } }

    public NativeFeatureInvocationEnqueueResult TryEnqueue(NativeFeatureInvocationRequest request)
    {
        if (!NativeFeatureInvocationProtocol.IsValidRequest(request)) return NativeFeatureInvocationEnqueueResult.InvalidRequest;
        lock (_gate)
        {
            if (ExpireLocked()) ScheduleExpiryLocked();
            TimeSpan? lifetime = null;
            if (request.Context is { } context)
            {
                var age = _clock.GetUtcNow().ToUnixTimeMilliseconds() - context.CapturedAtUnixMs;
                if (age < 0 || age >= 30_000) return NativeFeatureInvocationEnqueueResult.InvalidRequest;
                lifetime = TimeSpan.FromMilliseconds(30_000 - age);
            }
            if (_requestIds.Contains(request.RequestId)) return NativeFeatureInvocationEnqueueResult.DuplicateRequest;
            if (_items.Count >= MaximumCount) return NativeFeatureInvocationEnqueueResult.QueueFull;
            _items.Enqueue(new(request with { Ref = request.Ref with { } }, _clock.GetTimestamp(), lifetime));
            _requestIds.Add(request.RequestId);
            ScheduleExpiryLocked();
            return NativeFeatureInvocationEnqueueResult.Enqueued;
        }
    }

    public NativeFeatureInvocationRequest? Peek()
    {
        lock (_gate)
        {
            if (ExpireLocked()) ScheduleExpiryLocked();
            return _items.TryPeek(out var item) ? item.Request with { Ref = item.Request.Ref with { } } : null;
        }
    }

    public bool Complete(string requestId)
    {
        lock (_gate)
        {
            if (ExpireLocked()) ScheduleExpiryLocked();
            if (!_items.TryPeek(out var item) || !StringComparer.Ordinal.Equals(item.Request.RequestId, requestId)) return false;
            _items.Dequeue();
            _requestIds.Remove(item.Request.RequestId);
            ScheduleExpiryLocked();
            return true;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _expiryTimer?.Dispose(); _expiryTimer = null;
            _items.Clear();
            _requestIds.Clear();
        }
    }
    public bool Cancel(string requestId)
    {
        lock (_gate)
        {
            var removed = false;
            for (var remaining = _items.Count; remaining > 0; remaining--)
            {
                var item = _items.Dequeue();
                if (item.Request.RequestId == requestId) { _requestIds.Remove(requestId); removed = true; }
                else _items.Enqueue(item);
            }
            ScheduleExpiryLocked(); return removed;
        }
    }
    public void CancelQuickResults()
    {
        lock (_gate)
        {
            foreach (var requestId in _items.Where(item => item.Request.QuickResult is not null).Select(item => item.Request.RequestId).ToArray()) Cancel(requestId);
        }
    }
    private bool ExpireLocked()
    {
        var changed = false;
        var now = _clock.GetTimestamp();
        for (var remaining = _items.Count; remaining > 0; remaining--)
        {
            var item = _items.Dequeue();
            if (item.ContextLifetime is { } lifetime && _clock.GetElapsedTime(item.EnqueuedAt, now) >= lifetime)
            {
                _requestIds.Remove(item.Request.RequestId); changed = true; // Drop the only queued plaintext reference.
            }
            else _items.Enqueue(item);
        }
        return changed;
    }
    private void ScheduleExpiryLocked()
    {
        _expiryTimer?.Dispose(); _expiryTimer = null;
        var now = _clock.GetTimestamp();
        TimeSpan? earliest = null;
        foreach (var item in _items)
        {
            if (item.ContextLifetime is not { } lifetime) continue;
            var remaining = lifetime - _clock.GetElapsedTime(item.EnqueuedAt, now);
            if (earliest is null || remaining < earliest) earliest = remaining;
        }
        if (earliest is null) return;
        _expiryTimer = _clock.CreateTimer(_ =>
        {
            lock (_gate) { ExpireLocked(); ScheduleExpiryLocked(); }
        }, null, earliest < TimeSpan.Zero ? TimeSpan.Zero : earliest.Value, Timeout.InfiniteTimeSpan);
    }
}
