using System;
using System.Windows.Forms;

namespace DeskCompanionTaskbar
{
    // The corner's colour key makes it click-through, so this near-invisible window sits on top to
    // take Clawd's clicks. Alpha 1/255 is still hit-testable; it never activates.
    class ClickCatcher : Form
    {
        const int WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
        public event Action<string>? Message;
        public int LastX { get; private set; } // where the last click landed, in the window's pixels (the strip's chips)

        public ClickCatcher()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Opacity = 1.0 / 255;
            MouseUp += (_, e) =>
            {
                LastX = e.X;
                if (e.Button == MouseButtons.Left) Message?.Invoke("click");
                else if (e.Button == MouseButtons.Right) Message?.Invoke("menu");
            };
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE; return cp; }
        }
    }
}
