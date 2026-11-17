// A contact's relationships: the list (each name opens that contact) and an inline form that picks the kind
// and searches contacts by name.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Avatar, Button, Input, Select, useDebounced } from '../../components/ui'
import { avatarSrc, useContactMeta, usePeopleSearch, useRelationships, type PersonDetail } from './api'
import { LinkButton } from './LinkButton'
import { relLabel } from './personFields'
import { SectionLabel } from './SectionLabel'

export function Relationships({ person, onOpen }: { person: PersonDetail; onOpen: (id: string) => void }) {
  const kinds = useContactMeta().data?.relationship_kinds ?? ['friend']
  const { add, remove } = useRelationships(person.id)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState('friend')
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 250)
  const results = usePeopleSearch(adding ? q : '')
  const matches = results.data?.items.filter((x) => x.id !== person.id) ?? []
  const pick = (otherId: string) =>
    add.mutate(
      { other_id: otherId, kind },
      {
        onSuccess: () => {
          setText('')
          setAdding(false)
        },
      },
    )
  return (
    <div className="grid gap-2">
      <SectionLabel className="min-h-7 items-center">
        Relationships
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          <Icon name={adding ? 'x' : 'plus'} size={13} />
          {adding ? 'Cancel' : 'Add'}
        </Button>
      </SectionLabel>
      {adding && (
        <div className="grid gap-1.5 rounded-md border border-border bg-surface p-3">
          <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-1.5 max-md:grid-cols-1">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Relationship">
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {relLabel(k)}
                </option>
              ))}
            </Select>
            <Input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search contacts"
              aria-label="Contact"
              autoFocus
              autoComplete="off"
              maxLength={100}
            />
          </div>
          <p className="text-xs text-muted">
            {person.first_name || person.name}’s {relLabel(kind).toLowerCase()} is…
          </p>
          {q.length >= 2 && (
            <ul className="grid max-h-60 gap-px overflow-y-auto">
              {results.isFetching && !results.data ? (
                <li className="px-2 py-1.5 text-sm text-muted">Searching…</li>
              ) : matches.length ? (
                matches.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.25 text-left text-sm text-fg hover:bg-hover"
                      disabled={add.isPending}
                      onClick={() => pick(x.id)}
                    >
                      <Avatar name={x.name} src={avatarSrc(x)} size={1.5} />
                      <span className="truncate">{x.name}</span>
                      <span className="truncate text-xs text-muted">{x.company}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-2 py-1.5 text-sm text-muted">No matches.</li>
              )}
            </ul>
          )}
        </div>
      )}
      {person.relationships.length > 0 ? (
        <ul className="grid gap-px">
          {person.relationships.map((r) => (
            <li key={r.id} className="group flex min-h-8 items-center gap-2.5 rounded-sm px-1 py-0.5 hover:bg-hover">
              <span className="min-w-24 text-xs font-medium text-muted capitalize">{relLabel(r.kind)}</span>
              <LinkButton className="min-w-0 flex-auto" onClick={() => onOpen(r.other_id)}>
                {r.other_name}
              </LinkButton>
              <Button
                variant="ghost"
                size="sm"
                icon
                className="self-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Remove ${relLabel(r.kind)} ${r.other_name}`}
                onClick={() => remove.mutate(r.id)}
              >
                <Icon name="x" size={12} />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        !adding && <p className="text-sm text-muted">No relationships yet.</p>
      )}
    </div>
  )
}
