// /photos/upload: the upload portal. Anyone with the link (signed in or not) sends photos and videos to
// the site's owner. Files go one at a time (XMLHttpRequest, for progress) to POST /photos/public/upload
// and are saved untouched (all metadata kept); nothing is imported automatically.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { errorMessage, get, readCookie } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { fmtBytes } from '../photos/util'
import { PublicFrame, PublicNotice, usePublicTitle } from './PublicFrame'

interface Info { enabled: boolean; recipient: string; extensions: string[] }
type Status = 'queued' | 'uploading' | 'saved' | 'failed'
interface Item { key: number; file: File; ext: string; status: Status; progress: number; message: string; savedAs: string; preview: string | null }

const PREVIEWABLE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', mpg: 'video/mpeg', avi: 'video/x-msvideo',
  '3gp': 'video/3gpp', mkv: 'video/x-matroska',
}
const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')
let nextKey = 1

/** One file to the server; resolves with its saved name, rejects with the server's message. */
function send(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/v2/photos/public/upload')
    xhr.setRequestHeader('X-CSRFToken', readCookie('csrftoken'))
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)))
    xhr.onerror = () => reject(new Error("Couldn't reach the server. Check your connection."))
    xhr.onabort = () => reject(new Error('Cancelled.'))
    xhr.onload = () => {
      let data: unknown = null
      try { data = JSON.parse(xhr.responseText) } catch { /* not JSON (e.g. a proxy error page) */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        const d = data as { saved?: string[]; errors?: string[] } | null
        if (d?.saved?.length) return resolve(d.saved[0])
        return reject(new Error(d?.errors?.join(' ') || 'The server saved nothing.'))
      }
      if (xhr.status === 413) return reject(new Error('This file is larger than the server accepts.'))
      reject(new Error(errorMessage(xhr.status, data)))
    }
    const body = new FormData()
    body.append('files', file, file.name)
    xhr.send(body)
  })
}

export default function Upload() {
  const info = useQuery({ queryKey: ['public', 'upload'], queryFn: () => get<Info>('photos/public/upload'), staleTime: 10 * 60_000 })
  const recipient = info.data?.recipient ?? ''
  usePublicTitle(recipient ? `Share media with ${recipient}` : 'Upload photos and videos')
  const [items, setItems] = useState<Item[]>([])
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  const allowed = useMemo(() => new Set(info.data?.extensions ?? []), [info.data])
  const busy = items.some((i) => i.status === 'uploading')

  const patch = useCallback((key: number, change: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i))), [])

  // One upload at a time: whenever nothing is in flight, start the next queued file.
  useEffect(() => {
    if (busy) return
    const next = items.find((i) => i.status === 'queued')
    if (!next) return
    patch(next.key, { status: 'uploading', progress: 0, message: '' })
    send(next.file, (p) => patch(next.key, { progress: p }))
      .then((savedAs) => patch(next.key, { status: 'saved', progress: 100, savedAs }))
      .catch((e: Error) => patch(next.key, { status: 'failed', message: e.message }))
  }, [items, busy, patch])

  // Object URLs for previews are released when a row goes away and on leaving the page.
  const previews = useRef(new Set<string>())
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), [])
  const drop = (keep: (i: Item) => boolean) => setItems((list) => list.filter((i) => {
    if (keep(i)) return true
    if (i.preview) { URL.revokeObjectURL(i.preview); previews.current.delete(i.preview) }
    return false
  }))

  function add(files: FileList | File[] | null) {
    if (!files) return
    const bad: string[] = []
    const fresh: Item[] = []
    for (const file of Array.from(files)) {
      const ext = extOf(file.name)
      if (!allowed.has(ext)) { bad.push(file.name); continue }
      const preview = PREVIEWABLE.has(ext) && file.size < 40 * 1024 * 1024 ? URL.createObjectURL(file) : null
      if (preview) previews.current.add(preview)
      fresh.push({ key: nextKey++, file, ext, status: 'queued', progress: 0, message: '', savedAs: '', preview })
    }
    setRejected(bad)
    if (fresh.length) setItems((list) => [...list, ...fresh])
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (info.data?.enabled) add(e.dataTransfer.files)
  }

  const total = items.reduce((t, i) => t + i.file.size, 0)
  const sent = items.reduce((t, i) => t + (i.status === 'saved' ? i.file.size : i.status === 'uploading' ? (i.file.size * i.progress) / 100 : 0), 0)
  const counts = { saved: 0, failed: 0, queued: 0, uploading: 0 }
  for (const i of items) counts[i.status]++
  const accept = (info.data?.extensions ?? []).map((e) => `.${e}${MIME[e] ? ',' + MIME[e] : ''}`).join(',')

  if (info.isPending) return <PublicFrame><div className="card"><SkeletonRows rows={5} /></div></PublicFrame>
  if (!info.data) return <PublicFrame><div className="card"><ErrorBox error={info.error} retry={() => info.refetch()} /></div></PublicFrame>
  if (!info.data.enabled) {
    return (
      <PublicFrame>
        <PublicNotice icon="ban" title="Uploads are turned off">
          <p className="muted small">This site isn't accepting photos or videos right now. Ask {recipient || 'the owner'} for another way to send them.</p>
        </PublicNotice>
      </PublicFrame>
    )
  }

  return (
    <PublicFrame>
      <header className="pub-head">
        <h1>Share media with <span className="pub-accent">{recipient}</span></h1>
        <p className="muted small"><Icon name="shield" size={13} /> Files arrive exactly as sent: dates, places and camera details are kept.</p>
      </header>
      <p className="pub-warn small" role="note">
        <Icon name="alert" size={14} />
        <span>This portal is only for sending photos and videos to {recipient}. Uploads are logged; please don't send anything else.</span>
      </p>

      <div
        className={'card up-drop' + (over ? ' over' : '')}
        onDragEnter={(e) => (e.preventDefault(), setOver(true))}
        onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = 'copy'))}
        onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0} aria-label="Choose photos and videos to upload"
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
      >
        <span className="up-drop-icon"><Icon name="arrowUp" size={22} /></span>
        <strong>Drag photos and videos here</strong>
        <span className="muted small">or</span>
        <button type="button" className="btn primary" onClick={(e) => (e.stopPropagation(), input.current?.click())}>Select files</button>
        <span className="up-exts" aria-label="Accepted file types">
          {info.data.extensions.map((e) => <span key={e} className="chip">.{e}</span>)}
        </span>
        <input ref={input} type="file" multiple hidden accept={accept} onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
      </div>

      {rejected.length > 0 && (
        <p className="pub-error" role="alert"><Icon name="alert" size={14} />
          {rejected.length === 1 ? `${rejected[0]} isn't a supported photo or video type.` : `${rejected.length} files aren't supported photo or video types: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? '…' : ''}`}
        </p>
      )}

      {items.length > 0 && (
        <section className="card up-queue" aria-label="Uploads">
          <div className="card-head">
            <h2>{items.length === 1 ? '1 file' : `${items.length} files`}</h2>
            <span className="count tabular">{fmtBytes(Math.round(sent / 1024))} of {fmtBytes(Math.round(total / 1024))}</span>
            <span className="grow" />
            {counts.failed > 0 && !busy && (
              <button className="btn sm" onClick={() => setItems((l) => l.map((i) => (i.status === 'failed' ? { ...i, status: 'queued', progress: 0, message: '' } : i)))}>
                <Icon name="refresh" size={13} />Retry failed
              </button>
            )}
            {counts.saved > 0 && <button className="btn sm ghost" onClick={() => drop((i) => i.status !== 'saved')}>Clear finished</button>}
          </div>
          <div className="up-total" aria-hidden="true"><span style={{ width: `${total ? (sent / total) * 100 : 0}%` }} /></div>
          <p className="up-summary xsmall muted tabular" aria-live="polite">
            {[counts.saved && `${counts.saved} saved`, counts.uploading && 'uploading', counts.queued && `${counts.queued} waiting`, counts.failed && `${counts.failed} failed`].filter(Boolean).join(' · ')}
          </p>
          <ul className="up-list">
            {items.map((i) => (
              <li key={i.key} className={'up-row ' + i.status}>
                <span className="up-thumb">{i.preview ? <img src={i.preview} alt="" /> : <span>{i.ext.toUpperCase()}</span>}</span>
                <span className="up-name">
                  <span className="truncate" title={i.file.name}>{i.file.name}</span>
                  <span className="xsmall muted tabular">
                    {fmtBytes(Math.max(1, Math.round(i.file.size / 1024)))}
                    {i.savedAs && i.savedAs !== i.file.name && ` · saved as ${i.savedAs}`}
                  </span>
                  {i.message && <span className="xsmall up-msg">{i.message}</span>}
                  {i.status === 'uploading' && <span className="up-bar" aria-hidden="true"><span style={{ width: `${i.progress}%` }} /></span>}
                </span>
                <span className={'chip up-badge ' + ({ queued: '', uploading: 'accent', saved: 'success', failed: 'danger' }[i.status])}>
                  {i.status === 'queued' ? 'Queued' : i.status === 'uploading' ? `Uploading ${i.progress}%` : i.status === 'saved' ? <><Icon name="check" size={12} />Saved</> : <><Icon name="x" size={12} />Failed</>}
                </span>
                {i.status !== 'uploading' && (
                  <button className="btn ghost icon sm" onClick={() => drop((x) => x.key !== i.key)} aria-label={`Remove ${i.file.name}`} title="Remove from the list">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PublicFrame>
  )
}
