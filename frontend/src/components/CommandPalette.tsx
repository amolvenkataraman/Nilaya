import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon } from './Icon'
import { useDebounced } from './ui'
import { NAV } from './nav'
import { get } from '../lib/api'
import { useCreateTask, useProjects } from '../lib/queries'
import { toast } from './toast'
import { cycleTheme } from '../lib/theme'
import { dueLabel } from '../lib/dates'
import type { TaskPage } from '../lib/types'

interface Item { id: string; group: string; label: string; hint?: string; icon: string; run: () => void; colour?: string }

function score(label: string, q: string): number {
  const l = label.toLowerCase()
  if (!q) return 1
  if (l.startsWith(q)) return 3
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 2
  if (l.includes(q)) return 1
  return 0
}

export function CommandPalette({ open, onClose, onQuickAdd }: { open: boolean; onClose: () => void; onQuickAdd: () => void }) {
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

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      const prev = document.activeElement as HTMLElement | null
      return () => prev?.focus?.({ preventScroll: true })
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const ql = q.trim().toLowerCase()
    const go = (to: string) => () => (onClose(), navigate(to))
    const pages: Item[] = NAV.map((n) => ({ id: 'p' + n.to, group: 'Pages', label: n.label, icon: n.icon, hint: `G ${n.key.toUpperCase()}`, run: go(n.to) }))
    pages.push({ id: 'classic', group: 'Pages', label: 'Classic view', icon: 'classic', run: () => window.location.assign('/') })
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
      ['today', 'Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['inbox', 'Inbox'], ['done', 'Completed tasks'],
    ].map(([v, label]) => ({ id: 'v' + v, group: 'Task views', label, icon: 'tasks', run: go(`/tasks?view=${v}`) }))
    const projs: Item[] = (projects ?? [])
      .filter((p) => !p.is_inbox)
      .map((p) => ({ id: 'pr' + p.id, group: 'Projects', label: p.name, icon: 'folder', colour: p.colour, hint: p.open_count ? String(p.open_count) : undefined, run: go(`/tasks?project=${p.id}`) }))
    const ranked = [...pages, ...actions, ...views, ...projs]
      .map((it) => ({ it, s: score(it.label, ql) }))
      .filter((x) => x.s > 0)
    if (ql) ranked.sort((a, b) => b.s - a.s)
    let out = ranked.map((x) => x.it)
    if (!ql) out = out.filter((it) => it.group !== 'Projects' || out.indexOf(it) < 30)
    const found: Item[] = (tasks.data?.items ?? []).map((t) => ({
      id: 't' + t.id, group: 'Tasks', label: t.title, icon: t.done ? 'check' : 'tasks', hint: t.due ? dueLabel(t.due) : undefined,
      run: go(`/tasks?view=all&task=${t.id}`),
    }))
    const create: Item[] = ql ? [{ id: 'create', group: 'Create', label: `Add task "${q.trim()}"`, icon: 'plus', run: () => createTask(q.trim()) }] : []
    // Group order: best matches first when searching
    const groups = ql ? [...out, ...found, ...create] : [...actions, ...pages, ...views, ...projs]
    return groups
  }, [q, projects, tasks.data])

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

  if (!open) return null
  let lastGroup = ''
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, projects and tasks…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pi-${active}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
              else if (e.key === 'Enter') (e.preventDefault(), items[active]?.run())
              else if (e.key === 'Escape') (e.preventDefault(), onClose())
            }}
          />
          {tasks.isFetching && <span className="spinner" aria-label="Searching" />}
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {items.length === 0 && <div className="empty">No matches.</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <div key={it.id}>
                {header && <div className="palette-group">{header}</div>}
                <div
                  id={`pi-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  className={'palette-item' + (i === active ? ' active' : '')}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => it.run()}
                >
                  {it.colour ? <span className="dot" style={{ background: it.colour }} /> : <Icon name={it.icon} />}
                  <span className="grow truncate">{it.label}</span>
                  {it.hint && <span className="palette-hint">{it.hint}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> to move</span>
          <span><span className="kbd">Enter</span> to open</span>
          <span className="spacer" />
          <span><span className="kbd">G</span> then a letter jumps</span>
        </div>
      </div>
    </>,
    document.body,
  )
}
