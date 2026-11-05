/* Photos shell (photos_base.html): the Ingest nav button and a small snackbar
 * other Photos pages reuse (phToast). Deferred, so the page markup exists. */

/* Bottom snackbar: phToast("Added 3 items", {label: "Undo", onClick: fn}). */
function phToast(message, action) {
    let el = document.getElementById("ph-toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "ph-toast";
        el.className = "ph-toast";
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        document.body.appendChild(el);
    }
    el.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    if (action) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = action.label;
        btn.addEventListener("click", () => { el.classList.remove("is-open"); action.onClick(); });
        el.appendChild(btn);
    }
    el.classList.add("is-open");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("is-open"), action ? 8000 : 4000);
}

function ingest_photos() {
    const btn = document.getElementById("ingest-photos-btn");
    const r = new XMLHttpRequest();
    r.open("POST", btn.dataset.url);
    r.setRequestHeader("X-CSRFToken", csrfToken());
    r.onload = () => {
        let res = {};
        try { res = JSON.parse(r.responseText); } catch (e) { }
        if (res.status === "success") {
            phToast("Ingest started. New photos appear after a refresh once it finishes.");
        } else {
            phToast(res.data || "Couldn't start ingest.");
        }
    };
    r.onerror = () => phToast("Network error: ingest not started.");
    r.send();
}

(function () {
    const ingestBtn = document.getElementById("ingest-photos-btn");
    if (ingestBtn) ingestBtn.addEventListener("click", ingest_photos);
})();

/* Show-hidden mode (photos/hidden.py): a discreet toggle, never shown in the nav.
 * Shift+H on any Photos page, or a long press on "Photos" in the nav. Session-only, 30 minutes.
 * While it's on, a small pill offers "Turn off". The page reloads on every change. */
(function () {
    const nav = document.querySelector(".ph-nav");
    if (!nav) return;
    const isOn = nav.dataset.hiddenMode === "1";

    function setHiddenMode(on) {
        fetch(nav.dataset.hiddenUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-CSRFToken": csrfToken(), "Content-Type": "application/json" },
            body: JSON.stringify({ show: on }),
        }).then(r => {
            if (r.ok) location.reload();
            else phToast("Couldn't change hidden-photo mode.");
        }).catch(() => phToast("Couldn't change hidden-photo mode."));
    }

    document.addEventListener("keydown", e => {
        if (e.key !== "H" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
        e.preventDefault();
        setHiddenMode(!isOn);
    });

    const link = document.getElementById("ph-nav-photos");
    if (link) {
        let timer = null, fired = false;
        const cancel = () => clearTimeout(timer);
        link.addEventListener("pointerdown", () => {
            fired = false;
            timer = setTimeout(() => { fired = true; setHiddenMode(!isOn); }, 800);
        });
        ["pointerup", "pointerleave", "pointercancel"].forEach(t => link.addEventListener(t, cancel));
        link.addEventListener("click", e => { if (fired) e.preventDefault(); });
        link.addEventListener("contextmenu", e => { if (fired || timer) e.preventDefault(); });
    }

    const off = document.getElementById("ph-hidden-off");
    if (off) off.addEventListener("click", () => setHiddenMode(false));
})();
