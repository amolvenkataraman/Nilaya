// AVNet Superapp Calendar: calendar settings (big modal), all through /api/v2/calendar/calendars/{id}.
// Everyone: their colour, visibility, notifications and busy-sharing. Owners/admins: the calendar itself,
// people, invites and sync. Owners: delete. Uses globals from script.js/pickers.js: v2(), toast(), plain(),
// colour_picker(), icon_picker(), CAL_APPEARANCE_READY, populate_calendar(), m, y. Text only via textContent.
'use strict';

function open_calendar_settings(calId) {
    const titleEl = document.querySelector('.big-modal-title');
    const body = document.querySelector('.big-modal-body');
    titleEl.textContent = 'Calendar settings';
    body.replaceChildren(cs_el('div', { class: 'sb-skeleton' }, [cs_el('div', { class: 'sb-skel-line' }), cs_el('div', { class: 'sb-skel-line' })]));
    $('#big-modal').modal('show');

    v2('GET', `/api/v2/calendar/calendars/${encodeURIComponent(calId)}`).then(cal => {
        titleEl.textContent = plain(cal.name);
        const editor = cal.role === 'owner' || cal.role === 'admin';
        const parts = [cs_mine(cal)];
        if (editor) parts.push(cs_calendar(cal), cs_people(cal), cs_invites(cal));
        if (editor && cal.calendar_type !== 0) parts.push(cs_sync(cal));
        if (cal.role === 'owner') parts.push(cs_danger(cal));
        body.replaceChildren(cs_el('div', { class: 'cs' }, parts));
    }).catch(err => {
        body.replaceChildren(cs_el('p', { class: 'cal-form-err', text: `Couldn't load the calendar settings. ${err.message || ''}` }));
    });
}

// ---------------------------------------------------------------- helpers
function cs_el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'value') node.value = v;
        else if (k === 'checked') node.checked = !!v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
}

let cs_uid = 0;
function cs_field(label, control, hint) {
    const id = control.id || `cs-f-${++cs_uid}`;
    if (!control.id && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) control.id = id;
    return cs_el('div', { class: 'cal-prop' + (control.classList && control.classList.contains('pk-swatches') || control.classList && control.classList.contains('pk-icons') ? ' cal-prop-top' : '') }, [
        cs_el(/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? 'label' : 'span', { class: 'cal-prop-k', for: /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? id : null, text: label }),
        cs_el('span', { class: 'cal-prop-v cal-stack' }, [control, hint ? cs_el('span', { class: 'cal-hint', text: hint }) : null]),
    ]);
}

function cs_switch(label, checked) {
    const input = cs_el('input', { type: 'checkbox', class: 'form-check-input', role: 'switch', checked });
    return { el: cs_el('label', { class: 'form-check form-switch cs-switch' }, [input, cs_el('span', { class: 'form-check-label', text: label })]), input };
}

function cs_section(title, children, foot) {
    return cs_el('section', { class: 'cs-sec' }, [cs_el('h3', { class: 'cs-h', text: title }), ...children, foot ? cs_el('div', { class: 'cs-foot' }, foot) : null]);
}

function cs_saver(label, run) {
    const msg = cs_el('span', { class: 'cal-hint', 'aria-live': 'polite' });
    const btn = cs_el('button', {
        type: 'button', class: 'btn btn-primary btn-sm', text: label, onclick: () => {
            btn.disabled = true;
            msg.textContent = '';
            Promise.resolve().then(run).then(() => { msg.textContent = 'Saved'; }).catch(err => { msg.textContent = err.message || "Couldn't save."; })
                .finally(() => { btn.disabled = false; });
        },
    });
    return [msg, btn];
}

function cs_patch(cal, body) {
    return v2('PATCH', `/api/v2/calendar/calendars/${encodeURIComponent(cal.id)}`, body).then(res => {
        Object.assign(cal, res);
        populate_calendar(m, y, true);
        return res;
    });
}

// ---------------------------------------------------------------- your settings (any subscriber)
function cs_mine(cal) {
    const colour = colour_picker({ name: `cs-my-colour-${cal.id}`, value: cal.my_colour || '', allowNone: true, noneLabel: 'Calendar colour' });
    const visible = cs_switch('Show in my calendar', cal.visible);
    const notify = cs_switch('Notify me about changes', cal.notify);
    const busy = cs_el('select', { class: 'form-select form-select-sm' }, [
        cs_el('option', { value: '0', text: 'Nothing' }), cs_el('option', { value: '1', text: 'Busy times of meetings, work and study' }), cs_el('option', { value: '2', text: 'Busy times of every event' }),
    ]);
    busy.value = String(cal.subscription ? cal.subscription.display_busy : 0);
    return cs_section('Your settings', [
        cs_field('Your colour', colour.el),
        cs_field('Visibility', visible.el),
        cs_field('Notifications', notify.el),
        cs_field('Availability page', busy, 'What your availability page shows from this calendar'),
    ], cs_saver('Save', () => cs_patch(cal, { my_colour: colour.get(), visible: visible.input.checked, notify: notify.input.checked, display_busy: parseInt(busy.value) })));
}

// ---------------------------------------------------------------- the calendar (owners/admins)
function cs_calendar(cal) {
    const name = cs_el('input', { type: 'text', class: 'form-control form-control-sm', value: plain(cal.name), maxlength: '64' });
    const desc = cs_el('textarea', { class: 'cal-textarea', rows: '3', maxlength: '2000' });
    desc.value = cal.description || '';
    const colour = colour_picker({ name: `cs-colour-${cal.id}`, value: cal.calendar_colour });
    let icon = icon_picker({ name: `cs-icon-${cal.id}`, value: cal.icon || '', colour: cal.calendar_colour });
    const iconWrap = cs_el('div', {}, [icon.el]);
    CAL_APPEARANCE_READY.then(() => { const fresh = icon_picker({ name: `cs-icon-${cal.id}`, value: icon.get(), colour: colour.get() }); iconWrap.replaceChildren(fresh.el); icon = fresh; });
    colour.el.addEventListener('change', () => icon.setColour(colour.get()));
    const tz = cs_el('input', { type: 'text', class: 'form-control form-control-sm', value: cal.time_zone || '', placeholder: 'Server time zone', maxlength: '64', list: 'cs-tz-list' });
    const tags = cs_el('input', { type: 'text', class: 'form-control form-control-sm', value: (cal.tags || []).join(', '), placeholder: 'school, family', maxlength: '300' });
    const pub = cs_switch('Anyone with the link can view it', cal.public);
    const active = cs_switch('Active (inactive calendars are hidden unless "Show all events" is on)', cal.active);
    const zones = (typeof Intl.supportedValuesOf === 'function') ? Intl.supportedValuesOf('timeZone') : [];
    const tzList = cs_el('datalist', { id: 'cs-tz-list' }, zones.map(z => cs_el('option', { value: z })));
    return cs_section('Calendar', [
        cs_field('Name', name),
        cs_field('Description', desc),
        cs_field('Colour', colour.el, 'Subscribers see this unless they pick their own'),
        cs_field('Icon', iconWrap),
        cs_field('Time zone', tz), tzList,
        cs_field('Tags', tags),
        cs_field('Public', pub.el),
        cs_field('Status', active.el),
    ], cs_saver('Save calendar', () => {
        if (!name.value.trim()) throw new Error('The calendar needs a name.');
        return cs_patch(cal, {
            name: name.value.trim(), description: desc.value, calendar_colour: colour.get() || cal.calendar_colour, icon: icon.get(),
            time_zone: tz.value.trim(), tags: tags.value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20),
            public: pub.input.checked, active: active.input.checked,
        });
    }));
}

// ---------------------------------------------------------------- people
function cs_people(cal) {
    const list = cs_el('ul', { class: 'cs-list' }, [cs_el('li', { class: 'cal-hint', text: 'Loading…' })]);
    const base = `/api/v2/calendar/calendars/${encodeURIComponent(cal.id)}/subscribers`;
    const load = () => v2('GET', base).then(subs => {
        list.replaceChildren(...subs.map(sub => {
            const u = sub.user || {};
            const who = `${plain(u.first_name || '')} ${plain(u.last_name || '')}`.trim() || u.username;
            const name = cs_el('span', { class: 'cs-name' }, [who, cs_el('span', { class: 'cal-hint', text: ` @${u.username || ''}` })]);
            if (sub.role === 'owner') return cs_el('li', {}, [name, cs_el('span', { class: 'cs-badge', text: 'Owner' })]);
            const role = cs_el('select', { class: 'form-select form-select-sm cs-role', 'aria-label': `Role of ${who}` }, [cs_el('option', { value: 'subscriber', text: 'Subscriber' }), cs_el('option', { value: 'admin', text: 'Admin' })]);
            role.value = sub.role;
            role.addEventListener('change', () => v2('PATCH', `${base}/${sub.id}`, { role: role.value }).then(() => toast('Role updated')).catch(err => { toast(err.message, true); load(); }));
            const remove = cs_el('button', {
                type: 'button', class: 'cal-icon-btn cs-remove', title: 'Remove from calendar', 'aria-label': `Remove ${who}`, text: '×',
                onclick: () => { if (confirm(`Remove ${who} from ${plain(cal.name)}?`)) v2('DELETE', `${base}/${sub.id}`).then(load).catch(err => toast(err.message, true)); },
            });
            return cs_el('li', {}, [name, role, remove]);
        }));
        if (!subs.length) list.replaceChildren(cs_el('li', { class: 'cal-hint', text: 'Nobody else yet. Share an invite code below.' }));
    }).catch(() => list.replaceChildren(cs_el('li', { class: 'cal-form-err', text: "Couldn't load people." })));
    load();
    return cs_section('People', [list]);
}

// ---------------------------------------------------------------- invites
function cs_invites(cal) {
    const list = cs_el('ul', { class: 'cs-list' }, [cs_el('li', { class: 'cal-hint', text: 'Loading…' })]);
    const base = `/api/v2/calendar/calendars/${encodeURIComponent(cal.id)}/invites`;
    const load = () => v2('GET', base).then(invs => {
        list.replaceChildren(...invs.map(inv => {
            const active = cs_el('input', { type: 'checkbox', class: 'form-check-input', checked: inv.active, 'aria-label': `Invite ${inv.code} active` });
            active.addEventListener('change', () => v2('PATCH', `${base}/${inv.id}`, { active: active.checked }).then(load).catch(err => { toast(err.message, true); load(); }));
            const meta = [inv.role === 'admin' ? 'Admin' : 'Subscriber', `${inv.uses}${inv.max_uses ? '/' + inv.max_uses : ''} used`,
                inv.expires_on ? `expires ${moment(inv.expires_on).format('MMM D, YYYY')}` : 'no expiry'].join(' · ');
            return cs_el('li', { class: inv.usable ? '' : 'is-unusable' }, [
                active,
                cs_el('span', { class: 'cs-name' }, [cs_el('code', { class: 'cs-code', text: inv.code }), cs_el('span', { class: 'cal-hint', text: ` ${meta}${inv.usable ? '' : ' · not usable'}` })]),
                cs_el('button', { type: 'button', class: 'cal-icon-btn', title: 'Copy code', 'aria-label': `Copy ${inv.code}`, text: '⧉', onclick: () => navigator.clipboard?.writeText(inv.code).then(() => toast('Copied')) }),
                cs_el('button', { type: 'button', class: 'cal-icon-btn cs-remove', title: 'Delete invite', 'aria-label': `Delete invite ${inv.code}`, text: '×', onclick: () => v2('DELETE', `${base}/${inv.id}`).then(load).catch(err => toast(err.message, true)) }),
            ]);
        }));
        if (!invs.length) list.replaceChildren(cs_el('li', { class: 'cal-hint', text: 'No invite codes.' }));
    }).catch(() => list.replaceChildren(cs_el('li', { class: 'cal-form-err', text: "Couldn't load invites." })));
    load();
    const code = cs_el('input', { type: 'text', class: 'form-control form-control-sm', placeholder: 'Code (blank = random)', maxlength: '8', pattern: '[A-Za-z0-9_-]{4,8}', 'aria-label': 'Invite code' });
    const role = cs_el('select', { class: 'form-select form-select-sm', 'aria-label': 'Role' }, [cs_el('option', { value: 'subscriber', text: 'Subscriber' }), cs_el('option', { value: 'admin', text: 'Admin' })]);
    const days = cs_el('input', { type: 'number', class: 'form-control form-control-sm', min: '1', max: '3650', placeholder: 'Days', 'aria-label': 'Expires in days (blank = never)' });
    const maxUses = cs_el('input', { type: 'number', class: 'form-control form-control-sm', min: '1', placeholder: 'Max uses', 'aria-label': 'Maximum uses (blank = unlimited)' });
    const msg = cs_el('span', { class: 'cal-hint', 'aria-live': 'polite' });
    const create = cs_el('button', {
        type: 'button', class: 'btn btn-primary btn-sm', text: 'Create invite', onclick: () => {
            const body = { role: role.value };
            const c = code.value.trim();
            if (c) { if (!/^[A-Za-z0-9_-]{4,8}$/.test(c)) { msg.textContent = 'Codes are 4–8 letters, digits, _ or -.'; return; } body.code = c; }
            if (days.value) body.expires_in_days = Math.max(1, Math.min(3650, parseInt(days.value)));
            if (maxUses.value) body.max_uses = Math.max(1, parseInt(maxUses.value));
            v2('POST', base, body).then(() => { code.value = days.value = maxUses.value = ''; msg.textContent = 'Created'; load(); }).catch(err => { msg.textContent = err.message; });
        },
    });
    return cs_section('Invites', [list, cs_el('div', { class: 'cs-invite-new' }, [code, role, days, maxUses, create]), msg]);
}

// ---------------------------------------------------------------- sync
function cs_sync(cal) {
    const sync = cal.sync || {};
    const url = cs_el('input', { type: 'url', class: 'form-control form-control-sm', value: sync.url || '', placeholder: 'https://…/calendar.ics', maxlength: '256' });
    const auto = cs_switch('Sync automatically', sync.auto_sync);
    const past = cs_el('input', { type: 'number', class: 'form-control form-control-sm cs-num', min: '0', max: '120', value: String(sync.past_months ?? 1) });
    const future = cs_el('input', { type: 'number', class: 'form-control form-control-sm cs-num', min: '0', max: '120', value: String(sync.future_months ?? 6) });
    const status = cs_el('p', { class: 'cal-hint cs-sync-status' });
    const showStatus = (at, error) => {
        status.textContent = (at ? `Last synced ${moment(at).fromNow()}` : 'Never synced') + (error ? ` · Last error: ${error}` : '');
        status.classList.toggle('is-error', !!error);
    };
    showStatus(sync.last_synced_at, sync.last_error);
    const now = cs_el('button', {
        type: 'button', class: 'cal-btn', text: 'Sync now', onclick: () => {
            now.disabled = true;
            v2('POST', `/api/v2/calendar/calendars/${encodeURIComponent(cal.id)}/sync`).then(r => {
                showStatus(r.last_synced_at, r.last_sync_error);
                toast(r.not_modified ? 'Already up to date' : r.ok ? 'Synced' : "Sync didn't finish", !r.ok);
                if (r.ok && !r.not_modified) populate_calendar(m, y, true);
            }).catch(err => toast(err.message || "Couldn't sync.", true)).finally(() => { now.disabled = false; });
        },
    });
    return cs_section('Sync', [
        cs_field('Source', url),
        cs_field('Automatic', auto.el),
        cs_field('Months back', past),
        cs_field('Months ahead', future),
        status,
    ], [now, ...cs_saver('Save sync settings', () => {
        const u = url.value.trim();
        if (u && !/^(https?|webcal):\/\//i.test(u)) throw new Error('The source must be an http(s) or webcal link.');
        return cs_patch(cal, { sync: { url: u, auto_sync: auto.input.checked, past_months: parseInt(past.value) || 0, future_months: parseInt(future.value) || 0 } });
    })]);
}

// ---------------------------------------------------------------- delete (owner)
function cs_danger(cal) {
    const confirmIn = cs_el('input', { type: 'text', class: 'form-control form-control-sm', placeholder: plain(cal.name), autocomplete: 'off', 'aria-label': 'Type the calendar name to confirm' });
    const del = cs_el('button', { type: 'button', class: 'btn btn-outline-danger btn-sm', text: 'Delete calendar', disabled: true });
    confirmIn.addEventListener('input', () => { del.disabled = confirmIn.value !== plain(cal.name); });
    del.addEventListener('click', () => {
        del.disabled = true;
        v2('DELETE', `/api/v2/calendar/calendars/${encodeURIComponent(cal.id)}?confirm=${encodeURIComponent(cal.name)}`).then(() => {
            $('#big-modal').modal('hide');
            toast(`Deleted "${plain(cal.name)}"`);
            populate_calendar(m, y, true);
        }).catch(err => { toast(err.message, true); del.disabled = false; });
    });
    return cs_section('Delete calendar', [
        cs_el('p', { class: 'cal-hint', text: `Deletes "${plain(cal.name)}" and all its events for everyone. Type its name to confirm.` }),
        cs_el('div', { class: 'cs-danger-row' }, [confirmIn, del]),
    ]);
}
