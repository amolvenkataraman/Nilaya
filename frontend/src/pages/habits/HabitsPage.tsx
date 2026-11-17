// Habits: Today (one-tap check-ins), Progress (habits x days grid) and a page per habit with stats.
// Routes: /habits, /habits/progress, /habits/:id; ?new=1 opens the new-habit dialog. This file holds the
// sidebar, the app-wide shortcuts and the dialogs; the views are their own files.
import { useState } from 'react'
import { Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { layerOpen } from '../../components/layers'
import { Button, Dialog, SkeletonRows, useHotkey } from '../../components/ui'
import { cn } from '../../lib/cn'
import { dayKey } from '../../lib/dates'
import { useHabits, useToday, type Habit } from './api'
import { afterG } from './gPrefix'
import { GridView } from './GridView'
import { HabitBadge } from './HabitBadge'
import { HabitDetail } from './HabitDetail'
import { HabitDialog } from './HabitDialog'
import { HabitSettingsDialog } from './HabitSettingsDialog'
import { habitPage } from './page'
import { TodayView } from './TodayView'

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
  const free = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !e.altKey && !afterG(e) && !layerOpen(['dialog', 'palette', 'menu'])
  useHotkey(
    (e) => (e.key === 'n' || e.key === 'N') && free(e),
    (e) => {
      e.preventDefault()
      openNew()
    },
  )
  useHotkey(
    (e) => e.key === '?' && free(e),
    (e) => {
      e.preventDefault()
      setKeysOpen(true)
    },
  )
  // T / W: Today and the grid (the classic page's Today / Week tabs).
  useHotkey(
    (e) => (e.key === 't' || e.key === 'w') && free(e),
    (e) => {
      e.preventDefault()
      navigate(e.key === 't' ? '/habits' : '/habits/progress')
    },
  )
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
        action={
          <Button variant="ghost" size="sm" icon onClick={openNew} aria-label="New habit" title="New habit">
            <Icon name="plus" size={14} />
          </Button>
        }
      >
        {habits.isPending && <SkeletonRows rows={3} />}
        {habits.data?.length === 0 && <div className="side-empty">No habits yet.</div>}
        {habits.data?.map((h) => (
          <SideItem
            key={h.id}
            to={`/habits/${h.id}`}
            active={path === `/habits/${h.id}`}
            label={
              <span className="flex items-center gap-2">
                <HabitBadge habit={h} size={1.25} />
                <span className={cn('truncate', h.archived && 'text-muted')}>{h.name}</span>
              </span>
            }
          />
        ))}
      </SideSection>
      <SideSection>
        <SideItem icon="album" label={showArchived ? 'Hide archived' : 'Show archived'} onClick={() => setShowArchived((s) => !s)} />
        <SideItem icon="settings" label="Habit settings" onClick={() => setSettings(true)} />
      </SideSection>
    </>
  )

  const topbar = (
    <div className="flex w-full items-center justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        icon
        className="max-md:hidden touch:hidden"
        onClick={() => setKeysOpen(true)}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
      >
        <Icon name="command" size={16} />
      </Button>
      <Button variant="primary" size="sm" onClick={openNew} title="New habit (N)">
        <Icon name="plus" size={14} />
        New habit
      </Button>
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
        onSaved={(h) => {
          if (!editing) navigate(`/habits/${h.id}`, { replace: true })
        }}
      />
      {settings && <HabitSettingsDialog open onClose={() => setSettings(false)} />}
      <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
    </AppShell>
  )
}

const SHORTCUTS: [string[], string][] = [
  [['N'], 'New habit'],
  [['T'], 'Today'],
  [['W'], 'Progress grid'],
  [['J', 'K'], 'Move between habits (or ↓ ↑)'],
  [['Space'], 'Check off, or add to a measurable habit'],
  [['+', '−'], 'Add / subtract (measurable)'],
  [['S'], 'Skip or unskip today'],
  [['Enter'], 'Open stats and history'],
  [['E'], 'Edit the habit'],
  [['Alt', '↑', '↓'], 'Move the habit up / down'],
  [['Esc'], 'Back from a habit / close'],
  [['?'], 'This list'],
]

function KeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="26rem">
      <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} className="contents">
            <dt className="flex flex-wrap gap-1">
              {keys.map((k) => (
                <span key={k} className="kbd">
                  {k}
                </span>
              ))}
            </dt>
            <dd className="m-0">{label}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">On Today, the keys act on the highlighted habit (J / K, or click a row's empty space).</p>
    </Dialog>
  )
}

function DetailRoute({ onEdit }: { onEdit: (h: Habit) => void }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  useHotkey(
    (e) => e.key === 'Escape' && !layerOpen(['dialog', 'palette', 'menu']),
    () => navigate('/habits'),
  )
  return <HabitDetail key={id} id={id} onEdit={onEdit} />
}

function ProgressView() {
  const [search, setSearch] = useSearchParams()
  const range = search.get('range') === 'month' ? 'month' : 'week'
  const endParam = search.get('end') ?? ''
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endParam) ? endParam : dayKey(new Date())
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(search)
    next.set(k, v)
    setSearch(next, { replace: true })
  }
  return (
    <div className={habitPage(true)}>
      <header className="flex items-center gap-4">
        <h1>Progress</h1>
      </header>
      <GridView range={range} end={end} onRange={(r) => set('range', r)} onEnd={(d) => set('end', d)} />
    </div>
  )
}
