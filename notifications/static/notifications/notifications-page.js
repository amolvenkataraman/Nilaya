/* Notifications page (notifications/index.html): inbox, automatic reminder settings and delivery
 * channels. Talks to /api/v2/notifications/. Loaded with defer (after js/notifications.js, which
 * provides notifTimeAgo). All user data goes in via textContent. */
(function () {
    const API = "/api/v2/notifications/";
    const csrf = () => decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || "");
    const call = (url, opts = {}) => fetch(url, { ...opts, headers: { "Content-Type": "application/json", "X-CSRFToken": csrf(), ...(opts.headers || {}) } });
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const PRIO = { 15: "High", 20: "Urgent" };
    let oldest = null, types = [];

    // ---------------- inbox
    const list = document.getElementById("nt-list"), more = document.getElementById("nt-more");
    const filter = () => document.querySelector('input[name="nt-filter"]:checked').value;

    function row(n) {
        const li = el("li", "nt-item" + (n.read ? "" : " unread"));
        const url = (/^\/(?![\/\\])/.test(n.url || "") || /^https?:\/\//i.test(n.url || "")) ? n.url : null;  // no javascript: links
        const title = el(url ? "a" : "div", "t", n.title);
        if (url) title.href = url;
        const actions = el("div", "actions");
        if (PRIO[n.priority]) actions.append(el("span", `prio prio-${n.priority}`, PRIO[n.priority]));
        const toggle = el("button", "btn btn-sm btn-link p-0", n.read ? "Mark unread" : "Mark read");
        toggle.type = "button";
        toggle.onclick = async () => { await call(`${API}${n.id}/read?read=${!n.read}`, { method: "POST" }); load(true); };
        const del = el("button", "btn btn-sm btn-link p-0 text-danger", "Delete");
        del.type = "button";
        del.onclick = async () => { await call(`${API}${n.id}`, { method: "DELETE" }); li.remove(); };
        actions.append(toggle, del);
        li.append(title, actions);
        if (n.body) li.append(el("div", "b", n.body));
        li.append(el("div", "m", `${n.source} · ${window.notifTimeAgo ? notifTimeAgo(n.created_on) : new Date(n.created_on).toLocaleString()}`));
        return li;
    }

    async function load(reset) {
        if (reset) oldest = null;
        const params = new URLSearchParams({ limit: 30, unread_only: filter() === "unread" });
        if (oldest) params.set("before", oldest);
        const data = await (await fetch(`${API}?${params}`)).json();
        if (reset) list.replaceChildren();
        data.items.forEach((n) => list.append(row(n)));
        if (!list.children.length) list.append(el("li", "nt-empty", filter() === "unread" ? "No unread notifications." : "Nothing here yet."));
        oldest = data.items.length ? data.items[data.items.length - 1].created_on : oldest;
        more.hidden = data.items.length < 30;
    }
    document.querySelectorAll('input[name="nt-filter"]').forEach((r) => r.addEventListener("change", () => load(true)));
    more.onclick = () => load(false);
    document.getElementById("nt-readall").onclick = async () => { await call(API + "read-all", { method: "POST" }); load(true); };

    // ---------------- channels
    const chList = document.getElementById("ch-list");
    const minLabel = (v) => ({ 0: "Everything", 10: "Normal and above", 15: "High and urgent", 20: "Urgent only" })[v] || `Priority ≥ ${v}`;

    function channelRow(c) {
        const box = el("div", "ch");
        const top = el("div", "ch-top");
        const names = el("div");
        names.append(el("div", "ch-name", c.name), el("div", "ch-kind", `${(types.find((t) => t.kind === c.kind) || {}).label || c.kind} · ${minLabel(c.min_priority)}`));
        const sw = el("div", "form-check form-switch m-0");
        const input = el("input", "form-check-input");
        input.type = "checkbox"; input.checked = c.enabled; input.title = "Enabled";
        input.onchange = () => call(`${API}channels/${c.id}`, { method: "PATCH", body: JSON.stringify({ enabled: input.checked }) });
        sw.append(input);
        top.append(names, sw);
        const status = el("div", "ch-status" + (c.last_error ? " err" : c.last_sent_at ? " ok" : ""),
            c.last_error ? `Last attempt failed: ${c.last_error}` : c.last_sent_at ? `Last sent ${notifTimeAgo(c.last_sent_at)}` : "Not used yet");
        const actions = el("div", "ch-actions");
        const test = el("button", "btn btn-sm btn-outline-primary", "Send test");
        test.type = "button";
        test.onclick = async () => {
            test.disabled = true; test.textContent = "Sending…";
            const res = await (await call(`${API}channels/${c.id}/test`, { method: "POST" })).json();
            status.className = "ch-status " + (res.ok ? "ok" : "err");
            status.textContent = res.ok ? "Test sent just now" : `Test failed: ${res.error}`;
            test.disabled = false; test.textContent = "Send test";
        };
        const del = el("button", "btn btn-sm btn-outline-danger", "Remove");
        del.type = "button";
        del.onclick = async () => { await call(`${API}channels/${c.id}`, { method: "DELETE" }); box.remove(); };
        actions.append(test, del);
        box.append(top, status, actions);
        return box;
    }

    async function loadChannels() {
        const chans = await (await fetch(API + "channels")).json();
        chList.replaceChildren(...chans.map(channelRow));
        if (!chans.length) chList.append(el("div", "nt-empty", "No channels yet: notifications only appear here and in the bell menu."));
    }

    // ---------------- add form
    const kind = document.getElementById("ch-kind"), fields = document.getElementById("ch-fields"), err = document.getElementById("ch-error");
    function renderFields() {
        const t = types.find((x) => x.kind === kind.value);
        fields.replaceChildren(...t.fields.map((f) => {
            const wrap = el("div");
            const label = el("label", "form-label small mb-1", f.label + (f.required ? "" : ""));
            label.htmlFor = `cf-${f.key}`;
            const input = el("input", "form-control form-control-sm");
            input.id = `cf-${f.key}`; input.name = f.key; input.required = f.required;
            input.type = f.secret ? "password" : (f.key === "address" ? "email" : "text");
            wrap.append(label, input);
            return wrap;
        }));
    }
    kind.onchange = renderFields;
    document.getElementById("add-form").onsubmit = async (e) => {
        e.preventDefault();
        err.textContent = "";
        const config = {};
        fields.querySelectorAll("input").forEach((i) => { config[i.name] = i.value; });
        const res = await call(API + "channels", { method: "POST", body: JSON.stringify({
            kind: kind.value, name: document.getElementById("ch-name").value, config,
            min_priority: Number(document.getElementById("ch-min").value) }) });
        if (!res.ok) { const d = await res.json(); err.textContent = d.detail ? (typeof d.detail === "string" ? d.detail : "Check the fields") : "Couldn't add the channel"; return; }
        e.target.reset(); renderFields(); loadChannels();
    };

    // ---------------- automatic reminders (each change saves immediately)
    const LEAD = [[0, "Off"], [5, "5 min before"], [10, "10 min before"], [15, "15 min before"], [30, "30 min before"],
        [60, "1 hour before"], [120, "2 hours before"], [1440, "1 day before"], [2880, "2 days before"]];
    const leadLabel = (m) => m % 1440 === 0 ? `${m / 1440} days before` : m % 60 === 0 ? `${m / 60} hours before` : `${m} min before`;
    const rmCard = document.getElementById("rm-card"), rmStatus = document.getElementById("rm-status");
    const rmSelects = rmCard.querySelectorAll("select[data-field]");
    const agendaOn = document.getElementById("rm-agenda"), agendaTime = document.getElementById("rm-agenda-time");
    const toTodos = document.getElementById("rm-todos");
    let saved = {}, statusTimer = null, timeTimer = null;

    function showStatus(kind, text) {
        clearTimeout(statusTimer);
        rmStatus.className = `rm-status show ${kind}`;
        rmStatus.textContent = text;
        if (kind === "ok") statusTimer = setTimeout(() => rmStatus.classList.remove("show"), 1600);
    }

    function fillReminders(st) {
        saved = st;
        rmSelects.forEach((sel) => {
            const v = st[sel.dataset.field];
            const opts = LEAD.some(([m]) => m === v) ? LEAD : [...LEAD, [v, leadLabel(v)]].sort((a, b) => a[0] - b[0]);
            sel.replaceChildren(...opts.map(([m, label]) => Object.assign(document.createElement("option"), { value: m, textContent: label })));
            sel.value = String(v);
        });
        agendaOn.checked = st.daily_agenda;
        agendaTime.value = (st.agenda_time || "07:30").slice(0, 5);
        agendaTime.disabled = !st.daily_agenda;
        toTodos.checked = st.deadlines_to_todos;
    }

    async function saveReminders(patch) {
        showStatus("", "Saving…");
        try {
            const res = await call(API + "reminders", { method: "PATCH", body: JSON.stringify(patch) });
            if (!res.ok) throw new Error(res.status);
            fillReminders(await res.json());
            showStatus("ok", "✓ Saved");
        } catch (e) {
            fillReminders(saved);  // put the controls back to what the server has
            showStatus("err", "Couldn't save. Try again.");
        }
    }

    async function loadReminders() {
        try {
            fillReminders(await (await fetch(API + "reminders")).json());
            rmCard.querySelectorAll("select, input").forEach((c) => { c.disabled = c === agendaTime && !agendaOn.checked; });
        } catch (e) {
            showStatus("err", "Couldn't load reminder settings.");
        }
    }

    rmSelects.forEach((sel) => sel.addEventListener("change", () => saveReminders({ [sel.dataset.field]: Number(sel.value) })));
    agendaOn.addEventListener("change", () => { agendaTime.disabled = !agendaOn.checked; saveReminders({ daily_agenda: agendaOn.checked }); });
    toTodos.addEventListener("change", () => saveReminders({ deadlines_to_todos: toTodos.checked }));
    // Time pickers fire "change" per edited segment: wait until typing settles.
    agendaTime.addEventListener("change", () => {
        clearTimeout(timeTimer);
        if (!agendaTime.value) return;
        timeTimer = setTimeout(() => saveReminders({ agenda_time: agendaTime.value + ":00" }), 600);
    });

    loadReminders();

    (async () => {
        types = await (await fetch(API + "channel-types")).json();
        kind.replaceChildren(...types.map((t) => Object.assign(document.createElement("option"), { value: t.kind, textContent: t.label })));
        renderFields();
        load(true);
        loadChannels();
    })();
})();
