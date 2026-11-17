// Calendar colours: the palette offered in pickers, and the colour each calendar and event is drawn in.
// Any #rrggbb is allowed, so marks are adjusted to keep 3:1 contrast on this theme's surface (lib/colour).
import { useCallback, useMemo } from 'react'
import { readable, SURFACE } from '../../lib/colour'
import { useTheme } from '../../lib/theme'
import type { Calendar, CalEvent } from '../../lib/types'

export const CAL_COLOURS = ['#3b82f6', '#0891b2', '#10b981', '#16a34a', '#f59e0b', '#ea580c', '#ef4444', '#db2777', '#8b5cf6', '#64748b']

/** Slate: a calendar or event without a usable colour. */
export const FALLBACK_COLOUR = '#64748b'

/** `colour` made readable on the current theme's surface. */
export function useReadable(): (colour: string | null | undefined) => string {
  const { dark } = useTheme()
  return useCallback((c) => readable(c || FALLBACK_COLOUR, dark ? SURFACE.dark : SURFACE.light), [dark])
}

/** Colour per calendar and per event: an event's display_colour (its own colour, else my colour for its
 *  calendar) wins, else its calendar's. */
export function useEventColours(calendars: Calendar[] | undefined) {
  const mark = useReadable()
  const byCalendar = useMemo(() => new Map((calendars ?? []).map((c) => [c.id, mark(c.colour)])), [calendars, mark])
  const colour = useCallback(
    (e: CalEvent) => (e.display_colour ? mark(e.display_colour) : (byCalendar.get(e.calendar_id) ?? FALLBACK_COLOUR)),
    [byCalendar, mark],
  )
  return { byCalendar, colour }
}
