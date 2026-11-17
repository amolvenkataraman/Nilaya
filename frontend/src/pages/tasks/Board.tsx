// Kanban board for one project: buckets as columns, drag and drop (HTML5 DnD) between and within
// columns, plus a "Move to" menu on each card for keyboard and touch users.
// One request draws it (api.ts boardQuery: columns, their counts and first 50 cards each, seeded into one
// paged list per column); "Load more" pages a column. Drops name a neighbour card, so they work with
// partly loaded columns. The page reads the cards in column order through `orderRef` (selection ranges,
// Ctrl+A, j/k, the bulk bar), so columns loading never re-render the page.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type RefObject } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { dueTone, fmtMinutes, hoverText, Ring, TaskCheck } from '../../components/TaskRow'
import { toast } from '../../components/toast'
import {
  Avatar,
  Button,
  Confirm,
  Dialog,
  ErrorBox,
  Field,
  fieldClass,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from '../../components/ui'
import { cn } from '../../lib/cn'
import { dueLabel, fmtStamp } from '../../lib/dates'
import { keys, useCreateTask, useMoveTask, useSetDone, useTaskPages } from '../../lib/queries'
import { previewQuick } from '../../lib/quick'
import { cachedTask, listItems } from '../../lib/taskLists'
import type { Bucket, Label, Task } from '../../lib/types'
import { type BoardColumn, type BoardOut, boardQuery, columnParams, useDeleteBucket, useSaveBucket } from './api'
import { allowDrop, beginDrag, draggedId, dropIndex, leftTarget } from './dnd'
import { labelChip, labelStyle } from './Labels'
import { between, positionsBetween } from './order'
import { repeatText } from './recurrence'
import type { Selection } from './selection'
import { assigneesOf, isTempId } from './task'

const byPosition = (a: Task, b: Task) => a.position - b.position || a.created_on.localeCompare(b.created_on) || (a.id < b.id ? -1 : 1)
/** WIP counts open top-level tasks, as the server does. */
const atLimit = (c: BoardColumn) => c.limit > 0 && !c.is_done && c.open >= c.limit
const metaLine =
  'flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs text-muted [&>span]:inline-flex [&>span]:max-w-56 [&>span]:items-center [&>span]:gap-1 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap'
const TONE = { overdue: 'text-danger', today: 'text-accent font-medium', soon: 'text-warning', '': '' }
const dropLine = <div className="mb-1.5 h-0.5 rounded-[2px] bg-accent" />
const column = 'flex max-h-full flex-[0_0_18rem] flex-col rounded-md border max-md:basis-[85vw]'

type Drag = { id: string; over: number | null; index: number }
type ColDrag = { id: number; over: number | null; before: boolean }

export function Board({
  projectId,
  labels,
  q,
  onOpen,
  writable,
  hidden,
  sel,
  selected,
  orderRef,
}: {
  projectId: string
  labels?: Label[]
  q: string
  onOpen: (t: Task) => void
  writable: boolean
  hidden: Set<string>
  sel: Selection
  selected: string | null
  /** Set to a reader of every loaded card, in column order. */
  orderRef: RefObject<() => Task[]>
}) {
  const qc = useQueryClient()
  const board = useQuery({ ...boardQuery(qc, projectId, q), placeholderData: keepPreviousData })
  const move = useMoveTask()
  const saveBucket = useSaveBucket(projectId)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [colDrag, setColDrag] = useState<ColDrag | null>(null)
  const loaded = useRef(new Map<number, Task[]>())
  const cols = useMemo(() => [...(board.data?.columns ?? [])].sort((a, b) => a.position - b.position), [board.data])
  const cards = () => cols.flatMap((c) => loaded.current.get(c.id) ?? [])
  useLayoutEffect(() => {
    orderRef.current = () => cols.flatMap((c) => loaded.current.get(c.id) ?? [])
    return () => {
      orderRef.current = () => []
    }
  }, [cols, orderRef])

  const dropAt = (taskId: string, col: BoardColumn, index: number, list: Task[]) => {
    const task = list.find((t) => t.id === taskId) ?? cachedTask(qc, taskId)
    if (!task) return
    const here = list.some((t) => t.id === taskId)
    if (here && list.findIndex((t) => t.id === taskId) === index) return // dropped where it was
    if (!here && atLimit(col)) return toast.error(`"${col.name}" is at its limit of ${col.limit}.`)
    const rest = list.filter((t) => t.id !== taskId)
    const prev = rest[index - 1]
    const next = rest[index]
    const optimistic: Task = {
      ...task,
      bucket_id: col.id,
      position: positionsBetween(1, prev?.position, next?.position)[0],
      done: col.is_done ? true : here ? task.done : false,
    }
    if (!here) {
      // Counts move with the card at once (the board refetch confirms them).
      qc.setQueryData<BoardOut>(
        keys.board(projectId, q),
        (o) =>
          o && {
            columns: o.columns.map((c) => {
              const d = c.id === col.id ? 1 : c.id === task.bucket_id ? -1 : 0
              return d ? { ...c, total: c.total + d, open: c.open + (task.done ? 0 : d) } : c
            }),
          },
      )
    }
    move.mutate({ id: taskId, bucket_id: here ? undefined : col.id, after: prev?.id, before: prev ? undefined : next?.id, optimistic })
  }

  if (board.error && !board.data) return <ErrorBox error={board.error} retry={() => board.refetch()} />
  if (board.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto pb-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn(column, 'border-transparent bg-surface-2')}>
            <div className="flex h-10 flex-none items-center pl-3">
              <span className="sk h-3.5 w-2/5" />
            </div>
            {[0, 1, 2].slice(0, 3 - i).map((j) => (
              <span key={j} className="sk mx-2 mb-2 block h-14" />
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: flex columns that scroll sideways; a <ul> would need its list styles undone
    <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto pb-2" role="list" aria-label="Board">
      {cols.map((col) => (
        <Column
          key={col.id}
          col={col}
          cols={cols}
          projectId={projectId}
          q={q}
          labels={labels}
          writable={writable}
          hidden={hidden}
          sel={sel}
          selected={selected}
          cards={cards}
          drag={drag}
          setDrag={setDrag}
          colDrag={colDrag}
          setColDrag={setColDrag}
          onOpen={onOpen}
          report={(items) => loaded.current.set(col.id, items)}
          dropAt={dropAt}
          onMove={(t, b) => {
            if (atLimit(b)) return toast.error(`"${b.name}" is at its limit of ${b.limit}.`)
            const list = loaded.current.get(b.id) ?? []
            dropAt(t.id, b, list.length, list)
          }}
          onColumnDrop={() => {
            if (colDrag?.over != null) {
              const rest = cols.filter((b) => b.id !== colDrag.id)
              const i = rest.findIndex((b) => b.id === colDrag.over)
              const [a, b] = colDrag.before ? [rest[i - 1], rest[i]] : [rest[i], rest[i + 1]]
              saveBucket.mutate({ id: colDrag.id, body: { position: between(a?.position, b?.position) } })
            }
            setColDrag(null)
          }}
        />
      ))}
      {writable && <AddColumn onAdd={(name) => saveBucket.mutate({ body: { name, position: between(cols.at(-1)?.position) } })} />}
    </div>
  )
}

function Column({
  col,
  cols,
  projectId,
  q,
  labels,
  writable,
  hidden,
  sel,
  selected,
  cards,
  drag,
  setDrag,
  colDrag,
  setColDrag,
  onOpen,
  report,
  dropAt,
  onMove,
  onColumnDrop,
}: {
  col: BoardColumn
  cols: BoardColumn[]
  projectId: string
  q: string
  labels?: Label[]
  writable: boolean
  hidden: Set<string>
  sel: Selection
  selected: string | null
  /** Every loaded card in column order (for Shift-click ranges). */
  cards: () => Task[]
  drag: Drag | null
  setDrag: (d: Drag | null) => void
  colDrag: ColDrag | null
  setColDrag: (d: ColDrag | null) => void
  onOpen: (t: Task) => void
  report: (items: Task[]) => void
  dropAt: (taskId: string, col: BoardColumn, index: number, list: Task[]) => void
  onMove: (t: Task, b: BoardColumn) => void
  onColumnDrop: () => void
}) {
  const params = columnParams(projectId, col.id, q)
  const pages = useTaskPages(params)
  const setDone = useSetDone()
  const ref = useRef<HTMLDivElement>(null)
  const items = useMemo(
    () =>
      listItems(pages.data)
        .filter((t) => !hidden.has(t.id))
        .sort(byPosition),
    [pages.data, hidden],
  )
  // Before paint, so the page's next read (a key, a click) sees this column's cards.
  useLayoutEffect(() => report(items))
  const indexAt = (clientY: number) =>
    dropIndex(
      Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []).filter((c) => c.dataset.card !== drag?.id),
      clientY,
    )
  const left = Math.max(0, col.total - items.length)
  const dropping = drag?.over === col.id
  return (
    // biome-ignore lint/a11y/useSemanticElements: a column of the board list; <li> would need a <ul> around flex columns
    <div
      role="listitem"
      className={cn(
        column,
        'transition-[border-color,background-color] duration-120',
        dropping
          ? 'border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--app-accent-soft)_60%,var(--app-surface-2))]'
          : 'border-transparent bg-surface-2 dark:bg-[color-mix(in_srgb,var(--app-surface)_70%,var(--app-bg))]',
        colDrag?.over === col.id && (colDrag.before ? 'shadow-[-3px_0_0_var(--app-accent)]' : 'shadow-[3px_0_0_var(--app-accent)]'),
        colDrag?.id === col.id && 'opacity-50',
      )}
      onDragOver={(e: DragEvent<HTMLElement>) => {
        if (colDrag) {
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const before = e.clientX < r.left + r.width / 2
          const overId = col.id === colDrag.id ? null : col.id
          if (colDrag.over !== overId || colDrag.before !== before) setColDrag({ ...colDrag, over: overId, before })
          return
        }
        if (!drag) return
        allowDrop(e)
        const index = indexAt(e.clientY)
        if (drag.over !== col.id || drag.index !== index) setDrag({ ...drag, over: col.id, index })
      }}
      onDragLeave={(e) => {
        if (drag && leftTarget(e)) setDrag({ ...drag, over: null })
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (colDrag) return onColumnDrop()
        const id = draggedId(e, 'task') || drag?.id
        if (id) dropAt(id, col, indexAt(e.clientY), items)
        setDrag(null)
      }}
    >
      <ColumnHead
        bucket={col}
        total={col.total}
        open={col.open}
        projectId={projectId}
        writable={writable}
        cols={cols}
        onGrab={(e) => beginDrag(e, 'bucket', String(col.id), () => setColDrag({ id: col.id, over: null, before: true }))}
        onRelease={() => setColDrag(null)}
      />
      <div className="grid min-h-10 content-start gap-1.5 overflow-y-auto px-2" ref={ref}>
        {pages.error && !pages.data && <ErrorBox error={pages.error} retry={() => pages.refetch()} />}
        {items.map((t, i) => (
          <div key={t.id}>
            {dropping && drag.index === i && drag.id !== t.id && dropLine}
            <Card
              task={t}
              labels={labels}
              buckets={cols}
              dragging={drag?.id === t.id}
              picked={sel.has(t.id) || t.id === selected}
              draggable={writable}
              onOpen={(e) => {
                if (
                  sel.click(
                    e,
                    t.id,
                    cards().map((c) => c.id),
                  )
                )
                  return
                sel.clear()
                onOpen(t)
              }}
              onToggle={() => setDone.mutate({ task: t, done: !t.done })}
              onMove={(b) => {
                const target = cols.find((c) => c.id === b.id)
                if (target) onMove(t, target)
              }}
              onDragStart={(e) => beginDrag(e, 'task', t.id, () => setDrag({ id: t.id, over: col.id, index: i }))}
              onDragEnd={() => setDrag(null)}
            />
          </div>
        ))}
        {dropping && drag.index >= items.filter((t) => t.id !== drag.id).length && dropLine}
        {items.length === 0 && !drag && !pages.isPending && <div className="py-3 text-center text-xs text-muted">No tasks</div>}
        {pages.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="mx-2 mt-1 mb-2 w-[calc(100%-1rem)]"
            onClick={() => pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
          >
            {pages.isFetchingNextPage ? 'Loading…' : `Load more${left ? ` · ${left.toLocaleString()} left` : ''}`}
          </Button>
        )}
      </div>
      {writable && <AddCard projectId={projectId} bucket={col} listKey={keys.taskPages(params)} last={items.at(-1)} />}
    </div>
  )
}

function Card({
  task,
  labels,
  buckets,
  dragging,
  picked,
  draggable,
  onOpen,
  onToggle,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  task: Task
  labels?: Label[]
  buckets: Bucket[]
  dragging: boolean
  picked: boolean
  draggable: boolean
  onOpen: (e: MouseEvent) => void
  onToggle: () => void
  onMove: (b: Bucket) => void
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}) {
  const tone = dueTone(task.due, task.done)
  const taskLabels = labels?.filter((l) => task.labels.includes(l.id)) ?? []
  const future = task.start && !task.done && new Date(task.start) > new Date() ? task.start : null
  const rem = task.reminders.some((r) => !r.sent)
  const who = assigneesOf(task)
  const hasMeta =
    task.due ||
    task.done_at ||
    future ||
    task.subtasks ||
    task.comments ||
    task.priority >= 15 ||
    task.repeat_mode ||
    rem ||
    task.percent ||
    task.time_spent ||
    task.assignees.length
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the title button is the keyboard control; the card is a bigger pointer target
    // biome-ignore lint/a11y/useKeyWithClickEvents: the title button is the keyboard control; the card is a bigger pointer target
    <div
      className={cn(
        'group/card grid cursor-grab gap-1.5 rounded-sm border py-2 pr-1.5 pl-2.5 transition-[box-shadow,border-color] duration-120',
        picked
          ? 'border-accent bg-[color-mix(in_srgb,var(--app-accent-soft)_60%,var(--app-surface))]'
          : 'border-border bg-surface hover:border-[color-mix(in_srgb,var(--app-muted)_40%,var(--app-border))]',
        task.colour
          ? 'shadow-[inset_3px_0_0_var(--task-colour),0_1px_1px_rgba(16,24,40,.04)]'
          : 'shadow-[0_1px_1px_rgba(16,24,40,.04)] hover:shadow-[0_2px_6px_rgba(16,24,40,.07)]',
        dragging && 'opacity-40',
      )}
      style={task.colour ? ({ '--task-colour': task.colour } as CSSProperties) : undefined}
      data-card={task.id}
      data-task={task.id}
      draggable={draggable && !isTempId(task.id)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      {taskLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-6">
          {taskLabels.slice(0, 4).map((l) => (
            <span key={l.id} className={labelChip} style={labelStyle(l.colour)}>
              {l.name}
            </span>
          ))}
          {taskLabels.length > 4 && <span className={labelChip}>+{taskLabels.length - 4}</span>}
        </div>
      )}
      <div className="flex items-start gap-2 [&_.check]:mt-0.5">
        <TaskCheck task={task} onToggle={onToggle} />
        <button
          type="button"
          className={cn(
            'min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-sm leading-[1.35] wrap-anywhere',
            task.done && 'text-muted line-through',
          )}
          title={hoverText(task, taskLabels)}
          onClick={(e) => {
            e.stopPropagation()
            onOpen(e)
          }}
        >
          {task.title}
          {task.description && <Icon name="list" size={12} className="ml-1.25 inline align-[-1px] text-muted" title="Has a description" />}
        </button>
        {/* Menu items are portaled, but React events still bubble to the card: don't let them open it. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops the click reaching the card */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the click reaching the card */}
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            align="end"
            label="Card actions"
            trigger={(p) => (
              <Button
                {...p}
                variant="ghost"
                size="sm"
                icon
                className="-my-1 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 touch:opacity-100"
                aria-label={`Actions for "${task.title}"`}
                onClick={(e) => {
                  e.stopPropagation()
                  p.onClick?.(e)
                }}
              >
                <Icon name="more" size={14} />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>Move to</MenuLabel>
                {buckets.map((b) => (
                  <MenuItem
                    key={b.id}
                    icon={b.id === task.bucket_id ? 'check' : 'arrowRight'}
                    onClick={() => {
                      close()
                      if (b.id !== task.bucket_id) onMove(b)
                    }}
                  >
                    {b.name}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        </span>
      </div>
      {hasMeta ? (
        <div className={metaLine}>
          {task.priority >= 15 && (
            <span className={task.priority >= 20 ? 'text-danger' : 'text-warning'}>
              <Icon name="flag" size={12} />
              {task.priority_label}
            </span>
          )}
          {task.done && task.done_at ? (
            <span>
              <Icon name="check" size={12} />
              {dueLabel(task.done_at)}
            </span>
          ) : (
            task.due && (
              <span className={TONE[tone]}>
                <Icon name="calendar" size={12} />
                {dueLabel(task.due)}
              </span>
            )
          )}
          {future && (
            <span title={`Starts ${fmtStamp(future)}`}>
              <Icon name="play" size={12} />
              {dueLabel(future)}
            </span>
          )}
          {!!task.subtasks && (
            <span>
              <Icon name="subtask" size={12} />
              {task.subtasks_done}/{task.subtasks}
            </span>
          )}
          {!!task.comments && (
            <span>
              <Icon name="comment" size={12} />
              {task.comments}
            </span>
          )}
          {task.repeat_mode > 0 && (
            <span title={repeatText(task.repeat_mode, task.repeat_every)}>
              <Icon name="repeat" size={12} />
            </span>
          )}
          {rem && (
            <span title="Reminder set">
              <Icon name="bell" size={12} />
            </span>
          )}
          {task.percent > 0 && (
            <span title={`${task.percent}% done`}>
              <Ring value={task.percent} />
              {task.percent}%
            </span>
          )}
          {task.time_spent > 0 && (
            <span title="Time spent">
              <Icon name="clock" size={12} />
              {fmtMinutes(task.time_spent)}
            </span>
          )}
          {who.length > 0 && (
            <span className="ml-auto gap-0.5!" title={who.map((a) => a.name || a.username).join(', ')}>
              {who.slice(0, 2).map((a) => (
                <Avatar key={a.username} name={a.name || a.username} size={1.125} />
              ))}
              {who.length > 2 && <span className="text-muted">+{who.length - 2}</span>}
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}

function ColumnHead({
  bucket,
  total,
  open,
  projectId,
  writable,
  cols,
  onGrab,
  onRelease,
}: {
  bucket: Bucket
  total: number
  open: number
  projectId: string
  writable: boolean
  cols: Bucket[]
  onGrab: (e: DragEvent) => void
  onRelease: () => void
}) {
  const save = useSaveBucket(projectId)
  const remove = useDeleteBucket()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bucket.name)
  const [confirm, setConfirm] = useState(false)
  const [wip, setWip] = useState<string | null>(null)
  const over = bucket.limit > 0 && !bucket.is_done && open > bucket.limit
  const i = cols.findIndex((b) => b.id === bucket.id)
  const saveWip = () => {
    if (wip != null) save.mutate({ id: bucket.id, body: { limit: Math.max(0, Math.min(999, Number.parseInt(wip || '0', 10) || 0)) } })
    setWip(null)
  }
  const moveTo = (position: number) => save.mutate({ id: bucket.id, body: { position } })
  return (
    <div className="group/head flex h-10 flex-none items-center gap-1.5 pr-1 pl-3">
      {writable && (
        <span
          className="-ml-1.5 inline-flex cursor-grab text-muted opacity-50 group-hover/head:opacity-100"
          draggable
          onDragStart={onGrab}
          onDragEnd={onRelease}
          title="Drag to reorder"
          aria-hidden="true"
        >
          <Icon name="grip" size={14} />
        </span>
      )}
      {editing ? (
        <input
          className={cn(fieldClass.input, 'h-7!')}
          autoFocus
          value={name}
          maxLength={64}
          aria-label="Column name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (name.trim() && name.trim() !== bucket.name) save.mutate({ id: bucket.id, body: { name: name.trim() } })
            else setName(bucket.name)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setName(bucket.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <h3
          className="flex min-w-0 items-center gap-1 truncate text-sm"
          onDoubleClick={() => writable && setEditing(true)}
          title={writable ? 'Double-click to rename' : undefined}
        >
          {bucket.is_done && <Icon name="check" size={13} className="text-success" title="Tasks moved here are marked done" />}
          {bucket.name}
        </h3>
      )}
      <span
        className={cn('text-xs tabular-nums', over ? 'font-semibold text-danger' : 'text-muted')}
        title={bucket.limit ? `WIP limit ${bucket.limit}` : undefined}
      >
        {bucket.limit > 0 && !bucket.is_done ? `${open} / ${bucket.limit}` : total.toLocaleString()}
      </span>
      <span className="flex-1" />
      {writable && (
        <Menu
          align="end"
          label="Column actions"
          trigger={(p) => (
            <Button {...p} variant="ghost" size="sm" icon aria-label={`${bucket.name} column actions`}>
              <Icon name="more" size={14} />
            </Button>
          )}
        >
          {(close) => {
            const act = (fn: () => void) => () => {
              close()
              fn()
            }
            return (
              <>
                <MenuItem icon="edit" onClick={act(() => setEditing(true))}>
                  Rename
                </MenuItem>
                <MenuItem icon="filter" onClick={act(() => setWip(String(bucket.limit || 0)))}>
                  {bucket.limit ? `WIP limit: ${bucket.limit}…` : 'Set WIP limit…'}
                </MenuItem>
                {!bucket.is_done && (
                  <MenuItem icon="check" onClick={act(() => save.mutate({ id: bucket.id, body: { is_done: true } }))}>
                    Use as "done" column
                  </MenuItem>
                )}
                <MenuSeparator />
                {i > 0 && (
                  <MenuItem icon="chevronLeft" onClick={act(() => moveTo(between(cols[i - 2]?.position, cols[i - 1].position)))}>
                    Move left
                  </MenuItem>
                )}
                {i < cols.length - 1 && (
                  <MenuItem icon="chevronRight" onClick={act(() => moveTo(between(cols[i + 1].position, cols[i + 2]?.position)))}>
                    Move right
                  </MenuItem>
                )}
                {cols.length > 1 && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon="trash" danger onClick={act(() => setConfirm(true))}>
                      Delete column…
                    </MenuItem>
                  </>
                )}
              </>
            )
          }}
        </Menu>
      )}
      <Confirm
        open={confirm}
        title={`Delete "${bucket.name}"?`}
        body="Its tasks move to another column."
        onConfirm={() => remove.mutate(bucket.id)}
        onClose={() => setConfirm(false)}
      />
      <Dialog
        open={wip != null}
        onClose={() => setWip(null)}
        title={`WIP limit for "${bucket.name}"`}
        width="22rem"
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={() => setWip(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveWip}>
              Save
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveWip()
          }}
        >
          <Field label="Maximum open tasks (0 = no limit)">
            <Input type="number" min={0} max={999} autoFocus value={wip ?? ''} onChange={(e) => setWip(e.target.value)} />
          </Field>
        </form>
      </Dialog>
    </div>
  )
}

const addButton =
  'mx-2 mt-1.5 mb-2 flex h-8 flex-none items-center gap-1.5 rounded-sm border-0 bg-transparent px-2 text-sm text-muted hover:bg-hover hover:text-fg'

function AddCard({ projectId, bucket, listKey, last }: { projectId: string; bucket: Bucket; listKey: readonly unknown[]; last?: Task }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const create = useCreateTask()
  if (!open)
    return (
      <button type="button" className={addButton} onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />
        Add task
      </button>
    )
  const submit = () => {
    const t = title.trim()
    if (!t) return setOpen(false)
    // Natural language ("Call mom fri !3") straight into this column.
    const position = between(last?.position)
    const clean = previewQuick(t).title || t
    create.mutate({
      quick: t,
      body: { title: clean, project_id: projectId, bucket_id: bucket.id },
      listKey,
      optimistic: { title: clean, project_id: projectId, bucket_id: bucket.id, position },
    })
    setTitle('')
  }
  return (
    <form
      className="px-2 pt-1.5 pb-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder='Task, e.g. "Call mom fri !3"'
        maxLength={256}
        onBlur={() => !title.trim() && setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        aria-label={`New task in ${bucket.name}`}
      />
    </form>
  )
}

function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className={cn(column, 'border-dashed border-border bg-transparent')}>
      {open ? (
        <form
          className="p-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onAdd(name.trim())
            setName('')
            setOpen(false)
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Column name"
            aria-label="Column name"
            maxLength={64}
            onBlur={() => !name && setOpen(false)}
          />
        </form>
      ) : (
        <button type="button" className={addButton} onClick={() => setOpen(true)}>
          <Icon name="plus" size={14} />
          Add column
        </button>
      )}
    </div>
  )
}
