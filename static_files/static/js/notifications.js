/* Navbar bell: unread badge (refreshed every minute) and the latest notifications. */
(function () {
    const API = "/api/v2/notifications/";

    function csrf() {
        return decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || "");
    }

    function timeAgo(iso) {
        const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
        if (s < 60) return "just now";
        const units = [[86400 * 365, "y"], [86400 * 30, "mo"], [86400 * 7, "w"], [86400, "d"], [3600, "h"], [60, "m"]];
        for (const [secs, unit] of units) if (s >= secs) return `${Math.floor(s / secs)}${unit} ago`;
    }
    window.notifTimeAgo = timeAgo;

    function setBadge(n) {
        const badge = document.getElementById("notif-badge");
        if (!badge) return;
        badge.textContent = n > 99 ? "99+" : String(n);
        badge.hidden = n === 0;
    }

    async function refreshCount() {
        try {
            const r = await fetch(API + "unread-count");
            if (r.ok) setBadge((await r.json()).unread);
        } catch (e) { /* offline: keep the old badge */ }
    }

    function item(n) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "dropdown-item notif-item" + (n.read ? "" : " unread");
        a.href = n.url || "/notifications/";
        const title = document.createElement("div");
        title.className = "notif-title";
        title.textContent = n.title;
        const meta = document.createElement("div");
        meta.className = "notif-meta";
        meta.textContent = `${n.source} · ${timeAgo(n.created_on)}`;
        a.append(title);
        if (n.body) {
            const body = document.createElement("div");
            body.className = "notif-body";
            body.textContent = n.body;
            a.append(body);
        }
        a.append(meta);
        a.addEventListener("click", () => {
            if (!n.read) fetch(`${API}${n.id}/read`, { method: "POST", headers: { "X-CSRFToken": csrf() }, keepalive: true });
        });
        li.append(a);
        return li;
    }

    async function loadList() {
        const list = document.getElementById("notif-list");
        if (!list) return;
        try {
            const r = await fetch(API + "?limit=8");
            const data = await r.json();
            setBadge(data.unread);
            list.replaceChildren(...(data.items.length ? data.items.map(item) : [Object.assign(document.createElement("li"), {
                innerHTML: '<span class="dropdown-item-text app-muted">No notifications</span>'
            })]));
        } catch (e) {
            list.replaceChildren(Object.assign(document.createElement("li"), {
                innerHTML: '<span class="dropdown-item-text app-muted">Couldn\'t load notifications</span>'
            }));
        }
    }

    window.markAllNotificationsRead = async function (ev) {
        if (ev) ev.preventDefault();
        await fetch(API + "read-all", { method: "POST", headers: { "X-CSRFToken": csrf() } });
        setBadge(0);
        loadList();
    };

    document.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("notificationsDropdownBtn");
        if (!btn) return;
        btn.addEventListener("show.bs.dropdown", loadList);
        refreshCount();
        setInterval(() => { if (!document.hidden) refreshCount(); }, 60000);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshCount(); });
    });
})();
