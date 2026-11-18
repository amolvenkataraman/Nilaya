// What the detail side shows when nobody is open (desktop only): counts, upcoming birthdays, who's due a
// catch-up, the shortcuts and where contacts came from. With no contacts at all, a way to import some.
import type { ReactNode } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { Button, SkeletonRows } from '../../components/ui'
import { fmtDate, parseDayKey } from '../../lib/dates'
import type { ContactStats } from './api'
import { detailPane } from './detailPane'
import { SectionLabel } from './SectionLabel'

const miniRow = 'flex w-full items-baseline gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-sm text-fg hover:bg-hover'

export function ContactsOverview({
  stats,
  onOpen,
  onImport,
}: {
  stats?: ContactStats
  onOpen: (id: string) => void
  onImport: () => void
}) {
  if (!stats)
    return (
      <section className={detailPane()}>
        <SkeletonRows rows={5} />
      </section>
    )
  if (!stats.total)
    return (
      <div className="grid h-full content-center justify-items-center gap-3 p-8 text-center text-sm text-muted max-md:hidden">
        <Icon name="users" size={32} />
        <span>Your people, in one place. Add someone by hand, or import from Google, Outlook, LinkedIn, a phone (vCard) or any CSV.</span>
        <Button onClick={onImport}>
          <Icon name="arrowDown" size={14} />
          Import a file
        </Button>
      </div>
    )
  const bdays = stats.upcoming_birthdays ?? []
  const due = stats.overdue_people ?? []
  return (
    <section className={detailPane('gap-5')} aria-label="Overview">
      <div className="grid grid-cols-4 gap-2 max-md:grid-cols-2">
        <Stat n={stats.total} label="Contacts" />
        <Stat n={stats.favorites} label="Favourites" />
        <Stat n={stats.keep_in_touch} label="Keeping in touch" />
        <Stat n={stats.recent} label="Added recently" />
      </div>
      <Block icon="gift" title="Upcoming birthdays">
        {bdays.length === 0 ? (
          <p className="text-sm text-muted">None in the next 30 days.</p>
        ) : (
          <ul className="grid gap-px">
            {bdays.map((b) => (
              <li key={b.id}>
                <button type="button" className={miniRow} onClick={() => onOpen(b.id)}>
                  <span className="min-w-0 flex-auto truncate">{b.name}</span>
                  <span className="text-xs text-muted">
                    {b.days === 0
                      ? 'Today'
                      : b.days === 1
                        ? 'Tomorrow'
                        : fmtDate(parseDayKey(b.date), { weekday: 'short', month: 'short', day: 'numeric' })}
                    {b.age ? ` · turns ${b.age}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block icon="clock" title="Catch up">
        {due.length === 0 ? (
          <p className="text-sm text-muted">You're up to date with everyone.</p>
        ) : (
          <ul className="grid gap-px">
            {due.map((d) => (
              <li key={d.id}>
                <button type="button" className={miniRow} onClick={() => onOpen(d.id)}>
                  <span className="min-w-0 flex-auto truncate">{d.name}</span>
                  <span className={d.days_overdue > 0 ? 'text-xs text-danger' : 'text-xs text-muted'}>
                    {d.days_overdue > 0 ? `${d.days_overdue} days overdue` : 'Due today'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <p className="mt-1 text-xs text-muted [&_.kbd]:mr-0.5">
        <span className="kbd">/</span> search · <span className="kbd">N</span> new · <span className="kbd">J</span>
        <span className="kbd">K</span> move · <span className="kbd">E</span> edit
      </p>
      {stats.sources && Object.keys(stats.sources).length > 0 && (
        <p className="text-xs text-muted">
          Sources:{' '}
          {Object.entries(stats.sources)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}
        </p>
      )}
    </section>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="grid gap-0.5 rounded-md border border-border bg-surface p-3">
      <strong className="text-lg font-semibold tabular-nums">{n}</strong>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

function Block({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <SectionLabel>
        <Icon name={icon} size={13} />
        {title}
      </SectionLabel>
      {children}
    </div>
  )
}
