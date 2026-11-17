// Someone's profile (GET /users/{username}, also by user id): picture, name, staff badge, public groups, description.
// Your own profile shows all your groups and links to Settings to edit it.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Avatar, Button, buttonClass, EmptyState, ErrorBox, SkeletonRows } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useMe } from '../../lib/queries'
import { cardClass } from '../settings/Card'
import { Chip } from '../settings/Chip'
import { PictureDialog } from '../settings/PictureDialog'
import { pageClass } from '../settings/SettingsSection'
import { type Person, personQuery } from './api'

export default function UserPage() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const me = useMe().data
  const mine = !!me && me.username === username
  // Your own profile comes from /me, so edits show at once (and every group, not only public ones).
  const q = useQuery({ ...personQuery(username), enabled: !!username && !!me && !mine })
  const [picture, setPicture] = useState(false)
  const p: Person | undefined =
    mine && me
      ? {
          id: me.id,
          username: me.username,
          name: [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username,
          description: me.description,
          profile_picture: me.profile_picture,
          is_staff: me.is_staff,
          groups: me.groups,
        }
      : q.data
  const topbar = (
    <Button variant="ghost" size="sm" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
      <Icon name="x" size={14} />
      Close
    </Button>
  )
  return (
    <AppShell app="home" title="Profile" pageTitle={p?.name ?? 'Profile'} topbar={topbar}>
      <div className={cn(pageClass, 'max-w-[40rem]')}>
        {p ? (
          <article className={cn(cardClass, 'overflow-hidden')}>
            <div
              className="h-26 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--app-accent)_55%,var(--app-surface)),color-mix(in_srgb,var(--app-accent)_18%,var(--app-surface)))]"
              aria-hidden="true"
            />
            <div className="grid gap-2 px-5 pb-5 max-md:px-4 max-md:pb-4">
              <div className="-mt-12 flex items-end justify-between gap-3">
                <div className="relative shrink-0 [&_.avatar]:box-content [&_.avatar]:border-4 [&_.avatar]:border-surface">
                  <Avatar name={p.name} src={p.profile_picture} size={6} />
                  {mine && (
                    <Button
                      size="sm"
                      icon
                      className="absolute right-0.5 bottom-0.5 rounded-full! shadow-card"
                      onClick={() => setPicture(true)}
                      title="Change profile picture"
                      aria-label="Change profile picture"
                    >
                      <Icon name="camera" size={14} />
                    </Button>
                  )}
                </div>
                {mine && (
                  <Link className={buttonClass({ size: 'sm', className: 'hover:no-underline' })} to="/settings">
                    <Icon name="edit" size={14} />
                    Edit profile
                  </Link>
                )}
              </div>
              <h1 className="mt-1 text-lg font-semibold wrap-anywhere">{p.name}</h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>@{p.username}</span>
                {p.is_staff && (
                  <Chip tone="accent">
                    <Icon name="shield" size={12} />
                    Staff
                  </Chip>
                )}
              </div>
              {p.groups.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Groups">
                  {p.groups.map((g) => (
                    <li key={g.id} className="flex">
                      <Chip>{g.name}</Chip>
                    </li>
                  ))}
                </ul>
              )}
              {p.description ? (
                <p className="text-sm whitespace-pre-wrap wrap-anywhere">{p.description}</p>
              ) : (
                <p className="text-sm text-muted">No description.</p>
              )}
              <div className="font-mono text-xs wrap-anywhere text-muted" title="User ID">
                ID {p.id}
              </div>
            </div>
          </article>
        ) : q.isPending ? (
          <div className={cardClass}>
            <SkeletonRows rows={5} />
          </div>
        ) : q.error instanceof ApiError && q.error.status === 404 ? (
          <div className={cardClass}>
            <EmptyState>There's no one with the username "{username}".</EmptyState>
          </div>
        ) : (
          <ErrorBox error={q.error} retry={() => q.refetch()} />
        )}
      </div>
      {mine && <PictureDialog open={picture} onClose={() => setPicture(false)} />}
    </AppShell>
  )
}
