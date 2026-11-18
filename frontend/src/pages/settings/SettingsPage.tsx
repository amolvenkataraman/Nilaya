// Settings: one scrolling page of sections (profile, password, appearance, shortcuts, developer tools, staff
// links) with a sidebar that follows the scroll, plus the staff Usage page at /settings/usage.
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { AppShell, SideItem, SideSection, sideItemClass } from '../../components/AppShell'
import { Icon, type IconName } from '../../components/Icon'
import { cardClass, ErrorBox, pageClass, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { useMe } from '../../lib/queries'
import { ApiKeysSection } from './ApiKeys'
import { AppearanceSection } from './Appearance'
import { FeedsSection } from './Feeds'
import { GuidesSection } from './Guides'
import { AdminSection, MoreSection } from './MoreLinks'
import { PasswordSection } from './Password'
import { ProfileSection } from './Profile'
import { ShortcutsSection } from './Shortcuts'
import { UsagePage } from './Usage'

interface SectionDef {
  id: string
  label: string
  icon: IconName
}
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
  const item = (s: SectionDef) => (
    <SideItem key={s.id} icon={s.icon} label={s.label} active={!usage && active === s.id} onClick={() => open(s.id)} />
  )
  const sidebar = (
    <>
      <SideSection>{ACCOUNT.map(item)}</SideSection>
      <SideSection title="Developer">{DEVELOPER.map(item)}</SideSection>
      {staff && (
        <SideSection title="Admin">
          <SideItem icon="chart" label="Usage" active={usage} to="/settings/usage" />
          <a className={sideItemClass()} href="/admin/">
            <Icon name="wrench" size={16} />
            <span className="min-w-0 flex-1 truncate">Admin site</span>
            <Icon name="external" size={12} />
          </a>
        </SideSection>
      )}
      <SideSection>{item(MORE)}</SideSection>
    </>
  )
  const loading = (
    <div className={cardClass}>
      <SkeletonRows rows={5} />
    </div>
  )
  return (
    <AppShell app="settings" sidebar={sidebar} pageTitle={usage ? 'Usage' : 'Settings'}>
      <div className={cn(pageClass(true), usage ? 'max-w-[72rem]' : 'max-w-[52rem]')}>
        {usage ? (
          me.isPending ? (
            loading
          ) : staff ? (
            <UsagePage />
          ) : (
            <ErrorBox error={me.error ?? new Error('Usage is visible to staff only.')} />
          )
        ) : (
          <>
            {me.data ? (
              <ProfileSection me={me.data} />
            ) : me.isPending ? (
              loading
            ) : (
              <div className={cardClass}>
                <ErrorBox error={me.error} retry={() => me.refetch()} />
              </div>
            )}
            <PasswordSection />
            <AppearanceSection />
            <ShortcutsSection />
            <ApiKeysSection />
            <FeedsSection />
            <GuidesSection />
            {staff && <AdminSection />}
            <MoreSection username={me.data?.username} />
          </>
        )}
      </div>
    </AppShell>
  )
}
