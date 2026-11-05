// Merge duplicates: suggested pairs (grouped when several records look like the same person), a merge
// dialog that picks the kept record and the value per conflicting field, and "Not duplicates".
import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Avatar, Dialog, ErrorBox, SkeletonRows } from '../../components/ui'
import { toast } from '../../components/toast'
import { avatarSrc, useContactMeta, useDismissDuplicate, useDuplicates, useMerge, useMergeMany, type DuplicatePair, type PersonBrief, type PersonDetail, type PersonFull } from './api'
import { fmtBirthday, kitLabel, plural } from './util'

type Side = 'a' | 'b'
interface FieldDef { key: string; label: string; value: (p: PersonFull) => string; render?: (p: PersonFull) => ReactNode }

const text = (k: keyof PersonFull) => (p: PersonFull) => String(p[k] ?? '')
const FIELDS: FieldDef[] = [
  { key: 'first_name', label: 'First name', value: text('first_name') },
  { key: 'middle_name', label: 'Middle name', value: text('middle_name') },
  { key: 'last_name', label: 'Last name', value: text('last_name') },
  { key: 'prefix', label: 'Prefix', value: text('prefix') },
  { key: 'suffix', label: 'Suffix', value: text('suffix') },
  { key: 'nickname', label: 'Nickname', value: text('nickname') },
  { key: 'display_name', label: 'Display name', value: text('display_name') },
  { key: 'company', label: 'Company', value: text('company') },
  { key: 'title', label: 'Title', value: text('title') },
  { key: 'department', label: 'Department', value: text('department') },
  { key: 'birthday', label: 'Birthday', value: text('birthday'), render: (p) => (p.birthday ? fmtBirthday(p.birthday) : '') },
  { key: 'anniversary', label: 'Anniversary', value: (p) => p.anniversary ?? '', render: (p) => (p.anniversary ? fmtBirthday(p.anniversary) : '') },
  { key: 'keep_in_touch_days', label: 'Keep in touch', value: (p) => (p.keep_in_touch_days ? String(p.keep_in_touch_days) : ''), render: (p) => (p.keep_in_touch_days ? kitLabel(p.keep_in_touch_days) : '') },
  { key: 'user', label: 'Linked account', value: (p) => p.linked_user?.username ?? '', render: (p) => (p.linked_user ? `${p.linked_user.name} (@${p.linked_user.username})` : '') },
  { key: 'how_met', label: 'How we met', value: text('how_met') },
  { key: 'notes', label: 'Notes', value: text('notes') },
]
const AVATAR: FieldDef = { key: 'avatar', label: 'Photo', value: (p) => (p.has_avatar ? p.id : ''), render: (p) => <Avatar name={p.name} src={avatarSrc(p)} size={2.5} /> }

/** Connected groups of pairs, so A~B and B~C show together. */
function groupPairs(pairs: DuplicatePair[]): DuplicatePair[][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!
    return x
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

export function DuplicatesPane({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const dupes = useDuplicates()
  const dismiss = useDismissDuplicate()
  const [merging, setMerging] = useState<DuplicatePair | null>(null)
  const [mergingGroup, setMergingGroup] = useState<PersonFull[] | null>(null)
  const groups = useMemo(() => groupPairs(dupes.data ?? []), [dupes.data])
  return (
    <section className="c-detail c-dupes" aria-label="Merge duplicates">
      <div className="c-detail-bar">
        <button className="btn ghost sm" onClick={onBack}><Icon name="chevronLeft" size={14} />Back</button>
        <span className="spacer" />
      </div>
      <header>
        <h2 className="c-view-title">Merge duplicates</h2>
        <p className="muted small">Contacts that share an email, phone, profile or name. Merging keeps one record: emails, phones, addresses, profiles, tags, interactions and relationships are combined.</p>
      </header>
      {dupes.isPending ? <SkeletonRows rows={4} avatar /> : dupes.error ? <ErrorBox error={dupes.error} retry={() => dupes.refetch()} /> : !groups.length ? (
        <div className="c-empty"><Icon name="check" size={28} /><p>No likely duplicates. Nice and tidy.</p></div>
      ) : (
        <>
          <p className="muted xsmall">{plural(dupes.data!.length, 'possible duplicate')}{groups.length !== dupes.data!.length ? ` in ${plural(groups.length, 'group')}` : ''}</p>
          <ul className="c-dupe-list">
            {groups.map((g) => (
              <li key={g[0].a.id + g[0].b.id} className="c-dupe-group">
                {g.length > 1 && (
                  <div className="c-dupe-foot">
                    <span className="muted xsmall grow">{plural(groupPeople(g).length, 'record')} that look like the same person</span>
                    <button className="btn sm" onClick={() => setMergingGroup(groupPeople(g))}>Merge all into one…</button>
                  </div>
                )}
                {g.map((pair) => (
                  <div key={pair.a.id + pair.b.id} className="c-dupe">
                    <div className="c-dupe-people">
                      <PersonCell p={pair.a} onOpen={onOpen} />
                      <Icon name="link" size={14} className="muted c-dupe-join" />
                      <PersonCell p={pair.b} onOpen={onOpen} />
                    </div>
                    <div className="c-dupe-foot">
                      <div className="c-chips grow">{pair.reasons.map((r) => <span key={r} className="chip">{r}</span>)}</div>
                      <button className="btn sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate({ a_id: pair.a.id, b_id: pair.b.id }, { onSuccess: () => toast.show('Marked as different people') })}>Not duplicates</button>
                      <button className="btn primary sm" onClick={() => setMerging(pair)}>Merge…</button>
                    </div>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {merging && <MergeDialog pair={merging} onClose={() => setMerging(null)} />}
      {mergingGroup && <MergeManyDialog people={mergingGroup} onClose={() => setMergingGroup(null)} onMerged={(p) => onOpen(p.id)} />}
    </section>
  )
}

/** Everyone in a connected group, once each. */
function groupPeople(g: DuplicatePair[]): PersonFull[] {
  const seen = new Map<string, PersonFull>()
  for (const p of g) for (const x of [p.a, p.b]) if (!seen.has(x.id)) seen.set(x.id, x)
  return [...seen.values()]
}

type Mergeable = Pick<PersonBrief, 'id' | 'name' | 'email' | 'phone' | 'company' | 'has_avatar'> & { updated_on?: string }

/** Merge several records into one: pick the record to keep; the others are folded in one by one. */
export function MergeManyDialog({ people, onClose, onMerged }: { people: Mergeable[]; onClose: () => void; onMerged?: (p: PersonDetail) => void }) {
  const qc = useQueryClient()
  const mergeMany = useMergeMany()
  // Default: the most recently updated record (when known), else the first.
  const [keep, setKeep] = useState(() => [...people].sort((a, b) => (b.updated_on ?? '').localeCompare(a.updated_on ?? ''))[0].id)
  const others = people.filter((p) => p.id !== keep).map((p) => p.id)
  const submit = () => mergeMany.mutate({ keep, others }, {
    onSuccess: (p) => {
      const gone = new Set(others)
      qc.setQueryData<DuplicatePair[]>(['contacts', 'duplicates'], (old) => old?.filter((d) => !gone.has(d.a.id) && !gone.has(d.b.id)))
      toast.show(`Merged ${plural(people.length, 'contact')} into ${p.name || 'one'}`)
      onClose()
      onMerged?.(p)
    },
  })
  return (
    <Dialog open onClose={onClose} title={`Merge ${plural(people.length, 'contact')}`} width="32rem"
      footer={<><span className="muted xsmall grow">The other records are deleted after merging.</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={mergeMany.isPending} onClick={submit}>{mergeMany.isPending ? 'Merging…' : 'Merge'}</button></>}>
      <p className="muted small">Keep one record. Where both have a value, the kept record's value wins; empty fields are filled in from the others. Emails, phones, addresses, profiles, tags, interactions and relationships are combined.</p>
      <ul className="c-pick" role="radiogroup" aria-label="Record to keep">
        {people.map((p) => (
          <li key={p.id}>
            <label className={keep === p.id ? 'on' : ''}>
              <input type="radio" name="c-merge-many" checked={keep === p.id} onChange={() => setKeep(p.id)} />
              <Avatar name={p.name} src={avatarSrc(p)} size={1.75} />
              <span className="c-row-main">
                <span className="c-name truncate">{p.name || 'Unnamed'}</span>
                <span className="muted xsmall truncate">{keep === p.id ? 'Kept' : [p.email, p.phone, p.company].filter(Boolean).join(' · ') || 'Merged in, then deleted'}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

function PersonCell({ p, onOpen }: { p: PersonFull; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="c-dupe-person" onClick={() => onOpen(p.id)} title="Open contact">
      <Avatar name={p.name} src={avatarSrc(p)} size={2} />
      <span className="c-row-main">
        <span className="c-name truncate">{p.name || 'Unnamed'}</span>
        <span className="muted xsmall truncate">{[p.email, p.phone, p.company].filter(Boolean).join(' · ') || 'No details'}</span>
      </span>
    </button>
  )
}

function MergeDialog({ pair, onClose }: { pair: DuplicatePair; onClose: () => void }) {
  const qc = useQueryClient()
  const merge = useMerge()
  const networks = useContactMeta().data?.networks ?? []
  const [keep, setKeep] = useState<Side>(() => (pair.b.updated_on > pair.a.updated_on ? 'b' : 'a'))
  const [picked, setPicked] = useState<Record<string, Side>>({})
  const people = { a: pair.a, b: pair.b }
  const other: Side = keep === 'a' ? 'b' : 'a'

  const fields = useMemo(() => {
    const out: FieldDef[] = FIELDS.filter((f) => f.value(pair.a) !== f.value(pair.b))
    if (pair.a.has_avatar && pair.b.has_avatar) out.push(AVATAR)
    const nets = new Set([...Object.keys(pair.a.profiles), ...Object.keys(pair.b.profiles)])
    for (const net of nets) {
      const [ha, hb] = [pair.a.profiles[net], pair.b.profiles[net]]
      if (ha && hb && ha !== hb) out.push({ key: `profile:${net}`, label: networks.find((n) => n.key === net)?.label ?? net, value: (p) => p.profiles[net] ?? '' })
    }
    return out
  }, [pair, networks])
  // Default: the kept record's value, unless it's empty.
  const choice = (f: FieldDef): Side => picked[f.key] ?? (f.value(people[keep]) ? keep : other)

  const union = <T,>(get: (p: PersonFull) => T[], key: (x: T) => string) => {
    const seen = new Set<string>()
    return [...get(people[keep]), ...get(people[other])].filter((x) => { const k = key(x).toLowerCase(); return !seen.has(k) && !!seen.add(k) })
  }
  const emails = union((p) => p.emails, (e) => e.value)
  const phones = union((p) => p.phones, (e) => e.value.replace(/[^\d+]/g, ''))
  const tags = union((p) => [...p.groups, ...p.tags], (t) => t)

  const submit = () => {
    const body: Record<string, 'keep' | 'other'> = {}
    for (const f of fields) body[f.key] = choice(f) === keep ? 'keep' : 'other'
    const keepId = people[keep].id
    const goneId = people[other].id
    merge.mutate({ keep_id: keepId, other_id: goneId, fields: body }, {
      onSuccess: (p) => {
        qc.setQueryData<DuplicatePair[]>(['contacts', 'duplicates'], (old) => old?.filter((d) => d.a.id !== goneId && d.b.id !== goneId))
        toast.show(`Merged into ${p.name || 'contact'}`)
        onClose()
      },
    })
  }

  return (
    <Dialog open onClose={onClose} title="Merge contacts" width="44rem"
      footer={<><span className="muted xsmall grow">The other record is deleted after merging.</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={merge.isPending} onClick={submit}>{merge.isPending ? 'Merging…' : 'Merge'}</button></>}>
      <div className="c-merge" role="table" aria-label="Choose values">
        <div className="c-merge-row c-merge-head" role="row">
          <span role="columnheader" className="c-merge-k">Keep record</span>
          {(['a', 'b'] as Side[]).map((s) => (
            <label key={s} role="columnheader" className={'c-merge-opt c-merge-person' + (keep === s ? ' on' : '')}>
              <input type="radio" name="c-merge-keep" checked={keep === s} onChange={() => setKeep(s)} />
              <Avatar name={people[s].name} src={avatarSrc(people[s])} size={1.75} />
              <span className="c-row-main"><span className="c-name truncate">{people[s].name || 'Unnamed'}</span><span className="muted xsmall">{keep === s ? 'Kept' : 'Merged in, then deleted'}</span></span>
            </label>
          ))}
        </div>
        {fields.map((f) => (
          <div key={f.key} className="c-merge-row" role="row">
            <span role="rowheader" className="c-merge-k">{f.label}</span>
            {(['a', 'b'] as Side[]).map((s) => {
              const v = f.render ? f.render(people[s]) : f.value(people[s])
              return (
                <label key={s} role="cell" className={'c-merge-opt' + (choice(f) === s ? ' on' : '')}>
                  <input type="radio" name={`c-merge-${f.key}`} checked={choice(f) === s} onChange={() => setPicked((x) => ({ ...x, [f.key]: s }))} />
                  <span className="c-merge-v">{v === '' || v == null ? <span className="muted">Empty</span> : v}</span>
                </label>
              )
            })}
          </div>
        ))}
        {!fields.length && <p className="muted small">No conflicting fields: everything is combined.</p>}
      </div>
      {(emails.length > 0 || phones.length > 0 || tags.length > 0) && (
        <div className="c-block">
          <div className="detail-section-label">Combined automatically</div>
          <div className="c-chips">
            {emails.map((e) => <span key={'e' + e.value} className="chip"><Icon name="mail" size={11} />{e.value}</span>)}
            {phones.map((p) => <span key={'p' + p.value} className="chip"><Icon name="phone" size={11} />{p.value}</span>)}
            {tags.map((t) => <span key={'t' + t} className="chip">{t}</span>)}
          </div>
          <p className="muted xsmall">Plus addresses, links, custom fields, profiles, interactions and relationships from both.</p>
        </div>
      )}
    </Dialog>
  )
}
