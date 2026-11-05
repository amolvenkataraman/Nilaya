/* Tasks app state and server actions. Every task has one canonical object (S.byId) that the
 * list, board, table, calendar and detail drawer all share; actions update it optimistically,
 * roll back on error and tell the views to redraw through on()/emit().
 *
 * Requests are kept lean: mutations patch local state and refresh only the sidebar counts that can
 * change (one debounced overview call); projects, labels and saved views are cached in sessionStorage
 * for a few minutes. When the server can't be reached, what's on screen stays and health.* retries
 * with backoff (2 s, 5 s, 15 s, then every 30 s while the page is visible, plus on focus / online). */

import { api, qs, toast, debounce, fmtDay, store, session } from "./lib.js";

const boot = JSON.parse(document.getElementById("tk-boot").textContent);
const META_TTL = 5 * 60 * 1000;

export const S = {
    me: boot.me,
    overview: null,
    projects: [],
    showArchived: false,
    labels: [],
    views: [],
    members: new Map(),   // projectId -> [{id, user, role}]
    buckets: new Map(),   // projectId -> [bucket]
    byId: new Map(),
    route: { scope: "view", id: "today", layout: "list", q: "", task: null },
    filters: { priority_min: "", labels: [], assignee: "", sort: "", group: "" },
    showDone: false,
    tasks: [],            // current scope (open tasks unless the scope is "done"; all tasks on the board)
    total: 0,
    done: [],             // completed tasks when "Show completed" is on
    doneCount: 0,
    doneCounts: new Map(), // projectId -> completed tasks (progress ring), kept up to date locally
    loading: true,
    metaStale: false,     // sidebar shows a saved copy
    selected: new Set(),
    cursor: null,
    collapsedProjects: new Set(store.get("collapsedProjects", [])),
    collapsedTasks: new Set(store.get("collapsedTasks", [])),
    collapsedSections: new Set(),
    pendingDeletes: new Map(),
};

// ------------------------------------------------------------------ events

const listeners = new Map();
export function on(evt, fn) { (listeners.get(evt) || listeners.set(evt, []).get(evt)).push(fn); }
export function emit(evt, arg) { for (const fn of listeners.get(evt) || []) fn(arg); }

// ------------------------------------------------------------------ connection health & retries

const DELAYS = [2000, 5000, 15000, 30000];
export const health = { failures: new Map(), attempt: 0, retrying: false, timer: null };

/** A background load failed. Transient failures (no response / 5xx) are retried; returns true if it was transient. */
export function failed(key, retry, err) {
    if (!err?.transient) return false;
    health.failures.set(key, retry);
    schedule();
    emit("health");
    return true;
}

export function recovered(key) {
    if (!health.failures.delete(key)) return;
    if (!health.failures.size) { health.attempt = 0; clearTimeout(health.timer); health.timer = null; }
    emit("health");
}

function schedule() {
    if (health.timer || !health.failures.size) return;
    health.timer = setTimeout(() => { health.timer = null; retryNow(true); }, DELAYS[Math.min(health.attempt, DELAYS.length - 1)]);
}

export async function retryNow(fromTimer = false) {
    if (health.retrying || !health.failures.size) return;
    if (document.hidden) return;  // resumed by visibilitychange
    clearTimeout(health.timer);
    health.timer = null;
    if (fromTimer) health.attempt++;
    health.retrying = true;
    emit("health");
    const jobs = [...health.failures.values()];
    await Promise.allSettled(jobs.map((fn) => fn()));
    health.retrying = false;
    schedule();
    emit("health");
}

addEventListener("online", () => retryNow());
addEventListener("focus", () => retryNow());
document.addEventListener("visibilitychange", () => { if (!document.hidden) retryNow(); });

// ------------------------------------------------------------------ lookups

export const project = (id) => S.projects.find((p) => p.id === id);
export const label = (id) => S.labels.find((l) => l.id === id);
export const inboxId = () => S.overview?.inbox_id;
export const canEdit = (t) => t.owner?.username === S.me.username || (project(t.project_id)?.role ?? 0) >= 1;
export const isOwner = (p) => p?.owner?.username === S.me.username;

export function adopt(item) {
    const t = S.byId.get(item.id);
    if (t) { Object.assign(t, item); return t; }
    S.byId.set(item.id, item);
    return item;
}

export const PRIORITIES = [
    { value: 0, label: "None", key: "" },
    { value: 5, label: "Low", key: "1" },
    { value: 10, label: "Medium", key: "2" },
    { value: 15, label: "High", key: "3" },
    { value: 20, label: "Urgent", key: "4" },
];
export function prioLevel(p) { return p > 15 ? 4 : p > 10 ? 3 : p > 5 ? 2 : p > 0 ? 1 : 0; }

// ------------------------------------------------------------------ sidebar data (projects, labels, views, counts)

const archivedQs = () => qs({ include_archived: S.showArchived || "" });

/** Persist the sidebar payload so a reload can paint at once (and survive a server restart). */
export function saveMeta() {
    if (S.metaStale || !S.overview) return;
    session.set("meta", { overview: S.overview, projects: S.projects, labels: S.labels, views: S.views, archived: S.showArchived });
}

/**
 * Overview counts always come fresh; projects, labels and saved views come from the session copy when it is
 * younger than META_TTL (unless force). If the server is unreachable, any saved copy is shown instead.
 */
export async function loadMeta({ force = false } = {}) {
    const cached = session.get("meta");
    const fresh = !force && cached && Date.now() - cached.at < META_TTL && cached.v.archived === S.showArchived;
    try {
        if (fresh) {
            Object.assign(S, { projects: cached.v.projects, labels: cached.v.labels, views: cached.v.views });
            S.overview = await api("GET", "overview");
        } else {
            const [overview, projects, labels, views] = await Promise.all([
                api("GET", "overview"), api("GET", "projects" + archivedQs()), api("GET", "labels"), api("GET", "views")]);
            Object.assign(S, { overview, projects, labels, views });
        }
        S.metaStale = false;
        recovered("meta");
        saveMeta();
    } catch (e) {
        if (!e.transient) throw e;
        if (cached && !S.overview) {
            Object.assign(S, { overview: cached.v.overview, projects: cached.v.projects, labels: cached.v.labels, views: cached.v.views });
            S.metaStale = true;
        }
        failed("meta", () => loadMeta({ force }), e);
    }
    emit("meta");
}

/** After a change that can move sidebar counts: one overview call (debounced, so bursts collapse). */
export const refreshCounts = debounce(async () => {
    try {
        S.overview = await api("GET", "overview");
        recovered("counts");
        saveMeta();
        emit("meta");
    } catch (e) {
        if (!failed("counts", refreshCounts, e)) { /* counts are best effort */ }
    }
}, 500);

export async function refreshProjects() {
    try {
        S.projects = await api("GET", "projects" + archivedQs());
        recovered("projects");
        saveMeta();
        emit("meta");
    } catch (e) {
        if (!failed("projects", refreshProjects, e)) toast(e.message, { error: true });
    }
}

async function refreshLabels() {
    try { S.labels = await api("GET", "labels"); saveMeta(); emit("meta"); } catch (_) { /* chips just miss a name */ }
}

/** Keep a project's open count (and the Inbox count) right without asking the server. */
export function bumpProject(projectId, delta) {
    const p = project(projectId);
    if (p) p.open_count = Math.max(0, (p.open_count || 0) + delta);
    if (S.overview && projectId === S.overview.inbox_id) S.overview.inbox = Math.max(0, S.overview.inbox + delta);
    emit("meta");
    saveMeta();
}

on("meta", () => saveMeta());

export async function loadMembers(projectId, force = false) {
    if (!projectId) return [];
    if (!force && S.members.has(projectId)) return S.members.get(projectId);
    const m = await api("GET", `projects/${projectId}/members`);
    S.members.set(projectId, m);
    return m;
}

export async function loadBuckets(projectId, force = false) {
    if (!force && S.buckets.has(projectId)) return S.buckets.get(projectId);
    const b = await api("GET", `projects/${projectId}/buckets`);
    S.buckets.set(projectId, b);
    return b;
}

/** Users who can be assigned in a project: me, the project owner, the task owner, current assignees, members. */
export async function assignable(t) {
    const out = new Map([[S.me.username, { username: S.me.username, name: S.me.name }]]);
    const owner = project(t?.project_id)?.owner;
    if (owner) out.set(owner.username, owner);
    if (t?.owner) out.set(t.owner.username, t.owner);
    for (const a of t?.assignees || []) out.set(a.username, a);
    try {
        for (const m of await loadMembers(t?.project_id)) out.set(m.user.username, m.user);
    } catch (_) { /* view-only or offline: the people above are enough */ }
    return [...out.values()];
}

// ------------------------------------------------------------------ task actions

const LOCAL = ["title", "description", "due", "start", "priority", "labels", "percent", "time_spent", "repeat_mode",
    "repeat_every", "favorite", "colour", "parent_id"];
const COUNTED = ["due", "favorite", "assignees"];  // fields that move overview counts

function snapshot(t) { return JSON.parse(JSON.stringify(t)); }
function restore(t, snap) { for (const k of Object.keys(t)) if (!(k in snap)) delete t[k]; Object.assign(t, snap); }

function actionFailed(e) {
    toast(e.transient ? `${e.message}. Your change was undone.` : e.message, { error: true });
}

export async function patchTask(t, patch) {
    const snap = snapshot(t);
    for (const k of LOCAL) if (k in patch) t[k] = patch[k];
    if (patch.assignees) {
        const known = new Map((t.assignees || []).map((a) => [a.username, a]));
        t.assignees = patch.assignees.map((u) => known.get(u) || { username: u, name: u });
    }
    emit("task", t);
    try {
        adopt(await api("PATCH", t.id, patch));
        emit("task", t);
        if (COUNTED.some((k) => k in patch)) refreshCounts();
        return t;
    } catch (e) {
        restore(t, snap);
        emit("task", t);
        actionFailed(e);
        throw e;
    }
}

function adjustDoneCount(projectId, delta) {
    if (S.doneCounts.has(projectId)) S.doneCounts.set(projectId, Math.max(0, S.doneCounts.get(projectId) + delta));
    if (S.route.scope === "project" && S.route.id === projectId) S.doneCount = S.doneCounts.get(projectId) ?? S.doneCount;
}

export async function setDone(t, done, { quiet = false } = {}) {
    const snap = snapshot(t);
    t.done = done;
    t.done_at = done ? new Date().toISOString() : null;
    emit("task", t);
    try {
        const r = await api("POST", `${t.id}/done${qs({ done })}`);
        adopt(r.task);
        if (r.repeated) {
            t._repeated = true;
            toast(`Repeating task moved to ${fmtDay(t.due || t.start)}`, {
                action: "Undo",
                onAction: () => patchTask(t, { due: snap.due, start: snap.start }),
            });
        } else {
            bumpProject(t.project_id, done ? -1 : 1);
            adjustDoneCount(t.project_id, done ? 1 : -1);
            if (S.doneToday != null && S.route.id === "today") S.doneToday += done ? 1 : -1;
            if (!quiet && done) toast(`Completed “${t.title}”`, { action: "Undo", onAction: () => setDone(t, false, { quiet: true }) });
        }
        emit("task", t);
        emit("tasks");
        refreshCounts();
        return r;
    } catch (e) {
        restore(t, snap);
        emit("task", t);
        actionFailed(e);
        throw e;
    }
}

export async function moveTask(t, body) {
    const snap = snapshot(t);
    if ("bucket_id" in body) t.bucket_id = body.bucket_id;
    if ("project_id" in body) t.project_id = body.project_id;
    if ("position" in body) t.position = body.position;
    emit("tasks");
    try {
        adopt(await api("POST", `${t.id}/move`, body));
        if (t.project_id !== snap.project_id && !t.done) { bumpProject(snap.project_id, -1); bumpProject(t.project_id, 1); }
        if (t.done !== snap.done) { bumpProject(t.project_id, t.done ? -1 : 1); adjustDoneCount(t.project_id, t.done ? 1 : -1); }
        emit("task", t);
        emit("tasks");
        if (t.project_id !== snap.project_id || t.done !== snap.done) refreshCounts();
        return t;
    } catch (e) {
        restore(t, snap);
        emit("tasks");
        actionFailed(e);
        throw e;
    }
}

/** Save the order of a project's tasks after a drop (one request; positions become 0..n). */
export async function reorderTasks(projectId, ordered) {
    const before = ordered.map((t) => t.position);
    ordered.forEach((t, i) => { t.position = i; });
    S.tasks.sort((a, b) => a.position - b.position);
    emit("tasks");
    try {
        await api("POST", `projects/${projectId}/reorder`, { ids: ordered.map((t) => t.id) });
    } catch (e) {
        ordered.forEach((t, i) => { t.position = before[i]; });
        S.tasks.sort((a, b) => a.position - b.position);
        emit("tasks");
        actionFailed(e);
    }
}

function created(t) {
    if (!t.done) bumpProject(t.project_id, 1);
    refreshCounts();
}

export async function createTask(body) {
    const t = adopt(await api("POST", "", body));
    created(t);
    return t;
}

export async function quickAdd(text, extra = {}) {
    const t = adopt(await api("POST", "quick", { text, ...extra }));
    // Quick add can create labels (*new) and projects (+New): fetch just that list before drawing the task.
    if (t.labels.some((id) => !label(id))) await refreshLabels();
    if (!project(t.project_id)) await refreshProjects();
    created(t);
    return t;
}

/** Delete with an undo window: the rows disappear now and the DELETE is sent when the toast expires. */
export function deleteTasks(tasks) {
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of S.tasks) if (ids.has(t.parent_id)) ids.add(t.id);  // subtasks go with their parent
    const saved = { tasks: S.tasks, done: S.done };
    const all = [...ids].map((id) => S.byId.get(id)).filter(Boolean);
    S.tasks = S.tasks.filter((t) => !ids.has(t.id));
    S.done = S.done.filter((t) => !ids.has(t.id));
    for (const id of ids) S.selected.delete(id);
    const roots = tasks.filter((t) => !tasks.some((x) => x.id === t.parent_id));  // children go with a deleted parent
    const key = Symbol("delete");
    const putBack = () => {
        // Re-insert what's not on screen any more (the list may have been re-sorted or reloaded meanwhile).
        const have = new Set(S.tasks.map((t) => t.id));
        S.tasks = [...S.tasks, ...saved.tasks.filter((t) => ids.has(t.id) && !have.has(t.id))];
        const haveDone = new Set(S.done.map((t) => t.id));
        S.done = [...S.done, ...saved.done.filter((t) => ids.has(t.id) && !haveDone.has(t.id))];
        emit("tasks");
    };
    const commit = async () => {
        if (!S.pendingDeletes.has(key)) return;
        S.pendingDeletes.delete(key);
        const results = await Promise.allSettled(roots.map((t) => api("DELETE", t.id).catch((e) => { if (e.status !== 404) throw e; })));
        const bad = results.filter((r) => r.status === "rejected");
        if (bad.length) {
            putBack();
            const e = bad[0].reason;
            toast(`Couldn't delete: ${e.message}. ${bad.length === roots.length ? "Nothing was deleted." : "Some tasks were restored."}`, { error: true });
            if (bad.length === roots.length) return;
        }
        for (const t of all) if (!t.done) bumpProject(t.project_id, -1);
        for (const id of ids) S.byId.delete(id);
        refreshCounts();
    };
    S.pendingDeletes.set(key, { roots });
    const timer = setTimeout(commit, 6000);
    emit("tasks");
    emit("deleted", ids);
    toast(roots.length === 1 ? `Deleted “${roots[0].title}”` : `Deleted ${roots.length} tasks`, {
        timeout: 6000, action: "Undo",
        onAction: () => {
            clearTimeout(timer);
            S.pendingDeletes.delete(key);
            putBack();
        },
    });
}

// Leaving the page sends deletes that are still waiting for their undo window.
addEventListener("pagehide", () => {
    for (const { roots } of S.pendingDeletes.values()) for (const t of roots) api("DELETE", t.id, undefined, { keepalive: true }).catch(() => {});
    S.pendingDeletes.clear();
});

export async function duplicateTask(t) {
    const copy = adopt(await api("POST", `${t.id}/duplicate`));
    const i = S.tasks.indexOf(t);
    S.tasks.splice(i < 0 ? S.tasks.length : i + 1, 0, copy);
    created(copy);
    emit("tasks");
    toast("Task duplicated");
    return copy;
}

/** Filled in by tasks.js: go(params), openTask(id), render(), href(params). Lets modules call each other without import cycles. */
export const app = {};

export const COLOURS = ["#e5484d", "#f76b15", "#ffb224", "#46a758", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#8d8d86"];
