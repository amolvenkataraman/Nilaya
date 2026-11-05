/* Photos > Albums: Google Photos-style grid (or compact list) of the user's albums and the
 * "New album" dialog. Data: #albums-data (json_script); user id and create URL on .albums-container.
 * Album names/descriptions only reach the DOM through textContent. */
document.addEventListener("DOMContentLoaded", () => {
    const scriptEl = document.getElementById('albums-data');
    if (!scriptEl) return;

    const rawAlbums = JSON.parse(scriptEl.textContent);
    rawAlbums.forEach((a, i) => a.initial_index = i);

    const currentUserId = document.querySelector(".albums-container").dataset.userId;
    const albumsContainer = document.getElementById('albums-container');

    let viewMode = localStorage.getItem('albums_view_mode') || 'grid';
    let sortType = localStorage.getItem('albums_sort_type') || 'created_desc';

    const sortSelect = document.getElementById('albums-sort-select');
    const btnList = document.getElementById('btn-list-view');
    const btnGrid = document.getElementById('btn-grid-view');

    if (sortSelect) {
        sortSelect.value = sortType;
        if (sortSelect.value !== sortType) { sortType = 'created_desc'; sortSelect.value = sortType; }
    }
    updateViewButtons();
    renderAlbums();

    if (btnList) {
        btnList.addEventListener('click', () => {
            viewMode = 'list';
            localStorage.setItem('albums_view_mode', 'list');
            updateViewButtons();
            renderAlbums();
        });
    }

    if (btnGrid) {
        btnGrid.addEventListener('click', () => {
            viewMode = 'grid';
            localStorage.setItem('albums_view_mode', 'grid');
            updateViewButtons();
            renderAlbums();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            sortType = e.target.value;
            localStorage.setItem('albums_sort_type', sortType);
            renderAlbums();
        });
    }

    function updateViewButtons() {
        if (!btnList || !btnGrid) return;
        if (viewMode === 'list') {
            btnList.classList.add('active');
            btnGrid.classList.remove('active');
        } else {
            btnGrid.classList.add('active');
            btnList.classList.remove('active');
        }
    }

    function sortAlbums(sortVal, list) {
        return [...list].sort((a, b) => {
            if (sortVal === 'created_asc') {
                return a.initial_index - b.initial_index;
            } else if (sortVal === 'created_desc') {
                return b.initial_index - a.initial_index;
            } else if (sortVal === 'id_asc') {
                return a.id.localeCompare(b.id);
            } else if (sortVal === 'oldest_desc') {
                if (!a.oldest_date) return 1;
                if (!b.oldest_date) return -1;
                return new Date(b.oldest_date) - new Date(a.oldest_date);
            } else if (sortVal === 'oldest_asc') {
                if (!a.oldest_date) return 1;
                if (!b.oldest_date) return -1;
                return new Date(a.oldest_date) - new Date(b.oldest_date);
            } else if (sortVal === 'newest_desc') {
                if (!a.newest_date) return 1;
                if (!b.newest_date) return -1;
                return new Date(b.newest_date) - new Date(a.newest_date);
            } else if (sortVal === 'newest_asc') {
                if (!a.newest_date) return 1;
                if (!b.newest_date) return -1;
                return new Date(a.newest_date) - new Date(b.newest_date);
            } else if (sortVal === 'items_desc') {
                return (b.photo_count + b.video_count) - (a.photo_count + a.video_count);
            } else if (sortVal === 'items_asc') {
                return (a.photo_count + a.video_count) - (b.photo_count + b.video_count);
            } else if (sortVal === 'storage_desc') {
                return b.space_used_kb - a.space_used_kb;
            } else if (sortVal === 'storage_asc') {
                return a.space_used_kb - b.space_used_kb;
            } else if (sortVal === 'name_asc') {
                return String(a.name).localeCompare(String(b.name));
            }
            return 0;
        });
    }

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function coverEl(album) {
        const wrap = el('div', 'album-cover');
        if (album.cover_photo_id) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.src = album.cover_photo_hash
                ? `/private/${encodeURIComponent(album.cover_photo_hash)}/photo_cache/thumbnail/${encodeURIComponent(album.cover_photo_id)}.webp`
                : `/photos/photo/${encodeURIComponent(album.cover_photo_id)}/thumbnail/`;
            wrap.appendChild(img);
        } else {
            wrap.classList.add('is-empty');
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('width', '32');
            svg.setAttribute('height', '32');
            svg.setAttribute('aria-hidden', 'true');
            const path = document.createElementNS(ns, 'path');
            path.setAttribute('d', 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(path);
            wrap.appendChild(svg);
        }
        return wrap;
    }

    // Same stats the old album cards had: photos, videos, storage, owned/shared, public.
    function metaLines(album) {
        const p = album.photo_count || 0, v = album.video_count || 0;
        const counts = [`${p} photo${p === 1 ? '' : 's'}`];
        if (v) counts.push(`${v} video${v === 1 ? '' : 's'}`);
        const extra = [];
        if (album.space_used) extra.push(album.space_used);
        extra.push(album.owner === currentUserId ? 'Owned' : 'Shared with you');
        if (album.public) extra.push('Public');
        return [counts.join(' · '), extra.join(' · ')];
    }

    function renderAlbums() {
        if (!albumsContainer) return;
        albumsContainer.className = viewMode === 'grid' ? 'albums-grid' : 'albums-list';
        albumsContainer.replaceChildren(...sortAlbums(sortType, rawAlbums).map(album => {
            const a = el('a', 'album-tile');
            a.href = `/photos/?album=${encodeURIComponent(album.id)}`;
            a.appendChild(coverEl(album));
            const text = el('div', 'album-text');
            const name = el('div', 'album-name', album.name);
            name.title = album.name;
            text.appendChild(name);
            const [counts, extra] = metaLines(album);
            text.appendChild(el('div', 'album-meta', counts));
            text.appendChild(el('div', 'album-meta album-meta-2', extra));
            if (viewMode === 'list' && album.description) text.appendChild(el('div', 'album-desc', album.description));
            a.appendChild(text);
            return a;
        }));
    }
});

// Create album (the script loads after the modal markup, so the button exists)
(function () {
    const page = document.querySelector('.albums-container');
    const nameInput = document.getElementById('new-album-name');
    document.getElementById('createAlbumModal').addEventListener('shown.bs.modal', () => nameInput.focus());
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('saveNewAlbumBtn').click(); } });
    document.getElementById('saveNewAlbumBtn').addEventListener('click', () => {
        const name = document.getElementById('new-album-name').value.trim();
        const desc = document.getElementById('new-album-desc').value.trim();
        const publicStatus = document.getElementById('new-album-public').checked;

        if (!name) {
            nameInput.focus();
            return;
        }

        const r = new XMLHttpRequest();
        r.open("POST", page.dataset.createUrl);
        r.setRequestHeader("X-CSRFToken", csrfToken());
        r.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        r.onload = () => {
            const res = JSON.parse(r.responseText);
            if (res.status === 'success') {
                location.reload();
            } else {
                alert('Error creating album: ' + (res.message || 'unknown error'));
            }
        };
        r.send(JSON.stringify({
            name: name,
            description: desc,
            public: publicStatus
        }));
    });
})();
