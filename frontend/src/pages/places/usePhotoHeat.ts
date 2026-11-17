// The Places photo heat layer: on/off remembered per device, the heat filters, and the points for the visible
// box (the same photoPointsQuery as Photos › Map, so an area seen there is already cached).
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { Box } from '../../lib/map/geo'
import { heatParams, useHeatFilter } from '../../lib/map/HeatFilters'
import { type HeatPoint, photoPointsQuery } from '../../lib/map/points'
import { usePref } from '../../lib/storage'

const NONE: HeatPoint[] = []

export function usePhotoHeat() {
  const [on, setOn] = usePref<boolean>('app.places.heat', false)
  const [filter, setFilter] = useHeatFilter()
  const [box, setBox] = useState<Box | null>(null)
  const query = useQuery({ ...photoPointsQuery(box, heatParams(filter)), enabled: on && !!box })
  const points = on ? (query.data ?? NONE) : null
  const total = useMemo(() => (points ?? NONE).reduce((t, p) => t + p.count, 0), [points])
  return { on, toggle: () => setOn((v) => !v), filter, setFilter, box, setBox, points, total, fetching: query.isFetching }
}
