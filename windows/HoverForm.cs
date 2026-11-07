namespace DeskCompanionTaskbar
{
    // Opaque window with the full dashboard (?pc). Unlike the corner it may take focus once the
    // user clicks into it, so Esc and the page's buttons work; hover-open still uses no-activate.
    class HoverForm : WebForm
    {
        protected override bool NeverActivate => false;
    }
}
