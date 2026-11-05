/* Client copy of tasks/service.py parse_quick_add, used only for the live preview.
 * The server parses again on submit and is the source of truth. */

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const UNITS = { min: 60, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
const WORD = String.raw`(?:"([^"]+)"|(\S+))`;
export const PRIORITY_BY_BANG = [5, 10, 15, 20, 20];

function addMonths(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(d.getDate(), last));
    return x;
}

export function parseQuick(input, now = new Date()) {
    let text = input;
    const out = { labels: [], project: null, priority: null, due: null, repeatMode: 0, repeatEvery: null, repeatText: "" };
    const take = (re, fn) => {
        const m = re.exec(text);
        if (m) { fn(m); text = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim(); }
        return m;
    };

    while (take(new RegExp(String.raw`(?:^|\s)\*` + WORD, "i"), (m) => out.labels.push(m[1] || m[2]))) { /* all labels */ }
    take(new RegExp(String.raw`(?:^|\s)\+` + WORD, "i"), (m) => { out.project = m[1] || m[2]; });
    take(/(?:^|\s)!([1-5])\b/, (m) => { out.priority = PRIORITY_BY_BANG[+m[1] - 1]; });

    take(/\b(?:(every)\s+(\d+\s+)?(min(?:ute)?s?|hours?|days?|weeks?|months?|years?)|(daily|weekly|monthly|yearly))\b/i, (m) => {
        out.repeatText = m[0].toLowerCase();
        if (m[1]) {
            const n = parseInt(m[2] || "1", 10), unit = m[3].toLowerCase().replace(/s$/, "");
            if (unit === "month" && n === 1) out.repeatMode = 2;
            else { out.repeatMode = 1; out.repeatEvery = n * UNITS[unit]; }
        } else {
            const w = m[4].toLowerCase();
            if (w === "monthly") out.repeatMode = 2;
            else { out.repeatMode = 1; out.repeatEvery = { daily: 86400, weekly: 604800, yearly: 31536000 }[w]; }
        }
    });

    let day = null, clock = null;
    const tonight = /\btonight\b/i.test(text);  // checked before the word is stripped (matches the server)
    const setTime = (m) => {
        let hr = +m[1];
        const mn = +(m[2] || 0), ap = (m[3] || "").toLowerCase();
        if (ap === "pm" && hr < 12) hr += 12;
        if (ap === "am" && hr === 12) hr = 0;
        if (hr < 24 && mn < 60) clock = [hr, mn];
    };
    take(/\b(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b/i, setTime) || take(/\b(?:at\s+)?(\d{1,2})()\s*(am|pm)\b/i, setTime);

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const plus = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);

    take(/\b(?:today|tonight|tomorrow|next week|next month|this weekend|weekend)\b/i, (m) => {
        const w = m[0].toLowerCase();
        if (w === "today" || w === "tonight") day = today;
        else if (w === "tomorrow") day = plus(1);
        else if (w === "next week") day = plus(7);
        else if (w === "next month") day = addMonths(today, 1);
        else day = plus((5 - ((today.getDay() + 6) % 7) + 7) % 7);
    });
    if (!day) take(/\bin\s+(\d+)\s+(min(?:ute)?s?|hours?|days?|weeks?|months?)\b/i, (m) => {
        const unit = m[2].toLowerCase().replace(/s$/, "");
        const target = new Date(now.getTime() + +m[1] * UNITS[unit] * 1000);
        day = new Date(target.getFullYear(), target.getMonth(), target.getDate());
        if (unit === "min" || unit === "minute" || unit === "hour") clock = [target.getHours(), target.getMinutes()];
    });
    if (!day) take(/\b(?:on\s+)?(next\s+)?(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday)?\b/i, (m) => {
        const idx = WEEKDAYS.indexOf(m[2].toLowerCase().slice(0, 3)), wd = (today.getDay() + 6) % 7;
        day = plus(((idx - wd + 7) % 7) || 7);
    });
    if (!day) take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => {
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        if (d.getMonth() === +m[2] - 1) day = d;
    });
    if (!day) take(/\b(?:on\s+)?(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\b/i, (m) => {
        const mon = MONTHS.indexOf((m[1] || m[4]).toLowerCase().slice(0, 3)), d = +(m[2] || m[3]);
        let cand = new Date(today.getFullYear(), mon, d);
        if (cand.getMonth() !== mon) return;
        if (cand < today) cand = new Date(today.getFullYear() + 1, mon, d);
        day = cand;
    });

    if (!day && clock) day = (clock[0] * 60 + clock[1] > now.getHours() * 60 + now.getMinutes()) ? today : plus(1);
    if (day) {
        const [hr, mn] = clock || (tonight ? [20, 0] : [23, 59]);
        out.due = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hr, mn);
    }
    if (out.repeatMode && !out.due) out.due = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59);
    out.title = text.replace(/\s{2,}/g, " ").trim();
    return out;
}
