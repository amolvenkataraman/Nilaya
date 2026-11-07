// /login: sign in with a username and password (POST /auth/login, session cookie + CSRF), then a full
// page load of ?next= so the server-rendered session tag and the persisted caches start fresh.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ApiError, post } from '../../lib/api'
import { signedIn } from '../../lib/session'
import { Icon } from '../../components/Icon'
import { PublicFrame, usePublicTitle } from './PublicFrame'

/** Only a path on this site (the server checks again). */
function safeNext(raw: string | null): string {
  const n = (raw ?? '').trim()
  return /^\/(?![/\\])/.test(n) ? n : '/'
}

export default function Login() {
  usePublicTitle('Sign in')
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const already = signedIn()

  useEffect(() => {
    if (already) window.location.replace(next)
  }, [already, next])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setError('')
    setPending(true)
    try {
      const res = await post<{ next: string }>('auth/login', { username: username.trim(), password, next })
      window.location.assign(safeNext(res.next))
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      setError(status === 403 ? 'Your session expired. Reload the page and try again.' : (err as Error).message || "Couldn't sign in.")
      setPending(false)
    }
  }

  return (
    <PublicFrame>
      <section className="card pub-auth">
        <div className="pub-auth-head">
          <span className="app-logo pub-auth-logo" aria-hidden="true"><Icon name="home" size={22} /></span>
          <h1>Sign in</h1>
          <p className="muted small">to continue to AVNet Superapp</p>
        </div>
        <form className="pub-form" onSubmit={submit} noValidate>
          <label className="field">
            <span>Username</span>
            <input className="input" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} disabled={already} />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" name="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} disabled={already} />
          </label>
          {error && <p className="pub-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
          <button className="btn primary pub-submit" type="submit" disabled={pending || already || !username.trim() || !password}>
            {pending || already ? <><span className="spinner pub-spin" />Signing in…</> : 'Sign in'}
          </button>
        </form>
        <p className="pub-auth-foot small muted">
          No account? <Link to="/register">Request access</Link>
        </p>
      </section>
      <p className="pub-legal xsmall muted">Usernames and passwords are case-sensitive. On a shared computer, sign out when you're done.</p>
    </PublicFrame>
  )
}
