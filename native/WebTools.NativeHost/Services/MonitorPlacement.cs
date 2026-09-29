using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using WebTools.NativeHost.Interop;
using Forms = System.Windows.Forms;

namespace WebTools.NativeHost.Services;

internal static class MonitorPlacement
{
    private static readonly IntPtr HwndTopmost = new(-1);
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoSize = 0x0001;

    public static void PositionForCursorMonitor(Window window)
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
