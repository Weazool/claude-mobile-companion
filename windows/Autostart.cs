using System;
using System.IO;

namespace DeskCompanionTaskbar
{
    // Start with Windows: a shortcut to this exe in the user's Startup folder (mirrors src/server/autostart.mjs).
    static class Autostart
    {
        const string Shortcut = "desk-companion-taskbar.lnk";

        static string Lnk() => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), Shortcut);

        public static (bool ok, string message) Install()
        {
            string lnk = Lnk();
            try
            {
                Type? t = Type.GetTypeFromProgID("WScript.Shell");
                if (t == null) return (false, "The Startup shortcut could not be made: WScript.Shell is not available.");
                dynamic shell = Activator.CreateInstance(t)!;
                dynamic s = shell.CreateShortcut(lnk);
                string exe = System.Windows.Forms.Application.ExecutablePath;
                s.TargetPath = exe;
                s.WorkingDirectory = Path.GetDirectoryName(exe);
                s.Description = "desk-companion taskbar";
                s.Save();
            }
            catch (Exception e) { return (false, "The Startup shortcut could not be made: " + e.Message); }
            if (!File.Exists(lnk)) return (false, "The Startup shortcut could not be made.");
            return (true, "desk-companion-taskbar starts with Windows (" + lnk + ").");
        }

        public static (bool ok, string message) Remove()
        {
            try { File.Delete(Lnk()); } catch (Exception) { /* not there */ }
            return (true, "desk-companion-taskbar no longer starts with Windows.");
        }

        public static string Status() => File.Exists(Lnk()) ? "On: " + Lnk() : "Off";
    }
}
