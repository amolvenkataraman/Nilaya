// Share an album with people by username (viewer or editor), change their role, or stop sharing (with a
// second click to confirm). Members change optimistically.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Avatar, Button, Dialog, Input, QueryView, Select } from '../../components/ui'
import { type ApiError, api, get, patch, post } from '../../lib/api'
import type { Album } from '../../lib/types'
import type { AlbumMember } from './actions'
import { smallSelectClass } from './StatCards'

type Role = 'viewer' | 'editor'

export function ShareDialog({ album, onClose }: { album: Album; onClose: () => void }) {
  const qc = useQueryClient()
  const key = ['photos', 'album-members', album.id]
  const members = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<AlbumMember[]>(`photos/albums/${album.id}/members`, undefined, signal),
  })
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const add = useMutation({
    mutationFn: () => post<AlbumMember>(`photos/albums/${album.id}/members`, { username: username.trim(), role }),
    onSuccess: (m) => {
      toast.show(`Shared with @${m.username}`)
      setUsername('')
      refresh()
    },
    meta: { errorMessage: (e) => ((e as ApiError).status === 404 ? `No user called "${username.trim()}".` : (e as Error).message) },
  })
  const change = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => patch(`photos/albums/${album.id}/members/${id}`, { role }),
    onMutate: ({ id, role }) => qc.setQueryData<AlbumMember[]>(key, (old) => old?.map((m) => (m.id === id ? { ...m, role } : m))),
    onError: () => refresh(),
  })
  const drop = useMutation({
    mutationFn: (id: number) => api(`photos/albums/${album.id}/members/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.setQueryData<AlbumMember[]>(key, (old) => old?.filter((m) => m.id !== id))
      setConfirmId(null)
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Share "${album.name}"`}
      width="30rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <form
        className="grid grid-cols-[1fr_auto_auto] gap-1.5 max-sm:grid-cols-[1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          if (username.trim()) add.mutate()
        }}
      >
        <Input
          className="max-sm:col-span-full"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          aria-label="Username to share with"
          autoComplete="off"
          maxLength={150}
          autoFocus
        />
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
          <option value="viewer">Can view</option>
          <option value="editor">Can edit</option>
        </Select>
        <Button type="submit" variant="primary" disabled={!username.trim() || add.isPending}>
          Add
        </Button>
      </form>
      <p className="text-xs text-muted">Editors can add and remove photos. They get a notification when you add them.</p>
      <div className="mt-3 text-xs font-medium text-muted">People with access</div>
      <QueryView
        query={members}
        skeleton={<p className="text-sm text-muted">Loading…</p>}
        isEmpty={(d) => !d.length}
        empty={<p className="text-sm text-muted">Only you. Add someone by username above.</p>}
      >
        {(list) => (
          <ul className="mt-1.5 grid gap-0.5">
            {list.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 rounded-sm px-1 py-1.5 text-sm hover:bg-hover">
                <Avatar name={m.name || m.username} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.name}</span>
                  <span className="text-xs text-muted">@{m.username}</span>
                </span>
                <select
                  className={smallSelectClass}
                  value={m.role}
                  onChange={(e) => change.mutate({ id: m.id, role: e.target.value as Role })}
                  aria-label={`Role for ${m.username}`}
                >
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
                {confirmId === m.id ? (
                  <Button variant="danger" size="sm" onClick={() => drop.mutate(m.id)} disabled={drop.isPending}>
                    Remove?
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    onClick={() => setConfirmId(m.id)}
                    aria-label={`Stop sharing with ${m.username}`}
                    title="Stop sharing"
                  >
                    <Icon name="x" size={14} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Dialog>
  )
}
