using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using WebTools.NativeHost.Interop;
using Forms = System.Windows.Forms;

namespace WebTools.NativeHost.Services;

internal static class MonitorPlacement
{
    internal sealed record FloatingPanelAnchor(double X, double Y, double Left, double Top, double Right, double Bottom, double ScaleX, double ScaleY)
    {
        public double Width => Math.Min(330, Math.Max(1, (Right - Left) / ScaleX - 16));
        public double MaxHeight => Math.Min(560, Math.Max(1, (Bottom - Top) / ScaleY - 16));
    }

    internal static FloatingPanelAnchor CaptureFloatingPanelAnchor()
    {
        if (!NativeMethods.GetCursorPos(out var cursor)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var monitor = NativeMethods.MonitorFromPoint(cursor, NativeMethods.MonitorDefaultToNearest);
        var info = new NativeMethods.MonitorInfo { Size = Marshal.SizeOf<NativeMethods.MonitorInfo>() };
        if (!NativeMethods.GetMonitorInfo(monitor, ref info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        uint x = 96, y = 96;
        try { _ = NativeMethods.GetDpiForMonitor(monitor, NativeMethods.MonitorDpiType.Effective, out x, out y); }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException) { }
        var work = info.WorkArea;
        return new(cursor.X, cursor.Y, work.Left, work.Top, work.Right, work.Bottom, (x == 0 ? 96 : x) / 96d, (y == 0 ? 96 : y) / 96d);
    }

    internal static void PositionFloatingPanel(Window window, FloatingPanelAnchor anchor, double measuredHeight)
    {
        var width = window.Width * anchor.ScaleX;
        var height = Math.Min(measuredHeight, anchor.MaxHeight) * anchor.ScaleY;
        var left = Math.Clamp(anchor.X - width / 2, anchor.Left, Math.Max(anchor.Left, anchor.Right - width));
        var gap = 12 * anchor.ScaleY;
        var below = anchor.Y + gap;
        var top = below + height <= anchor.Bottom ? below : anchor.Y - gap - height;
        top = Math.Clamp(top, anchor.Top, Math.Max(anchor.Top, anchor.Bottom - height));
        window.Left = left / anchor.ScaleX; window.Top = top / anchor.ScaleY;
        var handle = new WindowInteropHelper(window).Handle;
        if (handle != IntPtr.Zero && !NativeMethods.SetWindowPos(handle, HwndTopmost, (int)Math.Round(left), (int)Math.Round(top), 0, 0, SwpNoActivate | SwpNoSize))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not position the Super Panel.");
    }
    private static readonly IntPtr HwndTopmost = new(-1);
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoSize = 0x0001;

    public static void PositionForCursorMonitor(Window window, bool constrainSize = false)
    {
        if (!NativeMethods.GetCursorPos(out var cursor))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not determine the cursor position.");
        }

        var monitor = NativeMethods.MonitorFromPoint(cursor, NativeMethods.MonitorDefaultToNearest);
        var monitorInfo = new NativeMethods.MonitorInfo
        {
            Size = Marshal.SizeOf<NativeMethods.MonitorInfo>(),
        };

        if (monitor == IntPtr.Zero || !NativeMethods.GetMonitorInfo(monitor, ref monitorInfo))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not determine the active display work area.");
        }

        var dpiX = 96u;
        var dpiY = 96u;
        try
        {
            _ = NativeMethods.GetDpiForMonitor(monitor, NativeMethods.MonitorDpiType.Effective, out dpiX, out dpiY);
        }
        catch (DllNotFoundException)
        {
            // Windows versions supported by this PoC include Shcore; 96 DPI is a safe fallback.
        }
        catch (EntryPointNotFoundException)
        {
            // Older platform API fallback.
        }

        if (dpiX == 0 || dpiY == 0)
        {
            dpiX = 96;
            dpiY = 96;
        }

        var scaleX = dpiX / 96d;
        var scaleY = dpiY / 96d;
        var work = monitorInfo.WorkArea;
        var widthPx = Math.Min(window.Width * scaleX, work.Right - work.Left);
        var heightPx = Math.Min(window.Height * scaleY, work.Bottom - work.Top);
        if (constrainSize) { window.Width = widthPx / scaleX; window.Height = heightPx / scaleY; }
        var leftPx = work.Left + ((work.Right - work.Left) - widthPx) / 2;
        var topPx = work.Top + ((work.Bottom - work.Top) * 0.18);
        leftPx = Math.Clamp(leftPx, work.Left, work.Right - widthPx);
        topPx = Math.Clamp(topPx, work.Top, work.Bottom - heightPx);

        window.Left = leftPx / scaleX;
        window.Top = topPx / scaleY;

        var handle = new WindowInteropHelper(window).Handle;
        if (handle != IntPtr.Zero)
        {
            var x = (int)Math.Round(leftPx);
            var y = (int)Math.Round(topPx);
            if (!NativeMethods.SetWindowPos(handle, HwndTopmost, x, y, 0, 0, SwpNoActivate | SwpNoSize))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not position the launcher window.");
            }
        }
    }

    public static IReadOnlyList<string> DescribeDisplays()
    {
        var descriptions = new List<string>();
        foreach (var screen in Forms.Screen.AllScreens)
        {
            var bounds = screen.Bounds;
            var center = new NativeMethods.NativePoint
            {
                X = bounds.Left + bounds.Width / 2,
                Y = bounds.Top + bounds.Height / 2,
            };
            var monitor = NativeMethods.MonitorFromPoint(center, NativeMethods.MonitorDefaultToNearest);
            var dpiX = 96u;
            var dpiY = 96u;
            if (monitor != IntPtr.Zero)
            {
                _ = NativeMethods.GetDpiForMonitor(monitor, NativeMethods.MonitorDpiType.Effective, out dpiX, out dpiY);
            }

            descriptions.Add(
                $"{screen.DeviceName};bounds={bounds};work={screen.WorkingArea};dpi={dpiX}x{dpiY};primary={screen.Primary}");
        }

        return descriptions;
    }
}
