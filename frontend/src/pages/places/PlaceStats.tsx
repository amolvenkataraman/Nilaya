// The Stats tab: totals, the status split as a stacked bar, places per category, and the most visited places
// (days with your photos within 150 m).
import { HBars } from '../../components/charts'
import { QueryView, SkeletonRows } from '../../components/ui'
import { STATUSES, usePlaceStats } from './api'
import { fmtDay, PHOTO_RADIUS_M } from './placeText'
import { STATUS_BG, StatusDot } from './StatusDot'

const h3 = 'mb-2 flex gap-1.5 text-sm'

export function StatsTab({ onSelect, catLabel }: { onSelect: (id: string) => void; catLabel: (k: string) => string }) {
  const q = usePlaceStats(true)
  return (
    <QueryView query={q} skeleton={<SkeletonRows rows={6} />}>
      {(s) => {
        const total = Math.max(1, s.total)
        return (
          <div className="grid gap-5 overflow-auto px-4 pt-3 pb-6">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['Places', s.total],
                  ['Visited', s.by_status.visited ?? 0],
                  ['Want to go', s.by_status.want_to_go ?? 0],
                ] as const
              ).map(([l, n]) => (
                <div key={l} className="grid gap-px rounded-sm border border-border bg-bg px-2.5 py-2 text-xs text-muted">
                  <strong className="text-md text-fg tabular-nums">{n.toLocaleString()}</strong>
                  <span>{l}</span>
                </div>
              ))}
            </div>
            <section>
              <h3 className={h3}>
                By status <span className="text-muted">{s.total}</span>
              </h3>
              <div
                className="flex h-2.5 gap-0.5 overflow-hidden rounded-xs bg-surface-2"
                role="img"
                aria-label={STATUSES.map((st) => `${st.label} ${s.by_status[st.key] ?? 0}`).join(', ')}
              >
                {STATUSES.map((st) =>
                  s.by_status[st.key] ? (
                    <span key={st.key} className={STATUS_BG[st.key]} style={{ width: `${(s.by_status[st.key] / total) * 100}%` }} />
                  ) : null,
                )}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {STATUSES.map((st) => (
                  <li key={st.key} className="inline-flex items-center gap-1.5">
                    <StatusDot status={st.key} />
                    {st.label}
                    <strong className="tabular-nums">{s.by_status[st.key] ?? 0}</strong>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className={h3}>By category</h3>
              <HBars items={s.by_category.map((c) => ({ key: c.key, label: c.label, value: c.count }))} format={(v) => String(v)} />
            </section>
            <section>
              <h3 className={h3}>
                Most visited <span className="text-xs text-muted">days with your photos within {PHOTO_RADIUS_M} m</span>
              </h3>
              {s.most_visited.length === 0 ? (
                <p className="text-sm text-muted">No visits yet: they come from photos taken at your places.</p>
              ) : (
                <ol className="m-0 grid list-none gap-px p-0">
                  {s.most_visited.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="flex w-full items-baseline gap-2 rounded-sm border-0 bg-transparent px-1 py-1.5 text-left text-sm text-fg hover:bg-hover"
                        onClick={() => onSelect(m.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {m.name}
                          <span className="text-xs text-muted"> · {catLabel(m.category)}</span>
                        </span>
                        <span className="text-sm whitespace-nowrap tabular-nums">{m.visits} visits</span>
                        {m.last_visit && <span className="text-xs text-muted">last {fmtDay(m.last_visit)}</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )
      }}
    </QueryView>
  )
}
