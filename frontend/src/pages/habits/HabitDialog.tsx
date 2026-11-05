import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, Switch } from '../../components/ui'
import { dayKey } from '../../lib/dates'
import { useArchiveHabit, useDeleteHabit, useHabitSettings, useSaveHabit, useSaveHabitSettings, type Goal, type Habit, type HabitInput, type Kind, type Period, type Schedule } from './api'
import { HABIT_COLOURS, HABIT_ICONS, HIcon, WEEKDAY_LETTERS, WEEKDAY_NAMES } from './util'

interface Form {
  name: string; description: string; colour: string; icon: string; kind: Kind; unit: string; goal: Goal; target: string
  period: Period; schedule: Schedule; weekdays: number; interval: string; start_date: string; end_date: string
  reminder: boolean; reminder_time: string; reminder_days: number
}

const blank = (): Form => ({
  name: '', description: '', colour: '', icon: '', kind: 'yesno', unit: '', goal: 'at_least', target: '1', period: 'day',
  schedule: 'daily', weekdays: 127, interval: '2', start_date: dayKey(new Date()), end_date: '', reminder: false,
  reminder_time: '20:00', reminder_days: 127,
})

/** "Start from" templates, the same list as the classic editor (habits/static/habits/editor.js). */
const TEMPLATES: (Partial<Omit<Form, 'target'>> & { name: string; target?: number })[] = [
  { name: 'Drink water', kind: 'measurable', unit: 'glasses', target: 8, icon: 'drop', colour: '#2a78d6' },
  { name: 'Read', kind: 'measurable', unit: 'minutes', target: 20, icon: 'book', colour: '#6250d6' },
  { name: 'Exercise', kind: 'yesno', target: 3, period: 'week', icon: 'dumbbell', colour: '#eb6834' },
  { name: 'No sugar', kind: 'measurable', unit: 'servings', goal: 'at_most', target: 0, icon: 'ban', colour: '#e34948' },
  { name: 'Meditate', kind: 'yesno', icon: 'leaf', colour: '#1baf7a' },
  { name: 'Walk', kind: 'measurable', unit: 'steps', target: 8000, icon: 'run', colour: '#008300' },
  { name: 'Journal', kind: 'yesno', schedule: 'weekdays', weekdays: 0b0011111, icon: 'pen', colour: '#eda100' },
  { name: 'Sleep by 11', kind: 'yesno', icon: 'moon', colour: '#e87ba4' },
]

const fromHabit = (h: Habit): Form => ({
  name: h.name, description: h.description, colour: h.colour, icon: h.icon, kind: h.kind, unit: h.unit, goal: h.goal,
  target: String(h.target), period: h.period, schedule: h.schedule, weekdays: h.weekdays, interval: String(h.interval),
  start_date: h.start_date, end_date: h.end_date ?? '', reminder: !!h.reminder_time,
  reminder_time: h.reminder_time?.slice(0, 5) ?? '20:00', reminder_days: h.reminder_days,
})

function DayPicker({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="h-days" role="group" aria-label={label}>
      {WEEKDAY_LETTERS.map((l, i) => {
        const on = !!((value >> i) & 1)
        return (
          <button key={i} type="button" className={'h-day' + (on ? ' on' : '')} aria-pressed={on} aria-label={WEEKDAY_NAMES[i]} title={WEEKDAY_NAMES[i]} onClick={() => onChange(value ^ (1 << i))}>
            {l}
          </button>
        )
      })}
    </div>
  )
}

export function HabitDialog({ open, habit, onClose, onSaved }: { open: boolean; habit: Habit | null; onClose: () => void; onSaved?: (h: Habit) => void }) {
  const save = useSaveHabit()
  const archive = useArchiveHabit()
  const remove = useDeleteHabit()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [f, setF] = useState<Form>(blank)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setF(habit ? fromHabit(habit) : blank())
      setError('')
    }
  }, [open, habit])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))

  const submit = () => {
    if (!f.name.trim()) return setError('Give the habit a name.')
    const target = Number(f.target)
    if (!(target > 0) && f.goal === 'at_least' && !(f.kind === 'yesno' && f.period === 'day')) return setError('The target must be more than 0.')
    const body: HabitInput = {
      name: f.name.trim(), description: f.description, colour: f.colour, icon: f.icon, kind: f.kind,
      unit: f.kind === 'measurable' ? f.unit.trim() : '', goal: f.kind === 'yesno' ? 'at_least' : f.goal,
      target: f.kind === 'yesno' && f.period === 'day' ? 1 : target, period: f.period, schedule: f.schedule,
      weekdays: f.weekdays, interval: Math.max(1, Number(f.interval) || 1), start_date: f.start_date || null,
      end_date: f.end_date || null, reminder_time: f.reminder ? f.reminder_time + ':00' : null, reminder_days: f.reminder_days,
    }
    save.mutate(
      { id: habit?.id, body },
      { onSuccess: (h) => (onSaved?.(h), onClose()), onError: (e) => setError((e as Error).message) },
    )
  }

  const showTarget = f.kind === 'measurable' || f.period !== 'day'
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={habit ? 'Edit habit' : 'New habit'}
      width="34rem"
      footer={
        <>
          {habit && (
            <>
              <button className="btn ghost" onClick={() => (archive.mutate({ id: habit.id, archived: !habit.archived }), onClose())}>{habit.archived ? 'Unarchive' : 'Archive'}</button>
              <button className="btn ghost danger" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
          {error && <span className="error-text grow" role="alert">{error}</span>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={save.isPending}>{habit ? 'Save' : 'Create habit'}</button>
        </>
      }
    >
      <form className="h-form" onSubmit={(e) => (e.preventDefault(), submit())}>
        {!habit && (
          <div className="field">
            <span>Start from</span>
            <div className="h-templates">
              {TEMPLATES.map(({ target, ...t }) => (
                <button key={t.name} type="button" className="h-template" style={{ ['--hc' as string]: t.colour }} aria-pressed={f.name === t.name}
                  onClick={() => (setF((x) => ({ ...blank(), start_date: x.start_date, ...t, target: String(target ?? 1) })), setError(''))}>
                  <HIcon name={t.icon!} size={0.875} />{t.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="field">
          <span>Name</span>
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="e.g. Read 20 minutes" autoFocus />
        </label>

        <div className="field">
          <span>Type</span>
          <div className="seg" role="group" aria-label="Type">
            <button type="button" aria-pressed={f.kind === 'yesno'} onClick={() => setF((x) => ({ ...x, kind: 'yesno', goal: 'at_least' }))}>Yes / no</button>
            <button type="button" aria-pressed={f.kind === 'measurable'} onClick={() => set('kind', 'measurable')}>Measurable</button>
          </div>
        </div>

        {f.kind === 'measurable' && (
          <div className="field-row">
            <label className="field">
              <span>Goal</span>
              <select className="select" value={f.goal} onChange={(e) => set('goal', e.target.value as Goal)}>
                <option value="at_least">At least</option>
                <option value="at_most">At most (a limit)</option>
              </select>
            </label>
            <label className="field">
              <span>Unit</span>
              <input className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)} maxLength={24} placeholder="glasses, minutes, km" />
            </label>
          </div>
        )}

        <div className="field-row">
          {showTarget && (
            <label className="field">
              <span>{f.kind === 'yesno' ? 'Times' : 'Target'}</span>
              <input className="input" type="number" inputMode="decimal" min={0} step={f.kind === 'yesno' ? 1 : 'any'} max={f.kind === 'yesno' ? (f.period === 'week' ? 7 : 31) : 1000000}
                value={f.target} onChange={(e) => set('target', e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Per</span>
            <select className="select" value={f.period} onChange={(e) => {
              const period = e.target.value as Period
              // Yes/no: "1 time a week" is rarely meant; start a week at 3 like the classic editor, and keep within the period.
              setF((x) => {
                if (x.kind !== 'yesno') return { ...x, period }
                const n = Number(x.target) || 1
                const target = period === 'day' ? 1 : period === 'week' && n <= 1 ? 3 : Math.min(period === 'week' ? 7 : 31, Math.max(1, n))
                return { ...x, period, target: String(target) }
              })
            }}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
        </div>
        {f.kind === 'measurable' && f.goal === 'at_most' && <span className="help" style={{ marginTop: '-0.5rem' }}>A limit: days are kept unless you log going over.</span>}

        <div className="field">
          <span>Schedule</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="seg" role="group" aria-label="Schedule">
              <button type="button" aria-pressed={f.schedule === 'daily'} onClick={() => set('schedule', 'daily')}>Every day</button>
              <button type="button" aria-pressed={f.schedule === 'weekdays'} onClick={() => set('schedule', 'weekdays')}>Some days</button>
              <button type="button" aria-pressed={f.schedule === 'interval'} onClick={() => set('schedule', 'interval')}>Every N days</button>
            </div>
            {f.schedule === 'weekdays' && <DayPicker value={f.weekdays} onChange={(v) => set('weekdays', v)} label="Scheduled days" />}
            {f.schedule === 'interval' && (
              <label className="row small">Every <input className="input" style={{ width: '4.5rem' }} type="number" min={1} max={365} value={f.interval} onChange={(e) => set('interval', e.target.value)} aria-label="Interval in days" /> days from the start date</label>
            )}
          </div>
          <span className="help">{f.period !== 'day' ? 'Shows on these days until the goal is met.' : 'Days off the schedule never break a streak.'}</span>
        </div>

        <div className="field">
          <span>Icon</span>
          <div className="h-icons" role="radiogroup" aria-label="Icon">
            <button type="button" role="radio" aria-checked={!f.icon} className="h-icon-opt" onClick={() => set('icon', '')} title="Letter">
              <span style={{ fontWeight: 600, fontSize: 'var(--fs-xs)' }}>{(f.name.trim()[0] ?? 'A').toUpperCase()}</span>
            </button>
            {HABIT_ICONS.map((i) => (
              <button key={i} type="button" role="radio" aria-checked={f.icon === i} aria-label={i} title={i} className="h-icon-opt" onClick={() => set('icon', i)}>
                <HIcon name={i} />
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {HABIT_COLOURS.map(([hex, label]) => (
              <button key={label} type="button" role="radio" aria-checked={f.colour === hex} aria-label={label} title={label} className="swatch" style={{ background: hex || 'var(--app-accent)' }} onClick={() => set('colour', hex)}>
                {f.colour === hex && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Reminder</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Switch checked={f.reminder} onChange={(v) => set('reminder', v)} label={f.reminder ? '' : 'Off'} />
            {f.reminder && (
              <>
                <input className="input" type="time" style={{ width: '7rem' }} value={f.reminder_time} onChange={(e) => set('reminder_time', e.target.value)} aria-label="Reminder time" />
                <DayPicker value={f.reminder_days} onChange={(v) => set('reminder_days', v)} label="Reminder days" />
              </>
            )}
          </div>
          {f.reminder && <span className="help">Sent through your notification channels if the habit isn't done yet.</span>}
        </div>

        <div className="field-row">
          <label className="field"><span>Start</span><input className="input" type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></label>
          <label className="field"><span>End (optional)</span><input className="input" type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></label>
        </div>

        <label className="field">
          <span>Notes</span>
          <textarea className="textarea" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} placeholder="Why this habit matters (optional)" />
        </label>
      </form>
      {habit && (
        <Confirm open={confirmDelete} title={`Delete "${habit.name}"?`} body="All of its history is deleted too. Archive it instead to keep the stats."
          onConfirm={() => (remove.mutate(habit.id, { onSuccess: () => navigate('/habits') }), onClose())} onClose={() => setConfirmDelete(false)} />
      )}
    </Dialog>
  )
}

export function HabitSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useHabitSettings()
  const save = useSaveHabitSettings()
  const s = settings.data
  return (
    <Dialog open={open} onClose={onClose} title="Habit settings" width="28rem" footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Done</button></>}>
      {!s ? (
        <span className="sk sk-line" />
      ) : (
        <div className="stack" style={{ gap: '0.75rem' }}>
          <div className="row">
            <div className="grow">
              <div className="small" style={{ fontWeight: 500 }}>Evening nudge</div>
              <div className="help">A notification like "2 habits left today" if you haven't finished.</div>
            </div>
            <Switch checked={s.evening_nudge} onChange={(v) => save.mutate({ evening_nudge: v })} />
          </div>
          {s.evening_nudge && (
            <label className="row small">
              <span className="grow">Send at</span>
              <input className="input" type="time" style={{ width: '7rem' }} defaultValue={s.nudge_time.slice(0, 5)} onBlur={(e) => e.target.value && save.mutate({ nudge_time: e.target.value + ':00' })} />
            </label>
          )}
        </div>
      )}
    </Dialog>
  )
}
