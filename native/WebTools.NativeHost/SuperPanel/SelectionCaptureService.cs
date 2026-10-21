using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.CompilerServices;
using System.Text;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>Native Shell context or one user-triggered Copy. One worker; native calls are not preempted.</summary>
internal sealed class SelectionCaptureService : IDisposable
{
    private int _capturing, _disposed;
    private string? _activeAttemptId;
    private CaptureInvocation? _activeInvocation;
    private Task _workerCompletion = Task.CompletedTask;
    private readonly Func<CaptureInvocation, SelectionDiagnosticAttempt?, SelectionCaptureResult>? _captureForCheck;
    internal SelectionCaptureService() { }
    internal SelectionCaptureService(Func<CaptureInvocation, SelectionDiagnosticAttempt?, SelectionCaptureResult> captureForCheck)
        => _captureForCheck = captureForCheck;
    internal int ActiveWorkerCount => Volatile.Read(ref _capturing);
    internal Task WorkerCompletion => Volatile.Read(ref _workerCompletion);

    internal async Task<SelectionCaptureResult> CaptureAsync(SelectionDiagnosticAttempt? attempt)
    {
        using var invocation = CaptureInvocation.Snapshot(0);
        return await CaptureAsync(invocation, attempt);
    }
    internal async Task<SelectionCaptureResult> CaptureAsync(CaptureInvocation invocation, SelectionDiagnosticAttempt? attempt)
    {
        var captureStarted = invocation.Started;
        attempt?.Record("CAPTURE_STARTED", "STARTED", timestamp: captureStarted);
        var foreground = invocation.Foreground; var processId = invocation.ProcessId;
        var windowClass = invocation.WindowClass;
        var textRoute = windowClass is not ("CabinetWClass" or "ExploreWClass" or "Progman" or "WorkerW" or "SHELLDLL_DefView" or "SysListView32");
        attempt?.Record("FOREGROUND_SNAPSHOT", "SUCCESS", timestamp: Stopwatch.GetTimestamp(),
            ("foregroundHwnd", FormatHwnd(foreground)), ("foregroundPid", processId.ToString()),
            ("foregroundProcess", GetProcessBasename(processId)), ("foregroundWindowClass", windowClass),
            ("focusRelation", invocation.FocusWindow == IntPtr.Zero ? "unavailable" : "snapshotted"));
        if (Volatile.Read(ref _disposed) != 0 || invocation.Token.IsCancellationRequested)
            return Complete(SelectionContext.None(), "CAPTURE_CANCELLED", attempt, outcome: SelectionCaptureOutcome.Cancelled);
        if (foreground == IntPtr.Zero) return Complete(SelectionContext.None("没有可捕获文字的前台窗口。"), "NO_FOREGROUND_WINDOW", attempt, textCaptureFailed: true);
        if (processId == Environment.ProcessId) return Complete(SelectionContext.None("请在原应用中选中文字后唤出。"), "FOREGROUND_IS_NATIVE_HOST", attempt, textCaptureFailed: true);
        if (Interlocked.CompareExchange(ref _capturing, 1, 0) != 0)
        {
            attempt?.Record("CAPTURE_BUSY", "REJECTED", "SINGLE_FLIGHT_BUSY",
                ("blockedByAttemptId", Volatile.Read(ref _activeAttemptId) ?? "UNKNOWN"), ("activeWorkerCount", "1"));
            return Complete(SelectionContext.None("上一次捕获仍在响应，请稍后重试。"), "CAPTURE_BUSY", attempt, workerRunning: true, textCaptureFailed: textRoute);
        }
        Volatile.Write(ref _activeInvocation, invocation);
        Volatile.Write(ref _activeAttemptId, attempt?.AttemptId);
        var source = new TaskCompletionSource<SelectionCaptureResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var finished = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Volatile.Write(ref _workerCompletion, finished.Task);
        var lease = invocation.RetainWorker();
        var worker = new Thread(() =>
        {
            var workerStart = Stopwatch.GetTimestamp();
            SelectionCaptureResult result;
            attempt?.Record("WORKER_STARTED", "SUCCESS", ("workerStarted", "true"), ("activeWorkerCount", "1"));
            try
            {
                invocation.Token.ThrowIfCancellationRequested();
                if (_captureForCheck is not null) result = _captureForCheck(invocation, attempt);
                else
                {
                    // Dispatch before entering provider methods. In particular, a text
                    // capture must not JIT the dynamic Shell automation call sites.
                    SelectionCaptureResult? captured = null;
                    if (windowClass is "CabinetWClass" or "ExploreWClass")
                        captured = CaptureExplorer(foreground, windowClass, attempt, invocation.Token);
                    invocation.Token.ThrowIfCancellationRequested();
                    if (captured is null && windowClass is ("Progman" or "WorkerW" or "SHELLDLL_DefView" or "SysListView32"))
                        captured = CaptureDesktop(invocation, attempt);
                    invocation.Token.ThrowIfCancellationRequested();
                    captured ??= textRoute ? CopyTextCaptureProvider.Capture(invocation, attempt)
                        : new(SelectionContext.None(), "SHELL_CONTEXT_UNAVAILABLE");
                    invocation.Token.ThrowIfCancellationRequested();
                    if (!invocation.IsNativeFocusCurrent())
                    {
                        invocation.Cancel("focus-changed");
                        captured = new(SelectionContext.None(), "CAPTURE_FOCUS_CHANGED", Outcome: SelectionCaptureOutcome.Cancelled);
                    }
                    result = captured;
                }
            }
            catch (OperationCanceledException)
            {
                result = new(SelectionContext.None(), invocation.CancelReason == "timeout" ? "CAPTURE_TIMEOUT" : "CAPTURE_CANCELLED",
                    Outcome: invocation.CancelReason == "timeout" ? SelectionCaptureOutcome.TimedOut : SelectionCaptureOutcome.Cancelled,
                    TextCaptureFailed: textRoute && invocation.CancelReason == "timeout"
                        && (!invocation.CopyInjected || invocation.CopyResultObserved));
            }
            catch (Exception error)
            {
                attempt?.Record("CAPTURE_WORKER_EXCEPTION", "FAILED", "CAPTURE_WORKER_EXCEPTION",
                    ("exceptionType", error.GetType().Name), ("hresult", FormatHresult(error.HResult)));
                result = new(SelectionContext.None("未能获取当前应用的选择，请重试。"), "CAPTURE_WORKER_EXCEPTION", TextCaptureFailed: textRoute);
            }
            finally
            {
                attempt?.Record("WORKER_COMPLETED", "SUCCESS", invocation.Token.IsCancellationRequested ? "COMPLETED_AFTER_CANCEL" : null,
                    ("cancelled", invocation.Token.IsCancellationRequested.ToString().ToLowerInvariant()),
                    ("workerTotalMs", Stopwatch.GetElapsedTime(workerStart).TotalMilliseconds.ToString("F1", System.Globalization.CultureInfo.InvariantCulture)));
                attempt?.SetWorkerRunning(false);
                Volatile.Write(ref _activeInvocation, null); Volatile.Write(ref _activeAttemptId, null);
                Volatile.Write(ref _capturing, 0); lease.Dispose(); finished.TrySetResult();
            }
            source.TrySetResult(result);
        }) { IsBackground = true, Name = "WebTools selection capture" };
        try { worker.SetApartmentState(ApartmentState.STA); worker.Start(); }
        catch (Exception error)
        {
            lease.Dispose(); Volatile.Write(ref _activeInvocation, null); Volatile.Write(ref _capturing, 0); finished.TrySetResult();
            attempt?.Record("CAPTURE_WORKER_START_FAILED", "FAILED", "THREAD_START_FAILED", ("exceptionType", error.GetType().Name));
            return Complete(SelectionContext.None("无法启动文字捕获，请重试。"), "THREAD_START_FAILED", attempt, textCaptureFailed: textRoute);
        }
        try
        {
            var result = await source.Task.WaitAsync(invocation.Remaining, invocation.Token);
            return Complete(result.Context, result.ReasonCode, attempt, outcome: result.Outcome, textCaptureFailed: result.TextCaptureFailed);
        }
        catch (TimeoutException)
        {
            invocation.Cancel("timeout");
            attempt?.Record("CAPTURE_TIMEOUT", "FAILED", "CAPTURE_TIMEOUT", ("workerStillRunning", (ActiveWorkerCount != 0).ToString().ToLowerInvariant()));
            if (textRoute && invocation.CopyInjected && !invocation.CopyResultObserved)
            {
                // Mirror the provider's no-update fallback even if this outer deadline wins the race.
                return Complete(SelectionContext.None(), "COPY_NO_TEXT_UPDATE", attempt, timedOut: true,
                    workerRunning: ActiveWorkerCount != 0, outcome: SelectionCaptureOutcome.TimedOut);
            }
            return Complete(SelectionContext.None("没有及时收到复制结果，请确认文字可复制后重试。"), "CAPTURE_TIMEOUT", attempt,
                timedOut: true, workerRunning: ActiveWorkerCount != 0, outcome: SelectionCaptureOutcome.TimedOut, textCaptureFailed: textRoute);
        }
        catch (OperationCanceledException)
        {
            attempt?.Record("CAPTURE_CANCELLED", "CANCELLED", "CAPTURE_CANCELLED");
            return Complete(SelectionContext.None(), "CAPTURE_CANCELLED", attempt,
                workerRunning: ActiveWorkerCount != 0, outcome: SelectionCaptureOutcome.Cancelled);
        }
    }
    public void Dispose()
    {
        Interlocked.Exchange(ref _disposed, 1);
        Volatile.Read(ref _activeInvocation)?.Cancel("shutdown");
    }

    private static SelectionCaptureResult Complete(SelectionContext context, string reasonCode, SelectionDiagnosticAttempt? attempt,
        bool timedOut = false, bool workerRunning = false, SelectionCaptureOutcome? outcome = null, bool textCaptureFailed = false)
    {
        var captureResult = CaptureResultName(context.Mode);
        var timeoutOccurred = timedOut || outcome == SelectionCaptureOutcome.TimedOut;
        if (attempt is not null)
        {
            var payload = context.Payload;
            var items = payload?.Items ?? [];
            var fileCount = items.Count(item => item.Kind == "file");
            var directoryCount = items.Count - fileCount;
            var characterCount = payload?.Text?.Length ?? 0;
            attempt.SetCaptureState(captureResult, reasonCode, workerRunning);
            attempt.Record("CAPTURE_COMPLETED", captureResult, reasonCode, Stopwatch.GetTimestamp(),
                ("captureResult", captureResult), ("workerStillRunning", workerRunning.ToString().ToLowerInvariant()),
                ("timeoutOccurred", timeoutOccurred.ToString().ToLowerInvariant()), ("itemCount", items.Count.ToString()),
                ("fileCount", fileCount.ToString()), ("directoryCount", directoryCount.ToString()), ("characterCount", characterCount.ToString()));
            attempt.Record("CONTEXT_CREATED", captureResult, reasonCode, Stopwatch.GetTimestamp(),
                ("itemCount", items.Count.ToString()), ("fileCount", fileCount.ToString()),
                ("directoryCount", directoryCount.ToString()), ("characterCount", characterCount.ToString()));
            attempt.Record("MODE_SELECTED", context.Mode.ToString(), timestamp: Stopwatch.GetTimestamp(), ("mode", context.Mode.ToString()));
        }
        var kind = outcome ?? SelectionCaptureOutcome.Unavailable;
        if (kind == SelectionCaptureOutcome.Unavailable && context.Payload is not null)
            kind = context.Mode == SurfaceContextMode.SelectedText ? SelectionCaptureOutcome.SelectedText : SelectionCaptureOutcome.SelectedContext;
        attempt?.Record("CAPTURE_OUTCOME", "RESOLVED", ("captureOutcome", kind.ToString()));
        return new(context, reasonCode, timedOut || kind == SelectionCaptureOutcome.TimedOut, workerRunning, kind, textCaptureFailed);
    }

    private static string CaptureResultName(SurfaceContextMode mode) => mode switch
    {
        SurfaceContextMode.SelectedText => "SelectedText",
        SurfaceContextMode.SelectedFiles => "SelectedFiles",
        SurfaceContextMode.SelectedDirectories => "SelectedDirectories",
        SurfaceContextMode.ExplorerFolder => "ExplorerFolder",
        _ => "None"
    };

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static SelectionCaptureResult? CaptureDesktop(CaptureInvocation invocation, SelectionDiagnosticAttempt? attempt) =>
        DesktopSelectionProvider.Capture(invocation.Foreground, invocation.ProcessId, invocation.WindowClass, attempt, invocation.Token);

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static SelectionCaptureResult? CaptureExplorer(IntPtr foreground, string windowClass, SelectionDiagnosticAttempt? attempt, CancellationToken cancellation)
    {
        if (windowClass is not ("CabinetWClass" or "ExploreWClass"))
        {
            attempt?.Record("EXPLORER_CAPTURE_SKIPPED", "SKIPPED", "NOT_EXPLORER_WINDOW", timestamp: Stopwatch.GetTimestamp(),
                ("foregroundWindowClass", windowClass), ("provider", "UIAutomation"));
            return null;
        }

        var providerStarted = Stopwatch.GetTimestamp();
        attempt?.Record("EXPLORER_CAPTURE_STARTED", "STARTED", timestamp: providerStarted,
            ("foregroundWindowClass", windowClass), ("provider", "ExplorerShell"), ("explorerProviderStartedUtc", DateTimeOffset.UtcNow.ToString("O")));
        object? shell = null; object? windows = null; object? firstBrowser = null;
        object? document = null; object? selected = null;
        var stage = "SHELL_APPLICATION";
        try
        {
            var type = Type.GetTypeFromProgID("Shell.Application");
            cancellation.ThrowIfCancellationRequested();
            if (type is null)
            {
                attempt?.Record("EXPLORER_SHELL_ENUMERATION", "FAILED", "SHELL_APPLICATION_UNAVAILABLE");
                attempt?.Record("EXPLORER_PROVIDER_COMPLETED", "FALLBACK", "SHELL_APPLICATION_UNAVAILABLE");
                return null;
            }
            shell = Activator.CreateInstance(type);
            if (shell is null)
            {
                attempt?.Record("EXPLORER_SHELL_ENUMERATION", "FAILED", "SHELL_APPLICATION_UNAVAILABLE");
                attempt?.Record("EXPLORER_PROVIDER_COMPLETED", "FALLBACK", "SHELL_APPLICATION_UNAVAILABLE");
                return null;
            }

            stage = "SHELL_WINDOWS_ENUMERATION";
            windows = ((dynamic)shell).Windows();
            cancellation.ThrowIfCancellationRequested();
            var totalCandidates = Convert.ToInt32(((dynamic)windows).Count);
            var candidateCount = Math.Min(64, totalCandidates);
            var matchingCount = 0;
            var firstMatchIndex = -1;
            stage = "SHELL_WINDOW_CANDIDATE";
            for (var index = 0; index < candidateCount; index++)
            {
                cancellation.ThrowIfCancellationRequested();
                cancellation.ThrowIfCancellationRequested();
                object? browser = null;
                try
                {
                    browser = ((dynamic)windows).Item(index);
                    if (browser is null || new IntPtr(Convert.ToInt64(((dynamic)browser).HWND)) != foreground) continue;
                    matchingCount++;
                    if (firstBrowser is null) { firstBrowser = browser; browser = null; firstMatchIndex = index; }
                }
                finally { Release(browser); }
            }
            attempt?.Record("EXPLORER_SHELL_ENUMERATION", "SUCCESS", timestamp: Stopwatch.GetTimestamp(),
                ("shellEnumeration", "success"), ("shellWindowsCandidateCount", totalCandidates.ToString()), ("shellCandidatesEnumerated", candidateCount.ToString()));
            attempt?.Record(firstBrowser is null ? "EXPLORER_WINDOW_NOT_MATCHED" : "EXPLORER_WINDOW_MATCHED",
                firstBrowser is null ? "NOT_FOUND" : "FOUND", firstBrowser is null ? "NO_MATCHING_HWND" : null,
                timestamp: Stopwatch.GetTimestamp(), ("matchingHwndCandidateCount", matchingCount.ToString()),
                ("candidateIndex", firstMatchIndex.ToString()), ("documentAvailable", (firstBrowser is not null).ToString().ToLowerInvariant()));
            if (firstBrowser is null)
            {
                attempt?.Record("EXPLORER_PROVIDER_COMPLETED", "FALLBACK", "NO_MATCHING_HWND");
                return null;
            }
            attempt?.Record("ACTIVE_TAB_IDENTITY_UNAVAILABLE", "UNAVAILABLE", "SHELL_TAB_IDENTITY_NOT_EXPOSED", timestamp: Stopwatch.GetTimestamp(),
                ("activeTabIdentity", "unavailable"), ("candidateIndex", firstMatchIndex.ToString()));

            stage = "SHELL_DOCUMENT";
            document = ((dynamic)firstBrowser).Document;
            if (document is null)
            {
                attempt?.Record("EXPLORER_DOCUMENT", "FAILED", "DOCUMENT_UNAVAILABLE", timestamp: Stopwatch.GetTimestamp(),
                    ("documentAvailable", "false"));
                attempt?.Record("EXPLORER_PROVIDER_COMPLETED", "FALLBACK", "DOCUMENT_UNAVAILABLE");
                return null;
            }
            attempt?.Record("EXPLORER_DOCUMENT", "SUCCESS", timestamp: Stopwatch.GetTimestamp(), ("documentAvailable", "true"));

            stage = "SELECTED_ITEMS_CALL";
            cancellation.ThrowIfCancellationRequested();
            selected = ((dynamic)document).SelectedItems();
            attempt?.Record("EXPLORER_SELECTED_ITEMS_CALL", "SUCCESS", timestamp: Stopwatch.GetTimestamp(), ("selectedItemsCall", "success"));
            stage = "SELECTED_ITEMS_COUNT";
            var length = Convert.ToInt32(((dynamic)selected).Count);
            attempt?.Record("EXPLORER_SELECTED_ITEMS_COUNT", "SUCCESS", timestamp: Stopwatch.GetTimestamp(), ("selectedItemsCount", length.ToString()));
            if (length == 0)
            {
                var folder = CaptureCurrentFolder(document, attempt, cancellation);
                attempt?.Record("EXPLORER_PROVIDER_COMPLETED", folder.Context.Mode == SurfaceContextMode.ExplorerFolder ? "SUCCESS" : "FAILED",
                    folder.ReasonCode, timestamp: Stopwatch.GetTimestamp(),
                    ("currentFolderMetadataAvailable", (folder.Context.ExplorerFolder is not null).ToString().ToLowerInvariant()));
                return folder;
            }
            stage = "SELECTED_ITEM_CLASSIFICATION";
            return SelectionCapturePayloads.FromFilesystemItems(selected, length, attempt, cancellation: cancellation);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error)
        {
            var reason = stage switch
            {
                "SHELL_WINDOWS_ENUMERATION" or "SHELL_WINDOW_CANDIDATE" => "SHELL_ENUMERATION_EXCEPTION",
                "SHELL_DOCUMENT" => "SHELL_DOCUMENT_EXCEPTION",
                "SELECTED_ITEMS_CALL" or "SELECTED_ITEMS_COUNT" => "SELECTED_ITEMS_EXCEPTION",
                "SELECTED_ITEM_CLASSIFICATION" => "ITEM_CLASSIFICATION_EXCEPTION",
                _ => "SHELL_PROVIDER_EXCEPTION"
            };
            attempt?.Record(reason == "SELECTED_ITEMS_EXCEPTION" ? "EXPLORER_SELECTED_ITEMS_EXCEPTION" : "EXPLORER_EXCEPTION",
                "FAILED", reason, timestamp: Stopwatch.GetTimestamp(), ("exceptionType", error.GetType().Name), ("hresult", FormatHresult(error.HResult)), ("provider", "ExplorerShell"));
            attempt?.Record("EXPLORER_PROVIDER_COMPLETED", "FALLBACK", reason, timestamp: Stopwatch.GetTimestamp(),
                ("providerCompletedUtc", DateTimeOffset.UtcNow.ToString("O")));
            return null;
        }
        finally { Release(selected); Release(document); Release(firstBrowser); Release(windows); Release(shell); }
    }

    private static SelectionCaptureResult CaptureCurrentFolder(object document, SelectionDiagnosticAttempt? attempt, CancellationToken cancellation)
    {
        object? folder = null; object? self = null;
        try
        {
            cancellation.ThrowIfCancellationRequested();
            folder = ((dynamic)document).Folder;
            cancellation.ThrowIfCancellationRequested();
            self = ((dynamic)folder).Self;
            cancellation.ThrowIfCancellationRequested();
            if (!Convert.ToBoolean(((dynamic)self).IsFileSystem))
            {
                attempt?.Record("EXPLORER_CURRENT_FOLDER", "REJECTED", "CURRENT_FOLDER_NOT_FILESYSTEM", timestamp: Stopwatch.GetTimestamp(),
                    ("currentFolderMetadataAvailable", "false"), ("isFileSystem", "false"));
                return new(SelectionContext.None("当前视图不是文件系统文件夹"), "CURRENT_FOLDER_NOT_FILESYSTEM");
            }
            var path = Convert.ToString(((dynamic)self).Path) ?? "";
            cancellation.ThrowIfCancellationRequested();
            if (path.Length > 2048 || !Path.IsPathFullyQualified(path))
            {
                attempt?.Record("EXPLORER_CURRENT_FOLDER", "REJECTED", "CURRENT_FOLDER_PATH_INVALID", timestamp: Stopwatch.GetTimestamp(),
                    ("currentFolderMetadataAvailable", "false"), ("pathValidation", "failed"));
                return new(SelectionContext.None("当前文件夹未提供有效路径"), "CURRENT_FOLDER_PATH_INVALID");
            }
            var name = Convert.ToString(((dynamic)self).Name) ?? Path.GetFileName(path.TrimEnd('\\', '/'));
            var context = new SelectionContext(null, "当前 Explorer 文件夹 · 仅用于面板展示") { ExplorerFolder = new(path, name) };
            attempt?.Record("EXPLORER_CURRENT_FOLDER", "AVAILABLE", "SELECTED_ITEMS_COUNT_ZERO", timestamp: Stopwatch.GetTimestamp(),
                ("currentFolderMetadataAvailable", "true"), ("pathValidation", "accepted"));
            return new(context, "SELECTED_ITEMS_COUNT_ZERO");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error)
        {
            attempt?.Record("EXPLORER_CURRENT_FOLDER", "FAILED", "CURRENT_FOLDER_EXCEPTION", timestamp: Stopwatch.GetTimestamp(),
                ("currentFolderMetadataAvailable", "false"), ("exceptionType", error.GetType().Name), ("hresult", FormatHresult(error.HResult)));
            return new(SelectionContext.None("当前文件夹读取失败"), "CURRENT_FOLDER_EXCEPTION");
        }
        finally { Release(self); Release(folder); }
    }

    private static string GetWindowClassName(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return "none";
        var value = new StringBuilder(256);
        _ = GetClassName(hwnd, value, value.Capacity);
        return value.Length == 0 ? "unknown" : value.ToString();
    }

    private static string GetProcessBasename(uint processId)
    {
        if (processId == 0) return "unknown";
        try { using var process = Process.GetProcessById(unchecked((int)processId)); return process.ProcessName + ".exe"; }
        catch { return "unavailable"; }
    }

    private static string FormatHwnd(IntPtr hwnd) => $"0x{hwnd.ToInt64():X}";
    private static string FormatHresult(int value) => $"0x{value:X8}";
    private static void Release(object? value) { if (value is not null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
}

internal sealed record SelectionCaptureResult(SelectionContext Context, string ReasonCode, bool TimedOut = false, bool WorkerRunning = false,
    SelectionCaptureOutcome Outcome = SelectionCaptureOutcome.Unavailable, bool TextCaptureFailed = false);
