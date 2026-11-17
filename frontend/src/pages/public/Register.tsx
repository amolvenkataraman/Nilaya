// /register: self-registration is turned off; accounts are made by an administrator.
import { Link } from 'react-router'
import { buttonClass } from '../../components/ui'
import { AuthCard, authSubmit } from './AuthCard'
import { PublicFrame, usePublicTitle } from './PublicFrame'

export default function Register() {
  usePublicTitle('Request access')
  return (
    <PublicFrame>
      <AuthCard icon="users" title="Request access" sub="Self-registration is turned off on this site.">
        <p className="text-sm">
          Ask an administrator to create an account for you. They'll send you a username and a first password, which you can change in
          Settings after signing in.
        </p>
        <Link className={buttonClass({ variant: 'primary', className: `${authSubmit} hover:no-underline` })} to="/login">
          Back to sign in
        </Link>
      </AuthCard>
    </PublicFrame>
  )
}
