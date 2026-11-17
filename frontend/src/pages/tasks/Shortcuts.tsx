// Tasks keyboard shortcuts (the classic Tasks page's keys) as one command table: each command names the
// keys it answers and the line it shows in the "?" help, so the help can't drift from what the keys do.
// One window keydown listener in the capture phase, so on this page "/" and "q" reach the page's own
// search and quick add before the app-wide shortcuts; "g" stays shared (g + an app letter still works
// unless the letter is one of the Tasks "go to" keys below).
import { useEffect, useRef } from 'react'
import { layerOpen } from '../../components/layers'
import { Dialog, isTyping } from '../../components/ui'
import type { SmartView } from '../../lib/qs'
import { Kbd } from './chip'
import type { LayoutName } from './useTasksUrl'

type Group = 'General' | 'Tasks' | 'Go to' | 'Layout'
export type CommandId =
  | 'quickAdd'
  | 'search'
  | 'help'
  | 'focus'
  | 'sidebar'
  | 'escape'
  | 'move'
  | 'open'
  | 'select'
  | 'edit'
  | 'complete'
  | 'favourite'
  | 'dueToday'
  | 'priority'
  | 'delete'
  | 'selectAll'
  | 'go'
  | 'layout'

interface Command {
  id: CommandId
  group: Group
  /** Keys as typed ("g i" is g, then i). */
  shown: string
  label: string
  /** Event keys it answers; a "g"/"v" prefix arrives as "g:i", Ctrl/Cmd+A as "ctrl+a". */
  keys: string[]
  /** For go/layout: the view or layout. */
  arg?: string
}

const go = (key: string, view: SmartView, label: string): Command => ({
  id: 'go',
  group: 'Go to',
  shown: `g ${key}`,
  label,
  keys: [`g:${key}`],
  arg: view,
})
const layout = (key: string, name: LayoutName, label: string): Command => ({
  id: 'layout',
  group: 'Layout',
  shown: `v ${key}`,
  label,
  keys: [`v:${key}`],
  arg: name,
})

export const COMMANDS: readonly Command[] = [
  { id: 'quickAdd', group: 'General', shown: 'q', label: 'Quick add', keys: ['q', 'n'] },
  { id: 'search', group: 'General', shown: '/', label: 'Search', keys: ['/'] },
  { id: 'help', group: 'General', shown: '?', label: 'Show shortcuts', keys: ['?'] },
  { id: 'focus', group: 'General', shown: 'f', label: 'Focus mode', keys: ['f'] },
  { id: 'sidebar', group: 'General', shown: '[', label: 'Toggle sidebar', keys: ['['] },
  { id: 'escape', group: 'General', shown: 'Esc', label: 'Close / clear selection', keys: ['Escape'] },
  { id: 'move', group: 'Tasks', shown: 'j / k', label: 'Next / previous', keys: ['j', 'k', 'ArrowDown', 'ArrowUp'] },
  { id: 'open', group: 'Tasks', shown: 'Enter', label: 'Open details', keys: ['Enter', 'o'] },
  { id: 'select', group: 'Tasks', shown: 'x', label: 'Select', keys: ['x'] },
  { id: 'edit', group: 'Tasks', shown: 'e', label: 'Edit title', keys: ['e'] },
  { id: 'complete', group: 'Tasks', shown: 'd', label: 'Complete', keys: ['d'] },
  { id: 'favourite', group: 'Tasks', shown: 's', label: 'Favourite', keys: ['s'] },
  { id: 'dueToday', group: 'Tasks', shown: 't', label: 'Due today', keys: ['t'] },
  { id: 'priority', group: 'Tasks', shown: '1 – 4', label: 'Priority low → urgent', keys: ['1', '2', '3', '4'] },
  { id: 'delete', group: 'Tasks', shown: 'Del', label: 'Delete', keys: ['Delete', 'Backspace'] },
  { id: 'selectAll', group: 'Tasks', shown: 'Ctrl A', label: 'Select all', keys: ['ctrl+a'] },
  go('i', 'inbox', 'Inbox'),
  go('t', 'today', 'Today'),
  go('u', 'upcoming', 'Upcoming'),
  go('o', 'overdue', 'Overdue'),
  go('n', 'nodate', 'No date'),
  go('f', 'favorites', 'Favourites'),
  go('a', 'assigned', 'Assigned to me'),
  go('d', 'done', 'Completed'),
  layout('l', 'list', 'List'),
  layout('b', 'board', 'Board'),
  layout('t', 'table', 'Table'),
  layout('c', 'calendar', 'Calendar'),
  layout('g', 'timeline', 'Timeline'),
]

const GROUPS: readonly Group[] = ['General', 'Tasks', 'Go to', 'Layout']

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="40rem">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-x-6 gap-y-4">
        {GROUPS.map((g) => (
          <section key={g}>
            <h3 className="mb-1.5 text-xs tracking-[0.05em] text-muted uppercase">{g}</h3>
            <dl className="m-0 grid gap-1">
              {COMMANDS.filter((c) => c.group === g).map((c) => (
                <div key={c.shown} className="flex items-center gap-3 text-sm">
                  <dt className="flex min-w-22 items-center gap-1 text-muted">
                    {c.shown.split(' ').map((part, i) =>
                      (part === '/' && c.shown !== '/') || part === '–' ? (
                        // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed string
                        <span key={i}> {part} </span>
                      ) : (
                        // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed string
                        <Kbd key={i}>{part}</Kbd>
                      ),
                    )}
                  </dt>
                  <dd className="m-0">{c.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

/** What each command does on this page: return false when it doesn't apply now (the key then passes on). */
export type CommandHandlers = Record<CommandId, (key: string, arg?: string) => boolean>

const byKey = new Map(COMMANDS.flatMap((c) => c.keys.map((k) => [k, c] as const)))

/** Runs the matching command for plain key presses outside fields and dialogs. A handled key is stopped
 *  (Escape keeps propagating, so overlays below still see it). */
export function useTaskKeys(handlers: CommandHandlers) {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    const run = (key: string) => {
      const c = byKey.get(key)
      return !!c && ref.current[c.id](key, c.arg)
    }
    let prefix: string | null = null
    let timer = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || isTyping(e)) return
      // Keys typed inside a dialog, menu or popover belong to it (not the task drawer: j/k and d work there).
      if ((e.target as HTMLElement | null)?.closest?.('.dialog,.menu')) return
      if (layerOpen(['dialog', 'menu']) && e.key !== 'Escape') return
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'a' && run('ctrl+a')) e.preventDefault()
        return
      }
      if (prefix) {
        const p = prefix
        prefix = null
        clearTimeout(timer)
        if (run(`${p}:${e.key}`)) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      if (e.key === 'g' || e.key === 'v') {
        prefix = e.key
        timer = window.setTimeout(() => {
          prefix = null
        }, 1200)
        if (e.key === 'v') e.stopPropagation()
        return // "g" also reaches the app-wide "go to app" shortcut
      }
      if (run(e.key)) {
        e.preventDefault()
        if (e.key !== 'Escape') e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(timer)
    }
  }, [])
}
