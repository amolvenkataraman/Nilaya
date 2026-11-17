// The sticky action bar of select mode: count and size, then set as cover / remove from album (on an album
// page), add to album, share, download, hide/unhide, delete. Delete key opens the delete confirmation.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { layerOpen } from '../../components/layers'
import { toast } from '../../components/toast'
import { Button, isTyping } from '../../components/ui'
import { safeHref } from '../../lib/api'
import { fmtBytes } from '../../lib/format'
import { copyLinks, downloadFiles, removeFromAlbum, setAlbumCover, setPhotosHidden, undoHide, useHiddenMode } from './actions'
import { AlbumPicker } from './AlbumPicker'
import { DeleteDialog } from './DeleteDialog'
import { albumContext, selection } from './selection'

/** Button labels give way to icons on phones. */
const label = 'max-md:hidden'

export function SelectionBar() {
  const s = selection.use()
  const album = albumContext.use()
  const hiddenMode = useHiddenMode().data?.show ?? false
  const qc = useQueryClient()
  const [albumPick, setAlbumPick] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const photos = [...s.picked.values()]
  const ids = photos.map((p) => p.id)
  const n = ids.length
  useEffect(() => {
    if (!s.mode || !n) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || isTyping(e) || layerOpen(['dialog', 'viewer', 'menu'])) return
      e.preventDefault()
      setConfirmDelete(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [s.mode, n])
  if (!s.mode) return null
  const refresh = () => qc.invalidateQueries({ queryKey: ['photos'] })

  const hide = async (hidden: boolean) => {
    try {
      const changed = await setPhotosHidden(ids, hidden)
      if (!changed)
        toast.error(hidden ? 'Nothing to hide: you can only hide your own photos.' : "None of these were hidden (or they aren't yours).")
      else
        toast.show(
          `${hidden ? 'Hid' : 'Unhid'} ${changed} item${changed === 1 ? '' : 's'}${changed < n ? ` (${n - changed} skipped)` : ''}`,
          { action: undoHide(qc, ids, hidden) },
        )
      selection.setMode(false)
      refresh()
    } catch (e) {
      toast.fail(e)
    }
  }
  return (
    <div
      className="sticky top-[calc(var(--topbar-h)+0.25rem)] z-20 mb-3 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 shadow-pop"
      role="toolbar"
      aria-label="Selected photos"
    >
      <Button variant="ghost" size="sm" icon onClick={() => selection.setMode(false)} aria-label="Cancel selection" title="Cancel (Esc)">
        <Icon name="x" />
      </Button>
      <strong className="tabular-nums">{n ? `${n} selected` : 'Select photos'}</strong>
      {n > 0 && <span className="text-xs text-muted">{fmtBytes(photos.reduce((t, p) => t + (p.size_kb ?? 0), 0))}</span>}
      <span className="flex-1" />
      {n > 0 && (
        <>
          {album?.mine && n === 1 && (
            <Button
              size="sm"
              onClick={() => setAlbumCover(qc, album, ids[0]).then(() => selection.setMode(false))}
              title="Use this photo as the album cover"
            >
              <Icon name="photo" size={14} />
              <span className={label}>Set as cover</span>
            </Button>
          )}
          {album && (
            <Button
              size="sm"
              onClick={() => removeFromAlbum(qc, album, ids).then((ok) => ok && selection.setMode(false))}
              title="Remove from this album (the photos stay in your library)"
            >
              <Icon name="x" size={14} />
              <span className={label}>Remove from album</span>
            </Button>
          )}
          <Button size="sm" onClick={() => setAlbumPick(true)}>
            <Icon name="album" size={14} />
            <span className={label}>Add to album</span>
          </Button>
          <Button size="sm" onClick={() => copyLinks(photos.map((p) => safeHref(p.url)))}>
            <Icon name="link" size={14} />
            <span className={label}>Share</span>
          </Button>
          <Button size="sm" onClick={() => downloadFiles(photos.map((p) => safeHref(p.url)))}>
            <Icon name="arrowDown" size={14} />
            <span className={label}>Download</span>
          </Button>
          <Button size="sm" onClick={() => hide(true)} title="Hide from everyone (only you can reveal them)">
            <Icon name="ban" size={14} />
            <span className={label}>Hide</span>
          </Button>
          {hiddenMode && (
            <Button size="sm" onClick={() => hide(false)} title="Make hidden photos visible again">
              <Icon name="refresh" size={14} />
              <span className={label}>Unhide</span>
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)} title="Delete (Del)">
            <Icon name="trash" size={14} />
            <span className={label}>Delete</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={selection.clear}>
            Clear
          </Button>
        </>
      )}
      {albumPick && <AlbumPicker ids={ids} onClose={() => setAlbumPick(false)} />}
      {confirmDelete && (
        <DeleteDialog
          ids={ids}
          onClose={() => setConfirmDelete(false)}
          onDone={() => {
            selection.setMode(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}
