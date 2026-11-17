// How many times a dialog has been opened, for use as its content's `key`: each opening then starts from fresh
// state (a remount) instead of an effect that copies props into state after the first render. The count only
// changes on opening, so the closing animation still shows what was there.
import { useState } from 'react'

export function useOpenCount(open: boolean): number {
  const [seen, setSeen] = useState({ open, count: 0 })
  // Adjusting state while rendering: React re-renders right away, before anything is committed.
  if (seen.open !== open) setSeen({ open, count: seen.count + (open ? 1 : 0) })
  return seen.count
}
