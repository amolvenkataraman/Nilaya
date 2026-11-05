// AVNet Superapp Calendar: colour and icon pickers (same look and palette as the Habits editor) and the
// calendar/event icon set. Icons are constant path data on a 16px stroke grid, never user input.
'use strict';

// Habits palette (habits/static/habits/charts.js), plus the app's teal. [hex, label]
const CAL_COLOURS = [
    ['#0f6d77', 'Teal'], ['#2a78d6', 'Blue'], ['#6250d6', 'Violet'], ['#e87ba4', 'Pink'], ['#e34948', 'Red'],
    ['#eb6834', 'Orange'], ['#eda100', 'Yellow'], ['#008300', 'Green'], ['#1baf7a', 'Aqua'], ['#64748b', 'Slate'],
];

const CAL_ICONS = {
    // shared with Habits
    drop: 'M8 2s4.5 4.8 4.5 8a4.5 4.5 0 0 1-9 0C3.5 6.8 8 2 8 2z',
    book: 'M2.5 3c2-.6 3.9-.4 5.5.8 1.6-1.2 3.5-1.4 5.5-.8v10c-2-.6-3.9-.4-5.5.8-1.6-1.2-3.5-1.4-5.5-.8zM8 3.8v10',
    run: 'M9.5 3.5a1 1 0 1 0 0-.01M6 14l2-4 2 2v2.5M5 8l2.5-2.5h3l1.5 2.5h2M8 10 7 6',
    dumbbell: 'M1.5 8h13M4 5v6M12 5v6M2.5 6.5v3M13.5 6.5v3',
    leaf: 'M3 13c0-6 4-10 10.5-10.5C13 9 9 13 3 13zM3 13l6-6',
    moon: 'M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z',
    heart: 'M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z',
    pen: 'M10.5 2.5l3 3-8 8H2.5v-3zM9 4l3 3',
    coffee: 'M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM11 7h1.5a1.5 1.5 0 0 1 0 3H11M5.5 2.5v1.5M8 2.5v1.5',
    sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
    music: 'M6 12V3.5l7-1.5v8.5M6 12a2 2 0 1 1-2-2 2 2 0 0 1 2 2zM13 10.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2z',
    // calendar
    briefcase: 'M2 5.5h12v7.5H2zM5.5 5.5V3.5h5v2M2 9h12',
    home: 'M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5M6.5 13V9.5h3V13',
    school: 'M1.5 6 8 3l6.5 3L8 9zM4 7.3V11c1 1 2.5 1.5 4 1.5s3-.5 4-1.5V7.3M14.5 6v4',
    users: 'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 13.5c.4-2.3 2.2-3.5 4.5-3.5s4.1 1.2 4.5 3.5M11 2.8a2.3 2.3 0 0 1 0 4.4M12.5 10.3c1 .5 1.8 1.6 2 3.2',
    plane: 'M14 2 7.5 8.5M14 2l-4 12-2.5-5.5L2 6z',
    star: 'M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z',
    cake: 'M2.5 14h11V8.5h-11zM2.5 11c1.5 1 2.5-1 3.7 0s2.4 1 3.6 0 2.2-1 3.7 0M8 8.5V6M8 3.5c.6.5.6 1.4 0 1.8-.6-.4-.6-1.3 0-1.8z',
    car: 'M2.5 11V8.5l1.5-4h8l1.5 4V11zM2.5 11v1.5M13.5 11v1.5M5 8.5h.01M11 8.5h.01M4 8.5h8',
    video: 'M2 4.5h8.5v7H2zM10.5 7l3.5-2v6l-3.5-2',
    phone: 'M5.5 2h5v12h-5zM7.5 12h1',
    flag: 'M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8',
    pin: 'M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14zM8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    bell: 'M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3',
    gift: 'M2.5 6.5h11v2.5h-11zM3.5 9v4.5h9V9M8 6.5v7M8 6.5C6.5 6.5 5 6 5 4.7S7 3.5 8 6.5zM8 6.5c1.5 0 3-.5 3-1.8S9 3.5 8 6.5z',
    cart: 'M1.5 2.5h2l1.5 8h7.5l1.5-5.5H4.3M6 13.5h.01M12 13.5h.01',
    code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10',
};

// Icon names the server accepts (GET /api/v2/calendar/icons when available), else every local icon.
let CAL_ICON_NAMES = Object.keys(CAL_ICONS);
// Event/calendar colour + icon fields exist on the server (schema update). Checked once per page load.
var CAL_APPEARANCE = false;
var CAL_APPEARANCE_READY = fetch('/api/v2/calendar/icons', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : null)
    .then(list => {
        if (!Array.isArray(list)) return;
        const names = list.map(x => typeof x === 'string' ? x : (x && (x.name || x.id))).filter(n => n in CAL_ICONS);
        if (names.length) CAL_ICON_NAMES = names;
        CAL_APPEARANCE = true;
    })
    .catch(() => { });

// Static SVG markup for an icon name ('' for unknown names).
function cal_icon_svg(name, size = 14) {
    if (!Object.prototype.hasOwnProperty.call(CAL_ICONS, name)) return '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${CAL_ICONS[name]}"/></svg>`;
}

function cal_hex(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : '';
}

// Colour swatches. `allowNone` adds a "calendar colour" choice (value ''). Returns {el, get()}.
function colour_picker({ name, value = '', allowNone = false, noneLabel = 'Calendar colour' }) {
    const wrap = document.createElement('div');
    wrap.className = 'pk-swatches';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', 'Colour');
    const current = cal_hex(value);
    const add = (hex, label) => {
        const lab = document.createElement('label');
        lab.className = 'pk-swatch' + (hex ? '' : ' is-none');
        lab.title = label;
        if (hex) lab.style.setProperty('--c', hex);
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = hex;
        input.checked = hex === current;
        input.setAttribute('aria-label', label);
        const dot = document.createElement('span');
        dot.className = 'pk-c-bg';
        lab.append(input, dot);
        wrap.appendChild(lab);
    };
    if (allowNone) add('', noneLabel);
    CAL_COLOURS.forEach(([hex, label]) => add(hex, label));
    // Custom colour (keeps any existing non-palette colour).
    const custom = document.createElement('label');
    custom.className = 'pk-swatch pk-custom';
    custom.title = 'Custom colour';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = 'custom';
    radio.setAttribute('aria-label', 'Custom colour');
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'pk-custom-input';
    colour.setAttribute('aria-label', 'Pick a custom colour');
    const inPalette = !current || CAL_COLOURS.some(([hex]) => hex === current);
    colour.value = current || '#0f6d77';
    radio.checked = !inPalette;
    custom.style.setProperty('--c', colour.value);
    colour.addEventListener('input', () => { radio.checked = true; custom.style.setProperty('--c', colour.value); });
    custom.append(radio, colour);
    wrap.appendChild(custom);
    if (!allowNone && !wrap.querySelector('input:checked')) wrap.querySelector('input').checked = true;
    return {
        el: wrap,
        get() {
            const sel = wrap.querySelector(`input[name="${name}"]:checked`);
            if (!sel) return '';
            return sel.value === 'custom' ? cal_hex(colour.value) : sel.value;
        },
    };
}

// Icon grid with a "none" choice. Returns {el, get()}.
function icon_picker({ name, value = '', colour = '' }) {
    const wrap = document.createElement('div');
    wrap.className = 'pk-icons';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', 'Icon');
    if (cal_hex(colour)) wrap.style.setProperty('--c', colour);
    const add = (key) => {
        const lab = document.createElement('label');
        lab.className = 'pk-iconpick';
        lab.title = key || 'No icon';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = key;
        input.checked = (value || '') === key;
        input.setAttribute('aria-label', key || 'No icon');
        const face = document.createElement('span');
        if (key) face.innerHTML = cal_icon_svg(key, 16);  // static markup
        else face.textContent = '–';
        lab.append(input, face);
        wrap.appendChild(lab);
    };
    add('');
    CAL_ICON_NAMES.forEach(add);
    return {
        el: wrap,
        get() { const sel = wrap.querySelector(`input[name="${name}"]:checked`); return sel ? sel.value : ''; },
        setColour(hex) { if (cal_hex(hex)) wrap.style.setProperty('--c', hex); else wrap.style.removeProperty('--c'); },
    };
}
