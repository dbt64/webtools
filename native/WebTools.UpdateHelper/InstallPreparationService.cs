namespace WebTools.UpdateHelper;

public sealed class InstallPreparationService(UpdatePipeClient? pipeClient = null)
{
    private readonly UpdatePipeClient _pipeClient = pipeClient ?? new UpdatePipeClient();

    public async Task<bool> PrepareAsync(string installRoot, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        var token = deadline.Token;
        var initial = InstallProcessTargets.Discover(installRoot);
        if (initial.UnresolvedCandidateProcessIds.Count > 0) return false;
        if (initial.Targets.Count == 0) return true;

        var hosts = initial.Targets.Where(target => target.Kind == InstallProcessKind.NativeHost).ToArray();
        if (hosts.Length > 1) return false;
        if (hosts.Length == 1)
        {
            var response = await _pipeClient.PrepareAsync(hosts[0].ProcessId, TimeSpan.FromSeconds(5), token).ConfigureAwait(false);
            if (response.Outcome != UpdatePipeOutcome.Prepared)
            {
                // A rejecting/unresponsive pipe must never fall through to window closing.
                if (!UpdatePipeClient.ShouldUseLegacyWindowClose(response.Outcome)) return false;
                var closed = await new LegacyWindowCloser().CloseAsync(installRoot, TimeSpan.FromSeconds(15), token).ConfigureAwait(false);
                if (!closed.Success) return false;
            }
        }
        else
        {
            var closed = await new LegacyWindowCloser().CloseAsync(installRoot, TimeSpan.FromSeconds(15), token).ConfigureAwait(false);
            if (!closed.Success) return false;
        }

        // Acknowledgement is not sufficient: wait until all old image paths are gone.
        while (true)
        {
            token.ThrowIfCancellationRequested();
            var current = InstallProcessTargets.Discover(installRoot);
            if (current.UnresolvedCandidateProcessIds.Count > 0) return false;
            if (current.Targets.Count == 0) return true;
            await Task.Delay(100, token).ConfigureAwait(false);
        }
    }
}
