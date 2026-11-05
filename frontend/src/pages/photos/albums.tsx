// Photos › Albums: list (sort, grid/list), create, one album (banner, edit, share, delete, its timeline).
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, get, patch, post, safeHref } from '../../lib/api'
import type { Album } from '../../lib/types'
import { useMe } from '../../lib/queries'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, ErrorBox, Menu, MenuItem, Switch } from '../../components/ui'
import { toast } from '../../components/toast'
import { PhotoStream, type Zoom } from './PhotoStream'
import { albumContext } from './select'
import { copyLinks, deleteAlbum, useAlbumMutations, useAlbums, type AlbumMember } from './actions'
import { PageHead, plural } from './parts'
import { fmtBytes } from './util'

type Sort = 'name' | 'items' | 'size' | 'mine'
const SORT_KEY = 'app.photos.albumSort'
const VIEW_KEY = 'app.photos.albumView'
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}

export function AlbumsPage() {
  const q = useAlbums()
  const [creating, setCreating] = useState(false)
  const [sort, setSortState] = useState<Sort>(() => (['name', 'items', 'size', 'mine'].includes(ls.get(SORT_KEY) ?? '') ? ls.get(SORT_KEY) as Sort : 'name'))
  const [view, setViewState] = useState<'grid' | 'list'>(() => (ls.get(VIEW_KEY) === 'list' ? 'list' : 'grid'))
  const setSort = (s: Sort) => (setSortState(s), ls.set(SORT_KEY, s))
  const setView = (v: 'grid' | 'list') => (setViewState(v), ls.set(VIEW_KEY, v))
  const navigate = useNavigate()
  const list = [...(q.data ?? [])].sort((a, b) =>
    sort === 'items' ? b.count - a.count : sort === 'size' ? (b.size_kb ?? 0) - (a.size_kb ?? 0) : sort === 'mine' ? Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
  return (
    <div className="page ph-page">
      <PageHead title="Albums" sub={q.data ? plural(q.data.length, 'album') : undefined}>
        {!!q.data?.length && (
          <>
            <select className="select sm-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort albums">
              <option value="name">Name</option>
              <option value="items">Most items</option>
              <option value="size">Largest</option>
              <option value="mine">Mine first</option>
            </select>
            <div className="seg" role="group" aria-label="View">
              <button aria-pressed={view === 'grid'} onClick={() => setView('grid')} title="Grid"><Icon name="apps" size={14} /><span className="sr-only">Grid</span></button>
              <button aria-pressed={view === 'list'} onClick={() => setView('list')} title="List"><Icon name="list" size={14} /><span className="sr-only">List</span></button>
            </div>
          </>
        )}
        <button className="btn primary sm" onClick={() => setCreating(true)}><Icon name="plus" size={14} /><span>New album</span></button>
      </PageHead>
      {q.isPending ? (
        <div className="albums">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="album-card">
              <span className="sk album-cover" />
              <span className="sk" style={{ width: '60%', height: '0.75rem', marginTop: '0.5rem' }} />
            </div>
          ))}
        </div>
      ) : q.isError && !q.data ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !q.data.length ? (
        <div className="empty left">
          <p>No albums yet. Albums collect photos from across your library and can be shared.</p>
          <button className="btn sm" onClick={() => setCreating(true)}><Icon name="plus" size={14} />Create an album</button>
        </div>
      ) : view === 'list' ? (
        <ul className="ph-alblist">
          {list.map((a) => {
            const src = a.cover ? safeHref(a.cover.thumb_url) : null
            return (
              <li key={a.id}>
                <Link to={`/photos/albums/${a.id}`} className="ph-alblist-row">
                  <span className="ph-albpick-cover">{src ? <img src={src} alt="" loading="lazy" /> : <Icon name="album" />}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="album-name truncate" style={{ display: 'block' }}>{a.name}</span>
                    {a.description && <span className="album-desc truncate" style={{ display: 'block' }}>{a.description}</span>}
                  </span>
                  {a.public && <span className="chip accent">Public</span>}
                  {!a.mine && <span className="chip">Shared with you</span>}
                  <span className="muted xsmall tabular ph-alblist-meta">{plural(a.count, 'item')}{a.size_kb ? ` · ${fmtBytes(a.size_kb)}` : ''}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="albums">
          {list.map((a) => {
            const src = a.cover ? safeHref(a.cover.thumb_url) : null
            return (
              <Link key={a.id} to={`/photos/albums/${a.id}`} className="album-card">
                <span className="album-cover">
                  {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <Icon name="album" size={28} />}
                </span>
                <span className="album-name truncate">{a.name}</span>
                {a.description && <span className="album-desc truncate" title={a.description}>{a.description}</span>}
                <span className="album-meta">
                  {plural(a.count, 'item')}{a.size_kb ? ` · ${fmtBytes(a.size_kb)}` : ''}
                  {a.public && <span className="chip accent">Public</span>}
                  {!a.mine && <span className="chip">Shared with you</span>}
                </span>
              </Link>
            )
          })}
        </div>
      )}
      {creating && <AlbumDialog onClose={() => setCreating(false)} onSaved={(a) => navigate(`/photos/albums/${a.id}`)} />}
    </div>
  )
}

/** Create (no album) or edit an album's name, description and visibility. */
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
    if (album) update.mutate({ id: album.id, ...body }, { onSuccess: done, onError: (err) => toast.error((err as Error).message) })
    else create.mutate(body, { onSuccess: done, onError: (err) => toast.error((err as Error).message) })
  }
  return (
    <Dialog open onClose={onClose} title={album ? 'Edit album' : 'New album'} width="28rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={() => submit()}>{busy ? 'Saving…' : album ? 'Save' : 'Create'}</button></>}>
      <form className="ph-form" onSubmit={submit}>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required autoFocus placeholder="e.g. Summer vacation" /></label>
        <label className="field"><span>Description</span><textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={2000} placeholder="What's this album about?" /></label>
        <Switch checked={pub} onChange={setPub} label="Public album" />
        <p className="help" style={{ margin: 0 }}>{pub ? 'Anyone signed in to this site who has the link can view it.' : 'Only you and the people you share it with can see it.'}</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function AlbumPage({ zoom }: { zoom: Zoom }) {
  const { id = '' } = useParams()
  const albums = useAlbums()
  const me = useMe().data
  const album = albums.data?.find((a) => a.id === id)
  const valid = /^[0-9a-f-]{36}$/i.test(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    albumContext.set(album ?? null)
    return () => albumContext.set(null)
  }, [album])
  const cover = album?.cover ? safeHref(album.cover.thumb_url) : null
  const link = `/app/photos/albums/${id}`
  return (
    <div className="page ph-page">
      {album ? (
        <header className="ph-banner">
          <Link to="/photos/albums" className="btn ghost icon ph-banner-back" aria-label="Back to albums" title="Back to albums"><Icon name="chevronLeft" size={18} /></Link>
          <span className="ph-banner-cover">{cover ? <img src={cover} alt="" /> : <Icon name="album" size={28} />}</span>
          <div className="ph-banner-info">
            <div className="ph-banner-title">
              <h1 className="truncate">{album.name}</h1>
              <span className={'chip' + (album.public ? ' accent' : '')}>{album.public ? 'Public' : 'Private'}</span>
              {album.mine ? <span className="chip">Owner</span> : <span className="chip">Shared with you</span>}
            </div>
            {album.description && <p className="ph-banner-desc">{album.description}</p>}
            <p className="ph-banner-meta tabular">
              {[plural(album.count, 'item'), album.size_kb ? fmtBytes(album.size_kb) : '', album.mine && me ? `by @${me.username}` : ''].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="ph-banner-actions">
            {album.public && <button className="btn sm" onClick={() => copyLinks([link])} title="Copy a link to this album"><Icon name="link" size={14} /><span>Copy link</span></button>}
            {album.mine && (
              <>
                <button className="btn sm" onClick={() => setEditing(true)}><Icon name="edit" size={14} /><span>Edit</span></button>
                <button className="btn primary sm" onClick={() => setSharing(true)}><Icon name="users" size={14} /><span>Share</span></button>
                <Menu align="end" label="More album actions" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="More album actions" title="More"><Icon name="more" size={16} /></button>}>
                  {(close) => (
                    <>
                      <MenuItem icon="link" onClick={() => (close(), copyLinks([link]))}>Copy album link</MenuItem>
                      <MenuItem icon="trash" danger onClick={() => (close(), setDeleting(true))}>Delete album</MenuItem>
                    </>
                  )}
                </Menu>
              </>
            )}
          </div>
        </header>
      ) : (
        <PageHead back="/photos/albums" title={albums.isPending ? <span className="sk" style={{ display: 'inline-block', width: '10rem', height: '1rem' }} /> : 'Album'} />
      )}
      {valid ? (
        <PhotoStream queryKey={['photos', 'album', id]} path={`photos/albums/${id}/photos`} zoom={zoom}
          empty={album?.mine ? 'This album is empty. Select photos in the timeline and choose "Add to album".' : 'This album is empty.'} />
      ) : (
        <div className="empty left">Album not found.</div>
      )}
      {editing && album && <AlbumDialog album={album} onClose={() => setEditing(false)} />}
      {sharing && album && <ShareDialog album={album} onClose={() => setSharing(false)} />}
      <Confirm open={deleting} onClose={() => setDeleting(false)} title={album ? `Delete "${album.name}"?` : 'Delete album?'} confirmLabel="Delete album"
        body={`The album goes away for everyone it's shared with. Its ${album ? plural(album.count, 'photo') : 'photos'} stay in your library.`}
        onConfirm={() => {
          if (!album) return
          // Leave first, so the album's stream doesn't refetch a deleted album.
          navigate('/photos/albums', { replace: true })
          deleteAlbum(qc, album).then(() => toast.show(`Deleted "${album.name}"`), (e) => toast.error((e as Error).message))
        }} />
    </div>
  )
}

// ---------------------------------------------------------------- sharing
function ShareDialog({ album, onClose }: { album: Album; onClose: () => void }) {
  const qc = useQueryClient()
  const key = ['photos', 'album-members', album.id]
  const members = useQuery({ queryKey: key, queryFn: () => get<AlbumMember[]>(`photos/albums/${album.id}/members`) })
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const add = useMutation({
    mutationFn: () => post<AlbumMember>(`photos/albums/${album.id}/members`, { username: username.trim(), role }),
    onSuccess: (m) => {
      toast.show(`Shared with @${m.username}`)
      setUsername('')
      refresh()
    },
    onError: (e) => toast.error((e as ApiError).status === 404 ? `No user called "${username.trim()}".` : (e as Error).message),
  })
  const change = useMutation({
    mutationFn: ({ id, role }: { id: number; role: 'viewer' | 'editor' }) => patch(`photos/albums/${album.id}/members/${id}`, { role }),
    onMutate: ({ id, role }) => qc.setQueryData<AlbumMember[]>(key, (old) => old?.map((m) => (m.id === id ? { ...m, role } : m))),
    onError: (e) => (toast.error((e as Error).message), refresh()),
  })
  const drop = useMutation({
    mutationFn: (id: number) => api(`photos/albums/${album.id}/members/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.setQueryData<AlbumMember[]>(key, (old) => old?.filter((m) => m.id !== id))
      setConfirmId(null)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog open onClose={onClose} title={`Share "${album.name}"`} width="30rem" footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Done</button></>}>
      <form className="ph-share-add" onSubmit={(e) => (e.preventDefault(), username.trim() && add.mutate())}>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username to share with" autoComplete="off" maxLength={150} autoFocus />
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')} aria-label="Role">
          <option value="viewer">Can view</option>
          <option value="editor">Can edit</option>
        </select>
        <button type="submit" className="btn primary" disabled={!username.trim() || add.isPending}>Add</button>
      </form>
      <p className="help">Editors can add and remove photos. They get a notification when you add them.</p>
      <div className="label" style={{ marginTop: '0.75rem' }}>People with access</div>
      {members.isPending ? <p className="muted small">Loading…</p> : members.isError ? <ErrorBox error={members.error} retry={() => members.refetch()} /> : !members.data.length ? (
        <p className="muted small">Only you. Add someone by username above.</p>
      ) : (
        <ul className="ph-members">
          {members.data.map((m) => (
            <li key={m.id}>
              <span className="avatar" aria-hidden="true">{(m.name || m.username).slice(0, 1).toUpperCase()}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="truncate" style={{ display: 'block' }}>{m.name}</span>
                <span className="muted xsmall">@{m.username}</span>
              </span>
              <select className="select sm-select" value={m.role} onChange={(e) => change.mutate({ id: m.id, role: e.target.value as 'viewer' | 'editor' })} aria-label={`Role for ${m.username}`}>
                <option value="viewer">Can view</option>
                <option value="editor">Can edit</option>
              </select>
              {confirmId === m.id ? (
                <button className="btn sm danger" onClick={() => drop.mutate(m.id)} disabled={drop.isPending}>Remove?</button>
              ) : (
                <button className="btn ghost icon sm" onClick={() => setConfirmId(m.id)} aria-label={`Stop sharing with ${m.username}`} title="Stop sharing"><Icon name="x" size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
