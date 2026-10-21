using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using WebTools.NativeHost.Data;
using WebTools.NativeHost.Services;
using Button = System.Windows.Controls.Button;
using ContextMenu = System.Windows.Controls.ContextMenu;
using ListBox = System.Windows.Controls.ListBox;
using Size = System.Windows.Size;

namespace WebTools.NativeHost.SuperPanel;

public partial class SuperPanelWindow : Window, IDisposable
{
    private const int BoardDimension = 3;
    private const int PageSize = BoardDimension * BoardDimension;
    private const double PreferredTileSide = 72, TileMargin = 2, PanelChromeWidth = 26, BoardFooterHeight = 36;
    private readonly SuperPanelStateStore _store;
    private readonly ManagerController _manager;
    private string? _launcherSessionId;
    public Action<string, string, string>? ShowWindowHandoff { get; set; }
    private void ScheduleLauncherSession()
    {
        if (_launcherSessionId is not null) return;
        var generation = _visibleGeneration;
        EventHandler? painted = null;
        painted = (_, _) => {
            CompositionTarget.Rendering -= painted;
            Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() => {
                if (_disposed || !IsVisible || Opacity == 0 || generation != _visibleGeneration || _openingWindow is not null) return;
                var id = _launcherSessionId ??= Guid.NewGuid().ToString("N");
                WindowStartupTrace.Record("wpf-first-frame-input-ready", entry: "super-panel", sessionId: id);
                _manager.BeginLauncherSession(id);
            }));
        };
        CompositionTarget.Rendering += painted;
    }
    private readonly SuperPanelIconLoader _iconLoader;
    private readonly Func<WebsiteSnapshot>? _readWebsiteSnapshot;
    private readonly Action<ProcessStartInfo> _startProcess;
    private readonly Func<NativeFeatureRef, NativeLauncherTextContext?, bool, string?, string?> _invokeSuperPanelFeature;
    private readonly Action<string, string> _openTranslation;
    private (string RequestId, string PluginId, string Startup)? _openingWindow;
    private string BeginWindowHandoff(string title, string pluginId)
    {
        var id = Guid.NewGuid().ToString("D");
        var startup = _manager.HasLiveElectronHost ? "warm" : "cold";
        _openingWindow = (id, pluginId, startup);
        WindowStartupTrace.Record("user-target-selected", id, "super-panel", pluginId, startup, _launcherSessionId);
        WindowStartupTrace.Record("confirm-input", id, "super-panel", pluginId, startup);
        EventHandler? rendered = null;
        rendered = (_, _) => {
            CompositionTarget.Rendering -= rendered;
            if (_openingWindow?.RequestId == id && IsVisible) WindowStartupTrace.Record("wpf-handoff-render", id, "super-panel", pluginId, startup);
        };
        CompositionTarget.Rendering += rendered;
        return id;
    }
    internal bool CompleteWindowHandoff(string requestId, IntPtr target, int processId)
    {
        if (_openingWindow is not { } opening || opening.RequestId != requestId) return false;
        if (!NativeWindowHandoff.ShowAndHide(this, target, processId)) throw new InvalidOperationException("Plugin window handoff failed.");
        WindowStartupTrace.Record("shell-window-shown", requestId, "super-panel", opening.PluginId, opening.Startup);
        Dismiss();
        WindowStartupTrace.Record("wpf-surface-hidden", requestId, "super-panel", opening.PluginId, opening.Startup);
        NativeWindowHandoff.Focus(target);
        return true;
    }
    private readonly Func<string, NativeLauncherTextContext, string?> _beginTranslationPreview;
    private readonly Func<Func<bool>> _capturePreviewFocus;
    private Func<bool>? _previewFocusCurrent;
    private string? _translationPreviewRequestId;
    private bool _translationPreviewShowingResult;
    private readonly Dictionary<FrameworkElement, IconSubscription> _iconSubscriptions = [];
    private NativeFeatureProjectionV2? _projection;
    private NativeFeatureProjectionV2? _developmentProjection;
    private readonly SuperPanelQuickResultState _quickResult = new();
    private string _quickResultSource = "";
    private SelectionContext _context = SelectionContext.None();
    private FeatureRow? _selected;
    private IReadOnlyList<FeatureRow> _pinned = [], _recommended = [];
    private MonitorPlacement.FloatingPanelAnchor? _anchor;
    private bool _changingSelection, _placing, _menuOpen, _disposed, _dismissing, _preparingPresentation, _compactInitial, _pointerPressActive;
    internal event Action? Dismissed;
    internal event Action? InteractionStarted;
    private string? _requestId;
    private int _presentation;
    private long _visibleGeneration;
    private DispatcherOperation? _revealOperation;
    private int _page;
    private bool _choosing, _dragging;
    private System.Windows.Point _dragStart;
    private FeatureRow? _dragRow;
    private IReadOnlyList<FeatureRow> _board = [];
    private HwndSource? _source;
    private readonly HashSet<HwndSource> _menuSources = [];
    private ContextMenu? _openMenu;
    public Func<SuperPanelSettingsStatus>? ReadTriggerSettings { get; set; }
    public Action? ShowLauncher { get; set; }

    internal SuperPanelWindow(SuperPanelStateStore store, ManagerController manager, Func<string?, Task<BitmapSource?>> getIcon,
        NativeFeatureProjectionV2? projection, Func<WebsiteSnapshot>? readWebsiteSnapshot = null,
        Action<ProcessStartInfo>? startProcess = null,
        Func<string, NativeLauncherTextContext, string?>? beginTranslationPreview = null,
        Func<Func<bool>>? capturePreviewFocus = null,
        Func<NativeFeatureRef, NativeLauncherTextContext?, bool, string?>? invokeSuperPanelFeature = null,
        Action<string>? openTranslation = null)
    {
        _store = store; _manager = manager; _iconLoader = new(getIcon); _projection = projection;
        _readWebsiteSnapshot = readWebsiteSnapshot;
        _startProcess = startProcess ?? (start => _ = Process.Start(start));
        _invokeSuperPanelFeature = (reference, context, quickResult, id) => invokeSuperPanelFeature is not null
            ? invokeSuperPanelFeature(reference, context, quickResult) : _manager.InvokeSuperPanelFeature(reference, context, quickResult, id);
        _openTranslation = (text, id) => { if (openTranslation is not null) openTranslation(text); else _manager.OpenTranslation(text, id, "super-panel"); };
        _beginTranslationPreview = beginTranslationPreview ?? ((id, context) => _manager.InvokeSuperPanelFeature(SuperPanelTranslationPreview.Reference, context, true, id));
        _capturePreviewFocus = capturePreviewFocus ?? CaptureInvocation.SnapshotFocusValidator;
        InitializeComponent();
        SourceInitialized += (_, _) =>
        {
            _source = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);
            if (_source is not null) ConfigureNonActivatingSource(_source);
        };
        _manager.FeatureInvocationFeedback += InvocationFeedback;
        _developmentProjection = _manager.DevelopmentProjection;
        _manager.FeatureQuickResult += ReceiveQuickResult;
        _manager.FeatureQuickResultClear += ReceiveQuickResultClear;
        _manager.FeatureQuickResultConfirmation += ReceiveQuickResultConfirmation;
        _manager.AcceptedQuickResultRequested += ReadAcceptedQuickResult;
        _manager.QuickResultTransportDisconnected += QuickResultDisconnected;
        _manager.DevelopmentProjectionChanged += DevelopmentProjectionChanged;
        PreviewMouseDown += (_, _) => { _pointerPressActive = true; InteractionStarted?.Invoke(); };
        AddHandler(Mouse.MouseUpEvent, new MouseButtonEventHandler((_, _) =>
        {
            _pointerPressActive = false;
            CancelAutomaticTranslationForInput();
        }), true);
        PreviewMouseWheel += (_, _) => InteractionStarted?.Invoke();
        AddHandler(Mouse.MouseWheelEvent, new MouseWheelEventHandler((_, _) => CancelAutomaticTranslationForInput()), true);
        Closing += (_, args) => { if (!_disposed) { args.Cancel = true; Dismiss(); } };
    }
    public void ApplyProjection(NativeFeatureProjectionV2 projection) { _projection = projection; if (IsVisible && !_compactInitial) RefreshFeatures(); }
    private void DevelopmentProjectionChanged(NativeFeatureProjectionV2? projection)
    {
        if (_disposed || Dispatcher.HasShutdownStarted) return;
        Dispatcher.BeginInvoke(new Action(() => { if (_disposed) return; _developmentProjection = projection; if (IsVisible && !_compactInitial) RefreshFeatures(); }));
    }
    private bool ReceiveQuickResult(NativeFeatureTextResult result)
    {
        if (result.RequestId == _translationPreviewRequestId && _previewFocusCurrent?.Invoke() != true)
        {
            if (!_disposed && !Dispatcher.HasShutdownStarted) Dispatcher.BeginInvoke(new Action(CancelAutomaticTranslationForInput));
            return false;
        }
        if (_disposed || Dispatcher.HasShutdownStarted || !_quickResult.TryAccept(result)) return false;
        Dispatcher.BeginInvoke(new Action(() =>
        {
            if (_disposed || !IsVisible || !ReferenceEquals(_quickResult.Result, result) || _quickResult.Generation != _visibleGeneration) return;
            // A late preview can resize/reposition this non-activating window between
            // mouse-down and mouse-up, moving the action under the pointer. Keep the
            // pending visual stable; the mouse-up route either activates or cancels it.
            if (result.RequestId == _translationPreviewRequestId && _pointerPressActive) return;
            if (result.RequestId == _translationPreviewRequestId)
            {
                if (!_store.Snapshot.AutoTranslationPreview || _previewFocusCurrent?.Invoke() != true) { CancelAutomaticTranslationForInput(); return; }
                _translationPreviewShowingResult = true;
                TranslationPreviewCancel.Visibility = Visibility.Collapsed;
            }
            QuickResultSource.Text = _quickResultSource; QuickResultBody.Text = result.Text;
            QuickResultConsentSurface.Visibility = Visibility.Collapsed;
            QuickResultConsentSource.Text = QuickResultConsentPreview.Text = "";
            QuickResultSurface.Visibility = Visibility.Visible; SetStatus("");
        }));
        return true;
    }
    private NativeFeatureResultControl? ReadAcceptedQuickResult() => _quickResult.AcceptedBinding;
    private void ReceiveQuickResultClear(NativeFeatureResultControl clear)
    {
        if (!_quickResult.TryClear(clear.RequestId, clear.Ref) || _disposed || Dispatcher.HasShutdownStarted) return;
        Dispatcher.BeginInvoke(new Action(() => { if (_quickResult.Result is null) ClearQuickResultVisual(); }));
    }
    private void QuickResultDisconnected()
    {
        var pending = _quickResult.Binding is not null && _quickResult.Result is null;
        _quickResult.OnTransportDisconnected();
        if (!pending || _disposed || Dispatcher.HasShutdownStarted) return;
        Dispatcher.BeginInvoke(new Action(() => { if (_quickResult.Binding is null) { _requestId = null; ClearQuickResultVisual(); if (IsVisible) SetStatus("功能执行未完成。"); } }));
    }
    private void ClearQuickResultVisual()
    {
        TranslationPreviewCancel.Visibility = Visibility.Collapsed;
        QuickResultBody.Text = QuickResultSource.Text = QuickResultConsentSource.Text = QuickResultConsentPreview.Text = "";
        QuickResultSurface.Visibility = QuickResultConsentSurface.Visibility = Visibility.Collapsed; UpdatePanelLayout();
    }
    private bool ReceiveQuickResultConfirmation(NativeFeatureAIConfirmation confirmation)
    {
        if (_disposed || Dispatcher.HasShutdownStarted || !_quickResult.TryConfirm(confirmation)) return false;
        Dispatcher.BeginInvoke(new Action(() =>
        {
            if (_disposed || !IsVisible || !ReferenceEquals(_quickResult.Confirmation, confirmation) || _quickResult.Generation != _visibleGeneration) return;
            QuickResultConsentSource.Text = confirmation.PluginName + " · " + confirmation.ProviderName;
            QuickResultConsentPreview.Text = confirmation.Preview; QuickResultConsentSurface.Visibility = Visibility.Visible; SetStatus("");
        }));
        return true;
    }
    private void QuickResultConsentApprove_Click(object sender, RoutedEventArgs e) => SendQuickResultDecision(true);
    private void QuickResultConsentCancel_Click(object sender, RoutedEventArgs e) => SendQuickResultDecision(false);
    private void SendQuickResultDecision(bool approved)
    {
        var confirmation = _quickResult.TakeConfirmation();
        QuickResultConsentSurface.Visibility = Visibility.Collapsed;
        QuickResultConsentSource.Text = QuickResultConsentPreview.Text = "";
        if (confirmation is null) return;
        SetStatus(approved ? "正在执行…" : "已取消发送。");
        _ = _manager.SendQuickResultControlAsync("feature-ai-decision-v1", new { requestId = confirmation.RequestId, @ref = confirmation.Ref, consentId = confirmation.ConsentId, approved });
    }
    private void CancelQuickResult()
    {
        var binding = _quickResult.Binding;
        _quickResult.Dismiss(); _quickResultSource = "";
        _translationPreviewRequestId = null; _translationPreviewShowingResult = false; _previewFocusCurrent = null; _requestId = null;
        if (binding is not null) _manager.CancelSuperPanelFeature(binding);
        ClearQuickResultVisual();
    }
    internal void Present(SelectionContext context, SelectionDiagnosticAttempt? attempt, MonitorPlacement.FloatingPanelAnchor? anchor = null)
    {
        _openingWindow = null;
        attempt?.Record("PRESENTATION_REQUESTED", "STARTED");
        PreparePresentation();
        _compactInitial = false;
        ResetIconSubscriptions();
        ++_visibleGeneration; _choosing = false;
        _context = context; _requestId = null; ++_presentation;
        _anchor = anchor ?? MonitorPlacement.CaptureFloatingPanelAnchor();
        MaxHeight = _anchor.MaxHeight; MinHeight = Math.Min(140, MaxHeight);
        PanelHeader.Visibility = Visibility.Visible;
        int matchedFeatureCount;
        _preparingPresentation = true;
        try
        {
            ApplyGeometry(context.Mode);
            PresentContext(context);
            SetStatus(context.CaptureNotice ?? ""); RefreshTriggerStatus();
            matchedFeatureCount = RefreshFeatures();
        }
        finally { _preparingPresentation = false; }
        UpdatePanelLayout();
        ShowPreparedPresentation();
        attempt?.Record("WINDOW_VISIBLE", IsVisible ? "VISIBLE" : "HIDDEN", ("renderProxy", "visible-after-layout-not-compositor"));
        var visualRoot = VisualRootName(context.Mode);
        attempt?.SetPresentationState(context.Mode.ToString(), visualRoot, matchedFeatureCount);
        attempt?.Record("PRESENTATION_SELECTED", "SHOWN", timestamp: System.Diagnostics.Stopwatch.GetTimestamp(),
            ("mode", context.Mode.ToString()), ("visualRoot", visualRoot), ("matchedFeatureCount", matchedFeatureCount.ToString()));
        StartTranslationPreview();
    }

    private void StartTranslationPreview()
    {
        if (!_store.Snapshot.Enabled || !_store.Snapshot.AutoTranslationPreview || _context.TextTruncated || _context.Mode != SurfaceContextMode.SelectedText
            || _context.Payload is not { Type: "text", Source: "selected-text" } context
            || !SuperPanelTranslationPreview.IsCandidate(context.Text)) return;
        var id = Guid.NewGuid().ToString("D");
        _previewFocusCurrent = _capturePreviewFocus();
        _translationPreviewRequestId = _requestId = id;
        _translationPreviewShowingResult = false;
        _quickResultSource = "翻译预览";
        // Bind before queuing: a warm Host may reply immediately on the Pipe reader.
        _quickResult.Begin(id, SuperPanelTranslationPreview.Reference, _visibleGeneration);
        QuickResultSource.Text = _quickResultSource; QuickResultBody.Text = "正在翻译…";
        QuickResultSurface.Visibility = TranslationPreviewCancel.Visibility = Visibility.Visible;
        UpdatePanelLayout();
        try
        {
            if (_beginTranslationPreview(id, context) == id) return;
        }
        catch { /* Keep failures local to this non-activating panel; no text/exception logging. */ }
        CancelQuickResult(); SetStatus("翻译预览暂不可用，请重新唤出或打开翻译页面。");
    }

    internal void CancelAutomaticTranslationForInput()
    {
        if (_translationPreviewRequestId is null || _translationPreviewShowingResult) return;
        CancelQuickResult(); SetStatus("自动翻译预览已取消。");
    }
    private void TranslationPreviewCancel_Click(object sender, RoutedEventArgs e) => CancelAutomaticTranslationForInput();

    internal void PresentInitialCompact(SelectionDiagnosticAttempt? attempt, MonitorPlacement.FloatingPanelAnchor? anchor)
    {
        attempt?.Record("PANEL_INITIAL_COMPACT", "STARTED");
        PreparePresentation();
        _compactInitial = true;
        ResetIconSubscriptions();
        ++_visibleGeneration;
        ++_presentation;
        _choosing = false;
        _context = SelectionContext.None();
        _requestId = null;
        _selected = null;
        _pinned = [];
        _recommended = [];
        _board = [];
        _anchor = anchor ?? MonitorPlacement.CaptureFloatingPanelAnchor();
        MaxHeight = _anchor.MaxHeight;
        MinHeight = 0;
        ApplyGeometry(SurfaceContextMode.NoContext);

        ActionList.ItemsSource = null;
        BoardList.ItemsSource = null;
        ChoiceList.ItemsSource = null;
        ClearContextPresentation();
        PanelTitle.Text = "WebTools";
        PanelTitle.ToolTip = null;
        PanelHeader.Visibility = Visibility.Visible;
        TriggerNotice.Text = "";
        TriggerNotice.Visibility = Visibility.Collapsed;
        SetStatus("");

        // The initial state is the real panel header, with its action surface collapsed.
        // It is shown independently of Copy; the same HWND expands at the UI checkpoint.
        UpdatePanelLayout();
        ShowPreparedPresentation();
        attempt?.Record("PANEL_INITIAL_COMPACT", IsVisible ? "VISIBLE" : "HIDDEN",
            ("width", ActualWidth.ToString("F0", CultureInfo.InvariantCulture)),
            ("height", ActualHeight.ToString("F0", CultureInfo.InvariantCulture)));
    }

    private void PreparePresentation()
    {
        CancelQuickResult();
        _pointerPressActive = false;
        _revealOperation?.Abort();
        _revealOperation = null;
        if (!IsVisible) Opacity = 0;
    }

    private void ShowPreparedPresentation()
    {
        WindowStartupTrace.Record("wpf-show-requested", entry: "super-panel");
        // Lay out and size the reused HWND while concealed. A hidden WPF window can retain
        // its previous rendered surface even after its data bindings have been cleared.
        UpdateLayout();
        Show();
        UpdateLayout();
        PositionPanel(ActualHeight);
        if (Opacity != 0) { ScheduleLauncherSession(); return; }
        var generation = _visibleGeneration;
        // Input priority runs after queued layout/render work, as in WPF's ContentRendered
        // dispatch. No timed delay; replacement/dismissal invalidates this presentation.
        _revealOperation = Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
        {
            _revealOperation = null;
            if (_disposed || !IsVisible || generation != _visibleGeneration) return;
            Opacity = 1;
            ScheduleLauncherSession();
        }));
    }

    private void ApplyGeometry(SurfaceContextMode mode)
    {
        if (_anchor is null) return;
        // Nine equal square cells determine width and height, independent of title/item count.
        var tileSide = Math.Max(1, Math.Min(PreferredTileSide,
            Math.Min((_anchor.Width - PanelChromeWidth) / BoardDimension - 2 * TileMargin,
                (MaxHeight - 26 - 38 - BoardFooterHeight) / BoardDimension - 2 * TileMargin)));
        var gridSide = BoardDimension * (tileSide + 2 * TileMargin);
        Resources["ShortcutTileSide"] = tileSide;
        Resources["ShortcutContentWidth"] = Math.Max(1, tileSide - 14);
        BoardList.Width = BoardList.Height = gridSide;
        BoardSurface.Height = gridSide + BoardFooterHeight;
        Width = mode == SurfaceContextMode.NoContext ? gridSide + PanelChromeWidth : Math.Min(290, _anchor.Width);
    }
    private void PresentContext(SelectionContext context)
    {
        ClearContextPresentation();
        // Capture chooses the visual tree. RefreshFeatures may only populate its action list.
        var board = context.Mode == SurfaceContextMode.NoContext;
        BoardSurface.Visibility = board ? Visibility.Visible : Visibility.Collapsed;
        ContextSurface.Visibility = board ? Visibility.Collapsed : Visibility.Visible;
        PanelTitle.Text = context.Mode switch
        {
            SurfaceContextMode.SelectedText => $"选中的文本 · {new StringInfo(context.Payload?.Text ?? "").LengthInTextElements} 字符",
            SurfaceContextMode.SelectedFiles => "选中的文件",
            SurfaceContextMode.SelectedDirectories => $"已选中 {context.Payload?.Items?.Count ?? 0} 个文件夹",
            SurfaceContextMode.ExplorerFolder => "Windows 资源管理器",
            _ => "WebTools",
        };
        PanelTitle.ToolTip = context.Hint;
        ContextActionsLabel.Visibility = context.Mode == SurfaceContextMode.NoContext ? Visibility.Collapsed : Visibility.Visible;
        var items = context.Payload?.Items;
        var names = (items ?? []).Take(3).Select(item =>
        {
            var name = Path.GetFileName(item.Path.TrimEnd('\\', '/'));
            return string.IsNullOrEmpty(name) ? item.Path : name;
        }).ToArray();
        var overflow = items is { Count: > 3 } ? $"另有 {items.Count - 3} 项" : "";
        switch (context.Mode)
        {
            case SurfaceContextMode.SelectedText:
                TextContextRoot.Visibility = Visibility.Visible;
                TextPreview.Text = context.Preview;
                TextCount.Text = $"已捕获 {new StringInfo(context.Payload?.Text ?? "").LengthInTextElements} 个字符";
                if (context.Hint.Contains("前 3000", StringComparison.Ordinal)) TextCount.Text += "（捕获已截断）";
                else if ((context.Payload?.Text?.Length ?? 0) > 220) TextCount.Text += " · 摘要预览";
                break;
            case SurfaceContextMode.SelectedFiles:
                FileContextRoot.Visibility = Visibility.Visible;
                var files = items?.Count(item => item.Kind == "file") ?? 0;
                var folders = (items?.Count ?? 0) - files;
                FilesCount.Text = folders == 0 ? $"选中的文件 {files} 个" : $"选中 {files} 个文件、{folders} 个文件夹";
                FileNames.ItemsSource = names;
                FilesOverflow.Text = overflow;
                FilesOverflow.Visibility = overflow.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
                break;
            case SurfaceContextMode.SelectedDirectories:
                DirectoryContextRoot.Visibility = Visibility.Visible;
                DirectoryNames.ItemsSource = names;
                DirectoryOverflow.Text = overflow;
                DirectoryOverflow.Visibility = overflow.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
                break;
            case SurfaceContextMode.ExplorerFolder:
                ExplorerContextRoot.Visibility = Visibility.Visible;
                ExplorerName.Text = context.ExplorerFolder?.DisplayName ?? "";
                ExplorerPath.Text = context.ExplorerFolder?.Path ?? "";
                break;
        }
    }
    private void ClearContextPresentation()
    {
        foreach (var block in new FrameworkElement[] { ContextSurface, BoardSurface, TextContextRoot, FileContextRoot, DirectoryContextRoot, ExplorerContextRoot, ContextActionsLabel })
            block.Visibility = Visibility.Collapsed;
        TextPreview.Text = TextCount.Text = FilesCount.Text = FilesOverflow.Text = DirectoryOverflow.Text = ExplorerName.Text = ExplorerPath.Text = "";
        FileNames.ItemsSource = DirectoryNames.ItemsSource = null;
        ClearQuickResultVisual();
    }
    public void Dismiss()
    {
        if (_dismissing) return;
        _dismissing = true;
        try
        {
        if (_launcherSessionId is { } sessionId) { _launcherSessionId = null; _manager.EndLauncherSession(sessionId); }
        _openingWindow = null;
        CancelQuickResult();
        _revealOperation?.Abort();
        _revealOperation = null;
        _pointerPressActive = false;
        Opacity = 0;
        _compactInitial = false;
        ResetIconSubscriptions();
        if (_openMenu is { IsOpen: true } menu) menu.IsOpen = false;
        _openMenu = null;
        ++_visibleGeneration; _choosing = false; _dragRow = null; _board = [];
        BoardList.ItemsSource = null; ChoiceList.ItemsSource = null;
        ++_presentation; _requestId = null; _context = SelectionContext.None(); _anchor = null; _menuOpen = false;
        _selected = null; _pinned = []; _recommended = [];
        ActionList.ItemsSource = null;
        PanelTitle.Text = "WebTools"; PanelTitle.ToolTip = null;
        ClearContextPresentation(); SetStatus("");
        if (IsVisible) Hide();
        }
        finally { _dismissing = false; Dismissed?.Invoke(); }
    }
    internal object CaptureHardeningSnapshot() => new
    {
        visible = IsVisible, windowHandle = new WindowInteropHelper(this).Handle.ToInt64(),
        mode = _context.Mode.ToString(), characterCount = _context.Payload?.Text?.Length ?? 0,
        itemCount = _context.Payload?.Items?.Count ?? 0,
        quickResultPending = _quickResult.Binding is not null && _quickResult.Result is null,
        hasQuickResult = _quickResult.Result is not null,
        quickResultCharacters = _quickResult.Result?.Text.Length ?? 0,
        quickResultRequestId = _quickResult.Binding?.RequestId,
        quickResultConfirmation = _quickResult.Confirmation is not null,
        quickResultVisible = QuickResultSurface.IsVisible,
        quickResultConfirmationVisible = QuickResultConsentSurface.IsVisible,
        quickResultBodySha256 = QuickResultBody.Text.Length == 0 ? null : Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(QuickResultBody.Text))),
        quickResultScrollBounded = QuickResultScroll.MaxHeight <= 220 && QuickResultScroll.MaxHeight > 0,
        status = StatusText.Text,
        developmentFeatureCount = _developmentProjection?.Features.Count ?? 0,
        actionRefs = ActionList.Items.OfType<FeatureRow>().Take(64).Select(row => row.Ref).ToArray(),
        actionCount = ActionList.Items.Count,
        actionScrollOffset = FindVisualChild<ScrollViewer>(ActionList)?.VerticalOffset ?? 0,
        actionViewport = FindVisualChild<ScrollViewer>(ActionList)?.ViewportHeight ?? 0,
        actionSurfaceHeight = ActionSurface.ActualHeight,
        firstActionVisible = IsFirstActionVisibleForAcceptance(),
        transientCleared = _context.Payload is null && _context.ExplorerFolder is null && _context.CaptureNotice is null && TextPreview.Text.Length == 0
            && FileNames.ItemsSource is null && DirectoryNames.ItemsSource is null && _selected is null,
    };
    // Reached only through the opt-in, isolated resource-test control server.
    // Uses real projection/matching/activation; never captures the shared clipboard.
    internal string? InvokeQuickResultForAcceptance(NativeFeatureRef reference, string text, bool previewOnly = false)
    {
        if (!reference.IsValid || text.Length > 3000 || !previewOnly && string.IsNullOrWhiteSpace(text)) throw new ArgumentException("Invalid synthetic selection.");
        if (previewOnly && string.IsNullOrWhiteSpace(text)) { Present(SelectionContext.None(), null); return null; }
        var context = new NativeLauncherTextContext("text", "selected-text", text, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (previewOnly) { Present(new SelectionContext(context, "隔离合成验收"), null); return null; }
        var row = (_developmentProjection?.Features ?? []).Concat(_projection?.Features ?? [])
            .FirstOrDefault(item => item.Ref == reference && SuperPanelFeatureMatcher.MatchesSelection(item, context))
            ?? throw new InvalidOperationException("Current projected Feature is unavailable.");
        Present(new SelectionContext(context, "隔离合成验收"), null);
        ActivateFeature(new FeatureRow(row.Ref, row, false));
        return _quickResult.Binding?.RequestId;
    }
    internal void DecideQuickResultForAcceptance(bool approved) => SendQuickResultDecision(approved);
    private bool IsFirstActionVisibleForAcceptance()
    {
        if (!ActionList.IsVisible || ActionList.ItemContainerGenerator.ContainerFromIndex(0) is not FrameworkElement first || !first.IsVisible) return false;
        var position = first.TransformToAncestor(ActionSurface).Transform(new System.Windows.Point());
        return first.ActualHeight > 0 && position.Y >= -1 && position.Y + first.ActualHeight <= ActionSurface.ActualHeight + 1;
    }
    internal bool ObservePointerDown(int x, int y)
    {
        // WH_MOUSE_LL is installed on this Dispatcher. Inspect physical bounds before queuing
        // dismissal; a later show invalidates this notification without a timer.
        if (!IsVisible || _dragging) return false;
        var hwnd = new WindowInteropHelper(this).Handle;
        if (!GetWindowRect(hwnd, out var bounds) || x >= bounds.Left && x < bounds.Right && y >= bounds.Top && y < bounds.Bottom) return false;
        if (_menuOpen && _menuSources.Any(source => !source.IsDisposed && IsWindowVisible(source.Handle)
            && GetWindowRect(source.Handle, out var menuBounds)
            && x >= menuBounds.Left && x < menuBounds.Right && y >= menuBounds.Top && y < menuBounds.Bottom)) return false;
        // Release the popup's mouse capture before forwarding this physical outside click.
        if (_openMenu is { IsOpen: true } menu) menu.IsOpen = false;
        var generation = _visibleGeneration;
        Dispatcher.BeginInvoke(new Action(() =>
        {
            if (generation == _visibleGeneration && IsVisible && !_menuOpen && !_dragging) Dismiss();
        }));
        return true;
    }
    [StructLayout(LayoutKind.Sequential)] private struct WindowBounds { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out WindowBounds bounds);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)] private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    private static void ConfigureNonActivatingSource(HwndSource source)
    {
        var styles = GetWindowLongPtr(source.Handle, -20).ToInt64();
        Marshal.SetLastPInvokeError(0);
        var previous = SetWindowLongPtr(source.Handle, -20, new IntPtr(styles | 0x08000000L)); // WS_EX_NOACTIVATE
        if (previous == IntPtr.Zero && Marshal.GetLastPInvokeError() != 0)
            throw new Win32Exception(Marshal.GetLastPInvokeError(), "Cannot configure non-activating Super Panel.");
        source.AddHook(NonActivatingHook);
    }
    private static IntPtr NonActivatingHook(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message != 0x21) return IntPtr.Zero; // WM_MOUSEACTIVATE
        handled = true;
        return new IntPtr(3); // MA_NOACTIVATE: preserve mouse input without activating the source window.
    }
    private void FeatureMenu_Opened(object sender, RoutedEventArgs e)
    {
        if (sender is not ContextMenu menu) return;
        _openMenu = menu; _menuOpen = true;
        if (PresentationSource.FromVisual(menu) is not HwndSource source || !_menuSources.Add(source)) return;
        try { ConfigureNonActivatingSource(source); source.Disposed += MenuSourceDisposed; }
        catch { _menuSources.Remove(source); menu.IsOpen = false; SetStatus("菜单未能保持原应用焦点，请重试。"); }
    }
    private void FeatureMenu_Closed(object sender, RoutedEventArgs e)
    {
        if (ReferenceEquals(sender, _openMenu)) { _openMenu = null; _menuOpen = false; }
    }
    private void MenuSourceDisposed(object? sender, EventArgs e)
    {
        if (sender is not HwndSource source) return;
        source.Disposed -= MenuSourceDisposed; _menuSources.Remove(source);
    }
    public void ApplyTheme(string theme) => LauncherThemePalette.Apply(Resources, theme, theme);
    public void RefreshTriggerStatus()
    {
        if ((!_store.Snapshot.Enabled || !_store.Snapshot.AutoTranslationPreview) && _translationPreviewRequestId is not null)
            CancelQuickResult();
        TriggerNotice.Text = ReadTriggerSettings?.Invoke().Error ?? "";
        TriggerNotice.Visibility = TriggerNotice.Text.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
        UpdatePanelLayout();
    }
    private int RefreshFeatures()
    {
        ++_presentation;
        ResetIconSubscriptions();
        var grid = _context.Mode == SurfaceContextMode.NoContext;
        // Explorer Folder is visual metadata, never a forged selected-directory plugin context.
        IReadOnlyList<NativeFeatureProjectionRowV2> features = _projection?.Features ?? [];
        if (_context.Mode == SurfaceContextMode.SelectedText && _developmentProjection is { } development)
            features = development.Features.Concat(features).DistinctBy(row => row.Ref).Take(NativeFeatureProjectionStore.MaximumFeatures).ToArray();
        var selection = SuperPanelFeatureSelection.Create(features, _store.Snapshot.Pinned,
            grid, _choosing, _context.Payload);
        _pinned = selection.Pinned.Select(row => new FeatureRow(row.Ref, row, true)).ToArray();
        _recommended = grid ? [] : selection.Others.Select(row => new FeatureRow(row.Ref, row, false)).ToArray();
        if (grid) RefreshBoard(selection.Others);
        else { _board = []; BoardList.ItemsSource = null; ChoiceList.ItemsSource = null; }
        var builtInTextActions = !grid && _readWebsiteSnapshot is not null
            ? SuperPanelBuiltInTextActions.Create(_context.Payload).Select(action => new FeatureRow(action)).ToArray()
            : [];
        var actionRows = builtInTextActions.Concat(_pinned).Concat(_recommended).ToArray();
        ActionList.ItemsSource = grid ? null : actionRows;
        ActionList.Visibility = actionRows.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        EmptyText.Visibility = actionRows.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        SelectRow(null);
        UpdatePanelLayout();
        ResetActionListScroll();
        return selection.MatchedCount + builtInTextActions.Length;
    }

    private void ResetActionListScroll()
    {
        if (ActionList.Items.Count == 0) return;
        ActionList.ApplyTemplate();
        ActionList.UpdateLayout();
        ActionList.ScrollIntoView(ActionList.Items[0]);
        FindVisualChild<ScrollViewer>(ActionList)?.ScrollToHome();
    }

    private static T? FindVisualChild<T>(DependencyObject parent) where T : DependencyObject
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(parent); index++)
        {
            var child = VisualTreeHelper.GetChild(parent, index);
            if (child is T match) return match;
            if (FindVisualChild<T>(child) is { } nested) return nested;
        }
        return null;
    }

    private static string VisualRootName(SurfaceContextMode mode) => mode switch
    {
        SurfaceContextMode.SelectedText => "TextContextRoot",
        SurfaceContextMode.SelectedFiles => "FileContextRoot",
        SurfaceContextMode.SelectedDirectories => "DirectoryContextRoot",
        SurfaceContextMode.ExplorerFolder => "ExplorerContextRoot",
        _ => "BoardSurface",
    };

    private void RefreshBoard(IReadOnlyList<NativeFeatureProjectionRowV2> available)
    {
        // Only explicit saved choices populate the board. No automatic recommendations/filler.
        var pages = Math.Max(1, (_pinned.Count + PageSize - 1) / PageSize);
        _page = Math.Clamp(_page, 0, pages - 1);
        _board = _pinned.Skip(_page * PageSize).Take(PageSize).ToArray();
        // The explicit 3×3 UniformGrid and fixed board extent reserve empty cells.
        // Null item placeholders unnecessarily instantiate nine button/icon templates
        // on an empty board, despite all of those buttons being hidden.
        BoardList.ItemsSource = _board;
        BoardEmpty.Visibility = _pinned.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        PageLabel.Text = $"{_page + 1} / {pages}";
        PreviousPage.IsEnabled = _page > 0; NextPage.IsEnabled = _page + 1 < pages;
        BoardGrid.Visibility = _choosing ? Visibility.Collapsed : Visibility.Visible;
        BoardChooser.Visibility = _choosing ? Visibility.Visible : Visibility.Collapsed;
        ChoiceList.ItemsSource = _choosing ? available.Select(row => new FeatureRow(row.Ref, row, false)).ToArray() : null;
        ChoiceEmpty.Visibility = ChoiceList.Items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        AddShortcut.IsEnabled = _store.Snapshot.Pinned.Count < 100;
    }
    private void PreviousPage_Click(object sender, RoutedEventArgs e) { --_page; RefreshFeatures(); }
    private void NextPage_Click(object sender, RoutedEventArgs e) { ++_page; RefreshFeatures(); }
    private void AddShortcut_Click(object sender, RoutedEventArgs e) { _choosing = true; RefreshFeatures(); }
    private void CancelChoice_Click(object sender, RoutedEventArgs e) { _choosing = false; RefreshFeatures(); }
    private void Choose_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not FeatureRow row || _context.Mode != SurfaceContextMode.NoContext) return;
        var pins = _store.Snapshot.Pinned.ToList();
        if (pins.Contains(row.Ref) || pins.Count >= 100) return;
        pins.Add(row.Ref); _choosing = false; _page = _pinned.Count / PageSize; SavePins(pins);
    }
    private void Board_PointerDown(object sender, MouseButtonEventArgs e)
    {
        _dragRow = FindRow(e.OriginalSource as DependencyObject);
        _dragStart = e.GetPosition(BoardList);
    }
    private void Board_PointerMove(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (_dragging || _dragRow is null || e.LeftButton != MouseButtonState.Pressed) return;
        var position = e.GetPosition(BoardList);
        if (Math.Abs(position.X - _dragStart.X) < SystemParameters.MinimumHorizontalDragDistance
            && Math.Abs(position.Y - _dragStart.Y) < SystemParameters.MinimumVerticalDragDistance) return;
        _dragging = true;
        try { System.Windows.DragDrop.DoDragDrop(BoardList, new System.Windows.DataObject("WebTools.SuperPanel.Shortcut", _dragRow), System.Windows.DragDropEffects.Move); }
        finally { _dragging = false; _dragRow = null; }
        e.Handled = true;
    }
    private void Board_Drop(object sender, System.Windows.DragEventArgs e)
    {
        if (!_dragging || _dragRow is null || !ReferenceEquals(e.Data.GetData("WebTools.SuperPanel.Shortcut"), _dragRow)) return;
        var target = FindRow(e.OriginalSource as DependencyObject);
        var pins = _store.Snapshot.Pinned.ToList();
        var sourceIndex = pins.IndexOf(_dragRow.Ref);
        var targetIndex = target is null ? (_board.Count > 0 ? pins.IndexOf(_board[^1].Ref) : -1) : pins.IndexOf(target.Ref);
        if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex != targetIndex)
        { pins.RemoveAt(sourceIndex); pins.Insert(targetIndex, _dragRow.Ref); SavePins(pins); }
        e.Handled = true;
    }
    private void Page_DragEnter(object sender, System.Windows.DragEventArgs e)
    {
        if (!_dragging || _dragRow is null || !ReferenceEquals(e.Data.GetData("WebTools.SuperPanel.Shortcut"), _dragRow)) return;
        var next = _page + (ReferenceEquals(sender, NextPage) ? 1 : -1);
        if (next < 0 || next >= Math.Max(1, (_pinned.Count + PageSize - 1) / PageSize)) return;
        _page = next; RefreshFeatures(); e.Handled = true;
    }
    private static FeatureRow? FindRow(DependencyObject? element)
    {
        while (element is not null)
        {
            if (element is FrameworkElement { DataContext: FeatureRow row }) return row;
            element = element is Visual ? VisualTreeHelper.GetParent(element) : null;
        }
        return null;
    }
    private sealed record IconSubscription(FeatureRow Row, CancellationTokenSource Cancellation, int Generation);
    private void FeatureIcon_Loaded(object sender, RoutedEventArgs e) => UpdateIconSubscription((FrameworkElement)sender);
    private void FeatureIcon_Unloaded(object sender, RoutedEventArgs e) => RemoveIconSubscription((FrameworkElement)sender);
    private void FeatureIcon_Changed(object sender, DependencyPropertyChangedEventArgs e) => UpdateIconSubscription((FrameworkElement)sender);
    private void UpdateIconSubscription(FrameworkElement element)
    {
        var row = element.DataContext as FeatureRow;
        if (_iconSubscriptions.TryGetValue(element, out var current)
            && ReferenceEquals(current.Row, row) && current.Generation == _presentation && element.IsVisible && element.IsLoaded) return;
        RemoveIconSubscription(element);
        if (_disposed || _anchor is null || !element.IsLoaded || !element.IsVisible || row?.Metadata?.IconDataUrl is not { } reference) return;
        var subscription = new IconSubscription(row, new CancellationTokenSource(), _presentation);
        _iconSubscriptions.Add(element, subscription);
        _ = LoadIconAsync(element, subscription, reference);
    }
    private void RemoveIconSubscription(FrameworkElement element)
    {
        if (!_iconSubscriptions.Remove(element, out var subscription)) return;
        subscription.Cancellation.Cancel(); subscription.Cancellation.Dispose(); subscription.Row.Icon = null;
    }
    private void ResetIconSubscriptions()
    {
        foreach (var element in _iconSubscriptions.Keys.ToArray()) RemoveIconSubscription(element);
    }
    private async Task LoadIconAsync(FrameworkElement element, IconSubscription subscription, string reference)
    {
        var token = subscription.Cancellation.Token;
        try
        {
            var bitmap = await _iconLoader.GetAsync(reference, token);
            if (!token.IsCancellationRequested && !_disposed && subscription.Generation == _presentation && _anchor is not null
                && _iconSubscriptions.TryGetValue(element, out var current) && ReferenceEquals(current, subscription))
                subscription.Row.Icon = bitmap;
        }
        catch (OperationCanceledException) { }
        catch { /* Keep the native fallback icon. */ }
    }
    private void UpdatePanelLayout()
    {
        if (_anchor is null || _placing || _preparingPresentation) return;
        _placing = true;
        try
        {
            var width = Math.Max(1, Width - 26);
            QuickResultScroll.MaxHeight = Math.Max(24, Math.Min(220, MaxHeight * 0.4));
            QuickResultConsentScroll.MaxHeight = Math.Max(24, Math.Min(120, MaxHeight * 0.25));
            if (_context.Mode == SurfaceContextMode.SelectedText) TextContextRoot.Visibility = Visibility.Visible;
            TextPreview.MaxHeight = 54;
            double MeasureChrome()
            {
                // Text and ScrollViewer desired sizes settle on the layout pass.
                // Measuring their ancestors first can reuse the loading preview's
                // smaller height and clip actions after a result arrives.
                PanelRoot.UpdateLayout();
                double measured = 26;
                foreach (var element in new FrameworkElement[] { PanelHeader, TextContextRoot, QuickResultSurface, QuickResultConsentSurface, FileContextRoot, DirectoryContextRoot, ExplorerContextRoot, ContextActionsLabel, TriggerNotice, StatusText })
                { element.Measure(new Size(width, double.PositiveInfinity)); measured += element.DesiredSize.Height; }
                return measured;
            }
            var chrome = MeasureChrome();
            const double minimumActionViewport = 44;
            if (TextContextRoot.Visibility == Visibility.Visible && ActionList.Items.Count > 0
                && MaxHeight - chrome < minimumActionViewport)
            {
                // On short work areas, keep one complete action row reachable by
                // compacting the optional text preview before clipping the list.
                var requiredReduction = minimumActionViewport - (MaxHeight - chrome);
                var previewHeight = Math.Max(18, TextPreview.MaxHeight - requiredReduction);
                TextPreview.MaxHeight = Math.Max(18, Math.Floor(previewHeight / 18) * 18);
                chrome = MeasureChrome();
                if (MaxHeight - chrome < minimumActionViewport)
                {
                    // The heading still identifies selected-text context. On a very
                    // short work area, favor the first complete action over its preview.
                    TextContextRoot.Visibility = Visibility.Collapsed;
                    chrome = MeasureChrome();
                }
            }
            if (ActionList.Items.Count > 0 && MaxHeight - chrome < minimumActionViewport
                && QuickResultSurface.Visibility == Visibility.Visible)
            {
                QuickResultScroll.MaxHeight = Math.Max(18, QuickResultScroll.DesiredSize.Height - (minimumActionViewport - (MaxHeight - chrome)));
                chrome = MeasureChrome();
            }
            if (ActionList.Items.Count > 0 && MaxHeight - chrome < minimumActionViewport
                && QuickResultConsentSurface.Visibility == Visibility.Visible)
            {
                QuickResultConsentScroll.MaxHeight = Math.Max(18, QuickResultConsentScroll.DesiredSize.Height - (minimumActionViewport - (MaxHeight - chrome)));
                chrome = MeasureChrome();
            }
            ActionSurface.MaxHeight = Math.Max(0, Math.Min(240, MaxHeight - chrome));
            PanelRoot.UpdateLayout();
            PanelRoot.Measure(new Size(Width, MaxHeight));
            Height = Math.Clamp(PanelRoot.DesiredSize.Height, MinHeight, MaxHeight);
            PanelRoot.Arrange(new Rect(0, 0, Width, Height));
            PositionPanel(Height);
        }
        finally { _placing = false; }
    }
    private void PositionPanel(double height) { if (_anchor is not null) MonitorPlacement.PositionFloatingPanel(this, _anchor, Math.Max(MinHeight, height)); }
    private void Panel_SizeChanged(object sender, SizeChangedEventArgs e) { if (IsVisible && !_placing) PositionPanel(e.NewSize.Height); }
    private void SetStatus(string text)
    { StatusText.Text = text; StatusText.Visibility = text.Length == 0 ? Visibility.Collapsed : Visibility.Visible; UpdatePanelLayout(); }
    private void SelectRow(FeatureRow? row)
    {
        _changingSelection = true;
        try { _selected = row; ActionList.SelectedItem = row; }
        finally { _changingSelection = false; }
    }
    private void Selection_Changed(object sender, SelectionChangedEventArgs e) { if (!_changingSelection && e.AddedItems.Count > 0 && e.AddedItems[0] is FeatureRow row) SelectRow(row); }
    private void Activate_PreviewMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (_dragging || e.ChangedButton != MouseButton.Left || sender is not Button { Tag: FeatureRow row }
            || row.Ref != SuperPanelTranslationPreview.Reference) return;

        // A pending automatic preview is cancelled by the Window-level mouse-up
        // handler. Complete the explicit Translation handoff on the first press,
        // before that cancellation can rebuild the action surface and consume the click.
        e.Handled = true;
        ActivateFeature(row);
    }
    private void Activate_Click(object sender, RoutedEventArgs e) { if (!_dragging && ((Button)sender).Tag is FeatureRow row) ActivateFeature(row); }
    private void ActivateFeature(FeatureRow row)
    {
        if (_openingWindow is not null) return;
        CancelQuickResult();
        var context = _context.Payload;
        if (row.Ref == SuperPanelTranslationPreview.Reference
            && context is { Type: "text", Source: "selected-text", Text: { } selectedText })
        {
            var openingId = BeginWindowHandoff("翻译", row.Ref.PluginId);
            _requestId = openingId;
            _openTranslation(selectedText, openingId);
            ShowWindowHandoff?.Invoke(openingId, "翻译", row.Ref.PluginId);
            Dismiss();
            return;
        }
        if (context is not null && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - context.CapturedAtUnixMs >= 30000)
        { SetStatus("选择已过期，请重新唤出 Super Panel。"); return; }
        if (row.BuiltInTextAction is { } builtIn)
        {
            ActivateBuiltInTextAction(builtIn, context);
            return;
        }
        if (row.Metadata is not { } metadata) return;
        var command = metadata.Presentation == "command";
        if (command) SetStatus("正在执行 " + row.Title + "…");
        var handoff = !command;
        var windowRequestId = handoff ? BeginWindowHandoff(row.Title, row.Ref.PluginId) : null;
        var quick = command && _context.Mode == SurfaceContextMode.SelectedText;
        var id = _invokeSuperPanelFeature(row.Ref, context, quick, windowRequestId); _requestId = id;
        if (id is not null && handoff) { ShowWindowHandoff?.Invoke(id, row.Title, row.Ref.PluginId); Dismiss(); }
        if (id is null) _openingWindow = null;
        if (quick && id is not null) { _quickResultSource = row.IdentityTitle; _quickResult.Begin(id, row.Ref, _visibleGeneration); }
    }
    private void ActivateBuiltInTextAction(SuperPanelBuiltInTextAction action, NativeLauncherTextContext? context)
    {
        if (_readWebsiteSnapshot is null) return;
        try
        {
            var start = SuperPanelBuiltInTextActions.CreateStartInfo(action, context, _readWebsiteSnapshot());
            _startProcess(start);
            Dismiss();
        }
        catch (Exception error) when (error is InvalidOperationException or ArgumentException or System.ComponentModel.Win32Exception)
        {
            SetStatus(action.Kind == SuperPanelBuiltInTextActionKind.SearchSelectedText
                ? "无法使用当前搜索引擎，请检查搜索设置。"
                : "无法打开选中的链接。");
        }
    }
    private void InvocationFeedback(string id, NativeFeatureRef reference, string status, bool dismissPanel)
    {
        if (_disposed || Dispatcher.HasShutdownStarted) return;
        Dispatcher.BeginInvoke(new Action(() =>
        {
            if (!IsVisible || _requestId != id) return;
            _requestId = null;
            if (status is "failed" or "rejected" or "cancelled") _openingWindow = null;
            if (_quickResult.Result is not null) return;
            if (status == "completed" && dismissPanel) { Dismiss(); return; }
            if (status is "failed" or "rejected" or "cancelled") { _quickResult.Dismiss(); ClearQuickResultVisual(); }
            else if (status == "completed" && _quickResult.Binding is not null)
            { _quickResult.TryClear(id, reference); SetStatus("执行完成，未返回快速结果"); return; }
            SetStatus(status == "completed" ? "命令执行完成。" : status == "cancelled" ? "命令已取消。" : status is "failed" or "rejected" ? "功能执行未完成。" : "功能已打开。");
        }));
    }
    private void Search_Click(object sender, RoutedEventArgs e) { Dismiss(); ShowLauncher?.Invoke(); }
    private void Panel_ContextMenuOpening(object sender, ContextMenuEventArgs e) => _menuOpen = true;
    private void Panel_ContextMenuClosing(object sender, ContextMenuEventArgs e) => _menuOpen = false;
    private static FeatureRow? MenuRow(object sender) => (sender as FrameworkElement)?.DataContext as FeatureRow;
    private void Pin_Click(object sender, RoutedEventArgs e)
    {
        var row = MenuRow(sender); if (row is null) return;
        var pins = _store.Snapshot.Pinned.ToList();
        if (!pins.Remove(row.Ref)) { if (pins.Count >= 100) { SetStatus("最多固定 100 个功能。"); return; } pins.Add(row.Ref); }
        SavePins(pins);
    }
    private void MoveUp_Click(object sender, RoutedEventArgs e) => MovePin(sender, -1);
    private void MoveDown_Click(object sender, RoutedEventArgs e) => MovePin(sender, 1);
    private void MovePin(object sender, int offset)
    {
        var row = MenuRow(sender); if (row is null) return;
        var pins = _store.Snapshot.Pinned.ToList(); var index = pins.IndexOf(row.Ref); var next = index + offset;
        if (index < 0 || next < 0 || next >= pins.Count) return;
        (pins[index], pins[next]) = (pins[next], pins[index]); SavePins(pins);
    }
    private void SavePins(IReadOnlyList<NativeFeatureRef> pins)
    {
        try { _store.Save(_store.Snapshot with { Pinned = Array.AsReadOnly(pins.ToArray()) }); if (IsVisible) RefreshFeatures(); }
        catch { SetStatus("固定功能保存失败，原设置保持不变。"); }
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true; _manager.FeatureInvocationFeedback -= InvocationFeedback;
        _manager.FeatureQuickResult -= ReceiveQuickResult; _manager.FeatureQuickResultClear -= ReceiveQuickResultClear;
        _manager.FeatureQuickResultConfirmation -= ReceiveQuickResultConfirmation;
        _manager.AcceptedQuickResultRequested -= ReadAcceptedQuickResult;
        _manager.QuickResultTransportDisconnected -= QuickResultDisconnected; _manager.DevelopmentProjectionChanged -= DevelopmentProjectionChanged;
        Dismiss();
        if (_source is { IsDisposed: false }) _source.RemoveHook(NonActivatingHook);
        foreach (var source in _menuSources.ToArray())
        {
            source.Disposed -= MenuSourceDisposed;
            if (!source.IsDisposed) source.RemoveHook(NonActivatingHook);
        }
        _menuSources.Clear(); Close();
    }
    private sealed class FeatureRow : INotifyPropertyChanged
    {
        public FeatureRow(NativeFeatureRef reference, NativeFeatureProjectionRowV2 metadata, bool pinned)
        { Ref = reference; Metadata = metadata; Pinned = pinned; }
        public FeatureRow(SuperPanelBuiltInTextAction action)
        { Ref = action.Ref; BuiltInTextAction = action; }
        public NativeFeatureRef Ref { get; }
        public NativeFeatureProjectionRowV2? Metadata { get; }
        public SuperPanelBuiltInTextAction? BuiltInTextAction { get; }
        public bool Pinned { get; }
        public string Title => BuiltInTextAction?.Title ?? Metadata?.Title ?? "";
        public string Detail => BuiltInTextAction is not null ? "WebTools" : Metadata?.PluginName ?? "";
        public string IdentityTitle => Title + "\n" + Detail;
        public string FullTitle => IdentityTitle + "\n右键可移除快捷方式或调整顺序";
        public string FallbackGlyph => BuiltInTextAction?.FallbackGlyph ?? (Metadata?.FeatureKind == "built-in" ? "文" : "◇");
        public string PinLabel => Pinned ? "移除快捷方式" : "添加快捷方式";
        private BitmapSource? _icon;
        public BitmapSource? Icon { get => _icon; set { _icon = value; PropertyChanged?.Invoke(this, new(nameof(Icon))); } }
        public event PropertyChangedEventHandler? PropertyChanged;
    }
}
