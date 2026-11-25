// How this account wants times, dates and distances shown (Settings › Preferences: time_format, date_format, units),
// for the plain formatting functions in lib/dates and lib/map/geo. Those run everywhere, often outside React, so
// they read this module instead of taking the preference as an argument at every call site.
//
// One writer: lib/preferences' followDisplayPrefs keeps it in step with the cached /me, synchronously, so the
// formatters already see a change when React re-renders. One reader for React: Shell keys the routed page by
// useDisplayVersion(), so a change rebuilds every memoized row and cached label at once. That remount happens only
// when someone changes these three settings (or /me first arrives with non-default ones), which is rare.
import { useSyncExternalStore } from 'react'
import type { Preferences } from './preferences'

export type DisplayPrefs = Pick<Preferences, 'time_format' | 'date_format' | 'units'>

/** The browser's own formats with both distance units: what every page showed before these settings existed. */
export const DEFAULT_DISPLAY: DisplayPrefs = { time_format: 'auto', date_format: 'auto', units: 'both' }

let current: DisplayPrefs = DEFAULT_DISPLAY
let version = 0
const listeners = new Set<() => void>()

export const displayPrefs = (): DisplayPrefs => current

/** Change what the formatters show; a no-op (no re-render, formatter caches kept) when nothing changed. */
export function setDisplayPrefs({ time_format, date_format, units }: DisplayPrefs): void {
  if (time_format === current.time_format && date_format === current.date_format && units === current.units) return
  current = { time_format, date_format, units }
  version++
  for (const l of listeners) l()
}

/** Called after every change (lib/dates drops its cached Intl formatters). Returns the unsubscribe. */
export function onDisplayChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** A number that changes with the display preferences, for a component that must re-render on a change. */
export const useDisplayVersion = () => useSyncExternalStore(onDisplayChange, () => version)
