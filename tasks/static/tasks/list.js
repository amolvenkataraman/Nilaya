/* List view: date / priority / project sections, nested subtasks, inline edit, inline subtasks,
 * multi-select and drag to reorder, reschedule (drop on a date section) or move (drop on a project). */

import { h, clear, icon, ring, avatar, fmtDay, fmtDateTime, fmtMinutes, ago, startOfDay, addDays, DAY, endOfDay, draggable, between, toast } from "./lib.js";
import { S, app, emit, project, label, prioLevel, canEdit, setDone, patchTask, moveTask, quickAdd, reorderTasks, projectPath, pathText,
    repeatText } from "./store.js";

// ------------------------------------------------------------------ shared row bits (also used by board/table)

export function dueChip(t, short = false) {
    if (!t.due) return null;
    const d = new Date(t.due), now = new Date();
    const overdue = !t.done && d < now && !(sameDayAllDay(d, now));
    const today = startOfDay(d).getTime() === startOfDay(now).getTime();
    const cls = overdue ? ".is-overdue" : today ? ".is-today" : "";
    return h("span.tk-meta.tk-due" + cls, { title: d.toLocaleString() }, icon("calendar", 12), fmtDay(t.due, !short));
}
const sameDayAllDay = (d, now) => d.getHours() === 23 && d.getMinutes() === 59 && startOfDay(d).getTime() === startOfDay(now).getTime();

export function isOverdue(t) {
    if (!t.due || t.done) return false;
    const d = new Date(t.due), now = new Date();
    return d < now && !sameDayAllDay(d, now);
}

export function labelChips(t, max = 3) {
    const ls = (t.labels || []).map(label).filter(Boolean);
    return [ls.slice(0, max).map((l) => h("span.tk-chip", { style: { "--lc": l.colour || "var(--app-muted)" } }, h("span.tk-chip-dot"), l.name)),
        ls.length > max ? h("span.tk-chip.tk-chip-more", `+${ls.length - max}`) : null];
}

export function checkbox(t, onToggle) {
    const lvl = prioLevel(t.priority);
    return h("button.tk-check.p" + lvl + (t.done ? ".is-done" : ""), {
        type: "button", role: "checkbox", "aria-checked": String(!!t.done), disabled: !canEdit(t),
        "aria-label": t.done ? `Reopen “${t.title}”` : `Complete “${t.title}”`,
        onclick: (e) => { e.stopPropagation(); (onToggle || toggleDone)(t); },
    }, icon("check", 12));
}

export function toggleDone(t) {
    const done = !t.done;
    if (done) {
        t._fading = true;
        setTimeout(() => { delete t._fading; emit("tasks"); }, 650);
    }
    setDone(t, done).catch(() => { delete t._fading; });
}

const dayWord = (iso) => { const d = fmtDay(iso, false); return /^(Today|Tomorrow|Yesterday)$/.test(d) ? d.toLowerCase() : d; };
const nextReminder = (t) => (t.reminders || []).filter((r) => !r.sent && r.fire_at).map((r) => r.fire_at).sort()[0];

/** The secondary line under a task title: everything useful at a glance, quietly. */
export function metaBits(t, { showProject = true } = {}) {
    const path = showProject ? projectPath(t.project_id) : [];
    const leaf = path.at(-1);
    const start = t.start ? new Date(t.start) : null;
    const next = nextReminder(t);
    return [
        t.done && t.done_at ? h("span.tk-meta", { title: `Completed ${fmtDateTime(t.done_at)}` }, icon("done", 12), `Completed ${dayWord(t.done_at)}`) : dueChip(t),
        start && !t.done && start > new Date() ? h("span.tk-meta", { title: `Starts ${fmtDateTime(t.start)}` }, icon("play", 12), `Starts ${dayWord(t.start)}`) : null,
        t.repeat_mode ? h("span.tk-meta", { title: repeatText(t) }, icon("repeat", 12), repeatText(t, true)) : null,
        t.subtasks ? h("span.tk-meta", { title: `${t.subtasks_done} of ${t.subtasks} subtasks done` }, icon("subtask", 12), `${t.subtasks_done}/${t.subtasks}`) : null,
        t.comments ? h("span.tk-meta", { title: `${t.comments} comment${t.comments > 1 ? "s" : ""}` }, icon("comment", 12), String(t.comments)) : null,
        next && !t.done ? h("span.tk-meta", { title: `Next reminder ${fmtDateTime(next)}` }, icon("bell", 12), fmtDay(next)) : null,
        t.percent ? h("span.tk-meta", { title: `${t.percent}% done` }, ring(t.percent / 100, 12), `${t.percent}%`) : null,
        t.time_spent ? h("span.tk-meta", { title: "Time spent" }, icon("clock", 12), fmtMinutes(t.time_spent)) : null,
        labelChips(t),
        leaf ? h("span.tk-meta.tk-meta-proj", { title: pathText(t.project_id) }, h("span.tk-dot", { style: { background: leaf.colour || "var(--app-muted)" } }),
            path.length > 1 ? h("span.tk-meta-parent", path.slice(0, -1).map((p) => p.name).join(" › ") + " ›") : null,
            leaf.is_inbox ? "Inbox" : leaf.name) : null,
    ];
}

/** Hover card: the whole task at a glance (mouse only; touch users open the drawer). */
export function taskSummary(t) {
    const rows = [];
    const add = (k, ...v) => { if (v.flat().some((x) => x != null && x !== "")) rows.push(h("dt", k), h("dd", v)); };
    add("Project", pathText(t.project_id));
    if (t.done) add("Completed", t.done_at ? fmtDateTime(t.done_at) : "Yes");
    add("Due", t.due ? fmtDateTime(t.due) : "");
    add("Start", t.start ? fmtDateTime(t.start) : "");
    add("Priority", t.priority ? t.priority_label : "");
    add("Repeat", repeatText(t));
    const next = nextReminder(t);
    add("Reminders", (t.reminders || []).length ? `${t.reminders.length}${next ? ` · next ${fmtDateTime(next)}` : ""}` : "");
    add("Progress", t.percent ? `${t.percent}%` : "");
    add("Time spent", fmtMinutes(t.time_spent));
    add("Assignees", (t.assignees || []).map((a) => a.name).join(", "));
    add("Labels", (t.labels || []).map((id) => label(id)?.name).filter(Boolean).join(", "));
    add("Subtasks", t.subtasks ? `${t.subtasks_done} of ${t.subtasks} done` : "");
    add("Comments", t.comments ? String(t.comments) : "");
    add("Created", `${fmtDateTime(t.created_on)}${t.owner ? ` by ${t.owner.name}` : ""}`);
    add("Updated", ago(t.updated_on));
    return [h("div.tk-hc-title", t.title),
        t.description ? h("div.tk-hc-desc", t.description.length > 280 ? t.description.slice(0, 280) + "…" : t.description) : null,
        h("dl.tk-hc-grid", rows)];
}

export function prioFlag(t) {
    const lvl = prioLevel(t.priority);
    return lvl >= 3 ? h("span.tk-flag.p" + lvl, { title: t.priority_label }, icon("flag", 12)) : null;
}

export function assigneeStack(t, max = 3) {
    const a = t.assignees || [];
    if (!a.length) return null;
    return h("span.tk-avatars", a.slice(0, max).map((u) => avatar(u, "sm")), a.length > max ? h("span.tk-avatar.tk-avatar-sm.tk-avatar-more", `+${a.length - max}`) : null);
}

// ------------------------------------------------------------------ grouping

function dueGroups(tasks) {
    const today = startOfDay(new Date()), tomorrow = addDays(today, 1), week = addDays(today, 7);
    const groups = [
        { key: "overdue", title: "Overdue", items: [] },
        { key: "today", title: "Today", items: [], due: today },
        { key: "tomorrow", title: "Tomorrow", items: [], due: tomorrow },
        { key: "week", title: "Next 7 days", items: [] },
        { key: "later", title: "Later", items: [] },
        { key: "nodate", title: "No date", items: [], due: null },
    ];
    for (const t of tasks) {
        if (!t.due) { groups[5].items.push(t); continue; }
        const d = new Date(t.due), day = startOfDay(d);
        if (isOverdue(t)) groups[0].items.push(t);
        else if (day <= today) groups[1].items.push(t);
        else if (day.getTime() === tomorrow.getTime()) groups[2].items.push(t);
        else if (day < week) groups[3].items.push(t);
        else groups[4].items.push(t);
    }
    // Upcoming: one section per day for the coming week, like a planner.
    if (S.route.scope === "view" && S.route.id === "upcoming") {
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = addDays(today, i);
            days.push({ key: "d" + i, title: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
                items: [], due: d, keepEmpty: true });
        }
        for (const t of tasks) {
            const i = t.due && !isOverdue(t) ? Math.round((startOfDay(new Date(t.due)) - today) / DAY) : -1;
            if (i >= 0 && i < 7) days[i].items.push(t);
        }
        const overdue = groups[0];
        return [overdue, ...days];
    }
    return groups;
}

function groupTasks(roots, mode) {
    if (mode === "due") return dueGroups(roots);
    if (mode === "priority") {
        return [[20, "Urgent"], [15, "High"], [10, "Medium"], [5, "Low"], [0, "No priority"]].map(([v, title], i, arr) => ({
            key: "p" + v, title,
            items: roots.filter((t) => t.priority <= v && t.priority > (arr[i + 1]?.[0] ?? -1)),
        }));
    }
    if (mode === "project") {
        const by = new Map();
        for (const t of roots) {
            const p = project(t.project_id);
            const k = p?.id || "none";
            if (!by.has(k)) by.set(k, { key: k, title: p?.name || "Other", colour: p?.colour, items: [] });
            by.get(k).items.push(t);
        }
        return [...by.values()].sort((a, b) => (project(a.key)?.position ?? 1e9) - (project(b.key)?.position ?? 1e9));
    }
    return [{ key: "all", title: "", items: roots }];
}

export function groupMode() {
    if (S.filters.group) return S.filters.group;
    const r = S.route;
    if (r.scope === "project" || (r.scope === "view" && r.id === "done")) return "none";
    return "due";
}

export function manualOrder() {
    return S.route.scope === "project" && (S.filters.sort || "position") === "position" && groupMode() === "none";
}

// ------------------------------------------------------------------ render

let addingSubtaskFor = null;

export function renderList(root) {
    const scopeDone = S.route.scope === "view" && S.route.id === "done";
    const visible = S.tasks.filter((t) => scopeDone || !t.done || t._fading || t._repeated);
    const ids = new Set(visible.map((t) => t.id));
    const kids = new Map();
    for (const t of visible) if (t.parent_id && ids.has(t.parent_id)) (kids.get(t.parent_id) || kids.set(t.parent_id, []).get(t.parent_id)).push(t);
    const roots = visible.filter((t) => !(t.parent_id && ids.has(t.parent_id)));
    const showProject = S.route.scope !== "project";
    const list = h("div.tk-list", { role: "list" });

    const rows = (t, depth) => {
        const children = kids.get(t.id) || [];
        const collapsed = S.collapsedTasks.has(t.id);
        const out = [row(t, depth, children.length, collapsed, showProject)];
        if (addingSubtaskFor === t.id) out.push(subtaskForm(t, depth + 1));
        if (!collapsed) for (const c of children) out.push(...rows(c, depth + 1));
        return out;
    };

    const groups = groupTasks(roots, groupMode());
    let any = false;
    for (const g of groups) {
        if (!g.items.length && !g.keepEmpty) continue;
        any = any || g.items.length > 0;
        const collapsed = S.collapsedSections.has(g.key);
        const sec = h("section.tk-section", { dataset: { key: g.key, ...(g.due !== undefined ? { due: g.due ? g.due.toISOString() : "none" } : {}) } });
        if (g.title) {
            sec.append(h("button.tk-section-head" + (g.key === "overdue" ? ".is-alert" : ""), {
                type: "button", "aria-expanded": String(!collapsed),
                onclick: () => { S.collapsedSections[collapsed ? "delete" : "add"](g.key); emit("tasks"); },
            }, icon(collapsed ? "chevR" : "chevD", 12), g.colour ? h("span.tk-dot", { style: { background: g.colour } }) : null,
            h("span", g.title), h("span.tk-section-count", String(g.items.length)),
            g.key === "overdue" && g.items.length ? h("span.tk-section-act", {
                role: "button", tabindex: 0, title: "Move all overdue tasks to today",
                onclick: (e) => { e.stopPropagation(); rescheduleAll(g.items); },
            }, "Reschedule to today") : null));
        }
        if (!collapsed) {
            const body = h("div.tk-section-body");
            for (const t of g.items) body.append(...rows(t, 0));
            if (!g.items.length) body.append(h("div.tk-section-empty", "Nothing scheduled"));
            sec.append(body);
        }
        list.append(sec);
    }

    if (!any) list.append(emptyState());

    if (!scopeDone && S.showDone) {
        const done = S.done.filter((t) => t.done);
        list.append(h("section.tk-section.tk-done-sec", h("div.tk-section-head.is-static", icon("done", 12), h("span", "Completed"), h("span.tk-section-count", String(S.doneCount))),
            h("div.tk-section-body", done.length ? done.map((t) => row(t, 0, 0, false, showProject)) : h("div.tk-section-empty", "No completed tasks"))));
    }
    clear(root, list);
}

function emptyState() {
    const r = S.route;
    const msg = r.q ? `No tasks match “${r.q}”.`
        : r.scope === "view" ? ({ today: "Nothing due today. Enjoy the calm.", overdue: "Nothing overdue. Nice.", upcoming: "Nothing in the next 7 days.",
            nodate: "Every task has a date.", favorites: "Star a task to see it here.", assigned: "Nothing assigned to you.", done: "Nothing completed this week yet." })[r.id]
        : "No tasks yet. Add one above.";
    return h("div.tk-empty", msg || "No tasks.");
}

function row(t, depth, nKids, collapsed, showProject) {
    const el = h("div.tk-row", {
        role: "listitem", tabindex: -1, dataset: { tid: t.id },
        class: [t.done && "is-done", t._fading && "is-fading", S.selected.has(t.id) && "is-selected", S.cursor === t.id && "is-cursor",
            S.route.task === t.id && "is-open"].filter(Boolean).join(" ") || null,
        style: { "--depth": depth, ...(t.colour ? { "--tc": t.colour } : {}) },
    });
    el.append(
        h("span.tk-grip", { "aria-hidden": "true" }, icon("grip", 14)),
        nKids ? h("button.tk-twisty", {
            type: "button", "aria-label": collapsed ? "Show subtasks" : "Hide subtasks", "aria-expanded": String(!collapsed),
            onclick: (e) => {
                e.stopPropagation();
                S.collapsedTasks[collapsed ? "delete" : "add"](t.id);
                emit("tasks");
            },
        }, icon(collapsed ? "chevR" : "chevD", 12)) : h("span.tk-twisty"),
        checkbox(t),
        h("div.tk-row-main",
            h("div.tk-row-title", h("span.tk-title-text", t.title), t.favorite ? icon("star-fill", 12, "tk-fav") : null,
                t.description ? icon("list", 12, "tk-has-desc") : null),
            h("div.tk-row-meta", metaBits(t, { showProject }))),
        h("div.tk-row-end", prioFlag(t), assigneeStack(t),
            canEdit(t) ? h("button.tk-icon-btn.tk-row-act", {
                type: "button", title: "Add subtask", "aria-label": "Add subtask",
                onclick: (e) => { e.stopPropagation(); addingSubtaskFor = t.id; S.collapsedTasks.delete(t.id); emit("tasks"); },
            }, icon("plus", 14)) : null),
    );
    if (!el.querySelector(".tk-row-meta").childNodes.length) el.querySelector(".tk-row-meta").remove();
    return el;
}

function subtaskForm(parent, depth) {
    const input = h("input.tk-inline-input", { placeholder: "Subtask name, then Enter (Esc to finish)", maxlength: 512, "aria-label": "New subtask" });
    const form = h("form.tk-row.tk-row-form", { style: { "--depth": depth } }, h("span.tk-grip"), h("span.tk-twisty"), h("span.tk-check.is-ghost"), input);
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        try {
            const t = await quickAdd(text, { parent_id: parent.id, project_id: parent.project_id });
            parent.subtasks = (parent.subtasks || 0) + 1;
            S.tasks.push(t);
            emit("tasks");
        } catch (err) { toast(err.message, { error: true }); }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); addingSubtaskFor = null; emit("tasks"); } });
    input.addEventListener("blur", () => setTimeout(() => {
        if (addingSubtaskFor === parent.id && !input.value.trim() && document.activeElement !== input) { addingSubtaskFor = null; emit("tasks"); }
    }, 150));
    requestAnimationFrame(() => input.focus());
    return form;
}

async function rescheduleAll(items) {
    const today = endOfDay(new Date());
    await Promise.allSettled(items.map((t) => {
        const d = new Date(t.due);
        const nd = new Date(today);
        if (!(d.getHours() === 23 && d.getMinutes() === 59)) nd.setHours(d.getHours(), d.getMinutes());
        return patchTask(t, { due: nd.toISOString() });
    }));
    emit("tasks");
    toast(`Moved ${items.length} task${items.length > 1 ? "s" : ""} to today`);
}

// ------------------------------------------------------------------ inline title edit

export function inlineEdit(t) {
    const rowEl = document.querySelector(`.tk-row[data-tid="${t.id}"]`);
    if (!rowEl || !canEdit(t)) return;
    const span = rowEl.querySelector(".tk-title-text");
    const input = h("input.tk-inline-input.tk-nodrag", { value: t.title, maxlength: 256, "aria-label": "Task title" });
    S.inlineEditing = true;
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
        if (done) return;
        done = true;
        S.inlineEditing = false;
        const v = input.value.trim();
        if (save && v && v !== t.title) patchTask(t, { title: v }).catch(() => {});
        rowEl.focus({ preventScroll: true });  // synchronously, so the next key press isn't typed into the input
        emit("tasks");
    };
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("blur", () => finish(true));
}

// ------------------------------------------------------------------ drag

export function setupListDrag(view) {
    let drop = null;
    const clearMarks = () => {
        document.querySelectorAll(".drop-before,.drop-after,.drop-into,.is-drop-target").forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-into", "is-drop-target"));
    };
    draggable(view, {
        selector: ".tk-list .tk-row[data-tid]",
        onStart: (el) => {
            const t = S.byId.get(el.dataset.tid);
            return t && canEdit(t) && !S.inlineEditing ? { t } : null;
        },
        scrollers: () => [view, document.querySelector("#sidebar-left .sidebar-content")],
        onMove: (ctx, { y, target }) => {
            clearMarks();
            drop = null;
            if (!target) return;
            const proj = target.closest(".tk-proj-row[data-pid], .tk-nav-link[data-pid]");
            if (proj) {
                if (proj.dataset.pid !== ctx.t.project_id) { proj.classList.add("is-drop-target"); drop = { kind: "project", id: proj.dataset.pid }; }
                return;
            }
            const rowEl = target.closest(".tk-row[data-tid]");
            if (rowEl && manualOrder() && rowEl.dataset.tid !== ctx.t.id) {
                const other = S.byId.get(rowEl.dataset.tid);
                if (other && (other.parent_id || null) === (ctx.t.parent_id || null)) {
                    const r = rowEl.getBoundingClientRect();
                    const where = y < r.top + r.height / 2 ? "before" : "after";
                    rowEl.classList.add("drop-" + where);
                    drop = { kind: "row", other, where };
                    return;
                }
            }
            const sec = target.closest(".tk-section[data-due]");
            if (sec && !manualOrder()) {
                sec.classList.add("drop-into");
                drop = { kind: "date", due: sec.dataset.due };
            }
        },
        onEnd: clearMarks,
        onDrop: async (ctx) => {
            const d = drop;
            drop = null;
            if (!d) return;
            const t = ctx.t;
            if (d.kind === "project") {
                const p = project(d.id);
                if (S.route.scope === "project") S.tasks = S.tasks.filter((x) => x !== t && x.parent_id !== t.id);
                await moveTask(t, { project_id: d.id }).catch(() => app.reload());
                toast(`Moved to ${p?.name || "project"}`);
            } else if (d.kind === "row") {
                const sibs = S.tasks.filter((x) => (x.parent_id || null) === (t.parent_id || null) && x !== t && !x.done)
                    .sort((a, b) => a.position - b.position);
                const i = sibs.indexOf(d.other);
                sibs.splice(d.where === "before" ? i : i + 1, 0, t);
                await reorderTasks(S.route.id, sibs);
            } else if (d.kind === "date") {
                let due = null;
                if (d.due !== "none") {
                    const day = new Date(d.due);
                    const old = t.due ? new Date(t.due) : null;
                    const nd = endOfDay(day);
                    if (old && !(old.getHours() === 23 && old.getMinutes() === 59)) nd.setHours(old.getHours(), old.getMinutes());
                    due = nd.toISOString();
                }
                if (due === t.due) return;
                await patchTask(t, { due }).catch(() => {});
                emit("tasks");
            }
        },
    });
}
