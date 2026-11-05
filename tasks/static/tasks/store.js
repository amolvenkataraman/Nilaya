/* Tasks app state and server actions. Every task has one canonical object (S.byId) that the
 * list, board, table, calendar and detail drawer all share; actions update it optimistically,
 * roll back on error and tell the views to redraw through on()/emit(). */

import { api, qs, toast, debounce, fmtDay, store } from "./lib.js";

const boot = JSON.parse(document.getElementById("tk-boot").textContent);

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
    tasks: [],            // current scope (open tasks unless the scope is "done")
    total: 0,
    done: [],             // completed tasks when "Show completed" is on
    doneCount: 0,
    loading: true,
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

// ------------------------------------------------------------------ lookups

export const project = (id) => S.projects.find((p) => p.id === id);
export const label = (id) => S.labels.find((l) => l.id === id);
export const inboxId = () => S.overview?.inbox_id;
export const canEdit = (t) => t.owner?.username === S.me.username || (project(t.project_id)?.role ?? 0) >= 1;

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

// ------------------------------------------------------------------ loading

export async function loadMeta() {
    const [overview, projects, labels, views] = await Promise.all([
        api("GET", "overview"), api("GET", "projects" + qs({ include_archived: S.showArchived || "" })),
        api("GET", "labels"), api("GET", "views"),
    ]);
    Object.assign(S, { overview, projects, labels, views });
    emit("meta");
}

export const refreshCounts = debounce(async () => {
    try {
        const [overview, projects] = await Promise.all([api("GET", "overview"), api("GET", "projects" + qs({ include_archived: S.showArchived || "" }))]);
        Object.assign(S, { overview, projects });
        emit("meta");
    } catch (_) { /* counts are best effort */ }
}, 400);

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

/** Users who can be assigned in a project: me, the task owner, members. */
export async function assignable(t) {
    const out = new Map([[S.me.username, { username: S.me.username, name: S.me.name }]]);
    if (t?.owner) out.set(t.owner.username, t.owner);
    for (const a of t?.assignees || []) out.set(a.username, a);
    try {
        for (const m of await loadMembers(t?.project_id)) out.set(m.user.username, m.user);
    } catch (_) { /* view-only */ }
    return [...out.values()];
}

// ------------------------------------------------------------------ task actions

const LOCAL = ["title", "description", "due", "start", "priority", "labels", "percent", "time_spent", "repeat_mode",
    "repeat_every", "favorite", "colour", "parent_id"];

function snapshot(t) { return JSON.parse(JSON.stringify(t)); }
function restore(t, snap) { for (const k of Object.keys(t)) if (!(k in snap)) delete t[k]; Object.assign(t, snap); }

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
        refreshCounts();
        return t;
    } catch (e) {
        restore(t, snap);
        emit("task", t);
        toast(e.message, { error: true });
        throw e;
    }
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
        } else if (!quiet && done) {
            toast(`Completed “${t.title}”`, { action: "Undo", onAction: () => setDone(t, false, { quiet: true }) });
        }
        emit("task", t);
        emit("tasks");
        refreshCounts();
        return r;
    } catch (e) {
        restore(t, snap);
        emit("task", t);
        toast(e.message, { error: true });
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
        emit("task", t);
        emit("tasks");
        refreshCounts();
        return t;
    } catch (e) {
        restore(t, snap);
        emit("tasks");
        toast(e.message, { error: true });
        throw e;
    }
}

export async function createTask(body) {
    const t = adopt(await api("POST", "", body));
    refreshCounts();
    return t;
}

export async function quickAdd(text, extra = {}) {
    const t = adopt(await api("POST", "quick", { text, ...extra }));
    // Quick add can create labels and projects (*new, +New): fetch them before drawing the task.
    if (t.labels.some((id) => !label(id)) || !project(t.project_id)) await loadMeta();
    else refreshCounts();
    return t;
}

/** Delete with an undo window: the rows disappear now and the DELETE is sent when the toast expires. */
export function deleteTasks(tasks) {
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of S.tasks) if (ids.has(t.parent_id)) ids.add(t.id);  // subtasks go with their parent
    const saved = { tasks: S.tasks, done: S.done };
    S.tasks = S.tasks.filter((t) => !ids.has(t.id));
    S.done = S.done.filter((t) => !ids.has(t.id));
    for (const id of ids) S.selected.delete(id);
    const roots = tasks.filter((t) => !ids.has(t.parent_id) || tasks.includes(t));
    const key = Symbol("delete");
    const commit = async () => {
        if (!S.pendingDeletes.has(key)) return;
        S.pendingDeletes.delete(key);
        try {
            await Promise.all(roots.map((t) => api("DELETE", t.id)));
            for (const id of ids) S.byId.delete(id);
            refreshCounts();
        } catch (e) {
            toast(e.message, { error: true });
            emit("reload");
        }
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
            S.tasks = saved.tasks;
            S.done = saved.done;
            emit("tasks");
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
    emit("tasks");
    refreshCounts();
    toast("Task duplicated");
    return copy;
}

/** Filled in by tasks.js: go(params), openTask(id), render(), href(params). Lets modules call each other without import cycles. */
export const app = {};

export const COLOURS = ["#e5484d", "#f76b15", "#ffb224", "#46a758", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#8d8d86"];
