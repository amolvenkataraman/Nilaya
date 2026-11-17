// The calendar's keyboard: T today, J/K (or arrows, . and ,) move, M W D A views, N/C new event, S subscribe,
// Q quick task, I insights; Ctrl+←/→ move, Ctrl+Shift+←/→ a year (as in the classic calendar). Quiet while a
// dialog, menu or the palette is open, or the event form is.
import { useHotkey } from '../../components/ui'
import { layerOpen } from '../../components/layers'
import { addMonths } from '../../lib/dates'
import type { CalState } from './range'
import type { CalChange } from './useCalendarUrl'

export interface CalendarKeys {
  state: CalState
  /** The event form is open. */
  editing: boolean
  update: (c: CalChange) => void
  today: () => void
  go: (dir: number) => void
  newEvent: () => void
  quickEvent: () => void
  subscribe: () => void
  quickTask: () => void
  toggleInsights: () => void
}

export function useCalendarHotkeys(k: CalendarKeys) {
  const movable = k.state.view !== 'agenda'
  useHotkey(
    (e) => !e.metaKey && !e.ctrlKey && !e.altKey && !k.editing && !layerOpen(['dialog', 'palette', 'menu']),
    (e) => {
      const key = e.key
      if (key === 't') k.today()
      else if (key === 'j' || key === 'ArrowRight' || key === '.') movable && k.go(1)
      else if (key === 'k' || key === 'ArrowLeft' || key === ',' || key === 'p') movable && k.go(-1)
      else if (key === 'm') k.update({ view: 'month' })
      else if (key === 'w') k.update({ view: 'week' })
      else if (key === 'd') k.update({ view: 'day' })
      else if (key === 'a') k.update({ view: 'agenda' })
      else if (key === 'n') k.newEvent()
      else if (key === 'c') k.quickEvent()
      else if (key === 's') k.subscribe()
      else if (key === 'q') k.quickTask()
      else if (key === 'i') k.toggleInsights()
      else return
      e.preventDefault()
    },
  )
  useHotkey(
    (e) =>
      (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !k.editing && !layerOpen(['dialog']),
    (e) => {
      e.preventDefault()
      const dir = e.key === 'ArrowRight' ? 1 : -1
      if (e.shiftKey) k.update({ date: addMonths(k.state.date, 12 * dir) })
      else if (movable) k.go(dir)
    },
  )
}
