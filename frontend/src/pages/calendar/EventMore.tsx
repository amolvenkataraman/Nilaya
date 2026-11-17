// The event form's "More" section: colour, icon, tags, meeting link, place, status, show-as, visibility and
// people. Its lists (icons, places) load only once it's opened.
import { Field, FieldRow, Input, Select } from '../../components/ui'
import type { Attendee, Calendar, CalEvent } from '../../lib/types'
import { Attendees, type AttendeeDraft } from './Attendees'
import { useCalendarIcons, usePlaces } from './api'
import { ColourChoice } from './ColourChoice'
import type { EventForm } from './eventForm'
import { IconPicker } from './IconPicker'

export function EventMore({
  f,
  set,
  cal,
  editing,
  attendees,
  pending,
  onPending,
}: {
  f: EventForm
  set: <K extends keyof EventForm>(k: K, v: EventForm[K]) => void
  cal?: Calendar
  editing: CalEvent | null
  attendees: Attendee[]
  pending: AttendeeDraft[]
  onPending: (a: AttendeeDraft[]) => void
}) {
  const icons = useCalendarIcons().data ?? []
  const places = usePlaces(true).data ?? []
  const label = 'text-xs font-medium text-muted'
  return (
    <div className="grid gap-3 border-l-2 border-border py-1 pl-2">
      <div className="grid gap-1.25">
        <span className={label}>Colour</span>
        <ColourChoice
          value={f.colour}
          onChange={(c) => set('colour', c)}
          none="Calendar colour"
          noneColour={cal?.colour}
          label="Event colour"
        />
      </div>
      <div className="grid gap-1.25">
        <span className={label}>Icon</span>
        <IconPicker value={f.icon} onChange={(i) => set('icon', i)} icons={icons} none="None" label="Event icon" size="sm" />
      </div>
      <Field label="Tags">
        <Input value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="work, travel" maxLength={300} />
      </Field>
      <Field label="Meeting link">
        <Input type="url" value={f.meeting} onChange={(e) => set('meeting', e.target.value)} placeholder="https://meet…" maxLength={500} />
      </Field>
      <Field label="Place">
        <Select value={f.place} onChange={(e) => set('place', e.target.value)}>
          <option value="">None</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.address ? ` · ${p.address}` : ''}
            </option>
          ))}
          {f.place && !places.some((p) => p.id === f.place) && <option value={f.place}>{editing?.place?.name ?? 'Current place'}</option>}
        </Select>
      </Field>
      <FieldRow cols={3}>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status', e.target.value as EventForm['status'])}>
            <option value="confirmed">Confirmed</option>
            <option value="tentative">Tentative</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Show as">
          <Select value={f.busy ? 'busy' : 'free'} onChange={(e) => set('busy', e.target.value === 'busy')}>
            <option value="busy">Busy</option>
            <option value="free">Free</option>
          </Select>
        </Field>
        <Field label="Visibility">
          <Select value={f.visibility} onChange={(e) => set('visibility', e.target.value as EventForm['visibility'])}>
            <option value="default">Calendar default</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </Select>
        </Field>
      </FieldRow>
      <Attendees eventId={editing?.id ?? null} attendees={attendees} pending={pending} onPending={onPending} />
    </div>
  )
}
