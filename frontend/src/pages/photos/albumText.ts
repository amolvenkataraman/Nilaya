// How an album is described in the grid, the list and on its page: "12 photos · 3 videos · 1.2 GB · by @ann",
// the span of its photo dates, and its public link.
import { fmtDate } from '../../lib/dates'
import { fmtBytes, plural } from '../../lib/format'
import type { Album } from '../../lib/types'

export function albumMeta(a: Album, withOwner = true): string {
  const videos = a.videos ?? 0
  return [
    plural(a.count - videos, 'photo'),
    videos ? plural(videos, 'video') : '',
    a.size_kb ? fmtBytes(a.size_kb) : '',
    withOwner && a.owner ? `by @${a.owner}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

const shortDate = (iso: string) => fmtDate(new Date(iso), { month: 'short', day: 'numeric', year: 'numeric' })
/** "Mar 2, 2019 – Aug 30, 2024" (one date when they're the same day). */
export function albumSpan(a: { first?: string | null; last?: string | null }): string {
  if (!a.first || !a.last) return ''
  const x = shortDate(a.first)
  const y = shortDate(a.last)
  return x === y ? x : `${x} – ${y}`
}

/** The album's public page: anyone with the link if it's public, members either way. */
export const publicAlbumUrl = (id: string) => `${window.location.origin}/shared/albums/${id}`
