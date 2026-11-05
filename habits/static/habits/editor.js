/* Habits: the create / edit dialog (native <dialog>), with starter templates. */

import { h, $, $$, api, icon, toast, HABIT_ICONS, WEEKDAYS, WEEKDAYS_1 } from "./lib.js";
import { COLOURS, colourVars } from "./charts.js";

export const TEMPLATES = [
    { name: "Drink water", kind: "measurable", unit: "glasses", target: 8, icon: "drop", colour: "#2a78d6" },
    { name: "Read", kind: "measurable", unit: "minutes", target: 20, icon: "book", colour: "#6250d6" },
    { name: "Exercise", kind: "yesno", target: 3, period: "week", icon: "dumbbell", colour: "#eb6834" },
    { name: "No sugar", kind: "measurable", unit: "servings", goal: "at_most", target: 0, icon: "ban", colour: "#e34948" },
    { name: "Meditate", kind: "yesno", icon: "leaf", colour: "#1baf7a" },
    { name: "Walk", kind: "measurable", unit: "steps", target: 8000, icon: "run", colour: "#008300" },
    { name: "Journal", kind: "yesno", schedule: "weekdays", weekdays: 0b0011111, icon: "pen", colour: "#eda100" },
    { name: "Sleep by 11", kind: "yesno", icon: "moon", colour: "#e87ba4" },
];

const DEFAULTS = { name: "", description: "", colour: "", icon: "", kind: "yesno", unit: "", goal: "at_least", target: 1,
    period: "day", schedule: "daily", weekdays: 127, interval: 2, start_date: "", end_date: null,
    reminder_time: null, reminder_days: 127 };

let dlg;

/** Open the dialog. Resolves with the saved habit, "deleted", or null if cancelled. */
export function openEditor({ habit = null, today, onArchive, onDelete } = {}) {
    dlg = dlg || $("#hb-editor");
    const s = { ...DEFAULTS, start_date: today, ...(habit || {}) };
    if (s.reminder_time) s.reminder_time = s.reminder_time.slice(0, 5);
    return new Promise((resolve) => {
        let result = null;
        const form = h("form.hb-form", { method: "dialog", novalidate: true });
        const err = h("div.hb-form-err", { role: "alert", hidden: true });

        const seg = (name, options, value, onchange) => h("div.hb-seg.hb-seg-sm", { role: "radiogroup", "aria-label": name },
            options.map(([v, label]) => h("label.hb-seg-opt",
                h("input", { type: "radio", name, value: v, checked: value === v, onchange: () => onchange(v) }),
                h("span", label))));
        const field = (label, control, hint, cls = "") => h("div.hb-field" + cls, h("label.hb-label", label), control, hint && h("div.hb-hint", hint));
        const dayToggles = (name, mask, onchange) => h("div.hb-days", { role: "group", "aria-label": name },
            WEEKDAYS_1.map((d, i) => h("label.hb-day", { title: WEEKDAYS[i] },
                h("input", { type: "checkbox", checked: !!((mask >> i) & 1), "aria-label": WEEKDAYS[i],
                    onchange: (e) => onchange(e.target.checked ? mask | (1 << i) : mask & ~(1 << i)) }),
                h("span", d))));

        const nameIn = h("input.form-control", { id: "hb-f-name", value: s.name, maxlength: 80, required: true,
            placeholder: "e.g. Drink water", autocomplete: "off", oninput: (e) => { s.name = e.target.value; } });

        const body = h("div.hb-form-body");
        const render = () => {
            const focusId = document.activeElement?.id;
            const measurable = s.kind === "measurable";
            const unitWord = measurable ? (s.unit || "units") : "times";
            const goalRow = h("div.hb-goal",
                measurable ? h("select.form-select.hb-goal-dir", { "aria-label": "Goal", onchange: (e) => { s.goal = e.target.value; render(); } },
                    h("option", { value: "at_least", selected: s.goal === "at_least" }, "At least"),
                    h("option", { value: "at_most", selected: s.goal === "at_most" }, "At most"))
                    : h("span.hb-goal-word", s.period === "day" ? "Done" : "At least"),
                (measurable || s.period !== "day") && h("input.form-control.hb-goal-n", { id: "hb-f-target", type: "number", min: 0,
                    step: measurable ? "any" : 1, max: measurable ? 1000000 : (s.period === "week" ? 7 : 31), value: s.target,
                    "aria-label": "Target", oninput: (e) => { s.target = e.target.value === "" ? "" : Number(e.target.value); } }),
                measurable ? h("input.form-control.hb-goal-unit", { id: "hb-f-unit", value: s.unit, maxlength: 24, placeholder: "glasses",
                    "aria-label": "Unit", oninput: (e) => { s.unit = e.target.value; } })
                    : (s.period !== "day" && h("span.hb-goal-word", "times")),
                h("span.hb-goal-word", s.period === "day" && !measurable ? "every scheduled day" : "per"),
                h("select.form-select.hb-goal-period", { "aria-label": "Period", onchange: (e) => {
                    s.period = e.target.value;
                    if (!measurable) s.target = s.period === "day" ? 1 : Math.max(1, Math.min(s.period === "week" ? 7 : 31, s.target || 3));
                    if (!measurable && s.period === "week" && s.target === 1) s.target = 3;
                    render();
                } },
                    ...[["day", "day"], ["week", "week"], ["month", "month"]].map(([v, l]) => h("option", { value: v, selected: s.period === v }, l))));

            const schedule = h("div.hb-sched",
                seg("schedule", [["daily", "Every day"], ["weekdays", "Some days"], ["interval", "Every N days"]], s.schedule, (v) => { s.schedule = v; render(); }),
                s.schedule === "weekdays" && dayToggles("Weekdays", s.weekdays, (m) => { s.weekdays = m; }),
                s.schedule === "interval" && h("div.hb-inline", h("span", "Every"),
                    h("input.form-control.hb-n", { id: "hb-f-interval", type: "number", min: 1, max: 365, value: s.interval, "aria-label": "Every N days",
                        oninput: (e) => { s.interval = Number(e.target.value); } }), h("span", "days from the start date")));

            const remindOn = !!s.reminder_time;
            const reminder = h("div.hb-remind",
                h("label.hb-check", h("input.form-check-input", { type: "checkbox", id: "hb-f-remind", checked: remindOn,
                    onchange: (e) => { s.reminder_time = e.target.checked ? (s.reminder_time || "09:00") : null; render(); } }),
                    h("span", "Remind me if it isn't done")),
                remindOn && h("div.hb-inline",
                    h("input.form-control.hb-time", { id: "hb-f-rtime", type: "time", value: s.reminder_time, "aria-label": "Reminder time",
                        oninput: (e) => { s.reminder_time = e.target.value || null; } }),
                    dayToggles("Reminder days", s.reminder_days, (m) => { s.reminder_days = m; })));

            body.replaceChildren(
                !habit && h("div.hb-templates", h("div.hb-label", "Start from"),
                    h("div.hb-chips", TEMPLATES.map((t) => h("button.hb-chip", { type: "button", style: colourVars(t.colour),
                        onclick: () => { Object.assign(s, DEFAULTS, { start_date: s.start_date }, t); nameIn.value = s.name; render(); nameIn.focus(); } },
                        icon(t.icon, 14, "hb-c"), t.name)))),
                field("Name", nameIn),
                field("Type", seg("kind", [["yesno", "Yes / no"], ["measurable", "Measurable"]], s.kind, (v) => {
                    s.kind = v;
                    if (v === "yesno") { s.goal = "at_least"; if (s.period === "day") s.target = 1; }
                    render();
                })),
                field("Goal", goalRow, s.goal === "at_most" ? "A limit: days are kept unless you log going over." : null),
                field("Schedule", schedule, s.period !== "day" ? "Shows on these days until the goal is met." : "Days off the schedule never break a streak."),
                h("div.hb-field-row",
                    field("Colour", h("div.hb-swatches", { role: "radiogroup", "aria-label": "Colour" },
                        COLOURS.map(([hex, label]) => h("label.hb-swatch", { title: label, style: colourVars(hex) },
                            h("input", { type: "radio", name: "colour", value: hex, checked: s.colour === hex, "aria-label": label,
                                onchange: () => { s.colour = hex; render(); } }), h("span.hb-c-bg"))))),
                    field("Icon", h("div.hb-icons", { role: "radiogroup", "aria-label": "Icon", style: colourVars(s.colour) },
                        h("label.hb-iconpick", { title: "None" }, h("input", { type: "radio", name: "icon", value: "", checked: !s.icon, "aria-label": "No icon",
                            onchange: () => { s.icon = ""; } }), h("span", "–")),
                        HABIT_ICONS.map((k) => h("label.hb-iconpick", { title: k },
                            h("input", { type: "radio", name: "icon", value: k, checked: s.icon === k, "aria-label": k, onchange: () => { s.icon = k; } }),
                            icon(k, 16)))))),
                field("Reminder", reminder),
                h("div.hb-field-row.hb-dates",
                    field("Starts", h("input.form-control", { id: "hb-f-start", type: "date", value: s.start_date, required: true,
                        oninput: (e) => { s.start_date = e.target.value; } })),
                    field("Ends (optional)", h("input.form-control", { id: "hb-f-end", type: "date", value: s.end_date || "",
                        oninput: (e) => { s.end_date = e.target.value || null; } }))),
                field("Notes", h("textarea.form-control", { id: "hb-f-desc", rows: 2, maxlength: 2000, placeholder: "Why it matters, how you'll do it",
                    value: s.description, oninput: (e) => { s.description = e.target.value; } })),
            );
            if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
        };
        render();

        const save = h("button.btn.btn-primary.btn-sm", { type: "submit" }, habit ? "Save" : "Create habit");
        form.append(
            h("div.hb-dlg-head", h("h2.hb-dlg-title", habit ? "Edit habit" : "New habit"),
                h("button.hb-icon-btn", { type: "button", "aria-label": "Close", onclick: () => dlg.close() }, icon("x"))),
            body, err,
            h("div.hb-dlg-foot",
                habit && h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => { result = "archived"; dlg.close(); onArchive?.(); } },
                    habit.archived ? "Unarchive" : "Archive"),
                habit && h("button.btn.btn-sm.hb-btn-danger", { type: "button", onclick: async () => {
                    if (!confirm(`Delete “${habit.name}” and all its history? This can't be undone.`)) return;
                    result = "deleted"; dlg.close(); onDelete?.();
                } }, "Delete"),
                h("div.hb-grow"),
                h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => dlg.close() }, "Cancel"),
                save));

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            err.hidden = true;
            if (!s.name.trim()) { err.textContent = "Give the habit a name."; err.hidden = false; nameIn.focus(); return; }
            const payload = {};
            for (const k of Object.keys(DEFAULTS)) payload[k] = s[k];
            payload.name = s.name.trim();
            payload.target = s.target === "" ? 0 : Number(s.target);
            payload.end_date = s.end_date || null;
            payload.start_date = s.start_date || today;
            save.disabled = true;
            try {
                result = habit ? await api("PATCH", `${habit.id}`, payload) : await api("POST", "", payload);
                dlg.close();
            } catch (ex) {
                err.textContent = ex.message;
                err.hidden = false;
            } finally { save.disabled = false; }
        });

        dlg.replaceChildren(form);
        dlg.addEventListener("close", function onClose() {
            dlg.removeEventListener("close", onClose);
            resolve(result);
        });
        dlg.showModal();
        nameIn.focus();
    });
}

/** Keyboard shortcuts sheet. */
export function openShortcuts() {
    dlg = dlg || $("#hb-editor");
    const rows = [["N", "New habit"], ["T / W", "Today / Week view"], ["J / K or ↓ / ↑", "Move between habits"],
        ["Space or X", "Check off / add one"], ["+ / −", "Add / subtract (measurable)"], ["S", "Skip today"],
        ["Enter", "Open details"], ["E", "Edit"], ["Alt + ↑ / ↓", "Move habit up / down"], ["Esc", "Back / close"], ["?", "This list"]];
    dlg.replaceChildren(h("div.hb-form",
        h("div.hb-dlg-head", h("h2.hb-dlg-title", "Keyboard shortcuts"),
            h("button.hb-icon-btn", { type: "button", "aria-label": "Close", onclick: () => dlg.close() }, icon("x"))),
        h("dl.hb-keys", rows.map(([k, v]) => [h("dt", h("kbd", k)), h("dd", v)]))));
    dlg.showModal();
}

