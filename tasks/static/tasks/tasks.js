/* Tasks app entry: URL routing (?project= ?view= ?label= ?saved= ?layout= ?q= ?task=), header, toolbar,
 * quick add with a live parse preview, bulk actions, keyboard shortcuts and focus mode. */

import { $, $$, h, clear, icon, ring, api, qs, toast, menu, popover, closePopover, dialog, debounce, store, session, hovercard,
    fmtDay, startOfDay, addDays, endOfDay, isAllDay } from "./lib.js";
import { S, app, on, emit, adopt, project, label, loadMeta, refreshCounts, loadBuckets, quickAdd, setDone, patchTask,
    moveTask, deleteTasks, canEdit, PRIORITIES, inboxId, health, failed, recovered, retryNow, refreshProjects } from "./store.js";
import { parseQuick } from "./parse.js";
import { SMART, renderSidebar, setupProjectDrag, projectDialog, projectMenu, shareDialog, labelDialog, saveViewDialog, savedViewMenu } from "./sidebar.js";
import { renderList, setupListDrag, inlineEdit, toggleDone, manualOrder, taskSummary } from "./list.js";
import { renderBoard, setupBoardDrag, renderTable, tableColumnsMenu, renderCalendar, calendarRange, setupCalendarDrag, renderTimeline } from "./views.js";
import { openDetail, closeDetail, isOpen, currentTask } from "./detail.js";

const view = $("#tk-view");
const LAYOUTS = [
    { id: "list", label: "List", icon: "list", key: "l" },
    { id: "board", label: "Board", icon: "board", key: "b", projectOnly: true },
    { id: "table", label: "Table", icon: "table", key: "t" },
    { id: "calendar", label: "Calendar", icon: "calendar", key: "c" },
    { id: "timeline", label: "Timeline", icon: "timeline", key: "g" },
];
const SORTS = [["position", "Manual"], ["due", "Due date"], ["priority", "Priority"], ["title", "Title"], ["created", "Newest"], ["updated", "Recently updated"]];
const GROUPS = [["", "Automatic"], ["none", "No grouping"], ["due", "Due date"], ["priority", "Priority"], ["project", "Project"]];

// ================================================================== routing

const FILTER_KEYS = { prio: "priority_min", labels: "labels", assignee: "assignee", sort: "sort", group: "group" };

function readUrl() {
    const u = new URLSearchParams(location.search);
    const r = { scope: "view", id: "today", layout: u.get("layout") || "", q: u.get("q") || "", task: u.get("task") || null };
    if (u.get("project")) Object.assign(r, { scope: "project", id: u.get("project") });
    else if (u.get("label")) Object.assign(r, { scope: "label", id: u.get("label") });
    else if (u.get("saved")) Object.assign(r, { scope: "saved", id: u.get("saved") });
    else if (u.get("view")) {
        const v = u.get("view");
        if (v === "inbox") Object.assign(r, { scope: "project", id: inboxId() });
        else if (SMART.some((s) => s.id === v)) r.id = v;
    }
    const f = { priority_min: u.get("prio") || "", labels: (u.get("labels") || "").split(",").filter(Boolean).map(Number), assignee: u.get("assignee") || "",
        sort: u.get("sort") || "", group: u.get("group") || "" };
    return { r, f, showDone: u.get("done") === "1" };
}

/** Current state as URL params (task excluded unless asked). */
app.params = (withTask = false) => {
    const r = S.route, f = S.filters, p = {};
    if (r.scope === "project") p.project = r.id;
    else if (r.scope === "label") p.label = r.id;
    else if (r.scope === "saved") p.saved = r.id;
    else p.view = r.id;
    if (r.layout && r.layout !== defaultLayout(r)) p.layout = r.layout;
    if (r.q) p.q = r.q;
    for (const [k, fk] of Object.entries(FILTER_KEYS)) if (f[fk] && (!Array.isArray(f[fk]) || f[fk].length)) p[k] = f[fk];
    if (S.showDone) p.done = "1";
    if (withTask && r.task) p.task = r.task;
    return p;
};
app.href = (params) => "/tasks/" + qs(params);

app.go = (params, { replace = false } = {}) => {
    const url = app.href(params);
    if (url !== location.pathname + location.search) history[replace ? "replaceState" : "pushState"]({ tk: true, opened: !!params.task && !S.route.task }, "", url);
    applyRoute();
};

app.openTask = (id) => {
    S.cursor = id;
    const p = { ...app.params(), task: id };
    if (S.route.task) history.replaceState({ ...(history.state || {}), tk: true }, "", app.href(p));
    else history.pushState({ tk: true, opened: true }, "", app.href(p));
    applyRoute();
};

app.closeTask = () => {
    if (!S.route.task) return;
    if (history.state?.opened) history.back();
    else { history.replaceState({ tk: true }, "", app.href(app.params())); applyRoute(); }
};

app.reload = () => load({ quiet: true, force: true });
app.refreshView = () => load({ quiet: true });
app.render = () => scheduleRender();

function defaultLayout(r) {
    if (r.scope === "project") return store.get("layout." + r.id, null) || project(r.id)?.default_view || "list";
    return store.get(`layout.${r.scope}.${r.id}`, "list");
}

function layoutOk(id, r) { return !(id === "board" && r.scope !== "project"); }

let lastKey = "";
function applyRoute() {
    const { r, f, showDone } = readUrl();
    if (r.scope === "project" && !r.id) Object.assign(r, { scope: "view", id: "today" });
    r.layout = r.layout && layoutOk(r.layout, r) ? r.layout : defaultLayout(r);
    if (!layoutOk(r.layout, r)) r.layout = "list";
    const prevTask = S.route.task;
    const scopeChanged = S.route.scope !== r.scope || S.route.id !== r.id;
    S.route = r;
    S.filters = f;
    S.showDone = showDone;
    if (scopeChanged) { S.selected.clear(); S.cursor = r.task || null; S.collapsedSections.clear(); exitFocus(false); }
    const key = JSON.stringify([r.scope, r.id, r.layout, r.q, f, showDone]);
    if (key !== lastKey) { lastKey = key; load({ quiet: !scopeChanged }); }
    else scheduleRender();
    $("#tk-q").value = r.q;
    if (r.task && r.task !== prevTask) openDetail(r.task);
    else if (!r.task && prevTask) closeDetail();
    renderSidebar();
}

addEventListener("popstate", applyRoute);

// ================================================================== loading

function scopeParams() {
    const r = S.route, f = S.filters, p = {};
    if (r.scope === "project") Object.assign(p, { project: r.id, done: false });
    else if (r.scope === "label") p.label = r.id;
    else if (r.scope === "saved") Object.assign(p, S.views.find((v) => v.id === r.id)?.filters || {});
    else if (r.id !== "inbox") p.view = r.id;
    if (r.q) p.q = r.q;
    if (f.priority_min) p.priority_min = f.priority_min;
    if (f.labels.length) p.label = [p.label, ...f.labels].filter(Boolean).join(",");
    if (f.assignee) p.assignee = f.assignee;
    p.sort = f.sort || p.sort || (r.scope === "project" ? "position" : r.id === "done" ? "done" : "due");
    return p;
}

// What the tasks on screen cover, so a layout switch inside the same list can reuse them instead of refetching.
// kind: "open" (open tasks), "all" (open + done: the board), "range" (calendar month).
let have = null;
let lastSync = 0;
const scopeKey = () => JSON.stringify([S.route.scope, S.route.id, S.route.q, S.filters.priority_min, S.filters.labels, S.filters.assignee,
    S.filters.sort, S.route.scope === "saved" ? S.views.find((v) => v.id === S.route.id)?.filters : null]);
const needKind = (layout) => (layout === "calendar" ? "range" : layout === "board" ? "all" : "open");

let loadSeq = 0;
async function load({ quiet = false, force = false } = {}) {
    const seq = ++loadSeq, r = S.route, sk = scopeKey(), kind = needKind(r.layout);
    const range = kind === "range" ? calendarRange().start.toISOString() : "";
    const covers = (h) => h && h.sk === sk && ((h.kind === kind && h.range === range) || (h.kind === "all" && kind === "open"));
    const reuse = !force && covers(have);
    const base = scopeParams();
    const jobs = {};
    if (!reuse) {
        if (kind === "range") {
            const { start, end } = calendarRange();
            const p = { ...base, due_after: start.toISOString(), due_before: end.toISOString(), limit: 1000 };
            if (r.scope === "project") delete p.done;
            if (["today", "upcoming", "overdue", "nodate"].includes(p.view)) delete p.view;
            jobs.cal = api("GET", qs(p));
        } else if (kind === "all") {
            const p = { ...base, limit: 1000 };
            delete p.done;
            jobs.list = api("GET", qs(p));
            if (!S.buckets.has(r.id)) jobs.buckets = loadBuckets(r.id);
        } else {
            jobs.list = api("GET", qs({ ...base, limit: 1000 }));
        }
    }
    const fromAll = kind === "open" && (reuse ? have.kind === "all" : false);
    // Progress ring: the project's done count is fetched once, then kept up to date locally.
    if (r.scope === "project" && kind === "open" && !fromAll && (force || !S.doneCounts.has(r.id))) jobs.doneCount = api("GET", qs({ project: r.id, done: true, limit: 1 }));
    if (S.showDone && r.id !== "done" && ["list", "table"].includes(r.layout) && !fromAll && (force || !reuse || !have.done)) {
        const p = { ...base, done: true, sort: "done", limit: 100 };
        if (p.view && p.view !== "favorites" && p.view !== "assigned") delete p.view;
        jobs.done = api("GET", qs(p));
    }
    if (r.scope === "view" && r.id === "today" && (force || !reuse || S.doneToday == null)) {
        jobs.doneToday = api("GET", qs({ view: "done", done_after: startOfDay(new Date()).toISOString(), limit: 1 }));
    }

    if (reuse) {  // derive what the layout needs from what's loaded
        if (fromAll) {
            S.total = S.tasks.filter((t) => !t.done).length;
            if (r.scope === "project") { S.doneCounts.set(r.id, S.tasks.filter((t) => t.done).length); S.doneCount = S.doneCounts.get(r.id); }
            if (S.showDone) S.done = S.tasks.filter((t) => t.done);
        }
        if (!S.showDone && !fromAll) S.done = [];
        if (r.scope === "project" && S.doneCounts.has(r.id)) S.doneCount = S.doneCounts.get(r.id);
    }
    if (!Object.keys(jobs).length) { S.loading = false; scheduleRender(true); return; }

    if (!reuse && !quiet) {
        // First paint: the saved copy of this list if there is one, else a skeleton.
        if (!(have === null && paintSaved(sk, kind, range))) { S.loading = true; skeleton(); }
    }
    renderChrome();
    try {
        const keys = Object.keys(jobs), vals = await Promise.all(Object.values(jobs));
        if (seq !== loadSeq) return;
        const res = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
        if (res.cal) S.calTasks = res.cal.items.map(adopt);
        if (res.list) { S.tasks = res.list.items.map(adopt); S.total = res.list.total; }
        if (res.done) S.done = res.done.items.map(adopt);
        else if (!S.showDone) S.done = [];
        if (res.doneCount) S.doneCounts.set(r.id, res.doneCount.total);
        if (r.scope === "project") S.doneCount = S.doneCounts.get(r.id) ?? (res.done ? res.done.total : 0);
        if (res.doneToday) S.doneToday = res.doneToday.total;
        if (!reuse) have = { sk, kind, range, done: !!res.done };
        else if (res.done) have.done = true;
        lastSync = Date.now();
        S.fromSaved = false;
        S.loading = false;
        recovered("list");
        saveList();
        scheduleRender(true);
    } catch (e) {
        if (seq !== loadSeq) return;
        S.loading = false;
        if (failed("list", () => load({ quiet: true, force: true }), e)) {
            // Keep whatever is on screen for this list; otherwise the saved copy; otherwise say so, with a retry.
            if (covers(have) || paintSaved(sk, kind, range)) { scheduleRender(true); return; }
            have = null;
            clear(view, h("div.tk-empty.tk-load-error", h("p", "Couldn't load these tasks. The server may be restarting."),
                h("button.tk-btn", { type: "button", onclick: () => retryNow() }, icon("repeat", 14), "Try again")));
        } else {
            have = null;
            clear(view, h("div.tk-empty", e.status === 404 ? "This list doesn't exist or isn't shared with you." : `Couldn't load tasks: ${e.message}`));
        }
        renderChrome();
    }
}
on("reload", () => load({ quiet: true, force: true }));

/** The last list shown, kept in sessionStorage so a reload while the server restarts still paints something. */
function saveList() {
    const r = S.route;
    session.set("list", { sk: have.sk, kind: have.kind, range: have.range, tasks: S.tasks, total: S.total, calTasks: S.calTasks || [],
        done: S.done, doneCount: S.doneCount, doneToday: S.doneToday, buckets: r.scope === "project" ? S.buckets.get(r.id) || null : null });
}

function paintSaved(sk, kind, range) {
    const saved = session.get("list");
    const v = saved?.v;
    if (!v || v.sk !== sk || !(v.kind === kind && v.range === range) && !(v.kind === "all" && kind === "open")) return false;
    S.tasks = v.tasks.map(adopt);
    S.total = v.total;
    S.calTasks = v.calTasks.map(adopt);
    S.done = v.done.map(adopt);
    S.doneCount = v.doneCount;
    S.doneToday = v.doneToday;
    if (v.buckets && !S.buckets.has(S.route.id)) S.buckets.set(S.route.id, v.buckets);
    have = { sk, kind: v.kind, range: v.range, done: v.done.length > 0 };
    S.fromSaved = saved.at;
    S.loading = false;
    scheduleRender(true);
    emit("health");
    return true;
}

/** Refresh what's on screen: on focus after a while away, and every few minutes while the page is visible. No other polling. */
function syncNow() {
    if (health.failures.size || S.loading) return;
    loadMeta();
    load({ quiet: true, force: true });
}
const SYNC_AFTER = 2 * 60 * 1000, SYNC_EVERY = 5 * 60 * 1000;
const syncIfStale = () => { if (!document.hidden && lastSync && Date.now() - lastSync > SYNC_AFTER) syncNow(); };
addEventListener("focus", syncIfStale);
document.addEventListener("visibilitychange", syncIfStale);
setInterval(() => { if (!document.hidden && Date.now() - lastSync >= SYNC_EVERY) syncNow(); }, 60 * 1000);

// ------------------------------------------------------------------ "Couldn't refresh · Retry" banner

function renderBanner() {
    const el = $("#tk-banner");
    // The drawer's parts (details, comments, subtasks) show their own inline notes; this banner is about the list and sidebar.
    const failing = ["list", "meta", "counts", "projects"].some((k) => health.failures.has(k));
    el.hidden = !failing && !S.fromSaved;
    if (el.hidden) return;
    const when = S.fromSaved ? new Date(S.fromSaved).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
    clear(el, icon("overdue", 14),
        h("span.tk-banner-text", failing ? "Couldn't refresh" : "Saved copy", S.fromSaved ? ` · saved copy from ${when}` : ""),
        failing ? (health.retrying ? h("span.tk-banner-muted", "Retrying…")
            : h("button.tk-banner-btn", { type: "button", onclick: () => retryNow() }, "Retry")) : null);
}
on("health", renderBanner);

function skeleton() {
    clear(view, h("div.tk-skeleton", { "aria-hidden": "true" }, Array.from({ length: 6 }, () => h("div"))));
}

// ================================================================== rendering

let renderQueued = false;
function scheduleRender(force = false) {
    if (force) renderNow.force = true;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderNow(); });
}

function renderNow() {
    renderChrome();
    if (S.loading) return;
    const ae = document.activeElement;
    const busy = S.inlineEditing || (ae && view.contains(ae) && ae.matches("input,textarea") && !ae.closest(".tk-row-form,.tk-card-form"));
    if (busy && !renderNow.force) { ae.addEventListener("blur", () => scheduleRender(), { once: true }); return; }
    renderNow.force = false;
    const keep = [".tk-board", ".tk-table-wrap", ".tk-tl-scroll", ".tk-cal-scroll"].map((s) => [s, $(s, view)?.scrollLeft || 0]);
    const cols = $$(".tk-col-cards", view).map((c) => [c.dataset.bid, c.scrollTop]);
    const top = view.scrollTop;
    const focusTid = ae && view.contains(ae) && ae.matches("[data-tid]") ? ae.dataset.tid : null;
    const L = S.route.layout;
    view.dataset.layout = L;
    if (L === "board") renderBoard(view);
    else if (L === "table") renderTable(view);
    else if (L === "calendar") renderCalendar(view);
    else if (L === "timeline") renderTimeline(view);
    else renderList(view);
    for (const [s, x] of keep) { const el = $(s, view); if (el) el.scrollLeft = x; }
    for (const [bid, y] of cols) { const el = $(`.tk-col-cards[data-bid="${bid}"]`, view); if (el) el.scrollTop = y; }
    view.scrollTop = top;
    if (focusTid) $(`[data-tid="${focusTid}"]`, view)?.focus({ preventScroll: true });
    if (S.flash) {
        const el = $(`[data-tid="${S.flash}"]`, view);
        S.flash = null;
        if (el) { el.classList.add("is-flash"); el.scrollIntoView({ block: "nearest" }); }
    }
}

on("tasks", () => scheduleRender());
on("task", () => scheduleRender());
on("meta", () => { renderSidebar(); renderChrome(); });
on("health", () => renderSidebar());

function scopeInfo() {
    const r = S.route;
    if (r.scope === "project") {
        const p = project(r.id);
        return { name: p ? (p.is_inbox ? "Inbox" : p.name) : "Project", mark: h("span.tk-dot.tk-dot-lg", { style: { background: p?.colour || "var(--app-muted)" } }), p };
    }
    if (r.scope === "label") {
        const l = label(+r.id);
        return { name: l?.name || "Label", mark: icon("tag", 18) };
    }
    if (r.scope === "saved") return { name: S.views.find((v) => v.id === r.id)?.name || "Saved view", mark: icon("filter", 18) };
    const v = SMART.find((s) => s.id === r.id) || SMART[1];
    return { name: v.label, mark: icon(v.icon, 18) };
}

function renderChrome() {
    renderHeader();
    renderToolbar();
    renderBulk();
}

function renderHeader() {
    const r = S.route, info = scopeInfo();
    document.title = `${info.name} · Tasks · AVNet Superapp`;
    clear($("#tk-title-mark"), info.mark);
    $("#tk-title").textContent = info.name;

    const sub = $("#tk-sub");
    if (S.loading) clear(sub);
    else if (r.layout === "calendar") clear(sub);
    else if (r.scope === "project" && r.layout !== "board") {
        const open = S.total, done = S.doneCount || 0, all = open + done;
        clear(sub, all ? ring(done / all, 16) : null, `${open} open${done ? ` · ${done} done` : ""}`);
        sub.title = all ? `${Math.round((done / all) * 100)}% complete` : "";
    } else if (r.scope === "view" && r.id === "today") {
        const open = S.tasks.filter((t) => !t.done).length, done = S.doneToday || 0;
        clear(sub, ring(done + open ? done / (done + open) : 0, 16), `${done} of ${done + open} done today`);
    } else if (r.layout === "board") {
        clear(sub, `${S.tasks.filter((t) => !t.done).length} open`);
    } else clear(sub, S.route.layout === "calendar" ? "" : `${S.tasks.filter((t) => !t.done).length} task${S.tasks.length === 1 ? "" : "s"}`);

    clear($("#tk-layouts"), LAYOUTS.filter((l) => layoutOk(l.id, r)).map((l) => h("button.tk-seg-btn" + (l.id === r.layout ? ".is-on" : ""), {
        type: "button", role: "tab", "aria-selected": String(l.id === r.layout), title: `${l.label} (v then ${l.key})`,
        onclick: () => setLayout(l.id),
    }, icon(l.icon, 14), h("span.tk-seg-label", l.label))));

    const acts = [];
    if (r.layout === "list") acts.push(h("button.tk-btn" + (document.body.classList.contains("tk-focus") ? ".is-on" : ""), {
        type: "button", title: "Focus mode (f)", onclick: toggleFocus, "aria-pressed": String(document.body.classList.contains("tk-focus")),
    }, icon("focus", 14), h("span.tk-btn-label", "Focus")));
    if (info.p && !info.p.is_inbox) acts.push(h("button.tk-btn", { type: "button", onclick: () => shareDialog(info.p) }, icon("share", 14), h("span.tk-btn-label", "Share")));
    if (info.p) acts.push(h("button.tk-icon-btn", { type: "button", "aria-label": "Project options", onclick: (e) => projectMenu(e.currentTarget, info.p) }, icon("more", 16)));
    if (r.scope === "saved") {
        const v = S.views.find((x) => x.id === r.id);
        if (v) acts.push(h("button.tk-icon-btn", { type: "button", "aria-label": "View options", onclick: (e) => savedViewMenu(e.currentTarget, v) }, icon("more", 16)));
    }
    clear($("#tk-head-actions"), acts);
}

function setLayout(id) {
    const r = S.route;
    store.set(r.scope === "project" ? "layout." + r.id : `layout.${r.scope}.${r.id}`, id);
    if (id !== "list") exitFocus();
    app.go({ ...app.params(true), layout: id });
}

function filtersActive() {
    const f = S.filters;
    return !!(f.priority_min || f.labels.length || f.assignee || S.route.q);
}

function renderToolbar() {
    const f = S.filters, r = S.route, L = r.layout;
    const chips = [];
    const drop = (patch) => app.go({ ...app.params(true), ...patch });
    if (f.priority_min) chips.push(chip(`Priority ≥ ${PRIORITIES.find((p) => p.value === +f.priority_min)?.label || f.priority_min}`, () => drop({ prio: "" })));
    for (const id of f.labels) { const l = label(id); chips.push(chip(l ? l.name : "Label", () => drop({ labels: f.labels.filter((x) => x !== id) }))); }
    if (f.assignee) chips.push(chip(`Assignee: ${f.assignee === S.me.username ? "me" : f.assignee}`, () => drop({ assignee: "" })));
    clear($("#tk-filter-chips"), chips);

    const sortLabel = SORTS.find(([k]) => k === (f.sort || scopeParams().sort))?.[1] || "Manual";
    const tools = [
        h("button.tk-btn" + (f.priority_min || f.labels.length || f.assignee ? ".is-on" : ""), { type: "button", onclick: (e) => filterPopover(e.currentTarget) }, icon("filter", 14), h("span.tk-btn-label", "Filter")),
        L !== "calendar" && L !== "board" ? h("button.tk-btn", {
            type: "button", title: "Sort",
            onclick: (e) => menu(e.currentTarget, SORTS.filter(([k]) => k !== "position" || r.scope === "project").map(([k, l]) => ({
                label: l, checked: (f.sort || scopeParams().sort) === k, onClick: () => drop({ sort: k }),
            })), { align: "end" }),
        }, icon("sort", 14), h("span.tk-btn-label", sortLabel)) : null,
        L === "list" ? h("button.tk-btn", {
            type: "button", title: "Group",
            onclick: (e) => menu(e.currentTarget, GROUPS.map(([k, l]) => ({ label: l, checked: f.group === k, onClick: () => drop({ group: k }) })), { align: "end" }),
        }, icon("group", 14), h("span.tk-btn-label", GROUPS.find(([k]) => k === f.group)?.[1] === "Automatic" ? "Group" : GROUPS.find(([k]) => k === f.group)?.[1])) : null,
        ["list", "table"].includes(L) && r.id !== "done" ? h("button.tk-btn" + (S.showDone ? ".is-on" : ""), {
            type: "button", "aria-pressed": String(S.showDone), title: "Show completed tasks",
            onclick: () => drop({ done: S.showDone ? "" : "1" }),
        }, icon("done", 14), h("span.tk-btn-label", "Completed")) : null,
        L === "table" ? h("button.tk-btn", { type: "button", onclick: (e) => tableColumnsMenu(e.currentTarget) }, icon("columns", 14), h("span.tk-btn-label", "Columns")) : null,
        filtersActive() && r.scope !== "saved" ? h("button.tk-btn.tk-btn-accent", { type: "button", onclick: saveCurrentView }, h("span", "Save view")) : null,
        r.scope === "saved" && filtersActive() ? h("button.tk-btn.tk-btn-accent", { type: "button", onclick: updateSavedView }, h("span", "Update view")) : null,
    ];
    clear($("#tk-tools"), tools);
}

function chip(text, onRemove) {
    return h("span.tk-fchip", text, h("button", { type: "button", "aria-label": `Remove filter ${text}`, onclick: onRemove }, icon("x", 12)));
}

function filterPopover(anchor) {
    const f = S.filters;
    const set = (patch) => { closePopover(); app.go({ ...app.params(true), ...patch }); };
    const prio = h("div.tk-seg.tk-seg-sm", [["", "Any"], ["5", "Low+"], ["10", "Medium+"], ["15", "High+"], ["20", "Urgent"]].map(([v, l]) =>
        h("button.tk-seg-btn" + ((f.priority_min || "") === v ? ".is-on" : ""), { type: "button", onclick: () => set({ prio: v }) }, l)));
    const labels = h("div.tk-menu.tk-menu-scroll", S.labels.length ? S.labels.map((l) => {
        const onL = f.labels.includes(l.id);
        return h("button.tk-menu-item" + (onL ? ".is-checked" : ""), {
            type: "button", role: "menuitemcheckbox", "aria-checked": String(onL),
            onclick: () => set({ labels: onL ? f.labels.filter((x) => x !== l.id) : [...f.labels, l.id] }),
        }, h("span.tk-dot", { style: { background: l.colour || "var(--app-muted)" } }), h("span.tk-menu-label", l.name), onL ? icon("check", 14, "tk-menu-check") : null);
    }) : h("div.tk-menu-head", "No labels yet"));
    const who = h("div.tk-seg.tk-seg-sm",
        h("button.tk-seg-btn" + (!f.assignee ? ".is-on" : ""), { type: "button", onclick: () => set({ assignee: "" }) }, "Anyone"),
        h("button.tk-seg-btn" + (f.assignee === S.me.username ? ".is-on" : ""), { type: "button", onclick: () => set({ assignee: S.me.username }) }, "Me"));
    const other = h("input.form-control.form-control-sm", { placeholder: "Username", value: f.assignee && f.assignee !== S.me.username ? f.assignee : "", "aria-label": "Assignee username" });
    other.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); set({ assignee: other.value.trim().replace(/^@/, "") }); } });
    popover(anchor, h("div.tk-filterpop",
        h("div.tk-fp-k", "Priority"), prio,
        h("div.tk-fp-k", "Labels"), labels,
        h("div.tk-fp-k", "Assignee"), h("div.d-flex.gap-2.align-items-center", who, other),
        filtersActive() ? h("button.tk-link-btn.mt-1", { type: "button", onclick: () => set({ prio: "", labels: [], assignee: "", q: "" }) }, "Clear all filters") : null),
    { className: "tk-pop-filter", focus: false });
}

function viewFilters() {
    const p = scopeParams();
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v != null));
}

function saveCurrentView() { saveViewDialog(null, viewFilters()); }

async function updateSavedView() {
    const v = S.views.find((x) => x.id === S.route.id);
    try {
        Object.assign(v, await api("PATCH", `views/${v.id}`, { filters: viewFilters() }));
        toast("View updated");
        app.go({ saved: v.id });
    } catch (e) { toast(e.message, { error: true }); }
}

// ================================================================== search

const q = $("#tk-q");
q.addEventListener("input", debounce(() => {
    const p = { ...app.params(true), q: q.value.trim() };
    const url = app.href(p);
    history.replaceState(history.state, "", url);
    applyRoute();
}, 300));
q.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); if (q.value) { q.value = ""; q.dispatchEvent(new Event("input")); } else q.blur(); }
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); moveCursor(1, true); }
});

// ================================================================== quick add

const quickForm = $("#tk-quick"), quickInput = $("#tk-quick-input"), preview = $("#tk-quick-preview");
clear($(".tk-quick-plus"), icon("plus", 16));

function renderPreview() {
    const text = quickInput.value;
    if (!text.trim()) {
        clear(preview, document.activeElement === quickInput ? h("span.tk-hint", "Dates like ", h("b", "tomorrow 5pm"), ", ", h("b", "next fri"), ", ", h("b", "in 3 days"),
            " · ", h("b", "every week"), " · ", h("b", "*label"), " · ", h("b", "+Project"), " · ", h("b", "!1–4"), " priority") : null);
        return;
    }
    const p = parseQuick(text);
    const bits = [];
    const due = p.due || contextDue();
    if (due) bits.push(h("span.tk-pchip", icon("calendar", 12), fmtDay(due.toISOString()) + (p.due ? "" : " (this list)")));
    if (p.repeatMode) bits.push(h("span.tk-pchip", icon("repeat", 12), p.repeatText || "repeats"));
    if (p.priority) bits.push(h("span.tk-pchip.p" + (p.priority > 15 ? 4 : p.priority > 10 ? 3 : p.priority > 5 ? 2 : 1), icon("flag", 12), PRIORITIES.find((x) => x.value === p.priority)?.label));
    const proj = p.project ? S.projects.find((x) => x.name.toLowerCase() === p.project.toLowerCase()) : null;
    if (p.project) bits.push(h("span.tk-pchip", icon("folder", 12), proj ? proj.name : `${p.project} (new project)`));
    else if (S.route.scope === "project") { const cp = project(S.route.id); if (cp) bits.push(h("span.tk-pchip.is-quiet", icon("folder", 12), cp.name)); }
    for (const l of p.labels) bits.push(h("span.tk-pchip", icon("tag", 12), l + (S.labels.some((x) => x.name.toLowerCase() === l.toLowerCase()) ? "" : " (new)")));
    clear(preview, h("span.tk-ptitle", p.title || "Untitled"), bits, h("span.tk-hint.tk-hint-enter", "Enter to add"));
}

function contextDue() {
    if (S.route.scope === "view" && S.route.id === "today") return endOfDay(new Date());
    return null;
}

quickInput.addEventListener("input", renderPreview);
quickInput.addEventListener("focus", () => { quickForm.classList.add("is-focus"); renderPreview(); });
quickInput.addEventListener("blur", () => { quickForm.classList.remove("is-focus"); setTimeout(renderPreview, 100); });
quickInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); quickInput.value = ""; renderPreview(); quickInput.blur(); } });

quickForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    let text = quickInput.value.trim();
    if (!text) return;
    const r = S.route, parsed = parseQuick(text), extra = {};
    if (r.scope === "project") extra.project_id = r.id;
    if (r.scope === "label") { const l = label(+r.id); if (l) text += ` *"${l.name}"`; }
    if (!parsed.due && r.scope === "view" && r.id === "today") text += " today";
    quickInput.value = "";
    renderPreview();
    try {
        const t = await quickAdd(text, extra);
        if (r.scope === "view" && r.id === "favorites") await patchTask(t, { favorite: true });
        if (r.scope === "view" && r.id === "assigned") await patchTask(t, { assignees: [S.me.username] });
        // Show it here if it belongs to this list (no reload); otherwise say where it went.
        const fits = matchesScope(t);
        if (fits === null) load({ quiet: true, force: true });
        else if (fits) { insertTask(t); S.flash = t.id; scheduleRender(true); }
        if (fits === false) {
            const p = project(t.project_id);
            toast(`Added to ${p ? (p.is_inbox ? "Inbox" : p.name) : "a project"}`, { action: "Open", onAction: () => app.openTask(t.id) });
        }
    } catch (err) {
        quickInput.value = text;
        toast(err.message, { error: true });
    }
});

/** Does a task belong in the current list? Mirrors the server's filters; null = can't tell (reload instead). */
function matchesScope(t) {
    const p = scopeParams();
    if (p.due_before || p.due_after || p.parent || p.top_level || p.done_after) return null;
    const now = new Date(), endToday = endOfDay(now), due = t.due ? new Date(t.due) : null;
    if (p.project && t.project_id !== p.project) return false;
    if (!p.project && project(t.project_id)?.archived) return false;
    const views = {
        today: () => due && due <= endToday,
        upcoming: () => due && due >= startOfDay(now) && due <= addDays(endToday, 7),
        overdue: () => due && due < now,
        nodate: () => !due,
        favorites: () => t.favorite,
        assigned: () => (t.assignees || []).some((a) => a.username === S.me.username),
        done: () => true,
    };
    if (p.view && !views[p.view]?.()) return false;
    const wantDone = p.view === "done" ? true : p.done ?? (p.view || !p.project ? false : null);
    if (wantDone != null && !!t.done !== !!wantDone) return false;
    if (p.label && !String(p.label).split(",").every((id) => (t.labels || []).includes(+id))) return false;
    if (p.priority_min && t.priority < +p.priority_min) return false;
    if (p.assignee && !(t.assignees || []).some((a) => a.username === p.assignee)) return false;
    if (p.q && !`${t.title} ${t.description || ""}`.toLowerCase().includes(String(p.q).toLowerCase())) return false;
    return true;
}

const SORT_CMP = {
    position: (a, b) => a.position - b.position,
    due: (a, b) => (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity) || b.priority - a.priority,
    priority: (a, b) => b.priority - a.priority || (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity),
    title: (a, b) => a.title.localeCompare(b.title),
    created: (a, b) => new Date(b.created_on) - new Date(a.created_on),
    updated: (a, b) => new Date(b.updated_on) - new Date(a.updated_on),
    done: (a, b) => new Date(b.done_at || 0) - new Date(a.done_at || 0),
};

/** Put a new task where the server's sort would. */
function insertTask(t) {
    if (S.route.layout === "calendar") { if (t.due) S.calTasks = [...(S.calTasks || []), t]; return; }
    if (S.tasks.includes(t)) return;
    S.tasks = [...S.tasks, t].sort(SORT_CMP[scopeParams().sort] || SORT_CMP.position);
    S.total += 1;
}

// ================================================================== selection, cursor and bulk actions

const rowsInView = () => $$("[data-tid]", view).filter((el) => !el.closest(".tk-cal-agenda") && !el.classList.contains("tk-tl-bar"));

function setCursor(id, scroll = true) {
    S.cursor = id;
    for (const el of $$(".is-cursor", view)) el.classList.remove("is-cursor");
    const el = id && $(`[data-tid="${id}"]`, view);
    if (el) { el.classList.add("is-cursor"); if (scroll) el.scrollIntoView({ block: "nearest" }); el.focus({ preventScroll: true }); }
}

function moveCursor(step, fromSearch = false) {
    const rows = rowsInView();
    if (!rows.length) return;
    const ids = [...new Set(rows.map((r) => r.dataset.tid))];
    let i = ids.indexOf(S.cursor);
    i = i < 0 || fromSearch ? (step > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + step));
    setCursor(ids[i]);
    if (isOpen()) app.openTask(ids[i]);
}

function toggleSelect(id) {
    S.selected[S.selected.has(id) ? "delete" : "add"](id);
    scheduleRender(true);
}

let anchorId = null;
view.addEventListener("click", (e) => {
    const el = e.target.closest("[data-tid]");
    if (!el || e.target.closest("button,input,textarea,a,select,form")) return;
    const id = el.dataset.tid;
    if (e.metaKey || e.ctrlKey) { toggleSelect(id); anchorId = id; setCursor(id, false); return; }
    if (e.shiftKey && (anchorId || S.cursor)) {
        const ids = [...new Set(rowsInView().map((r) => r.dataset.tid))];
        const a = ids.indexOf(anchorId || S.cursor), b = ids.indexOf(id);
        for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) S.selected.add(x);
        getSelection()?.removeAllRanges();
        scheduleRender(true);
        return;
    }
    anchorId = id;
    if (S.selected.size) { S.selected.clear(); scheduleRender(true); }
    app.openTask(id);
});
view.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".tk-list .tk-row[data-tid] .tk-title-text");
    if (el) { const t = S.byId.get(el.closest("[data-tid]").dataset.tid); if (t) inlineEdit(t); }
});

const targets = () => {
    const ids = S.selected.size ? [...S.selected] : (S.cursor ? [S.cursor] : []);
    return ids.map((id) => S.byId.get(id)).filter((t) => t && canEdit(t));
};

function renderBulk() {
    const bar = $("#tk-bulk"), n = S.selected.size;
    bar.hidden = !n;
    if (!n) return;
    const sel = () => [...S.selected].map((id) => S.byId.get(id)).filter(Boolean);
    const all = (fn) => Promise.allSettled(sel().filter(canEdit).map(fn)).then(() => { emit("tasks"); refreshCounts(); });
    const today = startOfDay(new Date());
    clear(bar,
        h("span.tk-bulk-n", `${n} selected`),
        h("button.tk-btn", { type: "button", onclick: () => { all((t) => setDone(t, true, { quiet: true })); toast(`Completed ${n} task${n > 1 ? "s" : ""}`); S.selected.clear(); } }, icon("check", 14), h("span.tk-btn-label", "Complete")),
        h("button.tk-btn", {
            type: "button",
            onclick: (e) => menu(e.currentTarget, [["Today", today], ["Tomorrow", addDays(today, 1)], ["Next week", addDays(today, 7)], ["No date", null]].map(([l, d]) => ({
                label: l, icon: "calendar", onClick: () => all((t) => patchTask(t, { due: d ? endOfDay(d).toISOString() : null })),
            }))),
        }, icon("calendar", 14), h("span.tk-btn-label", "Due")),
        h("button.tk-btn", {
            type: "button",
            onclick: (e) => menu(e.currentTarget, PRIORITIES.slice().reverse().map((p) => ({ label: p.label, icon: "flag", hint: p.key, onClick: () => all((t) => patchTask(t, { priority: p.value })) }))),
        }, icon("flag", 14), h("span.tk-btn-label", "Priority")),
        h("button.tk-btn", {
            type: "button",
            onclick: (e) => menu(e.currentTarget, S.labels.length ? S.labels.map((l) => ({
                label: l.name, swatch: l.colour,
                onClick: () => {
                    const ts = sel(), has = ts.every((t) => (t.labels || []).includes(l.id));
                    all((t) => patchTask(t, { labels: has ? t.labels.filter((x) => x !== l.id) : [...new Set([...(t.labels || []), l.id])] }));
                },
            })) : [{ label: "No labels yet", disabled: true }]),
        }, icon("tag", 14), h("span.tk-btn-label", "Label")),
        h("button.tk-btn", {
            type: "button",
            onclick: (e) => menu(e.currentTarget, S.projects.filter((p) => p.role >= 1 && !p.archived).map((p) => ({
                label: p.is_inbox ? "Inbox" : p.name, swatch: p.colour,
                onClick: async () => {
                    const ts = sel();
                    if (S.route.scope === "project" && p.id !== S.route.id) S.tasks = S.tasks.filter((t) => !ts.includes(t));
                    S.selected.clear();
                    await Promise.allSettled(ts.map((t) => moveTask(t, { project_id: p.id })));
                    toast(`Moved ${ts.length} task${ts.length > 1 ? "s" : ""} to ${p.name}`);
                },
            }))),
        }, icon("folder", 14), h("span.tk-btn-label", "Move")),
        h("button.tk-btn.is-danger", { type: "button", onclick: () => { deleteTasks(sel().filter(canEdit)); S.selected.clear(); } }, icon("trash", 14), h("span.tk-btn-label", "Delete")),
        h("div.tk-grow"),
        h("button.tk-icon-btn", { type: "button", "aria-label": "Clear selection", title: "Clear selection (Esc)", onclick: () => { S.selected.clear(); scheduleRender(true); } }, icon("x", 14)));
}

// ================================================================== focus mode

function toggleFocus() {
    if (document.body.classList.contains("tk-focus")) exitFocus();
    else {
        if (S.route.layout !== "list") setLayout("list");
        document.body.classList.add("tk-focus");
        S.focusPrevSidebar = window.left_sb;
        if (window.updateSidebars) { window.left_sb = false; window.updateSidebars(false, window.right_sb); }
        renderChrome();
    }
}

function exitFocus(rerender = true) {
    if (!document.body.classList.contains("tk-focus")) return;
    document.body.classList.remove("tk-focus");
    if (window.updateSidebars && S.focusPrevSidebar) { window.left_sb = true; window.updateSidebars(true, window.right_sb); }
    if (rerender) renderChrome();
}

// ================================================================== keyboard

const HELP = [
    ["General", [["q", "Quick add"], ["/", "Search"], ["?", "Show shortcuts"], ["f", "Focus mode"], ["[", "Toggle sidebar"], ["Esc", "Close / clear selection"]]],
    ["Tasks", [["j / k", "Next / previous"], ["Enter", "Open details"], ["x", "Select"], ["e", "Edit title"], ["d", "Complete"], ["s", "Favorite"],
        ["t", "Due today"], ["1 – 4", "Priority low → urgent"], ["Del", "Delete"]]],
    ["Go to", [["g i", "Inbox"], ["g t", "Today"], ["g u", "Upcoming"], ["g o", "Overdue"], ["g a", "Assigned to me"], ["g d", "Done"]]],
    ["Layout", [["v l", "List"], ["v b", "Board"], ["v t", "Table"], ["v c", "Calendar"], ["v g", "Timeline"]]],
];

function showHelp() {
    dialog({
        title: "Keyboard shortcuts", wide: true,
        body: h("div.tk-help", HELP.map(([title, keys]) => h("section", h("h3", title),
            h("dl", keys.map(([k, d]) => [h("dt", k.split(" ").map((part) => part === "/" && k !== "/" ? " / " : h("kbd", part))), h("dd", d)]))))),
    });
}

let prefix = null, prefixTimer;
document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const tgt = e.target;
    if (tgt.closest?.("input,textarea,select,[contenteditable=true],dialog")) return;
    const k = e.key;

    if (prefix) {
        const p = prefix;
        prefix = null;
        clearTimeout(prefixTimer);
        if (p === "g") {
            const map = { i: { project: inboxId() }, t: { view: "today" }, u: { view: "upcoming" }, o: { view: "overdue" }, n: { view: "nodate" }, f: { view: "favorites" }, a: { view: "assigned" }, d: { view: "done" } };
            if (map[k]) { e.preventDefault(); app.go(map[k]); }
        } else if (p === "v") {
            const l = LAYOUTS.find((x) => x.key === k);
            if (l && layoutOk(l.id, S.route)) { e.preventDefault(); setLayout(l.id); }
        }
        return;
    }

    const cur = () => (isOpen() && !S.selected.size ? [currentTask()] : targets()).filter(Boolean);
    switch (k) {
        case "q": case "n": e.preventDefault(); quickInput.focus(); break;
        case "/": e.preventDefault(); q.focus(); q.select(); break;
        case "?": e.preventDefault(); showHelp(); break;
        case "g": case "v": prefix = k; prefixTimer = setTimeout(() => { prefix = null; }, 1200); break;
        case "j": case "ArrowDown": e.preventDefault(); moveCursor(1); break;
        case "k": case "ArrowUp": e.preventDefault(); moveCursor(-1); break;
        case "Enter": case "o": if (S.cursor) { e.preventDefault(); app.openTask(S.cursor); } break;
        case "x": if (S.cursor) { e.preventDefault(); toggleSelect(S.cursor); } break;
        case "e": {
            const t = S.cursor && S.byId.get(S.cursor);
            if (!t) break;
            e.preventDefault();
            if (S.route.layout === "list" && !isOpen()) inlineEdit(t);
            else { if (!isOpen()) app.openTask(t.id); setTimeout(() => $(".tk-dr-title")?.focus(), 250); }
            break;
        }
        case "d": { const ts = cur(); if (ts.length) { e.preventDefault(); for (const t of ts) toggleDone(t); S.selected.clear(); } break; }
        case "s": { const ts = cur(); if (ts.length) { e.preventDefault(); const fav = !ts.every((t) => t.favorite); for (const t of ts) patchTask(t, { favorite: fav }).catch(() => {}); } break; }
        case "t": { const ts = cur(); if (ts.length) { e.preventDefault(); const due = endOfDay(new Date()).toISOString(); for (const t of ts) patchTask(t, { due }).catch(() => {}); toast("Due today"); } break; }
        case "1": case "2": case "3": case "4": {
            const ts = cur();
            if (!ts.length) break;
            e.preventDefault();
            const p = PRIORITIES[+k];
            for (const t of ts) patchTask(t, { priority: p.value }).catch(() => {});
            toast(`Priority: ${p.label}`, { timeout: 1500 });
            break;
        }
        case "Delete": case "Backspace": { const ts = cur(); if (ts.length) { e.preventDefault(); deleteTasks(ts); } break; }
        case "f": if (S.route.layout === "list") { e.preventDefault(); toggleFocus(); } break;
        case "[": e.preventDefault(); window.toggleLeftSidebar?.(); break;
        case "Escape":
            if (isOpen()) { app.closeTask(); }
            else if (S.selected.size) { S.selected.clear(); scheduleRender(true); }
            else if (document.body.classList.contains("tk-focus")) exitFocus();
            break;
        default:
    }
});

// The drawer: Esc closes it from anywhere inside (popovers and fields stop Esc themselves).
$("#tk-drawer").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && !e.target.closest("input,textarea,select")) { e.stopPropagation(); app.closeTask(); }
});

// ================================================================== sidebar wiring

$("#tk-new-project").append(icon("plus", 14));
$("#tk-new-label").append(icon("plus", 14));
$("#tk-new-project").addEventListener("click", () => projectDialog());
$("#tk-new-label").addEventListener("click", () => labelDialog());
$("#tk-archived-toggle").addEventListener("click", async () => { S.showArchived = !S.showArchived; await refreshProjects(); });
for (const btn of $$(".tk-side-toggle")) {
    const key = "side." + btn.dataset.collapse;
    const apply = (collapsed) => {
        btn.setAttribute("aria-expanded", String(!collapsed));
        btn.closest(".tk-side-sec").classList.toggle("is-collapsed", collapsed);
    };
    apply(store.get(key, false));
    btn.prepend(icon("chevD", 12, "tk-side-chev"));
    btn.addEventListener("click", () => { const c = btn.getAttribute("aria-expanded") === "true"; store.set(key, c); apply(c); });
}

// ================================================================== boot

setupListDrag(view);
hovercard(view, ".tk-list .tk-title-text, .tk-card .tk-title-text, .tk-table .tk-title-text, .tk-cal-chip, .tk-tl-name, .tk-tl-bar", (el) => {
    const t = S.byId.get(el.closest("[data-tid]")?.dataset.tid);
    return t && t.id !== S.route.task ? taskSummary(t) : null;  // the open task is already in the drawer
});
setupBoardDrag(view);
setupCalendarDrag(view);
setupProjectDrag();

(async () => {
    // Never blank out: if the sidebar can't load, the list still tries (and both retry on their own).
    try { await loadMeta(); } catch (e) { toast(`Couldn't load your lists: ${e.message}`, { error: true }); }
    if (!history.state) history.replaceState({ tk: true, opened: false }, "", location.href);
    applyRoute();
})();
