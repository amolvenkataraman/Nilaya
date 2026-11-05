/* Contacts: the right-hand pane. Overview (nothing selected), a contact's detail view with its
 * timeline, relationships and keep-in-touch control, and the edit form. */

import {
    $, API, MONTHS, api, avatar, clear, daysFromToday, extLink, fmtBirthday, fmtDay, fmtLongDay, h, icon, mark,
    plural, todayKey, toast,
} from "./lib.js";

const KIT = [[7, "Every week"], [14, "Every 2 weeks"], [30, "Every month"], [60, "Every 2 months"], [90, "Every 3 months"],
    [180, "Every 6 months"], [365, "Every year"]];
const KIND_LABEL = { call: "Call", meeting: "Meeting", message: "Message", email: "Email", note: "Note" };
const relLabel = (k) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ");

function card(title, extra, ...body) {
    return h("section.ct-card", h("div.ct-card-head", h("h3", title), extra), ...body);
}

// ------------------------------------------------------------------ overview

export function renderOverview(el, stats, ctx) {
    if (!stats.total) {
        clear(el, h("div.ct-welcome",
            h("div.ct-welcome-ico", icon("users", 28)),
            h("h2", "Your people, in one place"),
            h("p.app-muted", "Import from Google, Outlook, LinkedIn, a phone (vCard) or any CSV, or add someone by hand."),
            h("div.ct-empty-actions",
                h("button.btn.btn-primary.btn-sm", { type: "button", onclick: () => ctx.newContact() }, "New contact"),
                h("button.btn.btn-outline-secondary.btn-sm", { type: "button", onclick: () => document.getElementById("ct-import-btn").click() }, "Import a file"))));
        return;
    }
    const bdays = stats.upcoming_birthdays.length ? h("ul.ct-mini",
        stats.upcoming_birthdays.slice(0, 8).map((b) => h("li", h("button.ct-mini-row", { type: "button", onclick: () => ctx.open(b.id) },
            h("span.ct-mini-name", b.name),
            h("span.ct-mini-meta", (b.days === 0 ? "Today" : b.days === 1 ? "Tomorrow" : fmtDay(b.date)) + (b.age ? ` · ${b.age}` : ""))))))
        : h("p.ct-none", "No birthdays in the next 30 days.");
    const overdue = stats.overdue_people.length ? h("ul.ct-mini",
        stats.overdue_people.slice(0, 8).map((o) => h("li", h("button.ct-mini-row", { type: "button", onclick: () => ctx.open(o.id) },
            h("span.ct-mini-name", o.name),
            h("span.ct-mini-meta.ct-due", o.days_overdue ? `${plural(o.days_overdue, "day")} overdue` : "Due today")))))
        : h("p.ct-none", "You're caught up with everyone.");
    clear(el, h("div.ct-overview",
        h("div.ct-ov-stats",
            stat(stats.total, "Contacts"), stat(stats.favorites, "Favorites"), stat(stats.keep_in_touch, "Keeping in touch"),
            stat(stats.recent, "Added this month")),
        h("div.ct-ov-grid", card("Upcoming birthdays", null, bdays), card("Catch up", null, overdue)),
        h("p.ct-hint", h("kbd", "/"), " search  ", h("kbd", "N"), " new  ", h("kbd", "J"), h("kbd", "K"), " move  ", h("kbd", "E"), " edit")));
}

function stat(n, label) {
    return h("div.ct-stat", h("div.ct-stat-n", String(n)), h("div.ct-stat-l", label));
}

// ------------------------------------------------------------------ detail

export function renderDetail(el, p, ctx) {
    const sub = [p.title, p.company, p.department].filter(Boolean).join(" · ");
    const chips = [...p.groups.map((g) => h("span.ct-chip.ct-chip-group", icon("folder", 12), g)), ...p.tags.map((t) => h("span.ct-chip", t))];
    const photoInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true, onchange: (e) => uploadPhoto(p, e.target.files[0], ctx) });
    const more = h("div.dropdown",
        h("button.ct-icon-btn", { type: "button", "data-bs-toggle": "dropdown", "aria-expanded": "false", title: "More", "aria-label": "More actions" }, icon("more")),
        h("ul.dropdown-menu.dropdown-menu-end",
            h("li", h("a.dropdown-item", { href: `${API}export?format=vcf&ids=${p.id}` }, "Download vCard")),
            h("li", h("button.dropdown-item", { type: "button", onclick: () => photoInput.click() }, p.has_avatar ? "Change photo" : "Add photo")),
            p.has_avatar ? h("li", h("button.dropdown-item", { type: "button", onclick: () => removePhoto(p, ctx) }, "Remove photo")) : null,
            h("li", h("hr.dropdown-divider")),
            h("li", h("button.dropdown-item.text-danger", { type: "button", onclick: () => remove(p, ctx) }, "Delete contact"))));
    const star = h("button.ct-icon-btn.ct-star" + (p.favorite ? ".on" : ""), {
        type: "button", title: p.favorite ? "Remove from favorites" : "Add to favorites", "aria-pressed": String(p.favorite),
        onclick: async () => { try { ctx.updated(await api("PATCH", p.id, { favorite: !p.favorite })); } catch (e) { toast(e.message, { error: true }); } },
    }, icon(p.favorite ? "star-fill" : "star"));

    const top = h("div.ct-d-top",
        h("button.ct-icon-btn.ct-back", { type: "button", title: "Back", "aria-label": "Back to list", onclick: () => ctx.back() }, icon("chevL")),
        h("div.ct-grow"), star,
        h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => ctx.edit(p), title: "Edit (E)" }, "Edit"),
        more, photoInput);

    const head = h("header.ct-d-head", avatar(p, "xl"),
        h("div.ct-d-id",
            h("h2.ct-d-name", p.name),
            sub ? h("div.ct-d-sub", sub) : null,
            p.nickname && p.nickname !== p.name ? h("div.ct-d-nick", `“${p.nickname}”`) : null,
            chips.length ? h("div.ct-chips", chips) : null));

    const profileChips = p.profile_links.length ? h("div.ct-profiles", p.profile_links.map((l) => {
        const inner = [mark(l.network, 16), h("span.ct-prof-label", l.label), h("span.ct-prof-handle", displayHandle(l))];
        return l.url ? extLink(l.url, ...inner, icon("ext", 12, "ct-prof-ext")) : h("span", { title: "No public profile link" }, ...inner);
    }).map((a) => { a.classList.add("ct-prof"); return a; })) : null;

    clear(el, h("div.ct-detail", top, head, profileChips,
        h("div.ct-d-grid",
            h("div.ct-col-a", contactCard(p), aboutCard(p, ctx), relationsCard(p, ctx)),
            h("div.ct-col-b", kitCard(p, ctx), timelineCard(p, ctx)))));
    el.scrollTop = 0;
}

function displayHandle(l) {
    if (l.network === "website" || l.network === "blog") return l.handle.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (["twitter", "github", "gitlab", "devto", "keybase", "instagram", "telegram", "medium", "youtube"].includes(l.network)) return "@" + l.handle;
    if (l.network === "linkedin") return l.handle.replace(/^in\//, "");
    return l.handle;
}

function infoRow(ico, main, label, href) {
    const value = href ? h("a", { href }, main) : h("span", main);
    return h("div.ct-info", h("span.ct-info-ico", icon(ico)), h("div.ct-info-main", value, label ? h("span.ct-info-label", label) : null));
}

function contactCard(p) {
    const rows = [];
    for (const e of p.emails) rows.push(infoRow("mail", e.value, e.label, "mailto:" + e.value));
    for (const t of p.phones) rows.push(infoRow("phone", t.value, t.label, "tel:" + t.value.replace(/[^\d+]/g, "")));
    for (const a of p.addresses) {
        const lines = [a.street, [a.city, a.region, a.postcode].filter(Boolean).join(", "), a.country].filter(Boolean);
        rows.push(h("div.ct-info", h("span.ct-info-ico", icon("pin")), h("div.ct-info-main", h("span.ct-pre", lines.join("\n")), a.label ? h("span.ct-info-label", a.label) : null)));
    }
    if (p.birthday) rows.push(infoRow("cake", fmtBirthday(p.birthday), "birthday"));
    if (p.anniversary) rows.push(infoRow("heart", fmtLongDay(p.anniversary), "anniversary"));
    return card("Contact info", null, rows.length ? h("div.ct-infos", rows) : h("p.ct-none", "No email, phone or address yet."));
}

function aboutCard(p, ctx) {
    const rows = [];
    if (p.how_met) rows.push(h("div.ct-about", h("div.ct-about-k", "How we met"), h("div.ct-about-v.ct-pre", p.how_met)));
    if (p.notes) rows.push(h("div.ct-about", h("div.ct-about-k", "Notes"), h("div.ct-about-v.ct-pre", p.notes)));
    for (const c of p.custom_fields) rows.push(h("div.ct-about", h("div.ct-about-k", c.key), h("div.ct-about-v.ct-pre", c.value)));
    for (const l of p.links) rows.push(h("div.ct-about", h("div.ct-about-k", l.label || "Link"), h("div.ct-about-v", extLink(l.url, l.url.replace(/^https?:\/\//, "")))));
    if (p.linked_user) rows.push(h("div.ct-about", h("div.ct-about-k", "Account"), h("div.ct-about-v", `${p.linked_user.name} (@${p.linked_user.username})`)));
    const when = fmtDay(p.created_on.slice(0, 10));
    const from = p.sources.filter((s) => s !== "manual").map((s) => ctx.boot.import_formats[s] || s);
    const meta = `Added ${["Today", "Yesterday"].includes(when) ? when.toLowerCase() : when}` + (from.length ? ` · imported from ${from.join(", ")}` : "");
    return card("About", null, rows.length ? h("div.ct-abouts", rows) : h("p.ct-none", "Add how you met, notes or custom fields with Edit."), h("p.ct-meta", meta));
}

// ------------------------------------------------------------------ keep in touch

function kitCard(p, ctx) {
    const sel = h("select.form-select.form-select-sm", {
        "aria-label": "Keep in touch",
        onchange: async (e) => {
            const v = e.target.value ? Number(e.target.value) : null;
            try { ctx.updated(await api("PATCH", p.id, { keep_in_touch_days: v })); } catch (err) { toast(err.message, { error: true }); }
        },
    }, h("option", { value: "" }, "Off"), KIT.map(([d, l]) => h("option", { value: d }, l)));
    if (p.keep_in_touch_days && !KIT.some(([d]) => d === p.keep_in_touch_days)) {
        sel.append(h("option", { value: p.keep_in_touch_days }, `Every ${p.keep_in_touch_days} days`));
    }
    sel.value = p.keep_in_touch_days || "";
    let status = null;
    if (p.next_due) {
        const d = daysFromToday(p.next_due);
        status = h("div.ct-kit-status" + (d <= 0 ? ".ct-due" : ""),
            d < 0 ? `Overdue by ${plural(-d, "day")}` : d === 0 ? "Due today" : `Next catch-up ${fmtDay(p.next_due).toLowerCase().startsWith("tomorrow") ? "tomorrow" : "in " + plural(d, "day")}`);
    }
    const last = p.last_contacted ? `Last in touch ${fmtDay(p.last_contacted).toLowerCase()}` : "No interactions logged";
    return card("Keep in touch", null, h("div.ct-kit", sel, h("div.ct-kit-text", status, h("div.ct-kit-last", last))));
}

// ------------------------------------------------------------------ timeline

function logForm(p, ctx, existing, onDone) {
    let kind = existing?.kind || "call";
    const kinds = h("div.ct-seg", { role: "radiogroup", "aria-label": "Kind" });
    const paint = () => { for (const b of kinds.children) { b.classList.toggle("on", b.dataset.k === kind); b.setAttribute("aria-checked", String(b.dataset.k === kind)); } };
    for (const k of ctx.boot.interaction_kinds) {
        kinds.append(h("button", { type: "button", role: "radio", dataset: { k }, title: KIND_LABEL[k], onclick: () => { kind = k; paint(); } }, icon(k, 14), h("span", KIND_LABEL[k])));
    }
    paint();
    const date = h("input.form-control.form-control-sm.ct-log-date", { type: "date", value: existing?.date || todayKey(), max: "2100-12-31", "aria-label": "Date", required: true });
    const summary = h("input.form-control.form-control-sm", { placeholder: "What happened? e.g. Coffee, talked about the Rust job", maxLength: 500, required: true, value: existing?.summary || "", "aria-label": "Summary" });
    const notes = h("textarea.form-control.form-control-sm", { placeholder: "Notes (optional)", rows: 2, maxLength: 20000, value: existing?.notes || "", "aria-label": "Notes", hidden: !existing?.notes });
    const moreBtn = h("button.btn.btn-link.btn-sm.p-0", { type: "button", hidden: !!existing?.notes, onclick: () => { notes.hidden = false; moreBtn.hidden = true; notes.focus(); } }, "Add notes");
    const form = h("form.ct-log", {
        onsubmit: async (e) => {
            e.preventDefault();
            const body = { kind, date: date.value, summary: summary.value.trim(), notes: notes.value.trim() };
            if (!body.summary) { summary.focus(); return; }
            try {
                if (existing) await api("PATCH", `interactions/${existing.id}`, body);
                else await api("POST", `${p.id}/interactions`, body);
                ctx.updated(await api("GET", p.id));
                if (!existing) toast("Logged");
                onDone?.();
            } catch (err) { toast(err.message, { error: true }); }
        },
    }, kinds, h("div.ct-log-row", date, summary), notes,
    h("div.ct-log-actions", moreBtn, h("div.ct-grow"),
        existing ? h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => onDone?.() }, "Cancel") : null,
        h("button.btn.btn-sm.btn-primary", { type: "submit" }, existing ? "Save" : "Log interaction")));
    return form;
}

function timelineCard(p, ctx) {
    const list = h("ol.ct-timeline");
    for (const i of p.interactions) {
        const li = h("li.ct-tl");
        const view = () => clear(li,
            h("span.ct-tl-ico", { title: KIND_LABEL[i.kind] }, icon(i.kind, 14)),
            h("div.ct-tl-body",
                h("div.ct-tl-summary", i.summary),
                h("div.ct-tl-meta", `${KIND_LABEL[i.kind]} · ${fmtDay(i.date)}`),
                i.notes ? h("div.ct-tl-notes.ct-pre", i.notes) : null),
            h("div.ct-tl-actions",
                h("button.ct-icon-btn.ct-icon-sm", { type: "button", title: "Edit", "aria-label": "Edit interaction", onclick: () => clear(li, logForm(p, ctx, i, view)) }, icon("edit", 14)),
                h("button.ct-icon-btn.ct-icon-sm", {
                    type: "button", title: "Delete", "aria-label": "Delete interaction",
                    onclick: async () => {
                        if (!confirm("Delete this interaction?")) return;
                        try { await api("DELETE", `interactions/${i.id}`); ctx.updated(await api("GET", p.id)); } catch (e) { toast(e.message, { error: true }); }
                    },
                }, icon("trash", 14))));
        view();
        list.append(li);
    }
    return card("Timeline", null, logForm(p, ctx), p.interactions.length ? list : h("p.ct-none", "No interactions yet."));
}

// ------------------------------------------------------------------ relationships

function relationsCard(p, ctx) {
    const rows = p.relationships.map((r) => h("li.ct-rel",
        h("span.ct-rel-kind", relLabel(r.kind)),
        h("button.ct-link", { type: "button", onclick: () => ctx.open(r.other_id) }, r.other_name),
        h("button.ct-icon-btn.ct-icon-sm", {
            type: "button", title: "Remove", "aria-label": `Remove ${relLabel(r.kind)} ${r.other_name}`,
            onclick: async () => { try { await api("DELETE", `relationships/${r.id}`); ctx.updated(await api("GET", p.id)); } catch (e) { toast(e.message, { error: true }); } },
        }, icon("x", 14))));
    const addBtn = h("button.ct-icon-btn.ct-icon-sm", { type: "button", title: "Add relationship", "aria-label": "Add relationship", onclick: () => { form.hidden = !form.hidden; if (!form.hidden) input.focus(); } }, icon("plus", 14));
    const kind = h("select.form-select.form-select-sm", { "aria-label": "Relationship" }, ctx.boot.relationship_kinds.map((k) => h("option", { value: k }, relLabel(k))));
    kind.value = "friend";
    const input = h("input.form-control.form-control-sm", { type: "search", placeholder: "Search contacts", autocomplete: "off", "aria-label": "Contact" });
    const results = h("ul.ct-suggest");
    let t;
    input.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(async () => {
            const q = input.value.trim();
            if (!q) { clear(results); return; }
            const items = (await ctx.search(q)).filter((x) => x.id !== p.id);
            clear(results, items.length ? items.map((x) => h("li", h("button", {
                type: "button",
                onclick: async () => {
                    try {
                        await api("POST", `${p.id}/relationships`, { other_id: x.id, kind: kind.value });
                        ctx.updated(await api("GET", p.id));
                    } catch (e) { toast(e.message, { error: true }); }
                },
            }, avatar(x, "xs"), h("span", x.name), h("span.app-muted", x.company || "")))) : h("li.ct-none", "No matches"));
        }, 150);
    });
    const form = h("div.ct-rel-form", { hidden: true }, h("div.ct-rel-inputs", kind, input), results);
    return card("Relationships", addBtn, form, rows.length ? h("ul.ct-rels", rows) : h("p.ct-none", "No relationships yet."));
}

// ------------------------------------------------------------------ actions

async function remove(p, ctx) {
    if (!confirm(`Delete ${p.name}? Their interactions are deleted too.`)) return;
    try { await api("DELETE", p.id); ctx.deleted(p.name); } catch (e) { toast(e.message, { error: true }); }
}

async function uploadPhoto(p, file, ctx) {
    if (!file) return;
    if (file.size > 2_000_000) { toast("Photos can be up to 2 MB", { error: true }); return; }
    const fd = new FormData();
    fd.append("file", file);
    try { ctx.updated(await api("POST", `${p.id}/avatar`, fd)); } catch (e) { toast(e.message, { error: true }); }
}

async function removePhoto(p, ctx) {
    try { ctx.updated(await api("DELETE", `${p.id}/avatar`)); } catch (e) { toast(e.message, { error: true }); }
}

// ------------------------------------------------------------------ editor

const LABELS = { email: ["home", "work", "other"], phone: ["mobile", "home", "work", "main", "fax", "other"], address: ["home", "work", "other"] };

function field(label, input, cls = "") {
    const id = "ct-f-" + Math.random().toString(36).slice(2, 9);
    input.id = id;
    return h("div.ct-field" + cls, h("label.form-label", { for: id }, label), input);
}

function text(name, value, opts = {}) {
    return h("input.form-control.form-control-sm", { name, value: value || "", maxLength: opts.max || 200, placeholder: opts.placeholder || "", type: opts.type || "text", autocomplete: "off" });
}

function datalist(id, values) {
    return h("datalist", { id }, values.map((v) => h("option", { value: v })));
}

/** A repeatable list of rows (emails, phones, addresses, links, custom fields). */
function repeater(title, items, makeRow, blank, addLabel) {
    const list = h("div.ct-rep-list");
    const add = (item) => {
        const rowEl = h("div.ct-rep-row");
        const remove = h("button.ct-icon-btn.ct-icon-sm", { type: "button", title: "Remove", "aria-label": "Remove", onclick: () => rowEl.remove() }, icon("x", 14));
        rowEl.append(...makeRow(item), remove);
        list.append(rowEl);
        return rowEl;
    };
    items.forEach(add);
    const btn = h("button.btn.btn-link.btn-sm.ct-rep-add", { type: "button", onclick: () => { const r = add(blank()); r.querySelector("input")?.focus(); } }, icon("plus", 14), addLabel);
    const sec = h("fieldset.ct-fs", h("legend", title), list, btn);
    sec.collect = () => [...list.children];
    return sec;
}

export function renderEditor(el, p, ctx) {
    const isNew = !p;
    p = p || { first_name: "", last_name: "", emails: [], phones: [], addresses: [], profiles: {}, links: [], custom_fields: [], tags: [], groups: [], birthday: "" };
    const nets = ctx.boot.networks;
    const err = h("div.alert.alert-danger.ct-form-err", { role: "alert", hidden: true });

    const names = {
        prefix: text("prefix", p.prefix, { max: 32 }), first_name: text("first_name", p.first_name, { max: 128 }),
        middle_name: text("middle_name", p.middle_name, { max: 128 }), last_name: text("last_name", p.last_name, { max: 128 }),
        suffix: text("suffix", p.suffix, { max: 32 }), nickname: text("nickname", p.nickname, { max: 128 }),
        display_name: text("display_name", p.display_name, { placeholder: "Defaults to first and last name" }),
        company: text("company", p.company), title: text("title", p.title), department: text("department", p.department),
    };
    const moreNames = h("div.ct-grid-3", { hidden: !(p.prefix || p.middle_name || p.suffix || p.display_name) },
        field("Prefix", names.prefix), field("Middle name", names.middle_name), field("Suffix", names.suffix),
        field("Display name", names.display_name, ".ct-span-3"));

    const emails = repeater("Email", p.emails, (e) => [
        h("input.form-control.form-control-sm.ct-rep-label", { value: e.label || "", list: "ct-dl-email", placeholder: "Label", maxLength: 40, "aria-label": "Label" }),
        h("input.form-control.form-control-sm", { type: "email", value: e.value || "", placeholder: "name@example.com", maxLength: 254, "aria-label": "Email" })],
    () => ({ label: "", value: "" }), "Add email");
    const phones = repeater("Phone", p.phones, (t) => [
        h("input.form-control.form-control-sm.ct-rep-label", { value: t.label || "", list: "ct-dl-phone", placeholder: "Label", maxLength: 40, "aria-label": "Label" }),
        h("input.form-control.form-control-sm", { type: "tel", value: t.value || "", placeholder: "+1 555 0100", maxLength: 40, "aria-label": "Phone" })],
    () => ({ label: "", value: "" }), "Add phone");
    const addresses = repeater("Address", p.addresses, (a) => [
        h("input.form-control.form-control-sm.ct-rep-label", { value: a.label || "", list: "ct-dl-address", placeholder: "Label", maxLength: 40, "aria-label": "Label" }),
        h("div.ct-addr",
            h("input.form-control.form-control-sm.ct-span-2", { value: a.street || "", placeholder: "Street", maxLength: 300, "aria-label": "Street", dataset: { k: "street" } }),
            h("input.form-control.form-control-sm", { value: a.city || "", placeholder: "City", maxLength: 200, "aria-label": "City", dataset: { k: "city" } }),
            h("input.form-control.form-control-sm", { value: a.region || "", placeholder: "State / region", maxLength: 200, "aria-label": "Region", dataset: { k: "region" } }),
            h("input.form-control.form-control-sm", { value: a.postcode || "", placeholder: "Postal code", maxLength: 32, "aria-label": "Postal code", dataset: { k: "postcode" } }),
            h("input.form-control.form-control-sm", { value: a.country || "", placeholder: "Country", maxLength: 200, "aria-label": "Country", dataset: { k: "country" } }))],
    () => ({}), "Add address");

    // Birthday: month + day, year optional
    let by = "", bm = "", bd = "";
    if (p.birthday) {
        const parts = p.birthday.startsWith("--") ? ["", ...p.birthday.slice(2).split("-")] : p.birthday.split("-");
        [by, bm, bd] = [parts[0], String(Number(parts[1])), String(Number(parts[2]))];
    }
    const bMonth = h("select.form-select.form-select-sm", { "aria-label": "Birthday month" }, h("option", { value: "" }, "Month"), MONTHS.map((m, i) => h("option", { value: i + 1 }, m)));
    bMonth.value = bm;
    const bDay = h("input.form-control.form-control-sm", { type: "number", min: 1, max: 31, value: bd, placeholder: "Day", "aria-label": "Birthday day" });
    const bYear = h("input.form-control.form-control-sm", { type: "number", min: 1000, max: 2100, value: by, placeholder: "Year (optional)", "aria-label": "Birthday year" });
    const anniversary = h("input.form-control.form-control-sm", { type: "date", value: p.anniversary || "" });

    const profInputs = {};
    const showAll = nets.some((n) => n.group !== "dev" && n.group !== "web" && p.profiles[n.key]);
    const profGrid = h("div.ct-prof-grid");
    for (const n of nets) {
        const inp = h("input.form-control.form-control-sm", {
            value: p.profiles[n.key] || "", maxLength: 500, autocomplete: "off", spellcheck: false,
            placeholder: n.kind === "url" ? "https://…" : n.key === "mastodon" ? "user@instance.social" : n.key === "matrix" ? "@user:matrix.org" : "handle or profile link",
        });
        profInputs[n.key] = inp;
        const wrap = field(n.label, inp, ".ct-prof-field");
        wrap.querySelector("label").prepend(mark(n.key, 14));
        if (!["dev", "web"].includes(n.group) && !showAll && !p.profiles[n.key]) wrap.dataset.extra = "1";
        profGrid.append(wrap);
    }
    const toggleNets = h("button.btn.btn-link.btn-sm.p-0", {
        type: "button", hidden: showAll,
        onclick: () => { profGrid.querySelectorAll("[data-extra]").forEach((x) => delete x.dataset.extra); toggleNets.hidden = true; },
    }, "Show social and chat networks");

    const links = repeater("Other links", p.links, (l) => [
        h("input.form-control.form-control-sm.ct-rep-label", { value: l.label || "", placeholder: "Label", maxLength: 40, "aria-label": "Label" }),
        h("input.form-control.form-control-sm", { type: "url", value: l.url || "", placeholder: "https://…", maxLength: 500, "aria-label": "URL" })],
    () => ({ label: "", url: "" }), "Add link");
    const custom = repeater("Custom fields", p.custom_fields, (c) => [
        h("input.form-control.form-control-sm.ct-rep-label", { value: c.key || "", placeholder: "Field", maxLength: 64, "aria-label": "Field name" }),
        h("input.form-control.form-control-sm", { value: c.value || "", placeholder: "Value", maxLength: 1000, "aria-label": "Value" })],
    () => ({ key: "", value: "" }), "Add field");

    const tags = text("tags", p.tags.join(", "), { max: 2000, placeholder: "rust, climbing, conference-2026" });
    const groups = text("groups", p.groups.join(", "), { max: 2000, placeholder: "Family, Work" });
    const howMet = h("textarea.form-control.form-control-sm", { rows: 2, maxLength: 20000, value: p.how_met || "" });
    const notes = h("textarea.form-control.form-control-sm", { rows: 4, maxLength: 20000, value: p.notes || "" });
    const username = text("username", p.linked_user?.username || "", { max: 150, placeholder: "Their username here, if they have an account" });
    const favorite = h("input.form-check-input", { type: "checkbox", checked: !!p.favorite, id: "ct-f-fav" });
    const kit = h("select.form-select.form-select-sm", h("option", { value: "" }, "Off"), KIT.map(([d, l]) => h("option", { value: d }, l)));
    if (p.keep_in_touch_days && !KIT.some(([d]) => d === p.keep_in_touch_days)) kit.append(h("option", { value: p.keep_in_touch_days }, `Every ${p.keep_in_touch_days} days`));
    kit.value = p.keep_in_touch_days || "";

    const split = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
    const vals = (rowEl) => [...rowEl.querySelectorAll("input")].map((i) => i.value.trim());

    const save = h("button.btn.btn-primary.btn-sm", { type: "submit" }, isNew ? "Create" : "Save");
    const form = h("form.ct-editor", {
        novalidate: true,
        onsubmit: async (e) => {
            e.preventDefault();
            err.hidden = true;
            let birthday = "";
            if (bMonth.value && bDay.value) {
                const md = `${String(bMonth.value).padStart(2, "0")}-${String(bDay.value).padStart(2, "0")}`;
                birthday = bYear.value ? `${String(bYear.value).padStart(4, "0")}-${md}` : `--${md}`;
            }
            const body = {
                ...Object.fromEntries(Object.entries(names).map(([k, i]) => [k, i.value.trim()])),
                emails: emails.collect().map((r) => { const [label, value] = vals(r); return { label, value }; }).filter((x) => x.value),
                phones: phones.collect().map((r) => { const [label, value] = vals(r); return { label, value }; }).filter((x) => x.value),
                addresses: addresses.collect().map((r) => {
                    const a = { label: r.querySelector(".ct-rep-label").value.trim() };
                    r.querySelectorAll("[data-k]").forEach((i) => { a[i.dataset.k] = i.value.trim(); });
                    return a;
                }),
                profiles: Object.fromEntries(Object.entries(profInputs).map(([k, i]) => [k, i.value.trim()]).filter(([, v]) => v)),
                links: links.collect().map((r) => { const [label, url] = vals(r); return { label, url }; }).filter((x) => x.url),
                custom_fields: custom.collect().map((r) => { const [key, value] = vals(r); return { key, value }; }).filter((x) => x.key),
                birthday, anniversary: anniversary.value || null,
                tags: split(tags.value), groups: split(groups.value),
                how_met: howMet.value.trim(), notes: notes.value.trim(),
                username: username.value.trim(), favorite: favorite.checked,
                keep_in_touch_days: kit.value ? Number(kit.value) : null,
            };
            save.disabled = true;
            try {
                const saved = isNew ? await api("POST", "", body) : await api("PATCH", p.id, body);
                toast(isNew ? `Added ${saved.name}` : "Saved");
                ctx.saved(saved);
            } catch (ex) {
                err.textContent = ex.message;
                err.hidden = false;
                err.scrollIntoView({ block: "nearest" });
            } finally { save.disabled = false; }
        },
    },
    h("div.ct-d-top",
        h("button.ct-icon-btn.ct-back", { type: "button", title: "Back", "aria-label": "Cancel", onclick: () => ctx.cancelEdit() }, icon("chevL")),
        h("h2.ct-ed-title", isNew ? "New contact" : `Edit ${p.name}`), h("div.ct-grow"),
        h("button.btn.btn-sm.btn-outline-secondary", { type: "button", onclick: () => ctx.cancelEdit() }, "Cancel"), save),
    err,
    datalist("ct-dl-email", LABELS.email), datalist("ct-dl-phone", LABELS.phone), datalist("ct-dl-address", LABELS.address),
    h("fieldset.ct-fs", h("legend", "Name"),
        h("div.ct-grid-2", field("First name", names.first_name), field("Last name", names.last_name)),
        h("button.btn.btn-link.btn-sm.p-0.ct-more-names", { type: "button", hidden: !moreNames.hidden, onclick: (e) => { moreNames.hidden = false; e.target.hidden = true; } }, "Prefix, middle name, suffix, display name"),
        moreNames,
        h("div.ct-grid-3", field("Nickname", names.nickname), field("Company", names.company), field("Title / role", names.title)),
        h("div.ct-grid-3", field("Department", names.department),
            h("div.ct-field", h("span.form-label", "Favorite"), h("div.form-check.form-switch.m-0", favorite, h("label.form-check-label", { for: "ct-f-fav" }, "Starred"))))),
    emails, phones, addresses,
    h("fieldset.ct-fs", h("legend", "Dates"),
        h("div.ct-grid-bday", h("div.ct-field", h("span.form-label", "Birthday"), h("div.ct-bday", bMonth, bDay, bYear)), field("Anniversary", anniversary))),
    h("fieldset.ct-fs", h("legend", "Profiles"), h("p.ct-help", "Paste a handle or a profile link; we keep the handle and build the link."), profGrid, toggleNets),
    links,
    h("fieldset.ct-fs", h("legend", "Organise"),
        h("div.ct-grid-2", field("Groups", groups), field("Tags", tags)),
        h("div.ct-grid-2", field("Keep in touch", kit), field("Linked account", username))),
    h("fieldset.ct-fs", h("legend", "Notes"), field("How we met", howMet), field("Notes", notes)),
    custom);
    clear(el, h("div.ct-detail", form));
    el.scrollTop = 0;
    (isNew ? names.first_name : null)?.focus();
}
