// The drawer's lower sections: subtasks (progress, rows, natural-language add) and comments (edit and
// delete your own, Ctrl+Enter to send).
import { useState } from 'react'
import { QuickAddInput } from '../../components/QuickAdd'
import { TaskRow } from '../../components/TaskRow'
import { toast } from '../../components/toast'
import { Avatar, Button, Confirm, Textarea } from '../../components/ui'
import { fmtStamp, shortStamp } from '../../lib/dates'
import { keys, useComments, useMe, useSetDone, useTasks } from '../../lib/queries'
import type { TaskDetail } from '../../lib/types'
import { useAddComment, useDeleteComment, useEditComment } from './api'
import { sectionLabel } from './Relations'

export function Subtasks({ task, onOpen, canEdit }: { task: TaskDetail; onOpen: (id: string) => void; canEdit: boolean }) {
  const params = { parent: task.id, sort: 'position', limit: 200 }
  const subs = useTasks(params, !!task.subtasks)
  const setDone = useSetDone()
  const items = subs.data?.items ?? []
  const done = items.filter((t) => t.done).length
  return (
    <div className="grid gap-1.5">
      <div className={sectionLabel}>
        Subtasks{' '}
        {items.length > 0 && (
          <span className="text-muted">
            {done}/{items.length}
          </span>
        )}
        {items.length > 0 && (
          <span className="h-1 max-w-32 flex-1 overflow-hidden rounded-[2px] bg-surface-2">
            <span className="block h-full rounded-[2px] bg-success" style={{ width: `${(done / items.length) * 100}%` }} />
          </span>
        )}
      </div>
      <div className="-mx-2 grid gap-px">
        {items.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            showProject={false}
            onToggle={() => (canEdit ? setDone.mutate({ task: t, done: !t.done }) : toast.error('You can only view this task'))}
            onOpen={() => onOpen(t.id)}
          />
        ))}
        {canEdit && (
          <QuickAddInput
            compact
            parentId={task.id}
            projectId={task.project_id}
            listKey={keys.taskList(params)}
            placeholder="Add subtask — natural language works"
          />
        )}
      </div>
    </div>
  )
}

export function Comments({ taskId, canComment }: { taskId: string; canComment: boolean }) {
  const comments = useComments(taskId)
  const me = useMe().data
  const add = useAddComment(taskId)
  const edit = useEditComment(taskId)
  const remove = useDeleteComment(taskId)
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const submit = () => {
    const b = body.trim()
    if (!b) return
    add.mutate(b, { onSuccess: () => setBody('') })
  }
  const saveEdit = () => {
    if (!editing) return
    const b = editing.body.trim()
    if (!b) return
    edit.mutate({ id: editing.id, body: b }, { onSuccess: () => setEditing(null) })
  }
  const tool = 'h-5.5! px-1.5!'
  return (
    <div className="grid gap-1.5">
      <div className={sectionLabel}>
        Comments {comments.data?.length ? <span className="text-muted">{comments.data.length}</span> : null}
      </div>
      <div className="grid gap-3">
        {comments.data?.map((c) => {
          const mine = !!me && c.author.id === me.id
          return (
            <div key={c.id} className="group/comment flex gap-2.5">
              <Avatar name={c.author.name || c.author.username} size={1.5} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <strong>{c.author.name || c.author.username}</strong>
                  <span className="text-muted" title={fmtStamp(c.created_on)}>
                    {shortStamp(c.created_on)}
                    {c.edited_on ? ' · edited' : ''}
                  </span>
                  {mine && editing?.id !== c.id && (
                    <span className="ml-auto inline-flex gap-0.5 opacity-0 group-hover/comment:opacity-100 focus-within:opacity-100 touch:opacity-100">
                      <Button variant="ghost" size="sm" className={tool} onClick={() => setEditing({ id: c.id, body: c.body })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" className={tool} onClick={() => setDeleting(c.id)}>
                        Delete
                      </Button>
                    </span>
                  )}
                </div>
                {editing?.id === c.id ? (
                  <div className="grid gap-1.5">
                    <Textarea
                      className="min-h-10!"
                      rows={3}
                      autoFocus
                      value={editing.body}
                      maxLength={10000}
                      aria-label="Edit comment"
                      onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault()
                          saveEdit()
                        }
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setEditing(null)
                        }
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <span className="flex-auto" />
                      <Button size="sm" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button variant="primary" size="sm" disabled={!editing.body.trim() || edit.isPending} onClick={saveEdit}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-0.5 text-sm wrap-anywhere whitespace-pre-wrap">{c.body}</div>
                )}
              </div>
            </div>
          )
        })}
        {!canComment && !comments.data?.length && <p className="text-xs text-muted">No comments.</p>}
        {canComment && (
          <form
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Textarea
              className="min-h-10!"
              rows={2}
              value={body}
              maxLength={10000}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a comment…"
              aria-label="New comment"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  e.currentTarget.blur()
                }
              }}
            />
            {body.trim() && (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-auto text-xs text-muted">Ctrl+Enter to send</span>
                <Button type="submit" variant="primary" size="sm" disabled={add.isPending}>
                  Comment
                </Button>
              </div>
            )}
          </form>
        )}
      </div>
      <Confirm
        open={!!deleting}
        title="Delete comment?"
        body="This can't be undone."
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
