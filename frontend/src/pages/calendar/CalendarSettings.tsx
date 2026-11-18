// Calendar settings drawer (from a calendar's "…" menu), loaded on demand: general settings for owners and
// admins, personal ones for everyone, then sharing (CalendarPeople.tsx), sync (SyncSection.tsx) and delete/leave.
// Contract: GET/PATCH /calendar/calendars/{id}, DELETE /calendar/calendars/{id}?confirm=<name>, GET /calendar/icons.
import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import {
  Button,
  buttonClass,
  Confirm,
  Drawer,
  DrawerBody,
  DrawerHead,
  Field,
  FieldRow,
  Input,
  PanelRow,
  PanelSection,
  QueryView,
  Select,
  SkeletonRows,
  Switch,
  Textarea,
} from '../../components/ui'
import { toast } from '../../components/toast'
import type { Calendar } from '../../lib/types'
import { useCalendarDetail, useCalendarIcons, useDeleteCalendar, useLeaveCalendar, useSaveCalendar } from './api'
import { codeClass, Invites, Subscribers } from './CalendarPeople'
import { publicUrl } from './CalendarMenu'
import { ColourChoice } from './ColourChoice'
import { FALLBACK_COLOUR } from './colours'
import { IconPicker } from './IconPicker'
import { SyncSection } from './SyncSection'
import { type CalendarDetail, type CalendarPatchBody, personName } from './types'

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
})()

/** A calendar's icon on a soft tile of its colour. */
export function CalendarIconGlyph({ icon, colour, size = 1 }: { icon?: string; colour: string; size?: number }) {
  return (
    <span
      className="inline-grid flex-none place-items-center rounded-[30%] bg-[color-mix(in_srgb,var(--c)_16%,var(--app-surface))] text-(--c)"
      style={{ '--c': colour, width: `${size * 1.25}rem`, height: `${size * 1.25}rem` } as CSSProperties}
      aria-hidden="true"
    >
      <Icon name={icon || 'calendar'} size={size * 12} />
    </span>
  )
}

export function CalendarSettings({ calendar, onClose }: { calendar: Calendar | null; onClose: () => void }) {
  return (
    <Drawer open={!!calendar} onClose={onClose} label="Calendar settings">
      {calendar && <SettingsBody key={calendar.id} cal={calendar} onClose={onClose} />}
    </Drawer>
  )
}

function SettingsBody({ cal, onClose }: { cal: Calendar; onClose: () => void }) {
  const detail = useCalendarDetail(cal.id)
  const d = detail.data
  const colour = d?.my_colour || d?.colour || cal.colour || FALLBACK_COLOUR
  return (
    <>
      <DrawerHead>
        <CalendarIconGlyph icon={d?.icon} colour={colour} size={1.4} />
        <strong className="min-w-0 flex-auto truncate">{d?.name ?? cal.name}</strong>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close settings">
          <Icon name="x" />
        </Button>
      </DrawerHead>
      <DrawerBody className="gap-5">
        <QueryView query={detail} skeleton={<SkeletonRows rows={6} />}>
          {(data) => <SettingsSections d={data} cal={cal} onClose={onClose} />}
        </QueryView>
      </DrawerBody>
    </>
  )
}

function SettingsSections({ d, cal, onClose }: { d: CalendarDetail; cal: Calendar; onClose: () => void }) {
  const save = useSaveCalendar(cal.id)
  const manage = cal.role === 'owner' || cal.role === 'admin'
  return (
    <>
      {!d.active && (
        <p className="flex items-start gap-2 rounded-sm bg-warning-soft px-2.5 py-2 text-xs text-warning">
          <Icon name="alert" size={14} />
          This calendar is disabled: its events are hidden everywhere.
        </p>
      )}

      <PanelSection id="cs-general" title="General">
        {manage ? (
          <General d={d} onSave={(b) => save.mutate(b)} />
        ) : (
          <p className="text-sm">
            {d.name}
            {d.owner ? (
              <span className="text-muted">
                {' '}
                · owned by{' '}
                <Link to={`/calendar/availability/${encodeURIComponent(d.owner.username)}`} title="See their availability">
                  {personName(d.owner)}
                </Link>
              </span>
            ) : null}
            {d.description ? (
              <>
                <br />
                <span className="text-muted">{d.description}</span>
              </>
            ) : null}
          </p>
        )}
        {d.public && (
          <div className="grid gap-1">
            <span className="text-xs text-muted">Public link</span>
            <div className="flex items-center gap-1">
              <code className={`${codeClass} min-w-0 flex-auto truncate px-2! py-1!`} title={publicUrl(d.id)}>
                {publicUrl(d.id)}
              </code>
              <Button
                variant="ghost"
                size="sm"
                icon
                onClick={() => toast.copy(publicUrl(d.id), 'Public link copied')}
                aria-label="Copy public link"
                title="Copy link"
              >
                <Icon name="copy" size={14} />
              </Button>
              <a
                className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })}
                href={`/calendar/public/${d.id}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open public page"
                title="Open"
              >
                <Icon name="external" size={14} />
              </a>
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection id="cs-mine" title="Just for me">
        <PanelRow label="Show in my calendar">
          <Switch checked={d.visible} onChange={(v) => save.mutate({ visible: v })} ariaLabel="Visible" />
        </PanelRow>
        <PanelRow label="Reminders" help="Send event reminders from this calendar.">
          <Switch checked={!!d.notify} onChange={(v) => save.mutate({ notify: v })} ariaLabel="Notify" />
        </PanelRow>
        <div className="grid gap-1.25">
          <span className="text-xs font-medium text-muted">My colour (only you see it)</span>
          <ColourChoice value={d.my_colour ?? ''} onChange={(c) => save.mutate({ my_colour: c })} label="My colour" delay={400} />
        </div>
        {d.subscription && (
          <Field label="Your availability page shows" hint="What people see at your availability page (times only, never names).">
            <Select value={d.subscription.display_busy} onChange={(e) => save.mutate({ display_busy: Number(e.target.value) })}>
              <option value={0}>Nothing from this calendar</option>
              <option value={1}>Busy times of meetings, work and study</option>
              <option value={2}>Busy times of every event</option>
            </Select>
          </Field>
        )}
      </PanelSection>

      {manage && <Subscribers cal={cal} />}
      {manage && <Invites cal={cal} />}
      {(d.synced || d.sync?.url || manage) && <SyncSection cal={d} canSync={manage} />}
      <Danger cal={d} onDone={onClose} />
    </>
  )
}

/** Name, description, colour, icon, active, zone, tags and public, for owners and admins. Text saves on blur. */
function General({ d, onSave }: { d: CalendarDetail; onSave: (b: CalendarPatchBody) => void }) {
  const icons = useCalendarIcons().data ?? []
  const [name, setName] = useState(d.name)
  const [desc, setDesc] = useState(d.description ?? '')
  const [tz, setTz] = useState(d.time_zone ?? '')
  const [tags, setTags] = useState((d.tags ?? []).join(', '))
  // A newer detail from the server (after any save) resets the text fields, during render rather than in an
  // effect; remounting instead would drop focus from the field being tabbed into.
  const [seen, setSeen] = useState(d)
  if (seen !== d) {
    setSeen(d)
    setName(d.name)
    setDesc(d.description ?? '')
    setTz(d.time_zone ?? '')
    setTags((d.tags ?? []).join(', '))
  }
  const tagList = (t: string) =>
    t
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20)
  return (
    <>
      <Field label="Name">
        <Input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== d.name && onSave({ name: name.trim() })}
        />
      </Field>
      <Field label="Description">
        <Textarea
          rows={2}
          value={desc}
          maxLength={1000}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== (d.description ?? '') && onSave({ description: desc })}
        />
      </Field>
      <div className="grid gap-1.25">
        <span className="text-xs font-medium text-muted">Calendar colour</span>
        <ColourChoice
          value={d.calendar_colour ?? d.colour}
          onChange={(c) => c && onSave({ calendar_colour: c })}
          label="Calendar colour"
          delay={400}
        />
      </div>
      <div className="grid gap-1.25">
        <span className="text-xs font-medium text-muted">Icon</span>
        <IconPicker value={d.icon ?? ''} onChange={(i) => onSave({ icon: i })} icons={icons} />
      </div>
      <PanelRow label="Active" help="Disabled calendars and their events are hidden everywhere.">
        <Switch checked={d.active} onChange={(v) => onSave({ active: v })} ariaLabel="Active" />
      </PanelRow>
      <FieldRow>
        <Field label="Time zone">
          <Input
            value={tz}
            list="cal-zones"
            maxLength={64}
            placeholder="Server time zone"
            onChange={(e) => setTz(e.target.value)}
            onBlur={() => tz.trim() !== (d.time_zone ?? '') && onSave({ time_zone: tz.trim() })}
          />
          <datalist id="cal-zones">
            {ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field label="Tags">
          <Input
            value={tags}
            maxLength={300}
            placeholder="school, family"
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => tagList(tags).join(',') !== (d.tags ?? []).join(',') && onSave({ tags: tagList(tags) })}
          />
        </Field>
      </FieldRow>
      <PanelRow label="Public" help="Anyone with the link can view it.">
        <Switch checked={d.public} onChange={(v) => onSave({ public: v })} ariaLabel="Public" />
      </PanelRow>
    </>
  )
}

function Danger({ cal, onDone }: { cal: CalendarDetail; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const owner = cal.role === 'owner'
  const remove = useDeleteCalendar()
  const leave = useLeaveCalendar()
  return (
    <PanelSection id="cs-danger" title={owner ? 'Delete calendar' : 'Leave calendar'} danger>
      <p className="text-xs text-muted">
        {owner
          ? 'Deletes the calendar and all of its events for everyone.'
          : 'Stop seeing this calendar. You can rejoin with an invite code.'}
      </p>
      <Button
        variant="danger"
        size="sm"
        className="justify-self-start"
        onClick={() => {
          setTyped('')
          setOpen(true)
        }}
      >
        <Icon name={owner ? 'trash' : 'logout'} size={14} />
        {owner ? 'Delete…' : 'Leave'}
      </Button>
      <Confirm
        open={open}
        onClose={() => setOpen(false)}
        title={owner ? `Delete "${cal.name}"?` : `Leave "${cal.name}"?`}
        body={owner ? undefined : 'Its events disappear from your calendar.'}
        confirmLabel={owner ? 'Delete calendar' : 'Leave'}
        disabled={(owner && typed !== cal.name) || remove.isPending || leave.isPending}
        onConfirm={() => (owner ? remove.mutate({ cal, typed }, { onSuccess: onDone }) : leave.mutate(cal, { onSuccess: onDone }))}
      >
        {owner && (
          <Field
            label={
              <>
                Type <strong>{cal.name}</strong> to confirm
              </>
            }
          >
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
        )}
      </Confirm>
    </PanelSection>
  )
}
