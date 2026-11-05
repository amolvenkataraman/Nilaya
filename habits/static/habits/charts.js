/* Habits charts in plain SVG: progress ring, year heatmap, score sparkline, weekday bars.
 * Marks carry the habit colour (--c); all text uses text tokens. Each chart has an aria summary and
 * per-mark hover/focus tooltips (data-tip, shown by tooltip() below). */

import { svg, h, addDays, fmtFull, fmtShort, fmtMonth, WEEKDAYS, num, pct } from "./lib.js";

// ------------------------------------------------------------------ habit colours
// The validated categorical palette (light / dark steps); "" = the app accent.
export const COLOURS = [
    ["", "Teal", "", ""],
    ["#2a78d6", "Blue", "#2a78d6", "#3987e5"],
    ["#6250d6", "Violet", "#6250d6", "#9085e9"],
    ["#e87ba4", "Pink", "#e87ba4", "#d55181"],
    ["#e34948", "Red", "#e34948", "#e66767"],
    ["#eb6834", "Orange", "#eb6834", "#d95926"],
    ["#eda100", "Yellow", "#eda100", "#c98500"],
    ["#008300", "Green", "#008300", "#008300"],
    ["#1baf7a", "Aqua", "#1baf7a", "#199e70"],
];

/** Style props that give an element its habit colour in both themes (CSS picks --hc or --hc-d). */
export function colourVars(hex) {
    const row = COLOURS.find((c) => c[0] === hex);
    if (!hex) return {};
    return { "--hc": hex, "--hc-d": row ? row[3] : hex };
}

// ------------------------------------------------------------------ tooltip

let tip;
export function initTooltip() {
    tip = h("div.hb-tip", { role: "tooltip", hidden: true });
    document.body.append(tip);
    const show = (el) => {
        tip.textContent = el.dataset.tip;
        tip.hidden = false;
        const r = el.getBoundingClientRect();
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        tip.style.left = Math.max(6, Math.min(r.left + r.width / 2 - tw / 2, innerWidth - tw - 6)) + "px";
        tip.style.top = (r.top - th - 6 < 4 ? r.bottom + 6 : r.top - th - 6) + "px";
    };
    const hide = () => { tip.hidden = true; };
    document.addEventListener("pointerover", (e) => { const el = e.target.closest?.("[data-tip]"); el ? show(el) : hide(); });
    document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); el ? show(el) : hide(); });
    document.addEventListener("scroll", hide, true);
    document.addEventListener("pointerdown", hide);
}

// ------------------------------------------------------------------ ring

/** Progress ring (0..1) with an optional centre label. */
export function ring(frac, size = 64, stroke = 6, label = "") {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
    const el = svg("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: "hb-ring", "aria-hidden": "true" },
        svg("circle", { cx: size / 2, cy: size / 2, r, class: "hb-ring-bg", "stroke-width": stroke, fill: "none" }),
        f > 0 && svg("circle", { cx: size / 2, cy: size / 2, r, class: "hb-ring-fg", "stroke-width": stroke, fill: "none",
            "stroke-linecap": "round", "stroke-dasharray": `${(f * c).toFixed(2)} ${c.toFixed(2)}`,
            transform: `rotate(-90 ${size / 2} ${size / 2})` }));
    if (label) el.append(svg("text", { x: "50%", y: "50%", "dominant-baseline": "central", "text-anchor": "middle", class: "hb-ring-text" }, label));
    return el;
}

// ------------------------------------------------------------------ heatmap

const LEVEL_WORD = { 0: "Not done", 1: "A little", 2: "Partly", 3: "Most of the way", 4: "Done", s: "Skipped", o: "Not scheduled" };

/** GitHub-style year: 53 Monday-first weeks, one cell per day. */
export function heatmap(stats, habit) {
    const { start, levels, values } = stats.heatmap;
    const cell = 11, gap = 3, top = 16, left = 26;
    const weeks = Math.ceil(levels.length / 7);
    const W = left + weeks * (cell + gap), H = top + 7 * (cell + gap);
    const unit = habit.kind === "measurable" ? ` ${habit.unit || ""}`.trimEnd() : "";
    let done = 0;
    for (const ch of levels) if (ch === "4") done++;
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "hb-heat", role: "img",
        "aria-label": `${habit.name}: the last 12 months, ${done} days at goal` });
    for (const [i, label] of [[0, "Mon"], [2, "Wed"], [4, "Fri"]]) {
        root.append(svg("text", { x: 0, y: top + i * (cell + gap) + cell - 2, class: "hb-axis" }, label));
    }
    let lastMonth = "";
    for (let i = 0; i < levels.length; i++) {
        const day = addDays(start, i), w = Math.floor(i / 7), d = i % 7, ch = levels[i];
        if (d === 0) {
            const m = fmtMonth(day);
            if (m !== lastMonth && w < weeks - 1) {
                if (lastMonth || day.slice(8) <= "07") root.append(svg("text", { x: left + w * (cell + gap), y: 10, class: "hb-axis" }, m));
                lastMonth = m;
            }
        }
        if (ch === "-") {
            root.append(svg("rect", { x: left + w * (cell + gap), y: top + d * (cell + gap), width: cell, height: cell, rx: 2, class: "hb-heat-c l-" }));
            continue;
        }
        const v = values[i];
        const what = LEVEL_WORD[ch] ?? "";
        const amount = v != null && habit.kind === "measurable" ? ` · ${num(v)}${unit}` : "";
        root.append(svg("rect", { x: left + w * (cell + gap), y: top + d * (cell + gap), width: cell, height: cell, rx: 2,
            class: `hb-heat-c l${ch}`, "data-tip": `${fmtFull(day)} · ${what}${amount}` }));
    }
    return root;
}

export function heatLegend() {
    return h("div.hb-heat-legend", { "aria-hidden": "true" },
        h("span", "Less"),
        ...["0", "1", "2", "3", "4"].map((l) => h(`span.hb-heat-key.l${l}`)),
        h("span", "More"),
        h("span.hb-heat-key.ls"), h("span", "Skipped"));
}

// ------------------------------------------------------------------ sparkline

/** Score trend: a 2px line with a wash, end dot and end label; hover a point for its value. */
export function sparkline(points, { width = 320, height = 72 } = {}) {
    const pad = { l: 4, r: 34, t: 8, b: 16 };
    const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "hb-spark", role: "img",
        "aria-label": points.length ? `Score over ${points.length} weeks, from ${Math.round(points[0].score)} to ${Math.round(points.at(-1).score)}` : "No score yet" });
    if (points.length < 2) return root;
    const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
    const x = (i) => pad.l + (i / (points.length - 1)) * iw;
    const y = (s) => pad.t + ih - (s / 100) * ih;
    for (const g of [0, 50, 100]) root.append(svg("line", { x1: pad.l, x2: pad.l + iw, y1: y(g), y2: y(g), class: "hb-gridline" }));
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join("");
    root.append(svg("path", { d: `${d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: "hb-spark-area" }));
    root.append(svg("path", { d, class: "hb-spark-line" }));
    const last = points.at(-1);
    root.append(svg("circle", { cx: x(points.length - 1), cy: y(last.score), r: 4, class: "hb-spark-dot" }));
    root.append(svg("text", { x: x(points.length - 1) + 8, y: y(last.score) + 4, class: "hb-spark-label" }, Math.round(last.score)));
    root.append(svg("text", { x: pad.l, y: height - 3, class: "hb-axis" }, fmtShort(points[0].date)));
    root.append(svg("text", { x: pad.l + iw, y: height - 3, class: "hb-axis", "text-anchor": "end" }, "Now"));
    const step = iw / (points.length - 1);
    points.forEach((p, i) => root.append(svg("rect", { x: x(i) - step / 2, y: pad.t, width: step, height: ih, class: "hb-hit",
        "data-tip": `Week of ${fmtShort(addDays(p.date, -6))} · score ${Math.round(p.score)}` })));
    return root;
}

// ------------------------------------------------------------------ weekday bars

/** Completion by weekday (daily goals) or days done (week/month goals). */
export function weekdayBars(weekdays, habit) {
    const width = 320, height = 120, pad = { l: 4, r: 4, t: 18, b: 18 };
    const useRate = habit.period === "day";
    const vals = weekdays.map((w) => (useRate ? w.rate : w.done));
    const max = useRate ? 1 : Math.max(1, ...vals.map((v) => v || 0));
    const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b, band = iw / 7, bw = Math.min(24, band - 8);
    const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "hb-bars", role: "img",
        "aria-label": "By weekday: " + weekdays.map((w, i) => `${WEEKDAYS[i]} ${useRate ? pct(w.rate) : w.done}`).join(", ") });
    root.append(svg("line", { x1: pad.l, x2: pad.l + iw, y1: pad.t + ih, y2: pad.t + ih, class: "hb-gridline" }));
    const best = Math.max(...vals.map((v) => v || 0));
    weekdays.forEach((w, i) => {
        const v = vals[i] || 0, bh = Math.max(v > 0 ? 3 : 0, (v / max) * ih);
        const x0 = pad.l + i * band + (band - bw) / 2, y0 = pad.t + ih - bh, r = Math.min(4, bh);
        if (bh > 0) {
            root.append(svg("path", { class: "hb-bar" + (v === best && v > 0 ? " is-best" : ""),
                d: `M${x0},${pad.t + ih}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${pad.t + ih}Z` }));
        }
        const label = useRate ? (w.rate == null ? "–" : `${Math.round(w.rate * 100)}`) : String(w.done);
        root.append(svg("text", { x: x0 + bw / 2, y: Math.min(y0, pad.t + ih) - 4, class: "hb-bar-val", "text-anchor": "middle" }, label));
        root.append(svg("text", { x: x0 + bw / 2, y: height - 4, class: "hb-axis", "text-anchor": "middle" }, WEEKDAYS[i]));
        const avg = w.average != null && habit.kind === "measurable" ? ` · avg ${num(w.average)} ${habit.unit || ""}` : "";
        root.append(svg("rect", { x: pad.l + i * band, y: pad.t, width: band, height: ih, class: "hb-hit",
            "data-tip": useRate ? `${WEEKDAYS[i]} · ${w.done} of ${w.judged} at goal (${pct(w.rate)})${avg}` : `${WEEKDAYS[i]} · ${w.done} days logged${avg}` }));
    });
    return root;
}
