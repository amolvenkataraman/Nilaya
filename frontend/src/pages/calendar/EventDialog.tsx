// Create or edit an event (read-only for calendars you can't edit). Times are typed on the display zone's clock;
// the form's values and body live in eventForm.ts, the "More" section in EventMore.tsx.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import {
  Button,
  buttonClass,
  Confirm,
  Dialog,
  Field,
  FieldRow,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Segmented,
  Select,
  Switch,
  Textarea,
} from '../../components/ui'
import { toast } from '../../components/toast'
import { useCalendars, useCategories } from '../../lib/queries'
import { writePref } from '../../lib/storage'
import { cn } from '../../lib/cn'
import type { Calendar } from '../../lib/types'
import type { AttendeeDraft } from './Attendees'
import { smallSelect } from './Attendees'
import {
  eventDetailQuery,
  useAttendeeMutations,
  useCreateEvent,
  useDeleteEvent,
  useDuplicateEvent,
  useOwnerCategories,
  useTaskFromEvent,
  useUpdateEvent,
  type Scope,
} from './api'
import { dot, pill } from './chips'
import {
  defaultCalendar,
  type EventDraft,
  formBody,
  initialForm,
  type Kind,
  LAST_CAL,
  movedEnd,
  REMINDER_PRESETS,
  REPEATS,
} from './eventForm'
import { EventMore } from './EventMore'
import { isUncategorized, minutesText } from './format'
import { HOME_ZONE, fromZoneInput, gmtLabel, useCalPrefs, zoneCity } from './zone'

export type { EventDraft } from './eventForm'

const KINDS = [
  { value: 'event', label: 'Event', icon: 'clock' },
  { value: 'all_day', label: 'All day', icon: 'calendar' },
  { value: 'deadline', label: 'Deadline', icon: 'flag' },
] as const

export function EventDialog({ draft, onClose }: { draft: EventDraft; onClose: () => void }) {
  const cals = useCalendars().data ?? []
  const ownCats = useCategories().data
  const editing = 'event' in draft ? draft.event : null
  const { tz } = useCalPrefs()
  const [f, setF] = useState(() => initialForm(draft, tz))
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [more, setMore] = useState(
    () =>
      !!(
        editing &&
        (editing.colour ||
          editing.icon ||
          editing.tags?.length ||
          editing.place ||
          editing.meeting_url ||
          editing.status === 'tentative' ||
          editing.visibility === 'private')
      ),
  )
  const recurring = !!(editing && (editing.recurring || editing.series_id))
  const [scope, setScope] = useState<Scope>('this')
  // Reminders and attendees live on the event detail; load them (cached) when editing.
  const detail = useQuery({ ...eventDetailQuery(editing?.id ?? ''), enabled: !!editing })
  const reminders = f.reminders ?? detail.data?.reminders ?? null
  const [pending, setPending] = useState<AttendeeDraft[]>([])
  const create = useCreateEvent()
  const update = useUpdateEvent()
  const remove = useDeleteEvent()
  const dup = useDuplicateEvent()
  const toTask = useTaskFromEvent()
  const attendees = useAttendeeMutations()
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const editable = useMemo(() => cals.filter((c) => c.can_edit && c.active), [cals])
  const calendarId = f.calendar ?? defaultCalendar(cals)
  const cal = cals.find((c) => c.id === calendarId)
  const readOnly = !!editing && !cals.find((c) => c.id === editing.calendar_id)?.can_edit
  // Categories belong to the calendar's owner: someone else's calendar uses theirs.
  const foreign = cal && cal.role !== 'owner' ? cal.id : null
  const ownerCats = useOwnerCategories(foreign).data
  const cats = (foreign != null ? ownerCats : ownCats) ?? []
  const busy = create.isPending || update.isPending

  function save() {
    setError('')
    const b = formBody(f, calendarId, tz)
    if (typeof b === 'string') return setError(b)
    writePref(LAST_CAL, b.calendar_id)
    if (editing) {
      update.mutate(
        {
          id: editing.id,
          scope: recurring ? scope : undefined,
          body: { ...b, completed: f.kind === 'deadline' ? f.completed : undefined },
        },
        {
          onSuccess: () => {
            toast.show('Event saved')
            onClose()
          },
        },
      )
    } else {
      create.mutate(b, {
        onSuccess: (e) => {
          // Attendees have their own endpoint: add the queued ones once the event exists.
          for (const a of pending) attendees.add.mutate({ eventId: e.id, attendee: a })
          toast.show(`Created "${e.name}"`)
          onClose()
        },
      })
    }
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
                <Button variant="danger" icon aria-label="Delete event" title="Delete" onClick={() => setConfirm(true)}>
                  <Icon name="trash" />
                </Button>
                <MoreActions
                  onDuplicate={(days) => dup.mutate({ id: editing.id, days }, { onSuccess: onClose })}
                  onTask={() => toTask.mutate(editing.id)}
                />
              </>
            )}
            {readOnly && editing && (
              <Button onClick={() => toTask.mutate(editing.id)}>
                <Icon name="tasks" /> Make a task
              </Button>
            )}
            <span className="flex-1" />
            <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
            {!readOnly && (
              <Button variant="primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save' : 'Create'}
              </Button>
            )}
          </>
        }
      >
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            if (!readOnly) save()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !readOnly) {
              e.preventDefault()
              save()
            }
          }}
        >
          <fieldset
            disabled={readOnly}
            className="m-0 grid min-w-0 gap-3 border-0 p-0 [&:disabled_:is(input,select,textarea)]:bg-bg [&:disabled_:is(input,select,textarea)]:opacity-100"
          >
            <Input
              className="h-10! text-md! font-medium"
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Add title"
              aria-label="Title"
              maxLength={256}
              autoFocus
            />
            <Segmented<Kind> className="justify-self-start" label="Type" value={f.kind} onChange={(k) => set('kind', k)} options={KINDS} />

            {tz && f.kind !== 'all_day' && (
              <p className="m-0 flex items-center gap-1.5 text-xs text-accent">
                <Icon name="globe" size={12} /> Times are in {zoneCity(tz)} (
                {gmtLabel(new Date(fromZoneInput(f.start, tz) ?? Date.now()).getTime(), tz)}), the zone shown in this window. Yours is{' '}
                {zoneCity(HOME_ZONE)}.
              </p>
            )}
            {f.kind === 'event' && (
              <FieldRow>
                <Field label="Starts">
                  <Input
                    type="datetime-local"
                    value={f.start}
                    onChange={(e) => {
                      const v = e.target.value
                      const end = movedEnd(f, v, tz)
                      setF((x) => ({ ...x, start: v, ...(end ? { end } : {}) }))
                    }}
                    required
                  />
                </Field>
                <Field label="Ends">
                  <Input type="datetime-local" value={f.end} min={f.start} onChange={(e) => set('end', e.target.value)} required />
                </Field>
              </FieldRow>
            )}
            {f.kind === 'all_day' && (
              <FieldRow>
                <Field label="From">
                  <Input
                    type="date"
                    value={f.startDate}
                    onChange={(e) =>
                      setF((x) => ({ ...x, startDate: e.target.value, endDate: x.endDate < e.target.value ? e.target.value : x.endDate }))
                    }
                    required
                  />
                </Field>
                <Field label="To">
                  <Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set('endDate', e.target.value)} />
                </Field>
              </FieldRow>
            )}
            {f.kind === 'deadline' && (
              <FieldRow>
                <Field label="Due">
                  <Input type="datetime-local" value={f.start} onChange={(e) => set('start', e.target.value)} required />
                </Field>
                {editing && (
                  <div className="flex h-8 items-center self-end">
                    <Switch checked={f.completed} onChange={(v) => set('completed', v)} label="Done" />
                  </div>
                )}
              </FieldRow>
            )}

            <FieldRow>
              <Field label="Calendar">
                <span className="flex items-center gap-2">
                  <span className={cn(dot, 'size-2.5')} style={{ background: f.colour || cal?.colour }} />
                  <Select value={calendarId ?? ''} onChange={(e) => set('calendar', Number(e.target.value))}>
                    {(readOnly && cal ? [cal] : editable).map((c: Calendar) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </span>
              </Field>
              <Field label="Category">
                <Select value={f.category} onChange={(e) => set('category', e.target.value === '' ? '' : Number(e.target.value))}>
                  <option value="">None</option>
                  {cats
                    .filter((c) => !isUncategorized(c))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                </Select>
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Repeat">
                <Select value={f.repeat} onChange={(e) => set('repeat', e.target.value)} disabled={recurring && scope === 'this'}>
                  {REPEATS.map(([r, l]) => (
                    <option key={r} value={r}>
                      {l}
                    </option>
                  ))}
                  <option value="custom">
                    {f.repeat === 'custom' && editing?.recurrence_text ? editing.recurrence_text : 'Custom (RRULE)…'}
                  </option>
                </Select>
                {f.repeat === 'custom' && (
                  <Input
                    value={f.rrule}
                    onChange={(e) => set('rrule', e.target.value)}
                    placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH"
                    aria-label="Custom repeat rule (RRULE)"
                    maxLength={500}
                  />
                )}
              </Field>
              <div className="grid gap-1.25">
                <span className="text-xs font-medium text-muted">Reminders</span>
                <div className="flex min-h-8 flex-wrap items-center gap-1">
                  {(reminders ?? []).map((m) => (
                    <button
                      type="button"
                      key={m}
                      className={cn(pill, 'cursor-pointer hover:text-fg')}
                      onClick={() =>
                        set(
                          'reminders',
                          (reminders ?? []).filter((x) => x !== m),
                        )
                      }
                      title="Remove"
                    >
                      {minutesText(m)} <Icon name="x" size={10} />
                    </button>
                  ))}
                  <select
                    className={smallSelect}
                    value=""
                    aria-label="Add a reminder"
                    onChange={(e) =>
                      e.target.value &&
                      set(
                        'reminders',
                        [...(reminders ?? []), Number(e.target.value)].sort((a, b) => a - b),
                      )
                    }
                  >
                    <option value="">{reminders?.length ? '+ Add' : reminders === null && !editing ? 'Default' : 'None · add'}</option>
                    {REMINDER_PRESETS.filter((m) => !(reminders ?? []).includes(m)).map((m) => (
                      <option key={m} value={m}>
                        {minutesText(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </FieldRow>
            <Field label="Location">
              <Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Add a place" maxLength={256} />
            </Field>
            <Field label="Description">
              <Textarea
                rows={3}
                value={f.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Notes, links, agenda"
              />
            </Field>
            <Button variant="ghost" size="sm" className="justify-self-start pl-1" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <Icon name={more ? 'chevronDown' : 'chevronRight'} size={14} />
              More: colour, icon, tags, place, meeting link, people, status
            </Button>
            {more && (
              <EventMore
                f={f}
                set={set}
                cal={cal}
                editing={editing}
                attendees={detail.data?.attendees ?? []}
                pending={pending}
                onPending={setPending}
              />
            )}
            {recurring && !readOnly && (
              <Field label="Apply changes to">
                <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                  <option value="this">This event</option>
                  <option value="following">This and following events</option>
                  <option value="all">All events in the series</option>
                </Select>
              </Field>
            )}
            {readOnly && (
              <p className="text-xs text-muted">
                <Icon name="info" size={12} /> This calendar is read-only for you.
              </p>
            )}
            {error && (
              <p className="text-xs text-danger" role="alert">
                {error}
              </p>
            )}
            <button type="submit" hidden />
          </fieldset>
        </form>
      </Dialog>
      <Confirm
        open={confirm}
        title="Delete this event?"
        body={
          editing
            ? `"${editing.name}" will be removed from ${cals.find((c) => c.id === editing.calendar_id)?.name ?? 'its calendar'}.`
            : undefined
        }
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (!editing) return
          remove.mutate({ id: editing.id, scope: recurring ? scope : undefined, done: 'Event deleted' })
          onClose()
        }}
      />
    </>
  )
}

/** Duplicate / make-a-task actions. */
function MoreActions({ onDuplicate, onTask }: { onDuplicate: (days: number) => void; onTask: () => void }) {
  return (
    <Menu
      side="top"
      label="More actions"
      trigger={(p) => (
        <button {...p} type="button" className={buttonClass({ icon: true })} aria-label="More actions" title="More">
          <Icon name="more" />
        </button>
      )}
    >
      {() => (
        <>
          <MenuLabel>Duplicate</MenuLabel>
          <MenuItem icon="copy" onClick={() => onDuplicate(0)}>
            Same time
          </MenuItem>
          <MenuItem icon="copy" onClick={() => onDuplicate(1)}>
            Next day
          </MenuItem>
          <MenuItem icon="copy" onClick={() => onDuplicate(7)}>
            Next week
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="tasks" onClick={onTask}>
            Make a task
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
