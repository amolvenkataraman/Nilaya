import { useEffect, useMemo, useRef, useState } from 'react'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Avatar, ErrorBox, SkeletonRows } from '../../components/ui'
import { toast } from '../../components/toast'
import { useMe, useUpdateMe } from '../../lib/queries'
import { setTheme, useTheme, type ThemePref } from '../../lib/theme'
import type { Me, MePatch } from '../../lib/types'
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

const SECTIONS = [
  { id: 'set-profile', label: 'Profile', icon: 'user' },
  { id: 'set-appearance', label: 'Appearance', icon: 'sun' },
  { id: 'set-keys', label: 'Keyboard shortcuts', icon: 'command' },
  { id: 'set-links', label: 'More', icon: 'external' },
]

/** Highlight the section nearest the top of the viewport. */
function useActiveSection(): [string, (id: string) => void] {
  const [active, setActive] = useState(SECTIONS[0].id)
  const lockUntil = useRef(0) // after a click, keep the clicked item even if the page can't scroll that far
  useEffect(() => {
    // Active = the last section whose heading has passed 30% of the viewport (the first one at the top).
    const onScroll = () => {
      if (Date.now() < lockUntil.current) return
      const line = window.innerHeight * 0.3
      let id = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= line) id = s.id
      }
      setActive(id)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const go = (id: string) => {
    lockUntil.current = Date.now() + 1000
    setActive(id)
    document.getElementById(id)?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return [active, go]
}

export default function SettingsPage() {
  const me = useMe()
  const [active, go] = useActiveSection()
  const sidebar = (
    <SideSection>
      {SECTIONS.map((s) => <SideItem key={s.id} icon={s.icon} label={s.label} active={active === s.id} onClick={() => go(s.id)} />)}
    </SideSection>
  )
  return (
    <AppShell app="settings" sidebar={sidebar}>
    <div className="page set-page">
      {me.isPending ? (
        <div className="set-card"><SkeletonRows rows={5} /></div>
      ) : me.isError && !me.data ? (
        <div className="set-card"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>
      ) : (
        <Profile me={me.data} />
      )}
      <Appearance />
      <Shortcuts />
      <Links />
    </div>
    </AppShell>
  )
}

function Profile({ me }: { me: Me }) {
  const update = useUpdateMe()
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
          <Avatar name={name} src={me.profile_picture} size={3} />
          <div className="grow">
            <div className="name truncate">{name}</div>
            <div className="small muted truncate">@{me.username}{me.email ? ` · ${me.email}` : ''}</div>
          </div>
          <a className="btn sm" href="/accounts/profile/">Change photo</a>
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
          <div className="set-control fill"><textarea id="pf-about" className="textarea" rows={3} value={form.description} onChange={set('description')} maxLength={1000} /></div>
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
        <div className="set-foot">
          <span className="set-status">
            {update.isPending ? 'Saving…' : dirty ? `${dirtyKeys.length} unsaved change${dirtyKeys.length > 1 ? 's' : ''}` : 'All changes saved'}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" disabled={!dirty || update.isPending} onClick={() => setForm(initial)}>Reset</button>
          <button type="submit" className="btn primary" disabled={!dirty || update.isPending}>Save</button>
        </div>
      </form>
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
  ['Go to Home', ['G', 'H']],
  ['Go to Tasks', ['G', 'T']],
  ['Go to Calendar', ['G', 'C']],
  ['Go to Photos', ['G', 'P']],
  ['Go to Places', ['G', 'M']],
  ['Go to Notifications', ['G', 'N']],
  ['Go to Settings', ['G', 'S']],
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

function Links() {
  const links = [
    { href: '/accounts/profile/', icon: 'user', label: 'Profile page and photo', hint: 'Classic view' },
    { href: '/accounts/change_password/', icon: 'settings', label: 'Change password', hint: 'Classic view' },
    { href: '/', icon: 'classic', label: 'Open the classic view', hint: '' },
  ]
  return (
    <section className="set-section" aria-labelledby="set-links">
      <div className="set-section-head">
        <div>
          <h2 id="set-links">More</h2>
          <p>Account pages that still live in the classic view.</p>
        </div>
      </div>
      <div className="set-card">
        {links.map((l) => (
          <a key={l.href} className="set-link" href={l.href}>
            <Icon name={l.icon} />
            <span>{l.label}</span>
            <span className="end small">{l.hint}</span>
            <Icon name="external" size={14} />
          </a>
        ))}
      </div>
    </section>
  )
}
