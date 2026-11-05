// Project sharing: who can see or edit a project. Admins add people by username, change roles
// (POST upserts) and remove them; everyone else sees the list and can leave.
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Avatar, Confirm, Dialog, SkeletonRows, ErrorBox } from '../../components/ui'
import { useMe } from '../../lib/queries'
import type { Member } from '../../lib/types'
import { useMembers, useRemoveMember, useSaveMember, type ProjectWithOwner } from './api'

const ROLES = [[0, 'Can view'], [1, 'Can edit'], [2, 'Admin']] as const

export function ShareDialog({ project, onClose, onLeft }: { project: ProjectWithOwner | null; onClose: () => void; onLeft?: () => void }) {
  const id = project?.id ?? null
  const members = useMembers(id)
  const me = useMe().data
  const save = useSaveMember(id ?? '')
  const remove = useRemoveMember(id ?? '')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState(1)
  const [leaving, setLeaving] = useState<Member | null>(null)
  useEffect(() => { if (id) { setUsername(''); setRole(1) } }, [id])
  const admin = (project?.role ?? 0) >= 2
  const add = () => {
    const u = username.trim().replace(/^@/, '')
    if (!u) return
    save.mutate({ username: u, role }, { onSuccess: () => setUsername('') })
  }
  const owner = project?.owner

  return (
    <Dialog open={!!project} onClose={onClose} title={project ? <>Share “{project.name}”</> : ''} width="30rem">
      <div className="stack share">
        {admin && (
          <form className="share-add" onSubmit={(e) => (e.preventDefault(), add())}>
            <input className="input grow" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username to add" maxLength={150} autoComplete="off" autoFocus />
            <select className="select share-role" value={role} onChange={(e) => setRole(Number(e.target.value))} aria-label="Role">
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="btn primary" disabled={!username.trim() || save.isPending}>Add</button>
          </form>
        )}
        <div className="share-list" role="list" aria-label="People with access">
          {owner && (
            <div className="share-row" role="listitem">
              <Avatar name={owner.name || owner.username} size={1.75} />
              <div className="grow share-who"><span className="truncate">{owner.name || owner.username}{me?.id === owner.id ? ' (you)' : ''}</span><span className="muted xsmall truncate">@{owner.username}</span></div>
              <span className="muted xsmall share-fixed">Owner</span>
            </div>
          )}
          {members.isPending ? <SkeletonRows rows={2} avatar /> : members.error ? <ErrorBox error={members.error} retry={() => members.refetch()} /> : members.data?.map((m) => {
            const self = me?.id === m.user.id
            return (
              <div key={m.id} className="share-row" role="listitem">
                <Avatar name={m.user.name || m.user.username} size={1.75} />
                <div className="grow share-who"><span className="truncate">{m.user.name || m.user.username}{self ? ' (you)' : ''}</span><span className="muted xsmall truncate">@{m.user.username}</span></div>
                {admin ? (
                  <select className="select ghost-select share-role" value={m.role} aria-label={`Role for ${m.user.username}`}
                    onChange={(e) => save.mutate({ username: m.user.username, role: Number(e.target.value) })}>
                    {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : (
                  <span className="muted xsmall share-fixed">{ROLES.find(([v]) => v === m.role)?.[1]}</span>
                )}
                {(admin || self) && (
                  <button className="btn ghost icon sm" onClick={() => (self ? setLeaving(m) : remove.mutate(m.id))} aria-label={self ? 'Leave project' : `Remove ${m.user.username}`} title={self ? 'Leave project' : 'Remove'}>
                    <Icon name={self ? 'logout' : 'x'} size={14} />
                  </button>
                )}
              </div>
            )
          })}
          {members.data?.length === 0 && <p className="muted xsmall share-empty">{admin ? 'Only you can see this project. Add people by their username.' : 'Nobody else has been added.'}</p>}
        </div>
        <p className="help">Can view: see tasks. Can edit: add and change tasks. Admin: also manage people. People get a notification when added.</p>
      </div>
      <Confirm
        open={!!leaving}
        title="Leave this project?"
        body="You lose access until someone adds you again."
        confirmLabel="Leave"
        onConfirm={() => leaving && remove.mutate(leaving.id, { onSuccess: () => (onClose(), onLeft?.()) })}
        onClose={() => setLeaving(null)}
      />
    </Dialog>
  )
}
