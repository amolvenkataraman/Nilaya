// Habits: Today (one-tap check-ins), Progress (habits x days grid) and a page per habit with stats.
// Routes: /habits, /habits/progress, /habits/:id; ?new=1 opens the new-habit dialog.
import { useMemo, useState } from 'react'
import { Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { dayKey, fmtLongDate, parseDayKey } from '../../lib/dates'
import { useHabits, useHabitsOverview, useReorder, useToday, type Habit } from './api'
import { GridView } from './GridView'
import { HabitDetail } from './HabitDetail'
import { HabitDialog, HabitSettingsDialog } from './HabitDialog'
import { HabitRow } from './HabitsToday'
import { HabitBadge, streakText } from './util'
import './habits.css'

export default function HabitsPage() {
  const [search, setSearch] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Habit | null>(null)
  const [settings, setSettings] = useState(false)
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
      <button className="btn primary sm" onClick={openNew}><Icon name="plus" size={14} />New habit</button>
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
    </AppShell>
  )
}

function DetailRoute({ onEdit }: { onEdit: (h: Habit) => void }) {
  const { id = '' } = useParams()
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

function TodayView({ onNew, onEdit }: { onNew: () => void; onEdit: (h: Habit) => void }) {
  const today = useToday()
  const overview = useHabitsOverview()
  const reorder = useReorder()
  const rows = today.data?.habits ?? []
  const due = rows.filter((r) => r.due && !r.habit.paused)
  const other = rows.filter((r) => !r.due || r.habit.paused)
  const pct = today.data && today.data.total ? today.data.done / today.data.total : 0
  const best = useMemo(() => [...(overview.data?.streaks ?? [])].filter((s) => s.current > 0).sort((a, b) => b.current - a.current).slice(0, 3), [overview.data])
  const move = (id: string, dir: -1 | 1) => {
    const ids = rows.map((r) => r.habit.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorder.mutate(ids)
  }
  return (
    <div className="h-page">
      <header className="h-head">
        <div className="grow">
          <h1>Today</h1>
          <p className="muted small">{today.data ? fmtLongDate(parseDayKey(today.data.date)) : ' '}</p>
        </div>
        {today.data && today.data.total > 0 && (
          <div className="h-ring" role="img" aria-label={`${today.data.done} of ${today.data.total} done`} style={{ ['--p' as string]: pct }}>
            <span className="tabular">{today.data.done}<small>/{today.data.total}</small></span>
          </div>
        )}
      </header>

      {overview.data && (
        <div className="h-summary">
          <span><strong className="tabular">{overview.data.week_rate === null ? '–' : `${Math.round(overview.data.week_rate * 100)}%`}</strong> this week</span>
          {best.map((s) => <span key={s.habit_id}><strong className="tabular">{streakText(s.current, s.unit)}</strong> {s.name}</span>)}
        </div>
      )}

      {today.isPending ? (
        <div className="card"><SkeletonRows rows={4} avatar /></div>
      ) : today.error && !today.data ? (
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
            {due.map((r) => <HabitRow key={r.habit.id} row={r} today={today.data!.date} onEdit={() => onEdit(r.habit)} onMove={(d) => move(r.habit.id, d)} />)}
          </section>
          {other.length > 0 && (
            <section className="h-other" aria-label="Not due today">
              <h2 className="h-section-title">Not due today</h2>
              <div className="card h-list">
                {other.map((r) => <HabitRow key={r.habit.id} row={r} today={today.data!.date} onEdit={() => onEdit(r.habit)} onMove={(d) => move(r.habit.id, d)} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
