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
        // The session chips (strip.html): a see-through window like the corner's, its own click catcher, and the
        // chips' places as the page last sent them.
        readonly CornerForm strip = new CornerForm();
        readonly ClickCatcher stripCatcher = new ClickCatcher();
        bool cornerLoaded, stripLoaded;
        StripMessage stripAt = new StripMessage(); // the chips' places and the menu's sessions, as the page last sent them

        public Controller()
        {
            corner.Message += OnCornerMessage;
            catcher.Message += OnCornerMessage; // real clicks arrive here; the corner itself is click-through
            hover.Message += m => { if (m == "esc") { Unpin(); } };
            strip.Message += OnStripMessage;
            stripCatcher.Message += m => { if (m == "click") OpenChip(stripCatcher.LastX); else if (m == "menu") ShowMenu(); };
            var _h4 = strip.Handle;
            var _h5 = stripCatcher.Handle;
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
            PlaceStrip(want, tb);
            Hover();
        }

        void HideAll()
        {
            if (corner.Visible) corner.Hide();
            if (hover.Visible) hover.Hide();
            if (catcher.Visible) catcher.Hide();
            if (strip.Visible) strip.Hide();
            if (stripCatcher.Visible) stripCatcher.Hide();
        }

        void PlaceStrip(Rectangle cornerAt, TaskbarInfo tb)
        {
            if (stripAt.want <= 0 || !stripLoaded)
            {
                if (strip.Visible) strip.Hide();
                if (stripCatcher.Visible) stripCatcher.Hide();
                return;
            }
            var at = Placement.Strip(cornerAt, tb, stripAt.want);
            foreach (Form f in new Form[] { strip, stripCatcher }) // the catcher on top
            {
                if (f.Bounds != at) f.Bounds = at;
                if (!f.Visible) f.Show();
                SetWindowPos(f.Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }

        void OnStripMessage(string m)
        {
            var msg = StripMessage.Parse(m);
            if (msg != null) stripAt = msg;
        }

        // A chip opens its session (its ✕ clears it); the "+N" chip lists the working sessions without a card.
        void OpenChip(int x)
        {
            if (stripAt.menu != null && x >= stripAt.menu.x0 && x < stripAt.menu.x1) { ShowSessions(); return; }
            foreach (var c in stripAt.chips)
                if (x >= c.x0 && x < c.x1)
                {
                    if (c.closeX >= 0 && x >= c.closeX) strip.PostJson("{\"untrack\":\"" + c.id + "\"}"); // the ✕
                    else if (c.host != null) OpenSession(c.host);
                    return;
                }
        }

        void ShowSessions()
        {
            menu.Items.Clear();
            foreach (var s in stripAt.extra)
            {
                var host = s.host;
                // A terminal session has no desktop id: listed, but it can't be opened from here.
                var item = new ToolStripMenuItem(s.name.Replace("&", "&&") + "  ·  " + s.state) { Enabled = host != null };
                if (host != null) item.Click += (_, __) => OpenSession(host);
                menu.Items.Add(item);
            }
            if (menu.Items.Count > 0) Popup();
        }

        // A click on the corner's Clawd pins the dashboard; the chips open sessions.
        void OnCornerMessage(string m)
        {
            if (m == "click") TogglePin();
            else if (m == "menu") ShowMenu();
        }

        // The Claude desktop app's own link for a Code session; Windows hands it to the app.
        static void OpenSession(string id) => OpenLink("claude://code/continue?session=" + id);

        [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);

        static void OpenLink(string url)
        {
            AllowSetForegroundWindow(-1); // ASFW_ANY: the Claude app may bring its window forward
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception) { /* no Claude app registered for claude:// */ }
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
            Popup();
        }

        void Popup()
        {
            // A menu from a no-activate window only closes on an outside click if one of our windows is
            // foreground; take it for the menu, then give it back to where it was.
            IntPtr prev = GetForegroundWindow();
            SetForegroundWindow(catcher.Handle);
            void Restore(object? s, ToolStripDropDownClosedEventArgs e)
            {
                menu.Closed -= Restore;
                // A picked item may open the Claude app: let it come to the front instead of handing focus back.
                if (e.CloseReason == ToolStripDropDownCloseReason.ItemClicked) return;
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
            strip.Navigate(b + "web/strip.html");
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
                if (!cornerLoaded) { await corner.InitAsync(b + "?corner"); cornerLoaded = true; }
                if (!stripLoaded) { await strip.InitAsync(b + "web/strip.html"); stripLoaded = true; }
                loaded = true; loadedBase = b;
            }
            catch (Exception) { nextTry = DateTime.Now.AddSeconds(5); }
            finally { loading = false; }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { timer.Dispose(); menu.Dispose(); corner.Dispose(); catcher.Dispose(); hover.Dispose(); strip.Dispose(); stripCatcher.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
