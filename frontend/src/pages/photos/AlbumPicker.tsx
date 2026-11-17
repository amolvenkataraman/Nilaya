// "Add to album": pick one of your albums (yours first, then ones shared with you) or create one, with Undo.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, chipClass, Dialog, Field, Input, Switch } from '../../components/ui'
import { api, post } from '../../lib/api'
import type { Album } from '../../lib/types'
import { useAlbumMutations, useAlbums } from './actions'
import { AlbumCover } from './AlbumCover'
import { selection } from './selection'

const row = 'flex w-full items-center gap-2.5 rounded-sm p-1.5 text-left text-sm text-fg hover:bg-hover disabled:opacity-60'

export function AlbumPicker({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const albums = useAlbums()
  const { create } = useAlbumMutations()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [pub, setPub] = useState(false)
  const add = useMutation({
    mutationFn: (a: Album) => post<{ added: string[] }>(`photos/albums/${a.id}/photos`, { ids }).then((r) => ({ ...r, album: a })),
    onSuccess: ({ added, album }) => {
      qc.invalidateQueries({ queryKey: ['photos', 'albums'] })
      qc.invalidateQueries({ queryKey: ['photos', 'album', album.id] })
      toast.show(
        added.length ? `Added ${added.length} to "${album.name}"` : `Already in "${album.name}"`,
        added.length
          ? {
              action: {
                label: 'Undo',
                run: () =>
                  api(`photos/albums/${album.id}/photos`, { method: 'DELETE', body: { ids: added } }).then(() =>
                    qc.invalidateQueries({ queryKey: ['photos', 'album', album.id] }),
                  ),
              },
            }
          : {},
      )
      onClose()
      selection.setMode(false)
    },
  })
  const createAndAdd = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    create.mutate({ name: n.slice(0, 64), description: '', public: pub }, { onSuccess: (a) => add.mutate(a) })
  }
  // The API doesn't say whether you can edit someone else's album: list yours first, then shared ones (the server checks).
  const list = [...(albums.data ?? [])].sort((a, b) => Number(b.mine) - Number(a.mine))
  return (
    <Dialog open onClose={onClose} title={`Add ${ids.length} to an album`} width="26rem">
      {creating ? (
        <form className="grid gap-3.5" onSubmit={createAndAdd}>
          <Field label="New album name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus placeholder="e.g. Summer trip" />
          </Field>
          <Switch checked={pub} onChange={setPub} label="Public album" />
          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => setCreating(false)}>Back</Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending || add.isPending}>
              {create.isPending || add.isPending ? 'Creating…' : 'Create and add'}
            </Button>
          </div>
        </form>
      ) : (
        <ul className="grid max-h-[50vh] gap-0.5 overflow-auto">
          <li>
            <button type="button" className={row} onClick={() => setCreating(true)}>
              <span className="grid size-10 flex-none place-items-center rounded-sm bg-surface-2">
                <Icon name="plus" />
              </span>
              <span className="min-w-0 flex-1 truncate">New album…</span>
            </button>
          </li>
          {albums.isPending && <li className="p-2 text-sm text-muted">Loading albums…</li>}
          {list.map((a) => (
            <li key={a.id}>
              <button type="button" className={row} onClick={() => add.mutate(a)} disabled={add.isPending}>
                <AlbumCover album={a} lazy={false} className="size-10 rounded-sm" />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {!a.mine && <span className={chipClass()}>Shared</span>}
                <span className="text-xs text-muted">{a.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
