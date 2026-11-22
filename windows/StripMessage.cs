using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace DeskCompanionTaskbar
{
    // What strip.js sends after each layout: "strip:" + JSON, places in the strip window's pixels. Lower-case names
    // match the page's keys; ids that don't have the shapes below are dropped, so nothing else reaches a link.
    class StripMessage
    {
        public int want { get; set; }
        public List<ChipAt> chips { get; set; } = new List<ChipAt>();
        public Span? menu { get; set; }
        public List<Listed> extra { get; set; } = new List<Listed>(); // the working sessions without a card

        public class ChipAt { public int x0 { get; set; } public int x1 { get; set; } public string? host { get; set; } public int closeX { get; set; } public string id { get; set; } = ""; }
        public class Span { public int x0 { get; set; } public int x1 { get; set; } }
        public class Listed { public string name { get; set; } = ""; public string? host { get; set; } public string state { get; set; } = ""; }

        // The desktop app's own session ids (host.js HOST_ID), and the server's session ids.
        public static readonly Regex HostId = new Regex("^local_[A-Za-z0-9-]{1,64}$");
        static readonly Regex SessionId = new Regex("^[A-Za-z0-9-]{1,80}$");

        public static StripMessage? Parse(string m)
        {
            if (!m.StartsWith("strip:")) return null;
            StripMessage? msg;
            try { msg = new JavaScriptSerializer().Deserialize<StripMessage>(m.Substring(6)); }
            catch (System.Exception) { return null; }
            if (msg == null) return null;
            msg.chips ??= new List<ChipAt>();
            msg.extra ??= new List<Listed>();
            msg.chips.RemoveAll(c => c == null || c.id == null || !SessionId.IsMatch(c.id));
            foreach (var c in msg.chips) if (c.host != null && !HostId.IsMatch(c.host)) c.host = null;
            msg.extra.RemoveAll(s => s == null);
            foreach (var s in msg.extra) { s.name ??= ""; s.state ??= ""; if (s.host != null && !HostId.IsMatch(s.host)) s.host = null; }
            if (msg.want < 0) msg.want = 0;
            return msg;
        }
    }
}
