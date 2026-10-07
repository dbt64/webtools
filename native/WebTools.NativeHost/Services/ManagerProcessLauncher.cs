using System.Diagnostics;
using System.IO;

namespace WebTools.NativeHost.Services;

public sealed class ManagerProcessLauncher
{
    private readonly bool _allowDevelopmentLaunch;
    private readonly string? _testProfileRoot;
    private readonly ManagerPeerIdentityService _peerIdentityService;

    public ManagerProcessLauncher(bool allowDevelopmentLaunch, string? testProfileRoot = null)
        : this(allowDevelopmentLaunch, testProfileRoot, null) { }

    internal ManagerProcessLauncher(bool allowDevelopmentLaunch, string? testProfileRoot, ManagerPeerIdentityService? peerIdentityService)
    {
        _allowDevelopmentLaunch = allowDevelopmentLaunch;
        DevelopmentMode = allowDevelopmentLaunch;
        _testProfileRoot = testProfileRoot;
        _peerIdentityService = peerIdentityService ?? new ManagerPeerIdentityService(new WindowsManagerProcessIdentityApi());
    }

    public bool DevelopmentMode { get; }
    internal ManagerPeerIdentityService PeerIdentityService => _peerIdentityService;

    internal async Task<ManagerProcessLaunch> StartAsync(string pipeName, long generation)
    {
        var developmentRoot = _allowDevelopmentLaunch
            ? FindDevelopmentRoot(Environment.GetEnvironmentVariable("WEBTOOLS_MANAGER_DEV_ROOT"))
            : null;
        var expectedClientImagePath = developmentRoot is not null
            ? ResolveDevelopmentElectronExecutable(developmentRoot)
            : ResolvePackagedManagerExecutable();
        var start = developmentRoot is not null
            ? CreateDevelopmentStartInfo(developmentRoot, pipeName, expectedClientImagePath)
            : CreatePackagedStartInfo(expectedClientImagePath, pipeName, _testProfileRoot);
        var expectedLaunchRootImagePath = ResolveStartExecutablePath(start);
        var process = Process.Start(start) ?? throw new InvalidOperationException("Windows could not start the WebTools Manager process.");
        ManagerLaunchIdentity? identity = null;
        try
        {
            process.EnableRaisingEvents = true;
            var retainedCreationFileTimeUtc = process.StartTime.ToUniversalTime().ToFileTimeUtc();
            identity = _peerIdentityService.CaptureLaunchIdentity(
                process.Id,
                retainedCreationFileTimeUtc,
                expectedLaunchRootImagePath,
                expectedClientImagePath,
                developmentRoot is not null,
                generation);
            await _peerIdentityService.SetCurrentAsync(identity).ConfigureAwait(false);
            return new ManagerProcessLaunch(process, identity);
        }
        catch
        {
            if (identity is not null)
            {
                _peerIdentityService.ClearCurrent(identity);
                identity.Dispose();
            }
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(3_000);
                }
            }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or TimeoutException) { }
            process.Dispose();
            throw;
        }
    }

    internal static string ResolveDevelopmentElectronExecutable(string root)
    {
        var electronPackage = Path.Combine(Path.GetFullPath(root), "node_modules", "electron");
        var pathFile = Path.Combine(electronPackage, "path.txt");
        if (!File.Exists(pathFile)) throw new FileNotFoundException("Development Electron path.txt was not found.", pathFile);
        var relativeExecutable = File.ReadAllText(pathFile).Trim();
        if (string.IsNullOrWhiteSpace(relativeExecutable) || Path.IsPathRooted(relativeExecutable))
            throw new InvalidDataException("Development Electron path.txt must contain a relative executable path.");
        var distributionRoot = Path.GetFullPath(Path.Combine(electronPackage, "dist"));
        var executablePath = Path.GetFullPath(Path.Combine(distributionRoot, relativeExecutable));
        var relativeToDistribution = Path.GetRelativePath(distributionRoot, executablePath);
        if (relativeToDistribution == "." || relativeToDistribution == ".."
            || relativeToDistribution.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            || relativeToDistribution.StartsWith(".." + Path.AltDirectorySeparatorChar, StringComparison.Ordinal)
            || !File.Exists(executablePath))
            throw new InvalidDataException("Development Electron executable resolves outside its package distribution.");
        return executablePath;
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

    private static ProcessStartInfo CreateDevelopmentStartInfo(string root, string pipeName, string expectedElectronExecutable)
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
        start.Environment["ELECTRON_EXEC_PATH"] = expectedElectronExecutable;
        return start;
    }

    private static ProcessStartInfo CreatePackagedStartInfo(string executablePath, string pipeName, string? testProfileRoot = null)
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
        start.Environment.Remove("WEBTOOLS_MANAGER_TEST_PROFILE");
        if (testProfileRoot is not null)
        {
            start.ArgumentList.Add("--phase4g-manager-test");
            start.Environment["WEBTOOLS_MANAGER_TEST_PROFILE"] = testProfileRoot;
            if (int.TryParse(Environment.GetEnvironmentVariable("WEBTOOLS_MANAGER_TEST_DEBUG_PORT"), out var port) && port is >= 1024 and <= 65535)
            {
                start.ArgumentList.Add($"--remote-debugging-port={port}");
                start.ArgumentList.Add("--remote-debugging-address=127.0.0.1");
            }
        }
        return start;
    }

    private static string ResolveStartExecutablePath(ProcessStartInfo start)
    {
        var executable = start.FileName;
        if (Path.IsPathRooted(executable))
        {
            var fullPath = Path.GetFullPath(executable);
            if (File.Exists(fullPath)) return fullPath;
            throw new FileNotFoundException("Manager launch root executable was not found.", fullPath);
        }

        var pathExtensions = (Environment.GetEnvironmentVariable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var candidates = new List<string>();
        var searchDirectories = new[] { start.WorkingDirectory }
            .Concat((Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        foreach (var directory in searchDirectories)
        {
            if (string.IsNullOrWhiteSpace(directory)) continue;
            var basePath = Path.Combine(directory, executable);
            candidates.Add(basePath);
            if (string.IsNullOrEmpty(Path.GetExtension(basePath)))
                candidates.AddRange(pathExtensions.Select(extension => basePath + extension));
        }

        var resolved = candidates.FirstOrDefault(File.Exists);
        return resolved is null
            ? throw new FileNotFoundException("Could not resolve the executable used as the Manager launch root.", executable)
            : Path.GetFullPath(resolved);
    }

    private static bool IsDevelopmentRoot(string path) => File.Exists(Path.Combine(path, "package.json"))
        && File.Exists(Path.Combine(path, "node_modules", "electron-vite", "bin", "electron-vite.js"));
}
