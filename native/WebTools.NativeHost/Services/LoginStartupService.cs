using System.Diagnostics;
using System.IO;
using System.Reflection;
using Microsoft.Win32;

namespace WebTools.NativeHost.Services;

public static class LoginStartupService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "WebTools";

    internal static bool IsUnregisteredPreview()
    {
        if (!File.Exists(Path.Combine(AppContext.BaseDirectory, "preview-build.json"))) return false;
        try
        {
            using var installKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\WebToolsNative");
            var installed = installKey?.GetValue("InstallLocation") as string;
            if (string.IsNullOrWhiteSpace(installed)) return true;
            return !Path.GetFullPath(installed).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                .Equals(Path.GetFullPath(AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException or UnauthorizedAccessException or System.Security.SecurityException) { return true; }
    }

    public static void Apply(bool enabled)
    {
        using var runKey = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("Windows login startup settings are unavailable.");
        if (!enabled)
        {
            runKey.DeleteValue(ValueName, throwOnMissingValue: false);
            return;
        }

        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Native Host executable path is unavailable.");
        var arguments = string.Empty;
        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
        {
            var assembly = Assembly.GetEntryAssembly()?.Location;
            if (string.IsNullOrWhiteSpace(assembly) || !File.Exists(assembly)) throw new InvalidOperationException("Cannot configure login startup for the current development run.");
            arguments = $" \"{assembly}\"";
        }
        runKey.SetValue(ValueName, $"\"{executable}\"{arguments}", RegistryValueKind.String);
    }
}
