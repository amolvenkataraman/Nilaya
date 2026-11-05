// AVNet Superapp Calendar: customizable right sidebar. Widgets can be shown/hidden, reordered (drag, or
// the arrow buttons / Alt+Arrow keys) and collapsed; the layout is stacked (default) or compact tabs.
// Saved per device in localStorage["calendar:sidebar-widgets"]. Each widget loads lazily, the first time it
// is on screen, and has its own skeleton / empty / error state.
// Uses globals from script.js / sidebar.js: csrfToken(), plain(), short_time(), populate_calendar(), m, y.
(function () {
    'use strict';

    const KEY = 'calendar:sidebar-widgets';
    const WIDGETS = {
        tasks: 'Tasks', habits: 'Habits', upcoming: 'Upcoming', insight: 'Insight',
        mini: 'Mini month', photos: 'On this day', notifications: 'Notifications',
    };
    const DEFAULTS = { order: Object.keys(WIDGETS), visible: ['tasks', 'habits', 'upcoming', 'insight'], collapsed: [], layout: 'stacked', tab: 'tasks' };

    const side = document.getElementById('wg-side');
    const list = document.getElementById('wg-list');
    const tabs = document.getElementById('wg-tabs');
    const custom = document.getElementById('wg-custom');
    const gear = document.getElementById('wg-customize');
    const topTitle = document.getElementById('wg-top-title');
    const sections = Object.fromEntries([...list.querySelectorAll('.wg')].map(s => [s.dataset.widget, s]));

    // ------------------------------------------------------------------ state
    function load() {
        let st = {};
        try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { st = {}; }
        const known = (arr) => Array.isArray(arr) ? arr.filter(id => id in WIDGETS) : null;
        const order = known(st.order) || DEFAULTS.order.slice();
        for (const id of DEFAULTS.order) if (!order.includes(id)) order.push(id);  // widgets added later
        return {
            order: [...new Set(order)],
            visible: known(st.visible) || DEFAULTS.visible.slice(),
            collapsed: known(st.collapsed) || [],
            layout: st.layout === 'tabs' ? 'tabs' : 'stacked',
            tab: st.tab in WIDGETS ? st.tab : 'tasks',
        };
    }
    let state = load();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { } }

    const h = (tag, props = {}, children = []) => {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'style') for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
            else node.setAttribute(k, v === true ? '' : v);
        }
        for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
        return node;
    };
    const skeleton = (n = 3) => h('div', { class: 'sb-skeleton', 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => h('div', { class: 'sb-skel-line', style: { width: ['85%', '60%', '75%', '50%'][i % 4] } })));
    const message = (text, retry) => h('div', { class: 'wg-empty' }, [text, retry ? ' ' : null, retry ? h('button', { type: 'button', class: 'sb-link', text: 'Retry', 'data-wg-retry': '' }) : null]);
    const api = (path, opts = {}) => fetch(path, {
        credentials: 'same-origin', ...opts,
        headers: { ...(opts.method && opts.method !== 'GET' ? { 'X-CSRFToken': csrfToken() } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    }).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))));

    // ------------------------------------------------------------------ layout
    function shown(id) {
        if (!state.visible.includes(id)) return false;
        if (state.layout === 'tabs') return state.tab === id;
        return !state.collapsed.includes(id);
    }

    function apply() {
        if (state.layout === 'tabs' && !state.visible.includes(state.tab)) state.tab = state.visible[0] || 'tasks';
        side.classList.toggle('is-tabs', state.layout === 'tabs');
        for (const id of state.order) {
            const sec = sections[id];
            list.appendChild(sec);
            sec.hidden = !state.visible.includes(id) || (state.layout === 'tabs' && state.tab !== id);
            const collapsed = state.layout === 'stacked' && state.collapsed.includes(id);
            sec.classList.toggle('is-collapsed', collapsed);
            sec.querySelector('.wg-toggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            sec.querySelector('.wg-body').hidden = collapsed;
        }
        // Tabs (compact layout)
        tabs.hidden = state.layout !== 'tabs';
        topTitle.hidden = state.layout === 'tabs';
        tabs.replaceChildren(...state.order.filter(id => state.visible.includes(id)).map(id => h('button', {
            type: 'button', class: 'cal-seg-btn', role: 'tab', 'data-wg-tab': id, 'aria-selected': state.tab === id ? 'true' : 'false',
            'aria-controls': `wg-b-${id}`, text: ({ upcoming: 'Agenda', mini: 'Month', photos: 'Photos', notifications: 'Alerts' })[id] || WIDGETS[id],
        })));
        tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (!state.visible.length) list.replaceChildren(...Object.values(sections), h('div', { class: 'wg-empty wg-none', text: 'No widgets. Use the gear to add some.' }));
        else list.querySelector('.wg-none')?.remove();
        activateShown();
    }

    // Lazy loading: load each widget the first time it's on screen.
    const loaded = new Set();
    function activateShown() {
        for (const id of state.order) if (shown(id)) activate(id);
    }
    function activate(id) {
        if (id === 'upcoming') document.dispatchEvent(new CustomEvent('calendar:sidebar', { detail: { tab: '.sb-upcoming' } }));
        else if (id === 'insight') document.dispatchEvent(new CustomEvent('calendar:sidebar', { detail: { tab: '.sb-insight' } }));
        else if (!loaded.has(id) && LOADERS[id]) { loaded.add(id); LOADERS[id](); }
    }

    // ------------------------------------------------------------------ header interactions
    list.addEventListener('click', (e) => {
        const toggle = e.target.closest('.wg-toggle');
        if (toggle && state.layout === 'stacked') {
            const id = toggle.closest('.wg').dataset.widget;
            state.collapsed = state.collapsed.includes(id) ? state.collapsed.filter(x => x !== id) : [...state.collapsed, id];
            save();
            apply();
            return;
        }
        const retry = e.target.closest('[data-wg-retry]');
        if (retry) { const id = retry.closest('.wg').dataset.widget; if (LOADERS[id]) LOADERS[id](); }
    });
    tabs.addEventListener('click', (e) => {
        const b = e.target.closest('[data-wg-tab]');
        if (!b) return;
        state.tab = b.dataset.wgTab;
        save();
        apply();
    });
    tabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const btns = [...tabs.querySelectorAll('[data-wg-tab]')];
        const i = btns.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
        next.focus();
        next.click();
    });

    // ------------------------------------------------------------------ customize panel
    function renderCustom() {
        const layout = h('div', { class: 'cal-seg cal-seg-full', role: 'radiogroup', 'aria-label': 'Layout' }, ['stacked', 'tabs'].map(l => h('button', {
            type: 'button', class: 'cal-seg-btn', role: 'radio', 'data-wg-layout': l, 'aria-checked': state.layout === l ? 'true' : 'false',
            'aria-selected': state.layout === l ? 'true' : 'false', text: l === 'stacked' ? 'Stacked' : 'Tabs',
        })));
        const items = state.order.map((id, i) => h('li', { class: 'wg-c-item', draggable: 'true', 'data-id': id, tabindex: '0', 'aria-label': `${WIDGETS[id]}, position ${i + 1} of ${state.order.length}. Alt+Up or Alt+Down to move.` }, [
            h('span', { class: 'wg-grip', 'aria-hidden': 'true', title: 'Drag to reorder' }),
            h('label', { class: 'wg-c-label' }, [
                h('input', { type: 'checkbox', class: 'form-check-input', 'data-wg-show': id, checked: state.visible.includes(id) }),
                h('span', { text: WIDGETS[id] }),
            ]),
            h('button', { type: 'button', class: 'cal-icon-btn wg-c-move', 'data-wg-move': '-1', disabled: i === 0, 'aria-label': `Move ${WIDGETS[id]} up`, title: 'Move up', text: '↑' }),
            h('button', { type: 'button', class: 'cal-icon-btn wg-c-move', 'data-wg-move': '1', disabled: i === state.order.length - 1, 'aria-label': `Move ${WIDGETS[id]} down`, title: 'Move down', text: '↓' }),
        ]));
        custom.replaceChildren(
            h('div', { class: 'wg-c-head' }, [h('strong', { text: 'Customize sidebar' }), h('button', { type: 'button', class: 'sb-link', 'data-wg-done': '', text: 'Done' })]),
            layout,
            h('ul', { class: 'wg-c-list', 'aria-label': 'Widgets' }, items),
            h('button', { type: 'button', class: 'sb-link wg-c-reset', 'data-wg-reset': '', text: 'Reset to default' }),
        );
    }

    function move(id, delta) {
        const i = state.order.indexOf(id), j = i + delta;
        if (i < 0 || j < 0 || j >= state.order.length) return;
        state.order.splice(j, 0, state.order.splice(i, 1)[0]);
        save();
        apply();
        renderCustom();
        custom.querySelector(`.wg-c-item[data-id="${id}"]`)?.focus();
    }

    function openCustom(open) {
        custom.hidden = !open;
        gear.setAttribute('aria-expanded', open ? 'true' : 'false');
        gear.classList.toggle('is-on', open);
        if (open) { renderCustom(); custom.querySelector('[data-wg-show]')?.focus(); }
    }

    gear.addEventListener('click', () => openCustom(custom.hidden));
    custom.addEventListener('click', (e) => {
        if (e.target.closest('[data-wg-done]')) { openCustom(false); gear.focus(); return; }
        if (e.target.closest('[data-wg-reset]')) { state = JSON.parse(JSON.stringify(DEFAULTS)); save(); apply(); renderCustom(); return; }
        const lay = e.target.closest('[data-wg-layout]');
        if (lay) { state.layout = lay.dataset.wgLayout; save(); apply(); renderCustom(); return; }
        const mv = e.target.closest('[data-wg-move]');
        if (mv) move(mv.closest('.wg-c-item').dataset.id, parseInt(mv.dataset.wgMove));
    });
    custom.addEventListener('change', (e) => {
        const cb = e.target.closest('[data-wg-show]');
        if (!cb) return;
        const id = cb.dataset.wgShow;
        state.visible = cb.checked ? state.order.filter(x => x === id || state.visible.includes(x)) : state.visible.filter(x => x !== id);
        save();
        apply();
    });
    custom.addEventListener('keydown', (e) => {
        const li = e.target.closest('.wg-c-item');
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); openCustom(false); gear.focus(); return; }
        if (li && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(li.dataset.id, e.key === 'ArrowUp' ? -1 : 1); }
    });
    // Drag and drop (mouse); the arrow buttons and Alt+Arrow keys do the same without a pointer.
    let dragId = null;
    custom.addEventListener('dragstart', (e) => {
        const li = e.target.closest('.wg-c-item');
        if (!li) return;
        dragId = li.dataset.id;
        li.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
    });
    custom.addEventListener('dragover', (e) => {
        const li = e.target.closest('.wg-c-item');
        if (!dragId || !li || li.dataset.id === dragId) return;
        e.preventDefault();
        const r = li.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        custom.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
        li.classList.add(after ? 'drop-after' : 'drop-before');
    });
    custom.addEventListener('drop', (e) => {
        const li = e.target.closest('.wg-c-item');
        if (!dragId || !li) return;
        e.preventDefault();
        const after = li.classList.contains('drop-after');
        const order = state.order.filter(x => x !== dragId);
        order.splice(order.indexOf(li.dataset.id) + (after ? 1 : 0), 0, dragId);
        state.order = order;
        save();
        apply();
        renderCustom();
    });
    custom.addEventListener('dragend', () => {
        dragId = null;
        custom.querySelectorAll('.is-dragging, .drop-before, .drop-after').forEach(x => x.classList.remove('is-dragging', 'drop-before', 'drop-after'));
    });

    // ------------------------------------------------------------------ Habits widget
    const habitsBox = sections.habits.querySelector('.wg-habits');
    const habitsCount = document.getElementById('wg-count-habits');
    const CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';
    const fmtNum = (v) => (Math.round(v * 100) / 100).toString();

    function habitRow(t) {
        const hb = t.habit;
        const colour = /^#[0-9a-fA-F]{3,8}$/.test(hb.colour) ? hb.colour : 'var(--app-accent)';
        const name = plain(hb.name);
        const measurable = hb.kind === 'measurable';
        const sub = measurable
            ? `${fmtNum(t.period_value)} of ${fmtNum(t.period_required)} ${plain(hb.unit) || ''}${hb.period !== 'day' ? ` this ${hb.period}` : ''}`.trim()
            : (hb.period !== 'day' ? `${fmtNum(t.period_value)} of ${fmtNum(t.period_required)} this ${hb.period}` : (t.done ? 'Done today' : 'Not yet today'));
        const today = !measurable && t.value > 0;  // yes/no: checked today (weekly goals may still be open)
        const btn = h('button', {
            type: 'button', class: 'wg-hb-check' + (t.done || today ? ' is-done' : '') + (t.over ? ' is-over' : ''), 'data-habit': hb.id,
            title: measurable ? `Add 1 ${plain(hb.unit) || ''}`.trim() : (today ? 'Undo today' : 'Mark done today'),
            'aria-label': measurable ? `Add 1 to ${name}` : `${today ? 'Undo today' : 'Mark done today'}: ${name}`,
            'aria-pressed': measurable ? null : (today ? 'true' : 'false'),
        });
        if (measurable && !t.done) btn.textContent = '+';
        else if (measurable || today || t.done) btn.innerHTML = CHECK;  // static icon
        return h('li', { class: 'wg-hb' + (t.done ? ' is-done' : ''), style: { '--hb': colour } }, [
            btn,
            h('a', { class: 'wg-hb-main', href: '/habits/', title: 'Open Habits' }, [
                h('span', { class: 'wg-hb-name', text: name }),
                h('span', { class: 'wg-hb-sub', text: sub }),
            ]),
            t.streak > 1 ? h('span', { class: 'wg-hb-streak', title: `${t.streak}-${t.streak_unit} streak`, text: `${t.streak}${t.streak_unit[0]}` }) : null,
        ]);
    }

    function loadHabits() {
        habitsBox.replaceChildren(skeleton(3));
        api('/api/v2/habits/today').then(d => {
            const due = d.habits.filter(t => t.due && !t.habit.archived && !t.habit.paused);
            habitsCount.textContent = d.total ? `${d.done}/${d.total}` : '';
            if (!due.length) { habitsBox.replaceChildren(message('No habits due today.')); return; }
            habitsBox.replaceChildren(h('ul', { class: 'wg-hb-list' }, due.map(habitRow)));
        }).catch(() => habitsBox.replaceChildren(message("Couldn't load habits.", true)));
    }

    habitsBox.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-habit]');
        if (!btn) return;
        btn.disabled = true;
        api(`/api/v2/habits/${encodeURIComponent(btn.dataset.habit)}/check`, { method: 'POST' }).then(t => {
            btn.closest('.wg-hb').replaceWith(habitRow(t));
            api('/api/v2/habits/today').then(d => { habitsCount.textContent = d.total ? `${d.done}/${d.total}` : ''; }).catch(() => { });
        }).catch(() => {
            btn.disabled = false;
            toast("Couldn't update the habit.", true);
        });
    });

    // ------------------------------------------------------------------ Photos on this day
    const photosBox = sections.photos.querySelector('.wg-photos');
    function loadPhotos() {
        photosBox.replaceChildren(skeleton(2));
        api('/api/v2/photos/on-this-day?per_year=6').then(groups => {
            if (!groups.length) { photosBox.replaceChildren(message('No photos from this day in earlier years.')); return; }
            const now = new Date();
            const frag = groups.slice(0, 3).map(g => {
                const ago = now.getFullYear() - g.year;
                return h('div', { class: 'wg-ph-year' }, [
                    h('div', { class: 'wg-ph-label', text: `${ago} year${ago === 1 ? '' : 's'} ago · ${g.year}` }),
                    h('div', { class: 'wg-ph-grid' }, g.items.slice(0, 6).map(p => {
                        const d = p.date_taken ? new Date(p.date_taken) : null;
                        const href = d ? `/photos/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}/` : '/photos/';
                        const img = h('img', { src: p.thumb_url, alt: `Photo from ${g.year}${p.city ? ', ' + p.city : ''}`, loading: 'lazy', decoding: 'async' });
                        return h('a', { class: 'wg-ph' + (p.video ? ' is-video' : ''), href }, [img]);
                    })),
                ]);
            });
            photosBox.replaceChildren(...frag);
        }).catch(() => photosBox.replaceChildren(message("Couldn't load photos.", true)));
    }

    // ------------------------------------------------------------------ Notifications
    const notifBox = sections.notifications.querySelector('.wg-notifs');
    const notifCount = document.getElementById('wg-count-notifications');
    const safeUrl = (u) => (typeof u === 'string' && (/^\/(?!\/)/.test(u) || /^https?:\/\//i.test(u))) ? u : null;
    function loadNotifications() {
        notifBox.replaceChildren(skeleton(3));
        api('/api/v2/notifications/?limit=5').then(d => {
            notifCount.textContent = d.unread ? String(d.unread) : '';
            if (!d.items.length) { notifBox.replaceChildren(message('No notifications.')); return; }
            notifBox.replaceChildren(h('ul', { class: 'wg-nt-list' }, d.items.map(n => {
                const url = safeUrl(n.url);
                const inner = [
                    h('span', { class: 'wg-nt-title', text: plain(n.title) }),
                    n.body ? h('span', { class: 'wg-nt-body', text: plain(n.body) }) : null,
                    h('span', { class: 'wg-nt-meta', text: [plain(n.source), moment(n.created_on).fromNow()].filter(Boolean).join(' · ') }),
                ];
                return h('li', { class: 'wg-nt' + (n.read ? '' : ' is-unread') }, [url ? h('a', { class: 'wg-nt-main', href: url }, inner) : h('div', { class: 'wg-nt-main' }, inner)]);
            })));
        }).catch(() => notifBox.replaceChildren(message("Couldn't load notifications.", true)));
    }

    const LOADERS = { habits: loadHabits, photos: loadPhotos, notifications: loadNotifications, mini: () => { }, tasks: () => { } };

    // Refresh loaded widgets after explicit reloads (edits, Refresh) and when the tab regains focus.
    document.addEventListener('calendar:loaded', (e) => {
        if (!e.detail.manual) return;
        if (loaded.has('habits') && shown('habits')) loadHabits();
    });
    window.addEventListener('focus', () => {
        for (const id of ['habits', 'notifications']) if (loaded.has(id)) { if (shown(id)) LOADERS[id](); else loaded.delete(id); }
    });

    // ------------------------------------------------------------------ Insight: full view in a dialog
    const insPanel = sections.insight.querySelector('.sb-insight');
    const insDlg = document.getElementById('cal-insight-dlg');
    const insDlgBody = document.getElementById('cal-insight-dlg-body');
    side.addEventListener('click', (e) => {
        if (!e.target.closest('[data-ins-expand]')) return;
        insDlgBody.appendChild(insPanel);  // move the live panel (keeps its period and state)
        insDlg.showModal();
        document.dispatchEvent(new CustomEvent('calendar:sidebar', { detail: { tab: '.sb-insight' } }));
    });
    insDlg.addEventListener('click', (e) => { if (e.target === insDlg || e.target.closest('[data-dialog-close]')) insDlg.close(); });
    insDlg.addEventListener('close', () => { sections.insight.querySelector('.wg-body').appendChild(insPanel); });

    // ------------------------------------------------------------------ public API
    window.CalWidgets = {
        reveal(id) {
            if (!(id in WIDGETS)) return;
            if (!state.visible.includes(id)) state.visible = state.order.filter(x => x === id || state.visible.includes(x));
            state.collapsed = state.collapsed.filter(x => x !== id);
            state.tab = id;
            save();
            apply();
            sections[id].scrollIntoView({ block: 'nearest' });
        },
    };

    topTitle.textContent = moment().format('dddd, MMM D');
    apply();
})();
