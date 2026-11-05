/* Habits: DOM, API, date, icon, toast and popover helpers.
 * User data only reaches the page through textContent and attributes (see h()); never innerHTML. */

export const SVG_NS = "http://www.w3.org/2000/svg";

/** h("div.cls", {attrs, onclick, dataset, style}, ...children). Strings become text nodes. */
export function h(tag, props, ...kids) {
    const [name, ...classes] = tag.split(".");
    const el = document.createElement(name || "div");
    if (classes.length) el.className = classes.join(" ");
    if (props != null && props !== false && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
        kids.unshift(props);
        props = null;
    }
    for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === "class") el.className += (el.className ? " " : "") + v;
        else if (k === "text") el.textContent = v;
        else if (k === "dataset") Object.assign(el.dataset, v);
        else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k in el && !["list", "form", "type", "role"].includes(k)) el[k] = v;
        else el.setAttribute(k, v === true ? "" : v);
    }
    append(el, kids);
    return el;
}

export function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
        if (k == null || k === false) continue;
        el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
}

export function svg(tag, attrs = {}, ...kids) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    for (const k of kids.flat()) if (k) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el, ...kids) { el.replaceChildren(); return append(el, kids); }

// Stroke icons on a 16px grid (constant path data, never user input).
const ICONS = {
    check: "M3.5 8.5l3 3 6-7",
    plus: "M8 3v10M3 8h10",
    minus: "M3 8h10",
    x: "M4 4l8 8M12 4l-8 8",
    chevL: "M10 4 6 8l4 4",
    chevR: "M6 4l4 4-4 4",
    more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
    grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
    edit: "M10.5 2.5l3 3-8 8H2.5v-3z",
    archive: "M2 3h12v3H2zM3 6v7.5h10V6M6.5 9h3",
    trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4",
    pause: "M5.5 3.5v9M10.5 3.5v9",
    play: "M5 3.5v9l7-4.5z",
    skip: "M3.5 3.5v9l6-4.5zM12.5 3.5v9",
    note: "M3 2.5h7l3 3v8H3zM10 2.5v3h3M5.5 8.5h5M5.5 11h3.5",
    bell: "M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3",
    keyboard: "M1.5 4h13v8h-13zM4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6",
    flame: "M8 14.5c2.8 0 4.5-1.9 4.5-4.4 0-2.4-1.6-3.9-2.6-5.6-.5 1.3-1.2 2-2 2.3.3-2.3-.6-4.2-2.4-5.3.2 2-1 3.4-2.1 4.8C2.6 7.4 3.5 9 3.5 10.1c0 2.5 1.7 4.4 4.5 4.4z",
    // habit icons
    drop: "M8 2s4.5 4.8 4.5 8a4.5 4.5 0 0 1-9 0C3.5 6.8 8 2 8 2z",
    book: "M2.5 3c2-.6 3.9-.4 5.5.8 1.6-1.2 3.5-1.4 5.5-.8v10c-2-.6-3.9-.4-5.5.8-1.6-1.2-3.5-1.4-5.5-.8zM8 3.8v10",
    run: "M9.5 3.5a1 1 0 1 0 0-.01M6 14l2-4 2 2v2.5M5 8l2.5-2.5h3l1.5 2.5h2M8 10 7 6",
    leaf: "M3 13c0-6 4-10 10.5-10.5C13 9 9 13 3 13zM3 13l6-6",
    moon: "M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z",
    heart: "M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z",
    dumbbell: "M1.5 8h13M4 5v6M12 5v6M2.5 6.5v3M13.5 6.5v3",
    pen: "M10.5 2.5l3 3-8 8H2.5v-3zM9 4l3 3",
    coffee: "M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM11 7h1.5a1.5 1.5 0 0 1 0 3H11M5.5 2.5v1.5M8 2.5v1.5",
    sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
    brain: "M8 3v10M8 3a2.5 2.5 0 0 0-4.5 1.5A2.5 2.5 0 0 0 3 9a2.5 2.5 0 0 0 2 4h3M8 3a2.5 2.5 0 0 1 4.5 1.5A2.5 2.5 0 0 1 13 9a2.5 2.5 0 0 1-2 4H8",
    ban: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM3.8 3.8l8.4 8.4",
    music: "M6 12V3.5l7-1.5v8.5M6 12a2 2 0 1 1-2-2 2 2 0 0 1 2 2zM13 10.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2z",
    bed: "M1.5 4v9M1.5 10h13v3M14.5 10V8a2 2 0 0 0-2-2H7v4M4.5 8.5a1.2 1.2 0 1 0 0-.01",
};
export const HABIT_ICONS = ["drop", "book", "run", "dumbbell", "leaf", "moon", "heart", "pen", "coffee", "sun", "brain", "ban", "music", "bed"];

export function icon(name, size = 16, cls = "") {
    const el = svg("svg", { viewBox: "0 0 16 16", width: size, height: size, fill: "none", stroke: "currentColor",
        "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
        class: ("hb-ico " + cls).trim() });
    el.append(svg("path", { d: ICONS[name] || "" }));
    return el;
}

// ------------------------------------------------------------------ API

export const API = "/api/v2/habits/";

export function csrf() {
    return decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || "");
}

export async function api(method, path, body) {
    const init = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (method !== "GET") init.headers["X-CSRFToken"] = csrf();
    if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }
    const r = await fetch(API + path, init);
    if (!r.ok) {
        let msg = `Something went wrong (${r.status})`;
        try {
            const j = await r.json();
            if (typeof j.detail === "string") msg = j.detail;
            else if (Array.isArray(j.detail)) msg = j.detail.map((d) => `${(d.loc || []).slice(-1)[0] || ""}: ${d.msg}`).join("; ");
        } catch (_) { /* not JSON */ }
        if (r.status === 403 && msg.includes("CSRF")) msg = "Your session expired. Reload the page.";
        const err = new Error(msg);
        err.status = r.status;
        throw err;
    }
    return r.status === 204 ? null : r.json();
}

// ------------------------------------------------------------------ dates (local calendar dates as "YYYY-MM-DD")
// Arithmetic in UTC so DST never shifts a day; "today" always comes from the server (user's time zone).

export const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const fmtKey = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return fmtKey(d); };
export const diffDays = (a, b) => Math.round((parseDay(a) - parseDay(b)) / 86400000);
export const weekdayIdx = (s) => (parseDay(s).getUTCDay() + 6) % 7; // Monday = 0

const fmt = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...opts });
const F = {
    long: fmt({ weekday: "long", month: "long", day: "numeric" }),
    short: fmt({ month: "short", day: "numeric" }),
    full: fmt({ month: "short", day: "numeric", year: "numeric" }),
    wd: fmt({ weekday: "short" }),
    wdNarrow: fmt({ weekday: "narrow" }),
    month: fmt({ month: "short" }),
};
export const fmtLong = (s) => F.long.format(parseDay(s));
export const fmtShort = (s) => F.short.format(parseDay(s));
export const fmtFull = (s) => F.full.format(parseDay(s));
export const fmtWeekday = (s) => F.wd.format(parseDay(s));
export const fmtWeekdayNarrow = (s) => F.wdNarrow.format(parseDay(s));
export const fmtMonth = (s) => F.month.format(parseDay(s));
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS_1 = ["M", "T", "W", "T", "F", "S", "S"];

export function fmtTime(t) {
    if (!t) return "";
    const [hh, mm] = t.split(":").map(Number);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
        .format(new Date(Date.UTC(2000, 0, 1, hh, mm)));
}

export const num = (x) => (x == null ? "" : String(Math.round(x * 100) / 100));
export const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

// ------------------------------------------------------------------ toasts

let toastBox;
export function toast(message, { action, onAction, error = false, timeout = 5000 } = {}) {
    toastBox = toastBox || document.getElementById("hb-toasts");
    const close = () => { el.classList.add("is-leaving"); setTimeout(() => el.remove(), 160); };
    const el = h("div.hb-toast" + (error ? ".is-error" : ""), { role: error ? "alert" : "status" },
        h("span.hb-toast-msg", message),
        action && h("button.hb-toast-act", { type: "button", onclick: () => { close(); onAction(); } }, action),
        h("button.hb-toast-x", { type: "button", "aria-label": "Dismiss", onclick: close }, icon("x", 14)));
    toastBox.append(el);
    while (toastBox.children.length > 3) toastBox.firstElementChild.remove();
    if (timeout) setTimeout(close, timeout);
    return close;
}

// ------------------------------------------------------------------ popovers & menus

let openPop = null;
export function closePopover() { if (openPop) { const p = openPop; openPop = null; p.close(); } }

/** Anchor a floating panel to an element. Closes on outside click and Esc. */
export function popover(anchor, content, { className = "", onClose } = {}) {
    closePopover();
    const panel = h("div.hb-pop" + (className ? "." + className : ""), { role: "dialog" }, content);
    document.body.append(panel);
    const r = anchor.getBoundingClientRect();
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    panel.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + "px";
    let top = r.bottom + 4;
    if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 4);
    panel.style.top = top + "px";
    const onDown = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closePopover(); anchor.focus?.(); } };
    setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    document.addEventListener("keydown", onKey, true);
    addEventListener("resize", closePopover, { once: true });
    const pop = {
        panel,
        close() {
            document.removeEventListener("pointerdown", onDown, true);
            document.removeEventListener("keydown", onKey, true);
            panel.remove();
            if (openPop === pop) openPop = null;
            onClose?.();
        },
    };
    openPop = pop;
    (panel.querySelector("input,textarea,[role=menuitem],button") || panel).focus?.({ preventScroll: true });
    return pop;
}

/** items: [{label, icon, onClick, danger, sep, hint}] */
export function menu(anchor, items) {
    const list = h("div.hb-menu", { role: "menu" });
    for (const it of items) {
        if (!it) continue;
        if (it.sep) { list.append(h("div.hb-menu-sep", { role: "separator" })); continue; }
        list.append(h("button.hb-menu-item" + (it.danger ? ".is-danger" : ""), {
            type: "button", role: "menuitem",
            onclick: () => { closePopover(); it.onClick(); },
        }, it.icon ? icon(it.icon, 15) : h("span.hb-ico"), h("span", it.label), it.hint && h("kbd", it.hint)));
    }
    list.addEventListener("keydown", (e) => {
        const items = $$(".hb-menu-item", list), i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    return popover(anchor, list, { className: "hb-pop-menu" });
}
