// API keys (/keys/), private ICS feeds (/feeds/) and the per-app Markdown guides.
// Secrets (a new key's token, a new feed's URL) live only in component state and are shown once.
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, ErrorBox, Menu, MenuItem, SkeletonRows } from '../../components/ui'
import { toast } from '../../components/toast'
import { del, get, patch, post } from '../../lib/api'
import { fmtDate, shortStamp } from '../../lib/dates'

interface KeyApp { app: string; label: string; scopes: string[] }
interface ApiKey {
  id: string; name: string; prefix: string; scopes: string[]; created_on: string
  expires_on: string | null; last_used_on: string | null; last_used_ip: string | null
}
interface Feed { id: string; kind: 'calendar' | 'tasks'; name: string; created_on: string; last_fetched_on: string | null; fetches: number }

const KEYS = ['settings', 'keys'] as const
const APPS_KEY = ['settings', 'key-apps'] as const
const FEEDS = ['settings', 'feeds'] as const
const FEED_KINDS = { calendar: 'Calendar events', tasks: 'Tasks with due dates' } as const

const useKeyApps = () => useQuery({ queryKey: APPS_KEY, queryFn: () => get<KeyApp[]>('keys/apps'), staleTime: Infinity })
const day = (iso: string) => fmtDate(new Date(iso), { year: 'numeric', month: 'short', day: 'numeric' })

/** Copy to the clipboard; falls back to selecting the element's text. */
export async function copyText(text: string, fallback?: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (fallback) window.getSelection()?.selectAllChildren(fallback)
    return false
  }
}

/** A secret shown once, with a Copy button. */
function SecretBox({ value, label }: { value: string; label: string }) {
  const ref = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState<'' | 'ok' | 'manual'>('')
  return (
    <div className="secret-row">
      <code ref={ref} className="secret" aria-label={label}>{value}</code>
      <button
        type="button"
        className="btn sm"
        onClick={async () => {
          setCopied((await copyText(value, ref.current)) ? 'ok' : 'manual')
          setTimeout(() => setCopied(''), 2000)
        }}
      >
        <Icon name={copied === 'ok' ? 'check' : 'copy'} size={14} />
        {copied === 'ok' ? 'Copied' : copied === 'manual' ? 'Press Ctrl+C' : 'Copy'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- API keys
export function ApiKeysSection() {
  const keys = useQuery({ queryKey: KEYS, queryFn: () => get<ApiKey[]>('keys/') })
  const apps = useKeyApps()
  const [editing, setEditing] = useState<ApiKey | 'new' | null>(null)
  const label = (app: string) => apps.data?.find((a) => a.app === app)?.label ?? app
  return (
    <section className="set-section" aria-labelledby="set-api">
      <div className="set-section-head">
        <div className="grow">
          <h2 id="set-api">API keys</h2>
          <p>Let scripts, phone shortcuts and other apps use your data through the API. Each key only reaches the apps you choose.</p>
        </div>
        <button className="btn primary sm" onClick={() => setEditing('new')} disabled={!apps.data}>
          <Icon name="plus" size={14} />
          New key
        </button>
      </div>
      <div className="set-card">
        {keys.isPending ? (
          <SkeletonRows rows={2} />
        ) : keys.isError && !keys.data ? (
          <div className="card-body"><ErrorBox error={keys.error} retry={() => keys.refetch()} /></div>
        ) : !keys.data.length ? (
          <div className="empty">No keys yet. Create one to use the API from a script or another app.</div>
        ) : (
          keys.data.map((k) => <KeyRow key={k.id} k={k} label={label} onEdit={() => setEditing(k)} />)
        )}
      </div>
      {editing && apps.data && <KeyDialog apiKey={editing === 'new' ? null : editing} apps={apps.data} onClose={() => setEditing(null)} />}
    </section>
  )
}

function KeyRow({ k, label, onEdit }: { k: ApiKey; label: (app: string) => string; onEdit: () => void }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const revoke = useMutation({
    mutationFn: () => del(`keys/${k.id}`),
    onSuccess: () => toast.show(`Revoked "${k.name}"`),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  })
  const expired = !!k.expires_on && new Date(k.expires_on) <= new Date()
  return (
    <div className={'item-row' + (expired ? ' off' : '')}>
      <span className="item-icon" aria-hidden="true"><Icon name="code" /></span>
      <div className="item-main">
        <div className="item-title"><span className="truncate">{k.name}</span>{expired && <span className="chip danger">Expired</span>}</div>
        <div className="item-meta">
          <code>avn_{k.prefix}_…</code>
          <span>Created {day(k.created_on)}</span>
          <span title={k.last_used_ip ? `From ${k.last_used_ip}` : undefined}>{k.last_used_on ? `Last used ${shortStamp(k.last_used_on)}` : 'Never used'}</span>
          {k.expires_on && !expired && <span>Expires {day(k.expires_on)}</span>}
          {!k.expires_on && <span>Never expires</span>}
        </div>
        <div className="item-chips">
          {k.scopes.map((s) => {
            const [app, level] = s.split(':')
            return <span key={s} className={'chip' + (level === 'write' ? ' accent' : '')}>{label(app)}: {level === 'write' ? 'read & write' : 'read'}</span>
          })}
        </div>
      </div>
      <div className="item-actions">
        <Menu align="end" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label={`Actions for ${k.name}`}><Icon name="more" /></button>}>
          {(close) => (
            <>
              <MenuItem icon="edit" onClick={() => (close(), onEdit())}>Edit name and access</MenuItem>
              <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Revoke</MenuItem>
            </>
          )}
        </Menu>
      </div>
      <Confirm
        open={confirm}
        title={`Revoke "${k.name}"?`}
        body="Anything using this key stops working immediately. This can't be undone."
        confirmLabel="Revoke"
        onConfirm={() => revoke.mutate()}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}

const EXPIRY = [
  { value: '30', label: 'In 30 days' },
  { value: '90', label: 'In 90 days' },
  { value: '365', label: 'In a year' },
  { value: '', label: 'Never' },
]

function KeyDialog({ apiKey, apps, onClose }: { apiKey: ApiKey | null; apps: KeyApp[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(apiKey?.name ?? '')
  const [levels, setLevels] = useState<Record<string, '' | 'read' | 'write'>>(() => {
    const out: Record<string, '' | 'read' | 'write'> = {}
    for (const a of apps) out[a.app] = apiKey?.scopes.includes(`${a.app}:write`) ? 'write' : apiKey?.scopes.includes(`${a.app}:read`) ? 'read' : ''
    return out
  })
  const [expiry, setExpiry] = useState('90')
  const [error, setError] = useState('')
  const [token, setToken] = useState('') // shown once, dropped when the dialog closes
  const scopes = Object.entries(levels).filter(([, l]) => l).map(([a, l]) => `${a}:${l}`)
  const save = useMutation({
    mutationFn: async (): Promise<string | null> => {
      if (apiKey) {
        await patch<ApiKey>(`keys/${apiKey.id}`, { name: name.trim(), scopes })
        return null
      }
      const expires_on = expiry ? new Date(Date.now() + Number(expiry) * 86_400_000).toISOString() : null
      return (await post<{ key: ApiKey; token: string }>('keys/', { name: name.trim(), scopes, expires_on })).token
    },
    onSuccess: (newToken) => {
      qc.invalidateQueries({ queryKey: KEYS })
      if (newToken) return setToken(newToken)
      toast.show(`Saved "${name.trim()}"`)
      onClose()
    },
    onError: (e) => setError((e as Error).message),
  })
  const submit = () => {
    setError('')
    if (!name.trim()) return setError('Give the key a name so you can recognise it later.')
    if (!scopes.length) return setError('Choose at least one app the key can use.')
    save.mutate()
  }

  if (token) {
    return (
      <Dialog open onClose={onClose} title="Copy your key now" width="32rem" footer={<><span className="spacer" /><button className="btn primary" onClick={onClose}>Done</button></>}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <p className="small muted">This is the only time the key is shown. Store it somewhere safe, such as a password manager. If you lose it, revoke it and make a new one.</p>
          <SecretBox value={token} label="New API key" />
          <p className="help">Send it as <code>Authorization: Bearer &lt;key&gt;</code> or <code>X-API-Key: &lt;key&gt;</code>.</p>
        </div>
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
          {error ? <span className="error-text grow" role="alert">{error}</span> : <span className="spacer" />}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" form="key-form" disabled={save.isPending}>{save.isPending ? 'Saving…' : apiKey ? 'Save' : 'Create key'}</button>
        </>
      }
    >
      <form id="key-form" className="stack" style={{ gap: 'var(--sp-3)' }} onSubmit={(e) => (e.preventDefault(), submit())}>
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} maxLength={64} placeholder="e.g. Phone shortcut" onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="field scope-list">
          <legend className="label">Access</legend>
          {apps.map((a) => (
            <label key={a.app} className="scope-row">
              <span>{a.label}</span>
              <select className="select" value={levels[a.app]} onChange={(e) => setLevels((l) => ({ ...l, [a.app]: e.target.value as '' | 'read' | 'write' }))}>
                <option value="">No access</option>
                <option value="read">Read</option>
                <option value="write">Read &amp; write</option>
              </select>
            </label>
          ))}
        </fieldset>
        {apiKey ? (
          <p className="help">{apiKey.expires_on ? `Expires ${day(apiKey.expires_on)}.` : 'Never expires.'} The expiry can't be changed; make a new key instead.</p>
        ) : (
          <label className="field">
            <span>Expires</span>
            <select className="select" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
        )}
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------- ICS feeds
export function FeedsSection() {
  const qc = useQueryClient()
  const feeds = useQuery({ queryKey: FEEDS, queryFn: () => get<Feed[]>('feeds/') })
  const [kind, setKind] = useState<Feed['kind']>('calendar')
  const [created, setCreated] = useState<{ url: string; name: string } | null>(null) // shown once
  const create = useMutation({
    mutationFn: (v: { kind: Feed['kind']; name: string; replace?: Feed }) => post<{ feed: Feed; url: string }>('feeds/', { kind: v.kind, name: v.name }),
    onSuccess: (res, v) => {
      setCreated({ url: res.url, name: res.feed.name }) // keep the new URL even if revoking the old one fails
      if (v.replace) {
        del(`feeds/${v.replace.id}`)
          .then(() => toast.show('New address made; the old one stopped working'))
          .catch((e) => toast.error(`New address made, but the old one is still active: ${(e as Error).message}`))
          .finally(() => qc.invalidateQueries({ queryKey: FEEDS }))
      }
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => qc.invalidateQueries({ queryKey: FEEDS }),
  })
  return (
    <section className="set-section" aria-labelledby="set-feeds">
      <div className="set-section-head">
        <div className="grow">
          <h2 id="set-feeds">Calendar feeds</h2>
          <p>
            Private addresses to subscribe to from your phone's calendar app (iOS: Settings → Calendar → Accounts → Add subscribed calendar;
            Google Calendar: Add by URL). Anyone with the address can read the feed, so revoke it if it leaks.
          </p>
        </div>
      </div>
      <div className="set-card">
        <div className="set-row inline">
          <label className="set-label" htmlFor="feed-kind">New feed</label>
          <div className="set-control">
            <select id="feed-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as Feed['kind'])}>
              {Object.entries(FEED_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="btn sm" disabled={create.isPending} onClick={() => create.mutate({ kind, name: kind === 'tasks' ? 'Tasks' : 'Calendar' })}>
              <Icon name="plus" size={14} />
              Create
            </button>
          </div>
        </div>
        {created && (
          <div className="feed-created" role="status">
            <div className="small"><strong>{created.name}</strong> feed address. Copy it now: it's only shown once.</div>
            <SecretBox value={created.url} label="Feed address" />
            <button className="btn ghost sm" onClick={() => setCreated(null)}>Hide</button>
          </div>
        )}
        {feeds.isPending ? (
          <SkeletonRows rows={2} />
        ) : feeds.isError && !feeds.data ? (
          <div className="card-body"><ErrorBox error={feeds.error} retry={() => feeds.refetch()} /></div>
        ) : !feeds.data.length ? (
          <div className="empty item-sep">No feeds yet.</div>
        ) : (
          feeds.data.map((f) => (
            <FeedRow key={f.id} f={f} busy={create.isPending} onRegenerate={() => create.mutate({ kind: f.kind, name: f.name, replace: f })} />
          ))
        )}
      </div>
    </section>
  )
}

function FeedRow({ f, busy, onRegenerate }: { f: Feed; busy: boolean; onRegenerate: () => void }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'revoke' | 'regen' | null>(null)
  const revoke = useMutation({
    mutationFn: () => del(`feeds/${f.id}`),
    onSuccess: () => toast.show('Feed revoked'),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => qc.invalidateQueries({ queryKey: FEEDS }),
  })
  return (
    <div className="item-row item-sep">
      <span className="item-icon" aria-hidden="true"><Icon name={f.kind === 'tasks' ? 'tasks' : 'calendar'} /></span>
      <div className="item-main">
        <div className="item-title"><span className="truncate">{FEED_KINDS[f.kind] ?? f.kind}</span>{f.name && <span className="chip">{f.name}</span>}</div>
        <div className="item-meta">
          <span>Created {day(f.created_on)}</span>
          <span>{f.last_fetched_on ? `Last fetched ${shortStamp(f.last_fetched_on)} · ${f.fetches.toLocaleString()} time${f.fetches === 1 ? '' : 's'}` : 'Never fetched'}</span>
        </div>
      </div>
      <div className="item-actions">
        <Menu align="end" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="Feed actions" disabled={busy}><Icon name="more" /></button>}>
          {(close) => (
            <>
              <MenuItem icon="refresh" onClick={() => (close(), setConfirm('regen'))}>New address</MenuItem>
              <MenuItem icon="trash" danger onClick={() => (close(), setConfirm('revoke'))}>Revoke</MenuItem>
            </>
          )}
        </Menu>
      </div>
      <Confirm
        open={confirm !== null}
        title={confirm === 'regen' ? 'Make a new address?' : 'Revoke this feed?'}
        body={confirm === 'regen'
          ? "The current address stops working; you'll need to subscribe again with the new one."
          : 'Calendar apps subscribed to it stop getting updates.'}
        confirmLabel={confirm === 'regen' ? 'New address' : 'Revoke'}
        onConfirm={() => (confirm === 'regen' ? onRegenerate() : revoke.mutate())}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------- guides
export function GuidesSection() {
  const apps = useKeyApps()
  const [copied, setCopied] = useState('')
  const fetchGuide = async (app: string) => {
    const r = await fetch(`/api/v2/${encodeURIComponent(app)}/guide.md`, { credentials: 'same-origin' })
    if (!r.ok) throw new Error(`Guide unavailable (${r.status})`)
    return r.text()
  }
  const copy = async (app: string) => {
    try {
      await navigator.clipboard.writeText(await fetchGuide(app))
      setCopied(app)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      toast.error('Copy failed, open it instead.')
    }
  }
  const download = async (app: string) => {
    try {
      const url = URL.createObjectURL(new Blob([await fetchGuide(app)], { type: 'text/markdown;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `avnet-${app}-guide.md`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const curl = `curl -H "Authorization: Bearer YOUR_API_KEY" ${location.origin}/api/v2/tasks/?view=today`
  return (
    <section className="set-section" aria-labelledby="set-guides">
      <div className="set-section-head">
        <div>
          <h2 id="set-guides">Developers: guides for developers and AI agents</h2>
          <p>
            One Markdown guide per app: concepts, every endpoint and the JSON schemas. To let an AI agent (or a script) use an app,
            give it that app's guide plus an <a href="#set-api">API key</a> with access to that app. Send the key as{' '}
            <code>Authorization: Bearer &lt;key&gt;</code> or <code>X-API-Key: &lt;key&gt;</code>.
          </p>
        </div>
      </div>
      <div className="set-card">
        {apps.isPending ? <SkeletonRows rows={3} /> : apps.isError && !apps.data ? (
          <div className="card-body"><ErrorBox error={apps.error} retry={() => apps.refetch()} /></div>
        ) : (
          <div className="guide-grid">
            {apps.data.map((a) => (
              <div key={a.app} className="guide">
                <span className="grow truncate">{a.label}<span className="muted xsmall"> · /api/v2/{a.app}/guide.md</span></span>
                <a className="btn ghost sm" href={`/api/v2/${encodeURIComponent(a.app)}/guide.md`} target="_blank" rel="noopener noreferrer">Open</a>
                <button className="btn ghost sm" title="Copy the Markdown guide to paste into an AI agent" onClick={() => copy(a.app)}>
                  {copied === a.app ? 'Copied' : 'Copy'}
                </button>
                <button className="btn ghost sm" title="Download the guide as a .md file" onClick={() => download(a.app)}>Download .md</button>
              </div>
            ))}
          </div>
        )}
        <div className="card-body dev-links">
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <a className="btn sm" href="/api/v2/docs" target="_blank" rel="noopener noreferrer"><Icon name="book" size={14} />Interactive API docs</a>
            <a className="btn sm" href="/api/v2/openapi.json" target="_blank" rel="noopener noreferrer"><Icon name="code" size={14} />OpenAPI schema</a>
          </div>
          <div className="dev-curl">
            <code>{curl}</code>
            <button className="btn ghost icon sm" aria-label="Copy example" title="Copy example" onClick={() => navigator.clipboard?.writeText(curl).then(() => toast.show('Example copied'), () => toast.error('Copy failed'))}><Icon name="copy" size={14} /></button>
          </div>
        </div>
      </div>
    </section>
  )
}
