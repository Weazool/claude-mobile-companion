using System;
using System.Threading;
using System.Windows.Forms;

namespace DeskCompanionTaskbar
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // One copy only; a second start exits quietly.
            bool created;
            using (var mutex = new Mutex(true, @"Local\desk-companion-taskbar", out created))
            {
                if (!created) return;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Controller());
            }
        }
    }
}
