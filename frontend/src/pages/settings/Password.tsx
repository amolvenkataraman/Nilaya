// Change password (POST /me/password -> 204). This device stays signed in.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { post } from '../../lib/api'

const MIN = 8

export function PasswordSection() {
  const [old, setOld] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const change = useMutation({
    mutationFn: () => post<void>('me/password', { old, new: next }),
    onSuccess: () => {
      setOld('')
      setNext('')
      setConfirm('')
      toast.show('Password changed. You stay signed in here.')
    },
    onError: (e) => setError((e as Error).message),
  })
  const tooShort = next.length > 0 && next.length < MIN
  const mismatch = confirm.length > 0 && confirm !== next
  const ready = !!old && next.length >= MIN && confirm === next && !change.isPending
  return (
    <section className="set-section" aria-labelledby="set-password">
      <div className="set-section-head">
        <div>
          <h2 id="set-password">Password</h2>
          <p>You stay signed in on this device. API keys keep working.</p>
        </div>
      </div>
      <form
        className="set-card"
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          if (ready) change.mutate()
        }}
      >
        {/* Lets password managers attach the new password to the right account. */}
        <input type="text" name="username" autoComplete="username" hidden readOnly />
        <div className="set-row">
          <label className="set-label" htmlFor="pw-old">Current password</label>
          <div className="set-control fill">
            <input id="pw-old" className="input" type="password" autoComplete="current-password" value={old} onChange={(e) => (setOld(e.target.value), setError(''))} />
          </div>
        </div>
        <div className="set-row top">
          <label className="set-label" htmlFor="pw-new">New password<small>At least {MIN} characters, not too common or close to your name</small></label>
          <div className="set-control fill col">
            <input id="pw-new" className="input" type="password" autoComplete="new-password" maxLength={128} value={next} aria-invalid={tooShort || undefined} aria-describedby="pw-new-err" onChange={(e) => (setNext(e.target.value), setError(''))} />
            <span id="pw-new-err" className="error-text" aria-live="polite">{tooShort ? `${MIN - next.length} more character${MIN - next.length > 1 ? 's' : ''} needed` : ''}</span>
          </div>
        </div>
        <div className="set-row top">
          <label className="set-label" htmlFor="pw-confirm">Confirm new password</label>
          <div className="set-control fill col">
            <input id="pw-confirm" className="input" type="password" autoComplete="new-password" maxLength={128} value={confirm} aria-invalid={mismatch || undefined} aria-describedby="pw-confirm-err" onChange={(e) => (setConfirm(e.target.value), setError(''))} />
            <span id="pw-confirm-err" className="error-text" aria-live="polite">{mismatch ? "Doesn't match the new password" : ''}</span>
          </div>
        </div>
        <div className="set-foot">
          {error ? <span className="set-status err" role="alert">{error}</span> : <span className="set-status">{change.isPending ? 'Changing…' : ''}</span>}
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={!ready}>Change password</button>
        </div>
      </form>
    </section>
  )
}
