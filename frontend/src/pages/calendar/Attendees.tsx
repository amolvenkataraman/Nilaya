// Event attendees: search contacts (or type a name/email), RSVP, remove. For a new event they are
// queued and added once the event exists (attendees have their own endpoint).
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { useDebounced } from '../../components/ui'
import { toast } from '../../components/toast'
import { del, get, patch, post } from '../../lib/api'
import type { Attendee } from '../../lib/types'

export type AttendeeDraft = { contact_id?: string; name: string; email: string; rsvp?: Attendee['rsvp'] }
const RSVP: [Attendee['rsvp'], string][] = [['needs_action', 'Invited'], ['accepted', 'Going'], ['tentative', 'Maybe'], ['declined', 'Not going']]
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

export function Attendees({ eventId, attendees, pending, onPending }: {
  eventId: string | null; attendees: Attendee[]; pending: AttendeeDraft[]; onPending: (a: AttendeeDraft[]) => void
}) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 250)
  const people = useQuery({
    queryKey: ['contacts', 'list', { q, filter: undefined, tag: undefined, sort: 'name' }],
    queryFn: ({ signal }) => get<{ items: { id: string; name: string; email: string }[] }>('contacts/', { q, sort: 'name', limit: 8 }, signal),
    enabled: q.length >= 2,
    staleTime: 60_000,
  })
  const refresh = () => eventId && qc.invalidateQueries({ queryKey: ['calendar', 'event', eventId] })
  const add = useMutation({ mutationFn: (a: AttendeeDraft) => post(`calendar/events/${encodeURIComponent(eventId!)}/attendees`, a), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) })
  const setRsvp = useMutation({ mutationFn: ({ id, rsvp }: { id: number; rsvp: string }) => patch(`calendar/events/${encodeURIComponent(eventId!)}/attendees/${id}`, { rsvp }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: number) => del(`calendar/events/${encodeURIComponent(eventId!)}/attendees/${id}`), onSuccess: refresh })
  const pick = (a: AttendeeDraft) => {
    setText('')
    if (eventId) add.mutate(a)
    else onPending([...pending, a])
  }
  const typed = text.trim()
  return (
    <div className="field">
      <span>People</span>
      <ul className="ev-people">
        {attendees.map((a) => (
          <li key={a.id}>
            <span className="grow truncate">{a.name || a.email}{a.is_organizer && <span className="chip">Organizer</span>}{a.name && a.email && <span className="muted xsmall"> {a.email}</span>}</span>
            <select className="select sm-select" value={a.rsvp} aria-label={`RSVP for ${a.name || a.email}`} onChange={(e) => setRsvp.mutate({ id: a.id, rsvp: e.target.value })}>
              {RSVP.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="button" className="btn ghost icon sm" aria-label={`Remove ${a.name || a.email}`} onClick={() => remove.mutate(a.id)}><Icon name="x" size={12} /></button>
          </li>
        ))}
        {pending.map((a, i) => (
          <li key={'p' + i}>
            <span className="grow truncate">{a.name || a.email}<span className="muted xsmall"> · added when saved</span></span>
            <button type="button" className="btn ghost icon sm" aria-label={`Remove ${a.name || a.email}`} onClick={() => onPending(pending.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
          </li>
        ))}
      </ul>
      <div className="ev-people-add">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add people: search contacts or type an email" aria-label="Add attendee"
          onKeyDown={(e) => { if (e.key === 'Enter' && typed) { e.preventDefault(); pick(EMAIL.test(typed) ? { name: '', email: typed } : { name: typed, email: '' }) } }} />
        {q.length >= 2 && (people.data?.items.length ?? 0) > 0 && (
          <ul className="ev-people-results" role="listbox">
            {people.data!.items.map((c) => (
              <li key={c.id}><button type="button" role="option" aria-selected="false" onClick={() => pick({ contact_id: c.id, name: c.name, email: c.email })}>
                <Icon name="user" size={13} /><span className="truncate">{c.name}</span>{c.email && <span className="muted xsmall truncate">{c.email}</span>}
              </button></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
