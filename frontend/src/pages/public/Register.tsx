// /register: self-registration is turned off; accounts are made by an administrator.
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { PublicFrame, usePublicTitle } from './PublicFrame'

export default function Register() {
  usePublicTitle('Request access')
  return (
    <PublicFrame>
      <section className="card pub-auth">
        <div className="pub-auth-head">
          <span className="app-logo pub-auth-logo" aria-hidden="true"><Icon name="users" size={22} /></span>
          <h1>Request access</h1>
          <p className="muted small">Self-registration is turned off on this site.</p>
        </div>
        <p className="small">Ask an administrator to create an account for you. They'll send you a username and a first password, which you can change in Settings after signing in.</p>
        <Link className="btn primary pub-submit" to="/login">Back to sign in</Link>
      </section>
    </PublicFrame>
  )
}
