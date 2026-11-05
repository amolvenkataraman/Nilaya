import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { APPS } from '../../components/nav'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Avatar, ErrorBox, SkeletonRows } from '../../components/ui'
import { toast } from '../../components/toast'
import { useMe, useUpdateMe } from '../../lib/queries'
import { setTheme, useTheme, type ThemePref } from '../../lib/theme'
import type { Me, MePatch } from '../../lib/types'
import { userPath } from '../users/UserLink'
import { PictureDialog } from './PictureDialog'
import { PasswordSection } from './Password'
import { ApiKeysSection, FeedsSection, GuidesSection } from './Developer'
import { UsagePage } from './Usage'
import './settings.css'

type Form = { first_name: string; last_name: string; description: string; birthday: string; timezone: string }

const toForm = (me: Me): Form => ({
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

interface SectionDef { id: string; label: string; icon: string }
const ACCOUNT: SectionDef[] = [
  { id: 'set-profile', label: 'Profile', icon: 'user' },
  { id: 'set-password', label: 'Password', icon: 'shield' },
  { id: 'set-appearance', label: 'Appearance', icon: 'sun' },
  { id: 'set-keys', label: 'Keyboard shortcuts', icon: 'command' },
]
const DEVELOPER: SectionDef[] = [
  { id: 'set-api', label: 'API keys', icon: 'code' },
  { id: 'set-feeds', label: 'Calendar feeds', icon: 'calendar' },
  { id: 'set-guides', label: 'Guides', icon: 'book' },
]
const ADMIN: SectionDef = { id: 'set-admin', label: 'Admin', icon: 'wrench' }
const MORE: SectionDef = { id: 'set-links', label: 'More', icon: 'external' }

/** Highlight the section nearest the top of the viewport; `#set-…` in the URL scrolls to that section. */
function useActiveSection(ids: string[], enabled: boolean): [string, (id: string) => void] {
  const [active, setActive] = useState(ids[0])
  const lockUntil = useRef(0) // after a click, keep the clicked item even if the page can't scroll that far
  const key = ids.join(',')
  const { hash } = useLocation()
  useEffect(() => {
    if (!enabled) return
    // Active = the last section whose heading has passed 30% of the viewport (the first one at the top).
    const list = key.split(',')
    const onScroll = () => {
      if (Date.now() < lockUntil.current) return
      const line = window.innerHeight * 0.3
      let id = list[0]
      for (const s of list) {
        const el = document.getElementById(s)
        if (el && el.getBoundingClientRect().top <= line) id = s
      }
      setActive(id)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [key, enabled])
  const go = (id: string) => {
    lockUntil.current = Date.now() + 1000
    setActive(id)
    document.getElementById(id)?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  useEffect(() => {
    if (!enabled || !hash) return
    const id = decodeURIComponent(hash.slice(1))
    // Sections below the profile render after /me loads: wait a frame for layout.
    const t = setTimeout(() => {
      lockUntil.current = Date.now() + 1000
      setActive(id)
      document.getElementById(id)?.closest('section')?.scrollIntoView({ block: 'start' })
    }, 50)
    return () => clearTimeout(t)
  }, [hash, enabled])
  return [active, go]
}

export default function SettingsPage() {
  const me = useMe()
  const sub = useParams()['*'] ?? ''
  const navigate = useNavigate()
  const staff = !!me.data?.is_staff
  const usage = sub === 'usage'
  const ids = [...ACCOUNT, ...DEVELOPER, ...(staff ? [ADMIN] : []), MORE].map((s) => s.id)
  const [active, go] = useActiveSection(ids, !usage)
  const open = (id: string) => (usage ? navigate(`/settings#${id}`) : go(id))
  const item = (s: SectionDef) => <SideItem key={s.id} icon={s.icon} label={s.label} active={!usage && active === s.id} onClick={() => open(s.id)} />
  const sidebar = (
    <>
      <SideSection>{ACCOUNT.map(item)}</SideSection>
      <SideSection title="Developer">{DEVELOPER.map(item)}</SideSection>
      {staff && (
        <SideSection title="Admin">
          <SideItem icon="chart" label="Usage" active={usage} to="/settings/usage" />
          <a className="side-item" href="/admin/">
            <Icon name="wrench" size={16} />
            <span className="grow truncate">Admin site</span>
            <Icon name="external" size={12} />
          </a>
        </SideSection>
      )}
      <SideSection>{item(MORE)}</SideSection>
    </>
  )
  return (
    <AppShell app="settings" sidebar={sidebar} pageTitle={usage ? 'Usage' : 'Settings'}>
    <div className={'page set-page' + (usage ? ' usage-page' : '')}>
      {usage ? (
        me.isPending ? <div className="set-card"><SkeletonRows rows={5} /></div>
          : staff ? <UsagePage />
          : <ErrorBox error={me.error ?? new Error('Usage is visible to staff only.')} />
      ) : (
        <>
          {me.isPending ? (
            <div className="set-card"><SkeletonRows rows={5} /></div>
          ) : me.isError && !me.data ? (
            <div className="set-card"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>
          ) : (
            <Profile me={me.data} />
          )}
          <PasswordSection />
          <Appearance />
          <Shortcuts />
          <ApiKeysSection />
          <FeedsSection />
          <GuidesSection />
          {staff && <AdminSection />}
          <Links username={me.data?.username} />
        </>
      )}
    </div>
    </AppShell>
  )
}

function Profile({ me }: { me: Me }) {
  const update = useUpdateMe()
  const [picture, setPicture] = useState(false)
  const initial = useMemo(() => toForm(me), [me])
  const [form, setForm] = useState<Form>(initial)
  useEffect(() => setForm(initial), [initial])
  const zones = useMemo(() => timezones(me.timezone), [me.timezone])
  const dirtyKeys = (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== initial[k])
  const dirty = dirtyKeys.length > 0
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username

  const save = () => {
    const body: MePatch = {}
    for (const k of dirtyKeys) {
      if (k === 'birthday') body.birthday = form.birthday || null
      else body[k] = k === 'description' ? form[k] : form[k].trim()
    }
    update.mutate(body, {
      onSuccess: () => toast.show('Profile saved'),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  return (
    <section className="set-section" aria-labelledby="set-profile">
      <div className="set-section-head">
        <div>
          <h2 id="set-profile">Profile</h2>
          <p>How you appear to people you share projects, calendars and albums with.</p>
        </div>
      </div>
      <form
        className="set-card"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty) save()
        }}
      >
        <div className="profile-head">
          <button type="button" className="profile-pic" onClick={() => setPicture(true)} aria-label="Change profile picture" title="Change profile picture">
            <Avatar name={name} src={me.profile_picture} size={3} />
            <span className="profile-pic-cam" aria-hidden="true"><Icon name="camera" size={12} /></span>
          </button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="name truncate">{name}</div>
            <div className="small muted truncate">@{me.username}{me.email ? ` · ${me.email}` : ''}</div>
          </div>
          <div className="profile-actions">
            <button type="button" className="btn sm" onClick={() => setPicture(true)}>Change photo</button>
            <Link className="btn ghost sm" to={userPath(me.username)}>View profile</Link>
          </div>
        </div>
        <div className="set-row">
          <label className="set-label" htmlFor="pf-first">First name</label>
          <div className="set-control fill"><input id="pf-first" className="input" value={form.first_name} onChange={set('first_name')} maxLength={150} autoComplete="given-name" /></div>
        </div>
        <div className="set-row">
          <label className="set-label" htmlFor="pf-last">Last name</label>
          <div className="set-control fill"><input id="pf-last" className="input" value={form.last_name} onChange={set('last_name')} maxLength={150} autoComplete="family-name" /></div>
        </div>
        <div className="set-row top">
          <label className="set-label" htmlFor="pf-about">About<small>Shown on your profile</small></label>
          <div className="set-control fill"><textarea id="pf-about" className="textarea" rows={3} value={form.description} onChange={set('description')} maxLength={512} /></div>
        </div>
        <div className="set-row">
          <label className="set-label" htmlFor="pf-bday">Birthday</label>
          <div className="set-control fill"><input id="pf-bday" type="date" className="input" value={form.birthday} onChange={set('birthday')} /></div>
        </div>
        <div className="set-row">
          <label className="set-label" htmlFor="pf-tz">Time zone<small>Used for reminders and quick-add dates</small></label>
          <div className="set-control fill">
            <select id="pf-tz" className="select" value={form.timezone} onChange={set('timezone')}>
              {!form.timezone && <option value="">Not set</option>}
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>
        <div className="set-row">
          <span className="set-label">Username</span>
          <span className="set-value">{me.username}</span>
        </div>
        <div className="set-row">
          <span className="set-label">Email</span>
          <span className="set-value">{me.email || '—'}</span>
        </div>
        {(me.groups.length > 0 || me.is_staff) && (
          <div className="set-row">
            <span className="set-label">Groups</span>
            <span className="set-value profile-groups">
              {me.is_staff && <span className="chip accent">Staff</span>}
              {me.groups.map((g) => <span key={g.id} className="chip">{g.name}</span>)}
            </span>
          </div>
        )}
        <div className="set-foot">
          <span className="set-status">
            {update.isPending ? 'Saving…' : dirty ? `${dirtyKeys.length} unsaved change${dirtyKeys.length > 1 ? 's' : ''}` : 'All changes saved'}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" disabled={!dirty || update.isPending} onClick={() => setForm(initial)}>Reset</button>
          <button type="submit" className="btn primary" disabled={!dirty || update.isPending}>Save</button>
        </div>
      </form>
      <PictureDialog open={picture} onClose={() => setPicture(false)} />
    </section>
  )
}

function Appearance() {
  const { pref } = useTheme()
  const options: { value: ThemePref; label: string; icon: string }[] = [
    { value: 'system', label: 'System', icon: 'monitor' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ]
  return (
    <section className="set-section" aria-labelledby="set-appearance">
      <div className="set-section-head">
        <div>
          <h2 id="set-appearance">Appearance</h2>
          <p>Saved in this browser only, so each device can have its own theme. Shared with the classic view.</p>
        </div>
      </div>
      <div className="set-card">
        <div className="set-row inline">
          <span className="set-label">Theme</span>
          <div className="set-control">
            <div className="seg" role="group" aria-label="Theme">
              {options.map((o) => (
                <button key={o.value} type="button" aria-pressed={pref === o.value} onClick={() => setTheme(o.value)}>
                  <Icon name={o.icon} size={14} />
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const SHORTCUTS: [string, string[]][] = [
  ['Search or jump to', ['Ctrl', 'K']],
  ['Search', ['/']],
  ['New task', ['Q']],
  ...APPS.filter((a) => a.key).map((a) => [`Go to ${a.label}`, ['G', a.key!.toUpperCase()]] as [string, string[]]),
]

function Shortcuts() {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <section className="set-section" aria-labelledby="set-keys">
      <div className="set-section-head">
        <div>
          <h2 id="set-keys">Keyboard shortcuts</h2>
          <p>Letters work when you're not typing in a field.</p>
        </div>
      </div>
      <div className="set-card" style={{ overflow: 'hidden' }}>
        <div className="shortcut-grid">
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label} className="shortcut">
              <span>{label}</span>
              <span className="keys">{keys.map((k) => <span key={k} className="kbd">{k === 'Ctrl' && mac ? '⌘' : k}</span>)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function AdminSection() {
  return (
    <section className="set-section" aria-labelledby="set-admin">
      <div className="set-section-head">
        <div>
          <h2 id="set-admin">Admin</h2>
          <p>Staff only.</p>
        </div>
      </div>
      <div className="set-card">
        <Link className="set-link" to="/settings/usage">
          <Icon name="chart" />
          <span>Usage</span>
          <span className="end small">Page views and API calls per person and app</span>
        </Link>
        <a className="set-link" href="/admin/">
          <Icon name="wrench" />
          <span>Admin site</span>
          <span className="end small">Users, groups and all data</span>
          <Icon name="external" size={14} />
        </a>
      </div>
    </section>
  )
}

function Links({ username }: { username?: string }) {
  return (
    <section className="set-section" aria-labelledby="set-links">
      <div className="set-section-head">
        <div>
          <h2 id="set-links">More</h2>
        </div>
      </div>
      <div className="set-card">
        {username && (
          <Link className="set-link" to={userPath(username)}>
            <Icon name="user" />
            <span>Your profile</span>
            <span className="end small">As others see it</span>
          </Link>
        )}
        <a className="set-link" href="/">
          <Icon name="classic" />
          <span>Open the classic view</span>
          <span className="end small" />
          <Icon name="external" size={14} />
        </a>
      </div>
    </section>
  )
}
