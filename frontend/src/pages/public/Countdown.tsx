// /calendar/countdown/:id/:which: a live countdown to an event's start or end. Public events and
// events on public calendars for anyone; private events show only as "Busy" (server-side masking).
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ApiError, get } from '../../lib/api'
import { dateFormatter } from '../../lib/dates'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows, useNow } from '../../components/ui'
import { PublicFrame, PublicNotice, usePublicTitle } from './PublicFrame'

interface Countdown { id: string; name: string; target: string; which: 'start' | 'end'; deadline: boolean; busy: boolean }

const when = dateFormatter({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
const pad = (n: number) => String(n).padStart(2, '0')

/** Whole days, hours, minutes and seconds in |ms|. */
function split(ms: number) {
  const s = Math.floor(Math.abs(ms) / 1000)
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 }
}

export default function CountdownPage() {
  const { id = '', which: raw } = useParams()
  const which = raw === 'end' ? 'end' : 'start'
  const q = useQuery({
    queryKey: ['public', 'countdown', id, which],
    queryFn: () => get<Countdown>(`calendar/public/countdown/${encodeURIComponent(id)}`, { which }),
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 3,
  })
  const now = useNow(1000)
  const c = q.data
  usePublicTitle(!c ? 'Countdown' : c.deadline ? `Countdown to ${c.name}` : `Countdown to ${c.which} of ${c.name}`)

  if (q.isPending) return <PublicFrame><div className="card"><SkeletonRows rows={4} /></div></PublicFrame>
  if (!c) {
    return (
      <PublicFrame>
        {q.error instanceof ApiError && q.error.status === 404
          ? <PublicNotice icon="clock" title="This countdown isn't available"><p className="muted small">The event doesn't exist, has no {which} time, or isn't shared publicly.</p></PublicNotice>
          : <div className="card"><ErrorBox error={q.error} retry={() => q.refetch()} /></div>}
      </PublicFrame>
    )
  }
  const target = new Date(c.target)
  const left = target.getTime() - now.getTime()
  const past = left <= 0
  const t = split(left)
  const units: [number, string][] = [[t.days, t.days === 1 ? 'Day' : 'Days'], [t.hours, 'Hours'], [t.minutes, 'Minutes'], [t.seconds, 'Seconds']]
  const verb = c.deadline ? 'Due' : c.which === 'start' ? 'Started' : 'Ended'
  return (
    <PublicFrame>
      <section className={'card cd' + (past ? ' past' : '')}>
        <p className="cd-kicker"><Icon name="clock" size={14} />{c.deadline ? 'Countdown' : `Countdown to ${c.which}`}</p>
        <h1 className="cd-name">{c.name}{c.busy && <span className="chip cd-busy" title="A private event: only its time is shared">Private</span>}</h1>
        <div className="cd-units" role="timer" aria-live="off" aria-label={past ? `${verb} ${t.days} days ${t.hours} hours ago` : `${t.days} days ${t.hours} hours ${t.minutes} minutes left`}>
          {units.map(([n, label], i) => (
            <div key={label} className="cd-unit">
              <span className="cd-num tabular">{i === 0 ? n : pad(n)}</span>
              <span className="cd-label">{label}</span>
            </div>
          ))}
        </div>
        <p className="cd-when">
          {past ? <strong>{verb} {t.days ? `${t.days} day${t.days === 1 ? '' : 's'}, ` : ''}{t.hours} h {pad(t.minutes)} min ago</strong> : <span className="muted">{c.deadline ? 'Due' : c.which === 'start' ? 'Starts' : 'Ends'}</span>}
          <span className="tabular">{when.format(target)}</span>
        </p>
      </section>
    </PublicFrame>
  )
}
