// Photos: selection (select mode, shift-click ranges, long-press, per-day select-all), the action
// bar (hide, add to album, download, share, delete) and the per-device thumbnail label.
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Dialog, Menu, MenuItem, Switch, isTyping } from '../../components/ui'
import { toast } from '../../components/toast'
import { api, post, safeHref } from '../../lib/api'
import type { Album, Photo } from '../../lib/types'
import { fmtBytes } from './util'
import { copyLinks, removeFromAlbum, setAlbumCover, useAlbumMutations, useAlbums, useHiddenMode } from './actions'

// ---------------------------------------------------------------- tiny external stores
function store<T>(initial: T) {
  let v = initial
  const subs = new Set<() => void>()
  return {
    get: () => v,
    set: (next: T) => ((v = next), subs.forEach((s) => s())),
    use: () => useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => v),
  }
}

/** The album being viewed (album page), so the action bar and viewer can offer album actions. */
export const albumContext = store<Album | null>(null)

export interface Selection { mode: boolean; picked: Map<string, Photo>; anchor: string | null }
export const selection = store<Selection>({ mode: false, picked: new Map(), anchor: null })
const setSel = (patch: Partial<Selection>) => selection.set({ ...selection.get(), ...patch })

export const select = {
  setMode(mode: boolean) {
    setSel(mode ? { mode } : { mode: false, picked: new Map(), anchor: null })
  },
  clear() {
    setSel({ picked: new Map(), anchor: null })
  },
  /** Toggle one photo; with `range`, select everything between the last clicked photo and this one. */
  toggle(p: Photo, order: Photo[], range = false) {
    const s = selection.get()
    const picked = new Map(s.picked)
    if (range && s.anchor) {
      const a = order.findIndex((x) => x.id === s.anchor)
      const b = order.findIndex((x) => x.id === p.id)
      if (a >= 0 && b >= 0) {
        for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) picked.set(x.id, x)
        return setSel({ mode: true, picked, anchor: p.id })
      }
    }
    if (picked.has(p.id)) picked.delete(p.id)
    else picked.set(p.id, p)
    setSel({ mode: true, picked, anchor: p.id })
  },
  setMany(photos: Photo[], on: boolean) {
    const picked = new Map(selection.get().picked)
    for (const p of photos) on ? picked.set(p.id, p) : picked.delete(p.id)
    setSel({ mode: true, picked })
  },
}

// ---------------------------------------------------------------- thumbnail label (per device)
export type TileLabel = 'none' | 'time' | 'city' | 'camera' | 'mp' | 'size' | 'blur'
export const TILE_LABELS: [TileLabel, string][] = [
  ['none', 'None'], ['time', 'Time taken'], ['city', 'City'], ['camera', 'Camera'], ['mp', 'Megapixels'], ['size', 'Size'], ['blur', 'Blur score'],
]
const LABEL_KEY = 'app.photos.label'
const readLabel = (): TileLabel => {
  try {
    const v = localStorage.getItem(LABEL_KEY) as TileLabel | null
    return v && TILE_LABELS.some(([k]) => k === v) ? v : 'time'
  } catch {
    return 'time'
  }
}
export const tileLabel = store<TileLabel>(readLabel())
export function setTileLabel(v: TileLabel) {
  tileLabel.set(v)
  try { localStorage.setItem(LABEL_KEY, v) } catch { /* ignore */ }
}

export function labelText(p: Photo, l: TileLabel): string {
  switch (l) {
    case 'time': return p.date_taken ? new Date(p.date_taken).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''
    case 'city': return p.city ?? ''
    case 'camera': return p.camera ?? ''
    case 'mp': return p.megapixels ? `${p.megapixels.toFixed(1)} MP` : ''
    case 'size': return p.size_kb ? fmtBytes(p.size_kb) : ''
    case 'blur': return p.blur != null ? `Blur ${Math.round(p.blur)}` : ''
    default: return ''
  }
}

/** Everything about a tile, for its tooltip. */
export function tileTitle(p: Photo): string {
  const lines: string[] = []
  if (p.date_taken) lines.push(new Date(p.date_taken).toLocaleString())
  if (p.city || p.country) lines.push([p.city, p.country].filter(Boolean).join(', '))
  if (p.camera) lines.push(p.camera)
  const tech = [p.width && p.height ? `${p.width}×${p.height}` : '', p.megapixels ? `${p.megapixels.toFixed(1)} MP` : '', p.size_kb ? fmtBytes(p.size_kb) : '',
    p.size_total_kb && p.size_kb && p.size_total_kb > p.size_kb ? `${fmtBytes(p.size_total_kb)} with originals` : ''].filter(Boolean).join(' · ')
  if (tech) lines.push(tech)
  if (p.blur != null) lines.push(`Blur score ${Math.round(p.blur)}`)
  if (p.has_raw || p.has_orig) lines.push([p.has_raw && 'RAW', p.has_orig && 'Original'].filter(Boolean).join(' + ') + ' kept')
  return lines.join('\n')
}

// ---------------------------------------------------------------- action bar
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
  // Delete key: confirm deleting the selection (like the classic page).
  useEffect(() => {
    if (!s.mode || !n) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || isTyping(e) || document.querySelector('.dialog,.viewer,.menu')) return
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
      const r = await post<{ changed: number }>('photos/hide', { ids, hidden })
      const verb = hidden ? 'Hid' : 'Unhid'
      if (!r.changed) toast.error(hidden ? 'Nothing to hide: you can only hide your own photos.' : 'None of these were hidden (or they aren\'t yours).')
      else toast.show(`${verb} ${r.changed} item${r.changed === 1 ? '' : 's'}${r.changed < n ? ` (${n - r.changed} skipped)` : ''}`, {
        action: { label: 'Undo', run: () => post('photos/hide', { ids, hidden: !hidden }).then(refresh) },
      })
      select.setMode(false)
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const download = () => {
    photos.forEach((p, i) => {
      const href = safeHref(p.url)
      if (!href) return
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = href
        a.download = ''
        a.rel = 'noopener'
        document.body.append(a)
        a.click()
        a.remove()
      }, i * 350) // browsers throttle bursts of downloads
    })
  }
  const share = () => copyLinks(photos.map((p) => safeHref(p.url)))
  return (
    <div className="ph-selbar" role="toolbar" aria-label="Selected photos">
      <button className="btn ghost icon sm" onClick={() => select.setMode(false)} aria-label="Cancel selection" title="Cancel (Esc)"><Icon name="x" /></button>
      <strong className="tabular">{n ? `${n} selected` : 'Select photos'}</strong>
      {n > 0 && <span className="muted xsmall">{fmtBytes(photos.reduce((t, p) => t + (p.size_kb ?? 0), 0))}</span>}
      <span className="spacer" />
      {n > 0 && (
        <>
          {album?.mine && n === 1 && (
            <button className="btn sm" onClick={() => setAlbumCover(qc, album, ids[0]).then(() => select.setMode(false))} title="Use this photo as the album cover"><Icon name="photo" size={14} /><span>Set as cover</span></button>
          )}
          {album && (
            <button className="btn sm" onClick={() => removeFromAlbum(qc, album, ids).then((ok) => ok && select.setMode(false))} title="Remove from this album (the photos stay in your library)"><Icon name="x" size={14} /><span>Remove from album</span></button>
          )}
          <button className="btn sm" onClick={() => setAlbumPick(true)}><Icon name="album" size={14} /><span>Add to album</span></button>
          <button className="btn sm" onClick={share}><Icon name="link" size={14} /><span>Share</span></button>
          <button className="btn sm" onClick={download}><Icon name="arrowDown" size={14} /><span>Download</span></button>
          <button className="btn sm" onClick={() => hide(true)} title="Hide from everyone (only you can reveal them)"><Icon name="ban" size={14} /><span>Hide</span></button>
          {hiddenMode && <button className="btn sm" onClick={() => hide(false)} title="Make hidden photos visible again"><Icon name="refresh" size={14} /><span>Unhide</span></button>}
          <button className="btn sm danger" onClick={() => setConfirmDelete(true)} title="Delete (Del)"><Icon name="trash" size={14} /><span>Delete</span></button>
          <button className="btn ghost sm" onClick={select.clear}>Clear</button>
        </>
      )}
      {albumPick && <AlbumPicker ids={ids} onClose={() => setAlbumPick(false)} />}
      {confirmDelete && <DeleteDialog ids={ids} onClose={() => setConfirmDelete(false)} onDone={() => (select.setMode(false), refresh())} />}
    </div>
  )
}

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
      toast.show(added.length ? `Added ${added.length} to "${album.name}"` : `Already in "${album.name}"`, added.length ? {
        action: { label: 'Undo', run: () => api(`photos/albums/${album.id}/photos`, { method: 'DELETE', body: { ids: added } }).then(() => qc.invalidateQueries({ queryKey: ['photos', 'album', album.id] })) },
      } : {})
      onClose()
      select.setMode(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const createAndAdd = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    create.mutate({ name: n.slice(0, 64), description: '', public: pub }, { onSuccess: (a) => add.mutate(a), onError: (err) => toast.error((err as Error).message) })
  }
  // The API doesn't say whether you can edit someone else's album: list yours first, then shared ones (the server checks).
  const list = [...(albums.data ?? [])].sort((a, b) => Number(b.mine) - Number(a.mine))
  return (
    <Dialog open onClose={onClose} title={`Add ${ids.length} to an album`} width="26rem">
      {creating ? (
        <form className="ph-newalb" onSubmit={createAndAdd}>
          <label className="field"><span>New album name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus placeholder="e.g. Summer trip" /></label>
          <Switch checked={pub} onChange={setPub} label="Public album" />
          <div className="row" style={{ gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setCreating(false)}>Back</button>
            <button type="submit" className="btn primary" disabled={!name.trim() || create.isPending || add.isPending}>{create.isPending || add.isPending ? 'Creating…' : 'Create and add'}</button>
          </div>
        </form>
      ) : (
        <ul className="ph-albpick">
          <li>
            <button onClick={() => setCreating(true)}>
              <span className="ph-albpick-cover"><Icon name="plus" /></span>
              <span className="grow truncate">New album…</span>
            </button>
          </li>
          {albums.isPending && <li className="muted small" style={{ padding: '0.5rem' }}>Loading albums…</li>}
          {list.map((a) => {
            const src = a.cover ? safeHref(a.cover.thumb_url) : null
            return (
              <li key={a.id}>
                <button onClick={() => add.mutate(a)} disabled={add.isPending}>
                  <span className="ph-albpick-cover">{src ? <img src={src} alt="" /> : <Icon name="album" />}</span>
                  <span className="grow truncate">{a.name}</span>
                  {!a.mine && <span className="chip">Shared</span>}
                  <span className="muted xsmall">{a.count}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}

export function DeleteDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const n = ids.length
  const run = async () => {
    setBusy(true)
    try {
      const r = await post<{ deleted: number }>('photos/delete', { ids })
      if (!r.deleted) toast.error('Nothing was deleted. You can only delete from libraries you own or edit.')
      else toast.show(`Deleted ${r.deleted} item${r.deleted === 1 ? '' : 's'}${r.deleted < n ? ` (${n - r.deleted} skipped: libraries you can only view)` : ''}`)
      onDone()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Permanently delete ${n} item${n === 1 ? '' : 's'}?`} width="28rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" style={{ background: 'var(--app-danger)', borderColor: 'var(--app-danger)', color: '#fff' }} disabled={typed !== 'DELETE' || busy} onClick={run}>{busy ? 'Deleting…' : 'Delete forever'}</button></>}>
      <p className="small">This removes the files from disk, including originals and RAW files. It can't be undone. To keep them out of sight instead, use <strong>Hide</strong>.</p>
      <label className="field"><span>Type <strong>DELETE</strong> to confirm</span><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" /></label>
    </Dialog>
  )
}

/** Toolbar controls: select toggle and the thumbnail-label menu. */
export function SelectToggle() {
  const s = selection.use()
  return (
    <button className={'btn sm ph-select-btn' + (s.mode ? ' on' : '')} aria-pressed={s.mode} onClick={() => select.setMode(!s.mode)} title="Select photos (shift-click for a range)">
      <Icon name="check" size={14} /><span>Select</span>
    </button>
  )
}
export function LabelMenu() {
  const l = tileLabel.use()
  return (
    <Menu align="end" label="Label on thumbnails" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="Label on thumbnails" title="Label on thumbnails"><Icon name="tag" size={15} /></button>}>
      {(close) => (
        <>
          <div className="menu-label">Label on thumbnails</div>
          {TILE_LABELS.map(([k, name]) => <MenuItem key={k} active={l === k} end={l === k ? '✓' : undefined} onClick={() => (close(), setTileLabel(k))}>{name}</MenuItem>)}
        </>
      )}
    </Menu>
  )
}
