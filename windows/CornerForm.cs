using System.Drawing;

namespace DeskCompanionTaskbar
{
    // Transparency branch A: magenta colour key plus a transparent page background.
    class CornerForm : WebForm
    {
        static readonly Color Key = Color.FromArgb(255, 0, 255);

        public CornerForm()
        {
            BackColor = Key;
            TransparencyKey = Key;
        }

        protected override void OnWebReady() => web.DefaultBackgroundColor = Color.Transparent;
    }
}
