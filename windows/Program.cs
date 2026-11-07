using System;
using System.Threading;
using System.Windows.Forms;

namespace DeskCompanionTaskbar
{
    static class Program
    {
        [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool AttachConsole(int pid);

        [STAThread]
        static int Main(string[] args)
        {
            // Command line: no UI and no single-instance check, so it works while the program runs.
            if (args.Length > 0 && (args[0] == "--install" || args[0] == "--remove" || args[0] == "--status"))
            {
                AttachConsole(-1); // WinExe: print to the parent console
                if (args[0] == "--status") { Console.WriteLine(Autostart.Status()); return 0; }
                var r = args[0] == "--install" ? Autostart.Install() : Autostart.Remove();
                Console.WriteLine(r.message);
                return r.ok ? 0 : 1;
            }

            // One copy only; a second start exits quietly.
            bool created;
            using (var mutex = new Mutex(true, @"Local\desk-companion-taskbar", out created))
            {
                if (!created) return 0;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Controller());
            }
            return 0;
        }
    }
}
