// /login: sign in with a username and password (POST /auth/login, session cookie + CSRF), then a full
// page load of ?next= so the server-rendered session tag and the persisted caches start fresh.
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Icon } from '../../components/Icon'
import { Button, Field, Input } from '../../components/ui'
import { ApiError, post, safeHref } from '../../lib/api'
import { signedIn } from '../../lib/session'
import { AuthCard, authSubmit } from './AuthCard'
import { PublicFrame, usePublicTitle } from './PublicFrame'

/** Only a path on this site (the server checks again). */
function safeNext(raw: string | null): string {
  const href = safeHref(raw)
  return href?.startsWith('/') ? href : '/'
}

const big = 'h-10! text-base!' // `!`: the field's own height and text size

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
      <AuthCard icon="home" title="Sign in" sub="to continue to Nilaya">
        <form className="grid gap-3.5" onSubmit={submit} noValidate>
          <Field label="Username">
            <Input
              className={big}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={already}
            />
          </Field>
          <Field label="Password">
            <Input
              className={big}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={already}
            />
          </Field>
          {error && (
            <p className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              <Icon name="alert" size={14} className="mt-0.75 shrink-0" />
              {error}
            </p>
          )}
          <Button variant="primary" type="submit" className={authSubmit} disabled={pending || already || !username.trim() || !password}>
            {pending || already ? (
              <>
                {/* `!`: the spinner class sets its own colours */}
                <span className="spinner mr-1 border-[color-mix(in_srgb,currentColor_35%,transparent)]! border-t-current!" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>
        <p className="border-t border-border pt-3 text-center text-sm text-muted">
          No account? <Link to="/register">Request access</Link>
        </p>
      </AuthCard>
      <p className="mx-auto max-w-[24rem] text-center text-xs text-muted">
        Usernames and passwords are case-sensitive. On a shared computer, sign out when you're done.
      </p>
    </PublicFrame>
  )
}
