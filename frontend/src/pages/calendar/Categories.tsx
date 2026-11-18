// Event categories (yours): name, colour, icon and order. GET/POST /calendar/categories,
// PATCH/DELETE /calendar/categories/{id}. "Uncategorized" can be renamed but not deleted.
import { useState, type CSSProperties } from 'react'
import { Icon, type IconName, asIcon } from '../../components/Icon'
import { Button, Confirm, Dialog, Field, Input, QueryView, SkeletonRows } from '../../components/ui'
import { useCategories } from '../../lib/queries'
import type { Category } from '../../lib/types'
import { useCalendarIcons, useCategoryMutations, type CategoryPatch } from './api'
import { ColourChoice } from './ColourChoice'
import { dot } from './chips'
import { IconPicker } from './IconPicker'

export function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const cats = useCategories()
  const icons = useCalendarIcons().data ?? []
  const [edit, setEdit] = useState<number | 'new' | null>(null)
  const [removing, setRemoving] = useState<Category | null>(null)
  const { save, remove, swap } = useCategoryMutations()
  const list = (cats.data ?? []).slice().sort((a, b) => a.position - b.position || a.id - b.id)
  const move = (i: number, dir: -1 | 1) => {
    const a = list[i]
    const b = list[i + dir]
    if (a && b) swap.mutate({ a, b, pa: a.position === b.position ? b.position + dir : b.position })
  }
  const saveAndClose = (body: CategoryPatch, id?: number) => save.mutate({ id, body }, { onSuccess: () => setEdit(null) })
  const iconButton = (label: string, title: string, icon: IconName, onClick: () => void, disabled = false) => (
    <Button
      variant="ghost"
      size="sm"
      icon
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className="disabled:opacity-30!"
    >
      <Icon name={icon} size={14} />
    </Button>
  )
  return (
    <Dialog
      open
      onClose={onClose}
      title="Event categories"
      width="32rem"
      footer={
        <>
          <Button size="sm" onClick={() => setEdit('new')} disabled={edit === 'new'}>
            <Icon name="plus" size={14} />
            New category
          </Button>
          <span className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <p className="text-xs text-muted">
        Categories group events for insights and availability (meetings, work and study show as busy). Colour and icon are used when an
        event has none of its own.
      </p>
      <QueryView query={cats} skeleton={<SkeletonRows rows={5} />}>
        {() => (
          <ul className="mt-2 grid gap-px">
            {edit === 'new' && (
              <li>
                <CategoryForm icons={icons} busy={save.isPending} onCancel={() => setEdit(null)} onSave={(body) => saveAndClose(body)} />
              </li>
            )}
            {list.map((c, i) =>
              edit === c.id ? (
                <li key={c.id}>
                  <CategoryForm
                    cat={c}
                    icons={icons}
                    busy={save.isPending}
                    onCancel={() => setEdit(null)}
                    onSave={(body) => saveAndClose(body, c.id)}
                  />
                </li>
              ) : (
                <li key={c.id} className="flex min-h-9 items-center gap-1.5 rounded-sm px-1 text-sm hover:bg-hover">
                  <span
                    className="grid size-6 flex-none place-items-center rounded-[30%] bg-[color-mix(in_srgb,var(--c)_14%,var(--app-surface))] text-(--c)"
                    style={{ '--c': c.colour || 'var(--app-muted)' } as CSSProperties}
                  >
                    {c.icon ? <Icon name={asIcon(c.icon)} size={13} /> : <span className={`${dot} bg-(--c)`} />}
                  </span>
                  <span className="min-w-0 flex-auto truncate">
                    {c.name}
                    {c.legacy_id === 0 && <span className="text-xs text-muted"> · default</span>}
                  </span>
                  {iconButton(`Move ${c.name} up`, 'Move up', 'chevronUp', () => move(i, -1), i === 0)}
                  {iconButton(`Move ${c.name} down`, 'Move down', 'chevronDown', () => move(i, 1), i === list.length - 1)}
                  {iconButton(`Edit ${c.name}`, 'Edit', 'edit', () => setEdit(c.id))}
                  {c.legacy_id !== 0 && iconButton(`Delete ${c.name}`, 'Delete', 'trash', () => setRemoving(c))}
                </li>
              ),
            )}
          </ul>
        )}
      </QueryView>
      <Confirm
        open={!!removing}
        title={`Delete "${removing?.name}"?`}
        body="Its events become Uncategorized."
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </Dialog>
  )
}

function CategoryForm({
  cat,
  icons,
  busy,
  onSave,
  onCancel,
}: {
  cat?: Category
  icons: string[]
  busy: boolean
  onSave: (b: CategoryPatch) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(cat?.name ?? '')
  const [colour, setColour] = useState(cat?.colour ?? '')
  const [icon, setIcon] = useState(cat?.icon ?? '')
  const submit = () => name.trim() && onSave({ name: name.trim(), colour, icon })
  return (
    <form
      className="my-1 grid gap-2.5 rounded-md border border-border bg-bg p-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onCancel()
      }}
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus required />
      </Field>
      <div className="grid gap-1.25">
        <span className="text-xs font-medium text-muted">Colour</span>
        <ColourChoice value={colour} onChange={setColour} none="Calendar colour" />
      </div>
      <div className="grid gap-1.25">
        <span className="text-xs font-medium text-muted">Icon</span>
        <IconPicker value={icon} onChange={setIcon} icons={icons} none="None" size="sm" />
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || busy}>
          {cat ? 'Save' : 'Add category'}
        </Button>
      </div>
    </form>
  )
}
