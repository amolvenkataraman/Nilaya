/* App shell (templates/base.html): initial sidebar state and the sidebar toggle buttons.
 * Loaded at the end of <body>, so the page markup above it already exists.
 * The view says which sidebars the page has via <body data-left-sidebar / data-right-sidebar>.
 * Desktop: each app (first URL segment) remembers whether its left/right sidebar is open, per
 * device, in localStorage. Phones always start closed, because there they cover the page. */
(function () {
    var data = document.body.dataset;
    var hasLeft = data.leftSidebar === "1", hasRight = data.rightSidebar === "1";
    var phone = window.matchMedia("(max-width: 900px)").matches;
    var key = "sidebars:" + (location.pathname.split("/")[1] || "home");

    function load() {
        try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
    }
    function save() {
        if (phone) return;
        try { localStorage.setItem(key, JSON.stringify({ left: left_sb, right: right_sb })); } catch (e) { /* storage blocked */ }
    }

    var saved = phone ? {} : load();
    // Globals: toggleLeftSidebar()/toggleRightSidebar() in script.js read and flip these.
    window.left_sb = hasLeft && (phone ? false : (typeof saved.left === "boolean" ? saved.left : true));
    window.right_sb = hasRight && (phone ? false : (typeof saved.right === "boolean" ? saved.right : true));
    updateSidebars(left_sb, right_sb);

    // Remember every change, whichever code toggles the sidebar.
    ["toggleLeftSidebar", "toggleRightSidebar"].forEach(function (name) {
        var original = window[name];
        if (typeof original !== "function") return;
        window[name] = function () { var r = original.apply(this, arguments); save(); return r; };
    });

    var left = document.querySelector(".ct-navbar .left-sidebar-btn");
    var right = document.querySelector(".ct-navbar .right-sidebar-btn");
    if (left) left.addEventListener("click", function () { window.toggleLeftSidebar(); });
    if (right) right.addEventListener("click", function () { window.toggleRightSidebar(); });
})();
