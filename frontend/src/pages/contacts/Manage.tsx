// Contacts housekeeping dialogs: rename / delete tags and groups, and the reminder settings
// (birthdays, keep in touch; the same settings as Notifications › Reminders).
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Dialog, SkeletonRows, Switch, ErrorBox } from '../../components/ui'
import { toast } from '../../components/toast'
import { useContactSettings, useContactTags, useDeleteTag, useRenameTag, useSaveContactSettings, type Tag } from './api'
import { plural } from './util'

export function LabelsDialog({ open, onClose, startEditing, onRenamed, onDeleted, onOpen }: {
  open: boolean; onClose: () => void; startEditing?: number | null
  onRenamed: (t: Tag, name: string) => void; onDeleted: (t: Tag) => void; onOpen: (t: Tag) => void
}) {
  const tags = useContactTags()
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  useEffect(() => {
    if (open) (setEditing(startEditing ?? null), setDeleting(null))
  }, [open, startEditing])
  const list = tags.data ?? []
  const section = (kind: 'group' | 'tag', title: string, icon: string) => {
    const items = list.filter((t) => t.kind === kind)
    return (
      <section className="c-labels" aria-label={title}>
        <h3 className="detail-section-label">{title}</h3>
        {!items.length ? <p className="muted small">No {kind === 'group' ? 'groups' : 'tags'} yet. Add them to contacts with Edit.</p> : (
          <ul>
            {items.map((t) => (
              <li key={t.id}>
                {editing === t.id ? (
                  <RenameRow tag={t} onDone={(name) => (setEditing(null), name && onRenamed(t, name))} />
                ) : deleting === t.id ? (
                  <div className="c-label-row">
                    <span className="grow small">Delete {kind === 'group' ? 'group' : 'tag'} “{t.name}”? It's removed from {plural(t.count ?? 0, 'contact')}; the contacts stay.</span>
                    <button className="btn sm" onClick={() => setDeleting(null)}>Cancel</button>
                    <DeleteButton tag={t} onDone={() => (setDeleting(null), onDeleted(t))} />
                  </div>
                ) : (
                  <div className="c-label-row">
                    <Icon name={icon} size={14} className="muted" />
                    <button type="button" className="c-linkbtn grow truncate" onClick={() => onOpen(t)} title={`Show ${t.name}`}>{t.name}</button>
                    <span className="muted xsmall tabular">{t.count ?? 0}</span>
                    <button className="btn ghost icon sm" aria-label={`Rename ${t.name}`} title="Rename" onClick={() => setEditing(t.id)}><Icon name="edit" size={13} /></button>
                    <button className="btn ghost icon sm" aria-label={`Delete ${t.name}`} title="Delete" onClick={() => setDeleting(t.id)}><Icon name="trash" size={13} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }
  return (
    <Dialog open={open} onClose={onClose} title="Tags and groups" width="30rem" footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Done</button></>}>
      {tags.isPending ? <SkeletonRows rows={4} /> : tags.error && !tags.data ? <ErrorBox error={tags.error} retry={() => tags.refetch()} /> : (
        <div className="stack" style={{ gap: '1rem' }}>
          {section('group', 'Groups', 'folder')}
          {section('tag', 'Tags', 'tag')}
        </div>
      )}
    </Dialog>
  )
}

function RenameRow({ tag, onDone }: { tag: Tag; onDone: (name: string | null) => void }) {
  const rename = useRenameTag()
  const [name, setName] = useState(tag.name)
  const [error, setError] = useState('')
  const submit = () => {
    const n = name.trim()
    if (!n || n === tag.name) return onDone(null)
    rename.mutate({ id: tag.id, name: n }, { onSuccess: () => (toast.show(`Renamed to ${n}`), onDone(n)), onError: (e) => setError((e as Error).message) })
  }
  return (
    <form className="c-label-row" onSubmit={(e) => (e.preventDefault(), submit())}>
      <input className="input grow" value={name} onChange={(e) => (setName(e.target.value), setError(''))} maxLength={64} autoFocus aria-label={`New name for ${tag.name}`}
        aria-invalid={!!error} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), e.nativeEvent.stopImmediatePropagation(), onDone(null))} />
      <button type="button" className="btn sm" onClick={() => onDone(null)}>Cancel</button>
      <button className="btn primary sm" disabled={rename.isPending}>Save</button>
      {error && <span className="error-text c-label-err" role="alert">{error}</span>}
    </form>
  )
}

function DeleteButton({ tag, onDone }: { tag: Tag; onDone: () => void }) {
  const remove = useDeleteTag()
  return (
    <button className="btn sm danger" disabled={remove.isPending} onClick={() => remove.mutate(tag.id, { onSuccess: () => (toast.show(`Deleted ${tag.name}`), onDone()) })}>Delete</button>
  )
}

export function ContactSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useContactSettings(open)
  const save = useSaveContactSettings()
  const s = settings.data
  return (
    <Dialog open={open} onClose={onClose} title="Reminders" width="28rem" footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Done</button></>}>
      {settings.error && !s ? <ErrorBox error={settings.error} retry={() => settings.refetch()} /> : !s ? <SkeletonRows rows={2} /> : (
        <div className="stack" style={{ gap: '0.875rem' }}>
          <p className="muted small">Sent once each morning to your notification inbox and delivery channels. Changes save straight away.</p>
          <label className="row c-set-row">
            <span className="grow"><span className="small" style={{ fontWeight: 500 }}>Birthdays</span><span className="help">A heads-up for each contact's birthday</span></span>
            <select className="select" style={{ width: 'auto' }} value={s.birthday_reminders} onChange={(e) => save.mutate({ birthday_reminders: e.target.value as 'off' })}>
              <option value="day_before">The day before</option>
              <option value="on_day">On the day</option>
              <option value="off">Off</option>
            </select>
          </label>
          <div className="row c-set-row">
            <span className="grow"><span className="small" style={{ fontWeight: 500 }}>Keep in touch</span><span className="help">When someone you keep in touch with is due</span></span>
            <Switch checked={s.keep_in_touch_reminders} onChange={(v) => save.mutate({ keep_in_touch_reminders: v })} label={<span className="sr-only">Keep in touch reminders</span>} />
          </div>
        </div>
      )}
    </Dialog>
  )
}
