// Settings › More › Place data sources: who made the data behind place names, outlines and place search
// (placewise's packs), with their licences. Several licences (CC BY, StatCan, OGL-Canada) require this credit.
import { useQuery } from '@tanstack/react-query'
import { cardClass, QueryView, SettingsSection, SkeletonRows } from '../../components/ui'
import { placeSourcesQuery } from './api'

export function PlaceSourcesPage() {
  const q = useQuery(placeSourcesQuery())
  return (
    <SettingsSection
      page
      id="set-place-sources"
      title="Place data sources"
      description="Place names, park and city outlines and place search come from these open datasets, through placewise, on this server."
    >
      <QueryView
        query={q}
        skeleton={
          <div className={cardClass}>
            <SkeletonRows rows={6} />
          </div>
        }
      >
        {(d) => (
          <ul className={cardClass}>
            {Object.values(d).map((s) => (
              <li key={s.id} className="grid gap-0.5 px-4 py-2.5 [&+&]:border-t [&+&]:border-border">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-sm font-semibold">
                  {s.name}
                </a>
                <span className="text-xs text-muted">{s.credit}</span>
                <span className="text-xs text-muted">Licence: {s.licence.replace('LicenseRef-', '').replace(/-/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </SettingsSection>
  )
}
