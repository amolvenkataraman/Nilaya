import { useNavigate } from 'react-router'
import { Icon } from './Icon'
import { Menu, SkeletonRows } from './ui'
import { useInbox, useMarkRead, useReadAll, useUnreadCount } from '../lib/queries'
import { appRoute, safeHref } from '../lib/api'
import { fmtStamp, shortStamp } from '../lib/dates'
import type { Notification } from '../lib/types'

/** Open what a notification points at: a new-UI route when one exists, else the classic page. */
export function useOpenNotification() {
  const navigate = useNavigate()
  const mark = useMarkRead()
  return (n: Notification) => {
    if (!n.read) mark.mutate({ id: n.id })
    const route = appRoute(n.url)
    if (route) return navigate(route)
    const href = safeHref(n.url)
    if (href) window.location.assign(href)
  }
}

const SOURCES: Record<string, { icon: string; hue: string }> = {
  calendar: { icon: 'calendar', hue: '#0891b2' }, agenda: { icon: 'calendar', hue: '#0891b2' }, tasks: { icon: 'tasks', hue: '#2563eb' },
  habits: { icon: 'repeat', hue: '#ea580c' }, contacts: { icon: 'users', hue: '#7c3aed' }, photos: { icon: 'photo', hue: '#db2777' },
  places: { icon: 'map', hue: '#16a34a' }, security: { icon: 'shield', hue: '#dc2626' }, system: { icon: 'settings', hue: '#64748b' },
}
export const sourceStyle = (source: string) => SOURCES[source.trim().toLowerCase()] ?? { icon: 'bell', hue: '#64748b' }

/** "now", "5m", "3h", "Yesterday", "Mon", "Nov 3" */
export function ago(iso: string, now = new Date()): string {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  if (mins < 60 * 12) return `${Math.floor(mins / 60)}h`
  return shortStamp(iso, now)
}

/** One notification: source icon, title, 2-line body, relative time, unread dot, hover actions. */
export function NotificationRow({ n, onOpen, compact, onDelete, selected }: {
  n: Notification; onOpen: (n: Notification) => void; compact?: boolean; onDelete?: (n: Notification) => void; selected?: boolean
}) {
  const mark = useMarkRead()
  const src = sourceStyle(n.source)
  const href = safeHref(n.url)
  return (
    <div className={'notif' + (n.read ? '' : ' unread') + (compact ? ' compact' : '') + (selected ? ' selected' : '')} data-notif={n.id}>
      <span className="notif-src" style={{ '--hue': src.hue } as React.CSSProperties} aria-hidden="true"><Icon name={src.icon} size={14} /></span>
      <button className="notif-main" onClick={() => onOpen(n)}>
        <span className="notif-line">
          <span className="notif-title">{n.title}{n.priority >= 15 && <span className={'chip notif-prio' + (n.priority >= 20 ? ' danger' : ' warning')}>{n.priority >= 20 ? 'Urgent' : 'High'}</span>}</span>
          <time className="notif-time" dateTime={n.created_on} title={fmtStamp(n.created_on)}>{ago(n.created_on)}</time>
        </span>
        {n.body && <span className="notif-body">{n.body}</span>}
        {n.source && <span className="notif-meta">{n.source}</span>}
      </button>
      <span className="notif-dot" aria-label={n.read ? undefined : 'Unread'} />
      <span className="notif-acts">
        <button className="btn ghost icon sm" onClick={() => mark.mutate({ id: n.id, read: !n.read })} aria-label={n.read ? 'Mark as unread' : 'Mark as read'} title={n.read ? 'Mark as unread (E)' : 'Mark as read (E)'}>
          <Icon name={n.read ? 'mail' : 'check'} size={14} />
        </button>
        {href && !compact && (
          <button className="btn ghost icon sm" onClick={() => onOpen(n)} aria-label="Open link" title="Open (Enter)"><Icon name="external" size={14} /></button>
        )}
        {onDelete && (
          <button className="btn ghost icon sm" onClick={() => onDelete(n)} aria-label="Delete notification" title="Delete (#)"><Icon name="trash" size={14} /></button>
        )}
      </span>
    </div>
  )
}

export function NotificationBell() {
  const unread = useUnreadCount().data?.unread ?? 0
  const navigate = useNavigate()
  const open = useOpenNotification()
  return (
    <Menu
      align="end"
      width="min(24rem, calc(100vw - 16px))"
      label="Notifications"
      trigger={(p) => (
        <button {...p} className="btn ghost icon bell" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications">
          <Icon name="bell" size={18} />
          {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    >
      {(close) => <BellPanel close={close} onOpen={(n) => (close(), open(n))} onAll={() => (close(), navigate('/notifications'))} />}
    </Menu>
  )
}

function BellPanel({ onOpen, onAll }: { close: () => void; onOpen: (n: Notification) => void; onAll: () => void }) {
  const inbox = useInbox(false, 8)
  const readAll = useReadAll()
  const unread = inbox.data?.unread ?? 0
  return (
    <div className="bell-panel">
      <div className="bell-head">
        <strong>Notifications</strong>
        {unread > 0 && <span className="chip accent">{unread} new</span>}
        <span className="spacer" />
        <button className="btn ghost sm" disabled={!unread} onClick={() => readAll.mutate()}>Mark all read</button>
      </div>
      <div className="bell-list">
        {inbox.isPending ? (
          <SkeletonRows rows={4} />
        ) : !inbox.data?.items.length ? (
          <div className="empty">No notifications yet.</div>
        ) : (
          inbox.data.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={onOpen} compact />)
        )}
      </div>
      <button role="menuitem" className="bell-foot" onClick={onAll}>
        Open inbox <Icon name="arrowRight" size={14} />
      </button>
    </div>
  )
}
