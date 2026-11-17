// Ctrl/⌘ K: jump to a page, project or task, or run an action. A Base UI dialog (focus trap, Escape, outside click).
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon } from './Icon'
import { EmptyState, useDebounced } from './ui'
import { NAV } from './nav'
import { get } from '../lib/api'
import { useCreateTask, useProjects } from '../lib/queries'
import { toast } from './toast'
import { cycleTheme } from '../lib/theme'
import { dueLabel } from '../lib/dates'
import type { TaskPage } from '../lib/types'
import { useLayer } from './layers'
import { cn } from '../lib/cn'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  icon: string
  run: () => void
  colour?: string
}

function score(label: string, q: string): number {
  const l = label.toLowerCase()
  if (!q) return 1
  if (l.startsWith(q)) return 3
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 2
  if (l.includes(q)) return 1
  return 0
}

export function CommandPalette({ open, onClose, onQuickAdd }: { open: boolean; onClose: () => void; onQuickAdd: () => void }) {
  useLayer('palette', open)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const projects = useProjects().data
  const create = useCreateTask()
  const dq = useDebounced(q.trim(), 250)
  const tasks = useQuery({
    queryKey: ['tasks', 'search', dq],
    queryFn: ({ signal }) => get<TaskPage>('tasks/', { q: dq, limit: 8, sort: 'updated' }, signal),
    enabled: open && dq.length >= 2,
    staleTime: 10_000,
  })

  // Mounted only while open (Shell), so state starts fresh each time; give focus back on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    return () => prev?.focus?.({ preventScroll: true })
  }, [])

  // Rebuilt each render (a few dozen entries): memoising it kept stale handlers (onClose, navigate, createTask).
  const items = ((): Item[] => {
    const ql = q.trim().toLowerCase()
    const go = (to: string) => () => (onClose(), navigate(to))
    const pages: Item[] = NAV.map((n) => ({
      id: 'p' + n.to,
      group: 'Pages',
      label: n.label,
      icon: n.icon,
      hint: `G ${n.key.toUpperCase()}`,
      run: go(n.to),
    }))
    const actions: Item[] = [
      { id: 'a-task', group: 'Actions', label: 'New task', icon: 'plus', hint: 'Q', run: onQuickAdd },
      { id: 'a-event', group: 'Actions', label: 'New event', icon: 'calendar', run: go('/calendar?new=1') },
      { id: 'a-insights', group: 'Actions', label: 'Calendar insights', icon: 'chart', run: go('/calendar?insights=week') },
      { id: 'a-albums', group: 'Actions', label: 'Photo albums', icon: 'album', run: go('/photos/albums') },
      { id: 'a-gg', group: 'Photos', label: 'Geoguessr', icon: 'globe', run: go('/photos/geoguessr') },
      { id: 'a-locate', group: 'Photos', label: 'Add missing photo locations', icon: 'pin', run: go('/photos/locate') },
      { id: 'a-theme', group: 'Actions', label: 'Change theme', icon: 'moon', run: () => cycleTheme() },
      { id: 'a-dev', group: 'Actions', label: 'Developers & API: guides, keys, feeds', icon: 'code', run: go('/settings#set-guides') },
      { id: 'a-keys', group: 'Actions', label: 'API keys', icon: 'code', run: go('/settings#set-api') },
    ]
    const views: Item[] = [
      ['today', 'Today'],
      ['upcoming', 'Upcoming'],
      ['overdue', 'Overdue'],
      ['inbox', 'Inbox'],
      ['done', 'Completed tasks'],
    ].map(([v, label]) => ({ id: 'v' + v, group: 'Task views', label, icon: 'tasks', run: go(`/tasks?view=${v}`) }))
    const projs: Item[] = (projects ?? [])
      .filter((p) => !p.is_inbox)
      .map((p) => ({
        id: 'pr' + p.id,
        group: 'Projects',
        label: p.name,
        icon: 'folder',
        colour: p.colour,
        hint: p.open_count ? String(p.open_count) : undefined,
        run: go(`/tasks?project=${p.id}`),
      }))
    const ranked = [...pages, ...actions, ...views, ...projs].map((it) => ({ it, s: score(it.label, ql) })).filter((x) => x.s > 0)
    if (ql) ranked.sort((a, b) => b.s - a.s)
    let out = ranked.map((x) => x.it)
    if (!ql) out = out.filter((it) => it.group !== 'Projects' || out.indexOf(it) < 30)
    const found: Item[] = (tasks.data?.items ?? []).map((t) => ({
      id: 't' + t.id,
      group: 'Tasks',
      label: t.title,
      icon: t.done ? 'check' : 'tasks',
      hint: t.due ? dueLabel(t.due) : undefined,
      run: go(`/tasks?view=all&task=${t.id}`),
    }))
    const create: Item[] = ql
      ? [{ id: 'create', group: 'Create', label: `Add task "${q.trim()}"`, icon: 'plus', run: () => createTask(q.trim()) }]
      : []
    // Group order: best matches first when searching
    const groups = ql ? [...out, ...found, ...create] : [...actions, ...pages, ...views, ...projs]
    return groups
  })()

  function createTask(text: string) {
    create.mutate({ quick: text }, { onSuccess: (t) => toast.show(`Added "${t.title}" to ${t.project_id ? 'your tasks' : 'Inbox'}`) })
    onClose()
  }

  useEffect(() => {
    setActive(0)
  }, [q])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let lastGroup = ''
  return (
    <BaseDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-70 bg-scrim transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <BaseDialog.Popup
          aria-label="Command palette"
          initialFocus={input}
          className={cn(
            'fixed top-[12vh] left-1/2 z-80 flex max-h-[min(34rem,76vh)] w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col overflow-hidden',
            'rounded-[calc(var(--app-radius)+4px)] bg-surface shadow-pop outline-none max-md:top-2 max-md:max-h-[70vh]',
            'transition-[opacity,translate,scale] duration-150 ease-out data-ending-style:opacity-0 data-starting-style:translate-y-1.5 data-starting-style:scale-[0.985] data-starting-style:opacity-0',
          )}
        >
          <div className="flex h-13 items-center gap-2.5 border-b border-border px-3.5 text-muted">
            <Icon name="search" size={18} />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search pages, projects and tasks…"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={items[active] ? `pi-${active}` : undefined}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-md text-fg outline-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, items.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  items[active]?.run()
                }
              }}
            />
            {tasks.isFetching && <span className="spinner" aria-label="Searching" />}
            <span className="kbd">Esc</span>
          </div>
          <div className="overflow-auto p-1.5" id="palette-list" role="listbox" ref={list}>
            {items.length === 0 && <EmptyState>No matches.</EmptyState>}
            {items.map((it, i) => {
              const header = it.group !== lastGroup ? it.group : null
              lastGroup = it.group
              return (
                <div key={it.id}>
                  {header && <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted">{header}</div>}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: the input above drives the keyboard (aria-activedescendant) */}
                  <div
                    id={`pi-${i}`}
                    data-i={i}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    className={cn(
                      'flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm [&>svg]:shrink-0 [&>svg]:text-muted',
                      i === active && 'bg-hover [&>svg]:text-accent',
                    )}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => it.run()}
                  >
                    {it.colour ? <span className="dot" style={{ background: it.colour }} /> : <Icon name={it.icon} />}
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.hint && <span className="text-xs text-muted tabular-nums">{it.hint}</span>}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 border-t border-border bg-bg px-3.5 py-2 text-xs text-muted max-md:hidden">
            <span>
              <span className="kbd">↑</span> <span className="kbd">↓</span> to move
            </span>
            <span>
              <span className="kbd">Enter</span> to open
            </span>
            <span className="flex-1" />
            <span>
              <span className="kbd">G</span> then a letter jumps
            </span>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
