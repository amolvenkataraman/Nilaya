// Habits: Today (one-tap check-ins), Progress (habits x days grid) and a page per habit with stats.
// Routes: /habits, /habits/progress, /habits/:id; ?new=1 opens the new-habit dialog.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Dialog, ErrorBox, SkeletonRows, useHotkey } from '../../components/ui'
import { afterG } from '../contacts/util'
import { dayKey, fmtLongDate, parseDayKey } from '../../lib/dates'
import { useArchiveHabit, useCheck, useHabits, useReorder, useToday, type Habit, type TodayRow } from './api'
import { GridView } from './GridView'
import { HabitDetail } from './HabitDetail'
import { HabitDialog, HabitSettingsDialog } from './HabitDialog'
import { HabitRow, stepOf, useSkipToday } from './HabitsToday'
import { HabitBadge, HIcon, goalText, streakText } from './util'
import './habits.css'

export default function HabitsPage() {
  const [search, setSearch] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Habit | null>(null)
  const [settings, setSettings] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const habits = useHabits(showArchived)
  const today = useToday()
  const creating = search.get('new') === '1'
  const closeNew = () => {
    const next = new URLSearchParams(search)
    next.delete('new')
    setSearch(next, { replace: true })
  }
  const openNew = () => {
    const next = new URLSearchParams(search)
    next.set('new', '1')
    setSearch(next)
  }
  const free = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !e.altKey && !afterG(e) && !document.querySelector('.dialog,.palette,.menu')
  useHotkey((e) => (e.key === 'n' || e.key === 'N') && free(e), (e) => (e.preventDefault(), openNew()))
  useHotkey((e) => e.key === '?' && free(e), (e) => (e.preventDefault(), setKeysOpen(true)))
  // T / W: Today and the grid (the classic page's Today / Week tabs).
  useHotkey((e) => (e.key === 't' || e.key === 'w') && free(e), (e) => (e.preventDefault(), navigate(e.key === 't' ? '/habits' : '/habits/progress')))
  const path = location.pathname.replace(/\/+$/, '')
  const dueLeft = today.data ? today.data.left : undefined

  const sidebar = (
    <>
      <SideSection>
        <SideItem icon="sun" label="Today" to="/habits" active={path === '/habits'} count={dueLeft || undefined} />
        <SideItem icon="chart" label="Progress" to="/habits/progress" active={path === '/habits/progress'} />
      </SideSection>
      <SideSection
        title="Habits"
        action={<button className="btn ghost icon sm" onClick={openNew} aria-label="New habit" title="New habit"><Icon name="plus" size={14} /></button>}
      >
        {habits.isPending && <SkeletonRows rows={3} />}
        {habits.data?.length === 0 && <div className="side-empty">No habits yet.</div>}
        {habits.data?.map((h) => (
          <SideItem key={h.id} to={`/habits/${h.id}`} active={path === `/habits/${h.id}`} label={
            <span className="row" style={{ gap: '0.5rem' }}><HabitBadge habit={h} size={1.25} /><span className={'truncate' + (h.archived ? ' muted' : '')}>{h.name}</span></span>
          } />
        ))}
      </SideSection>
      <SideSection>
        <SideItem icon="album" label={showArchived ? 'Hide archived' : 'Show archived'} onClick={() => setShowArchived((s) => !s)} />
        <SideItem icon="settings" label="Habit settings" onClick={() => setSettings(true)} />
      </SideSection>
    </>
  )

  const topbar = (
    <div className="row h-top">
      <button className="btn ghost icon sm h-keys-btn" onClick={() => setKeysOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><Icon name="command" size={16} /></button>
      <button className="btn primary sm" onClick={openNew} title="New habit (N)"><Icon name="plus" size={14} />New habit</button>
    </div>
  )

  return (
    <AppShell app="habits" topbar={topbar} sidebar={sidebar}>
      <Routes>
        <Route index element={<TodayView onNew={openNew} onEdit={setEditing} />} />
        <Route path="progress" element={<ProgressView />} />
        <Route path=":id" element={<DetailRoute onEdit={setEditing} />} />
      </Routes>
      <HabitDialog
        open={creating || !!editing}
        habit={editing}
        onClose={() => (editing ? setEditing(null) : closeNew())}
        onSaved={(h) => { if (!editing) navigate(`/habits/${h.id}`, { replace: true }) }}
      />
      {settings && <HabitSettingsDialog open onClose={() => setSettings(false)} />}
      <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
    </AppShell>
  )
}

const SHORTCUTS: [string[], string][] = [
  [['N'], 'New habit'], [['T'], 'Today'], [['W'], 'Progress grid'], [['J', 'K'], 'Move between habits (or ↓ ↑)'],
  [['Space'], 'Check off, or add to a measurable habit'], [['+', '−'], 'Add / subtract (measurable)'], [['S'], 'Skip or unskip today'],
  [['Enter'], 'Open stats and history'], [['E'], 'Edit the habit'], [['Alt', '↑', '↓'], 'Move the habit up / down'],
  [['Esc'], 'Back from a habit / close'], [['?'], 'This list'],
]

function KeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="26rem">
      <dl className="h-keys-sheet">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{keys.map((k) => <span key={k} className="kbd">{k}</span>)}</dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <p className="help">On Today, the keys act on the highlighted habit (J / K, or click a row's empty space).</p>
    </Dialog>
  )
}

function DetailRoute({ onEdit }: { onEdit: (h: Habit) => void }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  useHotkey((e) => e.key === 'Escape' && !document.querySelector('.dialog,.palette,.menu'), () => navigate('/habits'))
  return <HabitDetail key={id} id={id} onEdit={onEdit} />
}

function ProgressView() {
  const [search, setSearch] = useSearchParams()
  const range = search.get('range') === 'month' ? 'month' : 'week'
  const end = /^\d{4}-\d{2}-\d{2}$/.test(search.get('end') ?? '') ? search.get('end')! : dayKey(new Date())
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(search)
    next.set(k, v)
    setSearch(next, { replace: true })
  }
  return (
    <div className="h-page wide">
      <header className="h-head"><h1>Progress</h1></header>
      <GridView range={range} end={end} onRange={(r) => set('range', r)} onEnd={(d) => set('end', d)} />
    </div>
  )
}

const noKeys = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !document.querySelector('.dialog,.palette,.menu')
const focusedRowId = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-hid]')?.dataset.hid

function TodayView({ onNew, onEdit }: { onNew: () => void; onEdit: (h: Habit) => void }) {
  const today = useToday()
  const reorder = useReorder()
  const check = useCheck()
  const skip = useSkipToday()
  const navigate = useNavigate()
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const refocus = useRef<string | null>(null)
  const loaded = today.data?.habits ?? []
  const rows = useMemo(() => {
    if (!dragOrder) return loaded
    const byId = new Map(loaded.map((r) => [r.habit.id, r]))
    return dragOrder.map((id) => byId.get(id)).filter((r): r is TodayRow => !!r)
  }, [loaded, dragOrder])
  const isDue = (r: TodayRow) => r.due && !r.habit.paused
  const due = rows.filter(isDue)
  const other = rows.filter((r) => !isDue(r))
  const t = today.data
  const pct = t && t.total ? t.done / t.total : 0
  // Best current streak (limits after goals on a tie), from Today alone like the classic page.
  const best = useMemo(() => [...loaded].sort((a, b) => b.streak - a.streak || (a.habit.goal === 'at_least' ? -1 : 1))[0], [loaded])

  /** Swap with the neighbour in the same section (due / not due). */
  const move = (id: string, dir: -1 | 1) => {
    const ids = rows.map((r) => r.habit.id)
    const row = rows.find((r) => r.habit.id === id)
    if (!row) return
    const section = (isDue(row) ? due : other).map((r) => r.habit.id)
    const nb = section[section.indexOf(id) + dir]
    if (!nb) return
    const i = ids.indexOf(id)
    const j = ids.indexOf(nb)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    keepFocus(id)
    reorder.mutate(ids)
  }
  /** Keep keyboard focus on a row that re-renders elsewhere (reordered, or moved between sections by a skip). */
  const keepFocus = (id: string) => {
    refocus.current = id
    window.setTimeout(() => refocus.current === id && (refocus.current = null), 3000)
  }
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    const el = document.querySelector<HTMLElement>(`[data-hid="${id}"]`)
    if (el && (!document.activeElement || document.activeElement === document.body)) el.focus()
  }, [rows])

  /** Drag a row by its grip within its own list; saved once on release. */
  const drag = (id: string) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const list = e.currentTarget.closest('.h-list')
    if (!list) return
    let full = rows.map((r) => r.habit.id)
    const startOrder = full.join()
    setDragOrder(full)
    const onMove = (ev: PointerEvent) => {
      const els = Array.from(list.querySelectorAll<HTMLElement>('[data-hid]'))
      const sec = els.map((el) => el.dataset.hid!)
      const rest = els.filter((el) => el.dataset.hid !== id)
      let at = rest.findIndex((el) => { const r = el.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2 })
      if (at < 0) at = rest.length
      const next = rest.map((el) => el.dataset.hid!)
      next.splice(at, 0, id)
      if (next.join() === sec.join()) return
      const slots = new Set(sec)
      let k = 0
      full = full.map((x) => (slots.has(x) ? next[k++] : x))
      setDragOrder(full)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('h-sorting')
      if (full.join() === startOrder) setDragOrder(null)
      else reorder.mutate(full, { onSettled: () => setDragOrder(null) })
    }
    document.body.classList.add('h-sorting')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  useHotkey(noKeys, (e) => {
    const id = focusedRowId()
    const r = id ? rows.find((x) => x.habit.id === id) : undefined
    if (e.altKey) {
      if (r && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) (e.preventDefault(), move(r.habit.id, e.key === 'ArrowUp' ? -1 : 1))
      return
    }
    if (afterG(e)) return
    const onRow = !!id && (document.activeElement as HTMLElement | null)?.dataset.hid === id // the row itself, not a button in it
    if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const els = Array.from(document.querySelectorAll<HTMLElement>('.h-page [data-hid]'))
      if (!els.length) return
      e.preventDefault()
      const cur = els.findIndex((el) => el.dataset.hid === id)
      const next = els[Math.max(0, Math.min(els.length - 1, cur < 0 ? 0 : cur + (e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1)))]
      next.focus()
      next.scrollIntoView({ block: 'nearest' })
    } else if (r && onRow && (e.key === ' ' || e.key === 'x')) {
      e.preventDefault()
      if (r.habit.kind === 'yesno') check.mutate({ habit: r.habit, current: r.value })
      else check.mutate({ habit: r.habit, amount: stepOf(r.habit), current: r.value })
    } else if (r && r.habit.kind === 'measurable' && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
      e.preventDefault()
      const up = e.key === '+' || e.key === '='
      if (up || r.value > 0) check.mutate({ habit: r.habit, amount: up ? stepOf(r.habit) : -Math.min(stepOf(r.habit), r.value), current: r.value })
    } else if (r && onRow && e.key === 'Enter') {
      e.preventDefault()
      navigate(`/habits/${r.habit.id}`)
    } else if (r && e.key === 'e') {
      e.preventDefault()
      onEdit(r.habit)
    } else if (r && e.key === 's' && t) {
      e.preventDefault()
      keepFocus(r.habit.id)
      skip(r, t.date)
    }
  })

  const rowProps = (r: TodayRow) => ({ row: r, today: t!.date, onEdit: () => onEdit(r.habit), onMove: (d: -1 | 1) => move(r.habit.id, d), onDrag: drag(r.habit.id) })
  return (
    <div className="h-page">
      <header className="h-head">
        <div className="grow">
          <h1>Today</h1>
          <p className="muted small">{t ? fmtLongDate(parseDayKey(t.date)) : ' '}</p>
        </div>
        {t && t.total > 0 && (
          <div className="h-ring" role="img" aria-label={`${t.done} of ${t.total} done`} style={{ ['--p' as string]: pct }}>
            <span className="tabular">{t.done}<small>/{t.total}</small></span>
          </div>
        )}
      </header>

      {t && loaded.length > 0 && (
        <div className="h-stats" aria-label="Summary">
          <div className="h-stat">
            <strong className="tabular">{best?.streak ? <><HIcon name="flame" size={0.9} />{best.streak}</> : '–'}</strong>
            <span className="truncate">{best?.streak ? `${streakText(best.streak, best.streak_unit).replace(/^\d+ /, '')} · ${best.habit.name}` : 'Best current streak'}</span>
          </div>
          <div className="h-stat">
            <strong className="tabular">{t.week_judged ? `${Math.round((t.week_done / t.week_judged) * 100)}%` : '–'}</strong>
            <span>Last 7 days</span>
          </div>
          {t.over > 0 && (
            <div className="h-stat over">
              <strong className="tabular">{t.over}</strong>
              <span>{t.over === 1 ? 'limit' : 'limits'} over</span>
            </div>
          )}
        </div>
      )}

      {today.isPending ? (
        <div className="card"><SkeletonRows rows={4} avatar /></div>
      ) : today.error && !t ? (
        <ErrorBox error={today.error} retry={() => today.refetch()} />
      ) : rows.length === 0 ? (
        <div className="card h-empty">
          <Icon name="repeat" size={28} />
          <p>Build a habit by checking it off every day.</p>
          <button className="btn primary" onClick={onNew}><Icon name="plus" size={14} />New habit</button>
        </div>
      ) : (
        <>
          <section className="card h-list" aria-label="Due today">
            {due.length === 0 && <div className="empty">Nothing scheduled today.</div>}
            {due.map((r) => <HabitRow key={r.habit.id} {...rowProps(r)} />)}
          </section>
          {other.length > 0 && (
            <section className="h-other" aria-label="Not due today">
              <h2 className="h-section-title">Not due today</h2>
              <div className="card h-list">
                {other.map((r) => <HabitRow key={r.habit.id} {...rowProps(r)} />)}
              </div>
            </section>
          )}
        </>
      )}
      {t && <ArchivedSection />}
      {rows.length > 0 && (
        <p className="help h-keys">
          <span className="kbd">N</span> new · <span className="kbd">J</span><span className="kbd">K</span> move between habits · <span className="kbd">Space</span> check off ·{' '}
          <span className="kbd">+</span><span className="kbd">−</span> amount · <span className="kbd">S</span> skip today · <span className="kbd">E</span> edit · <span className="kbd">?</span> all shortcuts
        </p>
      )}
    </div>
  )
}

function ArchivedSection() {
  const [open, setOpen] = useState(false)
  return (
    <section className="h-archived" aria-label="Archived habits">
      <button className="btn ghost sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />{open ? 'Hide archived' : 'Show archived'}
      </button>
      {open && <ArchivedList />}
    </section>
  )
}

function ArchivedList() {
  const all = useHabits(true)
  const archive = useArchiveHabit()
  const items = (all.data ?? []).filter((h) => h.archived)
  if (all.isPending) return <SkeletonRows rows={2} avatar />
  if (all.error && !all.data) return <ErrorBox error={all.error} retry={() => all.refetch()} />
  if (!items.length) return <p className="muted small h-archived-empty">Nothing archived.</p>
  return (
    <div className="card h-list">
      {items.map((h) => (
        <div key={h.id} className="h-row off">
          <HabitBadge habit={h} size={2} />
          <div className="h-main">
            <Link className="h-name truncate" to={`/habits/${h.id}`}>{h.name}</Link>
            <div className="h-sub"><span>{goalText(h)}</span></div>
          </div>
          <button className="btn sm" disabled={archive.isPending} onClick={() => archive.mutate({ id: h.id, archived: false })}>Unarchive</button>
        </div>
      ))}
    </div>
  )
}
