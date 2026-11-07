using System;
using System.Drawing;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace DeskCompanionTaskbar
{
    class TaskbarInfo
    {
        public Rectangle Bounds;
        public bool AutoHide;
        public bool LeftAligned;
        public Rectangle? Tray;
    }

    static class Taskbar
    {
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        struct APPBARDATA
        {
            public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge;
            public RECT rc; public IntPtr lParam;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string? title);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string? title);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);

        [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

        const uint ABM_GETSTATE = 4;
        const int ABS_AUTOHIDE = 1;

        // A full-screen game or video, a presentation, or any "busy" full-screen app: Clawd steps aside.
        public static bool FullscreenBusy()
        {
            const int QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3, QUNS_PRESENTATION_MODE = 4;
            if (SHQueryUserNotificationState(out int s) != 0) return false;
            return s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE;
        }

        // Null while Explorer has no taskbar window (restarting).
        public static TaskbarInfo? Read()
        {
            IntPtr tray = FindWindow("Shell_TrayWnd", null);
            if (tray == IntPtr.Zero || !GetWindowRect(tray, out RECT r)) return null;

            var abd = new APPBARDATA { cbSize = Marshal.SizeOf(typeof(APPBARDATA)) };
            bool autoHide = ((int)SHAppBarMessage(ABM_GETSTATE, ref abd).ToUInt32() & ABS_AUTOHIDE) != 0;

            // A missing value means the Windows 11 default: centred.
            bool left = false;
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
                    left = k?.GetValue("TaskbarAl") is int al && al == 0;
            }
            catch (System.Security.SecurityException) { }

            Rectangle? notify = null;
            IntPtr n = FindWindowEx(tray, IntPtr.Zero, "TrayNotifyWnd", null);
            if (n != IntPtr.Zero && GetWindowRect(n, out RECT nr))
                notify = Rectangle.FromLTRB(nr.Left, nr.Top, nr.Right, nr.Bottom);

            return new TaskbarInfo
            {
                Bounds = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom),
                AutoHide = autoHide,
                LeftAligned = left,
                Tray = notify,
            };
        }
    }
}
