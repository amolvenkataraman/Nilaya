// Kanban board for one project: buckets as columns, drag and drop (HTML5 DnD) between and within
// columns, plus a "Move to" menu on each card for keyboard and touch users.
// One request draws it (api.ts boardQuery: columns, their counts and first 50 cards each, seeded into one
// paged list per column); "Load more" pages a column. Drops name a neighbour card, so they work with
// partly loaded columns. The page reads the cards in column order through `orderRef` (selection ranges,
// Ctrl+A, j/k, the bulk bar), so columns loading never re-render the page.
import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { Button, ErrorBox } from '../../components/ui'
import { cn } from '../../lib/cn'
import { keys, useMoveTask, useSetDone, useTaskPages } from '../../lib/queries'
import { cachedTask, listItems } from '../../lib/taskLists'
import type { Label, Task } from '../../lib/types'
import { type BoardColumn, type BoardOut, boardQuery, columnParams, useSaveBucket } from './api'
import { Card } from './BoardCard'
import { AddCard, AddColumn, ColumnHead, column } from './BoardColumnParts'
import { allowDrop, beginDrag, draggedId, dropIndex, leftTarget } from './dnd'
import { between, positionsBetween } from './order'
import type { Selection } from './selection'

const byPosition = (a: Task, b: Task) => a.position - b.position || a.created_on.localeCompare(b.created_on) || (a.id < b.id ? -1 : 1)
/** WIP counts open top-level tasks, as the server does. */
const atLimit = (c: BoardColumn) => c.limit > 0 && !c.is_done && c.open >= c.limit
const dropLine = <div className="mb-1.5 h-0.5 rounded-[2px] bg-accent" />

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
