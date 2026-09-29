using System.IO;
using System.Text.Json;
using System.Windows.Media.Imaging;

namespace WebTools.NativeHost.Data;

// The Manager owns nook-data.json. Read only the requested saved icons when the shortcut panel opens.
internal static class WebsiteFaviconReader
{
    public static IReadOnlyDictionary<string, BitmapSource> Read(string dataPath, IReadOnlyCollection<string> websiteIds)
    {
        var icons = new Dictionary<string, BitmapSource>(StringComparer.Ordinal);
        if (websiteIds.Count == 0 || !File.Exists(dataPath)) return icons;
        var requested = websiteIds.ToHashSet(StringComparer.Ordinal);
        try
        {
            using var stream = File.Open(dataPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length > 32 * 1024 * 1024) return icons;
            using var document = JsonDocument.Parse(stream);
            if (!document.RootElement.TryGetProperty("webEntries", out var entries) || entries.ValueKind != JsonValueKind.Array) return icons;
            foreach (var entry in entries.EnumerateArray())
            {
                if (!entry.TryGetProperty("id", out var idValue) || idValue.ValueKind != JsonValueKind.String ||
                    !requested.Contains(idValue.GetString() ?? "") ||
                    !entry.TryGetProperty("favicon", out var faviconValue) || faviconValue.ValueKind != JsonValueKind.String) continue;
                var dataUrl = faviconValue.GetString();
                if (dataUrl is null || dataUrl.Length > 500_000 || !dataUrl.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)) continue;
                var separator = dataUrl.IndexOf(",", StringComparison.Ordinal);
                if (separator < 0 || !dataUrl[..separator].EndsWith(";base64", StringComparison.OrdinalIgnoreCase)) continue;
                try
                {
                    var bytes = Convert.FromBase64String(dataUrl[(separator + 1)..]);
                    using var imageStream = new MemoryStream(bytes, writable: false);
                    var image = new BitmapImage();
                    image.BeginInit();
                    image.CacheOption = BitmapCacheOption.OnLoad;
                    image.DecodePixelWidth = 64;
                    image.StreamSource = imageStream;
                    image.EndInit();
                    image.Freeze();
                    icons[idValue.GetString()!] = image;
                }
                catch (Exception error) when (error is FormatException or NotSupportedException or IOException or InvalidOperationException) { /* initial fallback */ }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException) { /* initial fallback */ }
        return icons;
    }
}
