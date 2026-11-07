using System;
using System.Drawing;

namespace DeskCompanionTaskbar
{
    static class Placement
    {
        // Full taskbar height, 1.5x as wide. A centred taskbar leaves the left edge free; with
        // left-aligned icons the corner moves to the tray's side instead.
        public static Rectangle Corner(TaskbarInfo tb)
        {
            int h = tb.Bounds.Height;
            int w = (int)Math.Round(1.5 * h);
            int x = tb.Bounds.Left;
            if (tb.LeftAligned)
                x = tb.Tray is Rectangle t ? t.Left - w : tb.Bounds.Right - tb.Bounds.Width / 4 - w;
            return new Rectangle(x, tb.Bounds.Top, w, h);
        }
    }
}
