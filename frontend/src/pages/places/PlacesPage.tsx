import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Confirm, Dialog, ErrorBox, Menu, MenuItem, SkeletonRows, Switch, useDebounced, useHotkey } from '../../components/ui'
import type { PlaceCategory, PlaceGroup } from '../../lib/types'
import {
  STATUSES, VISIBLE_KEY, categoryIcon, importPlaces, useDeleteGroup, useDeletePlace, useGroupVisibility, usePlaceCategories, usePlaceGroups, useSaveGroup, useSavePlace,
  useShowOnlyGroup, useSuggestions, useVisiblePlaces, distanceM, fetchVisiblePins, placeQuery, usePlace, useVisibleTextMatches, type Group, type Pin, type ImportResult, type Place, type PlaceInput, type PlaceStatus, type Suggestion,
} from './api'
import { PlaceDetail, PlaceRow, StatsTab, SuggestedTab, SuggestionDetail, type Tab } from './PlacePanel'
import { photosInArea } from '../photos/util'
import { HeatFilterControls, heatParams, useHeatFilter } from '../photos/HeatFilters'
import { PlaceSearch } from './Search'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '../../lib/api'
import { userKey } from '../../lib/owner'
import { useMe } from '../../lib/queries'
import { realPoints, type HeatPoint } from '../photos/heat'
import { toast } from '../../components/toast'
import { PlaceMap, type MapFocus } from './PlaceMap'
import './places.css'

type Draft = Partial<PlaceInput> & { id?: string }

function readSet<T>(key: string): Set<T> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]') as T[]) } catch { return new Set() }
}
function writeSet<T>(key: string, v: Set<T>, max = 500) {
  try { localStorage.setItem(key, JSON.stringify([...v].slice(-max))) } catch { /* per page only */ }
}
const spotKey = (s: Suggestion) => `${s.latitude.toFixed(3)},${s.longitude.toFixed(3)}`
let focusSeq = 0

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
  // Photo heat map: on/off, year and "include photos taken on planes" remembered per device.
  const [heatOn, setHeatOn] = useState(() => { try { return localStorage.getItem('app.places.heat') === '1' } catch { return false } })
  const [heatFilter, setHeatFilter] = useHeatFilter()
  const [box, setBox] = useState<{ south: number; west: number; north: number; east: number } | null>(null)
  const boxTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onBounds = (b: { south: number; west: number; north: number; east: number }) => {
    if (boxTimer.current) clearTimeout(boxTimer.current)
    // Debounce 350 ms; snap to 2 decimals so small pans reuse the cached box.
    boxTimer.current = setTimeout(() => {
      const f = (v: number, up: boolean) => (up ? Math.ceil(v * 100) : Math.floor(v * 100)) / 100
      setBox({ south: f(b.south, false), west: f(b.west, false), north: f(b.north, true), east: f(b.east, true) })
    }, 350)
  }
  const heat = useQuery({
    queryKey: ['photos', 'points', box, heatParams(heatFilter)],
    queryFn: ({ signal }) => get<HeatPoint[]>('photos/points', { ...box!, ...heatParams(heatFilter) }, signal),
    select: realPoints,
    enabled: heatOn && !!box,
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  })
  const toggleHeat = () => setHeatOn((v) => { try { localStorage.setItem('app.places.heat', v ? '0' : '1') } catch { /* ignore */ } return !v })

  // Groups are hidden by default (per person, on the server): the map loads only the groups turned on.
  const [showArchived, setShowArchivedState] = useState(() => { try { return localStorage.getItem('app.places.showArchived') === '1' } catch { return false } })
  const setShowArchived = (v: boolean) => { setShowArchivedState(v); try { localStorage.setItem('app.places.showArchived', v ? '1' : '0') } catch { /* ignore */ } }
  const groups = usePlaceGroups(showArchived)
  const cats = usePlaceCategories()
  const anyVisible = !!groups.data?.some((g) => g.visible && !g.archived)
  const all = useVisiblePlaces(anyVisible)
  const setVisible = useGroupVisibility()
  const showOnly = useShowOnlyGroup()
  const [removingGroup, setRemovingGroup] = useState<Group | null>(null)
  const removeGroup = useDeleteGroup()
  const saveGroup = useSaveGroup()
  const suggestionsQ = useSuggestions(tab === 'suggested')
  // Dismissed suggestions and groups hidden from the map/list are remembered per device (as in the classic page).
  // Dismissed spots are the signed-in user's own (coordinates): kept per user on a shared browser.
  const meId = useMe().data?.id
  const dismissKey = useMemo(() => userKey('app.places.dismissed', meId), [meId])
  const [dismissed, setDismissed] = useState(() => (dismissKey ? readSet<string>(dismissKey) : new Set<string>()))
  useEffect(() => setDismissed(dismissKey ? readSet<string>(dismissKey) : new Set<string>()), [dismissKey])
  const saveDismissed = (n: Set<string>) => dismissKey && writeSet(dismissKey, n, 200)
  const suggestions = useMemo(() => suggestionsQ.data?.filter((x) => !dismissed.has(spotKey(x))), [suggestionsQ.data, dismissed])
  const [sug, setSug] = useState<Suggestion | null>(null)
  const [addMode, setAddMode] = useState(false)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [fit, setFit] = useState<{ key: number; points: [number, number][] } | null>(null)
  const qc = useQueryClient()
  const groupById = (id: number) => groups.data?.find((g) => g.id === id)
  const turnOn = (id: number) => { const g = groupById(id); if (g && !g.visible && !g.archived) setVisible.mutate({ id, visible: true }) }
  const dismiss = (x: Suggestion) => {
    setDismissed((d) => { const n = new Set(d); n.add(spotKey(x)); saveDismissed(n); return n })
    if (sug === x) setSug(null)
    toast.show('Suggestion dismissed', { action: { label: 'Undo', run: () => setDismissed((d) => { const n = new Set(d); n.delete(spotKey(x)); saveDismissed(n); return n }) } })
  }
  const focusSuggestion = (x: Suggestion) => {
    setSug(x)
    setParam('place', null)
    setFocus({ key: ++focusSeq, lat: x.latitude, lon: x.longitude, zoom: 15 })
  }
  const saveSuggestion = (x: Suggestion) => newPlace(x.latitude, x.longitude, { name: x.name, address: x.address, status: 'visited', visited_on: x.last_day })
  useHotkey((e) => e.key === 'Escape' && addMode && !document.querySelector('.dialog'), () => setAddMode(false), true)
  const mineGroups = useMemo(() => (groups.data ?? []).filter((g) => g.mine && !g.archived), [groups.data])
  const catLabel = useMemo(() => {
    const m = new Map((cats.data ?? []).map((c) => [c.key, c.label]))
    return (k: string) => m.get(k) ?? k
  }, [cats.data])
  const groupName = (id: number) => groups.data?.find((g) => g.id === id)?.name ?? ''
  const canEdit = (p: Pin) => !!groups.data?.some((g) => g.id === p.group_id && g.mine)

  const [draft, setDraft] = useState<Draft | null>(null)
  // Long lists render in pages (thousands of rows would make every map move janky).
  const [limit, setLimit] = useState(200)
  const [groupDraft, setGroupDraft] = useState<Partial<Group> | null>(null)
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

  // One request for the groups that are on; filters and counts happen here over that set.
  const everything = useMemo(() => (anyVisible ? all.data ?? [] : []), [all.data, anyVisible])
  const inGroup = groupId ? everything.filter((p) => p.group_id === groupId) : everything
  // Pins carry no address/notes/description: a text filter also asks the server which places match those.
  const textHits = useVisibleTextMatches(q, anyVisible)
  const textIds = useMemo(() => new Set((textHits.data ?? []).map((p) => p.id)), [textHits.data])
  const places = useMemo(() => {
    const list = inGroup.filter((p) =>
      (!category || p.category === category) && (!status || (p.status ?? 'saved') === status) && (!minRating || (p.rating ?? 0) >= minRating) &&
      (!q || p.name.toLowerCase().includes(q) || textIds.has(p.id)))
    // Nearest first once your location is known.
    return pos ? list.map((p) => [distanceM(pos, { lat: p.latitude, lon: p.longitude }), p] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]) : list
  }, [inGroup, category, status, minRating, q, pos, textIds])
  const count = (fn: (p: Pin) => boolean) => inGroup.filter(fn).length
  const filtered = !!(groupId || category || status || q || minRating)
  // The open place loads in full (pins have no description, notes or address); its pin fills in meanwhile.
  const pinSel = everything.find((p) => p.id === selected) ?? null
  const oneSel = usePlace(selected)
  const sel: Place | null = oneSel.data?.id === selected ? oneSel.data
    : pinSel ? { description: '', notes: '', altitude: null, ...pinSel } : null
  /** Edit with every field: fetch the full place first (cached for a minute). */
  const editPlace = (p: Pin) => {
    if ('description' in p && 'notes' in p && p.description !== undefined && p.notes !== undefined) return setDraft({ ...(p as Place) })
    qc.fetchQuery(placeQuery(p.id)).then((full) => setDraft({ ...full }), (e) => toast.error((e as Error).message))
  }
  const prefetchPlace = (id: string) => void qc.prefetchQuery(placeQuery(id))

  const locate = () => {
    if (!navigator.geolocation) return toast.error("This browser can't share its location.")
    navigator.geolocation.getCurrentPosition(
      (g) => {
        setPos({ lat: g.coords.latitude, lon: g.coords.longitude })
        setFocus({ key: ++focusSeq, lat: g.coords.latitude, lon: g.coords.longitude, zoom: 13 })
        toast.show('Nearest places first: distances are from your location')
      },
      () => toast.error("Couldn't get your location."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }

  const sidebar = (
    <>
      <SideSection
        title="Groups"
        action={
          <span className="row" style={{ gap: 0 }}>
            <button className="btn ghost icon sm" onClick={() => qc.invalidateQueries({ queryKey: ['places'] })} aria-label="Refresh" title="Refresh"><Icon name="refresh" size={14} className={all.isFetching || groups.isFetching ? 'spin' : ''} /></button>
            <button className="btn ghost icon sm" onClick={() => (mineGroups.length ? setImporting(true) : (toast.show('Create a group first'), setGroupDraft({ name: '', description: '', is_public: false })))} aria-label="Import places" title="Import (GeoJSON, KML, GPX, Google Takeout, CSV)"><Icon name="arrowDown" size={14} /></button>
            <button className="btn ghost icon sm" onClick={() => setGroupDraft({ name: '', description: '', is_public: false })} aria-label="New group" title="New group"><Icon name="plus" size={14} /></button>
          </span>
        }
      >
        {groups.isPending ? <SkeletonRows rows={2} /> : groups.error && !groups.data ? <ErrorBox error={groups.error} retry={() => groups.refetch()} /> : !groups.data?.length ? (
          <p className="muted xsmall pl-side-note">No groups yet. Use + to create one.</p>
        ) : (groups.data ?? []).map((g) => (
          <div key={g.id} className={'pl-side-row' + (g.visible && !g.archived ? '' : ' hidden-group') + (g.archived ? ' archived' : '')}>
            <input type="checkbox" className="pl-group-check" checked={g.visible && !g.archived} disabled={g.archived} onChange={(e) => setVisible.mutate({ id: g.id, visible: e.target.checked })}
              aria-label={`Show ${g.name} on the map`} title={g.archived ? 'Archived: unarchive to show it' : g.visible ? 'Shown: hide from the map' : 'Hidden: show on the map'} />
            <SideItem icon="folder" label={<>{g.name}{g.archived && <span className="chip pl-pub">Archived</span>}{g.is_public && <span className="chip pl-pub">Public</span>}{!g.mine && <span className="chip pl-pub">Shared</span>}</>}
              count={g.count} active={groupId === g.id} onClick={() => { if (groupId === g.id) return setParam('group', null); turnOn(g.id); setParam('group', String(g.id)) }} />
            <span className="pl-side-acts">
              <GroupMenu g={g} onOnly={() => showOnly.mutate(g)} onEdit={() => setGroupDraft(g)} onDelete={() => setRemovingGroup(g)}
                onPatch={(body) => saveGroup.mutate({ id: g.id, body }, { onSuccess: () => toast.show(body.archived === true ? `Archived "${g.name}"` : body.archived === false ? `Unarchived "${g.name}"` : body.is_public ? `"${g.name}" is public` : `"${g.name}" is private`) })} />
            </span>
          </div>
        ))}
        <div className="side-switch"><Switch checked={showArchived} onChange={setShowArchived} label="Show archived groups" /></div>
      </SideSection>
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
      <SideSection title="Categories">
        {(cats.data ?? []).map((c) => ({ c, n: count((p) => p.category === c.key) })).sort((a, b) => b.n - a.n).map(({ c, n }) => (
          <SideItem key={c.key} icon={categoryIcon(c.key) ?? 'map-pin'} label={c.label} count={n || undefined} active={category === c.key} onClick={() => setParam('category', category === c.key ? null : c.key)} />
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
          <PlaceSearch text={text} onText={setText} places={everything} groups={groups.data ?? []} onShowGroup={(g) => setVisible.mutate({ id: g.id, visible: true })}
            onPlace={(p) => { setText(''); setSug(null); setParam('place', p.id); if (!everything.some((x) => x.id === p.id)) setFocus({ key: ++focusSeq, lat: p.latitude, lon: p.longitude, zoom: 16 }) }}
            onHit={(h) => (setAddMode(false), setFocus({ key: ++focusSeq, lat: h.lat, lon: h.lon, bbox: h.bbox, label: h.name, address: h.address }))} />
          <button className={'btn pl-add-btn' + (addMode ? ' on' : '')} aria-pressed={addMode} onClick={() => (mineGroups.length || addMode ? setAddMode((v) => !v) : newPlace())} title="Add place: click the map to drop it (Esc cancels)"><Icon name="pin" size={15} /><span>Add place</span></button>
          <button className={'btn pl-heat-btn' + (heatOn ? ' on' : '')} aria-pressed={heatOn} onClick={toggleHeat} title="Photo heat map"><Icon name="photo" size={15} /><span>Heatmap</span></button>
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
            onEdit={editPlace}
            onAddAt={(lat, lon, name, address) => (setAddMode(false), newPlace(lat, lon, name ? { name, address: address ?? '' } : {}))}
            suggestions={tab === 'suggested' ? suggestions : undefined}
            onSuggestion={focusSuggestion}
            heat={heatOn ? heat.data ?? [] : null}
            onBounds={onBounds}
            addMode={addMode}
            focus={focus}
            userPos={pos}
            fit={fit}
          />
          {heatOn && (
            <div className="pl-heat-panel" role="group" aria-label="Photo heat map">
              <strong className="xsmall">Photo heat map</strong>
              {heat.isFetching && <span className="spinner" aria-label="Loading" />}
              <HeatFilterControls f={heatFilter} set={setHeatFilter} enabled={heatOn} />
              <span className="muted xsmall tabular">{(heat.data ?? []).reduce((t, p) => t + p.count, 0).toLocaleString()} photos in view</span>
            </div>
          )}
          <p className={'pl-hint' + (addMode ? ' on' : '')}>{addMode ? <>Click the map to place the pin · <button className="pl-hint-x" onClick={() => setAddMode(false)}>Cancel (Esc)</button></>
            : groups.data && !anyVisible && groups.data.length ? 'Turn on a group to see its places' : 'Click the map to add a place'}</p>
          {box && (
            <Link className="btn sm pl-photos-area" to={photosInArea(box.north, box.south, box.east, box.west)} title="Photos taken in the visible area">
              <Icon name="photo" size={14} /><span>Photos in this area</span>
            </Link>
          )}
        </div>
        <section className="pl-list" aria-label="Places">
          {sug && tab === 'suggested' && !sel ? (
            <SuggestionDetail s={sug} pos={pos} onSave={() => saveSuggestion(sug)} onDismiss={() => dismiss(sug)} onClose={() => setSug(null)} />
          ) : sel ? (
            <PlaceDetail p={sel} catLabel={catLabel} group={groupById(sel.group_id)} canEdit={canEdit(sel)} pos={pos}
              onEdit={() => editPlace(sel)} onClose={() => setParam('place', null)} onShowGroup={() => turnOn(sel.group_id)} />
          ) : (
            <>
              <div className="tabs pl-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'places'} onClick={() => setParam('tab', null)}>Places <span className="muted">{places.length}</span></button>
                <button role="tab" aria-selected={tab === 'suggested'} onClick={() => setParam('tab', 'suggested')}>Suggested{suggestions && suggestions.length > 0 && <span className="muted"> {suggestions.length}</span>}</button>
                <button role="tab" aria-selected={tab === 'stats'} onClick={() => setParam('tab', 'stats')}>Stats</button>
              </div>
              {tab === 'suggested' ? (
                <SuggestedTab items={suggestions} pending={suggestionsQ.isPending} error={suggestionsQ.error} retry={() => suggestionsQ.refetch()} onSave={saveSuggestion} onFocus={focusSuggestion} onDismiss={dismiss} />
              ) : tab === 'stats' ? (
                <StatsTab onSelect={(id) => setParam('place', id)} catLabel={catLabel} />
              ) : (
                <>
                  {filtered && (
                    <div className="pl-list-head">
                      <h2 className="muted small">{places.length} of {everything.length} shown{pos ? ' · nearest first' : ''}</h2>
                      <button className="btn ghost sm" onClick={() => (setText(''), setParams(new URLSearchParams()))}>Clear filters</button>
                    </div>
                  )}
                  {groups.isPending || (anyVisible && all.isPending) ? <SkeletonRows rows={6} /> : all.isError && !all.data ? <ErrorBox error={all.error} retry={() => all.refetch()} /> : !places.length ? (
                    <div className="empty left">{filtered ? 'No places match.' : !groups.data?.length ? 'No places yet. Create a group, then use Add place, search the map, import a file, or save a suggestion.'
                      : !anyVisible ? 'Turn on a group in the sidebar to see its places. Search finds places in every group.' : 'No places in the groups that are on.'}</div>
                  ) : (
                    <ul className="pl-items">
                      {places.slice(0, limit).map((p) => (
                        <li key={p.id} className="pl-item" onPointerEnter={() => prefetchPlace(p.id)}>
                          <PlaceRow p={p} active={selected === p.id} onSelect={() => setParam('place', p.id)} catLabel={catLabel} groupName={groupName} pos={pos} />
                          {canEdit(p) && (
                            <button className="btn ghost icon sm pl-item-edit" onClick={() => editPlace(p)} aria-label={`Edit ${p.name}`} title="Edit">
                              <Icon name="edit" size={14} />
                            </button>
                          )}
                        </li>
                      ))}
                      {places.length > limit && (
                        <li className="pl-more-row"><button className="btn sm" onClick={() => setLimit((l) => l + 500)}>Show {Math.min(500, places.length - limit).toLocaleString()} more of {(places.length - limit).toLocaleString()}</button></li>
                      )}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
      {draft && <PlaceDialog draft={draft} groups={mineGroups} categories={cats.data ?? []} onClose={() => setDraft(null)} onSaved={(p) => (turnOn(p.group_id), setParam('place', p.id))} onDeleted={() => setParam('place', null)} />}
      {groupDraft && <GroupDialog group={groupDraft} onClose={() => setGroupDraft(null)} onDeleted={(id) => groupId === id && setParam('group', null)}
        onCreated={(g) => setVisible.mutate({ id: g.id, visible: true })} />}
      <Confirm open={!!removingGroup} title={`Delete "${removingGroup?.name}"?`} body={`This also deletes the ${removingGroup?.count ?? 0} ${removingGroup?.count === 1 ? 'place' : 'places'} in it.`}
        onClose={() => setRemovingGroup(null)} onConfirm={() => removingGroup && removeGroup.mutate(removingGroup, { onSuccess: () => groupId === removingGroup.id && setParam('group', null) })} />
      {importing && <ImportDialog groups={mineGroups} onClose={() => setImporting(false)} onDone={async (gid) => {
        // Turn the group on, then fit the map to its places once they're loaded.
        const g = groupById(gid)
        if (g && !g.visible) await setVisible.mutateAsync({ id: gid, visible: true })
        const fresh = await qc.fetchQuery({ queryKey: VISIBLE_KEY, queryFn: () => fetchVisiblePins(), staleTime: 0 })
        const pts = fresh.filter((p) => p.group_id === gid).map((p) => [p.latitude, p.longitude] as [number, number])
        if (pts.length) setFit({ key: Date.now(), points: pts })
      }} />}
    </AppShell>
  )
}

/** ⋯ menu of a group: show only, edit, public/private, export, archive, delete (owner actions only for owners). */
function GroupMenu({ g, onOnly, onEdit, onDelete, onPatch }: {
  g: Group; onOnly: () => void; onEdit: () => void; onDelete: () => void; onPatch: (b: { is_public?: boolean; archived?: boolean }) => void
}) {
  return (
    <Menu align="end" label={`${g.name} options`} trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label={`${g.name} options`} title="Options"><Icon name="more" size={14} /></button>}>
      {(close) => (
        <>
          {!g.archived && <MenuItem icon="map" onClick={() => (close(), onOnly())}>Show only this</MenuItem>}
          {g.mine && <MenuItem icon="edit" onClick={() => (close(), onEdit())}>Edit group</MenuItem>}
          {g.mine && <MenuItem icon={g.is_public ? 'shield' : 'users'} onClick={() => (close(), onPatch({ is_public: !g.is_public }))}>{g.is_public ? 'Make private' : 'Share with everyone (public)'}</MenuItem>}
          <MenuItem icon="arrowUp" href={`/api/v2/places/groups/${g.id}/export`} onClick={close}>Export GeoJSON</MenuItem>
          {g.mine && <MenuItem icon="folder" onClick={() => (close(), onPatch({ archived: !g.archived }))}>{g.archived ? 'Unarchive' : 'Archive'}</MenuItem>}
          {g.mine && <><div className="menu-sep" /><MenuItem icon="trash" danger onClick={() => (close(), onDelete())}>Delete group…</MenuItem></>}
        </>
      )}
    </Menu>
  )
}

function ImportDialog({ groups, onClose, onDone }: { groups: PlaceGroup[]; onClose: () => void; onDone: (groupId: number) => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [group, setGroup] = useState(groups[0]?.id ?? 0)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Preview as soon as a file and group are picked (dry run: nothing is saved).
  useEffect(() => { if (file && group) void run(true) }, [file, group])
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
        onDone(group)
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
      <label className="field"><span>File</span><input className="input" type="file" accept=".json,.geojson,.kml,.kmz,.gpx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError('') }} /></label>
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
      rating: f.rating ? Number(f.rating) : editing ? 0 : null, status: f.status,
    }
    // Visited with no date: leave it to the server (keeps the old date, or today for a new visit).
    if (f.status !== 'visited') body.visited_on = null
    else if (f.visited_on) body.visited_on = f.visited_on
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

function GroupDialog({ group, onClose, onDeleted, onCreated }: { group: Partial<Group>; onClose: () => void; onDeleted: (id: number) => void; onCreated: (g: PlaceGroup) => void }) {
  const [name, setName] = useState(group.name ?? '')
  const [description, setDescription] = useState(group.description ?? '')
  const [isPublic, setPublic] = useState(!!group.is_public)
  const [confirm, setConfirm] = useState(false)
  const save = useSaveGroup()
  const remove = useDeleteGroup()
  const editing = group.id != null
  const submit = () => {
    if (!name.trim()) return
    save.mutate({ id: group.id, body: { name: name.trim(), description: description.trim(), is_public: isPublic } }, { onSuccess: (g) => (onClose(), !editing && onCreated(g)) })
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
