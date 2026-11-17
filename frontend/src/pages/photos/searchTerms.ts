// Smart search helpers (pure): the server reads the query (photos/search.py) and says which words
// became which term; removing a term just drops those words from the query.
import type { Photo } from '../../lib/types'

export type SearchTerm = {
  type: 'place' | 'object' | 'camera' | 'date' | 'media' | 'album' | 'library' | 'text'
  kind: string
  value: string
  label: string
  /** [first, last + 1] indices into the query's whitespace-separated words. */
  span: [number, number]
  typo?: string | null
  detail?: string | null
}

export type SearchPage = {
  items: Photo[]
  next_before: string | null
  next_before_id?: string | null
  interpreted: SearchTerm[]
  unmatched: string[]
  count?: number | null
  count_capped?: boolean
}

const CONNECTORS = new Set(['in', 'at', 'from', 'of', 'on', 'with', 'during', 'near', 'by', 'and', 'or', 'the', 'between'])

/** The query without one term's words, a connector before them, and connectors left at either end
 *  ("videos in india" minus India -> "videos"; minus Videos -> "india"). */
export function dropSpan(q: string, [a, b]: [number, number]): string {
  const words = q.trim().split(/\s+/).filter(Boolean)
  const isConn = (w?: string) => !!w && CONNECTORS.has(w.toLowerCase())
  const start = a > 0 && isConn(words[a - 1]) ? a - 1 : a
  const left = [...words.slice(0, start), ...words.slice(b)]
  while (left.length && isConn(left[0])) left.shift()
  while (left.length && isConn(left[left.length - 1])) left.pop()
  return left.join(' ')
}

/** "1,284 photos", "10,000+ photos", "1 video". */
export function countLabel(count: number | null | undefined, capped = false, noun = 'photo'): string {
  if (count == null) return ''
  return `${count.toLocaleString()}${capped ? '+' : ''} ${count === 1 && !capped ? noun : noun + 's'}`
}
