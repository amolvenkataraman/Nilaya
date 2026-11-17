// Merging contacts. MergeDialog: two records side by side, pick the one to keep and the value of every field
// where they differ; lists (emails, phones, tags…) are combined. MergeManyDialog: several records into one,
// keeping one record's values where both have them.
import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Avatar, Button, Dialog } from '../../components/ui'
import { cn } from '../../lib/cn'
import { plural } from '../../lib/format'
import {
  avatarSrc,
  contactKeys,
  useContactMeta,
  useMerge,
  useMergeMany,
  type DuplicatePair,
  type PersonBrief,
  type PersonDetail,
  type PersonFull,
} from './api'
import { Chip } from './Chip'
import { fmtBirthday, kitLabel } from './personFields'
import { SectionLabel } from './SectionLabel'

type Side = 'a' | 'b'
interface FieldDef {
  key: string
  label: string
  value: (p: PersonFull) => string
  render?: (p: PersonFull) => ReactNode
}

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
  {
    key: 'anniversary',
    label: 'Anniversary',
    value: (p) => p.anniversary ?? '',
    render: (p) => (p.anniversary ? fmtBirthday(p.anniversary) : ''),
  },
  {
    key: 'keep_in_touch_days',
    label: 'Keep in touch',
    value: (p) => (p.keep_in_touch_days ? String(p.keep_in_touch_days) : ''),
    render: (p) => (p.keep_in_touch_days ? kitLabel(p.keep_in_touch_days) : ''),
  },
  {
    key: 'user',
    label: 'Linked account',
    value: (p) => p.linked_user?.username ?? '',
    render: (p) => (p.linked_user ? `${p.linked_user.name} (@${p.linked_user.username})` : ''),
  },
  { key: 'how_met', label: 'How we met', value: text('how_met') },
  { key: 'notes', label: 'Notes', value: text('notes') },
]
const AVATAR: FieldDef = {
  key: 'avatar',
  label: 'Photo',
  value: (p) => (p.has_avatar ? p.id : ''),
  render: (p) => <Avatar name={p.name} src={avatarSrc(p)} size={2.5} />,
}

const nameLine = 'flex min-w-0 items-center gap-1 truncate text-sm font-medium'

type Mergeable = Pick<PersonBrief, 'id' | 'name' | 'email' | 'phone' | 'company' | 'has_avatar'> & { updated_on?: string }

/** Merge several records into one: pick the record to keep; the others are folded in one by one. */
export function MergeManyDialog({
  people,
  onClose,
  onMerged,
}: {
  people: Mergeable[]
  onClose: () => void
  onMerged?: (p: PersonDetail) => void
}) {
  const qc = useQueryClient()
  const mergeMany = useMergeMany()
  // Default: the most recently updated record (when known), else the first.
  const [keep, setKeep] = useState(() => [...people].sort((a, b) => (b.updated_on ?? '').localeCompare(a.updated_on ?? ''))[0].id)
  const others = people.filter((p) => p.id !== keep).map((p) => p.id)
  const submit = () =>
    mergeMany.mutate(
      { keep, others },
      {
        onSuccess: (p) => {
          const gone = new Set(others)
          qc.setQueryData<DuplicatePair[]>(contactKeys.duplicates, (old) => old?.filter((d) => !gone.has(d.a.id) && !gone.has(d.b.id)))
          toast.show(`Merged ${plural(people.length, 'contact')} into ${p.name || 'one'}`)
          onClose()
          onMerged?.(p)
        },
      },
    )
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Merge ${plural(people.length, 'contact')}`}
      width="32rem"
      footer={
        <>
          <span className="min-w-0 flex-auto text-xs text-muted">The other records are deleted after merging.</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={mergeMany.isPending} onClick={submit}>
            {mergeMany.isPending ? 'Merging…' : 'Merge'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Keep one record. Where both have a value, the kept record's value wins; empty fields are filled in from the others. Emails, phones,
        addresses, profiles, tags, interactions and relationships are combined.
      </p>
      <div className="grid gap-1" role="radiogroup" aria-label="Record to keep">
        {people.map((p) => (
          <label
            key={p.id}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-sm border px-2 py-1.5',
              keep === p.id ? 'border-accent bg-accent-soft' : 'border-border',
            )}
          >
            <input type="radio" className="flex-none" name="c-merge-many" checked={keep === p.id} onChange={() => setKeep(p.id)} />
            <Avatar name={p.name} src={avatarSrc(p)} size={1.75} />
            <span className="grid min-w-0 flex-1">
              <span className={nameLine}>{p.name || 'Unnamed'}</span>
              <span className="truncate text-xs text-muted">
                {keep === p.id ? 'Kept' : [p.email, p.phone, p.company].filter(Boolean).join(' · ') || 'Merged in, then deleted'}
              </span>
            </span>
          </label>
        ))}
      </div>
    </Dialog>
  )
}

// `sticky` isn't generated (an older stylesheet owns that class name, see tailwind.css), hence sticky.
const mergeRow =
  'grid grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] items-start gap-2 border-b border-border py-1.5 max-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
const mergeKey = 'pt-1.5 text-xs text-muted max-md:col-span-full max-md:pt-0'
const option = (on: boolean) =>
  cn(
    'flex min-w-0 cursor-pointer gap-2 rounded-sm border px-2 py-1.25 text-sm',
    on ? 'border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] bg-accent-soft' : 'border-transparent hover:bg-hover',
  )

export function MergeDialog({ pair, onClose }: { pair: DuplicatePair; onClose: () => void }) {
  const qc = useQueryClient()
  const merge = useMerge()
  const networks = useContactMeta().data?.networks
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
      if (ha && hb && ha !== hb)
        out.push({ key: `profile:${net}`, label: networks?.find((n) => n.key === net)?.label ?? net, value: (p) => p.profiles[net] ?? '' })
    }
    return out
  }, [pair, networks])
  // Default: the kept record's value, unless it's empty.
  const choice = (f: FieldDef): Side => picked[f.key] ?? (f.value(people[keep]) ? keep : other)

  const union = <T,>(get: (p: PersonFull) => T[], key: (x: T) => string) => {
    const seen = new Set<string>()
    return [...get(people[keep]), ...get(people[other])].filter((x) => {
      const k = key(x).toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  const emails = union(
    (p) => p.emails,
    (e) => e.value,
  )
  const phones = union(
    (p) => p.phones,
    (e) => e.value.replace(/[^\d+]/g, ''),
  )
  const tags = union(
    (p) => [...p.groups, ...p.tags],
    (t) => t,
  )

  const submit = () => {
    const body: Record<string, 'keep' | 'other'> = {}
    for (const f of fields) body[f.key] = choice(f) === keep ? 'keep' : 'other'
    const goneId = people[other].id
    merge.mutate(
      { keep_id: people[keep].id, other_id: goneId, fields: body },
      {
        onSuccess: (p) => {
          qc.setQueryData<DuplicatePair[]>(contactKeys.duplicates, (old) => old?.filter((d) => d.a.id !== goneId && d.b.id !== goneId))
          toast.show(`Merged into ${p.name || 'contact'}`)
          onClose()
        },
      },
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Merge contacts"
      width="44rem"
      footer={
        <>
          <span className="min-w-0 flex-auto text-xs text-muted">The other record is deleted after merging.</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={merge.isPending} onClick={submit}>
            {merge.isPending ? 'Merging…' : 'Merge'}
          </Button>
        </>
      }
    >
      {/* One row per choice: the radios of a row share a name, and each describes itself with the row's label. */}
      <div className="grid border-t border-border">
        <div className={cn(mergeRow, 'sticky -top-2 z-1 items-center bg-surface')}>
          <span id="c-merge-k-keep" className={mergeKey}>
            Keep record
          </span>
          {(['a', 'b'] as Side[]).map((s) => (
            <label key={s} className={cn(option(keep === s), 'items-center')}>
              <input
                type="radio"
                className="flex-none"
                name="c-merge-keep"
                aria-describedby="c-merge-k-keep"
                checked={keep === s}
                onChange={() => setKeep(s)}
              />
              <Avatar name={people[s].name} src={avatarSrc(people[s])} size={1.75} />
              <span className="grid min-w-0 flex-1">
                <span className={nameLine}>{people[s].name || 'Unnamed'}</span>
                <span className="text-xs text-muted">{keep === s ? 'Kept' : 'Merged in, then deleted'}</span>
              </span>
            </label>
          ))}
        </div>
        {fields.map((f) => (
          <div key={f.key} className={mergeRow}>
            <span id={`c-merge-k-${f.key}`} className={mergeKey}>
              {f.label}
            </span>
            {(['a', 'b'] as Side[]).map((s) => {
              const v = f.render ? f.render(people[s]) : f.value(people[s])
              return (
                <label key={s} className={cn(option(choice(f) === s), 'items-start')}>
                  <input
                    type="radio"
                    className="mt-0.75 flex-none"
                    name={`c-merge-${f.key}`}
                    aria-describedby={`c-merge-k-${f.key}`}
                    checked={choice(f) === s}
                    onChange={() => setPicked((x) => ({ ...x, [f.key]: s }))}
                  />
                  <span className="line-clamp-4 min-w-0 whitespace-pre-wrap wrap-anywhere">
                    {v === '' || v == null ? <span className="text-muted">Empty</span> : v}
                  </span>
                </label>
              )
            })}
          </div>
        ))}
        {!fields.length && <p className="text-sm text-muted">No conflicting fields: everything is combined.</p>}
      </div>
      {(emails.length > 0 || phones.length > 0 || tags.length > 0) && (
        <div className="grid gap-2">
          <SectionLabel>Combined automatically</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {emails.map((e) => (
              <Chip key={'e' + e.value}>
                <Icon name="mail" size={11} />
                {e.value}
              </Chip>
            ))}
            {phones.map((p) => (
              <Chip key={'p' + p.value}>
                <Icon name="phone" size={11} />
                {p.value}
              </Chip>
            ))}
            {tags.map((t) => (
              <Chip key={'t' + t}>{t}</Chip>
            ))}
          </div>
          <p className="text-xs text-muted">Plus addresses, links, custom fields, profiles, interactions and relationships from both.</p>
        </div>
      )}
    </Dialog>
  )
}
