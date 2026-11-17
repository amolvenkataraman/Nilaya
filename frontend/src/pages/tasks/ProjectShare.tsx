// Project sharing: who can see or edit a project. Admins add people by username, change roles
// (POST upserts) and remove them; everyone else sees the list and can leave.
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Avatar, Button, Confirm, Dialog, fieldClass, Input, QueryView, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { useMe } from '../../lib/queries'
import type { Member, UserBrief } from '../../lib/types'
import { type ProjectWithOwner, useMembers, useRemoveMember, useSaveMember } from './api'
import { ghostSelect } from './propField'
import { isProjectAdmin } from './task'

const ROLES = [
  [0, 'Can view'],
  [1, 'Can edit'],
  [2, 'Admin'],
] as const

const roleSelect = 'h-7.5! w-auto text-xs!'

function Person({ user, you, children }: { user: UserBrief; you: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex min-h-11 items-center gap-2.5 rounded-sm p-1.5 hover:bg-hover">
      <Avatar name={user.name || user.username} size={1.75} />
      <div className="grid min-w-0 flex-auto text-sm leading-[1.3]">
        <span className="truncate">
          {user.name || user.username}
          {you ? ' (you)' : ''}
        </span>
        <span className="truncate text-xs text-muted">@{user.username}</span>
      </div>
      {children}
    </li>
  )
}

export function ShareDialog({ project, onClose, onLeft }: { project: ProjectWithOwner | null; onClose: () => void; onLeft?: () => void }) {
  const id = project?.id ?? null
  const members = useMembers(id)
  const me = useMe().data
  const save = useSaveMember(id ?? '')
  const remove = useRemoveMember(id ?? '')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState(1)
  const [leaving, setLeaving] = useState<Member | null>(null)
  useEffect(() => {
    if (id) {
      setUsername('')
      setRole(1)
    }
  }, [id])
  const admin = isProjectAdmin(project ?? undefined)
  const add = () => {
    const u = username.trim().replace(/^@/, '')
    if (!u) return
    save.mutate({ username: u, role }, { onSuccess: () => setUsername('') })
  }
  const owner = project?.owner

  return (
    <Dialog open={!!project} onClose={onClose} title={project ? <>Share “{project.name}”</> : ''} width="30rem">
      <div className="grid gap-3">
        {admin && (
          <form
            className="flex gap-1.5 max-md:flex-wrap"
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <Input
              className="min-w-0 flex-auto max-md:basis-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              aria-label="Username to add"
              maxLength={150}
              autoComplete="off"
              autoFocus
            />
            <select
              className={cn(fieldClass.select, roleSelect, 'max-md:flex-1')}
              value={role}
              onChange={(e) => setRole(Number(e.target.value))}
              aria-label="Role"
            >
              {ROLES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={!username.trim() || save.isPending}>
              Add
            </Button>
          </form>
        )}
        <ul className="-mx-1.5 grid gap-0.5" aria-label="People with access">
          {owner && (
            <Person user={owner} you={me?.id === owner.id}>
              <span className="px-2 text-xs text-muted">Owner</span>
            </Person>
          )}
          <QueryView
            query={members}
            skeleton={<SkeletonRows rows={2} avatar />}
            isEmpty={(list) => list.length === 0}
            empty={
              <p className="px-1.5 py-1 text-xs text-muted">
                {admin ? 'Only you can see this project. Add people by their username.' : 'Nobody else has been added.'}
              </p>
            }
          >
            {(list) =>
              list.map((m) => {
                const self = me?.id === m.user.id
                return (
                  <Person key={m.id} user={m.user} you={self}>
                    {admin ? (
                      <select
                        className={cn(ghostSelect, roleSelect)}
                        value={m.role}
                        aria-label={`Role for ${m.user.username}`}
                        onChange={(e) => save.mutate({ username: m.user.username, role: Number(e.target.value) })}
                      >
                        {ROLES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="px-2 text-xs text-muted">{ROLES.find(([v]) => v === m.role)?.[1]}</span>
                    )}
                    {(admin || self) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        onClick={() => (self ? setLeaving(m) : remove.mutate(m.id))}
                        aria-label={self ? 'Leave project' : `Remove ${m.user.username}`}
                        title={self ? 'Leave project' : 'Remove'}
                      >
                        <Icon name={self ? 'logout' : 'x'} size={14} />
                      </Button>
                    )}
                  </Person>
                )
              })
            }
          </QueryView>
        </ul>
        <p className="text-xs text-muted">
          Can view: see tasks. Can edit: add and change tasks. Admin: also manage people. People get a notification when added.
        </p>
      </div>
      <Confirm
        open={!!leaving}
        title="Leave this project?"
        body="You lose access until someone adds you again."
        confirmLabel="Leave"
        onConfirm={() =>
          leaving &&
          remove.mutate(leaving.id, {
            onSuccess: () => {
              onClose()
              onLeft?.()
            },
          })
        }
        onClose={() => setLeaving(null)}
      />
    </Dialog>
  )
}
