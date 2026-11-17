// New / edit habit: templates to start from, name, yes/no or measurable (goal, unit, target per period),
// schedule, icon, colour, reminder, dates and notes; Archive and Delete when editing.
// Each opening remounts the form, so it starts from the habit as it is now (or blank).
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button, ColourPicker, Confirm, Dialog, Field, FieldRow, Input, Segmented, Select, Switch, Textarea } from '../../components/ui'
import { cn } from '../../lib/cn'
import { dayKey } from '../../lib/dates'
import {
  useArchiveHabit,
  useDeleteHabit,
  useSaveHabit,
  type Goal,
  type Habit,
  type HabitInput,
  type Kind,
  type Period,
  type Schedule,
} from './api'
import { HABIT_COLOURS, HABIT_ICONS, HabitIcon } from './HabitBadge'
import { WEEKDAY_LETTERS, WEEKDAY_NAMES } from './habitRules'

interface Form {
  name: string
  description: string
  colour: string
  icon: string
  kind: Kind
  unit: string
  goal: Goal
  target: string
  period: Period
  schedule: Schedule
  weekdays: number
  interval: string
  start_date: string
  end_date: string
  reminder: boolean
  reminder_time: string
  reminder_days: number
}

const blank = (): Form => ({
  name: '',
  description: '',
  colour: '',
  icon: '',
  kind: 'yesno',
  unit: '',
  goal: 'at_least',
  target: '1',
  period: 'day',
  schedule: 'daily',
  weekdays: 127,
  interval: '2',
  start_date: dayKey(new Date()),
  end_date: '',
  reminder: false,
  reminder_time: '20:00',
  reminder_days: 127,
})

/** "Start from" templates, the same list the classic editor had. */
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

const KINDS = [
  { value: 'yesno', label: 'Yes / no' },
  { value: 'measurable', label: 'Measurable' },
] as const
const SCHEDULES = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Some days' },
  { value: 'interval', label: 'Every N days' },
] as const
/** The palette's default ('') is the accent, which the picker shows as a swatch of its own. */
const ACCENT = 'var(--app-accent)'
const SWATCHES = HABIT_COLOURS.map(([hex]) => hex || ACCENT)
const SWATCH_NAMES = Object.fromEntries(HABIT_COLOURS.map(([hex, name]) => [hex || ACCENT, name]))

// Segmented's buttons keep the browser's border and grey fill; the class below clears them until it does.

const fromHabit = (h: Habit): Form => ({
  name: h.name,
  description: h.description,
  colour: h.colour,
  icon: h.icon,
  kind: h.kind,
  unit: h.unit,
  goal: h.goal,
  target: String(h.target),
  period: h.period,
  schedule: h.schedule,
  weekdays: h.weekdays,
  interval: String(h.interval),
  start_date: h.start_date,
  end_date: h.end_date ?? '',
  reminder: !!h.reminder_time,
  reminder_time: h.reminder_time?.slice(0, 5) ?? '20:00',
  reminder_days: h.reminder_days,
})

/** A label over controls that aren't one input (a switch group, pickers): not a <label>. */
function Group({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1.25">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  )
}

function DayPicker({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0" aria-label={label}>
      {WEEKDAY_LETTERS.map((l, i) => {
        const on = !!((value >> i) & 1)
        return (
          <button
            key={WEEKDAY_NAMES[i]}
            type="button"
            className={cn(
              'size-8 rounded-full border text-xs font-semibold',
              on ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface text-muted',
            )}
            aria-pressed={on}
            aria-label={WEEKDAY_NAMES[i]}
            title={WEEKDAY_NAMES[i]}
            onClick={() => onChange(value ^ (1 << i))}
          >
            {l}
          </button>
        )
      })}
    </fieldset>
  )
}

interface Props {
  open: boolean
  habit: Habit | null
  onClose: () => void
  onSaved?: (h: Habit) => void
}

export function HabitDialog(props: Props) {
  // Count openings (adjusting state while rendering) and remount the form on each one.
  const [opens, setOpens] = useState({ open: props.open, n: 0 })
  if (opens.open !== props.open) setOpens({ open: props.open, n: opens.n + (props.open ? 1 : 0) })
  return <HabitForm key={opens.n} {...props} />
}

function HabitForm({ open, habit, onClose, onSaved }: Props) {
  const save = useSaveHabit()
  const archive = useArchiveHabit()
  const remove = useDeleteHabit()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [f, setF] = useState<Form>(() => (habit ? fromHabit(habit) : blank()))
  const [error, setError] = useState('')
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))

  const submit = () => {
    if (!f.name.trim()) return setError('Give the habit a name.')
    const target = Number(f.target)
    if (!(target > 0) && f.goal === 'at_least' && !(f.kind === 'yesno' && f.period === 'day'))
      return setError('The target must be more than 0.')
    const body: HabitInput = {
      name: f.name.trim(),
      description: f.description,
      colour: f.colour,
      icon: f.icon,
      kind: f.kind,
      unit: f.kind === 'measurable' ? f.unit.trim() : '',
      goal: f.kind === 'yesno' ? 'at_least' : f.goal,
      target: f.kind === 'yesno' && f.period === 'day' ? 1 : target,
      period: f.period,
      schedule: f.schedule,
      weekdays: f.weekdays,
      interval: Math.max(1, Number(f.interval) || 1),
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      reminder_time: f.reminder ? f.reminder_time + ':00' : null,
      reminder_days: f.reminder_days,
    }
    save.mutate(
      { id: habit?.id, body },
      {
        onSuccess: (h) => {
          onSaved?.(h)
          onClose()
        },
        onError: (e) => setError((e as Error).message),
      },
    )
  }
  // Yes/no: "1 time a week" is rarely meant; start a week at 3 like the classic editor, and keep within the period.
  const setPeriod = (period: Period) =>
    setF((x) => {
      if (x.kind !== 'yesno') return { ...x, period }
      const n = Number(x.target) || 1
      const target = period === 'day' ? 1 : period === 'week' && n <= 1 ? 3 : Math.min(period === 'week' ? 7 : 31, Math.max(1, n))
      return { ...x, period, target: String(target) }
    })

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
              <Button
                variant="ghost"
                onClick={() => {
                  archive.mutate({ id: habit.id, archived: !habit.archived })
                  onClose()
                }}
              >
                {habit.archived ? 'Unarchive' : 'Archive'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </>
          )}
          {error && (
            <span className="min-w-0 flex-auto text-xs text-danger" role="alert">
              {error}
            </span>
          )}
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            {habit ? 'Save' : 'Create habit'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {!habit && (
          <Group label="Start from">
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map(({ target, ...t }) => {
                const on = f.name === t.name
                return (
                  <button
                    key={t.name}
                    type="button"
                    className={cn(
                      'inline-flex h-7.5 items-center gap-1.5 rounded-full border px-3 py-0 text-xs font-medium text-fg',
                      '[&_svg]:text-(--hc) dark:[&_svg]:text-[color-mix(in_srgb,var(--hc)_70%,white)]',
                      on
                        ? 'border-(--hc) bg-[color-mix(in_srgb,var(--hc)_14%,var(--app-surface))]'
                        : 'border-border bg-surface hover:border-[color-mix(in_srgb,var(--hc)_50%,var(--app-border))] hover:bg-[color-mix(in_srgb,var(--hc)_8%,var(--app-surface))]',
                    )}
                    style={{ ['--hc' as string]: t.colour }}
                    aria-pressed={on}
                    onClick={() => {
                      setF((x) => ({ ...blank(), start_date: x.start_date, ...t, target: String(target ?? 1) }))
                      setError('')
                    }}
                  >
                    <HabitIcon name={t.icon ?? ''} size={0.875} />
                    {t.name}
                  </button>
                )
              })}
            </div>
          </Group>
        )}
        <Field label="Name">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="e.g. Read 20 minutes" autoFocus />
        </Field>

        <Group label="Type">
          <Segmented
            label="Type"
            value={f.kind}
            options={KINDS}
            onChange={(kind) => setF((x) => (kind === 'yesno' ? { ...x, kind, goal: 'at_least' } : { ...x, kind }))}
          />
        </Group>

        {f.kind === 'measurable' && (
          <FieldRow>
            <Field label="Goal">
              <Select value={f.goal} onChange={(e) => set('goal', e.target.value as Goal)}>
                <option value="at_least">At least</option>
                <option value="at_most">At most (a limit)</option>
              </Select>
            </Field>
            <Field label="Unit">
              <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} maxLength={24} placeholder="glasses, minutes, km" />
            </Field>
          </FieldRow>
        )}

        <FieldRow>
          {showTarget && (
            <Field label={f.kind === 'yesno' ? 'Times' : 'Target'}>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={f.kind === 'yesno' ? 1 : 'any'}
                max={f.kind === 'yesno' ? (f.period === 'week' ? 7 : 31) : 1000000}
                value={f.target}
                onChange={(e) => set('target', e.target.value)}
              />
            </Field>
          )}
          <Field label="Per">
            <Select value={f.period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </Select>
          </Field>
        </FieldRow>
        {f.kind === 'measurable' && f.goal === 'at_most' && (
          <span className="-mt-2 text-xs text-muted">A limit: days are kept unless you log going over.</span>
        )}

        <Group
          label="Schedule"
          hint={f.period !== 'day' ? 'Shows on these days until the goal is met.' : 'Days off the schedule never break a streak.'}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Schedule" value={f.schedule} options={SCHEDULES} onChange={(v) => set('schedule', v)} />
            {f.schedule === 'weekdays' && <DayPicker value={f.weekdays} onChange={(v) => set('weekdays', v)} label="Scheduled days" />}
            {f.schedule === 'interval' && (
              <label className="flex items-center gap-2 text-sm" htmlFor="h-interval">
                Every{' '}
                <Input
                  id="h-interval"
                  className="w-18!"
                  type="number"
                  min={1}
                  max={365}
                  value={f.interval}
                  onChange={(e) => set('interval', e.target.value)}
                  aria-label="Interval in days"
                />{' '}
                days from the start date
              </label>
            )}
          </div>
        </Group>

        <Group label="Icon">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Icon">
            <IconOption on={!f.icon} label="Letter" onPick={() => set('icon', '')}>
              <span className="font-semibold">{(f.name.trim()[0] ?? 'A').toUpperCase()}</span>
            </IconOption>
            {HABIT_ICONS.map((i) => (
              <IconOption key={i} on={f.icon === i} label={i} onPick={() => set('icon', i)}>
                <HabitIcon name={i} />
              </IconOption>
            ))}
          </div>
        </Group>

        <Group label="Colour">
          <ColourPicker
            value={f.colour || ACCENT}
            colours={SWATCHES}
            names={SWATCH_NAMES}
            onChange={(c) => set('colour', !c || c === ACCENT ? '' : c)}
          />
        </Group>

        <Group label="Reminder" hint={f.reminder ? "Sent through your notification channels if the habit isn't done yet." : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <Switch checked={f.reminder} onChange={(v) => set('reminder', v)} label={f.reminder ? '' : 'Off'} />
            {f.reminder && (
              <>
                <Input
                  className="w-28!"
                  type="time"
                  value={f.reminder_time}
                  onChange={(e) => set('reminder_time', e.target.value)}
                  aria-label="Reminder time"
                />
                <DayPicker value={f.reminder_days} onChange={(v) => set('reminder_days', v)} label="Reminder days" />
              </>
            )}
          </div>
        </Group>

        <FieldRow>
          <Field label="Start">
            <Input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
          <Field label="End (optional)">
            <Input type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
        </FieldRow>

        <Field label="Notes">
          <Textarea
            rows={2}
            value={f.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={2000}
            placeholder="Why this habit matters (optional)"
          />
        </Field>
      </form>
      {habit && (
        <Confirm
          open={confirmDelete}
          title={`Delete "${habit.name}"?`}
          body="All of its history is deleted too. Archive it instead to keep the stats."
          onConfirm={() => {
            remove.mutate(habit.id, { onSuccess: () => navigate('/habits') })
            onClose()
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Dialog>
  )
}

function IconOption({ on, label, onPick, children }: { on: boolean; label: string; onPick: () => void; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a swatch-style picker, like the shared ColourPicker
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label === 'Letter' ? undefined : label}
      title={label}
      className={cn(
        'grid size-8 place-items-center rounded-sm border text-xs font-bold',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-muted',
      )}
      onClick={onPick}
    >
      {children}
    </button>
  )
}
