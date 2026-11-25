// Settings › Preferences: account-wide choices every app and device follows (lib/preferences). Each change saves at
// once. The automatic reminders have their own page (Notifications › Reminders), linked from here.
import { Link } from 'react-router'
import {
  Button,
  cardClass,
  Input,
  Segmented,
  type SegmentOption,
  Select,
  settingControl,
  SettingRow,
  SettingsSection,
  Switch,
} from '../../components/ui'
import { fmtHour, fmtTime } from '../../lib/dates'
import { clockMinutes, type Preferences, usePreferences, useSavePreferences } from '../../lib/preferences'

const WEEK: SegmentOption<'0' | '1'>[] = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
]
const TIME: SegmentOption<Preferences['time_format']>[] = [
  { value: 'auto', label: 'Automatic' },
  { value: '12h', label: '3:30 PM' },
  { value: '24h', label: '15:30' },
]
const DATE: { value: Preferences['date_format']; label: string }[] = [
  { value: 'auto', label: 'Automatic (your browser’s language)' },
  { value: 'mdy', label: 'Nov 24, 2026 · 11/24/2026' },
  { value: 'dmy', label: '24 Nov 2026 · 24/11/2026' },
  { value: 'ymd', label: '2026-11-24' },
]
const UNITS: SegmentOption<Preferences['units']>[] = [
  { value: 'km', label: 'Kilometres' },
  { value: 'mi', label: 'Miles' },
  { value: 'both', label: 'Both' },
]
// Sunday first, as stored (0 = Sunday); the row follows the chosen week start.
type Weekday = Preferences['work_days'][number]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]
const DAY_STARTS = Array.from({ length: 9 }, (_, h) => `${String(h).padStart(2, '0')}:00:00`)

/** "Midnight", "5 AM" / "05:00", in the account's clock. */
const hourLabel = (t: string) => {
  const m = clockMinutes(t)
  if (!m) return 'Midnight'
  const d = new Date(2000, 0, 1, 0, m)
  return m % 60 ? fmtTime(d) : fmtHour(d)
}
const hhmm = (t: string) => t.slice(0, 5)

export function PreferencesSection() {
  const p = usePreferences()
  const { mutate: save } = useSavePreferences()
  const dayStarts = DAY_STARTS.includes(p.day_starts_at) ? DAY_STARTS : [...DAY_STARTS, p.day_starts_at].sort()
  const weekOrder = WEEKDAYS.map((i) => WEEKDAYS[(i + p.week_start) % 7])
  const toggleDay = (d: Weekday) => save({ work_days: p.work_days.includes(d) ? p.work_days.filter((x) => x !== d) : [...p.work_days, d] })
  const time = (key: 'work_start' | 'work_end') => (v: string) => v && save({ [key]: `${v}:00` })
  const quiet = (patch: Partial<Preferences['quiet_hours']>) => save({ quiet_hours: { ...p.quiet_hours, ...patch } })

  return (
    <SettingsSection id="set-preferences" title="Preferences" description="For your account, so every app, browser and phone follows them.">
      <div className={cardClass}>
        <SettingRow label="Week starts on" inline>
          <Segmented
            label="Week starts on"
            value={String(p.week_start) as '0' | '1'}
            onChange={(v) => save({ week_start: v === '0' ? 0 : 1 })}
            options={WEEK}
          />
        </SettingRow>
        <SettingRow
          label="Day starts at"
          hint="Photos and habit check-ins from before this count for the day before, so a late night stays one day"
          htmlFor="pref-day"
        >
          <Select id="pref-day" {...settingControl} value={p.day_starts_at} onChange={(e) => save({ day_starts_at: e.target.value })}>
            {dayStarts.map((t) => (
              <option key={t} value={t}>
                {hourLabel(t)}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow label="Time" inline>
          <Segmented label="Time format" value={p.time_format} onChange={(v) => save({ time_format: v })} options={TIME} />
        </SettingRow>
        <SettingRow label="Dates" htmlFor="pref-date">
          <Select
            id="pref-date"
            {...settingControl}
            value={p.date_format}
            onChange={(e) => save({ date_format: e.target.value as Preferences['date_format'] })}
          >
            {DATE.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow label="Distances" inline>
          <Segmented label="Distances" value={p.units} onChange={(v) => save({ units: v })} options={UNITS} />
        </SettingRow>
      </div>

      <div className={cardClass}>
        <SettingRow label="Working days" hint="The calendar shades the rest; your availability page offers only these">
          <fieldset className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0" aria-label="Working days">
            {weekOrder.map((d) => {
              const on = p.work_days.includes(d)
              return (
                <Button key={d} size="sm" pressed={on} aria-pressed={on} onClick={() => toggleDay(d)} className="min-w-10 md:min-w-11">
                  {DAY_NAMES[d]}
                </Button>
              )
            })}
          </fieldset>
        </SettingRow>
        <SettingRow label="Working hours" hint="The calendar opens scrolled to the start">
          <Input
            type="time"
            {...settingControl}
            className="md:min-w-0"
            aria-label="Working hours start"
            value={hhmm(p.work_start)}
            onChange={(e) => time('work_start')(e.target.value)}
          />
          <span className="text-sm text-muted">to</span>
          <Input
            type="time"
            {...settingControl}
            className="md:min-w-0"
            aria-label="Working hours end"
            value={hhmm(p.work_end)}
            onChange={(e) => time('work_end')(e.target.value)}
          />
        </SettingRow>
      </div>

      <div className={cardClass}>
        <SettingRow
          label="Quiet hours"
          hint="Phone, web and other channels hold notifications until the end; the bell still shows them at once"
        >
          <Input
            type="time"
            {...settingControl}
            className="md:min-w-0"
            aria-label="Quiet hours start"
            disabled={!p.quiet_hours.enabled}
            value={hhmm(p.quiet_hours.start)}
            onChange={(e) => e.target.value && quiet({ start: `${e.target.value}:00` })}
          />
          <span className="text-sm text-muted">to</span>
          <Input
            type="time"
            {...settingControl}
            className="md:min-w-0"
            aria-label="Quiet hours end"
            disabled={!p.quiet_hours.enabled}
            value={hhmm(p.quiet_hours.end)}
            onChange={(e) => e.target.value && quiet({ end: `${e.target.value}:00` })}
          />
          <Switch checked={p.quiet_hours.enabled} onChange={(v) => quiet({ enabled: v })} ariaLabel="Quiet hours" />
        </SettingRow>
        <SettingRow label="Default reminders" hint="How long before events, deadlines and tasks you're reminded">
          <Link to="/notifications?tab=reminders" className="text-sm font-medium text-accent hover:underline">
            Notifications › Reminders
          </Link>
        </SettingRow>
      </div>
    </SettingsSection>
  )
}
