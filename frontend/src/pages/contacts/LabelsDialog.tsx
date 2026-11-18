// Tags and groups: each with its count, rename in place, delete after an inline confirmation (the contacts stay),
// and a click on the name shows that tag's contacts. Opening from a tag's menu starts with it in rename mode.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, Dialog, Input, QueryView, SkeletonRows } from '../../components/ui'
import { plural } from '../../lib/format'
import { useContactTags, useDeleteTag, useRenameTag, type Tag } from './api'
import { LinkButton } from './LinkButton'
import { useOpenCount } from '../../lib/useOpenCount'

const labelRow = 'flex min-h-9 flex-wrap items-center gap-1.5 rounded-sm px-1 py-0.5 hover:bg-hover'

interface Props {
  open: boolean
  onClose: () => void
  startEditing?: number | null
  onRenamed: (t: Tag, name: string) => void
  onDeleted: (t: Tag) => void
  onOpen: (t: Tag) => void
}

export function LabelsDialog(props: Props) {
  return <Labels key={useOpenCount(props.open)} {...props} />
}

function Labels({ open, onClose, startEditing, onRenamed, onDeleted, onOpen }: Props) {
  const tags = useContactTags()
  const [editing, setEditing] = useState<number | null>(startEditing ?? null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const section = (list: Tag[], kind: 'group' | 'tag', title: string, icon: string) => {
    const items = list.filter((t) => t.kind === kind)
    return (
      <section aria-label={title}>
        <h3>{title}</h3>
        {!items.length ? (
          <p className="text-sm text-muted">No {kind === 'group' ? 'groups' : 'tags'} yet. Add them to contacts with Edit.</p>
        ) : (
          <ul className="mt-1 grid gap-px">
            {items.map((t) => (
              <li key={t.id}>
                {editing === t.id ? (
                  <RenameRow
                    tag={t}
                    onDone={(name) => {
                      setEditing(null)
                      if (name) onRenamed(t, name)
                    }}
                  />
                ) : deleting === t.id ? (
                  <div className={labelRow}>
                    <span className="min-w-0 flex-auto text-sm">
                      Delete {kind === 'group' ? 'group' : 'tag'} “{t.name}”? It's removed from {plural(t.count ?? 0, 'contact')}; the
                      contacts stay.
                    </span>
                    <Button size="sm" onClick={() => setDeleting(null)}>
                      Cancel
                    </Button>
                    <DeleteButton
                      tag={t}
                      onDone={() => {
                        setDeleting(null)
                        onDeleted(t)
                      }}
                    />
                  </div>
                ) : (
                  <div className={labelRow}>
                    <Icon name={icon} size={14} className="text-muted" />
                    <LinkButton plain className="min-w-0 flex-auto truncate" onClick={() => onOpen(t)} title={`Show ${t.name}`}>
                      {t.name}
                    </LinkButton>
                    <span className="text-xs text-muted tabular-nums">{t.count ?? 0}</span>
                    <Button variant="ghost" size="sm" icon aria-label={`Rename ${t.name}`} title="Rename" onClick={() => setEditing(t.id)}>
                      <Icon name="edit" size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" icon aria-label={`Delete ${t.name}`} title="Delete" onClick={() => setDeleting(t.id)}>
                      <Icon name="trash" size={13} />
                    </Button>
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
    <Dialog
      open={open}
      onClose={onClose}
      title="Tags and groups"
      width="30rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <QueryView query={tags} skeleton={<SkeletonRows rows={4} />}>
        {(list) => (
          <div className="grid gap-4">
            {section(list, 'group', 'Groups', 'folder')}
            {section(list, 'tag', 'Tags', 'tag')}
          </div>
        )}
      </QueryView>
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
    rename.mutate(
      { id: tag.id, name: n },
      {
        onSuccess: () => {
          toast.show(`Renamed to ${n}`)
          onDone(n)
        },
        onError: (e) => setError((e as Error).message),
      },
    )
  }
  return (
    <form
      className={labelRow}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input
        className="min-w-32 flex-1"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setError('')
        }}
        maxLength={64}
        autoFocus
        aria-label={`New name for ${tag.name}`}
        aria-invalid={!!error}
        onKeyDown={(e) => {
          // Escape cancels the rename only, not the dialog.
          if (e.key !== 'Escape') return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onDone(null)
        }}
      />
      <Button size="sm" onClick={() => onDone(null)}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" size="sm" disabled={rename.isPending}>
        Save
      </Button>
      {error && (
        <span className="basis-full text-xs text-danger" role="alert">
          {error}
        </span>
      )}
    </form>
  )
}

function DeleteButton({ tag, onDone }: { tag: Tag; onDone: () => void }) {
  const remove = useDeleteTag()
  return (
    <Button
      variant="danger"
      size="sm"
      disabled={remove.isPending}
      onClick={() =>
        remove.mutate(tag.id, {
          onSuccess: () => {
            toast.show(`Deleted ${tag.name}`)
            onDone()
          },
        })
      }
    >
      Delete
    </Button>
  )
}
