// Add or edit a delivery channel. The fields come from the server's channel types; secrets come back masked
// ("••••6789"), so they're never prefilled and a blank secret on save keeps the stored one.
import { useState } from 'react'
import { Button, Dialog, Field, Input, Select } from '../../components/ui'
import type { Channel, ChannelType } from '../../lib/types'
import { MIN_PRIORITY, useSaveChannel } from './api'

export function ChannelDialog({ channel, types, onClose }: { channel: Channel | null; types: ChannelType[]; onClose: () => void }) {
  const [kind, setKind] = useState(channel?.kind ?? types[0]?.kind ?? '')
  const type = types.find((t) => t.kind === kind)
  const [name, setName] = useState(channel?.name ?? type?.label ?? '')
  const [nameTouched, setNameTouched] = useState(!!channel)
  const [minPriority, setMinPriority] = useState(channel?.min_priority ?? 0)
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of type?.fields ?? []) out[f.key] = channel && !f.secret ? String(channel.config[f.key] ?? '') : ''
    return out
  })
  const [error, setError] = useState('')
  const save = useSaveChannel(channel, onClose, setError)
  const keepsSecret = (secret: boolean) => !!channel && secret
  const missing = (type?.fields ?? []).filter((f) => f.required && !config[f.key]?.trim() && !keepsSecret(f.secret))
  const canSave = !!name.trim() && !missing.length && !save.isPending
  return (
    <Dialog
      open
      onClose={onClose}
      title={channel ? `Edit ${channel.name}` : 'Add a delivery channel'}
      footer={
        <>
          {error ? <span className="flex-1 text-xs text-danger">{error}</span> : <span className="flex-1" />}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="chan-form" type="submit" disabled={!canSave}>
            {save.isPending ? 'Saving…' : channel ? 'Save' : 'Add channel'}
          </Button>
        </>
      }
    >
      <form
        id="chan-form"
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          if (canSave)
            save.mutate({
              kind,
              name: name.trim(),
              min_priority: minPriority,
              config: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, v.trim()])),
            })
        }}
      >
        {!channel && (
          <Field label="Type">
            <Select
              value={kind}
              onChange={(e) => {
                const k = e.target.value
                setKind(k)
                const t = types.find((x) => x.kind === k)
                setConfig(Object.fromEntries((t?.fields ?? []).map((f) => [f.key, ''])))
                if (!nameTouched) setName(t?.label ?? '')
              }}
            >
              {types.map((t) => (
                <option key={t.kind} value={t.kind}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Name">
          <Input
            value={name}
            maxLength={64}
            required
            onChange={(e) => {
              setName(e.target.value)
              setNameTouched(true)
            }}
          />
        </Field>
        {type?.fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input
              type={f.secret ? 'password' : f.key === 'address' ? 'email' : 'text'}
              autoComplete={f.secret ? 'new-password' : 'off'}
              spellCheck={false}
              value={config[f.key] ?? ''}
              required={f.required && !keepsSecret(f.secret)}
              placeholder={
                channel && f.secret
                  ? `Leave blank to keep ${channel.config[f.key] ? String(channel.config[f.key]) : 'the current value'}`
                  : ''
              }
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          </Field>
        ))}
        <Field label="Send">
          <Select value={minPriority} onChange={(e) => setMinPriority(Number(e.target.value))}>
            {MIN_PRIORITY.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  )
}
