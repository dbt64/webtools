using System.IO;

namespace WebTools.NativeHost.Files;

public enum FileCategory
{
    All,
    Folder,
    Application,
    Document,
    Image,
    Video,
    Audio,
    Archive,
    Other,
}

public static class FileCategoryClassifier
{
    private static readonly HashSet<string> Applications = Extensions(".exe .msi .msix .appx .lnk");
    private static readonly HashSet<string> Documents = Extensions(".txt .md .markdown .pdf .doc .docx .xls .xlsx .ppt .pptx .rtf .odt .ods .odp .csv .log .epub");
    private static readonly HashSet<string> Images = Extensions(".png .jpg .jpeg .gif .bmp .tif .tiff .webp .svg .ico .heic .avif");
    private static readonly HashSet<string> Videos = Extensions(".mp4 .m4v .mkv .mov .avi .wmv .webm .mpeg .mpg .flv .ts");
    private static readonly HashSet<string> Audio = Extensions(".mp3 .wav .flac .aac .m4a .ogg .opus .wma .aiff .mid .midi");
    private static readonly HashSet<string> Archives = Extensions(".zip .rar .7z .tar .gz .bz2 .xz .cab .iso .tgz .zst");

    public static FileCategory Classify(string path, bool isDirectory)
    {
        if (isDirectory) return FileCategory.Folder;
        var extension = Path.GetExtension(path);
        if (Applications.Contains(extension)) return FileCategory.Application;
        if (Documents.Contains(extension)) return FileCategory.Document;
        if (Images.Contains(extension)) return FileCategory.Image;
        if (Videos.Contains(extension)) return FileCategory.Video;
        if (Audio.Contains(extension)) return FileCategory.Audio;
        if (Archives.Contains(extension)) return FileCategory.Archive;
        return FileCategory.Other;
    }

    private static HashSet<string> Extensions(string values) =>
        values.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);
}
