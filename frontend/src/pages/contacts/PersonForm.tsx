// Create / edit a contact: every field the API stores, with repeatable labelled rows. Saving sends
// everything the form shows (PATCH is partial, so anything not shown here is left untouched).
// Each opening remounts the form, so it always starts from the contact as it is now.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Confirm, Dialog, Field, FieldRow, Input, Select, Switch, Textarea } from '../../components/ui'
import { useContactMeta, useContactTags, useSavePerson, type PersonDetail } from './api'
import { FieldGroup, FormSection, RepeatRows, TextField, TokenInput } from './FormFields'
import { LinkButton } from './LinkButton'
import { KIT, MONTHS } from './personFields'
import { blankAddress, formToPersonIn, initialForm, snapshot, type FormState } from './personFormState'
import { useOpenCount } from '../../lib/useOpenCount'

const EMAIL_LABELS = ['home', 'work', 'other']
const PHONE_LABELS = ['mobile', 'home', 'work', 'main', 'fax', 'other']
const ADDRESS_LABELS = ['home', 'work', 'other']
const GRID_3 = 'grid grid-cols-3 gap-3 max-md:grid-cols-2'

interface Props {
  open: boolean
  person: PersonDetail | null
  onClose: () => void
  onSaved: (p: PersonDetail) => void
}

export function PersonForm(props: Props) {
  return <PersonFormDialog key={useOpenCount(props.open)} {...props} />
}

function PersonFormDialog({ open, person, onClose, onSaved }: Props) {
  const save = useSavePerson(false)
  const meta = useContactMeta().data
  const tagList = useContactTags().data
  const [f, setF] = useState<FormState>(() => initialForm(person))
  const [baseline] = useState(() => snapshot(f))
  const [error, setError] = useState('')
  const [moreNames, setMoreNames] = useState(
    () => !!(person && (person.prefix || person.middle_name || person.suffix || person.display_name)),
  )
  const [askDiscard, setAskDiscard] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)

  const dirty = open && !save.isPending && snapshot(f) !== baseline
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
  const suggestions = useMemo(
    () => ({
      tags: (tagList ?? []).filter((t) => t.kind === 'tag').map((t) => t.name),
      groups: (tagList ?? []).filter((t) => t.kind === 'group').map((t) => t.name),
    }),
    [tagList],
  )

  const submit = () => {
    setError('')
    const out = formToPersonIn(f, person?.linked_user?.username ?? '', (k) => networks.find((n) => n.key === k)?.label ?? k)
    if ('error' in out) return setError(out.error)
    save.mutate(
      { id: person?.id, body: out.body },
      {
        onSuccess: (p) => {
          onClose()
          onSaved(p)
        },
        onError: (e) => setError((e as Error).message),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      title={person ? `Edit ${person.name || 'contact'}` : 'New contact'}
      width="44rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={requestClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="c-person-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : person ? 'Save' : 'Add contact'}
          </Button>
        </>
      }
    >
      <form
        id="c-person-form"
        className="grid gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {error && (
          <div ref={errRef} className="flex items-center gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            <Icon name="alert" size={14} />
            {error}
          </div>
        )}
        <datalist id="c-dl-email">
          {EMAIL_LABELS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <datalist id="c-dl-phone">
          {PHONE_LABELS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <datalist id="c-dl-address">
          {ADDRESS_LABELS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>

        <FormSection title="Name">
          <FieldRow>
            <TextField label="First name" value={f.first_name} onChange={(v) => set('first_name', v)} max={128} autoFocus={!person} />
            <TextField label="Last name" value={f.last_name} onChange={(v) => set('last_name', v)} max={128} />
          </FieldRow>
          {moreNames ? (
            <>
              <div className={GRID_3}>
                <TextField label="Prefix" value={f.prefix} onChange={(v) => set('prefix', v)} max={32} />
                <TextField label="Middle name" value={f.middle_name} onChange={(v) => set('middle_name', v)} max={128} />
                <TextField label="Suffix" value={f.suffix} onChange={(v) => set('suffix', v)} max={32} />
              </div>
              <TextField
                label="Display name"
                value={f.display_name}
                onChange={(v) => set('display_name', v)}
                max={200}
                placeholder="Defaults to first and last name"
              />
            </>
          ) : (
            <LinkButton onClick={() => setMoreNames(true)}>Prefix, middle name, suffix, display name</LinkButton>
          )}
          <div className={GRID_3}>
            <TextField label="Nickname" value={f.nickname} onChange={(v) => set('nickname', v)} max={128} />
            <TextField label="Company" value={f.company} onChange={(v) => set('company', v)} max={200} />
            <TextField label="Title / role" value={f.title} onChange={(v) => set('title', v)} max={200} />
          </div>
          <FieldRow>
            <TextField label="Department" value={f.department} onChange={(v) => set('department', v)} max={200} />
            <FieldGroup label="Favourite">
              <div className="flex h-8 items-center">
                <Switch checked={f.favorite} onChange={(v) => set('favorite', v)} label="Starred" />
              </div>
            </FieldGroup>
          </FieldRow>
        </FormSection>

        <RepeatRows
          title="Email"
          addLabel="Add email"
          items={f.emails}
          onChange={(v) => set('emails', v)}
          blank={() => ({ label: f.emails.length ? 'work' : 'home', value: '' })}
          render={(r, up) => (
            <>
              <Input
                data-row-label
                list="c-dl-email"
                value={r.label}
                onChange={(e) => up({ label: e.target.value })}
                placeholder="Label"
                maxLength={40}
                aria-label="Email label"
              />
              <Input
                type="email"
                value={r.value}
                onChange={(e) => up({ value: e.target.value })}
                placeholder="name@example.com"
                maxLength={254}
                aria-label="Email"
              />
            </>
          )}
        />
        <RepeatRows
          title="Phone"
          addLabel="Add phone"
          items={f.phones}
          onChange={(v) => set('phones', v)}
          blank={() => ({ label: f.phones.length ? 'work' : 'mobile', value: '' })}
          render={(r, up) => (
            <>
              <Input
                data-row-label
                list="c-dl-phone"
                value={r.label}
                onChange={(e) => up({ label: e.target.value })}
                placeholder="Label"
                maxLength={40}
                aria-label="Phone label"
              />
              <Input
                type="tel"
                value={r.value}
                onChange={(e) => up({ value: e.target.value })}
                placeholder="+1 555 0100"
                maxLength={50}
                aria-label="Phone"
              />
            </>
          )}
        />
        <RepeatRows
          title="Address"
          addLabel="Add address"
          items={f.addresses}
          onChange={(v) => set('addresses', v)}
          blank={() => ({ ...blankAddress(), label: f.addresses.length ? 'work' : 'home' })}
          render={(r, up) => (
            <>
              <Input
                data-row-label
                list="c-dl-address"
                value={r.label}
                onChange={(e) => up({ label: e.target.value })}
                placeholder="Label"
                maxLength={40}
                aria-label="Address label"
              />
              <div className="grid grid-cols-2 gap-1.5 max-md:grid-cols-1">
                <Input
                  className="col-span-2 max-md:col-span-1"
                  value={r.street}
                  onChange={(e) => up({ street: e.target.value })}
                  placeholder="Street"
                  maxLength={300}
                  aria-label="Street"
                />
                <Input value={r.city} onChange={(e) => up({ city: e.target.value })} placeholder="City" maxLength={200} aria-label="City" />
                <Input
                  value={r.region}
                  onChange={(e) => up({ region: e.target.value })}
                  placeholder="State / region"
                  maxLength={200}
                  aria-label="State or region"
                />
                <Input
                  value={r.postcode}
                  onChange={(e) => up({ postcode: e.target.value })}
                  placeholder="Postal code"
                  maxLength={32}
                  aria-label="Postal code"
                />
                <Input
                  value={r.country}
                  onChange={(e) => up({ country: e.target.value })}
                  placeholder="Country"
                  maxLength={200}
                  aria-label="Country"
                />
              </div>
            </>
          )}
        />

        <FormSection title="Dates">
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3 max-md:grid-cols-1">
            <FieldGroup label="Birthday" labelId="c-bday-l">
              <fieldset
                className="m-0 grid min-w-0 border-0 p-0 grid-cols-[minmax(0,1.4fr)_4.5rem_minmax(0,1.2fr)] gap-1.5 max-md:grid-cols-[minmax(0,1.3fr)_4rem_minmax(0,1fr)]"
                aria-labelledby="c-bday-l"
              >
                <Select value={f.bMonth} onChange={(e) => set('bMonth', e.target.value)} aria-label="Birthday month">
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={String(i + 1)}>
                      {m}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  value={f.bDay}
                  onChange={(e) => set('bDay', e.target.value)}
                  placeholder="Day"
                  aria-label="Birthday day"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1000}
                  max={2100}
                  value={f.bYear}
                  onChange={(e) => set('bYear', e.target.value)}
                  placeholder="Year (optional)"
                  aria-label="Birthday year (optional)"
                />
              </fieldset>
            </FieldGroup>
            <Field label="Anniversary">
              <Input type="date" value={f.anniversary} max="2100-12-31" onChange={(e) => set('anniversary', e.target.value)} />
            </Field>
          </div>
        </FormSection>

        <RepeatRows
          title="Profiles"
          hint="Paste a handle or a profile link; the handle is kept and the link built from it."
          addLabel="Add profile"
          items={f.profiles}
          onChange={(v) => set('profiles', v)}
          blank={() => ({ network: networks.find((n) => !f.profiles.some((p) => p.network === n.key))?.key ?? 'website', handle: '' })}
          render={(r, up) => {
            const net = networks.find((n) => n.key === r.network)
            return (
              <>
                <Select value={r.network} onChange={(e) => up({ network: e.target.value })} aria-label="Network">
                  {!net && <option value={r.network}>{r.network}</option>}
                  {networks.map((n) => (
                    <option key={n.key} value={n.key}>
                      {n.label}
                    </option>
                  ))}
                </Select>
                <Input
                  value={r.handle}
                  onChange={(e) => up({ handle: e.target.value })}
                  maxLength={500}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={`${net?.label ?? 'Profile'} handle or link`}
                  placeholder={
                    net?.kind === 'url'
                      ? 'https://…'
                      : r.network === 'mastodon'
                        ? 'user@instance.social'
                        : r.network === 'matrix'
                          ? '@user:matrix.org'
                          : 'handle or profile link'
                  }
                />
              </>
            )
          }}
        />
        <RepeatRows
          title="Links"
          addLabel="Add link"
          items={f.links}
          onChange={(v) => set('links', v)}
          blank={() => ({ label: '', url: '' })}
          render={(r, up) => (
            <>
              <Input
                value={r.label}
                onChange={(e) => up({ label: e.target.value })}
                placeholder="Label"
                maxLength={40}
                aria-label="Link label"
              />
              <Input
                type="url"
                value={r.url}
                onChange={(e) => up({ url: e.target.value })}
                placeholder="https://…"
                maxLength={500}
                aria-label="URL"
              />
            </>
          )}
        />

        <FormSection title="Organise">
          <FieldRow>
            <FieldGroup label="Groups" labelId="c-groups-l">
              <TokenInput
                value={f.groups}
                onChange={(v) => set('groups', v)}
                suggestions={suggestions.groups}
                placeholder="Family, Work"
                labelledBy="c-groups-l"
                listId="c-dl-groups"
              />
            </FieldGroup>
            <FieldGroup label="Tags" labelId="c-tags-l">
              <TokenInput
                value={f.tags}
                onChange={(v) => set('tags', v)}
                suggestions={suggestions.tags}
                placeholder="rust, climbing"
                labelledBy="c-tags-l"
                listId="c-dl-tags"
              />
            </FieldGroup>
          </FieldRow>
          <FieldRow>
            <Field label="Keep in touch">
              <Select value={f.kit} onChange={(e) => set('kit', Number(e.target.value))}>
                {KIT.map(([d, l]) => (
                  <option key={d} value={d}>
                    {l}
                  </option>
                ))}
                {f.kit && !KIT.some(([d]) => d === f.kit) ? <option value={f.kit}>Every {f.kit} days</option> : null}
              </Select>
            </Field>
            <TextField
              label="Linked account"
              value={f.username}
              onChange={(v) => set('username', v)}
              max={150}
              placeholder="Their username here, if they have one"
            />
          </FieldRow>
        </FormSection>

        <FormSection title="Notes">
          <Field label="How we met">
            <Textarea size="sm" value={f.how_met} onChange={(e) => set('how_met', e.target.value)} maxLength={20000} />
          </Field>
          <Field label="Notes">
            <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={20000} />
          </Field>
        </FormSection>

        <RepeatRows
          title="Custom fields"
          addLabel="Add field"
          items={f.custom_fields}
          onChange={(v) => set('custom_fields', v)}
          blank={() => ({ key: '', value: '' })}
          render={(r, up) => (
            <>
              <Input
                value={r.key}
                onChange={(e) => up({ key: e.target.value })}
                placeholder="Field"
                maxLength={64}
                aria-label="Field name"
              />
              <Input
                value={r.value}
                onChange={(e) => up({ value: e.target.value })}
                placeholder="Value"
                maxLength={1000}
                aria-label="Field value"
              />
            </>
          )}
        />
        {/* Enter in a text field submits */}
        <button type="submit" hidden />
      </form>
      <Confirm
        open={askDiscard}
        title="Discard your changes?"
        body={person ? `Your edits to ${person.name || 'this contact'} haven't been saved.` : "This contact hasn't been saved."}
        confirmLabel="Discard"
        onConfirm={onClose}
        onClose={() => setAskDiscard(false)}
      />
    </Dialog>
  )
}
