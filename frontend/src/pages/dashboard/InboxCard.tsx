// Home › Notifications: the five newest unread, with Mark all read. A failed load says so (with Retry)
// instead of "all caught up".
import { Icon } from '../../components/Icon'
import { NotificationRow, useOpenNotification } from '../../components/NotificationBell'
import { Button, QueryView } from '../../components/ui'
import { DASH_INBOX_LIMIT, useInbox, useReadAll } from '../../lib/queries'
import { CardLink } from '../settings/Card'
import { DashCard } from './DashCard'

export function InboxCard() {
  const inbox = useInbox(true, DASH_INBOX_LIMIT)
  const readAll = useReadAll()
  const open = useOpenNotification()
  const unread = inbox.data?.unread ?? 0
  return (
    <DashCard
      title={
        <>
          Notifications
          {unread > 0 && (
            <span className="ml-0.5 inline-grid h-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1.25 text-2xs font-semibold text-accent-fg tabular-nums">
              {unread}
            </span>
          )}
        </>
      }
      icon="bell"
      titleId="inbox-h"
      actions={
        <>
          <span className="flex-1" />
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => readAll.mutate()}>
              Mark all read
            </Button>
          )}
          <CardLink to="/notifications" label="All notifications" />
        </>
      }
    >
      <div className="p-1">
        <QueryView
          query={inbox}
          isEmpty={(d) => !d.items.length}
          empty={
            <div className="flex items-center justify-center gap-1.5 p-4 text-sm text-muted">
              <Icon name="check" size={14} /> You're all caught up.
            </div>
          }
        >
          {(d) => d.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} compact />)}
        </QueryView>
      </div>
    </DashCard>
  )
}
