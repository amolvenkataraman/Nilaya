// Joining other people's calendars: subscribe with an invite code (POST /calendar/subscribe?code=), and pick
// someone whose availability to open (/calendar/availability/:username). Both dialogs mount only while open,
// so each opening starts empty.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Button, Dialog, Field, Input } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { Calendar } from '../../lib/types'
import { ck, userQuery, useSubscribe } from './api'
import { dot, pill } from './chips'
import { type CalendarDetail, personName, type Subscriber } from './types'

const INVITE_CODE = /^[A-Za-z0-9_-]{4,8}$/

export function SubscribeDialog({
  onClose,
  onSettings,
  onNewCalendar,
}: {
  onClose: () => void
  onSettings: (c: Calendar) => void
  onNewCalendar: () => void
}) {
  const [code, setCode] = useState('')
  const join = useSubscribe()
  const done = join.data
  const valid = INVITE_CODE.test(code.trim())
  const submit = () => valid && join.mutate(code.trim())
  return (
    <Dialog
      open
      onClose={onClose}
      title={done ? 'Subscribed' : 'Subscribe with a code'}
      width="26rem"
      footer={
        done ? (
          <>
            <span className="flex-1" />
            <Button
              onClick={() => {
                onClose()
                onSettings(done.cal)
              }}
            >
              Settings
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onClose()
                onNewCalendar()
              }}
            >
              <Icon name="plus" size={14} />
              New calendar
            </Button>
            <span className="flex-1" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!valid || join.isPending} onClick={submit}>
              {join.isPending ? 'Subscribing…' : 'Subscribe'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex items-start gap-3">
          <span className="grid size-8 flex-none place-items-center rounded-full bg-success-soft text-success">
            <Icon name="check" size={18} />
          </span>
          <dl className="m-0 grid flex-1 gap-1.5 text-sm [&_dd]:m-0 [&_dd]:flex [&_dd]:items-center [&_dd]:gap-1.5 [&_dd]:font-medium [&_dt]:text-muted [&>div]:grid [&>div]:grid-cols-[5.5rem_1fr] [&>div]:gap-2">
            <div>
              <dt>Calendar</dt>
              <dd>
                <span className={dot} style={{ background: done.cal.colour }} />
                {done.cal.name}
              </dd>
            </div>
            {done.owner && (
              <div>
                <dt>Owner</dt>
                <dd>{done.owner}</dd>
              </div>
            )}
            <div>
              <dt>Access</dt>
              <dd>{done.cal.role === 'owner' ? 'Owner' : done.cal.can_edit ? 'Can edit' : 'Can view'}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="Invite code" hint="Ask the calendar's owner for a code (Settings and sharing › Invites).">
            <Input
              className="font-mono tracking-[0.04em]"
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                join.reset()
              }}
              maxLength={8}
              placeholder="e.g. SCHOOL01"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          {join.error && (
            <p className="text-xs text-danger" role="alert">
              {join.error.message}
            </p>
          )}
        </form>
      )}
    </Dialog>
  )
}

/** People already in the cache (subscriber lists and calendar owners you've opened): no extra requests. */
function useKnownPeople(): Map<string, string> {
  const qc = useQueryClient()
  const known = new Map<string, string>()
  for (const [, subs] of qc.getQueriesData<Subscriber[]>({ queryKey: ck.allSubscribers })) {
    for (const s of subs ?? []) known.set(s.user.username, personName(s.user))
  }
  for (const [, d] of qc.getQueriesData<CalendarDetail>({ queryKey: ck.details })) {
    if (d?.owner) known.set(d.owner.username, personName(d.owner))
  }
  return known
}

/** "View someone's availability": type a username (people from your calendars are suggested). */
export function PersonDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const known = useKnownPeople()
  const go = async (u = name.trim().replace(/^@/, '')) => {
    if (!u) return
    setBusy(true)
    setError('')
    try {
      await qc.fetchQuery(userQuery(u))
      onClose()
      navigate(`/calendar/availability/${encodeURIComponent(u)}`)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? `No one has the username "${u}".` : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="View someone's availability"
      width="26rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => go()}>
            Show availability
          </Button>
        </>
      }
    >
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
      >
        <Field label="Username" hint="Shows when they're busy (times only), from calendars they share as busy.">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
            list="cal-known-people"
            placeholder="e.g. sam"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={150}
          />
          <datalist id="cal-known-people">
            {[...known].map(([u, n]) => (
              <option key={u} value={u}>
                {n}
              </option>
            ))}
          </datalist>
        </Field>
        {known.size > 0 && (
          <div className="flex flex-wrap gap-1">
            {[...known].slice(0, 8).map(([u, n]) => (
              <button type="button" key={u} className={cn(pill, 'cursor-pointer hover:text-fg')} onClick={() => go(u)}>
                <Icon name="user" size={11} />
                {n}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
