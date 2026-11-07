using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace DeskCompanionTaskbar
{
    class Controller : ApplicationContext
    {
        [DllImport("user32.dll")]
        static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOACTIVATE = 0x10;

        readonly CornerForm corner = new CornerForm();
        const int OpenAfterMs = 300, CloseAfterMs = 1000;
        readonly ClickCatcher catcher = new ClickCatcher();
        readonly HoverForm hover = new HoverForm();
        bool pinned;
        bool holdClosed; // after an unpin or Esc: no hover-open until the pointer has left Clawd
        DateTime onCornerSince = DateTime.MaxValue, outsideSince = DateTime.MaxValue;
        readonly Timer timer = new Timer { Interval = 100 };
        bool loaded, loading, hoverLoaded;
        DateTime nextTry = DateTime.MinValue, nextPortCheck = DateTime.MinValue;
        string? loadedBase;
        readonly ContextMenuStrip menu = new ContextMenuStrip();

        public Controller()
        {
            corner.Message += OnCornerMessage;
            catcher.Message += OnCornerMessage; // real clicks arrive here; the corner itself is click-through
            hover.Message += m => { if (m == "esc") { Unpin(); } };
            var _h = corner.Handle;     // create the windows now so WebView2 can init while hidden
            var _h2 = hover.Handle;
            var _h3 = catcher.Handle;
            timer.Tick += (_, __) => Tick();
            timer.Start();
        }

        public void Tick()
        {
            Load();
            CheckPort();

            if (Taskbar.FullscreenBusy())
            {
                pinned = false;
                HideAll();
                return;
            }

            var tb = Taskbar.Read();
            if (tb == null || tb.AutoHide)
            {
                pinned = false; // else the next hover-open would never auto-close
                HideAll();
                return;
            }

            var want = Placement.Corner(tb);
            if (corner.Bounds != want) corner.Bounds = want;
            if (!corner.Visible) corner.Show();
            // A click on the taskbar raises it above us; take the top back without stealing focus.
            SetWindowPos(corner.Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            if (catcher.Bounds != want) catcher.Bounds = want;
            if (!catcher.Visible) catcher.Show();
            SetWindowPos(catcher.Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            Hover();
        }

        void HideAll()
        {
            if (corner.Visible) corner.Hide();
            if (hover.Visible) hover.Hide();
            if (catcher.Visible) catcher.Hide();
        }

        void OnCornerMessage(string m)
        {
            if (m == "click") TogglePin();
            else if (m == "menu") ShowMenu();
        }

        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();

        void ShowMenu()
        {
            menu.Items.Clear();
            var pin = new ToolStripMenuItem("Pin") { Checked = pinned };
            pin.Click += (_, __) => TogglePin();
            var auto = new ToolStripMenuItem("Start with Windows") { Checked = Autostart.Status() != "Off" };
            auto.Click += (_, __) => { if (auto.Checked) Autostart.Remove(); else Autostart.Install(); };
            var quit = new ToolStripMenuItem("Quit");
            quit.Click += (_, __) => ExitThread();
            menu.Items.AddRange(new ToolStripItem[] { pin, auto, quit });

            // A menu from a no-activate window only closes on an outside click if one of our windows is
            // foreground; take it for the menu, then give it back to where it was.
            IntPtr prev = GetForegroundWindow();
            SetForegroundWindow(catcher.Handle);
            void Restore(object? s, ToolStripDropDownClosedEventArgs e)
            {
                menu.Closed -= Restore;
                if (prev != IntPtr.Zero && prev != catcher.Handle) SetForegroundWindow(prev);
            }
            menu.Closed += Restore;
            menu.Show(Cursor.Position);
        }

        // The server may come back on another port: point both views at it.
        void CheckPort()
        {
            if (!loaded || DateTime.Now < nextPortCheck) return;
            nextPortCheck = DateTime.Now.AddSeconds(5);
            string? b = Dashboard.BaseUrl();
            if (b == null || b == loadedBase) return;
            loadedBase = b;
            corner.Navigate(b + "?corner");
            hover.Navigate(b + "?pc");
        }

        void Unpin()
        {
            pinned = false;
            holdClosed = true;
            hover.Hide();
        }

        void TogglePin()
        {
            pinned = !pinned;
            if (pinned) ShowHover(); else Unpin();
        }

        void ShowHover()
        {
            var want = Placement.Hover(corner.Bounds, Screen.PrimaryScreen.WorkingArea);
            if (hover.Bounds != want) hover.Bounds = want;
            if (!hover.Visible) hover.Show(); // ShowWithoutActivation: focus stays where it was
            SetWindowPos(hover.Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        // Rest on Clawd 300 ms to open; stay off both windows 1000 ms (and unpinned) to close.
        void Hover()
        {
            if (menu.Visible) return; // re-raising the hover window would cover the menu
            var p = Cursor.Position;
            bool onCorner = corner.Bounds.Contains(p);
            bool inside = onCorner || (hover.Visible && hover.Bounds.Contains(p));
            var now = DateTime.Now;
            if (!onCorner) holdClosed = false;

            if (onCorner) { if (onCornerSince == DateTime.MaxValue) onCornerSince = now; }
            else onCornerSince = DateTime.MaxValue;
            if (inside) outsideSince = DateTime.MaxValue;
            else if (outsideSince == DateTime.MaxValue) outsideSince = now;

            if (!hover.Visible && onCorner && !holdClosed && (now - onCornerSince).TotalMilliseconds >= OpenAfterMs)
                ShowHover();
            else if (hover.Visible && !pinned && !inside && (now - outsideSince).TotalMilliseconds >= CloseAfterMs)
                hover.Hide();
            else if (hover.Visible)
                ShowHover(); // keep placement and z-order current (taskbar/work-area changes)
        }

        async void Load()
        {
            if (loaded || loading || DateTime.Now < nextTry) return;
            string? b = Dashboard.BaseUrl();
            if (b == null) { nextTry = DateTime.Now.AddSeconds(5); return; }
            loading = true;
            try
            {
                if (!hoverLoaded) { await hover.InitAsync(b + "?pc"); hoverLoaded = true; }
                await corner.InitAsync(b + "?corner"); loaded = true; loadedBase = b;
            }
            catch (Exception) { nextTry = DateTime.Now.AddSeconds(5); }
            finally { loading = false; }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { timer.Dispose(); menu.Dispose(); corner.Dispose(); catcher.Dispose(); hover.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
