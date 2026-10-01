using System.Runtime.InteropServices;

namespace WebTools.NativeHost.Interop;

internal static class NativeMethods
{
    internal const int WmHotkey = 0x0312;
    internal const int WhKeyboardLl = 13;
    internal const int WmKeyDown = 0x0100;
    internal const int WmKeyUp = 0x0101;
    internal const int WmSysKeyDown = 0x0104;
    internal const int WmSysKeyUp = 0x0105;
    internal const uint VkControl = 0x11;
    internal const uint VkMenu = 0x12;
    internal const uint VkShift = 0x10;
    internal const uint VkLControl = 0xA2;
    internal const uint VkRControl = 0xA3;
    internal const uint VkLMenu = 0xA4;
    internal const uint VkRMenu = 0xA5;
    internal const uint VkLShift = 0xA0;
    internal const uint VkRShift = 0xA1;
    internal const uint VkLWin = 0x5B;
    internal const uint VkRWin = 0x5C;
    internal const int HotkeyId = 0x4B11;
    internal const int AlternateHotkeyId = 0x4B12;
    internal const uint ModAlt = 0x0001;
    internal const uint ModControl = 0x0002;
    internal const uint ModShift = 0x0004;
    internal const uint ModWin = 0x0008;
    internal const uint ModNoRepeat = 0x4000;
    internal const uint VkSpace = 0x20;
    internal const uint MonitorDefaultToNearest = 0x00000002;
    internal const int MonitorInfoPrimary = 0x00000001;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate IntPtr LowLevelKeyboardProc(int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    internal struct LowLevelKeyboardData
    {
        public uint VirtualKey;
        public uint ScanCode;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetWindowsHookEx(int hookId, LowLevelKeyboardProc callback, IntPtr moduleHandle, uint threadId);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    internal static extern IntPtr GetModuleHandle(string? moduleName);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetCursorPos(out NativePoint point);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo monitorInfo);

    [DllImport("shcore.dll")]
    internal static extern int GetDpiForMonitor(IntPtr monitor, MonitorDpiType dpiType, out uint dpiX, out uint dpiY);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct MonitorInfo
    {
        public int Size;
        public NativeRect Monitor;
        public NativeRect WorkArea;
        public int Flags;
    }

    internal enum MonitorDpiType
    {
        Effective = 0,
        Angular = 1,
        Raw = 2,
    }
}
