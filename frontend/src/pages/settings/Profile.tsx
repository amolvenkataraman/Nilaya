// Settings › Profile: picture, name, about, birthday, time zone and username, saved together (only the fields
// that changed are sent). A taken username is reported under its field; other failures as a toast.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Avatar, Button, buttonClass, cardClass, Chip, Input, Select, Textarea } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { plural } from '../../lib/format'
import { useUpdateMe } from '../../lib/queries'
import type { Me, MePatch } from '../../lib/types'
import { userPath } from '../users/UserLink'
import { PictureDialog } from './PictureDialog'
import { SaveStatus, SettingRow, SettingsFoot, SettingsSection, SettingValue } from './SettingsSection'

type Form = { username: string; first_name: string; last_name: string; description: string; birthday: string; timezone: string }

const toForm = (me: Me): Form => ({
  username: me.username ?? '',
  first_name: me.first_name ?? '',
  last_name: me.last_name ?? '',
  description: me.description ?? '',
  birthday: me.birthday ?? '',
  timezone: me.timezone ?? '',
})

function timezones(current: string): string[] {
  let zones: string[] = []
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  if (current && !zones.includes(current)) zones = [current, ...zones]
  return zones
}

export function ProfileSection({ me }: { me: Me }) {
  const update = useUpdateMe()
  const [picture, setPicture] = useState(false)
  const [nameError, setNameError] = useState('')
  const initial = useMemo(() => toForm(me), [me])
  const [form, setForm] = useState<Form>(initial)
  useEffect(() => setForm(initial), [initial])
  const zones = useMemo(() => timezones(me.timezone), [me.timezone])
  const dirtyKeys = (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== initial[k])
  const dirty = dirtyKeys.length > 0
  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    if (k === 'username') setNameError('')
    setForm((f) => ({ ...f, [k]: e.target.value }))
  }
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username

  const save = () => {
    const body: MePatch = {}
    for (const k of dirtyKeys) {
      if (k === 'birthday') body.birthday = form.birthday || null
      else body[k] = k === 'description' ? form[k] : form[k].trim()
    }
    if (body.username === '') return setNameError('Choose a username')
    update.mutate(body, {
      onSuccess: () => toast.show(body.username ? `Profile saved. You're now @${body.username}` : 'Profile saved'),
      onError: (e) => {
        const msg = (e as Error).message
        if (body.username && /username/i.test(msg))
          setNameError(msg) // shown under the field
        else toast.error(msg)
      },
    })
  }

  return (
    <SettingsSection id="set-profile" title="Profile" description="How you appear to people you share projects, calendars and albums with.">
      <form
        className={cardClass}
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty) save()
        }}
      >
        <div className="flex items-center gap-3.5 border-b border-border p-4 max-md:flex-wrap">
          <button
            type="button"
            className="relative flex shrink-0 rounded-full border-0 bg-transparent p-0"
            onClick={() => setPicture(true)}
            aria-label="Change profile picture"
            title="Change profile picture"
          >
            <Avatar name={name} src={me.profile_picture} size={3} />
            <span
              className="absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full border border-border bg-surface text-fg shadow-card"
              aria-hidden="true"
            >
              <Icon name="camera" size={12} />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-md font-semibold">{name}</div>
            <div className="truncate text-sm text-muted">
              @{me.username}
              {me.email ? ` · ${me.email}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 gap-2 max-md:w-full">
            <Button size="sm" onClick={() => setPicture(true)}>
              Change photo
            </Button>
            <Link className={buttonClass({ variant: 'ghost', size: 'sm', className: 'hover:no-underline' })} to={userPath(me.username)}>
              View profile
            </Link>
          </div>
        </div>
        <SettingRow label="First name" htmlFor="pf-first" control="fill">
          <Input id="pf-first" value={form.first_name} onChange={set('first_name')} maxLength={150} autoComplete="given-name" />
        </SettingRow>
        <SettingRow label="Last name" htmlFor="pf-last" control="fill">
          <Input id="pf-last" value={form.last_name} onChange={set('last_name')} maxLength={150} autoComplete="family-name" />
        </SettingRow>
        <SettingRow label="About" hint="Shown on your profile" htmlFor="pf-about" align="top" control="fill">
          <Textarea id="pf-about" rows={3} value={form.description} onChange={set('description')} maxLength={512} />
        </SettingRow>
        <SettingRow label="Birthday" htmlFor="pf-bday" control="fill">
          <Input id="pf-bday" type="date" value={form.birthday} onChange={set('birthday')} />
        </SettingRow>
        <SettingRow label="Time zone" hint="Used for reminders and quick-add dates" htmlFor="pf-tz" control="fill">
          <Select id="pf-tz" value={form.timezone} onChange={set('timezone')}>
            {!form.timezone && <option value="">Not set</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow label="Username" hint="Your profile and availability links use it" htmlFor="pf-user" align="top" control="fill">
          <div>
            <Input
              id="pf-user"
              className="aria-invalid:border-danger"
              value={form.username}
              onChange={set('username')}
              maxLength={150}
              autoComplete="username"
              spellCheck={false}
              pattern="[\w.@+\-]+"
              aria-invalid={!!nameError || undefined}
              aria-describedby={nameError ? 'pf-user-err' : undefined}
            />
            {nameError && (
              <p id="pf-user-err" className="mt-1 text-xs text-danger" role="alert">
                {nameError}
              </p>
            )}
          </div>
        </SettingRow>
        <SettingRow label="Email">
          <SettingValue>{me.email || '—'}</SettingValue>
        </SettingRow>
        {(me.groups.length > 0 || me.is_staff) && (
          <SettingRow label="Groups">
            <SettingValue className="flex flex-wrap justify-end gap-1.5 max-md:justify-start">
              {me.is_staff && <Chip tone="accent">Staff</Chip>}
              {me.groups.map((g) => (
                <Chip key={g.id}>{g.name}</Chip>
              ))}
            </SettingValue>
          </SettingRow>
        )}
        <SettingsFoot>
          <SaveStatus>{update.isPending ? 'Saving…' : dirty ? plural(dirtyKeys.length, 'unsaved change') : 'All changes saved'}</SaveStatus>
          <span className="flex-1" />
          <Button disabled={!dirty || update.isPending} onClick={() => setForm(initial)}>
            Reset
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty || update.isPending}>
            Save
          </Button>
        </SettingsFoot>
      </form>
      <PictureDialog open={picture} onClose={() => setPicture(false)} />
    </SettingsSection>
  )
}
