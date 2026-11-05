// AVNet Superapp Calendar: page chrome (mini month, event search, keyboard-shortcut help).
// Uses globals from script.js: currentDayDate, currentView, calendars, go_to_date(), open_event_by_id(),
// plain(), short_time(). User data only ever goes into textContent.
(function () {
    'use strict';

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
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const CHEV = (d) => `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;

    // ------------------------------------------------------------------ mini month
    // Every [data-mini] box (left sidebar, optional sidebar widget) shows the same month.
    const minis = [...document.querySelectorAll('[data-mini]')];
    let miniMonth = new Date(currentDayDate.getFullYear(), currentDayDate.getMonth(), 1);

    function renderMini() {
        const sel = new Date(currentDayDate);
        const today = new Date();
        const weekStart = new Date(sel); weekStart.setDate(sel.getDate() - sel.getDay()); weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

        const prev = h('button', { type: 'button', class: 'cal-icon-btn cal-mini-nav', 'data-mini-shift': '-1', 'aria-label': 'Previous month', title: 'Previous month' });
        prev.innerHTML = CHEV('M10 3 5 8l5 5');
        const next = h('button', { type: 'button', class: 'cal-icon-btn cal-mini-nav', 'data-mini-shift': '1', 'aria-label': 'Next month', title: 'Next month' });
        next.innerHTML = CHEV('m6 3 5 5-5 5');
        const head = h('div', { class: 'cal-mini-head' }, [
            h('span', { class: 'cal-mini-title', text: moment(miniMonth).format('MMMM YYYY'), 'aria-live': 'polite' }), prev, next,
        ]);

        const grid = h('div', { class: 'cal-mini-grid', role: 'grid', 'aria-label': moment(miniMonth).format('MMMM YYYY') });
        for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(h('span', { class: 'cal-mini-wd', 'aria-hidden': 'true', text: d }));
        const start = new Date(miniMonth); start.setDate(1 - miniMonth.getDay());
        for (let i = 0; i < 42; i++) {
            const d = new Date(start); d.setDate(start.getDate() + i);
            const cls = ['cal-mini-day'];
            if (d.getMonth() !== miniMonth.getMonth()) cls.push('is-out');
            if (sameDay(d, today)) cls.push('is-today');
            if (currentView === 'day' && sameDay(d, sel)) cls.push('is-sel');
            if (currentView === 'week' && d >= weekStart && d < weekEnd) cls.push('in-week');
            grid.append(h('button', {
                type: 'button', class: cls.join(' '), 'data-date': `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
                'aria-label': d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
                'aria-current': sameDay(d, today) ? 'date' : null, text: String(d.getDate()),
            }));
        }
        minis.forEach((box, i) => {
            if (i === 0) { box.replaceChildren(head, grid); return; }
            const copy = [head.cloneNode(true), grid.cloneNode(true)];
            copy[1].querySelectorAll('[aria-current]').forEach(el => el.removeAttribute('aria-current'));  // one "today" per page
            box.replaceChildren(...copy);
        });
    }

    const onMiniClick = (e) => {
        const shift = e.target.closest('[data-mini-shift]');
        if (shift) {
            miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + parseInt(shift.dataset.miniShift), 1);
            renderMini();
            return;
        }
        const day = e.target.closest('[data-date]');
        if (day) {
            const [Y, M, D] = day.dataset.date.split('-').map(Number);
            go_to_date(new Date(Y, M, D));
        }
    };
    minis.forEach(box => box.addEventListener('click', onMiniClick));

    // Follow the main view (navigation, Today, view switches).
    document.addEventListener('calendar:view', (e) => {
        const d = currentView === 'month' ? new Date(y, m, 1) : e.detail.date;
        miniMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        renderMini();
    });
    renderMini();

    // ------------------------------------------------------------------ event search
    const q = document.getElementById('cal-q');
    const results = document.getElementById('cal-q-results');
    let searchSeq = 0, timer = null, active = -1, items = [];

    function closeResults() {
        results.hidden = true;
        q.setAttribute('aria-expanded', 'false');
        q.removeAttribute('aria-activedescendant');
        active = -1;
    }

    function setActive(i) {
        const opts = results.querySelectorAll('[role="option"]');
        if (!opts.length) return;
        active = (i + opts.length) % opts.length;
        opts.forEach((o, j) => o.setAttribute('aria-selected', j === active ? 'true' : 'false'));
        q.setAttribute('aria-activedescendant', opts[active].id);
        opts[active].scrollIntoView({ block: 'nearest' });
    }

    function showMessage(text) {
        results.replaceChildren(h('div', { class: 'cal-pop-msg', text }));
        results.hidden = false;
        q.setAttribute('aria-expanded', 'true');
    }

    function choose(i) {
        const ev = items[i];
        if (!ev) return;
        closeResults();
        q.blur();
        go_to_date(new Date(ev.start));
        open_event_by_id(ev.id, ev.start);
    }

    function search(text) {
        const seq = ++searchSeq;
        const now = new Date();
        const start = new Date(now); start.setDate(start.getDate() - 200);
        const end = new Date(now); end.setDate(end.getDate() + 199);
        showMessage('Searching…');
        fetch(`/api/v2/calendar/events?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&q=${encodeURIComponent(text)}`, { credentials: 'same-origin' })
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(list => {
                if (seq !== searchSeq) return;
                // Upcoming first (soonest first), then past ones (most recent first).
                const upcoming = list.filter(e => new Date(e.end || e.start) >= now);
                const past = list.filter(e => new Date(e.end || e.start) < now).reverse();
                items = upcoming.concat(past).slice(0, 12);
                if (!items.length) { showMessage('No events match.'); return; }
                results.replaceChildren(...items.map((ev, i) => {
                    const s = new Date(ev.start);
                    const cal = calendars[ev.calendar_id];
                    const colour = cal && /^#[0-9a-fA-F]{3,8}$/.test(cal.colour) ? cal.colour : 'var(--app-muted)';
                    const when = ev.all_day ? `${moment(s).format('ddd MMM D, YYYY')} · All day`
                        : `${moment(s).format('ddd MMM D, YYYY')} · ${ev.kind === 'deadline' ? 'Due ' : ''}${short_time(s)}`;
                    return h('button', { type: 'button', class: 'cal-res' + (new Date(ev.end || ev.start) < now ? ' is-past' : ''), role: 'option', id: `cal-res-${i}`, 'data-i': i, 'aria-selected': 'false', tabindex: '-1' }, [
                        h('span', { class: 'cal-res-dot', style: { '--event-colour': colour }, 'aria-hidden': 'true' }),
                        h('span', { class: 'cal-res-main' }, [
                            h('span', { class: 'cal-res-title', text: plain(ev.name) }),
                            h('span', { class: 'cal-res-meta', text: [when, cal ? plain(cal.calendar.name) : ''].filter(Boolean).join(' · ') }),
                        ]),
                    ]);
                }));
                results.hidden = false;
                q.setAttribute('aria-expanded', 'true');
            })
            .catch(() => { if (seq === searchSeq) showMessage("Couldn't search right now."); });
    }

    q.addEventListener('input', () => {
        clearTimeout(timer);
        const text = q.value.trim();
        if (text.length < 2) { searchSeq++; closeResults(); return; }
        timer = setTimeout(() => search(text), 200);
    });
    q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); if (!results.hidden) choose(active >= 0 ? active : 0); }
        else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (q.value) { q.value = ''; searchSeq++; closeResults(); } else q.blur();
        }
    });
    q.addEventListener('focus', () => { if (q.value.trim().length >= 2 && results.childElementCount) { results.hidden = false; q.setAttribute('aria-expanded', 'true'); } });
    results.addEventListener('mousedown', (e) => e.preventDefault());  // keep focus in the input
    results.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-i]');
        if (opt) choose(parseInt(opt.dataset.i));
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.cal-search')) closeResults(); });

    // ------------------------------------------------------------------ shortcuts help
    const help = document.getElementById('cal-help');
    document.addEventListener('calendar:help', () => { if (!help.open) help.showModal(); });
    help.addEventListener('click', (e) => {
        if (e.target === help || e.target.closest('[data-dialog-close]')) help.close();
    });
})();
