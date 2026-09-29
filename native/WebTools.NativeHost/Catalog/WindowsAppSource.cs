using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text;
using Microsoft.Win32;

namespace WebTools.NativeHost.Catalog;

public sealed class WindowsAppSource
{
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

    private static IEnumerable<AppRecord> StartApps(CancellationToken cancellationToken)
    {
        const string script = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress";
        string output;
        try { output = RunPowerShell(script, cancellationToken); }
        catch { yield break; }
        JsonDocument document;
        try { document = JsonDocument.Parse(output); }
        catch { yield break; }
        using (document)
        {
            var rows = document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement.EnumerateArray().ToArray() : [document.RootElement];
            foreach (var row in rows)
            {
                if (!row.TryGetProperty("Name", out var name) || !row.TryGetProperty("AppID", out var appId)) continue;
                var id = appId.GetString()?.Trim();
                if (id is null || !id.Contains('!')) continue;
                yield return new AppRecord(name.GetString()?.Trim() ?? id, [id], "packaged", new PackagedTarget(id));
            }
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
