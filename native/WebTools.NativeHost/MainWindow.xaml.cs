using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Interop;
using Microsoft.Win32;
using WebTools.NativeHost.Catalog;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Diagnostics;
using WebTools.NativeHost.Files;
using WebTools.NativeHost.Models;
using WebTools.NativeHost.Search;
using WebTools.NativeHost.Services;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using Brush = System.Windows.Media.Brush;
using Image = System.Windows.Controls.Image;
using Orientation = System.Windows.Controls.Orientation;
using DispatcherPriority = System.Windows.Threading.DispatcherPriority;

namespace WebTools.NativeHost;

public partial class MainWindow : Window
{
    private const double CompactHeight = 128;
    private const double ExpandedHeight = 326;
    private const double SearchResultsHeight = 466;
    private readonly DiagnosticsService _diagnostics;
    private readonly LauncherStateStore _stateStore;
    private readonly AppCatalogSnapshotStore _catalogSnapshotStore;
    private readonly ManagerController _managerController;
    private readonly LauncherInteractionState _state = new();
    private readonly AppCatalogService _catalog = new();
    private readonly FileSearchProjection _fileSearchProjection = new();
    private readonly NativeIconCache _icons;
    private readonly LatestSearchGeneration _fileGeneration = new();
    private readonly LauncherResultSelectionController _selection;
    private readonly LauncherDragGesture _searchBarDragGesture = new();
    private readonly TaskCompletionSource _resourceTestReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private WebsiteSnapshot _snapshot;
    private SearchCore _search = new([], []);
    private EverythingClient _everything = new("");
    private ResultActionExecutor _actions;
    private List<ResultRow> _rows = [];
    private GlobalHotkeyService? _hotkey;
    private long _pendingShowTimestamp;
    private int _resultGeneration;
    private Task _resourceFileSearchTask = Task.CompletedTask;
    private Task _resourceVisibleIconTask = Task.CompletedTask;
    private bool _awaitingShowFocus;
    private bool _isDraggingSearchBar;
    private UIElement? _activeDragSurface;
    private bool _websitesExpanded;
    private System.Windows.Point _dragStartScreen;
    private double _dragStartLeft;
    private double _dragStartTop;
    private bool _expanded;
    private bool _pluginsExpanded;
    private IReadOnlyList<LauncherPluginShortcut> _plugins = [];
    private bool _catalogLoading = true;
    private bool _updatingFileCategories;
    private readonly bool _resourceTestMode;
    private bool _disposed;
    private string _themePreference = "system";
    private string _effectiveTheme = "dark";

    public event Action<string>? EffectiveThemeChanged;

    internal MainWindow(DiagnosticsService diagnostics, LauncherStateStore stateStore, LauncherState initialState,
        AppCatalogSnapshotStore catalogSnapshotStore, ManagerController managerController, bool resourceTestMode = false)
    {
        _diagnostics = diagnostics;
        _stateStore = stateStore;
        _snapshot = initialState.ToWebsiteSnapshot();
        _catalogSnapshotStore = catalogSnapshotStore;
        _managerController = managerController;
        _resourceTestMode = resourceTestMode;
        _selection = new LauncherResultSelectionController(_state);
        _actions = new ResultActionExecutor(_catalog, _everything);
        _icons = new NativeIconCache(64, outcome => _diagnostics.Record("packaged_icon_lookup", outcome));
        InitializeComponent();
        FileCategoriesList.ItemsSource = _fileSearchProjection.Categories
            .Select(category => new FileCategoryRow(category, GetFileCategoryLabel(category))).ToArray();
        FileCategoriesList.SelectedIndex = 0;
        ApplyTheme(initialState.Theme);
        LoadBrandIcon();
        SystemEvents.UserPreferenceChanged += SystemPreferenceChanged;
        _search = new SearchCore([], _snapshot.Websites, initialState.AppSearchMemory);
    }

    public void RegisterHotkey(IntPtr handle, string? shortcutOverride = null) => _hotkey = new GlobalHotkeyService(handle, shortcutOverride ?? _stateStore.Snapshot.QuickSearchShortcut, OnHotkey, _diagnostics);

    public bool TryReplaceHotkey(string shortcut, out string error)
    {
        if (_hotkey is null) { error = "快捷键服务尚未初始化。"; return false; }
        return _hotkey.TryReplace(shortcut, out error);
    }

    public async Task ApplyLauncherStateAsync(LauncherState state)
    {
        ApplyTheme(state.Theme);
        _snapshot = state.ToWebsiteSnapshot();
        _everything = new EverythingClient(_snapshot.EverythingEsPath);
        _actions = new ResultActionExecutor(_catalog, _everything);
        await RebuildIndexAsync();
        if (_expanded) RefreshShortcuts();
        RenderQuery();
    }
    public void ApplyPluginProjection(LauncherPluginProjection projection)
    {
        _plugins = projection.Plugins;
        if (_expanded && string.IsNullOrWhiteSpace(QueryBox.Text)) RefreshPluginShortcuts();
        UpdateLayoutForResults();
    }

    public async Task InitializeSearchAsync()
    {
        _snapshot = _stateStore.Snapshot.ToWebsiteSnapshot();
        _everything = new EverythingClient(_snapshot.EverythingEsPath);
        _actions = new ResultActionExecutor(_catalog, _everything);
        _diagnostics.Record("website_ready", $"count={_snapshot.Websites.Count}");

        if (_catalogSnapshotStore.TryLoad(out var cached, out var reason) && cached is not null)
        {
            try
            {
                _catalog.RestoreSnapshot(cached.Apps);
                _catalogLoading = false;
                _diagnostics.Record("catalog_snapshot_loaded", $"count={cached.Apps.Count};generated={cached.GeneratedAtUtc:O}");
            }
            catch (Exception error) when (error is InvalidDataException or ArgumentException or InvalidOperationException)
            {
                _diagnostics.Record("catalog_snapshot_rejected", error.GetType().Name);
            }
        }
        else _diagnostics.Record("catalog_snapshot_unavailable", reason);

        try
        {
            await RebuildIndexAsync();
            if (_expanded) RefreshShortcuts();
            RenderQuery();
        }
        catch (Exception error)
        {
            _diagnostics.Record("launcher_index_error", error.Message);
        }

        _ = RefreshCatalogAsync();
    }

    internal Task WaitForResourceTestReadyAsync() => _resourceTestReady.Task;

    internal async Task ActivateTranslationFromResourceTestAsync(string text)
    {
        await SetQueryFromResourceTestAsync(text);
        await Dispatcher.InvokeAsync(() =>
        {
            var result = _state.Results.FirstOrDefault(item => item.Action is OpenTranslationAction);
            if (result is null) throw new InvalidOperationException("Test query has no Translation action.");
            ActivateResult(result);
        });
    }
    internal async Task ActivatePluginFromResourceTestAsync(LauncherPluginRef reference)
    {
        if (!_resourceTestMode) throw new InvalidOperationException("The isolated test driver is not enabled.");
        await Dispatcher.InvokeAsync(() => {
            ShowLauncher();
            var button = PluginShortcuts.Children.OfType<System.Windows.Controls.Button>().FirstOrDefault(item => item.Tag is LauncherPluginRef value && value == reference)
                ?? throw new InvalidOperationException("Plugin shortcut is unavailable.");
            button.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
        });
    }

    internal async Task<Phase4EResourcePresentation> SetQueryFromResourceTestAsync(string query)
    {
        if (!_resourceTestMode) throw new InvalidOperationException("The Phase 4E resource test driver is not enabled.");
        if (query.Length > 300 || query.IndexOfAny(['\0', '\r', '\n']) >= 0)
            throw new ArgumentException("The resource test query is invalid.", nameof(query));

        if (!Dispatcher.CheckAccess())
        {
            var operation = Dispatcher.InvokeAsync(() => SetQueryFromResourceTestAsync(query));
            var pending = await operation.Task;
            return await pending;
        }

        QueryBox.Text = query;
        await _resourceFileSearchTask;
        await _resourceVisibleIconTask;
        return await Dispatcher.InvokeAsync(CaptureResourceTestPresentation, DispatcherPriority.Render).Task;
    }

    internal async Task<Phase4EResourcePresentation> GetResourceTestPresentationAsync()
    {
        if (!_resourceTestMode) throw new InvalidOperationException("The Phase 4E resource test driver is not enabled.");
        return await Dispatcher.InvokeAsync(CaptureResourceTestPresentation, DispatcherPriority.Render).Task;
    }

    internal async Task<Phase4EResourcePresentation> SetVisibilityFromResourceTestAsync(bool visible)
    {
        if (!_resourceTestMode) throw new InvalidOperationException("The Phase 4E resource test driver is not enabled.");

        if (!Dispatcher.CheckAccess())
        {
            var operation = Dispatcher.InvokeAsync(() => SetVisibilityFromResourceTestAsync(visible));
            var pending = await operation.Task;
            return await pending;
        }

        if (visible) ShowLauncher();
        else HideLauncher("resource-test");
        return await Dispatcher.InvokeAsync(CaptureResourceTestPresentation, DispatcherPriority.Render).Task;
    }

    private Phase4EResourcePresentation CaptureResourceTestPresentation()
    {
        UpdateLayout();
        var realizedCount = 0;
        for (var index = 0; index < ResultsList.Items.Count; index++)
            if (ResultsList.ItemContainerGenerator.ContainerFromIndex(index) is ListBoxItem { IsVisible: true }) realizedCount++;

        return new Phase4EResourcePresentation(
            QueryBox.Text,
            SearchCommand.Parse(QueryBox.Text).Mode.ToString(),
            IsVisible,
            ResultsList.Items.Count,
            realizedCount,
            _rows.Count(row => row.Icon is not null),
            _icons.Count,
            _icons.ApproximateBitmapBytes,
            StatusText.Visibility == Visibility.Visible ? StatusText.Text : "",
            new WindowInteropHelper(this).Handle.ToInt64(),
            IsActive,
            QueryBox.IsKeyboardFocused,
            _snapshot.EverythingEnabled,
            _rows.Select(row => row.Result.Kind.ToString()).ToArray(),
            _plugins.ToArray(),
            PluginShortcuts.Children.OfType<System.Windows.Controls.Button>().Count(button => button.IsVisible));
    }

    private async Task RefreshCatalogAsync()
    {
        var scan = Stopwatch.StartNew();
        try
        {
            await _catalog.RefreshAsync();
            _catalogLoading = false;
            var saved = await _catalogSnapshotStore.SaveIfChangedAsync(_catalog.Apps);
            await RebuildIndexAsync();
            RenderQuery();
            _diagnostics.Record("catalog_refresh_complete", $"count={_catalog.Apps.Count};ms={scan.ElapsedMilliseconds};snapshotChanged={saved}");
        }
        catch (Exception error)
        {
            if (!_catalog.Ready) _catalogLoading = false;
            _diagnostics.Record("catalog_error", error.Message);
            if (_catalog.Apps.Count == 0) SetStatus("应用目录加载失败：" + error.Message);
        }
        finally { _resourceTestReady.TrySetResult(); }
    }

    private async Task RebuildIndexAsync()
    {
        var apps = _catalog.Apps.Select(app => app.AsSearchEntry()).ToArray();
        var websites = _snapshot.Websites;
        var memory = _stateStore.Snapshot.AppSearchMemory;
        var next = await Task.Run(() => new SearchCore(apps, websites, memory));
        _search = next;
    }

    public void DisposeNativeResources()
    {
        if (_disposed) return;
        _disposed = true;
        _fileGeneration.Dispose();
        SystemEvents.UserPreferenceChanged -= SystemPreferenceChanged;
        _hotkey?.Dispose();
        _hotkey = null;
    }

    private void OnHotkey()
    {
        if (IsVisible) HideLauncher("hotkey-toggle");
        else ShowLauncher();
    }

    private void ShowLauncher()
    {
        _pendingShowTimestamp = Stopwatch.GetTimestamp();
        _awaitingShowFocus = true;
        _expanded = _snapshot.ExpandedByDefault;
        _websitesExpanded = false;
        _pluginsExpanded = false;
        ExpandButton.Content = _expanded ? "收起 ↑" : "展开 ↓";
        if (_expanded) RefreshShortcuts();
        UpdateLayoutForResults();
        MonitorPlacement.PositionForCursorMonitor(this);
        if (!IsVisible) Show();
        WindowState = WindowState.Normal;
        Topmost = true;
        Activate();
        if (IsActive) FocusQueryBox();
        _diagnostics.Record("launcher_show_requested", "hotkey");
    }

    public void ShowFromTray()
    {
        if (!IsVisible)
        {
            ShowLauncher();
            return;
        }

        _pendingShowTimestamp = Stopwatch.GetTimestamp();
        _awaitingShowFocus = true;
        WindowState = WindowState.Normal;
        Topmost = true;
        Activate();
        if (IsActive) FocusQueryBox();
    }

    private void HideLauncher(string reason)
    {
        _diagnostics.Record("launcher_hide", reason);
        _searchBarDragGesture.End();
        if (_activeDragSurface is not null && Mouse.Captured == _activeDragSurface) Mouse.Capture(null);
        _activeDragSurface = null;
        _isDraggingSearchBar = false;
        _awaitingShowFocus = false;
        _fileGeneration.Next();
        _everything.InvalidateCurrentResults();
        _fileSearchProjection.SetQuery(string.Empty);
        _fileSearchProjection.SetResults([]);
        ++_resultGeneration;
        _state.Reset();
        QueryBox.Clear();
        _rows = [];
        _selection.Clear(ResultsList);
        _selection.Clear(FileResultsList);
        FileSearchPanel.Visibility = Visibility.Collapsed;
        FileResultsList.Visibility = Visibility.Collapsed;
        FileEmptyText.Visibility = Visibility.Collapsed;
        FileStatusText.Visibility = Visibility.Collapsed;
        _expanded = false;
        _websitesExpanded = false;
        WebsiteShortcuts.Children.Clear();
        _pluginsExpanded = false;
        PluginShortcuts.Children.Clear();
        ShortcutPanel.Visibility = Visibility.Collapsed;
        ResultsList.Visibility = Visibility.Collapsed;
        StatusText.Visibility = Visibility.Collapsed;
        QueryPlaceholder.Visibility = Visibility.Visible;
        Height = CompactHeight;
        if (IsVisible) Hide();
    }

    private void FocusQueryBox()
    {
        if (!_awaitingShowFocus || !IsActive) return;
        QueryBox.Focus();
        Keyboard.Focus(QueryBox);
        QueryBox.CaretIndex = QueryBox.Text.Length;
        if (QueryBox.IsKeyboardFocused) CompleteShowFocusMeasurement();
    }

    private void CompleteShowFocusMeasurement()
    {
        if (!_awaitingShowFocus) return;
        _awaitingShowFocus = false;
        _diagnostics.RecordHotkeyFocusLatency(Stopwatch.GetElapsedTime(_pendingShowTimestamp).TotalMilliseconds);
    }

    private void QueryBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        _state.SetQuery(QueryBox.Text);
        QueryPlaceholder.Visibility = QueryBox.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        RenderQuery();
    }

    private void RenderQuery()
    {
        var command = SearchCommand.Parse(QueryBox.Text);
        _fileSearchProjection.SetQuery(QueryBox.Text);
        _everything.InvalidateCurrentResults();
        var generation = _fileGeneration.Next();
        var iconGeneration = ++_resultGeneration;
        _resourceFileSearchTask = Task.CompletedTask;
        _resourceVisibleIconTask = Task.CompletedTask;
        if (command.Raw.Trim().Length == 0)
        {
            Present([]);
            UpdateLayoutForResults();
            return;
        }
        if (command.Mode == SearchMode.Web)
        {
            Present([]);
            SetStatus(command.Query.Length > 0 ? $"使用默认搜索引擎搜索“{command.Query}”，按 Enter 打开。" : "输入关键词后按 Enter 搜索网页。");
        }
        else if (command.Mode == SearchMode.Files)
        {
            _fileSearchProjection.SetResults([]);
            if (!_snapshot.EverythingEnabled) PresentFileResults("请先在 WebTools 设置中启用 Everything 文件搜索。");
            else if (command.Query.Length == 0) PresentFileResults("输入关键词搜索文件和文件夹。");
            else
            {
                PresentFileResults("正在搜索 Everything…");
                _resourceFileSearchTask = SearchFilesAsync(command.Query, generation.Sequence, generation.Token, iconGeneration);
            }
        }
        else
        {
            var clock = Stopwatch.StartNew();
            var results = _search.Search(command);
            Present(results);
            _diagnostics.Record("search_latency", $"mode={command.Mode};count={results.Count};ms={clock.Elapsed.TotalMilliseconds:F3}");
            if (results.Count == 0)
                SetStatus(_catalogLoading && command.Mode == SearchMode.Local ? "正在加载应用目录…" : command.Mode == SearchMode.SavedWebsites && command.Query.Length == 0
                    ? "输入网址名称或网址片段，搜索已保存的网址。" : "没有找到匹配的应用或网址。");
            else LoadVisibleIcons(iconGeneration);
        }
        UpdateLayoutForResults();
    }

    private async Task SearchFilesAsync(string query, long sequence, CancellationToken token, int iconGeneration)
    {
        try
        {
            await Task.Delay(160, token);
            var results = await _everything.SearchAsync(query, token);
            if (!_fileGeneration.IsCurrent(sequence) || SearchCommand.Parse(QueryBox.Text) is not { Mode: SearchMode.Files } current || current.Query != query) return;
            _fileSearchProjection.SetResults(results);
            PresentFileResults();
            if (_fileSearchProjection.VisibleResults.Count > 0) LoadVisibleIcons(iconGeneration);
            UpdateLayoutForResults();
        }
        catch (OperationCanceledException) { /* newer query owns the UI */ }
        catch (Exception error)
        {
            if (_fileGeneration.IsCurrent(sequence))
            {
                _fileSearchProjection.SetResults([]);
                PresentFileResults("文件搜索失败，请检查 Everything 配置后重试。");
                SetFileFeedback(BoundFileFeedback(error.Message));
            }
        }
    }

    private void Present(IReadOnlyList<SearchResult> results)
    {
        FileSearchPanel.Visibility = Visibility.Collapsed;
        FileResultsList.Visibility = Visibility.Collapsed;
        _selection.Clear(FileResultsList);
        _rows = results.Select(result => new ResultRow(result)).ToList();
        _selection.Present(ResultsList, results, _rows);
        ResultsList.Visibility = _rows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Visibility = Visibility.Collapsed;
    }

    private void PresentFileResults(string? emptyMessage = null, bool preserveSelection = false)
    {
        var preferredResultId = preserveSelection ? _state.GetSelectedResult()?.Id : null;
        FileSearchPanel.Visibility = Visibility.Visible;
        ResultsList.Visibility = Visibility.Collapsed;
        StatusText.Visibility = Visibility.Collapsed;
        _selection.Clear(ResultsList);
        var results = _fileSearchProjection.VisibleResults;
        _rows = results.Select(result => new ResultRow(result)).ToList();
        _selection.Present(FileResultsList, results, _rows, preferredResultId);
        FileResultsList.Visibility = _rows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        FileEmptyText.Text = _rows.Count > 0 ? string.Empty : emptyMessage ??
            (_fileSearchProjection.Results.Count == 0 ? "没有找到匹配的文件或文件夹。" : "此类型没有匹配的项目。");
        FileEmptyText.Visibility = _rows.Count > 0 ? Visibility.Collapsed : Visibility.Visible;
        FileStatusText.Visibility = Visibility.Collapsed;
        FileStatusText.Text = string.Empty;
    }

    private void SetStatus(string message)
    {
        if (_fileSearchProjection.IsActive)
        {
            SetFileFeedback(BoundFileFeedback(message));
            return;
        }
        StatusText.Text = message;
        StatusText.Visibility = Visibility.Visible;
        ResultsList.Visibility = Visibility.Collapsed;
        UpdateLayoutForResults();
    }

    private void SetFileFeedback(string message)
    {
        FileStatusText.Text = BoundFileFeedback(message);
        FileStatusText.Visibility = Visibility.Visible;
    }

    private static string BoundFileFeedback(string message) => message.Length <= 180 ? message : message[..180] + "…";

    private static string GetFileCategoryLabel(FileCategory category) => category switch
    {
        FileCategory.All => "全部",
        FileCategory.Folder => "文件夹",
        FileCategory.Application => "应用程序",
        FileCategory.Document => "文档",
        FileCategory.Image => "图片",
        FileCategory.Video => "视频",
        FileCategory.Audio => "音频",
        FileCategory.Archive => "压缩文件",
        FileCategory.Other => "其他",
        _ => "其他",
    };

    private void FileCategoriesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_updatingFileCategories || FileCategoriesList.SelectedItem is not FileCategoryRow row) return;
        ApplyFileCategory(row.Category, synchronizeList: false);
    }

    private void ApplyFileCategory(FileCategory category, bool synchronizeList)
    {
        if (!_fileSearchProjection.SelectCategory(category)) return;
        if (synchronizeList)
        {
            _updatingFileCategories = true;
            try { FileCategoriesList.SelectedIndex = _fileSearchProjection.SelectedCategoryIndex; }
            finally { _updatingFileCategories = false; }
        }
        var iconGeneration = ++_resultGeneration;
        PresentFileResults(preserveSelection: true);
        if (_fileSearchProjection.VisibleResults.Count > 0) LoadVisibleIcons(iconGeneration);
    }

    private void LoadVisibleIcons(int generation)
    {
        if (_resourceTestMode)
        {
            _resourceVisibleIconTask = LoadVisibleIconsAsync(generation);
            return;
        }
        LoadVisibleIconsForNormalUi(generation);
    }

    private async void LoadVisibleIconsForNormalUi(int generation) => await LoadVisibleIconsAsync(generation);

    private async Task LoadVisibleIconsAsync(int generation)
    {
        var websiteRows = _rows.Where(row => row.Result.Kind == ResultKind.Website).ToArray();
        if (websiteRows.Length > 0)
        {
            var websiteIcons = WebsiteFaviconReader.Read(_stateStore.WebsiteDataPath, websiteRows.Select(row => row.Result.Id).ToArray());
            if (generation != _resultGeneration) return;
            foreach (var row in websiteRows)
                if (websiteIcons.TryGetValue(row.Result.Id, out var image)) row.Icon = image;
        }
        foreach (var row in _rows.Where(row => row.Result.IconReference is not null))
        {
            var icon = await _icons.GetAsync(row.Result.IconReference);
            if (generation != _resultGeneration || !_rows.Contains(row)) return;
            row.Icon = icon;
        }
    }

    private void UpdateLayoutForResults()
    {
        var hasQuery = QueryBox.Text.Trim().Length > 0;
        FooterHints.Visibility = hasQuery ? Visibility.Visible : Visibility.Collapsed;
        ShortcutPanel.Visibility = !hasQuery && _expanded ? Visibility.Visible : Visibility.Collapsed;
        var viewport = ShortcutViewportBudget.Calculate(_snapshot.Websites.Count, _websitesExpanded, _plugins.Count, _pluginsExpanded, MaxHeight - (ExpandedHeight - 120));
        WebsiteScroll.Height = viewport.Websites;
        PluginScroll.Height = viewport.Plugins;
        if (!hasQuery) Height = _expanded ? ExpandedHeight - 120 + viewport.Websites + viewport.Plugins : CompactHeight;
        else Height = SearchResultsHeight;
    }

    private void RefreshShortcuts()
    {
        RefreshPluginShortcuts();
        WebsiteShortcuts.Children.Clear();
        WebsiteSectionToggle.IsEnabled = _snapshot.Websites.Count > 6;
        if (!WebsiteSectionToggle.IsEnabled) _websitesExpanded = false;
        WebsiteSectionToggle.Content = _websitesExpanded ? "收起 ↑" : "展开 ↓";
        WebsiteScroll.Height = _websitesExpanded ? Math.Min(4, Math.Max(1, (_snapshot.Websites.Count + 5) / 6)) * 60 : 60;
        WebsiteScroll.VerticalScrollBarVisibility = _websitesExpanded
            ? ScrollBarVisibility.Auto : ScrollBarVisibility.Hidden;
        var icons = WebsiteFaviconReader.Read(_stateStore.WebsiteDataPath, _snapshot.Websites.Select(site => site.Id).ToArray());
        foreach (var site in _snapshot.Websites)
        {
            var fallback = new TextBlock
            {
                Text = FallbackInitial(site.Url ?? site.Name), FontSize = 11, FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("AccentBrush"), HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var iconContent = new Grid();
            if (icons.TryGetValue(site.Id, out var favicon))
            {
                var websiteImage = new Image { Source = favicon, Width = 28, Height = 28, Stretch = Stretch.Uniform };
                var roundedClip = new RectangleGeometry(new Rect(0, 0, 28, 28), 7, 7);
                roundedClip.Freeze();
                websiteImage.Clip = roundedClip;
                iconContent.Children.Add(websiteImage);
            }
            else iconContent.Children.Add(fallback);
            var content = new StackPanel { Width = 109, Orientation = Orientation.Horizontal, HorizontalAlignment = System.Windows.HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center };
            content.Children.Add(new Border
            {
                Width = 30, Height = 30, CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1),
                BorderBrush = (Brush)FindResource("LineBrush"), Background = (Brush)FindResource("AccentSoftBrush"),
                Child = iconContent,
            });
            content.Children.Add(new TextBlock
            {
                Text = site.Name, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush"), FontSize = 11, Margin = new Thickness(9, 0, 0, 0),
                Width = 69,
            });
            var button = new System.Windows.Controls.Button
            {
                Content = content,
                Tag = site, Style = (Style)FindResource("LauncherShortcutButtonStyle"),
                Margin = new Thickness(0, 0, 6, 6), Width = 127, Height = 54,
                ToolTip = site.Url,
            };
            button.Click += (_, _) => ActivateWebsiteShortcut(site);
            WebsiteShortcuts.Children.Add(button);
        }
        if (_snapshot.Websites.Count == 0)
            WebsiteShortcuts.Children.Add(new TextBlock { Text = "收藏的网址会显示在这里", Foreground = (Brush)FindResource("QuietBrush"), FontSize = 10 });
    }

    private static string FallbackInitial(string address)
    {
        var host = Uri.TryCreate(address, UriKind.Absolute, out var uri) ? uri.Host.Replace("www.", "", StringComparison.OrdinalIgnoreCase) : address;
        return host.EnumerateRunes().FirstOrDefault(rune => Rune.IsLetterOrDigit(rune)).ToString().ToUpperInvariant() is { Length: > 0 } initial ? initial : "?";
    }

    private void WebsiteSectionToggle_Click(object sender, RoutedEventArgs e)
    {
        if (_snapshot.Websites.Count <= 6) return;
        _websitesExpanded = !_websitesExpanded;
        RefreshShortcuts();
        WebsiteScroll.ScrollToTop();
        UpdateLayoutForResults();
    }

    private void ActivateWebsiteShortcut(SearchEntry site)
    {
        try
        {
            _actions.OpenWebsite(site.Url ?? "");
            HideLauncher("website-shortcut");
        }
        catch (Exception error) { SetStatus(error.Message); }
    }

    private void ExpandButton_Click(object sender, RoutedEventArgs e)
    {
        _expanded = !_expanded;
        _websitesExpanded = false;
        ExpandButton.Content = _expanded ? "收起 ↑" : "展开 ↓";
        if (_expanded) RefreshShortcuts();
        else { WebsiteShortcuts.Children.Clear(); PluginShortcuts.Children.Clear(); }
        UpdateLayoutForResults();
        QueryBox.Focus();
    }

    private void RefreshPluginShortcuts()
    {
        PluginShortcuts.Children.Clear();
        PluginSectionToggle.IsEnabled = _plugins.Count > 6;
        if (!PluginSectionToggle.IsEnabled) _pluginsExpanded = false;
        PluginSectionToggle.Content = _pluginsExpanded ? "收起 ↑" : "展开 ↓";
        PluginScroll.Height = _pluginsExpanded ? Math.Min(4, Math.Max(1, (_plugins.Count + 5) / 6)) * 60 : 60;
        PluginScroll.VerticalScrollBarVisibility = _pluginsExpanded ? ScrollBarVisibility.Auto : ScrollBarVisibility.Hidden;
        foreach (var item in _plugins)
        {
            var content = new StackPanel { Width = 109, Orientation = Orientation.Horizontal, HorizontalAlignment = System.Windows.HorizontalAlignment.Left };
            var glyph = new System.Windows.Shapes.Path {
                Width = 18, Height = 18, Stretch = Stretch.Uniform, StrokeThickness = 2,
                Data = Geometry.Parse(item.Icon == "translation" ? "M5,8 L11,14 M4,14 L10,8 12,5 H2 M2,5 H14 M7,2 H8 M22,22 L17,12 12,22 M14,18 H20" : "M3,3 H9 C7,0 15,0 13,3 H20 V9 C23,7 23,15 20,13 V20 H13 C15,23 7,23 9,20 H3 V13 C0,15 0,7 3,9 Z"),
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            };
            glyph.SetResourceReference(System.Windows.Shapes.Shape.StrokeProperty, "AccentBrush");
            var icon = new Border { Width = 30, Height = 30, CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1), Child = glyph };
            icon.SetResourceReference(Border.BackgroundProperty, "AccentSoftBrush"); icon.SetResourceReference(Border.BorderBrushProperty, "LineBrush");
            content.Children.Add(icon);
            var label = new TextBlock { Text = item.DisplayName, FontSize = 11, Width = 70, Margin = new Thickness(9, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
            label.SetResourceReference(TextBlock.ForegroundProperty, "TextBrush"); content.Children.Add(label);
            var button = new System.Windows.Controls.Button { Width = 127, Height = 54, Margin = new Thickness(0, 0, 6, 6), Content = content, ToolTip = item.DisplayName, Tag = item.Ref, Style = (Style)FindResource("LauncherShortcutButtonStyle") };
            System.Windows.Automation.AutomationProperties.SetName(button, item.DisplayName);
            button.Click += (_, _) => { HideLauncher("open-plugin"); _managerController.OpenPlugin(item.Ref); };
            PluginShortcuts.Children.Add(button);
        }
        if (_plugins.Count == 0) PluginShortcuts.Children.Add(new TextBlock { Text = "启用的插件会显示在这里", Foreground = (Brush)FindResource("QuietBrush"), FontSize = 10 });
    }
    private void PluginSectionToggle_Click(object sender, RoutedEventArgs e)
    { if (_plugins.Count <= 6) return; _pluginsExpanded = !_pluginsExpanded; RefreshPluginShortcuts(); PluginScroll.ScrollToTop(); UpdateLayoutForResults(); QueryBox.Focus(); }
    private void QueryBox_GotKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e) => CompleteShowFocusMeasurement();

    private void BrandButton_Click(object sender, RoutedEventArgs e) => _managerController.OpenPage(ManagerPage.Favorites);

    private void LoadBrandIcon()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "launcher-logo.png");
            if (!File.Exists(path)) return;
            var image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.DecodePixelWidth = 256;
            image.UriSource = new Uri(path, UriKind.Absolute);
            image.EndInit();
            image.Freeze();
            BrandImage.Source = image;
            BrandFallback.Visibility = Visibility.Collapsed;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or UriFormatException or NotSupportedException or InvalidOperationException)
        {
            _diagnostics.Record("launcher_brand_icon_fallback", error.GetType().Name);
        }
    }

    private void ApplyTheme(string preference)
    {
        _themePreference = preference is "light" or "dark" or "system" ? preference : "system";
        var systemTheme = PackagedIconResolver.GetCurrentSystemTheme();
        LauncherThemePalette.Apply(Resources, _themePreference, systemTheme);
        var effectiveTheme = LauncherThemePalette.ResolveEffectiveTheme(_themePreference, systemTheme);
        if (IsInitialized && _expanded) RefreshShortcuts();
        if (_effectiveTheme == effectiveTheme) return;
        _effectiveTheme = effectiveTheme;
        EffectiveThemeChanged?.Invoke(effectiveTheme);
    }

    private void SystemPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (_themePreference != "system" || Dispatcher.HasShutdownStarted) return;
        _ = Dispatcher.BeginInvoke(new Action(() =>
        {
            if (!_disposed && _themePreference == "system") ApplyTheme(_themePreference);
        }));
    }

    private void ResultsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_selection.AcceptUserSelection(ResultsList)) return;
        QueryBox.Focus();
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            if (TryGetOpenFileContextMenu(out var openMenu))
            {
                openMenu.IsOpen = false;
                e.Handled = true;
                return;
            }
            HideLauncher("escape");
            e.Handled = true;
            return;
        }
        if (TryGetOpenFileContextMenu(out _)) return;
        if (_fileSearchProjection.IsActive && (e.Key == Key.Apps || e.Key == Key.F10 && Keyboard.Modifiers == ModifierKeys.Shift)
            && _state.SelectedIndex >= 0
            && FileResultsList.ItemContainerGenerator.ContainerFromIndex(_state.SelectedIndex) is ListBoxItem { ContextMenu: { } contextMenu } item)
        {
            contextMenu.PlacementTarget = item;
            contextMenu.IsOpen = true;
            e.Handled = true;
            return;
        }
        if (_fileSearchProjection.IsActive && FileSearchPanel.Visibility == Visibility.Visible
            && FileCategoriesList.IsKeyboardFocusWithin && e.Key is Key.Down or Key.Up)
        {
            _fileSearchProjection.MoveCategorySelection(e.Key == Key.Down ? 1 : -1);
            ApplyFileCategory(_fileSearchProjection.SelectedCategory, synchronizeList: true);
            e.Handled = true;
            return;
        }
        if (e.Key is Key.Down or Key.Up && _state.Results.Count > 0)
        {
            var activeList = _fileSearchProjection.IsActive ? FileResultsList : ResultsList;
            SetSelectedIndex(_selection.MoveSelection(activeList, e.Key == Key.Down ? 1 : -1));
            e.Handled = true;
            return;
        }
        if (e.Key == Key.Enter)
        {
            if (_fileSearchProjection.IsActive && FileCategoriesList.IsKeyboardFocusWithin)
            {
                if (_state.Results.Count > 0) FileResultsList.Focus();
                e.Handled = true;
                return;
            }
            var command = SearchCommand.Parse(QueryBox.Text);
            if (command.Mode == SearchMode.Web && command.Query.Length > 0) OpenWebSearch(command.Query);
            else if (_state.GetSelectedResult() is { } result) ActivateResult(result);
            e.Handled = true;
        }
    }

    private bool TryGetOpenFileContextMenu(out System.Windows.Controls.ContextMenu contextMenu)
    {
        if (_fileSearchProjection.IsActive && _state.SelectedIndex >= 0
            && FileResultsList.ItemContainerGenerator.ContainerFromIndex(_state.SelectedIndex) is ListBoxItem { ContextMenu.IsOpen: true } item
            && item.ContextMenu is { } open)
        {
            contextMenu = open;
            return true;
        }
        contextMenu = null!;
        return false;
    }

    private void OpenWebSearch(string query)
    {
        try
        {
            _actions.SearchWeb(_snapshot, query);
            HideLauncher("web-search");
        }
        catch (Exception error) { SetStatus(error.Message); }
    }

    private void SetSelectedIndex(int index)
    {
        var activeList = _fileSearchProjection.IsActive ? FileResultsList : ResultsList;
        _selection.Select(activeList, index);
        if (index >= 0 && activeList.ItemContainerGenerator.ContainerFromIndex(index) is FrameworkElement item) item.BringIntoView();
    }

    private void ActivateResult(SearchResult result)
    {
        if (result.Action is SearchFilesAction fileSearch)
        {
            QueryBox.Text = FileSearchProjection.BuildSearchCommand(fileSearch);
            QueryBox.Focus();
            QueryBox.CaretIndex = QueryBox.Text.Length;
            return;
        }
        if (result.Action is OpenTranslationAction translation)
        {
            HideLauncher("translation-handoff");
            _managerController.OpenTranslation(translation.Text);
            return;
        }
        if (result.Action is OpenFileAction file && result.Kind is (ResultKind.File or ResultKind.Folder))
        {
            var operation = new FileResultOperations(_everything.ResolvePath, new WindowsFileResultOperationPlatform())
                .Execute(file.Token, result.Kind, FileResultOperation.Open);
            if (operation.Succeeded) HideLauncher("file-open");
            else SetFileFeedback(operation.Message);
            return;
        }
        try
        {
            _actions.Execute(result);
            if (result.Kind == ResultKind.Application && SearchCommand.Parse(QueryBox.Text).Mode == SearchMode.Local)
            {
                _search.RememberApplication(SearchCommand.Parse(QueryBox.Text).Query, result.Id);
                _ = SaveRememberedApplicationAsync(SearchCommand.Parse(QueryBox.Text).Query, result.Id);
            }
            HideLauncher("search-result");
        }
        catch (Exception error) { SetStatus(error.Message); }
    }

    private async Task SaveRememberedApplicationAsync(string query, string appId)
    {
        try { await _stateStore.RememberApplicationAsync(query, appId); }
        catch (Exception error) { _diagnostics.Record("app_search_memory_save_error", error.GetType().Name); }
    }

    public void OpenManagerPage(ManagerPage page) => _managerController.OpenPage(page);

    public void ShowManagerError(string message)
    {
        if (Dispatcher.CheckAccess()) SetStatus(message);
        else Dispatcher.BeginInvoke(new Action(() => SetStatus(message)));
    }

    private void ResultsList_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        for (DependencyObject? current = e.OriginalSource as DependencyObject; current is not null; current = VisualTreeHelper.GetParent(current))
        {
            if (current is ListBoxItem { DataContext: ResultRow row })
            {
                ActivateResult(row.Result);
                e.Handled = true;
                return;
            }
            if (current == ResultsList) return;
        }
    }

    private void FileResultsList_SelectionChanged(object sender, SelectionChangedEventArgs e) => _selection.AcceptUserSelection(FileResultsList);

    private void FileResultsList_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        for (DependencyObject? current = e.OriginalSource as DependencyObject; current is not null; current = VisualTreeHelper.GetParent(current))
        {
            if (current is ListBoxItem { DataContext: ResultRow row })
            {
                ActivateResult(row.Result);
                e.Handled = true;
                return;
            }
            if (current == FileResultsList) return;
        }
    }

    private void FileContextMenu_Opened(object sender, RoutedEventArgs e)
    {
        if (sender is not System.Windows.Controls.ContextMenu menu || menu.PlacementTarget is not ListBoxItem { DataContext: ResultRow row }) return;
        FileResultsList.SelectedItem = row;
        _selection.AcceptUserSelection(FileResultsList);
        menu.Tag = row;
        foreach (var item in menu.Items.OfType<System.Windows.Controls.MenuItem>())
            if (item.Tag as string == nameof(FileResultOperation.CopyObject))
                item.Header = row.Result.Kind == ResultKind.Folder ? "复制文件夹" : "复制文件";
    }

    private void FileContextMenu_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape || sender is not System.Windows.Controls.ContextMenu menu) return;
        menu.IsOpen = false;
        e.Handled = true;
    }

    private void FileContextMenuItem_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not System.Windows.Controls.MenuItem { Tag: string operationName, Parent: System.Windows.Controls.ContextMenu menu } menuItem
            || menu.Tag is not ResultRow row
            || !FileResultOperations.TryParseContextMenuOperation(operationName, out var operation)) return;

        var token = row.Result.Action is OpenFileAction action ? action.Token : string.Empty;
        var result = new FileResultOperations(_everything.ResolvePath, new WindowsFileResultOperationPlatform())
            .Execute(token, row.Result.Kind, operation);
        if (operation == FileResultOperation.Open && result.Succeeded) HideLauncher("file-context-open");
        else SetFileFeedback(result.Message);
        menuItem.IsEnabled = true;
    }

    private void Window_Activated(object? sender, EventArgs e) => FocusQueryBox();
    private void Window_Deactivated(object? sender, EventArgs e)
    {
        if (IsVisible && !_isDraggingSearchBar) HideLauncher("blur");
    }

    private void DragSurface_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        BeginLauncherDrag(DragSurface, e);
    }

    private void SearchBar_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        BeginLauncherDrag(SearchBar, e);
    }

    private void BeginLauncherDrag(UIElement dragSurface, MouseButtonEventArgs e)
    {
        _searchBarDragGesture.End();
        _activeDragSurface = null;
        _dragStartScreen = CursorScreenPosition();
        if (!_searchBarDragGesture.BeginFrom(
                _dragStartScreen,
                e.OriginalSource as DependencyObject,
                dragSurface,
                QueryBox,
                e.GetPosition(QueryBox))) return;
        _dragStartLeft = Left;
        _dragStartTop = Top;
        _activeDragSurface = dragSurface;
        if (!Mouse.Capture(dragSurface, CaptureMode.SubTree))
        {
            _searchBarDragGesture.End();
            _activeDragSurface = null;
        }
    }

    private void LauncherDragSurface_PreviewMouseMove(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (!ReferenceEquals(sender, _activeDragSurface)) return;
        if (e.LeftButton != MouseButtonState.Pressed)
        {
            _searchBarDragGesture.End();
            if (Mouse.Captured == _activeDragSurface) Mouse.Capture(null);
            _activeDragSurface = null;
            return;
        }
        var cursor = CursorScreenPosition();
        if (!_isDraggingSearchBar && !_searchBarDragGesture.TryBeginDrag(
                cursor, true, SystemParameters.MinimumHorizontalDragDistance, SystemParameters.MinimumVerticalDragDistance)) return;
        if (!_isDraggingSearchBar)
        {
            _isDraggingSearchBar = true;
        }
        var delta = cursor - _dragStartScreen;
        var transform = PresentationSource.FromVisual(this)?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        var dipDelta = transform.Transform(delta);
        Left = _dragStartLeft + dipDelta.X;
        Top = _dragStartTop + dipDelta.Y;
        e.Handled = true;
    }

    private void LauncherDragSurface_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (!ReferenceEquals(sender, _activeDragSurface)) return;
        _searchBarDragGesture.End();
        if (Mouse.Captured == _activeDragSurface) Mouse.Capture(null);
        _activeDragSurface = null;
        if (!_isDraggingSearchBar) return;
        _isDraggingSearchBar = false;
        e.Handled = true;
        RestoreQueryBoxFocusAfterDrag();
    }

    private void RestoreQueryBoxFocusAfterDrag()
    {
        if (!IsVisible) return;
        if (!IsActive) Activate();
        QueryBox.Focus();
        Keyboard.Focus(QueryBox);
    }

    private static System.Windows.Point CursorScreenPosition()
    {
        GetCursorPos(out var point);
        return new System.Windows.Point(point.X, point.Y);
    }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out NativePoint point);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    private sealed class ResultRow(SearchResult result) : INotifyPropertyChanged
    {
        private BitmapSource? _icon;
        public SearchResult Result { get; } = result;
        public string Title => Result.Title;
        public string Subtitle => Result.Subtitle;
        public string IconGlyph => Result.Kind switch
        {
            ResultKind.Website => FallbackInitial(Result.Subtitle),
            ResultKind.File => "▤",
            ResultKind.Folder => "▰",
            ResultKind.Translation => "文",
            _ => "⌘",
        };
        public string MatchLabel => Result.Match switch
        {
            MatchKind.Pinyin => "拼音",
            MatchKind.Alias => "别名",
            MatchKind.Initials => "首字母",
            _ => "",
        };
        public BitmapSource? Icon { get => _icon; set { _icon = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Icon))); } }
        public event PropertyChangedEventHandler? PropertyChanged;
    }

    private sealed record FileCategoryRow(FileCategory Category, string Label);
}
