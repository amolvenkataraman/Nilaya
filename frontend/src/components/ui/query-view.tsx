// Loading, error and empty states for one query, in the order that keeps a page from going blank:
// data on screen always wins (a failed refetch keeps what's shown), then the skeleton while the first load
// runs, then the error with a retry. `isEmpty` picks the empty state only once data has arrived.
import type { ReactNode } from 'react'
import { ErrorBox, SkeletonRows } from './feedback'

interface QueryLike<T> {
  data: T | undefined
  error: unknown
  isPending: boolean
  refetch: () => unknown
}

export function QueryView<T>({
  query,
  skeleton = <SkeletonRows rows={3} />,
  isEmpty,
  empty = null,
  children,
}: {
  query: QueryLike<T>
  skeleton?: ReactNode
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  children: (data: T) => ReactNode
}) {
  const { data } = query
  if (data !== undefined) return isEmpty?.(data) ? empty : children(data)
  if (query.error) return <ErrorBox error={query.error} retry={() => query.refetch()} />
  return query.isPending ? skeleton : null
}
