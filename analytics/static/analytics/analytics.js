/* Staff usage dashboard: plain SVG bar charts from /api/v2/analytics/summary. */
(function () {
    "use strict";
    const NS = "http://www.w3.org/2000/svg";
    const $ = (id) => document.getElementById(id);
    const fmt = (n) => Number(n).toLocaleString();

    function svg(tag, attrs, text) {
        const n = document.createElementNS(NS, tag);
        Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function empty(el, msg) {
        const d = document.createElement("div");
        d.className = "an-empty";
        d.textContent = msg || "No data for this period yet.";
        el.replaceChildren(d);
    }

    // Vertical bars over a sequence (days or hours), one series, one axis.
    function columns(el, labels, values, tip) {
        if (!values.some((v) => v > 0)) return empty(el);
        const W = 520, H = 160, L = 36, B = 22, T = 8;
        const max = Math.max(...values), step = (W - L) / values.length;
        const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
        [0, 0.5, 1].forEach((f) => {
            const y = T + (H - T - B) * (1 - f);
            s.append(svg("line", { x1: L, x2: W, y1: y, y2: y, class: "grid" }));
            s.append(svg("text", { x: L - 6, y: y + 3, "text-anchor": "end" }, fmt(Math.round(max * f))));
        });
        values.forEach((v, i) => {
            const h = (H - T - B) * (v / max);
            const bw = Math.min(28, Math.max(1, step - 2));  // a short period shouldn't draw one giant slab
            const r = svg("rect", { x: L + i * step + (step - bw) / 2, y: H - B - h, width: bw, height: Math.max(0, h), rx: 2, class: "bar" });
            r.append(svg("title", {}, tip(i, v)));
            s.append(r);
        });
        const every = Math.ceil(labels.length / 8);
        labels.forEach((lab, i) => {
            if (i % every === 0) s.append(svg("text", { x: L + i * step + step / 2, y: H - 6, "text-anchor": "middle" }, lab));
        });
        el.replaceChildren(s);
    }

    // Horizontal bars for categories, direct-labelled.
    function bars(el, rows) {
        if (!rows.length) return empty(el);
        const W = 520, rowH = 26, L = 120, R = 60, H = rows.length * rowH + 4;
        const max = Math.max(...rows.map((r) => r.value));
        const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
        rows.forEach((row, i) => {
            const y = i * rowH + 4, w = (W - L - R) * (row.value / max);
            s.append(svg("text", { x: L - 8, y: y + 13, "text-anchor": "end" }, row.label));
            const r = svg("rect", { x: L, y: y + 3, width: Math.max(1, w), height: 14, rx: 3, class: "bar" });
            r.append(svg("title", {}, `${row.label}: ${fmt(row.value)}${row.note ? " · " + row.note : ""}`));
            s.append(r, svg("text", { x: L + w + 6, y: y + 14, class: "v" }, fmt(row.value)));
        });
        el.replaceChildren(s);
    }

    function kpis(d) {
        const pages = d.per_day.reduce((a, r) => a + r.events, 0);
        const api = d.per_day.reduce((a, r) => a + r.api, 0) + (d.api_apps.length && !d.per_day.length ? d.api_apps.reduce((a, r) => a + r.calls, 0) : 0);
        const items = [[fmt(pages), "page views"], [fmt(d.api_apps.reduce((a, r) => a + r.calls, 0)), "API calls"],
            [fmt(d.users), "people active"], [d.apps[0] ? d.apps[0].app : "–", "most used app"]];
        $("an-kpis").replaceChildren(...items.map(([v, l]) => {
            const k = document.createElement("div"); k.className = "an-kpi";
            const b = document.createElement("b"); b.textContent = v;
            const s = document.createElement("span"); s.textContent = l;
            k.append(b, s); return k;
        }));
        return api;
    }

    function routes(d) {
        const t = $("an-routes");
        const head = document.createElement("tr");
        ["App", "Page (route)", "Views", "People", "Errors"].forEach((h) => { const th = document.createElement("th"); th.textContent = h; head.append(th); });
        const rows = d.routes.map((r) => {
            const tr = document.createElement("tr");
            [[r.app], [r.name, "route"], [fmt(r.events)], [fmt(r.users)], [fmt(r.errors)]].forEach(([v, cls]) => {
                const td = document.createElement("td"); td.textContent = v; if (cls) td.className = cls; tr.append(td);
            });
            return tr;
        });
        t.replaceChildren(head, ...rows);
    }

    async function load(days) {
        const r = await fetch(`/api/v2/analytics/summary?days=${days}`, { credentials: "same-origin" });
        if (!r.ok) { empty($("an-pages"), `Couldn't load usage (${r.status}).`); return; }
        const d = await r.json();
        kpis(d);
        const short = (iso) => new Date(iso + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
        columns($("an-pages"), d.per_day.map((x) => short(x.day)), d.per_day.map((x) => x.events), (i, v) => `${short(d.per_day[i].day)}: ${fmt(v)} views, ${d.per_day[i].users} people`);
        columns($("an-api"), d.per_day.map((x) => short(x.day)), d.per_day.map((x) => x.api), (i, v) => `${short(d.per_day[i].day)}: ${fmt(v)} API calls`);
        bars($("an-apps"), d.apps.map((a) => ({ label: a.app, value: a.events, note: `${a.users} people` })));
        bars($("an-api-apps"), d.api_apps.map((a) => ({ label: a.app, value: a.calls, note: `${a.users} people, ${a.errors} errors` })));
        columns($("an-hours"), d.hours.map((_, h) => `${h}h`), d.hours, (h, v) => `${h}:00–${h}:59: ${fmt(v)} views`);
        bars($("an-split"), [...d.devices.map((x) => ({ label: x.device, value: x.events, note: "page views" })),
            ...d.api_clients.map((x) => ({ label: `API · ${x.client}`, value: x.calls, note: "API calls" }))]);
        routes(d);
    }

    document.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll("[data-days]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        load(b.dataset.days);
    }));
    load(30);
})();
