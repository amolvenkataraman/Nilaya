// Someone's profile (GET /users/{username}): picture, name, public groups, description.
// Your own profile shows all your groups and links to Settings to edit it.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Avatar, ErrorBox, SkeletonRows } from '../../components/ui'
import { ApiError, get } from '../../lib/api'
import { useMe } from '../../lib/queries'
import type { GroupBrief, UUID } from '../../lib/types'
import { PictureDialog } from '../settings/PictureDialog'
import '../settings/settings.css'
import './users.css'

interface Person { id: UUID; username: string; name: string; description: string; profile_picture: string; groups: GroupBrief[] }

export default function UserPage() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const me = useMe().data
  const mine = !!me && me.username === username
  const q = useQuery({
    queryKey: ['users', username],
    queryFn: () => get<Person>(`users/${encodeURIComponent(username)}`),
    enabled: !!username && !!me && !mine, // your own profile comes from /me
    staleTime: 5 * 60_000,
  })
  const [picture, setPicture] = useState(false)
  // Your own card reads from /me so edits show at once (and every group, not only public ones).
  const p: Person | undefined = mine && me
    ? { id: me.id, username: me.username, name: [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username, description: me.description, profile_picture: me.profile_picture, groups: me.groups }
    : q.data
  const topbar = (
    <button className="btn ghost sm" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
      <Icon name="x" size={14} />
      Close
    </button>
  )
  return (
    <AppShell app="home" title="Profile" pageTitle={p?.name ?? 'Profile'} topbar={topbar}>
      <div className="page user-page">
        {p ? (
          <article className="set-card user-card">
            <div className="user-cover" aria-hidden="true" />
            <div className="user-main">
              <div className="user-top">
                <div className="user-pic">
                  <Avatar name={p.name} src={p.profile_picture} size={6} />
                  {mine && (
                    <button className="btn icon sm user-pic-btn" onClick={() => setPicture(true)} title="Change profile picture" aria-label="Change profile picture">
                      <Icon name="camera" size={14} />
                    </button>
                  )}
                </div>
                {mine && (
                  <Link className="btn sm" to="/settings">
                    <Icon name="edit" size={14} />
                    Edit profile
                  </Link>
                )}
              </div>
              <h1 className="user-name">{p.name}</h1>
              <div className="user-handle">
                <span>@{p.username}</span>
                {mine && me?.is_staff && <span className="chip accent"><Icon name="shield" size={12} />Staff</span>}
              </div>
              {p.groups.length > 0 && (
                <div className="user-groups" aria-label="Groups">
                  {p.groups.map((g) => <span key={g.id} className="chip">{g.name}</span>)}
                </div>
              )}
              {p.description ? <p className="user-desc pre-wrap">{p.description}</p> : <p className="user-desc muted">No description.</p>}
              <div className="user-id xsmall muted" title="User ID">ID {p.id}</div>
            </div>
          </article>
        ) : q.isPending ? (
          <div className="set-card"><SkeletonRows rows={5} /></div>
        ) : q.error instanceof ApiError && q.error.status === 404 ? (
          <div className="set-card empty">There's no one with the username "{username}".</div>
        ) : (
          <ErrorBox error={q.error} retry={() => q.refetch()} />
        )}
      </div>
      {mine && <PictureDialog open={picture} onClose={() => setPicture(false)} />}
    </AppShell>
  )
}
