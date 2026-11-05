import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, Menu, MenuItem } from '../../components/ui'
import { toast } from '../../components/toast'
import type { TaskQuery } from '../../lib/queries'
import type { Project, SavedView } from '../../lib/types'
import { useDeleteProject, useSaveProject, useSaveView } from './api'

export const PROJECT_COLOURS = ['#2563eb', '#0891b2', '#0f766e', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#64748b']

export function ProjectDialog({ open, project, onClose, onCreated }: {
  open: boolean; project: Project | null; onClose: () => void; onCreated: (p: Project) => void
}) {
  const save = useSaveProject()
  const [name, setName] = useState('')
  const [colour, setColour] = useState(PROJECT_COLOURS[0])
  const [view, setView] = useState('list')
  const [description, setDescription] = useState('')
  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setColour(project?.colour || PROJECT_COLOURS[0])
    setView(project?.default_view === 'board' ? 'board' : 'list')
    setDescription(project?.description ?? '')
  }, [open, project])
  const submit = () => {
    if (!name.trim()) return
    save.mutate(
      { id: project?.id, body: { name: name.trim(), colour, default_view: view, description } },
      { onSuccess: (p) => { onClose(); if (!project) onCreated(p) } },
    )
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
      width="28rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || save.isPending} onClick={submit}>{project ? 'Save' : 'Create project'}</button></>}
    >
      <form className="stack" style={{ gap: '0.75rem' }} onSubmit={(e) => (e.preventDefault(), submit())}>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={128} autoFocus /></label>
        <label className="field"><span>Description</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></label>
        <div className="field">
          <span>Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {PROJECT_COLOURS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === colour} aria-label={c} className="swatch" style={{ background: c }} onClick={() => setColour(c)}>
                {c === colour && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Default layout</span>
          <div className="seg" role="group">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list" size={14} />List</button>
            <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name="board" size={14} />Board</button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

export function ProjectMenu({ project, onEdit, onDeleted }: { project: Project; onEdit: () => void; onDeleted: () => void }) {
  const save = useSaveProject()
  const remove = useDeleteProject()
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <Menu align="end" label={`${project.name} options`} trigger={(p) => (
        <button {...p} className="btn ghost icon sm side-more" aria-label={`${project.name} options`}><Icon name="more" size={14} /></button>
      )}>
        {(close) => (
          <>
            <MenuItem icon="edit" onClick={() => (close(), onEdit())}>Edit project</MenuItem>
            <MenuItem icon="star" onClick={() => (close(), save.mutate({ id: project.id, body: { favorite: !project.favorite } }))}>{project.favorite ? 'Remove from favourites' : 'Add to favourites'}</MenuItem>
            <MenuItem icon="album" onClick={() => (close(), save.mutate({ id: project.id, body: { archived: !project.archived } }, { onSuccess: () => toast.show(project.archived ? `Restored "${project.name}"` : `Archived "${project.name}"`) }))}>
              {project.archived ? 'Unarchive' : 'Archive'}
            </MenuItem>
            {project.role >= 2 && (
              <>
                <div className="menu-sep" />
                <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete project</MenuItem>
              </>
            )}
          </>
        )}
      </Menu>
      <Confirm
        open={confirm}
        title={`Delete "${project.name}"?`}
        body="Its tasks are deleted too. This can't be undone."
        onConfirm={() => remove.mutate(project.id, { onSuccess: onDeleted })}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}

export function SaveViewDialog({ open, params, onClose, onSaved }: { open: boolean; params: TaskQuery | null; onClose: () => void; onSaved: (v: SavedView) => void }) {
  const save = useSaveView()
  const [name, setName] = useState('')
  useEffect(() => { if (open) setName('') }, [open])
  const filters = Object.fromEntries(Object.entries(params ?? {}).filter(([k, v]) => v !== undefined && k !== 'limit'))
  const submit = () => name.trim() && save.mutate({ name: name.trim(), filters }, { onSuccess: (v) => (onClose(), onSaved(v)) })
  return (
    <Dialog open={open} onClose={onClose} title="Save view" width="26rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={submit}>Save view</button></>}>
      <form onSubmit={(e) => (e.preventDefault(), submit())} className="stack">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus /></label>
        <p className="help">Saves the current list's filters: {Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}.</p>
      </form>
    </Dialog>
  )
}
