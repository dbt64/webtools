using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace WebTools.UpdateHelper;

public sealed record LegacyCloseResult(bool Success, string? ErrorCode = null);

public sealed class LegacyWindowCloser
{
    private const uint WmClose = 0x0010;
    private readonly Action<string>? _log;

    public LegacyWindowCloser(Action<string>? log = null) => _log = log;

    public async Task<LegacyCloseResult> CloseAsync(string installRoot, TimeSpan processTimeout, CancellationToken cancellationToken = default)
    {
        var initial = InstallProcessTargets.Discover(installRoot);
        if (initial.UnresolvedCandidateProcessIds.Count > 0)
            return new LegacyCloseResult(false, "process-path-unavailable");

        var ordered = initial.Targets
            .OrderBy(target => target.Kind == InstallProcessKind.Manager ? 0 : 1)
            .ThenBy(target => target.ProcessId)
            .ToArray();
        foreach (var target in ordered)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var result = await CloseOneAsync(installRoot, target, processTimeout, cancellationToken).ConfigureAwait(false);
            if (!result.Success) return result;
        }
        return new LegacyCloseResult(true);
    }

    private async Task<LegacyCloseResult> CloseOneAsync(
        string installRoot,
        InstallProcessTarget expected,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var status = TryOpenExactTarget(installRoot, expected, out var process, out var pathUnavailable);
        if (pathUnavailable) return new LegacyCloseResult(false, "process-path-unavailable");
        if (status == ExactProcessStatus.Gone) return new LegacyCloseResult(true);
        using (process!)
        {
            var windows = EnumerateProcessWindows(expected.ProcessId);
            if (windows.Count == 0)
            {
                if (!process!.HasExited) return new LegacyCloseResult(false, "target-window-not-found");
                return new LegacyCloseResult(true);
            }

            var posted = false;
            foreach (var window in windows)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var pathStatus = TryOpenExactTarget(installRoot, expected, out var verifiedProcess, out pathUnavailable);
                if (pathUnavailable) return new LegacyCloseResult(false, "process-path-unavailable");
                if (pathStatus == ExactProcessStatus.Gone) return new LegacyCloseResult(true);
                using (verifiedProcess!)
                {
                    if (GetWindowThreadProcessId(window, out var windowProcessId) == 0 || windowProcessId != (uint)expected.ProcessId) continue;
                    if (!PostMessage(window, WmClose, IntPtr.Zero, IntPtr.Zero))
                    {
                        if (verifiedProcess!.HasExited) return new LegacyCloseResult(true);
                        continue;
                    }
                    posted = true;
                }
            }

            if (!posted)
            {
                var confirmed = TryOpenExactTarget(installRoot, expected, out var stillRunning, out pathUnavailable);
                stillRunning?.Dispose();
                if (pathUnavailable) return new LegacyCloseResult(false, "process-path-unavailable");
                return confirmed == ExactProcessStatus.Gone
                    ? new LegacyCloseResult(true)
                    : new LegacyCloseResult(false, "close-message-rejected");
            }

            _log?.Invoke($"close-request-posted:{expected.Kind}:{expected.ProcessId}");
            try { await process!.WaitForExitAsync(cancellationToken).WaitAsync(timeout, cancellationToken).ConfigureAwait(false); }
            catch (TimeoutException) { return new LegacyCloseResult(false, "close-timeout"); }
            catch (InvalidOperationException)
            {
                var afterExit = InstallProcessTargets.Discover(installRoot);
                if (afterExit.UnresolvedCandidateProcessIds.Count > 0) return new LegacyCloseResult(false, "process-path-unavailable");
                return afterExit.Targets.Any(target => target.ProcessId == expected.ProcessId)
                    ? new LegacyCloseResult(false, "process-state-unknown")
                    : new LegacyCloseResult(true);
            }
            return new LegacyCloseResult(true);
        }
    }

    private static ExactProcessStatus TryOpenExactTarget(
        string installRoot,
        InstallProcessTarget target,
        out Process? process,
        out bool pathUnavailable)
    {
        process = null;
        pathUnavailable = false;
        try { process = Process.GetProcessById(target.ProcessId); }
        catch (ArgumentException) { return ExactProcessStatus.Gone; }
        catch (InvalidOperationException) { return ExactProcessStatus.Gone; }

        try
        {
            var path = process.MainModule?.FileName;
            if (string.IsNullOrWhiteSpace(path))
            {
                process.Dispose();
                process = null;
                pathUnavailable = true;
                return ExactProcessStatus.Gone;
            }
            if (!InstallProcessTargets.TryMatchTargetPath(installRoot, path, out var actualKind) || actualKind != target.Kind)
            {
                process.Dispose();
                process = null;
                return ExactProcessStatus.Gone;
            }
            return ExactProcessStatus.Running;
        }
        catch (Exception error) when (error is InvalidOperationException or Win32Exception or IOException or UnauthorizedAccessException)
        {
            process?.Dispose();
            process = null;
            pathUnavailable = true;
            return ExactProcessStatus.Gone;
        }
    }

    private static List<IntPtr> EnumerateProcessWindows(int expectedProcessId)
    {
        var windows = new List<IntPtr>();
        EnumWindows((window, _) =>
        {
            if (GetWindowThreadProcessId(window, out var processId) != 0 && processId == (uint)expectedProcessId)
                windows.Add(window);
            return true;
        }, IntPtr.Zero);
        return windows;
    }

    private enum ExactProcessStatus { Gone, Running }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
