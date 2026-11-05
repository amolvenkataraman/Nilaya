// Public calendar page: month grid filled with the calendar's events (as text, never HTML).
// Server data: json_script (calendar-id, calendar-colour) and data-* URLs on .main-container.
const CALENDAR_ID = JSON.parse(document.getElementById('calendar-id').textContent);
const CALENDAR_COLOUR = JSON.parse(document.getElementById('calendar-colour').textContent);
const PAGE = document.querySelector('.main-container');
const EVENTS_URL = PAGE.dataset.eventsUrl;
const SUBSCRIBE_URL = PAGE.dataset.subscribeUrl;

function csrfToken() {
    const m = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
}

// Fetch the month's events and place each one (as text, never HTML) on every day it covers.
function loadEvents(month, year) {
    fetch(`${EVENTS_URL}?calendar=${CALENDAR_ID}&timespan=month&time=${year}-${month + 1}`)
        .then((r) => r.json())
        .then((res) => {
            if (month !== currentMonth || year !== currentYear) return;  // user moved on
            const lastDay = daysInMonth(month, year);
            for (const ev of res.events || []) {
                const start = new Date(ev.startdate);
                const end = ev.enddate ? new Date(ev.enddate) : start;
                const time = ev.allday ? '' : start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                const label = time ? `${time} ${ev.name}` : ev.name;
                // all-day/multi-day events end at midnight of the following day
                const endInclusive = new Date(end.getTime() - (ev.enddate && end > start ? 1 : 0));
                for (let d = 1; d <= lastDay; d++) {
                    const dayStart = new Date(year, month, d), dayEnd = new Date(year, month, d + 1);
                    if (start < dayEnd && endInclusive >= dayStart) {
                        const box = document.querySelector(`.reg-events-${d}`);
                        const div = document.createElement('div');
                        div.className = 'public-event';
                        div.style.setProperty('--event-colour', CALENDAR_COLOUR);
                        if (time) {
                            const t = document.createElement('span');
                            t.className = 'ev-time';
                            t.textContent = time;
                            div.appendChild(t);
                        }
                        const n = document.createElement('span');
                        n.textContent = ev.name;
                        div.appendChild(n);
                        div.title = [label, ev.location].filter(Boolean).join(' — ');
                        box.appendChild(div);
                    }
                }
            }
        });
}

const subscribeBtn = document.querySelector('.public-subscribe-btn');
if (subscribeBtn) {
    subscribeBtn.onclick = () => {
        subscribeBtn.disabled = true;
        fetch(`${SUBSCRIBE_URL}?calendar=${CALENDAR_ID}`, { method: 'POST', headers: { 'X-CSRFToken': csrfToken() } })
            .then((r) => r.json())
            .then((res) => {
                if (res.status === 'success') { subscribeBtn.textContent = 'Subscribed'; }
                else { alert(res.data); subscribeBtn.disabled = false; }
            });
    };
}

function generate_year_range(start, end) {
    var years = "";
    for (var year = start; year <= end; year++) {
            years += "<option value='" + year + "'>" + year + "</option>";
    }
    return years;
}

var today = new Date();
var currentMonth = today.getMonth();
var currentYear = today.getFullYear();
var selectYear = document.getElementById("year");
var selectMonth = document.getElementById("month");


var createYear = generate_year_range(currentYear - 5, currentYear + 5);

document.getElementById("year").innerHTML = createYear;

var calendar = document.getElementById("calendar");
var lang = calendar.getAttribute('data-lang');

var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

var dayHeader = "<tr>";
for (day in days) {
    dayHeader += "<th data-days='" + days[day] + "'>" + days[day] + "</th>";
}
dayHeader += "</tr>";

document.getElementById("thead-month").innerHTML = dayHeader;


monthAndYear = document.getElementById("monthAndYear");
showCalendar(currentMonth, currentYear);



function next() {
    currentYear = (currentMonth === 11) ? currentYear + 1 : currentYear;
    currentMonth = (currentMonth + 1) % 12;
    showCalendar(currentMonth, currentYear);
}

function previous() {
    currentYear = (currentMonth === 0) ? currentYear - 1 : currentYear;
    currentMonth = (currentMonth === 0) ? 11 : currentMonth - 1;
    showCalendar(currentMonth, currentYear);
}

function jump() {
    currentYear = parseInt(selectYear.value);
    currentMonth = parseInt(selectMonth.value);
    showCalendar(currentMonth, currentYear);
}

function showCalendar(month, year) {
    currentMonth = month;
    currentYear = year;
    var firstDay = ( new Date( year, month ) ).getDay();

    tbl = document.getElementById("calendar-body");


    tbl.innerHTML = "";


    monthAndYear.innerHTML = months[month] + " " + year;
    selectYear.value = year;
    selectMonth.value = month;

    // creating all cells
    var date = 1;
    for (var i = 0; i < 6; i++) {
        today = new Date();

        var row = document.createElement("tr");

        for (var j = 0; j < 7; j++) {
            if (i === 0 && j < firstDay) {
                cell = document.createElement( "td" );
                cellText = document.createTextNode("");
                cell.appendChild(cellText);
                cell.className = `date-picker-dead`;
                row.appendChild(cell);
            } else if (date > daysInMonth(month, year)) {
                if (row.innerHTML != "") {
                    cell = document.createElement( "td" );
                    cellText = document.createTextNode("");
                    cell.appendChild(cellText);
                    cell.className = `date-picker-dead`;
                    row.appendChild(cell);
                }
            } else {
                cell = document.createElement("td");
                cell.setAttribute("data-date", date);
                cell.setAttribute("data-month", month + 1);
                cell.setAttribute("data-year", year);
                cell.setAttribute("data-month_name", months[month]);
                cell.setAttribute("data-day", j);
                cell.className = `date-picker date-picker-${date}`;
                cell.innerHTML = `
                    <div class='date-span'><span >${date}</span></div>
                    <div class='day-events day-events-${date}'></div>
                    <div class='reg-events reg-events-${date}'></div>
                `

                if ( date === today.getDate() && year === today.getFullYear() && month === today.getMonth() ) {
                    cell.className = `date-picker selected date-picker-${date}`;
                }
                row.appendChild(cell);
                date++;
            }
        }

        if (row.innerHTML != "") {
            tbl.appendChild(row);
        }
    }
    loadEvents(month, year);
}

function daysInMonth(iMonth, iYear) {
    return 32 - new Date(iYear, iMonth, 32).getDate();
}

document.querySelector('[data-action="prev"]').addEventListener('click', previous);
document.querySelector('[data-action="next"]').addEventListener('click', next);
document.querySelector('[data-action="today"]').addEventListener('click', () => showCalendar(new Date().getMonth(), new Date().getFullYear()));
selectMonth.addEventListener('change', jump);
selectYear.addEventListener('change', jump);
