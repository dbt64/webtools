using System.Text.Json;
using System.Diagnostics;
using WebTools.UpdateHelper;
using WebTools.UpdateHelper.Checks;
using WebTools.NativeHost.Services;

if (args.Length == 4 && args[0] == "--host-fixture")
{
    await RunHostFixtureAsync(args[1], args[2], args[3] == "refuse");
    return 0;
}

if (args.Length == 1 && args[0] == "--window-fixture")
{
    WindowFixture.Run();
    return 0;
}

if (args.Length == 1 && args[0] == "--process-fixture")
{
    Console.WriteLine("READY");
    Console.ReadLine();
    return 0;
}

var failures = new List<string>();
Run("canonical target matching supports spaces, Unicode, and case-insensitive Windows paths", VerifyCanonicalTargetMatching);
Run("same-named executables outside the install root are never targeted", VerifyExactTargetBoundary);
Run("only a genuinely absent update pipe allows legacy window closing", VerifyFailClosedPipeClassification);
Run("prepare request contains only the fixed version, operation, and expected PID", VerifyFixedProtocolRequest);
Run("Windows named-pipe wait path uses the canonical local pipe namespace", VerifyCanonicalPipePath);
Run("installer check detects running exact-path processes and succeeds after normal exit", VerifyInstallCheckRetry);
Run("prepare command succeeds when the previous application already exited", VerifyPrepareWithoutProcesses);
Run("prepare command closes a legacy Manager normally and leaves other installations untouched", VerifyLegacyPreparation);
Run("cooperative host preparation waits for both Manager and NativeHost exit", () => VerifyHostPreparation(false));
Run("host refusal preserves both processes and never invokes legacy closing", () => VerifyHostPreparation(true));
foreach (var failure in failures) Console.Error.WriteLine(failure);
Console.WriteLine($"{(failures.Count == 0 ? "All" : "Some")} update helper checks passed.");
return failures.Count == 0 ? 0 : 1;

void Run(string name, Action check)
{
    try { check(); Console.WriteLine($"PASS {name}"); }
    catch (Exception error) { failures.Add($"FAIL {name}: {error.Message}"); }
}

void VerifyCanonicalTargetMatching()
{
    const string root = @"C:\Acceptance\测试 安装目录";
    var target = Path.Combine(root, "WebTools.NativeHost.exe");
    Assert(InstallProcessTargets.TryMatchTargetPath(root, target.ToUpperInvariant(), out var kind)
        && kind == InstallProcessKind.NativeHost, "Canonical path comparison should ignore Windows case while preserving Unicode and spaces.");
}

void VerifyExactTargetBoundary()
{
    const string root = @"C:\Program Files\WebTools";
    Assert(!InstallProcessTargets.TryMatchTargetPath(root, @"C:\Other\WebTools.NativeHost.exe", out _), "A same-named executable in another installation must not match.");
    Assert(!InstallProcessTargets.TryMatchTargetPath(root, Path.Combine(root, "Manager", "..", "Other", "WebTools.exe"), out _), "Traversal-like paths must not match a recognized target.");
    Assert(InstallProcessTargets.TryMatchTargetPath(root, Path.Combine(root, "Manager", "WebTools.exe"), out var managerKind)
        && managerKind == InstallProcessKind.Manager, "The exact Manager executable path should match.");
    Assert(InstallProcessTargets.TryMatchTargetPath(root, Path.Combine(root, "WebTools.exe"), out var legacyKind)
        && legacyKind == InstallProcessKind.Manager, "The previous Electron-only install executable should match its exact root path.");
}

void VerifyInstallCheckRetry()
{
    var root = Path.Combine(Path.GetTempPath(), "WebTools 更新检测 中文 空格 " + Guid.NewGuid().ToString("N"));
    var installed = Path.Combine(root, "installed", "Manager");
    var unrelated = Path.Combine(root, "unrelated", "Manager");
    Process? target = null;
    Process? other = null;
    try
    {
        target = StartFixture(installed);
        other = StartFixture(unrelated);
        var installRoot = Path.GetDirectoryName(installed)!;
        Assert(InvokeHelper(installRoot) == 10, "A running exact-path Manager must return the retry-required code, not attempt shutdown.");
        Assert(!target.HasExited && !other.HasExited, "Checking readiness must leave both processes running.");
        target.StandardInput.WriteLine("exit");
        Assert(target.WaitForExit(5_000), "The fixture should exit normally before retrying installation.");
        Assert(InvokeHelper(installRoot) == 0, "The same installation check must succeed immediately after normal exit.");
        Assert(!other.HasExited, "An identically named process outside the old install directory must remain untouched.");
    }
    finally
    {
        foreach (var process in new[] { target, other })
        {
            if (process is null) continue;
            if (!process.HasExited)
            {
                process.StandardInput.WriteLine("exit");
                if (!process.WaitForExit(5_000)) process.Kill(); // Isolated check fixture only.
            }
            process.Dispose();
        }
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}

Process StartFixture(string directory, string mode = "--process-fixture")
{
    Directory.CreateDirectory(directory);
    foreach (var file in Directory.GetFiles(AppContext.BaseDirectory)) File.Copy(file, Path.Combine(directory, Path.GetFileName(file)));
    var fixtureExe = Path.Combine(directory, "WebTools.exe");
    File.Copy(Path.Combine(AppContext.BaseDirectory, "WebTools.UpdateHelper.Checks.exe"), fixtureExe);
    var info = new ProcessStartInfo(fixtureExe) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true };
    info.ArgumentList.Add(mode);
    var process = Process.Start(info) ?? throw new InvalidOperationException("Could not start isolated process fixture.");
    Assert(process.StandardOutput.ReadLine() == "READY", "Fixture did not become ready.");
    return process;
}

int InvokeHelper(string installRoot, string operation = "--check-install")
{
    var info = new ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
    info.ArgumentList.Add(typeof(InstallProcessTargets).Assembly.Location);
    info.ArgumentList.Add(operation);
    info.ArgumentList.Add(installRoot);
    using var process = Process.Start(info) ?? throw new InvalidOperationException("Could not start helper check.");
    Assert(process.WaitForExit(10_000), "Helper check exceeded its deadline.");
    return process.ExitCode;
}

void VerifyPrepareWithoutProcesses()
{
    var root = Path.Combine(Path.GetTempPath(), "WebTools-empty-" + Guid.NewGuid().ToString("N"));
    Assert(InvokeHelper(root, "--prepare-install") == 0, "Preparation should accept an already-exited installation without requiring setup restart.");
}

async Task RunHostFixtureAsync(string pipeName, string installRoot, bool refuse)
{
    using var manager = StartFixture(Path.Combine(installRoot, "Manager"));
    using var lifetime = new CancellationTokenSource();
    var server = new UpdatePreparationServer(pipeName, async (_, cancellation) =>
    {
        if (refuse) return false;
        manager.StandardInput.WriteLine("exit");
        await manager.WaitForExitAsync(cancellation);
        return true;
    }, () => Task.CompletedTask);
    var serving = server.RunAsync(lifetime.Token);
    Console.WriteLine("READY");
    var manualExit = Task.Run(Console.ReadLine);
    await Task.WhenAny(serving, manualExit);
    lifetime.Cancel();
    try { await serving; } catch (OperationCanceledException) { }
    if (!manager.HasExited)
    {
        manager.StandardInput.WriteLine("exit");
        await manager.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
    }
}

void VerifyHostPreparation(bool refuse)
{
    var root = Path.Combine(Path.GetTempPath(), "WebTools-pipe-test-" + Guid.NewGuid().ToString("N"));
    var pipeName = "WebTools.UpdateChecks." + Guid.NewGuid().ToString("N");
    Process? host = null;
    try
    {
        Directory.CreateDirectory(root);
        foreach (var file in Directory.GetFiles(AppContext.BaseDirectory)) File.Copy(file, Path.Combine(root, Path.GetFileName(file)));
        var executable = Path.Combine(root, "WebTools.NativeHost.exe");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "WebTools.UpdateHelper.Checks.exe"), executable);
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true };
        foreach (var argument in new[] { "--host-fixture", pipeName, root, refuse ? "refuse" : "accept" }) start.ArgumentList.Add(argument);
        host = Process.Start(start) ?? throw new InvalidOperationException("Could not start isolated host.");
        Assert(host.StandardOutput.ReadLine() == "READY", "Host fixture did not become ready.");
        var prepared = new InstallPreparationService(new UpdatePipeClient(pipeName)).PrepareAsync(root, TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
        Assert(prepared == !refuse, "Only accepted and completed cooperative shutdown should permit installation.");
        if (refuse)
        {
            Assert(!host.HasExited, "A refusing NativeHost must remain running.");
            Assert(InstallProcessTargets.Discover(root).Targets.Count == 2, "Refusal must leave both Host and Manager intact.");
        }
        else
        {
            Assert(host.WaitForExit(5_000), "NativeHost must exit before preparation succeeds.");
            Assert(InstallProcessTargets.Discover(root).Targets.Count == 0, "No old Manager or Host image may remain running.");
        }
    }
    finally
    {
        if (host is not null)
        {
            if (!host.HasExited) { host.StandardInput.WriteLine("exit"); if (!host.WaitForExit(5_000)) host.Kill(entireProcessTree: true); }
            host.Dispose();
        }
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}

void VerifyLegacyPreparation()
{
    var root = Path.Combine(Path.GetTempPath(), "WebTools-legacy-close-" + Guid.NewGuid().ToString("N"));
    Process? target = null;
    Process? unrelated = null;
    try
    {
        target = StartFixture(Path.Combine(root, "installed", "Manager"), "--window-fixture");
        unrelated = StartFixture(Path.Combine(root, "unrelated", "Manager"), "--window-fixture");
        Assert(InvokeHelper(Path.Combine(root, "installed"), "--prepare-install") == 0, "The legacy Manager must close through its normal window-close path.");
        Assert(target.WaitForExit(5_000), "The exact Manager should have exited before preparation succeeds.");
        Assert(!unrelated.HasExited, "A same-named application outside the installation must remain running.");
    }
    finally
    {
        foreach (var process in new[] { target, unrelated })
        {
            if (process is null) continue;
            if (!process.HasExited) { process.StandardInput.WriteLine("exit"); if (!process.WaitForExit(5_000)) process.Kill(); }
            process.Dispose();
        }
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}

void VerifyFailClosedPipeClassification()
{
    Assert(UpdatePipeClient.ShouldUseLegacyWindowClose(UpdatePipeOutcome.PipeNotFound), "Only pipe-not-found should select the old-build compatibility path.");
    foreach (var outcome in new[] { UpdatePipeOutcome.Timeout, UpdatePipeOutcome.AccessDenied, UpdatePipeOutcome.MalformedReply, UpdatePipeOutcome.HostPidMismatch, UpdatePipeOutcome.HostRefused, UpdatePipeOutcome.UnexpectedFailure })
        Assert(!UpdatePipeClient.ShouldUseLegacyWindowClose(outcome), $"{outcome} must fail closed rather than use WM_CLOSE fallback.");
}

void VerifyFixedProtocolRequest()
{
    using var request = JsonDocument.Parse(UpdatePipeClient.SerializePrepareRequest(4242));
    var root = request.RootElement;
    Assert(root.EnumerateObject().Count() == 3, "The request must not contain a path or arbitrary command field.");
    Assert(root.GetProperty("protocolVersion").GetInt32() == 1, "The protocol version must be fixed at 1.");
    Assert(root.GetProperty("operation").GetString() == "prepare-update", "The only request operation must be prepare-update.");
    Assert(root.GetProperty("expectedHostProcessId").GetInt32() == 4242, "The request must target the discovered NativeHost PID.");
}

void VerifyCanonicalPipePath()
{
    Assert(UpdatePipeClient.GetWindowsPipePath(UpdatePipeClient.PipeName) == @"\\.\pipe\WebTools.NativeHost.Update.v1",
        "WaitNamedPipe must use the canonical \\\\.\\pipe\\ path.");
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
