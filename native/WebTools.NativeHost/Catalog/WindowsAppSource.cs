using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace WebTools.NativeHost.Catalog;

public sealed class WindowsAppSource
{
    public StartAppDiscoveryStatus StartAppDiscovery { get; private set; } = new(false, false, "not-run");

    public IReadOnlyList<AppRecord> List(CancellationToken cancellationToken)
    {
        var result = new List<AppRecord>();
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        object? shell = null;
        try { if (shellType is not null) shell = Activator.CreateInstance(shellType); }
        catch (COMException) { /* System and registry sources remain available. */ }
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
        };
        try
        {
            foreach (var root in roots.Where(root => !string.IsNullOrWhiteSpace(root)).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                foreach (var shortcut in EnumerateShortcuts(root, cancellationToken))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (shell is null) break;
                    try
                    {
                        var details = ReadShortcut(shell, shortcut);
                        if (string.IsNullOrWhiteSpace(details.TargetPath)) continue;
                        var cwd = string.IsNullOrWhiteSpace(details.WorkingDirectory) ? "" : Path.GetFullPath(details.WorkingDirectory, Path.GetDirectoryName(shortcut)!);
                        var target = Path.IsPathFullyQualified(details.TargetPath)
                            ? Path.GetFullPath(details.TargetPath)
                            : Path.GetFullPath(details.TargetPath, cwd.Length > 0 ? cwd : Path.GetDirectoryName(shortcut)!);
                        if (!File.Exists(target)) continue;
                        var name = Path.GetFileNameWithoutExtension(shortcut).Trim();
                        if (name.Length == 0) continue;
                        var aliases = new[] { details.Description, Path.GetFileNameWithoutExtension(target) }
                            .Where(alias => !string.IsNullOrWhiteSpace(alias)).Distinct(StringComparer.Ordinal).ToArray();
                        result.Add(new AppRecord(name, aliases, "desktop", new ShortcutTarget(shortcut, target, details.Arguments.Trim(), cwd)));
                    }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException or COMException or ArgumentException or TargetInvocationException)
                    {
                        // A single stale or malformed shortcut must not invalidate the catalog.
                    }
                }
            }
        }
        finally { if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell); }
        result.AddRange(StartApps(cancellationToken));
        result.AddRange(AppPaths(cancellationToken));
        result.AddRange([
            new AppRecord("文件资源管理器", ["File Explorer", "Explorer", "explorer.exe"], "system", new SystemTarget("file-explorer")),
            new AppRecord("控制面板", ["Control Panel", "control.exe"], "system", new SystemTarget("control-panel")),
            new AppRecord("设备管理器", ["Device Manager", "devmgmt.msc"], "system", new SystemTarget("device-manager")),
        ]);
        var diskManagement = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "diskmgmt.msc");
        if (File.Exists(diskManagement))
            result.Add(new AppRecord("磁盘管理", ["Disk Management", "diskmgmt.msc"], "system", new SystemTarget("disk-management")));
        return result;
    }

    private static IEnumerable<string> EnumerateShortcuts(string root, CancellationToken cancellationToken)
    {
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var directory = pending.Pop();
            string[] children;
            try { children = Directory.GetFileSystemEntries(directory); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { continue; }
            foreach (var child in children)
            {
                var isShortcut = false;
                try
                {
                    var attributes = File.GetAttributes(child);
                    if (attributes.HasFlag(FileAttributes.Directory))
                    {
                        if (!attributes.HasFlag(FileAttributes.ReparsePoint)) pending.Push(child);
                    }
                    else if (child.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)) isShortcut = true;
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* isolate entry */ }
                if (isShortcut) yield return child;
            }
        }
    }

    private static (string TargetPath, string Arguments, string WorkingDirectory, string Description) ReadShortcut(object shell, string path)
    {
        var type = shell.GetType();
        object? shortcut = null;
        try
        {
            shortcut = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, [path]);
            if (shortcut is null) throw new COMException("Cannot read shortcut.");
            var shortcutType = shortcut.GetType();
            string Get(string name) => shortcutType.InvokeMember(name, BindingFlags.GetProperty, null, shortcut, null)?.ToString() ?? "";
            return (Get("TargetPath"), Get("Arguments"), Get("WorkingDirectory"), Get("Description"));
        }
        finally
        {
            if (shortcut is not null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
        }
    }

    private IEnumerable<AppRecord> StartApps(CancellationToken cancellationToken)
    {
        const string script = """
            [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
            $ErrorActionPreference = 'Stop'
            $startAppsAvailable = $false
            $startApps = @()
            try {
              $startApps = @(Get-StartApps -ErrorAction Stop | Select-Object -First 6000)
              $startAppsAvailable = $true
            } catch { $startApps = @() }
            $rows = [System.Collections.Generic.List[object]]::new()
            $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
            $byId = @{}
            $byName = @{}
            foreach ($app in $startApps) {
              if ($app.AppID) { $byId[[string]$app.AppID] = $app }
              if ($app.Name -and -not $byName.ContainsKey([string]$app.Name)) { $byName[[string]$app.Name] = $app }
            }
            $appsFolderAvailable = $false
            try {
              $folder = (New-Object -ComObject Shell.Application).Namespace('shell:AppsFolder')
              if ($folder) {
                $items = $folder.Items()
                if ($null -ne $items) { $appsFolderAvailable = $true }
                foreach ($item in $items) {
                  try {
                    $appId = [string]$item.ExtendedProperty('System.AppUserModel.ID')
                    $matched = if ($appId -and $byId.ContainsKey($appId)) { $byId[$appId] } else { $byName[[string]$item.Name] }
                    if (-not $appId -and $matched) { $appId = [string]$matched.AppID }
                    if (-not $appId -or -not $seen.Add($appId)) { continue }
                    $targetPath = ''
                    $arguments = ''
                    $workingDirectory = ''
                    if (-not $appId.Contains('!')) {
                      $targetPath = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
                      $arguments = [string]$item.ExtendedProperty('System.Link.Arguments')
                      $workingDirectory = [string]$item.ExtendedProperty('System.Link.WorkingDirectory')
                    }
                    $rows.Add([pscustomobject]@{
                      Name = [string]$item.Name
                      AppID = $appId
                      TargetPath = $targetPath
                      Arguments = $arguments
                      WorkingDirectory = $workingDirectory
                    })
                  } catch { }
                }
              }
            } catch { }
            foreach ($app in $startApps) {
              $appId = [string]$app.AppID
              if ($appId -and $seen.Add($appId)) {
                $rows.Add([pscustomobject]@{ Name = [string]$app.Name; AppID = $appId; TargetPath = ''; Arguments = ''; WorkingDirectory = '' })
              }
            }
            [pscustomobject]@{
              StartAppsAvailable = $startAppsAvailable
              AppsFolderAvailable = $appsFolderAvailable
              Rows = @($rows | Select-Object -First 6000)
            } | ConvertTo-Json -Depth 5 -Compress
            """;
        string output;
        try { output = RunPowerShell(script, cancellationToken); }
        catch (OperationCanceledException) { throw; }
        catch (Exception error)
        {
            StartAppDiscovery = new(false, false, error.GetType().Name);
            yield break;
        }
        var snapshot = StartAppMetadataParser.ParseSnapshot(output);
        StartAppDiscovery = snapshot.Status;
        foreach (var record in snapshot.Records)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return record;
        }
    }

    private static IEnumerable<AppRecord> AppPaths(CancellationToken cancellationToken)
    {
        var roots = new[]
        {
            (Registry.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\App Paths"),
            (Registry.LocalMachine, @"Software\Microsoft\Windows\CurrentVersion\App Paths"),
            (Registry.LocalMachine, @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths"),
        };
        foreach (var (hive, path) in roots)
        {
            RegistryKey? root;
            try { root = hive.OpenSubKey(path); }
            catch { continue; }
            using (root)
            {
                if (root is null) continue;
                string[] names;
                try { names = root.GetSubKeyNames(); }
                catch { continue; }
                foreach (var name in names)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    AppRecord? record = null;
                    try
                    {
                        using var entry = root.OpenSubKey(name);
                        var value = entry?.GetValue("")?.ToString()?.Trim().Trim('"');
                        if (value is null || !value.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !Path.IsPathFullyQualified(value) || !File.Exists(value)) continue;
                        record = new AppRecord(Path.GetFileNameWithoutExtension(name), [name, Path.GetFileNameWithoutExtension(value)], "desktop", new ExecutableTarget(Path.GetFullPath(value)));
                    }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException) { /* isolate registry key */ }
                    if (record is not null) yield return record;
                }
            }
        }
    }

    private static string RunPowerShell(string script, CancellationToken token)
    {
        var start = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (var arg in new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script }) start.ArgumentList.Add(arg);
        using var process = Process.Start(start) ?? throw new IOException("Cannot start PowerShell.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token).GetAwaiter().GetResult();
            if (output.Length > 1_000_000) throw new IOException("Windows application discovery output exceeded its bound.");
            process.WaitForExitAsync(timeout.Token).GetAwaiter().GetResult();
            if (process.ExitCode != 0) throw new IOException("Get-StartApps failed.");
            return output;
        }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw;
        }
    }
}

public sealed record StartAppDiscoveryStatus(bool StartAppsAvailable, bool AppsFolderAvailable, string? Failure);
public sealed record StartAppMetadataSnapshot(StartAppDiscoveryStatus Status, IReadOnlyList<AppRecord> Records);

public static class AppFolderIdValidator
{
    private static readonly Regex Simple = new(@"\A[A-Za-z0-9_.-]{1,256}\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex Package = new(@"\A[A-Za-z0-9._-]{1,128}![A-Za-z0-9._-]{1,128}\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex Generated = new(@"\AMicrosoft\.AutoGenerated\.\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex RegisteredSystem = new(@"\A\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}\\[A-Za-z0-9_.-]{1,128}\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static bool IsValid(string? appId)
    {
        if (string.IsNullOrWhiteSpace(appId) || appId.Length > 512 || appId.Any(char.IsControl)) return false;
        if (Package.IsMatch(appId)) return true;
        if (Generated.IsMatch(appId)) return true;
        if (appId.Contains('!') || appId is "." or ".." || appId.Contains("..", StringComparison.Ordinal)) return false;
        return Simple.IsMatch(appId) || RegisteredSystem.IsMatch(appId);
    }

    public static bool IsPackageAumid(string? appId) => !string.IsNullOrWhiteSpace(appId) && Package.IsMatch(appId);
}

public static class StartAppMetadataParser
{
    private const int MaximumOutputCharacters = 1_000_000;
    private const int MaximumRows = 6000;

    public static IReadOnlyList<AppRecord> Parse(string json)
        => ParseRows(json, out _);

    public static StartAppMetadataSnapshot ParseSnapshot(string json)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaximumOutputCharacters)
            return new(new(false, false, "invalid-output"), []);

        JsonDocument document;
        try { document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 }); }
        catch (JsonException) { return new(new(false, false, "invalid-json"), []); }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return new(new(false, false, "missing-source-status"), ParseRows(root));

            var startAppsAvailable = ReadBoolean(root, "StartAppsAvailable");
            var appsFolderAvailable = ReadBoolean(root, "AppsFolderAvailable");
            if (!root.TryGetProperty("Rows", out var rows))
                return new(new(false, false, "missing-rows"), []);

            var status = new StartAppDiscoveryStatus(startAppsAvailable, appsFolderAvailable,
                startAppsAvailable || appsFolderAvailable ? null : "all-sources-unavailable");
            return new(status, ParseRows(rows));
        }
    }

    private static bool ReadBoolean(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static IReadOnlyList<AppRecord> ParseRows(string json, out string? error)
    {
        error = null;
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaximumOutputCharacters) { error = "invalid-output"; return []; }
        JsonDocument document;
        try { document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 }); }
        catch (JsonException) { error = "invalid-json"; return []; }

        using (document) return ParseRows(document.RootElement);
    }

    private static IReadOnlyList<AppRecord> ParseRows(JsonElement root)
    {
        var rows = root.ValueKind == JsonValueKind.Array
            ? root.EnumerateArray().Take(MaximumRows).ToArray()
            : new[] { root };
        var records = new List<AppRecord>(rows.Length);
        foreach (var row in rows)
        {
            try
            {
                if (row.ValueKind != JsonValueKind.Object) continue;
                string? Field(string key)
                {
                    foreach (var property in row.EnumerateObject())
                        if (property.Name.Equals(key, StringComparison.OrdinalIgnoreCase) && property.Value.ValueKind == JsonValueKind.String)
                            return property.Value.GetString();
                    return null;
                }

                var name = Field("Name")?.Trim();
                var appId = Field("AppID")?.Trim();
                if (string.IsNullOrWhiteSpace(name) || name.Length > 512 || !AppFolderIdValidator.IsValid(appId)) continue;
                var validName = name!;
                var validAppId = appId!;

                var targetPath = Field("TargetPath")?.Trim();
                var arguments = Field("Arguments") ?? "";
                var workingDirectory = Field("WorkingDirectory")?.Trim() ?? "";
                if (arguments.Length > 32768 || arguments.Any(char.IsControl)) continue;
                if (string.IsNullOrWhiteSpace(targetPath) || targetPath.Length > 32767 || !Path.IsPathFullyQualified(targetPath)) targetPath = null;
                else
                {
                    try { targetPath = Path.GetFullPath(targetPath); }
                    catch (Exception error) when (error is ArgumentException or IOException or NotSupportedException) { targetPath = null; }
                }
                if (workingDirectory.Length > 32767 || workingDirectory.Length > 0 && !Path.IsPathFullyQualified(workingDirectory)) workingDirectory = "";
                else if (workingDirectory.Length > 0)
                {
                    try { workingDirectory = Path.GetFullPath(workingDirectory); }
                    catch (Exception error) when (error is ArgumentException or IOException or NotSupportedException) { workingDirectory = ""; }
                }

                var aliases = new[] { validAppId, targetPath is null ? null : Path.GetFileNameWithoutExtension(targetPath) }
                    .Where(alias => !string.IsNullOrWhiteSpace(alias)).Cast<string>().Distinct(StringComparer.Ordinal).ToArray();
                AppLaunchTarget target;
                var source = "start-apps";
                if (validAppId.Equals("Microsoft.Windows.ControlPanel", StringComparison.OrdinalIgnoreCase))
                {
                    target = new SystemTarget("control-panel");
                    source = "system";
                }
                else if (AppFolderIdValidator.IsPackageAumid(validAppId))
                {
                    target = new PackagedTarget(validAppId);
                    source = "packaged";
                }
                else target = new AppFolderTarget(validAppId, targetPath, arguments, workingDirectory);
                records.Add(new AppRecord(validName, aliases, source, target));
            }
            catch (Exception error) when (error is InvalidOperationException or ArgumentException or NullReferenceException)
            {
                // One damaged AppsFolder row must not invalidate the rest of the Windows catalog.
            }
        }
        return records;
    }
}
