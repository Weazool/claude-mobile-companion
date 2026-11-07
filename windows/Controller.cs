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
        readonly Timer timer = new Timer { Interval = 100 };
        bool loaded, loading;
        DateTime nextTry = DateTime.MinValue;

        public Controller()
        {
            corner.Message += _ => { }; // 'click' / 'menu' are consumed in later tasks
            var _h = corner.Handle;     // create the window now so WebView2 can init while hidden
            timer.Tick += (_, __) => Tick();
            timer.Start();
        }

        public void Tick()
        {
            Load();

            var tb = Taskbar.Read();
            if (tb == null || tb.AutoHide)
            {
                if (corner.Visible) corner.Hide();
                return;
            }

            var want = Placement.Corner(tb);
            if (corner.Bounds != want) corner.Bounds = want;
            if (!corner.Visible) corner.Show();
            // A click on the taskbar raises it above us; take the top back without stealing focus.
            SetWindowPos(corner.Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        async void Load()
        {
            if (loaded || loading || DateTime.Now < nextTry) return;
            string? b = Dashboard.BaseUrl();
            if (b == null) { nextTry = DateTime.Now.AddSeconds(5); return; }
            loading = true;
            try { await corner.InitAsync(b + "?corner"); loaded = true; }
            catch (Exception) { nextTry = DateTime.Now.AddSeconds(5); }
            finally { loading = false; }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { timer.Dispose(); corner.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
