using System.Runtime.InteropServices;
using System.Text;
using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.SuperPanel;

/// <summary>One user-triggered application Copy. Never reads an unchanged clipboard or runs while idle.</summary>
internal static class CopyTextCaptureProvider
{
    private const uint UnicodeText = 13;
    private const int MaximumCharacters = 3000;

    internal static SelectionCaptureResult Capture(CaptureInvocation invocation, SelectionDiagnosticAttempt? attempt)
    {
        attempt?.Record("COPY_CAPTURE_STARTED", "STARTED", ("provider", "ApplicationCopy"));
        using var clipboard = new ClipboardTransaction();
        if (!clipboard.IsAvailable) return Failed("COPY_CLIPBOARD_WINDOW_FAILED", "无法准备文字捕获，请重试。");
        uint initialSequence;
        // A fresh window station can have sequence 0. Opening, not the counter value, proves access.
        while (!clipboard.TryReadSequence(out initialSequence))
        {
            EnsureCurrent(invocation);
            if (invocation.Remaining <= TimeSpan.Zero)
                return Failed("COPY_CLIPBOARD_UNAVAILABLE", "当前无法打开剪贴板，请稍后重试。");
            WaitForUpdate(invocation);
        }
        clipboard.TryBackup(initialSequence);
        uint resultSequence = 0;
        try
        {
            EnsureCurrent(invocation);
            if (Native.GetClipboardSequenceNumber() != initialSequence)
                return Failed("COPY_CLIPBOARD_CHANGED_BEFORE_INPUT", "剪贴板正在变化，请重新唤出。");
            if (IsNativePassword(invocation.FocusWindow))
                return NoText("PASSWORD_CONTROL", SelectionCaptureOutcome.SafetyRejected);
            if (invocation.Remaining <= TimeSpan.Zero)
                return Failed("COPY_RESULT_TIMEOUT", "本次捕获已超时，请重试。", SelectionCaptureOutcome.TimedOut);
            // Console Ctrl+C can interrupt a running command. These native host classes use Copy's Ctrl+Insert chord.
            var copyKey = invocation.WindowClass is "ConsoleWindowClass" or "CASCADIA_HOSTING_WINDOW_CLASS" ? (ushort)0x2D : (ushort)0x43;
            if (!SendCopy(copyKey)) return Failed("COPY_INPUT_NOT_SENT", "无法向当前应用发送复制操作，请检查按键或应用权限。");
            invocation.MarkCopyInjected();
            attempt?.Record("COPY_INPUT_SENT", "SUCCESS", ("copyInjected", "true"));

            if (!WaitForCopyResponse(invocation, initialSequence, Native.GetClipboardSequenceNumber, () => EnsureCurrent(invocation)))
                return NoText("COPY_NO_TEXT_UPDATE");

            while (invocation.Remaining > TimeSpan.Zero)
            {
                EnsureCurrent(invocation);
                if (Native.GetClipboardSequenceNumber() != initialSequence && clipboard.TryOpen())
                {
                    try
                    {
                        var sequence = Native.GetClipboardSequenceNumber();
                        if (sequence == initialSequence) continue;
                        var owner = Native.GetClipboardOwner();
                        _ = Native.GetWindowThreadProcessId(owner, out var ownerProcess);
                        // A clipboard manager or unrelated writer is not proof of a selection in the target.
                        // Null/cross-process owners are deliberately reported as ambiguous, not guessed by app name.
                        if (owner == IntPtr.Zero || ownerProcess != invocation.ProcessId)
                            return Failed("COPY_OWNER_UNVERIFIED", "无法确认复制结果来自当前应用，请重试。");
                        resultSequence = sequence;
                        invocation.MarkCopyResultObserved();
                        attempt?.Record("COPY_CLIPBOARD_UPDATED", "SUCCESS",
                            ("clipboardUpdated", "true"), ("clipboardOwnerMatch", "true"));
                        if (!Native.IsClipboardFormatAvailable(UnicodeText))
                            return NoText("COPY_NON_TEXT_RESULT");
                        var value = ReadText(out var limited);
                        EnsureCurrent(invocation);
                        if (value is null)
                            return Failed("COPY_TEXT_UNREADABLE", "复制结果暂时无法读取，请重试。");
                        // Rendering a delayed format can itself advance the sequence while our lock is held.
                        // Accept that rendering only while the same target owner still owns the clipboard.
                        var renderedSequence = Native.GetClipboardSequenceNumber();
                        if (Native.GetClipboardOwner() != owner)
                            return Failed("COPY_RESULT_CHANGED", "复制结果已变化，请重新唤出。");
                        resultSequence = renderedSequence;
                        if (string.IsNullOrWhiteSpace(value))
                            return NoText("COPY_EMPTY_RESULT", SelectionCaptureOutcome.ConfirmedEmpty);
                        clipboard.Close();
                        var restoration = clipboard.RestoreIfCurrent(resultSequence, invocation);
                        resultSequence = 0; // Restoration has been decided once; finally must not repeat it.
                        attempt?.Record("COPY_CLIPBOARD_RESTORATION", "COMPLETE", ("clipboardRestoration", restoration));
                        EnsureCurrent(invocation);
                        var hint = restoration == "restored" ? "临时捕获 · 原剪贴板已恢复"
                            : "临时捕获 · 原剪贴板未恢复，复制结果由系统剪贴板管理";
                        var result = SelectionCapturePayloads.FromSelectedText(value, limited, attempt, hint);
                        return result with
                        {
                            Context = result.Context with { CaptureNotice = restoration == "restored" ? null : "未恢复原剪贴板；复制结果仍在系统剪贴板中。" },
                            ReasonCode = result.Context.Mode == SurfaceContextMode.SelectedText ? "COPY_TEXT_CAPTURED" : result.ReasonCode,
                            Outcome = result.Context.Mode == SurfaceContextMode.SelectedText ? SelectionCaptureOutcome.SelectedText : result.Outcome,
                            TextCaptureFailed = result.Context.Mode != SurfaceContextMode.SelectedText,
                        };
                    }
                    finally { clipboard.Close(); }
                }
                // Poll only inside this bounded transaction. The sequence change, not elapsed sleep, admits a result.
                WaitForUpdate(invocation);
            }
            // Copy alone cannot distinguish no selection from an application that did not publish a result.
            // Fall back to general actions without reading the previous clipboard or retrying Copy.
            return NoText("COPY_NO_TEXT_UPDATE", SelectionCaptureOutcome.TimedOut);
        }
        finally
        {
            clipboard.Close();
            if (resultSequence != 0)
            {
                var restoration = clipboard.RestoreIfCurrent(resultSequence, invocation);
                attempt?.Record("COPY_CLIPBOARD_RESTORATION", "COMPLETE", ("clipboardRestoration", restoration));
            }
            else if (invocation.CopyInjected && invocation.Token.IsCancellationRequested && !invocation.CopyResultObserved)
            {
                // Sent input cannot be retracted. On dismissal/focus change, retain this worker's
                // lease briefly for owner-verified cleanup; never read text or present a late result.
                var restoration = clipboard.RestorePendingCopy(initialSequence, invocation);
                attempt?.Record("COPY_CLIPBOARD_RESTORATION", "COMPLETE", ("clipboardRestoration", restoration));
            }
        }
    }

    private static SelectionCaptureResult Failed(string reason, string hint, SelectionCaptureOutcome outcome = SelectionCaptureOutcome.Unavailable) =>
        new(SelectionContext.None(hint), reason, TimedOut: outcome == SelectionCaptureOutcome.TimedOut,
            Outcome: outcome, TextCaptureFailed: true);
    private static SelectionCaptureResult NoText(string reason, SelectionCaptureOutcome outcome = SelectionCaptureOutcome.Unavailable) =>
        new(SelectionContext.None(), reason, TimedOut: outcome == SelectionCaptureOutcome.TimedOut, Outcome: outcome);

    internal static bool WaitForCopyResponse(CaptureInvocation invocation, uint initialSequence,
        Func<uint> readSequence, Action ensureCurrent)
    {
        // The UI checkpoint does not end this transaction. A slower Copy can still be
        // attributed/read/restored within the original total invocation budget.
        while (invocation.Remaining > TimeSpan.Zero)
        {
            ensureCurrent();
            if (readSequence() != initialSequence) return true;
            WaitForUpdate(invocation);
        }
        return false;
    }

    internal static string WaitForCopyCleanup(CaptureInvocation invocation, uint initialSequence,
        Func<uint> readSequence, Func<uint, string?> restoreTargetCopy)
    {
        while (invocation.Remaining > TimeSpan.Zero && !invocation.PhysicalInputChanged)
        {
            var sequence = readSequence();
            if (sequence != initialSequence && restoreTargetCopy(sequence) is { } result) return result;
            // Cancellation revokes presentation, not the already injected application's write.
            // Poll only until this same invocation's deadline; new physical input wins immediately.
            Thread.Sleep(TimeSpan.FromMilliseconds(Math.Max(1, Math.Min(8, invocation.Remaining.TotalMilliseconds))));
        }
        return invocation.PhysicalInputChanged ? "new-user-input" : "no-update-within-budget";
    }

    private static void WaitForUpdate(CaptureInvocation invocation)
    {
        if (invocation.Token.WaitHandle.WaitOne(TimeSpan.FromMilliseconds(Math.Max(0, Math.Min(8, invocation.Remaining.TotalMilliseconds)))))
            invocation.Token.ThrowIfCancellationRequested();
    }

    private static void EnsureCurrent(CaptureInvocation invocation)
    {
        invocation.Token.ThrowIfCancellationRequested();
        if (!invocation.IsNativeFocusCurrent()) { invocation.Cancel("focus-changed"); invocation.Token.ThrowIfCancellationRequested(); }
    }

    private static string? ReadText(out bool limited)
    {
        limited = false;
        var handle = Native.GetClipboardData(UnicodeText);
        if (handle == IntPtr.Zero) return null;
        var bytes = Native.GlobalSize(handle).ToUInt64();
        var length = (int)Math.Min(bytes / 2, MaximumCharacters + 1UL);
        if (length == 0) return null;
        var pointer = Native.GlobalLock(handle);
        if (pointer == IntPtr.Zero) return null;
        try
        {
            var text = Marshal.PtrToStringUni(pointer, length) ?? "";
            var terminator = text.IndexOf('\0');
            if (terminator >= 0) text = text[..terminator];
            limited = text.Length > MaximumCharacters;
            if (limited) text = text[..MaximumCharacters];
            if (text.Length > 0 && char.IsHighSurrogate(text[^1])) text = text[..^1];
            return text;
        }
        finally { _ = Native.GlobalUnlock(handle); }
    }

    private static bool IsNativePassword(IntPtr focus)
    {
        if (focus == IntPtr.Zero) return false;
        var name = new StringBuilder(64);
        _ = Native.GetClassName(focus, name, name.Capacity);
        return name.ToString().Equals("Edit", StringComparison.OrdinalIgnoreCase)
            && (Native.GetWindowLongPtr(focus, -16).ToInt64() & 0x20) != 0;
    }

    private static bool SendCopy(ushort copyKey)
    {
        // Do not transform a held Shift/Alt/Win into a different application command or release user-owned keys.
        if (new[] { 0x10, 0x12, 0x5B, 0x5C, (int)copyKey }.Any(IsDown)) return false;
        var injectControl = !IsDown(0x11);
        var inputs = injectControl
            ? new[] { Key(0x11), Key(copyKey), Key(copyKey, true), Key(0x11, true) }
            : new[] { Key(copyKey), Key(copyKey, true) };
        var sent = Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());
        if (sent == inputs.Length) return true;
        // A partial injection must not leave our Copy key/Control down. Never release user-owned Control.
        var releases = new List<Input>();
        if (sent >= (injectControl ? 2 : 1)) releases.Add(Key(copyKey, true));
        if (injectControl && sent >= 1) releases.Add(Key(0x11, true));
        if (releases.Count > 0) _ = Native.SendInput((uint)releases.Count, releases.ToArray(), Marshal.SizeOf<Input>());
        return false;
    }
    private static bool IsDown(int key) => (Native.GetAsyncKeyState(key) & 0x8000) != 0;
    private static Input Key(ushort key, bool up = false) => new()
    { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = key, Flags = up ? 2u : 0u } } };

    private sealed class ClipboardTransaction : IDisposable
    {
        private const int MaximumBackupBytes = 8 * 1024 * 1024;
        private const int MaximumFormats = 64;
        private readonly IntPtr _window = Native.CreateWindowEx(0, "STATIC", "WebTools Copy Capture", 0,
            0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, Native.GetModuleHandle(null), IntPtr.Zero);
        private readonly List<(uint Format, byte[] Bytes)> _backup = [];
        private bool _open, _restorable;
        internal bool IsAvailable => _window != IntPtr.Zero;
        internal bool TryOpen() => _open || (_open = Native.OpenClipboard(_window));
        internal void Close() { if (_open) { _ = Native.CloseClipboard(); _open = false; } }
        internal bool TryReadSequence(out uint sequence)
        {
            sequence = 0;
            if (!TryOpen()) return false;
            try { sequence = Native.GetClipboardSequenceNumber(); return true; }
            finally { Close(); }
        }

        internal void TryBackup(uint expectedSequence)
        {
            if (!TryOpen()) return;
            try
            {
                if (Native.GetClipboardSequenceNumber() != expectedSequence) return;
                var owner = Native.GetClipboardOwner();
                _ = Native.GetWindowThreadProcessId(owner, out var ownerProcess);
                // Foreign-owned original data can be delayed-rendered. Do not invoke it merely for a backup.
                // This is an incomplete backup, so the approved policy is to continue capture without rollback.
                if (owner != IntPtr.Zero && ownerProcess != Environment.ProcessId) return;
                Marshal.SetLastPInvokeError(0);
                var count = Native.CountClipboardFormats();
                if (count is < 0 or > MaximumFormats || count == 0 && Marshal.GetLastPInvokeError() != 0) return;
                var total = 0; uint format = 0;
                for (var i = 0; i < count; i++)
                {
                    format = Native.EnumClipboardFormats(format);
                    if (format == 0 || !IsFlatFormat(format)) return;
                    var handle = Native.GetClipboardData(format);
                    var size = handle == IntPtr.Zero ? 0UL : Native.GlobalSize(handle).ToUInt64();
                    if (size == 0 || size > (ulong)(MaximumBackupBytes - total)) return;
                    var pointer = Native.GlobalLock(handle);
                    if (pointer == IntPtr.Zero) return;
                    var bytes = new byte[(int)size];
                    try { Marshal.Copy(pointer, bytes, 0, bytes.Length); }
                    finally { _ = Native.GlobalUnlock(handle); }
                    _backup.Add((format, bytes)); total += bytes.Length;
                }
                _restorable = Native.CountClipboardFormats() == count && Native.GetClipboardSequenceNumber() == expectedSequence;
            }
            catch (Exception)
            {
                // Backup is optional. A failed preservation attempt must not reject the application's Copy.
                _restorable = false;
                foreach (var entry in _backup) Array.Clear(entry.Bytes);
                _backup.Clear();
            }
            finally { Close(); }
        }

        private static bool IsFlatFormat(uint format) => format is 1 or 7 or 8 or 13 or 15 or 16 or 17;

        internal string RestorePendingCopy(uint initialSequence, CaptureInvocation invocation)
        {
            if (!_restorable) return "backup-unavailable";
            return WaitForCopyCleanup(invocation, initialSequence, Native.GetClipboardSequenceNumber, sequence =>
            {
                if (!TryOpen()) return null;
                try
                {
                    if (Native.GetClipboardSequenceNumber() != sequence) return null;
                    var owner = Native.GetClipboardOwner();
                    _ = Native.GetWindowThreadProcessId(owner, out var ownerProcess);
                    if (owner == IntPtr.Zero || ownerProcess != invocation.ProcessId) return "owner-unverified";
                }
                finally { Close(); }
                var restoration = RestoreIfCurrent(sequence, invocation);
                return restoration == "clipboard-busy" ? null : restoration;
            });
        }

        internal string RestoreIfCurrent(uint sequence, CaptureInvocation invocation)
        {
            if (!_restorable) return "backup-unavailable";
            // A physical keyboard action may be a new user Copy whose clipboard write has not arrived yet.
            if (invocation.PhysicalInputChanged) return "new-user-input";
            var handles = new List<(uint Format, IntPtr Handle)>();
            try
            {
                // Allocate everything before emptying the clipboard; allocation failure must leave it untouched.
                foreach (var entry in _backup)
                {
                    var handle = Native.GlobalAlloc(2, (UIntPtr)(uint)entry.Bytes.Length);
                    if (handle == IntPtr.Zero) return "allocation-failed";
                    handles.Add((entry.Format, handle));
                    var pointer = Native.GlobalLock(handle);
                    if (pointer == IntPtr.Zero) return "allocation-failed";
                    try { Marshal.Copy(entry.Bytes, 0, pointer, entry.Bytes.Length); }
                    finally { _ = Native.GlobalUnlock(handle); }
                }
                if (!TryOpen()) return "clipboard-busy";
                if (Native.GetClipboardSequenceNumber() != sequence || invocation.PhysicalInputChanged) return "newer-update";
                if (!Native.EmptyClipboard()) return "restore-failed";
                var complete = true;
                for (var i = 0; i < handles.Count; i++)
                {
                    var entry = handles[i];
                    if (Native.SetClipboardData(entry.Format, entry.Handle) == IntPtr.Zero) complete = false;
                    else handles[i] = (entry.Format, IntPtr.Zero); // Windows owns this allocation now.
                }
                return complete ? "restored" : "restore-incomplete";
            }
            finally
            {
                Close();
                foreach (var entry in handles) if (entry.Handle != IntPtr.Zero) _ = Native.GlobalFree(entry.Handle);
            }
        }

        public void Dispose()
        {
            Close();
            foreach (var entry in _backup) Array.Clear(entry.Bytes);
            _backup.Clear();
            if (_window != IntPtr.Zero) _ = Native.DestroyWindow(_window);
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput
    { public ushort VirtualKey, ScanCode; public uint Flags, Time; public UIntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput
    { public int X, Y; public uint Data, Flags, Time; public UIntPtr ExtraInfo; }

    private static class Native
    {
        [DllImport("user32.dll")] internal static extern uint GetClipboardSequenceNumber();
        [DllImport("user32.dll")] internal static extern IntPtr GetClipboardOwner();
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool OpenClipboard(IntPtr window);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseClipboard();
        [DllImport("user32.dll", SetLastError = true)] internal static extern int CountClipboardFormats();
        [DllImport("user32.dll")] internal static extern uint EnumClipboardFormats(uint format);
        [DllImport("user32.dll")] internal static extern IntPtr GetClipboardData(uint format);
        [DllImport("user32.dll")] internal static extern IntPtr SetClipboardData(uint format, IntPtr memory);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool EmptyClipboard();
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsClipboardFormatAvailable(uint format);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalLock(IntPtr memory);
        [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GlobalUnlock(IntPtr memory);
        [DllImport("kernel32.dll")] internal static extern UIntPtr GlobalSize(IntPtr memory);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalFree(IntPtr memory);
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll", SetLastError = true)] internal static extern uint SendInput(uint count, Input[] inputs, int size);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] internal static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
        [DllImport("user32.dll", EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, StringBuilder name, int size);
        [DllImport("user32.dll", EntryPoint = "CreateWindowExW", CharSet = CharSet.Unicode)] internal static extern IntPtr CreateWindowEx(uint extendedStyle,
            string className, string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool DestroyWindow(IntPtr window);
        [DllImport("kernel32.dll", EntryPoint = "GetModuleHandleW", CharSet = CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string? name);
    }
}
