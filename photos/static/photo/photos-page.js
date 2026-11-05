/* Photos timeline (photos.html): toolbar (search, date jump, filters, zoom, select),
 * infinite-scroll justified grid with sticky day headers, date scrubber, viewer with an
 * optional info panel, filters drawer (incl. sources), selection actions and album owner tools.
 * Loaded in <head> after the Handlebars templates; server values come from the data-*
 * attributes of #photos-config and the #ph-months json_script (read once the DOM is ready).
 * Untrusted values only reach the DOM through textContent / escaped Handlebars {{ }}. */

const photo_in_list = Handlebars.compile(document.querySelector("#photo-in-list").innerHTML);
const photo_description = Handlebars.compile(document.querySelector("#photo-description").innerHTML);

let CFG = null;  // #photos-config dataset, set on DOMContentLoaded
let activeAlbumCoverPhotoId = "";

var currdate = null;
let forward = false;
var currimage;
var imgloaded = false;
var dates = [];
var nowloading = false;
var origload = false;
let selectMode = false;

const ROW_H_KEY = "photosRowH";
const INFO_KEY = "photoInfoOpen";

function photosConfig() {
    if (CFG === null) {
        CFG = document.getElementById("photos-config").dataset;
        activeAlbumCoverPhotoId = CFG.coverId || "";
        currdate = CFG.newest || null;
        forward = CFG.forward === 'True';
    }
    return CFG;
}

function scroller() { return document.querySelector(".main-content"); }
function allItems() { return Array.from(document.querySelectorAll("#photos-timeline .photo-item:not(.is-gone)")); }

function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { } }

function postJSON(url, body) {
    return fetch(url, {
        method: "POST",
        headers: { "X-CSRFToken": csrfToken(), "Content-Type": "application/json;charset=UTF-8" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
    }).then(r => r.json().catch(() => ({ status: "error", data: `HTTP ${r.status}` })));
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function get_size_in_format(size) {
    const formats = ["KB", "MB", "GB", "TB"];
    let format = 0;
    while (size > 1024 && format < 3) {
        size /= 1024;
        format++;
    }
    return [size.toFixed(2), formats[format]];
}

function get_duration_in_format(dur) {
    if (dur > 3600) { return `${Math.floor(dur / 3600)}h ${Math.floor((dur % 3600) / 60)}m ${Math.floor((dur % 3600) % 60)}s` }
    else if (dur > 60) { return `${Math.floor(dur / 60)}m ${Math.floor(dur % 60)}s` }
    else { return `${Math.floor(dur)}s` }
}

/* Label on each thumbnail (time, city, …), chosen in the Filters drawer. */
function update_photo_details(root) {
    const detailType = lsGet('photoDetailType') || 'time';
    (root || document).querySelectorAll('.detail-tag').forEach(tag => {
        let val = "";
        if (detailType === 'time') val = tag.dataset.time;
        else if (detailType === 'city') val = tag.dataset.city;
        else if (detailType === 'camera') val = tag.dataset.camera;
        else if (detailType === 'megapixels') val = tag.dataset.megapixels ? parseFloat(tag.dataset.megapixels).toFixed(1) + ' MP' : '';
        else if (detailType === 'size') val = tag.dataset.size;
        else if (detailType === 'blur') val = tag.dataset.blur ? parseFloat(tag.dataset.blur).toFixed(1) : '';

        const show = detailType !== 'none' && val && val !== 'null' && val !== 'undefined';
        tag.classList.toggle('is-shown', !!show);
        tag.textContent = show ? val : '';
    });
}

/* ---------- Viewer ---------- */

function infoOpen() { return document.getElementById("photo-display-area").classList.contains("info-open"); }

function setInfoOpen(open) {
    const viewer = document.getElementById("photo-display-area");
    viewer.classList.toggle("info-open", open);
    document.getElementById("info-btn").setAttribute("aria-pressed", open ? "true" : "false");
    lsSet(INFO_KEY, open ? "1" : "0");
    if (open && currimage) load_info(currimage);
}

function view_image(e) {
    const viewer = document.getElementById("photo-display-area");
    if (!imgloaded) viewer._returnFocus = document.activeElement;
    imgloaded = true;
    currimage = e;
    viewer.classList.add("is-open");
    document.body.classList.add("ph-viewer-open");

    const stage = document.getElementById("photo");
    let media;
    if (e.dataset.video == "true") {
        media = document.createElement("video");
        const src = document.createElement('source');
        src.src = e.dataset.url;
        src.type = "video/mp4";
        media.appendChild(src);
        media.controls = true;
        media.loop = true;
    } else {
        media = document.createElement("img");
        media.src = e.dataset.url;
        media.alt = "";
    }
    media.classList.add("image-displayed");
    stage.replaceChildren(media);
    if (media.tagName === "VIDEO") media.play().catch(() => { });

    document.getElementById("pv-download").href = e.dataset.url;
    update_viewer_hide();

    // Prev/next availability
    const items = allItems();
    const idx = items.indexOf(e.closest('.photo-item'));
    document.getElementById("previous-btn").hidden = idx <= 0;
    document.getElementById("next-btn").hidden = idx >= items.length - 1 && currdate == null;
    if (idx >= items.length - 6) maybe_load_more(true);

    document.querySelector(".photo-info").replaceChildren();
    if (infoOpen()) load_info(e);
    if (!viewer.contains(document.activeElement)) document.getElementById("exit-btn").focus({ preventScroll: true });
}

function load_info(e) {
    const panel = document.querySelector(".photo-info");
    if (panel.dataset.id === e.dataset.id && panel.childElementCount) return;
    panel.dataset.id = e.dataset.id;
    panel.replaceChildren(el("div", "photo-info-loading", "Loading…"));

    const shareAlbum = photosConfig().shareAlbum;
    let url = `/photos/photo/${encodeURIComponent(e.dataset.id)}/info/`;
    if (shareAlbum) url += `?album=${encodeURIComponent(shareAlbum)}`;
    fetch(url, { credentials: "same-origin" }).then(r => r.json()).then(pres => {
        if (currimage !== e) return;
        pres['date_taken'] = new Date(pres['date_taken']).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        let tmp = get_size_in_format(pres["size"]);
        pres["size"] = tmp[0]; pres["size_unit"] = tmp[1];
        tmp = get_size_in_format(pres["size_total"]);
        pres["size_total"] = tmp[0]; pres["st_unit"] = tmp[1];
        tmp = get_size_in_format(pres["bitrate"] / 1024);
        pres["bitrate"] = tmp[0]; pres["br_unit"] = tmp[1] + "/s";
        pres["duration"] = get_duration_in_format(pres["length"]);
        panel.innerHTML = photo_description(pres);  // Handlebars {{ }} escapes every value
    }).catch(() => panel.replaceChildren(el("div", "photo-info-loading", "Couldn't load details.")));
}

var sidebarMap = null;
function load_map(lat, lng) {
    if (sidebarMap !== null) {
        try { sidebarMap.remove(); } catch (e) { }
    }
    document.getElementById('mapid').classList.add('is-shown');
    sidebarMap = L.map('mapid').setView([lat, lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 28,
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(sidebarMap);
    // A CSS pin instead of Leaflet's default marker PNGs (not vendored).
    L.marker([lat, lng], { icon: L.divIcon({ className: 'ph-map-pin', iconSize: [16, 16] }) }).addTo(sidebarMap);
}

function close_image() {
    if (!imgloaded) return;
    imgloaded = false;
    if (sidebarMap !== null) {
        try { sidebarMap.remove(); } catch (e) { }
        sidebarMap = null;
    }
    const viewer = document.getElementById("photo-display-area");
    viewer.classList.remove("is-open");
    document.body.classList.remove("ph-viewer-open");
    document.getElementById("photo").replaceChildren();
    const ret = viewer._returnFocus;
    const tile = currimage && currimage.closest('.photo-item');
    if (tile) tile.scrollIntoView({ block: 'nearest' });
    if (ret && ret.focus) ret.focus({ preventScroll: true });
}

function step_image(delta) {
    if (!imgloaded) return;
    const items = allItems();
    const idx = items.indexOf(currimage.closest('.photo-item'));
    const ni = items[idx + delta];
    if (ni) view_image(ni.querySelector('img'));
}
function prev_image() { step_image(-1); }
function next_image() { step_image(1); }

function del_photo(p) {
    return fetch(`/photos/delete/${encodeURIComponent(p)}/`, {
        method: "POST", headers: { "X-CSRFToken": csrfToken() }, credentials: "same-origin",
    });
}

function delete_original_video(id) {
    if (!confirm("Delete the original video source file?\n\nThis frees disk space and keeps the optimized video in your library.")) return;
    del_original(id).then(ok => {
        if (ok) { phToast("Original video deleted."); close_image(); location.reload(); }
        else phToast("Couldn't delete the original video.");
    });
}
function del_original(id) {
    return fetch(`/photos/delete-original/${encodeURIComponent(id)}/`, {
        method: "POST", headers: { "X-CSRFToken": csrfToken() }, credentials: "same-origin",
    }).then(r => r.ok).catch(() => false);
}

/* ---------- Timeline ---------- */

// Days per batch: similar mode uses more (results are sparse across time).
function batch_days() {
    return photosConfig().similarRef ? 30 : 10;
}

function filter_query() {
    const cfg = photosConfig();
    const p = new URLSearchParams();
    if (cfg.boundsB64) p.set("bounds", cfg.boundsB64);
    else if (cfg.hasBounds) {
        p.set("north", cfg.boundsNorth); p.set("south", cfg.boundsSouth);
        p.set("east", cfg.boundsEast); p.set("west", cfg.boundsWest);
    }
    if (cfg.q) p.set("q", cfg.q);
    if (cfg.camMake) p.set("camera_make", cfg.camMake);
    if (cfg.camModel) p.set("camera_model", cfg.camModel);
    if (cfg.country) p.set("country", cfg.country);
    if (cfg.city) p.set("city", cfg.city);
    if (cfg.objects) p.set("objects", cfg.objects);
    if (cfg.minBlur) p.set("min_blur", cfg.minBlur);
    if (cfg.maxBlur) p.set("max_blur", cfg.maxBlur);
    if (cfg.shareAlbum) p.set("album", cfg.shareAlbum);
    if (cfg.similarRef) { p.set("similar", cfg.similarRef); p.set("tol", cfg.similarTol); }
    if (cfg.video == "True") p.set("video", "1");
    if (forward) p.set("forward", "1");
    return p;
}

function day_label(d) {
    const m = moment(d);
    return m.format(m.year() === moment().year() ? 'ddd, MMM D' : 'ddd, MMM D, YYYY');
}

function render_day(day) {
    const d = day.date;
    const section = el("section", "day-section");
    section.dataset.date = d;

    const header = el("header", "day-header");
    const selectDay = el("button", "day-select");
    selectDay.type = "button";
    selectDay.setAttribute("aria-label", `Select all from ${day_label(d)}`);
    selectDay.title = "Select day";
    selectDay.appendChild(check_svg());
    header.appendChild(selectDay);

    // Counts split by kind, day size, and up to five places (+n), like the original header.
    const nVid = day.photos.filter(ph => ph.video).length, nPh = day.photos.length - nVid;
    const sz = get_size_in_format(day.total_size || 0);
    header.appendChild(el("h2", "date", day_label(d)));
    const parts = [];
    if (nPh) parts.push(`${nPh} photo${nPh !== 1 ? 's' : ''}`);
    if (nVid) parts.push(`${nVid} video${nVid !== 1 ? 's' : ''}`);
    parts.push(`${sz[0]} ${sz[1]}`);
    const meta = el("span", "day-meta");
    parts.forEach(t => meta.appendChild(el("span", "", t)));
    header.appendChild(meta);

    if (day.cities.length) {
        const locs = el("span", "locations");
        day.cities.slice(0, 5).forEach(c => locs.appendChild(el("span", "location-tag", `${c[0]}, ${c[1]}`)));
        if (day.cities.length > 5) locs.appendChild(el("span", "location-tag location-more", `+${day.cities.length - 5}`));
        locs.title = day.cities.map(c => `${c[0]}, ${c[1]} (${c[2]})`).join("\n");
        header.appendChild(locs);
    }
    section.appendChild(header);

    let dayHtml = "";
    for (const photo of day.photos) {
        let formattedSize = "";
        if (photo['size']) {
            const s = get_size_in_format(photo['size']);
            formattedSize = s[0] + " " + s[1];
        }
        const timeStr = photo['date_taken'] ? new Date(photo['date_taken']).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : "";
        dayHtml += photo_in_list({
            "id": photo['id'],
            "url": `/photo_cdn/${photo['photo_hash']}/${photo['path']}`,
            "video": photo["video"],
            "thumbnail": `/private/${photo['thumbnail_hash']}/photo_cache/thumbnail/${photo['id']}.webp`,
            "aspect_ratio": photo['aspect_ratio'] || 1.0,
            "main_color": photo['main_color'] || '',
            "duration_text": photo['duration_text'],
            "has_raw": photo['has_raw'],
            "has_orig": photo['has_orig'],
            "is_cover": (photo['id'] === activeAlbumCoverPhotoId),
            "time_taken": timeStr,
            "location_city": photo['location_city'] || "",
            "camera_model": photo['camera_model'] || "",
            "megapixels": photo['megapixels'] || "",
            "normalized_blur": photo['normalized_blur'] || "",
            "hidden": !!photo['hidden'],
            "mine": !!photo['mine'],
            "size": formattedSize
        });
    }
    dayHtml += `<div class="last-row-spacer"></div>`;
    const grid = el("div", "day-photos");
    grid.innerHTML = dayHtml;  // Handlebars-escaped tile markup
    // Per-photo layout values from data-* (no inline style attributes), then load images.
    grid.querySelectorAll('.photo-item').forEach(item => {
        item.style.setProperty('--ar', item.dataset.ar);
        if (/^#[0-9a-fA-F]{3,8}$/.test(item.dataset.color)) item.style.backgroundColor = item.dataset.color;
    });
    grid.querySelectorAll('img').forEach(img => {
        img.loading = "lazy";
        img.decoding = "async";
        img.src = img.dataset.src;
    });
    section.appendChild(grid);
    return section;
}

function check_svg() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    const pl = document.createElementNS(ns, "polyline");
    pl.setAttribute("points", "20 6 9 17 4 12");
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", "currentColor");
    pl.setAttribute("stroke-width", "3");
    pl.setAttribute("stroke-linecap", "round");
    pl.setAttribute("stroke-linejoin", "round");
    svg.appendChild(pl);
    return svg;
}

function get_photos_for_date(date, ndays = 0, nphotos = 0) {
    if (nowloading || !date) { return; }
    const date1 = moment(date).format('YYYY-MM-DD');
    if (dates.includes(date1)) { return; }
    nowloading = true;
    dates.push(date1);

    const p = filter_query();
    p.set("date", date1);
    if (ndays > 0) p.set("ndays", ndays);
    if (nphotos > 0) p.set("nphotos", nphotos);

    fetch(`${photosConfig().photosForDateUrl}?${p}`, { credentials: "same-origin" })
        .then(r => r.json())
        .then(res => {
            currdate = res['next'];
            const photosEl = document.getElementById("photos-timeline");
            const frag = document.createDocumentFragment();
            for (const day of res["photos"]) {
                if (day.photos.length) frag.appendChild(render_day(day));
            }
            photosEl.appendChild(frag);
            update_photo_details(photosEl);
            nowloading = false;
            origload = true;

            if (currdate == null) {
                photosEl.classList.add("is-complete");
                if (!photosEl.querySelector(".photos-end") && photosEl.querySelector(".day-section")) {
                    photosEl.appendChild(el("div", "photos-end", "That's everything"));
                }
            }
            scrubber_update();
            if (imgloaded) document.getElementById("next-btn").hidden = false;
            maybe_load_more();
        })
        .catch(() => {
            nowloading = false;
            dates.pop();
            phToast("Couldn't load photos.", { label: "Retry", onClick: () => get_photos_for_date(date, ndays, nphotos) });
        });
}

/* Load the next batch when the user is near the bottom (or the page isn't full yet). */
function maybe_load_more(force) {
    const sc = scroller();
    if (!origload || nowloading || currdate == null) return;
    if (force || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 2000) {
        get_photos_for_date(currdate, batch_days(), 50);
    }
}

/* ---------- Selection ---------- */

let lastSelectedPhoto = null;

function toggle_selection(item) {
    item.classList.toggle("selected");
    if (item.classList.contains("selected")) lastSelectedPhoto = item;
    else if (lastSelectedPhoto === item) lastSelectedPhoto = null;
    update_selection_bar();
}

function handle_photo_click(event, item) {
    const img = item.querySelector('img');
    const selectedCount = document.querySelectorAll('.photo-item.selected').length;

    if (event.shiftKey && lastSelectedPhoto && lastSelectedPhoto !== item) {
        const items = allItems();
        const a = items.indexOf(lastSelectedPhoto), b = items.indexOf(item);
        if (a !== -1 && b !== -1) {
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) items[i].classList.add("selected");
            lastSelectedPhoto = item;
            update_selection_bar();
            return;
        }
    }
    if (event.shiftKey || selectMode || selectedCount > 0) toggle_selection(item);
    else view_image(img);
}

function selected_items() { return Array.from(document.querySelectorAll('.photo-item.selected')); }
function selected_ids() { return selected_items().map(i => i.querySelector('img').dataset.id); }

function update_selection_bar() {
    const n = document.querySelectorAll('.photo-item.selected').length;
    const active = selectMode || n > 0;
    document.getElementById('ph-bar').classList.toggle('is-selecting', active);
    document.getElementById('photos-timeline').classList.toggle('is-selecting', active);
    document.getElementById('selected-count-number').textContent = n;
    document.querySelectorAll('#selection-action-bar .selection-actions .ph-tool').forEach(b => { b.disabled = n === 0; });
    const setCoverBtn = document.getElementById('action-set-cover');
    if (setCoverBtn) setCoverBtn.hidden = n !== 1;
    // Hide / Unhide: only for your own photos
    const mine = selected_items().filter(i => i.dataset.mine === 'true');
    const hideBtn = document.getElementById('action-hide');
    const unhide = mine.length > 0 && mine.every(i => i.dataset.hidden === 'true');
    hideBtn.hidden = mine.length === 0;
    hideBtn.querySelector('.ph-tool-label').textContent = unhide ? 'Unhide' : 'Hide';
    hideBtn.dataset.unhide = unhide ? '1' : '';
    const modeBtn = document.getElementById('select-mode-btn');
    modeBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function clear_selection() {
    document.querySelectorAll('.photo-item.selected').forEach(i => i.classList.remove('selected'));
    selectMode = false;
    lastSelectedPhoto = null;
    update_selection_bar();
}

function set_select_mode(on) {
    if (!on) { clear_selection(); return; }
    selectMode = true;
    update_selection_bar();
}

/* ---------- Filters (drawer + chips) ---------- */

const FILTER_PARAMS = ['q', 'video', 'camera_make', 'camera_model', 'country', 'city', 'objects',
    'min_blur', 'max_blur', 'date', 'forward'];

function navigate(params) {
    const qs = params.toString();
    window.location.search = qs;
    if (!qs) window.location.href = window.location.pathname;
}

function applyFilters() {
    const params = new URLSearchParams(window.location.search);
    FILTER_PARAMS.filter(k => k !== 'q').forEach(k => params.delete(k));

    if (document.getElementById('filter-video').checked) params.set('video', '1');
    const date = document.getElementById('filter-date').value.trim();
    if (date) params.set('date', date);
    if (document.querySelector('input[name="direction"]:checked').value === 'forward') params.set('forward', '1');

    const fields = { 'filter-camera-make': 'camera_make', 'filter-country': 'country', 'filter-city': 'city',
        'filter-objects': 'objects', 'filter-min-blur': 'min_blur', 'filter-max-blur': 'max_blur' };
    for (const [id, key] of Object.entries(fields)) {
        const v = document.getElementById(id).value.trim();
        if (v) params.set(key, v);
    }
    // camera_model only comes from Search > Cameras; keep it unless its chip is removed.
    const model = new URLSearchParams(window.location.search).get('camera_model');
    if (model) params.set('camera_model', model);

    const btn = document.getElementById('apply-filters-btn');
    btn.disabled = true;
    applyAlbumChanges().then(() => navigate(params));
}

function removeFilter(filterNames) {
    const params = new URLSearchParams(window.location.search);
    filterNames.split(',').forEach(n => params.delete(n));
    navigate(params);
}

function clearAllFilters() {
    const album = new URLSearchParams(window.location.search).get('album');
    const params = new URLSearchParams();
    if (album) params.set('album', album);
    navigate(params);
}

/* Sources: library folders shown in the timeline (Album_Subscriber.visible). */
const originalStates = {};
let currentStates = {};

function toggleAlbumVisibility(albumId, checkbox) {
    currentStates[albumId] = checkbox.checked;
}

function displayOnlyAlbum(albumId) {
    Object.keys(currentStates).forEach(id => {
        currentStates[id] = (id == albumId);
        const cb = document.getElementById('album-' + id);
        if (cb) cb.checked = currentStates[id];
    });
}

/* POST a toggle for every changed source; resolves when all are done. */
function applyAlbumChanges() {
    const changed = Object.keys(originalStates).filter(id => originalStates[id] !== currentStates[id]);
    return Promise.all(changed.map(id =>
        postJSON(`/photos/albums/toggle-visibility/${encodeURIComponent(id)}/`).then(res => res.status === 'success')
    )).then(results => {
        if (results.includes(false)) alert("Some source changes couldn't be saved.");
    });
}

/* ---------- Zoom ---------- */

function apply_row_height(h) {
    const range = document.getElementById('zoom-range');
    h = Math.max(Number(range.min), Math.min(Number(range.max), h));
    range.value = h;
    document.getElementById('main-body').style.setProperty('--photo-row-h', h + 'px');
    return h;
}

/* ---------- Date scrubber ---------- */

let scrubMonths = [];   // [{m: "YYYY-MM", n, top, h}]
let scrubBubbleTimer = null;

function month_label(m) { return moment(m + "-01").format("MMM YYYY"); }

function scrubber_build() {
    const scrub = document.getElementById('ph-scrubber');
    let months = JSON.parse(document.getElementById('ph-months').textContent || "[]");
    if (forward) months = months.slice().reverse();
    if (months.length < 2 || photosConfig().noPhotos) { scrub.hidden = true; return; }
    scrub.hidden = false;
    scrubMonths = months.map(([m, n]) => ({ m, n }));
    scrubber_layout();
}

function scrubber_layout() {
    const scrub = document.getElementById('ph-scrubber');
    if (scrub.hidden) return;
    const sc = scroller();
    const top = sc.getBoundingClientRect().top + document.getElementById('ph-bar').offsetHeight;
    scrub.style.top = top + 'px';

    const H = scrub.clientHeight - 16;
    const total = scrubMonths.reduce((a, b) => a + b.n, 0);
    // Every month gets at least 2px; the rest is shared by item count.
    const minH = 2, spare = Math.max(0, H - minH * scrubMonths.length);
    let y = 8;
    scrubMonths.forEach(mo => { mo.top = y; mo.h = minH + spare * mo.n / total; y += mo.h; });

    const track = document.getElementById('ph-scrubber-track');
    track.replaceChildren();
    const nYears = new Set(scrubMonths.map(mo => mo.m.slice(0, 4))).size;
    let lastLabel = -100, lastYear = null;
    const put = (cls, text, y) => {
        const lbl = el("span", cls, text);
        lbl.style.top = y + 'px';
        track.appendChild(lbl);
    };
    scrubMonths.forEach(mo => {
        const year = mo.m.slice(0, 4);
        if (year !== lastYear) {
            lastYear = year;
            if (mo.top - lastLabel >= 22) { put("ph-scrub-year", year, mo.top); lastLabel = mo.top; }
            else put("ph-scrub-dot", undefined, mo.top);
        } else if (nYears <= 3 && mo.top - lastLabel >= 22) {
            // Few years: label the months too, where there's room.
            put("ph-scrub-year ph-scrub-month", moment(mo.m + "-01").format("MMM"), mo.top);
            lastLabel = mo.top;
        }
    });
    scrubber_update();
}

function scrub_month_at(y) {
    for (let i = scrubMonths.length - 1; i >= 0; i--) if (y >= scrubMonths[i].top) return scrubMonths[i];
    return scrubMonths[0];
}

function show_bubble(y, text, sticky) {
    const b = document.getElementById('ph-scrubber-bubble');
    b.hidden = false;
    b.textContent = text;
    b.style.top = y + 'px';
    clearTimeout(scrubBubbleTimer);
    if (!sticky) scrubBubbleTimer = setTimeout(() => { b.hidden = true; }, 900);
}

/* Section at the top of the viewport (binary search over offsetTop). */
function top_section() {
    const sections = document.querySelectorAll('#photos-timeline .day-section');
    if (!sections.length) return null;
    const y = scroller().scrollTop + document.getElementById('ph-bar').offsetHeight + 4;
    let lo = 0, hi = sections.length - 1, ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sections[mid].offsetTop <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return sections[ans];
}

function scrubber_update(fromScroll) {
    const scrub = document.getElementById('ph-scrubber');
    if (scrub.hidden || !scrubMonths.length) return;
    const sec = top_section();
    if (!sec) return;
    const m = sec.dataset.date.slice(0, 7);
    const mo = scrubMonths.find(x => x.m === m);
    if (!mo) return;
    const thumb = document.getElementById('ph-scrubber-thumb');
    thumb.style.top = mo.top + 'px';
    if (fromScroll && !scrub.classList.contains('is-dragging')) show_bubble(mo.top, month_label(m));
}

function jump_to_month(m) {
    const sec = document.querySelector(`#photos-timeline .day-section[data-date^="${m}-"]`);
    if (sec) {
        const sc = scroller();
        sc.scrollTop = sec.offsetTop - document.getElementById('ph-bar').offsetHeight;
        return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set('date', forward ? `${m}-01` : moment(m + "-01").endOf('month').format('YYYY-MM-DD'));
    navigate(params);
}

function scrubber_bind() {
    const scrub = document.getElementById('ph-scrubber');
    let dragging = false;
    const yOf = e => e.clientY - scrub.getBoundingClientRect().top;
    scrub.addEventListener('pointermove', e => {
        const mo = scrub_month_at(yOf(e));
        if (mo) show_bubble(yOf(e), month_label(mo.m), true);
        if (dragging && mo) {
            const sec = document.querySelector(`#photos-timeline .day-section[data-date^="${mo.m}-"]`);
            if (sec) jump_to_month(mo.m);
        }
    });
    scrub.addEventListener('pointerleave', () => { if (!dragging) document.getElementById('ph-scrubber-bubble').hidden = true; });
    scrub.addEventListener('pointerdown', e => {
        dragging = true;
        scrub.classList.add('is-dragging');
        scrub.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    scrub.addEventListener('pointerup', e => {
        if (!dragging) return;
        dragging = false;
        scrub.classList.remove('is-dragging');
        const mo = scrub_month_at(yOf(e));
        document.getElementById('ph-scrubber-bubble').hidden = true;
        if (mo) jump_to_month(mo.m);
    });
}

/* ---------- Boot ---------- */

window.addEventListener('DOMContentLoaded', () => {
    const cfg = photosConfig();
    const sc = scroller();
    const bar = document.getElementById('ph-bar');

    // Sticky day headers sit right under the toolbar.
    const setBarH = () => sc.style.setProperty('--ph-bar-h', bar.offsetHeight + 'px');
    setBarH();
    if (window.ResizeObserver) new ResizeObserver(() => { setBarH(); scrubber_layout(); }).observe(bar);
    window.addEventListener('resize', scrubber_layout);

    // Library summary: numbers, size, collapse (remembered), "videos only" keeps the other filters.
    document.querySelectorAll('#ph-lib [data-num]').forEach(e => { e.textContent = Number(e.dataset.num).toLocaleString(); });
    document.querySelectorAll('#ph-lib [data-kb]').forEach(e => { const z = get_size_in_format(Number(e.dataset.kb)); const v = parseFloat(z[0]); e.textContent = `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${z[1]}`; e.title = `${z[0]} ${z[1]}`; });
    const lib = document.getElementById('ph-lib');
    if (lib) {
        const toggle = document.getElementById('ph-lib-toggle');
        const setLib = open => {
            lib.classList.toggle('is-collapsed', !open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        setLib(lsGet('photosLibCollapsed') !== '1');
        toggle.addEventListener('click', () => {
            const open = lib.classList.contains('is-collapsed');
            setLib(open);
            lsSet('photosLibCollapsed', open ? '0' : '1');
            scrubber_update();
        });
        lib.querySelectorAll('[data-add-param]').forEach(a => a.addEventListener('click', e => {
            e.preventDefault();
            const params = new URLSearchParams(window.location.search);
            params.set(a.dataset.addParam, '1');
            navigate(params);
        }));
    }

    // Thumbnail label
    const showDetailSelect = document.getElementById('show-detail-select');
    showDetailSelect.value = lsGet('photoDetailType') || 'time';
    showDetailSelect.addEventListener('change', function () {
        lsSet('photoDetailType', this.value);
        update_photo_details();
    });

    // Zoom (persisted)
    const saved = Number(lsGet(ROW_H_KEY));
    if (saved) apply_row_height(saved);
    else document.getElementById('zoom-range').value = parseInt(getComputedStyle(document.getElementById('main-body')).getPropertyValue('--photo-row-h')) || 180;
    const zoomTo = h => { lsSet(ROW_H_KEY, apply_row_height(h)); scrubber_update(); };
    document.getElementById('zoom-range').addEventListener('input', e => zoomTo(Number(e.target.value)));
    document.getElementById('zoom-in').addEventListener('click', () => zoomTo(Number(document.getElementById('zoom-range').value) + 40));
    document.getElementById('zoom-out').addEventListener('click', () => zoomTo(Number(document.getElementById('zoom-range').value) - 40));

    // Search box: Enter searches the library (q); the popover links to Search pages.
    const searchForm = document.getElementById('ph-search');
    const searchInput = document.getElementById('ph-search-input');
    const searchPop = document.getElementById('ph-search-pop');
    searchInput.addEventListener('focus', () => { searchPop.hidden = false; });
    searchForm.addEventListener('focusout', e => { if (!searchForm.contains(e.relatedTarget)) searchPop.hidden = true; });
    searchForm.addEventListener('keydown', e => { if (e.key === 'Escape') { searchPop.hidden = true; searchInput.blur(); } });
    searchForm.addEventListener('submit', e => {
        e.preventDefault();
        const params = new URLSearchParams(window.location.search);
        params.delete('date'); params.delete('forward');
        const q = searchInput.value.trim();
        if (q) params.set('q', q); else params.delete('q');
        navigate(params);
    });

    // Go to date
    document.getElementById('date-jump-form').addEventListener('submit', e => {
        e.preventDefault();
        const v = document.getElementById('jump-date').value;
        if (!v) return;
        const params = new URLSearchParams(window.location.search);
        params.set('date', v);
        navigate(params);
    });
    document.getElementById('jump-today').addEventListener('click', () => {
        const params = new URLSearchParams(window.location.search);
        params.delete('date'); params.delete('forward');
        navigate(params);
    });
    document.getElementById('date-jump-btn').addEventListener('shown.bs.dropdown', () => document.getElementById('jump-date').focus());

    // Filters drawer + chips
    const chips = document.getElementById('active-filters-list');
    const nChips = chips.querySelectorAll('.filter-tag').length;
    const badge = document.getElementById('filters-count');
    badge.textContent = nChips;
    badge.hidden = nChips === 0;
    document.getElementById('filters-btn').classList.toggle('is-active', nChips > 0);
    document.getElementById('chips-clear').hidden = nChips < 2;
    chips.addEventListener('click', e => {
        const btn = e.target.closest('.remove-filter');
        if (btn) removeFilter(btn.closest('.filter-tag').dataset.filter);
    });
    document.getElementById('filters-drawer').querySelectorAll('.filter-input').forEach(input => {
        input.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
    });
    document.getElementById('apply-filters-btn').addEventListener('click', applyFilters);
    document.querySelectorAll('.js-clear-filters').forEach(b => b.addEventListener('click', clearAllFilters));

    // Sources
    document.querySelectorAll(".album-toggle-checkbox").forEach(cb => {
        originalStates[cb.dataset.albumId] = cb.dataset.visible === "true";
        cb.addEventListener("change", () => toggleAlbumVisibility(cb.dataset.albumId, cb));
    });
    currentStates = { ...originalStates };
    document.querySelectorAll(".album-display-only").forEach(b => {
        b.addEventListener("click", () => displayOnlyAlbum(b.dataset.albumId));
    });

    // Timeline
    if (!cfg.noPhotos) get_photos_for_date(currdate, batch_days(), 100);
    let ticking = false;
    sc.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            ticking = false;
            bar.classList.toggle('is-scrolled', sc.scrollTop > 0);
            maybe_load_more();
            scrubber_update(true);
        });
    }, { passive: true });
    scrubber_build();
    scrubber_bind();

    // Grid: click opens / selects; the corner circle or the day circle selects.
    document.getElementById('photos-timeline').addEventListener('click', (e) => {
        const daySel = e.target.closest('.day-select');
        if (daySel) {
            const items = daySel.closest('.day-section').querySelectorAll('.photo-item');
            const all = Array.from(items).every(i => i.classList.contains('selected'));
            items.forEach(i => i.classList.toggle('selected', !all));
            update_selection_bar();
            return;
        }
        const item = e.target.closest('.photo-item');
        if (!item) return;
        if (e.target.closest('.select-checkbox')) toggle_selection(item);
        else handle_photo_click(e, item);
    });

    // Select mode
    document.getElementById('select-mode-btn').addEventListener('click', () => set_select_mode(!selectMode));
    document.getElementById('action-clear-selection').addEventListener('click', clear_selection);

    // Viewer
    document.getElementById('exit-btn').addEventListener('click', close_image);
    document.getElementById('previous-btn').addEventListener('click', prev_image);
    document.getElementById('next-btn').addEventListener('click', next_image);
    document.getElementById('info-btn').addEventListener('click', () => setInfoOpen(!infoOpen()));
    document.getElementById('info-close').addEventListener('click', () => setInfoOpen(false));
    if (lsGet(INFO_KEY) === "1") setInfoOpen(true);
    document.querySelector('.photo-info').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'load-map') load_map(Number(btn.dataset.lat), Number(btn.dataset.lon));
        else if (btn.dataset.action === 'delete-original') delete_original_video(btn.dataset.id);
        else if (btn.dataset.action === 'delete-photo') delete_items([btn.dataset.id]);
    });

    document.addEventListener('keydown', (e) => {
        const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
        if (imgloaded) {
            if (e.key === 'Escape') { e.preventDefault(); close_image(); }
            else if (typing) return;
            else if (e.key === 'ArrowLeft') prev_image();
            else if (e.key === 'ArrowRight') next_image();
            else if (e.key === 'i') setInfoOpen(!infoOpen());
            return;
        }
        if (typing || document.querySelector('.modal.show, .offcanvas.show')) return;
        if (e.key === 'Escape' && (selectMode || selected_items().length)) clear_selection();
        else if (e.key === 'Delete' && selected_items().length) delete_items(selected_ids());
        else if (e.key === '/') { e.preventDefault(); searchInput.focus(); }
    });

    bind_selection_actions(cfg);
    if (cfg.owner) bind_album_owner(cfg);
});

/* Delete photos by id (confirm first), then drop their tiles. */
function delete_items(ids) {
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} item${ids.length > 1 ? 's' : ''}? This can't be undone.`)) return;
    Promise.all(ids.map(id => del_photo(id).then(r => r.ok).catch(() => false))).then(results => {
        const okIds = ids.filter((id, i) => results[i]);
        okIds.forEach(id => {
            const img = document.querySelector(`#photos-timeline img[data-id="${CSS.escape(id)}"]`);
            if (img) img.closest('.photo-item').remove();
        });
        if (imgloaded && okIds.includes(currimage.dataset.id)) close_image();
        clear_selection();
        phToast(okIds.length === ids.length ? `Deleted ${okIds.length} item${okIds.length > 1 ? 's' : ''}` : `Deleted ${okIds.length} of ${ids.length}; some failed`);
    });
}

function copy_text(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'ph-offscreen';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
    return Promise.resolve();
}

function bind_selection_actions(cfg) {
    const selectAlbumModal = new bootstrap.Modal(document.getElementById('addToAlbumModal'));
    const dropdown = document.getElementById('select-album-dropdown');

    document.getElementById('action-add-to-album').addEventListener('click', () => {
        dropdown.replaceChildren(new Option('Loading albums…', ''));
        fetch(cfg.listAlbumsUrl, { credentials: "same-origin" }).then(r => r.json()).then(res => {
            dropdown.replaceChildren(new Option(res.albums.length ? 'Select an album…' : 'No albums yet', ''));
            res.albums.forEach(album => dropdown.appendChild(new Option(album.name, album.id)));
            selectAlbumModal.show();
        });
    });

    document.getElementById('submitAddToAlbumBtn').addEventListener('click', () => {
        const albumId = dropdown.value;
        if (!albumId) { dropdown.focus(); return; }
        const albumName = dropdown.options[dropdown.selectedIndex].textContent;
        const ids = selected_ids();
        postJSON(cfg.addToAlbumUrl, { share_album_id: albumId, photo_id: ids }).then(pres => {
            if (pres.status !== 'success') { alert('Error adding to album: ' + (pres.data || 'unknown error')); return; }
            selectAlbumModal.hide();
            clear_selection();
            const added = (pres.data && pres.data.added) || [];
            const skipped = ids.length - added.length;
            phToast(`Added ${added.length} to “${albumName}”` + (skipped ? ` (${skipped} already there)` : ''), added.length ? {
                label: 'Undo',
                onClick: () => postJSON(cfg.removeFromAlbumUrl, { share_album_id: albumId, photo_id: added })
                    .then(r => phToast(r.status === 'success' ? 'Removed again' : "Couldn't undo")),
            } : null);
        });
    });

    document.getElementById('action-delete-selected').addEventListener('click', () => delete_items(selected_ids()));

    document.getElementById('action-share').addEventListener('click', () => {
        const ids = selected_ids();
        const text = ids.map(id => `${location.origin}/photos/view-photo/${id}/`).join("\n");
        copy_text(text).then(() => phToast(`Copied ${ids.length} link${ids.length > 1 ? 's' : ''}. People need access to the library to open them.`))
            .catch(() => phToast("Couldn't copy links."));
    });

    document.getElementById('action-download').addEventListener('click', () => {
        const urls = selected_items().map(i => i.querySelector('img').dataset.url);
        urls.forEach((url, k) => setTimeout(() => {
            const a = document.createElement('a');
            a.href = url;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            a.remove();
        }, k * 250));
        phToast(`Downloading ${urls.length} item${urls.length > 1 ? 's' : ''}`);
    });
}

/* ---- Album owner: cover, edit, share ---- */
function bind_album_owner(cfg) {
    const setCoverBtn = document.getElementById('action-set-cover');
    if (setCoverBtn) setCoverBtn.addEventListener('click', () => {
        const ids = selected_ids();
        if (ids.length !== 1) return;
        postJSON(cfg.setCoverUrl, { cover_photo_id: ids[0] }).then(res => {
            if (res.status === 'success') location.reload();
            else alert('Error updating cover: ' + (res.message || res.data || 'unknown error'));
        });
    });

    document.getElementById('saveEditAlbumBtn').addEventListener('click', () => {
        const name = document.getElementById('edit-album-name').value.trim();
        if (!name) { document.getElementById('edit-album-name').focus(); return; }
        postJSON(cfg.editAlbumUrl, {
            name: name,
            description: document.getElementById('edit-album-desc').value.trim(),
            public: document.getElementById('edit-album-public').checked,
        }).then(res => {
            if (res.status === 'success') location.reload();
            else alert('Error editing album: ' + (res.message || res.data || 'unknown error'));
        });
    });

    const container = document.getElementById('subscribers-list-container');
    function loadSubscribers() {
        container.replaceChildren(el("div", "ph-list-note", "Loading…"));
        fetch(cfg.subscribersUrl, { credentials: "same-origin" }).then(r => r.json()).then(res => {
            if (res.status !== 'success') { container.replaceChildren(el("div", "ph-list-note", "Couldn't load people.")); return; }
            if (!res.subscribers.length) { container.replaceChildren(el("div", "ph-list-note", "Not shared with anyone yet.")); return; }
            container.replaceChildren(...res.subscribers.map(sub => {
                const row = el("div", "list-group-item d-flex justify-content-between align-items-center");
                const who = el("div");
                who.appendChild(el("strong", "", "@" + sub.username));
                who.appendChild(el("span", "ph-role", sub.subscribe_type === 1 ? 'Editor' : 'Viewer'));
                const rm = el("button", "btn btn-sm btn-outline-danger", "Remove");
                rm.type = "button";
                rm.dataset.subId = sub.id;
                row.append(who, rm);
                return row;
            }));
        });
    }
    document.getElementById('shareAlbumModal').addEventListener('show.bs.modal', loadSubscribers);

    window.removeSubscriber = function (subId) {
        if (!confirm('Remove this person from the album?')) return;
        postJSON(cfg.subscribersUrl, { action: 'remove', subscriber_id: subId }).then(res => {
            if (res.status === 'success') loadSubscribers();
            else alert('Error removing person: ' + (res.message || res.data || 'unknown error'));
        });
    };
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sub-id]');
        if (btn) window.removeSubscriber(Number(btn.dataset.subId));
    });

    document.getElementById('addSubBtn').addEventListener('click', () => {
        const input = document.getElementById('new-sub-username');
        const username = input.value.trim();
        if (!username) { input.focus(); return; }
        postJSON(cfg.subscribersUrl, {
            action: 'add', username: username,
            subscribe_type: parseInt(document.getElementById('new-sub-role').value, 10),
        }).then(res => {
            if (res.status === 'success') { input.value = ''; loadSubscribers(); }
            else alert('Error adding person: ' + (res.message || res.data || 'unknown error'));
        });
    });
}

/* ---------- Hidden photos (owner only; see photos/hidden.py) ---------- */

function item_by_id(id) {
    const img = document.querySelector(`#photos-timeline img[data-id="${CSS.escape(id)}"]`);
    return img ? img.closest('.photo-item') : null;
}

/* Mark tiles hidden/unhidden. Outside show-hidden mode a hidden tile leaves the grid. */
function mark_hidden(ids, hidden) {
    const reveal = photosConfig().showHidden === '1';
    ids.forEach(id => {
        const item = item_by_id(id);
        if (!item) return;
        item.dataset.hidden = hidden ? 'true' : 'false';
        item.classList.toggle('is-gone', hidden && !reveal);
        let badge = item.querySelector('.badge-hidden');
        if (hidden && !badge) {
            badge = el('span', 'indicator-badge badge-hidden');
            badge.title = 'Hidden';
            badge.appendChild(eye_off_svg());
            item.querySelector('.photo-indicators').prepend(badge);
        } else if (!hidden && badge) badge.remove();
    });
}

function eye_off_svg() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "12");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.2");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);
    return svg;
}

/* POST the change; toast with Undo that reverses exactly these ids. */
function set_hidden(ids, hidden, isUndo) {
    if (!ids.length) return Promise.resolve();
    return postJSON(photosConfig().hideUrl, { ids: ids, hidden: hidden }).then(res => {
        if (typeof res.changed !== 'number') { phToast("Couldn't change that."); return; }
        mark_hidden(ids, hidden);
        const n = ids.length, word = `${n} item${n > 1 ? 's' : ''}`;
        if (isUndo) { phToast(hidden ? `Hid ${word} again` : `${word} visible again`); return; }
        phToast(hidden ? `Hid ${word}. Only you can reveal hidden items.` : `Unhid ${word}`,
            { label: 'Undo', onClick: () => set_hidden(ids, !hidden, true) });
    });
}

function update_viewer_hide() {
    const btn = document.getElementById('pv-hide');
    const item = currimage && currimage.closest('.photo-item');
    const mine = item && item.dataset.mine === 'true';
    btn.hidden = !mine;
    if (!mine) return;
    const unhide = item.dataset.hidden === 'true';
    btn.setAttribute('aria-label', unhide ? 'Unhide' : 'Hide');
    btn.title = unhide ? 'Unhide' : 'Hide (only you can reveal it)';
    btn.classList.toggle('is-on', unhide);
}

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('action-hide').addEventListener('click', e => {
        const unhide = e.currentTarget.dataset.unhide === '1';
        const ids = selected_items()
            .filter(i => i.dataset.mine === 'true' && (i.dataset.hidden === 'true') === unhide)
            .map(i => i.querySelector('img').dataset.id);
        clear_selection();
        set_hidden(ids, !unhide);
    });

    document.getElementById('pv-hide').addEventListener('click', () => {
        const item = currimage.closest('.photo-item');
        const id = currimage.dataset.id;
        const hide = item.dataset.hidden !== 'true';
        const reveal = photosConfig().showHidden === '1';
        // Hiding outside show-hidden mode: move on to a neighbour first, since this tile leaves the grid.
        if (hide && !reveal) {
            const items = allItems().filter(i => !i.classList.contains('is-gone'));
            const idx = items.indexOf(item);
            const nb = items[idx + 1] || items[idx - 1];
            set_hidden([id], true).then(() => { if (nb) view_image(nb.querySelector('img')); else close_image(); });
        } else {
            set_hidden([id], hide).then(update_viewer_hide);
        }
    });
});
