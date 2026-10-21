using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>Read the actual desktop FolderView; desktop is a source, not a new invocation context type.</summary>
internal static class DesktopSelectionProvider
{
    private const int SwcDesktop = 8, SwfoNeedDispatch = 1, CsidlDesktop = 0;
    private static readonly Guid ShellWindowsClassId = new("9BA05972-F6A8-11CF-A442-00A0C90A8F39");
    private static readonly Guid TopLevelBrowserServiceId = new("4C96BE40-915C-11CF-99D3-00AA004AE837");
    private static readonly Guid ShellBrowserInterfaceId = new("000214E2-0000-0000-C000-000000000046");
    private static readonly Guid DispatchInterfaceId = new("00020400-0000-0000-C000-000000000046");

    internal static SelectionCaptureResult? Capture(IntPtr foreground, uint processId, string windowClass, SelectionDiagnosticAttempt? attempt, CancellationToken cancellation = default)
    {
        var foregroundRoot = GetAncestor(foreground, 2);
        if (windowClass is not ("Progman" or "WorkerW" or "SHELLDLL_DefView" or "SysListView32")
            || WindowClass(foregroundRoot) is not ("Progman" or "WorkerW")) return null;
        attempt?.Record("DESKTOP_CAPTURE_STARTED", "STARTED", timestamp: Stopwatch.GetTimestamp(),
            ("provider", "DesktopShell"), ("foregroundWindowClass", windowClass));
        GetWindowThreadProcessId(GetShellWindow(), out var shellProcessId);
        if (shellProcessId == 0 || processId != shellProcessId)
            return Unavailable(attempt, "DESKTOP_SHELL_OWNERSHIP_MISMATCH");

        object? windowsObject = null, desktop = null, browserObject = null, document = null, selected = null;
        IShellViewNative? view = null;
        var stage = "SHELL_WINDOWS";
        try
        {
            cancellation.ThrowIfCancellationRequested();
            var type = Type.GetTypeFromCLSID(ShellWindowsClassId);
            if (type is null) return Unavailable(attempt, "DESKTOP_VIEW_UNAVAILABLE");
            windowsObject = Activator.CreateInstance(type);
            if (windowsObject is not IShellWindowsNative windows) return Unavailable(attempt, "DESKTOP_VIEW_UNAVAILABLE");
            object location = CsidlDesktop;
            object? locationRoot = null; // VT_EMPTY, as required by FindWindowSW.
            stage = "FIND_DESKTOP_WINDOW";
            Check(windows.FindWindowSW(ref location, ref locationRoot, SwcDesktop, out _, SwfoNeedDispatch, out desktop));
            cancellation.ThrowIfCancellationRequested();
            if (desktop is not IServiceProviderNative services) return Unavailable(attempt, "DESKTOP_VIEW_UNAVAILABLE");
            // Desktop's dispatch is not assumed to be an ordinary Explorer IWebBrowser2.Document.
            var serviceId = TopLevelBrowserServiceId;
            var browserId = ShellBrowserInterfaceId;
            stage = "DESKTOP_BROWSER_SERVICE";
            Check(services.QueryService(ref serviceId, ref browserId, out browserObject));
            cancellation.ThrowIfCancellationRequested();
            if (browserObject is not IShellBrowserNative browser) return Unavailable(attempt, "DESKTOP_VIEW_UNAVAILABLE");
            stage = "DESKTOP_ACTIVE_VIEW";
            Check(browser.QueryActiveShellView(out view));
            cancellation.ThrowIfCancellationRequested();
            if (view is null) return Unavailable(attempt, "DESKTOP_VIEW_UNAVAILABLE");
            Check(view.GetWindow(out var viewHwnd));
            GetWindowThreadProcessId(viewHwnd, out var viewProcessId);
            var viewRoot = GetAncestor(viewHwnd, 2);
            if (viewProcessId != shellProcessId || WindowClass(viewHwnd) != "SHELLDLL_DefView"
                || WindowClass(viewRoot) is not ("Progman" or "WorkerW")
                || FindWindowEx(viewHwnd, IntPtr.Zero, "SysListView32", null) == IntPtr.Zero)
                return Unavailable(attempt, "DESKTOP_VIEW_OWNERSHIP_UNVERIFIED");
            stage = "DESKTOP_AUTOMATION_VIEW";
            var dispatchId = DispatchInterfaceId;
            Check(view.GetItemObject(0, ref dispatchId, out document)); // SVGIO_BACKGROUND => ShellFolderView automation.
            cancellation.ThrowIfCancellationRequested();
            if (document is null) return Unavailable(attempt, "DESKTOP_VIEW_UNAVAILABLE");
            attempt?.Record("DESKTOP_VIEW_RESOLVED", "FOUND", timestamp: Stopwatch.GetTimestamp(),
                ("documentAvailable", "true"), ("desktopViewVerified", "true"));
            stage = "DESKTOP_SELECTED_ITEMS_CALL";
            selected = ((dynamic)document).SelectedItems();
            cancellation.ThrowIfCancellationRequested();
            attempt?.Record("DESKTOP_SELECTED_ITEMS_CALL", "SUCCESS", timestamp: Stopwatch.GetTimestamp(), ("selectedItemsCall", "success"));
            stage = "DESKTOP_SELECTED_ITEMS_COUNT";
            var length = Convert.ToInt32(((dynamic)selected).Count);
            attempt?.Record("DESKTOP_SELECTED_ITEMS_COUNT", "SUCCESS", timestamp: Stopwatch.GetTimestamp(), ("selectedItemsCount", length.ToString()));
            if (length == 0)
            {
                attempt?.Record("DESKTOP_PROVIDER_COMPLETED", "EMPTY", "DESKTOP_SELECTION_EMPTY");
                return new(SelectionContext.None(), "DESKTOP_SELECTION_EMPTY");
            }
            stage = "DESKTOP_ITEM_CLASSIFICATION";
            return SelectionCapturePayloads.FromFilesystemItems(selected, length, attempt, desktop: true, cancellation: cancellation);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error)
        {
            attempt?.Record("DESKTOP_PROVIDER_EXCEPTION", "FAILED", "DESKTOP_PROVIDER_EXCEPTION", timestamp: Stopwatch.GetTimestamp(),
                ("provider", "DesktopShell"), ("desktopStage", stage), ("exceptionType", error.GetType().Name), ("hresult", $"0x{error.HResult:X8}"));
            attempt?.Record("DESKTOP_PROVIDER_COMPLETED", "FAILED", "DESKTOP_PROVIDER_EXCEPTION");
            return new(SelectionContext.None("桌面选择读取失败 · 未使用剪贴板"), "DESKTOP_PROVIDER_EXCEPTION");
        }
        finally
        {
            Release(selected); Release(document); Release(view); Release(browserObject); Release(desktop); Release(windowsObject);
        }
    }

    private static SelectionCaptureResult Unavailable(SelectionDiagnosticAttempt? attempt, string reason)
    {
        attempt?.Record("DESKTOP_VIEW_UNAVAILABLE", "UNAVAILABLE", reason, timestamp: Stopwatch.GetTimestamp(), ("desktopViewVerified", "false"));
        attempt?.Record("DESKTOP_PROVIDER_COMPLETED", "FAILED", reason);
        return new(SelectionContext.None("桌面 Shell 未提供可读取的选择"), reason);
    }
    private static void Check(int result) { if (result < 0) Marshal.ThrowExceptionForHR(result); }
    private static void Release(object? value) { if (value is not null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    private static string WindowClass(IntPtr hwnd)
    {
        var name = new StringBuilder(256);
        _ = GetClassName(hwnd, name, name.Capacity);
        return name.ToString();
    }

    // Imported native ABI prefixes. Unused members retain their slots; only the read-only calls above are made.
    [ComImport, Guid("85CB6900-4D95-11CF-960C-0080C7F4EE85"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
    private interface IShellWindowsNative
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item([In, MarshalAs(UnmanagedType.Struct)] object index, [MarshalAs(UnmanagedType.IDispatch)] out object value);
        [PreserveSig] int NewEnum([MarshalAs(UnmanagedType.IUnknown)] out object value);
        [PreserveSig] int Register([MarshalAs(UnmanagedType.IDispatch)] object value, int hwnd, int windowClass, out int cookie);
        [PreserveSig] int RegisterPending(int threadId, [In, MarshalAs(UnmanagedType.Struct)] ref object location,
            [In, MarshalAs(UnmanagedType.Struct)] ref object locationRoot, int windowClass, out int cookie);
        [PreserveSig] int Revoke(int cookie);
        [PreserveSig] int OnNavigate(int cookie, [In, MarshalAs(UnmanagedType.Struct)] ref object location);
        [PreserveSig] int OnActivated(int cookie, [MarshalAs(UnmanagedType.VariantBool)] bool active);
        [PreserveSig] int FindWindowSW([In, MarshalAs(UnmanagedType.Struct)] ref object location,
            [In, MarshalAs(UnmanagedType.Struct)] ref object? locationRoot, int windowClass, out int hwnd, int options,
            [MarshalAs(UnmanagedType.IDispatch)] out object? value);
    }
    [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IServiceProviderNative
    {
        [PreserveSig] int QueryService(ref Guid service, ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out object? value);
    }
    [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellBrowserNative
    {
        [PreserveSig] int GetWindow(out IntPtr hwnd);
        [PreserveSig] int ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enterMode);
        [PreserveSig] int InsertMenusSB(IntPtr menu, IntPtr widths);
        [PreserveSig] int SetMenuSB(IntPtr menu, IntPtr oleMenu, IntPtr activeObject);
        [PreserveSig] int RemoveMenusSB(IntPtr menu);
        [PreserveSig] int SetStatusTextSB([MarshalAs(UnmanagedType.LPWStr)] string text);
        [PreserveSig] int EnableModelessSB([MarshalAs(UnmanagedType.Bool)] bool enable);
        [PreserveSig] int TranslateAcceleratorSB(IntPtr message, ushort id);
        [PreserveSig] int BrowseObject(IntPtr pidl, uint flags);
        [PreserveSig] int GetViewStateStream(uint mode, out IntPtr stream);
        [PreserveSig] int GetControlWindow(uint id, out IntPtr hwnd);
        [PreserveSig] int SendControlMsg(uint id, uint message, UIntPtr wParam, IntPtr lParam, out IntPtr result);
        [PreserveSig] int QueryActiveShellView([MarshalAs(UnmanagedType.Interface)] out IShellViewNative? view);
    }
    [ComImport, Guid("000214E3-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellViewNative
    {
        [PreserveSig] int GetWindow(out IntPtr hwnd);
        [PreserveSig] int ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enterMode);
        [PreserveSig] int TranslateAccelerator(IntPtr message);
        [PreserveSig] int EnableModeless([MarshalAs(UnmanagedType.Bool)] bool enable);
        [PreserveSig] int UIActivate(uint state);
        [PreserveSig] int Refresh();
        [PreserveSig] int CreateViewWindow(IntPtr previous, IntPtr settings, IntPtr browser, IntPtr rect, out IntPtr hwnd);
        [PreserveSig] int DestroyViewWindow();
        [PreserveSig] int GetCurrentInfo(IntPtr settings);
        [PreserveSig] int AddPropertySheetPages(uint reserved, IntPtr callback, IntPtr lParam);
        [PreserveSig] int SaveViewState();
        [PreserveSig] int SelectItem(IntPtr pidl, uint flags);
        [PreserveSig] int GetItemObject(uint item, ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out object? value);
    }
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string windowClass, string? title);
}
