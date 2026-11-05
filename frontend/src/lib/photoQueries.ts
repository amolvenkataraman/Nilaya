// The Photos sidebar's four queries (summary, albums, libraries, show-hidden mode). Fetched together they
// cost one request (GET /photos/sidebar); each key still refetches its own endpoint when invalidated alone.
import { queryGroup } from './batch'

const side = queryGroup('photos/sidebar', {
  summary: { key: ['photos', 'summary'], path: 'photos/summary' },
  albums: { key: ['photos', 'albums'], path: 'photos/albums' },
  libraries: { key: ['photos', 'libraries'], path: 'photos/libraries' },
  hidden_mode: { key: ['photos', 'hidden-mode'], path: 'photos/hidden-mode' },
}, (all, k) => all[k])

export const photoSummaryQuery = <T>() => ({ queryKey: ['photos', 'summary'], queryFn: side<T>('summary'), staleTime: 10 * 60_000 })
export const photoAlbumsQuery = <T>() => ({ queryKey: ['photos', 'albums'], queryFn: side<T>('albums'), staleTime: 5 * 60_000 })
export const photoLibrariesQuery = <T>() => ({ queryKey: ['photos', 'libraries'], queryFn: side<T>('libraries'), staleTime: 10 * 60_000 })
export const photoHiddenModeQuery = <T>() => ({ queryKey: ['photos', 'hidden-mode'], queryFn: side<T>('hidden_mode'), staleTime: 5 * 60_000 })
