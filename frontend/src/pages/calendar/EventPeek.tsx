// Event details popover (Google Calendar style): click an event to see it, Edit opens the form. Anchored beside
// the clicked chip on desktop (Base UI Popover with an external anchor), a bottom sheet on phones (Base UI
// Dialog); both close on Escape and outside presses, topmost first. Extra fields from GET /calendar/events/{id}
// (recurrence, attendees, tags, place, …) render when they arrive.
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon, type IconName } from '../../components/Icon'
import { useLayer } from '../../components/layers'
import { Button, buttonClass, Menu, MenuItem, MenuSeparator, Popover, useIsPhone } from '../../components/ui'
import { toast } from '../../components/toast'
import { safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import { relTime } from '../../lib/dates'
import type { CalEvent, Calendar, EventDetail } from '../../lib/types'
import { eventDetailQuery, useDeleteEvent, useDuplicateEvent, useTaskFromEvent, useUpdateEvent, type Scope } from './api'
import { dot, pill } from './chips'
import { FALLBACK_COLOUR } from './colours'
import { categoryName, eventIcon, homeWhen, minutesText, whenLine } from './format'
import { eventDayKey } from './range'
import { useCalPrefs } from './zone'

const MEETING_RE = /https:\/\/[^\s<>"]*(meet\.google\.com|zoom\.us|teams\.microsoft\.com|whereby\.com|jit\.si)[^\s<>"]*/i
const RSVP: Record<string, string> = { accepted: 'going', declined: 'not going', tentative: 'maybe', needs_action: '' }
/** Duplicate "N days later": up to ten years either way. */
const MAX_DUP_DAYS = 3650

const surface = 'overflow-auto bg-surface px-1.5 pt-1.5 pb-3.5 outline-none'

export function EventPeek({
  event,
  calendar,
  anchor,
  onClose,
  onEdit,
}: {
  event: CalEvent
  calendar?: Calendar
  anchor: HTMLElement | null
  onClose: () => void
  onEdit: (e: CalEvent) => void
}) {
  useLayer('popover', true)
  const phone = useIsPhone()
  const popup = useRef<HTMLDivElement>(null)
  const detail = useQuery(eventDetailQuery(event.id))
  const e: EventDetail = { ...event, ...(detail.data ?? {}) }
  const canEdit = !!calendar?.can_edit
  const recurring = !!(e.recurring || e.series_id)
  const remove = useDeleteEvent()
  const colour = e.display_colour || calendar?.colour || FALLBACK_COLOUR

  // Focus goes back to the chip when the peek goes.
  useEffect(
    () => () => {
      if (anchor?.isConnected) anchor.focus({ preventScroll: true })
    },
    [anchor],
  )

  const doDelete = (scope?: Scope) => {
    onClose()
    // Undo recreates it; a whole series (or this-and-following) can't come back that way.
    remove.mutate({ id: event.id, scope, done: `Deleted "${e.name}"`, restore: recurring && scope !== 'this' ? undefined : { ...e } })
  }

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    // Keys from the menus opened inside (portalled, but bubbling through React) aren't the peek's.
    if (!popup.current?.contains(ev.target as Node)) return
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((ev.target as HTMLElement).tagName)
    if (typing || !canEdit) return
    if (ev.key === 'e' || (ev.key === 'Enter' && ev.target === popup.current)) {
      ev.preventDefault()
      onEdit(event)
    } else if (!recurring && (ev.key === 'Delete' || ev.key === 'Backspace')) {
      ev.preventDefault()
      doDelete()
    }
  }

  const props = {
    ref: popup,
    'aria-label': `Event: ${e.name}`,
    style: { '--c': colour } as CSSProperties,
    onKeyDown,
    onDoubleClick: () => canEdit && onEdit(event),
  }
  const body = (
    <PeekBody
      e={e}
      event={event}
      calendar={calendar}
      colour={colour}
      canEdit={canEdit}
      onClose={onClose}
      onEdit={onEdit}
      onDelete={doDelete}
    />
  )

  if (phone)
    return (
      <BaseDialog.Root open onOpenChange={(open) => !open && onClose()}>
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="fixed inset-0 z-70 bg-scrim transition-opacity duration-150 data-starting-style:opacity-0" />
          <BaseDialog.Popup
            {...props}
            initialFocus={popup}
            className={cn(
              surface,
              'fixed inset-x-0 bottom-0 z-71 max-h-[80vh] w-full rounded-t-[14px] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]',
              'transition-[opacity,translate] duration-200 ease-out data-starting-style:translate-y-6 data-starting-style:opacity-0',
            )}
          >
            {body}
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
    )
  return (
    <BasePopover.Root open onOpenChange={(open) => !open && onClose()}>
      <BasePopover.Portal>
        <BasePopover.Positioner
          anchor={anchor?.isConnected ? anchor : centre}
          side={anchor?.isConnected ? 'right' : 'bottom'}
          align={anchor?.isConnected ? 'start' : 'center'}
          sideOffset={anchor?.isConnected ? 8 : 0}
          alignOffset={anchor?.isConnected ? -8 : 0}
          collisionPadding={8}
          className="z-62 outline-none"
        >
          <BasePopover.Popup
            {...props}
            initialFocus={popup}
            finalFocus={false}
            className={cn(
              surface,
              'max-h-[min(34rem,calc(100vh-16px))] w-[min(24rem,calc(100vw-16px))] rounded-[calc(var(--app-radius)+2px)] shadow-pop',
              'origin-(--transform-origin) transition-[opacity,scale,translate] duration-120 ease-out',
              'data-starting-style:-translate-y-1 data-starting-style:scale-[0.98] data-starting-style:opacity-0',
            )}
          >
            {body}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

/** Opened from a deep link or search (no chip on screen): centred near the top of the window. */
const centre = {
  getBoundingClientRect: () => {
    const x = window.innerWidth / 2
    const y = Math.max(16, window.innerHeight * 0.15)
    return new DOMRect(x, y, 0, 0)
  },
}

function PeekBody({
  e,
  event,
  calendar,
  colour,
  canEdit,
  onClose,
  onEdit,
  onDelete,
}: {
  e: EventDetail
  event: CalEvent
  calendar?: Calendar
  colour: string
  canEdit: boolean
  onClose: () => void
  onEdit: (e: CalEvent) => void
  onDelete: (scope?: Scope) => void
}) {
  const { tz } = useCalPrefs()
  const navigate = useNavigate()
  const toTask = useTaskFromEvent()
  const update = useUpdateEvent()
  const recurring = !!(e.recurring || e.series_id)
  const meeting = safeHref(e.meeting_url || null) ?? (e.location?.match(MEETING_RE)?.[0] || e.description?.match(MEETING_RE)?.[0] || null)
  const place = e.place ? [e.place.name, e.place.address].filter(Boolean).join(', ') : ''
  const location = [e.location && e.location !== meeting ? e.location : '', place && place !== e.location ? place : '']
    .filter(Boolean)
    .join(' · ')
  const category = categoryName(e)
  const attendees = (e.attendees ?? []).map(
    (a) => `${a.name || a.email}${a.is_organizer ? ' (organizer)' : RSVP[a.rsvp] ? ` (${RSVP[a.rsvp]})` : ''}`,
  )
  const reminders = (e.reminders ?? []).map(minutesText).join(', ')
  const upcoming = new Date(e.start) > new Date() ? relTime(new Date(e.start)) : null
  // Photos taken during the event (all-day events: their whole days).
  const photosHref = `/photos?${new URLSearchParams({ after: new Date(e.start).toISOString(), before: new Date(e.end ? e.end : new Date(e.start).getTime() + 3600_000).toISOString(), title: e.name })}`
  const dayHref = `/photos?date=${eventDayKey(e)}`
  // The countdown page (/calendar/countdown/<id>/start|end, works signed out) opens for editors and public calendars.
  const countdown = canEdit || calendar?.public ? `/calendar/countdown/${encodeURIComponent(event.id)}/` : null
  const icon = eventIcon(e)
  const link = buttonClass({ variant: 'ghost', size: 'sm' })
  const sub = 'mt-0.5 flex items-center gap-1 text-xs text-muted'
  const row = (key: string, glyph: IconName, children: ReactNode) => (
    <div className="flex items-start gap-3 text-sm" key={key}>
      <Icon name={glyph} size={15} className="mt-0.5 flex-none text-muted" />
      <div className="min-w-0 flex-auto">{children}</div>
    </div>
  )
  const go = (href: string) => (ev: React.MouseEvent) => {
    ev.preventDefault()
    navigate(href)
  }

  return (
    <>
      <div className="flex items-center gap-0.5">
        {canEdit && (
          <Button variant="ghost" size="sm" icon onClick={() => onEdit(event)} aria-label="Edit event" title="Edit (E)">
            <Icon name="edit" />
          </Button>
        )}
        {canEdit && !recurring && (
          <Button variant="ghost" size="sm" icon onClick={() => onDelete()} aria-label="Delete event" title="Delete (Del)">
            <Icon name="trash" />
          </Button>
        )}
        {canEdit && recurring && (
          <Menu
            label="Delete repeating event"
            trigger={(p) => (
              <button
                {...p}
                type="button"
                className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })}
                aria-label="Delete event"
                title="Delete"
              >
                <Icon name="trash" />
              </button>
            )}
          >
            {() => (
              <>
                <MenuItem onClick={() => onDelete('this')}>This event</MenuItem>
                <MenuItem onClick={() => onDelete('following')}>This and following events</MenuItem>
                <MenuItem danger onClick={() => onDelete('all')}>
                  All events
                </MenuItem>
              </>
            )}
          </Menu>
        )}
        {canEdit && (
          <DuplicateMenu
            id={event.id}
            onEdit={(c) => {
              onClose()
              onEdit(c)
            }}
          />
        )}
        {e.task_id && (
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={() => navigate(`/tasks?view=all&task=${e.task_id}`)}
            aria-label="Open in Tasks"
            title="Open in Tasks"
          >
            <Icon name="tasks" />
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon name="x" />
        </Button>
      </div>
      <div className="flex gap-3 pt-1 pr-3 pb-2 pl-3.5">
        <span className="mt-1.25 grid size-3.5 flex-none place-items-center rounded-xs bg-(--c) text-white" aria-hidden="true">
          {icon && <Icon name={icon} size={11} />}
        </span>
        <div className="min-w-0 flex-auto">
          <h2
            className={cn('text-lg leading-[1.3] font-semibold tracking-[-0.01em] wrap-anywhere', e.completed && 'text-muted line-through')}
          >
            {e.name}
          </h2>
          <p className="mt-0.5 text-sm">
            {whenLine(e, tz)}
            {upcoming && <span className="text-muted"> · {upcoming}</span>}
          </p>
          {tz && !e.all_day && (
            <p className={sub}>
              <Icon name="globe" size={12} /> {homeWhen(e)}
            </p>
          )}
          {e.recurrence_text && (
            <p className={sub}>
              <Icon name="repeat" size={12} /> {e.recurrence_text}
            </p>
          )}
          {e.status && e.status !== 'confirmed' && <p className={sub}>{e.status === 'tentative' ? 'Tentative' : 'Cancelled'}</p>}
        </div>
      </div>
      <div className="grid gap-2.5 px-3.5 pt-1">
        {meeting &&
          row(
            'meet',
            'video',
            <a className={buttonClass({ variant: 'primary', size: 'sm' })} href={meeting} target="_blank" rel="noopener noreferrer">
              Join meeting
            </a>,
          )}
        {location && row('loc', 'pin', <span className="whitespace-pre-wrap wrap-anywhere">{location}</span>)}
        {e.description &&
          row('desc', 'list', <p className="max-h-40 overflow-auto whitespace-pre-wrap text-fg wrap-anywhere">{e.description}</p>)}
        {attendees.length > 0 && row('att', 'users', attendees.join(', '))}
        {(category || (e.tags && e.tags.length > 0)) &&
          row(
            'tags',
            'tag',
            <span className="flex flex-wrap gap-1">
              {category && <span className={pill}>{category}</span>}
              {e.tags?.map((t) => (
                <span key={t} className={pill}>
                  #{t}
                </span>
              ))}
            </span>,
          )}
        {reminders && row('rem', 'bell', reminders)}
        {(e.transparency === 'free' || (e.visibility && e.visibility !== 'default')) &&
          row(
            'vis',
            'info',
            [
              e.transparency === 'free' ? 'Shows as free' : '',
              e.visibility === 'private' ? 'Private' : e.visibility === 'public' ? 'Public' : '',
            ]
              .filter(Boolean)
              .join(' · '),
          )}
        {row(
          'cal',
          'calendar',
          <span className="flex items-center gap-1.5">
            <span className={dot} style={{ background: calendar?.colour || colour }} />
            {calendar?.name ?? 'Calendar'}
            {!canEdit && <span className={pill}>View only</span>}
          </span>,
        )}
        <div className="-ml-2 flex flex-wrap gap-1">
          <a className={link} href={photosHref} onClick={go(photosHref)}>
            <Icon name="photo" size={13} />
            Photos from this event
          </a>
          <a className={link} href={dayHref} onClick={go(dayHref)}>
            This day
          </a>
          {countdown && (
            <>
              <a className={link} href={`${countdown}start`} target="_blank" rel="noopener noreferrer">
                <Icon name="clock" size={13} />
                {e.kind === 'deadline' ? 'Countdown' : 'Countdown to start'}
              </a>
              {e.kind === 'event' && e.end && (
                <a className={link} href={`${countdown}end`} target="_blank" rel="noopener noreferrer">
                  To end
                </a>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {e.kind === 'deadline' && canEdit && (
            <Button
              size="sm"
              onClick={() =>
                update.mutate(
                  { id: event.id, scope: recurring ? 'this' : undefined, body: { completed: !e.completed } },
                  { onSuccess: () => toast.show(e.completed ? 'Marked not done' : `Done: "${e.name}"`) },
                )
              }
              disabled={update.isPending}
            >
              <Icon name="check" size={14} />
              {e.completed ? 'Mark not done' : 'Mark done'}
            </Button>
          )}
          {e.task_id ? (
            <Button size="sm" onClick={() => navigate(`/tasks?view=all&task=${e.task_id}`)}>
              <Icon name="tasks" size={14} />
              In Tasks · Open
            </Button>
          ) : (
            <Button
              size="sm"
              variant={e.kind === 'deadline' ? 'primary' : 'default'}
              onClick={() => toTask.mutate(event.id)}
              disabled={toTask.isPending}
            >
              <Icon name="tasks" size={14} />
              Add to tasks
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

/** Duplicate: same time (then edit), next day, next week, or any number of days later or earlier. */
function DuplicateMenu({ id, onEdit }: { id: string; onEdit: (copy: CalEvent) => void }) {
  const duplicate = useDuplicateEvent()
  const [days, setDays] = useState('1')
  const n = Number(days)
  const ok = Number.isInteger(n) && Math.abs(n) <= MAX_DUP_DAYS
  return (
    <Popover
      label="Duplicate"
      width="15rem"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })}
          aria-label="Duplicate event"
          title="Duplicate"
        >
          <Icon name="copy" />
        </button>
      )}
    >
      {(close) => {
        const dup = (d: number, edit = false) => {
          close()
          duplicate.mutate({ id, days: d }, { onSuccess: (c) => edit && onEdit(c) })
        }
        return (
          <>
            <MenuItem icon="copy" onClick={() => dup(0, true)}>
              Same time, then edit
            </MenuItem>
            <MenuItem icon="copy" onClick={() => dup(1)}>
              Next day
            </MenuItem>
            <MenuItem icon="copy" onClick={() => dup(7)}>
              Next week
            </MenuItem>
            <MenuSeparator />
            <form
              className="flex items-center gap-1.5 px-2 py-1"
              onSubmit={(ev) => {
                ev.preventDefault()
                if (ok) dup(n)
              }}
            >
              <input
                className="h-7 w-18 rounded-sm border border-border bg-surface px-2.5 text-sm text-fg focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_18%,transparent)] focus:outline-none"
                type="number"
                min={-MAX_DUP_DAYS}
                max={MAX_DUP_DAYS}
                step={1}
                value={days}
                onChange={(ev) => setDays(ev.target.value)}
                aria-label="Days later (negative for earlier)"
              />
              <span className="text-xs text-muted">days later</span>
              <Button type="submit" size="sm" disabled={!ok}>
                Copy
              </Button>
            </form>
          </>
        )
      }}
    </Popover>
  )
}
