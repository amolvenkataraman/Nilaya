// One habit: today's check-in, streaks, rates, score trend, a year heat map, weekdays and notes.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { Confirm, ErrorBox, Menu, MenuItem, SkeletonRows, useHotkey } from '../../components/ui'
import { Columns } from '../../components/charts'
import { addDays, fmtDate, fmtTime } from '../../lib/dates'
import { useArchiveHabit, useDeleteHabit, useHabits, usePauseHabit, useStats, useToday, type Habit, type Stats } from './api'
import { DayDialog, type DayTarget } from './DayEditor'
import { HabitCheck, progressText } from './HabitsToday'
import { HabitBadge, HIcon, WEEKDAY_LETTERS, fmtNum, goalText, hc, parseDay, scheduleText, streakText } from './util'

/** "20:00:00" -> the app's time format. */
const clock = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return fmtTime(new Date(2000, 0, 1, h, m))
}
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`)

export function HabitDetail({ id, onEdit }: { id: string; onEdit: (h: Habit) => void }) {
  const all = useHabits(true)
  const habit = all.data?.find((h) => h.id === id)
  const stats = useStats(habit ? id : undefined)
  const today = useToday()
  const row = today.data?.habits.find((r) => r.habit.id === id)
  const pause = usePauseHabit()
  const archive = useArchiveHabit()
  const remove = useDeleteHabit()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [day, setDay] = useState<DayTarget | null>(null)
  useHotkey((e) => e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey && !!habit && !document.querySelector('.dialog,.palette,.menu'), (e) => (e.preventDefault(), habit && onEdit(habit)))

  if (all.isPending) return <div className="h-page"><SkeletonRows rows={6} /></div>
  if (all.error && !all.data) return <div className="h-page"><ErrorBox error={all.error} /></div>
  if (!habit) return <div className="h-page"><div className="empty">That habit doesn't exist any more.</div></div>
  const s = stats.data

  return (
    <div className="h-page" style={hc(habit)}>
      <header className="h-detail-head">
        <HabitBadge habit={habit} size={3} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h1 className="truncate">{habit.name}</h1>
          <p className="muted small">
            {goalText(habit)}
            {habit.period !== 'day' || habit.kind === 'measurable' ? ` · ${scheduleText(habit)}` : ''}
            {habit.reminder_time && ` · Reminder ${clock(habit.reminder_time)}`}
            {` · Since ${fmtDate(parseDay(habit.start_date), { month: 'short', day: 'numeric', year: 'numeric' })}`}
            {habit.end_date && ` until ${fmtDate(parseDay(habit.end_date), { month: 'short', day: 'numeric', year: 'numeric' })}`}
            {habit.paused && ' · Paused'}
            {habit.archived && ' · Archived'}
          </p>
        </div>
        {row && !habit.archived && (
          <div className="h-detail-check">
            {progressText(row) && <span className="muted small tabular">{progressText(row)}</span>}
            <HabitCheck row={row} />
          </div>
        )}
        <button className="btn sm" onClick={() => onEdit(habit)} title="Edit (E)"><Icon name="edit" size={14} />Edit</button>
        <Menu align="end" label="Habit actions" trigger={(p) => <button {...p} className="btn icon sm" aria-label="More actions"><Icon name="more" size={14} /></button>}>
          {(close) => (
            <>
              <MenuItem icon={habit.paused ? 'play' : 'clock'} onClick={() => (close(), pause.mutate({ id: habit.id, paused: !habit.paused }))}>
                {habit.paused ? 'Resume' : 'Pause'}
              </MenuItem>
              <MenuItem icon="album" onClick={() => (close(), archive.mutate({ id: habit.id, archived: !habit.archived }))}>{habit.archived ? 'Restore from archive' : 'Archive'}</MenuItem>
              <div className="menu-sep" />
              <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete habit</MenuItem>
            </>
          )}
        </Menu>
      </header>
      {habit.description && <p className="h-desc pre-wrap">{habit.description}</p>}

      {stats.error && !stats.data ? (
        <ErrorBox error={stats.error} retry={() => stats.refetch()} />
      ) : !s ? (
        <div className="h-tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="card h-tile"><span className="sk" style={{ height: '2.5rem' }} /></div>)}</div>
      ) : (
        <>
          <div className="h-tiles">
            <div className="card h-tile">
              <span className="label">Current streak</span>
              <span className="h-tile-value"><HIcon name="flame" size={1.1} />{s.current_streak}<small>{streakText(s.current_streak, s.streak_unit).replace(/^\d+ /, '')}</small></span>
            </div>
            <div className="card h-tile">
              <span className="label">Best streak</span>
              <span className="h-tile-value">{s.best_streak}<small>{streakText(s.best_streak, s.streak_unit).replace(/^\d+ /, '')}</small></span>
            </div>
            <div className="card h-tile">
              <span className="label">Habit strength</span>
              <span className="h-tile-value">{Math.round(s.score)}<small>/ 100</small></span>
              <span className="h-bar" aria-hidden="true"><span style={{ width: `${s.score}%` }} /></span>
            </div>
            <div className="card h-tile">
              <span className="label">Completion</span>
              <span className="h-tile-value">{pct(s.rates.d30)}<small>30 days</small></span>
              <span className="muted xsmall">7 d {pct(s.rates.d7)} · 90 d {pct(s.rates.d90)} · all {pct(s.rates.all)}</span>
            </div>
          </div>

          <section className="card h-section" aria-labelledby="heat-h">
            <div className="card-head"><h2 id="heat-h">Last 12 months</h2></div>
            <div className="card-body"><Heatmap stats={s} habit={habit} /></div>
          </section>

          <div className="h-two">
            <section className="card h-section" aria-labelledby="trend-h">
              <div className="card-head"><h2 id="trend-h">Strength over time</h2></div>
              <div className="card-body"><ScoreTrend points={s.score_trend} /></div>
            </section>
            <section className="card h-section" aria-labelledby="wd-h">
              <div className="card-head"><h2 id="wd-h">By weekday</h2></div>
              <div className="card-body">
                {s.weekdays.some((w) => w.judged) ? (
                  <Columns
                    title="Completion by weekday"
                    values={s.weekdays.map((w) => (w.rate ?? 0) * 100)}
                    labels={WEEKDAY_LETTERS}
                    format={(v) => `${Math.round(v)}%`}
                    height={96}
                  />
                ) : <div className="empty left">Not enough history yet.</div>}
              </div>
            </section>
          </div>

          {habit.kind === 'measurable' && (
            <section className="card h-section" aria-labelledby="tot-h">
              <div className="card-head"><h2 id="tot-h">Totals{habit.unit ? ` (${habit.unit})` : ''}</h2></div>
              <dl className="h-totals card-body">
                <div><dt>This week</dt><dd>{fmtNum(s.totals.week)}</dd></div>
                <div><dt>This month</dt><dd>{fmtNum(s.totals.month)}</dd></div>
                <div><dt>All time</dt><dd>{fmtNum(s.totals.total)}</dd></div>
                <div><dt>Daily average</dt><dd>{s.totals.average === null ? '–' : fmtNum(Math.round(s.totals.average * 10) / 10)}</dd></div>
                <div><dt>Best day</dt><dd>{s.totals.best === null ? '–' : fmtNum(s.totals.best)}</dd></div>
                <div><dt>Days logged</dt><dd>{s.totals.days}</dd></div>
              </dl>
            </section>
          )}

          <section className="card h-section" aria-labelledby="notes-h">
            <div className="card-head">
              <h2 id="notes-h">Notes</h2>
              <span className="spacer" />
              {row && !habit.archived && !s.notes.some((n) => n.date === s.today) && (
                <button className="btn ghost sm" onClick={() => setDay({ habit, day: s.today, value: row.value, skipped: row.skipped, note: row.note, focus: 'note' })}>
                  <Icon name="plus" size={14} />Note for today
                </button>
              )}
            </div>
            {s.notes.length ? (
              <ul className="h-notes">
                {s.notes.map((n) => (
                  <li key={n.date}>
                    <button className="h-note-date muted xsmall tabular" title="Edit this day"
                      onClick={() => setDay({ habit, day: n.date, value: n.value, skipped: n.skipped, note: n.note, focus: 'note' })}>
                      {fmtDate(parseDay(n.date), { month: 'short', day: 'numeric', year: 'numeric' })}
                    </button>
                    <span className="pre-wrap small">{n.note}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="empty left">No notes yet. Add one from Today or the Progress grid (right-click or long-press a day).</div>}
          </section>
        </>
      )}
      <Confirm
        open={confirm}
        title={`Delete "${habit.name}"?`}
        body="All of its history is deleted too. Archive it instead to keep the stats."
        onConfirm={() => remove.mutate(habit.id, { onSuccess: () => navigate('/habits') })}
        onClose={() => setConfirm(false)}
      />
      <DayDialog target={day} onClose={() => setDay(null)} />
    </div>
  )
}

/** GitHub-style year grid: one column per week (Monday first), single hue with 4 steps. */
function Heatmap({ stats, habit }: { stats: Stats; habit: Habit }) {
  const { start, levels, values } = stats.heatmap
  const first = parseDay(start)
  const lead = (first.getDay() + 6) % 7 // rows are Mon..Sun
  const weeks = Math.ceil((lead + levels.length) / 7)
  const C = 11
  const G = 2
  const top = 14
  const left = 18
  const W = left + weeks * (C + G)
  const H = top + 7 * (C + G)
  const months: { x: number; label: string }[] = []
  let lastMonth = -1
  for (let w = 0; w < weeks; w++) {
    const d = addDays(first, w * 7 - lead + 6)
    if (d.getMonth() !== lastMonth && d.getDate() <= 7) {
      months.push({ x: left + w * (C + G), label: fmtDate(d, { month: 'short' }) })
      lastMonth = d.getMonth()
    }
  }
  const unit = habit.unit ? ' ' + habit.unit : ''
  return (
    <div className="h-heat-wrap">
      <svg className="h-heat" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${habit.name}: daily history for the last year`} style={{ minWidth: `${W / 16}rem` }}>
        <defs>
          <pattern id="h-skip" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" className="h-heat-hatch" strokeWidth="1.5" />
          </pattern>
        </defs>
        {months.map((m) => <text key={m.x} x={m.x} y={9} className="h-heat-label">{m.label}</text>)}
        {[0, 2, 4].map((r) => <text key={r} x={0} y={top + r * (C + G) + 9} className="h-heat-label">{['M', '', 'W', '', 'F'][r]}</text>)}
        {Array.from(levels).map((ch, i) => {
          if (ch === '-') return null
          const n = i + lead
          const x = left + Math.floor(n / 7) * (C + G)
          const y = top + (n % 7) * (C + G)
          const d = addDays(first, i)
          const v = values[i]
          const desc = ch === 's' ? 'skipped' : ch === 'o' ? 'not scheduled' : v ? fmtNum(v) + (habit.kind === 'measurable' ? unit : '') : 'not done'
          return (
            <rect key={i} x={x} y={y} width={C} height={C} rx={2.5} className={'hl-' + ch}>
              <title>{`${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}: ${desc}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="h-heat-legend xsmall muted">
        Less <svg viewBox="0 0 66 11" width="4.125rem" height="0.6875rem" aria-hidden="true">{['0', '1', '2', '3', '4'].map((l, i) => <rect key={l} x={i * 13} y={0} width={11} height={11} rx={2.5} className={'hl-' + l} />)}</svg> More
        <span className="h-heat-key"><svg viewBox="0 0 11 11" width="0.6875rem" height="0.6875rem" aria-hidden="true"><rect width={11} height={11} rx={2.5} className="hl-s" /></svg> Skipped</span>
      </div>
    </div>
  )
}

function ScoreTrend({ points }: { points: { date: string; score: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const data = useMemo(() => points.slice(-120), [points])
  if (data.length < 2) return <div className="empty left">Check in for a few days to see a trend.</div>
  const W = 320
  const H = 110
  const pad = { l: 22, r: 6, t: 8, b: 16 }
  const x = (i: number) => pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b)
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join('')
  const area = `${line}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
  const h = hover !== null ? data[hover] : null
  return (
    <svg
      className="h-trend"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Habit strength from ${Math.round(data[0].score)} to ${Math.round(data[data.length - 1].score)} out of 100`}
      onMouseMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        const px = ((e.clientX - r.left) / r.width) * W
        setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1)))))
      }}
      onMouseLeave={() => setHover(null)}
    >
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="h-trend-grid" />
          <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="h-trend-label">{v}</text>
        </g>
      ))}
      <path d={area} className="h-trend-area" />
      <path d={line} className="h-trend-line" />
      <text x={pad.l} y={H - 3} className="h-trend-label">{fmtDate(parseDay(data[0].date))}</text>
      <text x={W - pad.r} y={H - 3} textAnchor="end" className="h-trend-label">{fmtDate(parseDay(data[data.length - 1].date))}</text>
      {h && hover !== null && (
        <g>
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} className="h-trend-cross" />
          <circle cx={x(hover)} cy={y(h.score)} r={3.5} className="h-trend-dot" />
          <text x={Math.min(Math.max(x(hover), pad.l + 30), W - 40)} y={pad.t + 8} textAnchor="middle" className="h-trend-read">
            {fmtDate(parseDay(h.date))}: {Math.round(h.score)}
          </text>
        </g>
      )}
    </svg>
  )
}
