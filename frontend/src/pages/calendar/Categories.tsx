// Event categories (yours): name, colour, icon and order. GET/POST /calendar/categories,
// PATCH/DELETE /calendar/categories/{id}. "Uncategorized" can be renamed but not deleted.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, ErrorBox, SkeletonRows } from '../../components/ui'
import { toast } from '../../components/toast'
import { del, get, patch, post } from '../../lib/api'
import { keys, useCategories } from '../../lib/queries'
import type { Category } from '../../lib/types'
import { CAL_COLOURS } from './calendarCommon'

type Patch = Partial<Pick<Category, 'name' | 'colour' | 'icon' | 'position'>>
const onError = (e: unknown) => toast.error((e as Error).message)

export function CategoriesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const cats = useCategories()
  const icons = useQuery({ queryKey: ['calendar', 'icons'], queryFn: () => get<string[]>('calendar/icons'), staleTime: Infinity, enabled: open }).data ?? []
  const [edit, setEdit] = useState<number | 'new' | null>(null)
  const [removing, setRemoving] = useState<Category | null>(null)
  // Categories show on events too: refresh both after a change.
  const refresh = () => (qc.invalidateQueries({ queryKey: keys.categories }), qc.invalidateQueries({ queryKey: ['calendar', 'events'] }))
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: number; body: Patch }) => (id ? patch<Category>(`calendar/categories/${id}`, body) : post<Category>('calendar/categories', body)),
    onSuccess: () => setEdit(null),
    onError,
    onSettled: refresh,
  })
  const remove = useMutation({ mutationFn: (c: Category) => del(`calendar/categories/${c.id}`), onSuccess: (_r, c) => toast.show(`Deleted "${c.name}": its events are now Uncategorized`), onError, onSettled: refresh })
  const list = (cats.data ?? []).slice().sort((a, b) => a.position - b.position || a.id - b.id)
  // Swap positions with the neighbour (two PATCHes; positions may have gaps or ties, so renumber both).
  const move = (i: number, dir: -1 | 1) => {
    const a = list[i]
    const b = list[i + dir]
    if (!a || !b) return
    const pa = a.position === b.position ? b.position + dir : b.position
    qc.setQueryData<Category[]>(keys.categories, (old) => old?.map((c) => (c.id === a.id ? { ...c, position: pa } : c.id === b.id ? { ...c, position: a.position } : c)))
    Promise.all([patch(`calendar/categories/${a.id}`, { position: pa }), patch(`calendar/categories/${b.id}`, { position: a.position })]).catch(onError).finally(refresh)
  }
  return (
    <Dialog open={open} onClose={onClose} title="Event categories" width="32rem"
      footer={<><button className="btn sm" onClick={() => setEdit('new')} disabled={edit === 'new'}><Icon name="plus" size={14} />New category</button><span className="spacer" /><button className="btn primary" onClick={onClose}>Done</button></>}>
      <p className="help">Categories group events for insights and availability (meetings, work and study show as busy). Colour and icon are used when an event has none of its own.</p>
      {cats.isPending ? <SkeletonRows rows={5} /> : cats.error && !cats.data ? <ErrorBox error={cats.error} retry={() => cats.refetch()} /> : (
        <ul className="cat-list">
          {edit === 'new' && <li><CategoryForm icons={icons} busy={save.isPending} onCancel={() => setEdit(null)} onSave={(body) => save.mutate({ body })} /></li>}
          {list.map((c, i) => edit === c.id ? (
            <li key={c.id}><CategoryForm cat={c} icons={icons} busy={save.isPending} onCancel={() => setEdit(null)} onSave={(body) => save.mutate({ id: c.id, body })} /></li>
          ) : (
            <li key={c.id} className="cat-row">
              <span className="cat-glyph" style={{ '--c': c.colour || 'var(--app-muted)' } as React.CSSProperties}>{c.icon ? <Icon name={c.icon} size={13} /> : <span className="dot" />}</span>
              <span className="grow truncate">{c.name}{c.legacy_id === 0 && <span className="muted xsmall"> · default</span>}</span>
              <button className="btn ghost icon sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`} title="Move up"><Icon name="chevronUp" size={14} /></button>
              <button className="btn ghost icon sm" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move ${c.name} down`} title="Move down"><Icon name="chevronDown" size={14} /></button>
              <button className="btn ghost icon sm" onClick={() => setEdit(c.id)} aria-label={`Edit ${c.name}`} title="Edit"><Icon name="edit" size={14} /></button>
              {c.legacy_id !== 0 && <button className="btn ghost icon sm" onClick={() => setRemoving(c)} aria-label={`Delete ${c.name}`} title="Delete"><Icon name="trash" size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
      <Confirm open={!!removing} title={`Delete "${removing?.name}"?`} body="Its events become Uncategorized." onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)} />
    </Dialog>
  )
}

function CategoryForm({ cat, icons, busy, onSave, onCancel }: { cat?: Category; icons: string[]; busy: boolean; onSave: (b: Patch) => void; onCancel: () => void }) {
  const [name, setName] = useState(cat?.name ?? '')
  const [colour, setColour] = useState(cat?.colour ?? '')
  const [icon, setIcon] = useState(cat?.icon ?? '')
  const submit = () => name.trim() && onSave({ name: name.trim(), colour, icon })
  return (
    <form className="cat-form" onSubmit={(e) => (e.preventDefault(), submit())} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancel())}>
      <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus required /></label>
      <div className="field"><span>Colour</span>
        <div className="cal-picker" role="radiogroup" aria-label="Colour">
          <button type="button" role="radio" aria-checked={!colour} className="cal-pick" title="Calendar colour" onClick={() => setColour('')}><Icon name="ban" size={13} /></button>
          {CAL_COLOURS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={colour === c} aria-label={c} title={c} className="cal-pick" onClick={() => setColour(c)}>
              <span className="cal-swatch" style={{ background: c }}>{colour === c && <Icon name="check" size={12} />}</span>
            </button>
          ))}
          <label className={'cal-pick cal-custom' + (colour && !CAL_COLOURS.includes(colour) ? ' on' : '')} title="Custom colour">
            <span className="cal-swatch" style={{ background: colour && !CAL_COLOURS.includes(colour) ? colour : 'conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ef4444)' }} />
            <input type="color" aria-label="Custom colour" value={colour || '#888888'} onChange={(e) => setColour(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="field"><span>Icon</span>
        <div className="cal-picker" role="radiogroup" aria-label="Icon">
          <button type="button" role="radio" aria-checked={!icon} className="cal-pick" title="None" onClick={() => setIcon('')}><Icon name="x" size={13} /></button>
          {icons.map((i) => <button type="button" key={i} role="radio" aria-checked={icon === i} aria-label={i} title={i} className="cal-pick" onClick={() => setIcon(i)}><Icon name={i} size={15} /></button>)}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: '0.375rem' }}>
        <button type="button" className="btn sm" onClick={onCancel}>Cancel</button>
        <button className="btn primary sm" disabled={!name.trim() || busy}>{cat ? 'Save' : 'Add category'}</button>
      </div>
    </form>
  )
}
