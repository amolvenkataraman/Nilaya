/* Contacts app shell: sidebar views, the searchable list, routing (?id=, ?filter=, ?tag=, ?group=),
 * selection and keyboard shortcuts. The detail pane lives in detail.js, dialogs in dialogs.js. */

import { $, $$, API, api, avatar, clear, debounce, fmtDay, h, icon, mark, plural, qs, toast } from "./lib.js";
import { renderDetail, renderEditor, renderOverview } from "./detail.js";
import { openDuplicates, openImport, openSettings } from "./dialogs.js";

const boot = JSON.parse($("#ct-boot").textContent);
const phone = window.matchMedia("(max-width: 900px)");

const S = {
    view: { filter: "", tag: "", group: "" },
    q: "",
    items: [],
    total: 0,
    cur: null,          // open contact id
    person: null,       // open contact detail
    stats: null,
    selected: new Set(),
    loading: false,
    seq: 0,
};

const SMART = [
    { filter: "", label: "All contacts", ico: "users", count: (s) => s.total },
    { filter: "favorites", label: "Favorites", ico: "star", count: (s) => s.favorites },
    { filter: "overdue", label: "Keep in touch", ico: "clock", count: (s) => s.overdue, alert: true },
    { filter: "recent", label: "Recently added", ico: "sparkle", count: (s) => s.recent },
    { filter: "birthdays", label: "Birthdays this month", ico: "cake", count: (s) => s.birthdays_this_month },
];

// ------------------------------------------------------------------ sidebar

function viewTitle() {
    const v = S.view;
    if (v.tag) return `#${v.tag}`;
    if (v.group) return v.group;
    return (SMART.find((x) => x.filter === v.filter) || SMART[0]).label;
}

function isActive(v) {
    return v.filter === S.view.filter && (v.tag || "") === S.view.tag && (v.group || "") === S.view.group;
}

function navItem(v, label, ico, count, alert) {
    const active = isActive(v);
    return h("li", h("button.ct-nav-item" + (active ? ".active" : ""), {
        type: "button", "aria-current": active ? "page" : null,
        onclick: () => setView({ filter: v.filter || "", tag: v.tag || "", group: v.group || "" }),
    }, ico, h("span.ct-nav-label", label), count ? h("span.ct-nav-count" + (alert ? ".ct-alert" : ""), String(count)) : null));
}

function renderSidebar() {
    const s = S.stats;
    if (!s) return;
    clear($("#ct-smart"), SMART.map((x) => navItem({ filter: x.filter }, x.label, icon(x.ico), x.count(s), x.alert && x.count(s) > 0)));
    const groups = s.tags.filter((t) => t.kind === "group");
    const tags = s.tags.filter((t) => t.kind === "tag");
    clear($("#ct-groups"), groups.length ? groups.map((t) => navItem({ group: t.name }, t.name, icon("folder"), t.count))
        : h("li.ct-side-empty", "No groups yet"));
    clear($("#ct-tags"), tags.length ? tags.map((t) => navItem({ tag: t.name }, t.name, icon("tag"), t.count))
        : h("li.ct-side-empty", "No tags yet"));
}

async function loadStats() {
    try {
        S.stats = await api("GET", "stats");
        renderSidebar();
        if (!S.cur) showOverview();
    } catch (e) { toast(e.message, { error: true }); }
}

// ------------------------------------------------------------------ list

async function loadList() {
    const seq = ++S.seq;
    S.loading = true;
    try {
        const r = await api("GET", qs({ q: S.q, filter: S.view.filter, tag: S.view.tag, group: S.view.group, limit: 2000 }));
        if (seq !== S.seq) return;
        S.items = r.items;
        S.total = r.total;
        renderList();
    } catch (e) {
        toast(e.message, { error: true });
    } finally {
        if (seq === S.seq) S.loading = false;
    }
}

function rowSub(p) {
    if (S.view.filter === "overdue" && p.next_due) {
        const d = fmtDay(p.next_due);
        return h("span.ct-due", `Due ${d.toLowerCase().startsWith("today") ? "today" : d}`);
    }
    if (S.view.filter === "birthdays" && p.birthday) {
        const [m, d] = p.birthday.slice(-5).split("-").map(Number);
        return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date(2000, m - 1, d));
    }
    return [p.title, p.company].filter(Boolean).join(" · ") || p.email || p.phone || "";
}

function row(p) {
    const selected = S.selected.has(p.id);
    const av = avatar(p, "md");
    const avBtn = h("button.ct-row-av" + (selected ? ".is-selected" : ""), {
        type: "button", title: selected ? "Deselect" : "Select", "aria-pressed": String(selected),
        "aria-label": `Select ${p.name}`,
        onclick: (e) => { e.stopPropagation(); toggleSelect(p.id); },
    }, av, h("span.ct-row-check", icon("check", 14)));
    const marks = p.profile_links.filter((l) => l.network !== "website").slice(0, 3).map((l) => h("span.ct-row-mark", { title: `${l.label}: ${l.handle}` }, mark(l.network, 14)));
    if (p.profile_links.some((l) => l.network === "website") && marks.length < 3) marks.push(h("span.ct-row-mark", { title: "Website" }, mark("website", 14)));
    return h("div.ct-row" + (p.id === S.cur ? ".active" : ""), {
        role: "option", "aria-selected": String(p.id === S.cur), tabindex: "-1", dataset: { id: p.id },
        onclick: () => open(p.id),
    }, avBtn,
    h("div.ct-row-main", h("div.ct-row-name", p.name, p.favorite ? icon("star-fill", 12, "ct-row-star") : null),
        h("div.ct-row-sub", rowSub(p))),
    h("div.ct-row-marks", marks, p.overdue && S.view.filter !== "overdue" ? h("span.ct-dot", { title: "Keep in touch: overdue" }) : null));
}

function renderList() {
    const list = $("#ct-list");
    $("#ct-title").textContent = viewTitle();
    $("#ct-count").textContent = S.total ? String(S.total) : "";
    document.title = `${viewTitle() === "All contacts" ? "Contacts" : viewTitle()} · AVNet Superapp`;
    if (!S.items.length) {
        const msg = S.q ? `No contacts match “${S.q}”.`
            : S.view.filter === "overdue" ? "Nobody is overdue. Set “Keep in touch” on a contact to get reminders."
                : S.view.filter === "favorites" ? "No favorites yet. Star a contact to pin it here."
                    : S.view.filter === "birthdays" ? "No birthdays this month."
                        : S.view.filter === "recent" ? "Nothing added in the last 30 days."
                            : S.view.tag || S.view.group ? "Nobody here." : null;
        clear(list, msg ? h("p.ct-empty", msg) : h("div.ct-empty", h("p", "No contacts yet."),
            h("div.ct-empty-actions", h("button.btn.btn-primary.btn-sm", { type: "button", onclick: () => newContact() }, "New contact"),
                h("button.btn.btn-outline-secondary.btn-sm", { type: "button", onclick: () => openImport(ctx) }, "Import a file"))));
        return;
    }
    const letters = !S.q && (["", "favorites"].includes(S.view.filter) || S.view.tag || S.view.group);
    const frag = document.createDocumentFragment();
    let last = null;
    for (const p of S.items) {
        if (letters) {
            const ch = (p.name[0] || "#").toUpperCase();
            const L = /\p{L}/u.test(ch) ? ch : "#";
            if (L !== last) { frag.append(h("div.ct-letter", { "aria-hidden": "true" }, L)); last = L; }
        }
        frag.append(row(p));
    }
    if (S.total > S.items.length) frag.append(h("p.ct-more", `Showing ${S.items.length} of ${S.total}. Search to narrow down.`));
    list.replaceChildren(frag);
}

function markActiveRow() {
    for (const el of $$(".ct-row", $("#ct-list"))) {
        const on = el.dataset.id === S.cur;
        el.classList.toggle("active", on);
        el.setAttribute("aria-selected", String(on));
        if (on) el.scrollIntoView({ block: "nearest" });
    }
}

// ------------------------------------------------------------------ selection

function toggleSelect(id) {
    if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
    renderBulk();
    renderList();
}

function renderBulk() {
    const bar = $("#ct-bulk");
    const n = S.selected.size;
    bar.hidden = !n;
    if (!n) return;
    const ids = [...S.selected].join(",");
    clear(bar, h("span.ct-bulk-n", `${n} selected`), h("div.ct-grow"),
        h("a.btn.btn-sm.btn-outline-secondary", { href: API + "export" + qs({ format: "vcf", ids }) }, "vCard"),
        h("a.btn.btn-sm.btn-outline-secondary", { href: API + "export" + qs({ format: "csv", ids }) }, "CSV"),
        h("button.btn.btn-sm.btn-outline-danger", { type: "button", onclick: bulkDelete }, "Delete"),
        h("button.ct-icon-btn", { type: "button", title: "Clear selection", "aria-label": "Clear selection", onclick: () => { S.selected.clear(); renderBulk(); renderList(); } }, icon("x")));
}

async function bulkDelete() {
    const n = S.selected.size;
    if (!confirm(`Delete ${plural(n, "contact")}? This can't be undone.`)) return;
    try {
        await api("POST", "bulk-delete", { ids: [...S.selected] });
        if (S.selected.has(S.cur)) closeDetail();
        S.selected.clear();
        renderBulk();
        toast(`Deleted ${plural(n, "contact")}`);
        refresh();
    } catch (e) { toast(e.message, { error: true }); }
}

// ------------------------------------------------------------------ routing

function syncUrl(push) {
    const p = new URLSearchParams();
    if (S.view.filter) p.set("filter", S.view.filter);
    if (S.view.tag) p.set("tag", S.view.tag);
    if (S.view.group) p.set("group", S.view.group);
    if (S.cur) p.set("id", S.cur);
    const url = location.pathname + (p.toString() ? "?" + p : "");
    if (url === location.pathname + location.search) return;
    history[push ? "pushState" : "replaceState"]({ ct: 1 }, "", url);
}

function readUrl() {
    const p = new URLSearchParams(location.search);
    S.view = { filter: p.get("filter") || "", tag: p.get("tag") || "", group: p.get("group") || "" };
    return p.get("id");
}

function setView(v) {
    S.view = v;
    if (phone.matches) { window.left_sb = false; window.updateSidebars?.(false, window.right_sb); }
    renderSidebar();
    syncUrl(false);
    loadList();
}

function setPane(pane) {
    $("#ct-app").dataset.pane = pane;
}

async function open(id, { push = true, focus = false } = {}) {
    if (!id) return;
    const changed = id !== S.cur;
    S.cur = id;
    markActiveRow();
    setPane("detail");
    if (changed) syncUrl(push && phone.matches);
    try {
        const p = await api("GET", id);
        if (S.cur !== id) return;
        S.person = p;
        renderDetail($("#ct-detail"), p, ctx);
        if (focus) $("#ct-detail").focus();
    } catch (e) {
        if (e.status === 404) { closeDetail(); toast("That contact no longer exists", { error: true }); }
        else toast(e.message, { error: true });
    }
}

function closeDetail() {
    S.cur = null;
    S.person = null;
    setPane("list");
    markActiveRow();
    syncUrl(false);
    showOverview();
}

function showOverview() {
    if (S.cur || !S.stats) return;
    renderOverview($("#ct-detail"), S.stats, ctx);
}

function newContact() {
    S.cur = null;
    markActiveRow();
    setPane("detail");
    renderEditor($("#ct-detail"), null, ctx);
}

async function refresh() {
    await Promise.all([loadList(), loadStats()]);
}

// Callbacks for detail.js and dialogs.js
const ctx = {
    boot,
    open,
    refresh,
    closeDetail,
    newContact,
    back: () => { if (phone.matches && history.state?.ct) history.back(); else closeDetail(); },
    edit: (p) => renderEditor($("#ct-detail"), p, ctx),
    async saved(p) {
        S.cur = p.id;
        S.person = p;
        renderDetail($("#ct-detail"), p, ctx);
        syncUrl(false);
        await refresh();
        markActiveRow();
    },
    cancelEdit() {
        if (S.person && S.cur) renderDetail($("#ct-detail"), S.person, ctx);
        else closeDetail();
    },
    async deleted(name) {
        closeDetail();
        toast(`Deleted ${name}`);
        await refresh();
    },
    updated(p) {
        S.person = p;
        renderDetail($("#ct-detail"), p, ctx);
        const i = S.items.findIndex((x) => x.id === p.id);
        if (i >= 0) { S.items[i] = { ...S.items[i], ...p }; renderList(); }
        loadStats();
    },
    search: async (q) => (await api("GET", qs({ q, limit: 8 }))).items,
};

// ------------------------------------------------------------------ keyboard

function move(delta) {
    if (!S.items.length) return;
    let i = S.items.findIndex((p) => p.id === S.cur);
    i = i < 0 ? (delta > 0 ? 0 : S.items.length - 1) : Math.max(0, Math.min(S.items.length - 1, i + delta));
    open(S.items[i].id, { push: false });
}

function typing(e) {
    const t = e.target;
    return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ($("#ct-dialog").open) return;
    if (e.key === "Escape" && typing(e) && e.target.id === "ct-q") { e.target.value = ""; e.target.blur(); onSearch(""); return; }
    if (typing(e)) return;
    if (e.key === "/") { e.preventDefault(); $("#ct-q").focus(); $("#ct-q").select(); }
    else if (e.key === "n") { e.preventDefault(); newContact(); }
    else if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "e" && S.person && !$(".ct-editor")) { e.preventDefault(); ctx.edit(S.person); }
    else if (e.key === "Escape" && $(".ct-editor")) ctx.cancelEdit();
    else if (e.key === "Escape" && phone.matches && S.cur) ctx.back();
});

// ------------------------------------------------------------------ boot

const onSearch = debounce((v) => { S.q = v.trim(); loadList(); }, 150);

function init() {
    $("#ct-new").append(icon("plus"));
    $("#ct-menu-btn").append(icon("more"));
    $("#ct-new").addEventListener("click", newContact);
    $("#ct-side-new").addEventListener("click", newContact);
    $("#ct-q").addEventListener("input", (e) => onSearch(e.target.value));
    $("#ct-import-btn").addEventListener("click", () => openImport(ctx));
    $("#ct-dupes-btn").addEventListener("click", () => openDuplicates(ctx));
    $("#ct-settings-btn").addEventListener("click", () => openSettings(ctx));
    for (const b of $$(".ct-menu [data-action]")) {
        b.addEventListener("click", () => {
            const a = b.dataset.action;
            if (a === "import") openImport(ctx);
            else if (a === "dupes") openDuplicates(ctx);
            else if (a === "settings") openSettings(ctx);
            else if (a.startsWith("export-")) location.href = API + "export" + qs({ format: a.slice(7) });
        });
    }
    window.addEventListener("popstate", () => {
        const id = readUrl();
        renderSidebar();
        loadList();
        if (id) open(id, { push: false }); else closeDetail();
    });
    const id = readUrl();
    refresh().then(() => { if (id) open(id, { push: false }); });
}

init();
