// Contacts: people list with smart filters and tags, a detail pane (?person=<id>) with contact
// info, interactions ("last talked") and relationships, and a create/edit dialog.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Avatar, Confirm, Dialog, ErrorBox, Menu, MenuItem, SkeletonRows, useDebounced, useMediaQuery } from '../../components/ui'
import { toast } from '../../components/toast'
import { safeHref } from '../../lib/api'
import { fmtDate, parseDayKey, shortStamp } from '../../lib/dates'
import {
  useContactStats, useContactTags, useDeleteInteraction, useDeletePerson, useInteractionKinds, useLogInteraction, usePeople,
  usePerson, useSavePerson, type ContactStats, type Filter, type PersonBrief, type PersonDetail, type PersonIn,
} from './api'
import './contacts.css'

const FILTERS: { id: Filter; label: string; icon: string; count?: string }[] = [
  { id: '', label: 'All contacts', icon: 'users', count: 'total' },
  { id: 'favorites', label: 'Favourites', icon: 'star', count: 'favorites' },
  { id: 'overdue', label: 'Reach out', icon: 'clock', count: 'overdue' },
  { id: 'kit', label: 'Keeping in touch', icon: 'repeat', count: 'keep_in_touch' },
  { id: 'recent', label: 'Recently added', icon: 'sparkle', count: 'recent' },
  { id: 'birthdays', label: 'Birthdays', icon: 'calendar', count: 'birthdays_this_month' },
]
const KIT = [[0, 'Off'], [7, 'Every week'], [14, 'Every 2 weeks'], [30, 'Every month'], [90, 'Every 3 months'], [180, 'Every 6 months'], [365, 'Every year']] as const

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
const telHref = (v: string) => (/^[+\d][\d\s().-]{2,}$/.test(v) ? 'tel:' + v.replace(/[^\d+]/g, '') : null)
const avatarSrc = (p: PersonBrief) => (p.has_avatar ? `/api/v2/contacts/${p.id}/avatar` : null)

export default function ContactsPage() {
  const [search, setSearch] = useSearchParams()
  const filter = (search.get('filter') ?? '') as Filter
  const tag = search.get('tag') ?? ''
  const personId = search.get('person')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 250)
  const people = usePeople({ q: dq || undefined, filter: filter || undefined, tag: tag || undefined, sort: filter === 'overdue' ? 'due' : 'name' })
  const stats = useContactStats().data
  const tags = useContactTags().data
  const [editing, setEditing] = useState<PersonDetail | 'new' | null>(null)
  const phone = useMediaQuery('(max-width: 760px)')

  useEffect(() => {
    if (search.get('new') === '1') setEditing('new')
  }, [search])

  const go = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(search)
    for (const [k, v] of Object.entries(change)) v ? next.set(k, v) : next.delete(k)
    next.delete('new')
    setSearch(next)
  }
  const groups = useMemo(() => {
    const out: { letter: string; items: PersonBrief[] }[] = []
    for (const p of people.data?.items ?? []) {
      const letter = filter === 'overdue' ? 'Due' : (p.name || '#').slice(0, 1).toUpperCase().replace(/[^A-Z]/, '#')
      if (!out.length || out[out.length - 1].letter !== letter) out.push({ letter, items: [] })
      out[out.length - 1].items.push(p)
    }
    return out
  }, [people.data, filter])

  const sidebar = (
    <>
      <SideSection>
        {FILTERS.map((f) => (
          <SideItem key={f.id} icon={f.icon} label={f.label} active={filter === f.id && !tag} count={stats && f.count ? (stats as unknown as Record<string, number>)[f.count] : undefined} onClick={() => go({ filter: f.id || null, tag: null, person: null })} />
        ))}
      </SideSection>
      <SideSection>
        <a className="side-item" href="/api/v2/contacts/export?format=vcf" download><Icon name="arrowUp" size={16} /><span className="grow">Export all (vCard)</span></a>
        <a className="side-item" href="/api/v2/contacts/export?format=csv" download><Icon name="arrowUp" size={16} /><span className="grow">Export all (CSV)</span></a>
      </SideSection>
      <SideSection title="Tags">
        {!tags?.length && <div className="side-empty">No tags yet.</div>}
        {tags?.map((t) => <SideItem key={t.id} icon="tag" label={t.name} count={t.count} active={tag === t.name} onClick={() => go({ tag: t.name, filter: null, person: null })} />)}
      </SideSection>
    </>
  )
  const topbar = (
    <div className="row c-top">
      <label className="c-search">
        <Icon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" />
      </label>
      <button className="btn primary sm" onClick={() => setEditing('new')}><Icon name="plus" size={14} /><span className="c-hide-phone">New contact</span></button>
    </div>
  )
  const showList = !(phone && personId)

  return (
    <AppShell app="contacts" topbar={topbar} sidebar={sidebar} fullHeight>
      <div className={'c-layout' + (personId ? ' has-detail' : '')}>
        {showList && (
          <section className="c-list" aria-label="People">
            <div className="c-list-head">
              <h1>{tag ? `#${tag}` : FILTERS.find((f) => f.id === filter)?.label}</h1>
              {people.data && <span className="muted small tabular">{people.data.total}</span>}
            </div>
            {people.isPending ? <SkeletonRows rows={8} avatar /> : people.error && !people.data ? <ErrorBox error={people.error} /> : !people.data?.items.length ? (
              <div className="c-empty">
                <Icon name="users" size={28} />
                <p>{dq ? `Nobody matches "${dq}".` : filter || tag ? 'Nobody here yet.' : 'No contacts yet.'}</p>
                {!dq && !filter && !tag && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={14} />Add a contact</button>}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.letter} className="c-group">
                  <div className="c-letter">{g.letter}</div>
                  {g.items.map((p) => (
                    <button key={p.id} className={'c-row' + (p.id === personId ? ' active' : '')} onClick={() => go({ person: p.id })}>
                      <Avatar name={p.name} src={avatarSrc(p)} size={2} />
                      <span className="c-row-main">
                        <span className="c-name truncate">{p.name || 'Unnamed'}{p.favorite && <Icon name="star" size={12} className="c-fav" />}</span>
                        <span className="muted xsmall truncate">
                          {filter === 'overdue' || filter === 'kit' ? (p.next_due ? `Due ${fmtDate(parseDayKey(p.next_due))}` : 'No catch-up scheduled')
                            : filter === 'birthdays' && p.birthday ? `Birthday ${fmtBirthday(p.birthday)}`
                            : [p.title, p.company].filter(Boolean).join(' · ') || p.email || p.phone}
                        </span>
                      </span>
                      {p.profile_links.length > 0 && <span className="c-nets" title={p.profile_links.map((l) => `${l.label}: ${l.handle}`).join('\n')}><Icon name="link" size={12} />{p.profile_links.length}</span>}
                      {p.overdue && <span className="chip warning">Reach out</span>}
                    </button>
                  ))}
                </div>
              ))
            )}
          </section>
        )}
        {personId ? (
          <PersonPane id={personId} onClose={() => go({ person: null })} onEdit={setEditing} />
        ) : (
          <Overview stats={stats} onOpen={(id) => go({ person: id })} />
        )}
      </div>
      <PersonDialog open={editing !== null} person={editing === 'new' ? null : editing} onClose={() => (setEditing(null), search.get('new') && go({}))} onSaved={(p) => go({ person: p.id })} />
    </AppShell>
  )
}

function PersonPane({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (p: PersonDetail) => void }) {
  const person = usePerson(id)
  const save = useSavePerson()
  const remove = useDeletePerson()
  const [confirm, setConfirm] = useState(false)
  const p = person.data
  if (person.isPending) return <section className="c-detail"><SkeletonRows rows={6} /></section>
  if (person.error || !p) return <section className="c-detail"><ErrorBox error={person.error} /></section>
  const profiles = p.profile_links.map((l) => ({ ...l, href: safeHref(l.url) }))
  return (
    <section className="c-detail" aria-label={p.name}>
      <div className="c-detail-bar">
        <button className="btn ghost sm" onClick={onClose}><Icon name="chevronLeft" size={14} />Back</button>
        <span className="spacer" />
        <button className={'btn ghost icon sm' + (p.favorite ? ' fav-on' : '')} aria-pressed={p.favorite} aria-label="Favourite" onClick={() => save.mutate({ id: p.id, body: { favorite: !p.favorite } })}><Icon name="star" /></button>
        <button className="btn sm" onClick={() => onEdit(p)}><Icon name="edit" size={14} />Edit</button>
        <Menu align="end" label="Contact actions" trigger={(t) => <button {...t} className="btn ghost icon sm" aria-label="More actions"><Icon name="more" /></button>}>
          {(close) => <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete contact</MenuItem>}
        </Menu>
      </div>
      <header className="c-hero">
        <Avatar name={p.name} src={avatarSrc(p)} size={4} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h2>{p.name || 'Unnamed'}</h2>
          {(p.title || p.company || p.department) && <p className="muted small">{[p.title, p.company, p.department].filter(Boolean).join(' · ')}</p>}
          {p.nickname && <p className="muted xsmall">“{p.nickname}”</p>}
          <div className="c-chips">
            {p.groups.map((g) => <span key={'g' + g} className="chip"><Icon name="folder" size={11} />{g}</span>)}
            {p.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
            {p.overdue && <span className="chip warning">Time to reach out</span>}
          </div>
        </div>
      </header>

      <dl className="c-info">
        {p.emails.map((e, i) => (
          <div key={'e' + i}><dt><Icon name="mail" size={14} />{e.label || 'Email'}</dt><dd>{EMAIL_RE.test(e.value) ? <a href={'mailto:' + e.value}>{e.value}</a> : e.value}</dd></div>
        ))}
        {p.phones.map((ph, i) => {
          const href = telHref(ph.value)
          return <div key={'p' + i}><dt><Icon name="send" size={14} />{ph.label || 'Phone'}</dt><dd>{href ? <a href={href}>{ph.value}</a> : ph.value}</dd></div>
        })}
        {p.addresses.map((a, i) => (
          <div key={'a' + i}><dt><Icon name="pin" size={14} />{a.label || 'Address'}</dt><dd className="pre-wrap">{[a.street, [a.city, a.region, a.postcode].filter(Boolean).join(', '), a.country].filter(Boolean).join('\n')}</dd></div>
        ))}
        {p.birthday && <div><dt><Icon name="gift" size={14} />Birthday</dt><dd>{fmtBirthday(p.birthday)}</dd></div>}
        {p.anniversary && <div><dt><Icon name="heart" size={14} />Anniversary</dt><dd>{fmtBirthday(p.anniversary)}</dd></div>}
        {p.links.map((l, i) => {
          const href = safeHref(l.url)
          return <div key={'lk' + i}><dt><Icon name="link" size={14} />{l.label || 'Link'}</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{l.url}</a> : l.url}</dd></div>
        })}
        {p.custom_fields.map((f, i) => <div key={'cf' + i}><dt><Icon name="info" size={14} />{f.key}</dt><dd className="pre-wrap">{f.value}</dd></div>)}
        <div><dt><Icon name="clock" size={14} />Last in touch</dt><dd>{p.last_contacted ? fmtDate(parseDayKey(p.last_contacted)) : <span className="muted">No interactions logged</span>}
          {p.keep_in_touch_days && p.next_due ? <span className={p.overdue ? ' c-overdue' : ' muted'}> · {kitStatus(p.next_due)}</span> : null}</dd></div>
        {p.keep_in_touch_days ? (
          <div><dt><Icon name="repeat" size={14} />Keep in touch</dt><dd>{KIT.find(([d]) => d === p.keep_in_touch_days)?.[1] ?? `Every ${p.keep_in_touch_days} days`}{p.next_due && <span className="muted"> · next {fmtDate(parseDayKey(p.next_due))}</span>}</dd></div>
        ) : null}
        {p.how_met && <div><dt><Icon name="users" size={14} />How we met</dt><dd>{p.how_met}</dd></div>}
        {profiles.length > 0 && (
          <div><dt><Icon name="link" size={14} />Profiles</dt><dd className="c-chips">
            {profiles.map((l) => l.href ? <a key={l.network + l.handle} className="chip" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}<Icon name="external" size={11} /></a> : <span key={l.network + l.handle} className="chip">{l.label}: {l.handle}</span>)}
          </dd></div>
        )}
      </dl>
      {p.notes && <div className="c-block"><div className="detail-section-label">Notes</div><p className="pre-wrap small">{p.notes}</p></div>}
      {p.relationships.length > 0 && (
        <div className="c-block">
          <div className="detail-section-label">Relationships</div>
          <div className="c-chips">{p.relationships.map((r) => <span key={r.id} className="chip">{r.kind.replace(/_/g, ' ')}: {r.other_name}</span>)}</div>
        </div>
      )}
      <Interactions person={p} />
      <p className="muted xsmall c-foot">Added {shortStamp(p.created_on)} · updated {shortStamp(p.updated_on)}{p.sources.length ? ` · from ${p.sources.join(', ')}` : ''}</p>
      <Confirm open={confirm} title={`Delete ${p.name || 'this contact'}?`} body="Their interactions and relationships are deleted too." onConfirm={() => { onClose(); remove.mutate(p.id, { onSuccess: () => toast.show('Contact deleted') }) }} onClose={() => setConfirm(false)} />
    </section>
  )
}

function Interactions({ person }: { person: PersonDetail }) {
  const kinds = useInteractionKinds().data?.interaction_kinds ?? ['call', 'meeting', 'message', 'email', 'note']
  const log = useLogInteraction(person.id)
  const remove = useDeleteInteraction()
  const [kind, setKind] = useState('call')
  const [summary, setSummary] = useState('')
  const submit = () => summary.trim() && log.mutate({ kind, summary: summary.trim() }, { onSuccess: () => setSummary('') })
  return (
    <div className="c-block">
      <div className="detail-section-label">Interactions {person.last_contacted && <span className="muted">· last {fmtDate(parseDayKey(person.last_contacted))}</span>}</div>
      <form className="c-log" onSubmit={(e) => (e.preventDefault(), submit())}>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          {kinds.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
        </select>
        <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What did you talk about?" aria-label="Summary" maxLength={300} />
        <button className="btn primary sm" disabled={!summary.trim() || log.isPending}>Log</button>
      </form>
      <ol className="c-timeline">
        {person.interactions.map((i) => (
          <li key={i.id}>
            <span className="c-kind">{i.kind}</span>
            <span className="grow small">{i.summary}{i.notes && <span className="muted pre-wrap"> {i.notes}</span>}</span>
            <time className="muted xsmall tabular">{fmtDate(parseDayKey(i.date))}</time>
            <button className="btn ghost icon sm c-del" aria-label="Delete interaction" onClick={() => remove.mutate(i.id)}><Icon name="trash" size={12} /></button>
          </li>
        ))}
        {!person.interactions.length && <li className="muted small">No interactions logged yet.</li>}
      </ol>
    </div>
  )
}

function kitStatus(nextDue: string): string {
  const days = Math.round((parseDayKey(nextDue).getTime() - parseDayKey(new Date().toISOString().slice(0, 10)).getTime()) / 86_400_000)
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`
  if (days === 0) return 'Due today'
  return `Next catch-up in ${days} day${days === 1 ? '' : 's'}`
}

function Overview({ stats, onOpen }: { stats?: ContactStats; onOpen: (id: string) => void }) {
  if (!stats) return <section className="c-detail"><SkeletonRows rows={5} /></section>
  if (!stats.total) return <div className="c-placeholder"><Icon name="users" size={32} /><span>No contacts yet. Add one, or import from the classic Contacts page.</span></div>
  const bdays = stats.upcoming_birthdays ?? []
  const due = stats.overdue_people ?? []
  return (
    <section className="c-detail c-overview" aria-label="Overview">
      <div className="c-stats">
        <div><strong className="tabular">{stats.total}</strong><span>Contacts</span></div>
        <div><strong className="tabular">{stats.favorites}</strong><span>Favourites</span></div>
        <div><strong className="tabular">{stats.keep_in_touch}</strong><span>Keeping in touch</span></div>
        <div><strong className="tabular">{stats.recent}</strong><span>Added recently</span></div>
      </div>
      <div className="c-block">
        <div className="detail-section-label"><Icon name="gift" size={13} />Upcoming birthdays</div>
        {bdays.length === 0 ? <p className="muted small">None in the next 30 days.</p> : (
          <ul className="c-mini">
            {bdays.map((b) => (
              <li key={b.id}><button onClick={() => onOpen(b.id)}>
                <span className="grow truncate">{b.name}</span>
                <span className="muted xsmall">{b.days === 0 ? 'Today' : b.days === 1 ? 'Tomorrow' : fmtDate(parseDayKey(b.date), { weekday: 'short', month: 'short', day: 'numeric' })}{b.age ? ` · turns ${b.age}` : ''}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
      <div className="c-block">
        <div className="detail-section-label"><Icon name="clock" size={13} />Catch up</div>
        {due.length === 0 ? <p className="muted small">You're up to date with everyone.</p> : (
          <ul className="c-mini">
            {due.map((d) => (
              <li key={d.id}><button onClick={() => onOpen(d.id)}>
                <span className="grow truncate">{d.name}</span>
                <span className={d.days_overdue > 0 ? 'c-overdue xsmall' : 'muted xsmall'}>{d.days_overdue > 0 ? `${d.days_overdue} days overdue` : 'Due today'}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
      {stats.sources && Object.keys(stats.sources).length > 0 && (
        <p className="muted xsmall">Sources: {Object.entries(stats.sources).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
      )}
    </section>
  )
}

function fmtBirthday(b: string): string {
  const m = /^(\d{4}|-{1,2})-?(\d{2})-(\d{2})$/.exec(b)
  if (!m) return b
  const year = /^\d{4}$/.test(m[1]) ? Number(m[1]) : 2000
  const d = new Date(year, Number(m[2]) - 1, Number(m[3]))
  return fmtDate(d, /^\d{4}$/.test(m[1]) ? { month: 'long', day: 'numeric', year: 'numeric' } : { month: 'long', day: 'numeric' })
}

function PersonDialog({ open, person, onClose, onSaved }: { open: boolean; person: PersonDetail | null; onClose: () => void; onSaved: (p: PersonDetail) => void }) {
  const save = useSavePerson()
  const [f, setF] = useState({ first_name: '', last_name: '', company: '', title: '', email: '', phone: '', birthday: '', tags: '', kit: 0, how_met: '', notes: '' })
  useEffect(() => {
    if (!open) return
    setF({
      first_name: person?.first_name ?? '', last_name: person?.last_name ?? '', company: person?.company ?? '', title: person?.title ?? '',
      email: person?.emails[0]?.value ?? '', phone: person?.phones[0]?.value ?? '', birthday: /^\d{4}-\d{2}-\d{2}$/.test(person?.birthday ?? '') ? person!.birthday : '',
      tags: person?.tags.join(', ') ?? '', kit: person?.keep_in_touch_days ?? 0, how_met: person?.how_met ?? '', notes: person?.notes ?? '',
    })
  }, [open, person])
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }))
  const submit = () => {
    if (!f.first_name.trim() && !f.last_name.trim() && !f.company.trim()) return toast.error('Give the contact a name or company.')
    const keepRest = <T,>(list: T[] | undefined) => (list ?? []).slice(1)
    const body: PersonIn = {
      first_name: f.first_name.trim(), last_name: f.last_name.trim(), company: f.company.trim(), title: f.title.trim(),
      emails: [...(f.email.trim() ? [{ label: person?.emails[0]?.label ?? 'home', value: f.email.trim() }] : []), ...keepRest(person?.emails)],
      phones: [...(f.phone.trim() ? [{ label: person?.phones[0]?.label ?? 'mobile', value: f.phone.trim() }] : []), ...keepRest(person?.phones)],
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), keep_in_touch_days: f.kit || null, how_met: f.how_met, notes: f.notes,
      ...(f.birthday || !person?.birthday || /^\d{4}-\d{2}-\d{2}$/.test(person.birthday) ? { birthday: f.birthday } : {}),
    }
    save.mutate({ id: person?.id, body }, { onSuccess: (p) => (onClose(), onSaved(p), toast.show(person ? 'Saved' : 'Contact added')) })
  }
  return (
    <Dialog open={open} onClose={onClose} title={person ? 'Edit contact' : 'New contact'} width="34rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit} disabled={save.isPending}>{person ? 'Save' : 'Add contact'}</button></>}>
      <form className="stack" style={{ gap: '0.75rem' }} onSubmit={(e) => (e.preventDefault(), submit())}>
        <div className="field-row">
          <label className="field"><span>First name</span><input className="input" value={f.first_name} onChange={(e) => set('first_name', e.target.value)} autoFocus maxLength={100} /></label>
          <label className="field"><span>Last name</span><input className="input" value={f.last_name} onChange={(e) => set('last_name', e.target.value)} maxLength={100} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Company</span><input className="input" value={f.company} onChange={(e) => set('company', e.target.value)} maxLength={200} /></label>
          <label className="field"><span>Title</span><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={200} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Email</span><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={254} /></label>
          <label className="field"><span>Phone</span><input className="input" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={50} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Birthday</span><input className="input" type="date" value={f.birthday} onChange={(e) => set('birthday', e.target.value)} /></label>
          <label className="field"><span>Keep in touch</span>
            <select className="select" value={f.kit} onChange={(e) => set('kit', Number(e.target.value))}>
              {KIT.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
              {f.kit && !KIT.some(([d]) => d === f.kit) ? <option value={f.kit}>Every {f.kit} days</option> : null}
            </select>
          </label>
        </div>
        <label className="field"><span>Tags</span><input className="input" value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="family, work" maxLength={300} /></label>
        <label className="field"><span>How we met</span><input className="input" value={f.how_met} onChange={(e) => set('how_met', e.target.value)} maxLength={300} /></label>
        <label className="field"><span>Notes</span><textarea className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={10000} /></label>
        {person && (person.emails.length > 1 || person.phones.length > 1 || person.addresses.length > 0) && (
          <p className="help">Extra emails, phones and addresses are kept; edit them in the classic Contacts page.</p>
        )}
      </form>
    </Dialog>
  )
}
