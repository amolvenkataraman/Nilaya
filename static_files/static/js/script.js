document.addEventListener('DOMContentLoaded', () => {
    console.log('%c WARNING! ', 'color: red; font-size: 32px; font-weight: 600;');
    console.log('DO NOT type or paste ANYTHING in this window. Doing so can allow hackers to access your data.');

    if (!localStorage.getItem('debug')) {
        localStorage.setItem('debug', 0)
    }
});

// Escape user-controlled text before interpolating it into innerHTML
function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function toggle_dark_mode() {
    r = new XMLHttpRequest();
    // Static file: Django template tags are not rendered here, so use the
    // literal route and read the CSRF token from its cookie.
    const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || "";
    r.open("POST", "/accounts/darkmode/");
    r.setRequestHeader("X-CSRFToken", csrf);
    r.onload = () => {window.location.reload();}
    r.send();
}
 
function updateSidebars(left_sb, right_sb) {
    sl = document.querySelector(".sidebar-left");
    sr = document.querySelector(".sidebar-right");

    if (left_sb) { sl.classList.add("sidebar-visible"); }
    else { sl.classList.remove("sidebar-visible"); }
    if (right_sb) { sr.classList.add("sidebar-visible"); }
    else { sr.classList.remove("sidebar-visible"); }

    mc = document.querySelector(".main-content");
    mc.classList.remove("mc-no-sidebar");
    mc.classList.remove("mc-one-sidebar");
    mc.classList.remove("mc-two-sidebar");

    if (left_sb && right_sb) { mc.classList.add("mc-two-sidebar"); }
    else if (left_sb || right_sb) { mc.classList.add("mc-one-sidebar"); }
    else { mc.classList.add("mc-no-sidebar"); }
}

function toggleLeftSidebar() {
    left_sb = !left_sb;
    updateSidebars(left_sb, right_sb);
}

function toggleRightSidebar() {
    right_sb = !right_sb;
    updateSidebars(left_sb, right_sb);
}
