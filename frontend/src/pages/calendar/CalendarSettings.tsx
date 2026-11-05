// Calendar settings drawer (from a calendar's "…" menu) and the New calendar dialog; loaded on demand.
// Contract: GET/PATCH /calendar/calendars/{id}, .../subscribers, .../invites, .../sync,
// DELETE /calendar/calendars/{id}?confirm=<name>, GET /calendar/icons. While the detail endpoints
// aren't deployed the drawer falls back to the list item and the fields PATCH already accepts.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Dialog, Drawer, ErrorBox, SkeletonRows, Switch } from '../../components/ui'
import { toast } from '../../components/toast'
import { ApiError, del, get, patch, post } from '../../lib/api'
import { fmtDate, parseDayKey, shortStamp } from '../../lib/dates'
import type { Calendar } from '../../lib/types'
import { CAL_COLOURS, copyText, personName, publicUrl, type Person } from './calendarCommon'

export interface CalendarDetail extends Calendar {
  calendar_colour: string // the calendar's own colour (PATCH calendar_colour)
  my_colour: string | null // my personal colour for it (PATCH my_colour)
  icon: string; description: string; notify: boolean
  owner?: Person | null
  subscription?: { colour: string | null; visible: boolean; notify: boolean; display_busy: number } | null
  subscriber_count?: number
  sync?: { url: string | null; auto_sync: boolean; past_months: number; future_months: number; last_synced_at: string | null; last_error: string; last_sync_error?: string } | null
}
type CalendarPatchBody = Partial<{
  name: string; calendar_colour: string; my_colour: string | null; icon: string; description: string; active: boolean; public: boolean
  time_zone: string; tags: string[]
  visible: boolean; notify: boolean; display_busy: number; sync: Partial<{ url: string; auto_sync: boolean; past_months: number; future_months: number }>
}>
export interface Subscriber { id: number; user: Person; role: 'owner' | 'admin' | 'subscriber'; display_busy: number }
export interface Invite { id: number; code: string; role: 'admin' | 'subscriber'; expires_on: string | null; max_uses: number | null; uses: number; active: boolean; usable: boolean }

const FALLBACK_ICONS = ['calendar', 'user', 'users', 'tasks', 'flag', 'star', 'home', 'map', 'clock', 'bell', 'photo', 'repeat']

const ZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [] } catch { return [] } })()

const notFound = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405)
const onError = (e: unknown) => toast.error((e as Error).message)

function useCalendarDetail(cal: Calendar) {
  return useQuery({
    queryKey: ['calendar', 'detail', cal.id],
    queryFn: async (): Promise<CalendarDetail & { _fallback?: boolean }> => {
      try {
        return await get<CalendarDetail>(`calendar/calendars/${cal.id}`)
      } catch (e) {
        if (notFound(e)) return { ...cal, calendar_colour: cal.colour, my_colour: null, icon: cal.icon ?? '', description: cal.description ?? '', notify: cal.notify ?? true, _fallback: true }
        throw e
      }
    },
    retry: false,
  })
}
const useIcons = () =>
  useQuery({
    queryKey: ['calendar', 'icons'],
    queryFn: async () => {
      try {
        const r = await get<(string | { key: string })[]>('calendar/icons')
        return r.map((x) => (typeof x === 'string' ? x : x.key))
      } catch (e) {
        if (notFound(e)) return FALLBACK_ICONS
        throw e
      }
    },
    staleTime: Infinity,
  })
const useSubList = <T,>(cal: Calendar, what: 'subscribers' | 'invites', enabled: boolean) =>
  useQuery({
    queryKey: ['calendar', what, cal.id],
    queryFn: async () => {
      try {
        return { items: await get<T[]>(`calendar/calendars/${cal.id}/${what}`), missing: false }
      } catch (e) {
        if (notFound(e)) return { items: [] as T[], missing: true }
        throw e
      }
    },
    enabled,
    retry: false,
  })

function useSaveCalendar(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CalendarPatchBody) => patch<CalendarDetail>(`calendar/calendars/${id}`, body),
    onSuccess: (d) => {
      qc.setQueryData(['calendar', 'detail', id], d)
      // Colours, visibility and names show in the list and on events; nothing else needs refetching.
      qc.invalidateQueries({ queryKey: ['calendar', 'calendars'] })
      qc.invalidateQueries({ queryKey: ['calendar', 'events'] })
    },
    onError,
  })
}

/** A colour or icon row of round buttons (same style as Habits). */
function Picker({ label, value, options, render, onPick, custom }: {
  label: string; value: string; options: string[]; render: (o: string) => ReactNode; onPick: (o: string) => void
  /** Also offer a free #rrggbb colour input. */
  custom?: boolean
}) {
  const isCustom = custom && !!value && !options.includes(value)
  return (
    <div className="field">
      <span>{label}</span>
      <div className="cal-picker" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={o === value} title={o} aria-label={o} className="cal-pick" onClick={() => onPick(o)}>
            {render(o)}
          </button>
        ))}
        {custom && <CustomColour value={isCustom ? value : ''} onPick={onPick} />}
      </div>
    </div>
  )
}

/** Native colour input; commits once the user stops dragging (no request per pixel). */
function CustomColour({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const [v, setV] = useState(value || '#888888')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { if (value) setV(value) }, [value])
  return (
    <label className={'cal-pick cal-custom' + (value ? ' on' : '')} title="Custom colour" aria-checked={!!value} role="radio">
      <span className="cal-swatch" style={{ background: value ? v : 'conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ef4444)' }}>
        {value && <Icon name="check" size={12} />}
      </span>
      <input type="color" value={v} aria-label="Custom colour" onChange={(e) => {
        const c = e.target.value
        setV(c)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => onPick(c), 400)
      }} />
    </label>
  )
}

export function CalendarIconGlyph({ icon, colour, size = 1 }: { icon?: string; colour: string; size?: number }) {
  return (
    <span className="cal-glyph" style={{ '--c': colour, width: `${size * 1.25}rem`, height: `${size * 1.25}rem` } as React.CSSProperties} aria-hidden="true">
      <Icon name={icon || 'calendar'} size={size * 12} />
    </span>
  )
}

export function CalendarSettings({ calendar, onClose }: { calendar: Calendar | null; onClose: () => void }) {
  return (
    <Drawer open={!!calendar} onClose={onClose} label="Calendar settings">
      {calendar && <SettingsBody key={calendar.id} cal={calendar} onClose={onClose} />}
    </Drawer>
  )
}

function SettingsBody({ cal, onClose }: { cal: Calendar; onClose: () => void }) {
  const detail = useCalendarDetail(cal)
  const icons = useIcons().data ?? FALLBACK_ICONS
  const save = useSaveCalendar(cal.id)
  const d = detail.data
  const [name, setName] = useState(cal.name)
  const [desc, setDesc] = useState('')
  useEffect(() => {
    if (d) {
      setName(d.name)
      setDesc(d.description ?? '')
    }
  }, [d])
  const manage = cal.role === 'owner' || cal.role === 'admin'
  const full = !!d && !d._fallback
  const colour = d?.my_colour || d?.colour || cal.colour || '#64748b'

  return (
    <>
      <div className="drawer-head">
        <CalendarIconGlyph icon={d?.icon} colour={colour} size={1.4} />
        <strong className="grow truncate">{d?.name ?? cal.name}</strong>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close settings"><Icon name="x" /></button>
      </div>
      <div className="drawer-body cal-settings">
        {detail.isPending ? <SkeletonRows rows={6} /> : detail.error && !detail.data ? <ErrorBox error={detail.error} retry={() => detail.refetch()} /> : d ? (
          <>
            {d._fallback && <p className="cal-note"><Icon name="info" size={14} />More settings (subscribers, invites, sync) appear once the server is updated.</p>}
            {!d.active && <p className="cal-note warn"><Icon name="alert" size={14} />This calendar is disabled: its events are hidden everywhere.</p>}

            <section className="cal-sec" aria-labelledby="cs-general">
              <h3 id="cs-general">General</h3>
              {manage ? (
                <>
                  <label className="field"><span>Name</span>
                    <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== d.name && save.mutate({ name: name.trim() })} />
                  </label>
                  {full && (
                    <label className="field"><span>Description</span>
                      <textarea className="textarea" rows={2} value={desc} maxLength={1000} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (d.description ?? '') && save.mutate({ description: desc })} />
                    </label>
                  )}
                  <Picker label="Calendar colour" custom value={d.calendar_colour ?? d.colour} options={CAL_COLOURS} onPick={(c) => save.mutate({ calendar_colour: c })}
                    render={(c) => <span className="cal-swatch" style={{ background: c }}>{c === (d.calendar_colour ?? d.colour) && <Icon name="check" size={12} />}</span>} />
                  {full && (
                    <Picker label="Icon" value={d.icon ?? ''} options={icons} onPick={(i) => save.mutate({ icon: i })}
                      render={(i) => <Icon name={i} size={15} />} />
                  )}
                  <div className="cal-row"><div><strong>Active</strong><span className="help">Disabled calendars and their events are hidden everywhere.</span></div>
                    <Switch checked={d.active} onChange={(v) => save.mutate({ active: v })} label={<span className="sr-only">Active</span>} /></div>
                  {full && <ZoneTags d={d} onSave={(b) => save.mutate(b)} />}
                  {full && (
                    <div className="cal-row"><div><strong>Public</strong><span className="help">Anyone with the link can view it.</span></div>
                      <Switch checked={d.public} onChange={(v) => save.mutate({ public: v })} label={<span className="sr-only">Public</span>} /></div>
                  )}
                </>
              ) : (
                <p className="small">{d.name}{d.owner ? <span className="muted"> · owned by <Link to={`/calendar/availability/${encodeURIComponent(d.owner.username)}`} title="See their availability">{personName(d.owner)}</Link></span> : null}{d.description ? <><br /><span className="muted">{d.description}</span></> : null}</p>
              )}
              {d.public && (
                <div className="cal-public">
                  <span className="xsmall muted">Public link</span>
                  <div className="row" style={{ gap: '0.25rem' }}>
                    <code className="cal-code grow truncate" title={publicUrl(d.id)}>{publicUrl(d.id)}</code>
                    <button className="btn ghost icon sm" onClick={() => copyText(publicUrl(d.id), 'Public link copied')} aria-label="Copy public link" title="Copy link"><Icon name="copy" size={14} /></button>
                    <a className="btn ghost icon sm" href={`/calendar/public/${d.id}/`} target="_blank" rel="noopener noreferrer" aria-label="Open public page" title="Open"><Icon name="external" size={14} /></a>
                  </div>
                </div>
              )}
            </section>

            <section className="cal-sec" aria-labelledby="cs-mine">
              <h3 id="cs-mine">Just for me</h3>
              <div className="cal-row"><div><strong>Show in my calendar</strong></div>
                <Switch checked={d.visible} onChange={(v) => save.mutate({ visible: v })} label={<span className="sr-only">Visible</span>} /></div>
              {full && (
                <div className="cal-row"><div><strong>Reminders</strong><span className="help">Send event reminders from this calendar.</span></div>
                  <Switch checked={!!d.notify} onChange={(v) => save.mutate({ notify: v })} label={<span className="sr-only">Notify</span>} /></div>
              )}
              {full && (
                <Picker label="My colour (only you see it)" custom value={d.my_colour ?? ''} options={CAL_COLOURS} onPick={(c) => save.mutate({ my_colour: c })}
                  render={(c) => <span className="cal-swatch" style={{ background: c }}>{c === d.my_colour && <Icon name="check" size={12} />}</span>} />
              )}
              {full && d.subscription && (
                <label className="field"><span>Your availability page shows</span>
                  <select className="select" value={d.subscription.display_busy} onChange={(e) => save.mutate({ display_busy: Number(e.target.value) })}>
                    <option value={0}>Nothing from this calendar</option>
                    <option value={1}>Busy times of meetings, work and study</option>
                    <option value={2}>Busy times of every event</option>
                  </select>
                  <span className="help">What people see at your availability page (times only, never names).</span>
                </label>
              )}
            </section>

            {manage && full && <Subscribers cal={cal} />}
            {manage && full && <Invites cal={cal} />}
            {(d.synced || d.sync?.url) && <Sync cal={d} canSync={manage} />}
            <Danger cal={d} onDone={onClose} />
          </>
        ) : null}
      </div>
    </>
  )
}

function Subscribers({ cal }: { cal: Calendar }) {
  const q = useSubList<Subscriber>(cal, 'subscribers', true)
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar', 'subscribers', cal.id] })
  const setRole = useMutation({ mutationFn: ({ id, role }: { id: number; role: string }) => patch(`calendar/calendars/${cal.id}/subscribers/${id}`, { role }), onSettled: refresh, onError })
  const remove = useMutation({ mutationFn: (id: number) => del(`calendar/calendars/${cal.id}/subscribers/${id}`), onSettled: refresh, onError })
  if (q.data?.missing) return null
  return (
    <section className="cal-sec" aria-labelledby="cs-subs">
      <h3 id="cs-subs">People {q.data && <span className="muted">{q.data.items.length}</span>}</h3>
      {q.isPending ? <SkeletonRows rows={2} /> : q.error && !q.data ? <ErrorBox error={q.error} /> : !q.data?.items.length ? <p className="muted small">Only you. Invite people with a code below.</p> : (
        <ul className="cal-list">
          {q.data.items.map((s) => (
            <li key={s.id}>
              <span className="grow truncate">{personName(s.user)}<span className="muted xsmall"> @{s.user.username}</span></span>
              <Link className="btn ghost icon sm" to={`/calendar/availability/${encodeURIComponent(s.user.username)}`} aria-label={`${personName(s.user)}'s availability`} title="Availability"><Icon name="clock" size={14} /></Link>
              {s.role === 'owner' ? <span className="chip">Owner</span> : (
                <>
                  <select className="select sm-select" value={s.role} aria-label={`Role for ${s.user.username}`} onChange={(e) => setRole.mutate({ id: s.id, role: e.target.value })}>
                    <option value="subscriber">Can view</option>
                    <option value="admin">Can edit</option>
                  </select>
                  <button className="btn ghost icon sm" aria-label={`Remove ${s.user.username}`} title="Remove" onClick={() => remove.mutate(s.id)}><Icon name="x" size={14} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Invites({ cal }: { cal: Calendar }) {
  const q = useSubList<Invite>(cal, 'invites', true)
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar', 'invites', cal.id] })
  const [days, setDays] = useState('7')
  const [uses, setUses] = useState('')
  const [role, setRole] = useState('subscriber')
  const [code, setCode] = useState('')
  const codeOk = !code || /^[A-Za-z0-9_-]{4,8}$/.test(code)
  const create = useMutation({
    mutationFn: () => post<Invite>(`calendar/calendars/${cal.id}/invites`, { role, code: code || null, expires_in_days: Number(days) ? Math.min(3650, Math.max(1, Number(days))) : null, max_uses: uses ? Number(uses) : null }),
    onSuccess: (inv) => (refresh(), setCode(''), copy(inv.code)),
    onError,
  })
  const setActive = useMutation({ mutationFn: ({ id, active }: { id: number; active: boolean }) => patch(`calendar/calendars/${cal.id}/invites/${id}`, { active }), onSettled: refresh, onError })
  const remove = useMutation({ mutationFn: (id: number) => del(`calendar/calendars/${cal.id}/invites/${id}`), onSettled: refresh, onError })
  const copy = (code: string) => navigator.clipboard?.writeText(code).then(() => toast.show('Invite code copied'), () => toast.show(`Code: ${code}`))
  if (q.data?.missing) return null
  return (
    <section className="cal-sec" aria-labelledby="cs-inv">
      <h3 id="cs-inv">Invites</h3>
      <form className="cal-invite-form" onSubmit={(e) => (e.preventDefault(), codeOk && create.mutate())}>
        <label className="field"><span>Code</span><input className="input" value={code} maxLength={8} placeholder="Random" onChange={(e) => setCode(e.target.value.trim())} aria-invalid={!codeOk} title="4–8 letters, digits, _ or -" /></label>
        <label className="field"><span>Expires in days</span><input className="input" type="number" min={1} max={3650} value={days} placeholder="Never" onChange={(e) => setDays(e.target.value)} /></label>
        <label className="field"><span>Max uses</span><input className="input" type="number" min={1} max={1000} value={uses} placeholder="No limit" onChange={(e) => setUses(e.target.value)} /></label>
        <label className="field"><span>Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}><option value="subscriber">Can view</option><option value="admin">Can edit</option></select>
        </label>
        <button className="btn primary sm" disabled={create.isPending || !codeOk}><Icon name="plus" size={14} />Create</button>
      </form>
      {!codeOk && <p className="error-text">Codes are 4–8 letters, digits, _ or -.</p>}
      {q.data && q.data.items.length > 0 && (
        <ul className="cal-list">
          {q.data.items.map((i) => (
            <li key={i.id} className={i.usable ? '' : 'inactive'}>
              <code className="cal-code">{i.code}</code>
              <span className="muted xsmall grow">
                {i.role === 'admin' ? 'Can edit' : 'Can view'} · {i.uses}{i.max_uses ? `/${i.max_uses}` : ''} used{i.expires_on ? ` · expires ${fmtDate(parseDayKey(i.expires_on.slice(0, 10)))}` : ''}{!i.active ? ' · deactivated' : !i.usable ? ' · expired or used up' : ''}
              </span>
              {i.active && <button className="btn ghost icon sm" aria-label="Copy code" title="Copy code" onClick={() => copy(i.code)}><Icon name="copy" size={14} /></button>}
              <button className="btn ghost sm" onClick={() => setActive.mutate({ id: i.id, active: !i.active })}>{i.active ? 'Deactivate' : 'Activate'}</button>
              <button className="btn ghost icon sm" aria-label={`Delete invite ${i.code}`} title="Delete invite" onClick={() => remove.mutate(i.id)}><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Sync({ cal, canSync }: { cal: CalendarDetail; canSync: boolean }) {
  const qc = useQueryClient()
  const save = useSaveCalendar(cal.id)
  const sync = useMutation({
    mutationFn: () => post<{ ok: boolean; not_modified?: boolean; last_synced_at?: string | null; last_sync_error?: string }>(`calendar/calendars/${cal.id}/sync`),
    onSuccess: (r) => (r.ok ? toast.show(r.not_modified ? 'Already up to date' : 'Synced') : toast.error(r.last_sync_error || 'Sync failed')),
    onError: (e) => toast.error(e instanceof ApiError && e.status === 503 ? 'Syncing is off on this server (offline mode).' : (e as Error).message),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['calendar', 'detail', cal.id] })
      qc.invalidateQueries({ queryKey: ['calendar', 'events'] })
    },
  })
  const s = cal.sync
  const err = s?.last_sync_error || s?.last_error
  return (
    <section className="cal-sec" aria-labelledby="cs-sync">
      <h3 id="cs-sync">Sync</h3>
      {canSync ? <SyncUrl url={s?.url ?? ''} onSave={(url) => save.mutate({ sync: { url } })} /> : s?.url && <p className="small truncate muted" title={s.url}>{s.url}</p>}
      <p className="small">{s?.last_synced_at ? <>Last synced {shortStamp(s.last_synced_at)}</> : 'Not synced yet'}</p>
      {err && <p className="error-text">{err}</p>}
      {canSync && s && (
        <>
          <div className="cal-row"><div><strong>Sync automatically</strong></div>
            <Switch checked={s.auto_sync} onChange={(v) => save.mutate({ sync: { auto_sync: v } })} label={<span className="sr-only">Auto sync</span>} /></div>
          <div className="field-row">
            <label className="field"><span>Months back</span>
              <input className="input" type="number" min={0} max={60} defaultValue={s.past_months} onBlur={(e) => Number(e.target.value) !== s.past_months && save.mutate({ sync: { past_months: Number(e.target.value) } })} />
            </label>
            <label className="field"><span>Months ahead</span>
              <input className="input" type="number" min={1} max={60} defaultValue={s.future_months} onBlur={(e) => Number(e.target.value) !== s.future_months && save.mutate({ sync: { future_months: Number(e.target.value) } })} />
            </label>
          </div>
        </>
      )}
      {canSync && <button className="btn sm" onClick={() => sync.mutate()} disabled={sync.isPending}><Icon name="refresh" size={14} />{sync.isPending ? 'Syncing…' : 'Sync now'}</button>}
    </section>
  )
}

function SyncUrl({ url, onSave }: { url: string; onSave: (u: string) => void }) {
  const [v, setV] = useState(url)
  useEffect(() => setV(url), [url])
  const ok = !v.trim() || /^(https?|webcal):\/\//i.test(v.trim())
  return (
    <label className="field"><span>Source (iCal link)</span>
      <input className="input" type="url" value={v} maxLength={256} placeholder="https://…/calendar.ics" aria-invalid={!ok}
        onChange={(e) => setV(e.target.value)} onBlur={() => ok && v.trim() !== url && onSave(v.trim())} />
      {!ok && <span className="error-text">Use an http(s) or webcal link.</span>}
    </label>
  )
}

function ZoneTags({ d, onSave }: { d: CalendarDetail; onSave: (b: CalendarPatchBody) => void }) {
  const [tz, setTz] = useState(d.time_zone ?? '')
  const [tags, setTags] = useState((d.tags ?? []).join(', '))
  useEffect(() => { setTz(d.time_zone ?? ''); setTags((d.tags ?? []).join(', ')) }, [d.time_zone, d.tags])
  const tagList = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20)
  return (
    <div className="field-row">
      <label className="field"><span>Time zone</span>
        <input className="input" value={tz} list="cal-zones" maxLength={64} placeholder="Server time zone" onChange={(e) => setTz(e.target.value)}
          onBlur={() => tz.trim() !== (d.time_zone ?? '') && onSave({ time_zone: tz.trim() })} />
        <datalist id="cal-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
      </label>
      <label className="field"><span>Tags</span>
        <input className="input" value={tags} maxLength={300} placeholder="school, family" onChange={(e) => setTags(e.target.value)}
          onBlur={() => tagList(tags).join(',') !== (d.tags ?? []).join(',') && onSave({ tags: tagList(tags) })} />
      </label>
    </div>
  )
}

function Danger({ cal, onDone }: { cal: CalendarDetail; onDone: () => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const owner = cal.role === 'owner'
  const remove = useMutation({
    mutationFn: () => (owner ? del(`calendar/calendars/${cal.id}?confirm=${encodeURIComponent(typed)}`) : del(`calendar/calendars/${cal.id}/subscription`)),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['calendar'] }), toast.show(owner ? `Deleted "${cal.name}"` : `Left "${cal.name}"`), setOpen(false), onDone()),
    onError,
  })
  return (
    <section className="cal-sec danger" aria-labelledby="cs-danger">
      <h3 id="cs-danger">{owner ? 'Delete calendar' : 'Leave calendar'}</h3>
      <p className="help">{owner ? 'Deletes the calendar and all of its events for everyone.' : 'Stop seeing this calendar. You can rejoin with an invite code.'}</p>
      <button className="btn danger sm" onClick={() => (setTyped(''), setOpen(true))}><Icon name={owner ? 'trash' : 'logout'} size={14} />{owner ? 'Delete…' : 'Leave'}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={owner ? `Delete "${cal.name}"?` : `Leave "${cal.name}"?`} width="26rem"
        footer={<><span className="spacer" /><button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" style={{ background: 'var(--app-danger)', borderColor: 'var(--app-danger)', color: '#fff' }} disabled={(owner && typed !== cal.name) || remove.isPending} onClick={() => remove.mutate()}>{owner ? 'Delete calendar' : 'Leave'}</button></>}>
        {owner ? (
          <label className="field"><span>Type <strong>{cal.name}</strong> to confirm</span><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></label>
        ) : <p className="muted small">Its events disappear from your calendar.</p>}
      </Dialog>
    </section>
  )
}

export function NewCalendarDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Calendar) => void }) {
  const qc = useQueryClient()
  const icons = useIcons().data ?? FALLBACK_ICONS
  const [name, setName] = useState('')
  const [colour, setColour] = useState(CAL_COLOURS[0])
  const [icon, setIcon] = useState('calendar')
  useEffect(() => { if (open) { setName(''); setColour(CAL_COLOURS[0]); setIcon('calendar') } }, [open])
  const create = useMutation({
    mutationFn: () => post<Calendar>('calendar/calendars', { name: name.trim(), colour, icon }),
    onSuccess: (c) => (qc.invalidateQueries({ queryKey: ['calendar'] }), toast.show(`Created "${c.name}"`), onClose(), onCreated(c)),
    onError,
  })
  return (
    <Dialog open={open} onClose={onClose} title="New calendar" width="28rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create calendar</button></>}>
      <form className="stack" style={{ gap: '0.75rem' }} onSubmit={(e) => (e.preventDefault(), name.trim() && create.mutate())}>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus /></label>
        <Picker label="Colour" custom value={colour} options={CAL_COLOURS} onPick={setColour} render={(c) => <span className="cal-swatch" style={{ background: c }}>{c === colour && <Icon name="check" size={12} />}</span>} />
        <Picker label="Icon" value={icon} options={icons} onPick={setIcon} render={(i) => <Icon name={i} size={15} />} />
      </form>
    </Dialog>
  )
}
