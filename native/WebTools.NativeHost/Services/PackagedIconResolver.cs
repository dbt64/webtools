using System.Runtime.InteropServices;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Media.Imaging;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Win32;

namespace WebTools.NativeHost.Services;

internal sealed record PackagedIconExtraction(BitmapSource? Bitmap, string Outcome);

internal static class PackagedIconResolver
{
    private const int ErrorInsufficientBuffer = 122;
    private const int MaxManifestBytes = 1024 * 1024;
    private const int MaxPackageCount = 128;
    private const int MaxAssetCandidates = 512;
    private static readonly HashSet<string> RasterExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff", ".wdp", ".jxr",
    };

    public static string GetCurrentSystemTheme()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return Convert.ToInt32(key?.GetValue("AppsUseLightTheme", 0), System.Globalization.CultureInfo.InvariantCulture) == 1
                ? "light"
                : "dark";
        }
        catch { return "dark"; }
    }

    public static PackagedIconExtraction Extract(string aumid, string theme)
    {
        try
        {
            if (!TryParseAumid(aumid, out var packageFamily, out var applicationId))
                return new(null, "invalid-aumid");

            var packagePaths = FindPackagePaths(packageFamily);
            if (packagePaths.Count == 0) return new(null, "package-not-found");

            var scale = GetPreferredScale();
            foreach (var packagePath in packagePaths)
            {
                var logoPath = ResolveManifestLogoPath(packagePath, applicationId, 32, scale, theme);
                if (logoPath is null) continue;
                try
                {
                    using var stream = new FileStream(logoPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                    var decoder = BitmapDecoder.Create(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
                    if (decoder.Frames.Count == 0) continue;
                    var bitmap = decoder.Frames[0];
                    bitmap.Freeze();
                    return new(bitmap, "resolved");
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or NotSupportedException or InvalidOperationException or System.Runtime.InteropServices.COMException)
                {
                    // A single bad visual asset must not fail other packaged icons or catalog search.
                }
            }
            return new(null, "manifest-asset-not-found");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or XmlException or System.Runtime.InteropServices.COMException or EntryPointNotFoundException or DllNotFoundException or OverflowException)
        {
            return new(null, $"resolution-error:{error.GetType().Name}");
        }
    }

    internal static string? ResolveManifestLogoPath(string packageRoot, string applicationId, int targetPixels, int preferredScale, string theme)
    {
        try
        {
            var root = Path.GetFullPath(packageRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var rootPrefix = root + Path.DirectorySeparatorChar;
            var manifest = Path.Combine(root, "AppxManifest.xml");
            var manifestInfo = new FileInfo(manifest);
            if (!manifestInfo.Exists || manifestInfo.Length is <= 0 or > MaxManifestBytes) return null;

            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = MaxManifestBytes };
            using var reader = XmlReader.Create(manifest, settings);
            var document = XDocument.Load(reader, LoadOptions.None);
            var app = document.Descendants().FirstOrDefault(element =>
                element.Name.LocalName == "Application"
                && string.Equals((string?)element.Attribute("Id"), applicationId, StringComparison.Ordinal));
            if (app is null) return null;

            var visualElements = app.Descendants().FirstOrDefault(element => element.Name.LocalName == "VisualElements");
            if (visualElements is null) return null;

            var requestedTheme = theme is "light" or "dark" ? theme : "dark";
            var logoAttributes = new (string Attribute, int BaseSize)[]
            {
                ("Square44x44Logo", 44),
                ("Square150x150Logo", 150),
                ("Square310x310Logo", 310),
                ("Square71x71Logo", 71),
            };

            foreach (var (attribute, baseSize) in logoAttributes)
            {
                var relativePath = (string?)visualElements.Attribute(attribute);
                if (string.IsNullOrWhiteSpace(relativePath) || relativePath.StartsWith("ms-resource:", StringComparison.OrdinalIgnoreCase)) continue;
                var safeRelativePath = relativePath.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                if (Path.IsPathFullyQualified(safeRelativePath)) continue;
                var declaredPath = Path.GetFullPath(Path.Combine(root, safeRelativePath));
                if (!declaredPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)) continue;

                var chosen = EnumerateAssetVariants(root, declaredPath, baseSize, targetPixels, preferredScale, requestedTheme)
                    .OrderBy(candidate => candidate.ThemeScore)
                    .ThenBy(candidate => candidate.SizeScore)
                    .ThenBy(candidate => candidate.ResolutionScore)
                    .FirstOrDefault();
                if (chosen is not null) return chosen.Path;
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or XmlException or InvalidOperationException or NotSupportedException or PathTooLongException or System.Security.SecurityException)
        {
            // Corrupt or inaccessible package metadata should yield a generic icon, not stop the search UI.
        }
        return null;
    }

    private static bool TryParseAumid(string aumid, out string packageFamily, out string applicationId)
    {
        packageFamily = "";
        applicationId = "";
        if (string.IsNullOrWhiteSpace(aumid) || aumid.Length > 512) return false;
        uint familyLength = 0;
        uint applicationLength = 0;
        var status = ParseApplicationUserModelId(aumid, ref familyLength, null, ref applicationLength, null);
        if (status != ErrorInsufficientBuffer || familyLength is 0 or > 512 || applicationLength is 0 or > 512) return false;

        var familyBuffer = new StringBuilder((int)familyLength);
        var applicationBuffer = new StringBuilder((int)applicationLength);
        status = ParseApplicationUserModelId(aumid, ref familyLength, familyBuffer, ref applicationLength, applicationBuffer);
        if (status != 0) return false;
        packageFamily = familyBuffer.ToString();
        applicationId = applicationBuffer.ToString();
        return packageFamily.Length > 0 && applicationId.Length > 0;
    }

    private static IReadOnlyList<string> FindPackagePaths(string packageFamily)
    {
        uint count = 0;
        uint bufferLength = 0;
        var status = GetPackagesByPackageFamily(packageFamily, ref count, IntPtr.Zero, ref bufferLength, IntPtr.Zero);
        if (status != ErrorInsufficientBuffer || count is 0 or > MaxPackageCount || bufferLength is 0 or > 32768) return [];

        var namePointers = Marshal.AllocHGlobal(checked((int)count * IntPtr.Size));
        var nameBuffer = Marshal.AllocHGlobal(checked((int)bufferLength * sizeof(char)));
        try
        {
            status = GetPackagesByPackageFamily(packageFamily, ref count, namePointers, ref bufferLength, nameBuffer);
            if (status != 0 || count > MaxPackageCount || bufferLength > 32768) return [];

            var paths = new List<string>((int)count);
            for (var index = 0; index < count; index++)
            {
                var fullNamePointer = Marshal.ReadIntPtr(namePointers, checked((int)index * IntPtr.Size));
                var fullName = Marshal.PtrToStringUni(fullNamePointer);
                if (string.IsNullOrWhiteSpace(fullName)) continue;
                var path = GetPackagePath(fullName);
                if (path is not null) paths.Add(path);
            }
            return paths;
        }
        finally
        {
            Marshal.FreeHGlobal(nameBuffer);
            Marshal.FreeHGlobal(namePointers);
        }
    }

    private static string? GetPackagePath(string packageFullName)
    {
        uint length = 0;
        var status = GetPackagePathByFullName(packageFullName, ref length, null);
        if (status != ErrorInsufficientBuffer || length is 0 or > 32768) return null;
        var path = new StringBuilder((int)length);
        status = GetPackagePathByFullName(packageFullName, ref length, path);
        return status == 0 && path.Length > 0 ? Path.GetFullPath(path.ToString()) : null;
    }

    private static IEnumerable<AssetCandidate> EnumerateAssetVariants(string root, string declaredPath, int baseSize, int targetPixels, int preferredScale, string theme)
    {
        var extension = Path.GetExtension(declaredPath);
        var directory = Path.GetDirectoryName(declaredPath);
        if (directory is null || !Directory.Exists(directory)) yield break;
        var nameWithoutExtension = Path.GetFileNameWithoutExtension(declaredPath);
        var extensions = string.IsNullOrEmpty(extension) ? RasterExtensions : [extension];
        var directories = new Queue<(string Path, int Depth)>();
        directories.Enqueue((directory, 0));
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var found = 0;

        while (directories.Count > 0 && found < MaxAssetCandidates)
        {
            var (current, depth) = directories.Dequeue();
            if (!visited.Add(current)) continue;
            string[] files;
            try { files = Directory.GetFiles(current); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException) { continue; }

            foreach (var file in files)
            {
                if (found >= MaxAssetCandidates) yield break;
                var fileExtension = Path.GetExtension(file);
                if (!RasterExtensions.Contains(fileExtension) || (!string.IsNullOrEmpty(extension) && !fileExtension.Equals(extension, StringComparison.OrdinalIgnoreCase))) continue;
                var fileStem = Path.GetFileNameWithoutExtension(file);
                if (!fileStem.Equals(nameWithoutExtension, StringComparison.OrdinalIgnoreCase)
                    && !fileStem.StartsWith(nameWithoutExtension + ".", StringComparison.OrdinalIgnoreCase)
                    && !fileStem.StartsWith(nameWithoutExtension + "_", StringComparison.OrdinalIgnoreCase)) continue;

                var fullPath = Path.GetFullPath(file);
                var rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (!fullPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)) continue;
                var qualifierText = fileStem + " " + Path.GetRelativePath(root, current).Replace(Path.DirectorySeparatorChar, ' ');
                var scale = ReadQualifier(qualifierText, "scale");
                var targetSize = ReadQualifier(qualifierText, "targetsize");
                var assetTheme = ReadThemeQualifier(qualifierText);
                var themeScore = assetTheme is null ? 1 : assetTheme.Equals(theme, StringComparison.OrdinalIgnoreCase) ? 0 : 2;
                var pixelSize = targetSize ?? (int)Math.Round(baseSize * (scale ?? 100) / 100d);
                var sizeScore = Math.Abs(pixelSize - targetPixels) + (pixelSize < targetPixels ? 40 : 0);
                var resolutionScore = scale.HasValue ? Math.Abs(scale.Value - preferredScale) + (scale.Value < preferredScale ? 10 : 0) : Math.Abs(100 - preferredScale) + (100 < preferredScale ? 10 : 0);
                yield return new AssetCandidate(fullPath, themeScore, sizeScore, resolutionScore);
                found++;
            }

            if (depth >= 2) continue;
            string[] children;
            try { children = Directory.GetDirectories(current); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException) { continue; }
            foreach (var child in children)
            {
                try
                {
                    if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) == 0) directories.Enqueue((child, depth + 1));
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* isolate an unreadable asset folder */ }
            }
        }
    }

    private static int? ReadQualifier(string text, string qualifier)
    {
        var match = Regex.Match(text, $"(?<![a-z0-9]){Regex.Escape(qualifier)}-(\\d+)(?!\\d)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return match.Success && int.TryParse(match.Groups[1].Value, out var value) ? value : null;
    }

    private static string? ReadThemeQualifier(string text)
    {
        var match = Regex.Match(text, @"(?<![a-z0-9])theme-(light|dark)(?![a-z0-9])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : null;
    }

    private static int GetPreferredScale()
    {
        try
        {
            var dpi = GetDpiForSystem();
            return dpi is >= 48 and <= 960 ? (int)Math.Round(dpi * 100d / 96d) : 100;
        }
        catch { return 100; }
    }

    private sealed record AssetCandidate(string Path, int ThemeScore, int SizeScore, int ResolutionScore);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int ParseApplicationUserModelId(string applicationUserModelId, ref uint packageFamilyNameLength, StringBuilder? packageFamilyName, ref uint packageRelativeApplicationIdLength, StringBuilder? packageRelativeApplicationId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetPackagesByPackageFamily(string packageFamilyName, ref uint count, IntPtr packageFullNames, ref uint bufferLength, IntPtr buffer);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetPackagePathByFullName(string packageFullName, ref uint pathLength, StringBuilder? path);

    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern uint GetDpiForSystem();
}
