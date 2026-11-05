/* Per-device theme: "system" (default, follows the OS), "light" or "dark".
 * Loaded synchronously in <head> so the right theme applies before first paint.
 * The choice is stored in this browser only (localStorage), not on the account. */
(function () {
    var KEY = "theme";
    var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

    function stored() {
        try { return localStorage.getItem(KEY) || "system"; } catch (e) { return "system"; }
    }

    function apply(pref) {
        var dark = pref === "dark" || (pref === "system" && media && media.matches);
        var root = document.documentElement;
        root.setAttribute("data-bs-theme", dark ? "dark" : "light");
        root.setAttribute("data-theme-pref", pref);
        document.querySelectorAll("[data-theme-label]").forEach(function (el) {
            el.textContent = { system: "System", light: "Light", dark: "Dark" }[pref];
        });
    }

    apply(stored());
    if (media && media.addEventListener) {
        media.addEventListener("change", function () { if (stored() === "system") apply("system"); });
    }

    // Cycle System -> Light -> Dark. Used by the theme button in the navbar / auth pages.
    window.cycleTheme = function () {
        var next = { system: "light", light: "dark", dark: "system" }[stored()] || "system";
        try {
            if (next === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, next);
        } catch (e) { /* storage blocked: still apply for this page */ }
        apply(next);
    };

    document.addEventListener("DOMContentLoaded", function () { apply(stored()); });
})();
