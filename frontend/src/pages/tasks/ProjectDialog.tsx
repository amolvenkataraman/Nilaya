// Project create/edit (name, description, colour, parent, default layout), the project options menu,
// and the saved-view dialog (save the current filters as a view, or rename one).
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, Menu, MenuItem } from '../../components/ui'
import { toast } from '../../components/toast'
import type { TaskQuery } from '../../lib/queries'
import type { Project, SavedView } from '../../lib/types'
import { useDeleteProject, useSaveProject, useSaveView } from './api'

export const PROJECT_COLOURS = ['#2563eb', '#0891b2', '#0f766e', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#64748b']
const LAYOUTS = [['list', 'List', 'list'], ['board', 'Board', 'board'], ['table', 'Table', 'layers'], ['calendar', 'Calendar', 'calendar']] as const

export function ProjectDialog({ open, project, parentId, projects, onClose, onCreated }: {
  open: boolean; project: Project | null; parentId?: string | null; projects?: Project[]; onClose: () => void; onCreated: (p: Project) => void
}) {
  const save = useSaveProject()
  const [name, setName] = useState('')
  const [colour, setColour] = useState(PROJECT_COLOURS[0])
  const [view, setView] = useState('list')
  const [description, setDescription] = useState('')
  const [parent, setParent] = useState('')
  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setColour(project ? project.colour : PROJECT_COLOURS[0])
    setView(project?.default_view || 'list')
    setDescription(project?.description ?? '')
    setParent(project?.parent_id ?? parentId ?? '')
  }, [open, project, parentId])
  // A project can't sit under itself or one of its own subprojects.
  const below = new Set<string>()
  if (project) {
    below.add(project.id)
    for (let grew = true; grew;) {
      grew = false
      for (const p of projects ?? []) if (p.parent_id && below.has(p.parent_id) && !below.has(p.id)) { below.add(p.id); grew = true }
    }
  }
  const parents = (projects ?? []).filter((p) => !p.is_inbox && p.role >= 2 && !below.has(p.id))
  const submit = () => {
    if (!name.trim()) return
    const body: Partial<Project> = { name: name.trim(), colour, default_view: view, description }
    if (!project?.is_inbox) body.parent_id = parent || null
    save.mutate({ id: project?.id, body }, { onSuccess: (p) => { onClose(); if (!project) onCreated(p); else toast.show('Project saved') } })
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : parentId ? 'New subproject' : 'New project'}
      width="28rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || save.isPending} onClick={submit}>{project ? 'Save' : 'Create project'}</button></>}
    >
      <form className="stack" style={{ gap: '0.75rem' }} onSubmit={(e) => (e.preventDefault(), submit())}>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={128} autoFocus /></label>
        <label className="field"><span>Description</span><textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></label>
        <div className="field">
          <span>Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Colour">
            <button type="button" role="radio" aria-checked={!colour} aria-label="No colour" className="swatch none" onClick={() => setColour('')}>{!colour && <Icon name="check" size={12} />}</button>
            {PROJECT_COLOURS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === colour} aria-label={c} className="swatch" style={{ background: c }} onClick={() => setColour(c)}>
                {c === colour && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>
        </div>
        {!project?.is_inbox && (
          <label className="field">
            <span>Parent project</span>
            <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">No parent</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <div className="field">
          <span>Default layout</span>
          <div className="seg" role="group" aria-label="Default layout">
            {LAYOUTS.map(([v, l, ic]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}><Icon name={ic} size={14} />{l}</button>)}
          </div>
        </div>
      </form>
    </Dialog>
  )
}

export function ProjectMenu({ project, onEdit, onDeleted, onShare, onAddSub, trigger }: {
  project: Project; onEdit: () => void; onDeleted: () => void; onShare?: () => void; onAddSub?: () => void
  trigger?: 'header'
}) {
  const save = useSaveProject()
  const remove = useDeleteProject()
  const [confirm, setConfirm] = useState(false)
  const admin = project.role >= 2
  return (
    <>
      <Menu align="end" label={`${project.name} options`} trigger={(p) => (
        trigger === 'header'
          ? <button {...p} className="btn ghost icon sm" aria-label="Project options" title="Project options"><Icon name="more" size={16} /></button>
          : <button {...p} className="btn ghost icon sm side-more" aria-label={`${project.name} options`}><Icon name="more" size={14} /></button>
      )}>
        {(close) => (
          <>
            {admin && <MenuItem icon="edit" onClick={() => (close(), onEdit())}>Edit project…</MenuItem>}
            {admin && onAddSub && !project.is_inbox && <MenuItem icon="plus" onClick={() => (close(), onAddSub())}>Add subproject…</MenuItem>}
            {onShare && !project.is_inbox && <MenuItem icon="users" end={project.shared ? 'Shared' : undefined} onClick={() => (close(), onShare())}>{admin ? 'Share…' : 'Members…'}</MenuItem>}
            {admin && <MenuItem icon="star" onClick={() => (close(), save.mutate({ id: project.id, body: { favorite: !project.favorite } }))}>{project.favorite ? 'Remove from favourites' : 'Add to favourites'}</MenuItem>}
            {admin && !project.is_inbox && (
              <MenuItem icon="album" onClick={() => (close(), save.mutate({ id: project.id, body: { archived: !project.archived } }, { onSuccess: () => toast.show(project.archived ? `Restored "${project.name}"` : `Archived "${project.name}"`) }))}>
                {project.archived ? 'Unarchive' : 'Archive'}
              </MenuItem>
            )}
            {admin && !project.is_inbox && (
              <>
                <div className="menu-sep" />
                <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete project…</MenuItem>
              </>
            )}
            {!admin && (!onShare || project.is_inbox) && <div className="menu-label">Only admins can change this project.</div>}
          </>
        )}
      </Menu>
      <Confirm
        open={confirm}
        title={`Delete "${project.name}"?`}
        body={`Its ${project.open_count ? `${project.open_count} open ` : ''}tasks and subprojects are deleted too. This can't be undone.`}
        onConfirm={() => remove.mutate(project.id, { onSuccess: () => (toast.show('Project deleted'), onDeleted()) })}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}

/** Save the current list's filters as a new view, or rename `view`. */
export function SaveViewDialog({ open, params, view, position, onClose, onSaved }: {
  open: boolean; params: TaskQuery | null; view?: SavedView | null; position?: number; onClose: () => void; onSaved: (v: SavedView) => void
}) {
  const save = useSaveView()
  const [name, setName] = useState('')
  useEffect(() => { if (open) setName(view?.name ?? '') }, [open, view])
  const filters = viewFilters(params)
  const submit = () => {
    const n = name.trim()
    if (!n) return
    save.mutate(view ? { id: view.id, body: { name: n } } : { body: { name: n, filters, position: position ?? 0 } }, { onSuccess: (v) => (onClose(), onSaved(v)) })
  }
  return (
    <Dialog open={open} onClose={onClose} title={view ? 'Rename view' : 'Save view'} width="26rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || save.isPending} onClick={submit}>{view ? 'Save' : 'Save view'}</button></>}>
      <form onSubmit={(e) => (e.preventDefault(), submit())} className="stack">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus /></label>
        {!view && <p className="help">Saves the current list, search, filters and sort: {Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}.</p>}
      </form>
    </Dialog>
  )
}

/** The list params worth storing in a saved view (no paging, no empties). */
export function viewFilters(params: TaskQuery | null): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(params ?? {}).filter(([k, v]) => v !== undefined && v !== '' && k !== 'limit')) as Record<string, string | number | boolean>
}
