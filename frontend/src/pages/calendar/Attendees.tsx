// Event attendees: search contacts (or type a name/email), RSVP, remove. For a new event they are
// queued and added once the event exists (attendees have their own endpoint).
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, fieldClass, useDebounced } from '../../components/ui'
import { cn } from '../../lib/cn'
import type { Attendee } from '../../lib/types'
import { useAttendeeMutations, useContactSearch } from './api'
import { pillSm } from './chips'

export type AttendeeDraft = { contact_id?: string; name: string; email: string; rsvp?: Attendee['rsvp'] }
const RSVP: [Attendee['rsvp'], string][] = [
  ['needs_action', 'Invited'],
  ['accepted', 'Going'],
  ['tentative', 'Maybe'],
  ['declined', 'Not going'],
]
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
/** The compact select in a row (RSVP, role). */
export const smallSelect = fieldClass.select({ size: 'sm', width: 'content' })

export function Attendees({
  eventId,
  attendees,
  pending,
  onPending,
}: {
  eventId: string | null
  attendees: Attendee[]
  pending: AttendeeDraft[]
  onPending: (a: AttendeeDraft[]) => void
}) {
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 250)
  const people = useContactSearch(q)
  const { add, rsvp, remove } = useAttendeeMutations()
  const pick = (a: AttendeeDraft) => {
    setText('')
    if (eventId) add.mutate({ eventId, attendee: a })
    else onPending([...pending, a])
  }
  const typed = text.trim()
  const row = 'flex min-h-8 items-center gap-1.5 text-sm'
  const hits = q.length >= 2 ? (people.data?.items ?? []) : []
  return (
    <div className="grid gap-1.25">
      <span className="text-xs font-medium text-muted">People</span>
      <ul className="grid gap-px">
        {attendees.map((a) => (
          <li key={a.id} className={row}>
            <span className="min-w-0 flex-auto truncate">
              {a.name || a.email}
              {a.is_organizer && <span className={cn(pillSm, 'ml-1.5')}>Organizer</span>}
              {a.name && a.email && <span className="text-xs text-muted"> {a.email}</span>}
            </span>
            <select
              className={smallSelect}
              value={a.rsvp}
              aria-label={`RSVP for ${a.name || a.email}`}
              onChange={(e) => eventId && rsvp.mutate({ eventId, id: a.id, rsvp: e.target.value })}
            >
              {RSVP.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={`Remove ${a.name || a.email}`}
              onClick={() => eventId && remove.mutate({ eventId, id: a.id })}
            >
              <Icon name="x" size={12} />
            </Button>
          </li>
        ))}
        {pending.map((a) => (
          <li key={`p${a.contact_id ?? ''}${a.email}${a.name}`} className={row}>
            <span className="min-w-0 flex-auto truncate">
              {a.name || a.email}
              <span className="text-xs text-muted"> · added when saved</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={`Remove ${a.name || a.email}`}
              onClick={() => onPending(pending.filter((x) => x !== a))}
            >
              <Icon name="x" size={12} />
            </Button>
          </li>
        ))}
      </ul>
      <div className="relative">
        <input
          className={fieldClass.input()}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add people: search contacts or type an email"
          aria-label="Add attendee"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && typed) {
              e.preventDefault()
              pick(EMAIL.test(typed) ? { name: '', email: typed } : { name: typed, email: '' })
            }
          }}
        />
        {hits.length > 0 && (
          <div
            className="absolute top-[calc(100%+2px)] right-0 left-0 z-5 grid rounded-md bg-surface p-1 shadow-pop"
            role="listbox"
            aria-label="Contacts"
          >
            {hits.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-sm text-fg hover:bg-hover"
                onClick={() => pick({ contact_id: c.id, name: c.name, email: c.email })}
              >
                <Icon name="user" size={13} />
                <span className="min-w-0 truncate">{c.name}</span>
                {c.email && <span className="min-w-0 truncate text-xs text-muted">{c.email}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
