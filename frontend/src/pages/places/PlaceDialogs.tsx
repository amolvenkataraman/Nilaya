// Places' dialogs: add or edit a place, create or edit a group, and import places from a file (a dry run previews
// what would be added as soon as a file and a group are picked).
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, Confirm, Dialog, Field, FieldRow, Input, Select, Switch, Textarea } from '../../components/ui'
import {
  type Group,
  type ImportResult,
  importPlaces,
  type Place,
  type PlaceCategory,
  type PlaceInput,
  STATUSES,
  stars,
  useDeleteGroup,
  useDeletePlace,
  useSaveGroup,
  useSavePlace,
} from './api'

export type Draft = Partial<PlaceInput> & { id?: string }

const form = 'grid gap-3'
const help = 'text-xs text-muted'
const err = 'text-xs text-danger'

export function PlaceDialog({
  draft,
  groups,
  categories,
  onClose,
  onSaved,
  onDeleted,
}: {
  draft: Draft
  groups: Group[]
  categories: PlaceCategory[]
  onClose: () => void
  onSaved: (p: Place) => void
  onDeleted: () => void
}) {
  const [f, setF] = useState(() => ({
    name: draft.name ?? '',
    group_id: String(draft.group_id ?? groups[0]?.id ?? ''),
    category: draft.category ?? 'other',
    latitude: draft.latitude != null ? String(+draft.latitude.toFixed(6)) : '',
    longitude: draft.longitude != null ? String(+draft.longitude.toFixed(6)) : '',
    address: draft.address ?? '',
    description: draft.description ?? '',
    notes: draft.notes ?? '',
    rating: String(draft.rating ?? ''),
    status: draft.status ?? 'saved',
    visited_on: draft.visited_on ?? '',
  }))
  const [confirm, setConfirm] = useState(false)
  const save = useSavePlace()
  const remove = useDeletePlace()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const lat = Number(f.latitude)
  const lon = Number(f.longitude)
  const latOk = f.latitude.trim() !== '' && Number.isFinite(lat) && lat >= -90 && lat <= 90
  const lonOk = f.longitude.trim() !== '' && Number.isFinite(lon) && lon >= -180 && lon <= 180
  const valid = f.name.trim() && f.group_id && latOk && lonOk
  const editing = !!draft.id

  const submit = () => {
    if (!valid) return
    const body: Partial<PlaceInput> = {
      name: f.name.trim(),
      group_id: Number(f.group_id),
      category: f.category,
      latitude: lat,
      longitude: lon,
      address: f.address.trim() || null,
      description: f.description.trim(),
      notes: f.notes.trim(),
      rating: f.rating ? Number(f.rating) : editing ? 0 : null,
      status: f.status,
    }
    // Visited with no date: leave it to the server (keeps the old date, or today for a new visit).
    if (f.status !== 'visited') body.visited_on = null
    else if (f.visited_on) body.visited_on = f.visited_on
    save.mutate(
      { id: draft.id, body },
      {
        onSuccess: (p) => {
          onSaved(p)
          onClose()
        },
      },
    )
  }

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={editing ? 'Edit place' : 'New place'}
        width="34rem"
        footer={
          <>
            {editing && (
              <Button variant="danger" onClick={() => setConfirm(true)}>
                <Icon name="trash" size={14} />
                Delete
              </Button>
            )}
            <span className="flex-1" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!valid || save.isPending} onClick={submit}>
              {editing ? 'Save' : 'Add place'}
            </Button>
          </>
        }
      >
        <form
          className={form}
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="Name">
            <Input value={f.name} onChange={set('name')} maxLength={200} required autoFocus placeholder="e.g. Lazeez" />
          </Field>
          <FieldRow>
            <Field label="Category">
              <Select value={f.category} onChange={set('category')}>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Group">
              <Select value={f.group_id} onChange={set('group_id')}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Status">
              <Select value={f.status} onChange={set('status')}>
                {STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            {f.status === 'visited' && (
              <Field label="Visited on">
                <Input type="date" value={f.visited_on} onChange={set('visited_on')} />
              </Field>
            )}
            <Field label="Rating">
              <Select value={f.rating} onChange={set('rating')}>
                <option value="">No rating</option>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {stars(n)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Field label="Address">
            <Input value={f.address} onChange={set('address')} maxLength={300} />
          </Field>
          <FieldRow>
            <Field label="Latitude" error={!latOk && f.latitude !== '' ? 'Between -90 and 90' : null}>
              <Input
                className="tabular-nums"
                inputMode="decimal"
                value={f.latitude}
                onChange={set('latitude')}
                aria-invalid={!latOk && f.latitude !== ''}
              />
            </Field>
            <Field label="Longitude" error={!lonOk && f.longitude !== '' ? 'Between -180 and 180' : null}>
              <Input
                className="tabular-nums"
                inputMode="decimal"
                value={f.longitude}
                onChange={set('longitude')}
                aria-invalid={!lonOk && f.longitude !== ''}
              />
            </Field>
          </FieldRow>
          {(f.latitude === '' || f.longitude === '') && (
            <p className={help}>Tip: close this and click the map to fill in the coordinates.</p>
          )}
          <Field label="Description">
            <Input value={f.description} onChange={set('description')} maxLength={500} />
          </Field>
          <Field label="Notes">
            <Textarea value={f.notes} onChange={set('notes')} rows={3} maxLength={2000} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Dialog>
      <Confirm
        open={confirm}
        title={`Delete "${draft.name}"?`}
        body="This place will be removed from its group."
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          remove.mutate(draft as Place, {
            onSuccess: () => {
              onDeleted()
              onClose()
            },
          })
        }
      />
    </>
  )
}

export function GroupDialog({
  group,
  onClose,
  onDeleted,
  onCreated,
}: {
  group: Partial<Group>
  onClose: () => void
  onDeleted: (id: number) => void
  onCreated: (g: Group) => void
}) {
  const [name, setName] = useState(group.name ?? '')
  const [description, setDescription] = useState(group.description ?? '')
  const [isPublic, setPublic] = useState(!!group.is_public)
  const [confirm, setConfirm] = useState(false)
  const save = useSaveGroup()
  const remove = useDeleteGroup()
  const editing = group.id != null
  const submit = () => {
    if (!name.trim()) return
    save.mutate(
      { id: group.id, body: { name: name.trim(), description: description.trim(), is_public: isPublic } },
      {
        onSuccess: (g) => {
          onClose()
          if (!editing) onCreated(g)
        },
      },
    )
  }
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={editing ? 'Edit group' : 'New group'}
        width="28rem"
        footer={
          <>
            {editing && (
              <Button variant="danger" onClick={() => setConfirm(true)}>
                <Icon name="trash" size={14} />
                Delete
              </Button>
            )}
            <span className="flex-1" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={submit}>
              {editing ? 'Save' : 'Create group'}
            </Button>
          </>
        }
      >
        <form
          className={form}
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {!editing && <p className={help}>Places live in groups, for example "Favourites" or "Food".</p>}
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
          <Switch checked={isPublic} onChange={setPublic} label="Visible to everyone on this server" />
          <button type="submit" hidden />
        </form>
      </Dialog>
      <Confirm
        open={confirm}
        title={`Delete "${group.name}"?`}
        body={`This also deletes the ${group.count ?? 0} ${group.count === 1 ? 'place' : 'places'} in it.`}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          remove.mutate(group as Group, {
            onSuccess: () => {
              if (group.id != null) onDeleted(group.id)
              onClose()
            },
          })
        }
      />
    </>
  )
}

export function ImportDialog({ groups, onClose, onDone }: { groups: Group[]; onClose: () => void; onDone: (groupId: number) => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [group, setGroup] = useState(groups[0]?.id ?? 0)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (dry: boolean, f = file, g = group) => {
    if (!f || !g) return
    if (f.size > 5 * 1024 * 1024) return setError('This file is over 5 MB.')
    setBusy(true)
    setError('')
    try {
      const r = await importPlaces(f, g, dry)
      if (dry) setPreview(r)
      else {
        toast.show(`Imported ${r.created} place${r.created === 1 ? '' : 's'}`)
        qc.invalidateQueries({ queryKey: ['places'] })
        onClose()
        onDone(g)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // Preview as soon as a file and a group are picked (a dry run: nothing is saved). Run from the change handlers
  // with the new values, so there's no effect racing the state it reads.
  const pick = (f: File | null, g: number) => {
    setPreview(null)
    setError('')
    void run(true, f, g)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Import places"
      width="30rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!preview?.new || busy} onClick={() => run(false)}>
            {preview ? `Import ${preview.new}` : 'Import'}
          </Button>
        </>
      }
    >
      <p className={help}>GeoJSON, KML/KMZ, GPX, Google Takeout (Saved places) or CSV, up to 5 MB. Duplicates are skipped.</p>
      <Field label="File">
        <Input
          type="file"
          accept=".json,.geojson,.kml,.kmz,.gpx,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            pick(f, group)
          }}
        />
      </Field>
      <Field label="Into group">
        <Select
          value={group}
          onChange={(e) => {
            const g = Number(e.target.value)
            setGroup(g)
            pick(file, g)
          }}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      {file && !preview && (
        <Button size="sm" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Reading…' : 'Preview'}
        </Button>
      )}
      {preview && (
        <div className="grid gap-1 rounded-sm bg-surface-2 px-3 py-2 text-sm">
          <span>
            <strong>{preview.format}</strong> file: {preview.found} found · <strong>{preview.new} new</strong> · {preview.duplicates}{' '}
            duplicates
            {preview.invalid ? ` · ${preview.invalid} invalid` : ''}
          </span>
          {preview.sample.length > 0 && (
            <div className="text-xs text-muted">
              {preview.sample.join(', ')}
              {preview.new > preview.sample.length ? '…' : ''}
            </div>
          )}
        </div>
      )}
      {error && (
        <p className={err} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
