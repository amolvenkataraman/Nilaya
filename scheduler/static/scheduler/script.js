// Comptech Calendar (Docket) main script
// (c) Amol Venkataraman 2019 - 2023

// Handlebars Templates
// =======================================================================================================================================================================
const calendar_item = Handlebars.compile(`
    <div class="event-button" data-calendar="{{ calendar }}" data-no="{{ i }}" data-type = "{{ type }}" {{#if modal}}data-bs-toggle="modal" data-bs-target="#modal" {{/if}}style="font-size: 12px; color: {{ color }}; background-color: {{ bg_color }}; border-radius: {{ bo_radius }}; margin-bottom: 2px; @media print { color: {{ color }}; }" {{#if modal}}onclick="display_info(this)"{{/if}}><span class="event-icon">{{{ icon }}}</span>{{#if del}}<del>{{/if}}{{{ text }}}{{#if del}}</div>{{/if}}</div>
`);

const todo_item = Handlebars.compile(`  
    <div class="card mb-1">
        <div class="card-body" data-todo-id="{{ id }}" style="padding: 8px;">
            <span class="card-title">
                <span>
                    <span class="text-success" style="cursor: pointer;" onclick="complete_todo('{{ i }}');">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check2-square" viewBox="0 0 16 16">
                            <path d="M3 14.5A1.5 1.5 0 0 1 1.5 13V3A1.5 1.5 0 0 1 3 1.5h8a.5.5 0 0 1 0 1H3a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V8a.5.5 0 0 1 1 0v5a1.5 1.5 0 0 1-1.5 1.5H3z"/>
                            <path d="m8.354 10.354 7-7a.5.5 0 0 0-.708-.708L8 9.293 5.354 6.646a.5.5 0 1 0-.708.708l3 3a.5.5 0 0 0 .708 0z"/>
                        </svg>
                    </span>
                    <span class="text-info" style="cursor: pointer;" data-bs-toggle="modal" data-bs-target="#modal" onclick="add_edit_todo(command='edit', edit_todo={{ i }});">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil" viewBox="0 0 16 16">
                            <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                        </svg>
                    </span>
                    <span class="text-danger" style="cursor: pointer;" onclick="delete_todo('{{ i }}');">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </span>

                </span>
                <span>{{{ name }}}</span>
            </span>
        </div>
    </div>
`);

const calendar_name = Handlebars.compile(`
    <div class="custom-control custom-checkbox calendar-name-div" data-calendar="{{ calendar }}" data-calendar-type="{{ calendar_type }}">
        <input type="checkbox" class="form-check-input" id="{{ name }}" {{ checked }} onchange="toggle_calendar_visibility(this, false)" style="opacity: {{ opacity }};">
        <label class="custom-control-label calendar-name-label" for="{{ name }}" style="color: {{ colour }}; opacity: {{ opacity }};">{{#if admin}}<em>{{/if}}{{ name }}{{#if admin}}</em>{{/if}}</label>
        <button class="btn btn-white calendar-options-btn"
            type="button" id="dropdownMenu{{ id }}" data-bs-toggle="dropdown"
            aria-haspopup="true" aria-expanded="false" aria-label="Calendar options">
            <svg width="1em" height="1em" viewBox="0 0 16 16" class="bi bi-three-dots-vertical" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
            </svg>
        </button>
        <div class="dropdown-menu" aria-labelledby="dropdownMenu{{ id }}" style="opacity: 1;">
            <a class="dropdown-item" href="#!" onclick="toggle_calendar_visibility(this, true)">Display this only</a>
            {{#if owner}}
            <a class="dropdown-item" href="#!" data-bs-toggle="modal" data-bs-target="#big-modal" onclick="display_calendar_info(this)">Settings</a>
            {{#if sync}}
            <a class="dropdown-item" href="#!" data-bs-toggle="modal" data-bs-target="#modal" onclick="sync_events(this)">Sync Events</a>
            {{/if}}
            {{/if}}
            {{#if c_owner}}
            <a class="dropdown-item" href="#!" data-bs-toggle="modal" data-bs-target="#modal" onclick="sync_events(this)">Configure</a>
            {{else}}
            <a class="dropdown-item" href="#!" onclick="unsubscribe(this)">Unsubscribe</a>
            {{/if}}
        </div>
    </div>
`);

const calendar_create_form = Handlebars.compile(`
    Subscribe to a calendar:
    <div class="input-group">
        <input type="text" class="form-control subscribe-code" placeholder="Code" aria-label="" aria-describedby="Code">
        <div class="input-group-append">
            <button class="btn btn-primary subscribe-btn" type="button">Subscribe</button>
        </div>
    </div>
    <p class="text-danger subscribe-warn"></p>
    <hr>
    Create a Calendar
    <div class="input-group">
        <input type="text" class="form-control calendar-name" id="calendar-name" type="text" placeholder="Name of calendar">
        <div class="input-group-append">
            <input type="color" class="form-control form-control-color calendar-color" id="exampleColorInput" value="#000000" title="Choose the calendar color" style="width: 50px;">
        </div>
        <div class="input-group-append">
            <button class="btn btn-primary calendar-submit" type="submit">Create</button>
        </div>
    </div>
    <p class="text-danger calendar-warn"></p>
`);

const subscribe_confirm = Handlebars.compile(`
    <center><h4>Subscribe?</h4></center>
    <p>Calendar name: {{ name }}</p>
    <p>Owner: {{ owner }}</p>
    <button type="submit" class="btn btn-success subscribe-confirm-btn" style="width: 100%;">Subscribe</button>
    <br><br>
    <button type="submit" class="btn btn-danger" style="width: 100%;" data-bs-dismiss="modal">Don't Subscribe</button>
`);

const calendar_info_template = Handlebars.compile(`
    <div class="row" style="width: 100%;">
        <div class="col">
            <div class="card">
                <div class="card-body">
                    <h4 class="card-title">Subscribers</h4>
                    <p class="card-text">
                        <ul class='subscriber-list list-unstyled'></ul>
                    </p>
                </div>
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
        <div class="col">
            <div class="card">
                <div class="card-body">
                    <h4 class="card-title">Invites</h4>
                    <h6 class="card-subtitle mb-2 text-muted">Click on the checkbox to enable/disable the invite</h6>
                    <p class="card-text">
                        <ul class='invite-list list-unstyled'></ul>
                        <div class="invite-create-form">
                            <div class="input-group input-group-sm">
                                <div class="input-group-prepend" data-bs-toggle="tooltip" data-placement="bottom" title="Random Invite">
                                    <button class="btn btn-primary random-invite" id="inputGroup-sizing-sm" style="padding: 4px 12px 4px 12px;">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-shuffle" viewBox="0 0 16 16">
                                            <path fill-rule="evenodd" d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.624 9.624 0 0 0 7.556 8a9.624 9.624 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.595 10.595 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.624 9.624 0 0 0 6.444 8a9.624 9.624 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5z"></path>
                                            <path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192zm0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192z"></path>
                                        </svg>
                                    </button>
                                </div>
                                <input class="form-control invite-text" type="text" placeholder="Invite" aria-label="Small" aria-describedby="inputGroup-sizing-sm">
                                <div class="input-group-append" data-bs-toggle="tooltip" data-placement="bottom" title="Create Invite">
                                    <button class="btn btn-primary create-invite" id="inputGroup-sizing-sm" style="padding: 4px 12px 4px 12px;">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check2" viewBox="0 0 16 16">
                                            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <p class="text-danger invite-warn"></p>
                        </div>
                    </p>
                </div>
            </div>
        </div>
    </div>
    <div>
    <button type="button" class="btn btn-primary toggle-calendar-activation-btn" onclick="toggle_calendar_enable(this);">Toggle Activation</button>
    </div>
    <script>
        //$(function(){
        //    $('[data-bs-toggle="tooltip"]').tooltip();
        //});
    </script>
`);

const calendar_invite = Handlebars.compile(`
    <li>
        <div class="custom-control custom-checkbox">
            <input type="checkbox" class="custom-control-input" id="customCheck{{ invite_no }}" data-invite="{{ invite }}" data-calendar="{{ calendar_id }}" {{ checked }} onclick="this.disabled=true;toggle_invite(this);">
            <label class="custom-control-label invite-label" for="customCheck{{ invite_no }}">{{ invite_name }}</label>
        </div>
    </li>
`);

const calendar_sync_template = Handlebars.compile(`
    <div class="calendar-sync-dates">
        Start:
        <div class="input-group mb-3">
            <select class="form-control month-select calendar-sync-start-month"></select>
            <select class="form-control year-select calendar-sync-start-year"></select>
        </div>
        End:
        <div class="input-group mb-3">
            <select class="form-control month-select calendar-sync-end-month"></select>
            <select class="form-control year-select calendar-sync-end-year"></select>
        </div>
    </div>
    <div class="mb-3">
        <label for="calendar-sync-token">Access Token (Optional):</label>
        <input type="text" class="form-control" id="calendar-sync-token">
    </div>
        <div class="d-grid gap-2 d-md-flex justify-content-md-end">
        <div>
            <button class="btn btn-primary calendar-sync-term-btn">T</button>
            <button class="btn btn-primary calendar-sync-term-full-btn">TF</button>
            <button class="btn btn-primary calendar-sync-btn">Sync</button>
        <div>
    </div>
`);

const event_info_template = Handlebars.compile(`
    <div class="ei-card">
        <div class="ei-header" style="margin-bottom: 8px;">
            <div class="ei-color-dot" style="background:{{ cal_color }};"></div>
            <div style="font-size: 13px; font-weight: 600; color: #5f6368;">{{ calendar }}</div>
        </div>
        <div class="ei-meta">
            <div class="ei-meta-row">
                <div class="ei-meta-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/></svg>
                </div>
                <div class="ei-meta-text">{{ date }}</div>
            </div>
            {{#if show_location}}
            <div class="ei-meta-row">
                <div class="ei-meta-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
                </div>
                <div class="ei-meta-text">{{ location }}</div>
            </div>
            {{/if}}
        </div>
        {{#if show_desc}}
        <div class="ei-desc-block">{{{ description }}}</div>
        {{/if}}
        <div class="ei-countdown">{{{ countdown }}}</div>
        {{{ dev_info }}}
        {{#if owner}}
        <div class="ei-actions">
            <button type="button" class="btn btn-outline-warning btn-sm" onclick="$('#modal').modal('hide'); $('#big-modal').modal('show'); add_edit_event(1, m+1, y, command='edit', edit_event=data['events']['{{ event_no }}'])">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10z"/></svg>
                Edit
            </button>
            <button type="button" class="btn btn-outline-danger btn-sm" onclick="delete_event('{{ event_no }}')">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                Delete
            </button>
            <button type="button" class="btn btn-outline-primary btn-sm" onclick="$('#modal').modal('hide'); $('#big-modal').modal('show'); view_event_images(data['events']['{{ event_no }}'])">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 6.827 3h2.344a1 1 0 0 1 .707.293l.828.828A3 3 0 0 0 12.828 5H14a1 1 0 0 1 1 1v6zM2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2z"/><path d="M8 11a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm0 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 6.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/></svg>
                Photos
            </button>
            <div class="input-group input-group-sm" style="width: auto; flex: 0 0 auto;">
                <input type="number" id="evDupDays" class="form-control" value="1" style="width:50px;"/>
                <button type="button" class="btn btn-outline-secondary btn-sm" onclick="duplicate_event('{{ event_no }}')">Dup</button>
            </div>
        </div>
        {{/if}}
    </div>
`);

const event_create_template = Handlebars.compile(`
    <div class="container">
        <div class="row">
            <div class="col-sm">
                <div class="form-floating">
                    <input type="text" class="form-control event-name-input event-name-input-{{i}}" id="event-name-input" placeholder="Name">
                    <label for="event-name-input">Name</label>
                </div>
                <br>
                <div class="form-floating">
                    <select class="form-select form-calendar-input form-calendar-input-{{i}}" id="event-calendar-input" aria-label="Calendar">
                    </select>
                    <label for="event-calendar-input">Calendar</label>
                </div>
                <br>
                <div class="btn-group" role="group" aria-label="Basic example">
                    <button type="button" class="btn btn-sm btn-primary event-type-btn event-type-btn-event" data-event-type="event">Event</button>
                    <button type="button" class="btn btn-sm btn-primary event-type-btn event-type-btn-ade" data-event-type="ade">All-Day Event</button>
                    <button type="button" class="btn btn-sm btn-primary event-type-btn event-type-btn-assignment" data-event-type="assignment">Assignment</button>
                </div>
                <br><br>
                <div class="event-datetime-wrapper">
                    <div class="event-datetime event-datetime-event">
                        <div class="input-group">
                            <input type="date" class="form-control event-date-start event-date-start-event">
                            <input type="time" class="form-control event-time-start event-time-start-event">
                        </div>
                        <br>
                        <div class="input-group">
                            <input type="date" class="form-control event-date-end event-date-end-event">
                            <input type="time" class="form-control event-time-end event-time-end-event">
                        </div>
                    </div>
                    <div class="event-datetime event-datetime-ade">
                        <div class="input-group">
                            <input type="date" class="form-control event-date-start event-date-start-ade">
                        </div>
                        <br>
                        <div class="input-group">
                            <input type="date" class="form-control event-date-end event-date-end-ade">
                        </div>
                    </div>
                    <div class="event-datetime event-datetime-assignment">
                        <div class="input-group">
                            <input type="date" class="form-control event-date-start event-date-start-assignment">
                            <input type="time" class="form-control event-time-start event-time-start-assignment">
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-sm">
                <div class="form-floating">
                    <textarea class="form-control" id="event-description-input" style="height: 150px;" placeholder="Description"></textarea>
                    <label for="event-description-input">Description</label>
                </div>
                <br>
                <div class="form-floating">
                    <input type="text" class="form-control event-loc-input event-loc-input-{{i}}" id="event-loc-input" placeholder="Location">
                    <label for="event-loc-input">Location</label>
                </div>
                <br>
                <div class="form-floating">
                    <select class="form-select form-category-input form-category-input-{{i}}" id="event-category-input" aria-label="Category">
                    </select>
                    <label for="event-category-input">Category</label>
                </div>
                <br>
                <div>
                    <label for="form-event-priority-input" class="form-label px-2">Priority</label>
                    <input type="range" id="form-event-priority-input" class="form-range form-event-priority-input" min="0" max="20" step="1">
                </div>
                <br>
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="event-public-check">
                    <label class="form-check-label" for="event-public-check">
                        Public
                    </label>
                </div>
                <br><br>
                <div class="d-grid gap-2 d-md-flex justify-content-md-end">
                    <button class="btn btn-primary create-event-btn">Create</button>
                </div>
            </div>
        </div>
    </div>
`);

const todo_create_template = Handlebars.compile(`
    <div class="form-floating">
        <input type="text" class="form-control todo-name-input todo-name-input-{{i}}" id="todo-name-input" placeholder="Name">
        <label for="todo-name-input">Name</label>
    </div>
    <br>
    <div class="form-floating">
        <textarea class="form-control" id="todo-description-input" style="height: 150px;" placeholder="Description"></textarea>
        <label for="todo-description-input">Description</label>
    </div>
    <br>
    <div>
        <label for="form-todo-priority-input" class="form-label px-2">Priority</label>
        <input type="range" id="form-todo-priority-input" class="form-range form-todo-priority-input" min="0" max="20" step="1">
    </div>
    <br>
    <div class="form-check">
        <input class="form-check-input" type="checkbox" value="" id="todo-recurring-check">
        <label class="form-check-label" for="todo-recurring-check">
            Recurring
        </label>
    </div>
    <br>
    Complete by:
    <div class="input-group">
        <input type="date" class="form-control todo-date-complete">
        <input type="time" class="form-control todo-time-complete">
    </div>
    <br>
    <div class="d-grid gap-2 d-md-flex justify-content-md-end">
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

document.addEventListener('DOMContentLoaded', () => {
    make_holidays_red();

    set_localstorage();

    set_display();

    // Restore sidebar tab from localStorage
    const savedTab = localStorage.getItem('calendar_sidebar_tab') || '.sb-todos';
    show_in_sidebar(savedTab);

    // Restore view mode from localStorage
    const savedView = localStorage.getItem('calendar_view') || 'month';
    document.getElementById('calViewSelect').value = savedView;
    currentView = savedView;

    populate_calendar(m, y);

    setTimeout(tick, 1000);
})


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
                cell = document.createElement("td");
                cellText = document.createTextNode("");
                cell.appendChild(cellText);
                cell.className = `date-picker-dead`;
                row.appendChild(cell);
            }
            else if (date > daysInMonth(month, year)) {
                if (row.innerHTML != "") {
                    cell = document.createElement("td");
                    cellText = document.createTextNode("");
                    cell.appendChild(cellText);
                    cell.className = `date-picker-dead`;
                    row.appendChild(cell);
                }
            }
            else {
                cell = document.createElement("td");
                cell.setAttribute("data-date", date);
                cell.setAttribute("data-month", month + 1);
                cell.setAttribute("data-year", year);
                cell.setAttribute("data-month_name", months[month]);
                cell.setAttribute("data-day", j);
                cell.className = `date-picker date-picker-${date}`;
                cell.innerHTML = `
                    <div class='date-span' data-bs-toggle='modal' data-bs-target='#big-modal' onclick="event.stopPropagation(); display_day_info(this)"><span onclick="event.stopPropagation(); display_day_info(this.parentElement)">${date}</span></div>
                    <div class='day-events day-events-${date}'></div>
                    <div class='reg-events reg-events-${date}'></div>
                    <span class="badge add-on-day-btn" data-bs-toggle="modal" data-bs-target="#big-modal" onclick="event.stopPropagation(); add_edit_event(${date})">+</span>
                    <span class="badge day-images-btn day-images-btn-${date}" data-bs-toggle="modal" data-bs-target="#big-modal" onclick="event.stopPropagation(); view_day_images(${date})">-</span>
                `;
                // Click empty cell space → open create form
                const cellDate = date;
                cell.style.cursor = 'pointer';
                cell.addEventListener('click', function (e) {
                    // Only fire if click is on the cell itself (not on children like events)
                    if (e.target === this || e.target.classList.contains('day-events') || e.target.classList.contains('reg-events')) {
                        add_edit_event(cellDate);
                        $('#big-modal').modal('show');
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
}

function change_display() {
    if (document.getElementById('displayBirthdaysCb').checked) { localStorage.setItem('calendar_show_birthdays', 1); }
    else { localStorage.setItem('calendar_show_birthdays', 0); }
    if (document.getElementById('displayTodosCb').checked) { localStorage.setItem('calendar_show_todos', 1); }
    else { localStorage.setItem('calendar_show_todos', 0); }
    if (document.getElementById('displayAllCb').checked) { localStorage.setItem('calendar_show_all', 1); }
    else { localStorage.setItem('calendar_show_all', 0); }
    reload();
    reload_calendar();
}

window.addEventListener("focus", () => {
    if (new Date() - lastrefresh >= 60000) {
        if (new Date().getDate() != loaddate) {
            jump_();
            populate_calendar(m, y, true);
            loaddate = new Date().getDate();
        }
        else {
            populate_calendar(m, y, true);
        }
    }
})

function tick() {
    if (new Date().getSeconds() == loadtime) {
        if (new Date().getDate() != loaddate) {
            jump_();
            populate_calendar(m, y, true);
            loaddate = new Date().getDate();
        }
        else {
            populate_calendar(m, y, true);
        }
    }

    setTimeout(tick, 1000);
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

function add_edit_event(date, month = m + 1, year = y, command = "add", edit_event = null) {
    var curreventtype = null;
    if (command == "add") { $('.modal-title').html("Create New Event") }
    else if (command == "edit") {
        $('.modal-title').html(`Edit ${edit_event['name']}`)
        if (edit_event['allday'] == true) { curreventtype = "ade" }
        else if (edit_event['enddate'] == "None") { curreventtype = "assignment" }
        else { curreventtype = "event" }
    }
    $('.big-modal-body').html(event_create_template({ 'i': '1' }));
    $('.event-datetime').css({ 'display': 'none' });
    $('.event-type-btn').click(function () {
        $('.event-datetime').css({ 'display': 'none' });
        $(`.event-datetime-${jQuery(this).data('event-type')}`).css({ 'display': 'block' });
        curreventtype = jQuery(this).data('event-type');
    });

    i = 0;
    for (cat of ['Uncategorized', 'Meeting', 'Focus Time', 'Break Time', 'Study', 'Work', 'Personal', 'Tech Break', 'Test / Exam', 'Lecture', 'Other']) {
        option = document.createElement('option');
        option.text = cat;
        option.value = i;
        if (option.text == 'Other') {
            option.value = 100;
        }
        document.querySelector('.form-category-input-1').add(option);
        i++;
    }

    if (command == "add") {
        document.querySelector('.event-type-btn-ade').click();
        document.querySelectorAll('.event-date-start').forEach(function (e) {
            e.valueAsDate = new Date(Date.UTC(year, month - 1, date));
        });
        document.querySelectorAll('.event-date-end-ade').forEach(function (e) {
            e.valueAsDate = new Date(Date.UTC(year, month - 1, date + 1));
        });
        document.querySelectorAll('.event-date-end-event').forEach(function (e) {
            e.valueAsDate = new Date(Date.UTC(year, month - 1, date));
        });

        const defaultStartTime = moment().add(1, "hours").format("HH:00");
        const defaultEndTime = moment().add(3, "hours").format("HH:00");
        document.querySelectorAll('.event-time-start').forEach(function (e) {
            e.value = defaultStartTime;
        });
        document.querySelectorAll('.event-time-end-event').forEach(function (e) {
            e.value = defaultEndTime;
        });
    }
    else if (command == "edit") {
        $('.create-event-btn').html('Edit')

        esdate = new Date(edit_event['startdate']);
        if (curreventtype == "assignment") { eedate = new Date(moment(esdate).add(1, "days").add(1, "hours")); }
        else { eedate = new Date(edit_event['enddate']); }

        if (curreventtype == "ade") {
            const sParts = getEasternDateParts(esdate);
            esdate = new Date(Date.UTC(sParts.year, sParts.month - 1, sParts.day));
            if (edit_event['enddate'] && edit_event['enddate'] !== 'None') {
                const eParts = getEasternDateParts(eedate);
                eedate = new Date(Date.UTC(eParts.year, eParts.month - 1, eParts.day));
            }
        } else {
            esdate = convertUTCDateToLocalDate(esdate);
            eedate = convertUTCDateToLocalDate(eedate);
        }
        document.querySelector(`.event-type-btn-${curreventtype}`).click();
        document.querySelectorAll('.event-date-start').forEach(function (e) {
            e.valueAsDate = esdate;
        });
        document.querySelectorAll('.event-date-end-ade').forEach(function (e) {
            e.valueAsDate = eedate;
        });
        document.querySelectorAll('.event-time-start').forEach(function (e) {
            e.valueAsDate = esdate;
        });
        document.querySelectorAll('.event-date-end-event').forEach(function (e) {
            e.valueAsDate = eedate;
        });
        document.querySelectorAll('.event-time-end-event').forEach(function (e) {
            e.valueAsDate = eedate;
        });

        $('.event-name-input-1').val(edit_event['name'])
        $('.event-loc-input-1').val(edit_event['location'])
        $('#event-description-input').val(edit_event['description'])
        $('#form-event-priority-input').val(edit_event['priority'])
        document.querySelector('#event-public-check').checked = edit_event['public']
    }

    for (c of data["calendars"]) {
        if (c["subscribe_type"] == 0 || c["subscribe_type"] == 1) {
            option = document.createElement('option');
            option.text = c["calendar"]["name"];
            option.value = c["calendar"]["id"];
            document.querySelector('.form-calendar-input-1').add(option);
        }

        if (command == "edit") {
            $('.form-calendar-input-1').val(edit_event['calendar'])
            $('.form-category-input-1').val(edit_event['category'])
        }
    }

    $('.create-event-btn').click(function () {
        valid = true;

        result = {
            "command": command,

            "type": curreventtype,
            "calendar": $('.form-calendar-input-1').val(),
            "category": $('.form-category-input-1').val(),
            "name": $('.event-name-input-1').val(),
            "location": $('.event-loc-input-1').val(),
            "description": $('#event-description-input').val(),
            "priority": $('#form-event-priority-input').val(),
            "public": document.querySelector('#event-public-check').checked,
        }

        if (command == "edit") { result["old_id"] = edit_event["id"] }

        if (curreventtype == "ade") {
            result["start"] = $('.event-date-start-ade').val();
            result["end"] = $('.event-date-end-ade').val();
        } else if (curreventtype == "assignment") {
            result["start"] = `${$('.event-date-start-assignment').val()} ${$('.event-time-start-assignment').val()}`;
        } else if (curreventtype == "event") {
            result["start"] = `${$('.event-date-start-event').val()} ${$('.event-time-start-event').val()}`;
            result["end"] = `${$('.event-date-end-event').val()} ${$('.event-time-end-event').val()}`;
        }

        if (curreventtype != "ade") {
            result['start'] = new Date(result['start'])
        }
        if (curreventtype == "event") {
            result['end'] = new Date(result['end'])
        }

        r = new XMLHttpRequest();
        r.open("POST", URLS['create_edit_event']);
        r.setRequestHeader("X-CSRFToken", CSRF_TOKEN);
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

function add_edit_todo(command = "add", edit_todo = null) {
    $('.modal-title').html("Create New Todo")
    $('.modal-body').html(todo_create_template({ 'i': '1' }))

    if (command == "edit") {
        et = data["todos"][edit_todo];
        $('.modal-title').html(`Edit ${et["name"]}`)
        $('.todo-name-input-1').val(et["name"]);
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
        r.setRequestHeader("X-CSRFToken", CSRF_TOKEN);
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
    r.setRequestHeader("X-CSRFToken", CSRF_TOKEN);
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

function make_holidays_red() {
    document.querySelectorAll('.date-span').forEach(ds => {
        if (vars["holidays"].includes(parseInt(ds.parentElement.dataset.day))) {
            ds.style.color = "red"
        }
    })
}

function change_height() {
    rowcount = document.querySelector('#calendar-body').childElementCount.toString()
    tableheight = document.querySelector('#calendar-body').offsetHeight
    document.querySelector('#calendar-body').querySelectorAll('tr').forEach(dp => {
        dp.style.height = (tableheight / rowcount).toString() + "px"
    })
}

function toggle_calendar_visibility(e, only) {
    const calendarInfo = data["calendars"][e.parentElement.dataset.calendar];
    const calId = calendarInfo["calendar"]["id"];
    const isNowHidden = !e.checked;

    // Flip visibility locally
    calendarInfo["visible"] = !isNowHidden;

    // Instant re-render from the full (unfiltered) data — reload_calendar skips hidden calendars
    reload_calendar();
    _afterDataLoad();
    switch_view(currentView);

    // Send the background request to persist the toggle on the server
    const r = new XMLHttpRequest();
    r.open("GET", `${URLS['toggle_visibility']}?calendar=${calId}`);
    r.onload = () => {
        const res = JSON.parse(r.responseText);
        if (res['status'] !== 'success') {
            alert(res['data']);
            // Revert on error
            populate_calendar(m, y, true);
        }
    }
    r.send();
}

function create_calendar() {
    $("#modal").modal();

    $('.modal-title').html("Create or join");
    $('.modal-body').html(calendar_create_form({}));


    $('.calendar-submit').click(() => {
        if ($('.calendar-name').val() === '') {
            $('.calendar-warn').text("Please enter a calendar name");
        }
        else {
            r = new XMLHttpRequest();
            r.open("POST", URLS['calendar']);
            r.setRequestHeader("X-CSRFToken", CSRF_TOKEN);
            r.onload = () => {
                res = JSON.parse(r.responseText);
                if (res["status"] == "success") {
                    populate_calendar(m, y, true);
                }
                else {
                    $('.calendar-warn').text(res["data"]);
                }
            }
            r.send(JSON.stringify({ "name": $('.calendar-name').val(), "color": $('.calendar-color').val() }));
        }
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
                        r.setRequestHeader("X-CSRFToken", CSRF_TOKEN)
                        r.onload = () => {
                            res = JSON.parse(r.responseText)
                            if (res["status"] == "error") {
                                $('.modal-body').html(`<p class="text-danger subscribe-warn" style="font-size: 15px;">ERROR: ${res["data"]}</p>`)
                            }
                            else {
                                $('.modal-body').html(`
                                    <p class="text-success subscribe-warn" style="font-size: 15px;">You are subscribed to this calendar.</p>
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

        if (allDayEvents && allDayEvents.length) {
            allDayEvents.forEach(ev => {
                const chip = document.createElement('div');
                chip.className = 'cv-allday-event';
                const cal = this.calendarMap[ev.calendar];
                chip.style.backgroundColor = cal ? cal.colour : '#039be5';
                chip.textContent = ev.name;
                if (this.onEventClick) {
                    chip.addEventListener('click', () => this.onEventClick(ev));
                }
                col.appendChild(chip);
            });
        }

        content.appendChild(col);
        bar.appendChild(content);
        return bar;
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

            return {
                ev, idx,
                top: (topMin / 60) * this.hourHeight,
                height: Math.max(((botMin - topMin) / 60) * this.hourHeight, 15),
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
            const el = document.createElement('div');
            el.className = 'cv-event';
            const cal = this.calendarMap[item.ev.calendar];
            const bgColor = cal ? cal.colour : '#039be5';
            el.style.backgroundColor = bgColor;
            el.style.color = this._contrastColor(bgColor);
            el.style.top = item.top + 'px';
            el.style.height = item.height + 'px';

            // Width and left based on column
            const widthPct = 100 / totalCols;
            el.style.left = (item.col * widthPct) + '%';
            el.style.width = 'calc(' + widthPct + '% - 2px)';

            // Content
            const title = document.createElement('div');
            title.className = 'cv-event-title';
            title.textContent = item.ev.name;
            el.appendChild(title);

            if (item.height >= 30) {
                const time = document.createElement('div');
                time.className = 'cv-event-time';
                const sDate = new Date(item.ev.startdate);
                let timeStr = moment(sDate).format('h:mm A');
                if (item.ev.enddate && item.ev.enddate !== 'None') {
                    timeStr += ' – ' + moment(new Date(item.ev.enddate)).format('h:mm A');
                }
                time.textContent = timeStr;
                el.appendChild(time);
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
            scrollToHour = 8;
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

        // Set handlers before building columns
        this._dayHelper.onEventClick = this.onEventClick;
        this._dayHelper.onSlotClick = this.onSlotClick;
        this._dayHelper.onDragCreate = this.onDragCreate;
        this._dayHelper.calendarMap = calendarMap;

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
            allDayEvts.forEach(ev => {
                const chip = document.createElement('div');
                chip.className = 'cv-allday-event';
                const cal = calendarMap[ev.calendar];
                chip.style.backgroundColor = cal ? cal.colour : '#039be5';
                chip.textContent = ev.name;
                if (this.onEventClick) {
                    chip.addEventListener('click', () => this.onEventClick(ev));
                }
                col.appendChild(chip);
            });
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
// display_day_info — refactored to use CalendarDayView
// =============================================================================================================
var _activeDayView = null;

function display_day_info(ds) {
    ds.onclick = () => {
        setTimeout(function () {
            const dp = ds.parentElement;
            const dpd = parseInt(dp.dataset.date);
            const dpMonth = parseInt(dp.dataset.month);
            const dpYear = parseInt(dp.dataset.year);

            const viewDate = new Date(dpYear, dpMonth - 1, dpd);

            $('.big-modal-title').html(
                moment(viewDate).format('dddd, MMMM D, YYYY')
            );

            $('.big-modal-body').html('');
            const container = document.querySelector('.big-modal-body');

            // Gather timed events for this day
            const timedEvents = events['events'][dpd] || [];
            // Gather all-day events for this day
            const allDayEvents = events['allday'][dpd] || [];

            // Clean up previous view
            if (_activeDayView) { _activeDayView.destroy(); }

            _activeDayView = new CalendarDayView(container, {
                hourHeight: 60,
                onEventClick: function (ev) {
                    // Find the index in data.events
                    const idx = data['events'].indexOf(ev);
                    if (idx !== -1) {
                        // Close big modal, open small modal
                        $('#big-modal').modal('hide');
                        $('#modal').modal('show');
                        // Simulate the event info display
                        const fakeBtn = document.createElement('div');
                        fakeBtn.dataset.no = idx;
                        fakeBtn.dataset.type = 'event';
                        fakeBtn.dataset.calendar = ev.calendar;
                        display_info(fakeBtn);
                    }
                },
                onSlotClick: function (date, hour, minute) {
                    // Open event creation at this time
                    $('#big-modal').modal('hide');
                    setTimeout(() => {
                        add_edit_event(date.getDate(), date.getMonth() + 1, date.getFullYear());
                        $('#big-modal').modal('show');
                    }, 300);
                }
            });

            _activeDayView.render(viewDate, timedEvents, allDayEvents, calendars);
        }, 100);
    };
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

    document.querySelectorAll('.date-span').forEach(ds => {
        if (vars["holidays"].includes(parseInt(ds.dataset.day))) {
            ds.style.color = "red"
        }
    })

    for (i = 0; i < daysInMonth(m, y); i++) {
        events["events"][i + 1] = [];
        events["allday"][i + 1] = [];
    }

    c = data["calendars"]
    for (i = 0; i < c.length; i++) {
        checked = "checked"
        if (c[i]["visible"] == false) { checked = ""; }
        if (c[i]["subscribe_type"] == 0) { owner = true; }
        else { owner = false; }

        calendars[c[i]["calendar"]["id"]] = c[i];

        if (c[i]['active'] == 'False') { opacity = 0.6; }
        else { opacity = 1; }
        cal_name = calendar_name({ "id": c[i]["calendar"]["id"], "name": c[i]["calendar"]["name"], "calendar": i, "calendar-type": c[i]["calendar"]["calendar_type"], "checked": checked, "colour": c[i]['colour'], "owner": c[i]["subscribe_type"] == 0, "opacity": opacity, "admin": c[i]["subscribe_type"] == 1, "sync": c[i]["calendar"]["calendar_type"] != "0", "c_owner": c[i]["calendar"]["owner"] == USER_ID });

        if (c[i]["subscribe_type"] == 0) {
            document.querySelector('.calendarlist-mine').innerHTML += cal_name;
        }
        else {
            document.querySelector('.calendarlist-other').innerHTML += cal_name;
        }
    }

    if (localStorage.getItem('calendar_show_birthdays') == 1) {
        b = data["birthdays"]
        for (i = 0; i < b.length; i++) {
            date_ = new Date(b[i]["birthday"]).getUTCDate()
            dp = document.querySelector(`.day-events-${date_}`)
            var ci = calendar_item({ 'modal': false, 'calendar': "", 'i': i, 'type': "event", 'bg_color': "", 'color': '#000000;', 'bo_radius': '3px', 'text': `<span style="font-weight: normal;">🎂</span> ${b[i]['username']}'s Birthday` })
            dp.innerHTML += ci
        }
    }

    e = data["events"]
    for (i = 0; i < e.length; i++) {
        // Skip events from hidden calendars
        if (calendars[e[i]['calendar']] && calendars[e[i]['calendar']]['visible'] === false) continue;

        sd = new Date(e[i]['startdate'])
        ed = new Date(e[i]['enddate'])
        if (e[i]['allday'] == true) {
            const sParts = getEasternDateParts(sd);
            sd = new Date(sParts.year, sParts.month - 1, sParts.day);
            if (e[i]['enddate'] && e[i]['enddate'] !== 'None') {
                const eParts = getEasternDateParts(ed);
                ed = new Date(eParts.year, eParts.month - 1, eParts.day);
            }
        }

        if (e[i]['category'] == 100) {
            icon = "";
        }
        else {
            icon = ICONS[e[i]['category']] + "&nbsp";
        }

        if (e[i]['enddate'] == null) {
            dp = document.querySelector(`.reg-events-${sd.getDate()}`)
            var ci = calendar_item({ 'modal': true, 'del': e[i]['completed'] == true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'color': calendars[e[i]['calendar']]['colour'], 'icon': icon, 'text': moment(sd).format('LT').replace(":00", "") + " - " + e[i]['name'], 'del': e[i]['completed'] == true })
            dp.innerHTML += ci

            events["events"][sd.getDate()].push(e[i]);
        }
        else if (sd.getMonth() == m && ed.getMonth() == m) {
            for (j = sd.getDate(); j <= ed.getDate(); j++) {
                if (sd.getDate() == ed.getDate()) {
                    dp = document.querySelector(`.reg-events-${j}`)
                    var ci = calendar_item({ 'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'color': calendars[e[i]['calendar']]['colour'], 'icon': icon, 'text': moment(sd).format('LT').replace(":00", "") + " - " + e[i]['name'], 'del': e[i]['completed'] == true })
                    dp.innerHTML += ci

                    events["events"][j].push(e[i]);
                }
                else if (e[i]['allday'] == true) {
                    if (j != ed.getDate()) {
                        dp = document.querySelector(`.day-events-${j}`)
                        var ci = calendar_item({ 'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': e[i]['name'], 'del': e[i]['completed'] == true })
                        dp.innerHTML += ci

                        events["allday"][j].push(e[i]);
                    }
                }
                else {
                    if (j == sd.getDate()) { prepend = moment(sd).format('LT').replace(":00", "") + " - "; events["events"][j].push(e[i]); }
                    else { prepend = "" }
                    dp = document.querySelector(`.day-events-${j}`)
                    var ci = calendar_item({ 'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': prepend + e[i]['name'], 'del': e[i]['completed'] == true })
                    dp.innerHTML += ci
                }
            }
        }
        else if (sd.getMonth() == m) {
            for (j = sd.getDate(); j <= daysInMonth(m, y); j++) {
                if (e[i]['allday'] == true) {
                    dp = document.querySelector(`.day-events-${j}`)
                    var ci = calendar_item({ 'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': e[i]['name'], 'del': e[i]['completed'] == true })
                    dp.innerHTML += ci

                    events["allday"][j].push(e[i]);
                }
                else {
                    if (j == sd.getDate()) { prepend = moment(sd).format('LT').replace(":00", "") + " - "; events["events"][j].push(e[i]); }
                    else { prepend = "" }
                    dp = document.querySelector(`.day-events-${j}`)
                    var ci = calendar_item({ 'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': prepend + e[i]['name'], 'del': e[i]['completed'] == true })
                    dp.innerHTML += ci
                }
            }
        }
        else if (ed.getMonth() == m) {
            for (j = 1; j <= ed.getDate(); j++) {
                if (e[i]["allday"] == true && j == ed.getDate()) { }
                else {
                    dp = document.querySelector(`.day-events-${j}`)
                    var ci = calendar_item({ 'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': e[i]['name'], 'del': e[i]['completed'] == true })
                    dp.innerHTML += ci
                }
            }
        }
        else {
            for (j = 1; j <= daysInMonth(m, y); j++) {
                dp = document.querySelector(`.day-events-${j}`)
                var ci = calendar_item({ 'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': e[i]['name'], 'del': e[i]['completed'] == true })
                dp.innerHTML += ci
            }
        }
    }

    t = data["todos"]
    for (let [num, todo] of t.entries()) {
        if (todo["complete_by"] == null) { tn = `<span class="text-muted">${todo.name}</span>` }
        else {
            cd = new Date(todo["complete_by"]);
            dc = cd.getTime() - new Date().getTime()
            if (cd <= new Date()) { overdue = "5"; }
            else if (dc <= timediff1) { overdue = "2"; }
            else if (dc <= timediff2) { overdue = "1"; }
            else { overdue = "0"; }

            if (localStorage.getItem("calendar_show_todos") == 1) {
                if (cd.getMonth() == m && cd.getFullYear() == y) {
                    j = cd.getDate();
                    dp = document.querySelector(`.day-events-${j}`)
                    if (cd.getHours() == 23 && cd.getMinutes() == 59) {
                        tdtime = "";
                    } else {
                        tdtime = `${moment(cd).format('LT').replace(":00", "")} - `;
                    }
                    var ci = calendar_item({ 'modal': false, 'calendar': [], 'i': num, 'type': "event", 'bg_color': "", 'color': '#000000;', 'bo_radius': '3px', 'del': todo["completed"] == true, 'text': `${TASK_ICON}&nbsp${tdtime}${todo.name}` });
                    dp.innerHTML += ci
                }
            }
            if (overdue == "5") { tn = `<span class="text-danger">⚠ ${todo.name}</span>` }
            else if (overdue == "2") { tn = `<span class="text-warning">${todo.name}</span>` }
            else if (overdue == "1") { tn = `<span class="text-info">${todo.name}</span>` }
            else { tn = `${todo.name}` }
        }
        if (todo["completed"] == false) {
            document.querySelector('.todo-list').innerHTML += todo_item({ 'id': todo.id, 'name': tn, 'i': num });
        }
    }

    for (i of Object.entries(data["photos"])) { $(`.day-images-btn-${i[0]}`).html(i[1]); }

    change_height();

    hide_loading();
}

function populate_calendar(m, y, jumponload = false) {
    r = new XMLHttpRequest();
    r.open("GET", `${URLS['get_events']}?month=${m + 1}&year=${y}&show_all=${localStorage.getItem('calendar_show_all')}&extra=${localStorage.getItem('calendar_extra')}&show_invisible=1`);
    r.onload = () => {
        data = JSON.parse(r.responseText.replace(/&#x27;/g, '"'))["data"];

        // Session Expired
        if (data == "Not logged in") {
            window.location.reload();
        }

        document.querySelector('.page-alert').style.display = "none";

        if (jumponload) { reload() };
        reload_calendar();
        lastrefresh = new Date();
        $('#last-refresh').html(moment(lastrefresh).format('LTS'));

        // Re-render day/week views if active
        _afterDataLoad();

        // Show correct view pane
        switch_view(currentView);
    }
    r.onerror = () => {
        document.querySelector('.page-alert').style.display = "block";
        $('.page-alert').html("Unable to connect to server (Network connection lost).");
    }

    r.send();
}

function complete_todo(todo_id) {
    todo = data["todos"][todo_id]
    r = new XMLHttpRequest();
    r.open("POST", URLS['todo_complete']);
    r.setRequestHeader("X-CSRFToken", CSRF_TOKEN);
    r.onload = () => {
        res = JSON.parse(r.responseText)
        if (res['status'] == 'success') {
            populate_calendar(m, y, true);
        }
        else {
            alert(res['data']);
        }
    }
    r.send(JSON.stringify({ 'id': todo["id"], 'completion': true }));
}

function display_info(button) {
    setTimeout(function () {
        event_ = data["events"][button.dataset.no]

        sd = new Date(event_["startdate"])
        ed = new Date(event_["enddate"])
        if (event_["allday"] == true) {
            const sParts = getEasternDateParts(sd);
            sd = new Date(sParts.year, sParts.month - 1, sParts.day);
            if (event_["enddate"] && event_["enddate"] !== 'None') {
                const eParts = getEasternDateParts(ed);
                ed = new Date(eParts.year, eParts.month - 1, eParts.day);
            }
        }
        if (event_['sync_id'] != null) {
            title = `${event_['name']} <span class="text-muted"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-repeat" viewBox="0 0 16 16"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg></span>`
        }
        else { title = event_['name'] }
        $('.modal-title').html(title)

        if (event_["enddate"] == "None") { date_ = moment(sd).format('LLLL') }
        else if (event_["allday"] == true) {
            sd1 = moment(sd)
            ed1 = moment(ed).subtract(1, 'days')
            if (sd1.calendar() == ed1.calendar()) { date_ = moment(sd).format('LL') }
            else { date_ = moment(sd).format('LL') + " – " + moment(ed).format('LL') }
        }
        else {
            if (sd.getDate() == ed.getDate()) { date_ = moment(sd).format('LLL') + " – " + moment(ed).format('LT') }
            else { date_ = moment(sd).format('LLL') + " – " + moment(ed).format('LLL') }
        }
        if (localStorage.getItem('debug') == 1) { dev_info = `<br><i>Id: ${event_["id"]}</i>` }
        else { dev_info = "" }
        if (event_["description"] == "" || event_["description"] == null) { show_desc = false; desc = null }
        else { show_desc = true; desc = parse_message(event_["description"]); }

        const loc = value_or_empty(event_["location"]);

        const clockIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>';
        if (event_["enddate"] == "None") {
            countdown = `<a href="/calendar/countdown/${event_["id"]}/start/" class="btn btn-outline-secondary btn-sm" target="_blank">${clockIcon} Start</a>`;
        } else {
            countdown = `<a href="/calendar/countdown/${event_["id"]}/start/" class="btn btn-outline-secondary btn-sm" target="_blank">${clockIcon} Start</a> <a href="/calendar/countdown/${event_["id"]}/end/" class="btn btn-outline-secondary btn-sm" target="_blank">${clockIcon} End</a>`;
        }

        const cal = calendars[event_["calendar"]];
        const calColor = cal ? cal.colour : '#039be5';

        $('.modal-body').html(event_info_template({
            "title": title,
            "cal_color": calColor,
            "date": date_,
            "calendar": `${cal ? cal.calendar.name : 'Unknown'} [${event_["category"]}]`,
            "show_desc": show_desc,
            "description": desc,
            "show_location": loc !== "",
            "location": loc,
            "countdown": countdown,
            "dev_info": dev_info,
            "event_no": button.dataset.no,
            "owner": cal && (cal.subscribe_type == 0 || cal.subscribe_type == 1),
        }))
    }, 100)
}

var no_invites = 0
var calendar_

function display_calendar_info(btn) {
    $('.big-modal-title').html("Loading...");
    $('.big-modal-body').html(`
        <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
        </div>
    `);

    cal = data["calendars"][btn.parentElement.parentElement.dataset.calendar];
    calid = cal["id"];

    if (cal["subscribe_type"] == 0) {
        r = new XMLHttpRequest();

        r.open('GET', `${URLS['calendar']}?id=${cal["calendar"]["id"]}`);
        r.onload = function () {
            calendar_ = JSON.parse(r.responseText);

            $('.big-modal-title').html(`${calendar_["name"]}`);
            $('.big-modal-body').html(calendar_info_template());

            if (calendar_["active"] == true) { $('.toggle-calendar-activation-btn').html("Disable"); }
            else { $('.toggle-calendar-activation-btn').html("Enable"); }
            $('.toggle-calendar-activation-btn').attr("data-calendar", cal["calendar"]["id"]);

            for (i = 0; i < calendar_["subscribers"].length; i++) {
                subscriberinfo = `
                    ${calendar_["subscribers"][i]["user"]["first_name"]}  ${calendar_["subscribers"][i]["user"]["last_name"]}  (${calendar_["subscribers"][i]["user"]["username"]})
                `;

                if (calendar_["subscribers"][i]["subscribe_type"] == 0) { document.querySelector('.subscriber-list').innerHTML += `<li style="color: blue;">${subscriberinfo} [OWNER]</li>`; }
                else if (calendar_["subscribers"][i]["subscribe_type"] == 1) { document.querySelector('.subscriber-list').innerHTML += `<em><li>${subscriberinfo}</li></em>`; }
                else { document.querySelector('.subscriber-list').innerHTML += `<li>${subscriberinfo}</li>`; }
            }

            for (inv of calendar_['invites']) {
                temp = "";
                if (inv["active"] == true) { temp = "checked"; }
                no_invites++;
                document.querySelector('.invite-list').innerHTML += calendar_invite({ "invite_no": no_invites, "invite": inv["id"], "calendar_id": calendar_["id"], "checked": temp, "invite_name": inv["code"] });
            }

            document.querySelector('.random-invite').onclick = function () { document.querySelector('.invite-text').value = randomText(8); }

            document.querySelector('.create-invite').onclick = function () {
                inv = document.querySelector('.invite-text').value;
                if (inv == "") { $('.invite-warn').html("Please enter an invite code"); }
                else {
                    $('.invite-warn').html("");
                    create_invite(calendar_)
                }
            }

            if (calendar_["calendar_type"] != "0") {
                document.querySelector('.big-modal-title').innerHTML += `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-repeat" viewBox="0 0 16 16">
                    <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"></path>
                    <path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"></path>
                </svg>
                `;
            }
            if (calendar_["public"] == true) {
                document.querySelector('.big-modal-title').innerHTML += `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-globe" viewBox="0 0 16 16">
                    <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z"/>
                </svg>
                `;
            }
        }
        r.send()
    }
    else {
        $('.big-modal-title').html(`${calendar_["name"]}`)
        $('.big-modal-body').html("You must be the owner of the calendar to view and change it's settings.")
    }
}

function sync_events(btn) {
    cal = data["calendars"][btn.parentElement.parentElement.dataset.calendar]

    $('.modal-title').html(`Sync Events for ${cal["calendar"]["name"]}`)
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
            r.setRequestHeader("X-CSRFToken", CSRF_TOKEN)
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
    cal = data["calendars"][btn.parentElement.parentElement.dataset.calendar]
    var r = new XMLHttpRequest()
    r.open('POST', `${URLS['unsubscribe']}?calendar=${cal["calendar"]["id"]}`)
    r.setRequestHeader("X-CSRFToken", CSRF_TOKEN)
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
    r.setRequestHeader("X-CSRFToken", CSRF_TOKEN);
    r.onload = () => {
        res = JSON.parse(r.responseText);
        if (res["status"] === "error") { $('.invite-warn').html(res["data"]); }
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
    r.setRequestHeader("X-CSRFToken", CSRF_TOKEN)
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
    r.open('GET', `${URLS['calendar']}?id=${e.dataset.calendar}&command=active`);
    r.onload = () => {
        $('#big-modal').modal("hide");
        populate_calendar(m, y, true);
    }
    r.send();
}

function delete_event(event_no) {
    ev = data["events"][event_no]
    if (calendars[ev["calendar"]]["subscribe_type"] == 0 || calendars[ev["calendar"]]["subscribe_type"] == 1) {
        var request = new XMLHttpRequest()
        request.open('POST', URLS['delete_event'])
        request.setRequestHeader("X-CSRFToken", CSRF_TOKEN)
        request.onload = () => {
            res = JSON.parse(request.responseText);
            if (res["status"] === "success") {
                $("#modal").modal("hide");
                data["events"].splice(event_no, 1)
                reload_calendar();
            }
            else {
                alert(res["data"])
            }
        }
        request.send(ev["id"])
    }
}

function duplicate_event(event_no) {
    ev = data["events"][event_no]
    if (calendars[ev["calendar"]]["subscribe_type"] == 0 || calendars[ev["calendar"]]["subscribe_type"] == 1) {
        var request = new XMLHttpRequest()
        request.open('POST', URLS['duplicate_event'])
        request.setRequestHeader("X-CSRFToken", CSRF_TOKEN)
        request.onload = () => {
            res = JSON.parse(request.responseText);
            if (res["status"] === "success") {
                $("#modal").modal("hide");
                populate_calendar(m, y, true);
            }
            else {
                alert(res["data"])
            }
        }
        request.send(JSON.stringify({ "id": ev["id"], "days": $('#evDupDays').val() }))
    }
}

function view_day_images(date) {
    $('.modal-title').html(`Images for ${date}-${m + 1}-${y}`)
    $('.modal-body').html(`<iframe src="${window.origin}/photos/day/${y}/${m + 1}/${date}/" style="width: 100%; height: 65vh;">`)
}

function view_event_images(evt) {
    $('.modal-title').html(`Images for ${evt['name']}`)
    $('.modal-body').html(`<iframe src="${window.origin}/photos/event/${evt['id']}/" style="width: 100%; height: 65vh;">`)
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

function show_in_sidebar(opt) {
    document.querySelectorAll('.sidebar-info').forEach((el) => {
        el.style.display = "none";
    });
    const target = document.querySelector(opt);
    if (target) target.style.display = "block";

    // Highlight active tab
    document.querySelectorAll('#sidebar-tabs .nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.sidebarTab === opt) {
            link.classList.add('active');
        }
    });

    // Persist
    localStorage.setItem('calendar_sidebar_tab', opt);
}

function hide_loading() {
    document.querySelector('.loading-screen').style.display = "none";
}

// ===== View Switching =====
function switch_view(view) {
    currentView = view;
    localStorage.setItem('calendar_view', view);

    document.querySelector('.view-month').style.display = view === 'month' ? '' : 'none';
    document.querySelector('.view-week').style.display = view === 'week' ? '' : 'none';
    document.querySelector('.view-day').style.display = view === 'day' ? '' : 'none';

    if (view === 'month') {
        // Already populated by month
    } else if (view === 'week') {
        renderWeekView();
    } else if (view === 'day') {
        renderDayView();
    }
}

function renderDayView() {
    if (!data) return;
    const container = document.querySelector('.view-day');
    if (_mainDayView) _mainDayView.destroy();

    _mainDayView = new CalendarDayView(container, {
        hourHeight: 60,
        onEventClick: _handleMainEventClick,
        onSlotClick: _handleMainSlotClick,
        onDragCreate: _handleDragCreate,
    });

    const dayNum = currentDayDate.getDate();
    const timedEvts = events['events'][dayNum] || [];
    const allDayEvts = events['allday'][dayNum] || [];
    _mainDayView.render(currentDayDate, timedEvts, allDayEvts, calendars);

    // Photo count badge
    _addPhotoBadge(container, dayNum);
}

function renderWeekView() {
    if (!data) return;
    const container = document.querySelector('.view-week');
    if (_mainWeekView) _mainWeekView.destroy();

    // Compute week start (Sunday) from currentDayDate
    const ws = new Date(currentDayDate);
    ws.setDate(ws.getDate() - ws.getDay());
    ws.setHours(0, 0, 0, 0);
    currentWeekStart = ws;

    _mainWeekView = new CalendarWeekView(container, {
        hourHeight: 60,
        onEventClick: _handleMainEventClick,
        onSlotClick: _handleMainSlotClick,
        onDragCreate: _handleDragCreate,
    });

    // Build eventsByDay for the 7 days
    const eventsByDay = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        d.setDate(d.getDate() + i);
        const dayNum = d.getDate();
        // Only include events from the current loaded month
        if (d.getMonth() === m && d.getFullYear() === y) {
            eventsByDay[i] = {
                timed: events['events'][dayNum] || [],
                allDay: events['allday'][dayNum] || [],
            };
        } else {
            eventsByDay[i] = { timed: [], allDay: [] };
        }
    }

    _mainWeekView.render(ws, eventsByDay, calendars);

    // Photo count badges for week view
    const cols = container.querySelectorAll('.cv-day-col');
    for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        d.setDate(d.getDate() + i);
        if (d.getMonth() === m && d.getFullYear() === y && cols[i]) {
            _addPhotoBadgeToCol(cols[i], d.getDate());
        }
    }
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
    const idx = data['events'].indexOf(ev);
    if (idx !== -1) {
        $('#modal').modal('show');
        const fakeBtn = document.createElement('div');
        fakeBtn.dataset.no = idx;
        fakeBtn.dataset.type = 'event';
        fakeBtn.dataset.calendar = ev.calendar;
        display_info(fakeBtn);
    }
}

function _handleMainSlotClick(date, hour, minute) {
    add_edit_event(date.getDate(), date.getMonth() + 1, date.getFullYear());
    $('#big-modal').modal('show');
}

function _handleDragCreate(date, startHour, startMin, endHour, endMin) {
    add_edit_event(date.getDate(), date.getMonth() + 1, date.getFullYear());
    $('#big-modal').modal('show');
    // Pre-fill time fields after modal renders
    setTimeout(() => {
        const sTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
        const eTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
        // Switch to timed event type
        const evtBtn = document.querySelector('.event-type-btn-event');
        if (evtBtn) evtBtn.click();
        document.querySelectorAll('.event-time-start').forEach(e => e.value = sTime);
        document.querySelectorAll('.event-time-end-event').forEach(e => e.value = eTime);
    }, 200);
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
                    d__ = new Date();
                    add_edit_event(d__.getDate(), d__.getMonth(), d__.getFullYear());
                    $('#big-modal').modal('show');
                }
            }
        }
    }

    // ===== Plain-key shortcuts (no modifier, no modal, no text input focused) =====
    const tag = document.activeElement ? document.activeElement.tagName : '';
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement.isContentEditable;
    const modalOpen = document.getElementById('modal').classList.contains('show') || document.getElementById('big-modal').classList.contains('show');

    if (!e.ctrlKey && !e.altKey && !e.metaKey && !isTyping && !modalOpen) {
        const k = e.key.toLowerCase();

        if (k === 'd') { e.preventDefault(); switch_view('day'); document.getElementById('calViewSelect').value = 'day'; }
        else if (k === 'w') { e.preventDefault(); switch_view('week'); document.getElementById('calViewSelect').value = 'week'; }
        else if (k === 'm') { e.preventDefault(); switch_view('month'); document.getElementById('calViewSelect').value = 'month'; }
        else if (k === 't') { e.preventDefault(); today_(); }
        else if (k === 'a') {
            // All-day event for current day
            e.preventDefault();
            const now = new Date();
            add_edit_event(now.getDate(), now.getMonth() + 1, now.getFullYear());
            $('#big-modal').modal('show');
            // Auto-click the all-day-event type button after the form renders
            setTimeout(() => { document.querySelector('[data-event-type="ade"]')?.click(); }, 100);
        }
        else if (k === 'c') {
            // Timed event starting at next 15-min mark, 1 hour duration
            e.preventDefault();
            const now = new Date();
            add_edit_event(now.getDate(), now.getMonth() + 1, now.getFullYear());
            $('#big-modal').modal('show');
            setTimeout(() => {
                // Click the "event" type button
                document.querySelector('[data-event-type="event"]')?.click();
                // Compute next 15-min mark
                const mins = now.getMinutes();
                const next15 = Math.ceil((mins + 1) / 15) * 15;
                const startH = now.getHours() + Math.floor(next15 / 60);
                const startM = next15 % 60;
                const endH = startH + 1;
                // Pre-fill time inputs if they exist
                const startTime = document.getElementById('event-start-time');
                const endTime = document.getElementById('event-end-time');
                if (startTime) startTime.value = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
                if (endTime) endTime.value = `${String(endH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
            }, 100);
        }
        else if (k === '.' || k === 'n') { e.preventDefault(); go_next(); }
        else if (k === ',' || k === 'p') { e.preventDefault(); go_prev(); }
        else if (k === 's') {
            e.preventDefault();
            create_calendar();
            $('#modal').modal('show');
        }
    }

    if (e.key == 'Escape' && document.querySelector('.command-block').style.display == 'block') {
        e.preventDefault();
        document.querySelector('.command-block').style.display = 'none';
    }

    if (e.altKey) {
        if (e.key == 'e') {
            e.preventDefault();
            localStorage.setItem('calendar_extra', prompt("Enter extra calendar code"));
            jump_();
        }
        else if (e.key == 'c') {
            e.preventDefault();
            document.querySelector('.command-block').style.display = 'block';
            document.querySelector('.command-block').querySelector('.form-control').focus();
        }
    }
}
