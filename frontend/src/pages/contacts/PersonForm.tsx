// Create / edit a contact: every field the API stores, with repeatable labelled rows. Saving sends
// everything the form shows (PATCH is partial, so anything not shown here is left untouched).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, Switch } from '../../components/ui'
import { useContactMeta, useContactTags, useSavePerson, type Address, type PersonDetail, type PersonIn } from './api'
import { KIT, MONTHS, buildBirthday, parseBirthday } from './util'

const EMAIL_LABELS = ['home', 'work', 'other']
const PHONE_LABELS = ['mobile', 'home', 'work', 'main', 'fax', 'other']
const ADDRESS_LABELS = ['home', 'work', 'other']
const MAX_ROWS = 20

type Row<T> = T & { _k: number }
let seq = 0
const rows = <T,>(list: T[] | undefined): Row<T>[] => (list ?? []).map((x) => ({ ...x, _k: ++seq }))
const blankAddress = (): Address => ({ label: '', street: '', city: '', region: '', postcode: '', country: '' })

interface FormState {
  prefix: string; first_name: string; middle_name: string; last_name: string; suffix: string; nickname: string; display_name: string
  company: string; title: string; department: string
  emails: Row<{ label: string; value: string }>[]; phones: Row<{ label: string; value: string }>[]; addresses: Row<Address>[]
  profiles: Row<{ network: string; handle: string }>[]; links: Row<{ label: string; url: string }>[]; custom_fields: Row<{ key: string; value: string }>[]
  bYear: string; bMonth: string; bDay: string; anniversary: string
  tags: string[]; groups: string[]; kit: number; favorite: boolean; username: string; how_met: string; notes: string
}

/** The form's content without row keys, for the unsaved-changes check. */
const snapshot = (f: FormState) => JSON.stringify(f, (k, v) => (k === '_k' ? undefined : v))

function initial(p: PersonDetail | null): FormState {
  const b = parseBirthday(p?.birthday)
  return {
    prefix: p?.prefix ?? '', first_name: p?.first_name ?? '', middle_name: p?.middle_name ?? '', last_name: p?.last_name ?? '',
    suffix: p?.suffix ?? '', nickname: p?.nickname ?? '', display_name: p?.display_name ?? '',
    company: p?.company ?? '', title: p?.title ?? '', department: p?.department ?? '',
    emails: rows(p ? p.emails : [{ label: 'home', value: '' }]), phones: rows(p ? p.phones : [{ label: 'mobile', value: '' }]),
    addresses: rows(p?.addresses), links: rows(p?.links), custom_fields: rows(p?.custom_fields),
    profiles: rows(Object.entries(p?.profiles ?? {}).map(([network, handle]) => ({ network, handle }))),
    bYear: b?.year ?? '', bMonth: b?.month ?? '', bDay: b?.day ?? '', anniversary: p?.anniversary ?? '',
    tags: p?.tags ?? [], groups: p?.groups ?? [], kit: p?.keep_in_touch_days ?? 0, favorite: p?.favorite ?? false,
    username: p?.linked_user?.username ?? '', how_met: p?.how_met ?? '', notes: p?.notes ?? '',
  }
}

export function PersonForm({ open, person, onClose, onSaved }: { open: boolean; person: PersonDetail | null; onClose: () => void; onSaved: (p: PersonDetail) => void }) {
  const save = useSavePerson(false)
  const meta = useContactMeta().data
  const tagList = useContactTags().data
  const [f, setF] = useState<FormState>(() => initial(person))
  const [error, setError] = useState('')
  const [moreNames, setMoreNames] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)
  const baseline = useRef('')
  const [askDiscard, setAskDiscard] = useState(false)

  useEffect(() => {
    if (!open) return
    const start = initial(person)
    setF(start)
    baseline.current = snapshot(start)
    setError('')
    setAskDiscard(false)
    setMoreNames(!!(person && (person.prefix || person.middle_name || person.suffix || person.display_name)))
  }, [open, person])
  const dirty = open && !save.isPending && snapshot(f) !== baseline.current
  // Closing with unsaved edits asks first; so does leaving the page.
  // Stable, so the dialog doesn't re-run its focus handling on every keystroke (and steal focus from the confirm).
  const closeRef = useRef(() => {})
  closeRef.current = () => {
    if (askDiscard) return // Escape while the confirm is open only closes the confirm
    if (dirty) setAskDiscard(true)
    else onClose()
  }
  const requestClose = useCallback(() => closeRef.current(), [])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
  useEffect(() => {
    if (error) errRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }))
  const networks = meta?.networks ?? []
  const netLabel = (k: string) => networks.find((n) => n.key === k)?.label ?? k
  const suggestions = useMemo(() => ({
    tags: (tagList ?? []).filter((t) => t.kind === 'tag').map((t) => t.name),
    groups: (tagList ?? []).filter((t) => t.kind === 'group').map((t) => t.name),
  }), [tagList])

  const submit = () => {
    setError('')
    const strip = <T extends { _k: number }>(list: T[]) => list.map(({ _k, ...rest }) => rest)
    const t = (s: string) => s.trim()
    const birthday = buildBirthday(t(f.bYear), f.bMonth, t(f.bDay))
    if (birthday === null) return setError('Birthday needs a month and a valid day (the year is optional).')
    const emails = strip(f.emails).map((e) => ({ label: t(e.label), value: t(e.value) })).filter((e) => e.value)
    const phones = strip(f.phones).map((e) => ({ label: t(e.label), value: t(e.value) })).filter((e) => e.value)
    const profiles: Record<string, string> = {}
    for (const r of f.profiles) {
      if (!t(r.handle)) continue
      if (profiles[r.network]) return setError(`Only one ${netLabel(r.network)} profile per contact.`)
      profiles[r.network] = t(r.handle)
    }
    const body: PersonIn = {
      prefix: t(f.prefix), first_name: t(f.first_name), middle_name: t(f.middle_name), last_name: t(f.last_name), suffix: t(f.suffix),
      nickname: t(f.nickname), display_name: t(f.display_name), company: t(f.company), title: t(f.title), department: t(f.department),
      emails, phones,
      addresses: strip(f.addresses).map((a) => ({ label: t(a.label), street: t(a.street), city: t(a.city), region: t(a.region), postcode: t(a.postcode), country: t(a.country) }))
        .filter((a) => a.street || a.city || a.region || a.postcode || a.country),
      profiles,
      links: strip(f.links).map((l) => ({ label: t(l.label), url: t(l.url) })).filter((l) => l.url),
      custom_fields: strip(f.custom_fields).map((c) => ({ key: t(c.key), value: t(c.value) })).filter((c) => c.key),
      birthday, anniversary: f.anniversary || null,
      tags: f.tags, groups: f.groups, keep_in_touch_days: f.kit || null, favorite: f.favorite,
      how_met: t(f.how_met), notes: t(f.notes),
    }
    // Only touch the linked account when it changed (blank unlinks).
    if (t(f.username) !== (person?.linked_user?.username ?? '')) body.username = t(f.username)
    if (!body.first_name && !body.last_name && !body.display_name && !body.nickname && !body.company && !emails.length && !phones.length)
      return setError('Give the contact a name, company, email or phone.')
    save.mutate({ id: person?.id, body }, {
      onSuccess: (p) => (onClose(), onSaved(p)),
      onError: (e) => setError((e as Error).message),
    })
  }

  return (
    <Dialog open={open} onClose={requestClose} title={person ? `Edit ${person.name || 'contact'}` : 'New contact'} width="44rem"
      footer={<><span className="spacer" /><button className="btn" onClick={requestClose}>Cancel</button><button className="btn primary" type="submit" form="c-person-form" disabled={save.isPending}>{save.isPending ? 'Saving…' : person ? 'Save' : 'Add contact'}</button></>}>
      <form id="c-person-form" className="c-form" noValidate onSubmit={(e) => (e.preventDefault(), submit())}>
        {error && <div ref={errRef} className="c-form-err" role="alert"><Icon name="alert" size={14} />{error}</div>}
        <datalist id="c-dl-email">{EMAIL_LABELS.map((l) => <option key={l} value={l} />)}</datalist>
        <datalist id="c-dl-phone">{PHONE_LABELS.map((l) => <option key={l} value={l} />)}</datalist>
        <datalist id="c-dl-address">{ADDRESS_LABELS.map((l) => <option key={l} value={l} />)}</datalist>

        <Section title="Name">
          <div className="field-row">
            <Text label="First name" value={f.first_name} onChange={(v) => set('first_name', v)} max={128} autoFocus={!person} />
            <Text label="Last name" value={f.last_name} onChange={(v) => set('last_name', v)} max={128} />
          </div>
          {moreNames ? (
            <>
              <div className="c-grid-3">
                <Text label="Prefix" value={f.prefix} onChange={(v) => set('prefix', v)} max={32} />
                <Text label="Middle name" value={f.middle_name} onChange={(v) => set('middle_name', v)} max={128} />
                <Text label="Suffix" value={f.suffix} onChange={(v) => set('suffix', v)} max={32} />
              </div>
              <Text label="Display name" value={f.display_name} onChange={(v) => set('display_name', v)} max={200} placeholder="Defaults to first and last name" />
            </>
          ) : (
            <button type="button" className="c-linkbtn" onClick={() => setMoreNames(true)}>Prefix, middle name, suffix, display name</button>
          )}
          <div className="c-grid-3">
            <Text label="Nickname" value={f.nickname} onChange={(v) => set('nickname', v)} max={128} />
            <Text label="Company" value={f.company} onChange={(v) => set('company', v)} max={200} />
            <Text label="Title / role" value={f.title} onChange={(v) => set('title', v)} max={200} />
          </div>
          <div className="field-row">
            <Text label="Department" value={f.department} onChange={(v) => set('department', v)} max={200} />
            <div className="field"><span>Favourite</span><div className="c-switch-cell"><Switch checked={f.favorite} onChange={(v) => set('favorite', v)} label="Starred" /></div></div>
          </div>
        </Section>

        <Repeat title="Email" addLabel="Add email" items={f.emails} onChange={(v) => set('emails', v)} blank={() => ({ label: f.emails.length ? 'work' : 'home', value: '' })}
          render={(r, up) => (<>
            <input className="input c-rep-label" list="c-dl-email" value={r.label} onChange={(e) => up({ label: e.target.value })} placeholder="Label" maxLength={40} aria-label="Email label" />
            <input className="input" type="email" value={r.value} onChange={(e) => up({ value: e.target.value })} placeholder="name@example.com" maxLength={254} aria-label="Email" />
          </>)} />
        <Repeat title="Phone" addLabel="Add phone" items={f.phones} onChange={(v) => set('phones', v)} blank={() => ({ label: f.phones.length ? 'work' : 'mobile', value: '' })}
          render={(r, up) => (<>
            <input className="input c-rep-label" list="c-dl-phone" value={r.label} onChange={(e) => up({ label: e.target.value })} placeholder="Label" maxLength={40} aria-label="Phone label" />
            <input className="input" type="tel" value={r.value} onChange={(e) => up({ value: e.target.value })} placeholder="+1 555 0100" maxLength={50} aria-label="Phone" />
          </>)} />
        <Repeat title="Address" addLabel="Add address" items={f.addresses} onChange={(v) => set('addresses', v)} blank={() => ({ ...blankAddress(), label: f.addresses.length ? 'work' : 'home' })}
          render={(r, up) => (<>
            <input className="input c-rep-label" list="c-dl-address" value={r.label} onChange={(e) => up({ label: e.target.value })} placeholder="Label" maxLength={40} aria-label="Address label" />
            <div className="c-addr">
              <input className="input c-span-2" value={r.street} onChange={(e) => up({ street: e.target.value })} placeholder="Street" maxLength={300} aria-label="Street" />
              <input className="input" value={r.city} onChange={(e) => up({ city: e.target.value })} placeholder="City" maxLength={200} aria-label="City" />
              <input className="input" value={r.region} onChange={(e) => up({ region: e.target.value })} placeholder="State / region" maxLength={200} aria-label="State or region" />
              <input className="input" value={r.postcode} onChange={(e) => up({ postcode: e.target.value })} placeholder="Postal code" maxLength={32} aria-label="Postal code" />
              <input className="input" value={r.country} onChange={(e) => up({ country: e.target.value })} placeholder="Country" maxLength={200} aria-label="Country" />
            </div>
          </>)} />

        <Section title="Dates">
          <div className="c-dates">
            <div className="field">
              <span id="c-bday-l">Birthday</span>
              <div className="c-bday" role="group" aria-labelledby="c-bday-l">
                <select className="select" value={f.bMonth} onChange={(e) => set('bMonth', e.target.value)} aria-label="Birthday month">
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                </select>
                <input className="input" type="number" inputMode="numeric" min={1} max={31} value={f.bDay} onChange={(e) => set('bDay', e.target.value)} placeholder="Day" aria-label="Birthday day" />
                <input className="input" type="number" inputMode="numeric" min={1000} max={2100} value={f.bYear} onChange={(e) => set('bYear', e.target.value)} placeholder="Year (optional)" aria-label="Birthday year (optional)" />
              </div>
            </div>
            <label className="field"><span>Anniversary</span><input className="input" type="date" value={f.anniversary} max="2100-12-31" onChange={(e) => set('anniversary', e.target.value)} /></label>
          </div>
        </Section>

        <Repeat title="Profiles" hint="Paste a handle or a profile link; the handle is kept and the link built from it." addLabel="Add profile" items={f.profiles} onChange={(v) => set('profiles', v)}
          blank={() => ({ network: networks.find((n) => !f.profiles.some((p) => p.network === n.key))?.key ?? 'website', handle: '' })}
          render={(r, up) => {
            const net = networks.find((n) => n.key === r.network)
            return (<>
              <select className="select c-rep-label" value={r.network} onChange={(e) => up({ network: e.target.value })} aria-label="Network">
                {!net && <option value={r.network}>{r.network}</option>}
                {networks.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
              </select>
              <input className="input" value={r.handle} onChange={(e) => up({ handle: e.target.value })} maxLength={500} spellCheck={false} autoComplete="off" aria-label={`${net?.label ?? 'Profile'} handle or link`}
                placeholder={net?.kind === 'url' ? 'https://…' : r.network === 'mastodon' ? 'user@instance.social' : r.network === 'matrix' ? '@user:matrix.org' : 'handle or profile link'} />
            </>)
          }} />
        <Repeat title="Links" addLabel="Add link" items={f.links} onChange={(v) => set('links', v)} blank={() => ({ label: '', url: '' })}
          render={(r, up) => (<>
            <input className="input c-rep-label" value={r.label} onChange={(e) => up({ label: e.target.value })} placeholder="Label" maxLength={40} aria-label="Link label" />
            <input className="input" type="url" value={r.url} onChange={(e) => up({ url: e.target.value })} placeholder="https://…" maxLength={500} aria-label="URL" />
          </>)} />

        <Section title="Organise">
          <div className="field-row">
            <div className="field"><span id="c-groups-l">Groups</span><Tokens value={f.groups} onChange={(v) => set('groups', v)} suggestions={suggestions.groups} placeholder="Family, Work" labelledBy="c-groups-l" listId="c-dl-groups" /></div>
            <div className="field"><span id="c-tags-l">Tags</span><Tokens value={f.tags} onChange={(v) => set('tags', v)} suggestions={suggestions.tags} placeholder="rust, climbing" labelledBy="c-tags-l" listId="c-dl-tags" /></div>
          </div>
          <div className="field-row">
            <label className="field"><span>Keep in touch</span>
              <select className="select" value={f.kit} onChange={(e) => set('kit', Number(e.target.value))}>
                {KIT.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
                {f.kit && !KIT.some(([d]) => d === f.kit) ? <option value={f.kit}>Every {f.kit} days</option> : null}
              </select>
            </label>
            <Text label="Linked account" value={f.username} onChange={(v) => set('username', v)} max={150} placeholder="Their username here, if they have one" />
          </div>
        </Section>

        <Section title="Notes">
          <label className="field"><span>How we met</span><textarea className="textarea c-short" value={f.how_met} onChange={(e) => set('how_met', e.target.value)} maxLength={20000} /></label>
          <label className="field"><span>Notes</span><textarea className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={20000} /></label>
        </Section>

        <Repeat title="Custom fields" addLabel="Add field" items={f.custom_fields} onChange={(v) => set('custom_fields', v)} blank={() => ({ key: '', value: '' })}
          render={(r, up) => (<>
            <input className="input c-rep-label" value={r.key} onChange={(e) => up({ key: e.target.value })} placeholder="Field" maxLength={64} aria-label="Field name" />
            <input className="input" value={r.value} onChange={(e) => up({ value: e.target.value })} placeholder="Value" maxLength={1000} aria-label="Field value" />
          </>)} />
        {/* Enter in a text field submits */}
        <button type="submit" hidden />
      </form>
      <Confirm open={askDiscard} title="Discard your changes?" body={person ? `Your edits to ${person.name || 'this contact'} haven't been saved.` : "This contact hasn't been saved."}
        confirmLabel="Discard" onConfirm={onClose} onClose={() => setAskDiscard(false)} />
    </Dialog>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="c-fs">
      <legend>{title}</legend>
      {hint && <p className="help">{hint}</p>}
      {children}
    </fieldset>
  )
}

function Text({ label, value, onChange, max, placeholder, autoFocus }: { label: string; value: string; onChange: (v: string) => void; max: number; placeholder?: string; autoFocus?: boolean }) {
  return (
    <label className="field"><span>{label}</span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} maxLength={max} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" />
    </label>
  )
}

function Repeat<T extends object>({ title, hint, addLabel, items, onChange, blank, render }: {
  title: string; hint?: string; addLabel: string; items: Row<T>[]; onChange: (v: Row<T>[]) => void; blank: () => T
  render: (row: Row<T>, update: (patch: Partial<T>) => void) => ReactNode
}) {
  const list = useRef<HTMLDivElement>(null)
  const add = () => {
    onChange([...items, { ...blank(), _k: ++seq }])
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('.c-rep-row:last-child input:not(.c-rep-label), .c-rep-row:last-child input')?.focus())
  }
  return (
    <Section title={title} hint={hint}>
      {items.length > 0 && (
        <div className="c-rep" ref={list}>
          {items.map((r) => (
            <div key={r._k} className="c-rep-row">
              {render(r, (p) => onChange(items.map((x) => (x._k === r._k ? { ...x, ...p } : x))))}
              <button type="button" className="btn ghost icon sm" aria-label={`Remove ${title.toLowerCase()}`} onClick={() => onChange(items.filter((x) => x._k !== r._k))}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {items.length < MAX_ROWS && <button type="button" className="c-linkbtn" onClick={add}><Icon name="plus" size={13} />{addLabel}</button>}
    </Section>
  )
}

/** Chips with a text box: Enter or comma adds, Backspace on empty removes the last. */
function Tokens({ value, onChange, suggestions, placeholder, labelledBy, listId }: {
  value: string[]; onChange: (v: string[]) => void; suggestions: string[]; placeholder: string; labelledBy: string; listId: string
}) {
  const [text, setText] = useState('')
  const commit = (raw = text) => {
    const add = raw.split(',').map((s) => s.trim().slice(0, 64)).filter(Boolean)
    const next = [...value]
    for (const a of add) if (!next.some((x) => x.toLowerCase() === a.toLowerCase())) next.push(a)
    if (next.length !== value.length) onChange(next)
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && text.trim()) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Enter') {
      e.preventDefault()
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    }
  }
  const left = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
  return (
    <div className="c-tokens" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {value.map((v) => (
        <span key={v} className="chip">{v}
          <button type="button" className="c-chip-x" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><Icon name="x" size={10} /></button>
        </span>
      ))}
      <input value={text} list={listId} onChange={(e) => (e.target.value.endsWith(',') ? commit(e.target.value) : setText(e.target.value))} onKeyDown={onKey} onBlur={() => text.trim() && commit()}
        placeholder={value.length ? '' : placeholder} aria-labelledby={labelledBy} maxLength={200} autoComplete="off" />
      <datalist id={listId}>{left.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  )
}
