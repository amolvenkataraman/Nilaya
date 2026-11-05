/* Board (kanban), table, calendar (month) and timeline (Gantt) layouts. */

import { h, append, clear, icon, ring, fmtMinutes, fmtDateTime, menu, dialog, confirmDialog, toast, api, draggable, between, store, startOfDay, addDays, dayKey,
    DAY, fmtDay, fmtMonth, monthDay, weekday, time, isAllDay, endOfDay } from "./lib.js";
import { S, app, emit, project, label, canEdit, patchTask, moveTask, createTask, quickAdd, loadBuckets, prioLevel, repeatText, pathText } from "./store.js";
import { checkbox, toggleDone, dueChip, labelChips, prioFlag, assigneeStack, isOverdue } from "./list.js";

// ================================================================== board

export function renderBoard(root) {
    const p = project(S.route.id);
    const buckets = S.buckets.get(p?.id) || [];
    const writable = (p?.role ?? 0) >= 1;
    const board = h("div.tk-board", { role: "list", "aria-label": "Board" });
    const ids = new Set(buckets.map((b) => b.id));
    const fallback = buckets.find((b) => !b.is_done) || buckets[0];

    const onBoard = new Set(S.tasks.map((t) => t.id));  // subtasks of a card show as its count, not as cards
    for (const b of buckets) {
        const cards = S.tasks.filter((t) => !onBoard.has(t.parent_id) && (ids.has(t.bucket_id) ? t.bucket_id : fallback?.id) === b.id)
            .sort((x, y) => x.position - y.position);
        const open = cards.filter((t) => !t.done && !t.parent_id).length;  // WIP counts open top-level tasks (as the server does)
        const over = b.limit && !b.is_done && open > b.limit;
        const col = h("section.tk-col" + (b.is_done ? ".is-done-col" : ""), { dataset: { bid: b.id }, "aria-label": b.name });
        const name = h("h2.tk-col-name", { title: writable ? "Double-click to rename" : null }, b.name);
        if (writable) name.addEventListener("dblclick", () => renameBucket(b, name));
        append(col, [
            h("header.tk-col-head",
                writable ? h("span.tk-col-grip", { title: "Drag to reorder", "aria-hidden": "true" }, icon("grip", 14)) : null,
                b.is_done ? h("span.tk-col-done", { title: "Tasks moved here are marked done" }, icon("done", 14)) : null,
                name,
                h("span.tk-col-count" + (over ? ".is-over" : ""), { title: b.limit ? `WIP limit ${b.limit}` : null },
                    b.limit && !b.is_done ? `${open} / ${b.limit}` : String(cards.length)),
                writable ? h("button.tk-icon-btn", { type: "button", "aria-label": `${b.name} options`, onclick: (e) => bucketMenu(e.currentTarget, b, buckets) }, icon("more", 14)) : null),
            h("div.tk-col-cards", { dataset: { bid: b.id } }, cards.map(card)),
            writable ? addCard(b, p) : null]);
        board.append(col);
    }
    if (writable) board.append(addColumn(p, buckets));
    clear(root, board);
}

function card(t) {
    const el = h("article.tk-card", {
        tabindex: -1, dataset: { tid: t.id },
        class: [t.done && "is-done", S.selected.has(t.id) && "is-selected", S.cursor === t.id && "is-cursor", S.route.task === t.id && "is-open"].filter(Boolean).join(" ") || null,
        style: t.colour ? { "--tc": t.colour } : null,
    });
    const labels = labelChips(t, 4);
    append(el, [
        (t.labels || []).length ? h("div.tk-card-labels", labels) : null,
        h("div.tk-card-title", checkbox(t, (x) => { toggleDone(x); }), h("span.tk-title-text", t.title),
            t.description ? icon("list", 12, "tk-has-desc") : null),
        h("div.tk-card-meta",
            t.done && t.done_at ? h("span.tk-meta", { title: `Completed ${fmtDateTime(t.done_at)}` }, icon("done", 12), fmtDay(t.done_at, false)) : dueChip(t, true),
            t.start && !t.done && new Date(t.start) > new Date() ? h("span.tk-meta", { title: `Starts ${fmtDateTime(t.start)}` }, icon("play", 12), fmtDay(t.start, false)) : null,
            t.subtasks ? h("span.tk-meta", { title: "Subtasks done" }, icon("subtask", 12), `${t.subtasks_done}/${t.subtasks}`) : null,
            t.comments ? h("span.tk-meta", { title: "Comments" }, icon("comment", 12), String(t.comments)) : null,
            t.repeat_mode ? h("span.tk-meta", { title: repeatText(t) }, icon("repeat", 12)) : null,
            t.reminders?.some((r) => !r.sent) ? h("span.tk-meta", { title: "Reminder set" }, icon("bell", 12)) : null,
            t.percent ? h("span.tk-meta", { title: `${t.percent}% done` }, ring(t.percent / 100, 12), `${t.percent}%`) : null,
            t.time_spent ? h("span.tk-meta", { title: "Time spent" }, icon("clock", 12), fmtMinutes(t.time_spent)) : null,
            h("span.tk-grow"), prioFlag(t), assigneeStack(t, 2))]);
    if (!el.querySelector(".tk-card-meta").querySelector(".tk-meta,.tk-flag,.tk-avatars")) el.querySelector(".tk-card-meta").remove();
    return el;
}

function addCard(b, p) {
    const btn = h("button.tk-col-add", { type: "button" }, icon("plus", 14), "Add task");
    const wrap = h("div.tk-col-foot", btn);
    btn.addEventListener("click", () => {
        const input = h("textarea.tk-card-input", { rows: 2, maxlength: 512, placeholder: "Task — e.g. “Review copy fri *design”. Enter to add", "aria-label": "New task" });
        const form = h("form.tk-card-form", input);
        const submit = async () => {
            const text = input.value.trim();
            if (!text) return;
            input.value = "";
            try {
                const t = await quickAdd(text, { project_id: p.id, bucket_id: b.id });  // natural language works here too
                if (t.project_id === p.id) S.tasks.push(t);
                else toast(`Added to ${project(t.project_id)?.name || "another project"}`);
                app.keepBoardInput = b.id;
                emit("tasks");
            } catch (e) { input.value = text; toast(e.message, { error: true }); }
        };
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            if (e.key === "Escape") { e.stopPropagation(); wrap.replaceChildren(btn); }
        });
        form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
        wrap.replaceChildren(form);
        input.focus();
    });
    if (app.keepBoardInput === b.id) { app.keepBoardInput = null; requestAnimationFrame(() => btn.click()); }
    return wrap;
}

function addColumn(p, buckets) {
    const btn = h("button.tk-col-new", { type: "button" }, icon("plus", 14), "Add column");
    const wrap = h("div.tk-col.tk-col-ghost", btn);
    btn.addEventListener("click", () => {
        const input = h("input.form-control.form-control-sm", { maxlength: 64, placeholder: "Column name", "aria-label": "Column name" });
        const form = h("form.tk-col-newform", input, h("div.d-flex.gap-2",
            h("button.btn.btn-sm.btn-primary", { type: "submit" }, "Add"),
            h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => wrap.replaceChildren(btn) }, "Cancel")));
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!input.value.trim()) return;
            try {
                const b = await api("POST", `projects/${p.id}/buckets`, { name: input.value.trim() });
                buckets.push(b);
                emit("tasks");
            } catch (err) { toast(err.message, { error: true }); }
        });
        input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); wrap.replaceChildren(btn); } });
        wrap.replaceChildren(form);
        input.focus();
    });
    return wrap;
}

async function patchBucket(b, patch) {
    const before = { ...b };
    Object.assign(b, patch);
    if (patch.is_done) for (const x of S.buckets.get(b.project_id) || []) if (x !== b) x.is_done = false;
    emit("tasks");
    try {
        Object.assign(b, await api("PATCH", `buckets/${b.id}`, patch));
    } catch (e) {
        Object.assign(b, before);
        toast(e.message, { error: true });
    }
    emit("tasks");
}

function renameBucket(b, nameEl) {
    const input = h("input.tk-inline-input", { value: b.name, maxlength: 64, "aria-label": "Column name" });
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
        if (done) return;
        done = true;
        if (save && input.value.trim() && input.value.trim() !== b.name) patchBucket(b, { name: input.value.trim() });
        else emit("tasks");
    };
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
}

function bucketMenu(anchor, b, buckets) {
    const i = buckets.indexOf(b);
    menu(anchor, [
        { label: "Rename", icon: "edit", onClick: () => renameBucket(b, anchor.closest(".tk-col").querySelector(".tk-col-name")) },
        { label: b.limit ? `WIP limit: ${b.limit}…` : "Set WIP limit…", icon: "filter", onClick: () => limitDialog(b) },
        { label: b.is_done ? "Done column" : "Mark as done column", icon: "done", checked: b.is_done, disabled: b.is_done, onClick: () => patchBucket(b, { is_done: true }) },
        { sep: true },
        { label: "Move left", icon: "chevL", disabled: i === 0, onClick: () => patchBucket(b, { position: between(buckets[i - 2]?.position, buckets[i - 1].position) }).then(() => sortBuckets(buckets)) },
        { label: "Move right", icon: "chevR", disabled: i === buckets.length - 1, onClick: () => patchBucket(b, { position: between(buckets[i + 1].position, buckets[i + 2]?.position) }).then(() => sortBuckets(buckets)) },
        { sep: true },
        { label: "Delete column…", icon: "trash", danger: true, disabled: buckets.length < 2, onClick: async () => {
            if (!await confirmDialog("Delete column", `Delete “${b.name}”? Its tasks move to another column.`)) return;
            try {
                await api("DELETE", `buckets/${b.id}`);
                await loadBuckets(b.project_id, true);
                app.reload();
            } catch (e) { toast(e.message, { error: true }); }
        } },
    ]);
}

function sortBuckets(buckets) { buckets.sort((a, b) => a.position - b.position); emit("tasks"); }

async function limitDialog(b) {
    const input = h("input.form-control.form-control-sm", { id: "tk-wip", type: "number", min: 0, max: 999, value: b.limit || 0 });
    const v = await dialog({
        title: `WIP limit for “${b.name}”`,
        body: h("div.tk-form", h("label.form-label", { for: "tk-wip" }, "Maximum open tasks (0 = no limit)"), input),
        actions: [{ label: "Cancel" }, { label: "Save", primary: true }],
        onSubmit: () => Math.max(0, parseInt(input.value || "0", 10)),
    });
    if (v != null) patchBucket(b, { limit: v });
}

export function setupBoardDrag(view) {
    let ph = null, target = null;
    const placeholder = (height) => { ph = ph || h("div.tk-card-ph"); ph.style.height = height + "px"; return ph; };
    draggable(view, {
        selector: ".tk-board .tk-card",
        onStart: (el) => {
            const t = S.byId.get(el.dataset.tid);
            return t && canEdit(t) ? { t, height: el.offsetHeight } : null;
        },
        scrollers: () => [view.querySelector(".tk-board"), ...view.querySelectorAll(".tk-col-cards")],
        onMove: (ctx, { x, y, target: el }) => {
            const col = el?.closest(".tk-col[data-bid]") || [...view.querySelectorAll(".tk-col[data-bid]")].find((c) => {
                const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right;
            });
            if (!col) { ph?.remove(); target = null; return; }
            const list = col.querySelector(".tk-col-cards");
            const cards = [...list.querySelectorAll(".tk-card:not(.tk-dragging)")];
            const next = cards.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
            list.insertBefore(placeholder(ctx.height), next || null);
            target = { bid: +col.dataset.bid, next: next ? S.byId.get(next.dataset.tid) : null, prevEl: ph.previousElementSibling };
        },
        onEnd: () => { ph?.remove(); },
        onDrop: async (ctx) => {
            const tg = target;
            target = null;
            if (!tg) return;
            const t = ctx.t;
            let prev = tg.prevEl;
            while (prev && !prev.dataset.tid) prev = prev.previousElementSibling;
            if (prev?.dataset.tid === t.id) prev = prev.previousElementSibling;
            const a = prev ? S.byId.get(prev.dataset.tid) : null;
            const position = between(a?.position, tg.next?.position);
            const buckets = S.buckets.get(t.project_id) || [];
            const b = buckets.find((x) => x.id === tg.bid);
            if (b && tg.bid !== t.bucket_id && b.limit && !b.is_done &&
                S.tasks.filter((x) => x.bucket_id === b.id && !x.done && !x.parent_id).length >= b.limit) {
                toast(`“${b.name}” is at its limit of ${b.limit}`, { error: true });
                return;
            }
            const body = { position };
            if (tg.bid !== t.bucket_id) body.bucket_id = tg.bid;
            await moveTask(t, body).catch(() => {});
        },
    });

    // Columns reorder by their grip.
    let colTarget = null;
    draggable(view, {
        selector: ".tk-board .tk-col[data-bid]",
        handle: ".tk-col-grip",
        onStart: (el) => ({ b: (S.buckets.get(S.route.id) || []).find((x) => x.id === +el.dataset.bid) }),
        scrollers: () => [view.querySelector(".tk-board")],
        onMove: (ctx, { x, target: el }) => {
            view.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
            const col = el?.closest(".tk-col[data-bid]");
            colTarget = null;
            if (!col || +col.dataset.bid === ctx.b.id) return;
            const r = col.getBoundingClientRect(), where = x < r.left + r.width / 2 ? "before" : "after";
            col.classList.add("drop-" + where);
            colTarget = { bid: +col.dataset.bid, where };
        },
        onEnd: () => view.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after")),
        onDrop: async (ctx) => {
            if (!colTarget || !ctx.b) return;
            const buckets = S.buckets.get(S.route.id).filter((x) => x !== ctx.b);
            const i = buckets.findIndex((x) => x.id === colTarget.bid);
            const [a, b] = colTarget.where === "before" ? [buckets[i - 1], buckets[i]] : [buckets[i], buckets[i + 1]];
            await patchBucket(ctx.b, { position: between(a?.position, b?.position) });
            sortBuckets(S.buckets.get(S.route.id));
        },
    });
}

// ================================================================== table

const COLS = [
    { key: "title", label: "Title", always: true, val: (t) => t.title.toLowerCase() },
    { key: "project", label: "Project", val: (t) => (project(t.project_id)?.name || "").toLowerCase() },
    { key: "due", label: "Due", val: (t) => t.due || "9999" },
    { key: "start", label: "Start", val: (t) => t.start || "9999" },
    { key: "priority", label: "Priority", val: (t) => -t.priority },
    { key: "labels", label: "Labels", val: (t) => (t.labels || []).map((id) => label(id)?.name || "").sort().join(",") },
    { key: "assignees", label: "Assignees", val: (t) => (t.assignees || []).map((a) => a.name).join(",") },
    { key: "percent", label: "Progress", val: (t) => t.percent },
    { key: "done", label: "Done", val: (t) => (t.done ? 1 : 0) },
    { key: "completed", label: "Completed", val: (t) => t.done_at || "" },
    { key: "time", label: "Time spent", val: (t) => t.time_spent || 0 },
    { key: "repeat", label: "Repeat", val: (t) => repeatText(t) },
    { key: "reminders", label: "Reminders", val: (t) => (t.reminders || []).length },
    { key: "created", label: "Created", val: (t) => t.created_on },
    { key: "updated", label: "Updated", val: (t) => t.updated_on },
];
const DEFAULT_COLS = ["title", "project", "due", "start", "priority", "labels", "assignees", "done", "created"];

export function tableColumnsMenu(anchor) {
    const shown = new Set(store.get("tableCols", DEFAULT_COLS));
    menu(anchor, [{ heading: "Columns" }, ...COLS.filter((c) => !c.always).map((c) => ({
        label: c.label, checked: shown.has(c.key), keepOpen: true,
        onClick: () => {
            shown[shown.has(c.key) ? "delete" : "add"](c.key);
            store.set("tableCols", COLS.map((x) => x.key).filter((k) => k === "title" || shown.has(k)));
            emit("tasks");
            tableColumnsMenu(anchor);
        },
    }))], { align: "end" });
}

export function renderTable(root) {
    const shown = new Set(store.get("tableCols", DEFAULT_COLS));
    const cols = COLS.filter((c) => c.always || shown.has(c.key));
    const sort = S.tableSort || (S.tableSort = store.get("tableSort", { key: "", dir: 1 }));
    let rows = [...S.tasks.filter((t) => !t.done || t._fading), ...(S.showDone ? S.done : [])];
    if (sort.key) {
        const col = COLS.find((c) => c.key === sort.key);
        rows = rows.map((t, i) => [t, i]).sort(([a, i], [b, j]) => {
            const x = col.val(a), y = col.val(b);
            return (x < y ? -1 : x > y ? 1 : i - j) * sort.dir;
        }).map(([t]) => t);
    }
    const cell = (t, c) => {
        switch (c.key) {
            case "title": return h("td.tk-td-title", h("div.tk-td-title-in", checkbox(t), h("span.tk-title-text", t.title),
                t.subtasks ? h("span.tk-meta", icon("subtask", 12), `${t.subtasks_done}/${t.subtasks}`) : null,
                t.comments ? h("span.tk-meta", icon("comment", 12), String(t.comments)) : null));
            case "project": { const p = project(t.project_id); return h("td", p ? h("span.tk-meta", { title: pathText(t.project_id) }, h("span.tk-dot", { style: { background: p.colour || "var(--app-muted)" } }), p.is_inbox ? "Inbox" : p.name) : ""); }
            case "completed": return h("td", t.done_at ? h("span", { title: fmtDateTime(t.done_at) }, fmtDay(t.done_at)) : h("span.app-muted", "—"));
            case "time": return h("td", t.time_spent ? fmtMinutes(t.time_spent) : h("span.app-muted", "—"));
            case "repeat": return h("td", repeatText(t) || h("span.app-muted", "—"));
            case "reminders": return h("td", (t.reminders || []).length ? h("span.tk-meta", icon("bell", 12), String(t.reminders.length)) : h("span.app-muted", "—"));
            case "due": return h("td", t.due ? h("span" + (isOverdue(t) ? ".tk-text-danger" : ""), fmtDay(t.due)) : h("span.app-muted", "—"));
            case "start": return h("td", t.start ? fmtDay(t.start) : h("span.app-muted", "—"));
            case "priority": return h("td", h("span.tk-prio-txt.p" + prioLevel(t.priority), t.priority ? t.priority_label : "—"));
            case "labels": return h("td", h("div.tk-td-chips", labelChips(t, 3)));
            case "assignees": return h("td", assigneeStack(t, 4) || h("span.app-muted", "—"));
            case "percent": return h("td", t.percent ? `${t.percent}%` : h("span.app-muted", "—"));
            case "done": return h("td", t.done ? icon("check", 14, "tk-text-success") : "");
            case "created": return h("td.app-muted", { title: `${fmtDateTime(t.created_on)}${t.owner ? ` by ${t.owner.name}` : ""}` }, new Date(t.created_on).toLocaleDateString());
            case "updated": return h("td.app-muted", { title: fmtDateTime(t.updated_on) }, new Date(t.updated_on).toLocaleDateString());
            default: return h("td");
        }
    };
    const table = h("table.tk-table",
        h("thead", h("tr", cols.map((c) => h("th", { scope: "col", "aria-sort": sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : null },
            h("button.tk-th-btn", {
                type: "button",
                onclick: () => {
                    S.tableSort = sort.key !== c.key ? { key: c.key, dir: 1 } : sort.dir > 0 ? { key: c.key, dir: -1 } : { key: "", dir: 1 };
                    store.set("tableSort", S.tableSort);
                    emit("tasks");
                },
            }, c.label, sort.key === c.key ? icon(sort.dir > 0 ? "chevD" : "chevR", 12, sort.dir > 0 ? "" : "tk-rot-up") : null))))),
        h("tbody", rows.map((t) => h("tr", {
            dataset: { tid: t.id }, tabindex: -1,
            class: [t.done && "is-done", S.selected.has(t.id) && "is-selected", S.cursor === t.id && "is-cursor", S.route.task === t.id && "is-open"].filter(Boolean).join(" ") || null,
        }, cols.map((c) => cell(t, c))))));
    clear(root, rows.length ? h("div.tk-table-wrap", table) : h("div.tk-empty", "No tasks to show."));
}

// ================================================================== calendar

export function calendarRange() {
    const m = S.calMonth || (S.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const first = weekStart();
    const start = addDays(m, -((m.getDay() - first + 7) % 7));
    return { start, end: addDays(start, 42) };
}

function weekStart() {
    try {
        const loc = new Intl.Locale(navigator.language);
        const info = loc.getWeekInfo?.() || loc.weekInfo;
        if (info) return info.firstDay % 7;
    } catch (_) { /* older browsers */ }
    return 0;
}

export function renderCalendar(root) {
    const { start } = calendarRange();
    const m = S.calMonth, today = startOfDay(new Date());
    const byDay = new Map();
    for (const t of S.calTasks || []) {
        if (!t.due) continue;
        const k = dayKey(new Date(t.due));
        (byDay.get(k) || byDay.set(k, []).get(k)).push(t);
    }
    for (const list of byDay.values()) list.sort((a, b) => (a.done - b.done) || new Date(a.due) - new Date(b.due));
    const sel = S.calSelected || dayKey(today);
    const nav = (n) => { S.calMonth = new Date(m.getFullYear(), m.getMonth() + n, 1); app.refreshView(); };
    const head = h("div.tk-cal-head",
        h("h2.tk-cal-title", fmtMonth.format(m)),
        h("div.tk-btn-group",
            h("button.tk-btn.tk-btn-icon", { type: "button", "aria-label": "Previous month", onclick: () => nav(-1) }, icon("chevL", 14)),
            h("button.tk-btn", { type: "button", onclick: () => { S.calMonth = null; S.calSelected = null; app.refreshView(); } }, "Today"),
            h("button.tk-btn.tk-btn-icon", { type: "button", "aria-label": "Next month", onclick: () => nav(1) }, icon("chevR", 14))));
    const grid = h("div.tk-cal-grid", { role: "grid", "aria-label": fmtMonth.format(m) });
    for (let i = 0; i < 7; i++) grid.append(h("div.tk-cal-wd", { role: "columnheader" }, weekday(addDays(start, i))));
    for (let i = 0; i < 42; i++) {
        const d = addDays(start, i), k = dayKey(d), items = byDay.get(k) || [];
        const cell = h("div.tk-cal-day", {
            role: "gridcell", dataset: { day: k },
            class: [d.getMonth() !== m.getMonth() && "is-out", d.getTime() === today.getTime() && "is-today", k === sel && "is-sel"].filter(Boolean).join(" ") || null,
            onclick: (e) => { if (!e.target.closest("button,input")) { S.calSelected = k; emit("tasks"); } },
        },
        h("div.tk-cal-dayhead", h("span.tk-cal-num", String(d.getDate())),
            h("button.tk-icon-btn.tk-cal-add", { type: "button", "aria-label": `Add task on ${d.toDateString()}`, onclick: () => calQuickAdd(cell, d) }, icon("plus", 12))),
        h("div.tk-cal-items", items.slice(0, 4).map(calChip),
            items.length > 4 ? h("button.tk-cal-more", { type: "button", onclick: () => { S.calSelected = k; cell.classList.add("is-expanded"); cell.querySelector(".tk-cal-items").replaceChildren(...items.map(calChip)); } }, `${items.length - 4} more`) : null),
        h("div.tk-cal-dots", items.slice(0, 5).map((t) => h("span.tk-dot.p" + prioLevel(t.priority) + (t.done ? ".is-done" : "")))));
        grid.append(cell);
    }
    const selItems = byDay.get(sel) || [];
    const agenda = h("div.tk-cal-agenda", h("h3", fmtDay(new Date(sel + "T12:00").toISOString(), false)),
        selItems.length ? selItems.map(calChip) : h("div.app-muted.small", "Nothing due."));
    clear(root, h("div.tk-cal", head, h("div.tk-cal-scroll", grid), agenda));
}

function calChip(t) {
    const d = new Date(t.due);
    return h("button.tk-cal-chip" + (t.done ? ".is-done" : "") + (isOverdue(t) ? ".is-overdue" : ""), {
        type: "button", dataset: { tid: t.id }, title: t.title, style: t.colour ? { "--tc": t.colour } : null,
        onclick: () => app.openTask(t.id),
    }, h("span.tk-dot.p" + prioLevel(t.priority)), isAllDay(d) ? null : h("span.tk-cal-time", time(d)), h("span.tk-cal-chip-t", t.title));
}

function calQuickAdd(cell, d) {
    const input = h("input.tk-inline-input.tk-cal-input", { placeholder: "New task", maxlength: 512, "aria-label": "New task" });
    const items = cell.querySelector(".tk-cal-items");
    items.prepend(input);
    input.focus();
    const close = () => input.remove();
    input.addEventListener("keydown", async (e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
        if (e.key === "Enter" && input.value.trim()) {
            const text = input.value.trim();
            close();
            try {
                const t = await quickAdd(`${text} ${dayKey(d)}`, { project_id: S.route.scope === "project" ? S.route.id : null });
                S.calTasks.push(t);
                emit("tasks");
            } catch (err) { toast(err.message, { error: true }); }
        }
    });
    input.addEventListener("blur", () => setTimeout(close, 100));
}

export function setupCalendarDrag(view) {
    let over = null;
    draggable(view, {
        selector: ".tk-cal-grid .tk-cal-chip",
        onStart: (el) => { const t = S.byId.get(el.dataset.tid); return t && canEdit(t) ? { t } : null; },
        onMove: (ctx, { target }) => {
            over?.classList.remove("is-drop-target");
            over = target?.closest(".tk-cal-day") || null;
            over?.classList.add("is-drop-target");
        },
        onEnd: () => over?.classList.remove("is-drop-target"),
        onDrop: async (ctx) => {
            const cell = over;
            over = null;
            if (!cell) return;
            const old = new Date(ctx.t.due), [y, mo, d] = cell.dataset.day.split("-").map(Number);
            const nd = new Date(y, mo - 1, d, old.getHours(), old.getMinutes());
            if (nd.getTime() === old.getTime()) return;
            const start = ctx.t.start ? new Date(new Date(ctx.t.start).getTime() + (nd - old)).toISOString() : undefined;
            await patchTask(ctx.t, start ? { due: nd.toISOString(), start } : { due: nd.toISOString() }).catch(() => {});
            emit("tasks");
            toast(`Rescheduled to ${fmtDay(nd.toISOString())}`);
        },
    });
}

// ================================================================== timeline (Gantt)

const TL_DAYS = 42;

export function renderTimeline(root) {
    const today = startOfDay(new Date());
    const start = S.tlStart || (S.tlStart = addDays(today, -7));
    const end = addDays(start, TL_DAYS);
    const dated = S.tasks.filter((t) => (t.due || t.start) && (!t.done || t._fading));
    const undated = S.tasks.filter((t) => !t.due && !t.start && !t.done).length;
    const span = (t) => {
        const s = startOfDay(new Date(t.start || t.due)), e = startOfDay(new Date(t.due || t.start));
        return e < s ? [e, s] : [s, e];
    };
    const rows = dated.filter((t) => { const [s, e] = span(t); return e >= start && s < end; })
        .sort((a, b) => span(a)[0] - span(b)[0] || span(a)[1] - span(b)[1]);
    const shift = (n) => { S.tlStart = addDays(start, n); emit("tasks"); };

    const head = h("div.tk-cal-head",
        h("h2.tk-cal-title", `${monthDay(start)} – ${monthDay(addDays(end, -1))}`),
        undated ? h("span.app-muted.small", `${undated} undated task${undated > 1 ? "s" : ""} not shown`) : null,
        h("div.tk-grow"),
        h("div.tk-btn-group",
            h("button.tk-btn.tk-btn-icon", { type: "button", "aria-label": "Earlier", onclick: () => shift(-14) }, icon("chevL", 14)),
            h("button.tk-btn", { type: "button", onclick: () => { S.tlStart = null; emit("tasks"); } }, "Today"),
            h("button.tk-btn.tk-btn-icon", { type: "button", "aria-label": "Later", onclick: () => shift(14) }, icon("chevR", 14))));

    const days = h("div.tk-tl-days");
    const months = h("div.tk-tl-months");
    for (let i = 0; i < TL_DAYS; i++) {
        const d = addDays(start, i);
        if (i === 0 || d.getDate() === 1) {
            const left = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
            months.append(h("span", { style: { gridColumn: `${i + 1} / span ${Math.min(left, TL_DAYS - i)}` } }, d.toLocaleDateString(undefined, { month: "short", year: "numeric" })));
        }
        days.append(h("span" + (d.getTime() === today.getTime() ? ".is-today" : "") + (d.getDay() === 0 || d.getDay() === 6 ? ".is-weekend" : ""), String(d.getDate())));
    }
    const body = h("div.tk-tl-body");
    for (const t of rows) {
        const [s, e] = span(t);
        const from = Math.max(0, Math.round((s - start) / DAY)), to = Math.min(TL_DAYS - 1, Math.round((e - start) / DAY));
        const bar = h("div.tk-tl-bar.p" + prioLevel(t.priority) + (t.done ? ".is-done" : "") + (isOverdue(t) ? ".is-overdue" : "") + (to - from < 3 ? ".is-short" : ""), {
            dataset: { tid: t.id }, title: `${t.title}\n${t.start ? fmtDay(t.start) + " → " : ""}${fmtDay(t.due)}`,
            style: { gridColumn: `${from + 1} / ${to + 2}`, ...(t.colour ? { "--tc": t.colour } : {}) },
        }, canEdit(t) ? h("span.tk-tl-h.is-l", { dataset: { edge: "start" } }) : null, h("span.tk-tl-bar-t", t.title),
        canEdit(t) ? h("span.tk-tl-h.is-r", { dataset: { edge: "end" } }) : null);
        body.append(h("div.tk-tl-row", { dataset: { tid: t.id } },
            h("button.tk-tl-name", { type: "button", onclick: () => app.openTask(t.id) }, h("span.tk-dot.p" + prioLevel(t.priority)), h("span", t.title)),
            h("div.tk-tl-track", bar)));
    }
    const todayIdx = Math.round((today - start) / DAY);
    const grid = h("div.tk-tl", { style: { "--days": TL_DAYS, "--today": todayIdx } },
        h("div.tk-tl-row.tk-tl-headrow", h("div.tk-tl-name.is-head", "Task"), h("div.tk-tl-track", months, days)),
        body, todayIdx >= 0 && todayIdx < TL_DAYS ? h("div.tk-tl-now", { "aria-hidden": "true" }) : null);
    clear(root, h("div.tk-timeline", head, rows.length ? h("div.tk-tl-scroll", grid) : h("div.tk-empty", "No tasks with dates in this range. Give tasks a start or due date to plan them here.")));
    setupTimelineDrag(root, start);
}

function setupTimelineDrag(root, start) {
    root.querySelectorAll(".tk-tl-bar").forEach((bar) => {
        bar.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            const t = S.byId.get(bar.dataset.tid);
            if (!t || !canEdit(t)) return;
            const edge = e.target.dataset.edge || "move";
            const track = bar.parentElement, dayW = track.getBoundingClientRect().width / TL_DAYS;
            const x0 = e.clientX;
            let delta = 0, moved = false;
            bar.setPointerCapture(e.pointerId);
            const move = (ev) => {
                delta = Math.round((ev.clientX - x0) / dayW);
                moved = moved || Math.abs(ev.clientX - x0) > 4;
                if (edge === "move") bar.style.transform = `translateX(${delta * dayW}px)`;
                else if (edge === "end") bar.style.marginRight = `${-delta * dayW}px`;
                else bar.style.marginLeft = `${delta * dayW}px`;
            };
            const up = async () => {
                bar.removeEventListener("pointermove", move);
                bar.removeEventListener("pointerup", up);
                bar.removeEventListener("pointercancel", up);
                if (!moved) { app.openTask(t.id); return; }
                bar.style.transform = bar.style.marginLeft = bar.style.marginRight = "";
                if (!delta) return;
                const sh = (iso, n) => iso ? new Date(new Date(iso).getTime() + n * DAY).toISOString() : iso;
                const patch = {};
                if (edge === "move") { if (t.due) patch.due = sh(t.due, delta); if (t.start) patch.start = sh(t.start, delta); }
                else if (edge === "end") {
                    const base = t.due || t.start;
                    patch.due = t.due ? sh(t.due, delta) : endOfDay(new Date(new Date(base).getTime() + delta * DAY)).toISOString();
                } else {
                    const base = t.start || t.due;
                    const ns = new Date(startOfDay(new Date(base)).getTime() + delta * DAY);
                    if (!t.start) ns.setHours(9, 0, 0, 0);
                    patch.start = t.start ? sh(t.start, delta) : ns.toISOString();
                }
                if (patch.start && patch.due && new Date(patch.start) > new Date(patch.due)) { toast("Start must be before the due date", { error: true }); emit("tasks"); return; }
                await patchTask(t, patch).catch(() => {});
                emit("tasks");
            };
            bar.addEventListener("pointermove", move);
            bar.addEventListener("pointerup", up);
            bar.addEventListener("pointercancel", up);
            e.preventDefault();
        });
    });
}
