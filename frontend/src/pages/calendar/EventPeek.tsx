// Event details popover (Google Calendar style): click an event to see it, Edit opens the form.
// Anchored next to the clicked chip on desktop, a bottom sheet on phones. Extra fields from
// GET /calendar/events/{id} (recurrence, attendees, tags, place, …) render when present.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { useMediaQuery } from '../../components/ui'
import { toast } from '../../components/toast'
import { get, post, safeHref } from '../../lib/api'
import { fmtDate, isSameDay, relTime } from '../../lib/dates'
import type { CalEvent, Calendar, EventDetail } from '../../lib/types'
import { Menu, MenuItem } from '../../components/ui'
import { eventDayKey, eventDays } from './util'
import { HOME_ZONE, fmtDateIn, fmtTimeIn, gmtLabel, useCalPrefs, zoneCity, zoneDayKey, type Zone } from './zone'
import { useDeleteEvent, useDuplicateEvent, useTaskFromEvent, useUpdateEvent, type Scope } from './api'

const MEETING_RE = /https:\/\/[^\s<>"]*(meet\.google\.com|zoom\.us|teams\.microsoft\.com|whereby\.com|jit\.si)[^\s<>"]*/i

/** When an event happens, in the display zone `tz` (all-day events by their own dates). */
export function whenLine(e: CalEvent, tz?: Zone): string {
  const s = new Date(e.start)
  const fmtTime = (d: Date) => fmtTimeIn(d, tz)
  const day = fmtDateIn(s, { weekday: 'long', month: 'long', day: 'numeric' }, tz)
  if (e.kind === 'deadline') return `Due ${day} at ${fmtTime(s)}`
  if (e.all_day) {
    // By its calendar dates, not the instants (another zone's midnight is another day here).
    const { first, last } = eventDays(e)
    const fday = fmtDate(first, { weekday: 'long', month: 'long', day: 'numeric' })
    return isSameDay(first, last) ? fday : `${fmtDate(first, { month: 'short', day: 'numeric' })} – ${fmtDate(last, { month: 'short', day: 'numeric' })}`
  }
  const en = e.end ? new Date(e.end) : null
  if (en && zoneDayKey(s.getTime(), tz) !== zoneDayKey(en.getTime(), tz)) return `${fmtDateIn(s, { month: 'short', day: 'numeric' }, tz)}, ${fmtTime(s)} – ${fmtDateIn(en, { month: 'short', day: 'numeric' }, tz)}, ${fmtTime(en)}`
  return `${day} · ${fmtTime(s)}${en ? ` – ${fmtTime(en)}` : ''}`
}

/** The same times on the home clock, shown under the main line while another zone is displayed. */
function homeWhen(e: CalEvent): string {
  const s = new Date(e.start)
  const en = e.end && e.kind !== 'deadline' ? new Date(e.end) : null
  const day = (d: Date) => fmtDateIn(d, { weekday: 'short', month: 'short', day: 'numeric' }, undefined)
  const span = en ? (zoneDayKey(s.getTime(), undefined) === zoneDayKey(en.getTime(), undefined) ? `${fmtTimeIn(s, undefined)} – ${fmtTimeIn(en, undefined)}` : `${fmtTimeIn(s, undefined)} – ${day(en)}, ${fmtTimeIn(en, undefined)}`) : fmtTimeIn(s, undefined)
  return `${zoneCity(HOME_ZONE)} (${gmtLabel(s.getTime(), HOME_ZONE)}): ${day(s)}, ${span}`
}

export function EventPeek({ event, calendar, anchor, onClose, onEdit }: {
  event: CalEvent
  calendar?: Calendar
  anchor: HTMLElement | null
  onClose: () => void
  onEdit: (e: CalEvent) => void
}) {
  const phone = useMediaQuery('(max-width: 760px)')
  const { tz } = useCalPrefs()
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const navigate = useNavigate()
  const detail = useQuery({ queryKey: ['calendar', 'event', event.id], queryFn: () => get<EventDetail>(`calendar/events/${event.id}`), staleTime: 30_000 })
  const qc = useQueryClient()
  const remove = useDeleteEvent()
  const duplicate = useDuplicateEvent()
  const toTask = useTaskFromEvent()
  const update = useUpdateEvent()
  const [dupDays, setDupDays] = useState('1')
  const e: EventDetail = { ...event, ...(detail.data ?? {}) }
  const recurring = !!(e.recurring || e.series_id)
  const canEdit = !!calendar?.can_edit
  const colour = e.display_colour || calendar?.colour || '#64748b'

  // Position beside the anchor (right, else left), clamped to the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || phone) return setStyle({})
    const p = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!anchor || !anchor.isConnected) return setStyle({ left: (vw - p.width) / 2, top: Math.max(16, vh * 0.15) })
    const r = anchor.getBoundingClientRect()
    let left = r.right + 8
    if (left + p.width > vw - 8) left = r.left - p.width - 8
    if (left < 8) left = Math.max(8, Math.min(vw - p.width - 8, r.left))
    const top = Math.max(8, Math.min(r.top - 8, vh - p.height - 8))
    setStyle({ left, top })
  }, [anchor, phone, detail.data])

  // Focus in, return focus to the chip, keyboard actions.
  useEffect(() => {
    ref.current?.focus()
    const back = anchor
    const onKey = (ev: KeyboardEvent) => {
      if (document.querySelector('.dialog')) return
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((ev.target as HTMLElement)?.tagName)
      if (ev.key === 'Escape') (ev.preventDefault(), onClose())
      else if (!typing && canEdit && (ev.key === 'e' || (ev.key === 'Enter' && ev.target === ref.current))) (ev.preventDefault(), onEdit(event))
      else if (!typing && canEdit && !recurring && (ev.key === 'Delete' || ev.key === 'Backspace')) (ev.preventDefault(), doDelete())
    }
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Node
      if (ref.current?.contains(t) || document.querySelector('.menu,.dialog')?.contains(t)) return
      if (anchor?.contains(t)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [event.id, canEdit])

  function doDelete(scope?: Scope) {
    const snapshot = { ...e }
    onClose()
    remove.mutate({ id: event.id, scope }, {
      onSuccess: () =>
        toast.show(`Deleted "${snapshot.name}"`, recurring && scope !== 'this' ? {} : {
          action: {
            label: 'Undo',
            run: () =>
              post('calendar/events', {
                calendar_id: snapshot.calendar_id, name: snapshot.name, kind: snapshot.kind, start: snapshot.start, end: snapshot.end,
                all_day: snapshot.all_day, category_id: snapshot.category_id ?? null, location: snapshot.location, description: snapshot.description,
                priority: snapshot.priority, colour: snapshot.colour ?? null, icon: snapshot.icon ?? null, tags: snapshot.tags ?? [],
                meeting_url: snapshot.meeting_url ?? '', reminders: snapshot.reminders ?? null,
              }).then(() => qc.invalidateQueries({ queryKey: ['calendar'] }), (err: Error) => toast.error(err.message)),
          },
        }),
    })
  }

  const meeting = safeHref(e.meeting_url || null) ?? (e.location?.match(MEETING_RE)?.[0] || e.description?.match(MEETING_RE)?.[0] || null)
  const place = e.place ? [e.place.name, e.place.address].filter(Boolean).join(', ') : ''
  const location = [e.location && e.location !== meeting ? e.location : '', place && place !== e.location ? place : ''].filter(Boolean).join(' · ')
  const category = e.category && e.category.name !== 'Uncategorized' ? e.category.name : ''
  const RSVP: Record<string, string> = { accepted: 'going', declined: 'not going', tentative: 'maybe', needs_action: '' }
  const attendees = (e.attendees ?? []).map((a) => `${a.name || a.email}${a.is_organizer ? ' (organizer)' : RSVP[a.rsvp] ? ` (${RSVP[a.rsvp]})` : ''}`)
  const reminders = (e.reminders ?? []).map(minutesText).join(', ')
  const upcoming = new Date(e.start) > new Date() ? relTime(new Date(e.start)) : null
  // Photos taken during the event (all-day events: their whole days).
  const photosHref = `/photos?${new URLSearchParams({ after: new Date(e.start).toISOString(), before: new Date(e.end ? e.end : new Date(e.start).getTime() + 3600_000).toISOString(), title: e.name })}`
  // The classic countdown page (/calendar/countdown/<id>/start|end/) opens for editors and public calendars.
  const countdown = canEdit || calendar?.public ? `/calendar/countdown/${encodeURIComponent(event.id)}/` : null

  const row = (icon: string, children: ReactNode, key?: string) => (
    <div className="peek-row" key={key ?? icon}><Icon name={icon} size={15} /><div className="grow">{children}</div></div>
  )

  return createPortal(
    <>
      {phone && <div className="scrim" onClick={onClose} />}
      <div
        ref={ref}
        className={'peek' + (phone ? ' sheet' : '')}
        style={{ ...style, '--c': colour } as CSSProperties}
        role="dialog"
        aria-modal={phone}
        aria-label={`Event: ${e.name}`}
        tabIndex={-1}
        onDoubleClick={() => canEdit && onEdit(event)}
      >
        <div className="peek-actions">
          {canEdit && <button className="btn ghost icon sm" onClick={() => onEdit(event)} aria-label="Edit event" title="Edit (E)"><Icon name="edit" /></button>}
          {canEdit && !recurring && <button className="btn ghost icon sm" onClick={() => doDelete()} aria-label="Delete event" title="Delete (Del)"><Icon name="trash" /></button>}
          {canEdit && recurring && (
            <Menu label="Delete repeating event" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="Delete event" title="Delete"><Icon name="trash" /></button>}>
              {(close) => (
                <>
                  <MenuItem onClick={() => (close(), doDelete('this'))}>This event</MenuItem>
                  <MenuItem onClick={() => (close(), doDelete('following'))}>This and following events</MenuItem>
                  <MenuItem danger onClick={() => (close(), doDelete('all'))}>All events</MenuItem>
                </>
              )}
            </Menu>
          )}
          {canEdit && (
            <Menu label="Duplicate" width="15rem" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="Duplicate event" title="Duplicate"><Icon name="copy" /></button>}>
              {(close) => {
                const dup = (days: number, edit = false) => {
                  close()
                  duplicate.mutate({ id: event.id, days }, {
                    onSuccess: (c) => {
                      toast.show(days ? `Duplicated ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'later' : 'earlier'}` : 'Duplicated')
                      if (edit) (onClose(), onEdit(c))
                    },
                  })
                }
                const n = Number(dupDays)
                const ok = Number.isInteger(n) && Math.abs(n) <= 3650
                return (
                  <>
                    <MenuItem icon="copy" onClick={() => dup(0, true)}>Same time, then edit</MenuItem>
                    <MenuItem icon="copy" onClick={() => dup(1)}>Next day</MenuItem>
                    <MenuItem icon="copy" onClick={() => dup(7)}>Next week</MenuItem>
                    <div className="menu-sep" />
                    <form className="peek-dup" onSubmit={(ev) => (ev.preventDefault(), ok && dup(n))}>
                      <input className="input" type="number" min={-3650} max={3650} step={1} value={dupDays} onChange={(ev) => setDupDays(ev.target.value)} aria-label="Days later (negative for earlier)" />
                      <span className="xsmall muted">days later</span>
                      <button className="btn sm" disabled={!ok}>Copy</button>
                    </form>
                  </>
                )
              }}
            </Menu>
          )}
          {e.task_id && <button className="btn ghost icon sm" onClick={() => navigate(`/tasks?view=all&task=${e.task_id}`)} aria-label="Open in Tasks" title="Open in Tasks"><Icon name="tasks" /></button>}
          <span className="spacer" />
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="x" /></button>
        </div>
        <div className="peek-head">
          <span className="peek-swatch" aria-hidden="true">{e.icon || e.category?.icon ? <Icon name={(e.icon || e.category?.icon)!} size={11} /> : null}</span>
          <div className="grow">
            <h2 className={e.completed ? 'done' : ''}>{e.name}</h2>
            <p className="peek-when">{whenLine(e, tz)}{upcoming && <span className="muted"> · {upcoming}</span>}</p>
            {tz && !e.all_day && <p className="peek-sub"><Icon name="globe" size={12} /> {homeWhen(e)}</p>}
            {e.recurrence_text && <p className="peek-sub"><Icon name="repeat" size={12} /> {e.recurrence_text}</p>}
            {e.status && e.status !== 'confirmed' && <p className="peek-sub">{e.status === 'tentative' ? 'Tentative' : 'Cancelled'}</p>}
          </div>
        </div>
        <div className="peek-body">
          {meeting && row('video', <a className="btn primary sm" href={meeting} target="_blank" rel="noopener noreferrer">Join meeting</a>, 'meet')}
          {location && row('pin', <span className="pre-wrap">{location}</span>, 'loc')}
          {e.description && row('list', <p className="peek-desc pre-wrap">{e.description}</p>, 'desc')}
          {attendees.length > 0 && row('users', attendees.join(', '), 'att')}
          {(category || (e.tags && e.tags.length > 0)) && row('tag', <span className="peek-tags">{category && <span className="chip">{category}</span>}{e.tags?.map((t) => <span key={t} className="chip">#{t}</span>)}</span>, 'tags')}
          {reminders && row('bell', reminders, 'rem')}
          {(e.transparency === 'free' || (e.visibility && e.visibility !== 'default')) && row('info', [e.transparency === 'free' ? 'Shows as free' : '', e.visibility === 'private' ? 'Private' : e.visibility === 'public' ? 'Public' : ''].filter(Boolean).join(' · '), 'vis')}
          {row('calendar', <span className="row" style={{ gap: '0.375rem' }}><span className="dot" style={{ background: calendar?.colour || colour }} />{calendar?.name ?? 'Calendar'}{!canEdit && <span className="chip">View only</span>}</span>, 'cal')}
          <div className="peek-links">
            <a className="btn ghost sm" href={`/app${photosHref}`} onClick={(ev) => { ev.preventDefault(); navigate(photosHref) }}><Icon name="photo" size={13} />Photos from this event</a>
            <a className="btn ghost sm" href={`/app/photos?date=${eventDayKey(e)}`} onClick={(ev) => { ev.preventDefault(); navigate(`/photos?date=${eventDayKey(e)}`) }}>This day</a>
          {countdown && (
            <>
              <a className="btn ghost sm" href={`${countdown}start/`} target="_blank" rel="noopener noreferrer"><Icon name="clock" size={13} />{e.kind === 'deadline' ? 'Countdown' : 'Countdown to start'}</a>
              {e.kind === 'event' && e.end && <a className="btn ghost sm" href={`${countdown}end/`} target="_blank" rel="noopener noreferrer">To end</a>}
            </>
          )}
          </div>
          <div className="peek-foot">
            {e.kind === 'deadline' && canEdit && (
              <button className="btn sm" onClick={() => update.mutate({ id: event.id, scope: recurring ? 'this' : undefined, body: { completed: !e.completed } }, { onSuccess: () => toast.show(e.completed ? 'Marked not done' : `Done: "${e.name}"`) })} disabled={update.isPending}>
                <Icon name="check" size={14} />{e.completed ? 'Mark not done' : 'Mark done'}
              </button>
            )}
            {!e.task_id && <button className={'btn sm' + (e.kind === 'deadline' ? ' primary' : '')} onClick={() => toTask.mutate(event.id)} disabled={toTask.isPending}><Icon name="tasks" size={14} />Add to tasks</button>}
            {e.task_id && <button className="btn sm" onClick={() => navigate(`/tasks?view=all&task=${e.task_id}`)}><Icon name="tasks" size={14} />In Tasks · Open</button>}
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

export function minutesText(m: number): string {
  if (m === 0) return 'At the start'
  if (m % 10080 === 0) return `${m / 10080} week${m === 10080 ? '' : 's'} before`
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'} before`
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} before`
  return `${m} min before`
}
