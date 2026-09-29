using System.Diagnostics;
using System.IO;

namespace WebTools.NativeHost.Services;

public sealed class ManagerProcessLauncher
{
    private readonly bool _allowDevelopmentLaunch;

    public ManagerProcessLauncher(bool allowDevelopmentLaunch)
    {
        _allowDevelopmentLaunch = allowDevelopmentLaunch;
        DevelopmentMode = allowDevelopmentLaunch;
    }

    public bool DevelopmentMode { get; }

    public Process Start(string pipeName)
    {
        var developmentRoot = _allowDevelopmentLaunch ? FindDevelopmentRoot() : null;
        var start = developmentRoot is not null
            ? CreateDevelopmentStartInfo(developmentRoot, pipeName)
            : CreatePackagedStartInfo(ResolvePackagedManagerExecutable(), pipeName);
        var process = Process.Start(start) ?? throw new InvalidOperationException("Windows could not start the WebTools Manager process.");
        process.EnableRaisingEvents = true;
        return process;
    }

    internal static string? FindDevelopmentRoot(string? rootOverride = null, string? baseDirectory = null)
    {
        if (!string.IsNullOrWhiteSpace(rootOverride) && IsDevelopmentRoot(rootOverride)) return Path.GetFullPath(rootOverride);
        var current = new DirectoryInfo(baseDirectory ?? AppContext.BaseDirectory);
        while (current is not null)
        {
            if (IsDevelopmentRoot(current.FullName)) return current.FullName;
            current = current.Parent;
        }
        return null;
    }

    internal static string ResolvePackagedManagerExecutable(string? processDirectory = null)
    {
        var explicitPath = Environment.GetEnvironmentVariable("WEBTOOLS_MANAGER_EXE");
        if (!string.IsNullOrWhiteSpace(explicitPath) && File.Exists(explicitPath)) return Path.GetFullPath(explicitPath);

        var executableDirectory = processDirectory ?? Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
        var candidates = new List<string>
        {
            Path.Combine(executableDirectory, "Manager", "WebTools.exe"),
            Path.Combine(executableDirectory, "WebTools.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "WebTools", "WebTools.exe"),
        };
        for (var current = new DirectoryInfo(executableDirectory); current is not null; current = current.Parent)
        {
            candidates.Add(Path.Combine(current.FullName, "release", "win-unpacked", "WebTools.exe"));
            candidates.Add(Path.Combine(current.FullName, "Manager", "WebTools.exe"));
        }
        var found = candidates.FirstOrDefault(File.Exists);
        if (found is null) throw new FileNotFoundException("WebTools Manager was not found. Set WEBTOOLS_MANAGER_EXE or install the Manager beside the Native Host.");
        return Path.GetFullPath(found);
    }

    private static ProcessStartInfo CreateDevelopmentStartInfo(string root, string pipeName)
    {
        var nodeExecutable = Environment.GetEnvironmentVariable("WEBTOOLS_NODE_EXECUTABLE");
        var start = new ProcessStartInfo(string.IsNullOrWhiteSpace(nodeExecutable) ? "node.exe" : nodeExecutable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = root,
        };
        start.ArgumentList.Add(Path.Combine(root, "node_modules", "electron-vite", "bin", "electron-vite.js"));
        start.ArgumentList.Add("dev");
        start.Environment["WEBTOOLS_MANAGER_ONLY"] = "1";
        start.Environment["WEBTOOLS_NATIVE_PIPE"] = pipeName;
        return start;
    }

    private static ProcessStartInfo CreatePackagedStartInfo(string executablePath, string pipeName)
    {
        var start = new ProcessStartInfo(executablePath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        start.ArgumentList.Add("--manager-only");
        start.Environment["WEBTOOLS_MANAGER_ONLY"] = "1";
        start.Environment["WEBTOOLS_NATIVE_PIPE"] = pipeName;
        return start;
    }

    private static bool IsDevelopmentRoot(string path) => File.Exists(Path.Combine(path, "package.json"))
        && File.Exists(Path.Combine(path, "node_modules", "electron-vite", "bin", "electron-vite.js"));
}
