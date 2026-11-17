// Merge duplicates (?view=duplicates): suggested pairs, grouped when several records look like the same person,
// each with why it matched, "Not duplicates" and Merge (the dialogs are in MergeDialogs.tsx).
import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Avatar, Button, Chip, QueryView, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { plural } from '../../lib/format'
import { avatarSrc, useDismissDuplicate, useDuplicates, type DuplicatePair, type PersonFull } from './api'
import { detailPane } from './detailPane'
import { MergeDialog, MergeManyDialog } from './MergeDialogs'

/** Connected groups of pairs, so A~B and B~C show together. */
function groupPairs(pairs: DuplicatePair[]): DuplicatePair[][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) as string
    return r
  }
  for (const p of pairs) for (const id of [p.a.id, p.b.id]) if (!parent.has(id)) parent.set(id, id)
  for (const p of pairs) parent.set(find(p.a.id), find(p.b.id))
  const groups = new Map<string, DuplicatePair[]>()
  for (const p of pairs) {
    const r = find(p.a.id)
    groups.set(r, [...(groups.get(r) ?? []), p])
  }
  return [...groups.values()]
}

/** Everyone in a connected group, once each. */
function groupPeople(g: DuplicatePair[]): PersonFull[] {
  const seen = new Map<string, PersonFull>()
  for (const p of g) for (const x of [p.a, p.b]) if (!seen.has(x.id)) seen.set(x.id, x)
  return [...seen.values()]
}

const foot = 'flex flex-wrap items-center gap-1.5'

export function DuplicatesPane({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const dupes = useDuplicates()
  const dismiss = useDismissDuplicate()
  const [merging, setMerging] = useState<DuplicatePair | null>(null)
  const [mergingGroup, setMergingGroup] = useState<PersonFull[] | null>(null)
  const groups = useMemo(() => groupPairs(dupes.data ?? []), [dupes.data])
  return (
    <section className={detailPane()} aria-label="Merge duplicates">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="invisible max-md:visible" onClick={onBack}>
          <Icon name="chevronLeft" size={14} />
          Back
        </Button>
        <span className="flex-1" />
      </div>
      <header>
        <h2 className="mb-1 text-lg font-semibold tracking-[-0.01em]">Merge duplicates</h2>
        <p className="text-sm text-muted">
          Contacts that share an email, phone, profile or name. Merging keeps one record: emails, phones, addresses, profiles, tags,
          interactions and relationships are combined.
        </p>
      </header>
      <QueryView
        query={dupes}
        skeleton={<SkeletonRows rows={4} avatar />}
        isEmpty={() => !groups.length}
        empty={
          <div className="grid content-center justify-items-center gap-3 px-4 py-12 text-center text-sm text-muted">
            <Icon name="check" size={28} />
            <p>No likely duplicates. Nice and tidy.</p>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="text-xs text-muted">
              {plural(data.length, 'possible duplicate')}
              {groups.length !== data.length ? ` in ${plural(groups.length, 'group')}` : ''}
            </p>
            <ul className="grid gap-3">
              {groups.map((g) => (
                <li key={g[0].a.id + g[0].b.id} className="overflow-hidden rounded-md border border-border bg-surface">
                  {g.length > 1 && (
                    <div className={foot}>
                      <span className="min-w-0 flex-auto text-xs text-muted">
                        {plural(groupPeople(g).length, 'record')} that look like the same person
                      </span>
                      <Button size="sm" onClick={() => setMergingGroup(groupPeople(g))}>
                        Merge all into one…
                      </Button>
                    </div>
                  )}
                  {g.map((pair, i) => (
                    <div key={pair.a.id + pair.b.id} className={cn('grid gap-2 p-3', i > 0 && 'border-t border-border')}>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 max-md:grid-cols-1">
                        <PersonCell p={pair.a} onOpen={onOpen} />
                        <Icon name="link" size={14} className="text-muted max-md:hidden" />
                        <PersonCell p={pair.b} onOpen={onOpen} />
                      </div>
                      <div className={foot}>
                        <div className="flex min-w-0 flex-auto flex-wrap gap-1">
                          {pair.reasons.map((r) => (
                            <Chip key={r}>{r}</Chip>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          disabled={dismiss.isPending}
                          onClick={() =>
                            dismiss.mutate(
                              { a_id: pair.a.id, b_id: pair.b.id },
                              { onSuccess: () => toast.show('Marked as different people') },
                            )
                          }
                        >
                          Not duplicates
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => setMerging(pair)}>
                          Merge…
                        </Button>
                      </div>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </QueryView>
      {merging && <MergeDialog pair={merging} onClose={() => setMerging(null)} />}
      {mergingGroup && <MergeManyDialog people={mergingGroup} onClose={() => setMergingGroup(null)} onMerged={(p) => onOpen(p.id)} />}
    </section>
  )
}

function PersonCell({ p, onOpen }: { p: PersonFull; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-2.5 rounded-sm border-0 bg-transparent px-1.5 py-1 text-left text-fg hover:bg-hover"
      onClick={() => onOpen(p.id)}
      title="Open contact"
    >
      <Avatar name={p.name} src={avatarSrc(p)} size={2} />
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">{p.name || 'Unnamed'}</span>
        <span className="truncate text-xs text-muted">{[p.email, p.phone, p.company].filter(Boolean).join(' · ') || 'No details'}</span>
      </span>
    </button>
  )
}
