namespace WebTools.NativeHost.Services;

/// <summary>Tracks Manager renderer generations so navigation cannot strand startup waiters.</summary>
public sealed class ManagerRendererReadiness
{
    private readonly object _sync = new();
    private TaskCompletionSource _readySignal = NewSignal();
    private bool _isReady;
    private long _generation;

    public bool IsReady { get { lock (_sync) return _isReady; } }
    public long Generation { get { lock (_sync) return _generation; } }
    public Task ReadyTask { get { lock (_sync) return _readySignal.Task; } }

    public void MarkNotReady()
    {
        TaskCompletionSource previousSignal;
        lock (_sync)
        {
            _isReady = false;
            _generation++;
            previousSignal = _readySignal;
            _readySignal = NewSignal();
        }
        // Release anyone who captured the previous navigation's signal before replacing it.
        previousSignal.TrySetResult();
    }

    public void MarkReady()
    {
        TaskCompletionSource signal;
        lock (_sync)
        {
            if (!_isReady) _generation++;
            _isReady = true;
            signal = _readySignal;
        }
        signal.TrySetResult();
    }

    public void MarkExited(Exception error)
    {
        TaskCompletionSource previousSignal;
        lock (_sync)
        {
            _isReady = false;
            _generation++;
            previousSignal = _readySignal;
            _readySignal = NewSignal();
        }
        previousSignal.TrySetException(error);
    }

    public void CancelWaiters()
    {
        TaskCompletionSource previousSignal;
        lock (_sync)
        {
            _isReady = false;
            _generation++;
            previousSignal = _readySignal;
            _readySignal = NewSignal();
        }
        previousSignal.TrySetCanceled();
    }

    public bool ShouldRetryAfter(long generationAtStart, bool hasPendingIntent, bool intentChanged, bool isDisposed, bool isShuttingDown)
    {
        lock (_sync)
            return hasPendingIntent && _isReady && (_generation != generationAtStart || intentChanged) && !isDisposed && !isShuttingDown;
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}
