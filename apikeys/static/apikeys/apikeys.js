/* API keys page: list, create (token shown once), revoke; links to per-app guides. */
(function () {
    "use strict";
    const API = "/api/v2/keys/";
    const apps = JSON.parse(document.getElementById("ak-apps").textContent);
    const label = Object.fromEntries(apps.map((a) => [a.key, a.label]));
    const $ = (id) => document.getElementById(id);

    function csrf() {
        return decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || "");
    }
    async function call(method, url, body) {
        const r = await fetch(url, {
            method, credentials: "same-origin",
            headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!r.ok) {
            let msg = `Request failed (${r.status})`;
            try { const d = (await r.json()).detail; msg = typeof d === "string" ? d : msg; } catch (e) { /* not JSON */ }
            throw new Error(msg);
        }
        return r.status === 204 ? null : r.json();
    }
    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    const day = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const ago = (iso) => (window.notifTimeAgo ? window.notifTimeAgo(iso) : day(iso));

    function row(k) {
        const r = el("div", "ak-row");
        const info = el("div");
        info.append(el("div", "ak-name", k.name));
        const meta = el("div", "ak-meta");
        const prefix = el("code", "", `avn_${k.prefix}_…`);
        meta.append(prefix, el("span", "", `Created ${day(k.created_on)}`),
            el("span", "", k.last_used_on ? `Last used ${ago(k.last_used_on)}` : "Never used"));
        if (k.expires_on) {
            const expired = new Date(k.expires_on) <= new Date();
            meta.append(el("span", expired ? "ak-expired" : "", expired ? "Expired" : `Expires ${day(k.expires_on)}`));
        }
        info.append(meta);
        const chips = el("div", "ak-chips");
        k.scopes.forEach((s) => {
            const [app, level] = s.split(":");
            chips.append(el("span", "ak-chip" + (level === "write" ? " write" : ""), `${label[app] || app}: ${level === "write" ? "read & write" : "read"}`));
        });
        info.append(chips);
        const revoke = el("button", "btn btn-sm btn-outline-secondary", "Revoke");
        revoke.type = "button";
        revoke.addEventListener("click", async () => {
            if (revoke.dataset.confirm !== "1") {
                revoke.dataset.confirm = "1";
                revoke.textContent = "Click again to revoke";
                setTimeout(() => { revoke.dataset.confirm = ""; revoke.textContent = "Revoke"; }, 4000);
                return;
            }
            revoke.disabled = true;
            try { await call("DELETE", `${API}${k.id}`); load(); } catch (e) { revoke.disabled = false; revoke.textContent = e.message; }
        });
        r.append(info, revoke);
        return r;
    }

    async function load() {
        const list = $("ak-list");
        try {
            const keys = await call("GET", API);
            list.replaceChildren(...(keys.length ? keys.map(row) : [el("div", "ak-empty", "No keys yet. Create one to use the API from a script or another app.")]));
        } catch (e) {
            list.replaceChildren(el("div", "ak-empty", `Couldn't load your keys: ${e.message}`));
        }
    }

    // Create dialog
    const modalEl = $("ak-modal");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const scopes = $("ak-scopes");
    apps.forEach((a) => {
        const r = el("div", "ak-scope");
        const id = `ak-scope-${a.key}`;
        const lab = el("label", "", a.label);
        lab.htmlFor = id;
        const sel = el("select", "form-select form-select-sm");
        sel.id = id;
        sel.dataset.app = a.key;
        [["", "No access"], ["read", "Read"], ["write", "Read & write"]].forEach(([v, t]) => {
            const o = el("option", "", t); o.value = v; sel.append(o);
        });
        r.append(lab, sel);
        scopes.append(r);
    });
    $("ak-new").addEventListener("click", () => {
        $("ak-form").reset();
        $("ak-form").hidden = false;
        $("ak-created").hidden = true;
        $("ak-error").hidden = true;
        modal.show();
    });
    modalEl.addEventListener("shown.bs.modal", () => { if (!$("ak-form").hidden) $("ak-name").focus(); });
    modalEl.addEventListener("hidden.bs.modal", () => { $("ak-token").textContent = ""; });  // don't keep the secret in the page
    $("ak-form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const err = $("ak-error");
        const picked = [...scopes.querySelectorAll("select")].filter((s) => s.value).map((s) => `${s.dataset.app}:${s.value}`);
        const name = $("ak-name").value.trim();
        if (!name) { err.textContent = "Give the key a name so you can recognise it later."; err.hidden = false; return; }
        if (!picked.length) { err.textContent = "Choose at least one app the key can use."; err.hidden = false; return; }
        const days = $("ak-expiry").value;
        const expires_on = days ? new Date(Date.now() + Number(days) * 86400000).toISOString() : null;
        $("ak-create").disabled = true;
        try {
            const res = await call("POST", API, { name, scopes: picked, expires_on });
            $("ak-token").textContent = res.token;
            $("ak-form").hidden = true;
            $("ak-created").hidden = false;
            load();
        } catch (e) {
            err.textContent = e.message; err.hidden = false;
        } finally {
            $("ak-create").disabled = false;
        }
    });
    $("ak-copy").addEventListener("click", async () => {
        const btn = $("ak-copy");
        try { await navigator.clipboard.writeText($("ak-token").textContent); btn.textContent = "Copied"; }
        catch (e) { window.getSelection().selectAllChildren($("ak-token")); btn.textContent = "Press Ctrl+C"; }
        setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    });

    // Guides
    $("ak-guides").replaceChildren(...apps.map((a) => {
        const li = el("li", "ak-guide");
        li.append(el("span", "", a.label));
        const actions = el("span", "ak-guide-actions");
        const open = el("a", "btn btn-sm btn-outline-secondary", "Open");
        open.href = `/api/v2/${a.key}/guide.md`;
        open.target = "_blank";
        open.rel = "noopener";
        const copy = el("button", "btn btn-sm btn-outline-secondary", "Copy");
        copy.type = "button";
        copy.title = "Copy the Markdown guide to paste into an AI agent";
        copy.addEventListener("click", async () => {
            try {
                const r = await fetch(open.href, { credentials: "same-origin" });
                await navigator.clipboard.writeText(await r.text());
                copy.textContent = "Copied";
            } catch (e) { copy.textContent = "Open it instead"; }
            setTimeout(() => { copy.textContent = "Copy"; }, 2000);
        });
        actions.append(open, copy);
        li.append(actions);
        return li;
    }));

    load();
})();
