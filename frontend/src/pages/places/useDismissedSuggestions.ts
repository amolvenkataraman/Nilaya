// Suggestions you dismissed, remembered on this device per signed-in user (a spot is a coordinate rounded to
// ~100 m, so the same place stays dismissed when the server recomputes it). Dismissing offers Undo.
import { useEffect, useMemo, useState } from 'react'
import { toast } from '../../components/toast'
import { userKey } from '../../lib/owner'
import { useMe } from '../../lib/queries'
import { readPref, writePref } from '../../lib/storage'
import type { Suggestion } from './api'

const spotKey = (s: Suggestion) => `${s.latitude.toFixed(3)},${s.longitude.toFixed(3)}`
const MAX = 200

export function useDismissedSuggestions(all: Suggestion[] | undefined) {
  const meId = useMe().data?.id
  const key = useMemo(() => userKey('app.places.dismissed', meId), [meId])
  const read = (k: string | null) => (k ? readPref<Set<string>>(k, new Set()) : new Set<string>())
  const [dismissed, setDismissed] = useState(() => read(key))
  // biome-ignore lint/correctness/useExhaustiveDependencies: read is pure; the key is the trigger
  useEffect(() => setDismissed(read(key)), [key])
  const change = (s: Suggestion, on: boolean) =>
    setDismissed((d) => {
      const n = new Set(d)
      if (on) n.add(spotKey(s))
      else n.delete(spotKey(s))
      if (key) writePref(key, [...n].slice(-MAX))
      return n
    })
  const dismiss = (s: Suggestion) => {
    change(s, true)
    toast.show('Suggestion dismissed', { action: { label: 'Undo', run: () => change(s, false) } })
  }
  const shown = useMemo(() => all?.filter((x) => !dismissed.has(spotKey(x))), [all, dismissed])
  return { shown, dismiss }
}
