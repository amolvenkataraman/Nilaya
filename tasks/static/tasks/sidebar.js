/* Left sidebar: smart views with counts, the project tree (drag to reorder / nest), labels and saved views.
 * Also the project, label and sharing dialogs, which the header reuses. */

import { $, h, clear, icon, menu, dialog, confirmDialog, toast, api, draggable, between, store, avatar } from "./lib.js";
import { S, app, emit, project, isOwner, refreshCounts, refreshProjects, loadMembers, health, retryNow, COLOURS } from "./store.js";

export const SMART = [
    { id: "inbox", label: "Inbox", icon: "inbox", count: "inbox" },
    { id: "today", label: "Today", icon: "today", count: "today" },
    { id: "upcoming", label: "Upcoming", icon: "upcoming", count: "upcoming" },
    { id: "overdue", label: "Overdue", icon: "overdue", count: "overdue", alert: true },
    { id: "nodate", label: "No date", icon: "nodate", count: "no_date" },
    { id: "favorites", label: "Favorites", icon: "star", count: "favorites" },
    { id: "assigned", label: "Assigned to me", icon: "user", count: "assigned" },
    { id: "done", label: "Done", icon: "done", count: "done_this_week", hint: "completed in the last 7 days" },
];

const isActive = (scope, id) => S.route.scope === scope && S.route.id === id;

/** On phones the sidebar overlays the page: close it after picking something. */
function closeOverlay() {
    if (matchMedia("(max-width: 900px)").matches && window.updateSidebars) {
        window.left_sb = false;
        window.updateSidebars(false, window.right_sb);
    }
}

function navLink(params, kids, extra = {}) {
    return h("a.tk-nav-link", {
        href: app.href(params), ...extra,
        onclick: (e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
            e.preventDefault();
            app.go(params);
            closeOverlay();
        },
    }, kids);
}

const retryNote = (text) => h("li.tk-side-warn", { role: "status" }, h("span", text),
    h("button.tk-link-btn", { type: "button", onclick: () => retryNow() }, health.retrying ? "Retrying…" : "Retry"));

export function renderSidebar() {
    const ov = S.overview || {};
    const failing = ["meta", "counts", "projects"].some((k) => health.failures.has(k));
    clear($("#tk-smart"), failing ? retryNote(S.overview ? (S.metaStale ? "Saved copy · counts may be old" : "Counts may be out of date") : "Couldn't load counts") : null,
        SMART.map((v) => {
        const isInbox = v.id === "inbox";
        const active = isInbox ? isActive("project", ov.inbox_id) : isActive("view", v.id);
        const n = ov[v.count] || 0;
        return h("li", navLink(isInbox ? (ov.inbox_id ? { project: ov.inbox_id } : { view: "inbox" }) : { view: v.id }, [
            icon(v.icon, 16, "tk-nav-ico"), h("span.tk-nav-label", v.label),
            n ? h("span.tk-count" + (v.alert ? ".is-alert" : ""), { title: v.hint || null }, String(n)) : null,
        ], { "aria-current": active ? "page" : null, class: active ? "is-active" : null, dataset: isInbox ? { pid: ov.inbox_id } : {} }));
    }));
    renderProjects();
    renderLabels();
    renderViews();
    $("#tk-archived-toggle").textContent = S.showArchived ? "Hide archived" : "Show archived";
}

// ------------------------------------------------------------------ projects

function children(parentId) {
    return S.projects.filter((p) => !p.is_inbox && (p.parent_id || null) === parentId &&
        (parentId || !S.projects.some((q) => q.id === p.parent_id)))
        .sort((a, b) => (b.favorite - a.favorite) || a.position - b.position || a.name.localeCompare(b.name));
}

function renderProjects() {
    const tree = $("#tk-projects");
    const build = (parentId, depth) => children(parentId).map((p) => {
        const kids = children(p.id);
        const open = !S.collapsedProjects.has(p.id);
        const active = isActive("project", p.id);
        const row = h("div.tk-proj-row", { dataset: { pid: p.id }, style: { "--depth": depth }, class: active ? "is-active" : null },
            kids.length ? h("button.tk-twisty.tk-nodrag", {
                type: "button", "aria-label": open ? "Collapse" : "Expand", "aria-expanded": String(open),
                onclick: () => {
                    S.collapsedProjects[open ? "add" : "delete"](p.id);
                    store.set("collapsedProjects", [...S.collapsedProjects]);
                    renderProjects();
                },
            }, icon(open ? "chevD" : "chevR", 12)) : h("span.tk-twisty"),
            navLink({ project: p.id }, [
                h("span.tk-dot", { style: { background: p.colour || "var(--app-muted)" } }),
                h("span.tk-nav-label", p.name),
                p.shared ? icon("share", 12, "tk-proj-shared") : null,
                p.archived ? h("span.tk-tag", "Archived") : null,
                p.open_count ? h("span.tk-count", String(p.open_count)) : null,
            ], { "aria-current": active ? "page" : null, draggable: "false" }),
            h("button.tk-icon-btn.tk-row-more.tk-nodrag", {
                type: "button", "aria-label": `${p.name} options`, onclick: (e) => projectMenu(e.currentTarget, p),
            }, icon("more", 14)));
        return h("li", { role: "treeitem", "aria-expanded": kids.length ? String(open) : null }, row,
            kids.length && open ? h("ul", { role: "group" }, build(p.id, depth + 1)) : null);
    });
    const items = build(null, 0);
    clear(tree, items.length ? items : !S.overview && health.failures.has("meta") ? retryNote("Couldn't load projects") : h("li.tk-side-empty", "No projects yet"));
}

export function projectMenu(anchor, p) {
    const admin = p.role >= 2;
    menu(anchor, [
        { label: "Edit project…", icon: "edit", onClick: () => projectDialog(p), disabled: !admin },
        !p.is_inbox && { label: "Add subproject…", icon: "plus", onClick: () => projectDialog(null, p.id), disabled: !admin },
        !p.is_inbox && { label: "Share…", icon: "share", onClick: () => shareDialog(p) },
        { label: p.favorite ? "Remove from favorites" : "Add to favorites", icon: "star", disabled: !admin,
          onClick: () => patchProject(p, { favorite: !p.favorite }) },
        !p.is_inbox && { sep: true },
        !p.is_inbox && { label: p.archived ? "Unarchive" : "Archive", icon: "archive", disabled: !admin,
          onClick: () => patchProject(p, { archived: !p.archived }).then(() => toast(p.archived ? "Project archived" : "Project restored")) },
        !p.is_inbox && { label: "Delete project…", icon: "trash", danger: true, disabled: !isOwner(p), onClick: () => deleteProject(p) },
    ]);
}

export async function patchProject(p, patch) {
    try {
        Object.assign(p, await api("PATCH", `projects/${p.id}`, patch));
        emit("meta");
        if ("archived" in patch) refreshCounts();  // archived projects drop out of the smart-view counts
    } catch (e) { toast(e.message, { error: true }); throw e; }
}

async function deleteProject(p) {
    const n = p.open_count;
    if (!await confirmDialog("Delete project", `Delete “${p.name}”${n ? ` and its ${n} open task${n > 1 ? "s" : ""}` : ""}? Subprojects are deleted too. This can't be undone.`)) return;
    try {
        await api("DELETE", `projects/${p.id}`);
        const gone = new Set([p.id]);
        for (let grew = true; grew;) { grew = false; for (const x of S.projects) if (gone.has(x.parent_id) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }
        S.projects = S.projects.filter((x) => !gone.has(x.id));
        if (S.route.scope === "project" && gone.has(S.route.id)) app.go({ project: S.overview.inbox_id });
        emit("meta");
        refreshCounts();
        toast("Project deleted");
    } catch (e) { toast(e.message, { error: true }); }
}

function swatches(name, current, colours = COLOURS) {
    return h("div.tk-swatches", { role: "radiogroup", "aria-label": "Colour" },
        ["", ...colours].map((c) => h("label.tk-swatch", { title: c || "No colour" },
            h("input", { type: "radio", name, value: c, checked: (current || "") === c }),
            h("span", { style: { background: c || "transparent" }, class: c ? null : "is-none" }))));
}

export async function projectDialog(p = null, parentId = null) {
    const name = h("input.form-control.form-control-sm", { id: "tk-pd-name", maxlength: 128, required: true, value: p?.name || "" });
    const parent = h("select.form-select.form-select-sm", { id: "tk-pd-parent" },
        h("option", { value: "" }, "No parent"),
        S.projects.filter((x) => !x.is_inbox && x.id !== p?.id && x.role >= 2).map((x) => h("option", { value: x.id }, x.name)));
    parent.value = p?.parent_id || parentId || "";
    const view = h("select.form-select.form-select-sm", { id: "tk-pd-view" },
        ["list", "board", "table", "calendar"].map((v) => h("option", { value: v }, v[0].toUpperCase() + v.slice(1))));
    view.value = p?.default_view || "list";
    const desc = h("textarea.form-control.form-control-sm", { id: "tk-pd-desc", rows: 2, maxlength: 2000 }, p?.description || "");
    const body = h("div.tk-form",
        h("label.form-label", { for: "tk-pd-name" }, "Name"), name,
        h("div.form-label", "Colour"), swatches("tk-pd-colour", p?.colour),
        !p?.is_inbox && [h("label.form-label", { for: "tk-pd-parent" }, "Parent project"), parent],
        h("label.form-label", { for: "tk-pd-view" }, "Default view"), view,
        h("label.form-label", { for: "tk-pd-desc" }, "Description"), desc);
    const saved = await dialog({
        title: p ? "Edit project" : "New project", body,
        actions: [{ label: "Cancel" }, { label: p ? "Save" : "Create project", primary: true }],
        onSubmit: async () => {
            const data = {
                name: name.value.trim(), colour: body.querySelector("input[name=tk-pd-colour]:checked")?.value || "",
                default_view: view.value, description: desc.value,
            };
            if (!data.name) { name.focus(); return false; }
            if (!p?.is_inbox) data.parent_id = parent.value || null;
            return p ? api("PATCH", `projects/${p.id}`, data) : api("POST", "projects", data);
        },
    });
    if (!saved) return;
    if (p) Object.assign(p, saved); else S.projects.push(saved);
    emit("meta");
    if (!p) app.go({ project: saved.id });
    toast(p ? "Project saved" : `Created “${saved.name}”`);
}

export async function shareDialog(p) {
    const list = h("ul.tk-members");
    const ROLES = [[0, "Can view"], [1, "Can edit"], [2, "Admin"]];
    const roleSelect = (value, onchange) => {
        const s = h("select.form-select.form-select-sm.tk-role", { "aria-label": "Role", onchange }, ROLES.map(([v, l]) => h("option", { value: v }, l)));
        s.value = String(value);
        return s;
    };
    const draw = async (fetch = true) => {
        let members;
        try { members = fetch ? await loadMembers(p.id, true) : S.members.get(p.id) || []; }
        catch (err) { clear(list, h("li.app-muted", `Couldn't load people: ${err.message}`)); return; }
        p.shared = !isOwner(p) || members.length > 0;
        emit("meta");
        clear(list, members.length ? members.map((m) => h("li",
            avatar(m.user), h("span.tk-member-name", m.user.name, h("span.app-muted", ` @${m.user.username}`)),
            p.role >= 2 ? roleSelect(m.role, async (e) => {
                try { await api("POST", `projects/${p.id}/members`, { username: m.user.username, role: +e.target.value }); toast("Role updated"); }
                catch (err) { toast(err.message, { error: true }); }
            }) : h("span.app-muted", ROLES[m.role][1]),
            (p.role >= 2 || m.user.username === S.me.username) ? h("button.tk-icon-btn", {
                type: "button", "aria-label": `Remove ${m.user.username}`,
                onclick: async () => {
                    try {
                        await api("DELETE", `projects/${p.id}/members/${m.id}`);
                        S.members.set(p.id, S.members.get(p.id).filter((x) => x.id !== m.id));
                        draw(false);
                    }
                    catch (err) { toast(err.message, { error: true }); }
                },
            }, icon("x", 14)) : null)) : h("li.app-muted", "Only you have access."));
    };
    const username = h("input.form-control.form-control-sm", { id: "tk-share-user", placeholder: "Username", autocomplete: "off", spellcheck: false });
    const role = roleSelect(1);
    const add = h("div.tk-share-add", username, role,
        h("button.btn.btn-sm.btn-primary", {
            type: "button",
            onclick: async () => {
                const u = username.value.trim().replace(/^@/, "");
                if (!u) return username.focus();
                try {
                    const m = await api("POST", `projects/${p.id}/members`, { username: u, role: +role.value });
                    S.members.set(p.id, [...(S.members.get(p.id) || []).filter((x) => x.id !== m.id), m]);
                    username.value = "";
                    toast(`Shared with @${u}`);
                    draw(false);
                } catch (err) { toast(err.status === 404 ? `No user called @${u}` : err.message, { error: true }); }
            },
        }, "Invite"));
    username.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add.querySelector("button").click(); } });
    draw();
    await dialog({
        title: `Share “${p.name}”`,
        body: h("div.tk-form", p.role >= 2 ? [h("label.form-label", { for: "tk-share-user" }, "Add people"), add] : null,
            h("div.form-label.mt-2", "People with access"), list),
    });
}

// ------------------------------------------------------------------ project drag & drop

export function setupProjectDrag() {
    const tree = $("#tk-projects");
    let marker = null;
    const clearMarks = () => { tree.querySelectorAll(".drop-before,.drop-after,.drop-inside").forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-inside")); };
    draggable(tree, {
        selector: ".tk-proj-row",
        onStart: (el) => {
            const p = project(el.dataset.pid);
            return p && p.role >= 2 ? { p } : null;
        },
        onMove: (ctx, { y, target }) => {
            clearMarks();
            marker = null;
            const row = target?.closest(".tk-proj-row");
            if (!row || !tree.contains(row) || row.dataset.pid === ctx.p.id) return;
            const r = row.getBoundingClientRect(), f = (y - r.top) / r.height;
            const where = f < 0.3 ? "before" : f > 0.7 ? "after" : "inside";
            row.classList.add("drop-" + where);
            marker = { row, where };
        },
        onEnd: clearMarks,
        onDrop: async (ctx) => {
            if (!marker) return;
            const target = project(marker.row.dataset.pid);
            // Don't drop a project into its own subtree.
            for (let n = target; n; n = project(n.parent_id)) if (n.id === ctx.p.id) return;
            let patch;
            if (marker.where === "inside") {
                const sibs = children(target.id);
                patch = { parent_id: target.id, position: between(sibs.at(-1)?.position, null) };
                S.collapsedProjects.delete(target.id);
            } else {
                const sibs = children(target.parent_id || null).filter((x) => x.id !== ctx.p.id);
                const i = sibs.indexOf(target);
                const [a, b] = marker.where === "before" ? [sibs[i - 1], sibs[i]] : [sibs[i], sibs[i + 1]];
                patch = { parent_id: target.parent_id || null, position: between(a?.position, b?.position) };
            }
            Object.assign(ctx.p, patch);
            renderProjects();
            await patchProject(ctx.p, patch).catch(refreshProjects);
        },
    });
}

// ------------------------------------------------------------------ labels

function renderLabels() {
    clear($("#tk-labels"), S.labels.length ? S.labels.map((l) => {
        const active = isActive("label", String(l.id));
        return h("li", h("div.tk-proj-row", { class: active ? "is-active" : null },
            navLink({ label: l.id }, [icon("tag", 14, "tk-nav-ico tk-label-ico"), h("span.tk-nav-label", l.name)],
                { "aria-current": active ? "page" : null, style: { "--lc": l.colour || "var(--app-muted)" } }),
            h("button.tk-icon-btn.tk-row-more", {
                type: "button", "aria-label": `${l.name} options`,
                onclick: (e) => menu(e.currentTarget, [
                    { label: "Edit label…", icon: "edit", onClick: () => labelDialog(l) },
                    { label: "Delete label", icon: "trash", danger: true, onClick: () => deleteLabel(l) },
                ]),
            }, icon("more", 14))));
    }) : h("li.tk-side-empty", "Type *label in quick add"));
}

export async function labelDialog(l = null, presetName = "") {
    const name = h("input.form-control.form-control-sm", { id: "tk-ld-name", maxlength: 48, value: l?.name || presetName, required: true });
    const body = h("div.tk-form", h("label.form-label", { for: "tk-ld-name" }, "Name"), name,
        h("div.form-label", "Colour"), swatches("tk-ld-colour", l?.colour));
    const saved = await dialog({
        title: l ? "Edit label" : "New label", body,
        actions: [{ label: "Cancel" }, { label: l ? "Save" : "Create label", primary: true }],
        onSubmit: () => {
            const data = { name: name.value.trim(), colour: body.querySelector("input[name=tk-ld-colour]:checked")?.value || "" };
            if (!data.name) return false;
            return l ? api("PATCH", `labels/${l.id}`, data) : api("POST", "labels", data);
        },
    });
    if (!saved) return null;
    if (l) Object.assign(l, saved); else S.labels.push(saved);
    S.labels.sort((a, b) => a.name.localeCompare(b.name));
    emit("meta");
    emit("tasks");
    return saved;
}

async function deleteLabel(l) {
    if (!await confirmDialog("Delete label", `Delete the label “${l.name}”? It's removed from every task.`)) return;
    try {
        await api("DELETE", `labels/${l.id}`);
        S.labels = S.labels.filter((x) => x.id !== l.id);
        for (const t of S.byId.values()) t.labels = (t.labels || []).filter((id) => id !== l.id);
        if (isActive("label", String(l.id))) app.go({ view: "today" });
        emit("meta");
        emit("tasks");
    } catch (e) { toast(e.message, { error: true }); }
}

// ------------------------------------------------------------------ saved views

function renderViews() {
    clear($("#tk-views"), S.views.length ? S.views.map((v) => {
        const active = isActive("saved", v.id);
        return h("li", h("div.tk-proj-row", { class: active ? "is-active" : null },
            navLink({ saved: v.id }, [icon("filter", 14, "tk-nav-ico"), h("span.tk-nav-label", v.name)], { "aria-current": active ? "page" : null }),
            h("button.tk-icon-btn.tk-row-more", {
                type: "button", "aria-label": `${v.name} options`,
                onclick: (e) => savedViewMenu(e.currentTarget, v),
            }, icon("more", 14))));
    }) : h("li.tk-side-empty", "Filter a list, then “Save view”"));
}

export function savedViewMenu(anchor, v) {
    menu(anchor, [
        { label: "Rename…", icon: "edit", onClick: () => saveViewDialog(v) },
        { label: "Delete view", icon: "trash", danger: true, onClick: async () => {
            try {
                await api("DELETE", `views/${v.id}`);
                S.views = S.views.filter((x) => x.id !== v.id);
                if (isActive("saved", v.id)) app.go({ view: "today" });
                emit("meta");
            } catch (e) { toast(e.message, { error: true }); }
        } },
    ]);
}

export async function saveViewDialog(v = null, filters = null) {
    const name = h("input.form-control.form-control-sm", { id: "tk-vd-name", maxlength: 64, value: v?.name || "", required: true });
    const saved = await dialog({
        title: v ? "Rename view" : "Save view",
        body: h("div.tk-form", h("label.form-label", { for: "tk-vd-name" }, "Name"), name,
            !v && h("p.app-muted.small.mb-0", "Saves the current list, search, filters and sort.")),
        actions: [{ label: "Cancel" }, { label: "Save", primary: true }],
        onSubmit: () => {
            if (!name.value.trim()) return false;
            return v ? api("PATCH", `views/${v.id}`, { name: name.value.trim() })
                : api("POST", "views", { name: name.value.trim(), filters, position: S.views.length });
        },
    });
    if (!saved) return;
    if (v) Object.assign(v, saved); else S.views.push(saved);
    emit("meta");
    if (!v) app.go({ saved: saved.id });
}
