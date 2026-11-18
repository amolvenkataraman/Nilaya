// Calendar sync: the source picker with a live preview (New calendar and Settings › Set up sync), and V1's
// "Sync a range…" dialog with its term presets. API: POST /calendar/preview-source,
// POST /calendar/calendars/{id}/sync [{start, end, token}] (api.ts).
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Dialog, Field, Input, Segmented, Select } from '../../components/ui'
import { fmtDate, fmtTime } from '../../lib/dates'
import { plural } from '../../lib/format'
import { syncError, useSyncCalendar, usePreviewSource, type Preview } from './api'

export type SourceType = 1 | 2 | 50
export const SOURCES: { type: SourceType; label: string; field: string; placeholder: string }[] = [
  { type: 1, label: 'iCalendar link', field: 'Link', placeholder: 'https://… or webcal://… (.ics)' },
  { type: 2, label: 'Google calendar ID', field: 'Calendar ID', placeholder: 'something@group.calendar.google.com' },
  { type: 50, label: 'UWaterloo WCMS', field: 'Events page link', placeholder: 'https://uwaterloo.ca/…' },
]

/** How far back and ahead a synced calendar reaches, in months (the server's limit). */
export const MAX_SYNC_MONTHS = 120
export const clampMonths = (v: unknown) => Math.max(0, Math.min(MAX_SYNC_MONTHS, Number(v) || 0))

/** Why this source can't be used yet (null when it looks fine). The server checks again. */
export function sourceProblem(type: SourceType, url: string): string | null {
  const v = url.trim()
  if (!v) return type === 2 ? 'Enter the calendar ID.' : 'Enter the link.'
  if (type !== 2 && !/^(https?|webcals?):\/\//i.test(v)) return 'Use an http(s) or webcal link.'
  return null
}

/** The source-type switch, full width with equal parts. */
export function SourceTypes({ type, onType, disabled }: { type: SourceType; onType: (t: SourceType) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="m-0 contents border-0 p-0">
      <Segmented
        label="Source type"
        className={`w-full flex-wrap [&>button]:flex-1 [&>button]:justify-center [&>button]:whitespace-nowrap`}
        value={String(type)}
        onChange={(v) => onType(Number(v) as SourceType)}
        options={SOURCES.map((s) => ({ value: String(s.type), label: s.label }))}
      />
    </fieldset>
  )
}

/** Type picker, link field, and (for iCal and Google) a Preview of what the source holds. */
export function SourceFields({
  type,
  url,
  onType,
  onUrl,
  onName,
  autoFocus,
}: {
  type: SourceType
  url: string
  onType: (t: SourceType) => void
  onUrl: (u: string) => void
  /** The feed's own name, when a preview finds one. */
  onName?: (name: string) => void
  autoFocus?: boolean
}) {
  const src = SOURCES.find((s) => s.type === type)!
  const preview = usePreviewSource()
  // A new type or link makes the old preview meaningless.
  // biome-ignore lint/correctness/useExhaustiveDependencies: type and url are the triggers
  useEffect(() => preview.reset(), [type, url])
  const problem = url.trim() ? sourceProblem(type, url) : null
  return (
    <div className="grid gap-2.5">
      <div className="grid gap-1.25">
        <span className="text-xs font-medium text-muted">Source</span>
        <SourceTypes type={type} onType={onType} />
      </div>
      <Field
        label={src.field}
        error={problem}
        hint={
          type === 1 ? (
            <>
              For a private Google or Outlook calendar, use its <strong>secret address in iCal format</strong>.
            </>
          ) : type === 2 ? (
            'Public Google calendars only. For a private one, use its secret address in iCal format with "iCalendar link".'
          ) : (
            "WCMS events can't be previewed: create the calendar and it syncs right away."
          )
        }
      >
        <div className="flex items-center gap-1.5">
          <Input
            className="min-w-0 flex-auto"
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            placeholder={src.placeholder}
            maxLength={256}
            aria-invalid={!!problem}
            autoFocus={autoFocus}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {type !== 50 && (
            <Button
              onClick={() => preview.mutate({ calendar_type: type, url: url.trim() }, { onSuccess: (p) => p.name && onName?.(p.name) })}
              disabled={!!sourceProblem(type, url) || preview.isPending}
            >
              {preview.isPending ? 'Reading…' : 'Preview'}
            </Button>
          )}
        </div>
      </Field>
      {preview.isError && (
        <p className="text-xs text-danger" role="alert">
          {syncError(preview.error)}
        </p>
      )}
      {preview.data && <PreviewBox p={preview.data} />}
    </div>
  )
}

function PreviewBox({ p }: { p: Preview }) {
  const counts = [p.events != null ? plural(p.events, 'event') : '', p.series ? `${p.series.toLocaleString()} repeating` : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="grid gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-2.5" role="status">
      <div className="flex items-center gap-2">
        <Icon name="check" size={14} className="text-success" />
        <strong className="min-w-0 flex-auto truncate">{p.name || 'Untitled calendar'}</strong>
        {counts && <span className="text-xs text-muted">{counts}</span>}
      </div>
      {p.upcoming.length ? (
        <ul className="grid gap-1 text-sm">
          {p.upcoming.map((e) => {
            const d = new Date(e.start)
            return (
              <li key={`${e.start}${e.name}`} className="flex min-w-0 items-center gap-2">
                <span className="min-w-30 flex-none text-xs text-muted tabular-nums">
                  {fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {e.all_day ? '' : ` · ${fmtTime(d)}`}
                </span>
                <span className="min-w-0 flex-auto truncate">{e.name}</span>
                {e.repeats && <Icon name="repeat" size={12} className="text-muted" title="Repeats" />}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted">No upcoming events.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- manual range sync (V1's "Sync events")
/** A month range for syncing: 0-based months, end exclusive (the first of the end month), as in V1. */
export interface MonthRange {
  sm: number
  sy: number
  em: number
  ey: number
}

/** V1's term presets. "This term" (T) starts this month; "Full term" (TF) starts at the term's first month.
 *  Terms: Sep–Dec (ends Jan 1 next year), Jan–Apr (ends May 1), May–Aug (ends Oct 1). */
export function termRange(today: Date, full: boolean): MonthRange {
  const m = today.getMonth()
  const y = today.getFullYear()
  if (m >= 8) return { sm: full ? 8 : m, sy: y, em: 0, ey: y + 1 }
  if (m <= 3) return { sm: full ? 0 : m, sy: y, em: 4, ey: y }
  return { sm: full ? 4 : m, sy: y, em: 9, ey: y }
}

/** POST /calendar/calendars/{id}/sync body: the first day of each month, [start, end). */
export function rangeBody(r: MonthRange): { start: string; end: string } {
  const d = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start: d(r.sy, r.sm), end: d(r.ey, r.em) }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Longest range one sync may cover, in months. */
const MAX_RANGE_MONTHS = 36

/** V1's "Sync events": a month range (end exclusive), term presets, and a token for private Google calendars.
 *  Mounted only while open, so it starts fresh each time. */
export function RangeSyncDialog({ id, name, google, onClose }: { id: number; name: string; google: boolean; onClose: () => void }) {
  const now = new Date()
  // V1's defaults: this month to next month.
  const [r, setR] = useState<MonthRange>(() => ({
    sm: now.getMonth(),
    sy: now.getFullYear(),
    em: (now.getMonth() + 1) % 12,
    ey: now.getFullYear() + (now.getMonth() === 11 ? 1 : 0),
  }))
  const [token, setToken] = useState('')
  const run = useSyncCalendar(id, name)
  const years = Array.from({ length: 11 }, (_, i) => now.getFullYear() - 5 + i)
  const body = rangeBody(r)
  const bad =
    body.end <= body.start
      ? 'The end month must be after the start month.'
      : (r.ey - r.sy) * 12 + (r.em - r.sm) > MAX_RANGE_MONTHS
        ? 'Sync up to three years at a time.'
        : null
  const monthYear = (label: string, m: number, y: number, set: (m: number, y: number) => void) => (
    <div className="grid gap-1.25">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <Select className="min-w-0 flex-auto" value={m} onChange={(e) => set(Number(e.target.value), y)} aria-label={`${label} month`}>
          {MONTHS.map((mm, i) => (
            <option key={mm} value={i}>
              {mm}
            </option>
          ))}
        </Select>
        <Select width="content" value={y} onChange={(e) => set(m, Number(e.target.value))} aria-label={`${label} year`}>
          {years.map((yy) => (
            <option key={yy} value={yy}>
              {yy}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
  const submit = () => {
    if (bad) return
    run.mutate({ ...body, ...(google && token.trim() ? { token: token.trim() } : {}) }, { onSuccess: (res) => res.ok && onClose() })
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Sync a range: ${name}`}
      width="28rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!!bad || run.isPending}>
            {run.isPending ? 'Syncing…' : 'Sync'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted">Presets</span>
          <Button size="sm" onClick={() => setR(termRange(new Date(), false))} title="From this month to the end of the term">
            This term
          </Button>
          <Button size="sm" onClick={() => setR(termRange(new Date(), true))} title="The whole term: Sep–Dec, Jan–Apr or May–Sep">
            Full term
          </Button>
        </div>
        {monthYear('From', r.sm, r.sy, (sm, sy) => setR({ ...r, sm, sy }))}
        {monthYear('Until (not included)', r.em, r.ey, (em, ey) => setR({ ...r, em, ey }))}
        <p className="text-xs text-muted">
          Syncs {fmtDate(new Date(r.sy, r.sm, 1), { month: 'long', year: 'numeric' })} up to the start of{' '}
          {fmtDate(new Date(r.ey, r.em, 1), { month: 'long', year: 'numeric' })}.
        </p>
        {bad && <p className="text-xs text-danger">{bad}</p>}
        {google && (
          <Field
            label="Access token (optional)"
            hint="Only for private Google calendars: an OAuth access token with calendar read access. Sent once, not stored."
          >
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" maxLength={4096} />
          </Field>
        )}
      </form>
    </Dialog>
  )
}
