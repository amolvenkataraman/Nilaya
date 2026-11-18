// Task relations in the drawer: grouped by kind, remove with ×, add by searching tasks (debounced).
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Input, Select, useDebounced } from '../../components/ui'
import { cn } from '../../lib/cn'
import { useTasks } from '../../lib/queries'
import type { TaskDetail } from '../../lib/types'
import { RELATION_KINDS, type RelationKind, useAddRelation, useRemoveRelation } from './api'

const KIND_LABEL = Object.fromEntries(RELATION_KINDS) as Record<string, string>
/** The drawer's section headings (Subtasks, Relations, Comments). */
export const sectionLabel = 'mt-2 flex items-center gap-2 text-xs font-semibold text-muted'
const hint = 'px-2 py-1 text-xs text-muted'

export function Relations({ task, onOpen, canEdit }: { task: TaskDetail; onOpen: (id: string) => void; canEdit: boolean }) {
  const add = useAddRelation(task.id)
  const remove = useRemoveRelation(task.id)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<RelationKind>('related')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const results = useTasks({ q: dq, limit: 8, sort: 'updated' }, adding && dq.length >= 2)
  const linked = new Set(task.relations.filter((r) => r.kind === kind).map((r) => r.other_id))
  const hits = (results.data?.items ?? []).filter((t) => t.id !== task.id && !linked.has(t.id))
  const groups = RELATION_KINDS.map(([k, label]) => ({ k, label, items: task.relations.filter((r) => r.kind === k) })).filter(
    (g) => g.items.length,
  )
  const close = () => {
    setAdding(false)
    setQ('')
  }

  return (
    <div className="grid gap-1.5">
      <div className={sectionLabel}>
        Relations {task.relations.length > 0 && <span className="text-muted">{task.relations.length}</span>}
        <span className="flex-1" />
        {canEdit && !adding && (
          <Button variant="ghost" size="sm" className="-my-1 h-6!" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} />
            Add
          </Button>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.k} className="grid gap-px">
          <div className="px-1 pt-1 pb-0.5 text-xs text-muted">{g.label}</div>
          {g.items.map((r) => (
            <div key={r.id} className="group/rel flex items-center gap-2 rounded-sm py-0.5 pr-0.5 pl-1.5 text-left text-sm hover:bg-hover">
              <Icon name={r.other_done ? 'check' : 'link'} size={13} className="text-muted" />
              {r.other_visible === false ? (
                <span className="min-w-0 flex-1 truncate text-left text-sm text-muted" title="You can't open this task">
                  {r.other_name}
                </span>
              ) : (
                <button
                  type="button"
                  className={cn(
                    'min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-sm underline-offset-2 hover:underline',
                    r.other_done ? 'text-muted line-through' : 'text-fg',
                  )}
                  onClick={() => onOpen(r.other_id)}
                  title={r.other_name}
                >
                  {r.other_name}
                </button>
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  className="opacity-0 group-hover/rel:opacity-100 focus-visible:opacity-100 touch:opacity-100"
                  onClick={() => remove.mutate(r)}
                  aria-label={`Remove relation to "${r.other_name}"`}
                  title="Remove"
                >
                  <Icon name="x" size={12} />
                </Button>
              )}
            </div>
          ))}
        </div>
      ))}
      {!adding && task.relations.length === 0 && (
        <p className="text-xs text-muted">{canEdit ? 'Link tasks that block, follow or duplicate this one.' : 'No related tasks.'}</p>
      )}
      {adding && canEdit && (
        // biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere in the form cancels it
        <div
          className="grid gap-1.5 rounded-md border border-border bg-surface p-2"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            close()
          }}
        >
          <div className="flex items-center gap-2">
            <Select
              width="content"
              className="max-w-38 flex-none"
              value={kind}
              onChange={(e) => setKind(e.target.value as RelationKind)}
              aria-label="Relation kind"
            >
              {RELATION_KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <Input
              className="min-w-0 flex-auto"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks to link"
              maxLength={200}
            />
            <Button variant="ghost" size="sm" icon onClick={close} aria-label="Cancel">
              <Icon name="x" size={14} />
            </Button>
          </div>
          {dq.length >= 2 && (
            <div className="grid max-h-60 gap-px overflow-auto" role="listbox" aria-label="Matching tasks">
              {results.isPending ? (
                <div className={hint}>Searching…</div>
              ) : hits.length === 0 ? (
                <div className={hint}>No matching tasks.</div>
              ) : (
                hits.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="group/hit flex items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-sm hover:bg-hover focus-visible:bg-hover"
                    disabled={add.isPending}
                    onClick={() => add.mutate({ other_id: t.id, kind }, { onSuccess: () => setQ('') })}
                  >
                    <Icon name={t.done ? 'check' : 'tasks'} size={13} className="text-muted" />
                    <span className={cn('truncate', t.done && 'text-muted line-through')}>{t.title}</span>
                    <span className="ml-auto flex-none text-xs text-muted opacity-0 group-hover/hit:opacity-100 group-focus-visible/hit:opacity-100">
                      {KIND_LABEL[kind]}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          {dq.length < 2 && <div className={hint}>Type at least 2 letters.</div>}
        </div>
      )}
    </div>
  )
}
