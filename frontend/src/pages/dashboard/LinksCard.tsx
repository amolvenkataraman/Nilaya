// Home › Quick links: one tap to the things people start most (a new event or task, habits progress, …).
import { Link } from 'react-router'
import { AppLogo } from '../../components/AppShell'
import { APPS } from '../../components/nav'
import { DashCard } from './DashCard'

export function LinksCard({ onTask }: { onTask: () => void }) {
  const app = (id: string) => APPS.find((a) => a.id === id)!
  const links: { label: string; sub: string; app: string; to?: string; run?: () => void }[] = [
    { label: 'New event', sub: 'Calendar', app: 'calendar', to: '/calendar?new=1' },
    { label: 'New task', sub: 'Quick add', app: 'tasks', run: onTask },
    { label: 'Progress', sub: 'Habits', app: 'habits', to: '/habits/progress' },
    { label: 'Contacts', sub: 'People', app: 'contacts', to: '/contacts' },
    { label: 'Places', sub: 'Map', app: 'places', to: '/places' },
    { label: 'Albums', sub: 'Photos', app: 'photos', to: '/photos/albums' },
  ]
  const tile =
    'flex min-w-0 items-center gap-2.5 rounded-sm border-0 bg-transparent p-2 text-left text-sm text-fg hover:bg-hover hover:no-underline'
  return (
    <DashCard title="Quick links" icon="zap" titleId="links-h">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-0.5 p-1.5 max-md:grid-cols-2">
        {links.map((l) => {
          const inner = (
            <>
              <AppLogo app={app(l.app)} size={2} />
              <span className="grid min-w-0 leading-[1.25]">
                <span className="truncate">{l.label}</span>
                <span className="truncate text-xs text-muted">{l.sub}</span>
              </span>
            </>
          )
          return l.to ? (
            <Link key={l.label} to={l.to} className={tile}>
              {inner}
            </Link>
          ) : (
            <button key={l.label} type="button" className={tile} onClick={l.run}>
              {inner}
            </button>
          )
        })}
      </div>
    </DashCard>
  )
}
