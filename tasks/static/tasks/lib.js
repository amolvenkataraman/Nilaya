/* Tasks app: small DOM, API, date, toast, menu, dialog and drag helpers.
 * User data only ever reaches the page through textContent / attributes (see h()). */

// ------------------------------------------------------------------ DOM

const SVG_NS = "http://www.w3.org/2000/svg";

/** h("div.cls", {attrs, onclick, dataset, style}, ...children). Strings become text nodes. */
export function h(tag, props, ...kids) {
    const [name, ...classes] = tag.split(".");
    const el = document.createElement(name || "div");
    if (classes.length) el.className = classes.join(" ");
    if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
        kids.unshift(props);
        props = null;
    }
    for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === "class") el.className += (el.className ? " " : "") + v;
        else if (k === "text") el.textContent = v;
        else if (k === "dataset") Object.assign(el.dataset, v);
        else if (k === "style") for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k in el && !["list", "form", "type"].includes(k)) el[k] = v;
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

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el, ...kids) { el.replaceChildren(); return append(el, kids); }

// Stroke icons on a 16px grid (constant path data, never user input).
const ICONS = {
    inbox: "M2 9.5V13h12V9.5M2 9.5 4 3h8l2 6.5M2 9.5h3.5l1 1.5h3l1-1.5H14",
    today: "M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3M8 10h.01",
    upcoming: "M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3M5 9.5h6M5 11.5h3.5",
    overdue: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 5v3.2l2 1.3",
    nodate: "M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3M6 9l4 3M10 9l-4 3",
    star: "M8 1.9l1.85 3.8 4.15.6-3 2.9.7 4.1L8 11.4l-3.7 1.9.7-4.1-3-2.9 4.15-.6z",
    user: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c.5-2.6 2.4-3.8 5-3.8s4.5 1.2 5 3.8",
    done: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM5.5 8.2l1.8 1.8 3.3-3.6",
    check: "M3.5 8.5l3 3 6-7",
    list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01",
    board: "M2.5 2.5h3v11h-3zM6.5 2.5h3v7h-3zM10.5 2.5h3v9h-3z",
    table: "M2 2.5h12v11H2zM2 6h12M2 9.5h12M6 2.5v11",
    calendar: "M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3",
    timeline: "M2 4h6.5M5 8h8M3.5 12h5.5",
    plus: "M8 3v10M3 8h10",
    chevR: "M6 4l4 4-4 4",
    chevD: "M4 6l4 4 4-4",
    chevL: "M10 4 6 8l4 4",
    more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
    x: "M4 4l8 8M12 4l-8 8",
    search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14",
    filter: "M2 3.5h12M4.5 8h7M7 12.5h2",
    sort: "M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5",
    group: "M2.5 3h11M2.5 6h7M2.5 10h11M2.5 13h7",
    repeat: "M2.5 7.5V6.5a2 2 0 0 1 2-2h8.5M11 2.5l2 2-2 2M13.5 8.5v1a2 2 0 0 1-2 2H3M5 13.5l-2-2 2-2",
    comment: "M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z",
    subtask: "M4 2.5v5a2 2 0 0 0 2 2h6.5M10.5 7.5l2 2-2 2",
    flag: "M3.5 14V2.5M3.5 3h8.5l-1.8 3 1.8 3H3.5",
    tag: "M2.5 2.5h5l6 6-5 5-6-6zM5.5 5.5h.01",
    bell: "M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3",
    trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4",
    copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
    link: "M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8",
    share: "M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 13.5c.4-2.5 2.2-3.6 4.5-3.6s4.1 1.1 4.5 3.6M12.5 5v4M10.5 7h4",
    focus: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
    clock: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 5v3.2l2 1.3",
    archive: "M2 3h12v3H2zM3 6v7.5h10V6M6.5 9h3",
    edit: "M10.5 2.5l3 3-8 8H2.5v-3z",
    folder: "M2 4h4l1.5 1.5H14V13H2z",
    play: "M5 3.5v9l7-4.5z",
    keyboard: "M1.5 4h13v8h-13zM4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6",
    eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    columns: "M2 2.5h12v11H2zM6 2.5v11M10 2.5v11",
    percent: "M3.5 12.5l9-9M4.5 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11.5 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
    palette: "M8 14A6 6 0 1 1 14 8c0 1.5-1.2 2-2.2 2H10a1.3 1.3 0 0 0-1 2.2c.4.5.1 1.8-1 1.8zM5 7h.01M7 4.8h.01M10 5h.01",
    door: "M3 14V2.5h7.5V14M10.5 4H13v10M8 8.5h.01",
};

export function icon(name, size = 16, cls = "") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", name === "star-fill" ? "currentColor" : "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "tk-ico " + cls);
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", ICONS[name === "star-fill" ? "star" : name] || "");
    svg.append(p);
    return svg;
}

/** Progress ring (0..1). */
export function ring(frac, size = 16, cls = "") {
    const svg = document.createElementNS(SVG_NS, "svg");
    const r = 6, c = 2 * Math.PI * r;
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("class", "tk-ring " + cls);
    svg.setAttribute("aria-hidden", "true");
    const bg = document.createElementNS(SVG_NS, "circle");
    const fg = document.createElementNS(SVG_NS, "circle");
    for (const n of [bg, fg]) {
        n.setAttribute("cx", 8); n.setAttribute("cy", 8); n.setAttribute("r", r);
        n.setAttribute("fill", "none"); n.setAttribute("stroke-width", 2.2);
    }
    bg.setAttribute("class", "tk-ring-bg");
    fg.setAttribute("class", "tk-ring-fg");
    fg.setAttribute("stroke-dasharray", `${(Math.max(0, Math.min(1, frac)) * c).toFixed(2)} ${c.toFixed(2)}`);
    fg.setAttribute("transform", "rotate(-90 8 8)");
    fg.setAttribute("stroke-linecap", "round");
    svg.append(bg, fg);
    return svg;
}

export function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function hue(s) {
    let x = 0;
    for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) % 360;
    return x;
}

export function avatar(user, size = "") {
    const el = h("span.tk-avatar" + (size ? ".tk-avatar-" + size : ""), { title: user.name || user.username }, initials(user.name || user.username));
    el.style.setProperty("--h", hue(user.username || user.name));
    return el;
}

// ------------------------------------------------------------------ API

export const API = "/api/v2/tasks/";

export function csrf() {
    return decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || "");
}

export function qs(params) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === "" || v == null || (Array.isArray(v) && !v.length)) continue;
        u.set(k, Array.isArray(v) ? v.join(",") : v);
    }
    const s = u.toString();
    return s ? "?" + s : "";
}

export async function api(method, path, body, opts = {}) {
    const init = { method, credentials: "same-origin", headers: { Accept: "application/json" }, keepalive: !!opts.keepalive };
    if (method !== "GET") init.headers["X-CSRFToken"] = csrf();
    if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }
    const r = await fetch((opts.base ?? API) + path, init);
    if (!r.ok) {
        let msg = `Something went wrong (${r.status})`;
        try {
            const j = await r.json();
            if (typeof j.detail === "string") msg = j.detail;
            else if (Array.isArray(j.detail)) msg = j.detail.map((d) => d.msg).join("; ");
        } catch (_) { /* not JSON */ }
        if (r.status === 403 && msg.includes("CSRF")) msg = "Your session expired. Reload the page.";
        const err = new Error(msg);
        err.status = r.status;
        throw err;
    }
    return r.status === 204 ? null : r.json();
}

// ------------------------------------------------------------------ dates

export const DAY = 86400000;
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const isAllDay = (d) => d.getHours() === 23 && d.getMinutes() === 59;
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toInput = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fromInput = (v) => (v ? new Date(v).toISOString() : null);
export const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 0, 0); return x; };

const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fmtMonthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fmtFull = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtWeekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const fmtWeekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });
export const fmtMonth = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
export const time = (d) => fmtTime.format(d);
export const monthDay = (d) => fmtMonthDay.format(d);
export const weekday = (d, long) => (long ? fmtWeekdayLong : fmtWeekday).format(d);

/** "Today", "Tomorrow 5:00 PM", "Fri", "Nov 12", "Nov 12, 2027". */
export function fmtDay(iso, withTime = true) {
    if (!iso) return "";
    const d = new Date(iso), today = startOfDay(new Date());
    const diff = Math.round((startOfDay(d) - today) / DAY);
    let s;
    if (diff === 0) s = "Today";
    else if (diff === 1) s = "Tomorrow";
    else if (diff === -1) s = "Yesterday";
    else if (diff > 1 && diff < 7) s = weekday(d, true);
    else s = d.getFullYear() === today.getFullYear() ? fmtMonthDay.format(d) : fmtFull.format(d);
    return withTime && !isAllDay(d) ? `${s} ${fmtTime.format(d)}` : s;
}

export function fmtDateTime(iso) {
    const d = new Date(iso);
    return `${d.getFullYear() === new Date().getFullYear() ? fmtMonthDay.format(d) : fmtFull.format(d)}, ${fmtTime.format(d)}`;
}

export function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
    return fmtDateTime(iso);
}

export function fmtMinutes(m) {
    if (!m) return "";
    const hrs = Math.floor(m / 60), mins = m % 60;
    return hrs ? `${hrs}h${mins ? ` ${mins}m` : ""}` : `${mins}m`;
}

/** "90", "1h", "1h 30m", "1:30", "45m" -> minutes (null if unreadable). */
export function parseMinutes(s) {
    s = String(s).trim().toLowerCase();
    if (!s) return 0;
    let m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return +m[1] * 60 + +m[2];
    m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m?)?$/);
    if (m && (m[1] || m[2])) return Math.round((parseFloat(m[1] || 0) * 60) + +(m[2] || 0));
    return null;
}

// ------------------------------------------------------------------ toasts

let toastBox;
export function toast(message, { action, onAction, error = false, timeout = 5000 } = {}) {
    toastBox = toastBox || document.getElementById("tk-toasts");
    const close = () => { el.classList.add("is-leaving"); setTimeout(() => el.remove(), 160); };
    const el = h("div.tk-toast" + (error ? ".is-error" : ""), { role: error ? "alert" : "status" },
        h("span.tk-toast-msg", message),
        action && h("button.tk-toast-act", { type: "button", onclick: () => { close(); onAction(); } }, action),
        h("button.tk-toast-x", { type: "button", "aria-label": "Dismiss", onclick: close }, icon("x", 14)));
    toastBox.append(el);
    while (toastBox.children.length > 3) toastBox.firstElementChild.remove();
    if (timeout) setTimeout(close, timeout);
    return close;
}

// ------------------------------------------------------------------ popovers & menus

let openPop = null;

export function closePopover() {
    if (openPop) { const p = openPop; openPop = null; p.close(); }
}

/** Anchor a floating panel to an element (or {x,y}). Closes on outside click / Esc. */
export function popover(anchor, content, { className = "", onClose, align = "start", focus = true } = {}) {
    closePopover();
    const panel = h("div.tk-pop" + (className ? "." + className.split(" ").join(".") : ""), { role: "dialog" }, content);
    document.body.append(panel);
    const place = () => {
        const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
        const pw = panel.offsetWidth, ph = panel.offsetHeight, vw = innerWidth, vh = innerHeight;
        let left = align === "end" ? r.right - pw : r.left;
        left = Math.max(8, Math.min(left, vw - pw - 8));
        let top = r.bottom + 4;
        if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 4);
        panel.style.left = left + "px";
        panel.style.top = top + "px";
    };
    place();
    const onDown = (e) => { if (!panel.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) closePopover(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closePopover(); if (anchor instanceof Element) anchor.focus?.(); } };
    setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    document.addEventListener("keydown", onKey, true);
    addEventListener("resize", closePopover, { once: true });
    const pop = {
        panel, place,
        close() {
            document.removeEventListener("pointerdown", onDown, true);
            document.removeEventListener("keydown", onKey, true);
            panel.remove();
            if (openPop === pop) openPop = null;
            onClose?.();
        },
    };
    openPop = pop;
    if (focus) (panel.querySelector("input,[role=menuitem],button,select,textarea") || panel).focus?.({ preventScroll: true });
    return pop;
}

/** items: [{label, icon, onClick, danger, checked, hint, sep, disabled, swatch}] */
export function menu(anchor, items, opts = {}) {
    const list = h("div.tk-menu", { role: "menu" });
    for (const it of items) {
        if (!it) continue;
        if (it.sep) { list.append(h("div.tk-menu-sep", { role: "separator" })); continue; }
        if (it.heading) { list.append(h("div.tk-menu-head", it.heading)); continue; }
        const b = h("button.tk-menu-item" + (it.danger ? ".is-danger" : "") + (it.checked ? ".is-checked" : ""),
            { type: "button", role: it.checked != null ? "menuitemcheckbox" : "menuitem", disabled: it.disabled,
              "aria-checked": it.checked != null ? String(!!it.checked) : null },
            it.swatch != null ? h("span.tk-dot", { style: { background: it.swatch || "var(--app-muted)" } }) : (it.icon ? icon(it.icon, 14) : h("span.tk-menu-ico")),
            h("span.tk-menu-label", it.label),
            it.checked ? icon("check", 14, "tk-menu-check") : null,
            it.hint ? h("kbd", it.hint) : null);
        b.addEventListener("click", () => { if (!it.keepOpen) closePopover(); it.onClick?.(); });
        list.append(b);
    }
    list.addEventListener("keydown", (e) => {
        const btns = $$(".tk-menu-item:not(:disabled)", list), i = btns.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    });
    return popover(anchor, list, { className: "tk-pop-menu", ...opts });
}

// ------------------------------------------------------------------ dialogs

/** Modal built on <dialog>. actions: [{label, primary, danger, value}] -> resolves with value (or null). */
export function dialog({ title, body, actions = [{ label: "Close", value: null }], onSubmit, wide = false }) {
    return new Promise((resolve) => {
        const form = h("form.tk-dlg-form", { method: "dialog" });
        const dlg = h("dialog.tk-dlg" + (wide ? ".tk-dlg-wide" : ""), { "aria-label": title }, form);
        const foot = h("div.tk-dlg-foot");
        for (const a of actions) {
            foot.append(h("button.btn.btn-sm." + (a.primary ? "btn-primary" : a.danger ? "btn-danger" : "btn-outline-secondary"),
                { type: a.primary ? "submit" : "button", value: a.primary ? "ok" : "", onclick: a.primary ? null : () => done(a.value ?? null) }, a.label));
        }
        append(form, [h("div.tk-dlg-head", h("h2", title),
            h("button.tk-icon-btn", { type: "button", "aria-label": "Close", onclick: () => done(null) }, icon("x"))),
        h("div.tk-dlg-body", body), foot]);
        let settled = false;
        const done = (v) => { if (settled) return; settled = true; dlg.close(); dlg.remove(); resolve(v); };
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const primary = actions.find((a) => a.primary);
            try {
                const v = onSubmit ? await onSubmit() : primary?.value ?? true;
                if (v !== false) done(v);
            } catch (err) { toast(err.message, { error: true }); }
        });
        dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(null); });
        document.body.append(dlg);
        dlg.showModal();
        const first = dlg.querySelector("input:not([type=hidden]),select,textarea");
        if (first) { first.focus(); first.select?.(); }
    });
}

export function confirmDialog(title, text, okLabel = "Delete") {
    return dialog({ title, body: h("p.mb-0", text), actions: [{ label: "Cancel", value: false }, { label: okLabel, primary: true, value: true }] });
}

// ------------------------------------------------------------------ drag (pointer events: mouse, pen and touch)

/**
 * One implementation for mouse and touch. Touch starts after a short press so normal scrolling still works.
 * opts: selector (draggable items inside root), handle (optional selector), onStart(el, e) -> ctx|null,
 *       onMove(ctx, {x, y, target}), onDrop(ctx, {x, y, target}), onEnd(ctx), scrollers() -> [elements]
 */
export function draggable(root, opts) {
    let pending = null, active = null;
    const NO_DRAG = "input,textarea,select,a[href],[contenteditable=true],.tk-nodrag";

    root.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || active) return;
        const el = e.target.closest(opts.selector);
        if (!el || !root.contains(el)) return;
        if (opts.handle && !e.target.closest(opts.handle)) return;
        const btn = e.target.closest("button");
        if (e.target.closest(NO_DRAG) || (btn && btn !== el && !e.target.closest(opts.handle || "[data-drag-handle]"))) return;
        pending = { el, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === "touch" };
        if (pending.touch) pending.timer = setTimeout(() => pending && begin(e), 260);
        addEventListener("pointermove", onMove, { passive: false });
        addEventListener("pointerup", onUp);
        addEventListener("pointercancel", onCancel);
    });

    function begin(e) {
        const ctx = opts.onStart(pending.el, e);
        if (!ctx) { reset(); return; }
        const r = pending.el.getBoundingClientRect();
        const ghost = pending.el.cloneNode(true);
        ghost.classList.add("tk-ghost");
        ghost.removeAttribute("id");
        Object.assign(ghost.style, { width: r.width + "px", left: r.left + "px", top: r.top + "px" });
        document.body.append(ghost);
        active = { ctx, el: pending.el, ghost, dx: pending.x - r.left, dy: pending.y - r.top, x: pending.x, y: pending.y };
        pending.el.classList.add("tk-dragging");
        document.body.classList.add("tk-is-dragging");
        if (navigator.vibrate && pending.touch) navigator.vibrate(8);
        addEventListener("touchmove", stopTouch, { passive: false });
        addEventListener("keydown", onKey, true);
        tick();
    }

    const stopTouch = (e) => e.preventDefault();
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };

    function onMove(e) {
        if (!pending || e.pointerId !== pending.id) return;
        const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
        if (!active) {
            if (pending.touch) { if (dist > 8) reset(); return; }
            if (dist < 5) return;
            begin(e);
            if (!active) return;
        }
        e.preventDefault();
        active.x = e.clientX; active.y = e.clientY;
        active.ghost.style.transform = `translate(${e.clientX - active.dx - parseFloat(active.ghost.style.left)}px, ${e.clientY - active.dy - parseFloat(active.ghost.style.top)}px)`;
        opts.onMove?.(active.ctx, { x: e.clientX, y: e.clientY, target: document.elementFromPoint(e.clientX, e.clientY) });
    }

    function tick() {  // auto-scroll near the edges of scroll containers
        if (!active) return;
        for (const sc of opts.scrollers?.() || []) {
            const r = sc.getBoundingClientRect(), m = 36;
            if (active.y > r.top && active.y < r.bottom) {
                if (active.x > r.right - m && active.x < r.right + 4) sc.scrollLeft += 12;
                else if (active.x < r.left + m && active.x > r.left - 4) sc.scrollLeft -= 12;
            }
            if (active.x > r.left && active.x < r.right) {
                if (active.y > r.bottom - m && active.y < r.bottom + 4) sc.scrollTop += 12;
                else if (active.y < r.top + m && active.y > r.top - 4) sc.scrollTop -= 12;
            }
        }
        requestAnimationFrame(tick);
    }

    function onUp(e) {
        if (active) {
            const { ctx, x, y } = active;
            const target = document.elementFromPoint(e.clientX ?? x, e.clientY ?? y);
            // Swallow the click that follows a drag.
            const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            addEventListener("click", swallow, { capture: true, once: true });
            setTimeout(() => removeEventListener("click", swallow, true), 0);
            finish();
            opts.onDrop?.(ctx, { x: e.clientX ?? x, y: e.clientY ?? y, target });
        } else reset();
    }

    function onCancel() {
        if (active) { const { ctx } = active; finish(); opts.onCancel?.(ctx); } else reset();
    }

    function finish() {
        active.ghost.remove();
        active.el.classList.remove("tk-dragging");
        document.body.classList.remove("tk-is-dragging");
        const ctx = active.ctx;
        active = null;
        removeEventListener("touchmove", stopTouch);
        removeEventListener("keydown", onKey, true);
        reset();
        opts.onEnd?.(ctx);
    }

    function reset() {
        if (pending?.timer) clearTimeout(pending.timer);
        pending = null;
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onCancel);
    }

    // A long press on touch would otherwise open the context menu.
    root.addEventListener("contextmenu", (e) => { if (pending || active) e.preventDefault(); });
}

/** Midpoint position between two neighbours (either may be missing). */
export function between(before, after) {
    if (before == null && after == null) return 1;
    if (before == null) return after - 1;
    if (after == null) return before + 1;
    return (before + after) / 2;
}

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export const store = {
    get(k, d) { try { const v = localStorage.getItem("tk." + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("tk." + k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
};
