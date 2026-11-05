// Label management from the sidebar: create, rename, recolour, delete.
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, Menu, MenuItem } from '../../components/ui'
import type { Label } from '../../lib/types'
import { useDeleteLabel, useSaveLabel } from './api'
import { PROJECT_COLOURS } from './ProjectDialog'

export function LabelDialog({ open, label, onClose }: { open: boolean; label: Label | null; onClose: () => void }) {
  const save = useSaveLabel()
  const [name, setName] = useState('')
  const [colour, setColour] = useState('')
  useEffect(() => {
    if (!open) return
    setName(label?.name ?? '')
    setColour(label?.colour ?? PROJECT_COLOURS[(Date.now() / 1000 | 0) % PROJECT_COLOURS.length])
  }, [open, label])
  const submit = () => {
    const n = name.trim()
    if (!n) return
    save.mutate({ id: label?.id, body: { name: n, colour } }, { onSuccess: onClose })
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={label ? 'Edit label' : 'New label'}
      width="24rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || save.isPending} onClick={submit}>{label ? 'Save' : 'Create label'}</button></>}
    >
      <form className="stack" style={{ gap: '0.75rem' }} onSubmit={(e) => (e.preventDefault(), submit())}>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} autoFocus /></label>
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
        <div className="field">
          <span>Preview</span>
          <span className="label-preview"><span className="label-chip" style={labelStyle(colour)}><Icon name="tag" size={11} />{name.trim() || 'Label'}</span></span>
        </div>
      </form>
    </Dialog>
  )
}

export function LabelMenu({ label, onEdit, onDeleted }: { label: Label; onEdit: () => void; onDeleted: () => void }) {
  const remove = useDeleteLabel()
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <Menu align="end" label={`${label.name} options`} trigger={(p) => (
        <button {...p} className="btn ghost icon sm side-more" aria-label={`${label.name} options`}><Icon name="more" size={14} /></button>
      )}>
        {(close) => (
          <>
            <MenuItem icon="edit" onClick={() => (close(), onEdit())}>Edit label</MenuItem>
            <div className="menu-sep" />
            <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete label</MenuItem>
          </>
        )}
      </Menu>
      <Confirm open={confirm} title={`Delete "${label.name}"?`} body="It's removed from every task. The tasks stay." onConfirm={() => remove.mutate(label.id, { onSuccess: onDeleted })} onClose={() => setConfirm(false)} />
    </>
  )
}

/** Tinted chip colours for a label (falls back to the neutral chip). */
export function labelStyle(colour: string | undefined): React.CSSProperties | undefined {
  return colour ? ({ '--lc': colour } as React.CSSProperties) : undefined
}
