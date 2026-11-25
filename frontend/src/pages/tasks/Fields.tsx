// Editable task properties for the detail drawer: status (board column), assignees, labels (with create)
// and time spent. Due/start, repeat and reminders have their own files. Each saves through `save` (an
// optimistic PATCH) or the move mutation; nothing here fetches unless its menu is opened.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { fmtMinutes } from '../../components/TaskRow'
import { toast } from '../../components/toast'
import { Avatar, Chip, chipClass, Dot, Input, Menu, MenuItem, MenuLabel } from '../../components/ui'
import { cn } from '../../lib/cn'
import { useBuckets, useMe, useMoveTask, useProjects } from '../../lib/queries'
import type { Label, TaskDetail, UserBrief } from '../../lib/types'
import { useMembers, useSaveLabel } from './api'
import { labelStyle } from './Labels'
import { ghostSelect, propBtn, type Save } from './propField'
import { canEditIn, parseMinutes } from './task'

// ---------------------------------------------------------------- status (board column)
export function StatusField({ task }: { task: TaskDetail }) {
  const buckets = useBuckets(task.project_id)
  const move = useMoveTask()
  const list = [...(buckets.data ?? [])].sort((a, b) => a.position - b.position)
  if (!list.length) return null
  const cur = list.find((b) => b.id === task.bucket_id) ?? list.find((b) => !b.is_done)
  return (
    <>
      <dt>
        <Icon name="board" size={14} />
        Status
      </dt>
      <dd>
        <select
          className={ghostSelect}
          aria-label="Status"
          value={cur?.id ?? ''}
          onChange={(e) => move.mutate({ id: task.id, bucket_id: Number(e.target.value) })}
        >
          {list.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.is_done ? ' (done)' : ''}
            </option>
          ))}
        </select>
      </dd>
    </>
  )
}

// ---------------------------------------------------------------- assignees
export function AssigneesField({ task, save }: { task: TaskDetail; save: Save }) {
  const people = task.assignees
  return (
    <Menu
      label="Assignees"
      width="16rem"
      trigger={(p) => (
        <button {...p} type="button" className={cn(propBtn, people.length ? 'text-fg' : 'text-muted')}>
          {people.length
            ? people.map((a) => (
                <Chip key={a.username}>
                  <Avatar name={a.name || a.username} size={0.875} />
                  {a.name || a.username}
                </Chip>
              ))
            : 'Unassigned'}
        </button>
      )}
    >
      {() => <AssigneeList task={task} assigned={people} save={save} />}
    </Menu>
  )
}

function AssigneeList({ task, assigned, save }: { task: TaskDetail; assigned: UserBrief[]; save: Save }) {
  const me = useMe().data
  const project = useProjects().data?.find((p) => p.id === task.project_id)
  const members = useMembers(task.project_id && !project?.is_inbox ? task.project_id : null)
  // Who the server accepts (tasks.service.assignable_user_ids): the project's owner and members, just
  // the creator for a loose task; people already assigned can stay.
  const people = new Map<string, UserBrief>()
  if (me && (task.project_id ? canEditIn(project) : task.owner.id === me.id))
    people.set(me.username, {
      id: me.id,
      username: me.username,
      name: [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username,
    })
  if (project?.owner) people.set(project.owner.username, project.owner)
  if (!task.project_id) people.set(task.owner.username, task.owner)
  for (const a of assigned) people.set(a.username, a)
  for (const m of members.data ?? []) people.set(m.user.username, m.user)
  const names = assigned.map((a) => a.username)
  return (
    <>
      <MenuLabel>Assign to</MenuLabel>
      {[...people.values()].map((u) => {
        const on = names.includes(u.username)
        return (
          <MenuItem
            key={u.username}
            active={on}
            end={on ? '✓' : undefined}
            onClick={() => save({ assignees: on ? names.filter((n) => n !== u.username) : [...names, u.username] })}
          >
            <span className="flex items-center gap-2">
              <Avatar name={u.name || u.username} size={1.125} />
              {u.name || u.username}
              {u.username === me?.username ? <span className="text-muted"> (you)</span> : null}
            </span>
          </MenuItem>
        )
      })}
      {members.isFetching && <MenuLabel>Loading people…</MenuLabel>}
      {people.size < 2 && !members.isFetching && <MenuLabel>Share the project to assign others.</MenuLabel>}
    </>
  )
}

// ---------------------------------------------------------------- labels
export function LabelsField({ task, labels, save }: { task: TaskDetail; labels?: Label[]; save: Save }) {
  const create = useSaveLabel()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const add = () => {
    const n = name.trim()
    if (!n) return setAdding(false)
    const hit = labels?.find((l) => l.name.toLowerCase() === n.toLowerCase())
    const apply = (id: number) => !task.labels.includes(id) && save({ labels: [...task.labels, id] })
    setName('')
    setAdding(false)
    if (hit) return apply(hit.id)
    create.mutate({ body: { name: n } }, { onSuccess: (l) => apply(l.id) })
  }
  return (
    <>
      {labels?.map((l) => {
        const on = task.labels.includes(l.id)
        return (
          <button
            key={l.id}
            type="button"
            className={cn(
              chipClass({ interactive: true }),
              on &&
                'border-transparent! bg-[color-mix(in_srgb,var(--lc,var(--app-accent))_14%,transparent)]! text-[color-mix(in_srgb,var(--lc,var(--app-accent))_82%,var(--app-fg))]!',
            )}
            style={labelStyle(l.colour)}
            aria-pressed={on}
            onClick={() => save({ labels: on ? task.labels.filter((x) => x !== l.id) : [...task.labels, l.id] })}
          >
            {on ? <Icon name="check" size={11} /> : <Dot colour={l.colour} className="size-1.75!" />}
            {l.name}
          </button>
        )
      })}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <Input
            size="xs"
            width="content"
            className="w-32"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={add}
            maxLength={48}
            placeholder="New label"
            aria-label="New label name"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              e.stopPropagation()
              setName('')
              setAdding(false)
            }}
          />
        </form>
      ) : (
        <button type="button" className={chipClass({ interactive: true })} onClick={() => setAdding(true)}>
          <Icon name="plus" size={11} />
          New label
        </button>
      )}
    </>
  )
}

// ---------------------------------------------------------------- time spent
export function TimeSpentField({ task, save }: { task: TaskDetail; save: Save }) {
  const shown = (m: number) => (m ? fmtMinutes(m) : '')
  const [v, setV] = useState(shown(task.time_spent))
  const [prev, setPrev] = useState(task.time_spent)
  if (prev !== task.time_spent) {
    setPrev(task.time_spent)
    setV(shown(task.time_spent))
  }
  const commit = () => {
    const m = parseMinutes(v)
    if (m == null) {
      toast.error('Use a time like 45m, 1h 30m or 1:30.')
      setV(shown(task.time_spent))
      return
    }
    if (m !== task.time_spent) save({ time_spent: Math.min(m, 32767) })
  }
  return (
    <>
      <Input
        width="content"
        variant="ghost"
        className="w-26"
        value={v}
        placeholder="e.g. 1h 30m"
        aria-label="Time spent"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setV(shown(task.time_spent))
            e.currentTarget.blur()
          }
        }}
      />
      {[15, 30, 60].map((m) => (
        <button
          key={m}
          type="button"
          className={chipClass({ interactive: true })}
          onClick={() => save({ time_spent: task.time_spent + m })}
        >
          +{m < 60 ? `${m}m` : '1h'}
        </button>
      ))}
    </>
  )
}
