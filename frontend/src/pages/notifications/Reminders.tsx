import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows, Switch } from '../../components/ui'
import { get, patch } from '../../lib/api'
import type { ReminderSettings } from '../../lib/types'

const KEY = ['notifications', 'reminders'] as const

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

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function RemindersTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: KEY, queryFn: () => get<ReminderSettings>('notifications/reminders') })
  const [status, setStatus] = useState<Status>('idle')
  const save = useMutation({
    mutationFn: (body: Partial<ReminderSettings>) => patch<ReminderSettings>('notifications/reminders', body),
    onMutate: (body) => {
      setStatus('saving')
      const prev = qc.getQueryData<ReminderSettings>(KEY)
      if (prev) qc.setQueryData<ReminderSettings>(KEY, { ...prev, ...body })
      return { prev }
    },
    onError: (_e, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
      setStatus('error')
    },
    onSuccess: (s) => {
      qc.setQueryData(KEY, s)
      setStatus('saved')
    },
  })
  useEffect(() => {
    if (status !== 'saved') return
    const t = setTimeout(() => setStatus('idle'), 2500)
    return () => clearTimeout(t)
  }, [status])

  const s = q.data
  const set = (body: Partial<ReminderSettings>) => save.mutate(body)

  return (
    <div className="set-section">
      <div className="set-section-head">
        <div className="grow">
          <h1>Automatic reminders</h1>
          <p>Notifications sent for your calendar and tasks, through the bell and your delivery channels.</p>
        </div>
        <span className={'set-status' + (status === 'saved' ? ' ok' : status === 'error' ? ' err' : '')} role="status" aria-live="polite">
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && (<><Icon name="check" size={12} />Saved</>)}
          {status === 'error' && (save.error as Error)?.message}
        </span>
      </div>
      <div className="set-card">
        {q.isPending ? (
          <SkeletonRows rows={5} />
        ) : !s ? (
          q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />
        ) : (
          <>
            <MinutesRow id="rm-event" label="Events" hint="Before a timed event starts" value={s.event_minutes} presets={EVENT} onChange={(v) => set({ event_minutes: v })} />
            <MinutesRow id="rm-deadline" label="Deadlines" hint="Before a calendar deadline" value={s.deadline_minutes} presets={DEADLINE} onChange={(v) => set({ deadline_minutes: v })} />
            <MinutesRow id="rm-todo" label="Tasks" hint="Before a task is due" value={s.todo_minutes} presets={TODO} onChange={(v) => set({ todo_minutes: v })} />
            <div className="set-row">
              <span className="set-label">Morning agenda<small>A summary of the day's events and tasks</small></span>
              <div className="set-control">
                <input
                  type="time"
                  className="input"
                  aria-label="Agenda time"
                  value={s.agenda_time.slice(0, 5)}
                  disabled={!s.daily_agenda}
                  onChange={(e) => e.target.value && set({ agenda_time: e.target.value + ':00' })}
                />
                <Switch checked={s.daily_agenda} onChange={(v) => set({ daily_agenda: v })} label={<span className="sr-only">Send a morning agenda</span>} />
              </div>
            </div>
            <div className="set-row inline">
              <span className="set-label">Deadlines become tasks<small>Each new calendar deadline also gets a task in your Inbox</small></span>
              <div className="set-control">
                <Switch checked={s.deadlines_to_todos} onChange={(v) => set({ deadlines_to_todos: v })} label={<span className="sr-only">Turn deadlines into tasks</span>} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Reminder settings owned by another app (habits, contacts): immediate save + "Saved". */
function useAppSettings<T extends object>(path: string) {
  const qc = useQueryClient()
  const key = ['settings', path]
  const q = useQuery({ queryKey: key, queryFn: () => get<T>(path), retry: false })
  const [saved, setSaved] = useState(false)
  const m = useMutation({
    mutationFn: (body: Partial<T>) => patch<T>(path, body),
    onMutate: (body) => {
      const prev = qc.getQueryData<T>(key)
      if (prev) qc.setQueryData<T>(key, { ...prev, ...body })
      return { prev }
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSuccess: (v) => (qc.setQueryData(key, v), setSaved(true), setTimeout(() => setSaved(false), 2500)),
  })
  return { q, save: m.mutate, saved, error: m.error as Error | null }
}

export function AppReminders() {
  const habits = useAppSettings<{ evening_nudge: boolean; nudge_time: string }>('habits/settings')
  const contacts = useAppSettings<{ birthday_reminders: 'off' | 'day_before' | 'on_day'; keep_in_touch_reminders: boolean }>('contacts/settings')
  if (habits.q.isError && contacts.q.isError) return null
  const status = habits.saved || contacts.saved
  return (
    <div className="set-section">
      <div className="set-section-head">
        <div className="grow"><h1>Habits and contacts</h1><p>Nudges from the Habits and Contacts apps.</p></div>
        <span className={'set-status' + (status ? ' ok' : '')} role="status" aria-live="polite">{status && (<><Icon name="check" size={12} />Saved</>)}</span>
      </div>
      <div className="set-card">
        {habits.q.data && (
          <div className="set-row">
            <span className="set-label">Habits evening nudge<small>A reminder about habits not done yet today</small></span>
            <div className="set-control">
              <input type="time" className="input" aria-label="Nudge time" value={habits.q.data.nudge_time.slice(0, 5)} disabled={!habits.q.data.evening_nudge}
                onChange={(e) => e.target.value && habits.save({ nudge_time: e.target.value + ':00' })} />
              <Switch checked={habits.q.data.evening_nudge} onChange={(v) => habits.save({ evening_nudge: v })} label={<span className="sr-only">Evening nudge</span>} />
            </div>
          </div>
        )}
        {contacts.q.data && (
          <>
            <div className="set-row">
              <label className="set-label" htmlFor="rm-bday">Birthdays<small>Reminders for your contacts' birthdays</small></label>
              <div className="set-control">
                <select id="rm-bday" className="select" value={contacts.q.data.birthday_reminders} onChange={(e) => contacts.save({ birthday_reminders: e.target.value as 'off' })}>
                  <option value="off">Off</option><option value="day_before">The day before</option><option value="on_day">On the day</option>
                </select>
              </div>
            </div>
            <div className="set-row inline">
              <span className="set-label">Keep in touch<small>When it's time to reach out to someone</small></span>
              <div className="set-control">
                <Switch checked={contacts.q.data.keep_in_touch_reminders} onChange={(v) => contacts.save({ keep_in_touch_reminders: v })} label={<span className="sr-only">Keep in touch reminders</span>} />
              </div>
            </div>
          </>
        )}
        {(habits.q.isPending || contacts.q.isPending) && <SkeletonRows rows={2} />}
        {(habits.error || contacts.error) && <p className="error-text" style={{ padding: '0.5rem 1rem' }}>{(habits.error ?? contacts.error)!.message}</p>}
      </div>
    </div>
  )
}

function MinutesRow({ id, label, hint, value, presets, onChange }: {
  id: string; label: string; hint: string; value: number; presets: number[]; onChange: (v: number) => void
}) {
  const options = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b)
  return (
    <div className="set-row">
      <label className="set-label" htmlFor={id}>{label}<small>{hint}</small></label>
      <div className="set-control">
        <select id={id} className="select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
          {options.map((m) => <option key={m} value={m}>{minutesLabel(m)}</option>)}
        </select>
      </div>
    </div>
  )
}
