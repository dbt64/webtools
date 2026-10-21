using System.Windows.Media.Imaging;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>Bounds panel work without cancelling shared Launcher cache operations.</summary>
internal sealed class SuperPanelIconLoader(Func<string?, Task<BitmapSource?>> load)
{
    private readonly SemaphoreSlim _slots = new(2, 2);
    private readonly Dictionary<string, Task<BitmapSource?>> _running = new(StringComparer.Ordinal);

    internal async Task<BitmapSource?> GetAsync(string reference, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Task<BitmapSource?>? task;
        lock (_running) _running.TryGetValue(reference, out task);
        if (task is not null) return await task.WaitAsync(cancellationToken);

        await _slots.WaitAsync(cancellationToken);
        TaskCompletionSource<BitmapSource?>? owner = null;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (_running)
            {
                if (!_running.TryGetValue(reference, out task))
                {
                    owner = new(TaskCreationOptions.RunContinuationsAsynchronously);
                    task = owner.Task; _running.Add(reference, task);
                }
            }
        }
        finally
        {
            // The decode owns its slot until it actually completes, including across hide/show.
            if (owner is null) _slots.Release();
        }
        if (owner is not null) _ = CompleteAsync(reference, owner);
        return await task!.WaitAsync(cancellationToken);
    }

    private async Task CompleteAsync(string reference, TaskCompletionSource<BitmapSource?> completion)
    {
        BitmapSource? bitmap = null;
        try { bitmap = await load(reference); }
        catch { /* The native fallback remains available; failures do not poison future attempts. */ }
        finally
        {
            lock (_running) _running.Remove(reference);
            _slots.Release();
            completion.TrySetResult(bitmap);
        }
    }
}
