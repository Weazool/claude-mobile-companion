using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DeskCompanionTaskbar
{
    // Borderless, top-most, never-activating window holding one WebView2 page.
    class WebForm : Form
    {
        const int WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;

        protected readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        public event Action<string>? Message;

        public WebForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Controls.Add(web);
        }

        protected override bool ShowWithoutActivation => true;

        // A window that must take clicks and keys (Esc) once the user clicks into it turns this off.
        protected virtual bool NeverActivate => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_TOOLWINDOW | (NeverActivate ? WS_EX_NOACTIVATE : 0);
                return cp;
            }
        }

        public async Task InitAsync(string url)
        {
            string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "desk-companion", "taskbar", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, data);
            await web.EnsureCoreWebView2Async(env);
            var s = web.CoreWebView2.Settings;
            s.AreDefaultContextMenusEnabled = false;
            s.AreDevToolsEnabled = false;
            s.IsZoomControlEnabled = false;
            web.CoreWebView2.WebMessageReceived += (_, e) =>
            {
                string? m = null;
                try { m = e.TryGetWebMessageAsString(); } catch (ArgumentException) { }
                if (m != null) Message?.Invoke(m);
            };
            OnWebReady();

            // Server not up yet (autostart) or stale port: retry the same URL. After a successful
            // load the page's own JS handles reconnecting.
            var retry = new Timer { Interval = 5000 };
            retry.Tick += (_, __) => { retry.Stop(); web.CoreWebView2?.Navigate(url); };
            web.CoreWebView2.NavigationCompleted += (_, e) =>
            {
                if (!e.IsSuccess && !retry.Enabled) retry.Start();
            };
            web.CoreWebView2.Navigate(url);
        }

        protected virtual void OnWebReady() { }

        public void Navigate(string url) => web.CoreWebView2?.Navigate(url);

        public void PostJson(string json) => web.CoreWebView2?.PostWebMessageAsJson(json);
    }
}
