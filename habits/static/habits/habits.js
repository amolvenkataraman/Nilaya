/* Habits app (habits/index.html): Today checklist, 7-day grid, habit detail. Driven by /api/v2/habits/.
 * "Today" is always the server's date in the user's time zone (boot.today.date), never the browser's. */

import {
    h, $, $$, append, clear, api, icon, toast, menu, popover, closePopover,
    addDays, diffDays, weekdayIdx, fmtLong, fmtShort, fmtFull, fmtWeekday, fmtTime, num, pct, plural, WEEKDAYS,
} from "./lib.js";
import { ring, heatmap, heatLegend, sparkline, weekdayBars, colourVars, initTooltip } from "./charts.js";
import { openEditor, openShortcuts } from "./editor.js";

const boot = JSON.parse($("#hb-boot").textContent);
const S = {
    today: boot.today,          // TodayOut
    overview: null,             // OverviewOut (lazy)
    view: "today",
    detailId: null,
    weekEnd: boot.today.date,
    entries: new Map(),         // "habitId|date" -> entry (week grid)
    archived: null,             // archived habits (lazy)
    showArchived: false,
};
const view = $("#hb-view");
const UNIT = { day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"] };

const habits = () => S.today.habits.map((r) => r.habit);
const rowOf = (id) => S.today.habits.find((r) => r.habit.id === id);
const date = () => S.today.date;

// ------------------------------------------------------------------ text helpers

function scheduleText(hb) {
    if (hb.schedule === "weekdays") {
        if (hb.weekdays === 0b0011111) return "Weekdays";
        if (hb.weekdays === 0b1100000) return "Weekends";
        return WEEKDAYS.filter((_, i) => (hb.weekdays >> i) & 1).join(", ");
    }
    if (hb.schedule === "interval") return hb.interval === 1 ? "Every day" : `Every ${hb.interval} days`;
    return "Every day";
}

function goalText(hb) {
    const unit = hb.kind === "measurable" ? (hb.unit || "units") : "times";
    if (hb.kind === "yesno" && hb.period === "day") return scheduleText(hb);
    const per = { day: "a day", week: "a week", month: "a month" }[hb.period];
    return `${hb.goal === "at_most" ? "At most" : "At least"} ${num(hb.target)} ${unit} ${per}`;
}

function metaText(r) {
    const hb = r.habit;
    if (r.skipped) return "Skipped today";
    const unit = hb.kind === "measurable" ? (hb.unit || "") : "";
    const span = { day: "today", week: "this week", month: "this month" }[hb.period];
    let s;
    if (hb.goal === "at_most") {
        const v = num(r.period_value), lim = num(hb.target);
        if (r.over) s = `Over the limit · ${v} ${unit} ${span}, limit ${lim}`;
        else if (!hb.target) s = r.period_value ? `${v} ${unit} ${span}` : `None ${span} · keep it that way`;
        else s = `${v} of ${lim} ${unit} max ${span}`;
    } else if (hb.kind === "measurable" || hb.period !== "day") {
        s = `${num(r.period_value)} of ${num(r.period_required)} ${unit || "times"} ${hb.period === "day" ? "" : span}`;
    } else {
        s = scheduleText(hb);
    }
    if (hb.paused) s = "Paused";
    return s.replace(/\s+/g, " ").trim();
}

function streakEl(n, unit, big = false) {
    if (!n) return null;
    const label = `${n}-${UNIT[unit][0]} streak`;
    return h("span.hb-streak" + (big ? ".is-big" : ""), { title: label, "aria-label": label },
        icon("flame", big ? 16 : 13), h("b", n), h("span.hb-streak-u", n === 1 ? UNIT[unit][0] : UNIT[unit][1]));
}

function headline(t) {
    if (!S.today.habits.length) return "Build a habit, one day at a time.";
    if (!t.total) return "Nothing due today. Enjoy the day off.";
    if (t.done === t.total) return "All done for today. Nicely kept.";
    if (t.done === 0) return "A fresh day. Start with one.";
    return t.left === 1 ? "One to go." : `${t.left} to go. Steady progress.`;
}

// ------------------------------------------------------------------ data

function recount() {
    const due = S.today.habits.filter((r) => r.due && r.habit.goal === "at_least");
    S.today.total = due.length;
    S.today.done = due.filter((r) => r.done).length;
    S.today.left = S.today.total - S.today.done;
    S.today.over = S.today.habits.filter((r) => r.over).length;
}

function putRow(row) {
    const i = S.today.habits.findIndex((r) => r.habit.id === row.habit.id);
    if (i >= 0) S.today.habits[i] = row;
    recount();
}

async function refreshToday() {
    S.today = await api("GET", "today");
    if (S.today.date !== S.weekEnd && S.view !== "week") S.weekEnd = S.today.date;
}

async function loadOverview() {
    try { S.overview = await api("GET", "overview"); } catch (_) { S.overview = null; }
    renderSummary();
}

function fail(e) { toast(e.message || String(e), { error: true }); }

// ------------------------------------------------------------------ header & summary

function renderHeader() {
    $("#hb-date").textContent = fmtLong(date());
    for (const tab of $$("#hb-tabs [role=tab]")) {
        const on = tab.dataset.view === S.view;
        tab.setAttribute("aria-selected", on);
        tab.tabIndex = on ? 0 : -1;
    }
    $("#hb-tabs").hidden = S.view === "detail";
}

function renderSummary() {
    const box = $("#hb-summary");
    if (S.view === "detail" || !S.today.habits.length) { box.hidden = true; return; }
    box.hidden = false;
    const t = S.today, frac = t.total ? t.done / t.total : 0;
    const best = S.overview?.streaks?.find((r) => r.current > 0);
    clear(box,
        h("div.hb-sum-ring", ring(frac, 56, 5, t.total ? `${t.done}/${t.total}` : "–")),
        h("div.hb-sum-text",
            h("div.hb-sum-title", headline(t)),
            h("div.hb-sum-sub", t.total ? `${t.done} of ${plural(t.total, "habit")} done today` : "No habits due",
                t.over ? h("span.hb-over-note", ` · ${plural(t.over, "limit")} over`) : null)),
        h("div.hb-sum-stats",
            S.overview ? [
                h("div.hb-stat", h("div.hb-stat-v", best ? best.current : "–"),
                    h("div.hb-stat-l", best ? `${UNIT[best.unit][best.current === 1 ? 0 : 1]} · ${best.name}` : "Best current streak")),
                h("div.hb-stat", h("div.hb-stat-v", pct(S.overview.week_rate)), h("div.hb-stat-l", "Last 7 days")),
            ] : [h("div.hb-stat.hb-skel-stat"), h("div.hb-stat.hb-skel-stat")]));
}

// ------------------------------------------------------------------ Today

function mark(r) {
    const hb = r.habit;
    if (hb.kind === "yesno" && hb.period === "day") {
        return h("span.hb-mark" + (r.done ? ".is-done" : "") + (r.skipped ? ".is-skipped" : ""),
            r.done ? icon("check", 20) : (r.skipped ? icon("skip", 16) : (hb.icon ? icon(hb.icon, 18) : null)));
    }
    const req = hb.goal === "at_most" ? (hb.target || 1) : (r.period_required || 1);
    const frac = hb.goal === "at_most" ? Math.min(1, r.period_value / req) : r.period_value / req;
    const label = hb.kind === "yesno" ? `${num(r.period_value)}` : num(r.period_value);
    return h("span.hb-mark.is-ring" + (r.done && hb.goal === "at_least" ? ".is-done" : "") + (r.over ? ".is-over" : ""),
        ring(frac, 44, 4, label.length > 4 ? "" : label));
}

function rowEl(r) {
    const hb = r.habit, measurable = hb.kind === "measurable";
    const tapLabel = measurable ? `Add 1 ${hb.unit || ""} to ${hb.name}` : (r.done ? `Mark ${hb.name} not done` : `Mark ${hb.name} done`);
    const li = h("li.hb-row" + (r.done && hb.goal === "at_least" ? ".is-done" : "") + (r.due ? "" : ".is-off") + (r.over ? ".is-over" : ""),
        { dataset: { id: hb.id }, tabIndex: -1, style: colourVars(hb.colour), "aria-label": hb.name });
    const stepper = measurable && h("div.hb-stepper",
        h("button.hb-step", { type: "button", "aria-label": `Subtract 1 from ${hb.name}`, onclick: () => check(hb.id, { amount: -1 }) }, icon("minus", 14)),
        h("input.hb-step-in", { type: "number", inputmode: "decimal", min: 0, step: "any", value: num(r.value), "aria-label": `${hb.name} today (${hb.unit || "amount"})`,
            onchange: (e) => setToday(hb.id, e.target.value), onkeydown: (e) => { if (e.key === "Enter") e.target.blur(); e.stopPropagation(); } }),
        h("button.hb-step", { type: "button", "aria-label": `Add 1 to ${hb.name}`, onclick: () => check(hb.id, { amount: 1 }) }, icon("plus", 14)));
    append(li, [
        h("button.hb-grip", { type: "button", "aria-label": `Reorder ${hb.name} (Alt + arrow keys)`, tabIndex: -1 }, icon("grip", 14)),
        h("button.hb-tap", { type: "button", "aria-pressed": measurable ? null : String(r.done), "aria-label": tapLabel,
            onclick: () => check(hb.id, measurable ? { amount: 1 } : {}) },
            mark(r),
            h("span.hb-text", h("span.hb-name", hb.name),
                h("span.hb-meta", metaText(r), r.note ? h("span.hb-note", ` · ${r.note}`) : null))),
        streakEl(r.streak, r.streak_unit),
        stepper,
        h("button.hb-icon-btn.hb-open", { type: "button", "aria-label": `${hb.name} details`, onclick: () => go(`habit/${hb.id}`) }, icon("chevR")),
        h("button.hb-icon-btn.hb-more", { type: "button", "aria-label": `More for ${hb.name}`, onclick: (e) => rowMenu(e.currentTarget, r) }, icon("more"))]);
    return li;
}

function renderToday() {
    const rows = S.today.habits;
    if (!rows.length) {
        clear(view, h("div.hb-empty", h("span", "No habits yet. Start with a template."),
            h("button.btn.btn-primary.btn-sm", { type: "button", onclick: newHabit }, "New habit")),
            archivedSection());
        return;
    }
    const due = rows.filter((r) => r.due), off = rows.filter((r) => !r.due);
    const list = (items, label) => h("ul.hb-list", { "aria-label": label, dataset: { group: label } }, items.map(rowEl));
    clear(view,
        due.length ? list(due, "Due today") : h("div.hb-empty", "Nothing due today."),
        off.length ? [h("h2.hb-group", "Not today"), list(off, "Not today")] : null,
        archivedSection());
    for (const ul of $$(".hb-list", view)) enableDrag(ul);
}

function archivedSection() {
    const box = h("div.hb-archived");
    const btn = h("button.hb-link", { type: "button", "aria-expanded": String(S.showArchived), onclick: async () => {
        S.showArchived = !S.showArchived;
        if (S.showArchived && !S.archived) await loadArchived();
        renderToday();
    } }, S.showArchived ? "Hide archived" : "Show archived");
    box.append(btn);
    if (S.showArchived) {
        const items = S.archived || [];
        box.append(items.length ? h("ul.hb-arch-list", items.map((hb) => h("li.hb-arch", { style: colourVars(hb.colour) },
            h("span.hb-dot"), h("button.hb-link.hb-arch-name", { type: "button", onclick: () => go(`habit/${hb.id}`) }, hb.name),
            h("span.hb-meta", goalText(hb)), h("span.hb-grow"),
            h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => setArchived(hb, false) }, "Unarchive"))))
            : h("div.hb-muted", "Nothing archived."));
    }
    return box;
}

async function loadArchived() {
    const all = await api("GET", "?include_archived=true");
    S.archived = all.filter((x) => x.archived);
}

async function check(id, body = {}) {
    const r = rowOf(id);
    const li = $(`.hb-row[data-id="${id}"]`);
    if (r && r.habit.kind === "yesno" && !body.date && li) li.classList.toggle("is-done", !r.done); // optimistic
    try {
        const row = await api("POST", `${id}/check`, body);
        const wasDone = r?.done;
        putRow(row);
        afterChange(id);
        if (!wasDone && row.done && row.habit.goal === "at_least" && row.streak >= 2) {
            const live = $("#hb-live");
            live.textContent = `${row.habit.name} done. ${row.streak}-${UNIT[row.streak_unit][0]} streak.`;
        }
    } catch (e) { fail(e); render(); }
}

async function setToday(id, raw) {
    const r = rowOf(id), v = Number(raw);
    if (!r || raw === "" || Number.isNaN(v) || v < 0) { render(); return; }
    await check(id, { amount: v - r.value });
}

function afterChange(id) {
    if (S.view === "today") {
        const li = $(`.hb-row[data-id="${id}"]`), r = rowOf(id);
        if (li && r) {
            const focused = li.contains(document.activeElement) ? document.activeElement.className : null;
            const fresh = rowEl(r);
            li.replaceWith(fresh);
            if (focused) (fresh.querySelector("." + focused.split(" ")[0]) || fresh).focus();
        }
    }
    renderSummary();
    loadOverview();
}

function rowMenu(anchor, r) {
    const hb = r.habit;
    menu(anchor, [
        { label: "Details", icon: "chevR", hint: "↵", onClick: () => go(`habit/${hb.id}`) },
        { label: "Edit", icon: "edit", hint: "E", onClick: () => editHabit(hb) },
        { label: r.skipped ? "Unskip today" : "Skip today", icon: "skip", hint: "S", onClick: () => skipToday(hb, !r.skipped) },
        { label: r.note ? "Edit today's note" : "Add a note", icon: "note", onClick: () => noteToday(anchor, r) },
        { sep: true },
        { label: hb.paused ? "Resume" : "Pause", icon: hb.paused ? "play" : "pause", onClick: () => setPaused(hb, !hb.paused) },
        { label: "Archive", icon: "archive", onClick: () => setArchived(hb, true) },
    ]);
}

async function saveEntry(hb, day, body) {
    await api("PUT", `entries/${hb.id}/${day}`, body);
    S.entries.set(`${hb.id}|${day}`, { ...(S.entries.get(`${hb.id}|${day}`) || { value: 0, note: "", skipped: false }), ...body });
}

async function skipToday(hb, skipped) {
    try {
        await saveEntry(hb, date(), { skipped });
        await refreshToday();
        render();
        toast(skipped ? `Skipped ${hb.name} today. Your streak is safe.` : `${hb.name} is back on for today.`);
    } catch (e) { fail(e); }
}

function noteToday(anchor, r) {
    const ta = h("textarea.form-control", { rows: 3, maxlength: 500, value: r.note, placeholder: "How did it go?", "aria-label": "Note" });
    const pop = popover(anchor, h("form.hb-pop-form", { onsubmit: async (e) => {
        e.preventDefault();
        try {
            await saveEntry(r.habit, date(), { note: ta.value });
            closePopover();
            await refreshToday();
            render();
        } catch (ex) { fail(ex); }
    } }, h("div.hb-pop-title", `Note · ${r.habit.name} · today`), ta,
        h("div.hb-pop-actions", h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => closePopover() }, "Cancel"),
            h("button.btn.btn-sm.btn-primary", { type: "submit" }, "Save"))));
    ta.focus();
    return pop;
}

async function setPaused(hb, paused) {
    try {
        await api("PATCH", hb.id, { paused });
        await refreshToday();
        render();
        toast(paused ? `${hb.name} paused. No reminders until you resume.` : `${hb.name} resumed. Paused days count as skipped.`);
    } catch (e) { fail(e); }
}

async function setArchived(hb, archived) {
    try {
        await api("POST", `${hb.id}/archive`, { archived });
        S.archived = null;
        if (S.showArchived) await loadArchived();
        await refreshToday();
        if (S.view === "detail" && archived) go("");
        else render();
        loadOverview();
        toast(archived ? `Archived ${hb.name}.` : `${hb.name} is back.`, archived ? { action: "Undo", onAction: () => setArchived(hb, false) } : {});
    } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ drag & keyboard reorder

function enableDrag(ul) {
    for (const grip of $$(".hb-grip", ul)) {
        grip.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const li = grip.closest(".hb-row");
            // Window listeners, not pointer capture: moving the row in the DOM would release a capture.
            li.classList.add("is-dragging");
            ul.classList.add("is-sorting");
            const startY = e.clientY;
            let moved = false;
            const onMove = (ev) => {
                if (Math.abs(ev.clientY - startY) > 3) moved = true;
                const sibs = $$(".hb-row", ul).filter((x) => x !== li);
                const next = sibs.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
                if (next) { if (li.nextElementSibling !== next) ul.insertBefore(li, next); } else if (ul.lastElementChild !== li) ul.append(li);
            };
            const onUp = () => {
                removeEventListener("pointermove", onMove);
                removeEventListener("pointerup", onUp);
                removeEventListener("pointercancel", onUp);
                li.classList.remove("is-dragging");
                ul.classList.remove("is-sorting");
                if (moved) saveOrder();
            };
            addEventListener("pointermove", onMove);
            addEventListener("pointerup", onUp);
            addEventListener("pointercancel", onUp);
        });
    }
}

async function saveOrder() {
    const ids = $$(".hb-row", view).map((li) => li.dataset.id);
    const pos = new Map(ids.map((id, i) => [id, i]));
    S.today.habits.sort((a, b) => pos.get(a.habit.id) - pos.get(b.habit.id));
    S.today.habits.forEach((r, i) => { r.habit.position = i; });
    try { await api("POST", "reorder", { ids }); } catch (e) { fail(e); await refreshToday(); render(); }
}

function moveFocused(dir) {
    const li = document.activeElement?.closest?.(".hb-row");
    if (!li) return;
    const sib = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
    if (!sib) return;
    dir < 0 ? sib.before(li) : sib.after(li);
    li.focus();
    saveOrder();
}

// ------------------------------------------------------------------ Week grid

function cellState(hb, day, e) {
    if (day < hb.start_date || (hb.end_date && day > hb.end_date) || day > date()) return { cls: "is-none", text: "", label: "Not tracked" };
    const scheduled = matchesRule(hb, day);
    if (e?.skipped) return { cls: "is-skip", text: "", label: "Skipped" };
    const v = e?.value || 0;
    if (hb.kind === "yesno") {
        if (v >= 1) return { cls: "is-done", text: "", label: "Done", icon: "check" };
        if (!scheduled || hb.period !== "day") return { cls: "is-off", text: "", label: scheduled ? "Not done" : "Not scheduled" };
        return day === date() ? { cls: "is-pending", label: "Not done yet" } : { cls: "is-miss", label: "Missed" };
    }
    const label = `${num(v)} ${hb.unit || ""}`.trim();
    if (hb.goal === "at_most") {
        const over = hb.period === "day" && v > hb.target;
        return { cls: over ? "is-over" : (v ? "is-part" : "is-kept"), text: v ? num(v) : "", label: over ? `${label}, over the limit` : (v ? label : "Kept (nothing logged)") };
    }
    if (hb.period === "day" && v >= hb.target) return { cls: "is-done", text: num(v), label: `${label}, goal met` };
    if (v > 0) return { cls: "is-part", text: num(v), label, frac: hb.period === "day" ? v / hb.target : 1 };
    if (!scheduled || hb.period !== "day") return { cls: "is-off", label: scheduled ? "Nothing logged" : "Not scheduled" };
    return day === date() ? { cls: "is-pending", label: "Nothing yet" } : { cls: "is-miss", label: "Missed" };
}

function matchesRule(hb, day) {
    if (hb.schedule === "weekdays") return !!((hb.weekdays >> weekdayIdx(day)) & 1);
    if (hb.schedule === "interval") return diffDays(day, hb.start_date) % Math.max(1, hb.interval) === 0;
    return true;
}

async function loadWeek() {
    const start = addDays(S.weekEnd, -6);
    const list = await api("GET", `entries?start=${start}&end=${S.weekEnd}`);
    S.entries = new Map(list.map((e) => [`${e.habit_id}|${e.date}`, e]));
}

function renderWeekSkeleton() {
    clear(view, h("div.hb-skel-grid", { "aria-hidden": "true" }, Array.from({ length: 5 }, () => h("div"))));
}

function renderWeek() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(S.weekEnd, i - 6));
    const atToday = S.weekEnd >= date();
    const nav = h("div.hb-week-nav",
        h("button.hb-icon-btn", { type: "button", "aria-label": "Earlier week", onclick: () => shiftWeek(-7) }, icon("chevL")),
        h("span.hb-week-range", `${fmtShort(days[0])} – ${fmtShort(days[6])}`),
        h("button.hb-icon-btn", { type: "button", "aria-label": "Later week", disabled: atToday, onclick: () => shiftWeek(7) }, icon("chevR")),
        !atToday && h("button.hb-link", { type: "button", onclick: () => { S.weekEnd = date(); showWeek(); } }, "Back to today"),
        h("span.hb-grow"),
        h("span.hb-hint", "Tap to check off · right-click or long-press to edit, skip or add a note"));
    const rows = habits();
    if (!rows.length) { clear(view, nav, h("div.hb-empty", "No habits yet.")); return; }
    const table = h("table.hb-grid",
        h("caption.visually-hidden", `Habits, ${fmtFull(days[0])} to ${fmtFull(days[6])}`),
        h("thead", h("tr", h("th.hb-grid-name", { scope: "col" }, h("span.visually-hidden", "Habit")),
            days.map((d) => h("th" + (d === date() ? ".is-today" : ""), { scope: "col" },
                h("span.hb-grid-wd", fmtWeekday(d)), h("span.hb-grid-d", d.slice(8).replace(/^0/, "")))))),
        h("tbody", rows.map((hb) => h("tr", { style: colourVars(hb.colour), dataset: { id: hb.id } },
            h("th.hb-grid-name", { scope: "row" }, h("button.hb-grid-link", { type: "button", onclick: () => go(`habit/${hb.id}`) },
                h("span.hb-dot"), h("span.hb-grid-title", hb.name))),
            days.map((d) => h("td", weekCell(hb, d)))))));
    clear(view, nav, h("div.hb-grid-wrap", table));
}

function weekCell(hb, day) {
    const e = S.entries.get(`${hb.id}|${day}`);
    const st = cellState(hb, day, e);
    const disabled = st.cls === "is-none";
    const btn = h("button.hb-cell." + st.cls + (day === date() ? ".is-today" : ""), {
        type: "button", disabled, dataset: { id: hb.id, day },
        "aria-label": `${hb.name}, ${fmtFull(day)}: ${st.label}${e?.note ? ". Note: " + e.note : ""}`,
        "data-tip": disabled ? null : `${fmtWeekday(day)} ${fmtShort(day)} · ${st.label}${e?.note ? " · " + e.note : ""}`,
        style: st.frac != null ? { "--f": Math.max(0.15, Math.min(1, st.frac)) } : null,
        onclick: (ev) => cellClick(ev.currentTarget, hb, day),
        oncontextmenu: (ev) => { ev.preventDefault(); if (!disabled) cellEditor(ev.currentTarget, hb, day); },
    }, st.icon ? icon(st.icon, 14) : (st.text || ""), e?.note ? h("span.hb-cell-note", { "aria-hidden": "true" }) : null);
    return btn;
}

async function cellClick(btn, hb, day) {
    if (hb.kind === "measurable") { cellEditor(btn, hb, day); return; }
    const key = `${hb.id}|${day}`, e = S.entries.get(key);
    const nowDone = !(e && !e.skipped && e.value >= 1);
    S.entries.set(key, { ...(e || { note: "" }), value: nowDone ? 1 : 0, skipped: false });
    btn.replaceWith(weekCell(hb, day));
    $(`.hb-cell[data-id="${hb.id}"][data-day="${day}"]`)?.focus();
    try {
        const row = await api("POST", `${hb.id}/check`, { done: nowDone, date: day });
        putRow(row);
        renderSummary();
        loadOverview();
    } catch (ex) { fail(ex); S.entries.set(key, e); showWeek(false); }
}

function cellEditor(anchor, hb, day) {
    const key = `${hb.id}|${day}`, e = S.entries.get(key) || { value: 0, note: "", skipped: false };
    const measurable = hb.kind === "measurable";
    const val = measurable
        ? h("input.form-control.hb-step-in", { type: "number", min: 0, step: "any", value: num(e.value || 0), "aria-label": hb.unit || "Amount" })
        : h("input.form-check-input", { type: "checkbox", checked: e.value >= 1 && !e.skipped, id: "hb-ce-done" });
    const skip = h("input.form-check-input", { type: "checkbox", checked: !!e.skipped, id: "hb-ce-skip" });
    const note = h("textarea.form-control", { rows: 2, maxlength: 500, value: e.note || "", placeholder: "Note (optional)", "aria-label": "Note" });
    const done = async (body) => {
        try {
            if (body === null) {
                await api("DELETE", `entries/${hb.id}/${day}`);
                S.entries.delete(key);
            } else {
                await saveEntry(hb, day, body);
            }
            closePopover();
            await refreshToday();
            S.view === "week" ? showWeek(false) : render();
            if (S.view === "detail") showDetail(hb.id);
            loadOverview();
        } catch (ex) { fail(ex); }
    };
    popover(anchor, h("form.hb-pop-form", { onsubmit: (ev) => {
        ev.preventDefault();
        const v = measurable ? Number(val.value || 0) : (val.checked ? 1 : 0);
        done({ value: v, skipped: skip.checked, note: note.value });
    } },
        h("div.hb-pop-title", `${hb.name} · ${fmtWeekday(day)} ${fmtShort(day)}`),
        measurable ? h("label.hb-pop-row", h("span", `Amount${hb.unit ? ` (${hb.unit})` : ""}`), val)
            : h("label.hb-pop-row.hb-check", val, h("span", "Done")),
        h("label.hb-pop-row.hb-check", skip, h("span", "Skip this day (keeps the streak)")),
        note,
        h("div.hb-pop-actions",
            h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => done(null) }, "Clear"),
            h("span.hb-grow"),
            h("button.btn.btn-sm.btn-primary", { type: "submit" }, "Save"))));
    (measurable ? val : note).focus();
}

async function shiftWeek(n) {
    const next = addDays(S.weekEnd, n);
    S.weekEnd = next > date() ? date() : next;
    showWeek();
}

async function showWeek(skeleton = true) {
    if (skeleton) renderWeekSkeleton();
    try { await loadWeek(); } catch (e) { fail(e); }
    if (S.view === "week") renderWeek();
}

// ------------------------------------------------------------------ Detail

function detailSkeleton() {
    clear(view, h("div.hb-detail", { "aria-busy": "true" },
        h("div.hb-skel-line.w40"), h("div.hb-tiles", Array.from({ length: 4 }, () => h("div.hb-tile.hb-skel-tile"))),
        h("div.hb-card.hb-skel-card"), h("div.hb-card.hb-skel-card")));
}

async function showDetail(id) {
    let hb = habits().find((x) => x.id === id) || S.archived?.find((x) => x.id === id);
    if (!view.querySelector(".hb-detail:not([aria-busy])")) detailSkeleton();
    try {
        const [stats, fetched] = await Promise.all([api("GET", `${id}/stats`), hb ? null : api("GET", id)]);
        hb = hb || fetched;
        if (S.view === "detail" && S.detailId === id) renderDetail(hb, stats);
    } catch (e) {
        if (e.status === 404) { toast("That habit isn't here any more.", { error: true }); go(""); } else fail(e);
    }
}

function tile(label, value, sub) {
    return h("div.hb-tile", h("div.hb-tile-l", label), h("div.hb-tile-v", value), sub ? h("div.hb-tile-s", sub) : null);
}

function renderDetail(hb, st) {
    const r = rowOf(hb.id);
    const unitWord = (n) => UNIT[st.streak_unit][n === 1 ? 0 : 1];
    const measurable = hb.kind === "measurable";
    const facts = [goalText(hb), hb.period !== "day" || hb.kind === "measurable" ? scheduleText(hb) : null,
        hb.reminder_time ? `Reminder ${fmtTime(hb.reminder_time)}` : null, `Since ${fmtFull(hb.start_date)}`,
        hb.end_date ? `until ${fmtFull(hb.end_date)}` : null, hb.paused ? "Paused" : null, hb.archived ? "Archived" : null].filter(Boolean);
    const span = { day: "today", week: "this week", month: "this month" }[hb.period];

    const heatBox = h("div.hb-heat-wrap", heatmap(st, hb));
    const rates = [["7 days", st.rates.d7], ["30 days", st.rates.d30], ["90 days", st.rates.d90], ["All time", st.rates.all]];

    clear(view, h("div.hb-detail", { style: colourVars(hb.colour) },
        h("div.hb-detail-top",
            h("button.hb-link.hb-back", { type: "button", onclick: () => history.length > 1 && location.hash ? history.back() : go("") }, icon("chevL", 14), "All habits"),
            h("span.hb-grow"),
            r && !hb.archived && h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => check(hb.id, measurable ? { amount: 1 } : {}).then(() => showDetail(hb.id)) },
                measurable ? `+1 ${hb.unit || ""}`.trim() : (r.done ? "Undo today" : "Check off today")),
            h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => editHabit(hb) }, icon("edit", 14), " Edit"),
            h("button.hb-icon-btn", { type: "button", "aria-label": "More", onclick: (e) => menu(e.currentTarget, [
                { label: hb.paused ? "Resume" : "Pause", icon: hb.paused ? "play" : "pause", onClick: () => setPaused(hb, !hb.paused).then(() => showDetail(hb.id)) },
                { label: hb.archived ? "Unarchive" : "Archive", icon: "archive", onClick: () => setArchived(hb, !hb.archived) },
                { sep: true },
                { label: "Delete…", icon: "trash", danger: true, onClick: () => deleteHabit(hb) },
            ]) }, icon("more"))),
        h("header.hb-detail-head",
            h("span.hb-detail-mark", hb.icon ? icon(hb.icon, 20) : h("span.hb-dot.is-lg")),
            h("div", h("h2.hb-detail-name", hb.name), h("div.hb-detail-facts", facts.join(" · ")))),
        hb.description ? h("p.hb-detail-desc", hb.description) : null,
        h("div.hb-tiles",
            tile("Current streak", h("span.hb-streak.is-big", icon("flame", 18), h("b", st.current_streak)), unitWord(st.current_streak)),
            tile("Best streak", String(st.best_streak), unitWord(st.best_streak)),
            tile("Score", String(Math.round(st.score)), "Habit strength, 0–100"),
            tile(hb.goal === "at_most" ? `Logged ${span}` : `Progress ${span}`, `${num(st.period_value)}`,
                `${hb.goal === "at_most" ? "limit" : "of"} ${num(st.period_required)} ${measurable ? hb.unit || "" : "times"}`)),
        h("section.hb-card",
            h("div.hb-card-head", h("h3", "Last 12 months"), heatLegend()),
            heatBox),
        h("div.hb-cols",
            h("section.hb-card",
                h("div.hb-card-head", h("h3", "Completion")),
                h("div.hb-rates", rates.map(([l, v]) => h("div.hb-rate",
                    h("div.hb-rate-top", h("span", l), h("b", pct(v))),
                    h("div.hb-meter", { role: "meter", "aria-label": `${l} completion`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": v == null ? 0 : Math.round(v * 100) },
                        h("span", { style: { width: `${Math.round((v || 0) * 100)}%` } })))))),
            h("section.hb-card",
                h("div.hb-card-head", h("h3", "Score trend"), h("span.hb-muted", "26 weeks")),
                sparkline(st.score_trend))),
        h("div.hb-cols",
            h("section.hb-card",
                h("div.hb-card-head", h("h3", hb.period === "day" ? "By weekday" : "Days logged by weekday"),
                    h("span.hb-muted", hb.period === "day" ? "% at goal" : "count")),
                weekdayBars(st.weekdays, hb)),
            h("section.hb-card",
                h("div.hb-card-head", h("h3", measurable ? "Totals" : "Days done")),
                measurable ? h("dl.hb-totals",
                    h("dt", "This week"), h("dd", `${num(st.totals.week)} ${hb.unit}`),
                    h("dt", "This month"), h("dd", `${num(st.totals.month)} ${hb.unit}`),
                    h("dt", "All time"), h("dd", `${num(st.totals.total)} ${hb.unit}`),
                    h("dt", "Average logged day"), h("dd", st.totals.average == null ? "–" : `${num(st.totals.average)} ${hb.unit}`),
                    h("dt", "Best day"), h("dd", st.totals.best == null ? "–" : `${num(st.totals.best)} ${hb.unit}`))
                    : h("dl.hb-totals",
                        h("dt", "This week"), h("dd", String(st.totals.week)),
                        h("dt", "This month"), h("dd", String(st.totals.month)),
                        h("dt", "All time"), h("dd", String(st.totals.total))))),
        h("section.hb-card",
            h("div.hb-card-head", h("h3", "Notes")),
            st.notes.length ? h("ul.hb-notes", st.notes.map((n) => h("li",
                h("button.hb-link.hb-note-date", { type: "button", onclick: (e) => cellEditor(e.currentTarget, hb, n.date) }, fmtFull(n.date)),
                h("span.hb-note-text", n.note)))) : h("div.hb-muted", "No notes yet. Add one from Today or the week grid."))));
    // Show the most recent weeks first on narrow screens.
    requestAnimationFrame(() => { heatBox.scrollLeft = heatBox.scrollWidth; });
}

// ------------------------------------------------------------------ create / edit / delete

async function newHabit() {
    const saved = await openEditor({ today: date() });
    if (saved && typeof saved === "object") {
        await refreshToday();
        loadOverview();
        render();
        toast(`Created ${saved.name}.`);
        $(`.hb-row[data-id="${saved.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
}

async function editHabit(hb) {
    const saved = await openEditor({ habit: hb, today: date(),
        onArchive: () => setArchived(hb, !hb.archived), onDelete: () => deleteHabit(hb, true) });
    if (saved && typeof saved === "object") {
        await refreshToday();
        S.archived = null;
        render();
        loadOverview();
    }
}

async function deleteHabit(hb, confirmed = false) {
    if (!confirmed && !confirm(`Delete “${hb.name}” and all its history? This can't be undone.`)) return;
    try {
        await api("DELETE", hb.id);
        S.archived = null;
        await refreshToday();
        toast(`Deleted ${hb.name}.`);
        S.view === "detail" ? go("") : render();
        loadOverview();
    } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ routing & render

function go(hash) {
    if (("#" + hash) === location.hash || (!hash && !location.hash)) route();
    else location.hash = hash;
}

function route() {
    closePopover();
    const hsh = location.hash.slice(1);
    const m = hsh.match(/^habit\/([0-9a-f-]{36})$/);
    S.view = m ? "detail" : (hsh === "week" ? "week" : "today");
    S.detailId = m ? m[1] : null;
    renderHeader();
    renderSummary();
    if (S.view === "week") showWeek();
    else if (S.view === "detail") { detailSkeleton(); showDetail(S.detailId); }
    else renderToday();
    if (S.view !== "detail") view.scrollTop = 0;
}

function render() {
    renderHeader();
    renderSummary();
    if (S.view === "week") renderWeek();
    else if (S.view === "today") renderToday();
}

// ------------------------------------------------------------------ keyboard

function focusRow(delta) {
    const rows = $$(".hb-row", view);
    if (!rows.length) return;
    const cur = rows.indexOf(document.activeElement?.closest?.(".hb-row"));
    const next = rows[Math.max(0, Math.min(rows.length - 1, cur < 0 ? 0 : cur + delta))];
    next.focus();
    next.scrollIntoView({ block: "nearest" });
}

document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    if ($("#hb-editor").open) return;
    const t = e.target;
    if (t.closest?.("input, textarea, select, [contenteditable], .hb-pop")) return;
    const li = t.closest?.(".hb-row");
    const r = li ? rowOf(li.dataset.id) : null;
    if (e.altKey && li && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); moveFocused(e.key === "ArrowUp" ? -1 : 1); return; }
    if (e.altKey) return;
    const k = e.key;
    if (k === "?") { openShortcuts(); return; }
    if (k === "n" || k === "N") { e.preventDefault(); newHabit(); return; }
    if (k === "t") { go(""); return; }
    if (k === "w") { go("week"); return; }
    if (k === "Escape" && S.view === "detail") { go(""); return; }
    if (S.view !== "today") return;
    if (k === "j" || k === "ArrowDown") { e.preventDefault(); focusRow(1); return; }
    if (k === "k" || k === "ArrowUp") { e.preventDefault(); focusRow(-1); return; }
    if (!r) return;
    const measurable = r.habit.kind === "measurable";
    if ((k === " " || k === "x") && t === li) { e.preventDefault(); check(r.habit.id, measurable ? { amount: 1 } : {}); }
    else if ((k === "+" || k === "=") && measurable) check(r.habit.id, { amount: 1 });
    else if ((k === "-" || k === "_") && measurable) check(r.habit.id, { amount: -1 });
    else if (k === "s") skipToday(r.habit, !r.skipped);
    else if (k === "e") editHabit(r.habit);
    else if (k === "Enter" && t === li) go(`habit/${r.habit.id}`);
});

// ------------------------------------------------------------------ boot

$("#hb-new").addEventListener("click", newHabit);
$("#hb-help").addEventListener("click", openShortcuts);
for (const tab of $$("#hb-tabs [role=tab]")) {
    tab.addEventListener("click", () => go(tab.dataset.view === "today" ? "" : tab.dataset.view));
    tab.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const other = $$("#hb-tabs [role=tab]").find((x) => x !== tab); other.focus(); other.click(); }
    });
}
addEventListener("hashchange", route);
// Coming back to the tab after midnight (user's zone): reload today from the server.
document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    const before = date();
    try { await refreshToday(); } catch (_) { return; }
    if (S.today.date !== before) { S.weekEnd = S.today.date; route(); } else if (S.view !== "detail") render();
});
initTooltip();
route();
loadOverview();
