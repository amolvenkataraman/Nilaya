// Settings › Password (POST /me/password -> 204). This device stays signed in; problems show inline.
import { useState } from 'react'
import { Button, cardClass, Input, SaveStatus, SettingRow, SettingsFoot, SettingsSection } from '../../components/ui'
import { useChangePassword } from './api'

const MIN = 8

export function PasswordSection() {
  const [old, setOld] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const change = useChangePassword(() => {
    setOld('')
    setNext('')
    setConfirm('')
  }, setError)
  const tooShort = next.length > 0 && next.length < MIN
  const mismatch = confirm.length > 0 && confirm !== next
  const ready = !!old && next.length >= MIN && confirm === next && !change.isPending
  const typed = (fn: (v: string) => void) => (e: { target: { value: string } }) => {
    fn(e.target.value)
    setError('')
  }
  const fieldError = 'text-xs text-danger empty:hidden'
  return (
    <SettingsSection id="set-password" title="Password" description="You stay signed in on this device. API keys keep working.">
      <form
        className={cardClass}
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          if (ready) change.mutate({ old, next })
        }}
      >
        {/* Lets password managers attach the new password to the right account. */}
        <input type="text" name="username" autoComplete="username" hidden readOnly />
        <SettingRow label="Current password" htmlFor="pw-old" control="fill">
          <Input id="pw-old" type="password" autoComplete="current-password" value={old} onChange={typed(setOld)} />
        </SettingRow>
        <SettingRow
          label="New password"
          hint={`At least ${MIN} characters, not too common or close to your name`}
          htmlFor="pw-new"
          align="top"
          control="col"
        >
          <Input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={next}
            aria-invalid={tooShort || undefined}
            aria-describedby="pw-new-err"
            onChange={typed(setNext)}
          />
          <span id="pw-new-err" className={fieldError} aria-live="polite">
            {tooShort ? `${MIN - next.length} more character${MIN - next.length > 1 ? 's' : ''} needed` : ''}
          </span>
        </SettingRow>
        <SettingRow label="Confirm new password" htmlFor="pw-confirm" align="top" control="col">
          <Input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={confirm}
            aria-invalid={mismatch || undefined}
            aria-describedby="pw-confirm-err"
            onChange={typed(setConfirm)}
          />
          <span id="pw-confirm-err" className={fieldError} aria-live="polite">
            {mismatch ? "Doesn't match the new password" : ''}
          </span>
        </SettingRow>
        <SettingsFoot>
          {error ? (
            <SaveStatus tone="err" alert>
              {error}
            </SaveStatus>
          ) : (
            <SaveStatus>{change.isPending ? 'Changing…' : ''}</SaveStatus>
          )}
          <span className="flex-1" />
          <Button type="submit" variant="primary" disabled={!ready}>
            Change password
          </Button>
        </SettingsFoot>
      </form>
    </SettingsSection>
  )
}
