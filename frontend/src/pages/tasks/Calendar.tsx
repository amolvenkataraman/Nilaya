// Calendar layout: a month of due dates. Chips per day (time, priority dot, colour), "N more" expands a
// day, drag a chip to another day to reschedule (keeps the time, shifts the start), "+" adds a task on
// that day, and the selected day's agenda sits under the grid (the only list on phones, where days
// show priority dots). One request per month: the list's filters plus due_after/due_before.
import { useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import { Icon } from '../../components/Icon'
import { ErrorBox } from '../../components/ui'
import { hoverText } from '../../components/TaskRow'
import { toast } from '../../components/toast'
import { keys, useCreateTask, useTasks, useUpdateTask, type TaskQuery } from '../../lib/queries'
import { addDays, dayKey, fmtDate, fmtTime, isEndOfDay, isSameDay, parseDayKey, startOfDay } from '../../lib/dates'
import type { Label, Task } from '../../lib/types'
import { previewQuick } from '../../lib/quick'
import { calendarRange, isOverdue, rescheduleTo } from './util'

const prio = (p: number) => (p >= 20 ? 'p20' : p >= 15 ? 'p15' : p >= 10 ? 'p10' : 'p5')
const MAX = 4

/** The month query for a list: its filters without the date-window views, and done tasks included. */
export function calendarParams(base: TaskQuery, month: Date): TaskQuery {
  const { start, end } = calendarRange(month)
  const p: TaskQuery = { ...base, due_after: start.toISOString(), due_before: end.toISOString(), limit: 1000, sort: 'due' }
  delete p.top_level
  if (p.done === false && p.project) delete p.done
  if (['today', 'upcoming', 'overdue', 'nodate'].includes(String(p.view))) delete p.view
  return p
}

export function Calendar({ base, labels, projectId, hidden, onOpen, selected }: {
  base: TaskQuery; labels?: Label[]; projectId: string | null; hidden: Set<string>; onOpen: (t: Task) => void; selected: string | null
}) {
  const today = startOfDay(new Date())
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [sel, setSel] = useState(dayKey(today))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [over, setOver] = useState<string | null>(null)
  const params = calendarParams(base, month)
  const tasks = useTasks(params)
  const update = useUpdateTask()
  const create = useCreateTask()
  const { start } = calendarRange(month)

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks.data?.items ?? []) {
      if (!t.due || hidden.has(t.id)) continue
      const k = dayKey(new Date(t.due))
      m.set(k, [...(m.get(k) ?? []), t])
    }
    for (const list of m.values()) list.sort((a, b) => Number(a.done) - Number(b.done) || a.due!.localeCompare(b.due!))
    return m
  }, [tasks.data, hidden])

  const nav = (n: number) => { setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1)); setExpanded(null) }
  const add = (k: string) => {
    const t = text.trim()
    setText('')
    setAdding(null)
    if (!t) return
    const d = parseDayKey(k)
    d.setHours(23, 59, 0, 0)
    const pv = previewQuick(t)
    create.mutate({
      quick: pv.when ? t : `${t} ${k}`,
      body: { title: pv.title || t, project_id: projectId },
      listKey: keys.taskList(params),
      optimistic: { title: pv.title || t, project_id: projectId, due: pv.when ? null : d.toISOString() },
    })
  }
  const drop = (e: DragEvent, k: string) => {
    e.preventDefault()
    setOver(null)
    const t = tasks.data?.items.find((x) => x.id === e.dataTransfer.getData('text/x-task'))
    if (!t) return
    const body = rescheduleTo(t, parseDayKey(k))
    if (!body) return
    update.mutate({ id: t.id, body })
    toast.show(`Rescheduled to ${fmtDate(parseDayKey(k), { weekday: 'short', month: 'short', day: 'numeric' })}`)
  }

  const chip = (t: Task) => {
    const d = new Date(t.due!)
    return (
      <button key={t.id} type="button" draggable={!t.id.startsWith('temp-')} data-task={t.id}
        className={'cal-chip' + (t.done ? ' done' : '') + (isOverdue(t) ? ' overdue' : '') + (t.id === selected ? ' sel' : '')}
        style={t.colour ? ({ '--tc': t.colour } as CSSProperties) : undefined}
        title={hoverText(t, labels?.filter((l) => t.labels.includes(l.id)) ?? [])}
        onClick={(e) => (e.stopPropagation(), onOpen(t))}
        onDragStart={(e) => { e.dataTransfer.setData('text/x-task', t.id); e.dataTransfer.effectAllowed = 'move' }}>
        <span className={'cal-dot ' + prio(t.priority)} />
        {!isEndOfDay(d) && <span className="cal-time">{fmtTime(d)}</span>}
        <span className="truncate">{t.title}</span>
      </button>
    )
  }

  if (tasks.error && !tasks.data) return <ErrorBox error={tasks.error} retry={() => tasks.refetch()} />
  const selItems = byDay.get(sel) ?? []
  return (
    <div className="cal">
      <div className="tl-head">
        <h2 className="tl-range">{fmtDate(month, { month: 'long', year: 'numeric' })}</h2>
        {tasks.isFetching && <span className="muted xsmall">Loading…</span>}
        <span className="spacer" />
        <div className="tl-nav">
          <button className="btn sm icon" onClick={() => nav(-1)} aria-label="Previous month" title="Previous month"><Icon name="chevronLeft" size={14} /></button>
          <button className="btn sm" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSel(dayKey(today)) }}>Today</button>
          <button className="btn sm icon" onClick={() => nav(1)} aria-label="Next month" title="Next month"><Icon name="chevronRight" size={14} /></button>
        </div>
      </div>
      <div className="cal-grid" role="grid" aria-label={fmtDate(month, { month: 'long', year: 'numeric' })}>
        {Array.from({ length: 7 }, (_, i) => <div key={'w' + i} className="cal-wd" role="columnheader">{fmtDate(addDays(start, i), { weekday: 'short' })}</div>)}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(start, i)
          const k = dayKey(d)
          const items = byDay.get(k) ?? []
          const open = expanded === k
          return (
            <div key={k} role="gridcell" aria-selected={k === sel}
              className={'cal-day' + (d.getMonth() !== month.getMonth() ? ' out' : '') + (isSameDay(d, today) ? ' today' : '') + (k === sel ? ' sel' : '') + (over === k ? ' drop' : '') + (open ? ' open' : '')}
              onClick={() => setSel(k)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== k) setOver(k) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && over === k) setOver(null) }}
              onDrop={(e) => drop(e, k)}>
              <div className="cal-dayhead">
                <span className="cal-num">{d.getDate()}</span>
                <button className="btn ghost icon sm cal-add" aria-label={`Add task on ${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                  onClick={(e) => { e.stopPropagation(); setSel(k); setAdding(k); setText('') }}><Icon name="plus" size={12} /></button>
              </div>
              {adding === k && (
                <form onSubmit={(e) => (e.preventDefault(), add(k))} onClick={(e) => e.stopPropagation()}>
                  <input className="input cal-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="New task" maxLength={500} aria-label="New task"
                    onBlur={() => add(k)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setText(''), setAdding(null))} />
                </form>
              )}
              <div className="cal-items">
                {(open ? items : items.slice(0, MAX)).map(chip)}
                {!open && items.length > MAX && <button className="cal-more" onClick={(e) => { e.stopPropagation(); setSel(k); setExpanded(k) }}>{items.length - MAX} more</button>}
              </div>
              {items.length > 0 && <div className="cal-dots" aria-hidden="true">{items.slice(0, 5).map((t) => <span key={t.id} className={'cal-dot ' + prio(t.priority) + (t.done ? ' done' : '')} />)}</div>}
            </div>
          )
        })}
      </div>
      <section className="cal-agenda" aria-label="Selected day">
        <h3>{fmtDate(parseDayKey(sel), { weekday: 'long', month: 'long', day: 'numeric' })} <span className="muted">{selItems.length || ''}</span>
          <button className="btn ghost sm" onClick={() => { setAdding('a:' + sel); setText('') }}><Icon name="plus" size={12} />Add</button></h3>
        {adding === 'a:' + sel && (
          <form onSubmit={(e) => (e.preventDefault(), add(sel))}>
            <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder='New task, e.g. "Dentist 3pm !2"' maxLength={500} aria-label="New task"
              onBlur={() => add(sel)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setText(''), setAdding(null))} />
          </form>
        )}
        {selItems.length ? selItems.map(chip) : <p className="muted xsmall">Nothing due.</p>}
      </section>
    </div>
  )
}
