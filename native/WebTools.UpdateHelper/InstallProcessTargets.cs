using System.ComponentModel;
using System.Diagnostics;
using System.IO;

namespace WebTools.UpdateHelper;

public enum InstallProcessKind { NativeHost, Manager }

public sealed record InstallProcessTarget(int ProcessId, string ExecutablePath, InstallProcessKind Kind);
public sealed record InstallProcessSnapshot(IReadOnlyList<InstallProcessTarget> Targets, IReadOnlyList<int> UnresolvedCandidateProcessIds);

public static class InstallProcessTargets
{
    private static readonly StringComparer PathComparer = StringComparer.OrdinalIgnoreCase;

    public static string NormalizeInstallRoot(string installRoot)
    {
        if (string.IsNullOrWhiteSpace(installRoot)) throw new ArgumentException("安装目录不能为空。", nameof(installRoot));
        var value = installRoot.Trim();
        if (!Path.IsPathFullyQualified(value)) throw new ArgumentException("安装目录必须是绝对路径。", nameof(installRoot));
        var fullPath = Path.GetFullPath(value);
        return Path.TrimEndingDirectorySeparator(fullPath);
    }

    public static bool TryMatchTargetPath(string installRoot, string executablePath, out InstallProcessKind kind)
    {
        kind = default;
        string root;
        string candidate;
        try
        {
            root = NormalizeInstallRoot(installRoot);
            candidate = Path.GetFullPath(executablePath);
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }

        var nativeHostPath = Path.GetFullPath(Path.Combine(root, "WebTools.NativeHost.exe"));
        var managerPath = Path.GetFullPath(Path.Combine(root, "Manager", "WebTools.exe"));
        var legacyManagerPath = Path.GetFullPath(Path.Combine(root, "WebTools.exe"));
        if (PathComparer.Equals(candidate, nativeHostPath))
        {
            kind = InstallProcessKind.NativeHost;
            return true;
        }
        if (PathComparer.Equals(candidate, managerPath) || PathComparer.Equals(candidate, legacyManagerPath))
        {
            kind = InstallProcessKind.Manager;
            return true;
        }
        return false;
    }

    public static InstallProcessSnapshot Discover(string installRoot)
    {
        var root = NormalizeInstallRoot(installRoot);
        var targets = new List<InstallProcessTarget>();
        var unresolved = new HashSet<int>();
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                var processId = TryGetProcessId(process);
                if (processId <= 0) continue;
                var processName = TryGetProcessName(process);
                try
                {
                    var executablePath = process.MainModule?.FileName;
                    if (string.IsNullOrWhiteSpace(executablePath))
                    {
                        if (IsWebToolsCandidateName(processName)) unresolved.Add(processId);
                        continue;
                    }
                    if (TryMatchTargetPath(root, executablePath, out var kind))
                        targets.Add(new InstallProcessTarget(processId, Path.GetFullPath(executablePath), kind));
                }
                catch (Exception error) when (error is InvalidOperationException or Win32Exception or NotSupportedException or IOException or UnauthorizedAccessException)
                {
                    if (IsWebToolsCandidateName(processName)) unresolved.Add(processId);
                }
            }
        }

        // A process may exit between enumeration and reading its image path. Only discard
        // an inaccessible WebTools candidate after a new process enumeration confirms it is gone.
        var stillPresent = new HashSet<int>();
        if (unresolved.Count > 0)
        {
            foreach (var process in Process.GetProcesses())
            {
                using (process)
                {
                    var processId = TryGetProcessId(process);
                    if (unresolved.Contains(processId) && IsWebToolsCandidateName(TryGetProcessName(process))) stillPresent.Add(processId);
                }
            }
        }

        return new InstallProcessSnapshot(targets, stillPresent.Order().ToArray());
    }

    private static int TryGetProcessId(Process process)
    {
        try { return process.Id; }
        catch (InvalidOperationException) { return 0; }
    }

    private static string? TryGetProcessName(Process process)
    {
        try { return process.ProcessName; }
        catch (Exception error) when (error is InvalidOperationException or Win32Exception or NotSupportedException) { return null; }
    }

    private static bool IsWebToolsCandidateName(string? processName) =>
        PathComparer.Equals(processName, "WebTools.NativeHost") || PathComparer.Equals(processName, "WebTools");
}
