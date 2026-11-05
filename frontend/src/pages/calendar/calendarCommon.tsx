// Calendar bits needed on first paint (the sidebar's "…" menu, colours, names). The settings drawer
// and New calendar dialog live in CalendarSettings.tsx and load only when opened.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Dialog, Menu, MenuItem } from '../../components/ui'
import { toast } from '../../components/toast'
import { ApiError, del, post } from '../../lib/api'
import type { Calendar } from '../../lib/types'

export type Person = { id: string; username: string; first_name?: string; last_name?: string; name?: string }
export const personName = (u: Person) => u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username
export const CAL_COLOURS = ['#3b82f6', '#0891b2', '#10b981', '#16a34a', '#f59e0b', '#ea580c', '#ef4444', '#db2777', '#8b5cf6', '#64748b']

/** The classic public page (read-only month view, anyone with the link). */
export const publicUrl = (id: number) => `${window.location.origin}/calendar/public/${id}/`
export function copyText(text: string, done = 'Copied') {
  navigator.clipboard?.writeText(text).then(() => toast.show(done), () => toast.show(text))
}
const onError = (e: unknown) => toast.error((e as Error).message)

/** "…" menu next to a calendar in the sidebar. */
export function CalendarMenu({ calendar, onSettings, onOnly }: { calendar: Calendar; onSettings: () => void; onOnly?: () => void }) {
  const qc = useQueryClient()
  const editor = calendar.role === 'owner' || calendar.role === 'admin'
  const sync = useMutation({
    mutationFn: () => post<{ ok: boolean; not_modified?: boolean; last_sync_error?: string }>(`calendar/calendars/${calendar.id}/sync`),
    onSuccess: (r) => (r.ok ? toast.show(r.not_modified ? `"${calendar.name}" is up to date` : `Synced "${calendar.name}"`) : toast.error(r.last_sync_error || 'Sync failed')),
    onError: (e) => toast.error(e instanceof ApiError && e.status === 503 ? 'Syncing is off on this server (offline mode).' : (e as Error).message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  })
  const leave = useMutation({
    mutationFn: () => del(`calendar/calendars/${calendar.id}/subscription`),
    onSuccess: () => toast.show(`Left "${calendar.name}"`),
    onError,
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  })
  const [confirmLeave, setConfirmLeave] = useState(false)
  return (
    <>
    <Menu align="end" label={`${calendar.name} options`} trigger={(p) => (
      <button {...p} className="btn ghost icon sm cal-more" aria-label={`${calendar.name} options`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); p.onClick() }}>
        <Icon name="more" size={14} />
      </button>
    )}>
      {(close) => (
        <>
          {onOnly && <MenuItem icon="calendar" onClick={() => (close(), onOnly())}>Display this only</MenuItem>}
          <MenuItem icon="settings" onClick={() => (close(), onSettings())}>Settings and sharing</MenuItem>
          {calendar.synced && editor && <MenuItem icon="refresh" onClick={() => (close(), sync.mutate())}>Sync now</MenuItem>}
          {calendar.public && <MenuItem icon="link" onClick={() => (close(), copyText(publicUrl(calendar.id), 'Public link copied'))}>Copy public link</MenuItem>}
          {calendar.role !== 'owner' && <MenuItem icon="logout" danger onClick={() => (close(), setConfirmLeave(true))}>Leave calendar</MenuItem>}
        </>
      )}
    </Menu>
    <Dialog open={confirmLeave} onClose={() => setConfirmLeave(false)} title={`Leave "${calendar.name}"?`} width="26rem"
      footer={<><span className="spacer" /><button className="btn" onClick={() => setConfirmLeave(false)}>Cancel</button>
        <button className="btn primary" style={{ background: 'var(--app-danger)', borderColor: 'var(--app-danger)', color: '#fff' }} onClick={() => (setConfirmLeave(false), leave.mutate())}>Leave</button></>}>
      <p className="muted small">Its events disappear from your calendar. You can rejoin with an invite code.</p>
    </Dialog>
    </>
  )
}
