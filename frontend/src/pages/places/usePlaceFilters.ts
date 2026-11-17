// What Places shows, from the URL (?group, ?category, ?status, ?rating, ?place, ?tab) and the search text: the
// filtered list (nearest first once your location is known) and the sidebar's counts, all from one pass over the
// groups that are on, recomputed only when the pins or a filter change (not on every keystroke of an unrelated
// state).
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useDebounced } from '../../components/ui'
import { distanceM } from '../../lib/map/geo'
import { type Pin, type PlaceStatus, STATUSES, statusOf, useVisibleTextMatches } from './api'
import type { Pos } from './PlaceDetail'

export type Tab = 'places' | 'suggested' | 'stats'

export interface Counts {
  status: Record<PlaceStatus, number>
  /** Places rated at least 3, 4, 5. */
  rating: Record<3 | 4 | 5, number>
  category: Map<string, number>
}

/** The sidebar's facets in one pass over the selected group's places. */
export function countPlaces(list: Pin[]): Counts {
  const c: Counts = { status: { saved: 0, want_to_go: 0, visited: 0 }, rating: { 3: 0, 4: 0, 5: 0 }, category: new Map() }
  for (const p of list) {
    c.status[statusOf(p)]++
    const r = p.rating ?? 0
    if (r >= 3) c.rating[3]++
    if (r >= 4) c.rating[4]++
    if (r >= 5) c.rating[5]++
    c.category.set(p.category, (c.category.get(p.category) ?? 0) + 1)
  }
  return c
}

export function usePlaceFilters(everything: Pin[], anyVisible: boolean, pos: Pos) {
  const [params, setParams] = useSearchParams()
  const groupId = Number(params.get('group')) || undefined
  const category = params.get('category') || undefined
  const statusRaw = params.get('status')
  const status = STATUSES.find((s) => s.key === statusRaw)?.key
  const minRating = Number(params.get('rating')) || 0
  const selected = params.get('place')
  const tabRaw = params.get('tab')
  const tab: Tab = tabRaw === 'suggested' || tabRaw === 'stats' ? tabRaw : 'places'
  const [text, setText] = useState(params.get('q') ?? '')
  const q = useDebounced(text.trim().toLowerCase(), 250)

  /** Set or clear one param; choosing a place, the search and the tab replace history, filters push it. */
  const setParam = (k: string, v: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (v) p.set(k, v)
        else p.delete(k)
        return p
      },
      { replace: k === 'place' || k === 'q' || k === 'tab' },
    )
  const clearFilters = (keepGroup = false) =>
    setParams(keepGroup && groupId ? new URLSearchParams({ group: String(groupId) }) : new URLSearchParams())

  const inGroup = useMemo(() => (groupId ? everything.filter((p) => p.group_id === groupId) : everything), [everything, groupId])
  const counts = useMemo(() => countPlaces(inGroup), [inGroup])
  // Pins carry no address/notes/description: a text filter also asks the server which places match those.
  const textHits = useVisibleTextMatches(q, anyVisible)
  const textIds = useMemo(() => new Set((textHits.data ?? []).map((p) => p.id)), [textHits.data])
  const places = useMemo(() => {
    const list = inGroup.filter(
      (p) =>
        (!category || p.category === category) &&
        (!status || statusOf(p) === status) &&
        (!minRating || (p.rating ?? 0) >= minRating) &&
        (!q || p.name.toLowerCase().includes(q) || textIds.has(p.id)),
    )
    // Nearest first once your location is known.
    return pos
      ? list
          .map((p) => [distanceM(pos, { lat: p.latitude, lon: p.longitude }), p] as const)
          .sort((a, b) => a[0] - b[0])
          .map((x) => x[1])
      : list
  }, [inGroup, category, status, minRating, q, pos, textIds])

  return {
    params,
    groupId,
    category,
    status,
    minRating,
    selected,
    tab,
    text,
    setText,
    setParam,
    clearFilters,
    inGroup,
    counts,
    places,
    filtered: !!(groupId || category || status || q || minRating),
  }
}
