import { useEffect, useMemo, useRef, useState } from 'react'
import { Confirm, Dialog } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { addDays, dayKey, fromLocalInput, parseDayKey, toLocalInput } from '../../lib/dates'
import { keys, useCalendars, useCategories } from '../../lib/queries'
import type { CalEvent, Calendar, Category, EventDetail, EventIn } from '../../lib/types'
import { useQuery } from '@tanstack/react-query'
import { get, post } from '../../lib/api'
import { Attendees, type AttendeeDraft } from './Attendees'
import { CAL_COLOURS } from './calendarCommon'
import { minutesText } from './EventPeek'
import { allDayRange } from './util'
import { useCreateEvent, useDeleteEvent, useDuplicateEvent, useTaskFromEvent, useUpdateEvent, type Scope } from './api'

export type EventDraft = { event: CalEvent } | { start: Date; end?: Date; allDay?: boolean }
type Kind = 'event' | 'all_day' | 'deadline'

const REPEATS: [string, string][] = [
  ['', 'Does not repeat'], ['FREQ=DAILY', 'Every day'], ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday'],
  ['FREQ=WEEKLY', 'Every week'], ['FREQ=MONTHLY', 'Every month'], ['FREQ=YEARLY', 'Every year'],
]
const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080]
/** The preset an existing RRULE matches (ignoring UNTIL/COUNT/BYDAY order), or 'custom'. */
function repeatPreset(rrule?: string | null): string {
  if (!rrule) return ''
  const norm = rrule.replace(/^RRULE:/i, '').split(';').filter((p) => !/^(UNTIL|COUNT|WKST|INTERVAL=1)\b/i.test(p)).sort().join(';').toUpperCase()
  const hit = REPEATS.find(([r]) => r && r.split(';').sort().join(';') === norm)
  return hit ? hit[0] : 'custom'
}

const LAST_CAL = 'app.cal.last'

function defaultCalendar(cals: Calendar[]): number | undefined {
  const editable = cals.filter((c) => c.can_edit && c.active)
  let last: number | null = null
  try {
    last = Number(localStorage.getItem(LAST_CAL)) || null
  } catch { /* ignore */ }
  return (editable.find((c) => c.id === last) ?? editable.find((c) => !c.synced) ?? editable[0])?.id
}

function initial(draft: EventDraft) {
  if ('event' in draft) {
    const e = draft.event
    const kind: Kind = e.kind
    const s = new Date(e.start)
    // All-day events keep their calendar dates as sent (start_date/end_date): converting the
    // instants would shift them in a browser outside the calendar's zone.
    const days = allDayRange(e) ?? { first: s, last: s }
    return {
      kind, name: e.name, calendar: e.calendar_id, category: e.category_id ?? '' as number | '', location: e.location ?? '', description: e.description ?? '',
      colour: e.colour ?? '', icon: e.icon ?? '', tags: (e.tags ?? []).join(', '), repeat: repeatPreset(e.rrule), reminders: null as number[] | null,
      rrule: e.rrule ?? '', meeting: e.meeting_url ?? '', place: e.place?.id ?? '', status: e.status ?? 'confirmed', busy: e.transparency !== 'free', visibility: e.visibility ?? 'default',
      start: toLocalInput(e.start), end: toLocalInput(e.end ?? new Date(s.getTime() + 3600_000).toISOString()),
      startDate: dayKey(days.first), endDate: dayKey(days.last), completed: e.completed,
    }
  }
  const s = draft.start
  const en = draft.end ?? new Date(s.getTime() + 3600_000)
  return {
    kind: (draft.allDay ? 'all_day' : 'event') as Kind, name: '', calendar: undefined as number | undefined, category: '' as number | '', location: '', description: '',
    colour: '', icon: '', tags: '', repeat: '', reminders: null as number[] | null,
    rrule: '', meeting: '', place: '', status: 'confirmed' as const, busy: true, visibility: 'default' as const,
    start: toLocalInput(s.toISOString()), end: toLocalInput(en.toISOString()), startDate: dayKey(s), endDate: dayKey(draft.allDay && draft.end ? addDays(draft.end, -1) : s),
    completed: false,
  }
}

export function EventDialog({ draft, onClose }: { draft: EventDraft; onClose: () => void }) {
  const cals = useCalendars().data ?? []
  const ownCats = useCategories().data
  const editing = 'event' in draft ? draft.event : null
  const [f, setF] = useState(() => initial(draft))
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [more, setMore] = useState(() => !!(editing && (editing.colour || editing.icon || editing.tags?.length || editing.place || editing.meeting_url || editing.status === 'tentative' || editing.visibility === 'private')))
  const recurring = !!(editing && (editing.recurring || editing.series_id))
  const [scope, setScope] = useState<Scope>('this')
  // Reminders live on the event detail; load them (cached) when editing.
  const detail = useQuery({ queryKey: ['calendar', 'event', editing?.id], queryFn: () => get<EventDetail>(`calendar/events/${editing!.id}`), enabled: !!editing, staleTime: 30_000 })
  const icons = useQuery({ queryKey: ['calendar', 'icons'], queryFn: () => get<string[]>('calendar/icons'), staleTime: 60 * 60_000, enabled: more }).data ?? []
  const reminders = f.reminders ?? detail.data?.reminders ?? null
  const [pending, setPending] = useState<AttendeeDraft[]>([])
  const places = useQuery({ queryKey: ['places', 'list', 'all'], queryFn: () => get<{ id: string; name: string; address: string | null }[]>('places/'), staleTime: 5 * 60_000, enabled: more }).data ?? []
  const create = useCreateEvent()
  const update = useUpdateEvent()
  const remove = useDeleteEvent()
  const dup = useDuplicateEvent()
  const toTask = useTaskFromEvent()
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const editable = useMemo(() => cals.filter((c) => c.can_edit && c.active), [cals])
  const calendarId = f.calendar ?? defaultCalendar(cals)
  const cal = cals.find((c) => c.id === calendarId)
  const readOnly = !!editing && !cals.find((c) => c.id === editing.calendar_id)?.can_edit
  // Categories belong to the calendar's owner: someone else's calendar uses theirs.
  const foreign = cal && cal.role !== 'owner' ? cal.id : null
  const ownerCats = useQuery({ queryKey: [...keys.categories, foreign], queryFn: () => get<Category[]>('calendar/categories', { calendar: foreign! }), enabled: foreign != null, staleTime: 60 * 60_000 }).data
  const cats = (foreign != null ? ownerCats : ownCats) ?? []
  const busy = create.isPending || update.isPending

  function body(): EventIn | null {
    if (!f.name.trim()) return setError('Give the event a title.'), null
    if (!calendarId) return setError('Pick a calendar you can edit.'), null
    let start: string | null = null
    let end: string | null = null
    let dates: Pick<EventIn, 'start_date' | 'end_date'> | null = null
    if (f.kind === 'all_day') {
      if (!f.startDate) return setError('Pick a date.'), null
      const last = f.endDate && f.endDate >= f.startDate ? f.endDate : f.startDate
      // Dates only (end exclusive): the server places them in the calendar's zone.
      dates = { start_date: f.startDate, end_date: dayKey(addDays(parseDayKey(last), 1)) }
    } else {
      start = fromLocalInput(f.start)
      if (!start) return setError('Pick a start time.'), null
      if (f.kind === 'event') {
        end = fromLocalInput(f.end)
        if (!end || end <= start) return setError('The end must be after the start.'), null
      }
    }
    const out: EventIn = {
      calendar_id: calendarId, name: f.name.trim(), kind: f.kind, ...(dates ?? { start, end }), all_day: f.kind === 'all_day', category_id: f.category === '' ? null : f.category,
      location: f.location.trim() || null, description: f.description.trim() || null,
      colour: f.colour || null, icon: f.icon || null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    }
    out.rrule = f.repeat === 'custom' ? f.rrule.trim() : f.repeat
    if (f.reminders !== null) out.reminders = f.reminders
    out.meeting_url = f.meeting.trim()
    out.place_id = f.place || null
    out.status = f.status
    out.transparency = f.busy ? 'busy' : 'free'
    out.visibility = f.visibility
    return out
  }

  function save() {
    setError('')
    const b = body()
    if (!b) return
    try {
      localStorage.setItem(LAST_CAL, String(b.calendar_id))
    } catch { /* ignore */ }
    if (editing) {
      update.mutate({ id: editing.id, scope: recurring ? scope : undefined, body: { ...b, completed: f.kind === 'deadline' ? f.completed : undefined } }, { onSuccess: () => (toast.show('Event saved'), onClose()) })
    } else {
      create.mutate(b, {
        onSuccess: (e) => {
          // Attendees have their own endpoint: add the queued ones once the event exists.
          for (const a of pending) post(`calendar/events/${encodeURIComponent(e.id)}/attendees`, a).catch((err: Error) => toast.error(err.message))
          toast.show(`Created "${e.name}"`)
          onClose()
        },
      })
    }
  }

  // Keep the end after the start when the start moves (same duration, like Google Calendar).
  function moveStart(value: string) {
    const oldS = fromLocalInput(f.start)
    const oldE = fromLocalInput(f.end)
    const newS = fromLocalInput(value)
    if (oldS && oldE && newS) {
      const dur = Math.max(new Date(oldE).getTime() - new Date(oldS).getTime(), 15 * 60_000)
      setF((x) => ({ ...x, start: value, end: toLocalInput(new Date(new Date(newS).getTime() + dur).toISOString()) }))
    } else set('start', value)
  }

  const title = readOnly ? 'Event' : editing ? 'Edit event' : 'New event'
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={title}
        width="34rem"
        footer={
          <>
            {editing && !readOnly && (
              <>
                <button className="btn danger icon" aria-label="Delete event" title="Delete" onClick={() => setConfirm(true)}>
                  <Icon name="trash" />
                </button>
                <MoreActions
                  onDuplicate={(days) => dup.mutate({ id: editing.id, days }, { onSuccess: () => (toast.show('Duplicated'), onClose()) })}
                  onTask={() => toTask.mutate(editing.id)}
                />
              </>
            )}
            {readOnly && editing && (
              <button className="btn" onClick={() => toTask.mutate(editing.id)}>
                <Icon name="tasks" /> Make a task
              </button>
            )}
            <span className="spacer" />
            <button className="btn" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>
            {!readOnly && (
              <button className="btn primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save' : 'Create'}
              </button>
            )}
          </>
        }
      >
        <form
          className="ev-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!readOnly) save()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !readOnly) (e.preventDefault(), save())
          }}
        >
          <fieldset disabled={readOnly} className="ev-fieldset">
            <input
              className="input ev-title"
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Add title"
              aria-label="Title"
              maxLength={256}
              autoFocus
            />
            <div className="seg ev-kind" role="group" aria-label="Type">
              {(
                [
                  ['event', 'Event', 'clock'],
                  ['all_day', 'All day', 'calendar'],
                  ['deadline', 'Deadline', 'flag'],
                ] as const
              ).map(([k, label, icon]) => (
                <button type="button" key={k} aria-pressed={f.kind === k} onClick={() => set('kind', k)}>
                  <Icon name={icon} size={13} />
                  {label}
                </button>
              ))}
            </div>

            {f.kind === 'event' && (
              <div className="field-row">
                <label className="field">
                  <span>Starts</span>
                  <input className="input" type="datetime-local" value={f.start} onChange={(e) => moveStart(e.target.value)} required />
                </label>
                <label className="field">
                  <span>Ends</span>
                  <input className="input" type="datetime-local" value={f.end} min={f.start} onChange={(e) => set('end', e.target.value)} required />
                </label>
              </div>
            )}
            {f.kind === 'all_day' && (
              <div className="field-row">
                <label className="field">
                  <span>From</span>
                  <input className="input" type="date" value={f.startDate} onChange={(e) => setF((x) => ({ ...x, startDate: e.target.value, endDate: x.endDate < e.target.value ? e.target.value : x.endDate }))} required />
                </label>
                <label className="field">
                  <span>To</span>
                  <input className="input" type="date" value={f.endDate} min={f.startDate} onChange={(e) => set('endDate', e.target.value)} />
                </label>
              </div>
            )}
            {f.kind === 'deadline' && (
              <div className="field-row">
                <label className="field">
                  <span>Due</span>
                  <input className="input" type="datetime-local" value={f.start} onChange={(e) => set('start', e.target.value)} required />
                </label>
                {editing && (
                  <label className="switch" style={{ alignSelf: 'end', height: '2rem' }}>
                    <input type="checkbox" role="switch" checked={f.completed} onChange={(e) => set('completed', e.target.checked)} />
                    <span className="track" />
                    <span>Done</span>
                  </label>
                )}
              </div>
            )}

            <div className="field-row">
              <label className="field">
                <span>Calendar</span>
                <span className="ev-cal">
                  <span className="dot" style={{ background: f.colour || cal?.colour }} />
                  <select className="select" value={calendarId ?? ''} onChange={(e) => set('calendar', Number(e.target.value))}>
                    {(readOnly && cal ? [cal] : editable).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="field">
                <span>Category</span>
                <select className="select" value={f.category} onChange={(e) => set('category', e.target.value === '' ? '' : Number(e.target.value))}>
                  <option value="">None</option>
                  {cats.filter((c) => c.name !== 'Uncategorized').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Repeat</span>
                <select className="select" value={f.repeat} onChange={(e) => set('repeat', e.target.value)} disabled={recurring && scope === 'this'}>
                  {REPEATS.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
                  <option value="custom">{f.repeat === 'custom' && editing?.recurrence_text ? editing.recurrence_text : 'Custom (RRULE)…'}</option>
                </select>
                {f.repeat === 'custom' && (
                  <input className="input" value={f.rrule} onChange={(e) => set('rrule', e.target.value)} placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH" aria-label="Custom repeat rule (RRULE)" maxLength={500} />
                )}
              </label>
              <div className="field">
                <span>Reminders</span>
                <div className="ev-rem">
                  {(reminders ?? []).map((m) => (
                    <button type="button" key={m} className="chip" onClick={() => set('reminders', (reminders ?? []).filter((x) => x !== m))} title="Remove">
                      {minutesText(m)} <Icon name="x" size={10} />
                    </button>
                  ))}
                  <select className="select ev-rem-add" value="" aria-label="Add a reminder" onChange={(e) => e.target.value && set('reminders', [...(reminders ?? []), Number(e.target.value)].sort((a, b) => a - b))}>
                    <option value="">{reminders?.length ? '+ Add' : reminders === null && !editing ? 'Default' : 'None · add'}</option>
                    {REMINDER_PRESETS.filter((m) => !(reminders ?? []).includes(m)).map((m) => <option key={m} value={m}>{minutesText(m)}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <label className="field">
              <span>Location</span>
              <input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Add a place" maxLength={256} />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea className="textarea" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Notes, links, agenda" />
            </label>
            <button type="button" className="btn ghost sm ev-more-toggle" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <Icon name={more ? 'chevronDown' : 'chevronRight'} size={14} />More: colour, icon, tags, place, meeting link, people, status
            </button>
            {more && (
              <div className="ev-more-opts">
                <div className="field">
                  <span>Colour</span>
                  <div className="cal-picker" role="radiogroup" aria-label="Event colour">
                    <button type="button" role="radio" aria-checked={!f.colour} className="cal-pick" title="Calendar colour" onClick={() => set('colour', '')}>
                      <span className="cal-swatch" style={{ background: cal?.colour }}>{!f.colour && <Icon name="check" size={12} />}</span>
                    </button>
                    {CAL_COLOURS.map((c) => (
                      <button type="button" key={c} role="radio" aria-checked={f.colour === c} className="cal-pick" title={c} onClick={() => set('colour', c)}>
                        <span className="cal-swatch" style={{ background: c }}>{f.colour === c && <Icon name="check" size={12} />}</span>
                      </button>
                    ))}
                    <label className="cal-pick cal-custom" title="Custom colour">
                      <span className="cal-swatch" style={{ background: f.colour && !CAL_COLOURS.includes(f.colour) ? f.colour : 'conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ef4444)' }} />
                      <input type="color" aria-label="Custom colour" value={f.colour || '#888888'} onChange={(e) => set('colour', e.target.value)} />
                    </label>
                  </div>
                </div>
                <div className="field">
                  <span>Icon</span>
                  <div className="cal-picker" role="radiogroup" aria-label="Event icon">
                    <button type="button" role="radio" aria-checked={!f.icon} className="cal-pick" title="None" onClick={() => set('icon', '')}><Icon name="x" size={13} /></button>
                    {icons.map((i) => (
                      <button type="button" key={i} role="radio" aria-checked={f.icon === i} className="cal-pick" title={i} aria-label={i} onClick={() => set('icon', i)}><Icon name={i} size={15} /></button>
                    ))}
                  </div>
                </div>
                <label className="field"><span>Tags</span><input className="input" value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="work, travel" maxLength={300} /></label>
                <label className="field"><span>Meeting link</span><input className="input" type="url" value={f.meeting} onChange={(e) => set('meeting', e.target.value)} placeholder="https://meet…" maxLength={500} /></label>
                <label className="field"><span>Place</span>
                  <select className="select" value={f.place} onChange={(e) => set('place', e.target.value)}>
                    <option value="">None</option>
                    {places.map((p) => <option key={p.id} value={p.id}>{p.name}{p.address ? ` · ${p.address}` : ''}</option>)}
                    {f.place && !places.some((p) => p.id === f.place) && <option value={f.place}>{editing?.place?.name ?? 'Current place'}</option>}
                  </select>
                </label>
                <div className="field-row three">
                  <label className="field"><span>Status</span>
                    <select className="select" value={f.status} onChange={(e) => set('status', e.target.value as typeof f.status)}>
                      <option value="confirmed">Confirmed</option><option value="tentative">Tentative</option><option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <label className="field"><span>Show as</span>
                    <select className="select" value={f.busy ? 'busy' : 'free'} onChange={(e) => set('busy', e.target.value === 'busy')}>
                      <option value="busy">Busy</option><option value="free">Free</option>
                    </select>
                  </label>
                  <label className="field"><span>Visibility</span>
                    <select className="select" value={f.visibility} onChange={(e) => set('visibility', e.target.value as typeof f.visibility)}>
                      <option value="default">Calendar default</option><option value="public">Public</option><option value="private">Private</option>
                    </select>
                  </label>
                </div>
                <Attendees eventId={editing?.id ?? null} attendees={detail.data?.attendees ?? []} pending={pending} onPending={setPending} />
              </div>
            )}
            {recurring && !readOnly && (
              <label className="field">
                <span>Apply changes to</span>
                <select className="select" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                  <option value="this">This event</option>
                  <option value="following">This and following events</option>
                  <option value="all">All events in the series</option>
                </select>
              </label>
            )}
            {readOnly && <p className="help"><Icon name="info" size={12} /> This calendar is read-only for you.</p>}
            {error && <p className="error-text" role="alert">{error}</p>}
            <button type="submit" hidden />
          </fieldset>
        </form>
      </Dialog>
      <Confirm
        open={confirm}
        title="Delete this event?"
        body={editing ? `"${editing.name}" will be removed from ${cals.find((c) => c.id === editing.calendar_id)?.name ?? 'its calendar'}.` : undefined}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (!editing) return
          remove.mutate({ id: editing.id, scope: recurring ? scope : undefined }, { onSuccess: () => toast.show('Event deleted') })
          onClose()
        }}
      />
    </>
  )
}

/** Duplicate / make-a-task actions. An in-dialog popover (not a portaled Menu) so it stacks above the dialog. */
function MoreActions({ onDuplicate, onTask }: { onDuplicate: (days: number) => void; onTask: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const item = (label: string, icon: string, run: () => void) => (
    <button type="button" role="menuitem" className="menu-item" onClick={() => (setOpen(false), run())}>
      <Icon name={icon} />
      <span className="truncate">{label}</span>
    </button>
  )
  return (
    <span className="ev-more" ref={box}>
      <button type="button" className="btn icon" aria-label="More actions" title="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="ev-more-pop" role="menu" aria-label="More actions">
          <div className="menu-label">Duplicate</div>
          {item('Same time', 'copy', () => onDuplicate(0))}
          {item('Next day', 'copy', () => onDuplicate(1))}
          {item('Next week', 'copy', () => onDuplicate(7))}
          <div className="menu-sep" />
          {item('Make a task', 'tasks', onTask)}
        </div>
      )}
    </span>
  )
}
