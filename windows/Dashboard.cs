using System;
using System.IO;
using System.Text.RegularExpressions;

namespace DeskCompanionTaskbar
{
    static class Dashboard
    {
        // http://localhost:<port>/ from the server's config, or null when it isn't there yet.
        public static string? BaseUrl()
        {
            try
            {
                string? home = Environment.GetEnvironmentVariable("DESK_COMPANION_HOME");
                if (string.IsNullOrEmpty(home)) home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string path = Path.Combine(home, ".desk-companion", "config.json");
                if (!File.Exists(path)) return null;
                var m = Regex.Match(File.ReadAllText(path), "\"port\"\\s*:\\s*(\\d+)");
                return m.Success ? "http://localhost:" + m.Groups[1].Value + "/" : null;
            }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
        }
    }
}
