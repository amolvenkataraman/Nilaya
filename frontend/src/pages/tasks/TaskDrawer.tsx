// Task detail drawer: title, properties, description, subtasks, relations (add/remove) and comments.
// Edits save on blur/change with optimistic updates (lib/queries useUpdateTask / useMoveTask). The Calendar
// app opens it too, for tasks on its agenda.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { TaskCheck } from '../../components/TaskRow'
import { toast } from '../../components/toast'
import {
  Button,
  Dot,
  Drawer,
  DrawerBody,
  DrawerHead,
  ErrorBox,
  Menu,
  MenuItem,
  MenuSeparator,
  SkeletonRows,
  Textarea,
} from '../../components/ui'
import { cn } from '../../lib/cn'
import { fmtStamp, relTime, shortStamp } from '../../lib/dates'
import { useLabels, useMe, useMoveTask, useProjects, useSetDone, useTask, useUpdateTask } from '../../lib/queries'
import { cachedTask } from '../../lib/taskLists'
import type { Project, TaskDetail, TaskPatch } from '../../lib/types'
import { useDuplicateTask, useUnassignMe } from './api'
import { DateField } from './DateField'
import { Comments, Subtasks } from './DrawerSections'
import { useDeleteWithUndo } from './deleteUndo'
import { AssigneesField, LabelsField, StatusField, TimeSpentField } from './Fields'
import { PRIORITY_OPTIONS } from './priority'
import { PROJECT_COLOURS } from './ProjectDialog'
import { ghostSelect } from './propField'
import { Relations, sectionLabel } from './Relations'
import { RemindersField } from './RemindersField'
import { RepeatField } from './RepeatField'
import { canEditIn, canEditTask, isOverdue, isTempId, projectName } from './task'

export function TaskDrawer({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  const task = useTask(id && !isTempId(id) ? id : null)
  return (
    <Drawer open={!!id} onClose={onClose} label="Task details">
      {task.isPending ? (
        <div className="p-4">
          <SkeletonRows rows={6} />
        </div>
      ) : task.error && !task.data ? (
        <DrawerBody>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </Button>
          <ErrorBox error={task.error} />
        </DrawerBody>
      ) : task.data ? (
        <Detail key={task.data.id} task={task.data} onClose={onClose} onOpen={onOpen} />
      ) : null}
    </Drawer>
  )
}

/** Root → leaf project path ("Work › Website"). */
function pathOf(projects: Project[] | undefined, id: string | null): Project[] {
  const out: Project[] = []
  for (let p = projects?.find((x) => x.id === id), n = 0; p && n < 20; p = projects?.find((x) => x.id === p?.parent_id), n++) out.unshift(p)
  return out
}

/** Grows a textarea to fit its text (the title is one line that wraps). */
function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

const fact = 'inline-flex items-center gap-1'
const linkish = 'border-0 bg-transparent p-0 text-[length:inherit] text-accent'
const swatch = 'grid size-5 place-items-center rounded-full border-0 text-white'
const swatchOn = 'shadow-[0_0_0_2px_var(--app-surface),0_0_0_4px_var(--app-fg)]'

function Detail({ task, onClose, onOpen }: { task: TaskDetail; onClose: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient()
  const projects = useProjects().data
  const labels = useLabels().data
  const me = useMe().data
  const update = useUpdateTask()
  const move = useMoveTask()
  const setDone = useSetDone()
  const removeLater = useDeleteWithUndo()
  const duplicate = useDuplicateTask()
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.description)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setTitle(task.title), [task.title])
  useEffect(() => setDesc(task.description), [task.description])
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the title text changes
  useEffect(() => autosize(titleRef.current), [title])

  const canEdit = canEditTask(task, me, projects)
  // Assignees may comment and take themselves off a task even when it's view-only for them.
  const assignedToMe = !!me && task.assignees.some((a) => a.id === me.id || a.username === me.username)
  const unassign = useUnassignMe(task.id)
  const path = pathOf(projects, task.project_id)
  // The parent's title from whatever list already has it (no extra request).
  const parent = task.parent_id ? cachedTask(qc, task.parent_id) : undefined
  const save = (body: TaskPatch) => update.mutate({ id: task.id, body })
  const remove = () => {
    removeLater([task])
    onClose()
  }
  const parentId = task.parent_id

  return (
    <>
      <DrawerHead>
        <TaskCheck task={task} size="lg" onToggle={() => setDone.mutate({ task, done: !task.done })} />
        <nav className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted" aria-label="Breadcrumb">
          {path.length
            ? path.map((p, i) => (
                <span key={p.id} className="inline-flex min-w-0 items-center gap-1">
                  {i > 0 && <Icon name="chevronRight" size={11} />}
                  <Link
                    to={`/tasks?project=${p.id}&task=${task.id}`}
                    className="inline-flex items-center gap-1.25 text-muted no-underline hover:text-fg hover:no-underline"
                  >
                    <Dot colour={p.colour} />
                    {projectName(p)}
                  </Link>
                </span>
              ))
            : 'Task'}
          {parentId && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Icon name="chevronRight" size={11} />
              <button type="button" className={cn(linkish, 'truncate')} onClick={() => onOpen(parentId)}>
                {parent?.title ?? 'Parent task'}
              </button>
            </span>
          )}
        </nav>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon
          className={cn(task.favorite && 'text-warning! [&_svg]:fill-current')}
          onClick={() => save({ favorite: !task.favorite })}
          aria-pressed={task.favorite}
          aria-label={task.favorite ? 'Remove from favourites' : 'Add to favourites'}
          title="Favourite (s)"
        >
          <Icon name="star" />
        </Button>
        <Menu
          align="end"
          label="Task actions"
          trigger={(p) => (
            <Button {...p} variant="ghost" size="sm" icon aria-label="Task actions">
              <Icon name="more" />
            </Button>
          )}
        >
          {(close) => {
            const act = (fn: () => void) => () => {
              close()
              fn()
            }
            return (
              <>
                <MenuItem icon="link" onClick={act(() => toast.copy(`${location.origin}/tasks?view=all&task=${task.id}`, 'Link copied'))}>
                  Copy link
                </MenuItem>
                {canEdit && (
                  <MenuItem
                    icon="copy"
                    onClick={act(() =>
                      duplicate.mutate(task.id, {
                        onSuccess: (t) => {
                          toast.show('Task duplicated')
                          onOpen(t.id)
                        },
                      }),
                    )}
                  >
                    Duplicate
                  </MenuItem>
                )}
                {canEdit && task.parent_id && (
                  <MenuItem icon="arrowUp" onClick={act(() => save({ parent_id: null }))}>
                    Make top-level task
                  </MenuItem>
                )}
                {canEdit && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon="trash" danger end="Del" onClick={act(remove)}>
                      Delete task
                    </MenuItem>
                  </>
                )}
              </>
            )
          }}
        </Menu>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <Icon name="x" />
        </Button>
      </DrawerHead>

      <DrawerBody>
        <textarea
          ref={titleRef}
          // `detail-title` is the hook the "e" shortcut focuses.
          className={cn(
            'detail-title -mx-1.5 w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent px-1.5 py-1 text-lg leading-[1.3] font-semibold tracking-[-0.01em]',
            'hover:bg-hover focus:bg-surface focus:shadow-[0_0_0_1px_var(--app-accent)] focus:outline-none',
            task.done && 'text-muted line-through',
          )}
          value={title}
          rows={1}
          maxLength={256}
          readOnly={!canEdit}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              setTitle(task.title)
              requestAnimationFrame(() => titleRef.current?.blur())
            }
          }}
          onBlur={() => {
            const t = title.replace(/\s+/g, ' ').trim()
            if (t && t !== task.title) save({ title: t })
            else setTitle(task.title)
          }}
        />

        <p className="-mt-1 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted">
          {task.done && task.done_at ? (
            <span className={fact}>
              <Icon name="check" size={11} /> Completed {shortStamp(task.done_at)}
            </span>
          ) : null}
          {!task.done && task.repeat_mode > 0 && task.done_at ? (
            <span className={fact} title={fmtStamp(task.done_at)}>
              <Icon name="repeat" size={11} /> Last done {relTime(new Date(task.done_at))}
            </span>
          ) : null}
          {isOverdue(task) && task.due ? (
            <span className={cn(fact, 'text-danger')}>
              <Icon name="alert" size={11} /> Overdue since {shortStamp(task.due)}
            </span>
          ) : null}
          {task.event_id ? (
            <Link to={`/calendar?event=${task.event_id}`} className={fact}>
              <Icon name="calendar" size={11} /> From a calendar event
            </Link>
          ) : null}
          {me && task.owner.id !== me.id ? (
            <span className={fact}>
              <Icon name="user" size={11} /> Owned by {task.owner.name || task.owner.username}
            </span>
          ) : null}
          {!canEdit ? (
            <span className={fact}>
              <Icon name="info" size={11} /> View only
            </span>
          ) : null}
          {!canEdit && assignedToMe ? (
            <button
              type="button"
              className={linkish}
              onClick={() => unassign.mutate(undefined, { onSuccess: () => toast.show('You are no longer assigned') })}
              disabled={unassign.isPending}
            >
              <Icon name="x" size={11} /> Unassign me
            </button>
          ) : null}
        </p>
        <fieldset className="m-0 min-w-0 border-0 p-0" disabled={!canEdit}>
          <dl
            className={cn(
              'm-0 grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 max-md:grid-cols-[5.5rem_minmax(0,1fr)]',
              '[&>dt]:flex [&>dt]:h-8 [&>dt]:items-center [&>dt]:gap-1.5 [&>dt]:text-xs [&>dt]:text-muted',
              '[&>dd]:m-0 [&>dd]:flex [&>dd]:min-h-8 [&>dd]:flex-wrap [&>dd]:items-center [&>dd]:gap-1',
            )}
          >
            <dt>
              <Icon name="folder" size={14} />
              Project
            </dt>
            <dd>
              <select
                className={ghostSelect}
                value={task.project_id ?? ''}
                aria-label="Project"
                onChange={(e) =>
                  move.mutate(
                    { id: task.id, project_id: e.target.value, bucket_id: null },
                    { onSuccess: () => toast.show(`Moved to ${projects?.find((p) => p.id === e.target.value)?.name ?? 'project'}`) },
                  )
                }
              >
                {projects
                  ?.filter((p) => (!p.archived && canEditIn(p)) || p.id === task.project_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {projectName(p)}
                    </option>
                  ))}
              </select>
            </dd>

            <StatusField task={task} />

            <dt>
              <Icon name="calendar" size={14} />
              Due
            </dt>
            <dd>
              <DateField task={task} field="due" save={save} />
            </dd>

            <dt>
              <Icon name="play" size={14} />
              Start
            </dt>
            <dd>
              <DateField task={task} field="start" save={save} />
            </dd>

            <dt>
              <Icon name="flag" size={14} />
              Priority
            </dt>
            <dd>
              {/* Segmented's look, with the level's colour on the chosen high/urgent. */}
              {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, like the shared Segmented */}
              <div
                role="group"
                aria-label="Priority"
                className="inline-flex flex-wrap gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5"
              >
                {PRIORITY_OPTIONS.map((p) => {
                  const on = task.priority === p.value
                  return (
                    <button
                      key={p.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => save({ priority: p.value })}
                      className={cn(
                        'inline-flex h-6.5 items-center rounded-xs border-0 px-2.5 text-xs font-medium',
                        on
                          ? [
                              'bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.08),0_0_0_1px_var(--app-border)]',
                              p.value === 20 ? 'text-danger' : p.value === 15 ? 'text-warning' : 'text-fg',
                            ]
                          : 'bg-transparent text-muted hover:text-fg',
                      )}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </dd>

            <dt>
              <Icon name="tag" size={14} />
              Labels
            </dt>
            <dd>
              <LabelsField task={task} labels={labels} save={save} />
            </dd>

            <dt>
              <Icon name="users" size={14} />
              Assignees
            </dt>
            <dd>
              <AssigneesField task={task} save={save} />
            </dd>

            <dt>
              <Icon name="repeat" size={14} />
              Repeat
            </dt>
            <dd>
              <RepeatField task={task} save={save} />
            </dd>

            <dt>
              <Icon name="bell" size={14} />
              Reminders
            </dt>
            <dd>
              <RemindersField task={task} save={save} />
            </dd>

            <dt>
              <Icon name="palette" size={14} />
              Colour
            </dt>
            {/* Smaller than the shared ColourPicker, to keep the property list dense. */}
            <dd className="gap-1.25!">
              <button
                type="button"
                className={cn(swatch, 'bg-surface text-muted shadow-[inset_0_0_0_1px_var(--app-border)]', !task.colour && swatchOn)}
                aria-pressed={!task.colour}
                aria-label="No colour"
                onClick={() => save({ colour: '' })}
              >
                {!task.colour && <Icon name="check" size={11} />}
              </button>
              {PROJECT_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn(swatch, task.colour === c && swatchOn)}
                  aria-pressed={task.colour === c}
                  aria-label={c}
                  style={{ background: c }}
                  onClick={() => save({ colour: c })}
                >
                  {task.colour === c && <Icon name="check" size={11} />}
                </button>
              ))}
            </dd>

            <dt>
              <Icon name="chart" size={14} />
              Progress
            </dt>
            <dd>
              <input
                type="range"
                className="max-w-48 flex-1 accent-accent"
                min={0}
                max={100}
                step={5}
                defaultValue={task.percent}
                key={task.percent}
                aria-label="Percent done"
                onInput={(e) => {
                  const out = e.currentTarget.nextElementSibling
                  if (out) out.textContent = `${e.currentTarget.value}%`
                }}
                onPointerUp={(e) => save({ percent: Number(e.currentTarget.value) })}
                onKeyUp={(e) => save({ percent: Number(e.currentTarget.value) })}
              />
              <span className="text-sm tabular-nums">{task.percent}%</span>
            </dd>

            <dt>
              <Icon name="clock" size={14} />
              Time spent
            </dt>
            <dd>
              <TimeSpentField task={task} save={save} />
            </dd>
          </dl>
        </fieldset>

        <label className={sectionLabel} htmlFor="task-desc">
          Description
        </label>
        <Textarea
          id="task-desc"
          size="lg"
          value={desc}
          readOnly={!canEdit}
          placeholder={canEdit ? 'Add details…' : 'No description'}
          maxLength={10000}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              e.currentTarget.blur()
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.blur()
          }}
          onBlur={() => desc !== task.description && save({ description: desc })}
        />

        <Subtasks task={task} onOpen={onOpen} canEdit={canEdit} />

        <Relations task={task} onOpen={onOpen} canEdit={canEdit} />

        <Comments taskId={task.id} canComment={canEdit || assignedToMe} />

        <p className="border-t border-border pt-3 text-xs text-muted">
          Created {shortStamp(task.created_on)} by {task.owner.name || task.owner.username} · updated {shortStamp(task.updated_on)}
        </p>
      </DrawerBody>
    </>
  )
}
