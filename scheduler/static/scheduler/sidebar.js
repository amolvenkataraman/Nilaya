// AVNet Superapp Calendar: right-sidebar panels (task quick add, Upcoming agenda, Insight).
// Uses globals from script.js: plain(), short_time(), getEasternDateParts(), open_event_by_id(),
// populate_calendar(), m, y. Every piece of user data goes into the DOM as text (textContent /
// SVG <title>), never as HTML.
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';

    // ------------------------------------------------------------------ helpers
    function api(path, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (opts.method && opts.method !== 'GET') headers['X-CSRFToken'] = csrfToken();
        if (opts.body) headers['Content-Type'] = 'application/json';
        return fetch(path, { credentials: 'same-origin', ...opts, headers }).then(r => {
            if (r.ok) return r.status === 204 ? null : r.json();
            return r.json().catch(() => ({})).then(b => {
                const detail = typeof b.detail === 'string' ? b.detail : '';
                throw new Error(detail || `Request failed (${r.status})`);
            });
        });
    }

    // h('div', {class: 'x', text: 'y', title: 'z', 'data-a': 1}, [children])
    function h(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'style') for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
            else node.setAttribute(k, v === true ? '' : v);
        }
        for (const c of [].concat(children)) if (c) node.append(c);
        return node;
    }

    function s(tag, attrs = {}, children = []) {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        for (const c of [].concat(children)) if (c) node.append(c);
        return node;
    }

    function svgTitle(text) { const t = s('title'); t.textContent = text; return t; }

    // Small static icons (trusted markup, no data).
    const ICON = {
        plus: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/></svg>',
        check: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>',
        up: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="currentColor" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 1 7.5 6.5h-7z"/></svg>',
        down: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="currentColor" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 7 .5 1.5h7z"/></svg>',
    };
    function icon(name) { const t = document.createElement('template'); t.innerHTML = ICON[name]; return t.content.firstChild; }

    function ymd(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function parseYmd(str) { const [Y, M, D] = str.split('-').map(Number); return new Date(Y, M - 1, D); }
    function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

    function fmtHours(v) {
        if (!v) return '0h';
        if (v < 1) return `${Math.round(v * 60)}m`;
        return v < 100 ? `${+v.toFixed(1)}h` : `${Math.round(v)}h`;
    }
    function fmtMinutes(min) {
        if (!min) return '0m';
        return min < 60 ? `${min}m` : fmtHours(min / 60);
    }
    function fmtClock(hhmm) { return hhmm ? moment(hhmm, 'HH:mm').format('h:mm A') : '–'; }

    // Rendered on screen (its widget is shown, expanded, and in tabs mode the active tab).
    function isVisible(panel) { return !!panel && panel.getClientRects().length > 0; }

    function skeleton(lines) {
        const box = h('div', { class: 'sb-skeleton', 'aria-hidden': 'true' });
        for (const w of lines) box.append(h('div', { class: 'sb-skel-line', style: { width: w } }));
        return box;
    }

    // ------------------------------------------------------------------ Tasks tab: quick add
    const quickForm = document.querySelector('.todo-quick');
    const quickInput = document.getElementById('todo-quick-input');
    const quickMsg = document.getElementById('todo-quick-msg');

    quickForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = quickInput.value.trim();
        quickMsg.className = 'todo-quick-msg';
        if (!text) { quickMsg.textContent = 'Type a task, e.g. "Pay rent tomorrow 5pm !3".'; return; }
        if (text.length > 512) { quickMsg.textContent = 'Keep it under 512 characters.'; quickMsg.classList.add('is-error'); return; }
        quickInput.disabled = true;
        api('/api/v2/tasks/quick', { method: 'POST', body: JSON.stringify({ text }) }).then(task => {
            quickInput.value = '';
            const due = task.due ? ` · due ${moment(task.due).calendar(null, { sameElse: 'MMM D, h:mm A' })}` : '';
            quickMsg.textContent = `Added "${plain(task.title)}"${due}`;
            upsert_todo(task);
            after_local_change();
        }).catch(err => {
            quickMsg.textContent = err.message || "Couldn't add the task.";
            quickMsg.classList.add('is-error');
        }).finally(() => {
            quickInput.disabled = false;
            quickInput.focus();
        });
    });

    // ------------------------------------------------------------------ Upcoming tab
    const upPanel = document.querySelector('.sb-upcoming');
    const agendaBox = upPanel.querySelector('.agenda');
    const AGENDA_DAYS = 14;
    let agendaLoadedAt = 0;
    let agendaSeq = 0;

    let agendaInflight = false;
    function loadAgenda() {
        if (agendaInflight) return;  // one request at a time; the result serves every trigger
        agendaInflight = true;
        const seq = ++agendaSeq;
        if (!agendaBox.childElementCount) agendaBox.replaceChildren(skeleton(['40%', '90%', '75%', '85%', '35%', '80%']));
        const today = startOfDay(new Date());
        const last = new Date(today); last.setDate(last.getDate() + AGENDA_DAYS - 1);
        // Contacts' birthdays come from their own (day-cached) request; if it fails the agenda still shows.
        // Same yearly ranges as the month grid, so this is usually a cache hit.
        const years = [...new Set([today.getFullYear(), last.getFullYear()])];
        const bdays = show_contact_birthdays()
            ? Promise.all(years.map(yr => contact_birthdays(`${yr}-01-01`, `${yr}-12-31`))).then(ls => ls.flat().filter(b => b.date >= ymd(today) && b.date <= ymd(last))).catch(() => [])
            : Promise.resolve([]);
        Promise.all([api(`/api/v2/calendar/agenda?days=${AGENDA_DAYS}`), bdays]).then(([items, bd]) => {
            if (seq !== agendaSeq) return;
            agendaLoadedAt = Date.now();
            for (const b of bd) {
                items.push({ kind: 'birthday', id: b.id, title: birthday_label(b), start: `${b.date}T00:00:00`, end: null, colour: '#e87ba4', calendar: 'Contacts', location: null, done: false });
            }
            renderAgenda(items);
        }).finally(() => { agendaInflight = false; }).catch(() => {
            if (seq !== agendaSeq) return;
            agendaBox.replaceChildren(h('div', { class: 'sidebar-empty' }, [
                "Couldn't load upcoming items. ",
                h('button', { type: 'button', class: 'sb-link', 'data-agenda-retry': '', text: 'Retry' }),
            ]));
        });
    }

    // Local calendar day of an agenda item (all-day events are stored at Eastern midnight,
    // the same convention the month grid uses).
    function itemDay(it) {
        const d = new Date(it.start);
        if (it.kind === 'all_day') { const p = getEasternDateParts(d); return new Date(p.year, p.month - 1, p.day); }
        if (it.kind === 'birthday') { const [Y, M, D] = it.start.slice(0, 10).split('-').map(Number); return new Date(Y, M - 1, D); }
        return startOfDay(d);
    }

    function dayLabel(day, today) {
        const diff = Math.round((day - today) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Tomorrow';
        return moment(day).format('ddd MMM D');
    }

    function renderAgenda(items) {
        const today = startOfDay(new Date());
        const groups = new Map();  // key -> {label, rows}
        const push = (key, label, it, ongoing) => {
            if (!groups.has(key)) groups.set(key, { label, rows: [] });
            groups.get(key).rows.push({ it, ongoing });
        };
        for (const it of items) {
            if (!it.start) continue;
            const day = itemDay(it);
            if (day < today) {
                if (it.kind === 'todo' || it.kind === 'deadline') push('0-overdue', 'Overdue', it, false);
                else push(ymd(today), 'Today', it, true);  // started earlier, still running
            } else {
                push(ymd(day), dayLabel(day, today), it, false);
            }
        }
        if (!groups.size) {
            agendaBox.replaceChildren(h('div', { class: 'sidebar-empty', text: `Nothing in the next ${AGENDA_DAYS} days.` }));
            return;
        }
        const frag = document.createDocumentFragment();
        for (const key of [...groups.keys()].sort()) {
            const g = groups.get(key);
            const section = h('section', { class: 'agenda-day' + (key === '0-overdue' ? ' is-overdue' : '') }, [
                h('h3', { class: 'agenda-day-label', text: g.label }),
            ]);
            // all-day first within a day, then by time
            const allDayish = (k) => k === 'all_day' || k === 'birthday';
            g.rows.sort((a, b) => allDayish(b.it.kind) - allDayish(a.it.kind) || new Date(a.it.start) - new Date(b.it.start));
            for (const row of g.rows) section.append(agendaRow(row.it, row.ongoing));
            frag.append(section);
        }
        agendaBox.replaceChildren(frag);
    }

    function agendaTime(it, ongoing) {
        const start = new Date(it.start);
        if (it.kind === 'all_day' || it.kind === 'birthday') return 'All day';
        if (ongoing) return it.end ? `→ ${short_time(new Date(it.end))}` : '';
        if (it.kind === 'todo' && start.getHours() === 23 && start.getMinutes() === 59) return '';
        return short_time(start);
    }

    function agendaRow(it, ongoing) {
        const title = plain(it.title);
        const time = agendaTime(it, ongoing);
        const meta = [plain(it.calendar)];
        if (it.kind === 'deadline') meta.push('Due');
        if (it.kind === 'todo') meta.push('Task');
        if (it.location) meta.push(plain(it.location));

        const row = h('div', {
            class: `agenda-row kind-${it.kind}` + (it.done ? ' is-done' : ''),
            style: { '--event-colour': /^#[0-9a-fA-F]{3,8}$/.test(it.colour) ? it.colour : 'var(--app-muted)' },
        });
        cal_set_ink(row, it.colour);
        row.append(h('span', { class: 'ag-dot', 'aria-hidden': 'true' }));
        row.append(h('span', { class: 'ag-time', text: time }));

        const fullLabel = [time, title, meta.join(' · ')].filter(Boolean).join(', ');
        const open = it.kind === 'birthday'
            ? h('a', { class: 'ag-open', href: `/contacts/?id=${encodeURIComponent(it.id)}`, title: title, 'aria-label': `${fullLabel}. Open contact` })
            : it.kind === 'todo'
            ? h('a', { class: 'ag-open', href: `/tasks/?task=${encodeURIComponent(it.id)}`, title: title, 'aria-label': `${fullLabel}. Open in Tasks` })
            : h('button', { type: 'button', class: 'ag-open', 'data-event-id': it.id, 'data-start': it.start, title: title, 'aria-label': `${fullLabel}. Show details` });
        const main = h('span', { class: 'ag-main' }, [
            h('span', { class: 'ag-title', text: title }),
            h('span', { class: 'ag-meta', text: meta.join(' · ') }),
        ]);
        row.append(main, open);

        if (it.kind === 'deadline' && !it.done) {
            if (it.has_todo) {
                row.append(h('span', { class: 'ag-intask', title: 'Already in Tasks' }, [icon('check'), ' Task']));
            } else {
                const add = h('button', { type: 'button', class: 'ag-add', 'data-add-task': it.id, title: 'Add to tasks', 'aria-label': `Add "${title}" to tasks` }, [icon('plus'), ' Task']);
                row.append(add);
            }
        }
        return row;
    }

    agendaBox.addEventListener('click', (e) => {
        if (e.target.closest('[data-agenda-retry]')) { loadAgenda(); return; }
        const add = e.target.closest('[data-add-task]');
        if (add) {
            add.disabled = true;
            api(`/api/v2/tasks/from-event/${encodeURIComponent(add.dataset.addTask)}`, { method: 'POST' }).then(task => {
                add.replaceWith(h('span', { class: 'ag-intask', title: 'Added to Tasks' }, [icon('check'), ' Task']));
                upsert_todo(task);
                after_local_change();
            }).catch(() => {
                add.disabled = false;
                add.title = "Couldn't add. Try again";
            });
            return;
        }
        const open = e.target.closest('button.ag-open');
        if (open) open_event_by_id(open.dataset.eventId, open.dataset.start);
    });

    // ------------------------------------------------------------------ Insight tab
    const insPanel = document.querySelector('.sb-insight');
    const insBody = insPanel.querySelector('.ins-body');
    const insRange = insPanel.querySelector('.ins-range-label');
    const insReset = insPanel.querySelector('.ins-reset');
    const insCache = new Map();
    const insInflight = new Map();
    let insSeq = 0;
    let insPeriod = 'week';
    try { if (localStorage.getItem('calendar_insight_period') === 'month') insPeriod = 'month'; } catch (e) { }
    let insAnchor = startOfDay(new Date());

    function periodBounds(period, anchor) {
        if (period === 'week') {
            const start = new Date(anchor);
            start.setDate(start.getDate() - ((start.getDay() + 6) % 7));  // Monday, like the API
            const end = new Date(start); end.setDate(end.getDate() + 6);
            return [start, end];
        }
        return [new Date(anchor.getFullYear(), anchor.getMonth(), 1), new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)];
    }

    function rangeLabel(period, start, end) {
        if (period === 'month') return moment(start).format('MMMM YYYY');
        if (start.getFullYear() !== end.getFullYear()) return `${moment(start).format('MMM D, YYYY')} – ${moment(end).format('MMM D, YYYY')}`;
        if (start.getMonth() !== end.getMonth()) return `${moment(start).format('MMM D')} – ${moment(end).format('MMM D, YYYY')}`;
        return `${moment(start).format('MMM D')} – ${moment(end).format('D, YYYY')}`;
    }

    function setPeriodUi() {
        insPanel.querySelectorAll('.ins-seg-btn').forEach(b => b.setAttribute('aria-pressed', b.dataset.period === insPeriod ? 'true' : 'false'));
        const [start, end] = periodBounds(insPeriod, insAnchor);
        insRange.textContent = rangeLabel(insPeriod, start, end);
        const today = startOfDay(new Date());
        insReset.hidden = today >= start && today <= end;
        insReset.textContent = insPeriod === 'week' ? 'This week' : 'This month';
    }

    function loadInsights() {
        setPeriodUi();
        const key = `${insPeriod}|${ymd(periodBounds(insPeriod, insAnchor)[0])}`;
        const seq = ++insSeq;
        if (insCache.has(key)) { renderInsights(insCache.get(key)); return; }
        insBody.replaceChildren(skeleton(['100%', '100%', '100%', '100%', '60%', '100%', '100%', '80%']));
        insBody.setAttribute('aria-busy', 'true');
        // One request per period even when several triggers fire at once.
        if (!insInflight.has(key)) insInflight.set(key, api(`/api/v2/calendar/insights?period=${insPeriod}&date=${ymd(insAnchor)}`).finally(() => insInflight.delete(key)));
        insInflight.get(key).then(d => {
            insCache.set(key, d);
            if (seq === insSeq) renderInsights(d);
        }).catch(() => {
            if (seq !== insSeq) return;
            insBody.replaceChildren(h('div', { class: 'sidebar-empty' }, [
                "Couldn't load insights. ",
                h('button', { type: 'button', class: 'sb-link', 'data-ins-retry': '', text: 'Retry' }),
            ]));
        }).finally(() => { if (seq === insSeq) insBody.removeAttribute('aria-busy'); });
    }

    insPanel.addEventListener('click', (e) => {
        const seg = e.target.closest('[data-period]');
        const shift = e.target.closest('[data-shift]');
        if (seg) {
            if (seg.dataset.period === insPeriod) return;
            insPeriod = seg.dataset.period === 'month' ? 'month' : 'week';
            try { localStorage.setItem('calendar_insight_period', insPeriod); } catch (err) { }
        } else if (shift) {
            const n = parseInt(shift.dataset.shift);
            if (n === 0) insAnchor = startOfDay(new Date());
            else if (insPeriod === 'week') insAnchor.setDate(insAnchor.getDate() + 7 * n);
            else insAnchor = new Date(insAnchor.getFullYear(), insAnchor.getMonth() + n, 1);
        } else if (e.target.closest('[data-ins-retry]')) {
            // fall through to reload
        } else {
            return;
        }
        loadInsights();
    });

    function section(title, children, extraClass) {
        return h('section', { class: 'ins-section' + (extraClass ? ' ' + extraClass : '') }, [h('h3', { class: 'ins-h', text: title }), ...[].concat(children)]);
    }

    // value delta vs previous period; neutral colour (more hours is neither good nor bad)
    function delta(cur, prev, fmt, unitWord) {
        if (prev === undefined || prev === null) return h('span', { class: 'ins-delta' });
        const diff = Math.round((cur - prev) * 100) / 100;
        const prevWord = insPeriod === 'week' ? 'last week' : 'last month';
        if (diff === 0) return h('span', { class: 'ins-delta is-same', title: `Same as ${prevWord}`, 'aria-label': `same as ${prevWord}`, text: '=' });
        const up = diff > 0;
        return h('span', {
            class: 'ins-delta', title: `${fmt(prev)} ${prevWord}`,
            'aria-label': `${up ? 'up' : 'down'} ${fmt(Math.abs(diff))}${unitWord ? ' ' + unitWord : ''} from ${prevWord}`,
        }, [icon(up ? 'up' : 'down'), ` ${fmt(Math.abs(diff))}`]);
    }

    function kpis(d) {
        const t = d.totals, p = d.previous;
        const n = (v) => String(v);
        const rows = [
            ['Hours scheduled', fmtHours(t.hours), delta(t.hours, p.hours, fmtHours)],
            ['Events', n(t.events), delta(t.events, p.events, n, 'events')],
            ['Deadlines', n(t.deadlines), delta(t.deadlines, p.deadlines, n, 'deadlines')],
            ['Meetings', fmtHours(t.meeting_hours), delta(t.meeting_hours, p.meeting_hours, fmtHours)],
            ['Focus time', fmtHours(t.focus_hours), delta(t.focus_hours, p.focus_hours, fmtHours)],
            ['Tasks completed', n(d.todos.completed), delta(d.todos.completed, d.todos.completed_previous, n, 'tasks')],
            ['Photos taken', n(d.photos), delta(d.photos, p.photos, n, 'photos')],
        ];
        return h('dl', { class: 'ins-kpis' }, rows.map(([label, value, dl]) => h('div', { class: 'ins-kpi' }, [
            h('dt', { text: label }), h('dd', {}, [h('span', { class: 'ins-kpi-val', text: value }), dl]),
        ])));
    }

    // Column chart: one bar per value. labels: under-bar text or null; tips: per-bar tooltip.
    function columns(values, { labels = null, tips = [], highlight = -1, height = 44, ariaLabel = '' } = {}) {
        const n = values.length;
        const W = 224, gap = n > 14 ? 2 : 12;
        const bw = (W - gap * (n - 1)) / n;
        const max = Math.max(...values, 0);
        const labelH = labels ? 12 : 0;
        const svg = s('svg', { class: 'ins-cols', viewBox: `0 0 ${W} ${height + labelH}`, role: 'img', 'aria-label': ariaLabel });
        values.forEach((v, i) => {
            const x = i * (bw + gap);
            const bh = max ? Math.max(v > 0 ? 2 : 0, (v / max) * (height - 2)) : 0;
            const g = s('g', { class: 'ins-col' + (i === highlight ? ' is-today' : '') });
            g.append(s('rect', { class: 'ins-col-hit', x, y: 0, width: bw + gap, height: height + labelH }));
            g.append(s('rect', { class: 'ins-col-track', x, y: height - 1, width: bw, height: 1 }));
            if (bh) g.append(s('rect', { class: 'ins-col-bar', x, y: height - bh, width: bw, height: bh, rx: Math.min(2, bw / 2) }));
            if (labels) {
                const tx = s('text', { class: 'ins-col-label', x: x + bw / 2, y: height + labelH - 2, 'text-anchor': 'middle' });
                tx.textContent = labels[i];
                g.append(tx);
            }
            if (tips[i]) g.append(svgTitle(tips[i]));
            svg.append(g);
        });
        return svg;
    }

    function heatmap(heat, byHour) {
        const LW = 17, C = 8.75, R = 11, G = 1.5, rows = 7, cols = 24, axisH = 12;  // cells are 9 wide, 11 tall
        const W = LW + cols * C, H = rows * R + axisH;
        const max = Math.max(0, ...heat.flat());
        const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const peakHour = byHour.indexOf(Math.max(...byHour));
        const svg = s('svg', {
            class: 'ins-heat', viewBox: `0 0 ${W} ${H}`, role: 'img',
            'aria-label': max ? `Scheduled hours by weekday and hour of day. Busiest hour: ${moment({ hour: peakHour }).format('h A')}.` : 'No timed events',
        });
        heat.forEach((row, r) => {
            const lab = s('text', { class: 'ins-axis', x: 0, y: r * R + R - 3 });
            lab.textContent = names[r].slice(0, 2);
            svg.append(lab);
            row.forEach((v, c) => {
                const level = !v || !max ? 0 : Math.min(4, Math.ceil((v / max) * 4));
                const rect = s('rect', { class: `ins-cell l${level}`, x: LW + c * C, y: r * R, width: C - G, height: R - G, rx: 1.5 });
                rect.append(svgTitle(`${names[r]} ${moment({ hour: c }).format('h A')} · ${fmtHours(v)}`));
                svg.append(rect);
            });
        });
        for (const hr of [0, 6, 12, 18]) {
            const t = s('text', { class: 'ins-axis', x: LW + hr * C, y: H - 1 });
            t.textContent = hr === 0 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p`;
            svg.append(t);
        }
        return svg;
    }

    function heatLegend() {
        return h('div', { class: 'ins-legend', 'aria-hidden': 'true' }, [
            h('span', { text: 'Less' }),
            ...[0, 1, 2, 3, 4].map(l => h('span', { class: `ins-swatch l${l}` })),
            h('span', { text: 'More' }),
        ]);
    }

    function bars(items, { colour = null, max = null } = {}) {
        const top = max || Math.max(...items.map(i => i.hours), 0.0001);
        return h('div', { class: 'ins-bars' }, items.map(it => {
            const tip = `${it.label} · ${fmtHours(it.hours)} · ${it.events} event${it.events === 1 ? '' : 's'}`;
            const c = colour ? colour(it) : null;
            return h('div', { class: 'ins-bar-row', title: tip }, [
                h('span', { class: 'ins-bar-label' }, [c ? h('span', { class: 'ins-bar-dot', style: { '--bar-colour': c, '--ink-l': (cal_ink(c) || {}).l || c, '--ink-d': (cal_ink(c) || {}).d || c }, 'aria-hidden': 'true' }) : null, it.label]),
                h('span', { class: 'ins-bar-track', 'aria-hidden': 'true' }, [
                    h('span', { class: 'ins-bar-fill' + (c ? ' has-colour' : ''), style: { width: `${Math.max(2, (it.hours / top) * 100)}%`, ...(c ? { '--bar-colour': c } : {}) } }),
                ]),
                h('span', { class: 'ins-bar-val', text: fmtHours(it.hours) }),
                h('span', { class: 'visually-hidden', text: `, ${it.events} events` }),
            ]);
        }));
    }

    function foldOther(list, keep) {
        if (list.length <= keep) return list;
        const rest = list.slice(keep - 1);
        return [...list.slice(0, keep - 1), {
            label: `${rest.length} more`, hours: rest.reduce((a, b) => a + b.hours, 0), events: rest.reduce((a, b) => a + b.events, 0),
        }];
    }

    function facts(d) {
        const t = d.totals;
        const rows = [];
        if (t.busiest_day) rows.push(['Busiest day', `${moment(t.busiest_day.date).format('ddd MMM D')} · ${fmtHours(t.busiest_day.hours)}`]);
        if (t.typical_start) rows.push(['Typical day', `${fmtClock(t.typical_start)} – ${fmtClock(t.typical_end)}`]);
        rows.push(['Evenings (6 PM+)', fmtHours(t.evening_hours)]);
        if (t.early_hours) rows.push(['Early (before 8 AM)', fmtHours(t.early_hours)]);
        rows.push(['Weekends', fmtHours(t.weekend_hours)]);
        rows.push(['Free days', String(t.free_days)]);
        if (t.timed_events) rows.push(['Average event', fmtMinutes(t.avg_minutes)]);
        if (t.longest_minutes) rows.push(['Longest event', fmtMinutes(t.longest_minutes)]);
        if (t.all_day) rows.push(['All-day events', String(t.all_day)]);
        rows.push(['Tasks due', String(d.todos.due)]);
        if (d.todos.overdue_now) rows.push(['Overdue now', String(d.todos.overdue_now)]);
        return h('dl', { class: 'ins-facts' }, rows.map(([k, v]) => h('div', { class: 'ins-fact' }, [h('dt', { text: k }), h('dd', { text: v })])));
    }

    function renderInsights(d) {
        const out = [kpis(d)];
        const t = d.totals;
        const today = ymd(new Date());
        const word = insPeriod === 'week' ? 'week' : 'month';

        if (!t.events && !t.hours) {
            out.push(h('div', { class: 'ins-empty', text: `No events this ${word}.` }));
            insBody.replaceChildren(...out);
            return;
        }

        const dayTips = d.per_day.map(p => `${moment(p.date).format('ddd MMM D')} · ${fmtHours(p.hours)} · ${p.events} event${p.events === 1 ? '' : 's'}`);
        const todayIdx = d.per_day.findIndex(p => p.date === today);
        if (insPeriod === 'week') {
            out.push(section('By day', columns(d.per_day.map(p => p.hours), {
                labels: d.per_day.map(p => moment(p.date).format('dd')[0]), tips: dayTips, highlight: todayIdx,
                ariaLabel: 'Hours per day: ' + d.per_day.map((p, i) => `${moment(p.date).format('ddd')} ${fmtHours(p.hours)}`).join(', '),
            })));
        } else {
            out.push(section('Daily', [
                columns(d.per_day.map(p => p.hours), { tips: dayTips, highlight: todayIdx, height: 36, ariaLabel: `Hours per day this month, busiest ${t.busiest_day ? moment(t.busiest_day.date).format('MMM D') : 'none'}` }),
                h('div', { class: 'ins-axis-row', 'aria-hidden': 'true' }, [
                    h('span', { text: moment(d.start).format('MMM D') }), h('span', { text: moment(d.end).format('MMM D') }),
                ]),
            ]));
            const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            out.push(section('By weekday', columns(d.by_weekday, {
                labels: wd.map(x => x[0]), tips: d.by_weekday.map((v, i) => `${wd[i]} · ${fmtHours(v)} total`),
                ariaLabel: 'Hours by weekday: ' + d.by_weekday.map((v, i) => `${wd[i]} ${fmtHours(v)}`).join(', '),
            })));
        }

        out.push(section('Time of day', [heatmap(d.heat, d.by_hour), heatLegend()]));

        if (d.by_category.length) {
            out.push(section('By category', bars(foldOther(d.by_category, 6))));
        }
        if (d.by_calendar.length) {
            const list = d.by_calendar.map(c => ({ ...c, label: plain(c.name) }));
            out.push(section('By calendar', bars(list, { colour: c => /^#[0-9a-fA-F]{3,8}$/.test(c.colour) ? c.colour : null })));
        }

        out.push(section('Patterns', facts(d)));

        if (d.top_locations.length) {
            out.push(section('Top places', h('ol', { class: 'ins-places' }, d.top_locations.map(l => h('li', {}, [
                h('span', { class: 'ins-place-name', text: plain(l.name), title: plain(l.name) }),
                h('span', { class: 'ins-place-count', text: `${l.count}×`, 'aria-label': `${l.count} times` }),
            ])))));
        }
        insBody.replaceChildren(...out);
    }

    // ------------------------------------------------------------------ wiring
    function refreshVisible(force) {
        if (isVisible(upPanel) && (force || Date.now() - agendaLoadedAt > 5 * 60000)) loadAgenda();
        if (isVisible(insPanel) && force) loadInsights();
    }

    document.addEventListener('calendar:sidebar', (e) => {
        if (e.detail.tab === '.sb-upcoming' && (!agendaLoadedAt || Date.now() - agendaLoadedAt > 60000)) loadAgenda();
        if (e.detail.tab === '.sb-insight') loadInsights();
    });
    // Data reloads: every minute (tick) and after edits (manual). Edits invalidate insights.
    // Month paging doesn't touch the agenda/insights; edits do, background refreshes only when stale.
    document.addEventListener('calendar:loaded', (e) => {
        if (e.detail.manual) { insCache.clear(); agendaLoadedAt = 0; refreshVisible(true); }
        else if (e.detail.background) refreshVisible(false);
    });
    document.addEventListener('calendar:changed', () => { insCache.clear(); agendaLoadedAt = 0; refreshVisible(true); });

    // First loads come from widgets.js when each widget is first on screen.
})();
