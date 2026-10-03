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

        var requestedProfileRoot = ResolveAbsolutePath(arguments[1], "profile root");
        var requestedCatalogPath = ResolveAbsolutePath(arguments[2], "catalog snapshot path");
        var userProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Nook");
        var installRoot = Path.GetDirectoryName(Environment.ProcessPath ?? AppContext.BaseDirectory) ?? AppContext.BaseDirectory;
        var canonicalUserProfile = ResolvePhysicalPath(userProfile, allowMissing: true);
        var canonicalInstallRoot = ResolvePhysicalPath(installRoot, allowMissing: true);
        if (PathsOverlap(requestedProfileRoot, canonicalUserProfile))
            throw new ArgumentException("The Phase 4E profile cannot overlap the real WebTools user profile.");
        if (PathsOverlap(requestedProfileRoot, canonicalInstallRoot))
            throw new ArgumentException("The Phase 4E profile cannot overlap the NativeHost installation directory.");

        var tempRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
        if (!IsWithin(tempRoot, requestedProfileRoot))
            throw new ArgumentException("The Phase 4E test profile must be a strict descendant of the current user's temporary directory.");
        if (!IsWithin(requestedProfileRoot, requestedCatalogPath))
            throw new ArgumentException("The Phase 4E catalog snapshot must be a strict descendant of the isolated test profile.");

        EnsureExistingDirectoryWithoutReparsePoints(tempRoot, requestedProfileRoot, "profile root");
        EnsureExistingFileWithoutReparsePoints(requestedProfileRoot, requestedCatalogPath, "catalog snapshot");

        var canonicalTempRoot = ResolvePhysicalPath(tempRoot, allowMissing: false);
        var canonicalProfileRoot = ResolvePhysicalPath(requestedProfileRoot, allowMissing: false);
        var canonicalCatalogPath = ResolvePhysicalPath(requestedCatalogPath, allowMissing: false);
        if (!IsWithin(canonicalTempRoot, canonicalProfileRoot))
            throw new ArgumentException("The Phase 4E profile resolves outside the current user's temporary directory.");

        if (PathsOverlap(canonicalProfileRoot, canonicalUserProfile))
            throw new ArgumentException("The Phase 4E profile cannot overlap the real WebTools user profile.");
        if (PathsOverlap(canonicalProfileRoot, canonicalInstallRoot))
            throw new ArgumentException("The Phase 4E profile cannot overlap the NativeHost installation directory.");

        var controlPipeName = arguments[3];
        if (!PipeNamePattern.IsMatch(controlPipeName))
            throw new ArgumentException("The Phase 4E resource control pipe name is invalid.");

        var hotkey = arguments[4];
        if (!HotkeyPattern.IsMatch(hotkey))
            throw new ArgumentException("The Phase 4E resource test hotkey must use Control+Alt+Shift+F1 through F12.");

        return new Phase4EResourceTestOptions(canonicalProfileRoot, canonicalCatalogPath, controlPipeName, hotkey);
    }

    private static string ResolveAbsolutePath(string value, string label)
    {
        if (!Path.IsPathFullyQualified(value)) throw new ArgumentException($"The Phase 4E {label} must be an absolute path.");
        return Path.GetFullPath(value);
    }

    private static void EnsureExistingDirectoryWithoutReparsePoints(string root, string directory, string label)
    {
        if (!Directory.Exists(directory)) throw new ArgumentException($"The Phase 4E {label} must already exist.");
        EnsureNoReparsePointsBetween(root, directory, label);
        if ((File.GetAttributes(directory) & FileAttributes.Directory) == 0)
            throw new ArgumentException($"The Phase 4E {label} must be a directory.");
    }

    private static void EnsureExistingFileWithoutReparsePoints(string root, string file, string label)
    {
        if (!File.Exists(file)) throw new ArgumentException($"The Phase 4E {label} must already exist.");
        EnsureNoReparsePointsBetween(root, file, label);
        if ((File.GetAttributes(file) & FileAttributes.Directory) != 0)
            throw new ArgumentException($"The Phase 4E {label} must be a file.");
    }

    private static void EnsureNoReparsePointsBetween(string root, string path, string label)
    {
        var relativePath = Path.GetRelativePath(root, path);
        var current = Path.GetFullPath(root);
        foreach (var part in relativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            if (string.IsNullOrEmpty(part) || part == ".") continue;
            current = Path.Combine(current, part);
            try
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new ArgumentException($"The Phase 4E {label} cannot traverse a symbolic link, junction, or reparse point.");
            }
            catch (FileNotFoundException error)
            {
                throw new ArgumentException($"The Phase 4E {label} path could not be resolved.", error);
            }
            catch (DirectoryNotFoundException error)
            {
                throw new ArgumentException($"The Phase 4E {label} path could not be resolved.", error);
            }
        }
    }

    private static string ResolvePhysicalPath(string path, bool allowMissing)
    {
        var fullPath = Path.GetFullPath(path);
        var volumeRoot = Path.GetPathRoot(fullPath)
            ?? throw new ArgumentException("A filesystem path has no volume root.");
        var current = volumeRoot;
        var relative = fullPath[volumeRoot.Length..];

        foreach (var part in relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            if (string.IsNullOrEmpty(part)) continue;
            var candidate = Path.Combine(current, part);
            if (!Directory.Exists(candidate) && !File.Exists(candidate))
            {
                if (!allowMissing) throw new ArgumentException("A required isolated path does not exist.");
                current = candidate;
                continue;
            }

            var attributes = File.GetAttributes(candidate);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                FileSystemInfo entry = (attributes & FileAttributes.Directory) != 0
                    ? new DirectoryInfo(candidate)
                    : new FileInfo(candidate);
                var target = entry.ResolveLinkTarget(returnFinalTarget: true)
                    ?? throw new ArgumentException("A reparse point could not be resolved safely.");
                current = Path.GetFullPath(target.FullName);
            }
            else
            {
                current = candidate;
            }
        }

        return Path.TrimEndingDirectorySeparator(Path.GetFullPath(current));
    }

    private static bool PathsOverlap(string left, string right) => IsSameOrWithin(left, right) || IsSameOrWithin(right, left);

    private static bool IsWithin(string root, string path)
    {
        var relative = Path.GetRelativePath(Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)), Path.GetFullPath(path));
        return relative != "."
            && relative != ".."
            && !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            && !relative.StartsWith(".." + Path.AltDirectorySeparatorChar, StringComparison.Ordinal)
            && !Path.IsPathRooted(relative);
    }

    private static bool IsSameOrWithin(string root, string path)
    {
        var normalizedRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        var normalizedPath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        return string.Equals(normalizedRoot, normalizedPath, StringComparison.OrdinalIgnoreCase)
            || IsWithin(normalizedRoot, normalizedPath);
    }
}
