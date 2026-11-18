// The settings drawer's Sync section: a synced calendar's source, status and options (owners and admins can
// change them), or, for a local calendar, a way to connect it to a source.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Confirm, Field, FieldRow, Input, PanelRow, PanelSection, Switch } from '../../components/ui'
import { toast } from '../../components/toast'
import { shortStamp } from '../../lib/dates'
import { useSaveCalendar, useSyncCalendar } from './api'
import {
  clampMonths,
  MAX_SYNC_MONTHS,
  RangeSyncDialog,
  SOURCES,
  SourceFields,
  SourceTypes,
  sourceProblem,
  type SourceType,
} from './SyncSetup'
import type { CalendarDetail } from './types'

export function SyncSection({ cal, canSync }: { cal: CalendarDetail; canSync: boolean }) {
  const save = useSaveCalendar(cal.id)
  const run = useSyncCalendar(cal.id, cal.name)
  const [ranging, setRanging] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const s = cal.sync
  const err = s?.last_sync_error || s?.last_error
  const type = (cal.calendar_type === 2 || cal.calendar_type === 50 ? cal.calendar_type : 1) as SourceType
  if (!cal.synced && canSync) return <SetupSync cal={cal} />
  const months = (label: string, value: number, key: 'past_months' | 'future_months') => (
    <Field label={label}>
      <Input
        type="number"
        min={0}
        max={MAX_SYNC_MONTHS}
        defaultValue={value}
        onBlur={(e) => {
          const v = clampMonths(e.target.value)
          if (v !== value) save.mutate({ sync: { [key]: v } })
        }}
      />
    </Field>
  )
  return (
    <PanelSection id="cs-sync" title="Sync">
      {canSync && (
        <div className="grid gap-1.25">
          <span className="text-xs font-medium text-muted">Source</span>
          <SourceTypes
            type={type}
            disabled={save.isPending}
            onType={(t) => t !== type && save.mutate({ calendar_type: t, ...(s?.url ? { calendar_url: s.url } : {}) })}
          />
        </div>
      )}
      {canSync ? (
        // key: the field starts again from the saved link after each save
        <SyncUrl key={s?.url ?? ''} url={s?.url ?? ''} type={type} onSave={(url) => save.mutate({ sync: { url } })} />
      ) : (
        s?.url && (
          <p className="truncate text-sm text-muted" title={s.url}>
            {s.url}
          </p>
        )
      )}
      <p className="text-sm">{s?.last_synced_at ? <>Last synced {shortStamp(s.last_synced_at)}</> : 'Not synced yet'}</p>
      {err && <p className="text-xs text-danger">{err}</p>}
      {canSync && s && (
        <>
          <PanelRow label="Sync automatically">
            <Switch checked={s.auto_sync} onChange={(v) => save.mutate({ sync: { auto_sync: v } })} ariaLabel="Auto sync" />
          </PanelRow>
          {/* key: the fields restart from the saved values after each save */}
          <FieldRow key={`${s.past_months}-${s.future_months}`}>
            {months('Months back', s.past_months, 'past_months')}
            {months('Months ahead', s.future_months, 'future_months')}
          </FieldRow>
        </>
      )}
      {canSync && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => run.mutate(undefined)} disabled={run.isPending}>
            <Icon name="refresh" size={14} />
            {run.isPending ? 'Syncing…' : 'Sync now'}
          </Button>
          <Button size="sm" onClick={() => setRanging(true)}>
            <Icon name="calendar" size={14} />
            Sync a range…
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setDisconnecting(true)}>
            Disconnect
          </Button>
        </div>
      )}
      {ranging && <RangeSyncDialog id={cal.id} name={cal.name} google={type === 2} onClose={() => setRanging(false)} />}
      <Confirm
        open={disconnecting}
        onClose={() => setDisconnecting(false)}
        title={`Disconnect "${cal.name}"?`}
        body="It becomes a local calendar: the events already synced stay, and automatic syncing stops. You can connect it again later."
        confirmLabel="Disconnect"
        danger={false}
        disabled={save.isPending}
        onConfirm={() => save.mutate({ calendar_type: 0 }, { onSuccess: () => toast.show(`"${cal.name}" is a local calendar now`) })}
      />
    </PanelSection>
  )
}

/** A local calendar (owners/admins): connect it to a source. */
function SetupSync({ cal }: { cal: CalendarDetail }) {
  const save = useSaveCalendar(cal.id)
  const run = useSyncCalendar(cal.id, cal.name)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<SourceType>(1)
  const [url, setUrl] = useState('')
  const [auto, setAuto] = useState(true)
  const connect = () =>
    save.mutate({ calendar_type: type, calendar_url: url.trim(), auto_sync: auto }, { onSuccess: () => run.mutate(undefined) })
  return (
    <PanelSection id="cs-sync" title="Sync">
      {!open ? (
        <PanelRow label="Local calendar" help="Fill it from an iCalendar link, a public Google calendar or UWaterloo WCMS.">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Icon name="refresh" size={14} />
            Set up sync
          </Button>
        </PanelRow>
      ) : (
        <div className="grid gap-3">
          <SourceFields type={type} url={url} onType={setType} onUrl={setUrl} autoFocus />
          <PanelRow label="Sync automatically">
            <Switch checked={auto} onChange={setAuto} ariaLabel="Sync automatically" />
          </PanelRow>
          <div className="flex items-center gap-1.5">
            <span className="flex-1" />
            <Button size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={connect} disabled={!!sourceProblem(type, url) || save.isPending || run.isPending}>
              {save.isPending || run.isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </div>
      )}
    </PanelSection>
  )
}

function SyncUrl({ url, type, onSave }: { url: string; type: SourceType; onSave: (u: string) => void }) {
  const [v, setV] = useState(url)
  const problem = sourceProblem(type, v)
  const src = SOURCES.find((x) => x.type === type)!
  return (
    <Field label={src.field} error={problem}>
      <Input
        value={v}
        maxLength={256}
        placeholder={src.placeholder}
        aria-invalid={!!problem}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => !problem && v.trim() !== url && onSave(v.trim())}
      />
    </Field>
  )
}
