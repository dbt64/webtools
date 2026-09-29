namespace WebTools.NativeHost.Files;

public sealed class LatestSearchGeneration : IDisposable
{
    private CancellationTokenSource? _current;
    private long _sequence;

    public (long Sequence, CancellationToken Token) Next()
    {
        _current?.Cancel();
        _current?.Dispose();
        _current = new CancellationTokenSource();
        return (++_sequence, _current.Token);
    }

    public bool IsCurrent(long sequence) => sequence == _sequence && _current is { IsCancellationRequested: false };

    public void Dispose()
    {
        _current?.Cancel();
        _current?.Dispose();
        _current = null;
    }
}
