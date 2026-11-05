import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, ErrorBox, SkeletonRows, Switch, useDebounced } from '../../components/ui'
import type { PlaceCategory, PlaceGroup } from '../../lib/types'
import {
  STATUSES, importPlaces, useAllPlaces, useDeleteGroup, useDeletePlace, usePlaceCategories, usePlaceGroups, useSaveGroup, useSavePlace, useSuggestions,
  type ImportResult, type Place, type PlaceInput, type PlaceStatus,
} from './api'
import { PlaceDetail, PlaceRow, StatsTab, SuggestedTab, type Tab } from './PlacePanel'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { PlaceMap } from './PlaceMap'
import './places.css'

type Draft = Partial<PlaceInput> & { id?: string }

export default function PlacesPage() {
  const [params, setParams] = useSearchParams()
  const groupId = Number(params.get('group')) || undefined
  const category = params.get('category') || undefined
  const statusRaw = params.get('status') as PlaceStatus | null
  const status = STATUSES.some((s) => s.key === statusRaw) ? statusRaw! : undefined
  const minRating = Number(params.get('rating')) || 0
  const selected = params.get('place')
  const tab = (['places', 'suggested', 'stats'].includes(params.get('tab') ?? '') ? params.get('tab') : 'places') as Tab
  const [text, setText] = useState(params.get('q') ?? '')
  const q = useDebounced(text.trim().toLowerCase(), 250)
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null)

  const groups = usePlaceGroups()
  const cats = usePlaceCategories()
  const all = useAllPlaces()
  const suggestions = useSuggestions(tab === 'suggested')
  const mineGroups = useMemo(() => (groups.data ?? []).filter((g) => g.mine), [groups.data])
  const catLabel = useMemo(() => {
    const m = new Map((cats.data ?? []).map((c) => [c.key, c.label]))
    return (k: string) => m.get(k) ?? k
  }, [cats.data])
  const groupName = (id: number) => groups.data?.find((g) => g.id === id)?.name ?? ''
  const canEdit = (p: Place) => mineGroups.some((g) => g.id === p.group_id)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [groupDraft, setGroupDraft] = useState<Partial<PlaceGroup> | null>(null)
  const [importing, setImporting] = useState(false)

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: k === 'place' || k === 'q' || k === 'tab' })
  }

  const newPlace = (lat?: number, lon?: number, extra: Partial<Draft> = {}) => {
    if (!mineGroups.length) {
      setGroupDraft({ name: '', description: '', is_public: false })
      return
    }
    setDraft({
      name: '', group_id: groupId && mineGroups.some((g) => g.id === groupId) ? groupId : mineGroups[0].id,
      category: category ?? 'other', latitude: lat, longitude: lon, address: '', description: '', notes: '', rating: null, status: 'saved', ...extra,
    })
  }

  // "New place" from the global create menu: /places?new=1
  useEffect(() => {
    if (params.get('new') === '1' && groups.data) {
      setParam('new', null)
      newPlace()
    }
  }, [params, groups.data])

  // One request for every place; filters, search and counts happen here.
  const everything = all.data ?? []
  const inGroup = groupId ? everything.filter((p) => p.group_id === groupId) : everything
  const places = useMemo(() => inGroup.filter((p) =>
    (!category || p.category === category) && (!status || (p.status ?? 'saved') === status) && (!minRating || (p.rating ?? 0) >= minRating) &&
    (!q || [p.name, p.address, p.description, p.notes].some((t) => t?.toLowerCase().includes(q)))), [inGroup, category, status, minRating, q])
  const count = (fn: (p: Place) => boolean) => inGroup.filter(fn).length
  const filtered = !!(groupId || category || status || q || minRating)
  const sel = everything.find((p) => p.id === selected) ?? null

  const locate = () => {
    if (!navigator.geolocation) return toast.error("This browser can't share its location.")
    navigator.geolocation.getCurrentPosition(
      (g) => (setPos({ lat: g.coords.latitude, lon: g.coords.longitude }), toast.show('Distances are from your current location')),
      () => toast.error("Couldn't get your location."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }

  const sidebar = (
    <>
      <SideSection>
        <SideItem icon="map" label="All places" count={inGroup.length} active={!category && !status && !minRating} onClick={() => setParams(groupId ? new URLSearchParams({ group: String(groupId) }) : new URLSearchParams())} />
        {STATUSES.map((s) => (
          <SideItem key={s.key} icon={s.icon} label={s.label} count={count((p) => (p.status ?? 'saved') === s.key)} active={status === s.key} onClick={() => setParam('status', status === s.key ? null : s.key)} />
        ))}
      </SideSection>
      <SideSection title="Rating">
        <div className="pl-rating-filter" role="group" aria-label="Minimum rating">
          {[0, 3, 4, 5].map((r) => (
            <button key={r} className="chip" aria-pressed={minRating === r} onClick={() => setParam('rating', r ? String(r) : null)}>
              {r ? `${r}★${r < 5 ? '+' : ''}` : 'Any'}<span className="muted">{r ? count((p) => (p.rating ?? 0) >= r) : inGroup.length}</span>
            </button>
          ))}
        </div>
      </SideSection>
      <SideSection
        title="Groups"
        action={
          <span className="row" style={{ gap: 0 }}>
            <button className="btn ghost icon sm" onClick={() => setImporting(true)} aria-label="Import places" title="Import (GeoJSON, KML, GPX, Google Takeout, CSV)"><Icon name="arrowDown" size={14} /></button>
            <button className="btn ghost icon sm" onClick={() => setGroupDraft({ name: '', description: '', is_public: false })} aria-label="New group" title="New group"><Icon name="plus" size={14} /></button>
          </span>
        }
      >
        {groups.isPending ? <SkeletonRows rows={2} /> : (groups.data ?? []).map((g) => (
          <div key={g.id} className="pl-side-row">
            <SideItem icon={g.is_public ? 'users' : 'folder'} label={<>{g.name}{g.is_public && <span className="chip pl-pub">Public</span>}{!g.mine && <span className="chip pl-pub">Shared</span>}</>} count={g.count} active={groupId === g.id} onClick={() => setParam('group', groupId === g.id ? null : String(g.id))} />
            <span className="pl-side-acts">
              <a className="btn ghost icon sm" href={`/api/v2/places/groups/${g.id}/export`} download aria-label={`Export ${g.name} as GeoJSON`} title="Export GeoJSON"><Icon name="arrowUp" size={13} /></a>
              {g.mine && <button className="btn ghost icon sm" onClick={() => setGroupDraft(g)} aria-label={`Edit group ${g.name}`} title="Edit group"><Icon name="edit" size={13} /></button>}
            </span>
          </div>
        ))}
      </SideSection>
      <SideSection title="Categories">
        {(cats.data ?? []).map((c) => ({ c, n: count((p) => p.category === c.key) })).sort((a, b) => b.n - a.n).map(({ c, n }) => (
          <SideItem key={c.key} icon="tag" label={c.label} count={n || undefined} active={category === c.key} onClick={() => setParam('category', category === c.key ? null : c.key)} />
        ))}
      </SideSection>
    </>
  )

  return (
    <AppShell
      app="places"
      fullHeight
      topbar={
        <>
          <form className="pl-search" role="search" onSubmit={(e) => e.preventDefault()}>
            <Icon name="search" />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search names, addresses, notes" aria-label="Search places" maxLength={100} />
            {text && (
              <button type="button" className="btn ghost icon sm" onClick={() => setText('')} aria-label="Clear search">
                <Icon name="x" size={14} />
              </button>
            )}
          </form>
          <button className="btn pl-locate" onClick={locate} title="Show distances from your location"><Icon name="location" size={15} /><span>Near me</span></button>
          <button className="btn primary pl-new" onClick={() => newPlace()}>
            <Icon name="plus" size={15} />
            <span>New place</span>
          </button>
        </>
      }
      sidebar={sidebar}
    >
      <div className="pl-layout">
        <div className="pl-map-wrap">
          <PlaceMap
            places={places}
            selected={selected}
            categoryLabel={catLabel}
            canEdit={canEdit}
            onSelect={(id) => setParam('place', id)}
            onEdit={(p) => setDraft({ ...p })}
            onAddAt={(lat, lon) => newPlace(lat, lon)}
            suggestions={tab === 'suggested' ? suggestions.data : undefined}
            onSuggestion={(sg) => newPlace(sg.latitude, sg.longitude, { name: sg.name, address: sg.address, status: 'visited' })}
          />
          <p className="pl-hint">Click the map to add a place</p>
        </div>
        <section className="pl-list" aria-label="Places">
          {sel ? (
            <PlaceDetail p={sel} catLabel={catLabel} group={groups.data?.find((g) => g.id === sel.group_id)} canEdit={canEdit(sel)} pos={pos}
              onEdit={() => setDraft({ ...sel })} onClose={() => setParam('place', null)} />
          ) : (
            <>
              <div className="tabs pl-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'places'} onClick={() => setParam('tab', null)}>Places <span className="muted">{places.length}</span></button>
                <button role="tab" aria-selected={tab === 'suggested'} onClick={() => setParam('tab', 'suggested')}>Suggested</button>
                <button role="tab" aria-selected={tab === 'stats'} onClick={() => setParam('tab', 'stats')}>Stats</button>
              </div>
              {tab === 'suggested' ? (
                <SuggestedTab onSave={(sg) => newPlace(sg.latitude, sg.longitude, { name: sg.name, address: sg.address, status: 'visited' })} onFocus={() => {}} />
              ) : tab === 'stats' ? (
                <StatsTab onSelect={(id) => setParam('place', id)} catLabel={catLabel} />
              ) : (
                <>
                  {filtered && (
                    <div className="pl-list-head">
                      <h2 className="muted small">{places.length} of {everything.length} shown</h2>
                      <button className="btn ghost sm" onClick={() => (setText(''), setParams(new URLSearchParams()))}>Clear filters</button>
                    </div>
                  )}
                  {all.isPending ? <SkeletonRows rows={6} /> : all.isError && !all.data ? <ErrorBox error={all.error} retry={() => all.refetch()} /> : !places.length ? (
                    <div className="empty left">{filtered ? 'No places match.' : 'No places yet. Click the map, import a file, or save a suggestion.'}</div>
                  ) : (
                    <ul className="pl-items">
                      {places.map((p) => (
                        <li key={p.id} className="pl-item">
                          <PlaceRow p={p} active={selected === p.id} onSelect={() => setParam('place', p.id)} catLabel={catLabel} groupName={groupName} pos={pos} />
                          {canEdit(p) && (
                            <button className="btn ghost icon sm pl-item-edit" onClick={() => setDraft({ ...p })} aria-label={`Edit ${p.name}`} title="Edit">
                              <Icon name="edit" size={14} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
      {draft && <PlaceDialog draft={draft} groups={mineGroups} categories={cats.data ?? []} onClose={() => setDraft(null)} onSaved={(p) => setParam('place', p.id)} onDeleted={() => setParam('place', null)} />}
      {groupDraft && <GroupDialog group={groupDraft} onClose={() => setGroupDraft(null)} onDeleted={(id) => groupId === id && setParam('group', null)} />}
      {importing && <ImportDialog groups={mineGroups} onClose={() => setImporting(false)} />}
    </AppShell>
  )
}

function ImportDialog({ groups, onClose }: { groups: PlaceGroup[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [group, setGroup] = useState(groups[0]?.id ?? 0)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (dry: boolean) => {
    if (!file || !group) return
    if (file.size > 5 * 1024 * 1024) return setError('This file is over 5 MB.')
    setBusy(true)
    setError('')
    try {
      const r = await importPlaces(file, group, dry)
      if (dry) setPreview(r)
      else {
        toast.show(`Imported ${r.created} place${r.created === 1 ? '' : 's'}`)
        qc.invalidateQueries({ queryKey: ['places'] })
        onClose()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} title="Import places" width="30rem"
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!preview || !preview.new || busy} onClick={() => run(false)}>{preview ? `Import ${preview.new}` : 'Import'}</button></>}>
      <p className="help">GeoJSON, KML/KMZ, GPX, Google Takeout (Saved places) or CSV, up to 5 MB. Duplicates are skipped.</p>
      <label className="field"><span>File</span><input className="input" type="file" accept=".json,.geojson,.kml,.kmz,.gpx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null) }} /></label>
      <label className="field"><span>Into group</span>
        <select className="select" value={group} onChange={(e) => { setGroup(Number(e.target.value)); setPreview(null) }}>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      {file && !preview && <button className="btn sm" onClick={() => run(true)} disabled={busy}>{busy ? 'Reading…' : 'Preview'}</button>}
      {preview && (
        <div className="pl-import-preview small">
          <strong>{preview.format}</strong> file: {preview.found} found · <strong>{preview.new} new</strong> · {preview.duplicates} duplicates{preview.invalid ? ` · ${preview.invalid} invalid` : ''}
          {preview.sample.length > 0 && <div className="muted xsmall">{preview.sample.join(', ')}{preview.new > preview.sample.length ? '…' : ''}</div>}
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </Dialog>
  )
}

function PlaceDialog({ draft, groups, categories, onClose, onSaved, onDeleted }: {
  draft: Draft; groups: PlaceGroup[]; categories: PlaceCategory[]; onClose: () => void; onSaved: (p: Place) => void; onDeleted: () => void
}) {
  const [f, setF] = useState(() => ({
    name: draft.name ?? '', group_id: String(draft.group_id ?? groups[0]?.id ?? ''), category: draft.category ?? 'other',
    latitude: draft.latitude != null ? String(+draft.latitude.toFixed(6)) : '', longitude: draft.longitude != null ? String(+draft.longitude.toFixed(6)) : '',
    address: draft.address ?? '', description: draft.description ?? '', notes: draft.notes ?? '', rating: String(draft.rating ?? ''),
    status: (draft.status ?? 'saved') as PlaceStatus, visited_on: draft.visited_on ?? '',
  }))
  const [confirm, setConfirm] = useState(false)
  const save = useSavePlace()
  const remove = useDeletePlace()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const lat = Number(f.latitude)
  const lon = Number(f.longitude)
  const latOk = f.latitude.trim() !== '' && isFinite(lat) && lat >= -90 && lat <= 90
  const lonOk = f.longitude.trim() !== '' && isFinite(lon) && lon >= -180 && lon <= 180
  const valid = f.name.trim() && f.group_id && latOk && lonOk
  const editing = !!draft.id

  const submit = () => {
    if (!valid) return
    const body: Partial<PlaceInput> = {
      name: f.name.trim(), group_id: Number(f.group_id), category: f.category, latitude: lat, longitude: lon,
      address: f.address.trim() || null, description: f.description.trim(), notes: f.notes.trim(),
      rating: f.rating ? Number(f.rating) : editing ? 0 : null, status: f.status, visited_on: f.status === 'visited' && f.visited_on ? f.visited_on : null,
    }
    save.mutate({ id: draft.id, body }, { onSuccess: (p) => (onSaved(p), onClose()) })
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
              <button className="btn danger" onClick={() => setConfirm(true)}>
                <Icon name="trash" size={14} />Delete
              </button>
            )}
            <span className="spacer" />
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!valid || save.isPending} onClick={submit}>{editing ? 'Save' : 'Add place'}</button>
          </>
        }
      >
        <form className="stack" style={{ gap: 'var(--sp-3)' }} onSubmit={(e) => (e.preventDefault(), submit())}>
          <label className="field">
            <span>Name</span>
            <input className="input" value={f.name} onChange={set('name')} maxLength={200} required autoFocus placeholder="e.g. Lazeez" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Category</span>
              <select className="select" value={f.category} onChange={set('category')}>
                {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Group</span>
              <select className="select" value={f.group_id} onChange={set('group_id')}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Status</span>
              <select className="select" value={f.status} onChange={set('status')}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            {f.status === 'visited' && (
              <label className="field">
                <span>Visited on</span>
                <input className="input" type="date" value={f.visited_on} onChange={set('visited_on')} />
              </label>
            )}
            <label className="field">
              <span>Rating</span>
              <select className="select" value={f.rating} onChange={set('rating')}>
                <option value="">No rating</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Address</span>
            <input className="input" value={f.address} onChange={set('address')} maxLength={300} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Latitude</span>
              <input className="input tabular" inputMode="decimal" value={f.latitude} onChange={set('latitude')} aria-invalid={!latOk && f.latitude !== ''} />
              {!latOk && f.latitude !== '' && <span className="error-text">Between -90 and 90</span>}
            </label>
            <label className="field">
              <span>Longitude</span>
              <input className="input tabular" inputMode="decimal" value={f.longitude} onChange={set('longitude')} aria-invalid={!lonOk && f.longitude !== ''} />
              {!lonOk && f.longitude !== '' && <span className="error-text">Between -180 and 180</span>}
            </label>
          </div>
          {(f.latitude === '' || f.longitude === '') && <p className="help">Tip: close this and click the map to fill in the coordinates.</p>}
          <label className="field">
            <span>Description</span>
            <input className="input" value={f.description} onChange={set('description')} maxLength={500} />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea className="textarea" value={f.notes} onChange={set('notes')} rows={3} maxLength={2000} />
          </label>
          <button type="submit" hidden />
        </form>
      </Dialog>
      <Confirm
        open={confirm}
        title={`Delete "${draft.name}"?`}
        body="This place will be removed from its group."
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(draft as Place, { onSuccess: () => (onDeleted(), onClose()) })}
      />
    </>
  )
}

function GroupDialog({ group, onClose, onDeleted }: { group: Partial<PlaceGroup>; onClose: () => void; onDeleted: (id: number) => void }) {
  const [name, setName] = useState(group.name ?? '')
  const [description, setDescription] = useState(group.description ?? '')
  const [isPublic, setPublic] = useState(!!group.is_public)
  const [confirm, setConfirm] = useState(false)
  const save = useSaveGroup()
  const remove = useDeleteGroup()
  const editing = group.id != null
  const submit = () => {
    if (!name.trim()) return
    save.mutate({ id: group.id, body: { name: name.trim(), description: description.trim(), is_public: isPublic } }, { onSuccess: onClose })
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
            {editing && <button className="btn danger" onClick={() => setConfirm(true)}><Icon name="trash" size={14} />Delete</button>}
            <span className="spacer" />
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!name.trim() || save.isPending} onClick={submit}>{editing ? 'Save' : 'Create group'}</button>
          </>
        }
      >
        <form className="stack" style={{ gap: 'var(--sp-3)' }} onSubmit={(e) => (e.preventDefault(), submit())}>
          {!editing && <p className="help">Places live in groups, for example "Favourites" or "Food".</p>}
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required />
          </label>
          <label className="field">
            <span>Description</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </label>
          <Switch checked={isPublic} onChange={setPublic} label="Visible to everyone on this server" />
          <button type="submit" hidden />
        </form>
      </Dialog>
      <Confirm
        open={confirm}
        title={`Delete "${group.name}"?`}
        body={`This also deletes the ${group.count ?? 0} ${group.count === 1 ? 'place' : 'places'} in it.`}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(group as PlaceGroup, { onSuccess: () => (onDeleted(group.id!), onClose()) })}
      />
    </>
  )
}
