// Calendar sync: the source picker with a live preview (New calendar and Settings › Set up sync), the
// "Sync now" / range sync runner, and V1's "Sync a range…" dialog with its term presets.
// API: POST /calendar/preview-source, POST /calendar/calendars/{id}/sync [{start, end, token}].
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Dialog } from '../../components/ui'
import { toast } from '../../components/toast'
import { ApiError, post } from '../../lib/api'
import { fmtDate, fmtTime } from '../../lib/dates'
import { rangeBody, termRange, type MonthRange } from './util'

export type SourceType = 1 | 2 | 50
export const SOURCES: { type: SourceType; label: string; field: string; placeholder: string }[] = [
  { type: 1, label: 'iCalendar link', field: 'Link', placeholder: 'https://… or webcal://… (.ics)' },
  { type: 2, label: 'Google calendar ID', field: 'Calendar ID', placeholder: 'something@group.calendar.google.com' },
  { type: 50, label: 'UWaterloo WCMS', field: 'Events page link', placeholder: 'https://uwaterloo.ca/…' },
]
export const sourceLabel = (t: number) => SOURCES.find((s) => s.type === t)?.label ?? 'Link'

/** Readable text for a failed preview or sync (503 = offline mode). */
export const syncError = (e: unknown) =>
  e instanceof ApiError && e.status === 503 ? 'Syncing is off on this server (offline mode).' : (e as Error).message || 'Something went wrong.'

/** Why this source can't be used yet (null when it looks fine). The server checks again. */
export function sourceProblem(type: SourceType, url: string): string | null {
  const v = url.trim()
  if (!v) return type === 2 ? 'Enter the calendar ID.' : 'Enter the link.'
  if (type !== 2 && !/^(https?|webcals?):\/\//i.test(v)) return 'Use an http(s) or webcal link.'
  return null
}

export interface Preview {
  name: string | null; events: number | null; series: number | null
  upcoming: { name: string; start: string; all_day: boolean; repeats: boolean }[]
}

/** Type picker, link field, and (for iCal and Google) a Preview of what the source holds. */
export function SourceFields({ type, url, onType, onUrl, onName, autoFocus }: {
  type: SourceType; url: string; onType: (t: SourceType) => void; onUrl: (u: string) => void
  /** The feed's own name, when a preview finds one. */
  onName?: (name: string) => void
  autoFocus?: boolean
}) {
  const src = SOURCES.find((s) => s.type === type)!
  const preview = useMutation({
    mutationFn: () => post<Preview>('calendar/preview-source', { calendar_type: type, url: url.trim() }),
    onSuccess: (p) => p.name && onName?.(p.name),
  })
  // A new type or link makes the old preview meaningless.
  useEffect(() => preview.reset(), [type, url]) // eslint-disable-line react-hooks/exhaustive-deps
  const problem = url.trim() ? sourceProblem(type, url) : null
  return (
    <div className="stack" style={{ gap: '0.625rem' }}>
      <div className="field"><span>Source</span>
        <div className="seg cal-src-seg" role="group" aria-label="Source type">
          {SOURCES.map((s) => <button key={s.type} type="button" aria-pressed={type === s.type} onClick={() => onType(s.type)}>{s.label}</button>)}
        </div>
      </div>
      <label className="field"><span>{src.field}</span>
        <div className="row" style={{ gap: '0.375rem' }}>
          <input className="input grow" value={url} onChange={(e) => onUrl(e.target.value)} placeholder={src.placeholder} maxLength={256} aria-invalid={!!problem}
            autoFocus={autoFocus} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
          {type !== 50 && (
            <button type="button" className="btn" onClick={() => preview.mutate()} disabled={!!sourceProblem(type, url) || preview.isPending}>
              {preview.isPending ? 'Reading…' : 'Preview'}
            </button>
          )}
        </div>
        {problem ? <span className="error-text">{problem}</span>
          : type === 1 ? <span className="help">For a private Google or Outlook calendar, use its <strong>secret address in iCal format</strong>.</span>
          : type === 2 ? <span className="help">Public Google calendars only. For a private one, use its secret address in iCal format with "iCalendar link".</span>
          : <span className="help">WCMS events can't be previewed: create the calendar and it syncs right away.</span>}
      </label>
      {preview.isError && <p className="error-text" role="alert">{syncError(preview.error)}</p>}
      {preview.data && <PreviewBox p={preview.data} />}
    </div>
  )
}

function PreviewBox({ p }: { p: Preview }) {
  const counts = [p.events != null ? `${p.events.toLocaleString()} ${p.events === 1 ? 'event' : 'events'}` : '',
    p.series ? `${p.series.toLocaleString()} repeating` : ''].filter(Boolean).join(' · ')
  return (
    <div className="cal-preview" role="status">
      <div className="row" style={{ gap: '0.5rem' }}>
        <Icon name="check" size={14} className="cal-preview-ok" />
        <strong className="grow truncate">{p.name || 'Untitled calendar'}</strong>
        {counts && <span className="muted xsmall">{counts}</span>}
      </div>
      {p.upcoming.length ? (
        <ul className="cal-preview-list">
          {p.upcoming.map((e, i) => {
            const d = new Date(e.start)
            return (
              <li key={i}>
                <span className="muted tabular">{fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}{e.all_day ? '' : ` · ${fmtTime(d)}`}</span>
                <span className="grow truncate">{e.name}</span>
                {e.repeats && <Icon name="repeat" size={12} className="muted" title="Repeats" />}
              </li>
            )
          })}
        </ul>
      ) : <p className="muted xsmall">No upcoming events.</p>}
    </div>
  )
}

export type SyncResult = { ok: boolean; not_modified?: boolean; last_synced_at?: string | null; last_sync_error?: string }

/** Sync a calendar now (its own window) or a month range; toasts the result and refreshes events and status. */
export function useRunSync(id: number, name?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: { start: string; end: string; token?: string }) => post<SyncResult>(`calendar/calendars/${id}/sync`, body),
    onSuccess: (r) => (r.ok ? toast.show(r.not_modified ? `${name ? `"${name}" is` : 'Already'} up to date` : `Synced${name ? ` "${name}"` : ''}`) : toast.error(r.last_sync_error || 'Sync failed')),
    onError: (e) => toast.error(syncError(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['calendar', 'detail', id] })
      qc.invalidateQueries({ queryKey: ['calendar', 'events'] })
      qc.invalidateQueries({ queryKey: ['calendar', 'agenda'] })
    },
  })
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** V1's "Sync events": a month range (end exclusive), term presets, and a token for private Google calendars. */
export function RangeSyncDialog({ id, name, google, open, onClose }: { id: number; name: string; google: boolean; open: boolean; onClose: () => void }) {
  const now = new Date()
  // V1's defaults: this month to next month.
  const initial = (): MonthRange => ({ sm: now.getMonth(), sy: now.getFullYear(), em: (now.getMonth() + 1) % 12, ey: now.getFullYear() + (now.getMonth() === 11 ? 1 : 0) })
  const [r, setR] = useState<MonthRange>(initial)
  const [token, setToken] = useState('')
  useEffect(() => { if (open) { setR(initial()); setToken('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = useRunSync(id, name)
  const years = Array.from({ length: 11 }, (_, i) => now.getFullYear() - 5 + i)
  const body = rangeBody(r)
  const bad = body.end <= body.start ? 'The end month must be after the start month.'
    : (r.ey - r.sy) * 12 + (r.em - r.sm) > 36 ? 'Sync up to three years at a time.' : null
  const monthYear = (label: string, m: number, y: number, set: (m: number, y: number) => void) => (
    <div className="field"><span>{label}</span>
      <div className="row" style={{ gap: '0.375rem' }}>
        <select className="select grow" value={m} onChange={(e) => set(Number(e.target.value), y)} aria-label={`${label} month`}>
          {MONTHS.map((mm, i) => <option key={mm} value={i}>{mm}</option>)}
        </select>
        <select className="select" value={y} onChange={(e) => set(m, Number(e.target.value))} aria-label={`${label} year`}>
          {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
        </select>
      </div>
    </div>
  )
  const submit = () => !bad && run.mutate({ ...body, ...(google && token.trim() ? { token: token.trim() } : {}) }, { onSuccess: (res) => res.ok && onClose() })
  return (
    <Dialog open={open} onClose={onClose} title={`Sync a range: ${name}`} width="28rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!!bad || run.isPending}>{run.isPending ? 'Syncing…' : 'Sync'}</button></>}>
      <form className="stack" style={{ gap: '0.75rem' }} onSubmit={(e) => (e.preventDefault(), submit())}>
        <div className="row" style={{ gap: '0.375rem', flexWrap: 'wrap' }}>
          <span className="muted small">Presets</span>
          <button type="button" className="btn sm" onClick={() => setR(termRange(new Date(), false))} title="From this month to the end of the term">This term</button>
          <button type="button" className="btn sm" onClick={() => setR(termRange(new Date(), true))} title="The whole term: Sep–Dec, Jan–Apr or May–Sep">Full term</button>
        </div>
        {monthYear('From', r.sm, r.sy, (sm, sy) => setR({ ...r, sm, sy }))}
        {monthYear('Until (not included)', r.em, r.ey, (em, ey) => setR({ ...r, em, ey }))}
        <p className="help">Syncs {fmtDate(new Date(r.sy, r.sm, 1), { month: 'long', year: 'numeric' })} up to the start of {fmtDate(new Date(r.ey, r.em, 1), { month: 'long', year: 'numeric' })}.</p>
        {bad && <p className="error-text">{bad}</p>}
        {google && (
          <label className="field"><span>Access token (optional)</span>
            <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" maxLength={4096} />
            <span className="help">Only for private Google calendars: an OAuth access token with calendar read access. Sent once, not stored.</span>
          </label>
        )}
      </form>
    </Dialog>
  )
}
