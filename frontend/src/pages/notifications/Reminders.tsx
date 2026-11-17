// Notifications › Reminders: the automatic reminders for events, deadlines and tasks, the morning agenda, and
// the nudges the Habits and Contacts apps send. Every change saves at once and says "Saved".
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cardClass, ErrorBox, Input, Select, SkeletonRows, Switch } from '../../components/ui'
import type { ReminderSettings } from '../../lib/types'
import { SavedMark, SaveStatus, SettingRow, SettingsSection, settingControl } from '../settings/SettingsSection'
import { remindersQuery, useAppSettings, useSaveReminders } from './api'

// 0 minutes = off (see GET /notifications/reminders). Max 10080 (a week).
const EVENT = [0, 5, 10, 15, 30, 60, 120, 1440]
const DEADLINE = [0, 60, 180, 720, 1440, 2880, 10080]
const TODO = [0, 15, 30, 60, 180, 1440]

function minutesLabel(m: number): string {
  if (m === 0) return 'Off'
  if (m % 10080 === 0) return m === 10080 ? '1 week before' : `${m / 10080} weeks before`
  if (m % 1440 === 0) return m === 1440 ? '1 day before' : `${m / 1440} days before`
  if (m % 60 === 0) return m === 60 ? '1 hour before' : `${m / 60} hours before`
  return `${m} minutes before`
}

/** True for 2.5 s after `flash()`: the "Saved" mark. */
function useFlash(): [boolean, () => void] {
  const [on, setOn] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setTimeout(() => setOn(0), 2500)
    return () => clearTimeout(t)
  }, [on])
  return [on > 0, () => setOn((n) => n + 1)]
}

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function RemindersTab() {
  const q = useQuery(remindersQuery())
  const [status, setStatus] = useState<Status>('idle')
  const save = useSaveReminders(setStatus)
  useEffect(() => {
    if (status !== 'saved') return
    const t = setTimeout(() => setStatus('idle'), 2500)
    return () => clearTimeout(t)
  }, [status])
  const s = q.data
  const set = (body: Partial<ReminderSettings>) => save.mutate(body)

  return (
    <SettingsSection
      page
      title="Automatic reminders"
      description="Notifications sent for your calendar and tasks, through the bell and your delivery channels."
      actions={
        <SaveStatus tone={status === 'saved' ? 'ok' : status === 'error' ? 'err' : undefined}>
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && <SavedMark />}
          {status === 'error' && (save.error as Error)?.message}
        </SaveStatus>
      }
    >
      <div className={cardClass}>
        {s ? (
          <>
            <MinutesRow
              id="rm-event"
              label="Events"
              hint="Before a timed event starts"
              value={s.event_minutes}
              presets={EVENT}
              onChange={(v) => set({ event_minutes: v })}
            />
            <MinutesRow
              id="rm-deadline"
              label="Deadlines"
              hint="Before a calendar deadline"
              value={s.deadline_minutes}
              presets={DEADLINE}
              onChange={(v) => set({ deadline_minutes: v })}
            />
            <MinutesRow
              id="rm-todo"
              label="Tasks"
              hint="Before a task is due"
              value={s.todo_minutes}
              presets={TODO}
              onChange={(v) => set({ todo_minutes: v })}
            />
            <SettingRow label="Morning agenda" hint="A summary of the day's events and tasks">
              <Input
                type="time"
                className={settingControl}
                aria-label="Agenda time"
                value={s.agenda_time.slice(0, 5)}
                disabled={!s.daily_agenda}
                onChange={(e) => e.target.value && set({ agenda_time: `${e.target.value}:00` })}
              />
              <Switch
                checked={s.daily_agenda}
                onChange={(v) => set({ daily_agenda: v })}
                label={<span className="sr-only">Send a morning agenda</span>}
              />
            </SettingRow>
            <SettingRow label="Deadlines become tasks" hint="Each new calendar deadline also gets a task in your Inbox" inline>
              <Switch
                checked={s.deadlines_to_todos}
                onChange={(v) => set({ deadlines_to_todos: v })}
                label={<span className="sr-only">Turn deadlines into tasks</span>}
              />
            </SettingRow>
          </>
        ) : q.error ? (
          <ErrorBox error={q.error} retry={() => q.refetch()} />
        ) : (
          <SkeletonRows rows={5} />
        )}
      </div>
    </SettingsSection>
  )
}

export function AppReminders() {
  const [saved, flash] = useFlash()
  const habits = useAppSettings<{ evening_nudge: boolean; nudge_time: string }>('habits/settings', flash)
  const contacts = useAppSettings<{ birthday_reminders: 'off' | 'day_before' | 'on_day'; keep_in_touch_reminders: boolean }>(
    'contacts/settings',
    flash,
  )
  if (habits.q.isError && contacts.q.isError) return null
  const error = habits.error ?? contacts.error
  return (
    <SettingsSection
      page
      title="Habits and contacts"
      description="Nudges from the Habits and Contacts apps."
      actions={<SaveStatus tone={saved ? 'ok' : undefined}>{saved && <SavedMark />}</SaveStatus>}
    >
      <div className={cardClass}>
        {habits.q.data && (
          <SettingRow label="Habits evening nudge" hint="A reminder about habits not done yet today">
            <Input
              type="time"
              className={settingControl}
              aria-label="Nudge time"
              value={habits.q.data.nudge_time.slice(0, 5)}
              disabled={!habits.q.data.evening_nudge}
              onChange={(e) => e.target.value && habits.save({ nudge_time: `${e.target.value}:00` })}
            />
            <Switch
              checked={habits.q.data.evening_nudge}
              onChange={(v) => habits.save({ evening_nudge: v })}
              label={<span className="sr-only">Evening nudge</span>}
            />
          </SettingRow>
        )}
        {contacts.q.data && (
          <>
            <SettingRow label="Birthdays" hint="Reminders for your contacts' birthdays" htmlFor="rm-bday">
              <Select
                id="rm-bday"
                className={settingControl}
                value={contacts.q.data.birthday_reminders}
                onChange={(e) => contacts.save({ birthday_reminders: e.target.value as 'off' })}
              >
                <option value="off">Off</option>
                <option value="day_before">The day before</option>
                <option value="on_day">On the day</option>
              </Select>
            </SettingRow>
            <SettingRow label="Keep in touch" hint="When it's time to reach out to someone" inline>
              <Switch
                checked={contacts.q.data.keep_in_touch_reminders}
                onChange={(v) => contacts.save({ keep_in_touch_reminders: v })}
                label={<span className="sr-only">Keep in touch reminders</span>}
              />
            </SettingRow>
          </>
        )}
        {(habits.q.isPending || contacts.q.isPending) && <SkeletonRows rows={2} />}
        {error && <p className="px-4 py-2 text-xs text-danger">{error.message}</p>}
      </div>
    </SettingsSection>
  )
}

function MinutesRow({
  id,
  label,
  hint,
  value,
  presets,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: number
  presets: number[]
  onChange: (v: number) => void
}) {
  const options = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b)
  return (
    <SettingRow label={label} hint={hint} htmlFor={id}>
      <Select id={id} className={settingControl} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((m) => (
          <option key={m} value={m}>
            {minutesLabel(m)}
          </option>
        ))}
      </Select>
    </SettingRow>
  )
}
