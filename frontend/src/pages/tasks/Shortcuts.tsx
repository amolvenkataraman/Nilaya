// Tasks keyboard shortcuts (same keys as the classic Tasks page) and the "?" help dialog.
// One window keydown listener in the capture phase, so on this page "/" and "q" reach the page's own
// search and quick add before the app-wide shortcuts; "g" stays shared (g + an app letter still works
// unless the letter is one of the Tasks "go to" keys below).
import { useEffect, useRef } from 'react'
import { Dialog, isTyping } from '../../components/ui'

export const HELP: [string, [string, string][]][] = [
  ['General', [['q', 'Quick add'], ['/', 'Search'], ['?', 'Show shortcuts'], ['f', 'Focus mode'], ['[', 'Toggle sidebar'], ['Esc', 'Close / clear selection']]],
  ['Tasks', [['j / k', 'Next / previous'], ['Enter', 'Open details'], ['x', 'Select'], ['e', 'Edit title'], ['d', 'Complete'], ['s', 'Favourite'],
    ['t', 'Due today'], ['1 – 4', 'Priority low → urgent'], ['Del', 'Delete'], ['Ctrl A', 'Select all']]],
  ['Go to', [['g i', 'Inbox'], ['g t', 'Today'], ['g u', 'Upcoming'], ['g o', 'Overdue'], ['g n', 'No date'], ['g f', 'Favourites'], ['g a', 'Assigned to me'], ['g d', 'Completed']]],
  ['Layout', [['v l', 'List'], ['v b', 'Board'], ['v t', 'Table'], ['v c', 'Calendar'], ['v g', 'Timeline']]],
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="40rem">
      <div className="kb-help">
        {HELP.map(([title, rows]) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl>
              {rows.map(([k, d]) => (
                <div key={k} className="kb-row">
                  <dt>{k.split(' ').map((part, i) => (part === '/' && k !== '/') || part === '–' ? <span key={i}> {part} </span> : <kbd key={i} className="kbd">{part}</kbd>)}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

export type KeyHandler = (key: string, e: KeyboardEvent) => boolean | void

/**
 * Calls `handle(key)` for plain key presses outside fields and dialogs; "g x" and "v x" arrive as
 * "g:x" / "v:x". Return true when handled (the event is then stopped, except Escape).
 */
export function useTaskKeys(handle: KeyHandler) {
  const ref = useRef(handle)
  ref.current = handle
  useEffect(() => {
    let prefix: string | null = null
    let timer = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || isTyping(e)) return
      if ((e.target as HTMLElement | null)?.closest?.('.dialog,.menu')) return
      if (document.querySelector('.dialog,.menu') && e.key !== 'Escape') return
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'a' && ref.current('ctrl+a', e)) e.preventDefault()
        return
      }
      if (prefix) {
        const p = prefix
        prefix = null
        clearTimeout(timer)
        if (ref.current(`${p}:${e.key}`, e)) { e.preventDefault(); e.stopPropagation() }
        return
      }
      if (e.key === 'g' || e.key === 'v') {
        prefix = e.key
        timer = window.setTimeout(() => (prefix = null), 1200)
        if (e.key === 'v') e.stopPropagation()
        return // "g" also reaches the app-wide "go to app" shortcut
      }
      if (ref.current(e.key, e)) {
        e.preventDefault()
        if (e.key !== 'Escape') e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(timer) }
  }, [])
}
