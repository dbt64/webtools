using System.IO;

namespace WebTools.NativeHost.Catalog;

/// <summary>Marks the cached catalog stale when a shortcut tree changes; it never scans on the watcher thread.</summary>
internal sealed class AppCatalogChangeMonitor : IDisposable
{
    private readonly List<FileSystemWatcher> _watchers = [];
    private readonly Action _changed;
    private readonly Action _failed;
    private volatile bool _disposed;

    internal AppCatalogChangeMonitor(Action changed, Action failed)
    {
        _changed = changed;
        _failed = failed;
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
        };

        foreach (var root in roots.Where(path => !string.IsNullOrWhiteSpace(path)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(root)) continue;
            try
            {
                var watcher = new FileSystemWatcher(root, "*.lnk")
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite,
                    InternalBufferSize = 16 * 1024,
                    EnableRaisingEvents = false,
                };
                watcher.Created += OnChanged;
                watcher.Changed += OnChanged;
                watcher.Deleted += OnChanged;
                watcher.Renamed += OnRenamed;
                watcher.Error += OnError;
                _watchers.Add(watcher);
                watcher.EnableRaisingEvents = true;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException
                or ArgumentException or PlatformNotSupportedException or System.ComponentModel.Win32Exception)
            {
                _failed();
            }
        }
    }

    private void OnChanged(object sender, FileSystemEventArgs args)
    {
        if (!_disposed) _changed();
    }

    private void OnRenamed(object sender, RenamedEventArgs args)
    {
        if (!_disposed) _changed();
    }

    private void OnError(object sender, ErrorEventArgs args)
    {
        if (!_disposed) _failed();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var watcher in _watchers)
        {
            watcher.EnableRaisingEvents = false;
            watcher.Created -= OnChanged;
            watcher.Changed -= OnChanged;
            watcher.Deleted -= OnChanged;
            watcher.Renamed -= OnRenamed;
            watcher.Error -= OnError;
            watcher.Dispose();
        }
        _watchers.Clear();
    }
}
