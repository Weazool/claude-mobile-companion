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

        // The session chips: to the corner's right on a centred taskbar (to its left with left-aligned icons, where
        // the corner sits by the tray), as wide as the chips want, at most 30% of the taskbar; the page fits the rest
        // into a "+N" chip.
        public static Rectangle Strip(Rectangle corner, TaskbarInfo tb, int want)
        {
            int w = Math.Min(want, (int)(tb.Bounds.Width * 0.3));
            int x = tb.LeftAligned ? corner.Left - w : corner.Right;
            return new Rectangle(x, tb.Bounds.Top, w, tb.Bounds.Height);
        }

        // A quarter of the work area wide, 932:430 like the dashboard page; sits on the corner's top-left.
        public static Rectangle Hover(Rectangle corner, Rectangle work)
        {
            int w = (int)Math.Round(work.Width / 4.0);
            int h = (int)Math.Round(w * 430 / 932.0);
            int x = Math.Max(work.Left, Math.Min(corner.Left, work.Right - w));
            int y = Math.Max(work.Top, corner.Top - h);
            return new Rectangle(x, y, w, h);
        }
    }
}
