/* Home dashboard (mainsite/home.html): clock, greeting, next-7-days events/todos and web search.
 * Server data: #first-name (json_script) and data-recent-url on .dash. */
(function () {
    var data = null;
    var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    function setGreeting() {
        const name = JSON.parse(document.getElementById('first-name').textContent);
        const h = new Date().getHours();  // 0-23
        let s = h < 12 ? `Good Morning, ${name}` : h < 15 ? `Good Afternoon, ${name}`
              : h < 21 ? `Good Evening, ${name}` : `Good Night, ${name}`;

        if (data != null) {
            const now = new Date(), DAY = 1000 * 60 * 60 * 24;
            for (const event of data["events"]) {  // next event starting within 24 h
                const until = new Date(event['startdate']) - now;
                if (until >= 0 && until < DAY) {
                    s = `${event['name']} is ${moment(new Date(event['startdate'])).fromNow()}!`;
                    break;
                }
            }
            for (const todo of data["todos"]) {  // overdue, or due within 2 days
                if (!todo["complete_by"]) continue;
                const due = new Date(todo["complete_by"]);
                if (due <= now) { s = `${todo['name']} is overdue! (${moment(due).fromNow()})`; break; }
                if (due - now <= 2 * DAY) { s = `${todo['name']} must be completed ${moment(due).fromNow()}!`; break; }
            }
        }
        document.querySelector('.greeting-greeting').textContent = s;  // names are user data: text only
    }

    function pad(i) { return i < 10 ? "0" + i : String(i); }

    // Ticks once per second, aligned to the wall-clock second (was every 500 ms, which could
    // also reload the events twice during second :00).
    function startTime() {
        var today = new Date();
        var s = today.getSeconds();

        if (s == 0) {
            populateEvents();
        }

        document.querySelector('.hour').textContent = pad(today.getHours());
        document.querySelector('.minute').textContent = pad(today.getMinutes());
        document.querySelector('.second').textContent = pad(s);
        document.querySelector('.date').textContent = DAYS[today.getDay()] + ", " + today.getDate() + " " + MONTHS[today.getMonth()] + " " + today.getFullYear();

        setTimeout(startTime, 1000 - (Date.now() % 1000) + 5);
    }

    function populateEvents() {
        const r = new XMLHttpRequest();
        r.open("GET", document.querySelector('.dash').dataset.recentUrl);
        r.onload = () => {
            if (r.status == 200) {
                data = JSON.parse(r.responseText)["data"];
                setGreeting();

                // Build list items as DOM nodes: names are user data, never HTML.
                const el = (tag, cls, text) => {
                    const n = document.createElement(tag);
                    if (cls) n.className = cls;
                    if (text != null) n.textContent = text;
                    return n;
                };
                const now = new Date();
                const item = (name, colour, when, date, kind) => {
                    const overdue = kind === 'todo' && date && date <= now;
                    const li = el('li', 'dash-item');

                    // Date chip: weekday + day of month (or a dash when there's no date)
                    const chip = el('div', 'date-chip');
                    if (date) {
                        if (date.toDateString() === now.toDateString()) chip.classList.add('today');
                        if (overdue) chip.classList.add('overdue');
                        chip.append(el('span', 'dow', moment(date).format('ddd')), el('span', 'day', moment(date).format('D')));
                    } else {
                        chip.append(el('span', 'day', '–'));
                    }

                    const text = el('div', 'dash-item-text');
                    const title = el('div', 'event-name');
                    const dot = el('span', kind === 'todo' ? 'todo-dot' : 'cal-dot');
                    if (overdue) dot.classList.add('overdue');
                    if (colour && kind !== 'todo') dot.style.background = colour;
                    dot.setAttribute('aria-hidden', 'true');
                    title.append(dot, el('span', 'label', name));
                    title.title = name;
                    text.append(title, el('div', 'event-when' + (overdue ? ' overdue' : ''), when));

                    li.append(chip, text);
                    return li;
                };
                const empty = (msg) => el('li', 'dash-item empty', msg);
                const events = document.querySelector('.recent-events');
                const todos = document.querySelector('.recent-todos');
                events.replaceChildren();
                todos.replaceChildren();
                for (const ev of data["events"]) {
                    const start = new Date(ev["startdate"]);
                    let when = moment(start).calendar();
                    if (ev["allday"] == true) when = when.split(" at")[0] + " · All day";
                    events.append(item(ev["name"], ev["colour"], when, start, 'event'));
                }
                for (const td of data["todos"]) {
                    const due = td["complete_by"] ? new Date(td["complete_by"]) : null;
                    let when = due ? "Due " + moment(due).calendar().replace(/^(Today|Tomorrow|Yesterday)/, (w) => w.toLowerCase()) : "No deadline";
                    if (due && due <= now) when = "Overdue · " + moment(due).calendar();
                    todos.append(item(td["name"], td["colour"], when, due, 'todo'));
                }
                if (!data["events"].length) events.append(empty("Nothing scheduled in the next 7 days."));
                if (!data["todos"].length) todos.append(empty("No open todos. Nice."));
            }
        };
        r.send();
    }

    function search(e) {
        if (e.key === "Enter" && !e.isComposing) {
            window.location.href = `https://duckduckgo.com/?q=${encodeURIComponent(e.target.value)}`;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        setGreeting();

        startTime();

        const box = document.querySelector('#search-box');
        box.addEventListener('keydown', search);
        if (window.matchMedia('(pointer: fine)').matches) box.focus();  // no keyboard pop-up on phones

        populateEvents();

        // Background tabs throttle timers and can skip the :00 refresh; catch up on return.
        document.addEventListener('visibilitychange', () => { if (!document.hidden) populateEvents(); });
    });
})();
