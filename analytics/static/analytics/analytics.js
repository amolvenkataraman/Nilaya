/* Staff usage dashboard: per person, app and day, from /api/v2/analytics/summary. */
(function () {
    "use strict";
    const NS = "http://www.w3.org/2000/svg";
    const $ = (id) => document.getElementById(id);
    const fmt = (n) => Number(n || 0).toLocaleString();

    function svg(tag, attrs, text) {
        const n = document.createElementNS(NS, tag);
        Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function empty(node) { node.replaceChildren(el("div", "an-empty", "No usage in this period yet.")); }

    function columns(node, labels, values, tip) {
        if (!values.some((v) => v > 0)) return empty(node);
        const W = 520, H = 160, L = 36, B = 22, T = 8, max = Math.max(...values), step = (W - L) / values.length;
        const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
        [0, 0.5, 1].forEach((f) => {
            const y = T + (H - T - B) * (1 - f);
            s.append(svg("line", { x1: L, x2: W, y1: y, y2: y, class: "grid" }), svg("text", { x: L - 6, y: y + 3, "text-anchor": "end" }, fmt(Math.round(max * f))));
        });
        values.forEach((v, i) => {
            const h = (H - T - B) * (v / max), bw = Math.min(28, Math.max(1, step - 2));
            const r = svg("rect", { x: L + i * step + (step - bw) / 2, y: H - B - h, width: bw, height: Math.max(0, h), rx: 2, class: "bar" });
            r.append(svg("title", {}, tip(i, v)));
            s.append(r);
        });
        const every = Math.ceil(labels.length / 8);
        labels.forEach((lab, i) => { if (i % every === 0) s.append(svg("text", { x: L + i * step + step / 2, y: H - 6, "text-anchor": "middle" }, lab)); });
        node.replaceChildren(s);
    }

    function bars(node, rows) {
        if (!rows.length) return empty(node);
        const W = 520, rowH = 26, L = 120, R = 60, H = rows.length * rowH + 4, max = Math.max(...rows.map((r) => r.value), 1);
        const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
        rows.forEach((row, i) => {
            const y = i * rowH + 4, w = (W - L - R) * (row.value / max);
            s.append(svg("text", { x: L - 8, y: y + 14, "text-anchor": "end" }, row.label));
            const r = svg("rect", { x: L, y: y + 4, width: Math.max(1, w), height: 14, rx: 3, class: "bar" });
            r.append(svg("title", {}, `${row.label}: ${fmt(row.value)} views · ${fmt(row.calls)} API calls · ${row.people} people`));
            s.append(r, svg("text", { x: L + w + 6, y: y + 15, class: "v" }, fmt(row.value)));
        });
        node.replaceChildren(s);
    }

    function matrix(d) {
        const apps = d.apps.map((a) => a.app);
        const people = d.people;
        const cell = {};
        d.matrix.forEach((m) => { cell[`${m.user__username}|${m.app}`] = m; });
        const head = el("tr");
        head.append(el("th", "", "Person"), el("th", "", "Active days"), ...apps.map((a) => el("th", "", a)));
        const rows = people.map((p) => {
            const tr = el("tr");
            tr.append(el("td", "", p.name), el("td", "", fmt(p.active_days)));
            apps.forEach((a) => {
                const m = cell[`${p.user}|${a}`];
                tr.append(el("td", m ? "" : "an-zero", m ? `${fmt(m.views)} · ${fmt(m.calls)}` : "–"));
            });
            return tr;
        });
        $("an-matrix").replaceChildren(head, ...rows);
    }

    async function load(days) {
        const r = await fetch(`/api/v2/analytics/summary?days=${days}`, { credentials: "same-origin" });
        if (!r.ok) { empty($("an-days")); return; }
        const d = await r.json();
        const views = d.apps.reduce((a, x) => a + x.views, 0), calls = d.apps.reduce((a, x) => a + x.calls, 0);
        $("an-kpis").replaceChildren(...[[fmt(views), "page views"], [fmt(calls), "API calls"], [fmt(d.people.length), "people active"],
            [d.apps[0] ? d.apps[0].app : "–", "most used app"]].map(([v, l]) => { const k = el("div", "an-kpi"); k.append(el("b", "", v), el("span", "", l)); return k; }));
        const short = (iso) => new Date(iso + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
        columns($("an-days"), d.per_day.map((x) => short(x.day)), d.per_day.map((x) => x.views),
            (i, v) => `${short(d.per_day[i].day)}: ${fmt(v)} views, ${fmt(d.per_day[i].calls)} API calls, ${d.per_day[i].people} people`);
        bars($("an-apps"), d.apps.map((a) => ({ label: a.app, value: a.views, calls: a.calls, people: a.people })));
        matrix(d);
    }

    document.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll("[data-days]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        load(b.dataset.days);
    }));
    load(30);
})();
