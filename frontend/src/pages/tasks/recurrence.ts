// How repeats and reminders are worded and edited: the repeat presets and custom units ("Every 3 days after
// completion"), reminder wording ("1 hour before due") and the reminder shape the PATCH takes. Pure, unit-tested.
import type { Schemas, TaskReminder } from '../../lib/types'

// ---------------------------------------------------------------- repeat
export const REPEAT_PRESETS: { label: string; short: string; mode: number; every: number | null }[] = [
  { label: 'Does not repeat', short: '', mode: 0, every: null },
  { label: 'Every day', short: 'Daily', mode: 1, every: 86400 },
  { label: 'Every week', short: 'Weekly', mode: 1, every: 604800 },
  { label: 'Every 2 weeks', short: 'Every 2 wk', mode: 1, every: 1209600 },
  { label: 'Every month', short: 'Monthly', mode: 2, every: null },
  { label: 'Every year', short: 'Yearly', mode: 1, every: 31536000 },
]
export const REPEAT_UNITS: [string, number][] = [
  ['hours', 3600],
  ['days', 86400],
  ['weeks', 604800],
  ['months', 2592000],
  ['years', 31536000],
]

/** "Every week", "Every 3 days after completion"; short gives "Weekly" for rows. */
export function repeatText(mode: number, every: number | null, short = false): string {
  if (!mode) return ''
  const preset = mode === 2 ? REPEAT_PRESETS[4] : REPEAT_PRESETS.find((p) => p.mode === (mode === 3 ? 1 : mode) && p.every === every)
  let s: string
  if (preset) s = short ? preset.short : preset.label
  else {
    const [name, secs] = [...REPEAT_UNITS].reverse().find(([, x]) => (every ?? 0) % x === 0) ?? ['minutes', 60]
    const n = Math.round((every ?? 0) / secs)
    s = `Every ${n} ${n === 1 ? name.replace(/s$/, '') : name}`
  }
  if (mode === 3) s += short ? ' after done' : ' after completion'
  return s
}

/** Split repeat_every into [count, unit seconds] for the custom form. */
export function repeatParts(every: number | null): [number, number] {
  if (!every) return [1, 86400]
  const [, secs] = [...REPEAT_UNITS].reverse().find(([, s]) => every % s === 0) ?? REPEAT_UNITS[0]
  return [every / secs, secs]
}

// ---------------------------------------------------------------- reminders
export type ReminderIn = Schemas['ReminderIn']

export const durText = (secs: number) => {
  const a = Math.abs(secs)
  if (a % 604800 === 0) return `${a / 604800} week${a === 604800 ? '' : 's'}`
  if (a % 86400 === 0) return `${a / 86400} day${a === 86400 ? '' : 's'}`
  if (a % 3600 === 0) return `${a / 3600} hour${a === 3600 ? '' : 's'}`
  return `${Math.round(a / 60)} min`
}

/** "1 hour before due", "At start time"; absolute reminders return null (the caller formats the date). */
export function reminderText(r: Pick<TaskReminder, 'relative_to' | 'offset'>): string | null {
  if (!r.relative_to) return null
  const what = r.relative_to === 'due' ? 'due' : 'start'
  if (!r.offset) return `At ${what} time`
  return `${durText(r.offset)} ${r.offset < 0 ? 'before' : 'after'} ${what}`
}

export const reminderIn = (r: Pick<TaskReminder, 'at' | 'relative_to' | 'offset'>): ReminderIn => ({
  at: r.relative_to ? null : r.at,
  relative_to: (r.relative_to || '') as ReminderIn['relative_to'],
  offset: r.offset || 0,
})
