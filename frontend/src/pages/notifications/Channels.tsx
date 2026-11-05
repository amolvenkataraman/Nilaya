import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, ErrorBox, Menu, MenuItem, SkeletonRows, Switch } from '../../components/ui'
import { toast } from '../../components/toast'
import { del, get, patch, post } from '../../lib/api'
import { shortStamp } from '../../lib/dates'
import type { Channel, ChannelType } from '../../lib/types'

const KEY = ['notifications', 'channels'] as const
const TYPES_KEY = ['notifications', 'channel-types'] as const
const KIND_ICON: Record<string, string> = { ntfy: 'send', gotify: 'send', email: 'mail', discord: 'comment', webhook: 'link' }
export const MIN_PRIORITY = [
  { value: 0, label: 'Everything' },
  { value: 10, label: 'Normal and up' },
  { value: 15, label: 'High and up' },
  { value: 20, label: 'Urgent only' },
]

function useChannelTypes() {
  return useQuery({ queryKey: TYPES_KEY, queryFn: () => get<ChannelType[]>('notifications/channel-types'), staleTime: Infinity })
}

function useChannelPatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<Channel, 'name' | 'enabled' | 'min_priority' | 'config'>> }) =>
      patch<Channel>(`notifications/channels/${id}`, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<Channel[]>(KEY)
      if (!body.config) qc.setQueryData<Channel[]>(KEY, (old) => old?.map((c) => (c.id === id ? { ...c, ...body } as Channel : c)))
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
      toast.error((e as Error).message)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function ChannelsTab() {
  const channels = useQuery({ queryKey: KEY, queryFn: () => get<Channel[]>('notifications/channels') })
  const types = useChannelTypes()
  const [editing, setEditing] = useState<Channel | 'new' | null>(null)
  // Short chip label: "Webhook (JSON, e.g. Home Assistant)" -> "Webhook"
  const label = (kind: string) => (types.data?.find((t) => t.kind === kind)?.label ?? kind).replace(/\s*\(.*\)$/, '')
  return (
    <div className="set-section">
      <div className="set-section-head">
        <div className="grow">
          <h1>Delivery channels</h1>
          <p>Where notifications are sent besides the bell: your phone, email, chat or a webhook.</p>
        </div>
        <button className="btn primary sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} />
          Add channel
        </button>
      </div>
      <div className="chan-list">
        {channels.isPending ? (
          <div className="set-card"><SkeletonRows rows={3} avatar /></div>
        ) : channels.isError && !channels.data ? (
          <ErrorBox error={channels.error} retry={() => channels.refetch()} />
        ) : !channels.data.length ? (
          <div className="set-card empty">No channels yet. Notifications only show in the bell.</div>
        ) : (
          channels.data.map((c) => <ChannelRow key={c.id} c={c} kindLabel={label(c.kind)} onEdit={() => setEditing(c)} />)
        )}
      </div>
      {editing && types.data && (
        <ChannelDialog channel={editing === 'new' ? null : editing} types={types.data} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function destination(c: Channel, types?: ChannelType[]): string {
  const fields = types?.find((t) => t.kind === c.kind)?.fields ?? []
  const pub = fields.find((f) => !f.secret && c.config[f.key])
  return pub ? String(c.config[pub.key]) : ''
}

function ChannelRow({ c, kindLabel, onEdit }: { c: Channel; kindLabel: string; onEdit: () => void }) {
  const qc = useQueryClient()
  const types = useChannelTypes().data
  const update = useChannelPatch()
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const test = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string }>(`notifications/channels/${c.id}/test`),
    onMutate: () => setResult(null),
    onSuccess: (r) => setResult(r.ok ? { ok: true, text: 'Test delivered' } : { ok: false, text: r.error || 'Delivery failed' }),
    onError: (e) => setResult({ ok: false, text: (e as Error).message }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
  const remove = useMutation({
    mutationFn: () => del(`notifications/channels/${c.id}`),
    onSuccess: () => toast.show(`Deleted "${c.name}"`),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
  const dest = destination(c, types)
  return (
    <div className={'chan-row' + (c.enabled ? '' : ' off')}>
      <span className="chan-icon" aria-hidden="true"><Icon name={KIND_ICON[c.kind] ?? 'bell'} /></span>
      <div className="chan-main">
        <div className="chan-title">
          <span className="truncate">{c.name}</span>
          <span className="chip">{kindLabel}</span>
        </div>
        {dest && <div className="chan-dest truncate" title={dest}>{dest}</div>}
        <div className="chan-meta">
          <span className="chip">{MIN_PRIORITY.find((p) => p.value === c.min_priority)?.label ?? `Priority ${c.min_priority}+`}</span>
          {c.last_sent_at ? <span>Last sent {shortStamp(c.last_sent_at)}</span> : <span>Never sent</span>}
          {result && (
            <span className={result.ok ? 'chan-ok' : 'chan-error'} role="status">
              <Icon name={result.ok ? 'check' : 'alert'} size={12} /><span className="truncate">{result.text}</span>
            </span>
          )}
          {c.last_error && !result && (
            <span className="chan-error" title={c.last_error}>
              <Icon name="alert" size={12} />
              <span className="truncate">{c.last_error}</span>
            </span>
          )}
        </div>
      </div>
      <div className="chan-actions">
        <select
          className="select chan-prio"
          aria-label={`Minimum priority for ${c.name}`}
          value={c.min_priority}
          onChange={(e) => update.mutate({ id: c.id, body: { min_priority: Number(e.target.value) } })}
        >
          {!MIN_PRIORITY.some((p) => p.value === c.min_priority) && <option value={c.min_priority}>Priority {c.min_priority}+</option>}
          {MIN_PRIORITY.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <button className="btn sm" onClick={() => test.mutate()} disabled={test.isPending || !c.enabled}>
          {test.isPending ? 'Sending…' : 'Test'}
        </button>
        <span className="chan-switch" title={c.enabled ? 'Enabled' : 'Disabled'}>
          <Switch checked={c.enabled} onChange={(v) => update.mutate({ id: c.id, body: { enabled: v } })} label={<span className="sr-only">Enabled</span>} />
        </span>
        <Menu
          align="end"
          label={`${c.name} actions`}
          trigger={(p) => (
            <button {...p} className="btn ghost icon sm" aria-label={`More actions for ${c.name}`}>
              <Icon name="moreV" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon="edit" onClick={() => (close(), onEdit())}>Edit</MenuItem>
              <MenuItem icon="send" onClick={() => (close(), test.mutate())}>Send test</MenuItem>
              <div className="menu-sep" />
              <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete</MenuItem>
            </>
          )}
        </Menu>
      </div>
      <Confirm
        open={confirm}
        title={`Delete "${c.name}"?`}
        body="Notifications will no longer be delivered here."
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}

function ChannelDialog({ channel, types, onClose }: { channel: Channel | null; types: ChannelType[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [kind, setKind] = useState(channel?.kind ?? types[0]?.kind ?? '')
  const type = types.find((t) => t.kind === kind)
  const [name, setName] = useState(channel?.name ?? type?.label ?? '')
  const [nameTouched, setNameTouched] = useState(!!channel)
  const [minPriority, setMinPriority] = useState(channel?.min_priority ?? 0)
  // Secrets come back masked ("••••6789"): never prefill them; blank on save keeps the stored value.
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of type?.fields ?? []) out[f.key] = channel && !f.secret ? String(channel.config[f.key] ?? '') : ''
    return out
  })
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => {
      const cfg = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, v.trim()]))
      return channel
        ? patch<Channel>(`notifications/channels/${channel.id}`, { name: name.trim(), min_priority: minPriority, config: cfg })
        : post<Channel>('notifications/channels', { kind, name: name.trim(), config: cfg, enabled: true, min_priority: minPriority })
    },
    onSuccess: (c) => {
      toast.show(channel ? `Saved "${c.name}"` : `Added "${c.name}"`)
      qc.invalidateQueries({ queryKey: KEY })
      onClose()
    },
    onError: (e) => setError((e as Error).message),
  })
  const missing = (type?.fields ?? []).filter((f) => f.required && !config[f.key]?.trim() && !(channel && f.secret))
  const canSave = !!name.trim() && !missing.length && !save.isPending
  return (
    <Dialog
      open
      onClose={onClose}
      title={channel ? `Edit ${channel.name}` : 'Add a delivery channel'}
      footer={
        <>
          {error ? <span className="error-text grow">{error}</span> : <span className="spacer" />}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="chan-form" type="submit" disabled={!canSave}>
            {save.isPending ? 'Saving…' : channel ? 'Save' : 'Add channel'}
          </button>
        </>
      }
    >
      <form
        id="chan-form"
        className="stack"
        style={{ gap: 'var(--sp-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          if (canSave) save.mutate()
        }}
      >
        {!channel && (
          <label className="field">
            <span>Type</span>
            <select
              className="select"
              value={kind}
              onChange={(e) => {
                const k = e.target.value
                setKind(k)
                const t = types.find((x) => x.kind === k)
                setConfig(Object.fromEntries((t?.fields ?? []).map((f) => [f.key, ''])))
                if (!nameTouched) setName(t?.label ?? '')
              }}
            >
              {types.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} maxLength={64} required onChange={(e) => (setName(e.target.value), setNameTouched(true))} />
        </label>
        {type?.fields.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}{f.required && !(channel && f.secret) ? '' : ' '}</span>
            <input
              className="input"
              type={f.secret ? 'password' : f.key === 'address' ? 'email' : 'text'}
              autoComplete={f.secret ? 'new-password' : 'off'}
              spellCheck={false}
              value={config[f.key] ?? ''}
              required={f.required && !(channel && f.secret)}
              placeholder={channel && f.secret ? `Leave blank to keep ${channel.config[f.key] ? String(channel.config[f.key]) : 'the current value'}` : ''}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        <label className="field">
          <span>Send</span>
          <select className="select" value={minPriority} onChange={(e) => setMinPriority(Number(e.target.value))}>
            {MIN_PRIORITY.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </form>
    </Dialog>
  )
}
