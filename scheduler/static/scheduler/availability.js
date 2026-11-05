// Availability page (/calendar/availability/<username>/): pick a day, see the busy blocks.
// The API URL comes from data-busy-url on .avail-page; results are written as text.
(function () {
    'use strict';

    const root = document.querySelector('.avail-page');
    const BUSY_URL = root.dataset.busyUrl;
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const selectYear = document.getElementById("year");
    const selectMonth = document.getElementById("month");
    const title = document.getElementById("monthAndYear");
    const body = document.getElementById("calendar-body");
    const panel = document.querySelector('.day-calendar');

    const now = new Date();
    let currentMonth = now.getMonth();
    let currentYear = now.getFullYear();

    // This year and next (busy times further out are rarely useful).
    for (let yr = currentYear; yr <= currentYear + 1; yr++) selectYear.add(new Option(String(yr), String(yr)));

    const headRow = document.createElement('tr');
    for (const d of DAYS) {
        const th = document.createElement('th');
        th.textContent = d;
        headRow.append(th);
    }
    document.getElementById("thead-month").append(headRow);

    function daysInMonth(month, year) { return 32 - new Date(year, month, 32).getDate(); }

    function showCalendar(month, year) {
        currentMonth = month;
        currentYear = year;
        title.textContent = `${MONTHS[month]} ${year}`;
        selectYear.value = String(year);
        selectMonth.value = String(month);
        body.replaceChildren();

        const firstDay = new Date(year, month).getDay();
        const total = daysInMonth(month, year);
        const today = new Date();
        let date = 1;
        for (let i = 0; i < 6 && date <= total; i++) {
            const row = document.createElement('tr');
            for (let j = 0; j < 7; j++) {
                const cell = document.createElement('td');
                if ((i === 0 && j < firstDay) || date > total) {
                    cell.className = 'date-picker-dead';
                } else {
                    cell.className = 'date-picker';
                    cell.dataset.date = date;
                    if (date === today.getDate() && month === today.getMonth() && year === today.getFullYear()) cell.classList.add('selected');
                    const btn = document.createElement('div');
                    btn.className = 'date-span';
                    btn.setAttribute('role', 'button');
                    btn.tabIndex = 0;
                    btn.setAttribute('aria-label', new Date(year, month, date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
                    const num = document.createElement('span');
                    num.textContent = date;
                    btn.append(num);
                    cell.append(btn);
                    date++;
                }
                row.append(cell);
            }
            body.append(row);
        }
    }

    function jump_() { showCalendar(parseInt(selectMonth.value), parseInt(selectYear.value)); }
    function today_() { const d = new Date(); showCalendar(d.getMonth(), d.getFullYear()); }

    function showBusy(cell) {
        body.querySelectorAll('.is-picked').forEach(c => c.classList.remove('is-picked'));
        cell.classList.add('is-picked');
        const day = new Date(currentYear, currentMonth, parseInt(cell.dataset.date));
        const iso = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const label = document.createElement('div');
        label.className = 'section-label';
        label.textContent = `Busy on ${moment(day).format('ddd MMM D')}`;
        panel.replaceChildren(label);
        panel.setAttribute('aria-busy', 'true');
        fetch(`${BUSY_URL}?date=${iso}`, { credentials: 'same-origin' })
            .then(r => r.json())
            .then(res => {
                if (res.status === 'error') throw new Error(res.data);
                const busy = res.data.busy;
                if (!busy.length) {
                    const empty = document.createElement('div');
                    empty.className = 'busy-empty';
                    empty.textContent = 'Free all day.';
                    panel.append(empty);
                }
                for (const [start, end] of busy) {
                    const slot = document.createElement('div');
                    slot.className = 'busy-slot';
                    slot.textContent = `${moment(start).format('LT')} – ${moment(end).format('LT')}`;
                    panel.append(slot);
                }
            })
            .catch(err => {
                const msg = document.createElement('div');
                msg.className = 'busy-empty';
                msg.textContent = `Couldn't load busy times${err && err.message ? ': ' + err.message : ''}.`;
                panel.append(msg);
            })
            .finally(() => panel.removeAttribute('aria-busy'));
    }

    selectMonth.addEventListener('change', jump_);
    selectYear.addEventListener('change', jump_);
    document.querySelector('[data-action="today"]').addEventListener('click', today_);
    // One delegated listener, so every month's days work (not just the first one shown).
    body.addEventListener('click', (e) => {
        const cell = e.target.closest('td.date-picker');
        if (cell) showBusy(cell);
    });
    body.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.date-span')) {
            e.preventDefault();
            showBusy(e.target.closest('td'));
        }
    });

    showCalendar(currentMonth, currentYear);
})();
