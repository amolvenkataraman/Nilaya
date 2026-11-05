// Joining other people's calendars: subscribe with an invite code (POST /calendar/subscribe?code=),
// and pick someone whose availability to open (/calendar/availability/:username).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Dialog } from '../../components/ui'
import { ApiError, get, post } from '../../lib/api'
import type { Calendar } from '../../lib/types'
import type { CalendarDetail, Subscriber } from './CalendarSettings'
import { personName } from './calendarCommon'

export function SubscribeDialog({ open, onClose, onSettings, onNewCalendar }: {
  open: boolean; onClose: () => void; onSettings: (c: Calendar) => void; onNewCalendar: () => void
}) {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [done, setDone] = useState<{ cal: Calendar; owner: string } | null>(null)
  useEffect(() => { if (open) { setCode(''); setDone(null) } }, [open])
  const join = useMutation({
    mutationFn: async () => {
      const cal = await post<Calendar>('calendar/subscribe', undefined, { code: code.trim() })
      let owner = ''
      try {
        const d = await get<CalendarDetail>(`calendar/calendars/${cal.id}`)
        if (d.owner) owner = personName(d.owner)
      } catch { /* the name is enough */ }
      return { cal, owner }
    },
    onSuccess: (r) => {
      setDone(r)
      qc.invalidateQueries({ queryKey: ['calendar'] })
    },
  })
  const valid = /^[A-Za-z0-9_-]{4,8}$/.test(code.trim())
  return (
    <Dialog open={open} onClose={onClose} title={done ? 'Subscribed' : 'Subscribe with a code'} width="26rem"
      footer={done ? (
        <><span className="spacer" /><button className="btn" onClick={() => (onClose(), onSettings(done.cal))}>Settings</button><button className="btn primary" onClick={onClose}>Done</button></>
      ) : (
        <><button className="btn ghost sm" onClick={() => (onClose(), onNewCalendar())}><Icon name="plus" size={14} />New calendar</button><span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid || join.isPending} onClick={() => join.mutate()}>{join.isPending ? 'Subscribing…' : 'Subscribe'}</button></>
      )}>
      {done ? (
        <div className="cal-joined">
          <span className="cal-joined-icon"><Icon name="check" size={18} /></span>
          <dl className="cal-dl">
            <div><dt>Calendar</dt><dd><span className="dot" style={{ background: done.cal.colour }} />{done.cal.name}</dd></div>
            {done.owner && <div><dt>Owner</dt><dd>{done.owner}</dd></div>}
            <div><dt>Access</dt><dd>{done.cal.role === 'owner' ? 'Owner' : done.cal.can_edit ? 'Can edit' : 'Can view'}</dd></div>
          </dl>
        </div>
      ) : (
        <form className="stack" style={{ gap: '0.5rem' }} onSubmit={(e) => (e.preventDefault(), valid && join.mutate())}>
          <label className="field"><span>Invite code</span>
            <input className="input cal-code-input" value={code} onChange={(e) => (setCode(e.target.value), join.reset())} maxLength={8} placeholder="e.g. SCHOOL01" autoFocus autoComplete="off" spellCheck={false} />
          </label>
          <p className="help">Ask the calendar's owner for a code (Settings and sharing › Invites).</p>
          {join.error && <p className="error-text" role="alert">{join.error.message}</p>}
        </form>
      )}
    </Dialog>
  )
}

/** "View someone's availability": type a username (people from your calendars are suggested). */
export function PersonDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setName(''); setError('') } }, [open])
  // Only people already in the cache (subscriber lists you opened): no extra requests.
  const known = new Map<string, string>()
  for (const [, d] of qc.getQueriesData<{ items: Subscriber[] }>({ queryKey: ['calendar', 'subscribers'] })) {
    for (const s of d?.items ?? []) known.set(s.user.username, personName(s.user))
  }
  for (const [, d] of qc.getQueriesData<CalendarDetail>({ queryKey: ['calendar', 'detail'] })) {
    if (d?.owner) known.set(d.owner.username, personName(d.owner))
  }
  const go = async (u = name.trim().replace(/^@/, '')) => {
    if (!u) return
    setBusy(true)
    setError('')
    try {
      await qc.fetchQuery({ queryKey: ['users', u], queryFn: () => get(`users/${encodeURIComponent(u)}`), staleTime: 10 * 60_000 })
      onClose()
      navigate(`/calendar/availability/${encodeURIComponent(u)}`)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? `No one has the username "${u}".` : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="View someone's availability" width="26rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={() => go()}>Show availability</button></>}>
      <form className="stack" style={{ gap: '0.5rem' }} onSubmit={(e) => (e.preventDefault(), go())}>
        <label className="field"><span>Username</span>
          <input className="input" value={name} onChange={(e) => (setName(e.target.value), setError(''))} list="cal-known-people" placeholder="e.g. sam" autoFocus autoComplete="off" spellCheck={false} maxLength={150} />
          <datalist id="cal-known-people">{[...known].map(([u, n]) => <option key={u} value={u}>{n}</option>)}</datalist>
        </label>
        <p className="help">Shows when they're busy (times only), from calendars they share as busy.</p>
        {known.size > 0 && (
          <div className="cal-people-chips">
            {[...known].slice(0, 8).map(([u, n]) => <button type="button" key={u} className="chip" onClick={() => go(u)}><Icon name="user" size={11} />{n}</button>)}
          </div>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}
