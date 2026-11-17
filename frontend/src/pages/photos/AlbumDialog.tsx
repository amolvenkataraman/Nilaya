// Create (no album given) or edit an album's name, description and visibility.
import { type FormEvent, useState } from 'react'
import { toast } from '../../components/toast'
import { Button, Dialog, Field, Input, Switch, Textarea } from '../../components/ui'
import type { Album } from '../../lib/types'
import { useAlbumMutations } from './actions'

export function AlbumDialog({ album, onClose, onSaved }: { album?: Album; onClose: () => void; onSaved?: (a: Album) => void }) {
  const { create, update } = useAlbumMutations()
  const [name, setName] = useState(album?.name ?? '')
  const [desc, setDesc] = useState(album?.description ?? '')
  const [pub, setPub] = useState(album?.public ?? false)
  const busy = create.isPending || update.isPending
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const n = name.trim()
    if (!n || busy) return
    const body = { name: n.slice(0, 64), description: desc.trim(), public: pub }
    const done = (a: Album) => {
      toast.show(album ? 'Album saved' : `Created "${a.name}"`)
      onClose()
      onSaved?.(a)
    }
    if (album) update.mutate({ id: album.id, ...body }, { onSuccess: done })
    else create.mutate(body, { onSuccess: done })
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={album ? 'Edit album' : 'New album'}
      width="28rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => submit()}>
            {busy ? 'Saving…' : album ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form className="grid gap-3.5" onSubmit={submit}>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
            autoFocus
            placeholder="e.g. Summer vacation"
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What's this album about?"
          />
        </Field>
        <Switch checked={pub} onChange={setPub} label="Public album" />
        <p className="m-0 text-xs text-muted">
          {pub
            ? 'Anyone with the link can view it, signed in or not (hidden photos never show).'
            : 'Only you and the people you share it with can see it.'}
        </p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
