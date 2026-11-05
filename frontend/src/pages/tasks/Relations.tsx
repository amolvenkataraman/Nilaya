// Task relations in the drawer: grouped by kind, remove with ×, add by searching tasks (debounced).
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { useDebounced } from '../../components/ui'
import { useTasks } from '../../lib/queries'
import type { TaskDetail } from '../../lib/types'
import { RELATION_KINDS, useAddRelation, useRemoveRelation, type RelationKind } from './api'

const KIND_LABEL = Object.fromEntries(RELATION_KINDS) as Record<string, string>

export function Relations({ task, onOpen }: { task: TaskDetail; onOpen: (id: string) => void }) {
  const add = useAddRelation(task.id)
  const remove = useRemoveRelation(task.id)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<RelationKind>('related')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const results = useTasks({ q: dq, limit: 8, sort: 'updated' }, adding && dq.length >= 2)
  const linked = new Set(task.relations.filter((r) => r.kind === kind).map((r) => r.other_id))
  const hits = (results.data?.items ?? []).filter((t) => t.id !== task.id && !linked.has(t.id))
  const groups = RELATION_KINDS.map(([k, label]) => ({ k, label, items: task.relations.filter((r) => r.kind === k) })).filter((g) => g.items.length)
  const close = () => { setAdding(false); setQ('') }

  return (
    <div className="detail-block">
      <div className="detail-section-label">
        Relations {task.relations.length > 0 && <span className="muted">{task.relations.length}</span>}
        <span className="spacer" />
        {!adding && <button className="btn ghost sm rel-add-btn" onClick={() => setAdding(true)}><Icon name="plus" size={12} />Add</button>}
      </div>
      {groups.map((g) => (
        <div key={g.k} className="rel-group">
          <div className="rel-kind">{g.label}</div>
          {g.items.map((r) => (
            <div key={r.id} className="relation">
              <Icon name={r.other_done ? 'check' : 'link'} size={13} className="muted" />
              <button className={'linkish rel-title truncate' + (r.other_done ? ' muted strike' : '')} onClick={() => onOpen(r.other_id)} title={r.other_name}>{r.other_name}</button>
              <button className="btn ghost icon sm rel-del" onClick={() => remove.mutate(r)} aria-label={`Remove relation to "${r.other_name}"`} title="Remove"><Icon name="x" size={12} /></button>
            </div>
          ))}
        </div>
      ))}
      {!adding && task.relations.length === 0 && <p className="muted xsmall">Link tasks that block, follow or duplicate this one.</p>}
      {adding && (
        <div className="rel-form" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}>
          <div className="row">
            <select className="select rel-kind-select" value={kind} onChange={(e) => setKind(e.target.value as RelationKind)} aria-label="Relation kind">
              {RELATION_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input className="input grow" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" aria-label="Search tasks to link" maxLength={200} />
            <button className="btn ghost icon sm" onClick={close} aria-label="Cancel"><Icon name="x" size={14} /></button>
          </div>
          {dq.length >= 2 && (
            <div className="rel-results" role="listbox" aria-label="Matching tasks">
              {results.isPending ? <div className="muted xsmall rel-hint">Searching…</div> : hits.length === 0 ? <div className="muted xsmall rel-hint">No matching tasks.</div> : hits.map((t) => (
                <button key={t.id} role="option" aria-selected={false} className="rel-hit" disabled={add.isPending}
                  onClick={() => add.mutate({ other_id: t.id, kind }, { onSuccess: () => setQ('') })}>
                  <Icon name={t.done ? 'check' : 'tasks'} size={13} className="muted" />
                  <span className={'truncate' + (t.done ? ' muted strike' : '')}>{t.title}</span>
                  <span className="muted xsmall rel-hit-kind">{KIND_LABEL[kind]}</span>
                </button>
              ))}
            </div>
          )}
          {dq.length < 2 && <div className="muted xsmall rel-hint">Type at least 2 letters.</div>}
        </div>
      )}
    </div>
  )
}
