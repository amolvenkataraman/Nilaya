// The settings drawer's sharing sections (owners and admins): who has the calendar and with what role, and the
// invite codes that let people join.
import { useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { Button, buttonClass, ErrorBox, Field, Input, PanelSection, QueryView, Select, SkeletonRows } from '../../components/ui'
import { toast } from '../../components/toast'
import { cn } from '../../lib/cn'
import { fmtDate, parseDayKey } from '../../lib/dates'
import type { Calendar } from '../../lib/types'
import { useInviteMutations, useInvites, useSubscriberMutations, useSubscribers } from './api'
import { smallSelect } from './Attendees'
import { pill } from './chips'
import { type Invite, personName } from './types'

const list = 'grid gap-px'
const listRow = 'flex min-h-9 items-center gap-2 rounded-sm px-1 text-sm hover:bg-hover'
const code = 'rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-xs'
const INVITE_CODE = /^[A-Za-z0-9_-]{4,8}$/

export function Subscribers({ cal }: { cal: Calendar }) {
  const q = useSubscribers(cal.id)
  const { setRole, remove } = useSubscriberMutations(cal.id)
  return (
    <PanelSection id="cs-subs" title={<>People {q.data && <span className="text-muted">{q.data.length}</span>}</>}>
      <QueryView
        query={q}
        skeleton={<SkeletonRows rows={2} />}
        isEmpty={(d) => !d.length}
        empty={<p className="text-sm text-muted">Only you. Invite people with a code below.</p>}
      >
        {(subs) => (
          <ul className={list}>
            {subs.map((s) => (
              <li key={s.id} className={listRow}>
                <span className="min-w-0 flex-auto truncate">
                  {personName(s.user)}
                  <span className="text-xs text-muted"> @{s.user.username}</span>
                </span>
                <Link
                  className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })}
                  to={`/calendar/availability/${encodeURIComponent(s.user.username)}`}
                  aria-label={`${personName(s.user)}'s availability`}
                  title="Availability"
                >
                  <Icon name="clock" size={14} />
                </Link>
                {s.role === 'owner' ? (
                  <span className={pill}>Owner</span>
                ) : (
                  <>
                    <select
                      className={smallSelect}
                      value={s.role}
                      aria-label={`Role for ${s.user.username}`}
                      onChange={(e) => setRole.mutate({ id: s.id, role: e.target.value })}
                    >
                      <option value="subscriber">Can view</option>
                      <option value="admin">Can edit</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={`Remove ${s.user.username}`}
                      title="Remove"
                      onClick={() => remove.mutate(s.id)}
                    >
                      <Icon name="x" size={14} />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </PanelSection>
  )
}

export function Invites({ cal }: { cal: Calendar }) {
  const q = useInvites(cal.id)
  const { create, setActive, remove } = useInviteMutations(cal.id)
  const [days, setDays] = useState('7')
  const [uses, setUses] = useState('')
  const [role, setRole] = useState<Invite['role']>('subscriber')
  const [inviteCode, setCode] = useState('')
  const codeOk = !inviteCode || INVITE_CODE.test(inviteCode)
  const submit = () =>
    codeOk &&
    create.mutate(
      {
        role,
        code: inviteCode || null,
        expires_in_days: Number(days) ? Math.min(3650, Math.max(1, Number(days))) : null,
        max_uses: uses ? Number(uses) : null,
      },
      { onSuccess: () => setCode('') },
    )
  return (
    <PanelSection id="cs-inv" title="Invites">
      <form
        className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2 max-md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Code">
          <Input
            value={inviteCode}
            maxLength={8}
            placeholder="Random"
            onChange={(e) => setCode(e.target.value.trim())}
            aria-invalid={!codeOk}
            title="4–8 letters, digits, _ or -"
          />
        </Field>
        <Field label="Expires in days">
          <Input type="number" min={1} max={3650} value={days} placeholder="Never" onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Max uses">
          <Input type="number" min={1} max={1000} value={uses} placeholder="No limit" onChange={(e) => setUses(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Invite['role'])}>
            <option value="subscriber">Can view</option>
            <option value="admin">Can edit</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" size="sm" disabled={create.isPending || !codeOk}>
          <Icon name="plus" size={14} />
          Create
        </Button>
      </form>
      {!codeOk && <p className="text-xs text-danger">Codes are 4–8 letters, digits, _ or -.</p>}
      {q.error && !q.data && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && q.data.length > 0 && (
        <ul className={list}>
          {q.data.map((i) => (
            <li key={i.id} className={cn(listRow, !i.usable && 'opacity-55')}>
              <code className={code}>{i.code}</code>
              <span className="min-w-0 flex-auto text-xs text-muted">
                {i.role === 'admin' ? 'Can edit' : 'Can view'} · {i.uses}
                {i.max_uses ? `/${i.max_uses}` : ''} used
                {i.expires_on ? ` · expires ${fmtDate(parseDayKey(i.expires_on.slice(0, 10)))}` : ''}
                {!i.active ? ' · deactivated' : !i.usable ? ' · expired or used up' : ''}
              </span>
              {i.active && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label="Copy code"
                  title="Copy code"
                  onClick={() => toast.copy(i.code, 'Invite code copied')}
                >
                  <Icon name="copy" size={14} />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setActive.mutate({ id: i.id, active: !i.active })}>
                {i.active ? 'Deactivate' : 'Activate'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label={`Delete invite ${i.code}`}
                title="Delete invite"
                onClick={() => remove.mutate(i.id)}
              >
                <Icon name="trash" size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  )
}

/** The public link and invite codes use the same monospace code look. */
export const codeClass = code
