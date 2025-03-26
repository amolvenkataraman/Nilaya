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
        <button class="btn btn-primary calendar-sync-btn">Sync</button>
    </div>
`);

const event_info_template = Handlebars.compile(`
    <div class="ei-date-info">
        {{ date }}
    </div>
    <div class="ei-calendar-info">
        {{ calendar }}
    </div>
    {{#if show_desc}}
    <div class="ei-description">
        {{{ description }}}
    </div>
    <div class="ei-location">
        Location: {{{ location }}}
    </div>
    {{/if}}
    <div class="ei-countdown">
        {{{ countdown }}}
    </div>
    <div class="ei-dev-info">
        {{{ dev_info }}}
    </div>
    {{#if owner}}
    <div class="ei-controls">
        <div class="btn-group mb-2" role="group" aria-label="Event controls">
            <button type="button" class="btn btn-warning" onclick="$('#modal').modal('hide'); $('#big-modal').modal('show'); add_edit_event(1, m+1, y, command='edit', edit_event=data['events']['{{ event_no }}'])">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil" viewBox="0 0 16 16">
                    <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                </svg>
            </button>
            <button type="button" class="btn btn-danger" onclick="delete_event('{{ event_no }}')">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                </svg>
            </button>
            <button type="button" class="btn btn-primary" onclick="$('#modal').modal('hide'); $('#big-modal').modal('show'); view_event_images(data['events']['{{ event_no }}'])">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-camera" viewBox="0 0 16 16">
                    <path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 6.827 3h2.344a1 1 0 0 1 .707.293l.828.828A3 3 0 0 0 12.828 5H14a1 1 0 0 1 1 1v6zM2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2z"/>
                    <path d="M8 11a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm0 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 6.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/>
                </svg>
            </button>
        </div>
        <div class="input-group input-group-sm" style="width: 50%;">
            <input type="number" id="evDupDays" class="form-control" value="1"/>
            <label class="input-group-text" for="evDupDays">Days</label>
            <button type="button" class="btn btn-primary" onclick="duplicate_event('{{ event_no }}')">Duplicate</button>
        </div>
    </div>
    {{/if}}
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
            }
            else if (date > daysInMonth(month, year)) {
                if (row.innerHTML != "") {
                    cell = document.createElement( "td" );
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
                    <div class='date-span' data-bs-toggle='modal' data-bs-target='#big-modal' onclick="display_day_info(this)"><span data-bs-toggle='modal' data-bs-target='#big-modal' onclick="display_day_info(this.parentElement)">${date}</span></div>
                    <div class='day-events day-events-${date}'></div>
                    <div class='reg-events reg-events-${date}'></div>
                    <span class="badge add-on-day-btn" data-bs-toggle="modal" data-bs-target="#big-modal" onclick="add_edit_event(${date})">+</span>
                    <span class="badge day-images-btn day-images-btn-${date}" data-bs-toggle="modal" data-bs-target="#big-modal" onclick="view_day_images(${date})">-</span>
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

    if (moment().format("HH mm ss") == "19 00 00") {
        for (time of [0, 1000, 2000]) {setTimeout(function() {notification.play()}, time)}
        if (ss_available) {speech_synthesis.text = `Tomorrow is ${moment().add(1, 'days').format("dddd, MMMM Do YYYY")}. Your events tomorrow are: `}
        if (today.getDate != daysInMonth(m, y))
        {
            is_ev = false;
            for (ev of events["allday"][parseInt(moment().add(1, 'days').format("DD"))]) {
                if (ss_available) { speech_synthesis.text += `${ev['name']} all day, `; }
                is_ev = true;
            }
            for (ev of events["events"][parseInt(moment().add(1, 'days').format("DD"))]) {
                if (ev['enddate'] == "None") {sst = `${ev['name']} at ${moment(ev['startdate']).format('LT')}, `}
                else {sst = `${ev['name']} from ${moment(ev['startdate']).format('LT')} to ${moment(ev['enddate']).format('LT')}, `}
                if (ss_available) { speech_synthesis.text += sst; }
                is_ev = true;
            }

            if (is_ev == false) {
                if (ss_available) { speech_synthesis.text += "There are no events tomorrow."; }
            }
        }

        if (ss_available) {setTimeout(function() {window.speechSynthesis.speak(speech_synthesis);}, 3000)}
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
            catch {}
        }

        if (is_ev) {
            notification.play();
            if (ss_available) {
                setTimeout(function() { window.speechSynthesis.speak(speech_synthesis); }, 500);
            }
        }
    }
    setTimeout(tick, 1000)
}

function add_edit_event(date, month=m+1, year=y, command="add", edit_event=null) {
    var curreventtype = null;
    if (command=="add") {$('.modal-title').html("Create New Event")}
    else if (command=="edit") {
        $('.modal-title').html(`Edit ${edit_event['name']}`)
        if (edit_event['allday'] == true) {curreventtype="ade"}
        else if (edit_event['enddate'] == "None") {curreventtype="assignment"}
        else {curreventtype="event"}
    }
    $('.big-modal-body').html(event_create_template({'i': '1'}));
    $('.event-datetime').css({'display': 'none'});
    $('.event-type-btn').click(function() {
        $('.event-datetime').css({'display': 'none'});
        $(`.event-datetime-${jQuery(this).data('event-type')}`).css({'display': 'block'});
        curreventtype = jQuery(this).data('event-type');
    });

    i = 0;
    for (cat of ['Uncategorized', 'Meeting', 'Focus Time', 'Break Time', 'Study', 'Work', 'Personal', 'Tech Break', 'Test / Exam', 'Lecture',  'Other']) {
        option = document.createElement('option');
        option.text = cat;
        option.value = i;
        if (option.text == 'Other') {
            option.value = 100;
        }
        document.querySelector('.form-category-input-1').add(option);
        i++;
    }

    if (command =="add") {
        document.querySelector('.event-type-btn-ade').click();
        document.querySelectorAll('.event-date-start').forEach(function(e) {
            e.valueAsDate = new Date(`${year}-${month}-${date}`);
        });
        document.querySelectorAll('.event-date-end-ade').forEach(function(e) {
            e.valueAsDate = new Date(moment(new Date(`${year}-${month}-${date}`)).add(1, "days"));
        });
        document.querySelectorAll('.event-time-start').forEach(function(e) {
            e.value = `${moment(new Date()).add(1, "hours").format("hh")}:00:00`;
        });
        document.querySelectorAll('.event-date-end-event').forEach(function(e) {
            e.valueAsDate = new Date(moment(new Date(`${year}-${month}-${date} ${moment(new Date()).add(1, "hours").format("hh")}:00:00`)).add(2, "hours"));
        });
        document.querySelectorAll('.event-time-end-event').forEach(function(e) {
            e.value = `${moment(new Date()).add(2, "hours").format("hh")}:00:00`;
        });
    }
    else if (command =="edit") {
        $('.create-event-btn').html('Edit')

        esdate = new Date(edit_event['startdate']);
        if (curreventtype=="assignment") {eedate = new Date(moment(esdate).add(1, "days").add(1, "hours"));}
        else {eedate = new Date(edit_event['enddate']);}
        esdate = convertUTCDateToLocalDate(esdate);
        eedate = convertUTCDateToLocalDate(eedate);
        document.querySelector(`.event-type-btn-${curreventtype}`).click();
        document.querySelectorAll('.event-date-start').forEach(function(e) {
            e.valueAsDate = esdate;
        });
        document.querySelectorAll('.event-date-end-ade').forEach(function(e) {
            e.valueAsDate = eedate;
        });
        document.querySelectorAll('.event-time-start').forEach(function(e) {
            e.valueAsDate = esdate;
        });
        document.querySelectorAll('.event-date-end-event').forEach(function(e) {
            e.valueAsDate = eedate;
        });
        document.querySelectorAll('.event-time-end-event').forEach(function(e) {
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
        if (curreventtype == "assignment") {
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

function add_edit_todo( command="add", edit_todo=null) {
    $('.modal-title').html("Create New Todo")
    $('.modal-body').html(todo_create_template({'i': '1'}))

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
    r.send(JSON.stringify({'id': todo["id"]}));
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
    calendar_ = data["calendars"][e.parentElement.dataset.calendar]

    r = new XMLHttpRequest();
    r.open("GET", `${URLS['toggle_visibility']}?calendar=${calendar_["calendar"]["id"]}`);
    r.onload = () => {
        res = JSON.parse(r.responseText)
        if (res['status'] == 'success') {
            populate_calendar(m, y, true);
        }
        else {
            alert(res['data']);
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
            r.send(JSON.stringify({"name": $('.calendar-name').val(), "color": $('.calendar-color').val()}));
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
            r.open("GET", `${URLS['subscribe']}?code=` + subscribeCode)
            r.onload = () => {
                res = JSON.parse(r.responseText)
                if (res["status"] == "error") {
                    $('.subscribe-warn').html(res["data"])
                }
                else {
                    $('.modal-body').html(subscribe_confirm({"name": res["datasubscribename"], "owner": `${res["data"]["owner"]["first_name"]} ${res["data"]["owner"]["last_name"]}`}))
                    document.querySelector('.subscribe-confirm-btn').onclick = () => {
                        r = new XMLHttpRequest()
                        r.open("POST", `${URLS['subscribe']}?code=` + subscribeCode)
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
                                setTimeout(function() {
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

function display_day_info(ds) {
    ds.onclick = () => {
        setTimeout(function() {
            dp = ds.parentElement;
            dpd = dp.dataset.date

            $('.big-modal-title').html(dpd + " " + months[m]);

            $('.big-modal-body').html(`
                <table class="day-list">
                    <tbody class="day-list-tb">

                    </tbody>
                </table>

                <style>
                    .day-list .day-list-f {
                        border: 1px solid #e2e2e2;
                    }

                    .day-list-f td {
                        border-right: 1px solid #e2e2e2;
                    }

                    .day-list-f {
                        height: 20px;
                    }

                    .day-list-events {
                        width: 15%;
                    }

                    .day-list-time {
                        width: 10%;
                    }
                </style>
            `);

            cols = {};

            for(i = 0; i < 96; i++) {
                d__ = moment(new Date(`${dp.dataset.year} ${dp.dataset.month} ${dpd}`)).add(15 * i, "m").toDate()
                if (d__.getMinutes() == 0) { lbl = moment(d__).format('LT'); }
                else { lbl = ""; }

                $('.day-list-tb').append(`
                    <tr class="day-list-f day-list-${d__.getHours()}-${(String(d__.getMinutes())).padStart(2, "0")}">
                        <td class="day-list-time">
                            ${lbl}
                        </td>
                        <td class="day-list-events day-list-events-1">
                            
                        </td>
                        <td class="day-list-events day-list-events-2">
                            
                        </td>
                        <td class="day-list-events day-list-events-3">
                            
                        </td>
                        <td class="day-list-events day-list-events-4">
                            
                        </td>
                        <td class="day-list-events day-list-events-5">
                            
                        </td>
                    </tr>
                    <br>
                `)

                cols[`${d__.getHours()}-${(String(d__.getMinutes())).padStart(2, "0")}`] = [0, 0, 0, 0, 0]
            }

            for (ev of events["events"][dpd]) {
                evd = roundDate(new Date(ev["startdate"]), 15);
                evt = `${evd.getHours()}-${String(evd.getMinutes()).padStart(2, "0")}`
                cr = document.querySelector(`.day-list-${evt}`);

                col = 5;
                for (c = 0; c < 5; c++) {
                    if (cols[evt][c] == 0) {
                        col = c + 1;
                        cols[evt][c] = 1;
                        break;
                    }
                }

                cr.querySelector(`.day-list-events-${col}`).innerHTML += ev["name"] + "<br>";
                cr.querySelector(`.day-list-events-${col}`).style.backgroundColor = calendars[ev["calendar"]]["colour"];
                document.querySelector(`.day-list-${evt}`).style.borderBottom = "0";

                if (ev["enddate"] != "None")
                {
                    evd1 = roundDate(new Date(ev["enddate"]), 15);
                    for (i = evd.valueOf(); i < evd1.valueOf(); i += 1000 * 60 * 15) {
                        evd2 = new Date(i);
                        evt1 = `${evd2.getHours()}-${String(evd2.getMinutes()).padStart(2, "0")}`
                        cr = document.querySelector(`.day-list-${evt1}`);
                        cc = cr.querySelector(`.day-list-events-${col}`);
                        cc.style.backgroundColor = calendars[ev["calendar"]]["colour"]
                        cr.style.borderTop = "0";
                        cr.style.borderBottom = "0";
                        
                        cols[evt1][col - 1] = 1;
                    }

                    try {
                        cc.style.borderBottom = "1px solid #e2e2e2";
                    } catch {}
                }
            }
        }, 100)
    }
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

    for (i=0; i<daysInMonth(m, y); i++) {
        events["events"][i+1] = [];
        events["allday"][i+1] = [];
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
        cal_name = calendar_name({"id": c[i]["calendar"]["id"], "name": c[i]["calendar"]["name"], "calendar": i, "calendar-type": c[i]["calendar"]["calendar_type"], "checked": checked, "colour": c[i]['colour'], "owner": c[i]["subscribe_type"] == 0, "opacity": opacity, "admin": c[i]["subscribe_type"] == 1, "sync": c[i]["calendar"]["calendar_type"] != "0", "c_owner": c[i]["calendar"]["owner"] == USER_ID});

        if (c[i]["subscribe_type"] == 0) {
            document.querySelector('.calendarlist-mine').innerHTML += cal_name;
        }
        else {
            document.querySelector('.calendarlist-other').innerHTML += cal_name;
        }
    }

    if (localStorage.getItem('calendar_show_birthdays') == 1) {
        b = data["birthdays"]
        for (i = 0; i < b.length; i++)
        {
            date_ = new Date(b[i]["birthday"]).getUTCDate()
            dp = document.querySelector(`.day-events-${date_}`)
            var ci = calendar_item({'modal': false, 'calendar': "", 'i': i, 'type': "event", 'bg_color': "", 'color': '#000000;', 'bo_radius': '3px', 'text': `<span style="font-weight: normal;">🎂</span> ${b[i]['username']}'s Birthday`})
            dp.innerHTML += ci
        }
    }

    e = data["events"]
    for (i = 0; i < e.length; i++)
    {
        sd = new Date(e[i]['startdate'])
        ed = new Date(e[i]['enddate'])

        if (e[i]['category'] == 100) {
            icon = "";
        }
        else {
            icon = ICONS[e[i]['category']] + "&nbsp";
        }

        if (e[i]['enddate'] == null) {
            dp = document.querySelector(`.reg-events-${sd.getDate()}`)
            var ci = calendar_item({'modal': true, 'del': e[i]['completed'] == true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'color': calendars[e[i]['calendar']]['colour'], 'icon': icon, 'text': moment(sd).format('LT').replace(":00", "") + " - " + e[i]['name'], 'del': e[i]['completed'] == true})
            dp.innerHTML += ci

            events["events"][sd.getDate()].push(e[i]);
        }
        else if (sd.getMonth() == m && ed.getMonth() == m)
        {
            for (j = sd.getDate(); j <= ed.getDate(); j++)
            {
                if (sd.getDate() == ed.getDate()) {
                    dp = document.querySelector(`.reg-events-${j}`)
                    var ci = calendar_item({'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'color': calendars[e[i]['calendar']]['colour'], 'icon': icon, 'text': moment(sd).format('LT').replace(":00", "") + " - " + e[i]['name'], 'del': e[i]['completed'] == true})
                    dp.innerHTML += ci

                    events["events"][j].push(e[i]);
                }
                else if (e[i]['allday'] == true) {
                    if (j != ed.getDate()) {
                        dp = document.querySelector(`.day-events-${j}`)
                        var ci = calendar_item({'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': e[i]['name'], 'del': e[i]['completed'] == true})
                        dp.innerHTML += ci

                        events["allday"][j].push(e[i]);
                    }
                }
                else {
                    if (j == sd.getDate()) {prepend = moment(sd).format('LT').replace(":00", "") + " - "; events["events"][j].push(e[i]);}
                    else {prepend = ""}
                    dp = document.querySelector(`.day-events-${j}`)
                    var ci = calendar_item({'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': prepend + e[i]['name'], 'del': e[i]['completed'] == true})
                    dp.innerHTML += ci
                }
            }
        }
        else if (sd.getMonth() == m) {
            for (j = sd.getDate(); j <= daysInMonth(m, y); j++)
            {
                if (e[i]['allday'] == true) {
                    dp = document.querySelector(`.day-events-${j}`)
                    var ci = calendar_item({'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': e[i]['name'], 'del': e[i]['completed'] == true})
                    dp.innerHTML += ci

                    events["allday"][j].push(e[i]);
                }
                else {
                    if (j == sd.getDate()) {prepend = moment(sd).format('LT').replace(":00", "") + " - "; events["events"][j].push(e[i]);}
                    else {prepend = ""}
                    dp = document.querySelector(`.day-events-${j}`)
                    var ci = calendar_item({'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': prepend + e[i]['name'], 'del': e[i]['completed'] == true})
                    dp.innerHTML += ci
                }
            }
        }
        else if (ed.getMonth() == m) {
            for (j = 1; j <= ed.getDate(); j++)
            {
                if (e[i]["allday"] == true && j == ed.getDate()) {}
                else {
                    dp = document.querySelector(`.day-events-${j}`)
                    var ci = calendar_item({'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': e[i]['name'], 'del': e[i]['completed'] == true})
                    dp.innerHTML += ci
                }
            }
        }
        else {
            for (j = 1; j <= daysInMonth(m, y); j++)
            {
                dp = document.querySelector(`.day-events-${j}`)
                var ci = calendar_item({'modal': true, 'calendar': calendars[e[i]['calendar']], 'i': i, 'type': "event", 'bg_color': calendars[e[i]['calendar']]['colour'], 'color': '#f0f0f0', 'bo_radius': '3px', 'icon': icon, 'text': e[i]['name'], 'del': e[i]['completed'] == true})
                dp.innerHTML += ci
            }
        }
    }

    t = data["todos"]
    for (let [num, todo] of t.entries()) {
        if (todo["complete_by"] == null) { tn = `<span class="text-muted">${todo.name}</span>`}
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
                    var ci = calendar_item({'modal': false, 'calendar': [], 'i': num, 'type': "event", 'bg_color': "", 'color': '#000000;', 'bo_radius': '3px', 'del': todo["completed"] == true, 'text': `${TASK_ICON}&nbsp${ moment(cd).format('LT').replace(":00", "")} - ${todo.name}`});
                    dp.innerHTML += ci
                }
            }
        if (overdue == "5") { tn = `<span class="text-danger">⚠ ${todo.name}</span>` }
        else if (overdue == "2") { tn = `<span class="text-warning">${todo.name}</span>` }
        else if (overdue == "1") { tn = `<span class="text-info">${todo.name}</span>` }
        else { tn = `${todo.name}` } }
        if (todo["completed"] == false) {
            document.querySelector('.todo-list').innerHTML += todo_item({'id': todo.id, 'name': tn, 'i': num});
        }
    }

    document.querySelector('.habit-list').innerHTML = "";
    h = data["habits"]
    for (let [num, hab] of h.entries()) {
        document.querySelector('.habit-list').innerHTML += `

            <div class="card mb-1">
                <div class="card-body" data-habit-id="${hab['id']}" style="padding: 8px;">
                    <span class="card-title">${hab['name']}</span>

                    <div class="input-group input-group-sm" style="width: 50%;">
                        <input type="number" id="habitVal-${num}" class="form-control" value="1"/>
                        <button type="button" class="btn btn-primary" onclick="update_habit('${hab['id']}', this)">o</button>
                    </div>
                </div>
            </div>

        `;
    }

    for (h1 of data["habit_days"]) {

    }

    for (i of Object.entries(data["photos"])) { $(`.day-images-btn-${i[0]}`).html(i[1]); }

    change_height();

    hide_loading();
}

function populate_calendar(m, y, jumponload=false) {
    r = new XMLHttpRequest();
    r.open("GET", `${URLS['get_events']}?month=${m+1}&year=${y}&show_all=${localStorage.getItem('calendar_show_all')}&extra=${localStorage.getItem('calendar_extra')}`);
    r.onload = () => {
        data = JSON.parse(r.responseText.replace(/&#x27;/g,'"'))["data"];
        
        // Session Expired
        if (data == "Not logged in") {
            window.location.reload();
        }

        document.querySelector('.page-alert').style.display = "none";

        if (jumponload) {reload()};
        reload_calendar();
        lastrefresh = new Date();
        $('#last-refresh').html(moment(lastrefresh).format('LTS'));
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
    r.send(JSON.stringify({'id': todo["id"], 'completion': true}));
}

function display_info(button) {
    setTimeout(function() {
        event_ = data["events"][button.dataset.no]

        sd = new Date(event_["startdate"])
        ed = new Date(event_["enddate"])
        if (event_['sync_id'] != null) { title = `${event_['name']} <span class="text-muted"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-repeat" viewBox="0 0 16 16">
                <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
                <path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/>
            </svg></span>` }
        else { title = event_['name'] }
        $('.modal-title').html(title)

        if (event_["enddate"] == "None") {date_ = moment(sd).format('LLLL')}
        else if (event_["allday"] == true) {
            sd1 = moment(sd)
            ed1 = moment(ed).subtract(1, 'days')
            if (sd1.calendar() == ed1.calendar()) {date_ = moment(sd).format('LL')}
            else {date_ = moment(sd).format('LL') + " - " + moment(ed).format('LL')}
        }
        else {
            if (sd.getDate() == ed.getDate()) {date_ = moment(sd).format('LLL') + " - " + moment(ed).format('LT')}
            else {date_ = moment(sd).format('LLL') + " - " + moment(ed).format('LLL')}}
        if (localStorage.getItem('debug') == 1) {dev_info = `<br><i>Id: ${event_["id"]}</i>`}
        else {dev_info = ""}
        if (event_["description"] == "" || event_["description"] == null) {show_desc = false; desc = null}
        else {show_desc = true; desc = parse_message(event_["description"]);}

        if (event_["enddate"] == "None") {countdown = `<a href="/calendar/countdown/${event_["id"]}/start/">Countdown to Start</a>`}
        else {countdown = `<a href="/calendar/countdown/${event_["id"]}/start/">Countdown to Start</a> <a href="/calendar/countdown/${event_["id"]}/end/">Countdown to End</a>`}

        $('.modal-body').html(event_info_template({
            "date": date_,
            "calendar": `${calendars[event_["calendar"]]["calendar"]["name"]} [${event_["category"]}]`,
            "show_desc": show_desc, "description": desc, "location": value_or_empty(event_["location"]),
            "countdown": countdown,
            "dev_info": dev_info,
            "event_no": button.dataset.no,
            "owner": calendars[event_["calendar"]]["subscribe_type"] == 0 || calendars[event_["calendar"]]["subscribe_type"] == 1,
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
        r.onload = function() {
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
                document.querySelector('.invite-list').innerHTML += calendar_invite({"invite_no": no_invites, "invite": inv["id"], "calendar_id": calendar_["id"], "checked": temp, "invite_name": inv["code"]});
            }

            document.querySelector('.random-invite').onclick = function() { document.querySelector('.invite-text').value = randomText(8); }

            document.querySelector('.create-invite').onclick = function() {
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
            for (i=0; i<months.length; i++) {
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
        
        $('.calendar-sync-btn').click(function() {
            result = {
                "calendar": cal["calendar"]["id"],
                "sy": parseInt($('.calendar-sync-start-year').val()),
                "sm": parseInt($('.calendar-sync-start-month').val()) + 1,
                "ey": parseInt($('.calendar-sync-end-year').val()),
                "em": parseInt($('.calendar-sync-start-month').val()) + 1,
            }
            st = $('#calendar-sync-token').val();
            if (st != "") {result["token"] = st}
            
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
    }
    else {
        $('.modal-body').html("Only calendar owners and admins can sync it.")
    }
}

function unsubscribe(btn) {
    cal = data["calendars"][btn.parentElement.parentElement.dataset.calendar]
    var r = new XMLHttpRequest()
    r.open('POST', `${URLS['unsubscribe']}?calendar=${cal["id"]}`)
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
    r.open('POST', `${URLS['invite']}?code=${document.querySelector('.invite-text').value}&calendar=${c["id"]}&option=create`);
    r.setRequestHeader("X-CSRFToken", CSRF_TOKEN);
    r.onload = () => {
        res = JSON.parse(r.responseText);
        if (res["status"] === "error") { $('.invite-warn').html(res["data"]); }
        else
        {
            no_invites++;
            document.querySelector('.invite-list').innerHTML += calendar_invite({"invite_no": no_invites, "invite": res["data"]["id"], "calendar_id": c["id"], "checked": "checked", "invite_name": res["data"]["code"]});
            document.querySelector('.invite-text').value = "";
        }
    }
    r.send();
}

function toggle_invite(cb) {
    var r = new XMLHttpRequest()
    r.open('POST', `${URLS['invite']}?code=${cb.dataset.invite}&option=active`)
    r.setRequestHeader("X-CSRFToken", CSRF_TOKEN)
    r.onload = () => {
        res = JSON.parse(r.responseText)
        if (res["status"] === "error") { alert("Something went wrong on the server-side. Please try again.") }
        else
        {
            for (i=0; i<data["calendars"][cb.dataset.class]["invites"].length; i++)
            {
                if (data["calendars"][cb.dataset.class]["invites"][i]["id"] == cb.dataset.invite)
                {
                    if (data["calendars"][cb.dataset.class]["invites"][i]["active"] == true)
                    { data["calendars"][cb.dataset.class]["invites"][i]["active"] = false }
                    else
                    { data["calendars"][cb.dataset.class]["invites"][i]["active"] = true }
                }
            }
            cb.disabled = false
        }
    }
    request.send()
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
        request.send(JSON.stringify({"id": ev["id"], "days": $('#evDupDays').val()}))
    }
}

function update_habit(id, el) {
    val = el.parentElement.querySelector('input').value
    var request = new XMLHttpRequest()
    request.open('POST', `/calendar/habit/?habit=${id}`)
    request.setRequestHeader("X-CSRFToken", CSRF_TOKEN)
    request.onload = () => {
        res = JSON.parse(request.responseText);
        if (res["status"] === "success") {
            alert("Updated")
        }
        else {
            alert(res["data"])
        }
    }
    request.send(val)
}

function view_day_images(date) {
    $('.modal-title').html(`Images for ${date}-${m+1}-${y}`)
    $('.modal-body').html(`<iframe src="${window.origin}/photos/day/${y}/${m+1}/${date}/" style="width: 100%; height: 65vh;">`)
}

function view_event_images(evt) {
    $('.modal-title').html(`Images for ${evt['name']}`)
    $('.modal-body').html(`<iframe src="${window.origin}/photos/event/${evt['id']}/" style="width: 100%; height: 65vh;">`)
}

function randomText(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function convertUTCDateToLocalDate(date) {
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date;
}

function roundDate(date = new Date(), mins) {
    ms = 1000 * 60 * mins;
    nd = new Date(Math.ceil(date.getTime() / ms) * ms);
    return nd
}

function parse_message(text) {
    text = text.replace("\n", "<br>")
    var urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function(url) {
      return '<a href="' + url + '" target="blank">' + url + '</a>';
    })
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
    document.querySelector(opt).style.display = "block";
}

function hide_loading() {
    document.querySelector('.loading-screen').style.display = "none";
}

function go_prev() {
    m -= 1
    if (m == -1) {
        m = 11
        y -= 1
    }

    previous()
    make_holidays_red()
    populate_calendar(m, y)
}

function go_next() {
    m += 1
    if (m == 12) {
        m = 0
        y += 1
    }

    next()
    make_holidays_red()
    populate_calendar(m, y)
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
    d = new Date();
    mm = parseInt(d.getMonth())
    yy = parseInt(d.getFullYear())
    if (m == mm && y == yy) {}
    else {
        $('#month').val(mm);
        $('#year').val(yy);
        jump_();
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

    if (e.altKey)
    if (e.key == 'e') {
        e.preventDefault();
        localStorage.setItem('calendar_extra', prompt("Enter extra calendar code"));
        jump_();
    }
}
