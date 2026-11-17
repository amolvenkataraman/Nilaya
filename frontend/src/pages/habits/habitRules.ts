// Habit wording (goal, schedule, streak, amounts) and the two rules the client applies itself: whether a day is
// scheduled and whether a day's value meets a daily goal. Week and month goals are judged by the server.
import { dayDiff, parseDayKey } from '../../lib/dates'
import type { Habit, Period } from './api'

export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** 8, 2.5, 0.33: no trailing zeros. */
export const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))

export function scheduleText(h: Habit): string {
  if (h.schedule === 'weekdays') {
    if (h.weekdays === 127) return 'Every day'
    if (h.weekdays === 31) return 'Weekdays'
    if (h.weekdays === 96) return 'Weekends'
    return WEEKDAY_NAMES.filter((_, i) => (h.weekdays >> i) & 1).join(', ')
  }
  if (h.schedule === 'interval') return h.interval === 1 ? 'Every day' : `Every ${h.interval} days`
  return 'Every day'
}

export function goalText(h: Habit): string {
  const per = { day: 'a day', week: 'a week', month: 'a month' }[h.period]
  if (h.kind === 'yesno') {
    if (h.period === 'day') return scheduleText(h)
    return `${fmtNum(h.target)} ${h.target === 1 ? 'time' : 'times'} ${per}`
  }
  const amount = `${fmtNum(h.target)}${h.unit ? ' ' + h.unit : ''}`
  return `${h.goal === 'at_most' ? 'At most' : 'At least'} ${amount} ${per}`
}

export function streakText(n: number, unit: Period): string {
  const u = { day: 'day', week: 'week', month: 'month' }[unit]
  return `${n} ${u}${n === 1 ? '' : 's'}`
}

/** Same rule as habits/service.py is_scheduled (start/end dates + weekdays/interval). */
export function isScheduled(h: Habit, day: string): boolean {
  if (day < h.start_date || (h.end_date && day > h.end_date)) return false
  const d = parseDayKey(day)
  if (h.schedule === 'weekdays') return !!((h.weekdays >> ((d.getDay() + 6) % 7)) & 1)
  if (h.schedule === 'interval') return dayDiff(parseDayKey(h.start_date), d) % Math.max(1, h.interval) === 0
  return true
}

/** Does one day's value meet a daily goal? */
export function dayMet(h: Habit, value: number): boolean {
  if (h.goal === 'at_most') return value <= h.target
  const daily = h.period === 'day' ? h.target : 1
  return value >= (h.kind === 'yesno' ? 1 : daily)
}
