// New calendar: blank, or synced from a link (iCalendar, public Google, UWaterloo WCMS) with a preview first.
// Mounted only while open, so every opening starts from the defaults. Loaded on demand.
import { useState } from 'react'
import { Button, Dialog, Field, FieldRow, Input, Segmented, Switch } from '../../components/ui'
import type { Calendar } from '../../lib/types'
import { useCalendarIcons, useCreateCalendar } from './api'
import { ColourChoice } from './ColourChoice'
import { CAL_COLOURS } from './colours'
import { IconPicker } from './IconPicker'
import { SettingRow, srOnly } from './SettingRow'
import { clampMonths, MAX_SYNC_MONTHS, SourceFields, sourceProblem, type SourceType } from './SyncSetup'

export default function NewCalendarDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Calendar) => void }) {
  const icons = useCalendarIcons().data ?? []
  const [mode, setMode] = useState<'blank' | 'sync'>('blank')
  const [name, setName] = useState('')
  const [colour, setColour] = useState(CAL_COLOURS[0])
  const [icon, setIcon] = useState('calendar')
  const [type, setType] = useState<SourceType>(1)
  const [url, setUrl] = useState('')
  const [auto, setAuto] = useState(true)
  const [back, setBack] = useState(1)
  const [ahead, setAhead] = useState(6)
  const syncing = mode === 'sync'
  const create = useCreateCalendar()
  const ok = !!name.trim() && (!syncing || !sourceProblem(type, url))
  const submit = () =>
    ok &&
    create.mutate(
      {
        name: name.trim(),
        colour,
        icon,
        sync: syncing
          ? { calendar_type: type, calendar_url: url.trim(), auto_sync: auto, sync_past_months: back, sync_future_months: ahead }
          : undefined,
      },
      {
        onSuccess: (c) => {
          onClose()
          onCreated(c)
        },
      },
    )
  const months = (label: string, value: number, set: (n: number) => void) => (
    <Field label={label}>
      <Input type="number" min={0} max={MAX_SYNC_MONTHS} value={value} onChange={(e) => set(clampMonths(e.target.value))} />
    </Field>
  )
  return (
    <Dialog
      open
      onClose={onClose}
      title="New calendar"
      width="32rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok || create.isPending} onClick={submit}>
            {syncing ? 'Create and sync' : 'Create calendar'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Segmented
          label="Kind of calendar"
          className="w-full flex-wrap [&>button]:flex-1 [&>button]:justify-center [&>button]:whitespace-nowrap"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'blank', label: 'Blank calendar', icon: 'calendar' },
            { value: 'sync', label: 'Sync from a link', icon: 'refresh' },
          ]}
        />
        {syncing && (
          <SourceFields
            type={type}
            url={url}
            onType={setType}
            onUrl={setUrl}
            onName={(n) => setName((cur) => (cur.trim() ? cur : n.slice(0, 64)))}
            autoFocus
          />
        )}
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus={!syncing} />
        </Field>
        {syncing && (
          <>
            <SettingRow label="Sync automatically" help="Keeps it up to date in the background.">
              <Switch checked={auto} onChange={setAuto} label={srOnly('Sync automatically')} />
            </SettingRow>
            <FieldRow>
              {months('Months back', back, setBack)}
              {months('Months ahead', ahead, setAhead)}
            </FieldRow>
          </>
        )}
        <div className="grid gap-1.25">
          <span className="text-xs font-medium text-muted">Colour</span>
          <ColourChoice value={colour} onChange={(c) => setColour(c || CAL_COLOURS[0])} />
        </div>
        <div className="grid gap-1.25">
          <span className="text-xs font-medium text-muted">Icon</span>
          <IconPicker value={icon} onChange={setIcon} icons={icons} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
