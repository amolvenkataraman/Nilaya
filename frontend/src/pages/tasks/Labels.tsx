// Labels: the create/edit dialog and the sidebar menu (edit, delete), plus the tinted chip that shows a
// label on cards, in the table and in the dialog's preview.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { Button, ColourPicker, Confirm, Dialog, Field, Input, Menu, MenuItem, MenuSeparator } from '../../components/ui'
import type { Label } from '../../lib/types'
import { useDeleteLabel, useSaveLabel } from './api'
import { PROJECT_COLOURS } from './ProjectDialog'

/** A label's chip, tinted with its colour (`labelStyle`), neutral without one. */
export const labelChip =
  'inline-flex h-5 items-center gap-1 rounded-full px-1.75 text-xs whitespace-nowrap bg-[color-mix(in_srgb,var(--lc,var(--app-muted))_14%,transparent)] text-[color-mix(in_srgb,var(--lc,var(--app-muted))_82%,var(--app-fg))]'

/** The colour a tinted chip uses (falls back to the neutral chip). */
export function labelStyle(colour: string | undefined): CSSProperties | undefined {
  return colour ? ({ '--lc': colour } as CSSProperties) : undefined
}

/** A titled group of controls that isn't one field (colour swatches, a preview). */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.25">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  )
}

export function LabelDialog({ open, label, onClose }: { open: boolean; label: Label | null; onClose: () => void }) {
  const save = useSaveLabel()
  const [name, setName] = useState('')
  const [colour, setColour] = useState('')
  useEffect(() => {
    if (!open) return
    setName(label?.name ?? '')
    setColour(label?.colour ?? PROJECT_COLOURS[((Date.now() / 1000) | 0) % PROJECT_COLOURS.length])
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
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={submit}>
            {label ? 'Save' : 'Create label'}
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
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} autoFocus />
        </Field>
        <FieldGroup label="Colour">
          <ColourPicker value={colour || null} onChange={(c) => setColour(c ?? '')} colours={PROJECT_COLOURS} none="No colour" />
        </FieldGroup>
        <FieldGroup label="Preview">
          <span className="flex">
            <span className={labelChip} style={labelStyle(colour)}>
              <Icon name="tag" size={11} />
              {name.trim() || 'Label'}
            </span>
          </span>
        </FieldGroup>
      </form>
    </Dialog>
  )
}

/** The "…" button of a sidebar row: shown on hover (always on touch screens), and while its menu is open. */
export const sideMore =
  'absolute right-0.5 opacity-0 group-hover/side:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 touch:opacity-100'

export function LabelMenu({ label, onEdit, onDeleted }: { label: Label; onEdit: () => void; onDeleted: () => void }) {
  const remove = useDeleteLabel()
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <Menu
        align="end"
        label={`${label.name} options`}
        trigger={(p) => (
          <Button {...p} variant="ghost" size="sm" icon className={sideMore} aria-label={`${label.name} options`}>
            <Icon name="more" size={14} />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon="edit"
              onClick={() => {
                close()
                onEdit()
              }}
            >
              Edit label
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon="trash"
              danger
              onClick={() => {
                close()
                setConfirm(true)
              }}
            >
              Delete label
            </MenuItem>
          </>
        )}
      </Menu>
      <Confirm
        open={confirm}
        title={`Delete "${label.name}"?`}
        body="It's removed from every task. The tasks stay."
        onConfirm={() => remove.mutate(label.id, { onSuccess: onDeleted })}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}
