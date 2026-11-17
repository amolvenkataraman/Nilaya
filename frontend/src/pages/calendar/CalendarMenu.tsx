// The "…" menu beside a calendar in the sidebar. It's on first paint, so it stays small: the settings drawer
// and New calendar dialog live in CalendarSettings.tsx and load only when opened.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { buttonClass, Confirm, Menu, MenuItem } from '../../components/ui'
import { toast } from '../../components/toast'
import type { Calendar } from '../../lib/types'
import { useLeaveCalendar, useSyncCalendar } from './api'

/** The public page (read-only month view, anyone with the link, signed in or not). */
export const publicUrl = (id: number) => `${window.location.origin}/calendar/public/${id}`

export function CalendarMenu({
  calendar,
  onSettings,
  onOnly,
  onPeek,
  peeking,
}: {
  calendar: Calendar
  onSettings: () => void
  onOnly?: () => void
  /** Disabled calendars: show (or hide) its events without enabling it. */
  onPeek?: () => void
  peeking?: boolean
}) {
  const editor = calendar.role === 'owner' || calendar.role === 'admin'
  const sync = useSyncCalendar(calendar.id, calendar.name)
  const leave = useLeaveCalendar()
  const [confirmLeave, setConfirmLeave] = useState(false)
  // Each item closes the menu first, then acts (a drawer or dialog opens on top of the page, not the menu).
  const act = (close: () => void, fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <>
      <Menu
        align="end"
        label={`${calendar.name} options`}
        trigger={(p) => (
          <button
            {...p}
            type="button"
            className={buttonClass({
              variant: 'ghost',
              size: 'sm',
              icon: true,
              // Shows on row hover, keyboard focus, while open, and always on touch screens.
              className:
                'absolute right-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 touch:opacity-100',
            })}
            aria-label={`${calendar.name} options`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              p.onClick?.(e)
            }}
          >
            <Icon name="more" size={14} />
          </button>
        )}
      >
        {(close) => (
          <>
            {onPeek && (
              <MenuItem icon={peeking ? 'eyeOff' : 'eye'} onClick={act(close, onPeek)}>
                {peeking ? 'Hide its events' : 'Show events (read-only)'}
              </MenuItem>
            )}
            {onOnly && calendar.active && (
              <MenuItem icon="calendar" onClick={act(close, onOnly)}>
                Display this only
              </MenuItem>
            )}
            <MenuItem icon="settings" onClick={act(close, onSettings)}>
              Settings and sharing
            </MenuItem>
            {calendar.synced && editor && (
              <MenuItem icon="refresh" onClick={act(close, () => sync.mutate(undefined))}>
                Sync now
              </MenuItem>
            )}
            {calendar.public && (
              <MenuItem icon="link" onClick={act(close, () => toast.copy(publicUrl(calendar.id), 'Public link copied'))}>
                Copy public link
              </MenuItem>
            )}
            {calendar.role !== 'owner' && (
              <MenuItem icon="logout" danger onClick={act(close, () => setConfirmLeave(true))}>
                Leave calendar
              </MenuItem>
            )}
          </>
        )}
      </Menu>
      <Confirm
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title={`Leave "${calendar.name}"?`}
        body="Its events disappear from your calendar. You can rejoin with an invite code."
        confirmLabel="Leave"
        onConfirm={() => leave.mutate(calendar)}
      />
    </>
  )
}
