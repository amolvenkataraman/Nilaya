// Project create/edit (name, description, colour, parent, default layout), the project options menu,
// and the saved-view dialog (save the current filters as a view, or rename one).
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import {
  Button,
  ColourPicker,
  Confirm,
  Dialog,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Segmented,
  Select,
  Textarea,
} from '../../components/ui'
import type { TaskQuery } from '../../lib/queries'
import type { Project, SavedView } from '../../lib/types'
import { useDeleteProject, useSaveProject, useSaveView } from './api'
import { FieldGroup, sideMore } from './Labels'
import { isProjectAdmin } from './task'
import { useOpenCount } from '../../lib/useOpenCount'

/** The colours projects, labels and tasks pick from (candidate for lib/colour.ts). */
export const PROJECT_COLOURS = [
  '#2563eb',
  '#0891b2',
  '#0f766e',
  '#16a34a',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#7c3aed',
  '#64748b',
]
type DefaultLayout = 'list' | 'board' | 'table' | 'calendar'
const LAYOUTS: { value: DefaultLayout; label: string; icon: string }[] = [
  { value: 'list', label: 'List', icon: 'list' },
  { value: 'board', label: 'Board', icon: 'board' },
  { value: 'table', label: 'Table', icon: 'layers' },
  { value: 'calendar', label: 'Calendar', icon: 'calendar' },
]

export function ProjectDialog({
  open,
  project,
  parentId,
  projects,
  onClose,
  onCreated,
}: {
  open: boolean
  project: Project | null
  parentId?: string | null
  projects?: Project[]
  onClose: () => void
  onCreated: (p: Project) => void
}) {
  const save = useSaveProject()
  const [name, setName] = useState('')
  const [colour, setColour] = useState(PROJECT_COLOURS[0])
  const [view, setView] = useState<DefaultLayout>('list')
  const [description, setDescription] = useState('')
  const [parent, setParent] = useState('')
  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setColour(project ? project.colour : PROJECT_COLOURS[0])
    setView((project?.default_view || 'list') as DefaultLayout)
    setDescription(project?.description ?? '')
    setParent(project?.parent_id ?? parentId ?? '')
  }, [open, project, parentId])
  // A project can't sit under itself or one of its own subprojects.
  const below = new Set<string>()
  if (project) {
    below.add(project.id)
    for (let grew = true; grew; ) {
      grew = false
      for (const p of projects ?? [])
        if (p.parent_id && below.has(p.parent_id) && !below.has(p.id)) {
          below.add(p.id)
          grew = true
        }
    }
  }
  const parents = (projects ?? []).filter((p) => !p.is_inbox && isProjectAdmin(p) && !below.has(p.id))
  const submit = () => {
    if (!name.trim()) return
    const body: Partial<Project> = { name: name.trim(), colour, default_view: view, description }
    if (!project?.is_inbox) body.parent_id = parent || null
    save.mutate(
      { id: project?.id, body },
      {
        onSuccess: (p) => {
          onClose()
          if (!project) onCreated(p)
          else toast.show('Project saved')
        },
      },
    )
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : parentId ? 'New subproject' : 'New project'}
      width="28rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={submit}>
            {project ? 'Save' : 'Create project'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={128} autoFocus />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <FieldGroup label="Colour">
          <ColourPicker value={colour || null} onChange={(c) => setColour(c ?? '')} colours={PROJECT_COLOURS} none="No colour" />
        </FieldGroup>
        {!project?.is_inbox && (
          <Field label="Parent project">
            <Select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">No parent</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <FieldGroup label="Default layout">
          <Segmented
            label="Default layout"
            className="justify-self-start"
            value={view}
            onChange={setView}
            options={LAYOUTS.map((l) => ({ value: l.value, label: l.label, icon: l.icon }))}
          />
        </FieldGroup>
      </form>
    </Dialog>
  )
}

export function ProjectMenu({
  project,
  onEdit,
  onDeleted,
  onShare,
  onAddSub,
  trigger,
}: {
  project: Project
  onEdit: () => void
  onDeleted: () => void
  onShare?: () => void
  onAddSub?: () => void
  trigger?: 'header'
}) {
  const save = useSaveProject()
  const remove = useDeleteProject()
  const [confirm, setConfirm] = useState(false)
  const admin = isProjectAdmin(project)
  return (
    <>
      <Menu
        align="end"
        label={`${project.name} options`}
        trigger={(p) =>
          trigger === 'header' ? (
            <Button {...p} variant="ghost" size="sm" icon aria-label="Project options" title="Project options">
              <Icon name="more" size={16} />
            </Button>
          ) : (
            <Button {...p} variant="ghost" size="sm" icon className={sideMore} aria-label={`${project.name} options`}>
              <Icon name="more" size={14} />
            </Button>
          )
        }
      >
        {(close) => {
          const act = (fn: () => void) => () => {
            close()
            fn()
          }
          return (
            <>
              {admin && (
                <MenuItem icon="edit" onClick={act(onEdit)}>
                  Edit project…
                </MenuItem>
              )}
              {admin && onAddSub && !project.is_inbox && (
                <MenuItem icon="plus" onClick={act(onAddSub)}>
                  Add subproject…
                </MenuItem>
              )}
              {onShare && !project.is_inbox && (
                <MenuItem icon="users" end={project.shared ? 'Shared' : undefined} onClick={act(onShare)}>
                  {admin ? 'Share…' : 'Members…'}
                </MenuItem>
              )}
              {admin && (
                <MenuItem icon="star" onClick={act(() => save.mutate({ id: project.id, body: { favorite: !project.favorite } }))}>
                  {project.favorite ? 'Remove from favourites' : 'Add to favourites'}
                </MenuItem>
              )}
              {admin && !project.is_inbox && (
                <MenuItem
                  icon="album"
                  onClick={act(() =>
                    save.mutate(
                      { id: project.id, body: { archived: !project.archived } },
                      { onSuccess: () => toast.show(project.archived ? `Restored "${project.name}"` : `Archived "${project.name}"`) },
                    ),
                  )}
                >
                  {project.archived ? 'Unarchive' : 'Archive'}
                </MenuItem>
              )}
              {admin && !project.is_inbox && (
                <>
                  <MenuSeparator />
                  <MenuItem icon="trash" danger onClick={act(() => setConfirm(true))}>
                    Delete project…
                  </MenuItem>
                </>
              )}
              {!admin && (!onShare || project.is_inbox) && <MenuLabel>Only admins can change this project.</MenuLabel>}
            </>
          )
        }}
      </Menu>
      <Confirm
        open={confirm}
        title={`Delete "${project.name}"?`}
        body={`Its ${project.open_count ? `${project.open_count} open ` : ''}tasks and subprojects are deleted too. This can't be undone.`}
        onConfirm={() =>
          remove.mutate(project.id, {
            onSuccess: () => {
              toast.show('Project deleted')
              onDeleted()
            },
          })
        }
        onClose={() => setConfirm(false)}
      />
    </>
  )
}

interface SaveViewProps {
  open: boolean
  params: TaskQuery | null
  view?: SavedView | null
  position?: number
  onClose: () => void
  onSaved: (v: SavedView) => void
}

/** Save the current list's filters as a new view, or rename `view`. Each opening starts from the view's name. */
export function SaveViewDialog(props: SaveViewProps) {
  return <SaveViewForm key={useOpenCount(props.open)} {...props} />
}

function SaveViewForm({ open, params, view, position, onClose, onSaved }: SaveViewProps) {
  const save = useSaveView()
  const [name, setName] = useState(view?.name ?? '')
  const filters = viewFilters(params)
  const submit = () => {
    const n = name.trim()
    if (!n) return
    save.mutate(view ? { id: view.id, body: { name: n } } : { body: { name: n, filters, position: position ?? 0 } }, {
      onSuccess: (v) => {
        onClose()
        onSaved(v)
      },
    })
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={view ? 'Rename view' : 'Save view'}
      width="26rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={submit}>
            {view ? 'Save' : 'Save view'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus />
        </Field>
        {!view && (
          <p className="text-xs text-muted">
            Saves the current list, search, filters and sort:{' '}
            {Object.entries(filters)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ') || 'none'}
            .
          </p>
        )}
      </form>
    </Dialog>
  )
}

/** The list params worth storing in a saved view (no paging, no empties). */
export function viewFilters(params: TaskQuery | null): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(params ?? {}).filter(([k, v]) => v !== undefined && v !== '' && k !== 'limit')) as Record<
    string,
    string | number | boolean
  >
}
