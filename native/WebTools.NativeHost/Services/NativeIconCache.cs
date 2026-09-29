using System.Runtime.InteropServices;
using System.IO;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace WebTools.NativeHost.Services;

public sealed class NativeIconCache
{
    private const uint ShgfiIcon = 0x000000100;
    private const uint ShgfiSmallIcon = 0x000000001;
    private readonly Dictionary<string, (BitmapSource? Bitmap, LinkedListNode<string> Node)> _items = new(StringComparer.OrdinalIgnoreCase);
    private readonly LinkedList<string> _lru = new();
    private readonly int _capacity;
    private readonly Func<string> _themeProvider;
    private readonly Func<string, string, PackagedIconExtraction> _packagedExtractor;
    private readonly Action<string>? _diagnostic;

    public NativeIconCache(int capacity = 64, Action<string>? diagnostic = null)
        : this(capacity, PackagedIconResolver.GetCurrentSystemTheme, PackagedIconResolver.Extract, diagnostic) { }

    internal NativeIconCache(int capacity, Func<string> themeProvider,
        Func<string, string, PackagedIconExtraction> packagedExtractor, Action<string>? diagnostic = null)
    {
        _capacity = Math.Max(1, capacity);
        _themeProvider = themeProvider;
        _packagedExtractor = packagedExtractor;
        _diagnostic = diagnostic;
    }

    public int Count => _items.Count;
    public long ApproximateBitmapBytes => _items.Values.Where(item => item.Bitmap is not null)
        .Sum(item => (long)item.Bitmap!.PixelWidth * item.Bitmap.PixelHeight * 4);

    public async Task<BitmapSource?> GetAsync(string? reference)
    {
        if (string.IsNullOrWhiteSpace(reference)) return null;
        var isPackaged = reference.StartsWith("appx:", StringComparison.OrdinalIgnoreCase);
        var theme = isPackaged ? _themeProvider() : "";
        var cacheKey = isPackaged ? $"{reference}|theme:{theme}" : reference;
        lock (_items)
        {
            if (_items.TryGetValue(cacheKey, out var cached))
            {
                _lru.Remove(cached.Node);
                _lru.AddFirst(cached.Node);
                return cached.Bitmap;
            }
        }
        BitmapSource? bitmap;
        try
        {
            if (isPackaged)
            {
                var result = await Task.Run(() => _packagedExtractor(reference[5..], theme));
                _diagnostic?.Invoke(result.Outcome);
                bitmap = result.Bitmap;
            }
            else bitmap = await Task.Run(() => Extract(reference));
        }
        catch { return null; }
        lock (_items)
        {
            if (_items.TryGetValue(cacheKey, out var existing)) return existing.Bitmap;
            var node = _lru.AddFirst(cacheKey);
            _items[cacheKey] = (bitmap, node);
            while (_items.Count > _capacity)
            {
                var last = _lru.Last!;
                _items.Remove(last.Value);
                _lru.RemoveLast();
            }
        }
        return bitmap;
    }

    private static BitmapSource? Extract(string path)
    {
        if (!File.Exists(path)) return null;
        var info = new ShellFileInfo { DisplayName = "", TypeName = "" };
        var pointer = SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf<ShellFileInfo>(), ShgfiIcon | ShgfiSmallIcon);
        if (pointer == IntPtr.Zero || info.Icon == IntPtr.Zero) return null;
        try
        {
            var bitmap = Imaging.CreateBitmapSourceFromHIcon(info.Icon, System.Windows.Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            bitmap.Freeze();
            return bitmap;
        }
        finally { DestroyIcon(info.Icon); }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShellFileInfo
    {
        public IntPtr Icon;
        public int IconIndex;
        public uint Attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string DisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string TypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHGetFileInfoW")]
    private static extern IntPtr SHGetFileInfo(string path, uint attributes, ref ShellFileInfo info, uint size, uint flags);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr icon);
}
