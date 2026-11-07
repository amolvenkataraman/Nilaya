// Link to someone's profile page (/users/<username>). Use wherever a person's name is shown.
//   <UserLink username={u.username}>{u.name}</UserLink>   (children default to "@username")
import type { ReactNode } from 'react'
import { Link } from 'react-router'

export const userPath = (username: string) => `/users/${encodeURIComponent(username)}`

export function UserLink({ username, children, className, title }: { username: string; children?: ReactNode; className?: string; title?: string }) {
  return (
    <Link to={userPath(username)} className={className} title={title ?? `@${username}`} onClick={(e) => e.stopPropagation()}>
      {children ?? `@${username}`}
    </Link>
  )
}
