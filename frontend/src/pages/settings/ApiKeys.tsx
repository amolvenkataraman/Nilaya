// Settings › API keys: each key reaches only the apps chosen for it, read or read & write. A new key's token is
// shown once, in the dialog that made it, and dropped when the dialog closes.
import { useState } from 'react'
import { Button, Confirm, Dialog, EmptyState, Field, Input, Menu, MenuItem, QueryView, Select, SkeletonRows } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { fmtDate, shortStamp } from '../../lib/dates'
import { type ApiKey, type KeyApp, useApiKeys, useKeyApps, useRevokeKey, useSaveKey } from './api'
import { cardClass } from './Card'
import { Chip } from './Chip'
import { ItemRow } from './ItemRow'
import { SecretBox } from './SecretBox'
import { SettingsSection } from './SettingsSection'

export const day = (iso: string) => fmtDate(new Date(iso), { year: 'numeric', month: 'short', day: 'numeric' })

export function ApiKeysSection() {
  const keys = useApiKeys()
  const apps = useKeyApps()
  const [editing, setEditing] = useState<ApiKey | 'new' | null>(null)
  const label = (app: string) => apps.data?.find((a) => a.app === app)?.label ?? app
  return (
    <SettingsSection
      id="set-api"
      title="API keys"
      description="Let scripts, phone shortcuts and other apps use your data through the API. Each key only reaches the apps you choose."
      actions={
        <Button variant="primary" size="sm" onClick={() => setEditing('new')} disabled={!apps.data}>
          <Icon name="plus" size={14} />
          New key
        </Button>
      }
    >
      <div className={cardClass}>
        <QueryView
          query={keys}
          skeleton={<SkeletonRows rows={2} />}
          isEmpty={(d) => !d.length}
          empty={<EmptyState>No keys yet. Create one to use the API from a script or another app.</EmptyState>}
        >
          {(list) => list.map((k) => <KeyRow key={k.id} k={k} label={label} onEdit={() => setEditing(k)} />)}
        </QueryView>
      </div>
      {editing && apps.data && <KeyDialog apiKey={editing === 'new' ? null : editing} apps={apps.data} onClose={() => setEditing(null)} />}
    </SettingsSection>
  )
}

function KeyRow({ k, label, onEdit }: { k: ApiKey; label: (app: string) => string; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const revoke = useRevokeKey(k)
  const expired = !!k.expires_on && new Date(k.expires_on) <= new Date()
  return (
    <ItemRow
      icon="code"
      off={expired}
      title={
        <>
          <span className="truncate">{k.name}</span>
          {expired && <Chip tone="danger">Expired</Chip>}
        </>
      }
      meta={
        <>
          <code className="font-mono">nly_{k.prefix}_…</code>
          <span>Created {day(k.created_on)}</span>
          <span title={k.last_used_ip ? `From ${k.last_used_ip}` : undefined}>
            {k.last_used_on ? `Last used ${shortStamp(k.last_used_on)}` : 'Never used'}
          </span>
          {k.expires_on && !expired && <span>Expires {day(k.expires_on)}</span>}
          {!k.expires_on && <span>Never expires</span>}
        </>
      }
      actions={
        <>
          <Menu
            align="end"
            trigger={(p) => (
              <Button {...p} variant="ghost" size="sm" icon aria-label={`Actions for ${k.name}`}>
                <Icon name="more" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon="edit"
                  onClick={() => {
                    close()
                    onEdit()
                  }}
                >
                  Edit name and access
                </MenuItem>
                <MenuItem
                  icon="trash"
                  danger
                  onClick={() => {
                    close()
                    setConfirm(true)
                  }}
                >
                  Revoke
                </MenuItem>
              </>
            )}
          </Menu>
          <Confirm
            open={confirm}
            title={`Revoke "${k.name}"?`}
            body="Anything using this key stops working immediately. This can't be undone."
            confirmLabel="Revoke"
            onConfirm={() => revoke.mutate()}
            onClose={() => setConfirm(false)}
          />
        </>
      }
    >
      <div className="flex flex-wrap gap-1">
        {k.scopes.map((s) => {
          const [app, level] = s.split(':')
          return (
            <Chip key={s} tone={level === 'write' ? 'accent' : 'default'}>
              {label(app)}: {level === 'write' ? 'read & write' : 'read'}
            </Chip>
          )
        })}
      </div>
    </ItemRow>
  )
}

const EXPIRY = [
  { value: '30', label: 'In 30 days' },
  { value: '90', label: 'In 90 days' },
  { value: '365', label: 'In a year' },
  { value: '', label: 'Never' },
]
type Level = '' | 'read' | 'write'

function KeyDialog({ apiKey, apps, onClose }: { apiKey: ApiKey | null; apps: KeyApp[]; onClose: () => void }) {
  const [name, setName] = useState(apiKey?.name ?? '')
  const [levels, setLevels] = useState<Record<string, Level>>(() => {
    const out: Record<string, Level> = {}
    for (const a of apps)
      out[a.app] = apiKey?.scopes.includes(`${a.app}:write`) ? 'write' : apiKey?.scopes.includes(`${a.app}:read`) ? 'read' : ''
    return out
  })
  const [expiry, setExpiry] = useState('90')
  const [error, setError] = useState('')
  const [token, setToken] = useState('') // shown once, dropped when the dialog closes
  const save = useSaveKey(apiKey, setError)
  const scopes = Object.entries(levels)
    .filter(([, l]) => l)
    .map(([a, l]) => `${a}:${l}`)
  const submit = () => {
    setError('')
    if (!name.trim()) return setError('Give the key a name so you can recognise it later.')
    if (!scopes.length) return setError('Choose at least one app the key can use.')
    save.mutate(
      { name: name.trim(), scopes, expiryDays: expiry },
      {
        onSuccess: (newToken) => {
          if (newToken) return setToken(newToken)
          toast.show(`Saved "${name.trim()}"`)
          onClose()
        },
      },
    )
  }

  if (token) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Copy your key now"
        width="32rem"
        footer={
          <>
            <span className="flex-1" />
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          This is the only time the key is shown. Store it somewhere safe, such as a password manager. If you lose it, revoke it and make a
          new one.
        </p>
        <SecretBox value={token} label="New API key" />
        <p className="text-xs text-muted">
          Send it as <code>Authorization: Bearer &lt;key&gt;</code> or <code>X-API-Key: &lt;key&gt;</code>.
        </p>
      </Dialog>
    )
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={apiKey ? `Edit ${apiKey.name}` : 'New API key'}
      width="30rem"
      footer={
        <>
          {error ? (
            <span className="flex-1 text-xs text-danger" role="alert">
              {error}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="key-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : apiKey ? 'Save' : 'Create key'}
          </Button>
        </>
      }
    >
      <form
        id="key-form"
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Name">
          <Input value={name} maxLength={64} placeholder="e.g. Phone shortcut" onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="m-0 grid gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 text-xs font-medium text-muted">Access</legend>
          {apps.map((a) => (
            <div key={a.app} className="flex items-center justify-between gap-3 text-sm">
              <label htmlFor={`scope-${a.app}`}>{a.label}</label>
              <Select
                id={`scope-${a.app}`}
                className="w-40! shrink-0 max-md:w-36!"
                value={levels[a.app]}
                onChange={(e) => setLevels((l) => ({ ...l, [a.app]: e.target.value as Level }))}
              >
                <option value="">No access</option>
                <option value="read">Read</option>
                <option value="write">Read &amp; write</option>
              </Select>
            </div>
          ))}
        </fieldset>
        {apiKey ? (
          <p className="text-xs text-muted">
            {apiKey.expires_on ? `Expires ${day(apiKey.expires_on)}.` : 'Never expires.'} The expiry can't be changed; make a new key
            instead.
          </p>
        ) : (
          <Field label="Expires">
            <Select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </Dialog>
  )
}
