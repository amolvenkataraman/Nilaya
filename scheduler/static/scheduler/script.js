// AVNet Superapp Calendar (Docket) main script
// (c) Amol Venkataraman 2019 - 2023

// Page config (server data comes from data-* attributes and json_script, never inline JS)
// =======================================================================================================================================================================
const CAL_ROOT = document.querySelector('.cal-page');
const CAL_VERSION = "6.0.0";
try {
    if (!localStorage.getItem("calendar_version")) { localStorage.setItem("calendar_version", CAL_VERSION); }
    else if (localStorage.getItem("calendar_version") != CAL_VERSION) { localStorage.setItem("calendar_version", CAL_VERSION); document.location.reload(); }
} catch (e) { }

var USER_ID = CAL_ROOT.dataset.user;
var URLS = {};
for (const [k, v] of Object.entries(CAL_ROOT.dataset)) {
    // dataset key "urlCreateEditEvent" -> URLS["create_edit_event"]
    if (k.startsWith('url')) URLS[k.slice(3).replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase())] = v;
}
var vars = JSON.parse(document.getElementById('cal-vars').textContent);
var notification = new Audio(CAL_ROOT.dataset.sound);

// Text stored by the server is bleach-cleaned (entities, a few tags). Decode it to plain
// text for display; the result must only ever go into textContent or an escaped template.
function plain(value) {
    if (value === null || value === undefined) return "";
    const s = String(value);
    if (!/[&<]/.test(s)) return s;
    return new DOMParser().parseFromString(s, 'text/html').body.textContent || "";
}

// Compact clock like Google Calendar's chips: 9a, 9:45a, 12:30p
function short_time(date) {
    const h = date.getHours(), mi = date.getMinutes();
    const h12 = h % 12 || 12;
    return `${h12}${mi ? ':' + String(mi).padStart(2, '0') : ''}${h < 12 ? 'a' : 'p'}`;
}

// ---- Contacts' birthdays (GET /api/v2/contacts/birthdays), cached per range for a day in localStorage.
var _bdayInflight = {};
var BDAY_TTL = 24 * 3600000;
function show_contact_birthdays() {
    try { return localStorage.getItem('calendar_show_contact_birthdays') !== '0'; } catch (e) { return true; }
}

function contact_birthdays(startYmd, endYmd) {
    const key = `calendar:bdays:${startYmd}:${endYmd}`;
    try {
        const c = JSON.parse(localStorage.getItem(key) || 'null');
        if (c && Date.now() - c.t < BDAY_TTL && Array.isArray(c.list)) return Promise.resolve(c.list);
    } catch (e) { }
    if (!_bdayInflight[key]) {
        _bdayInflight[key] = fetch(`/api/v2/contacts/birthdays?start=${startYmd}&end=${endYmd}`, { credentials: 'same-origin' })
            .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
            .then(list => {
                try {
                    localStorage.setItem(key, JSON.stringify({ t: Date.now(), list }));
                    // drop other cached ranges older than a day
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                        const k = localStorage.key(i);
                        if (k && k.startsWith('calendar:bdays:') && k !== key) {
                            const v = JSON.parse(localStorage.getItem(k) || 'null');
                            if (!v || Date.now() - v.t > BDAY_TTL) localStorage.removeItem(k);
                        }
                    }
                } catch (e) { }
                return list;
            })
            .finally(() => { delete _bdayInflight[key]; });
    }
    return _bdayInflight[key];
}

function birthday_label(b) {
    const name = plain(b.name);
    return b.age != null ? `${name} turns ${b.age}` : `${name}'s birthday`;
}

// Birthdays for the loaded month and its neighbours (one cached range covers the week views too).
var _contactBdays = {};   // "YYYY-MM-DD" -> [{id, name, date, age}]
var _contactBdaysRange = '';
function load_contact_birthdays() {
    if (!show_contact_birthdays()) { _contactBdays = {}; _contactBdaysRange = ''; return; }
    // Whole calendar years (one cached request per year) covering the loaded month and its neighbours.
    const years = [...new Set([new Date(y, m - 1, 1).getFullYear(), y, new Date(y, m + 1, 1).getFullYear()])];
    const range = years.join(',');
    if (range === _contactBdaysRange) return;
    _contactBdaysRange = range;
    Promise.all(years.map(yr => contact_birthdays(`${yr}-01-01`, `${yr}-12-31`))).then(lists => {
        if (range !== _contactBdaysRange) return;
        _contactBdays = {};
        for (const b of lists.flat()) (_contactBdays[b.date] = _contactBdays[b.date] || []).push(b);
        reload_calendar();
        _afterDataLoad();
    }).catch(() => { _contactBdaysRange = ''; });  // birthdays are optional: the calendar is fine without them
}

// An event's own colour (when the server sends one) or its calendar's.
function event_colour(ev) {
    const cal = calendars[ev['calendar']];
    return cal_hex(ev['display_colour']) || cal_hex(ev['colour']) || (cal ? cal['colour'] : 'var(--app-muted)');
}

// Legacy API: deadlines have enddate null (older code also checked the string "None").
function has_end(ev) {
    return ev.enddate !== null && ev.enddate !== undefined && ev.enddate !== 'None';
}

// Right-hand drawer (event details and the event form), like the Tasks detail drawer
// =======================================================================================================================================================================
var _drawerReturnFocus = null;

// Open the drawer with `html` (a compiled, escaped template) and return its body element.
function drawer_open(title, html) {
    const dr = document.getElementById('cal-drawer');
    const body = dr.querySelector('.cal-drawer-body');
    dr.querySelector('.cal-drawer-title').textContent = title;
    body.innerHTML = html;
    body.scrollTop = 0;
    if (dr.hidden) {
        _drawerReturnFocus = document.activeElement;
        dr.hidden = false;
        requestAnimationFrame(() => dr.classList.add('is-open'));
        document.body.classList.add('cal-drawer-open');
    }
    return body;
}

function drawer_close() {
    const dr = document.getElementById('cal-drawer');
    if (dr.hidden) return;
    dr.classList.remove('is-open');
    document.body.classList.remove('cal-drawer-open');
    const done = () => { if (!dr.classList.contains('is-open')) { dr.hidden = true; dr.querySelector('.cal-drawer-body').replaceChildren(); } };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setTimeout(done, 200);
    if (_drawerReturnFocus && document.contains(_drawerReturnFocus)) _drawerReturnFocus.focus();
    _drawerReturnFocus = null;
}

function drawer_is_open() { return !document.getElementById('cal-drawer').hidden; }

// Small confirmation at the bottom of the screen (text only).
function toast(message, error = false) {
    const box = document.getElementById('cal-toasts');
    const t = document.createElement('div');
    t.className = 'cal-toast' + (error ? ' is-error' : '');
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 200); }, 2600);
}

// Handlebars Templates
// =======================================================================================================================================================================
// Month chips. `icon` is a trusted static SVG; time and title are escaped text.
const calendar_item = Handlebars.compile(`
    <div class="event-button {{#if bg_color}}event-allday{{else}}event-timed{{/if}}{{#if modal}} event-open{{/if}}" data-calendar="{{ calendar }}" data-no="{{ i }}" data-type="{{ type }}" {{#if modal}}role="button" tabindex="0" {{/if}}title="{{ tip }}" style="--event-colour: {{#if bg_color}}{{ bg_color }}{{else}}{{ color }}{{/if}};{{#if ink_l}} --ink-l: {{ ink_l }}; --ink-d: {{ ink_d }};{{/if}}"><span class="event-icon">{{{ icon }}}</span>{{#if time}}<span class="ev-time">{{ time }}</span>{{/if}}<span class="ev-title">{{#if del}}<del>{{ title }}</del>{{else}}{{ title }}{{/if}}</span></div>
`);

// Contact birthday chip: a link to the contact. `icon` is the static gift SVG.
const contact_bday_chip = Handlebars.compile(`<a class="event-button event-timed event-bday" href="/contacts/?id={{ id }}" title="{{ title }}" style="--event-colour: #e87ba4;"><span class="event-icon">{{{ icon }}}</span><span class="ev-title">{{ title }}</span></a>`);

const todo_item = Handlebars.compile(`
    <div class="todo-item" data-todo-id="{{ id }}" data-i="{{ i }}">
        <button type="button" class="todo-check p{{ prio }}" data-todo-action="complete" title="Mark complete" aria-label="Mark &quot;{{ name }}&quot; complete">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-circle" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/></svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check-circle" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M10.97 4.97a.235.235 0 0 0-.02.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05z"/></svg>
        </button>
        <div class="todo-main">
            <a class="todo-name" href="/tasks/?task={{ id }}" title="Open in Tasks">{{ name }}</a>
            {{#if due}}<span class="todo-due-meta {{ cls }}">{{#if overdue}}<span class="visually-hidden">Overdue: </span>{{/if}}{{ due }}</span>{{/if}}
        </div>
        <div class="todo-actions">
            <button type="button" class="todo-action" data-bs-toggle="modal" data-bs-target="#modal" data-todo-action="edit" title="Edit" aria-label="Edit">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg>
            </button>
            <button type="button" class="todo-action danger" data-todo-action="delete" title="Delete" aria-label="Delete">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
            </button>
        </div>
    </div>
`);

const calendar_name = Handlebars.compile(`
    <div class="calendar-name-div{{#if light}} is-light{{/if}}{{#if lightD}} is-light-d{{/if}}" title="{{ tip }}" data-calendar="{{ calendar }}" data-calendar-type="{{ calendar_type }}" style="--cal-colour: {{ colour }};{{#if ink_l}} --ink-l: {{ ink_l }}; --ink-d: {{ ink_d }};{{/if}}">
        <input type="checkbox" class="form-check-input{{#if inactive}} is-inactive{{/if}}" id="cal-cb-{{ id }}" {{ checked }} data-cal-action="toggle">
        {{#if icon}}<span class="calendar-icon" aria-hidden="true">{{{ icon }}}</span>{{/if}}
        <label class="calendar-name-label{{#if inactive}} is-inactive{{/if}}" for="cal-cb-{{ id }}">{{#if admin}}<em>{{/if}}{{ name }}{{#if admin}}</em>{{/if}}</label>
        <button class="calendar-options-btn"
            type="button" id="dropdownMenu{{ id }}" data-bs-toggle="dropdown"
            aria-haspopup="true" aria-expanded="false" aria-label="Calendar options">
            <svg width="14" height="14" viewBox="0 0 16 16" class="bi bi-three-dots" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
            </svg>
        </button>
        <div class="dropdown-menu dropdown-menu-end" aria-labelledby="dropdownMenu{{ id }}">
            <button type="button" class="dropdown-item" data-cal-action="only">Display this only</button>
            <button type="button" class="dropdown-item" data-cal-action="settings">Settings</button>
            {{#if owner}}
            {{#if sync}}
            <button type="button" class="dropdown-item" data-bs-toggle="modal" data-bs-target="#modal" data-cal-action="sync">Sync Events</button>
            {{/if}}
            {{/if}}
            {{#unless c_owner}}
            <button type="button" class="dropdown-item" data-cal-action="unsubscribe">Unsubscribe</button>
            {{/unless}}
        </div>
    </div>
`);

const calendar_create_form = Handlebars.compile(`
    <label class="form-label" for="subscribe-code">Subscribe with an invite code</label>
    <div class="input-group input-group-sm">
        <input type="text" class="form-control subscribe-code" id="subscribe-code" placeholder="Invite code" aria-label="Invite code">
        <button class="btn btn-outline-primary subscribe-btn" type="button">Subscribe</button>
    </div>
    <p class="text-danger small mt-1 mb-0 subscribe-warn"></p>
    <hr class="my-3 modal-divider">
    <label class="form-label" for="calendar-name">Create a calendar</label>
    <input type="text" class="form-control form-control-sm calendar-name" id="calendar-name" placeholder="Calendar name" maxlength="64">
    <div class="pk-field"><span class="form-label">Colour</span><div class="calendar-colour-pick"></div></div>
    <div class="pk-field calendar-icon-field" hidden><span class="form-label">Icon</span><div class="calendar-icon-pick"></div></div>
    <p class="text-danger small mt-1 mb-0 calendar-warn" role="alert"></p>
    <div class="modal-actions">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary calendar-submit" type="submit">Create calendar</button>
    </div>
`);

const subscribe_confirm = Handlebars.compile(`
    <p class="mb-2 fw-semibold">Subscribe to this calendar?</p>
    <dl class="row mb-0">
        <dt class="col-4 app-muted fw-normal">Calendar</dt><dd class="col-8 mb-1">{{ name }}</dd>
        <dt class="col-4 app-muted fw-normal">Owner</dt><dd class="col-8 mb-0">{{ owner }}</dd>
    </dl>
    <div class="modal-actions">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        <button type="submit" class="btn btn-primary subscribe-confirm-btn">Subscribe</button>
    </div>
`);

const calendar_info_template = Handlebars.compile(`
    <div class="app-card cal-settings-section cal-appearance mb-3">
        <h6 class="form-section-label">Appearance</h6>
        <div class="pk-field"><span class="form-label">Colour</span><div class="cal-appearance-colour"></div></div>
        <div class="pk-field cal-appearance-icon-field" hidden><span class="form-label">Icon</span><div class="cal-appearance-icon"></div></div>
        <div class="d-flex justify-content-end align-items-center gap-2">
            <span class="small app-muted cal-appearance-msg" aria-live="polite"></span>
            <button type="button" class="btn btn-primary btn-sm cal-appearance-save">Save appearance</button>
        </div>
    </div>
    <div class="row g-3">
        <div class="col-md-6">
            <div class="app-card cal-settings-section">
                <h6 class="form-section-label">Subscribers</h6>
                <ul class='subscriber-list list-unstyled mb-0'></ul>
            </div>
        </div>
        <!-- <div class="col">
            <div class="card">
                <div class="card-body">
                    <h4 class="card-title">Upcoming</h4>
                    <p class="card-text">
                        <ul class='upcoming-list list-unstyled'></ul>
                    </p>
                </div>
            </div>
        </div> -->
        <div class="col-md-6">
            <div class="app-card cal-settings-section">
                <h6 class="form-section-label">Invites</h6>
                <p class="small app-muted mb-2">Tick an invite to enable it, untick to disable it.</p>
                <ul class='invite-list list-unstyled mb-3'></ul>
                <div class="invite-create-form">
                    <div class="input-group input-group-sm">
                        <button class="btn btn-outline-secondary random-invite" type="button" title="Random invite code" aria-label="Random invite code">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-shuffle" viewBox="0 0 16 16" aria-hidden="true">
                                <path fill-rule="evenodd" d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.624 9.624 0 0 0 7.556 8a9.624 9.624 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.595 10.595 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.624 9.624 0 0 0 6.444 8a9.624 9.624 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5z"></path>
                                <path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192zm0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192z"></path>
                            </svg>
                        </button>
                        <input class="form-control invite-text" type="text" placeholder="New invite code" aria-label="New invite code">
                        <button class="btn btn-primary create-invite" type="button">Create</button>
                    </div>
                    <p class="text-danger small mt-1 mb-0 invite-warn"></p>
                </div>
            </div>
        </div>
    </div>
    <div class="d-flex justify-content-end mt-3">
        <button type="button" class="btn btn-outline-secondary btn-sm toggle-calendar-activation-btn" data-modal-action="calendar-enable">Toggle Activation</button>
    </div>
`);

const calendar_invite = Handlebars.compile(`
    <li>
        <div class="form-check mb-0">
            <input type="checkbox" class="form-check-input" id="customCheck{{ invite_no }}" data-invite="{{ invite }}" data-calendar="{{ calendar_id }}" {{ checked }} data-modal-action="invite-toggle">
            <label class="form-check-label invite-label font-monospace" for="customCheck{{ invite_no }}">{{ invite_name }}</label>
        </div>
    </li>
`);

const calendar_sync_template = Handlebars.compile(`
    <div class="calendar-sync-dates">
        <label class="form-label">Start</label>
        <div class="input-group input-group-sm field">
            <select class="form-select month-select calendar-sync-start-month" aria-label="Start month"></select>
            <select class="form-select year-select calendar-sync-start-year" aria-label="Start year"></select>
        </div>
        <label class="form-label">End</label>
        <div class="input-group input-group-sm field">
            <select class="form-select month-select calendar-sync-end-month" aria-label="End month"></select>
            <select class="form-select year-select calendar-sync-end-year" aria-label="End year"></select>
        </div>
    </div>
    <div class="field">
        <label class="form-label" for="calendar-sync-token">Access token (optional)</label>
        <input type="text" class="form-control form-control-sm" id="calendar-sync-token">
    </div>
    <div class="modal-actions">
        <button class="btn btn-outline-secondary calendar-sync-term-btn" title="Term">T</button>
        <button class="btn btn-outline-secondary calendar-sync-term-full-btn" title="Full term">TF</button>
        <button class="btn btn-primary calendar-sync-btn">Sync</button>
    </div>
`);

// Event details. `description` is server-cleaned rich text run through parse_message();
// everything else is escaped.
const event_info_template = Handlebars.compile(`
    <div class="ei-card" data-event-id="{{ id }}">
        <h2 class="cal-dr-title">{{ title }}{{#if synced}} <span class="ei-synced" title="Synced from another calendar" aria-label="Synced">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg></span>{{/if}}</h2>
        <div class="cal-props ei-props">
            <div class="cal-prop"><span class="cal-prop-k">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>
                {{#if deadline}}Due{{else}}When{{/if}}</span><span class="cal-prop-v">{{ date }}</span></div>
            <div class="cal-prop"><span class="cal-prop-k">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/></svg>
                Calendar</span><span class="cal-prop-v"><span class="ei-color-dot" style="--cal-colour: {{ cal_color }};" aria-hidden="true"></span><span class="ei-calendar">{{ calendar }}</span></span></div>
            {{#if category}}
            <div class="cal-prop"><span class="cal-prop-k">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2a1 1 0 0 1 1-1h4.586a1 1 0 0 1 .707.293l7 7a1 1 0 0 1 0 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-7-7A1 1 0 0 1 2 6.586V2zm3.5 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>
                Category</span><span class="cal-prop-v">{{ category }}</span></div>
            {{/if}}
            {{#if location}}
            <div class="cal-prop"><span class="cal-prop-k">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
                Location</span><span class="cal-prop-v ei-meta-text">{{ location }}</span></div>
            {{/if}}
        </div>
        <div class="cal-props ei-extra"></div>
        {{#if description}}
        <h3 class="cal-sec-h">Description</h3>
        <div class="ei-desc-block">{{{ description }}}</div>
        {{/if}}
        <div class="ei-countdown">
            <a href="/calendar/countdown/{{ id }}/start/" class="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>
                {{#if deadline}}Countdown{{else}}Start{{/if}}
            </a>
            {{#unless deadline}}{{#unless allday}}
            <a href="/calendar/countdown/{{ id }}/end/" class="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>
                End
            </a>
            {{/unless}}{{/unless}}
            <button type="button" class="btn btn-sm {{#if deadline}}btn-outline-primary{{else}}btn-outline-secondary{{/if}} ei-add-task" data-ei-action="add-task">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/></svg>
                Add to tasks
            </button>
        </div>
        {{#if dev_info}}<div class="ei-dev"><i>Id: {{ id }}</i></div>{{/if}}
        {{#if owner}}
        <div class="ei-actions">
            <button type="button" class="btn btn-outline-secondary btn-sm" data-ei-action="edit">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10z"/></svg>
                Edit
            </button>
            <button type="button" class="btn btn-outline-secondary btn-sm" data-ei-action="photos">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 6.827 3h2.344a1 1 0 0 1 .707.293l.828.828A3 3 0 0 0 12.828 5H14a1 1 0 0 1 1 1v6zM2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2z"/><path d="M8 11a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm0 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 6.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/></svg>
                Photos
            </button>
            <div class="input-group input-group-sm" title="Duplicate this event N days later">
                <input type="number" id="evDupDays" class="form-control" value="1" min="-3650" max="3650" step="1" aria-label="Days"/>
                <button type="button" class="btn btn-outline-secondary btn-sm" data-ei-action="duplicate">Duplicate</button>
            </div>
            <button type="button" class="btn btn-outline-danger btn-sm ms-auto" data-ei-action="delete">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                Delete
            </button>
        </div>
        {{/if}}
    </div>
`);

// New/edit event form, rendered in the right-hand drawer (saved through the V2 events API).
const event_create_template = Handlebars.compile(`
    <form class="event-form cal-form" novalidate>
        <label class="visually-hidden" for="event-name-input">Title</label>
        <input type="text" class="cal-form-title event-name-input event-name-input-1" id="event-name-input" placeholder="Add title" maxlength="256" autocomplete="off" required>

        <div class="cal-seg cal-seg-full event-type-group" role="radiogroup" aria-label="Event type">
            <input type="radio" class="btn-check event-type-btn event-type-btn-event" name="event-type-1" id="event-type-event-1" data-event-type="event" autocomplete="off">
            <label class="cal-seg-btn" for="event-type-event-1">Event</label>
            <input type="radio" class="btn-check event-type-btn event-type-btn-ade" name="event-type-1" id="event-type-ade-1" data-event-type="ade" autocomplete="off">
            <label class="cal-seg-btn" for="event-type-ade-1">All day</label>
            <input type="radio" class="btn-check event-type-btn event-type-btn-assignment" name="event-type-1" id="event-type-assignment-1" data-event-type="assignment" autocomplete="off">
            <label class="cal-seg-btn" for="event-type-assignment-1">Deadline</label>
        </div>

        <div class="cal-props">
            <div class="event-datetime event-datetime-event">
                <div class="cal-prop"><span class="cal-prop-k">Starts</span>
                    <span class="cal-prop-v cal-dt">
                        <input type="date" class="form-control form-control-sm event-date-start event-date-start-event" aria-label="Start date">
                        <input type="time" class="form-control form-control-sm event-time-start event-time-start-event" aria-label="Start time">
                    </span>
                </div>
                <div class="cal-prop"><span class="cal-prop-k">Ends</span>
                    <span class="cal-prop-v cal-dt">
                        <input type="date" class="form-control form-control-sm event-date-end event-date-end-event" aria-label="End date">
                        <input type="time" class="form-control form-control-sm event-time-end event-time-end-event" aria-label="End time">
                    </span>
                </div>
            </div>
            <div class="event-datetime event-datetime-ade">
                <div class="cal-prop"><span class="cal-prop-k">Starts</span>
                    <span class="cal-prop-v cal-dt"><input type="date" class="form-control form-control-sm event-date-start event-date-start-ade" aria-label="Start date"></span>
                </div>
                <div class="cal-prop"><span class="cal-prop-k">Ends</span>
                    <span class="cal-prop-v cal-dt"><input type="date" class="form-control form-control-sm event-date-end event-date-end-ade" aria-label="Last day"></span>
                </div>
            </div>
            <div class="event-datetime event-datetime-assignment">
                <div class="cal-prop"><span class="cal-prop-k">Due</span>
                    <span class="cal-prop-v cal-dt">
                        <input type="date" class="form-control form-control-sm event-date-start event-date-start-assignment" aria-label="Due date">
                        <input type="time" class="form-control form-control-sm event-time-start event-time-start-assignment" aria-label="Due time">
                    </span>
                </div>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-repeat">Repeat</label>
                <span class="cal-prop-v cal-stack">
                    <select class="form-select form-select-sm event-repeat" id="event-repeat">
                        <option value="">Doesn't repeat</option>
                        <option value="daily">Every day</option>
                        <option value="weekly">Every week</option>
                        <option value="weekdays">Every weekday (Mon–Fri)</option>
                        <option value="monthly">Every month</option>
                        <option value="yearly">Every year</option>
                        <option value="custom">Custom…</option>
                    </select>
                    <input type="text" class="form-control form-control-sm event-rrule" maxlength="500" placeholder="FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10" aria-label="Repeat rule (RRULE)" spellcheck="false" hidden>
                    <span class="cal-hint event-repeat-text"></span>
                </span>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-calendar-input">Calendar</label>
                <span class="cal-prop-v"><select class="form-select form-select-sm form-calendar-input form-calendar-input-1" id="event-calendar-input"></select></span>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-category-input">Category</label>
                <span class="cal-prop-v"><select class="form-select form-select-sm form-category-input form-category-input-1" id="event-category-input"><option value="">None</option></select></span>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-loc-input">Location</label>
                <span class="cal-prop-v"><input type="text" class="form-control form-control-sm event-loc-input event-loc-input-1" id="event-loc-input" placeholder="Add a location" maxlength="256"></span>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-place-input">Place</label>
                <span class="cal-prop-v cal-place">
                    <input type="text" class="form-control form-control-sm event-place-input" id="event-place-input" placeholder="Link a saved place" autocomplete="off"
                        role="combobox" aria-expanded="false" aria-controls="event-place-results" aria-autocomplete="list">
                    <span class="cal-place-chip" hidden><span class="cal-place-name"></span><button type="button" class="cal-icon-btn cal-place-clear" aria-label="Remove place" title="Remove place">×</button></span>
                    <span class="cal-pop cal-place-results" id="event-place-results" role="listbox" aria-label="Places" hidden></span>
                </span>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-meeting-input">Meeting link</label>
                <span class="cal-prop-v"><input type="url" class="form-control form-control-sm event-meeting-input" id="event-meeting-input" placeholder="https://" maxlength="500" inputmode="url"></span>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-tags-input">Tags</label>
                <span class="cal-prop-v"><input type="text" class="form-control form-control-sm event-tags-input" id="event-tags-input" placeholder="work, travel" maxlength="300" autocomplete="off"></span>
            </div>
            <div class="cal-prop cal-prop-top"><span class="cal-prop-k">Reminders</span>
                <span class="cal-prop-v cal-stack">
                    <span class="cal-rems"></span>
                    <select class="form-select form-select-sm event-rem-add" aria-label="Add a reminder">
                        <option value="">Add reminder…</option>
                        <option value="0">At the start</option>
                        <option value="5">5 minutes before</option>
                        <option value="10">10 minutes before</option>
                        <option value="15">15 minutes before</option>
                        <option value="30">30 minutes before</option>
                        <option value="60">1 hour before</option>
                        <option value="120">2 hours before</option>
                        <option value="1440">1 day before</option>
                        <option value="2880">2 days before</option>
                        <option value="10080">1 week before</option>
                    </select>
                </span>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-transparency">Show as</label>
                <span class="cal-prop-v"><select class="form-select form-select-sm event-transparency" id="event-transparency">
                    <option value="">Automatic</option><option value="busy">Busy</option><option value="free">Free</option>
                </select></span>
            </div>
            <div class="cal-prop"><label class="cal-prop-k" for="event-visibility">Visibility</label>
                <span class="cal-prop-v"><select class="form-select form-select-sm event-visibility" id="event-visibility">
                    <option value="default">Calendar default</option><option value="public">Public</option><option value="private">Private (others see "busy")</option>
                </select></span>
            </div>
            <div class="cal-prop cal-prop-top"><span class="cal-prop-k">Colour</span><span class="cal-prop-v event-colour-pick"></span></div>
            <div class="cal-prop cal-prop-top"><span class="cal-prop-k">Icon</span><span class="cal-prop-v event-icon-pick"></span></div>
        </div>

        <label class="cal-sec-h" for="event-description-input">Description</label>
        <textarea class="cal-textarea" id="event-description-input" rows="4" placeholder="Add details"></textarea>

        <div class="event-scope" hidden>
            <span class="cal-sec-h">Apply changes to</span>
            <div class="cal-seg cal-seg-full" role="radiogroup" aria-label="Apply changes to">
                <input type="radio" class="btn-check" name="event-scope" id="event-scope-this" value="this"><label class="cal-seg-btn" for="event-scope-this">This event</label>
                <input type="radio" class="btn-check" name="event-scope" id="event-scope-following" value="following"><label class="cal-seg-btn" for="event-scope-following">This and following</label>
                <input type="radio" class="btn-check" name="event-scope" id="event-scope-all" value="all"><label class="cal-seg-btn" for="event-scope-all">All events</label>
            </div>
        </div>

        <p class="cal-form-err" role="alert" hidden></p>
        <div class="cal-drawer-foot">
            <button type="button" class="cal-btn" data-drawer-close>Cancel</button>
            <button type="submit" class="btn btn-primary btn-sm create-event-btn">Create</button>
        </div>
    </form>
`);

const todo_create_template = Handlebars.compile(`
    <div class="field">
        <label class="form-label" for="todo-name-input">Name</label>
        <input type="text" class="form-control form-control-sm todo-name-input todo-name-input-{{i}}" id="todo-name-input" placeholder="Add a task">
    </div>
    <div class="field">
        <label class="form-label" for="todo-description-input">Description</label>
        <textarea class="form-control form-control-sm" id="todo-description-input" rows="3" placeholder="Add details"></textarea>
    </div>
    <div class="field">
        <label for="form-todo-priority-input" class="form-label">Priority</label>
        <input type="range" id="form-todo-priority-input" class="form-range form-todo-priority-input" min="0" max="20" step="1">
    </div>
    <div class="field">
        <span class="form-label">Complete by</span>
        <div class="input-group input-group-sm">
            <input type="date" class="form-control todo-date-complete" aria-label="Date">
            <input type="time" class="form-control todo-time-complete" aria-label="Time">
        </div>
    </div>
    <div class="form-check">
        <input class="form-check-input" type="checkbox" value="" id="todo-recurring-check">
        <label class="form-check-label" for="todo-recurring-check">Recurring</label>
    </div>
    <div class="modal-actions">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary create-todo-btn">Create</button>
    </div>
`);

// Setup Script
// =======================================================================================================================================================================
const d_ = new Date();
var m = d_.getMonth();
var y = d_.getFullYear();
var loadtime = new Date().getSeconds();
var loaddate = new Date().getDate();
var lastrefresh;
var data;
var todos;
var calendars = {};
var events = {};
var ss_available = false;
var timediff1 = 1000 * 60 * 60 * 12;
var timediff2 = 1000 * 60 * 60 * 24 * 2;

// View state
var currentView = localStorage.getItem('calendar_view') || 'month';
var currentDayDate = new Date(); // for day view navigation
var currentWeekStart = null;     // for week view navigation
var _mainDayView = null;
var _mainWeekView = null;

var ICONS = [
    "",
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-projector" viewBox="0 0 16 16">
        <path d="M14 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM2.5 6a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4Zm0 2a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4Z"/>
        <path fill-rule="evenodd" d="M0 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1H5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1 2 2 0 0 1-2-2V6Zm2-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-person-workspace" viewBox="0 0 16 16">
        <path d="M4 16s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1H4Zm4-5.95a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>
        <path d="M2 1a2 2 0 0 0-2 2v9.5A1.5 1.5 0 0 0 1.5 14h.653a5.373 5.373 0 0 1 1.066-2H1V3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v9h-2.219c.554.654.89 1.373 1.066 2h.653a1.5 1.5 0 0 0 1.5-1.5V3a2 2 0 0 0-2-2H2Z"/>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-hourglass-split" viewBox="0 0 16 16">
        <path d="M2.5 15a.5.5 0 1 1 0-1h1v-1a4.5 4.5 0 0 1 2.557-4.06c.29-.139.443-.377.443-.59v-.7c0-.213-.154-.451-.443-.59A4.5 4.5 0 0 1 3.5 3V2h-1a.5.5 0 0 1 0-1h11a.5.5 0 0 1 0 1h-1v1a4.5 4.5 0 0 1-2.557 4.06c-.29.139-.443.377-.443.59v.7c0 .213.154.451.443.59A4.5 4.5 0 0 1 12.5 13v1h1a.5.5 0 0 1 0 1h-11zm2-13v1c0 .537.12 1.045.337 1.5h6.326c.216-.455.337-.963.337-1.5V2h-7zm3 6.35c0 .701-.478 1.236-1.011 1.492A3.5 3.5 0 0 0 4.5 13s.866-1.299 3-1.48V8.35zm1 0v3.17c2.134.181 3 1.48 3 1.48a3.5 3.5 0 0 0-1.989-3.158C8.978 9.586 8.5 9.052 8.5 8.351z"/>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-pencil" viewBox="0 0 16 16">
        <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-briefcase" viewBox="0 0 16 16">
        <path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H1.5A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 14.5 3H11v-.5A1.5 1.5 0 0 0 9.5 1h-3zm0 1h3a.5.5 0 0 1 .5.5V3H6v-.5a.5.5 0 0 1 .5-.5zm1.886 6.914L15 7.151V12.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V7.15l6.614 1.764a1.5 1.5 0 0 0 .772 0zM1.5 4h13a.5.5 0 0 1 .5.5v1.616L8.129 7.948a.5.5 0 0 1-.258 0L1 6.116V4.5a.5.5 0 0 1 .5-.5z"/>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-emoji-smile" viewBox="0 0 16 16">
        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
        <path d="M4.285 9.567a.5.5 0 0 1 .683.183A3.498 3.498 0 0 0 8 11.5a3.498 3.498 0 0 0 3.032-1.75.5.5 0 1 1 .866.5A4.498 4.498 0 0 1 8 12.5a4.498 4.498 0 0 1-3.898-2.25.5.5 0 0 1 .183-.683zM7 6.5C7 7.328 6.552 8 6 8s-1-.672-1-1.5S5.448 5 6 5s1 .672 1 1.5zm4 0c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S9.448 5 10 5s1 .672 1 1.5z"/>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-tree" viewBox="0 0 16 16">
        <path d="M8.416.223a.5.5 0 0 0-.832 0l-3 4.5A.5.5 0 0 0 5 5.5h.098L3.076 8.735A.5.5 0 0 0 3.5 9.5h.191l-1.638 3.276a.5.5 0 0 0 .447.724H7V16h2v-2.5h4.5a.5.5 0 0 0 .447-.724L12.31 9.5h.191a.5.5 0 0 0 .424-.765L10.902 5.5H11a.5.5 0 0 0 .416-.777l-3-4.5zM6.437 4.758A.5.5 0 0 0 6 4.5h-.066L8 1.401 10.066 4.5H10a.5.5 0 0 0-.424.765L11.598 8.5H11.5a.5.5 0 0 0-.447.724L12.69 12.5H3.309l1.638-3.276A.5.5 0 0 0 4.5 8.5h-.098l2.022-3.235a.5.5 0 0 0 .013-.507z"/>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-exclamation-triangle" viewBox="0 0 16 16">
        <path d="M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.146.146 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.163.163 0 0 1-.054.06.116.116 0 0 1-.066.017H1.146a.115.115 0 0 1-.066-.017.163.163 0 0 1-.054-.06.176.176 0 0 1 .002-.183L7.884 2.073a.147.147 0 0 1 .054-.057zm1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566z"/>
        <path d="M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995z"/>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-easel3" viewBox="0 0 16 16">
        <path fill-rule="evenodd" d="M8.5 13.134V12h5a1.5 1.5 0 0 0 1.5-1.5V2h.5a.5.5 0 0 0 0-1H.5a.5.5 0 0 0 0 1H1v8.5A1.5 1.5 0 0 0 2.5 12h5v1.134a1 1 0 1 0 1 0ZM2 2v8.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V2H2Z"/>
    </svg>`
];

var TASK_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-list-task" viewBox="0 0 16 16">
        <path fill-rule="evenodd" d="M2 2.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5H2zM3 3H2v1h1V3z"/>
        <path d="M5 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM5.5 7a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1h-9zm0 4a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1h-9z"/>
        <path fill-rule="evenodd" d="M1.5 7a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V7zM2 7h1v1H2V7zm0 3.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5H2zm1 .5H2v1h1v-1z"/>
    </svg>
`

if ('speechSynthesis' in window) {
    ss_available = true;
    var speech_synthesis = new SpeechSynthesisUtterance();
}

//navigator.registerProtocolHandler("webcal", "https://app.example.org/calendar/?import_id=%s","Calendar");

var CATEGORY_LABELS = { 0: 'Uncategorized', 1: 'Meeting', 2: 'Focus Time', 3: 'Break Time', 4: 'Study', 5: 'Work', 6: 'Personal', 7: 'Tech Break', 8: 'Test / Exam', 9: 'Lecture', 100: 'Other' };

document.addEventListener('DOMContentLoaded', () => {
    make_holidays_red();

    set_localstorage();

    set_display();

    bind_page_events();

    // Restore view mode from localStorage
    const savedView = localStorage.getItem('calendar_view') || 'month';
    currentView = ['month', 'week', 'day'].includes(savedView) ? savedView : 'month';

    populate_calendar(m, y);

    setTimeout(tick, 60000);
})

// All page controls use delegated listeners (no inline handlers).
function bind_page_events() {
    const actions = {
        'prev': () => go_prev(),
        'next': () => go_next(),
        'today': () => today_(),
        'new-event': () => { const d = new Date(); add_edit_event(d.getDate(), d.getMonth() + 1, d.getFullYear()); },
        'create-calendar': () => create_calendar(),
        'refresh': () => populate_calendar(m, y, true),
        'retry': () => retry_now(),
        'new-task': () => add_edit_todo(),
        'help': () => document.dispatchEvent(new CustomEvent('calendar:help')),
    };
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (btn && actions[btn.dataset.action]) { actions[btn.dataset.action](btn, e); return; }
        const tab = e.target.closest('[data-sidebar-tab]');
        if (tab) show_in_sidebar(tab.dataset.sidebarTab);
    });

    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => switch_view(b.dataset.view)));
    document.getElementById('month').addEventListener('change', () => jump_());
    document.getElementById('year').addEventListener('change', () => jump_());
    document.querySelectorAll('.display-option').forEach(cb => cb.addEventListener('change', change_display));

    // Month grid: day number opens the day, "+" adds, camera opens photos, chips open details.
    const body = document.getElementById('calendar-body');
    body.addEventListener('click', (e) => {
        const go = e.target.closest('[data-goto]');
        if (go) { const [Y, M, D] = go.dataset.goto.split('-').map(Number); go_to_date(new Date(Y, M, D)); return; }
        const cell = e.target.closest('td.date-picker');
        if (!cell) return;
        const date = parseInt(cell.dataset.date);
        if (e.target.closest('.add-on-day-btn')) { add_edit_event(date, parseInt(cell.dataset.month), parseInt(cell.dataset.year)); return; }
        if (e.target.closest('.day-images-btn')) { view_day_images(date); return; }
        if (e.target.closest('.date-span') || e.target.closest('.more-events')) {
            open_day(date, parseInt(cell.dataset.month), parseInt(cell.dataset.year));
            return;
        }
        const chip = e.target.closest('.event-open');
        if (chip) display_info(chip);
    });
    body.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const chip = e.target.closest('.event-open, .more-events');
        if (!chip) return;
        e.preventDefault();
        chip.click();
    });

    // Calendar list (sidebar): visibility checkbox and the per-calendar menu.
    document.querySelector('.sidebar-calendar-list').addEventListener('click', (e) => {
        const el = e.target.closest('[data-cal-action]');
        if (!el || el.dataset.calAction === 'toggle') return;
        const act = el.dataset.calAction;
        if (act === 'only') toggle_calendar_visibility(el, true);
        else if (act === 'settings') display_calendar_info(el);
        else if (act === 'sync') sync_events(el);
        else if (act === 'unsubscribe') unsubscribe(el);
    });
    document.querySelector('.sidebar-calendar-list').addEventListener('change', (e) => {
        if (e.target.matches('[data-cal-action="toggle"]')) toggle_calendar_visibility(e.target, false);
    });

    // Sidebar task list.
    document.querySelector('.todo-list').addEventListener('click', (e) => {
        const more = e.target.closest('[data-todo-more]');
        if (more) {
            const list = more.closest('.todo-list');
            const open = list.classList.toggle('is-expanded');
            more.setAttribute('aria-expanded', open ? 'true' : 'false');
            more.textContent = open ? 'Show fewer' : `Show ${list.querySelectorAll('.is-extra').length} more`;
            return;
        }
        const el = e.target.closest('[data-todo-action]');
        if (!el) return;
        const i = el.closest('.todo-item').dataset.i;
        if (el.dataset.todoAction === 'complete') complete_todo(i);
        else if (el.dataset.todoAction === 'edit') add_edit_todo('edit', i);
        else if (el.dataset.todoAction === 'delete') delete_todo(i);
    });

    // Drawer: close button, event-detail actions.
    const drawer = document.getElementById('cal-drawer');
    drawer.addEventListener('click', (e) => {
        if (e.target.closest('[data-drawer-close]')) { drawer_close(); return; }
        const el = e.target.closest('[data-ei-action]');
        if (!el) return;
        const card = el.closest('.ei-card');
        const ev = find_event(card.dataset.eventId);
        const act = el.dataset.eiAction;
        if (act === 'add-task') { event_to_task(card.dataset.eventId, el); return; }
        if (!ev) return;
        if (act === 'edit') { add_edit_event(1, m + 1, y, 'edit', ev); }
        else if (act === 'photos') { drawer_close(); $('#big-modal').modal('show'); view_event_images(ev); }
        else if (act === 'duplicate') duplicate_event(ev);
        else if (act === 'delete') delete_event(ev);
    });
    document.getElementById('big-modal').addEventListener('click', (e) => {
        const el = e.target.closest('[data-modal-action]');
        if (el && el.dataset.modalAction === 'calendar-enable') toggle_calendar_enable(el);
        if (el && el.dataset.modalAction === 'invite-toggle') { el.disabled = true; toggle_invite(el); }
    });
}

// POST /api/v2/tasks/from-event/<id> (idempotent); the button becomes a link to the task.
function event_to_task(eventId, btn) {
    btn.disabled = true;
    return fetch(`/api/v2/tasks/from-event/${encodeURIComponent(eventId)}`, {
        method: 'POST', headers: { 'X-CSRFToken': csrfToken() }, credentials: 'same-origin',
    }).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(task => {
        const a = document.createElement('a');
        a.className = btn.className.replace('btn-outline-primary', 'btn-outline-secondary');
        a.href = `/tasks/?task=${encodeURIComponent(task.id)}`;
        a.textContent = 'In Tasks · Open';
        btn.replaceWith(a);
        a.focus();  // keep focus inside the drawer (Escape still closes it)
        upsert_todo(task);
        after_local_change();
        return task;
    }).catch(() => {
        btn.disabled = false;
        btn.textContent = 'Couldn\'t add. Retry';
    });
}


// Calendar.JS
// =======================================================================================================================================================================
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


var createYear = generate_year_range(2004, currentYear + 5);

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

    var firstDay = (new Date(year, month)).getDay();

    tbl = document.getElementById("calendar-body");

    tbl.innerHTML = "";

    if (typeof currentView === 'undefined' || currentView === 'month') monthAndYear.textContent = months[month] + " " + year;
    selectYear.value = year;
    selectMonth.value = month;

    // creating all cells
    var date = 1;
    let trailing = 1;
    for (var i = 0; i < 6; i++) {
        today = new Date();

        var row = document.createElement("tr");

        for (var j = 0; j < 7; j++) {
            if ((i === 0 && j < firstDay) || (date > daysInMonth(month, year) && row.childElementCount)) {
                // Neighbouring month: muted day number that jumps there.
                const d = i === 0 && j < firstDay ? new Date(year, month, j - firstDay + 1) : new Date(year, month + 1, trailing++);
                cell = document.createElement("td");
                cell.className = 'date-picker-dead' + (vars["holidays"].includes(j) ? ' is-holiday' : '');
                const num = document.createElement('button');
                num.type = 'button';
                num.className = 'dead-num';
                num.dataset.goto = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                num.textContent = d.getDate() === 1 ? moment(d).format('MMM D') : String(d.getDate());
                num.setAttribute('aria-label', `Go to ${moment(d).format('dddd, MMMM D')}`);
                cell.appendChild(num);
                row.appendChild(cell);
            }
            else if (date > daysInMonth(month, year)) {
                // row not started: nothing
            }
            else {
                cell = document.createElement("td");
                cell.setAttribute("data-date", date);
                cell.setAttribute("data-month", month + 1);
                cell.setAttribute("data-year", year);
                cell.setAttribute("data-month_name", months[month]);
                cell.setAttribute("data-day", j);
                cell.className = `date-picker date-picker-${date}`;
                const label = new Date(year, month, date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
                cell.innerHTML = `
                    <div class='date-span'><button type="button" class="date-num" title="Open day" aria-label="Open ${label}">${date}</button></div>
                    <div class='day-events day-events-${date}'></div>
                    <div class='reg-events reg-events-${date}'></div>
                    <span class="badge add-on-day-btn" role="button" tabindex="0" title="New event" aria-label="New event on ${label}">+</span>
                    <span class="badge day-images-btn day-images-btn-${date}" data-bs-toggle="modal" data-bs-target="#big-modal" role="button" title="Photos"></span>
                `;
                // Click empty cell space → open create form
                const cellDate = date;
                cell.addEventListener('click', function (e) {
                    // Only fire if click is on the cell itself (not on children like events)
                    if (e.target === this || e.target.classList.contains('day-events') || e.target.classList.contains('reg-events')) {
                        add_edit_event(cellDate, month + 1, year);
                    }
                });

                if (date === today.getDate() && year === today.getFullYear() && month === today.getMonth()) {
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
}

function daysInMonth(iMonth, iYear) {
    return 32 - new Date(iYear, iMonth, 32).getDate();
}


// Script from page
// =======================================================================================================================================================================
function set_localstorage() {
    if (!localStorage.getItem('calendar_show_all')) {
        localStorage.setItem('calendar_show_all', 0)
    }
    if (!localStorage.getItem('calendar_notifications')) {
        localStorage.setItem('calendar_notifications', JSON.stringify([]))
    }
    if (!localStorage.getItem('calendar_show_todos')) {
        localStorage.setItem('calendar_show_todos', 1)
    }
    if (!localStorage.getItem('calendar_show_birthdays')) {
        localStorage.setItem('calendar_show_birthdays', 1)
    }
    if (!localStorage.getItem('calendar_extra')) {
        localStorage.setItem('calendar_extra', "")
    }
}

function set_display() {
    if (localStorage.getItem('calendar_show_todos') == 1) { document.getElementById('displayTodosCb').checked = true; }
    else { document.getElementById('displayTodosCb').checked = false; }
    if (localStorage.getItem('calendar_show_birthdays') == 1) { document.getElementById('displayBirthdaysCb').checked = true; }
    else { document.getElementById('displayBirthdaysCb').checked = false; }
    document.getElementById('displayContactBirthdaysCb').checked = show_contact_birthdays();
}

function change_display() {
    const contactsBefore = show_contact_birthdays();
    try { localStorage.setItem('calendar_show_contact_birthdays', document.getElementById('displayContactBirthdaysCb').checked ? '1' : '0'); } catch (e) { }
    if (contactsBefore !== show_contact_birthdays()) {
        _contactBdaysRange = '';
        if (!show_contact_birthdays()) _contactBdays = {};
        load_contact_birthdays();
        document.dispatchEvent(new CustomEvent('calendar:changed'));
    }
    if (document.getElementById('displayBirthdaysCb').checked) { localStorage.setItem('calendar_show_birthdays', 1); }
    else { localStorage.setItem('calendar_show_birthdays', 0); }
    if (document.getElementById('displayTodosCb').checked) { localStorage.setItem('calendar_show_todos', 1); }
    else { localStorage.setItem('calendar_show_todos', 0); }
    const showAllBefore = localStorage.getItem('calendar_show_all');
    if (document.getElementById('displayAllCb').checked) { localStorage.setItem('calendar_show_all', 1); }
    else { localStorage.setItem('calendar_show_all', 0); }
    if (showAllBefore !== localStorage.getItem('calendar_show_all')) {
        _monthCache = {};
        populate_calendar(m, y, true);  // inactive calendars come from the server
        return;
    }
    reload();
    reload_calendar();
    _afterDataLoad();
}

window.addEventListener("focus", () => background_refresh(2 * 60000));

function tick() {
    background_refresh();  // no-op unless the data is 5+ minutes old and the tab is visible
    setTimeout(tick, 60000);
    return;

    if (moment().format("HH mm ss") == "19 00 00") {
        for (time of [0, 1000, 2000]) { setTimeout(function () { notification.play() }, time) }
        if (ss_available) { speech_synthesis.text = `Tomorrow is ${moment().add(1, 'days').format("dddd, MMMM Do YYYY")}. Your events tomorrow are: ` }
        if (today.getDate != daysInMonth(m, y)) {
            is_ev = false;
            for (ev of events["allday"][parseInt(moment().add(1, 'days').format("DD"))]) {
                if (ss_available) { speech_synthesis.text += `${ev['name']} all day, `; }
                is_ev = true;
            }
            for (ev of events["events"][parseInt(moment().add(1, 'days').format("DD"))]) {
                if (ev['enddate'] == "None") { sst = `${ev['name']} at ${moment(ev['startdate']).format('LT')}, ` }
                else { sst = `${ev['name']} from ${moment(ev['startdate']).format('LT')} to ${moment(ev['enddate']).format('LT')}, ` }
                if (ss_available) { speech_synthesis.text += sst; }
                is_ev = true;
            }

            if (is_ev == false) {
                if (ss_available) { speech_synthesis.text += "There are no events tomorrow."; }
            }
        }

        if (ss_available) { setTimeout(function () { window.speechSynthesis.speak(speech_synthesis); }, 3000) }
    }
    if (moment().format("ss") == "00") {
        is_ev = false;
        if (ss_available) { speech_synthesis.text = ""; }
        for (time of [0, 5, 15, 30]) {
            d1 = moment().add(time, 'minutes')
            try {
                for (ev of events["events"][parseInt(d1.format("DD"))]) {
                    ed_ = moment(new Date(ev["startdate"]));
                    if ((ed_.format("HH") == d1.format("HH")) && (ed_.format("mm") == d1.format("mm"))) {
                        if (ss_available) {
                            if (time == 0) {
                                speech_synthesis.text += `${ev["name"]} is starting now, `;
                            }
                            else {
                                speech_synthesis.text += `${ev["name"]} is starting in ${time} minutes, `;
                            }
                        }
                    }
                }
            }
            catch { }
        }

        if (is_ev) {
            notification.play();
            if (ss_available) {
                setTimeout(function () { window.speechSynthesis.speak(speech_synthesis); }, 500);
            }
        }
    }
    setTimeout(tick, 1000);
}

// ---- V2 helpers for the event drawer
function v2(method, path, body) {
    return fetch(path, {
        method, credentials: 'same-origin',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRFToken': csrfToken() } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    }).then(async res => {
        if (res.status === 204) return null;
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
            const d = j.detail;
            throw new Error(typeof d === 'string' ? d : Array.isArray(d) && d[0] && d[0].msg ? d[0].msg : `Request failed (${res.status})`);
        }
        return j;
    });
}

// Event detail (GET /events/{id}): fetched on demand, kept until the next edit.
var _detailCache = new Map();
function event_detail(id) {
    if (!_detailCache.has(id)) {
        _detailCache.set(id, v2('GET', `/api/v2/calendar/events/${encodeURIComponent(id)}`).catch(err => { _detailCache.delete(id); throw err; }));
    }
    return _detailCache.get(id);
}

// Event categories of a calendar's owner, cached for an hour.
function calendar_categories(calId) {
    const key = `calendar:categories:${calId}`;
    try {
        const c = JSON.parse(localStorage.getItem(key) || 'null');
        if (c && Date.now() - c.t < 3600000 && Array.isArray(c.list)) return Promise.resolve(c.list);
    } catch (e) { }
    return v2('GET', `/api/v2/calendar/categories?calendar=${encodeURIComponent(calId)}`).then(list => {
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), list })); } catch (e) { }
        return list;
    });
}

const REM_LABELS = { 0: 'At the start', 5: '5 min before', 10: '10 min before', 15: '15 min before', 30: '30 min before', 60: '1 hour before', 120: '2 hours before', 1440: '1 day before', 2880: '2 days before', 10080: '1 week before' };
function rem_label(min) {
    if (REM_LABELS[min]) return REM_LABELS[min];
    if (min % 1440 === 0) return `${min / 1440} days before`;
    if (min % 60 === 0) return `${min / 60} hours before`;
    return `${min} min before`;
}

const _ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const RR_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// RRULE presets relative to the start date.
function rrule_for(preset, start) {
    if (preset === 'daily') return 'FREQ=DAILY';
    if (preset === 'weekly') return `FREQ=WEEKLY;BYDAY=${RR_DAYS[start.getDay()]}`;
    if (preset === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    if (preset === 'monthly') return `FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}`;
    if (preset === 'yearly') return 'FREQ=YEARLY';
    return '';
}

function preset_for(rrule, start) {
    const r = (rrule || '').replace(/^RRULE:/i, '').toUpperCase();
    if (!r) return '';
    for (const p of ['daily', 'weekly', 'weekdays', 'monthly', 'yearly']) if (rrule_for(p, start) === r) return p;
    return 'custom';
}

// New/edit event form in the drawer. `date`/`month`/`year` prefill a new event's day; editing loads the
// event's full details (V2) first.
function add_edit_event(date, month = m + 1, year = y, command = "add", edit_event = null) {
    if (command == "edit" && edit_event) {
        const body = drawer_open('Edit event', '<div class="sb-skeleton" aria-hidden="true"><div class="sb-skel-line"></div><div class="sb-skel-line"></div><div class="sb-skel-line"></div></div>');
        event_detail(edit_event['id']).then(det => {
            if (!body.isConnected || document.querySelector('#cal-drawer .cal-drawer-title').textContent !== 'Edit event') return;
            render_event_form(command, det, { date, month, year });
        }).catch(err => {
            body.replaceChildren();
            const p = document.createElement('p');
            p.className = 'cal-form-err';
            p.textContent = `Couldn't load the event. ${err.message || ''}`;
            body.appendChild(p);
        });
        return;
    }
    render_event_form("add", null, { date, month, year });
}

function render_event_form(command, det, { date, month, year }) {
    const body = drawer_open(command == "edit" ? 'Edit event' : 'New event', event_create_template({}));
    const form = body.querySelector('.event-form');
    const err = form.querySelector('.cal-form-err');
    const q = (sel) => form.querySelector(sel);
    let kind = det ? ({ all_day: 'ade', deadline: 'assignment' }[det.kind] || 'event') : 'ade';
    const showType = (t) => {
        kind = t;
        form.querySelectorAll('.event-datetime').forEach(el => { el.hidden = !el.classList.contains(`event-datetime-${t}`); });
        updateRepeatText();
    };
    form.querySelectorAll('.event-type-btn').forEach(btn => btn.addEventListener('change', () => showType(btn.dataset.eventType)));
    const pick = (t) => { q(`.event-type-btn-${t}`).checked = true; showType(t); };

    // calendars you can add to (last used first for new events)
    const calSelect = q('.form-calendar-input-1');
    for (const c of data["calendars"]) {
        if (c["subscribe_type"] == 0 || c["subscribe_type"] == 1) calSelect.add(new Option(plain(c["calendar"]["name"]), c["calendar"]["id"]));
    }
    let lastCal = null;
    try { lastCal = localStorage.getItem('calendar_last_calendar'); } catch (e) { }
    if (det) calSelect.value = det.calendar_id;
    else if (lastCal && calSelect.querySelector(`option[value="${CSS.escape(lastCal)}"]`)) calSelect.value = lastCal;

    // categories follow the calendar's owner
    const catSelect = q('.form-category-input-1');
    const loadCats = () => {
        const calId = calSelect.value;
        if (!calId) return;
        const keep = catSelect.value || (det ? String(det.category_id || '') : '');
        calendar_categories(calId).then(list => {
            catSelect.replaceChildren(new Option('None', ''));
            for (const c of list) catSelect.add(new Option(plain(c.name), c.id));
            catSelect.value = keep && catSelect.querySelector(`option[value="${CSS.escape(keep)}"]`) ? keep : '';
        }).catch(() => { });
    };
    calSelect.addEventListener('change', loadCats);
    loadCats();

    // dates and times
    const setV = (sel, v) => form.querySelectorAll(sel).forEach(el => { el.value = v; });
    if (det) {
        const s0 = new Date(det.start);
        const e0 = det.end ? new Date(det.end) : new Date(s0.getTime() + 3600000);
        setV('.event-date-start-event, .event-date-start-assignment', _ymd(s0));
        setV('.event-time-start-event, .event-time-start-assignment', _hhmm(s0));
        setV('.event-date-end-event', _ymd(e0));
        setV('.event-time-end-event', _hhmm(e0));
        if (det.start_date) {
            setV('.event-date-start-ade', det.start_date);
            const last = new Date(det.end_date ? `${det.end_date}T00:00:00` : `${det.start_date}T00:00:00`);
            if (det.end_date) last.setDate(last.getDate() - 1);  // the form shows the last day (inclusive)
            setV('.event-date-end-ade', _ymd(last));
        } else {
            setV('.event-date-start-ade', _ymd(s0));
            setV('.event-date-end-ade', _ymd(s0));
        }
        q('.create-event-btn').textContent = 'Save';
        q('.event-name-input-1').value = plain(det.name);
        q('.event-loc-input-1').value = plain(det.location || '');
        q('.event-meeting-input').value = det.meeting_url || '';
        q('.event-tags-input').value = (det.tags || []).join(', ');
        q('#event-description-input').value = det.description || '';
        q('.event-transparency').value = det.transparency || '';
        q('.event-visibility').value = det.visibility || 'default';
    } else {
        const day = new Date(year, month - 1, date);
        const start = new Date(day); start.setHours(new Date().getHours() + 1, 0, 0, 0);
        const end = new Date(start.getTime() + 3600000);
        setV('.event-date-start-event, .event-date-start-assignment, .event-date-start-ade, .event-date-end-ade', _ymd(day));
        setV('.event-date-end-event', _ymd(end));
        setV('.event-time-start-event, .event-time-start-assignment', _hhmm(start));
        setV('.event-time-end-event', _hhmm(end));
    }

    // repeat
    const repeat = q('.event-repeat'), rruleIn = q('.event-rrule'), repeatText = q('.event-repeat-text');
    const startDate = () => new Date(`${q(kind === 'ade' ? '.event-date-start-ade' : kind === 'assignment' ? '.event-date-start-assignment' : '.event-date-start-event').value}T12:00:00`);
    function updateRepeatText() {
        rruleIn.hidden = repeat.value !== 'custom';
        const sd = startDate();
        if (!repeat.value || isNaN(sd)) { repeatText.textContent = ''; return; }
        if (repeat.value === 'weekly') repeatText.textContent = `On ${moment(sd).format('dddd')}s`;
        else if (repeat.value === 'monthly') repeatText.textContent = `On day ${sd.getDate()} of each month`;
        else if (repeat.value === 'yearly') repeatText.textContent = `On ${moment(sd).format('MMMM D')}`;
        else if (repeat.value === 'custom') repeatText.textContent = det && det.rrule && rruleIn.value === det.rrule ? det.recurrence_text : 'An RFC 5545 rule, e.g. FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10';
        else repeatText.textContent = '';
    }
    if (det && det.rrule) {
        const pr = preset_for(det.rrule, new Date(det.start));
        repeat.value = pr;
        if (pr === 'custom') rruleIn.value = det.rrule.replace(/^RRULE:/i, '');
    }
    repeat.addEventListener('change', updateRepeatText);
    form.querySelectorAll('.event-date-start').forEach(el => el.addEventListener('change', updateRepeatText));

    // reminders
    let reminders = det ? (det.reminders || []).slice() : [];
    const remBox = q('.cal-rems'), remAdd = q('.event-rem-add');
    const renderRems = () => {
        remBox.replaceChildren(...reminders.sort((a, b) => a - b).map(min => {
            const chip = document.createElement('span');
            chip.className = 'cal-rem';
            chip.append(rem_label(min));
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'cal-rem-x';
            x.setAttribute('aria-label', `Remove reminder ${rem_label(min)}`);
            x.textContent = '×';
            x.addEventListener('click', () => { reminders = reminders.filter(v => v !== min); renderRems(); });
            chip.appendChild(x);
            return chip;
        }));
        if (!reminders.length) { const n = document.createElement('span'); n.className = 'cal-hint'; n.textContent = 'Your default reminders'; remBox.appendChild(n); }
        remAdd.disabled = reminders.length >= 5;
    };
    remAdd.addEventListener('change', () => {
        const v = parseInt(remAdd.value);
        if (!isNaN(v) && !reminders.includes(v)) reminders.push(v);
        remAdd.value = '';
        renderRems();
    });
    renderRems();

    // place (saved places from the Map app)
    let placeId = det && det.place ? det.place.id : null;
    const placeIn = q('.event-place-input'), placeChip = q('.cal-place-chip'), placeRes = q('.cal-place-results');
    const showPlace = (name) => {
        placeChip.hidden = !placeId;
        placeIn.hidden = !!placeId;
        q('.cal-place-name').textContent = name || '';
    };
    showPlace(det && det.place ? plain(det.place.name) : '');
    let placeTimer = null, placeSeq = 0;
    placeIn.addEventListener('input', () => {
        clearTimeout(placeTimer);
        const text = placeIn.value.trim();
        if (text.length < 2) { placeRes.hidden = true; placeIn.setAttribute('aria-expanded', 'false'); return; }
        placeTimer = setTimeout(() => {
            const seq = ++placeSeq;
            v2('GET', `/api/v2/places?q=${encodeURIComponent(text)}`).then(list => {
                if (seq !== placeSeq) return;
                placeRes.replaceChildren(...(list.length ? list.slice(0, 8).map(pl => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'cal-res';
                    b.setAttribute('role', 'option');
                    const name = document.createElement('span');
                    name.className = 'cal-res-title';
                    name.textContent = plain(pl.name);
                    b.append(document.createElement('span'), name);
                    b.addEventListener('click', () => {
                        placeId = pl.id;
                        placeRes.hidden = true;
                        placeIn.value = '';
                        showPlace(plain(pl.name));
                        if (!q('.event-loc-input-1').value) q('.event-loc-input-1').value = plain(pl.name);
                    });
                    return b;
                }) : [Object.assign(document.createElement('div'), { className: 'cal-pop-msg', textContent: 'No saved places match.' })]));
                placeRes.hidden = false;
                placeIn.setAttribute('aria-expanded', 'true');
            }).catch(() => { placeRes.hidden = true; });
        }, 250);
    });
    q('.cal-place-clear').addEventListener('click', () => { placeId = null; showPlace(''); placeIn.focus(); });

    // colour + icon
    const colourPick = colour_picker({ name: 'event-colour', value: det ? det.colour || '' : '', allowNone: true });
    const iconPick = icon_picker({ name: 'event-icon', value: det ? det.icon || '' : '', colour: colourPick.get() });
    q('.event-colour-pick').appendChild(colourPick.el);
    q('.event-icon-pick').appendChild(iconPick.el);
    colourPick.el.addEventListener('change', () => iconPick.setColour(colourPick.get()));
    CAL_APPEARANCE_READY.then(() => {
        // refresh the icon grid once the server's icon list is known
        if (!form.isConnected) return;
        const cur = iconPick.get();
        const fresh = icon_picker({ name: 'event-icon', value: cur, colour: colourPick.get() });
        iconPick.el.replaceWith(fresh.el);
        Object.assign(iconPick, fresh);
    });

    // scope for repeating events
    const recurring = !!(det && det.recurring);
    if (recurring) {
        q('.event-scope').hidden = false;
        const occurrence = String(det.id).includes(':');
        if (!occurrence) { q('#event-scope-this').disabled = true; q('#event-scope-following').disabled = true; }
        q(occurrence ? '#event-scope-this' : '#event-scope-all').checked = true;
    }

    pick(kind);
    updateRepeatText();

    form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const fail = (msg) => { err.textContent = msg; err.hidden = false; };
        err.hidden = true;
        const name = q('.event-name-input-1').value.trim();
        if (!name) { fail('Add a title.'); q('.event-name-input-1').focus(); return; }
        const calId = parseInt(calSelect.value);
        if (!calId) { fail('You have no calendar you can add events to.'); return; }
        const val = (sel) => q(sel).value;
        const payload = {
            calendar_id: calId, name,
            category_id: catSelect.value ? parseInt(catSelect.value) : null,
            location: val('.event-loc-input-1').trim() || null,
            meeting_url: val('.event-meeting-input').trim(),
            description: val('#event-description-input') || null,
            tags: val('.event-tags-input').split(',').map(t => t.trim()).filter(Boolean).slice(0, 20),
            visibility: val('.event-visibility'),
            colour: colourPick.get() || '',
            icon: iconPick.get() || '',
            reminders: reminders.slice(),
            place_id: placeId,
        };
        if (payload.meeting_url && !/^https?:\/\/\S+$/i.test(payload.meeting_url)) { fail('The meeting link must start with http:// or https://'); return; }
        if (val('.event-transparency')) payload.transparency = val('.event-transparency');
        if (kind === 'ade') {
            const s0 = val('.event-date-start-ade'), last = val('.event-date-end-ade') || s0;
            if (!s0) { fail('Pick the start date.'); return; }
            if (last < s0) { fail('The last day is before the first.'); return; }
            const endEx = new Date(`${last}T00:00:00`); endEx.setDate(endEx.getDate() + 1);
            Object.assign(payload, { kind: 'all_day', all_day: true, start_date: s0, end_date: _ymd(endEx), start: null, end: null });
        } else if (kind === 'assignment') {
            const due = new Date(`${val('.event-date-start-assignment')}T${val('.event-time-start-assignment') || '23:59'}`);
            if (isNaN(due)) { fail('Pick the due date and time.'); return; }
            Object.assign(payload, { kind: 'deadline', all_day: false, start: due.toISOString(), end: null });
        } else {
            const s0 = new Date(`${val('.event-date-start-event')}T${val('.event-time-start-event')}`);
            const e0 = new Date(`${val('.event-date-end-event')}T${val('.event-time-end-event')}`);
            if (isNaN(s0) || isNaN(e0)) { fail('Pick the start and end.'); return; }
            if (e0 < s0) { fail('The event ends before it starts.'); return; }
            Object.assign(payload, { kind: 'event', all_day: false, start: s0.toISOString(), end: e0.toISOString() });
        }
        let rrule = '';
        if (repeat.value === 'custom') {
            rrule = rruleIn.value.trim().replace(/^RRULE:/i, '').toUpperCase();
            if (!/^[A-Z0-9=;,:+-]+$/.test(rrule) || !rrule.includes('FREQ=')) { fail('The repeat rule needs FREQ=…, e.g. FREQ=WEEKLY;BYDAY=MO.'); return; }
        } else rrule = rrule_for(repeat.value, startDate());
        const scopeEl = form.querySelector('input[name="event-scope"]:checked');
        const scope = recurring && scopeEl ? scopeEl.value : null;
        if (scope !== 'this') payload.rrule = rrule;  // one occurrence can't change the series' rule

        const submit = q('.create-event-btn');
        submit.disabled = true;
        const req = command == "edit"
            ? v2('PATCH', `/api/v2/calendar/events/${encodeURIComponent(det.id)}${scope ? `?scope=${scope}` : ''}`, payload)
            : v2('POST', '/api/v2/calendar/events', payload);
        req.then(() => {
            try { localStorage.setItem('calendar_last_calendar', String(calId)); } catch (e) { }
            _detailCache.clear();
            drawer_close();
            toast(command == "edit" ? 'Event saved' : 'Event created');
            populate_calendar(m, y, true);  // times, repeats and colours are resolved on the server
        }).catch(e => {
            submit.disabled = false;
            fail(e.message || "Couldn't save the event.");
        });
    });
    setTimeout(() => q('.event-name-input-1').focus(), 30);
}

function add_edit_todo(command = "add", edit_todo = null) {
    $('.modal-title').html("Create New Todo")
    $('.modal-body').html(todo_create_template({ 'i': '1' }))

    if (command == "edit") {
        et = data["todos"][edit_todo];
        $('.modal-title').text(`Edit ${plain(et["name"])}`)
        $('.todo-name-input-1').val(plain(et["name"]));
        $('#todo-description-input').val(et["description"]);
        $('#form-todo-priority-input').val(et["priority"]);
        document.querySelector('#todo-recurring-check').checked = et["recurring"];
        tcd = new Date(et["complete_by"]);
        tcd = convertUTCDateToLocalDate(tcd);
        document.querySelector('.todo-date-complete').valueAsDate = tcd;
        document.querySelector('.todo-time-complete').valueAsDate = tcd;
    }
    else {
        document.querySelector('.todo-date-complete').value = new Date().toISOString().split('T')[0];
        document.querySelector('.todo-time-complete').value = "23:59";
    }

    $('.create-todo-btn').click(function () {
        valid = true;
        result = {
            "name": $('.todo-name-input-1').val(),
            "description": $('#todo-description-input').val(),
            "priority": $('#form-todo-priority-input').val(),
            "recurring": document.querySelector('#todo-recurring-check').checked,
            "completion": `${$('.todo-date-complete').val()} ${$('.todo-time-complete').val()}`
        }
        if (command == "edit") { result["old_id"] = et["id"] }

        if (command == "add") { url_ = 'todo_add' }
        else if (command == "edit") { url_ = 'todo_edit' }
        r = new XMLHttpRequest();
        r.open("POST", URLS[url_]);
        r.setRequestHeader("X-CSRFToken", csrfToken());
        r.onload = () => {
            res = JSON.parse(r.responseText)
            if (res['status'] == 'success') {
                populate_calendar(m, y, true);
            }
            else {
                alert(res['data']);
            }
        }
        r.send(JSON.stringify(result));
        $('.btn-close').click();
    });
}

function delete_todo(todo_num) {
    todo = data["todos"][todo_num]
    r = new XMLHttpRequest();
    r.open("POST", URLS["todo_delete"]);
    r.setRequestHeader("X-CSRFToken", csrfToken());
    r.onload = () => {
        res = JSON.parse(r.responseText)
        if (res['status'] == 'success') {
            data["todos"].splice(todo_num, 1)
            reload_calendar();
        }
        else {
            alert(res['data']);
        }
    }
    r.send(JSON.stringify({ 'id': todo["id"] }));
}

// Holiday columns (CALENDAR_VARS.holidays, e.g. weekends) get a quiet tint.
function make_holidays_red() {
    document.querySelectorAll('#calendar-body td.date-picker').forEach(td => {
        td.classList.toggle('is-holiday', vars["holidays"].includes(parseInt(td.dataset.day)));
    });
}

function change_height() {
    rowcount = document.querySelector('#calendar-body').childElementCount.toString()
    tableheight = document.querySelector('#calendar-body').offsetHeight
    document.querySelector('#calendar-body').querySelectorAll('tr').forEach(dp => {
        dp.style.height = (tableheight / rowcount).toString() + "px"
    })
}

// Month view (presentation only): when a day's chips don't fit in its cell, hide the
// extras and show a "+N more" line that opens that day.
function collapse_overflowing_events() {
    const box = document.querySelector('.view-month');
    const body = document.getElementById('calendar-body');
    if (!box || !body || !box.clientHeight) return;
    const rows = body.querySelectorAll('tr');
    if (!rows.length) return;
    const thead = document.getElementById('thead-month');
    const avail = Math.floor((box.clientHeight - (thead ? thead.offsetHeight : 0)) / rows.length);
    rows.forEach(tr => { tr.style.height = avail + 'px'; });

    body.querySelectorAll('td.date-picker').forEach(cell => {
        cell.querySelectorAll('.more-events').forEach(el => el.remove());
        const chips = Array.from(cell.querySelectorAll('.event-button'));
        chips.forEach(c => c.classList.remove('event-overflow'));
        if (!chips.length) return;
        const top = cell.getBoundingClientRect().top;
        const limit = avail - 3;
        if (chips[chips.length - 1].getBoundingClientRect().bottom - top <= limit) return;

        const more = document.createElement('div');
        more.className = 'more-events';
        more.setAttribute('role', 'button');
        more.setAttribute('aria-label', 'Show all events of this day');
        cell.querySelector('.reg-events').after(more);
        let hidden = 0;
        const label = () => { more.innerHTML = `+${hidden}<span class="more-label"> more</span>`; };
        label();
        for (let k = chips.length - 1; k >= 0; k--) {
            if (more.getBoundingClientRect().bottom - top <= limit) break;
            chips[k].classList.add('event-overflow');
            hidden++;
            label();
        }
        more.title = `${hidden} more`;
        more.tabIndex = 0;  // click/Enter handled by the delegated listener in bind_page_events()
    });
}

var _collapseTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(_collapseTimer);
    _collapseTimer = setTimeout(() => { if (currentView === 'month') collapse_overflowing_events(); }, 150);
});

// Show/hide a calendar ("only": show just this one). Re-renders at once from the loaded data,
// then saves each changed calendar with the idempotent V2 PATCH.
function toggle_calendar_visibility(el, only) {
    const row = el.closest('.calendar-name-div');
    if (!row || !data) return;
    const idx = parseInt(row.dataset.calendar);
    const changed = [];
    data["calendars"].forEach((c, i) => {
        const visible = only ? i === idx : (i === idx ? el.checked : c["visible"]);
        if (c["visible"] !== visible) { c["visible"] = visible; changed.push(c); }
    });
    if (!changed.length) return;

    reload_calendar();
    _afterDataLoad();
    switch_view(currentView);

    Promise.all(changed.map(c => fetch(`/api/v2/calendar/calendars/${encodeURIComponent(c["calendar"]["id"])}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
        body: JSON.stringify({ visible: c["visible"] }),
    }).then(r => { if (!r.ok) throw new Error(r.status); }))).then(() => {
        document.dispatchEvent(new CustomEvent('calendar:changed'));
    }).catch(() => {
        alert("Couldn't save the calendar visibility.");
        populate_calendar(m, y, true);  // revert to the server state
    });
}

function create_calendar() {
    $("#modal").modal();

    $('.modal-title').html("Create or join");
    $('.modal-body').html(calendar_create_form({}));


    const colourPick = colour_picker({ name: 'new-cal-colour', value: CAL_COLOURS[1][0] });
    document.querySelector('.calendar-colour-pick').appendChild(colourPick.el);
    let iconPick = null;
    CAL_APPEARANCE_READY.then(() => {
        if (!CAL_APPEARANCE || !document.querySelector('.calendar-icon-pick')) return;
        iconPick = icon_picker({ name: 'new-cal-icon', colour: colourPick.get() });
        document.querySelector('.calendar-icon-pick').appendChild(iconPick.el);
        document.querySelector('.calendar-icon-field').hidden = false;
        colourPick.el.addEventListener('change', () => iconPick.setColour(colourPick.get()));
    });

    // Created through the V2 API (same result as the legacy endpoint; can also carry the icon).
    $('.calendar-submit').click(() => {
        const name = $('.calendar-name').val().trim();
        if (!name) { $('.calendar-warn').text("Please enter a calendar name"); return; }
        const body = { name, colour: colourPick.get() || CAL_COLOURS[0][0] };
        if (iconPick && iconPick.get()) body.icon = iconPick.get();
        const btn = document.querySelector('.calendar-submit');
        btn.disabled = true;
        fetch('/api/v2/calendar/calendars', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() }, body: JSON.stringify(body),
        }).then(async r => {
            if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(typeof b.detail === 'string' ? b.detail : "Couldn't create the calendar."); }
            $('#modal').modal('hide');
            toast(`Created "${name}"`);
            populate_calendar(m, y, true);
        }).catch(err => {
            btn.disabled = false;
            $('.calendar-warn').text(err.message || "Couldn't create the calendar.");
        });
    });

    var subscribeCode

    document.querySelector('.subscribe-btn').onclick = () => {
        subscribeCode = document.querySelector('.subscribe-code').value
        if (subscribeCode == "") {
            $('.subscribe-warn').html("Please enter an subscribe code.")
        }
        else {
            $('.subscribe-warn').html("")
            r = new XMLHttpRequest()
            r.open("GET", `${URLS['subscribe']}?code=` + encodeURIComponent(subscribeCode))
            r.onload = () => {
                res = JSON.parse(r.responseText)
                if (res["status"] == "error") {
                    $('.subscribe-warn').html(res["data"])
                }
                else {
                    $('.modal-body').html(subscribe_confirm({ "name": res["data"]["name"], "owner": `${res["data"]["owner"]["first_name"]} ${res["data"]["owner"]["last_name"]}` }))
                    document.querySelector('.subscribe-confirm-btn').onclick = () => {
                        r = new XMLHttpRequest()
                        r.open("POST", `${URLS['subscribe']}?code=` + encodeURIComponent(subscribeCode))
                        r.setRequestHeader("X-CSRFToken", csrfToken())
                        r.onload = () => {
                            res = JSON.parse(r.responseText)
                            if (res["status"] == "error") {
                                $('.modal-body').html(`<p class="text-danger subscribe-warn mb-0">ERROR: ${res["data"]}</p>`)
                            }
                            else {
                                $('.modal-body').html(`
                                    <p class="text-success subscribe-warn mb-0">You are subscribed to this calendar.</p>
                                    <p>This page will automatically refresh. Please wait...</p>
                                `)
                                setTimeout(function () {
                                    populate_calendar(m, y, true);
                                    $('.modal').modal('close');
                                }, 1000)
                            }
                        }
                        r.send()
                    }
                }
            }
            r.send()
        }
    }
}

// =============================================================================================================
// CalendarDayView — reusable day-view component (Outlook / Thunderbird style)
// =============================================================================================================
class CalendarDayView {
    /**
     * @param {HTMLElement} container - Element to render into
     * @param {Object} options
     * @param {number} [options.hourHeight=60] - Pixels per hour
     * @param {number} [options.startHour=0]
     * @param {number} [options.endHour=24]
     * @param {Function} [options.onEventClick] - (eventObj, index) => void
     * @param {Function} [options.onSlotClick] - (date, hour, minute) => void
     * @param {boolean} [options.showHeader=false] - show day name header (used by week view)
     */
    constructor(container, options = {}) {
        this.container = container;
        this.hourHeight = options.hourHeight || 60;
        this.startHour = options.startHour || 0;
        this.endHour = options.endHour || 24;
        this.onEventClick = options.onEventClick || null;
        this.onSlotClick = options.onSlotClick || null;
        this.onDragCreate = options.onDragCreate || null;
        this.onTodoCheck = options.onTodoCheck || complete_task;
        this.showHeader = options.showHeader || false;
        this._nowTimer = null;
    }

    /**
     * Render day view for a single day.
     * @param {Date} date
     * @param {Array} timedEvents - [{name, startdate, enddate, calendar, id, ...}, ...]
     * @param {Array} allDayEvents
     * @param {Object} calendarMap - {calendarId: {colour, calendar: {name}}}
     */
    render(date, timedEvents, allDayEvents, calendarMap) {
        this.date = date;
        // Earliest timed item that starts on this day (used to scroll it into view).
        const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
        const starts = (timedEvents || []).map(ev => new Date(ev.startdate)).filter(d => d >= dayStart).map(d => d.getHours());
        this._firstHour = starts.length ? Math.min(...starts) : null;
        this.calendarMap = calendarMap;
        this.container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'cv-container';

        // Day header (shows which day this is)
        if (this.showHeader !== 'none') {
            const header = document.createElement('div');
            header.className = 'cv-day-header';
            header.textContent = moment(date).format('dddd, MMMM D, YYYY');
            wrapper.appendChild(header);
        }

        // All-day section
        wrapper.appendChild(this._buildAllDay(allDayEvents));

        // Scrollable time grid
        const scroll = document.createElement('div');
        scroll.className = 'cv-scroll';

        const grid = document.createElement('div');
        grid.className = 'cv-grid';
        grid.style.minHeight = (this.endHour - this.startHour) * this.hourHeight + 'px';

        // Gutter (time labels)
        grid.appendChild(this._buildGutter());

        // Single day column
        const col = this._buildDayColumn(date, timedEvents);
        const columns = document.createElement('div');
        columns.className = 'cv-columns';
        columns.appendChild(col);
        grid.appendChild(columns);

        scroll.appendChild(grid);
        wrapper.appendChild(scroll);
        this.container.appendChild(wrapper);

        // Scroll to ~current hour or 8 AM
        this._autoScroll(scroll, date);

        // Now indicator
        this._startNowIndicator(col, date);
    }

    /** Build the all-day events bar */
    _buildAllDay(allDayEvents) {
        const bar = document.createElement('div');
        bar.className = 'cv-allday';

        const label = document.createElement('div');
        label.className = 'cv-allday-label';
        label.textContent = 'all-day';
        bar.appendChild(label);

        const content = document.createElement('div');
        content.className = 'cv-allday-content';
        const col = document.createElement('div');
        col.className = 'cv-allday-column';

        (allDayEvents || []).forEach(ev => col.appendChild(this._allDayChip(ev, this.date)));

        content.appendChild(col);
        bar.appendChild(content);
        return bar;
    }

    /** One chip of the all-day lane: an all-day event, or a task due at 23:59 that day. */
    _allDayChip(ev, date) {
        if (ev._bday) {
            const a = document.createElement('a');
            a.className = 'cv-allday-event cv-bday';
            a.href = `/contacts/?id=${encodeURIComponent(ev.id)}`;
            a.style.setProperty('--ev', '#e87ba4');
            a.title = ev.name;
            a.insertAdjacentHTML('beforeend', BIRTHDAY_ICON);  // static icon
            a.append(' ', ev.name);
            return a;
        }
        if (ev._todo) {
            const today = date && new Date(date).toDateString() === new Date().toDateString();
            return this._todoChip(ev, today ? 'due today' : 'due');
        }
        const chip = document.createElement('div');
        chip.className = 'cv-allday-event';
        chip.style.setProperty('--ev', event_colour(ev));
        cal_set_ink(chip, event_colour(ev));
        chip.tabIndex = 0;
        chip.setAttribute('role', 'button');
        chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } });
        chip.textContent = plain(ev.name);
        chip.title = event_tooltip(ev);
        if (this.onEventClick) {
            chip.addEventListener('click', () => this.onEventClick(ev));
        }
        return chip;
    }

    /** Task chip: checkbox (completes it) + title (opens it in Tasks) + a short note. */
    _todoChip(t, note) {
        const name = plain(t.name);
        const chip = document.createElement('div');
        chip.className = 'cv-todo';
        chip.dataset.todoId = t.id;
        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'cv-todo-check';
        check.title = 'Mark complete';
        check.setAttribute('aria-label', `Mark "${name}" complete`);
        check.innerHTML = TODO_CHECK_ICON;  // static markup
        check.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.onTodoCheck) this.onTodoCheck(t, chip, check);
        });
        const link = document.createElement('a');
        link.className = 'cv-todo-title';
        link.href = `/tasks/?task=${encodeURIComponent(t.id)}`;
        link.textContent = name;
        link.title = `${name} · due ${moment(new Date(t.startdate)).format('ddd MMM D, h:mm A')}`;
        link.addEventListener('click', (e) => e.stopPropagation());
        chip.append(check, link);
        if (note) {
            const n = document.createElement('span');
            n.className = 'cv-todo-note';
            n.textContent = note;
            chip.appendChild(n);
        }
        chip.addEventListener('mousedown', (e) => e.stopPropagation());
        return chip;
    }

    /** Build the left-side time gutter */
    _buildGutter() {
        const gutter = document.createElement('div');
        gutter.className = 'cv-gutter';

        for (let h = this.startHour; h < this.endHour; h++) {
            if (h === 0) continue; // don't label midnight at top
            const lbl = document.createElement('div');
            lbl.className = 'cv-gutter-label';
            lbl.style.top = (h - this.startHour) * this.hourHeight + 'px';
            lbl.textContent = this._formatHour(h);
            gutter.appendChild(lbl);
        }

        return gutter;
    }

    /** Build a single day column with hour lines, slots, and events */
    _buildDayColumn(date, timedEvents) {
        const col = document.createElement('div');
        col.className = 'cv-day-col';

        // Hour and half-hour lines
        for (let h = this.startHour; h < this.endHour; h++) {
            const line = document.createElement('div');
            line.className = 'cv-hour-line';
            line.style.top = (h - this.startHour) * this.hourHeight + 'px';
            col.appendChild(line);

            const halfLine = document.createElement('div');
            halfLine.className = 'cv-half-hour-line';
            halfLine.style.top = (h - this.startHour) * this.hourHeight + this.hourHeight / 2 + 'px';
            col.appendChild(halfLine);
        }
        // Bottom line
        const bottomLine = document.createElement('div');
        bottomLine.className = 'cv-hour-line';
        bottomLine.style.top = (this.endHour - this.startHour) * this.hourHeight + 'px';
        col.appendChild(bottomLine);

        // Clickable slot overlay with drag-to-create
        const overlay = document.createElement('div');
        overlay.className = 'cv-slot-overlay';

        // Drag state
        let dragging = false;
        let dragStartY = 0;
        let dragPreview = null;
        const self = this;
        const totalHeight = (this.endHour - this.startHour) * this.hourHeight;

        const _yToTime = (y) => {
            const totalMins = (y / self.hourHeight) * 60 + self.startHour * 60;
            // Snap to 15 min
            const snapped = Math.round(totalMins / 15) * 15;
            const h = Math.floor(snapped / 60);
            const m = snapped % 60;
            return { h: Math.max(0, Math.min(23, h)), m: Math.max(0, Math.min(45, m)) };
        };

        overlay.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const rect = overlay.getBoundingClientRect();
            dragStartY = e.clientY - rect.top;
            dragging = true;

            // Create preview
            dragPreview = document.createElement('div');
            dragPreview.className = 'cv-drag-preview';
            dragPreview.style.top = dragStartY + 'px';
            dragPreview.style.height = '0px';
            col.appendChild(dragPreview);

            e.preventDefault();
        });

        overlay.addEventListener('mousemove', (e) => {
            if (!dragging || !dragPreview) return;
            const rect = overlay.getBoundingClientRect();
            const curY = Math.max(0, Math.min(totalHeight, e.clientY - rect.top));
            const top = Math.min(dragStartY, curY);
            const height = Math.abs(curY - dragStartY);
            dragPreview.style.top = top + 'px';
            dragPreview.style.height = height + 'px';
        });

        const _endDrag = (e) => {
            if (!dragging) return;
            dragging = false;
            if (dragPreview) {
                dragPreview.remove();
                dragPreview = null;
            }
            const rect = overlay.getBoundingClientRect();
            const endY = Math.max(0, Math.min(totalHeight, e.clientY - rect.top));
            const minY = Math.min(dragStartY, endY);
            const maxY = Math.max(dragStartY, endY);

            // Only trigger if dragged at least ~10px (not a simple click)
            if (maxY - minY < 10) {
                // Treat as click
                if (self.onSlotClick) {
                    const t = _yToTime(minY);
                    self.onSlotClick(date, t.h, t.m);
                }
                return;
            }

            const startT = _yToTime(minY);
            const endT = _yToTime(maxY);

            if (self.onDragCreate) {
                self.onDragCreate(date, startT.h, startT.m, endT.h, endT.m);
            }
        };

        overlay.addEventListener('mouseup', _endDrag);
        overlay.addEventListener('mouseleave', (e) => {
            if (dragging) _endDrag(e);
        });

        col.appendChild(overlay);

        // Position events
        this._layoutEvents(col, date, timedEvents);

        return col;
    }

    /** Layout timed events with overlap handling */
    _layoutEvents(col, date, timedEvents) {
        if (!timedEvents || !timedEvents.length) return;

        // Normalise events to day-local pixel coordinates
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        const items = timedEvents.map((ev, idx) => {
            let s = new Date(ev.startdate);
            let e = ev.enddate && ev.enddate !== 'None' ? new Date(ev.enddate) : new Date(s.getTime() + 30 * 60000); // default 30 min

            // Clamp to this day
            if (s < dayStart) s = dayStart;
            if (e > dayEnd) e = dayEnd;
            if (e <= s) e = new Date(s.getTime() + 15 * 60000);

            const topMin = (s.getHours() * 60 + s.getMinutes());
            const botMin = (e.getHours() * 60 + e.getMinutes()) || 1440;
            // Keep short items (e.g. a deadline at 11:59 PM) inside the grid: the minimum
            // height would otherwise push them past midnight, below the last hour line.
            const gridHeight = (this.endHour - this.startHour) * this.hourHeight;
            const height = Math.min(Math.max(((botMin - topMin) / 60) * this.hourHeight, 15), gridHeight);
            const top = Math.min((topMin / 60) * this.hourHeight, gridHeight - height);

            return {
                ev, idx, top, height,
                start: topMin,
                end: botMin
            };
        });

        // Sort by start time then by longest first
        items.sort((a, b) => a.start - b.start || b.end - a.end);

        // Greedy column assignment for overlaps
        const columns = [];
        for (const item of items) {
            let placed = false;
            for (let c = 0; c < columns.length; c++) {
                const lastInCol = columns[c][columns[c].length - 1];
                if (item.start >= lastInCol.end) {
                    columns[c].push(item);
                    item.col = c;
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                item.col = columns.length;
                columns.push([item]);
            }
        }

        const totalCols = columns.length;

        // Render each event
        for (const item of items) {
            const widthPct = 100 / totalCols;
            if (item.ev._todo) {
                const chip = this._todoChip(item.ev, short_time(new Date(item.ev.startdate)));
                chip.classList.add('cv-todo-timed');
                chip.style.top = Math.min(item.top, (this.endHour - this.startHour) * this.hourHeight - 22) + 'px';
                chip.style.left = (item.col * widthPct) + '%';
                chip.style.width = 'calc(' + widthPct + '% - 2px)';
                col.appendChild(chip);
                continue;
            }
            const el = document.createElement('div');
            el.className = 'cv-event';
            const cal = this.calendarMap[item.ev.calendar];
            el.style.setProperty('--ev', event_colour(item.ev));
            cal_set_ink(el, event_colour(item.ev));
            el.tabIndex = 0;
            el.setAttribute('role', 'button');
            el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
            el.style.top = item.top + 'px';
            el.style.height = item.height + 'px';

            // Width and left based on column
            el.style.left = (item.col * widthPct) + '%';
            el.style.width = 'calc(' + widthPct + '% - 2px)';

            // Content
            const title = document.createElement('div');
            title.className = 'cv-event-title';
            title.textContent = plain(item.ev.name);
            el.appendChild(title);

            const sDate = new Date(item.ev.startdate);
            let timeStr = moment(sDate).format('h:mm A');
            if (has_end(item.ev)) {
                timeStr += ' – ' + moment(new Date(item.ev.enddate)).format('h:mm A');
            } else {
                el.classList.add('cv-deadline');
                timeStr = 'Due ' + timeStr;
            }
            el.title = event_tooltip(item.ev);
            if (item.ev.completed) el.classList.add('is-done');
            if (item.height >= 30) {
                const time = document.createElement('div');
                time.className = 'cv-event-time';
                time.textContent = timeStr;
                el.appendChild(time);
            }
            if (item.height >= 48 && item.ev.location) {
                const loc = document.createElement('div');
                loc.className = 'cv-event-loc';
                loc.textContent = plain(item.ev.location);
                el.appendChild(loc);
            }

            if (this.onEventClick) {
                const evRef = item.ev;
                const idxRef = item.idx;
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.onEventClick(evRef, idxRef);
                });
            }

            col.appendChild(el);
        }
    }

    /** Auto-scroll to current hour or 8 AM */
    _autoScroll(scrollEl, date) {
        const now = new Date();
        let scrollToHour;
        if (date.toDateString() === now.toDateString()) {
            scrollToHour = Math.max(now.getHours() - 1, 0);
        } else {
            scrollToHour = this._firstHour !== null && this._firstHour !== undefined ? Math.max(this._firstHour - 1, 0) : 8;
        }
        requestAnimationFrame(() => {
            scrollEl.scrollTop = scrollToHour * this.hourHeight;
        });
    }

    /** Add and maintain the current-time red line */
    _startNowIndicator(col, date) {
        this._stopNowIndicator();

        const update = () => {
            const now = new Date();
            if (date.toDateString() !== now.toDateString()) {
                const existing = col.querySelector('.cv-now-line');
                if (existing) existing.remove();
                return;
            }
            let indicator = col.querySelector('.cv-now-line');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'cv-now-line';
                const dot = document.createElement('div');
                dot.className = 'cv-now-dot';
                indicator.appendChild(dot);
                col.appendChild(indicator);
            }
            const mins = now.getHours() * 60 + now.getMinutes();
            indicator.style.top = (mins / 60) * this.hourHeight + 'px';
        };

        update();
        this._nowTimer = setInterval(update, 60000);
    }

    _stopNowIndicator() {
        if (this._nowTimer) {
            clearInterval(this._nowTimer);
            this._nowTimer = null;
        }
    }

    _formatHour(h) {
        if (h === 0 || h === 24) return '12 AM';
        if (h === 12) return '12 PM';
        if (h < 12) return h + ' AM';
        return (h - 12) + ' PM';
    }

    _contrastColor(hex) {
        if (!hex) return '#fff';
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#1f1f1f' : '#ffffff';
    }

    destroy() {
        this._stopNowIndicator();
        this.container.innerHTML = '';
    }
}


// =============================================================================================================
// CalendarWeekView — reusable week-view component (composes day columns)
// =============================================================================================================
class CalendarWeekView {
    /**
     * @param {HTMLElement} container
     * @param {Object} options
     * @param {number} [options.hourHeight=60]
     * @param {Function} [options.onEventClick]
     * @param {Function} [options.onSlotClick]
     */
    constructor(container, options = {}) {
        this.container = container;
        this.hourHeight = options.hourHeight || 60;
        this.startHour = options.startHour || 0;
        this.endHour = options.endHour || 24;
        this.onEventClick = options.onEventClick || null;
        this.onSlotClick = options.onSlotClick || null;
        this.onDragCreate = options.onDragCreate || null;
        this.onTodoCheck = options.onTodoCheck || complete_task;
        this._nowTimer = null;
        this._dayHelper = new CalendarDayView(document.createElement('div'), {
            hourHeight: this.hourHeight,
            startHour: this.startHour,
            endHour: this.endHour,
        });
    }

    /**
     * @param {Date} weekStartDate - the Sunday (or Monday) that starts the week
     * @param {Object} eventsByDay - { 0: {timed: [], allDay: []}, 1: {...}, ... 6: {...} }
     *    keys 0-6 for Sun-Sat (or the 7 days starting from weekStartDate)
     * @param {Object} calendarMap
     */
    render(weekStartDate, eventsByDay, calendarMap) {
        this.weekStartDate = weekStartDate;
        this.calendarMap = calendarMap;
        this.container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'cv-container';

        const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStartDate);
            d.setDate(d.getDate() + i);
            dates.push(d);
        }
        const today = new Date();

        // Week header
        const header = document.createElement('div');
        header.className = 'cv-week-header';
        const gutterH = document.createElement('div');
        gutterH.className = 'cv-week-header-gutter';
        header.appendChild(gutterH);

        dates.forEach(d => {
            const dh = document.createElement('div');
            dh.className = 'cv-week-header-day';
            if (d.toDateString() === today.toDateString()) dh.classList.add('cv-today');
            const nameSpan = document.createElement('span');
            nameSpan.className = 'cv-week-header-day-name';
            nameSpan.textContent = dayNames[d.getDay()];
            const numSpan = document.createElement('span');
            numSpan.className = 'cv-week-header-day-num';
            numSpan.textContent = d.getDate();
            dh.appendChild(nameSpan);
            dh.appendChild(numSpan);
            header.appendChild(dh);
        });
        wrapper.appendChild(header);

        // Handlers for the shared day helper (all-day chips and day columns)
        this._dayHelper.onEventClick = this.onEventClick;
        this._dayHelper.onSlotClick = this.onSlotClick;
        this._dayHelper.onDragCreate = this.onDragCreate;
        this._dayHelper.onTodoCheck = this.onTodoCheck;
        this._dayHelper.calendarMap = calendarMap;

        // All-day section
        wrapper.appendChild(this._buildAllDayWeek(dates, eventsByDay, calendarMap));

        // Scrollable grid
        const scroll = document.createElement('div');
        scroll.className = 'cv-scroll';
        const grid = document.createElement('div');
        grid.className = 'cv-grid';
        grid.style.minHeight = (this.endHour - this.startHour) * this.hourHeight + 'px';

        // Gutter
        grid.appendChild(this._dayHelper._buildGutter());

        // 7 day columns
        const columns = document.createElement('div');
        columns.className = 'cv-columns';
        this._dayCols = [];


        dates.forEach((d, i) => {
            const dayEvents = eventsByDay[i] ? eventsByDay[i].timed || [] : [];
            const col = this._dayHelper._buildDayColumn(d, dayEvents);
            columns.appendChild(col);
            this._dayCols.push({ col, date: d });
        });

        grid.appendChild(columns);
        scroll.appendChild(grid);
        wrapper.appendChild(scroll);
        this.container.appendChild(wrapper);

        // Auto-scroll
        this._dayHelper._autoScroll(scroll, today);

        // Now indicators for today's column
        this._startNowIndicators();
    }

    _buildAllDayWeek(dates, eventsByDay, calendarMap) {
        const bar = document.createElement('div');
        bar.className = 'cv-allday';

        const label = document.createElement('div');
        label.className = 'cv-allday-label';
        label.textContent = 'all-day';
        bar.appendChild(label);

        const content = document.createElement('div');
        content.className = 'cv-allday-content';

        dates.forEach((d, i) => {
            const col = document.createElement('div');
            col.className = 'cv-allday-column';
            const allDayEvts = eventsByDay[i] ? eventsByDay[i].allDay || [] : [];
            allDayEvts.forEach(ev => col.appendChild(this._dayHelper._allDayChip(ev, d)));
            content.appendChild(col);
        });

        bar.appendChild(content);
        return bar;
    }

    _startNowIndicators() {
        this._stopNowIndicators();
        const today = new Date();

        const update = () => {
            const now = new Date();
            for (const { col, date } of this._dayCols) {
                const existing = col.querySelector('.cv-now-line');
                if (existing) existing.remove();
                if (date.toDateString() === now.toDateString()) {
                    const indicator = document.createElement('div');
                    indicator.className = 'cv-now-line';
                    const dot = document.createElement('div');
                    dot.className = 'cv-now-dot';
                    indicator.appendChild(dot);
                    const mins = now.getHours() * 60 + now.getMinutes();
                    indicator.style.top = (mins / 60) * this.hourHeight + 'px';
                    col.appendChild(indicator);
                }
            }
        };

        update();
        this._nowTimer = setInterval(update, 60000);
    }

    _stopNowIndicators() {
        if (this._nowTimer) {
            clearInterval(this._nowTimer);
            this._nowTimer = null;
        }
    }

    destroy() {
        this._stopNowIndicators();
        this.container.innerHTML = '';
    }
}


// =============================================================================================================
// open_day — the day of the loaded month in the big modal (CalendarDayView)
// =============================================================================================================
var _activeDayView = null;

function open_day(dpd, dpMonth = m + 1, dpYear = y) {
    if (!data) return;
    const viewDate = new Date(dpYear, dpMonth - 1, dpd);
    const modalEl = document.getElementById('big-modal');
    document.querySelector('.big-modal-title').textContent = moment(viewDate).format('dddd, MMMM D, YYYY');
    const container = document.querySelector('.big-modal-body');
    container.replaceChildren();

    if (_activeDayView) { _activeDayView.destroy(); }
    _activeDayView = new CalendarDayView(container, {
        hourHeight: 60,
        onEventClick: function (ev) {
            $('#big-modal').modal('hide');
            open_event(ev);
        },
        onSlotClick: function (date) {
            $('#big-modal').modal('hide');
            add_edit_event(date.getDate(), date.getMonth() + 1, date.getFullYear());
        }
    });
    const day = items_for_day(viewDate);
    _activeDayView.render(viewDate, day.timed, day.allDay, calendars);

    // The grid can only scroll once the modal is laid out.
    const view = _activeDayView;
    if (!modalEl.classList.contains('show')) {
        modalEl.addEventListener('shown.bs.modal', () => {
            const sc = container.querySelector('.cv-scroll');
            if (sc && view === _activeDayView) view._autoScroll(sc, viewDate);
        }, { once: true });
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
}

// =============================================================================================================
// Events and tasks by date (day/week views). The month payload covers the loaded month; weeks that
// cross into the next/previous month fetch that month too (same endpoint and options, cached).
// =============================================================================================================
// Month payloads (legacy /calendar/api/events/), shared by the month grid and the day/week views.
// key "YYYY-M" (0-based month) -> {t: fetched at, data, stale}. Fresh entries are reused instead of refetched;
// edits mark everything stale (the loaded month refetches at once, the others when they're next needed).
var _monthCache = {};
var _monthPending = {};
var MONTH_TTL = 5 * 60000;
var TODO_CHECK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path class="ci-ring" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path class="ci-tick" d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>';

function month_key(yy, mm) { return `${yy}-${mm}`; }

// Every event we have: the loaded month first, then cached neighbouring months (deduplicated).
function loaded_events() {
    const all = data ? data['events'].slice() : [];
    const seen = new Set(all.map(e => e.id));
    for (const [key, entry] of Object.entries(_monthCache)) {
        if (key === month_key(y, m) || !entry.data || !entry.data.events) continue;  // the loaded month's own copy is authoritative
        for (const e of entry.data.events) if (!seen.has(e.id)) { seen.add(e.id); all.push(e); }
    }
    return all;
}

function find_event(id) {
    return loaded_events().find(e => e.id === id) || null;
}

function eastern_day(iso) {
    const p = getEasternDateParts(new Date(iso));
    return new Date(p.year, p.month - 1, p.day);
}

// Items to draw on one day: timed events (incl. deadlines and multi-day pieces), all-day events,
// and open tasks due that day (23:59 = "due that day", drawn in the all-day lane).
function items_for_day(date, list = loaded_events()) {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const timed = [], allDay = [];
    for (const ev of list) {
        const cal = calendars[ev['calendar']];
        if (cal && cal['visible'] === false) continue;
        if (ev['allday']) {
            const s = eastern_day(ev['startdate']);
            let e = has_end(ev) ? eastern_day(ev['enddate']) : null;
            if (!e || e <= s) { e = new Date(s); e.setDate(e.getDate() + 1); }
            if (s <= dayStart && dayStart < e) allDay.push(ev);
        } else if (!has_end(ev)) {
            const s = new Date(ev['startdate']);
            if (s >= dayStart && s < dayEnd) timed.push(ev);
        } else if (new Date(ev['startdate']) < dayEnd && new Date(ev['enddate']) > dayStart) {
            timed.push(ev);
        }
    }
    if (show_contact_birthdays()) {
        const key = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
        for (const b of _contactBdays[key] || []) allDay.push({ _bday: true, id: b.id, name: birthday_label(b) });
    }
    if (data && localStorage.getItem('calendar_show_todos') == 1) {
        for (const t of data['todos']) {
            if (t['completed'] || !t['complete_by']) continue;
            const due = new Date(t['complete_by']);
            if (due < dayStart || due >= dayEnd) continue;
            const item = { _todo: true, id: t['id'], name: t['name'], startdate: t['complete_by'], enddate: null };
            (due.getHours() === 23 && due.getMinutes() === 59 ? allDay : timed).push(item);
        }
    }
    return { timed, allDay };
}

// Fetch months (other than the loaded one) that the given dates fall in; re-render when they arrive.
function ensure_months(dates) {
    const wanted = new Map();
    for (const d of dates) {
        if (d.getMonth() === m && d.getFullYear() === y) continue;
        const key = month_key(d.getFullYear(), d.getMonth());
        const c = _monthCache[key];
        if ((!c || c.stale || Date.now() - c.t > MONTH_TTL) && !_monthPending[key]) wanted.set(key, [d.getFullYear(), d.getMonth()]);
    }
    wanted.forEach(([yy, mm], key) => {
        _monthPending[key] = fetch_month(mm, yy)
            .then(d => { cache_month(key, d); _afterDataLoad(); })
            .catch(() => { })  // keep whatever we had; the grid still shows the loaded month
            .finally(() => { delete _monthPending[key]; });
    });
}

// Tick a task off from the day/week view (repeating tasks move to their next date).
function complete_task(t, chip, btn) {
    btn.disabled = true;
    chip.classList.add('is-done');
    done_task(t.id).catch(() => {
        chip.classList.remove('is-done');
        btn.disabled = false;
        btn.title = "Couldn't complete it. Try again";
    });
}

// Show one event's details in the small modal.
function open_event(ev) {
    if (!ev) return;
    show_event(ev);
}

// Open an event by id. If we don't have it, go to its month first.
function open_event_by_id(id, startIso) {
    const ev = find_event(id);
    if (ev) { open_event(ev); return; }
    const d = new Date(startIso);
    if (isNaN(d)) return;
    goto_month(d.getMonth(), d.getFullYear(), () => open_event(find_event(id)));
}

function goto_month(month, year, after) {
    $('#month').val(month);
    $('#year').val(year);
    jump();
    make_holidays_red();
    m = month;
    y = year;
    populate_calendar(m, y, false, after);
}

var BIRTHDAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0v.006c0 .07 0 .27-.038.494H15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 14.5V7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2.038A2.968 2.968 0 0 1 3 2.506V2.5zm1.068.5H7v-.5a1.5 1.5 0 1 0-3 0c0 .085.002.274.045.43a.522.522 0 0 0 .023.07zM9 3h2.932a.56.56 0 0 0 .023-.07c.043-.156.045-.345.045-.43a1.5 1.5 0 0 0-3 0V3zM1 4v2h6V4H1zm8 0v2h6V4H9zm5 3H9v8h4.5a.5.5 0 0 0 .5-.5V7zm-7 8V7H2v7.5a.5.5 0 0 0 .5.5H7z"/></svg>`;

// Append one month chip to a day cell.
// Hover text with everything the old chips and info box showed: when, calendar, category, place, repeat.
function event_tooltip(ev) {
    const s0 = new Date(ev['startdate']);
    let when;
    if (ev['allday']) {
        const a = ev['start_date'] ? moment(ev['start_date']) : moment(eastern_day(ev['startdate']));
        const last = ev['end_date'] ? moment(ev['end_date']).subtract(1, 'day') : a;
        when = last.isAfter(a, 'day') ? `${a.format('ddd MMM D')} – ${last.format('ddd MMM D')} · All day` : `${a.format('ddd MMM D')} · All day`;
    } else if (!has_end(ev)) when = `Due ${moment(s0).format('ddd MMM D, h:mm A')}`;
    else {
        const e0 = new Date(ev['enddate']);
        when = s0.toDateString() === e0.toDateString() ? `${moment(s0).format('ddd MMM D, h:mm A')} – ${moment(e0).format('h:mm A')}`
            : `${moment(s0).format('ddd MMM D, h:mm A')} – ${moment(e0).format('ddd MMM D, h:mm A')}`;
    }
    const cal = calendars[ev['calendar']];
    const cat = ev['category_name'] ? plain(ev['category_name']) : (ev['category'] ? CATEGORY_LABELS[ev['category']] : '');
    return [
        plain(ev['name']) + (ev['completed'] ? ' (done)' : ''), when,
        [cal ? plain(cal.calendar.name) : '', cat].filter(Boolean).join(' · '),
        plain(value_or_empty(ev['location'])),
        ev['recurring'] ? 'Repeats' : '',
        (ev['tags'] || []).length ? '#' + ev['tags'].map(plain).join(' #') : '',
    ].filter(Boolean).join('\n');
}

function add_chip(selector, o) {
    const dp = document.querySelector(selector);
    if (!dp) return;
    const title = plain(o.title);
    const ink = cal_ink(o.bg_color || o.color);
    dp.insertAdjacentHTML('beforeend', calendar_item({
        ...o, title, ink_l: ink ? ink.l : '', ink_d: ink ? ink.d : '',
        tip: o.ev ? event_tooltip(o.ev) : [o.time ? `${o.time} ${title}` : title, plain(o.location)].filter(Boolean).join(' · '),
    }));
}

function reload_calendar() {
    $('.calendarlist-mine').html("")
    $('.calendarlist-other').html("")
    $('.todo-list').html("");
    $('.day-events').html("");
    $('.reg-events').html("");

    events = {
        "events": {},
        "allday": {},
    }

    for (let d = 1; d <= daysInMonth(m, y); d++) {
        events["events"][d] = [];
        events["allday"][d] = [];
    }

    const mine = [], other = [];
    data["calendars"].forEach((c, i) => {
        calendars[c["calendar"]["id"]] = c;
        const html = calendar_name({
            "id": c["calendar"]["id"], "name": plain(c["calendar"]["name"]), "calendar": i,
            "calendar_type": c["calendar"]["calendar_type"], "checked": c["visible"] === false ? "" : "checked",
            "colour": c['colour'], "owner": c["subscribe_type"] == 0, "inactive": c["calendar"]["active"] === false,
            "admin": c["subscribe_type"] == 1, "sync": c["calendar"]["calendar_type"] != "0",
            "c_owner": c["calendar"]["owner"] && c["calendar"]["owner"]["id"] == USER_ID,
            "icon": cal_icon_svg(c["calendar"]["icon"] || c["icon"] || '', 14),  // static SVG for a known icon name
            "tip": [plain(c["calendar"]["name"]), ['Owner', 'Admin', 'Subscriber'][c["subscribe_type"]] || '', c["calendar"]["calendar_type"] != 0 ? 'Synced' : '', c["calendar"]["public"] ? 'Public' : '', c["calendar"]["active"] === false ? 'Inactive' : ''].filter(Boolean).join(' · '),
            "ink_l": (cal_ink(c['colour']) || {}).l, "ink_d": (cal_ink(c['colour']) || {}).d, "light": (cal_ink(c['colour']) || {}).light, "lightD": (cal_ink(c['colour']) || {}).lightD,
        });
        (c["subscribe_type"] == 0 ? mine : other).push(html);
    });
    document.querySelector('.calendarlist-mine').innerHTML = mine.join('');
    document.querySelector('.calendarlist-other').innerHTML = other.join('');

    if (localStorage.getItem('calendar_show_birthdays') == 1) {
        data["birthdays"].forEach((b, i) => {
            const date_ = new Date(b["birthday"]).getUTCDate();
            add_chip(`.day-events-${date_}`, { 'modal': false, 'calendar': "", 'i': i, 'type': "event", 'bg_color': "", 'color': 'var(--app-muted)', 'icon': BIRTHDAY_ICON, 'title': `${b['username']}'s birthday` });
        });
    }

    if (show_contact_birthdays()) {
        for (const [date, list] of Object.entries(_contactBdays)) {
            const [Y, M, D] = date.split('-').map(Number);
            if (Y !== y || M - 1 !== m) continue;
            for (const b of list) {
                const dp = document.querySelector(`.day-events-${D}`);
                if (dp) dp.insertAdjacentHTML('beforeend', contact_bday_chip({ id: b.id, title: birthday_label(b), icon: BIRTHDAY_ICON }));
            }
        }
    }

    const evs = data["events"];
    for (let i = 0; i < evs.length; i++) {
        const ev = evs[i];
        const cal = calendars[ev['calendar']];
        // Skip events from hidden calendars
        if (cal && cal['visible'] === false) continue;
        const colour = event_colour(ev);

        let sd = new Date(ev['startdate']);
        let ed = new Date(ev['enddate']);
        if (ev['allday'] == true) {
            const sParts = getEasternDateParts(sd);
            sd = new Date(sParts.year, sParts.month - 1, sParts.day);
            if (has_end(ev)) {
                const eParts = getEasternDateParts(ed);
                ed = new Date(eParts.year, eParts.month - 1, eParts.day);
            }
        }

        // The event's own icon (once the server has it) replaces the category icon.
        const icon = (ev['icon'] && cal_icon_svg(ev['icon'], 12)) || (ev['category'] == 100 ? "" : (ICONS[ev['category']] || ""));
        const base = { 'modal': true, 'calendar': ev['calendar'], 'i': i, 'type': "event", 'icon': icon, 'title': ev['name'], 'location': ev['location'], 'del': ev['completed'] == true, 'ev': ev };
        const timed = { ...base, 'color': colour, 'time': short_time(sd) };    // dot + time + title
        const bar = { ...base, 'bg_color': colour, 'color': '#f0f0f0' };       // tinted all-day / multi-day bar

        if (!has_end(ev)) {
            add_chip(`.reg-events-${sd.getDate()}`, timed);
            if (events["events"][sd.getDate()]) events["events"][sd.getDate()].push(ev);
        }
        else if (sd.getMonth() == m && ed.getMonth() == m) {
            for (let j = sd.getDate(); j <= ed.getDate(); j++) {
                if (sd.getDate() == ed.getDate()) {
                    add_chip(`.reg-events-${j}`, timed);
                    events["events"][j].push(ev);
                }
                else if (ev['allday'] == true) {
                    if (j != ed.getDate()) {
                        add_chip(`.day-events-${j}`, bar);
                        events["allday"][j].push(ev);
                    }
                }
                else {
                    if (j == sd.getDate()) { events["events"][j].push(ev); }
                    add_chip(`.day-events-${j}`, j == sd.getDate() ? { ...bar, 'time': short_time(sd) } : bar);
                }
            }
        }
        else if (sd.getMonth() == m) {
            for (let j = sd.getDate(); j <= daysInMonth(m, y); j++) {
                if (ev['allday'] == true) {
                    add_chip(`.day-events-${j}`, bar);
                    events["allday"][j].push(ev);
                }
                else {
                    if (j == sd.getDate()) { events["events"][j].push(ev); }
                    add_chip(`.day-events-${j}`, j == sd.getDate() ? { ...bar, 'time': short_time(sd) } : bar);
                }
            }
        }
        else if (ed.getMonth() == m) {
            for (let j = 1; j <= ed.getDate(); j++) {
                if (!(ev["allday"] == true && j == ed.getDate())) {
                    add_chip(`.day-events-${j}`, bar);
                }
            }
        }
        else {
            for (let j = 1; j <= daysInMonth(m, y); j++) {
                add_chip(`.day-events-${j}`, bar);
            }
        }
    }

    const now = new Date();
    const sidebarTodos = [];
    let openCount = 0;
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    for (let [num, todo] of data["todos"].entries()) {
        let cls = "", overdue = false, due = "";
        if (todo["complete_by"] != null) {
            const cd = new Date(todo["complete_by"]);
            const untimed = cd.getHours() == 23 && cd.getMinutes() == 59;
            const dayDiff = Math.round((new Date(cd).setHours(0, 0, 0, 0) - todayStart) / 86400000);
            const dayLabel = dayDiff === 0 ? 'Today' : dayDiff === -1 ? 'Yesterday' : dayDiff === 1 ? 'Tomorrow'
                : moment(cd).format(cd.getFullYear() === now.getFullYear() ? 'ddd MMM D' : 'MMM D, YYYY');
            due = untimed ? dayLabel : `${dayLabel} ${moment(cd).format('h:mm A')}`;
            if (cd <= now) { cls = "is-overdue"; overdue = true; }
            else if (dayDiff === 0) { cls = "is-today"; }
            else if (cd.getTime() - now.getTime() <= timediff2) { cls = "is-soon"; }

            if (localStorage.getItem("calendar_show_todos") == 1 && cd.getMonth() == m && cd.getFullYear() == y) {
                add_chip(`.day-events-${cd.getDate()}`, { 'modal': false, 'calendar': "", 'i': num, 'type': "event", 'bg_color': "", 'color': 'var(--app-muted)', 'icon': TASK_ICON, 'del': todo["completed"] == true, 'time': untimed ? "" : short_time(cd), 'title': todo.name });
            }
        }
        if (todo["completed"] == false) {
            openCount++;
            const dueSoon = todo["complete_by"] != null && new Date(todo["complete_by"]).getTime() - now.getTime() <= 7 * 86400000;
            // Priority 0-20 -> the Tasks app's Low/Medium/High/Urgent ring colours
            const pr = todo.priority ?? 10;
            const prio = pr <= 5 ? 1 : pr <= 10 ? 2 : pr <= 15 ? 3 : 4;
            sidebarTodos.push([todo["complete_by"] ? new Date(todo["complete_by"]).getTime() : Infinity, dueSoon, todo_item({ 'id': todo.id, 'name': plain(todo.name), 'cls': cls, 'overdue': overdue, 'due': due, 'prio': prio, 'i': num })]);
        }
    }
    sidebarTodos.sort((a, b) => (a[0] - b[0]) || 0);
    // Every open task, overdue and soonest first (undated last). The first 8 show; the rest expand in place.
    const listEl = document.querySelector('.todo-list');
    const expanded = listEl.classList.contains('is-expanded');
    listEl.innerHTML = sidebarTodos.map((x, i) => i < 8 ? x[2] : x[2].replace('class="todo-item"', 'class="todo-item is-extra"')).join('')
        + (sidebarTodos.length > 8 ? `<button type="button" class="todo-more" data-todo-more aria-expanded="${expanded}">${expanded ? 'Show fewer' : `Show ${sidebarTodos.length - 8} more`}</button>` : '');
    const dueSoonCount = sidebarTodos.filter(x => x[1]).length;
    const tasksCount = document.getElementById('wg-count-tasks');
    if (tasksCount) { tasksCount.textContent = dueSoonCount ? String(dueSoonCount) : ''; tasksCount.title = `${dueSoonCount} overdue or due within 7 days`; }
    const openLink = document.getElementById('todo-open-link');
    if (openLink) openLink.textContent = openCount ? `Open Tasks · ${openCount} open` : 'Open Tasks';

    for (const [day, count] of Object.entries(data["photos"])) { $(`.day-images-btn-${day}`).text(count); }

    change_height();
    collapse_overflowing_events();

    hide_loading();
}

function month_url(mm, yy) {
    return `${URLS['get_events']}?month=${mm + 1}&year=${yy}&show_all=${encodeURIComponent(localStorage.getItem('calendar_show_all') || 0)}&extra=${encodeURIComponent(localStorage.getItem('calendar_extra') || '')}&show_invisible=1`;
}

// One month payload. Rejects on network errors, HTTP errors and unreadable responses.
function fetch_month(mm, yy) {
    return fetch(month_url(mm, yy), { credentials: 'same-origin' }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
    }).then(text => {
        const d = JSON.parse(text.replace(/&#x27;/g, '"'))["data"];
        if (d == "Not logged in") { window.location.reload(); throw new Error('logged out'); }
        if (!d || !Array.isArray(d.events) || !Array.isArray(d.calendars)) throw new Error('bad payload');
        return d;
    });
}

// Last good payloads also go to sessionStorage, so a reload during a server restart still paints something.
function session_key(key) {
    return `calendar:month:${key}:${localStorage.getItem('calendar_show_all') || 0}:${localStorage.getItem('calendar_extra') || ''}`;
}

function cache_month(key, d) {
    _monthCache[key] = { t: Date.now(), data: d, stale: false };
    try {
        const k = session_key(key);
        sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), data: d }));
        const keys = JSON.parse(sessionStorage.getItem('calendar:month:keys') || '[]').filter(x => x !== k);
        keys.push(k);
        while (keys.length > 3) sessionStorage.removeItem(keys.shift());
        sessionStorage.setItem('calendar:month:keys', JSON.stringify(keys));
    } catch (e) { }  // storage full or blocked: memory cache only
}

function saved_month(key) {
    try { const v = JSON.parse(sessionStorage.getItem(session_key(key)) || 'null'); if (v && v.data) return v; } catch (e) { }
    return null;
}

// ---- failure banner + retry with backoff (2 s, 5 s, 15 s, then every 30 s while the tab is visible)
var _retryTimer = null, _retryN = 0, _failing = false;
var RETRY_DELAYS = [2000, 5000, 15000, 30000];

function show_banner(message) {
    const b = document.getElementById('cal-banner');
    b.querySelector('.cal-banner-msg').textContent = message;
    b.hidden = false;
}

function hide_banner() {
    document.getElementById('cal-banner').hidden = true;
}

function schedule_retry() {
    clearTimeout(_retryTimer);
    if (document.visibilityState !== 'visible') return;  // resumes on visibilitychange
    const delay = RETRY_DELAYS[Math.min(_retryN, RETRY_DELAYS.length - 1)];
    _retryN++;
    _retryTimer = setTimeout(() => populate_calendar(m, y, false, null, { background: true }), delay);
}

function retry_now() {
    clearTimeout(_retryTimer);
    _retryN = 0;
    populate_calendar(m, y, false, null, { manualRetry: true });
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (_failing) retry_now();
    else background_refresh(2 * 60000);
});

// When the month can't be fetched: rebuild it from the V2 APIs (each part on its own), keeping
// whatever we already have (calendars, tasks) for parts that fail too.
function fallback_month(mm, yy) {
    const start = new Date(yy, mm, 1), end = new Date(yy, mm + 1, 1);
    const get = (url) => fetch(url, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : Promise.reject(r.status));
    return Promise.allSettled([
        get('/api/v2/calendar/calendars?include_inactive=true'),
        get(`/api/v2/calendar/events?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&include_hidden=true`),
        get('/api/v2/tasks/?done=false&limit=500'),
    ]).then(([cals, evs, tasks]) => {
        const prev = data || {};
        const out = { calendars: prev.calendars || [], events: [], todos: prev.todos || [], birthdays: [], photos: {}, _partial: true };
        if (cals.status === 'fulfilled') {
            out.calendars = cals.value.map(c => ({
                id: c.id, subscribe_type: { owner: 0, admin: 1 }[c.role] ?? 2, colour: c.colour, visible: c.visible,
                calendar: { id: c.id, name: c.name, colour: c.colour, active: c.active, public: c.public, calendar_type: c.calendar_type, owner: { id: c.role === 'owner' ? USER_ID : '' }, icon: c.icon },
            }));
        }
        if (evs.status === 'fulfilled') {
            out.events = evs.value.map(e => ({
                id: e.id, name: e.name, startdate: e.start, enddate: e.end, allday: e.all_day, category: e.category, location: e.location,
                description: e.description, completed: e.completed, priority: e.priority, calendar: e.calendar_id, public: false,
                colour: e.colour, icon: e.icon, display_colour: e.display_colour,
            }));
        }
        if (tasks.status === 'fulfilled' && Array.isArray(tasks.value.items)) {
            out.todos = tasks.value.items.map(t => ({ id: t.id, name: t.title, description: t.description, priority: t.priority, completed: t.done, complete_by: t.due }));
        }
        out._failedParts = [cals, evs, tasks].filter(x => x.status !== 'fulfilled').length;
        return out;
    });
}

var _populateSeq = 0;
// Load (or reuse) a month and render it. Failures never blank the page: the last good copy stays
// on screen with a small banner, and retries back off. opts.background: refresh nobody asked for.
function populate_calendar(mm, yy, jumponload = false, after = null, opts = {}) {
    const seq = ++_populateSeq;
    const key = month_key(yy, mm);
    const cached = _monthCache[key];
    const render = (d, note) => {
        if (seq !== _populateSeq) return;
        data = d;
        data._key = key;
        if (jumponload) reload();
        load_contact_birthdays();
        reload_calendar();
        if (!note) {
            lastrefresh = new Date();
            $('#last-refresh').text(moment(lastrefresh).format('LTS'));
        }
        _afterDataLoad();
        switch_view(currentView);
        document.dispatchEvent(new CustomEvent('calendar:loaded', { detail: { manual: jumponload && !opts.background, background: !!opts.background } }));
        if (after) after();
    };

    // Paging back to a month we fetched a moment ago: no request.
    if (cached && !cached.stale && !jumponload && !opts.background && !opts.manualRetry && Date.now() - cached.t < MONTH_TTL && !_failing) {
        render(cached.data);
        return;
    }
    if (jumponload) for (const c of Object.values(_monthCache)) c.stale = true;  // an edit: neighbours refetch when needed
    if (!opts.background) document.querySelector('.loading-screen').style.display = '';

    fetch_month(mm, yy).then(d => {
        if (seq !== _populateSeq) return;
        delete d._savedAt;
        cache_month(key, d);
        _failing = false;
        _retryN = 0;
        clearTimeout(_retryTimer);
        hide_banner();
        render(d);
    }).catch(() => {
        if (seq !== _populateSeq) return;
        _failing = true;
        hide_loading();
        if (data && data._key === key && !data._partial) {
            show_banner(data._savedAt ? `Showing a saved copy from ${moment(data._savedAt).format('LT')}. Couldn't reach the server.`
                : "Couldn't refresh. Showing what was loaded earlier.");
        } else {
            const saved = (cached && cached.data) ? { t: cached.t, data: cached.data } : saved_month(key);
            if (saved) {
                if (!(cached && cached.data)) saved.data._savedAt = saved.t;
                render(saved.data, 'saved');
                show_banner(`Showing a saved copy from ${moment(saved.t).format('LT')}. Couldn't reach the server.`);
            } else {
                fallback_month(mm, yy).then(d => {
                    render(d, 'partial');
                    show_banner(d._failedParts >= 3 ? "Couldn't reach the server." : "Couldn't load everything. Showing what loaded.");
                });
            }
        }
        schedule_retry();
    });
}

// Unasked refreshes: at most every few minutes, only while the tab is visible (and on focus).
function background_refresh(minAge = MONTH_TTL) {
    if (document.visibilityState !== 'visible' || _failing) return;
    if (lastrefresh && Date.now() - lastrefresh < minAge) return;
    if (new Date().getDate() != loaddate) {  // a new day: move "today"
        loaddate = new Date().getDate();
        showCalendar(m, y);
        make_holidays_red();
    }
    populate_calendar(m, y, false, null, { background: true });
}

// ---- Local patches: after a small change, update what we have instead of refetching the month.
function after_local_change() {
    reload_calendar();
    _afterDataLoad();
    document.dispatchEvent(new CustomEvent('calendar:changed'));
}

// Put a V2 task (POST /tasks/quick, /tasks/{id}/done, /tasks/from-event) into the loaded todos.
function upsert_todo(task) {
    if (!data || !task) return;
    const todo = { id: task.id, name: task.title, description: task.description, priority: task.priority, completed: !!task.done, complete_by: task.due, completed_on: task.done_at };
    const i = data['todos'].findIndex(t => t.id === task.id);
    if (i === -1) data['todos'].push(todo);
    else Object.assign(data['todos'][i], todo);
}

// Complete a task via V2 (repeating tasks move to their next date) and patch the local copy.
function done_task(id) {
    return fetch(`/api/v2/tasks/${encodeURIComponent(id)}/done`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': csrfToken() },
    }).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status)))).then(res => {
        upsert_todo(res.task);
        after_local_change();
        toast(res.repeated ? `Done. Next: ${moment(res.task.due).format('ddd MMM D')}` : 'Task completed');
        return res;
    });
}

function complete_todo(todo_id) {
    const todo = data["todos"][todo_id];
    if (!todo) return;
    const row = document.querySelector(`.todo-item[data-i="${todo_id}"]`);
    if (row) row.classList.add('is-fading');
    done_task(todo["id"]).catch(() => {
        if (row) row.classList.remove('is-fading');
        toast("Couldn't complete the task.", true);
    });
}

var SYNC_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-repeat text-muted" viewBox="0 0 16 16" aria-label="Synced"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>';

// Event details in the small modal. Month chips carry `data-no` (index in data.events).
function display_info(button) {
    show_event(data["events"][button.dataset.no]);
}

function show_event(event_) {
    if (!event_) return;

    let sd = new Date(event_["startdate"]);
    let ed = new Date(event_["enddate"]);
    const deadline = !has_end(event_);
    if (event_["allday"] == true) {
        const sParts = getEasternDateParts(sd);
        sd = new Date(sParts.year, sParts.month - 1, sParts.day);
        if (!deadline) {
            const eParts = getEasternDateParts(ed);
            ed = new Date(eParts.year, eParts.month - 1, eParts.day);
        }
    }


    let date_;
    if (deadline) { date_ = moment(sd).format('LLLL'); }
    else if (event_["allday"] == true) {
        const last = moment(ed).subtract(1, 'days');
        date_ = last.isSame(moment(sd), 'day') || last.isBefore(moment(sd)) ? moment(sd).format('LL') : moment(sd).format('LL') + " – " + last.format('LL');
    }
    else if (sd.toDateString() == ed.toDateString()) { date_ = moment(sd).format('LLL') + " – " + moment(ed).format('LT'); }
    else { date_ = moment(sd).format('LLL') + " – " + moment(ed).format('LLL'); }

    const cal = calendars[event_["calendar"]];
    drawer_open(cal ? plain(cal.calendar.name) : 'Event', event_info_template({
        "title": plain(event_['name']),
        "synced": event_['sync_id'] != null,
        "id": event_["id"],
        "cal_color": cal ? cal.colour : '#039be5',
        "date": date_,
        "deadline": deadline,
        "allday": event_["allday"] == true,
        "calendar": cal ? plain(cal.calendar.name) : 'Unknown',
        "category": event_["category_name"] ? plain(event_["category_name"]) : (event_["category"] ? CATEGORY_LABELS[event_["category"]] : ""),
        "description": event_["description"] ? parse_message(event_["description"]) : "",
        "location": plain(value_or_empty(event_["location"])),
        "dev_info": localStorage.getItem('debug') == 1,
        "owner": cal && (cal.subscribe_type == 0 || cal.subscribe_type == 1),
        "recurring": !!event_['recurring'],
    }));
    enrich_event_details(event_);
}

// Details only the V2 event detail has (repeat rule text, reminders, place, link, tags, the task made from it).
function enrich_event_details(ev) {
    const box = document.querySelector('#cal-drawer .ei-extra');
    if (!box) return;
    event_detail(ev.id).then(det => {
        if (!box.isConnected) return;
        const row = (label, content) => {
            const r = document.createElement('div');
            r.className = 'cal-prop';
            const k = document.createElement('span');
            k.className = 'cal-prop-k';
            k.textContent = label;
            const v = document.createElement('span');
            v.className = 'cal-prop-v';
            v.append(...[].concat(content));
            r.append(k, v);
            return r;
        };
        const rows = [];
        if (det.recurrence_text) rows.push(row('Repeats', det.recurrence_text));
        if (det.place) rows.push(row('Place', plain(det.place.name)));
        if (det.meeting_url && /^https?:\/\//i.test(det.meeting_url)) {
            const a = document.createElement('a');
            a.href = det.meeting_url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = det.meeting_url.replace(/^https?:\/\//i, '').slice(0, 60);
            rows.push(row('Meeting', a));
        }
        if (det.reminders && det.reminders.length) rows.push(row('Reminders', det.reminders.map(rem_label).join(', ')));
        if (det.tags && det.tags.length) {
            rows.push(row('Tags', det.tags.map(t => { const c = document.createElement('span'); c.className = 'cal-tag'; c.textContent = plain(t); return c; })));
        }
        if (det.attendees && det.attendees.length) rows.push(row('People', det.attendees.map(a => plain(a.name || a.email)).join(', ')));
        if (det.visibility === 'private') rows.push(row('Visibility', 'Private'));
        if (det.status && det.status !== 'confirmed') rows.push(row('Status', det.status[0].toUpperCase() + det.status.slice(1)));
        box.replaceChildren(...rows);
        if (det.task_id) {
            const btn = document.querySelector('#cal-drawer .ei-add-task');
            if (btn) {
                const a = document.createElement('a');
                a.className = 'btn btn-sm btn-outline-secondary';
                a.href = `/tasks/?task=${encodeURIComponent(det.task_id)}`;
                a.textContent = 'In Tasks · Open';
                btn.replaceWith(a);
            }
        }
    }).catch(() => { });  // the basics are already shown
}

var no_invites = 0
var calendar_

function display_calendar_info(btn) {
    const sub = data["calendars"][btn.closest(".calendar-name-div").dataset.calendar];
    if (sub) open_calendar_settings(sub["calendar"]["id"]);
}

// Calendar colour (your colour for it, V2 PATCH) and, once the server supports it, its icon.
function setup_calendar_appearance(sub) {
    const calId = sub["calendar"]["id"];
    const colourPick = colour_picker({ name: `cal-colour-${calId}`, value: sub["colour"] || sub["calendar"]["colour"] });
    document.querySelector('.cal-appearance-colour').appendChild(colourPick.el);
    let iconPick = null;
    CAL_APPEARANCE_READY.then(() => {
        const box = document.querySelector('.cal-appearance-icon');
        if (!CAL_APPEARANCE || !box) return;
        iconPick = icon_picker({ name: `cal-icon-${calId}`, value: sub["calendar"]["icon"] || '', colour: colourPick.get() });
        box.appendChild(iconPick.el);
        document.querySelector('.cal-appearance-icon-field').hidden = false;
        colourPick.el.addEventListener('change', () => iconPick.setColour(colourPick.get()));
    });
    const msg = document.querySelector('.cal-appearance-msg');
    document.querySelector('.cal-appearance-save').addEventListener('click', (e) => {
        const body = { colour: colourPick.get() };
        if (!body.colour) { msg.textContent = 'Pick a colour.'; return; }
        if (iconPick) body.icon = iconPick.get();
        e.currentTarget.disabled = true;
        const btn = e.currentTarget;
        fetch(`/api/v2/calendar/calendars/${encodeURIComponent(calId)}`, {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() }, body: JSON.stringify(body),
        }).then(r => {
            if (!r.ok) throw new Error(r.status);
            msg.textContent = 'Saved';
            populate_calendar(m, y, true);
        }).catch(() => { msg.textContent = "Couldn't save."; }).finally(() => { btn.disabled = false; });
    });
}

function sync_events(btn) {
    cal = data["calendars"][btn.closest(".calendar-name-div").dataset.calendar]

    $('.modal-title').text(`Sync Events for ${plain(cal["calendar"]["name"])}`)
    if (cal["subscribe_type"] == 0 || cal["subscribe_type"] == 1) {
        $('.modal-body').html(calendar_sync_template())

        firstms = true
        document.querySelectorAll('.month-select').forEach(e => {
            for (i = 0; i < months.length; i++) {
                e.innerHTML += `<option value="${i}">${months[i]}</option>`
            }

            today = new Date();
            if (firstms) {
                e.value = today.getMonth();
                firstms = false;
            }
            else {
                e.value = (today.getMonth() + 1) % 12;
            }
        })
        document.querySelectorAll('.year-select').forEach(e => {
            e.innerHTML = generate_year_range(currentYear - 5, currentYear + 5);
            e.value = new Date().getFullYear();
        })

        $('.calendar-sync-btn').click(function () {
            result = {
                "calendar": cal["calendar"]["id"],
                "sy": parseInt($('.calendar-sync-start-year').val()),
                "sm": parseInt($('.calendar-sync-start-month').val()) + 1,
                "ey": parseInt($('.calendar-sync-end-year').val()),
                "em": parseInt($('.calendar-sync-end-month').val()) + 1,
            }
            st = $('#calendar-sync-token').val();
            if (st != "") { result["token"] = st }

            var r = new XMLHttpRequest()
            r.open('POST', URLS['sync_events'])
            r.setRequestHeader("X-CSRFToken", csrfToken())
            r.onload = () => {
                res = JSON.parse(r.responseText)
                if (res['status'] == 'success') {
                    $('.btn-close').click();
                    populate_calendar(m, y, true);
                }
                else {
                    alert(res['data']);
                }
            }
            r.send(JSON.stringify(result))
        })

        $('.calendar-sync-term-btn').click(function () {
            today = new Date();
            if ([8, 9, 10, 11].includes(today.getMonth())) {
                document.querySelector('.calendar-sync-start-month').value = today.getMonth();
                document.querySelector('.calendar-sync-start-year').value = today.getFullYear();
                document.querySelector('.calendar-sync-end-month').value = 0;
                document.querySelector('.calendar-sync-end-year').value = today.getFullYear() + 1;
            }
            else if ([0, 1, 2, 3].includes(today.getMonth())) {
                document.querySelector('.calendar-sync-start-month').value = today.getMonth();
                document.querySelector('.calendar-sync-start-year').value = today.getFullYear();
                document.querySelector('.calendar-sync-end-month').value = 4;
                document.querySelector('.calendar-sync-end-year').value = today.getFullYear();
            }
            else {
                document.querySelector('.calendar-sync-start-month').value = today.getMonth();
                document.querySelector('.calendar-sync-start-year').value = today.getFullYear();
                document.querySelector('.calendar-sync-end-month').value = 9;
                document.querySelector('.calendar-sync-end-year').value = today.getFullYear();
            }
        })

        $('.calendar-sync-term-full-btn').click(function () {
            today = new Date();
            if ([8, 9, 10, 11].includes(today.getMonth())) {
                document.querySelector('.calendar-sync-start-month').value = 8;
                document.querySelector('.calendar-sync-start-year').value = today.getFullYear();
                document.querySelector('.calendar-sync-end-month').value = 0;
                document.querySelector('.calendar-sync-end-year').value = today.getFullYear() + 1;
            }
            else if ([0, 1, 2, 3].includes(today.getMonth())) {
                document.querySelector('.calendar-sync-start-month').value = 0;
                document.querySelector('.calendar-sync-start-year').value = today.getFullYear();
                document.querySelector('.calendar-sync-end-month').value = 4;
                document.querySelector('.calendar-sync-end-year').value = today.getFullYear();
            }
            else {
                document.querySelector('.calendar-sync-start-month').value = 4;
                document.querySelector('.calendar-sync-start-year').value = today.getFullYear();
                document.querySelector('.calendar-sync-end-month').value = 9;
                document.querySelector('.calendar-sync-end-year').value = today.getFullYear();
            }
        })
    }
    else {
        $('.modal-body').html("Only calendar owners and admins can sync it.")
    }
}

function unsubscribe(btn) {
    cal = data["calendars"][btn.closest(".calendar-name-div").dataset.calendar]
    var r = new XMLHttpRequest()
    r.open('POST', `${URLS['unsubscribe']}?calendar=${cal["calendar"]["id"]}`)
    r.setRequestHeader("X-CSRFToken", csrfToken())
    r.onload = () => {
        res = JSON.parse(r.responseText)
        if (res["status"] === "success") {
            populate_calendar(m, y, true);
        }
        else {
            alert(res["data"])
        }
    }
    r.send()
}

function create_invite(c) {
    var r = new XMLHttpRequest();
    r.open('POST', `${URLS['invite']}?code=${encodeURIComponent(document.querySelector('.invite-text').value)}&calendar=${c["id"]}&option=create`);
    r.setRequestHeader("X-CSRFToken", csrfToken());
    r.onload = () => {
        res = JSON.parse(r.responseText);
        if (res["status"] === "error") { $('.invite-warn').text(res["data"]); }
        else {
            no_invites++;
            document.querySelector('.invite-list').innerHTML += calendar_invite({ "invite_no": no_invites, "invite": res["data"]["id"], "calendar_id": c["id"], "checked": "checked", "invite_name": res["data"]["code"] });
            document.querySelector('.invite-text').value = "";
        }
    }
    r.send();
}

function toggle_invite(cb) {
    var r = new XMLHttpRequest()
    r.open('POST', `${URLS['invite']}?invite=${encodeURIComponent(cb.dataset.invite)}&option=active`)
    r.setRequestHeader("X-CSRFToken", csrfToken())
    r.onload = () => {
        res = JSON.parse(r.responseText)
        if (res["status"] === "error") { alert(res["data"]); cb.checked = !cb.checked }
        else { cb.checked = res["data"]["active"] }
        cb.disabled = false
    }
    r.send()
}

function toggle_calendar_enable(e) {
    r = new XMLHttpRequest();
    r.open('POST', `${URLS['calendar']}?id=${e.dataset.calendar}&command=active`);
    r.setRequestHeader("X-CSRFToken", csrfToken());
    r.onload = () => {
        $('#big-modal').modal("hide");
        populate_calendar(m, y, true);
    }
    r.send();
}

function can_edit_event(ev) {
    const cal = ev && calendars[ev["calendar"]];
    return !!cal && (cal["subscribe_type"] == 0 || cal["subscribe_type"] == 1);
}

// Delete (V2). A repeating event asks which occurrences: this one, this and following, or all.
function delete_event(ev, scope = null) {
    if (!can_edit_event(ev)) return;
    if (ev['recurring'] && !scope) {
        const box = document.querySelector('#cal-drawer .ei-actions');
        if (!box || box.querySelector('.ei-scope')) return;
        const row = document.createElement('div');
        row.className = 'ei-scope';
        row.append('Delete:');
        for (const [sc, label] of [['this', 'This event'], ['following', 'This and following'], ['all', 'All events']]) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-sm btn-outline-danger';
            b.textContent = label;
            b.addEventListener('click', () => delete_event(ev, sc));
            row.appendChild(b);
        }
        box.appendChild(row);
        row.querySelector('button').focus();
        return;
    }
    if (!scope && !confirm(`Delete "${plain(ev['name'])}"?`)) return;
    v2('DELETE', `/api/v2/calendar/events/${encodeURIComponent(ev['id'])}${scope ? `?scope=${scope}` : ''}`).then(() => {
        drawer_close();
        toast('Event deleted');
        _detailCache.clear();
        if (scope) { populate_calendar(m, y, true); return; }  // other occurrences change too
        const drop = (list) => { const i = list.findIndex(e => e.id === ev.id); if (i !== -1) list.splice(i, 1); };
        drop(data['events']);
        for (const c of Object.values(_monthCache)) if (c.data && c.data !== data) drop(c.data.events);
        after_local_change();
    }).catch(err => toast(err.message || "Couldn't delete the event.", true));
}

function duplicate_event(ev) {
    if (!can_edit_event(ev)) return;
    const days = parseInt($('#evDupDays').val());
    if (!Number.isInteger(days) || Math.abs(days) > 3650) { toast("Enter a whole number of days (up to 3650).", true); return; }
    v2('POST', `/api/v2/calendar/events/${encodeURIComponent(ev['id'])}/duplicate?days=${days}`).then(() => {
        drawer_close();
        toast(`Duplicated ${days} day${Math.abs(days) === 1 ? '' : 's'} later`);
        populate_calendar(m, y, true);
    }).catch(err => toast(err.message || "Couldn't duplicate the event.", true));
}

function view_day_images(date) {
    $('.modal-title').html(`Images for ${date}-${m + 1}-${y}`)
    $('.modal-body').html(`<iframe class="cal-photos-frame" title="Photos" src="${window.origin}/photos/day/${y}/${m + 1}/${encodeURIComponent(date)}/">`)
}

function view_event_images(evt) {
    $('.modal-title').text(`Images for ${plain(evt['name'])}`)
    $('.modal-body').html(`<iframe class="cal-photos-frame" title="Photos" src="${window.origin}/photos/event/${encodeURIComponent(evt['id'])}/">`)
}

function randomText(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function convertUTCDateToLocalDate(date) {
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date;
}

function getEasternDateParts(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Canada/Eastern',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });
    const parts = formatter.formatToParts(date);
    const result = {};
    for (const part of parts) {
        result[part.type] = parseInt(part.value, 10);
    }
    return result;
}

function roundDate(date = new Date(), mins) {
    ms = 1000 * 60 * mins;
    nd = new Date(Math.ceil(date.getTime() / ms) * ms);
    return nd
}

function parse_message(text) {
    if (!text) return "";

    // If text does not contain HTML tags, convert newlines to <br>
    const hasBlockHtml = /<\s*(p|div|ul|ol|li|table|br|h[1-6]|a)\b/i.test(text);
    let htmlContent = hasBlockHtml ? text : text.replace(/\r?\n/g, '<br>');

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        // Traverse all text nodes that are NOT inside an <a> tag
        const walker = doc.createTreeWalker(
            doc.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    let parent = node.parentElement;
                    while (parent && parent !== doc.body) {
                        if (parent.tagName.toLowerCase() === 'a') {
                            return NodeFilter.FILTER_REJECT;
                        }
                        parent = parent.parentElement;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const nodesToReplace = [];
        const urlRegex = /(https?:\/\/[^\s<>"'`]+)/g;

        let currentNode;
        while ((currentNode = walker.nextNode())) {
            if (urlRegex.test(currentNode.nodeValue)) {
                nodesToReplace.push(currentNode);
            }
            urlRegex.lastIndex = 0;
        }

        for (let i = 0; i < nodesToReplace.length; i++) {
            const node = nodesToReplace[i];
            const val = node.nodeValue;
            const parent = node.parentNode;
            if (!parent) continue;

            const frag = doc.createDocumentFragment();
            let lastIdx = 0;
            let match;
            urlRegex.lastIndex = 0;

            while ((match = urlRegex.exec(val)) !== null) {
                if (match.index > lastIdx) {
                    frag.appendChild(doc.createTextNode(val.substring(lastIdx, match.index)));
                }

                let url = match[0];
                let trailing = "";
                const punctMatch = url.match(/[.,;:!?)]+$/);
                if (punctMatch) {
                    const openCount = (url.slice(0, -punctMatch[0].length).match(/\(/g) || []).length;
                    const closeCount = (url.slice(0, -punctMatch[0].length).match(/\)/g) || []).length;
                    if (openCount === closeCount) {
                        trailing = punctMatch[0];
                        url = url.slice(0, -trailing.length);
                    }
                }

                const a = doc.createElement('a');
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = url;
                frag.appendChild(a);

                if (trailing) {
                    frag.appendChild(doc.createTextNode(trailing));
                }

                lastIdx = match.index + match[0].length;
            }

            if (lastIdx < val.length) {
                frag.appendChild(doc.createTextNode(val.substring(lastIdx)));
            }

            parent.replaceChild(frag, node);
        }

        // Ensure all existing or newly created <a> tags open safely in a new tab
        const allLinks = doc.body.querySelectorAll('a');
        for (let j = 0; j < allLinks.length; j++) {
            if (!allLinks[j].getAttribute('target')) allLinks[j].setAttribute('target', '_blank');
            if (!allLinks[j].getAttribute('rel')) allLinks[j].setAttribute('rel', 'noopener noreferrer');
        }

        return doc.body.innerHTML;
    } catch (e) {
        console.error("Error in parse_message:", e);
        return text;
    }
}


function value_or_empty(str) {
    if (str == null) {
        return "";
    }
    return str;
}

// Show one of the right-sidebar widgets (expands it / switches to its tab). See widgets.js.
function show_in_sidebar(opt) {
    const id = { '.sb-todos': 'tasks', '.sb-upcoming': 'upcoming', '.sb-insight': 'insight' }[opt] || opt;
    if (window.CalWidgets) window.CalWidgets.reveal(id);
}

function hide_loading() {
    document.querySelector('.loading-screen').style.display = "none";
}

// ===== View Switching =====
function switch_view(view) {
    if (!['month', 'week', 'day'].includes(view)) view = 'month';
    currentView = view;
    localStorage.setItem('calendar_view', view);

    document.querySelector('.view-month').hidden = view !== 'month';
    document.querySelector('.view-week').hidden = view !== 'week';
    document.querySelector('.view-day').hidden = view !== 'day';
    document.querySelectorAll('.cal-views [data-view]').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view ? 'true' : 'false'));

    if (view === 'month') {
        // Already populated by month
        collapse_overflowing_events();
    } else if (view === 'week') {
        renderWeekView();
    } else if (view === 'day') {
        renderDayView();
    }
    set_title();
}

// Toolbar title: "November 2026", "Nov 1 – 7, 2026" or "Thursday, November 5, 2026".
function set_title() {
    const el = document.getElementById('monthAndYear');
    if (currentView === 'day') { el.textContent = moment(currentDayDate).format('dddd, MMMM D, YYYY'); }
    else if (currentView === 'week') {
        const s0 = new Date(currentDayDate); s0.setDate(s0.getDate() - s0.getDay());
        const e0 = new Date(s0); e0.setDate(e0.getDate() + 6);
        const sm = moment(s0), em = moment(e0);
        el.textContent = s0.getFullYear() !== e0.getFullYear() ? `${sm.format('MMM D, YYYY')} – ${em.format('MMM D, YYYY')}`
            : s0.getMonth() !== e0.getMonth() ? `${sm.format('MMM D')} – ${em.format('MMM D, YYYY')}` : `${sm.format('MMMM D')} – ${em.format('D, YYYY')}`;
    }
    else { el.textContent = `${months[m]} ${y}`; }
    document.dispatchEvent(new CustomEvent('calendar:view', { detail: { view: currentView, date: new Date(currentDayDate) } }));
}

// Jump to a date (mini calendar, search): month view shows its month, week/day views its week/day.
function go_to_date(date) {
    currentDayDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (currentView === 'month' && (date.getMonth() !== m || date.getFullYear() !== y)) {
        goto_month(date.getMonth(), date.getFullYear());
        set_title();
        return;
    }
    _syncMonthFromDate(currentDayDate);
    set_title();
}

// Re-renders (e.g. the once-a-minute refresh) keep the grid where the user scrolled it.
function _keepScroll(container, key) {
    const sc = container.querySelector('.cv-scroll');
    const keep = sc && container.dataset.viewKey === key ? sc.scrollTop : null;
    container.dataset.viewKey = key;
    return () => {
        if (keep === null) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const now = container.querySelector('.cv-scroll');
            if (now) now.scrollTop = keep;
        }));
    };
}

function renderDayView() {
    if (!data) return;
    const container = document.querySelector('.view-day');
    const restore = _keepScroll(container, currentDayDate.toDateString());
    if (_mainDayView) _mainDayView.destroy();

    _mainDayView = new CalendarDayView(container, {
        hourHeight: 60,
        onEventClick: _handleMainEventClick,
        onSlotClick: _handleMainSlotClick,
        onDragCreate: _handleDragCreate,
    });

    const day = items_for_day(currentDayDate);
    _mainDayView.render(currentDayDate, day.timed, day.allDay, calendars);
    restore();

    // Photo count badge
    if (currentDayDate.getMonth() === m && currentDayDate.getFullYear() === y) _addPhotoBadge(container, currentDayDate.getDate());
}

function renderWeekView() {
    if (!data) return;
    const container = document.querySelector('.view-week');

    // Compute week start (Sunday) from currentDayDate
    const ws = new Date(currentDayDate);
    ws.setDate(ws.getDate() - ws.getDay());
    ws.setHours(0, 0, 0, 0);
    currentWeekStart = ws;
    const dates = [];
    for (let i = 0; i < 7; i++) { const d = new Date(ws); d.setDate(d.getDate() + i); dates.push(d); }

    // A week that crosses into another month needs that month's events too.
    ensure_months(dates);

    const restore = _keepScroll(container, ws.toDateString());
    if (_mainWeekView) _mainWeekView.destroy();
    _mainWeekView = new CalendarWeekView(container, {
        hourHeight: 60,
        onEventClick: _handleMainEventClick,
        onSlotClick: _handleMainSlotClick,
        onDragCreate: _handleDragCreate,
    });

    const all = loaded_events();
    const eventsByDay = {};
    dates.forEach((d, i) => { const day = items_for_day(d, all); eventsByDay[i] = { timed: day.timed, allDay: day.allDay }; });

    _mainWeekView.render(ws, eventsByDay, calendars);
    restore();
    // Day names in the header open that day.
    container.querySelectorAll('.cv-week-header-day').forEach((dh, i) => {
        dh.tabIndex = 0;
        dh.setAttribute('role', 'button');
        dh.setAttribute('aria-label', `Open ${moment(dates[i]).format('dddd, MMMM D')}`);
        const go = () => { currentDayDate = new Date(dates[i]); switch_view('day'); _syncMonthFromDate(currentDayDate); };
        dh.addEventListener('click', go);
        dh.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });

    // Photo count badges for week view
    const cols = container.querySelectorAll('.cv-day-col');
    dates.forEach((d, i) => {
        if (d.getMonth() === m && d.getFullYear() === y && cols[i]) _addPhotoBadgeToCol(cols[i], d.getDate());
    });
}

function _addPhotoBadge(container, dayNum) {
    if (!data || !data.photos) return;
    const count = data.photos[dayNum];
    if (!count || count === '-' || count === 0) return;
    const col = container.querySelector('.cv-day-col');
    if (col) _addPhotoBadgeToCol(col, dayNum);
}

function _addPhotoBadgeToCol(col, dayNum) {
    if (!data || !data.photos) return;
    const count = data.photos[dayNum];
    if (!count || count === '-' || count === 0) return;
    const badge = document.createElement('div');
    badge.className = 'cv-photo-badge';
    badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 6.827 3h2.344a1 1 0 0 1 .707.293l.828.828A3 3 0 0 0 12.828 5H14a1 1 0 0 1 1 1v6z"/><path d="M8 11a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>${count}`;
    col.appendChild(badge);
}

function _handleMainEventClick(ev) {
    open_event(ev);
}

function _handleMainSlotClick(date, hour, minute) {
    add_edit_event(date.getDate(), date.getMonth() + 1, date.getFullYear());
}

function _handleDragCreate(date, startHour, startMin, endHour, endMin) {
    add_edit_event(date.getDate(), date.getMonth() + 1, date.getFullYear());
    {
        const sTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
        const eTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
        // Switch to timed event type
        const evtBtn = document.querySelector('.event-type-btn-event');
        if (evtBtn) evtBtn.click();
        document.querySelectorAll('.event-time-start').forEach(e => e.value = sTime);
        document.querySelectorAll('.event-time-end-event').forEach(e => e.value = eTime);
    }
}

// After data loads, re-render current view
function _afterDataLoad() {
    if (currentView === 'week') renderWeekView();
    else if (currentView === 'day') renderDayView();
}

function go_prev() {
    if (currentView === 'month') {
        m -= 1;
        if (m == -1) { m = 11; y -= 1; }
        previous();
        make_holidays_red();
        populate_calendar(m, y);
    } else if (currentView === 'week') {
        currentDayDate.setDate(currentDayDate.getDate() - 7);
        _syncMonthFromDate(currentDayDate);
    } else if (currentView === 'day') {
        currentDayDate.setDate(currentDayDate.getDate() - 1);
        _syncMonthFromDate(currentDayDate);
    }
}

function go_next() {
    if (currentView === 'month') {
        m += 1;
        if (m == 12) { m = 0; y += 1; }
        next();
        make_holidays_red();
        populate_calendar(m, y);
    } else if (currentView === 'week') {
        currentDayDate.setDate(currentDayDate.getDate() + 7);
        _syncMonthFromDate(currentDayDate);
    } else if (currentView === 'day') {
        currentDayDate.setDate(currentDayDate.getDate() + 1);
        _syncMonthFromDate(currentDayDate);
    }
}

function _syncMonthFromDate(date) {
    setTimeout(set_title, 0);
    const newM = date.getMonth();
    const newY = date.getFullYear();
    if (newM !== m || newY !== y) {
        m = newM;
        y = newY;
        $('#month').val(m);
        $('#year').val(y);
        showCalendar(m, y);
        make_holidays_red();
        populate_calendar(m, y);
    } else {
        if (currentView === 'week') renderWeekView();
        else if (currentView === 'day') renderDayView();
    }
}

function jump_() {
    jump()
    make_holidays_red()
    m = parseInt($("#month").val())
    y = parseInt($("#year").val())
    populate_calendar(m, y)
}


function reload() {
    jump()
    make_holidays_red()
    m = parseInt($("#month").val())
    y = parseInt($("#year").val())
}

function today_() {
    const d = new Date();
    currentDayDate = new Date();
    const mm = d.getMonth();
    const yy = d.getFullYear();
    if (m !== mm || y !== yy) {
        m = mm; y = yy;
        $('#month').val(mm);
        $('#year').val(yy);
        jump_();
    } else {
        if (currentView === 'week') renderWeekView();
        else if (currentView === 'day') renderDayView();
        set_title();
    }
}

document.onkeydown = function (e) {
    if (e.ctrlKey) {
        if (document.getElementById('modal').classList.contains('show') == false && document.getElementById('big-modal').classList.contains('show') == false) {
            if (e.shiftKey) {
                if (e.key == 'ArrowLeft') {
                    e.preventDefault();
                    $("#year").val(parseInt($("#year").val()) - 1);
                    jump_();
                }
                else if (e.key == 'ArrowRight') {
                    e.preventDefault();
                    $("#year").val(parseInt($("#year").val()) + 1);
                    jump_();
                }
                else if (e.key == '.') {
                    e.preventDefault();
                    $('.create-btn').click();
                }
            }
            else {
                if (e.key == 'ArrowLeft') {
                    e.preventDefault();
                    go_prev();
                }
                else if (e.key == 'ArrowRight') {
                    e.preventDefault();
                    go_next();
                }
                else if (e.key == '.') {
                    e.preventDefault();
                    const d__ = new Date();
                    add_edit_event(d__.getDate(), d__.getMonth() + 1, d__.getFullYear());
                }
            }
        }
    }

    // ===== Plain-key shortcuts (no modifier, no modal, no text input focused). Same keys as
    // Google Calendar, plus the Tasks app's / ? q [ ] and Esc.
    const tag = document.activeElement ? document.activeElement.tagName : '';
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement.isContentEditable;
    const modalOpen = document.getElementById('modal').classList.contains('show') || document.getElementById('big-modal').classList.contains('show') || !!document.querySelector('dialog[open]');

    if (e.key === 'Escape' && drawer_is_open() && !modalOpen && !e.defaultPrevented) {
        e.preventDefault();
        drawer_close();
        return;
    }

    if (!e.ctrlKey && !e.altKey && !e.metaKey && !isTyping && !modalOpen) {
        const k = e.key.toLowerCase();

        if (k === 'd') { e.preventDefault(); switch_view('day'); }
        else if (k === 'w') { e.preventDefault(); switch_view('week'); }
        else if (k === 'm') { e.preventDefault(); switch_view('month'); }
        else if (k === 't') { e.preventDefault(); today_(); }
        else if (k === 'a') {
            // All-day event for today
            e.preventDefault();
            const now = new Date();
            add_edit_event(now.getDate(), now.getMonth() + 1, now.getFullYear());
            document.querySelector('.event-type-btn-ade')?.click();
        }
        else if (k === 'c') {
            // Timed event starting at the next 15-minute mark, 1 hour long
            e.preventDefault();
            const start = new Date();
            start.setSeconds(0, 0);
            start.setMinutes(Math.floor(start.getMinutes() / 15) * 15 + 15);
            const end = new Date(start.getTime() + 60 * 60000);
            add_edit_event(start.getDate(), start.getMonth() + 1, start.getFullYear());
            const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            document.querySelector('.event-type-btn-event')?.click();
            document.querySelectorAll('.event-date-start-event').forEach(el => el.value = ymd(start));
            document.querySelectorAll('.event-time-start-event').forEach(el => el.value = hhmm(start));
            document.querySelectorAll('.event-date-end-event').forEach(el => el.value = ymd(end));
            document.querySelectorAll('.event-time-end-event').forEach(el => el.value = hhmm(end));
        }
        else if (k === '.' || k === 'n' || k === 'j') { e.preventDefault(); go_next(); }
        else if (k === ',' || k === 'p' || k === 'k') { e.preventDefault(); go_prev(); }
        else if (k === 's') {
            e.preventDefault();
            create_calendar();
            $('#modal').modal('show');
        }
        else if (k === '/') { e.preventDefault(); document.getElementById('cal-q')?.focus(); }
        else if (k === '?') { e.preventDefault(); document.dispatchEvent(new CustomEvent('calendar:help')); }
        else if (k === 'q') {
            e.preventDefault();
            if (!right_sb) { right_sb = true; updateSidebars(left_sb, right_sb); }
            show_in_sidebar('.sb-todos');
            document.getElementById('todo-quick-input').focus();
        }
        else if (k === '[') { e.preventDefault(); toggleLeftSidebar(); }
        else if (k === ']') { e.preventDefault(); toggleRightSidebar(); }
    }

    if (e.key == 'Escape' && !document.querySelector('.command-block').hidden) {
        e.preventDefault();
        document.querySelector('.command-block').hidden = true;
    }

    if (e.altKey) {
        if (e.key == 'e') {
            e.preventDefault();
            localStorage.setItem('calendar_extra', prompt("Enter extra calendar code"));
            jump_();
        }
        else if (e.key == 'c') {
            e.preventDefault();
            document.querySelector('.command-block').hidden = false;
            document.querySelector('.command-block').querySelector('.form-control').focus();
        }
    }
}
