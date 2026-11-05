/* App shell (templates/base.html): initial sidebar state and the sidebar toggle buttons.
 * Loaded at the end of <body>, so the page markup above it already exists.
 * The view says which sidebars the page has via <body data-left-sidebar / data-right-sidebar>. */
(function () {
    var data = document.body.dataset;

    // Globals: toggleLeftSidebar()/toggleRightSidebar() in script.js read and flip these.
    window.left_sb = data.leftSidebar === "1";
    window.right_sb = data.rightSidebar === "1";

    // Phones: start with sidebars closed (they open over the page).
    if (window.matchMedia("(max-width: 900px)").matches) { left_sb = false; right_sb = false; }
    updateSidebars(left_sb, right_sb);

    var left = document.querySelector(".ct-navbar .left-sidebar-btn");
    var right = document.querySelector(".ct-navbar .right-sidebar-btn");
    if (left) left.addEventListener("click", toggleLeftSidebar);
    if (right) right.addEventListener("click", toggleRightSidebar);
})();
