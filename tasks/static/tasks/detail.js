/* Task detail drawer: every field editable, subtasks, relations and comments. Full screen on phones. */

import { $, h, clear, icon, avatar, popover, closePopover, menu, dialog, confirmDialog, toast, api, qs, fmtDay, fmtDateTime,
    ago, toInput, fromInput, startOfDay, addDays, endOfDay, isAllDay, fmtMinutes, parseMinutes, dayKey } from "./lib.js";
import { S, app, emit, on, adopt, project, label, canEdit, patchTask, setDone, moveTask, quickAdd, deleteTasks, duplicateTask,
    loadBuckets, assignable, PRIORITIES, prioLevel, COLOURS, failed, recovered, retryNow, REPEAT_PRESETS, REPEAT_UNITS as UNITS, repeatText,
    projectPath } from "./store.js";
import { labelDialog } from "./sidebar.js";

const drawer = () => document.getElementById("tk-drawer");
let cur = null;          // the open task (canonical object)
let parts = {};          // section containers
let loadToken = 0;

export function isOpen() { return !!cur; }
export function currentTask() { return cur; }

export async function openDetail(id) {
    const el = drawer();
    const token = ++loadToken;
    const known = S.byId.get(id);
    if (!cur || cur.id !== id) {
        cur = known || null;
        el.hidden = false;
        requestAnimationFrame(() => el.classList.add("is-open"));
        document.body.classList.add("tk-drawer-open");
        if (cur) build(); else clear(el, h("div.tk-dr-loading", h("div.tk-skeleton", h("div"), h("div"), h("div"))));
    }
    // One request for the task itself (fresh fields + relations). Comments and subtasks are fetched only when the
    // task has some, and each part can fail on its own without closing the drawer.
    const early = known && known.comments > 0 && !known._comments ? loadComments(known) : null;
    try {
        const t = await api("GET", id);
        if (token !== loadToken) return;
        cur = adopt(t);
        cur._detailError = null;
        recovered("detail");
        build();
    } catch (e) {
        if (token !== loadToken) return;
        if (!failed("detail", () => openDetail(id), e)) {
            toast(e.status === 404 ? "That task doesn't exist or isn't shared with you." : e.message, { error: true });
            app.closeTask();
            return;
        }
        if (!cur) {
            clear(el, h("div.tk-dr-head", h("div.tk-grow"), h("button.tk-icon-btn", { type: "button", "aria-label": "Close details", onclick: () => app.closeTask() }, icon("x", 16))),
                h("div.tk-dr-body", h("div.tk-dr-warn", h("span", "Couldn't load this task. The server may be restarting."),
                    h("button.tk-link-btn", { type: "button", onclick: () => retryNow() }, "Retry"))));
            return;
        }
        cur._detailError = e.message;
        build();
    }
    if (!early && cur.comments > 0 && !cur._comments) loadComments(cur);
    loadSubtasks();
    if (cur.project_id && !S.buckets.has(cur.project_id)) loadBuckets(cur.project_id).then(() => token === loadToken && renderProps()).catch(() => {});
}

async function loadComments(t) {
    t._commentsError = null;
    if (cur === t) renderComments();
    try {
        t._comments = await api("GET", `${t.id}/comments`);
        recovered("comments");
    } catch (e) {
        t._commentsError = e.message;
        failed("comments", () => (cur === t ? loadComments(t) : recovered("comments")), e);
    }
    if (cur === t) renderComments();
}

export function closeDetail() {
    loadToken++;
    for (const k of ["detail", "comments", "subtasks"]) recovered(k);  // nothing to retry for a closed drawer
    cur = null;
    parts = {};
    const el = drawer();
    el.classList.remove("is-open");
    document.body.classList.remove("tk-drawer-open");
    setTimeout(() => { if (!cur) { el.hidden = true; el.replaceChildren(); } }, 180);
}

on("task", (t) => {
    if (!cur || t !== cur) return;
    renderHead();
    renderStatus();
    renderFoot();
    renderProps();
    const title = parts.title;
    if (title && document.activeElement !== title) { title.value = cur.title; autosize(title); }
    if (parts.desc && document.activeElement !== parts.desc) { parts.desc.value = cur.description || ""; autosize(parts.desc); }
    parts.check?.replaceWith(parts.check = doneBox());
});
on("deleted", (ids) => { if (cur && ids.has(cur.id)) app.closeTask(); });

// ------------------------------------------------------------------ layout

function build() {
    const t = cur, ro = !canEdit(t);
    parts = {};
    parts.head = h("div.tk-dr-head");
    parts.title = h("textarea.tk-dr-title", { rows: 1, maxlength: 256, readOnly: ro, "aria-label": "Title", value: t.title });
    parts.title.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); parts.title.blur(); }
        if (e.key === "Escape") { e.stopPropagation(); parts.title.value = cur.title; parts.title.blur(); }
    });
    parts.title.addEventListener("input", () => autosize(parts.title));
    parts.title.addEventListener("blur", () => {
        const v = parts.title.value.replace(/\s+/g, " ").trim();
        if (v && v !== cur.title) patchTask(cur, { title: v }).catch(() => {});
        else parts.title.value = cur.title;
    });
    parts.check = doneBox();
    parts.props = h("div.tk-props");
    parts.desc = h("textarea.tk-dr-desc", { rows: 3, readOnly: ro, placeholder: ro ? "No description" : "Add a description…", "aria-label": "Description", value: t.description || "" });
    parts.desc.addEventListener("input", () => autosize(parts.desc));
    parts.desc.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.stopPropagation(); parts.desc.blur(); }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) parts.desc.blur();
    });
    parts.desc.addEventListener("blur", () => {
        if (parts.desc.value !== (cur.description || "")) patchTask(cur, { description: parts.desc.value }).catch(() => {});
    });
    parts.subtasks = h("section.tk-dr-sec");
    parts.relations = h("section.tk-dr-sec");
    parts.comments = h("section.tk-dr-sec");
    parts.foot = h("div.tk-dr-foot");

    clear(drawer(), parts.head, h("div.tk-dr-body",
        t._detailError ? h("div.tk-dr-warn", { role: "status" }, h("span", "Showing what's loaded. Couldn't get the latest details."),
            h("button.tk-link-btn", { type: "button", onclick: () => retryNow() }, "Retry")) : null,
        h("div.tk-dr-titlebar", parts.check, parts.title),
        parts.status = h("div.tk-dr-status"),
        parts.props,
        h("section.tk-dr-sec", h("h3.tk-dr-h", "Description"), parts.desc),
        parts.subtasks, parts.relations, parts.comments, parts.foot));
    renderHead();
    renderStatus();
    renderProps();
    renderSubtasks();
    renderRelations();
    renderComments();
    renderFoot();
    requestAnimationFrame(() => { autosize(parts.title); autosize(parts.desc); });
}

/** Quiet facts under the title: completion, origin, who owns it. */
function renderStatus() {
    if (!parts.status || !cur) return;
    const t = cur, bits = [];
    if (t.done) bits.push(h("span.tk-dr-fact.is-done", icon("done", 12), t.done_at ? `Completed ${fmtDateTime(t.done_at)}` : "Completed"));
    if (t.repeat_mode && t.done_at && !t.done) bits.push(h("span.tk-dr-fact", { title: fmtDateTime(t.done_at) }, icon("repeat", 12), `Last done ${ago(t.done_at)}`));
    if (isOverdueT(t)) bits.push(h("span.tk-dr-fact.is-alert", icon("overdue", 12), `Overdue since ${fmtDay(t.due)}`));
    if (t.event_id) bits.push(h("a.tk-dr-fact", { href: "/calendar/" }, icon("calendar", 12), "From a calendar event"));
    if (t.owner && t.owner.username !== S.me.username) bits.push(h("span.tk-dr-fact", icon("user", 12), `Owned by ${t.owner.name}`));
    clear(parts.status, bits);
    parts.status.hidden = !bits.length;
}

function renderFoot() {
    if (!parts.foot || !cur) return;
    const t = cur;
    clear(parts.foot,
        h("span", { title: fmtDateTime(t.created_on) }, `Created ${ago(t.created_on)}${t.owner ? ` by ${t.owner.name}` : ""}`),
        h("span", { title: fmtDateTime(t.updated_on) }, `Updated ${ago(t.updated_on)}`));
}

function autosize(el) { if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }

function doneBox() {
    const t = cur;
    return h("button.tk-check.tk-check-lg.p" + prioLevel(t.priority) + (t.done ? ".is-done" : ""), {
        type: "button", role: "checkbox", "aria-checked": String(!!t.done), disabled: !canEdit(t),
        "aria-label": t.done ? "Mark not done" : "Mark done", onclick: () => setDone(t, !t.done).catch(() => {}),
    }, icon("check", 14));
}

function renderHead() {
    if (!parts.head || !cur) return;
    const t = cur, p = project(t.project_id), parent = t.parent_id ? S.byId.get(t.parent_id) : null;
    clear(parts.head,
        h("nav.tk-crumbs", { "aria-label": "Breadcrumb" },
            projectPath(t.project_id).map((x, i) => [i ? icon("chevR", 12, "tk-crumb-sep") : null,
                h("a.tk-crumb", { href: app.href({ project: x.id }), onclick: (e) => { e.preventDefault(); app.go({ project: x.id, task: t.id }); } },
                    h("span.tk-dot", { style: { background: x.colour || "var(--app-muted)" } }), x.is_inbox ? "Inbox" : x.name)]),
            t.parent_id ? [icon("chevR", 12, "tk-crumb-sep"), h("a.tk-crumb", {
                href: app.href({ ...app.params(), task: t.parent_id }),
                onclick: (e) => { e.preventDefault(); app.openTask(t.parent_id); },
            }, parent?.title || "Parent task")] : null),
        h("div.tk-grow"),
        h("button.tk-icon-btn" + (t.favorite ? ".is-on" : ""), {
            type: "button", "aria-pressed": String(!!t.favorite), title: t.favorite ? "Unfavorite" : "Favorite", disabled: !canEdit(t),
            onclick: () => patchTask(t, { favorite: !t.favorite }).catch(() => {}),
        }, icon(t.favorite ? "star-fill" : "star", 16)),
        h("button.tk-icon-btn", {
            type: "button", title: "More", "aria-label": "More actions",
            onclick: (e) => menu(e.currentTarget, [
                { label: "Copy link", icon: "link", onClick: () => { navigator.clipboard?.writeText(`${location.origin}/tasks/?task=${t.id}`); toast("Link copied"); } },
                { label: "Duplicate", icon: "copy", disabled: !canEdit(t), onClick: async () => { const c = await duplicateTask(t); app.openTask(c.id); } },
                t.parent_id && { label: "Make top-level task", icon: "chevL", disabled: !canEdit(t), onClick: () => patchTask(t, { parent_id: null }).then(() => emit("tasks")) },
                { sep: true },
                { label: "Delete task", icon: "trash", danger: true, hint: "Del", disabled: !canEdit(t), onClick: () => deleteTasks([t]) },
            ], { align: "end" }),
        }, icon("more", 16)),
        h("button.tk-icon-btn", { type: "button", title: "Close (Esc)", "aria-label": "Close details", onclick: () => app.closeTask() }, icon("x", 16)));
}

// ------------------------------------------------------------------ properties

function prop(name, ico, value, onClick, { empty = false, ro = false } = {}) {
    return [h("div.tk-prop-k", icon(ico, 14), name),
        h("div.tk-prop-v", ro || !onClick ? h("div.tk-prop-static" + (empty ? ".is-empty" : ""), value)
            : h("button.tk-prop-btn" + (empty ? ".is-empty" : ""), { type: "button", onclick: (e) => onClick(e.currentTarget) }, value))];
}

function renderProps() {
    if (!parts.props || !cur) return;
    const t = cur, ro = !canEdit(t), p = project(t.project_id);
    const buckets = S.buckets.get(t.project_id) || [];
    const bucket = buckets.find((b) => b.id === t.bucket_id);
    const labels = (t.labels || []).map(label).filter(Boolean);
    clear(parts.props,
        prop("Project", "folder", p ? [h("span.tk-dot", { style: { background: p.colour || "var(--app-muted)" } }), p.name] : "—", ro ? null : projectPicker, { ro }),
        buckets.length ? prop("Status", "board", bucket?.name || "—", ro ? null : (a) => menu(a, buckets.map((b) => ({
            label: b.name, checked: b.id === t.bucket_id, icon: b.is_done ? "done" : "board",
            onClick: () => b.id !== t.bucket_id && moveTask(t, { bucket_id: b.id }).catch(() => {}),
        }))), { ro }) : null,
        prop("Due", "calendar", t.due ? h("span" + (isOverdueT(t) ? ".tk-text-danger" : ""), fmtDay(t.due)) : "No due date", ro ? null : (a) => datePicker(a, "due"), { empty: !t.due, ro }),
        prop("Start", "play", t.start ? fmtDay(t.start) : "No start date", ro ? null : (a) => datePicker(a, "start"), { empty: !t.start, ro }),
        prop("Priority", "flag", h("span.tk-prio-txt.p" + prioLevel(t.priority), t.priority ? t.priority_label : "None"), ro ? null : (a) => menu(a, PRIORITIES.slice().reverse().map((x) => ({
            label: x.label, hint: x.key, checked: prioLevel(t.priority) === prioLevel(x.value), icon: "flag",
            onClick: () => patchTask(t, { priority: x.value }).catch(() => {}),
        }))), { ro }),
        prop("Labels", "tag", labels.length ? h("span.tk-chips-inline", labels.map((l) => h("span.tk-chip", { style: { "--lc": l.colour || "var(--app-muted)" } }, h("span.tk-chip-dot"), l.name))) : "Add labels",
            ro ? null : labelPicker, { empty: !labels.length, ro }),
        prop("Assignees", "user", (t.assignees || []).length ? h("span.tk-assignees", t.assignees.map((u) => h("span.tk-assignee", avatar(u, "sm"), u.name))) : "Unassigned",
            ro ? null : assigneePicker, { empty: !(t.assignees || []).length, ro }),
        prop("Repeat", "repeat", repeatText(t) || "Does not repeat", ro ? null : repeatPicker, { empty: !t.repeat_mode, ro }),
        prop("Reminders", "bell", remindersValue(t, ro), null),
        prop("Colour", "palette", colourRow(t, ro), null),
        prop("Progress", "percent", progressRow(t, ro), null),
        prop("Time spent", "clock", timeSpentInput(t, ro), null));
}

const isOverdueT = (t) => t.due && !t.done && new Date(t.due) < new Date() && !(isAllDay(new Date(t.due)) && startOfDay(new Date(t.due)).getTime() === startOfDay(new Date()).getTime());

function projectPicker(anchor) {
    const t = cur;
    menu(anchor, S.projects.filter((p) => p.role >= 1 && !p.archived).map((p) => ({
        label: p.name, swatch: p.colour, checked: p.id === t.project_id,
        onClick: async () => {
            if (p.id === t.project_id) return;
            await moveTask(t, { project_id: p.id }).catch(() => {});
            if (S.route.scope === "project" && S.route.id !== p.id) { S.tasks = S.tasks.filter((x) => x !== t); emit("tasks"); }
            loadBuckets(p.id).then(renderProps).catch(() => {});
            toast(`Moved to ${p.name}`);
        },
    })));
}

function datePicker(anchor, field) {
    const t = cur;
    const curVal = t[field] ? new Date(t[field]) : null;
    const keepTime = (d) => {
        const x = endOfDay(d);
        if (curVal && !isAllDay(curVal)) x.setHours(curVal.getHours(), curVal.getMinutes());
        else if (field === "start") x.setHours(9, 0);
        return x.toISOString();
    };
    const set = (iso) => {
        closePopover();
        if (iso === t[field]) return;
        if (field === "start" && iso && t.due && new Date(iso) > new Date(t.due)) return toast("Start must be before the due date", { error: true });
        patchTask(t, { [field]: iso }).catch(() => {});
    };
    const today = startOfDay(new Date());
    const nextMon = addDays(today, ((8 - today.getDay()) % 7) || 7);
    const sat = addDays(today, (6 - today.getDay() + 7) % 7 || 7);
    const quick = [
        ["Today", today, "today"], ["Tomorrow", addDays(today, 1), "upcoming"], ["This weekend", sat, "calendar"],
        ["Next week", nextMon, "chevR"], ["In 2 weeks", addDays(today, 14), "calendar"],
    ];
    const dateIn = h("input.form-control.form-control-sm", { type: "date", value: curVal ? dayKey(curVal) : "", "aria-label": "Date" });
    const timeIn = h("input.form-control.form-control-sm", { type: "time", value: curVal && !isAllDay(curVal) ? toInput(t[field]).slice(11) : "", "aria-label": "Time" });
    const apply = () => {
        if (!dateIn.value) return;
        const [y, m, d] = dateIn.value.split("-").map(Number);
        const x = new Date(y, m - 1, d, 23, 59);
        if (timeIn.value) { const [hh, mm] = timeIn.value.split(":").map(Number); x.setHours(hh, mm); }
        set(x.toISOString());
    };
    const content = h("div.tk-datepop",
        h("div.tk-menu", quick.map(([lbl, d, ic]) => h("button.tk-menu-item", { type: "button", role: "menuitem", onclick: () => set(keepTime(d)) },
            icon(ic, 14), h("span.tk-menu-label", lbl), h("span.tk-menu-hint", d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })))),
        t[field] ? h("button.tk-menu-item.is-danger", { type: "button", role: "menuitem", onclick: () => set(null) }, icon("x", 14), h("span.tk-menu-label", field === "due" ? "No due date" : "No start date")) : null),
        h("form.tk-datepop-custom", { onsubmit: (e) => { e.preventDefault(); apply(); } },
            h("div.tk-datepop-row", dateIn, timeIn),
            h("div.tk-datepop-row", h("span.app-muted.small", "Leave time empty for all day"), h("button.btn.btn-sm.btn-primary", { type: "submit" }, "Set"))));
    popover(anchor, content, { className: "tk-pop-date" });
}

function labelPicker(anchor) {
    const t = cur;
    const search = h("input.form-control.form-control-sm", { placeholder: "Search or create label", "aria-label": "Search labels", maxlength: 48 });
    const list = h("div.tk-menu.tk-menu-scroll");
    const draw = () => {
        const q = search.value.trim().toLowerCase();
        const items = S.labels.filter((l) => l.name.toLowerCase().includes(q));
        const exact = S.labels.some((l) => l.name.toLowerCase() === q);
        clear(list, items.map((l) => {
            const on = (t.labels || []).includes(l.id);
            return h("button.tk-menu-item" + (on ? ".is-checked" : ""), {
                type: "button", role: "menuitemcheckbox", "aria-checked": String(on),
                onclick: () => {
                    const next = on ? t.labels.filter((x) => x !== l.id) : [...(t.labels || []), l.id];
                    patchTask(t, { labels: next }).catch(() => {});
                    draw();
                },
            }, h("span.tk-dot", { style: { background: l.colour || "var(--app-muted)" } }), h("span.tk-menu-label", l.name), on ? icon("check", 14, "tk-menu-check") : null);
        }), q && !exact ? h("button.tk-menu-item", {
            type: "button", role: "menuitem",
            onclick: async () => {
                try {
                    const l = await api("POST", "labels", { name: search.value.trim() });
                    S.labels.push(l);
                    S.labels.sort((a, b) => a.name.localeCompare(b.name));
                    emit("meta");
                    await patchTask(t, { labels: [...(t.labels || []), l.id] });
                    search.value = "";
                    draw();
                } catch (e) { toast(e.message, { error: true }); }
            },
        }, icon("plus", 14), h("span.tk-menu-label", `Create “${search.value.trim()}”`)) : null,
        !items.length && !q ? h("div.tk-menu-head", "No labels yet — type to create one") : null);
    };
    search.addEventListener("input", draw);
    search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); list.querySelector(".tk-menu-item")?.click(); } });
    draw();
    popover(anchor, h("div.tk-picker", search, list), { className: "tk-pop-picker" });
}

async function assigneePicker(anchor) {
    const t = cur;
    const list = h("div.tk-menu.tk-menu-scroll", h("div.tk-menu-head", "Loading…"));
    popover(anchor, h("div.tk-picker", list), { className: "tk-pop-picker" });
    const users = await assignable(t);
    const draw = () => clear(list, h("div.tk-menu-head", "Assign to"), users.map((u) => {
        const on = (t.assignees || []).some((a) => a.username === u.username);
        return h("button.tk-menu-item" + (on ? ".is-checked" : ""), {
            type: "button", role: "menuitemcheckbox", "aria-checked": String(on),
            onclick: () => {
                const names = (t.assignees || []).map((a) => a.username);
                patchTask(t, { assignees: on ? names.filter((n) => n !== u.username) : [...names, u.username] }).catch(() => {});
                draw();
            },
        }, avatar(u, "sm"), h("span.tk-menu-label", u.name, u.username === S.me.username ? h("span.app-muted", " (you)") : null), on ? icon("check", 14, "tk-menu-check") : null);
    }), users.length < 2 ? h("div.tk-menu-head", "Share the project to assign others") : null);
    draw();
}

function repeatPicker(anchor) {
    const t = cur;
    const n = h("input.form-control.form-control-sm", { type: "number", min: 1, max: 999, value: 1, "aria-label": "Every" });
    const unit = h("select.form-select.form-select-sm", { "aria-label": "Unit" }, UNITS.map(([name, s]) => h("option", { value: s }, name)));
    unit.value = "86400";
    if (t.repeat_mode && t.repeat_every) {
        const [, secs] = [...UNITS].reverse().find(([, s]) => t.repeat_every % s === 0) || UNITS[0];
        unit.value = String(secs);
        n.value = t.repeat_every / secs;
    }
    const after = h("input.form-check-input", { type: "checkbox", id: "tk-rep-after", checked: t.repeat_mode === 3 });
    const set = (mode, every) => { closePopover(); patchTask(t, { repeat_mode: mode, repeat_every: every }).catch(() => {}); };
    popover(anchor, h("div.tk-datepop",
        h("div.tk-menu", REPEAT_PRESETS.map((p) => h("button.tk-menu-item" + (repeatText(t) === p.label || (!t.repeat_mode && !p.mode) ? ".is-checked" : ""), {
            type: "button", role: "menuitem",
            onclick: () => {
                if (p.mode && !t.due && !t.start) toast("Repeats count from the due date: set one so the task can move forward");
                set(p.mode, p.every);
            },
        }, icon(p.mode ? "repeat" : "x", 14), h("span.tk-menu-label", p.label)))),
        h("form.tk-datepop-custom", { onsubmit: (e) => { e.preventDefault(); set(after.checked ? 3 : 1, Math.max(1, +n.value || 1) * +unit.value); } },
            h("div.small.fw-semibold", "Custom"),
            h("div.tk-datepop-row", h("span.small", "Every"), n, unit),
            h("div.form-check.small", after, h("label.form-check-label", { for: "tk-rep-after" }, "Count from when I complete it")),
            h("div.tk-datepop-row", h("span"), h("button.btn.btn-sm.btn-primary", { type: "submit" }, "Set")))), { className: "tk-pop-date" });
}

// reminders --------------------------------------------------------

const durText = (secs) => {
    const a = Math.abs(secs);
    if (a % 86400 === 0) return `${a / 86400} day${a === 86400 ? "" : "s"}`;
    if (a % 3600 === 0) return `${a / 3600} hour${a === 3600 ? "" : "s"}`;
    return `${Math.round(a / 60)} min`;
};

function reminderText(r) {
    if (!r.relative_to) return fmtDateTime(r.at);
    const what = r.relative_to === "due" ? "due" : "start";
    if (!r.offset) return `At ${what} time`;
    return `${durText(r.offset)} ${r.offset < 0 ? "before" : "after"} ${what}`;
}

function remindersValue(t, ro) {
    const rems = t.reminders || [];
    const save = (list) => patchTask(t, { reminders: list.map((r) => ({ at: r.at || null, relative_to: r.relative_to || "", offset: r.offset || 0 })) }).catch(() => {});
    return h("div.tk-rems",
        rems.map((r, i) => h("span.tk-rem" + (r.sent ? ".is-sent" : ""), { title: r.fire_at ? `Fires ${fmtDateTime(r.fire_at)}` : "Needs a date on the task" },
            icon("bell", 12), reminderText(r),
            r.sent ? h("span.app-muted", " · sent") : r.relative_to && r.fire_at ? h("span.app-muted", ` · ${fmtDateTime(r.fire_at)}`) : !r.fire_at ? h("span.app-muted", " · needs a date") : null,
            ro ? null : h("button.tk-x", { type: "button", "aria-label": "Remove reminder", onclick: () => save(rems.filter((_, j) => j !== i)) }, icon("x", 12)))),
        ro ? (rems.length ? null : h("span.app-muted", "None")) : h("button.tk-prop-btn.is-empty.tk-add-inline", {
            type: "button",
            onclick: (e) => menu(e.currentTarget, [
                { heading: t.due ? "Relative to due date" : "Set a due date for relative reminders" },
                ...[[0, "At due time"], [-900, "15 minutes before"], [-3600, "1 hour before"], [-86400, "1 day before"], [-604800, "1 week before"]]
                    .map(([off, lbl]) => ({ label: lbl, icon: "bell", disabled: !t.due, onClick: () => save([...rems, { relative_to: "due", offset: off }]) })),
                t.start && { label: "At start time", icon: "play", onClick: () => save([...rems, { relative_to: "start", offset: 0 }]) },
                { sep: true },
                { label: "Pick date & time…", icon: "calendar", onClick: async () => {
                    const input = h("input.form-control.form-control-sm", { id: "tk-rem-at", type: "datetime-local", required: true, value: toInput(t.due || new Date(Date.now() + 3600000).toISOString()) });
                    const at = await dialog({ title: "Remind me at", body: h("div.tk-form", h("label.form-label", { for: "tk-rem-at" }, "Date and time"), input),
                        actions: [{ label: "Cancel" }, { label: "Add reminder", primary: true }], onSubmit: () => fromInput(input.value) || false });
                    if (at) save([...rems, { at }]);
                } },
            ]),
        }, icon("plus", 12), "Add reminder"));
}

function colourRow(t, ro) {
    return h("div.tk-swatches.is-compact", ["", ...COLOURS].map((c) => h("button.tk-swatch-btn" + ((t.colour || "") === c ? ".is-on" : ""), {
        type: "button", disabled: ro, title: c || "No colour", "aria-label": c ? `Colour ${c}` : "No colour", "aria-pressed": String((t.colour || "") === c),
        style: { "--sw": c || "transparent" }, class: c ? null : "is-none",
        onclick: () => patchTask(t, { colour: c }).catch(() => {}),
    })));
}

function progressRow(t, ro) {
    const out = h("span.tk-pct", `${t.percent || 0}%`);
    const range = h("input.form-range.tk-range", { type: "range", min: 0, max: 100, step: 5, value: t.percent || 0, disabled: ro, "aria-label": "Percent done" });
    range.addEventListener("input", () => { out.textContent = `${range.value}%`; });
    range.addEventListener("change", () => patchTask(t, { percent: +range.value }).catch(() => {}));
    return h("div.tk-progress-row", range, out);
}

function timeSpentInput(t, ro) {
    const input = h("input.tk-prop-input", { value: fmtMinutes(t.time_spent), placeholder: ro ? "—" : "e.g. 1h 30m", readOnly: ro, "aria-label": "Time spent" });
    const save = () => {
        const m = parseMinutes(input.value);
        if (m == null) { toast("Use a time like 45m, 1h 30m or 1:30", { error: true }); input.value = fmtMinutes(t.time_spent); return; }
        if (m !== (t.time_spent || 0)) patchTask(t, { time_spent: Math.min(m, 32767) }).catch(() => {});
        else input.value = fmtMinutes(t.time_spent);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } if (e.key === "Escape") { e.stopPropagation(); input.value = fmtMinutes(t.time_spent); input.blur(); } });
    input.addEventListener("blur", save);
    return input;
}

// ------------------------------------------------------------------ subtasks

async function loadSubtasks() {
    const t = cur;
    if (!t) return;
    if (!t.subtasks) { t._subs = []; renderSubtasks(); return; }  // nothing to fetch
    t._subsError = null;
    try {
        const r = await api("GET", qs({ parent: t.id, project: t.project_id, sort: "position", limit: 200 }));
        t._subs = r.items.map(adopt);
        recovered("subtasks");
    } catch (e) {
        t._subsError = e.message;
        failed("subtasks", () => (cur === t ? loadSubtasks() : recovered("subtasks")), e);
    }
    if (cur === t) renderSubtasks();
}

function renderSubtasks() {
    if (!parts.subtasks || !cur) return;
    const t = cur, subs = t._subs || [], ro = !canEdit(t);
    const doneN = subs.filter((s) => s.done).length;
    const input = h("input.tk-dr-addinput", { placeholder: "Add subtask — natural language works", maxlength: 512, "aria-label": "Add subtask" });
    const form = h("form.tk-dr-add", icon("plus", 14), input);
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        try {
            const s = await quickAdd(text, { parent_id: t.id, project_id: t.project_id });
            t._subs = [...subs, s];
            t.subtasks = (t.subtasks || 0) + 1;
            if (S.tasks.some((x) => x.id === t.id) && S.route.scope === "project") S.tasks.push(s);
            renderSubtasks();
            emit("tasks");
            parts.subtasks.querySelector("input")?.focus();
        } catch (err) { toast(err.message, { error: true }); }
    });
    clear(parts.subtasks,
        h("h3.tk-dr-h", "Subtasks", subs.length ? h("span.tk-dr-count", `${doneN}/${subs.length}`) : null),
        subs.length ? h("div.tk-subbar", h("span", { style: { width: `${(doneN / subs.length) * 100}%` } })) : null,
        t._subsError ? h("div.tk-dr-warn", h("span", `Couldn't load ${t.subtasks} subtask${t.subtasks > 1 ? "s" : ""}.`),
            h("button.tk-link-btn", { type: "button", onclick: () => loadSubtasks() }, "Retry"))
            : !t._subs && t.subtasks ? h("div.tk-dr-empty", "Loading subtasks…") : null,
        h("ul.tk-sublist", subs.map((s) => h("li.tk-sub" + (s.done ? ".is-done" : ""),
            h("button.tk-check.p" + prioLevel(s.priority) + (s.done ? ".is-done" : ""), {
                type: "button", role: "checkbox", "aria-checked": String(!!s.done), "aria-label": `Complete ${s.title}`, disabled: !canEdit(s),
                onclick: async () => {
                    await setDone(s, !s.done, { quiet: true }).catch(() => {});
                    t.subtasks_done = (t._subs || []).filter((x) => x.done).length;
                    renderSubtasks();
                    emit("tasks");
                },
            }, icon("check", 12)),
            h("button.tk-sub-title", { type: "button", onclick: () => app.openTask(s.id) }, s.title),
            s.due ? h("span.tk-meta", fmtDay(s.due)) : null))),
        ro ? null : form);
}

// ------------------------------------------------------------------ relations

const KINDS = { related: "Related", blocks: "Blocks", blocked_by: "Blocked by", duplicate_of: "Duplicate of", duplicated_by: "Duplicated by", precedes: "Precedes", follows: "Follows" };

function renderRelations() {
    if (!parts.relations || !cur) return;
    const t = cur, rels = t.relations || [], ro = !canEdit(t);
    const groups = {};
    for (const r of rels) (groups[r.kind] = groups[r.kind] || []).push(r);
    clear(parts.relations,
        h("h3.tk-dr-h", "Relations", rels.length ? h("span.tk-dr-count", String(rels.length)) : null, ro ? null : h("button.tk-link-btn", { type: "button", onclick: (e) => relationPicker(e.currentTarget) }, icon("plus", 12), "Add")),
        rels.length ? Object.entries(groups).map(([kind, items]) => h("div.tk-relgroup", h("div.tk-relkind", KINDS[kind] || kind),
            items.map((r) => h("div.tk-rel" + (r.other_done ? ".is-done" : ""),
                icon(r.other_done ? "done" : "link", 14),
                h("button.tk-sub-title", { type: "button", onclick: () => app.openTask(r.other_id) }, r.other_name),
                ro ? null : h("button.tk-x", {
                    type: "button", "aria-label": "Remove relation",
                    onclick: async () => {
                        try {
                            await api("DELETE", `${t.id}/relations/${r.id}`);
                            t.relations = t.relations.filter((x) => x.id !== r.id);
                            renderRelations();
                        } catch (e) { toast(e.message, { error: true }); }
                    },
                }, icon("x", 12)))))) : h("div.tk-dr-empty", "Link tasks that block, follow or duplicate this one."));
}

function relationPicker(anchor) {
    const t = cur;
    const kind = h("select.form-select.form-select-sm", { "aria-label": "Relation" }, Object.entries(KINDS).map(([k, l]) => h("option", { value: k }, l)));
    const search = h("input.form-control.form-control-sm", { placeholder: "Search tasks", "aria-label": "Search tasks" });
    const list = h("div.tk-menu.tk-menu-scroll");
    let seq = 0;
    const find = async () => {
        const q = search.value.trim(), mine = ++seq;
        if (!q) { clear(list, h("div.tk-menu-head", "Type to search open tasks")); return; }
        try {
            const r = await api("GET", qs({ q, limit: 8 }));
            if (mine !== seq) return;
            const items = r.items.filter((x) => x.id !== t.id);
            clear(list, items.length ? items.map((x) => h("button.tk-menu-item", {
                type: "button", role: "menuitem",
                onclick: async () => {
                    closePopover();
                    try {
                        const rel = await api("POST", `${t.id}/relations`, { other_id: x.id, kind: kind.value });
                        t.relations = [...(t.relations || []).filter((y) => y.id !== rel.id), rel];
                        renderRelations();
                    } catch (e) { toast(e.message, { error: true }); }
                },
            }, icon("link", 14), h("span.tk-menu-label", x.title), h("span.tk-menu-hint", project(x.project_id)?.name || ""))) : h("div.tk-menu-head", "No matching tasks"));
        } catch (_) { /* ignore */ }
    };
    let timer;
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 200); });
    find();
    popover(anchor, h("div.tk-picker", kind, search, list), { className: "tk-pop-picker", align: "end" });
    search.focus();
}

// ------------------------------------------------------------------ comments

function renderComments() {
    if (!parts.comments || !cur) return;
    const t = cur, comments = t._comments || [];
    const box = h("textarea.form-control.form-control-sm.tk-comment-input", { rows: 2, maxlength: 10000, placeholder: "Write a comment…  (Ctrl+Enter to send)", "aria-label": "Comment" });
    const send = h("button.btn.btn-sm.btn-primary", { type: "submit" }, "Comment");
    const form = h("form.tk-comment-form", box, h("div.tk-comment-actions", send));
    const post = async () => {
        const body = box.value.trim();
        if (!body) return;
        send.disabled = true;
        try {
            const c = await api("POST", `${t.id}/comments`, { body });
            t._comments = [...comments, c];
            t.comments = (t.comments || 0) + 1;
            renderComments();
            emit("tasks");
            parts.comments.querySelector("textarea")?.focus();
        } catch (e) { toast(e.message, { error: true }); send.disabled = false; }
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); post(); });
    box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); }
        if (e.key === "Escape") { e.stopPropagation(); box.blur(); }
    });
    clear(parts.comments,
        h("h3.tk-dr-h", "Comments", comments.length ? h("span.tk-dr-count", String(comments.length)) : null),
        t._commentsError ? h("div.tk-dr-warn", h("span", "Couldn't load comments."),
            h("button.tk-link-btn", { type: "button", onclick: () => loadComments(t) }, "Retry"))
            : !t._comments && t.comments ? h("div.tk-dr-empty", "Loading comments…") : null,
        h("ul.tk-comments", comments.map((c) => comment(t, c))),
        form);
}

function comment(t, c) {
    const mine = c.author.username === S.me.username;
    const body = h("div.tk-comment-body", c.body);
    const li = h("li.tk-comment", avatar(c.author),
        h("div.tk-comment-main",
            h("div.tk-comment-head", h("span.tk-comment-author", c.author.name), h("span.app-muted", { title: fmtDateTime(c.created_on) }, ago(c.created_on)),
                c.edited_on ? h("span.app-muted", "· edited") : null,
                mine ? h("span.tk-comment-tools",
                    h("button.tk-link-btn", { type: "button", onclick: () => edit() }, "Edit"),
                    h("button.tk-link-btn.is-danger", {
                        type: "button",
                        onclick: async () => {
                            if (!await confirmDialog("Delete comment", "Delete this comment?")) return;
                            try {
                                await api("DELETE", `comments/${c.id}`);
                                t._comments = t._comments.filter((x) => x.id !== c.id);
                                t.comments = Math.max(0, (t.comments || 1) - 1);
                                renderComments();
                                emit("tasks");
                            } catch (e) { toast(e.message, { error: true }); }
                        },
                    }, "Delete")) : null),
            body));
    const edit = () => {
        const ta = h("textarea.form-control.form-control-sm", { rows: 3, maxlength: 10000, value: c.body, "aria-label": "Edit comment" });
        const save = async () => {
            const v = ta.value.trim();
            if (!v) return;
            try {
                Object.assign(c, await api("PATCH", `comments/${c.id}`, { body: v }));
                renderComments();
            } catch (e) { toast(e.message, { error: true }); }
        };
        ta.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
            if (e.key === "Escape") { e.stopPropagation(); renderComments(); }
        });
        body.replaceWith(h("div.tk-comment-edit", ta, h("div.tk-comment-actions",
            h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: renderComments }, "Cancel"),
            h("button.btn.btn-sm.btn-primary", { type: "button", onclick: save }, "Save"))));
        ta.focus();
    };
    return li;
}
