/* Contacts dialogs: import wizard (drop -> detect -> preview -> import), merge duplicates, reminder settings. */

import { $, api, avatar, clear, fmtBirthday, h, icon, plural, toast } from "./lib.js";

function dialog(title, { wide = false } = {}) {
    const d = $("#ct-dialog");
    d.classList.toggle("ct-dialog-wide", wide);
    const body = h("div.ct-dlg-body");
    const foot = h("div.ct-dlg-foot");
    clear(d, h("div.ct-dlg-head", h("h2", { id: "ct-dialog-title" }, title),
        h("button.ct-icon-btn", { type: "button", "aria-label": "Close", onclick: () => d.close() }, icon("x"))), body, foot);
    if (!d.open) d.showModal();
    return { d, body, foot, close: () => d.close() };
}

// Click on the backdrop closes the dialog.
$("#ct-dialog")?.addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// ------------------------------------------------------------------ import

const STATUS = { new: "New", update: "Update", duplicate: "Duplicate" };

export function openImport(ctx) {
    const { body, foot, close } = dialog("Import contacts", { wide: true });
    const st = { file: null, mode: "merge", mapping: null, format: "auto", preview: null };
    const input = h("input", { type: "file", accept: ".vcf,.vcard,.csv,.txt,text/vcard,text/csv", hidden: true, onchange: (e) => choose(e.target.files[0]) });
    const drop = h("label.ct-drop", { tabindex: "0" },
        icon("upload", 22), h("strong", "Drop a file here, or browse"),
        h("span.app-muted", "vCard (.vcf), Google Contacts CSV, Outlook CSV, LinkedIn Connections.csv or any CSV · up to 5 MB"),
        input);
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
    for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) choose(e.dataTransfer.files[0]); });
    const out = h("div.ct-imp-out", { "aria-live": "polite" });
    const importBtn = h("button.btn.btn-primary.btn-sm", { type: "button", disabled: true, onclick: commit }, "Import");
    clear(body, drop, out);
    clear(foot, h("span.ct-grow"), h("button.btn.btn-outline-secondary.btn-sm", { type: "button", onclick: close }, "Cancel"), importBtn);

    function form() {
        const fd = new FormData();
        fd.append("file", st.file);
        fd.append("mode", st.mode);
        fd.append("format", st.format);
        if (st.mapping) fd.append("mapping", JSON.stringify(st.mapping));
        return fd;
    }

    async function choose(file) {
        if (!file) return;
        if (file.size > ctx.boot.max_upload_bytes) { toast("Files can be up to 5 MB", { error: true }); return; }
        st.file = file;
        st.mapping = null;
        st.format = "auto";
        drop.classList.add("ct-drop-small");
        clear(drop.querySelector("strong"), file.name);
        await preview();
    }

    async function preview() {
        importBtn.disabled = true;
        clear(out, h("div.ct-skel-line.w-50"), h("div.ct-skel-line.w-75"), h("div.ct-skel-line.w-25"));
        try {
            const p = await api("POST", "import/preview", form());
            st.preview = p;
            if (p.format === "csv" && !st.mapping) st.mapping = p.mapping;
            st.format = p.format;
            renderPreview(p);
            importBtn.disabled = !(p.new + p.updated);
            importBtn.textContent = p.new + p.updated ? `Import ${plural(p.new + p.updated, "contact")}` : "Nothing to import";
        } catch (e) {
            clear(out, h("div.alert.alert-danger.mb-0", { role: "alert" }, e.message));
        }
    }

    function renderPreview(p) {
        const tiles = h("div.ct-imp-tiles",
            tile(p.new, "New", "new"), tile(p.updated, "Updated", "update"), tile(p.duplicates, p.duplicates === 1 ? "Duplicate" : "Duplicates", "duplicate"));
        const modeSel = h("div.ct-seg", { role: "radiogroup", "aria-label": "Existing contacts" },
            [["merge", "Merge into existing"], ["skip", "Skip existing"]].map(([v, l]) => h("button" + (st.mode === v ? ".on" : ""), {
                type: "button", role: "radio", "aria-checked": String(st.mode === v), onclick: () => { st.mode = v; preview(); },
            }, l)));
        const head = h("div.ct-imp-head",
            h("div", h("div.ct-imp-format", icon("file", 14), p.format_label), h("div.app-muted.small", `${plural(p.total, "contact")} in the file · matched on email, phone, GitHub or LinkedIn`)),
            h("div.ct-grow"), modeSel);
        const parts = [head, tiles];
        if (p.format === "csv") parts.push(mappingTable(p));
        parts.push(h("div.ct-imp-table-wrap", h("table.ct-imp-table",
            h("thead", h("tr", h("th", "Name"), h("th", "Details"), h("th", "Result"))),
            h("tbody", p.sample.map((r) => h("tr",
                h("td", r.name), h("td.app-muted", r.detail),
                h("td", h("span.ct-pill.ct-pill-" + r.status, STATUS[r.status]), r.match && r.status !== "new" ? h("span.ct-imp-match", ` ${r.match}`) : null)))))));
        if (p.sample.length < p.total) parts.push(h("p.app-muted.small.mb-0", `Showing the first ${p.sample.length}.`));
        clear(out, ...parts);
    }

    function mappingTable(p) {
        const opts = Object.entries(p.fields);
        return h("details.ct-map", { open: true },
            h("summary", "Columns"),
            h("div.ct-map-grid", p.columns.map((c) => {
                const sel = h("select.form-select.form-select-sm", {
                    "aria-label": `Field for column ${c}`,
                    onchange: (e) => { st.mapping = { ...st.mapping, [c]: e.target.value }; preview(); },
                }, opts.map(([k, l]) => h("option", { value: k }, l)));
                sel.value = st.mapping?.[c] ?? "";
                return h("div.ct-map-row", h("span.ct-map-col", { title: c }, c), icon("chevL", 12, "ct-map-arrow"), sel);
            })));
    }

    function tile(n, label, kind) {
        return h("div.ct-imp-tile.ct-imp-" + kind, h("div.ct-imp-n", String(n)), h("div.ct-imp-l", label));
    }

    async function commit() {
        importBtn.disabled = true;
        importBtn.textContent = "Importing…";
        try {
            const r = await api("POST", "import/commit", form());
            close();
            toast(`Imported ${plural(r.created, "new contact")}` + (r.updated ? `, updated ${r.updated}` : "") + (r.duplicates ? `, skipped ${r.duplicates}` : ""));
            ctx.refresh();
        } catch (e) {
            importBtn.disabled = false;
            importBtn.textContent = "Import";
            toast(e.message, { error: true });
        }
    }
}

// ------------------------------------------------------------------ duplicates & merge

const MERGE_FIELDS = [
    ["first_name", "First name"], ["middle_name", "Middle name"], ["last_name", "Last name"], ["nickname", "Nickname"],
    ["display_name", "Display name"], ["company", "Company"], ["title", "Title"], ["department", "Department"],
    ["birthday", "Birthday"], ["anniversary", "Anniversary"], ["how_met", "How we met"], ["notes", "Notes"],
    ["keep_in_touch_days", "Keep in touch (days)"],
];

export async function openDuplicates(ctx) {
    const { body, foot, close } = dialog("Merge duplicates", { wide: true });
    clear(body, h("div.ct-skel-line.w-75"), h("div.ct-skel-line.w-50"));
    clear(foot, h("span.ct-grow"), h("button.btn.btn-outline-secondary.btn-sm", { type: "button", onclick: close }, "Done"));
    let pairs;
    try { pairs = await api("GET", "duplicates"); } catch (e) { clear(body, h("div.alert.alert-danger", e.message)); return; }
    let merged = 0;
    const render = () => {
        if (!pairs.length) {
            clear(body, h("p.ct-empty", merged ? `Merged ${plural(merged, "pair")}. No more likely duplicates.` : "No likely duplicates. Nice and tidy."));
            return;
        }
        clear(body, h("p.app-muted.small", `${plural(pairs.length, "possible duplicate")}. Pick the value to keep for each field that differs; emails, phones, profiles, tags and history are combined.`),
            h("div.ct-pairs", pairs.map((pair, i) => pairCard(pair, i))));
    };
    const pairCard = (pair, i) => {
        let [keep, other] = [pair.a, pair.b];
        const box = h("section.ct-pair");
        const draw = () => {
            const choices = {};
            const diff = MERGE_FIELDS.filter(([f]) => (keep[f] ?? "") !== (other[f] ?? "") && (keep[f] || other[f]));
            const rows = diff.map(([f, label]) => {
                const pick = keep[f] ? "keep" : "other";
                choices[f] = pick;
                const name = `m-${i}-${f}`;
                const opt = (side, person) => h("label.ct-merge-opt",
                    h("input.form-check-input", { type: "radio", name, value: side, checked: pick === side, onchange: () => { choices[f] = side; } }),
                    h("span", fmtVal(f, person[f])));
                return h("div.ct-merge-row", h("div.ct-merge-k", label), opt("keep", keep), opt("other", other));
            });
            clear(box,
                h("div.ct-pair-head",
                    side(keep, "Keep"), h("button.ct-icon-btn", { type: "button", title: "Swap which record is kept", "aria-label": "Swap", onclick: () => { [keep, other] = [other, keep]; draw(); } }, icon("swap")),
                    side(other, "Merge in"),
                    h("div.ct-pair-reasons", pair.reasons.map((r) => h("span.ct-chip", r)))),
                rows.length ? h("div.ct-merge", rows) : h("p.app-muted.small.mb-2", "No conflicting fields."),
                h("div.ct-pair-actions",
                    h("button.btn.btn-sm.btn-outline-secondary", {
                        type: "button",
                        onclick: async () => {
                            try { await api("POST", "duplicates/dismiss", { a_id: keep.id, b_id: other.id }); pairs.splice(pairs.indexOf(pair), 1); render(); } catch (e) { toast(e.message, { error: true }); }
                        },
                    }, "Not the same person"),
                    h("button.btn.btn-sm.btn-primary", {
                        type: "button",
                        onclick: async () => {
                            try {
                                await api("POST", "merge", { keep_id: keep.id, other_id: other.id, fields: choices });
                                merged++;
                                const gone = other.id;
                                pairs = pairs.filter((x) => x !== pair && x.a.id !== gone && x.b.id !== gone);
                                render();
                                ctx.refresh();
                            } catch (e) { toast(e.message, { error: true }); }
                        },
                    }, "Merge")));
        };
        draw();
        return box;
    };
    render();
}

function side(p, label) {
    return h("div.ct-pair-side", avatar(p, "sm"), h("div", h("div.ct-pair-label", label), h("div.ct-pair-name", p.name),
        h("div.app-muted.small", [p.email, p.company].filter(Boolean).join(" · "))));
}

function fmtVal(f, v) {
    if (v == null || v === "") return "—";
    if (f === "birthday") return fmtBirthday(v);
    const s = String(v);
    return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

// ------------------------------------------------------------------ settings

export async function openSettings() {
    const { body, foot, close } = dialog("Reminders");
    let s;
    try { s = await api("GET", "settings"); } catch (e) { clear(body, h("div.alert.alert-danger", e.message)); return; }
    const bday = h("select.form-select.form-select-sm", { id: "ct-set-bday" },
        h("option", { value: "day_before" }, "The day before"), h("option", { value: "on_day" }, "On the day"), h("option", { value: "off" }, "Off"));
    bday.value = s.birthday_reminders;
    const kit = h("input.form-check-input", { type: "checkbox", role: "switch", id: "ct-set-kit", checked: s.keep_in_touch_reminders });
    clear(body,
        h("p.app-muted.small", "Sent once each morning to your notification inbox and delivery channels."),
        h("div.ct-set-row", h("label", { for: "ct-set-bday" }, h("div", "Birthdays"), h("div.app-muted.small", "A heads-up for each contact's birthday")), bday),
        h("div.ct-set-row", h("label", { for: "ct-set-kit" }, h("div", "Keep in touch"), h("div.app-muted.small", "When someone you keep in touch with is due (one notification each, or a digest)")),
            h("div.form-check.form-switch.m-0", kit)));
    clear(foot, h("span.ct-grow"), h("button.btn.btn-outline-secondary.btn-sm", { type: "button", onclick: close }, "Cancel"),
        h("button.btn.btn-primary.btn-sm", {
            type: "button",
            onclick: async () => {
                try { await api("PATCH", "settings", { birthday_reminders: bday.value, keep_in_touch_reminders: kit.checked }); close(); toast("Reminder settings saved"); } catch (e) { toast(e.message, { error: true }); }
            },
        }, "Save"));
}
