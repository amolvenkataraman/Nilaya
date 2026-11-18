// A contact's interactions: a one-line form to log one (kind, date, summary, optional notes) and the timeline,
// where each entry can be edited in place with the same form or deleted.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, Confirm, Input, Select, Textarea } from '../../components/ui'
import { dayKey, fmtDate, parseDayKey } from '../../lib/dates'
import { useContactMeta, useDeleteInteraction, useLogInteraction, useUpdateInteraction, type Interaction, type PersonDetail } from './api'
import { LinkButton } from './LinkButton'
import { cap } from './personFields'
import { SectionLabel } from './SectionLabel'

const rowAction = 'self-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100'

export function Interactions({ person }: { person: PersonDetail }) {
  const kinds = useContactMeta().data?.interaction_kinds ?? ['call', 'meeting', 'message', 'email', 'note']
  const log = useLogInteraction(person.id)
  const update = useUpdateInteraction()
  const remove = useDeleteInteraction()
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Interaction | null>(null)
  return (
    <div className="grid gap-2">
      <SectionLabel>
        Interactions {person.last_contacted && <span className="text-muted">· last {fmtDate(parseDayKey(person.last_contacted))}</span>}
      </SectionLabel>
      <InteractionForm
        kinds={kinds}
        pending={log.isPending}
        onSubmit={(body, reset) =>
          log.mutate(body, {
            onSuccess: () => {
              reset()
              toast.show('Logged')
            },
          })
        }
      />
      <ol className="m-0 grid list-none gap-px p-0">
        {person.interactions.map((i) =>
          editing === i.id ? (
            <li key={i.id} className="rounded-sm bg-surface-2 p-2">
              <InteractionForm
                kinds={kinds}
                existing={i}
                pending={update.isPending}
                onCancel={() => setEditing(null)}
                onSubmit={(body) => update.mutate({ id: i.id, body }, { onSuccess: () => setEditing(null) })}
              />
            </li>
          ) : (
            <li key={i.id} className="group flex items-baseline gap-2.5 rounded-sm px-1 py-1.5 hover:bg-hover">
              <span className="min-w-16 text-xs font-medium text-accent capitalize">{i.kind}</span>
              <span className="min-w-0 flex-auto text-sm">
                {i.summary}
                {i.notes && <span className="mt-0.5 block text-xs whitespace-pre-wrap wrap-anywhere text-muted">{i.notes}</span>}
              </span>
              <time className="text-xs text-muted tabular-nums">{fmtDate(parseDayKey(i.date))}</time>
              <span className="inline-flex self-center">
                <Button variant="ghost" size="sm" icon className={rowAction} aria-label="Edit interaction" onClick={() => setEditing(i.id)}>
                  <Icon name="edit" size={12} />
                </Button>
                <Button variant="ghost" size="sm" icon className={rowAction} aria-label="Delete interaction" onClick={() => setDeleting(i)}>
                  <Icon name="trash" size={12} />
                </Button>
              </span>
            </li>
          ),
        )}
        {!person.interactions.length && <li className="text-sm text-muted">No interactions logged yet.</li>}
      </ol>
      <Confirm
        open={!!deleting}
        title="Delete this interaction?"
        body={deleting?.summary}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

type InteractionBody = { kind: string; date: string; summary: string; notes: string }

function InteractionForm({
  kinds,
  existing,
  pending,
  onSubmit,
  onCancel,
}: {
  kinds: string[]
  existing?: Interaction
  pending: boolean
  onSubmit: (b: InteractionBody, reset: () => void) => void
  onCancel?: () => void
}) {
  const today = dayKey(new Date())
  const [kind, setKind] = useState(existing?.kind ?? 'call')
  const [date, setDate] = useState(existing?.date ?? today)
  const [summary, setSummary] = useState(existing?.summary ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [showNotes, setShowNotes] = useState(!!existing?.notes)
  const reset = () => {
    setSummary('')
    setNotes('')
    setShowNotes(false)
    setDate(dayKey(new Date()))
  }
  const submit = () => summary.trim() && onSubmit({ kind, date: date || today, summary: summary.trim(), notes: notes.trim() }, reset)
  return (
    <form
      className="grid grid-cols-[7.5rem_9rem_minmax(0,1fr)_auto] items-center gap-1.5 max-md:grid-cols-[minmax(0,1fr)_9rem]"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
        {kinds.map((k) => (
          <option key={k} value={k}>
            {cap(k)}
          </option>
        ))}
      </Select>
      <Input type="date" value={date} max="2100-12-31" onChange={(e) => setDate(e.target.value)} aria-label="Date" required />
      <Input
        className="max-md:col-span-full"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="What did you talk about?"
        aria-label="Summary"
        maxLength={500}
        autoFocus={!!existing}
      />
      <span className="flex justify-end gap-1.5 max-md:col-span-full">
        {onCancel && (
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" disabled={!summary.trim() || pending}>
          {existing ? 'Save' : 'Log'}
        </Button>
      </span>
      {showNotes ? (
        <Textarea
          size="sm"
          className="col-span-full"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          aria-label="Notes"
          maxLength={20000}
          rows={2}
        />
      ) : (
        <LinkButton className="col-span-full text-xs!" onClick={() => setShowNotes(true)}>
          <Icon name="plus" size={12} />
          Add notes
        </LinkButton>
      )}
    </form>
  )
}
