/* Contacts app: DOM, icon, API, date and toast helpers.
 * User data only reaches the page through textContent and attributes (see h()); never innerHTML. */

const SVG_NS = "http://www.w3.org/2000/svg";

/** h("div.cls", {attrs, onclick, dataset}, ...children). Strings become text nodes. */
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
    users: "M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 13.5c.4-2.5 2.2-3.6 4.5-3.6s4.1 1.1 4.5 3.6M11 2.7a2.4 2.4 0 0 1 0 4.6M12.5 9.9c1.1.5 1.8 1.6 2 3.6",
    star: "M8 1.9l1.85 3.8 4.15.6-3 2.9.7 4.1L8 11.4l-3.7 1.9.7-4.1-3-2.9 4.15-.6z",
    clock: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 5v3.2l2 1.3",
    sparkle: "M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12",
    cake: "M2.5 13.5h11v-5h-11zM2.5 10.5c1.5 1 2.5-1 3.7 0s2.4 1 3.6 0 2.2-1 3.7 0M8 8.5V6M8 4.5c-.8-.6-.6-1.6 0-2.5.6.9.8 1.9 0 2.5z",
    folder: "M2 4h4l1.5 1.5H14V13H2z",
    tag: "M2.5 2.5h5l6 6-5 5-6-6zM5.5 5.5h.01",
    plus: "M8 3v10M3 8h10",
    search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14",
    more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
    x: "M4 4l8 8M12 4l-8 8",
    chevL: "M10 4 6 8l4 4",
    chevD: "M4 6l4 4 4-4",
    edit: "M10.5 2.5l3 3-8 8H2.5v-3z",
    trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4",
    mail: "M2 3.5h12v9H2zM2 4l6 5 6-5",
    phone: "M3 2.5h2.5l1.2 3-1.5 1a7 7 0 0 0 3.3 3.3l1-1.5 3 1.2V12a1.5 1.5 0 0 1-1.5 1.5A10.5 10.5 0 0 1 1.5 4 1.5 1.5 0 0 1 3 2.5z",
    pin: "M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14zM8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
    globe: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c1.8 1.7 2.5 3.7 2.5 6S9.8 12.3 8 14M8 2C6.2 3.7 5.5 5.7 5.5 8s.7 4.3 2.5 6",
    link: "M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8",
    ext: "M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v4H2.5V4h4",
    upload: "M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3.5h11V10",
    download: "M8 2.5v8M5 7.5l3 3 3-3M2.5 10v3.5h11V10",
    merge: "M4 2.5v3a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v0M12 2.5v3a4 4 0 0 1-2.3 3.6M4 13.5v-1",
    bell: "M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3",
    call: "M3 2.5h2.5l1.2 3-1.5 1a7 7 0 0 0 3.3 3.3l1-1.5 3 1.2V12a1.5 1.5 0 0 1-1.5 1.5A10.5 10.5 0 0 1 1.5 4 1.5 1.5 0 0 1 3 2.5z",
    meeting: "M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3",
    message: "M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z",
    email: "M2 3.5h12v9H2zM2 4l6 5 6-5",
    note: "M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5",
    heart: "M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z",
    check: "M3.5 8.5l3 3 6-7",
    gear: "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4",
    user: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c.5-2.6 2.4-3.8 5-3.8s4.5 1.2 5 3.8",
    swap: "M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13",
    file: "M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3",
};

export function icon(name, size = 16, cls = "") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    const fill = name.endsWith("-fill");
    svg.setAttribute("fill", fill ? "currentColor" : "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "ct-ico " + cls);
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", ICONS[fill ? name.slice(0, -5) : name] || "");
    svg.append(p);
    return svg;
}

// Profile marks: a short monogram per network (no third-party logos, no network requests).
const MARKS = {
    website: "", blog: "", github: "GH", gitlab: "GL", linkedin: "in", stackoverflow: "SO", hackernews: "Y",
    twitter: "X", mastodon: "M", bluesky: "B", devto: "DEV", codeberg: "CB", sourcehut: "~", huggingface: "HF",
    kaggle: "K", leetcode: "LC", npm: "npm", pypi: "Py", orcid: "iD", scholar: "GS", keybase: "KB", medium: "Me",
    youtube: "YT", instagram: "IG", reddit: "r/", discord: "D", telegram: "TG", signal: "S", matrix: "[m]",
};

export function mark(network, size = 16) {
    if (network === "website") return icon("globe", size, "ct-mark-ico");
    if (network === "blog") return icon("note", size, "ct-mark-ico");
    const m = MARKS[network] || network.slice(0, 2).toUpperCase();
    return h("span.ct-mark", { dataset: { net: network, len: String(Math.min(m.length, 3)) }, "aria-hidden": "true" }, m);
}

export function initials(name) {
    const parts = String(name || "?").replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function hue(s) {
    let x = 0;
    for (const ch of String(s)) x = (x * 31 + ch.codePointAt(0)) % 360;
    return x;
}

export function avatar(p, size = "md") {
    if (p.has_avatar) {
        return h("img.ct-avatar.ct-avatar-" + size, {
            src: `${API}${p.id}/avatar?v=${encodeURIComponent(p.updated_on || p.created_on || "")}`,
            alt: "", loading: "lazy", decoding: "async",
        });
    }
    const el = h("span.ct-avatar.ct-avatar-" + size, { "aria-hidden": "true" }, initials(p.name));
    el.style.setProperty("--h", hue(p.id || p.name));
    return el;
}

/** Only ever put http(s) URLs into href (the server already builds them; this is belt and braces). */
export function safeUrl(u) {
    return /^https?:\/\//i.test(u || "") ? u : null;
}

export function extLink(url, ...kids) {
    const safe = safeUrl(url);
    if (!safe) return h("span", ...kids);
    return h("a", { href: safe, target: "_blank", rel: "noopener noreferrer" }, ...kids);
}

// ------------------------------------------------------------------ API

export const API = "/api/v2/contacts/";

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

async function errorOf(r) {
    let msg = `Something went wrong (${r.status})`;
    try {
        const j = await r.json();
        if (typeof j.detail === "string") msg = j.detail;
        else if (Array.isArray(j.detail)) msg = j.detail.map((d) => `${(d.loc || []).slice(-1)[0] || ""}: ${d.msg}`).join("; ");
    } catch (_) { /* not JSON */ }
    if (r.status === 403 && msg.includes("CSRF")) msg = "Your session expired. Reload the page.";
    const err = new Error(msg);
    err.status = r.status;
    return err;
}

export async function api(method, path, body) {
    const init = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (method !== "GET") init.headers["X-CSRFToken"] = csrf();
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }
    const r = await fetch(API + path, init);
    if (!r.ok) throw await errorOf(r);
    return r.status === 204 ? null : r.json();
}

// ------------------------------------------------------------------ dates

const pad = (n) => String(n).padStart(2, "0");
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtMD = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fmtMDY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtLongMD = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
const fmtLongMDY = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
export const MONTHS = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2000, i, 1)));

export function daysFromToday(dayStr) {
    const t = parseDay(todayKey());
    return Math.round((parseDay(dayStr) - t) / 86400000);
}

/** "Today", "Yesterday", "3 days ago", "Mar 4", "Mar 4, 2024". */
export function fmtDay(dayStr) {
    if (!dayStr) return "";
    const diff = daysFromToday(dayStr);
    if (diff === 0) return "Today";
    if (diff === -1) return "Yesterday";
    if (diff === 1) return "Tomorrow";
    if (diff < 0 && diff > -7) return `${-diff} days ago`;
    const d = parseDay(dayStr);
    return d.getFullYear() === new Date().getFullYear() ? fmtMD.format(d) : fmtMDY.format(d);
}

export function fmtLongDay(dayStr) {
    return dayStr ? fmtLongMDY.format(parseDay(dayStr)) : "";
}

/** "1990-05-17" -> "May 17, 1990 (age 36)"; "--05-17" -> "May 17". */
export function fmtBirthday(b) {
    if (!b) return "";
    if (b.startsWith("--")) {
        const [m, d] = b.slice(2).split("-").map(Number);
        return fmtLongMD.format(new Date(2000, m - 1, d));
    }
    const d = parseDay(b), now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
    return `${fmtLongMDY.format(d)} · ${age}`;
}

export function plural(n, word, pl) {
    return `${n} ${n === 1 ? word : pl || word + "s"}`;
}

// ------------------------------------------------------------------ toast

let toastTimer;
export function toast(msg, opts = {}) {
    let el = $("#ct-toast");
    if (!el) {
        el = h("div.ct-toast", { id: "ct-toast", role: "status", "aria-live": "polite" });
        document.body.append(el);
    }
    clear(el, h("span", msg), opts.action ? h("button.ct-toast-btn", { type: "button", onclick: () => { el.hidden = true; opts.action.run(); } }, opts.action.label) : null);
    el.classList.toggle("ct-toast-error", !!opts.error);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, opts.error ? 6000 : 3500);
}

export function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
