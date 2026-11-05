import { useSearchParams } from 'react-router'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { useUnreadCount } from '../../lib/queries'
import { InboxTab } from './Inbox'
import { ChannelsTab } from './Channels'
import { AppReminders, RemindersTab } from './Reminders'
import '../settings/settings.css'
import './notifications.css'

const TABS = ['inbox', 'channels', 'reminders'] as const
type Tab = (typeof TABS)[number]

export default function NotificationsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'inbox'
  const unreadOnly = tab === 'inbox' && params.get('unread') === '1'
  const unread = useUnreadCount().data?.unread ?? 0
  // URL state: ?tab=channels|reminders, and ?unread=1 for the unread inbox.
  const go = (next: Tab, unreadFilter = false) => {
    const p = new URLSearchParams()
    if (next !== 'inbox') p.set('tab', next)
    if (next === 'inbox' && unreadFilter) p.set('unread', '1')
    setParams(p)
  }
  const sidebar = (
    <>
      <SideSection>
        <SideItem icon="inbox" label="Inbox" active={tab === 'inbox' && !unreadOnly} onClick={() => go('inbox')} />
        <SideItem icon="bell" label="Unread" count={unread || undefined} active={unreadOnly} onClick={() => go('inbox', true)} />
      </SideSection>
      <SideSection title="Settings">
        <SideItem icon="send" label="Delivery channels" active={tab === 'channels'} onClick={() => go('channels')} />
        <SideItem icon="clock" label="Reminders" active={tab === 'reminders'} onClick={() => go('reminders')} />
      </SideSection>
    </>
  )
  return (
    <AppShell app="notifications" sidebar={sidebar}>
      <div className="page set-page notif-page">
        {tab === 'inbox' && <InboxTab unreadOnly={unreadOnly} />}
        {tab === 'channels' && <ChannelsTab />}
        {tab === 'reminders' && <><RemindersTab /><AppReminders /></>}
      </div>
    </AppShell>
  )
}
