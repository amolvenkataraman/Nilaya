// Contacts: people list with smart filters, groups and tags (multi-select for bulk export/delete), a
// detail pane (?person=<id>) with contact info, photo, interactions and relationships, the full edit
// form, the import wizard and the merge-duplicates view (?view=duplicates).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Avatar, Confirm, ErrorBox, Menu, MenuItem, SkeletonRows, isTyping, useDebounced, useMediaQuery } from '../../components/ui'
import { toast } from '../../components/toast'
import { safeHref } from '../../lib/api'
import { dayKey, fmtDate, parseDayKey, shortStamp } from '../../lib/dates'
import {
  AVATAR_MAX, avatarSrc, exportHref, useAvatar, useBulkDelete, useContactMeta, useContactStats, useContactTags, useDeleteInteraction,
  useDeletePerson, useDeleteTag, useLogInteraction, usePeople, usePeopleSearch, usePerson, useRelationships, useSavePerson, useUpdateInteraction,
  type ContactStats, type Filter, type Interaction, type PersonBrief, type PersonDetail, type Tag,
} from './api'
import { PersonForm } from './PersonForm'
import { ImportDialog } from './ImportDialog'
import { DuplicatesPane, MergeManyDialog } from './Duplicates'
import { ContactSettingsDialog, LabelsDialog } from './Manage'
import { KIT, afterG, cap, fmtBirthday, plural, relLabel } from './util'
import './contacts.css'

const FILTERS: { id: Filter; label: string; icon: string; count?: string }[] = [
  { id: '', label: 'All contacts', icon: 'users', count: 'total' },
  { id: 'favorites', label: 'Favourites', icon: 'star', count: 'favorites' },
  { id: 'overdue', label: 'Reach out', icon: 'clock', count: 'overdue' },
  { id: 'kit', label: 'Keeping in touch', icon: 'repeat', count: 'keep_in_touch' },
  { id: 'recent', label: 'Recently added', icon: 'sparkle', count: 'recent' },
  { id: 'birthdays', label: 'Birthdays', icon: 'calendar', count: 'birthdays_this_month' },
]

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
const telHref = (v: string) => (/^[+\d][\d\s().-]{2,}$/.test(v) ? 'tel:' + v.replace(/[^\d+]/g, '') : null)

export default function ContactsPage() {
  const [search, setSearch] = useSearchParams()
  const filter = (search.get('filter') ?? '') as Filter
  const tag = search.get('tag') ?? ''
  const group = search.get('group') ?? ''
  const personId = search.get('person')
  const view = search.get('view')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 250)
  const people = usePeople({ q: dq || undefined, filter: filter || undefined, tag: tag || undefined, group: group || undefined, sort: filter === 'overdue' ? 'due' : 'name' })
  const stats = useContactStats().data
  const tags = useContactTags().data
  const [editing, setEditing] = useState<PersonDetail | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const bulkDelete = useBulkDelete()
  const deleteTag = useDeleteTag()
  const phone = useMediaQuery('(max-width: 760px)')
  const qc = useQueryClient()
  const searchRef = useRef<HTMLInputElement>(null)
  const [labels, setLabels] = useState<{ edit: number | null } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mergingSel, setMergingSel] = useState<PersonBrief[] | null>(null)
  const [confirmTag, setConfirmTag] = useState<Tag | null>(null)

  useEffect(() => {
    if (search.get('new') === '1') setEditing('new')
  }, [search])
  // A selection belongs to the list it was made in.
  useEffect(() => setSelected(new Set()), [filter, tag, group, dq])

  const go = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(search)
    for (const [k, v] of Object.entries(change)) v ? next.set(k, v) : next.delete(k)
    next.delete('new')
    setSearch(next)
  }
  const items = people.data?.items
  const groups = useMemo(() => {
    const out: { letter: string; items: PersonBrief[] }[] = []
    for (const p of items ?? []) {
      const letter = filter === 'overdue' ? 'Due' : (p.name || '#').slice(0, 1).toUpperCase().replace(/[^A-Z]/, '#')
      if (!out.length || out[out.length - 1].letter !== letter) out.push({ letter, items: [] })
      out[out.length - 1].items.push(p)
    }
    return out
  }, [items, filter])
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s)
    if (!n.delete(id)) n.add(id)
    return n
  })
  const allSelected = !!items?.length && items.every((p) => selected.has(p.id))
  const ids = [...selected]
  const currentTag = tag ? tags?.find((t) => t.kind === 'tag' && t.name.toLowerCase() === tag.toLowerCase()) : group ? tags?.find((t) => t.kind === 'group' && t.name.toLowerCase() === group.toLowerCase()) : undefined
  // Letter headings only where the list is in name order (not search results, due dates, birthdays or newest first).
  const letters = !dq && (filter === '' || filter === 'favorites')
  const openLabel = (t: Tag) => (setLabels(null), go(t.kind === 'group' ? { group: t.name, tag: null, filter: null, person: null, view: null } : { tag: t.name, group: null, filter: null, person: null, view: null }))
  const labelRenamed = (t: Tag, name: string) => {
    if (t.kind === 'tag' && tag === t.name) go({ tag: name })
    if (t.kind === 'group' && group === t.name) go({ group: name })
  }
  const labelDeleted = (t: Tag) => {
    if ((t.kind === 'tag' && tag === t.name) || (t.kind === 'group' && group === t.name)) go({ tag: null, group: null })
  }

  // Keyboard (as in the classic page): / search, N new, J/K or arrows move, E edit, Esc clears search / closes on phones.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || afterG(e) || document.querySelector('.dialog,.menu,.palette')) return
    if (e.key === 'Escape' && e.target === searchRef.current) return (setQ(''), searchRef.current?.blur())
    if (isTyping(e)) return
    if (e.key === '/') {
      e.preventDefault()
      e.stopPropagation() // the contacts search, not the global palette (Ctrl+K still opens that)
      searchRef.current?.focus()
      searchRef.current?.select()
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault()
      setEditing('new')
    } else if ((e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && items?.length) {
      e.preventDefault()
      const d = e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1
      const i = items.findIndex((p) => p.id === personId)
      const next = i < 0 ? (d > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + d))
      go({ person: items[next].id, view: null })
    } else if (e.key === 'e' && personId) {
      const p = qc.getQueryData<PersonDetail>(['contacts', 'person', personId])
      if (p) (e.preventDefault(), setEditing(p))
    } else if (e.key === 'Escape' && phone && (personId || view)) {
      go({ person: null, view: null })
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', h, true) // capture: runs before the app-wide "/" shortcut
    return () => window.removeEventListener('keydown', h, true)
  }, [])
  useEffect(() => {
    if (personId) document.querySelector('.c-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [personId])

  const sidebar = (
    <>
      <SideSection>
        {FILTERS.map((f) => (
          <SideItem key={f.id} icon={f.icon} label={f.label} active={filter === f.id && !tag && !group && !view} count={stats && f.count ? (stats as unknown as Record<string, number>)[f.count] : undefined} onClick={() => go({ filter: f.id || null, tag: null, group: null, person: null, view: null })} />
        ))}
      </SideSection>
      {tags?.some((t) => t.kind === 'group') && (
        <SideSection title="Groups">
          {tags.filter((t) => t.kind === 'group').map((t) => <SideItem key={t.id} icon="folder" label={t.name} count={t.count} active={group === t.name && !view} onClick={() => go({ group: t.name, tag: null, filter: null, person: null, view: null })} />)}
        </SideSection>
      )}
      <SideSection title="Tags">
        {!tags?.some((t) => t.kind === 'tag') && <div className="side-empty">No tags yet.</div>}
        {tags?.filter((t) => t.kind === 'tag').map((t) => <SideItem key={t.id} icon="tag" label={t.name} count={t.count} active={tag === t.name && !view} onClick={() => go({ tag: t.name, group: null, filter: null, person: null, view: null })} />)}
      </SideSection>
      <SideSection title="Tools">
        <SideItem icon="arrowDown" label="Import…" onClick={() => setImporting(true)} />
        <SideItem icon="users" label="Merge duplicates" active={view === 'duplicates'} onClick={() => go({ view: 'duplicates', person: null })} />
        <a className="side-item" href={exportHref('vcf')} download><Icon name="arrowUp" size={16} /><span className="grow">Export all (vCard)</span></a>
        <a className="side-item" href={exportHref('csv')} download><Icon name="arrowUp" size={16} /><span className="grow">Export all (CSV)</span></a>
        <SideItem icon="tag" label="Tags and groups…" onClick={() => setLabels({ edit: null })} />
        <SideItem icon="bell" label="Reminders…" onClick={() => setSettingsOpen(true)} />
      </SideSection>
    </>
  )
  const topbar = (
    <div className="row c-top">
      <label className="c-search">
        <Icon name="search" size={14} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, company, tag" aria-label="Search people" maxLength={100} title="Search (/)" />
      </label>
      <button className="btn primary sm" onClick={() => setEditing('new')} title="New contact (N)"><Icon name="plus" size={14} /><span className="c-hide-phone">New contact</span></button>
    </div>
  )
  const showList = !(phone && (personId || view))
  const title = view === 'duplicates' && phone ? '' : tag ? `#${tag}` : group || FILTERS.find((f) => f.id === filter)?.label

  return (
    <AppShell app="contacts" topbar={topbar} sidebar={sidebar} fullHeight>
      <div className={'c-layout' + (personId ? ' has-detail' : '')}>
        {showList && (
          <section className={'c-list' + (selected.size ? ' selecting' : '')} aria-label="People">
            {selected.size > 0 ? (
              <div className="c-bulk" role="toolbar" aria-label="Selected contacts">
                <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = !allSelected }} aria-label={allSelected ? 'Clear selection' : 'Select all'} onChange={() => setSelected(allSelected ? new Set() : new Set(items?.map((p) => p.id)))} />
                <strong className="small tabular grow">{selected.size} selected</strong>
                <a className="btn ghost sm" href={exportHref('vcf', ids)} download title="Download as vCard">vCard</a>
                <a className="btn ghost sm" href={exportHref('csv', ids)} download title="Download as CSV">CSV</a>
                {selected.size > 1 && <button className="btn ghost sm" title="Merge into one contact" onClick={() => setMergingSel(items?.filter((p) => selected.has(p.id)) ?? [])}>Merge</button>}
                <button className="btn ghost icon sm danger" aria-label="Delete selected" title="Delete" onClick={() => setConfirmBulk(true)}><Icon name="trash" size={14} /></button>
                <button className="btn ghost icon sm" aria-label="Clear selection" title="Clear selection" onClick={() => setSelected(new Set())}><Icon name="x" size={14} /></button>
              </div>
            ) : (
              <div className="c-list-head">
                <h1 className="grow truncate">{title}</h1>
                {people.data && <span className="muted small tabular">{people.data.total}</span>}
                {currentTag && !view && (
                  <Menu align="end" label={`${currentTag.kind === 'group' ? 'Group' : 'Tag'} actions`} trigger={(t) => <button {...t} className="btn ghost icon sm" aria-label={`${currentTag.kind === 'group' ? 'Group' : 'Tag'} actions`}><Icon name="more" size={14} /></button>}>
                    {(close) => (
                      <>
                        <MenuItem icon="check" onClick={() => (close(), setSelected(new Set(items?.map((p) => p.id))))}>Select everyone</MenuItem>
                        <MenuItem icon="edit" onClick={() => (close(), setLabels({ edit: currentTag.id }))}>Rename {currentTag.kind}…</MenuItem>
                        <div className="menu-sep" />
                        <MenuItem icon="trash" danger onClick={() => (close(), setConfirmTag(currentTag))}>Delete {currentTag.kind}…</MenuItem>
                      </>
                    )}
                  </Menu>
                )}
              </div>
            )}
            {people.isPending ? <SkeletonRows rows={8} avatar /> : people.error && !people.data ? <ErrorBox error={people.error} /> : !items?.length ? (
              <div className="c-empty">
                <Icon name="users" size={28} />
                <p>{dq ? `Nobody matches "${dq}".` : filter || tag || group ? 'Nobody here yet.' : 'No contacts yet.'}</p>
                {!dq && !filter && !tag && !group && (
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={14} />Add a contact</button>
                    <button className="btn" onClick={() => setImporting(true)}>Import a file</button>
                  </div>
                )}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.letter} className="c-group">
                  {letters && <div className="c-letter" aria-hidden="true">{g.letter}</div>}
                  {g.items.map((p) => {
                    const on = selected.has(p.id)
                    return (
                      <div key={p.id} className={'c-row' + (p.id === personId && !view ? ' active' : '') + (on ? ' selected' : '')}>
                        <button type="button" className="c-sel" role="checkbox" aria-checked={on} aria-label={`Select ${p.name || 'contact'}`} onClick={() => toggle(p.id)}>
                          <Avatar name={p.name} src={avatarSrc(p)} size={2} />
                          <span className="c-check" aria-hidden="true"><Icon name="check" size={12} /></span>
                        </button>
                        <button type="button" className="c-row-btn" onClick={() => (selected.size ? toggle(p.id) : go({ person: p.id, view: null }))}>
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
                      </div>
                    )
                  })}
                </div>
              ))
            )}
            {!!items?.length && people.data && people.data.total > items.length && (
              <p className="muted xsmall c-more-note">Showing {items.length.toLocaleString()} of {people.data.total.toLocaleString()}. Search to narrow down.</p>
            )}
          </section>
        )}
        {view === 'duplicates' ? (
          <DuplicatesPane onOpen={(id) => go({ person: id, view: null })} onBack={() => go({ view: null })} />
        ) : personId ? (
          <PersonPane id={personId} onClose={() => go({ person: null })} onEdit={setEditing} onOpen={(id) => go({ person: id })} />
        ) : !phone ? (
          <Overview stats={stats} onOpen={(id) => go({ person: id })} onImport={() => setImporting(true)} />
        ) : null}
      </div>
      <PersonForm open={editing !== null} person={editing === 'new' ? null : editing} onClose={() => (setEditing(null), search.get('new') && go({}))}
        onSaved={(p) => (toast.show(editing === 'new' ? `Added ${p.name || 'contact'}` : 'Saved'), go({ person: p.id, view: null }))} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <LabelsDialog open={!!labels} startEditing={labels?.edit} onClose={() => setLabels(null)} onRenamed={labelRenamed} onDeleted={labelDeleted} onOpen={openLabel} />
      <ContactSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {mergingSel && <MergeManyDialog people={mergingSel} onClose={() => setMergingSel(null)} onMerged={(p) => (setSelected(new Set()), go({ person: p.id, view: null }))} />}
      <Confirm open={!!confirmTag} title={`Delete ${confirmTag?.kind ?? 'tag'} “${confirmTag?.name ?? ''}”?`} body="The contacts stay; only the label is removed from them."
        onConfirm={() => confirmTag && deleteTag.mutate(confirmTag.id, { onSuccess: () => (toast.show(`Deleted ${confirmTag.name}`), labelDeleted(confirmTag)) })}
        onClose={() => setConfirmTag(null)} />
      <Confirm open={confirmBulk} title={`Delete ${plural(selected.size, 'contact')}?`} body="Their interactions and relationships are deleted too. This can't be undone."
        onConfirm={() => bulkDelete.mutate(ids, {
          onSuccess: () => {
            if (personId && selected.has(personId)) go({ person: null })
            setSelected(new Set())
            toast.show(`Deleted ${plural(ids.length, 'contact')}`)
          },
        })}
        onClose={() => setConfirmBulk(false)} />
    </AppShell>
  )
}

function PersonPane({ id, onClose, onEdit, onOpen }: { id: string; onClose: () => void; onEdit: (p: PersonDetail) => void; onOpen: (id: string) => void }) {
  const person = usePerson(id)
  const save = useSavePerson()
  const remove = useDeletePerson()
  const avatar = useAvatar(id)
  const formats = useContactMeta().data?.import_formats
  const [confirm, setConfirm] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const p = person.data
  if (person.isPending) return <section className="c-detail"><SkeletonRows rows={6} /></section>
  if (person.error || !p) return <section className="c-detail"><ErrorBox error={person.error} /></section>
  const profiles = p.profile_links.map((l) => ({ ...l, href: safeHref(l.url) }))
  const upload = (f: File | undefined) => {
    if (!f) return
    if (f.size > AVATAR_MAX) return toast.error('Photos can be up to 2 MB.')
    avatar.set.mutate(f, { onSuccess: () => toast.show('Photo updated') })
  }
  return (
    <section className="c-detail" aria-label={p.name}>
      <div className="c-detail-bar">
        <button className="btn ghost sm" onClick={onClose}><Icon name="chevronLeft" size={14} />Back</button>
        <span className="spacer" />
        <button className={'btn ghost icon sm' + (p.favorite ? ' fav-on' : '')} aria-pressed={p.favorite} aria-label="Favourite" title={p.favorite ? 'Unfavourite' : 'Favourite'} onClick={() => save.mutate({ id: p.id, body: { favorite: !p.favorite } })}><Icon name="star" /></button>
        <button className="btn sm" onClick={() => onEdit(p)}><Icon name="edit" size={14} />Edit</button>
        <Menu align="end" label="Contact actions" trigger={(t) => <button {...t} className="btn ghost icon sm" aria-label="More actions"><Icon name="more" /></button>}>
          {(close) => (
            <>
              <MenuItem icon="camera" onClick={() => (close(), fileInput.current?.click())}>{p.has_avatar ? 'Change photo' : 'Add photo'}</MenuItem>
              {p.has_avatar && <MenuItem icon="x" onClick={() => (close(), avatar.remove.mutate(undefined, { onSuccess: () => toast.show('Photo removed') }))}>Remove photo</MenuItem>}
              <MenuItem icon="arrowUp" href={exportHref('vcf', [p.id])} onClick={close}>Download vCard</MenuItem>
              <div className="menu-sep" />
              <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete contact</MenuItem>
            </>
          )}
        </Menu>
      </div>
      <header className="c-hero">
        <button type="button" className="c-avatar-btn" onClick={() => fileInput.current?.click()} aria-label={p.has_avatar ? 'Change photo' : 'Add photo'} title={p.has_avatar ? 'Change photo' : 'Add photo'} disabled={avatar.set.isPending}>
          <Avatar name={p.name} src={avatarSrc(p)} size={4} />
          <span className="c-avatar-cam" aria-hidden="true"><Icon name="camera" size={16} /></span>
        </button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ''))} />
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
          return <div key={'p' + i}><dt><Icon name="phone" size={14} />{ph.label || 'Phone'}</dt><dd>{href ? <a href={href}>{ph.value}</a> : ph.value}</dd></div>
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
        <div><dt><Icon name="repeat" size={14} /><label htmlFor="c-kit">Keep in touch</label></dt><dd>
          <select id="c-kit" className="select c-kit-select" value={p.keep_in_touch_days ?? 0} disabled={save.isPending}
            onChange={(e) => save.mutate({ id: p.id, body: { keep_in_touch_days: Number(e.target.value) || null } })}>
            {KIT.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
            {p.keep_in_touch_days && !KIT.some(([d]) => d === p.keep_in_touch_days) ? <option value={p.keep_in_touch_days}>Every {p.keep_in_touch_days} days</option> : null}
          </select>
          {p.keep_in_touch_days && p.next_due ? <span className="muted"> · next {fmtDate(parseDayKey(p.next_due))}</span> : null}
        </dd></div>
        {p.how_met && <div><dt><Icon name="users" size={14} />How we met</dt><dd className="pre-wrap">{p.how_met}</dd></div>}
        {p.linked_user && <div><dt><Icon name="user" size={14} />Account</dt><dd>{p.linked_user.name} <span className="muted">@{p.linked_user.username}</span></dd></div>}
        {profiles.length > 0 && (
          <div><dt><Icon name="link" size={14} />Profiles</dt><dd className="c-chips">
            {profiles.map((l) => l.href ? <a key={l.network + l.handle} className="chip" href={l.href} target="_blank" rel="noopener noreferrer" title={l.url ?? undefined}>{l.label} <span className="muted">{l.handle}</span><Icon name="external" size={11} /></a> : <span key={l.network + l.handle} className="chip" title="No public profile link">{l.label}: {l.handle}</span>)}
          </dd></div>
        )}
      </dl>
      {p.notes && <div className="c-block"><div className="detail-section-label">Notes</div><p className="pre-wrap small">{p.notes}</p></div>}
      <Relationships person={p} onOpen={onOpen} />
      <Interactions person={p} />
      <p className="muted xsmall c-foot">Added {shortStamp(p.created_on)} · updated {shortStamp(p.updated_on)}{(() => {
        const from = p.sources.filter((x) => x !== 'manual').map((x) => formats?.[x] ?? x)
        return from.length ? ` · imported from ${from.join(', ')}` : ''
      })()}</p>
      <Confirm open={confirm} title={`Delete ${p.name || 'this contact'}?`} body="Their interactions and relationships are deleted too." onConfirm={() => { onClose(); remove.mutate(p.id, { onSuccess: () => toast.show('Contact deleted') }) }} onClose={() => setConfirm(false)} />
    </section>
  )
}

function Relationships({ person, onOpen }: { person: PersonDetail; onOpen: (id: string) => void }) {
  const kinds = useContactMeta().data?.relationship_kinds ?? ['friend']
  const { add, remove } = useRelationships(person.id)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState('friend')
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 250)
  const results = usePeopleSearch(adding ? q : '')
  const matches = results.data?.items.filter((x) => x.id !== person.id) ?? []
  const pick = (otherId: string) => add.mutate({ other_id: otherId, kind }, { onSuccess: () => (setText(''), setAdding(false)) })
  return (
    <div className="c-block">
      <div className="detail-section-label c-block-head">Relationships
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding}><Icon name={adding ? 'x' : 'plus'} size={13} />{adding ? 'Cancel' : 'Add'}</button>
      </div>
      {adding && (
        <div className="c-rel-form">
          <div className="c-rel-inputs">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Relationship">
              {kinds.map((k) => <option key={k} value={k}>{relLabel(k)}</option>)}
            </select>
            <input className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search contacts" aria-label="Contact" autoFocus autoComplete="off" maxLength={100} />
          </div>
          <p className="help">{person.first_name || person.name}’s {relLabel(kind).toLowerCase()} is…</p>
          {q.length >= 2 && (
            <ul className="c-suggest">
              {results.isFetching && !results.data ? <li className="muted small">Searching…</li> : matches.length ? matches.map((x) => (
                <li key={x.id}><button type="button" disabled={add.isPending} onClick={() => pick(x.id)}>
                  <Avatar name={x.name} src={avatarSrc(x)} size={1.5} /><span className="truncate">{x.name}</span><span className="muted xsmall truncate">{x.company}</span>
                </button></li>
              )) : <li className="muted small">No matches.</li>}
            </ul>
          )}
        </div>
      )}
      {person.relationships.length > 0 ? (
        <ul className="c-rels">
          {person.relationships.map((r) => (
            <li key={r.id}>
              <span className="c-kind">{relLabel(r.kind)}</span>
              <button type="button" className="c-linkbtn grow" onClick={() => onOpen(r.other_id)}>{r.other_name}</button>
              <button className="btn ghost icon sm c-del" aria-label={`Remove ${relLabel(r.kind)} ${r.other_name}`} onClick={() => remove.mutate(r.id)}><Icon name="x" size={12} /></button>
            </li>
          ))}
        </ul>
      ) : !adding && <p className="muted small">No relationships yet.</p>}
    </div>
  )
}

function Interactions({ person }: { person: PersonDetail }) {
  const kinds = useContactMeta().data?.interaction_kinds ?? ['call', 'meeting', 'message', 'email', 'note']
  const log = useLogInteraction(person.id)
  const update = useUpdateInteraction()
  const remove = useDeleteInteraction()
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Interaction | null>(null)
  return (
    <div className="c-block">
      <div className="detail-section-label">Interactions {person.last_contacted && <span className="muted">· last {fmtDate(parseDayKey(person.last_contacted))}</span>}</div>
      <InteractionForm kinds={kinds} pending={log.isPending} onSubmit={(body, reset) => log.mutate(body, { onSuccess: () => (reset(), toast.show('Logged')) })} />
      <ol className="c-timeline">
        {person.interactions.map((i) => editing === i.id ? (
          <li key={i.id} className="c-tl-edit">
            <InteractionForm kinds={kinds} existing={i} pending={update.isPending} onCancel={() => setEditing(null)}
              onSubmit={(body) => update.mutate({ id: i.id, body }, { onSuccess: () => setEditing(null) })} />
          </li>
        ) : (
          <li key={i.id}>
            <span className="c-kind">{i.kind}</span>
            <span className="grow small">{i.summary}{i.notes && <span className="muted pre-wrap c-tl-notes">{i.notes}</span>}</span>
            <time className="muted xsmall tabular">{fmtDate(parseDayKey(i.date))}</time>
            <span className="c-tl-acts">
              <button className="btn ghost icon sm c-del" aria-label="Edit interaction" onClick={() => setEditing(i.id)}><Icon name="edit" size={12} /></button>
              <button className="btn ghost icon sm c-del" aria-label="Delete interaction" onClick={() => setDeleting(i)}><Icon name="trash" size={12} /></button>
            </span>
          </li>
        ))}
        {!person.interactions.length && <li className="muted small">No interactions logged yet.</li>}
      </ol>
      <Confirm open={!!deleting} title="Delete this interaction?" body={deleting?.summary} onConfirm={() => deleting && remove.mutate(deleting.id)} onClose={() => setDeleting(null)} />
    </div>
  )
}

type InteractionBody = { kind: string; date: string; summary: string; notes: string }
function InteractionForm({ kinds, existing, pending, onSubmit, onCancel }: {
  kinds: string[]; existing?: Interaction; pending: boolean; onSubmit: (b: InteractionBody, reset: () => void) => void; onCancel?: () => void
}) {
  const today = dayKey(new Date())
  const [kind, setKind] = useState(existing?.kind ?? 'call')
  const [date, setDate] = useState(existing?.date ?? today)
  const [summary, setSummary] = useState(existing?.summary ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [showNotes, setShowNotes] = useState(!!existing?.notes)
  const reset = () => (setSummary(''), setNotes(''), setShowNotes(false), setDate(dayKey(new Date())))
  const submit = () => summary.trim() && onSubmit({ kind, date: date || today, summary: summary.trim(), notes: notes.trim() }, reset)
  return (
    <form className="c-log" onSubmit={(e) => (e.preventDefault(), submit())}>
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
        {kinds.map((k) => <option key={k} value={k}>{cap(k)}</option>)}
      </select>
      <input className="input c-log-date" type="date" value={date} max="2100-12-31" onChange={(e) => setDate(e.target.value)} aria-label="Date" required />
      <input className="input c-log-sum" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What did you talk about?" aria-label="Summary" maxLength={500} autoFocus={!!existing} />
      <span className="c-log-btns">
        {onCancel && <button type="button" className="btn sm" onClick={onCancel}>Cancel</button>}
        <button className="btn primary sm" disabled={!summary.trim() || pending}>{existing ? 'Save' : 'Log'}</button>
      </span>
      {showNotes ? (
        <textarea className="textarea c-log-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" aria-label="Notes" maxLength={20000} rows={2} />
      ) : (
        <button type="button" className="c-linkbtn c-log-more" onClick={() => setShowNotes(true)}><Icon name="plus" size={12} />Add notes</button>
      )}
    </form>
  )
}

function kitStatus(nextDue: string): string {
  const days = Math.round((parseDayKey(nextDue).getTime() - parseDayKey(dayKey(new Date())).getTime()) / 86_400_000)
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`
  if (days === 0) return 'Due today'
  return `Next catch-up in ${days} day${days === 1 ? '' : 's'}`
}

function Overview({ stats, onOpen, onImport }: { stats?: ContactStats; onOpen: (id: string) => void; onImport: () => void }) {
  if (!stats) return <section className="c-detail"><SkeletonRows rows={5} /></section>
  if (!stats.total) return (
    <div className="c-placeholder">
      <Icon name="users" size={32} />
      <span>Your people, in one place. Add someone by hand, or import from Google, Outlook, LinkedIn, a phone (vCard) or any CSV.</span>
      <button className="btn" onClick={onImport}><Icon name="arrowDown" size={14} />Import a file</button>
    </div>
  )
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
      <p className="muted xsmall c-keys"><span className="kbd">/</span> search · <span className="kbd">N</span> new · <span className="kbd">J</span><span className="kbd">K</span> move · <span className="kbd">E</span> edit</p>
      {stats.sources && Object.keys(stats.sources).length > 0 && (
        <p className="muted xsmall">Sources: {Object.entries(stats.sources).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
      )}
    </section>
  )
}
