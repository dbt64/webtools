using System.IO;
using System.Text.RegularExpressions;

namespace WebTools.NativeHost.Diagnostics;

internal sealed record Phase4EResourceTestOptions(
    string ProfileRoot,
    string CatalogSnapshotPath,
    string ControlPipeName,
    string Hotkey)
{
    private const string Flag = "--phase4e-resource-test";
    private static readonly Regex PipeNamePattern = new(
        "^WebTools\\.NativeHost\\.Resource\\.[A-Za-z0-9._-]{8,80}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex HotkeyPattern = new(
        "^Control\\+Alt\\+Shift\\+F(?:[1-9]|1[0-2])$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static Phase4EResourceTestOptions? Parse(IReadOnlyList<string> arguments)
    {
        var flagIndex = -1;
        for (var index = 0; index < arguments.Count; index++)
            if (arguments[index] == Flag) { flagIndex = index; break; }
        if (flagIndex < 0) return null;
        if (flagIndex != 0 || arguments.Count != 5)
            throw new ArgumentException("Phase 4E resource test mode requires a profile root, catalog path, control pipe, and isolated hotkey.");

        var profileRoot = ResolveAbsolutePath(arguments[1], "profile root");
        var catalogSnapshotPath = ResolveAbsolutePath(arguments[2], "catalog snapshot path");
        var tempRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
        if (!IsWithin(tempRoot, profileRoot))
            throw new ArgumentException("The Phase 4E test profile must be located under the current user's temporary directory.");
        if (!IsWithin(profileRoot, catalogSnapshotPath))
            throw new ArgumentException("The Phase 4E catalog snapshot must be located inside the isolated test profile.");

        var controlPipeName = arguments[3];
        if (!PipeNamePattern.IsMatch(controlPipeName))
            throw new ArgumentException("The Phase 4E resource control pipe name is invalid.");

        var hotkey = arguments[4];
        if (!HotkeyPattern.IsMatch(hotkey))
            throw new ArgumentException("The Phase 4E resource test hotkey must use Control+Alt+Shift+F1 through F12.");

        return new Phase4EResourceTestOptions(profileRoot, catalogSnapshotPath, controlPipeName, hotkey);
    }

    private static string ResolveAbsolutePath(string value, string label)
    {
        if (!Path.IsPathFullyQualified(value)) throw new ArgumentException($"The Phase 4E {label} must be an absolute path.");
        return Path.GetFullPath(value);
    }

    private static bool IsWithin(string root, string path)
    {
        var normalizedRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)) + Path.DirectorySeparatorChar;
        var normalizedPath = Path.GetFullPath(path);
        return normalizedPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
    }
}
