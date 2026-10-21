using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace WebTools.NativeHost.Services;

internal static class NativeWindowHandoff
{
    internal static void Focus(IntPtr target) => _ = SetForegroundWindow(target);
    // The handle is used for this one authenticated request only; NativeHost does
    // not retain a plugin identity or manage its subsequent window lifecycle.
    internal static bool ShowAndHide(Window surface, IntPtr target, int expectedProcessId)
    {
        GetWindowThreadProcessId(target, out var processId);
        if (processId != expectedProcessId || !IsWindow(target)) return false;
        // The target page is already ready in its hidden Electron HWND.
        // Reveal it in the same deferred window batch as WPF's hide.
        if (!SetLayeredWindowAttributes(target, 0, byte.MaxValue, 0x0002)) return false;
        var disableTransitions = 1;
        _ = DwmSetWindowAttribute(target, 3, ref disableTransitions, sizeof(int));
        if (IsIconic(target)) ShowWindow(target, 4); // restore without activation
        var batch = BeginDeferWindowPos(2);
        if (batch == IntPtr.Zero) return false;
        batch = DeferWindowPos(batch, target, IntPtr.Zero, 0, 0, 0, 0, 0x0010 | 0x0001 | 0x0002 | 0x0040);
        if (batch == IntPtr.Zero) return false;
        batch = DeferWindowPos(batch, new WindowInteropHelper(surface).Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0010 | 0x0001 | 0x0002 | 0x0004 | 0x0080);
        return batch != IntPtr.Zero && EndDeferWindowPos(batch);
    }
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern IntPtr BeginDeferWindowPos(int count);
    [DllImport("user32.dll")] private static extern IntPtr DeferWindowPos(IntPtr batch, IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool EndDeferWindowPos(IntPtr batch);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetLayeredWindowAttributes(IntPtr window, uint colorKey, byte alpha, uint flags);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}
