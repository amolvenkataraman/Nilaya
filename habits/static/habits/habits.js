/* Habits app (habits/index.html): Today checklist, 7-day grid, habit detail. Driven by /api/v2/habits/.
 * "Today" is always the server's date in the user's time zone (boot.today.date), never the browser's.
 *
 * Requests are lean on purpose:
 * - Today (with the 7-day rate) is embedded in the page: loading costs no API request.
 * - A tap is one request; its response (the habit's Today row) updates the list, summary, week grid
 *   and an open detail locally. Nothing is refetched after a tap, and nothing polls.
 * - The week grid and stats are cached per week / habit and only fetched when opened (stats again
 *   only after that habit changed). GETs revalidate with ETags, so unchanged data comes back as 304.
 * - When the server can't be reached, whatever is loaded stays on screen, a small banner offers
 *   Retry, and reads retry with backoff (2 s, 5 s, 15 s, then every 30 s while the tab is visible). */

import {
    h, $, $$, append, clear, api, icon, toast, menu, popover, closePopover,
    addDays, diffDays, weekdayIdx, fmtLong, fmtShort, fmtFull, fmtWeekday, fmtTime, num, pct, plural, WEEKDAYS,
} from "./lib.js";
import { ring, heatmap, heatLegend, sparkline, weekdayBars, colourVars, initTooltip } from "./charts.js";
import { openEditor, openShortcuts } from "./editor.js";

const boot = JSON.parse($("#hb-boot").textContent);
const S = {
    today: boot.today,          // TodayOut
    view: "today",
    detailId: null,
    weekEnd: boot.today.date,
    entries: new Map(),         // the shown week: "habitId|date" -> entry
    archived: null,             // archived habits (lazy)
    showArchived: false,
};
const weeks = new Map();        // weekEnd -> {entries: Map, saved: bool (from sessionStorage), stale: bool}
const statsCache = new Map();   // habitId -> {stats, stale: bool, saved: bool}
const view = $("#hb-view");
const UNIT = { day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"] };

const habits = () => S.today.habits.map((r) => r.habit);
const rowOf = (id) => S.today.habits.find((r) => r.habit.id === id);
const date = () => S.today.date;

// ------------------------------------------------------------------ network state, retries, banner

const NET = { down: false, signedOut: false, attempt: 0, timer: 0, busy: false, retry: new Map(), hiddenAt: 0 };
const BACKOFF = [2000, 5000, 15000, 30000];
const isNetErr = (e) => !e.status || e.status >= 500 || e.status === 429;

/** Every request goes through here: it tracks reachability for the banner. */
async function call(method, path, body) {
    try {
        const out = await api(method, path, body);
        if (NET.down || NET.signedOut) netUp();
        return out;
    } catch (e) {
        if (e.status === 401) { NET.signedOut = true; renderBanner(); }
        else if (isNetErr(e)) netDown();
        throw e;
    }
}

/** A read that failed for connectivity: remember how to redo it, retry with backoff. */
function retryLater(key, fn) {
    NET.retry.set(key, fn);
    netDown();
}

function netDown() {
    if (!NET.down) { NET.down = true; NET.attempt = 0; }
    renderBanner();
    if (!NET.timer && !NET.busy) schedule();   // one pending retry at a time
}

function netUp() {
    NET.down = false; NET.signedOut = false; NET.attempt = 0;
    clearTimeout(NET.timer);
    NET.timer = 0;
    renderBanner();
}

function schedule() {
    clearTimeout(NET.timer);
    NET.timer = 0;
    if (!NET.down || document.visibilityState !== "visible") return;
    NET.timer = setTimeout(() => { NET.timer = 0; retryNow(); }, BACKOFF[Math.min(NET.attempt, BACKOFF.length - 1)]);
    NET.attempt++;
}

async function retryNow() {
    if (NET.busy) return;
    clearTimeout(NET.timer);
    NET.timer = 0;
    NET.busy = true;
    renderBanner();
    const jobs = NET.retry.size ? [...NET.retry.entries()] : [["today", refreshToday]];
    let ok = true;
    for (const [key, fn] of jobs) {
        try { await fn(); NET.retry.delete(key); } catch (e) { ok = false; if (!isNetErr(e)) NET.retry.delete(key); break; }
    }
    NET.busy = false;
    if (ok) { netUp(); repaint(); } else { renderBanner(); schedule(); }
}

function renderBanner() {
    const b = $("#hb-banner");
    if (!NET.down && !NET.signedOut) { b.hidden = true; return; }
    const saved = [...weeks.values(), ...statsCache.values()].some((x) => x.saved);
    b.hidden = false;
    clear(b, NET.signedOut
        ? [h("span", "You're signed out."), h("button.hb-banner-btn", { type: "button", onclick: () => location.reload() }, "Sign in again")]
        : [h("span", "Couldn't refresh · showing what's loaded" + (saved ? " (some from a saved copy)" : "")),
            h("button.hb-banner-btn", { type: "button", disabled: NET.busy, onclick: retryNow }, NET.busy ? "Retrying…" : "Retry")]);
}

function fail(e) {
    toast(isNetErr(e) ? "Couldn't reach the server. Nothing was changed." : (e.message || String(e)), { error: true });
}

// ------------------------------------------------------------------ saved copy (sessionStorage)

const SAVE_KEY = `hb:${boot.me.username}`;
function persist() {
    try {
        const out = { date: date(), weeks: {}, stats: {} };
        for (const [k, w] of weeks) out.weeks[k] = [...w.entries.values()];
        for (const [k, c] of statsCache) out.stats[k] = c.stats;
        sessionStorage.setItem(SAVE_KEY, JSON.stringify(out));
    } catch (_) { /* storage full or blocked: the copy is optional */ }
}
function restore() {
    try {
        const s = JSON.parse(sessionStorage.getItem(SAVE_KEY) || "null");
        if (!s || s.date !== date()) return;
        for (const [k, list] of Object.entries(s.weeks || {})) weeks.set(k, { entries: entryMap(list), saved: true, stale: true });
        for (const [k, st] of Object.entries(s.stats || {})) statsCache.set(k, { stats: st, stale: true, saved: true });
    } catch (_) { /* no copy */ }
}
const entryMap = (list) => new Map(list.map((e) => [`${e.habit_id}|${e.date}`, e]));
let persistTimer;
const persistSoon = () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 400); };

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
    if (hb.paused) return "Paused";
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
        if (hb.period !== "day" && r.done_today && !r.done) s += " · done today";
    } else {
        s = scheduleText(hb);
    }
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

// ------------------------------------------------------------------ local state updates

function recount() {
    const due = S.today.habits.filter((r) => r.due && r.habit.goal === "at_least");
    S.today.total = due.length;
    S.today.done = due.filter((r) => r.done).length;
    S.today.left = S.today.total - S.today.done;
    S.today.over = S.today.habits.filter((r) => r.over).length;
}

// How a habit's current day/period counts in the 7-day rate: met (1,1), missed (1,0), open (0,0).
const unitScore = (r) => (r.goal_met ? [1, 1] : r.over ? [1, 0] : [0, 0]);

/** Apply a habit's fresh Today row (from a check or a save) everywhere it shows. No requests. */
function applyRow(row) {
    const i = S.today.habits.findIndex((r) => r.habit.id === row.habit.id);
    if (i < 0) return;
    const [d0, j0] = unitScore(S.today.habits[i]), [d1, j1] = unitScore(row);
    S.today.week_done += d1 - d0;
    S.today.week_judged += j1 - j0;
    S.today.habits[i] = row;
    recount();
    setEntry(row.habit.id, date(), { value: row.value, skipped: row.skipped, note: row.note });
    const c = statsCache.get(row.habit.id);
    if (c) { patchStats(c.stats, row); c.stale = true; }
}

/** Keep every cached week in step with a saved day. */
function setEntry(id, day, e) {
    const key = `${id}|${day}`;
    for (const w of weeks.values()) {
        if (!e || (!e.value && !e.skipped && !e.note)) w.entries.delete(key);
        else w.entries.set(key, { habit_id: id, date: day, value: e.value || 0, note: e.note || "", skipped: !!e.skipped });
    }
    persistSoon();
}

/** A past day's contribution to the 7-day rate (daily goals only; the server's rules). */
function pastScore(hb, day, e) {
    if (hb.period !== "day" || day === date() || diffDays(date(), day) > 6 || day < hb.start_date) return [0, 0];
    if (e?.skipped) return [0, 0];
    const v = e?.value || 0, meets = hb.goal === "at_most" ? v <= hb.target : v >= hb.target;
    if (!matchesRule(hb, day)) return meets && hb.goal === "at_least" && e ? [1, 1] : [0, 0];
    return meets ? [1, 1] : [1, 0];
}
function applyPast(hb, day, before, after) {
    const [d0, j0] = pastScore(hb, day, before), [d1, j1] = pastScore(hb, day, after);
    S.today.week_done += d1 - d0;
    S.today.week_judged += j1 - j0;
    const c = statsCache.get(hb.id);
    if (c) c.stale = true;
}

/** Bring an open detail's cached stats in line with today's row (score and rates refresh on next open). */
function patchStats(st, row) {
    const hb = row.habit;
    st.current_streak = row.streak;
    st.best_streak = Math.max(st.best_streak, row.streak);
    st.period_value = row.period_value;
    st.period_required = row.period_required;
    const i = diffDays(date(), st.heatmap.start);
    if (i < 0 || i >= st.heatmap.levels.length || st.heatmap.levels[i] === "-") return;
    let ch;
    if (row.skipped) ch = "s";
    else if (hb.goal === "at_most") ch = row.over ? "0" : "4";
    else if (row.done_today || (hb.period === "day" && row.goal_met)) ch = "4";
    else if (hb.kind === "measurable" && row.value > 0 && hb.period === "day") ch = String(Math.min(3, Math.floor((row.value / hb.target) * 4)));
    else ch = matchesRule(hb, date()) ? "0" : "o";
    st.heatmap.levels = st.heatmap.levels.slice(0, i) + ch + st.heatmap.levels.slice(i + 1);
    st.heatmap.values[i] = row.value > 0 && !row.skipped ? row.value : null;
}

async function refreshToday() {
    const before = date();
    S.today = await call("GET", "today");
    if (S.today.date !== before) {           // a new day (user's zone): cached weeks and stats are stale
        weeks.clear(); statsCache.clear();
        S.weekEnd = S.today.date;
    }
}

/** Rare structural changes (create, edit, pause, archive, delete): one more GET (often a 304). */
async function reloadToday() {
    try { await refreshToday(); } catch (e) { if (isNetErr(e)) retryLater("today", refreshToday); }
}

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
    const best = [...t.habits].sort((a, b) => b.streak - a.streak || (a.habit.goal === "at_least" ? -1 : 1))[0];
    const rate = t.week_judged ? t.week_done / t.week_judged : null;
    clear(box,
        h("div.hb-sum-ring", ring(frac, 56, 5, t.total ? `${t.done}/${t.total}` : "–")),
        h("div.hb-sum-text",
            h("div.hb-sum-title", headline(t)),
            h("div.hb-sum-sub", t.total ? `${t.done} of ${plural(t.total, "habit")} done today` : "No habits due",
                t.over ? h("span.hb-over-note", ` · ${plural(t.over, "limit")} over`) : null)),
        h("div.hb-sum-stats",
            h("div.hb-stat", h("div.hb-stat-v", best?.streak ? best.streak : "–"),
                h("div.hb-stat-l", best?.streak ? `${UNIT[best.streak_unit][best.streak === 1 ? 0 : 1]} · ${best.habit.name}` : "Best current streak")),
            h("div.hb-stat", h("div.hb-stat-v", pct(rate)), h("div.hb-stat-l", "Last 7 days"))));
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
    const label = num(r.period_value);
    return h("span.hb-mark.is-ring" + (r.done ? ".is-done" : "") + (r.over ? ".is-over" : "") + (r.done_today && !r.done ? ".is-today" : ""),
        ring(frac, 44, 4, label.length > 4 ? "" : label));
}

function rowEl(r) {
    const hb = r.habit, measurable = hb.kind === "measurable";
    const ticked = hb.kind === "yesno" && r.done_today;
    const tapLabel = measurable ? `Add 1 ${hb.unit || ""} to ${hb.name}` : (ticked ? `Undo ${hb.name} today` : `Mark ${hb.name} done today`);
    const li = h("li.hb-row" + (r.done ? ".is-done" : "") + (r.due ? "" : ".is-off") + (r.over ? ".is-over" : ""),
        { dataset: { id: hb.id }, tabIndex: -1, style: colourVars(hb.colour), "aria-label": hb.name });
    const stepper = measurable && h("div.hb-stepper",
        h("button.hb-step", { type: "button", "aria-label": `Subtract 1 from ${hb.name}`, onclick: () => check(hb.id, { amount: -1 }) }, icon("minus", 14)),
        h("input.hb-step-in", { type: "number", inputmode: "decimal", min: 0, step: "any", value: num(r.value), "aria-label": `${hb.name} today (${hb.unit || "amount"})`,
            onchange: (e) => setToday(hb.id, e.target.value), onkeydown: (e) => { if (e.key === "Enter") e.target.blur(); e.stopPropagation(); } }),
        h("button.hb-step", { type: "button", "aria-label": `Add 1 to ${hb.name}`, onclick: () => check(hb.id, { amount: 1 }) }, icon("plus", 14)));
    append(li, [
        h("button.hb-grip", { type: "button", "aria-label": `Reorder ${hb.name} (Alt + arrow keys)`, tabIndex: -1 }, icon("grip", 14)),
        h("button.hb-tap", { type: "button", "aria-pressed": measurable ? null : String(ticked), "aria-label": tapLabel,
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
    box.append(h("button.hb-link", { type: "button", "aria-expanded": String(S.showArchived), onclick: async () => {
        S.showArchived = !S.showArchived;
        if (S.showArchived && !S.archived) {
            try { await loadArchived(); } catch (e) { S.showArchived = false; fail(e); }
        }
        renderToday();
    } }, S.showArchived ? "Hide archived" : "Show archived"));
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
    const all = await call("GET", "?include_archived=true");
    S.archived = all.filter((x) => x.archived);
}

/** One request; the response row updates everything locally. A failure rolls back the optimistic tick. */
async function check(id, body = {}) {
    const r = rowOf(id);
    const li = $(`.hb-row[data-id="${id}"]`);
    if (r && r.habit.kind === "yesno" && li) {               // optimistic: flip the mark at once
        const mk = li.querySelector(".hb-mark:not(.is-ring)");
        if (mk) mk.classList.toggle("is-done", !r.done_today);
    }
    try {
        const row = await call("POST", `${id}/check`, body);
        const wasDone = r?.done;
        applyRow(row);
        repaintHabit(id);
        if (!wasDone && row.done && row.streak >= 2) {
            $("#hb-live").textContent = `${row.habit.name} done. ${row.streak}-${UNIT[row.streak_unit][0]} streak.`;
        }
    } catch (e) {
        fail(e);
        repaintHabit(id);                                     // back to the last known state
    }
}

async function setToday(id, raw) {
    const r = rowOf(id), v = Number(raw);
    if (!r || raw === "" || Number.isNaN(v) || v < 0) { repaintHabit(id); return; }
    await check(id, { amount: v - r.value });
}

/** Re-render just what shows one habit (row or grid row or detail) plus the summary. */
function repaintHabit(id) {
    renderSummary();
    if (S.view === "today") {
        const li = $(`.hb-row[data-id="${id}"]`), r = rowOf(id);
        if (li && r) {
            const focused = li.contains(document.activeElement) ? document.activeElement.className.split(" ")[0] : null;
            const fresh = rowEl(r);
            li.replaceWith(fresh);
            if (focused) (fresh.querySelector("." + focused) || fresh).focus();
        }
    } else if (S.view === "week") {
        const tr = $(`.hb-grid tr[data-id="${id}"]`), hb = rowOf(id)?.habit;
        if (tr && hb) tr.replaceWith(weekRow(hb, weekDays()));
    } else if (S.view === "detail" && S.detailId === id) {
        const c = statsCache.get(id), hb = rowOf(id)?.habit;
        if (c && hb) renderDetail(hb, c.stats);
    }
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

/** PUT one day: one request; the response carries the habit's Today row. */
async function saveDay(hb, day, body) {
    const key = `${hb.id}|${day}`;
    const before = S.entries.get(key) || [...weeks.values()].map((w) => w.entries.get(key)).find(Boolean);
    const saved = await call("PUT", `entries/${hb.id}/${day}`, body);
    if (day !== date()) {
        setEntry(hb.id, day, saved);
        applyPast(hb, day, before, saved);
    }
    applyRow(saved.today);
    return saved;
}

async function skipToday(hb, skipped) {
    try {
        await saveDay(hb, date(), { skipped });
        repaintHabit(hb.id);
        toast(skipped ? `Skipped ${hb.name} today. Your streak is safe.` : `${hb.name} is back on for today.`);
    } catch (e) { fail(e); }
}

function noteToday(anchor, r) {
    const ta = h("textarea.form-control", { rows: 3, maxlength: 500, value: r.note, placeholder: "How did it go?", "aria-label": "Note" });
    popover(anchor, h("form.hb-pop-form", { onsubmit: async (e) => {
        e.preventDefault();
        try {
            await saveDay(r.habit, date(), { note: ta.value });
            closePopover();
            repaintHabit(r.habit.id);
        } catch (ex) { fail(ex); }
    } }, h("div.hb-pop-title", `Note · ${r.habit.name} · today`), ta,
        h("div.hb-pop-actions", h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => closePopover() }, "Cancel"),
            h("button.btn.btn-sm.btn-primary", { type: "submit" }, "Save"))));
    ta.focus();
}

async function setPaused(hb, paused) {
    try {
        await call("PATCH", hb.id, { paused });
        statsCache.delete(hb.id);
        await reloadToday();
        repaint();
        toast(paused ? `${hb.name} paused. No reminders until you resume.` : `${hb.name} resumed. Paused days count as skipped.`);
    } catch (e) { fail(e); }
}

async function setArchived(hb, archived) {
    try {
        await call("POST", `${hb.id}/archive`, { archived });
        S.archived = null;
        if (S.showArchived) await loadArchived().catch(() => {});
        await reloadToday();
        if (S.view === "detail" && archived) go(""); else repaint();
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
    const prev = S.today.habits.slice();
    const pos = new Map(ids.map((id, i) => [id, i]));
    S.today.habits.sort((a, b) => pos.get(a.habit.id) - pos.get(b.habit.id));
    S.today.habits.forEach((r, i) => { r.habit.position = i; });
    try { await call("POST", "reorder", { ids }); } catch (e) { fail(e); S.today.habits = prev; renderToday(); }
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

function matchesRule(hb, day) {
    if (hb.schedule === "weekdays") return !!((hb.weekdays >> weekdayIdx(day)) & 1);
    if (hb.schedule === "interval") return diffDays(day, hb.start_date) % Math.max(1, hb.interval) === 0;
    return true;
}

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

const weekDays = () => Array.from({ length: 7 }, (_, i) => addDays(S.weekEnd, i - 6));

async function loadWeek(end) {
    const list = await call("GET", `entries?start=${addDays(end, -6)}&end=${end}`);
    weeks.set(end, { entries: entryMap(list), saved: false, stale: false });
    persistSoon();
}

function weekRow(hb, days) {
    return h("tr", { style: colourVars(hb.colour), dataset: { id: hb.id } },
        h("th.hb-grid-name", { scope: "row" }, h("button.hb-grid-link", { type: "button", onclick: () => go(`habit/${hb.id}`) },
            h("span.hb-dot"), h("span.hb-grid-title", hb.name))),
        days.map((d) => h("td", weekCell(hb, d))));
}

function renderWeek(state = "ok") {
    const days = weekDays();
    const atToday = S.weekEnd >= date();
    const w = weeks.get(S.weekEnd);
    S.entries = w ? w.entries : new Map();
    const nav = h("div.hb-week-nav",
        h("button.hb-icon-btn", { type: "button", "aria-label": "Earlier week", onclick: () => shiftWeek(-7) }, icon("chevL")),
        h("span.hb-week-range", `${fmtShort(days[0])} – ${fmtShort(days[6])}`),
        h("button.hb-icon-btn", { type: "button", "aria-label": "Later week", disabled: atToday, onclick: () => shiftWeek(7) }, icon("chevR")),
        !atToday && h("button.hb-link", { type: "button", onclick: () => { S.weekEnd = date(); showWeek(); } }, "Back to today"),
        w?.saved && h("span.hb-saved", "Saved copy"),
        h("span.hb-grow"),
        h("span.hb-hint", "Tap to check off · right-click or long-press to edit, skip or add a note"));
    const rows = habits();
    if (!rows.length) { clear(view, nav, h("div.hb-empty", "No habits yet.")); return; }
    if (!w) {
        clear(view, nav, state === "loading"
            ? h("div.hb-skel-grid", { "aria-hidden": "true" }, Array.from({ length: Math.min(rows.length, 6) }, () => h("div")))
            : h("div.hb-empty", "Couldn't load this week.", h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => showWeek() }, "Retry")));
        return;
    }
    const table = h("table.hb-grid",
        h("caption.visually-hidden", `Habits, ${fmtFull(days[0])} to ${fmtFull(days[6])}`),
        h("thead", h("tr", h("th.hb-grid-name", { scope: "col" }, h("span.visually-hidden", "Habit")),
            days.map((d) => h("th" + (d === date() ? ".is-today" : ""), { scope: "col" },
                h("span.hb-grid-wd", fmtWeekday(d)), h("span.hb-grid-d", d.slice(8).replace(/^0/, "")))))),
        h("tbody", rows.map((hb) => weekRow(hb, days))));
    clear(view, nav, h("div.hb-grid-wrap", table));
}

function weekCell(hb, day) {
    const e = S.entries.get(`${hb.id}|${day}`);
    const st = cellState(hb, day, e);
    const disabled = st.cls === "is-none";
    return h("button.hb-cell." + st.cls + (day === date() ? ".is-today" : ""), {
        type: "button", disabled, dataset: { id: hb.id, day },
        "aria-label": `${hb.name}, ${fmtFull(day)}: ${st.label}${e?.note ? ". Note: " + e.note : ""}`,
        "data-tip": disabled ? null : `${fmtWeekday(day)} ${fmtShort(day)} · ${st.label}${e?.note ? " · " + e.note : ""}`,
        style: st.frac != null ? { "--f": Math.max(0.15, Math.min(1, st.frac)) } : null,
        onclick: (ev) => cellClick(ev.currentTarget, hb, day),
        oncontextmenu: (ev) => { ev.preventDefault(); if (!disabled) cellEditor(ev.currentTarget, hb, day); },
    }, st.icon ? icon(st.icon, 14) : (st.text || ""), e?.note ? h("span.hb-cell-note", { "aria-hidden": "true" }) : null);
}

/** Yes/no cell: one request (check with a date). Optimistic, rolled back on failure. */
async function cellClick(btn, hb, day) {
    if (hb.kind === "measurable") { cellEditor(btn, hb, day); return; }
    const key = `${hb.id}|${day}`, before = S.entries.get(key);
    const nowDone = !(before && !before.skipped && before.value >= 1);
    const after = { ...(before || { habit_id: hb.id, date: day, note: "" }), value: nowDone ? 1 : 0, skipped: false };
    const swap = () => { const cur = $(`.hb-cell[data-id="${hb.id}"][data-day="${day}"]`); if (cur) { const n = weekCell(hb, day); cur.replaceWith(n); n.focus(); } };
    S.entries.set(key, after);
    swap();
    try {
        const row = await call("POST", `${hb.id}/check`, { done: nowDone, date: day });
        if (day !== date()) { setEntry(hb.id, day, after); applyPast(hb, day, before, after); }
        applyRow(row);
        renderSummary();
    } catch (ex) {
        fail(ex);
        if (before) S.entries.set(key, before); else S.entries.delete(key);
        swap();
    }
}

function cellEditor(anchor, hb, day) {
    const key = `${hb.id}|${day}`, e = S.entries.get(key) || { value: 0, note: "", skipped: false };
    const measurable = hb.kind === "measurable";
    const val = measurable
        ? h("input.form-control.hb-step-in", { type: "number", min: 0, step: "any", value: num(e.value || 0), "aria-label": hb.unit || "Amount" })
        : h("input.form-check-input", { type: "checkbox", checked: e.value >= 1 && !e.skipped, id: "hb-ce-done" });
    const skip = h("input.form-check-input", { type: "checkbox", checked: !!e.skipped, id: "hb-ce-skip" });
    const note = h("textarea.form-control", { rows: 2, maxlength: 500, value: e.note || "", placeholder: "Note (optional)", "aria-label": "Note" });
    const save = async (body) => {
        try {
            await saveDay(hb, day, body);
            closePopover();
            if (S.view === "week") { const tr = $(`.hb-grid tr[data-id="${hb.id}"]`); if (tr) tr.replaceWith(weekRow(hb, weekDays())); renderSummary(); }
            else repaintHabit(hb.id);
        } catch (ex) { fail(ex); }
    };
    popover(anchor, h("form.hb-pop-form", { onsubmit: (ev) => {
        ev.preventDefault();
        save({ value: measurable ? Number(val.value || 0) : (val.checked ? 1 : 0), skipped: skip.checked, note: note.value });
    } },
        h("div.hb-pop-title", `${hb.name} · ${fmtWeekday(day)} ${fmtShort(day)}`),
        measurable ? h("label.hb-pop-row", h("span", `Amount${hb.unit ? ` (${hb.unit})` : ""}`), val)
            : h("label.hb-pop-row.hb-check", val, h("span", "Done")),
        h("label.hb-pop-row.hb-check", skip, h("span", "Skip this day (keeps the streak)")),
        note,
        h("div.hb-pop-actions",
            h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => save({ value: 0, skipped: false, note: "" }) }, "Clear"),
            h("span.hb-grow"),
            h("button.btn.btn-sm.btn-primary", { type: "submit" }, "Save"))));
    (measurable ? val : note).focus();
}

function shiftWeek(n) {
    const next = addDays(S.weekEnd, n);
    S.weekEnd = next > date() ? date() : next;
    showWeek();
}

/** Show the week at once from cache; fetch only if it was never loaded (or is a saved copy). */
async function showWeek() {
    const end = S.weekEnd, w = weeks.get(end);
    renderWeek(w ? "ok" : "loading");
    if (w && !w.stale) return;
    try {
        await loadWeek(end);
        NET.retry.delete("week");
    } catch (e) {
        if (isNetErr(e)) retryLater("week", () => loadWeek(end)); else fail(e);
    }
    if (S.view === "week" && S.weekEnd === end) renderWeek("failed");
}

// ------------------------------------------------------------------ Detail

function detailSkeleton() {
    clear(view, h("div.hb-detail", { "aria-busy": "true" },
        h("div.hb-skel-line.w40"), h("div.hb-tiles", Array.from({ length: 4 }, () => h("div.hb-tile.hb-skel-tile"))),
        h("div.hb-card.hb-skel-card"), h("div.hb-card.hb-skel-card")));
}

async function fetchStats(id) {
    const stats = await call("GET", `${id}/stats`);
    statsCache.set(id, { stats, stale: false, saved: false });
    persistSoon();
    return stats;
}

/** Cached stats paint at once; they're fetched only when missing, or stale after this habit changed. */
async function showDetail(id) {
    let hb = habits().find((x) => x.id === id) || S.archived?.find((x) => x.id === id);
    const c = statsCache.get(id);
    if (hb && c) renderDetail(hb, c.stats); else detailSkeleton();
    if (c && !c.stale) return;
    try {
        if (!hb) hb = await call("GET", id);
        const stats = await fetchStats(id);
        NET.retry.delete(`stats:${id}`);
        if (S.view === "detail" && S.detailId === id) renderDetail(hb, stats);
    } catch (e) {
        if (e.status === 404) { toast("That habit isn't here any more.", { error: true }); go(""); return; }
        if (isNetErr(e)) retryLater(`stats:${id}`, () => fetchStats(id)); else fail(e);
        if (S.view === "detail" && S.detailId === id && !c) {
            if (hb) renderDetail(hb, null);
            else clear(view, h("div.hb-empty", "Couldn't load this habit.", h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => showDetail(id) }, "Retry")));
        }
    }
}

function tile(label, value, sub) {
    return h("div.hb-tile", h("div.hb-tile-l", label), h("div.hb-tile-v", value), sub ? h("div.hb-tile-s", sub) : null);
}

/** Each card draws on its own: a chart that fails (or stats that didn't load) never blanks the page. */
function card(title, extra, draw, id) {
    let body;
    try { body = draw(); } catch (err) {
        console.warn("Habits chart failed", title, err);  // eslint-disable-line no-console
        body = h("div.hb-muted", "Couldn't draw this chart.");
    }
    return h("section.hb-card", h("div.hb-card-head", h("h3", title), extra), body);
}

function statsMissing(id) {
    return h("div.hb-card-err", h("span", "Couldn't load these stats."),
        h("button.hb-link", { type: "button", onclick: () => showDetail(id) }, "Retry"));
}

function renderDetail(hb, st) {
    const r = rowOf(hb.id);
    const measurable = hb.kind === "measurable";
    const unitWord = (n) => UNIT[hb.period][n === 1 ? 0 : 1];
    const facts = [goalText(hb), hb.period !== "day" || hb.kind === "measurable" ? scheduleText(hb) : null,
        hb.reminder_time ? `Reminder ${fmtTime(hb.reminder_time)}` : null, `Since ${fmtFull(hb.start_date)}`,
        hb.end_date ? `until ${fmtFull(hb.end_date)}` : null, hb.paused ? "Paused" : null, hb.archived ? "Archived" : null].filter(Boolean);
    const span = { day: "today", week: "this week", month: "this month" }[hb.period];
    const saved = statsCache.get(hb.id)?.saved;
    // Tiles fall back to today's row when the stats aren't available.
    const cur = st ? st.current_streak : (r?.streak ?? 0);
    const pv = st ? st.period_value : (r?.period_value ?? 0), pr = st ? st.period_required : (r?.period_required ?? hb.target);
    const ticked = r && hb.kind === "yesno" && r.done_today;

    let heatBox = null;
    clear(view, h("div.hb-detail", { style: colourVars(hb.colour) },
        h("div.hb-detail-top",
            h("button.hb-link.hb-back", { type: "button", onclick: () => go("") }, icon("chevL", 14), "All habits"),
            saved && h("span.hb-saved", "Saved copy"),
            h("span.hb-grow"),
            r && !hb.archived && h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => check(hb.id, measurable ? { amount: 1 } : {}) },
                measurable ? `+1 ${hb.unit || ""}`.trim() : (ticked ? "Undo today" : "Check off today")),
            h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => editHabit(hb) }, icon("edit", 14), " Edit"),
            h("button.hb-icon-btn", { type: "button", "aria-label": "More", onclick: (e) => menu(e.currentTarget, [
                { label: hb.paused ? "Resume" : "Pause", icon: hb.paused ? "play" : "pause", onClick: () => setPaused(hb, !hb.paused) },
                { label: hb.archived ? "Unarchive" : "Archive", icon: "archive", onClick: () => setArchived(hb, !hb.archived) },
                { sep: true },
                { label: "Delete…", icon: "trash", danger: true, onClick: () => deleteHabit(hb) },
            ]) }, icon("more"))),
        h("header.hb-detail-head",
            h("span.hb-detail-mark", hb.icon ? icon(hb.icon, 20) : h("span.hb-dot.is-lg")),
            h("div", h("h2.hb-detail-name", hb.name), h("div.hb-detail-facts", facts.join(" · ")))),
        hb.description ? h("p.hb-detail-desc", hb.description) : null,
        h("div.hb-tiles",
            tile("Current streak", h("span.hb-streak.is-big", icon("flame", 18), h("b", cur)), unitWord(cur)),
            tile("Best streak", st ? String(st.best_streak) : "–", st ? unitWord(st.best_streak) : ""),
            tile("Score", st ? String(Math.round(st.score)) : "–", "Habit strength, 0–100"),
            tile(hb.goal === "at_most" ? `Logged ${span}` : `Progress ${span}`, num(pv),
                `${hb.goal === "at_most" ? "limit" : "of"} ${num(pr)} ${measurable ? hb.unit || "" : "times"}`)),
        card("Last 12 months", st && heatLegend(), () => st ? (heatBox = h("div.hb-heat-wrap", heatmap(st, hb))) : statsMissing(hb.id)),
        h("div.hb-cols",
            card("Completion", null, () => {
                if (!st) return statsMissing(hb.id);
                const rates = [["7 days", st.rates.d7], ["30 days", st.rates.d30], ["90 days", st.rates.d90], ["All time", st.rates.all]];
                return h("div.hb-rates", rates.map(([l, v]) => h("div.hb-rate",
                    h("div.hb-rate-top", h("span", l), h("b", pct(v))),
                    h("div.hb-meter", { role: "meter", "aria-label": `${l} completion`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": v == null ? 0 : Math.round(v * 100) },
                        h("span", { style: { width: `${Math.round((v || 0) * 100)}%` } })))));
            }),
            card("Score trend", h("span.hb-muted", "26 weeks"), () => st ? sparkline(st.score_trend) : statsMissing(hb.id))),
        h("div.hb-cols",
            card(hb.period === "day" ? "By weekday" : "Days logged by weekday", h("span.hb-muted", hb.period === "day" ? "% at goal" : "count"),
                () => st ? weekdayBars(st.weekdays, hb) : statsMissing(hb.id)),
            card(measurable ? "Totals" : "Days done", null, () => {
                if (!st) return statsMissing(hb.id);
                const u = measurable ? ` ${hb.unit}` : "";
                const rows = [["This week", st.totals.week], ["This month", st.totals.month], ["All time", st.totals.total]];
                if (measurable) rows.push(["Average logged day", st.totals.average], ["Best day", st.totals.best]);
                return h("dl.hb-totals", rows.map(([l, v]) => [h("dt", l), h("dd", v == null ? "–" : `${num(v)}${u}`)]));
            })),
        card("Notes", null, () => !st ? statsMissing(hb.id) : st.notes.length
            ? h("ul.hb-notes", st.notes.map((n) => h("li",
                h("button.hb-link.hb-note-date", { type: "button", onclick: (e) => cellEditor(e.currentTarget, hb, n.date) }, fmtFull(n.date)),
                h("span.hb-note-text", n.note))))
            : h("div.hb-muted", "No notes yet. Add one from Today or the week grid."))));
    // Show the most recent weeks first on narrow screens.
    if (heatBox) requestAnimationFrame(() => { heatBox.scrollLeft = heatBox.scrollWidth; });
}

// ------------------------------------------------------------------ create / edit / delete

async function newHabit() {
    const saved = await openEditor({ today: date() });
    if (saved && typeof saved === "object") {
        await reloadToday();
        repaint();
        toast(`Created ${saved.name}.`);
        $(`.hb-row[data-id="${saved.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
}

async function editHabit(hb) {
    const saved = await openEditor({ habit: hb, today: date(),
        onArchive: () => setArchived(hb, !hb.archived), onDelete: () => deleteHabit(hb, true) });
    if (saved && typeof saved === "object") {
        statsCache.delete(hb.id);
        S.archived = null;
        await reloadToday();
        repaint();
    }
}

async function deleteHabit(hb, confirmed = false) {
    if (!confirmed && !confirm(`Delete “${hb.name}” and all its history? This can't be undone.`)) return;
    try {
        await call("DELETE", hb.id);
        S.archived = null;
        statsCache.delete(hb.id);
        await reloadToday();
        toast(`Deleted ${hb.name}.`);
        S.view === "detail" ? go("") : repaint();
    } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ routing & render

function go(hash) {
    if (("#" + hash) === location.hash || (!hash && !location.hash.slice(1))) route();
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
    else if (S.view === "detail") showDetail(S.detailId);
    else renderToday();
    if (S.view !== "detail") view.scrollTop = 0;
}

/** Redraw the current view from memory (no requests). */
function repaint() {
    renderHeader();
    renderSummary();
    if (S.view === "week") renderWeek(weeks.has(S.weekEnd) ? "ok" : "failed");
    else if (S.view === "today") renderToday();
    else if (S.view === "detail") {
        const hb = habits().find((x) => x.id === S.detailId) || S.archived?.find((x) => x.id === S.detailId);
        const c = statsCache.get(S.detailId);
        if (hb) renderDetail(hb, c ? c.stats : null);
    }
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
addEventListener("online", () => { if (NET.down) retryNow(); });
addEventListener("focus", () => { if (NET.down) retryNow(); });
// Back after a while (maybe past midnight, maybe changed elsewhere): one revalidating GET, no polling.
document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") { NET.hiddenAt = Date.now(); clearTimeout(NET.timer); NET.timer = 0; return; }
    if (NET.down) { retryNow(); return; }
    if (!NET.hiddenAt || Date.now() - NET.hiddenAt < 5 * 60 * 1000) return;
    const before = date();
    try { await refreshToday(); } catch (e) { if (isNetErr(e)) retryLater("today", refreshToday); return; }
    for (const c of statsCache.values()) c.stale = true;
    for (const w of weeks.values()) w.stale = true;   // revalidate a week when it's next opened
    if (S.today.date !== before) route(); else repaint();
});
restore();
initTooltip();
route();
