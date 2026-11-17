// Today's keyboard: J/K (or ↓/↑) move between habit rows, Space/X checks off (or adds one step), +/− change a
// measurable amount, Enter opens the habit, E edits, S skips today, Alt+↑/↓ moves the row. Keys act on the
// focused row; Space and Enter only when the row itself has focus, not a button inside it.
import { useNavigate } from 'react-router'
import { layerOpen } from '../../components/layers'
import { useHotkey } from '../../components/ui'
import { useCheck, type Habit, type TodayRow } from './api'
import { afterG } from './gPrefix'
import { stepOf, useSkipToday } from './HabitRow'

const focusedRowId = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-hid]')?.dataset.hid

export function useTodayHotkeys({
  rows,
  today,
  move,
  keepFocus,
  onEdit,
}: {
  rows: TodayRow[]
  today: string | undefined
  move: (id: string, dir: -1 | 1) => void
  keepFocus: (id: string) => void
  onEdit: (h: Habit) => void
}) {
  const check = useCheck()
  const skip = useSkipToday()
  const navigate = useNavigate()
  useHotkey(
    (e) => !e.metaKey && !e.ctrlKey && !layerOpen(['dialog', 'palette', 'menu']),
    (e) => {
      const id = focusedRowId()
      const r = id ? rows.find((x) => x.habit.id === id) : undefined
      if (e.altKey) {
        if (r && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          move(r.habit.id, e.key === 'ArrowUp' ? -1 : 1)
        }
        return
      }
      if (afterG(e)) return
      const onRow = !!id && (document.activeElement as HTMLElement | null)?.dataset.hid === id
      if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const els = Array.from(document.querySelectorAll<HTMLElement>('[data-habit-list] [data-hid]'))
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
        if (up || r.value > 0)
          check.mutate({ habit: r.habit, amount: up ? stepOf(r.habit) : -Math.min(stepOf(r.habit), r.value), current: r.value })
      } else if (r && onRow && e.key === 'Enter') {
        e.preventDefault()
        navigate(`/habits/${r.habit.id}`)
      } else if (r && e.key === 'e') {
        e.preventDefault()
        onEdit(r.habit)
      } else if (r && e.key === 's' && today) {
        e.preventDefault()
        keepFocus(r.habit.id)
        skip(r, today)
      }
    },
  )
}
