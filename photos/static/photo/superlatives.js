/* Photos > Superlatives: lightbox, single/batch deletion and live summary totals.
 * Loaded at the end of the page body (the elements above already exist).
 * Data: #sup-photos-meta (json_script), CSRF token on .sup-page; uses escapeHtml() from js/script.js. */
(function () {
    // Metadata for every ranked item, keyed by id (json_script holds the JSON text the view built).
    const photosMeta = JSON.parse(JSON.parse(document.getElementById("sup-photos-meta").textContent));
    // Ranked ids in table order (one row per item).
    let activePhotoIds = Array.from(document.querySelectorAll('#top-files-table tr[id^="row-"]'), (row) => row.id.slice(4));
    const csrf = document.querySelector(".sup-page").dataset.csrf;
    let currentLightboxIdx = -1;
    let isLightboxOpen = false;

    function formatBytesStr(kb) {
        if (!kb) return "0.0 MB";
        let mb = kb / 1024.0;
        if (mb >= 1024.0 * 1024.0) {
            return (mb / (1024.0 * 1024.0)).toFixed(2) + " TB";
        } else if (mb >= 1024.0) {
            return (mb / 1024.0).toFixed(2) + " GB";
        } else {
            return mb.toFixed(1) + " MB";
        }
    }

    function openLightboxById(id) {
        const idx = activePhotoIds.indexOf(id);
        if (idx !== -1) {
            showLightboxAtIndex(idx);
        }
    }

    function showLightboxAtIndex(idx) {
        if (idx < 0 || idx >= activePhotoIds.length) return;
        currentLightboxIdx = idx;
        isLightboxOpen = true;
        const id = activePhotoIds[idx];
        const meta = photosMeta[id];
        if (!meta) return;

        const displayArea = document.getElementById("photo-display-area");
        displayArea.style.visibility = "visible";

        const photoContainer = document.getElementById("photo");
        photoContainer.innerHTML = "";

        const mediaUrl = `/photo_cdn/${meta.photo_hash}/${meta.path}`;
        if (meta.video) {
            const vid = document.createElement("video");
            vid.src = mediaUrl;
            vid.controls = true;
            vid.autoplay = true;
            vid.loop = true;
            vid.style.maxHeight = "90vh";
            vid.style.maxWidth = "90vw";
            photoContainer.appendChild(vid);
        } else {
            const img = document.createElement("img");
            img.src = mediaUrl;
            img.style.maxHeight = "90vh";
            img.style.maxWidth = "90vw";
            img.style.objectFit = "contain";
            photoContainer.appendChild(img);
        }

        // Render Sidebar info
        const infoSidebar = document.querySelector("#photo-display-area .sup-info");
        const fileName = meta.filepath ? meta.filepath.split('/').pop() : '';
        infoSidebar.innerHTML = `
            <div class="sup-info-head">
                <div class="sup-info-name">${meta.filepath ? escapeHtml(fileName) : 'File Details'}</div>
                <div class="sup-info-sub">ID: ${escapeHtml(meta.id)}</div>
            </div>

            <div class="sup-info-section">
                <div class="ins-label">File details</div>
                <div class="sup-info-row"><span>Type</span><strong>${meta.video ? 'Video' : 'Photo'}</strong></div>
                ${meta.width ? `<div class="sup-info-row"><span>Dimensions</span><strong>${escapeHtml(meta.width)} × ${escapeHtml(meta.height)} (${escapeHtml(meta.megapixels || '')} MP)</strong></div>` : ''}
                ${meta.date_taken ? `<div class="sup-info-row"><span>Date Taken</span><strong>${new Date(meta.date_taken).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong></div>` : ''}
                <div class="sup-info-row"><span>Optimized Size</span><strong>${formatBytesStr(meta.size)}</strong></div>
                <div class="sup-info-row"><span>Total Size</span><strong>${formatBytesStr(meta.size_total || meta.size)}</strong></div>
            </div>

            ${meta.camera_model || meta.camera_make ? `
            <div class="sup-info-section">
                <div class="ins-label">Camera</div>
                ${meta.camera_make ? `<div class="sup-info-row"><span>Make</span><strong>${escapeHtml(meta.camera_make)}</strong></div>` : ''}
                ${meta.camera_model ? `<div class="sup-info-row"><span>Model</span><strong>${escapeHtml(meta.camera_model)}</strong></div>` : ''}
            </div>` : ''}

            ${meta.location_city ? `
            <div class="sup-info-section">
                <div class="ins-label">Location</div>
                <div class="d-flex align-items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.166 8.94c-.524 1.062-1.234 2.12-1.96 3.07A32 32 0 0 1 8 14.58a32 32 0 0 1-2.206-2.57c-.726-.95-1.436-2.008-1.96-3.07C3.304 7.867 3 6.862 3 6a5 5 0 0 1 10 0c0 .862-.305 1.867-.834 2.94M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10"/><path d="M8 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4m0 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/></svg><strong>${escapeHtml(meta.location_city)}${meta.location_country ? ', ' + escapeHtml(meta.location_country) : ''}</strong></div>
            </div>` : ''}

            <div class="sup-info-actions">
                ${meta.has_orig ? `
                <button type="button" class="btn btn-sm btn-outline-warning w-100" data-sup-action="delete-original" data-id="${escapeHtml(meta.id)}" data-filename="${escapeHtml(fileName)}" data-overhead="${formatBytesStr((meta.size_total || meta.size) - meta.size)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47M8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/></svg> Delete original only (${formatBytesStr((meta.size_total || meta.size) - meta.size)})
                </button>` : ''}
                <button type="button" class="btn btn-sm btn-danger w-100" data-sup-action="delete" data-id="${escapeHtml(meta.id)}" data-filename="${escapeHtml(fileName)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47M8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/></svg> Delete entire item
                </button>
            </div>
        `;
    }

    function closeLightbox() {
        isLightboxOpen = false;
        document.getElementById("photo-display-area").style.visibility = "hidden";
        document.getElementById("photo").innerHTML = "";
    }

    function prevLightboxImage() {
        if (isLightboxOpen && currentLightboxIdx > 0) {
            showLightboxAtIndex(currentLightboxIdx - 1);
        }
    }

    function nextLightboxImage() {
        if (isLightboxOpen && currentLightboxIdx < activePhotoIds.length - 1) {
            showLightboxAtIndex(currentLightboxIdx + 1);
        }
    }

    document.addEventListener('keydown', function(e) {
        if (!isLightboxOpen) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') prevLightboxImage();
        else if (e.key === 'ArrowRight') nextLightboxImage();
    });

    // --- Deletion Handlers ---

    function deleteOriginalFile(id, filename, overheadStr) {
        if (!confirm(`Are you sure you want to delete the original source file for '${filename}' (${overheadStr})?\n\nThis will free up disk space while keeping the optimized file in your library.`)) {
            return;
        }

        const r = new XMLHttpRequest();
        r.open("POST", `/photos/delete-original/${id}/`);
        r.setRequestHeader("X-CSRFToken", csrf);
        r.onload = function() {
            if (r.status === 200) {
                const res = JSON.parse(r.responseText);
                if (res.status === 'success') {
                    updateRowAfterOriginalDeleted(id, res);
                    if (isLightboxOpen && activePhotoIds[currentLightboxIdx] === id) {
                        showLightboxAtIndex(currentLightboxIdx);
                    }
                } else {
                    alert("Failed to delete original file: " + (res.data || "Unknown error"));
                }
            } else {
                alert("Failed to delete original file. You may not have authorization.");
            }
        };
        r.onerror = function() {
            alert("Network error occurred while deleting original file.");
        };
        r.send();
    }

    function updateRowAfterOriginalDeleted(id, res) {
        const row = document.getElementById(`row-${id}`);
        if (row) {
            row.dataset.totKb = res.size_total;

            const totCell = row.children[7];
            if (totCell) {
                totCell.innerHTML = `${res.tot_size_str}`;
            }

            const badgesContainer = row.querySelector('.badge-container-orig');
            if (badgesContainer) {
                badgesContainer.innerHTML = '';
            }

            const origBtn = row.querySelector('.btn-del-orig');
            if (origBtn) {
                origBtn.remove();
            }
        }

        if (photosMeta[id]) {
            photosMeta[id].size_total = res.size_total;
            photosMeta[id].has_orig = false;
            photosMeta[id].has_raw = false;
        }

        recalculateStats();
    }

    function deleteSingleFile(id, filename) {
        if (!confirm(`Are you sure you want to permanently delete '${filename}'?\nThis will remove the file and all associated thumbnails from storage.`)) {
            return;
        }

        const r = new XMLHttpRequest();
        r.open("POST", `/photos/delete/${id}/`);
        r.setRequestHeader("X-CSRFToken", csrf);
        r.onload = function() {
            if (r.status === 200) {
                if (isLightboxOpen && activePhotoIds[currentLightboxIdx] === id) {
                    closeLightbox();
                }
                removeRowFromTable(id);
            } else {
                alert("Failed to delete file. You may not have authorization to delete this item.");
            }
        };
        r.onerror = function() {
            alert("Network error occurred while attempting to delete file.");
        };
        r.send();
    }

    function removeRowFromTable(id) {
        const row = document.getElementById(`row-${id}`);
        if (row) {
            row.remove();
        }

        activePhotoIds = activePhotoIds.filter(pid => pid !== id);

        const countEl = document.getElementById("stat-total-items");
        if (countEl) {
            countEl.textContent = activePhotoIds.length;
        }

        recalculateStats();
        updateBatchSelection();
    }

    function recalculateStats() {
        let totKbSum = 0;
        let optKbSum = 0;
        let photos = 0;
        let videos = 0;

        activePhotoIds.forEach(id => {
            const row = document.getElementById(`row-${id}`);
            if (row) {
                const tot = parseFloat(row.dataset.totKb) || 0;
                const opt = parseFloat(row.dataset.optKb) || 0;
                totKbSum += tot;
                optKbSum += opt;

                const isVid = row.querySelector('.sup-video') !== null;
                if (isVid) videos++;
                else photos++;
            }
        });

        const totEl = document.getElementById("stat-tot-size");
        const optEl = document.getElementById("stat-opt-size");
        const overheadEl = document.getElementById("stat-overhead-size");
        const photoCntEl = document.getElementById("stat-photo-count");
        const videoCntEl = document.getElementById("stat-video-count");

        if (totEl) totEl.textContent = formatBytesStr(totKbSum);
        if (optEl) optEl.textContent = formatBytesStr(optKbSum);
        if (overheadEl) overheadEl.textContent = formatBytesStr(Math.max(0, totKbSum - optKbSum));
        if (photoCntEl) photoCntEl.textContent = photos;
        if (videoCntEl) videoCntEl.textContent = videos;
    }

    // --- Batch Selection Handlers ---

    function toggleSelectAll(master) {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = master.checked;
        });
        updateBatchSelection();
    }

    function updateBatchSelection() {
        const selected = document.querySelectorAll('.row-checkbox:checked');
        const count = selected.length;
        const bar = document.getElementById('batch-action-bar');
        const countSpan = document.getElementById('batch-count');
        const master = document.getElementById('select-all-checkbox');

        if (countSpan) countSpan.textContent = count;

        if (count > 0) {
            bar.style.display = 'flex';
        } else {
            bar.style.display = 'none';
        }

        const allCheckboxes = document.querySelectorAll('.row-checkbox');
        if (master && allCheckboxes.length > 0) {
            master.checked = selected.length === allCheckboxes.length;
        }
    }

    function clearBatchSelection() {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(cb => cb.checked = false);
        const master = document.getElementById('select-all-checkbox');
        if (master) master.checked = false;
        updateBatchSelection();
    }

    function deleteBatchFiles() {
        const selected = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.value);
        if (selected.length === 0) return;

        if (!confirm(`Are you sure you want to permanently delete the ${selected.length} selected files?\nThis action cannot be undone.`)) {
            return;
        }

        let completed = 0;
        let failed = 0;

        selected.forEach(id => {
            const r = new XMLHttpRequest();
            r.open("POST", `/photos/delete/${id}/`);
            r.setRequestHeader("X-CSRFToken", csrf);
            r.onload = function() {
                if (r.status === 200) {
                    removeRowFromTable(id);
                } else {
                    failed++;
                }
                completed++;
                checkBatchDone();
            };
            r.onerror = function() {
                failed++;
                completed++;
                checkBatchDone();
            };
            r.send();
        });

        function checkBatchDone() {
            if (completed === selected.length) {
                clearBatchSelection();
                if (failed > 0) {
                    alert(`Batch deletion completed with ${failed} failure(s).`);
                }
            }
        }
    }

    function changeLimit(val) {
        const params = new URLSearchParams(window.location.search);
        params.set('limit', val);
        window.location.search = params.toString();
    }

    // --- Wiring (replaces the inline on* handlers) ---

    document.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-sup-action]');
        if (!btn) return;
        const d = btn.dataset;
        switch (d.supAction) {
            case 'view': openLightboxById(d.id); break;
            case 'delete-original': deleteOriginalFile(d.id, d.filename, d.overhead); break;
            case 'delete': deleteSingleFile(d.id, d.filename); break;
            case 'batch-delete': deleteBatchFiles(); break;
            case 'batch-clear': clearBatchSelection(); break;
            case 'lb-close': closeLightbox(); break;
            case 'lb-prev': prevLightboxImage(); break;
            case 'lb-next': nextLightboxImage(); break;
        }
    });

    document.addEventListener('change', function(e) {
        if (e.target.matches('.row-checkbox')) updateBatchSelection();
    });

    const selectAll = document.getElementById('select-all-checkbox');
    if (selectAll) selectAll.addEventListener('change', function() { toggleSelectAll(this); });

    const limitSelect = document.getElementById('limitSelect');
    if (limitSelect) limitSelect.addEventListener('change', function() { changeLimit(this.value); });
})();
