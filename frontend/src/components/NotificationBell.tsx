// The bell in the top bar (unread badge, the latest notifications) and the notification row the inbox and Home use.
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import { Icon } from './Icon'
import { Button, Chip, EmptyState, Popover, QueryView, SkeletonRows, buttonClass } from './ui'
import { cn } from '../lib/cn'
import { useInbox, useMarkRead, useReadAll, useUnreadCount } from '../lib/queries'
import { appRoute, safeHref } from '../lib/api'
import { fmtStamp, shortStamp } from '../lib/dates'
import type { Notification } from '../lib/types'

/** Open what a notification points at: in the app when it's an app route, else a full page load
 *  (old URLs are redirected by the server; other sites open as links). */
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
  calendar: { icon: 'calendar', hue: '#0891b2' },
  agenda: { icon: 'calendar', hue: '#0891b2' },
  tasks: { icon: 'tasks', hue: '#2563eb' },
  habits: { icon: 'repeat', hue: '#ea580c' },
  contacts: { icon: 'users', hue: '#7c3aed' },
  photos: { icon: 'photo', hue: '#db2777' },
  places: { icon: 'map', hue: '#16a34a' },
  security: { icon: 'shield', hue: '#dc2626' },
  system: { icon: 'settings', hue: '#64748b' },
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

/** One notification: source icon, title, 2-line body, relative time, unread dot, hover actions.
 *  `notif` and `data-notif` stay as hooks (the inbox scrolls to the selected row by its data-notif). */
export function NotificationRow({
  n,
  onOpen,
  compact,
  onDelete,
  selected,
}: {
  n: Notification
  onOpen: (n: Notification) => void
  compact?: boolean
  onDelete?: (n: Notification) => void
  selected?: boolean
}) {
  const mark = useMarkRead()
  const src = sourceStyle(n.source)
  const href = safeHref(n.url)
  const act = buttonClass({ variant: 'ghost', size: 'sm', icon: true })
  return (
    <div
      className={cn(
        'notif group/notif relative flex items-start gap-2.5 rounded-sm hover:bg-hover',
        compact ? 'py-2 pr-1.5 pl-2' : 'py-2.5 pr-2 pl-2.5',
        selected && 'bg-hover shadow-[inset_2px_0_0_var(--app-accent)]',
      )}
      data-notif={n.id}
    >
      <span
        className={cn(
          'grid size-7 flex-none place-items-center rounded-[30%] text-(--hue)',
          'bg-[color-mix(in_srgb,var(--hue)_13%,var(--app-surface))]',
          'dark:bg-[color-mix(in_srgb,var(--hue)_24%,var(--app-surface))] dark:text-[color-mix(in_srgb,var(--hue)_60%,white)]',
        )}
        style={{ '--hue': src.hue } as CSSProperties}
        aria-hidden="true"
      >
        <Icon name={src.icon} size={14} />
      </span>
      <button
        type="button"
        className="grid min-w-0 flex-1 cursor-pointer gap-0.5 border-0 bg-transparent p-0 text-left"
        onClick={() => onOpen(n)}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 text-sm leading-[1.35] [overflow-wrap:anywhere]',
              n.read ? 'text-muted' : 'font-semibold text-fg',
            )}
          >
            {n.title}
            {n.priority >= 15 && (
              <Chip tone={n.priority >= 20 ? 'danger' : 'warning'} size="xs" className="ml-1.5 align-[1px]">
                {n.priority >= 20 ? 'Urgent' : 'High'}
              </Chip>
            )}
          </span>
          <time className="flex-none text-xs text-muted tabular-nums" dateTime={n.created_on} title={fmtStamp(n.created_on)}>
            {ago(n.created_on)}
          </time>
        </span>
        {n.body && <span className="line-clamp-2 text-xs whitespace-pre-line text-muted [overflow-wrap:anywhere]">{n.body}</span>}
        {n.source && <span className="text-2xs text-muted opacity-85">{n.source}</span>}
      </button>
      <span className={cn('mt-1.5 size-2 flex-none rounded-full', !n.read && 'bg-accent')}>
        {!n.read && <span className="sr-only">Unread</span>}
      </span>
      <span
        className={cn(
          'absolute top-1.5 right-1.5 hidden gap-px rounded-sm bg-surface p-0.5 shadow-[0_0_0_1px_var(--app-border),0_2px_6px_rgba(16,24,40,0.08)]',
          'group-hover/notif:flex group-focus-within/notif:flex touch:static touch:flex touch:bg-transparent touch:shadow-none',
          selected && 'flex',
        )}
      >
        <button
          type="button"
          className={act}
          onClick={() => mark.mutate({ id: n.id, read: !n.read })}
          aria-label={n.read ? 'Mark as unread' : 'Mark as read'}
          title={n.read ? 'Mark as unread (E)' : 'Mark as read (E)'}
        >
          <Icon name={n.read ? 'mail' : 'check'} size={14} />
        </button>
        {href && !compact && (
          <button type="button" className={act} onClick={() => onOpen(n)} aria-label="Open link" title="Open (Enter)">
            <Icon name="external" size={14} />
          </button>
        )}
        {onDelete && (
          <button type="button" className={act} onClick={() => onDelete(n)} aria-label="Delete notification" title="Delete (#)">
            <Icon name="trash" size={14} />
          </button>
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
    <Popover
      align="end"
      width="min(24rem, calc(100vw - 16px))"
      label="Notifications"
      flush
      trigger={(p) => (
        <button
          {...p}
          type="button"
          className={buttonClass({ variant: 'ghost', icon: true, className: 'relative' })}
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          title="Notifications"
        >
          <Icon name="bell" size={18} />
          {unread > 0 && (
            <span className="absolute top-0.5 right-px grid h-3.75 min-w-3.75 place-items-center rounded-full bg-danger px-0.75 text-[0.5625rem] font-bold text-white tabular-nums shadow-[0_0_0_2px_var(--app-surface)]">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <BellPanel
          onOpen={(n) => {
            close()
            open(n)
          }}
          onAll={() => {
            close()
            navigate('/notifications')
          }}
        />
      )}
    </Popover>
  )
}

function BellPanel({ onOpen, onAll }: { onOpen: (n: Notification) => void; onAll: () => void }) {
  const inbox = useInbox(false, 8)
  const readAll = useReadAll()
  const unread = inbox.data?.unread ?? 0
  return (
    <div className="flex max-h-[min(32rem,75vh)] flex-col">
      <div className="flex items-center gap-2 border-b border-border py-2.5 pr-2 pl-3.5 text-sm">
        <strong>Notifications</strong>
        {unread > 0 && <Chip tone="accent">{unread} new</Chip>}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" disabled={!unread} onClick={() => readAll.mutate()}>
          Mark all read
        </Button>
      </div>
      <div className="overflow-auto p-1">
        <QueryView
          query={inbox}
          skeleton={<SkeletonRows rows={4} />}
          isEmpty={(d) => !d.items.length}
          empty={<EmptyState>No notifications yet.</EmptyState>}
        >
          {(d) => d.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={onOpen} compact />)}
        </QueryView>
      </div>
      <button
        type="button"
        role="menuitem"
        className="flex h-10 items-center justify-center gap-1.5 rounded-b-md border-0 border-t border-border bg-bg text-sm font-medium text-accent hover:bg-hover"
        onClick={onAll}
      >
        Open inbox <Icon name="arrowRight" size={14} />
      </button>
    </div>
  )
}
