// Places: the map (pins, suggestions, the photo heat layer) and a right panel (list / Suggested / Stats, or a
// place's or suggestion's details), with the sidebar's groups and filters. Groups are hidden by default (per
// person, on the server): the map loads only the groups turned on, and filters and counts run over that set.
// State lives in small hooks (usePlaceFilters, usePhotoHeat, useDismissedSuggestions); dialogs in PlaceDialogs.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { layerOpen } from '../../components/layers'
import { toast } from '../../components/toast'
import { Button, buttonClass, Confirm, useHotkey } from '../../components/ui'
import { cn } from '../../lib/cn'
import { HeatFilterControls } from '../../lib/map/HeatFilters'
import { usePref } from '../../lib/storage'
import { photosInArea } from '../photos/util'
import {
  type Group,
  type Pin,
  type Place,
  placeQuery,
  type Suggestion,
  useDeleteGroup,
  useGroupVisibility,
  usePlace,
  usePlaceCategories,
  usePlaceGroups,
  useSuggestions,
  useVisiblePlaces,
  visiblePinsQuery,
} from './api'
import { PlaceDetail, type Pos, SuggestionDetail } from './PlaceDetail'
import { type Draft, GroupDialog, ImportDialog, PlaceDialog } from './PlaceDialogs'
import { type MapFocus, PlaceMap } from './PlaceMap'
import { PlacesList, SuggestedTab } from './PlacesList'
import { PlacesSidebar } from './PlacesSidebar'
import { StatsTab } from './PlaceStats'
import { PlaceSearch } from './Search'
import { useDismissedSuggestions } from './useDismissedSuggestions'
import { usePhotoHeat } from './usePhotoHeat'
import { usePlaceFilters } from './usePlaceFilters'

let focusSeq = 0
const NEW_GROUP: Partial<Group> = { name: '', description: '', is_public: false }
/** A top-bar button whose label gives way to its icon on phones. */
const label = 'max-md:hidden'
const iconOnPhone = 'max-md:w-8 max-md:gap-0 max-md:px-0'

export default function PlacesPage() {
  const qc = useQueryClient()
  const [pos, setPos] = useState<Pos>(null)
  const heat = usePhotoHeat()
  const [showArchived, setShowArchived] = usePref<boolean>('app.places.showArchived', false)
  const groups = usePlaceGroups(showArchived)
  const cats = usePlaceCategories()
  const anyVisible = !!groups.data?.some((g) => g.visible && !g.archived)
  const all = useVisiblePlaces(anyVisible)
  // One request for the groups that are on; filters and counts happen here over that set.
  const everything = useMemo(() => (anyVisible ? (all.data ?? []) : []), [all.data, anyVisible])
  const f = usePlaceFilters(everything, anyVisible, pos)
  const { groupId, category, selected, tab, setParam } = f
  const setVisible = useGroupVisibility()
  const [removingGroup, setRemovingGroup] = useState<Group | null>(null)
  const removeGroup = useDeleteGroup()
  const suggestionsQ = useSuggestions(tab === 'suggested')
  const { shown: suggestions, dismiss: dismissSpot } = useDismissedSuggestions(suggestionsQ.data)
  const [sug, setSug] = useState<Suggestion | null>(null)
  const [addMode, setAddMode] = useState(false)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [fit, setFit] = useState<{ key: number; points: [number, number][] } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [groupDraft, setGroupDraft] = useState<Partial<Group> | null>(null)
  const [importing, setImporting] = useState(false)

  const groupById = (id: number) => groups.data?.find((g) => g.id === id)
  const turnOn = (id: number) => {
    const g = groupById(id)
    if (g && !g.visible && !g.archived) setVisible.mutate({ id, visible: true })
  }
  const mineGroups = useMemo(() => (groups.data ?? []).filter((g) => g.mine && !g.archived), [groups.data])
  const catLabel = useMemo(() => {
    const m = new Map((cats.data ?? []).map((c) => [c.key, c.label]))
    return (k: string) => m.get(k) ?? k
  }, [cats.data])
  const groupName = (id: number) => groupById(id)?.name ?? ''
  const canEdit = (p: Pin) => !!groups.data?.some((g) => g.id === p.group_id && g.mine)

  const newPlace = (lat?: number, lon?: number, extra: Partial<Draft> = {}) => {
    if (!mineGroups.length) return setGroupDraft(NEW_GROUP)
    setDraft({
      name: '',
      group_id: groupId && mineGroups.some((g) => g.id === groupId) ? groupId : mineGroups[0].id,
      category: category ?? 'other',
      latitude: lat,
      longitude: lon,
      address: '',
      description: '',
      notes: '',
      rating: null,
      status: 'saved',
      ...extra,
    })
  }
  const dismiss = (x: Suggestion) => {
    dismissSpot(x)
    if (sug === x) setSug(null)
  }
  const focusSuggestion = (x: Suggestion) => {
    setSug(x)
    setParam('place', null)
    setFocus({ key: ++focusSeq, lat: x.latitude, lon: x.longitude, zoom: 15 })
  }
  const saveSuggestion = (x: Suggestion) =>
    newPlace(x.latitude, x.longitude, { name: x.name, address: x.address, status: 'visited', visited_on: x.last_day })
  useHotkey(
    (e) => e.key === 'Escape' && addMode && !layerOpen(['dialog']),
    () => setAddMode(false),
    true,
  )

  // "New place" from the global create menu: /places?new=1
  const wantsNew = f.params.get('new') === '1'
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the groups are known
  useEffect(() => {
    if (wantsNew && groups.data) {
      setParam('new', null)
      newPlace()
    }
  }, [wantsNew, groups.data])

  // The open place loads in full (pins have no description, notes or address); its pin fills in meanwhile.
  const pinSel = everything.find((p) => p.id === selected) ?? null
  const oneSel = usePlace(selected)
  const sel: Place | null =
    oneSel.data?.id === selected ? oneSel.data : pinSel ? { description: '', notes: '', altitude: null, ...pinSel } : null
  /** Edit with every field: fetch the full place first (cached for a minute). */
  const editPlace = (p: Pin) => {
    if (p.description !== undefined && p.notes !== undefined) return setDraft({ ...p })
    qc.fetchQuery(placeQuery(p.id)).then(
      (full) => setDraft({ ...full }),
      (e) => toast.fail(e),
    )
  }

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

  const tabClass = (on: boolean) =>
    cn(
      '-mb-px inline-flex h-9 items-center gap-1.5 border-0 border-b-2 bg-transparent px-2.5 text-sm font-medium whitespace-nowrap',
      on ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
    )

  return (
    <AppShell
      app="places"
      fullHeight
      topbar={
        <>
          <PlaceSearch
            text={f.text}
            onText={f.setText}
            places={everything}
            groups={groups.data ?? []}
            onShowGroup={(g) => setVisible.mutate({ id: g.id, visible: true })}
            onPlace={(p) => {
              f.setText('')
              setSug(null)
              setParam('place', p.id)
              if (!everything.some((x) => x.id === p.id)) setFocus({ key: ++focusSeq, lat: p.latitude, lon: p.longitude, zoom: 16 })
            }}
            onHit={(h) => {
              setAddMode(false)
              setFocus({ key: ++focusSeq, lat: h.lat, lon: h.lng, bbox: h.bbox, label: h.name, address: h.address, id: h.id })
            }}
          />
          <Button
            variant={addMode ? 'primary' : 'default'}
            className={iconOnPhone}
            aria-pressed={addMode}
            onClick={() => (mineGroups.length || addMode ? setAddMode((v) => !v) : newPlace())}
            title="Add place: click the map to drop it (Esc cancels)"
          >
            <Icon name="pin" size={15} />
            <span className={label}>Add place</span>
          </Button>
          <Button pressed={heat.on} aria-pressed={heat.on} onClick={heat.toggle} title="Photo heat map">
            <Icon name="photo" size={15} />
            <span className={label}>Heatmap</span>
          </Button>
          <Button className="max-md:hidden" onClick={locate} title="Show distances from your location">
            <Icon name="location" size={15} />
            <span>Near me</span>
          </Button>
          <Button variant="primary" className="ml-auto max-md:hidden" onClick={() => newPlace()}>
            <Icon name="plus" size={15} />
            <span>New place</span>
          </Button>
        </>
      }
      sidebar={
        <PlacesSidebar
          groups={groups}
          refreshing={all.isFetching || groups.isFetching}
          groupId={groupId}
          category={category}
          status={f.status}
          minRating={f.minRating}
          total={f.inGroup.length}
          counts={f.counts}
          categories={cats.data ?? []}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          setParam={setParam}
          onAllPlaces={() => f.clearFilters(true)}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['places'] })}
          onImport={() => {
            if (mineGroups.length) return setImporting(true)
            toast.show('Create a group first')
            setGroupDraft(NEW_GROUP)
          }}
          onNewGroup={() => setGroupDraft(NEW_GROUP)}
          onEditGroup={setGroupDraft}
          onDeleteGroup={setRemovingGroup}
          onVisible={(g, visible) => setVisible.mutate({ id: g.id, visible })}
          onSelectGroup={(g) => {
            if (groupId === g.id) return setParam('group', null)
            turnOn(g.id)
            setParam('group', String(g.id))
          }}
        />
      }
    >
      {/* On phones the top bar needs the app name's room for the search (the title is AppShell's; hidden from here). */}
      <div className="max-md:[body:has(&)_.app-title-text]:hidden grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem] max-[1100px]:grid-cols-[minmax(0,1fr)_18rem] max-md:h-auto max-md:grid-cols-1 max-md:grid-rows-[48vh_auto]">
        <div className="relative isolate min-h-0 max-md:h-[48vh]">
          <PlaceMap
            places={f.places}
            selected={selected}
            categoryLabel={catLabel}
            canEdit={canEdit}
            onSelect={(id) => setParam('place', id)}
            onEdit={editPlace}
            onAddAt={(lat, lon, name, address) => {
              setAddMode(false)
              newPlace(lat, lon, name ? { name, address: address ?? '' } : {})
            }}
            suggestions={tab === 'suggested' ? suggestions : undefined}
            onSuggestion={focusSuggestion}
            heat={heat.points}
            onBox={heat.setBox}
            addMode={addMode}
            focus={focus}
            userPos={pos}
            fit={fit}
          />
          {heat.on && (
            <fieldset
              className="absolute top-3 left-3 z-500 m-0 grid min-w-52 gap-1.5 rounded-md border-0 bg-[color-mix(in_srgb,var(--app-surface)_94%,transparent)] px-3 py-2 shadow-pop max-md:top-2 max-md:right-12 max-md:left-2"
              aria-label="Photo heat map"
            >
              <strong className="text-xs">Photo heat map</strong>
              {heat.fetching && <span className="spinner absolute top-2 right-2" role="status" aria-label="Loading" />}
              <HeatFilterControls f={heat.filter} set={heat.setFilter} enabled={heat.on} />
              <span className="text-xs text-muted tabular-nums">{heat.total.toLocaleString()} photos in view</span>
            </fieldset>
          )}
          <p
            className={cn(
              'absolute bottom-13 left-1/2 z-500 -translate-x-1/2 rounded-full px-2.5 py-1 text-xs whitespace-nowrap shadow-pop max-md:hidden',
              addMode
                ? 'bg-accent font-medium text-accent-fg'
                : 'pointer-events-none bg-[color-mix(in_srgb,var(--app-surface)_90%,transparent)] text-muted',
            )}
          >
            {addMode ? (
              <>
                Click the map to place the pin ·{' '}
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline"
                  onClick={() => setAddMode(false)}
                >
                  Cancel (Esc)
                </button>
              </>
            ) : groups.data && !anyVisible && groups.data.length ? (
              'Turn on a group to see its places'
            ) : (
              'Click the map to add a place'
            )}
          </p>
          {heat.box && (
            <Link
              className={buttonClass({
                size: 'sm',
                className: cn(
                  'absolute top-3 right-3 z-500 bg-surface shadow-pop hover:no-underline max-md:w-8 max-md:justify-center max-md:px-0',
                  heat.on && 'max-md:top-auto max-md:bottom-3',
                ),
              })}
              to={photosInArea(heat.box.north, heat.box.south, heat.box.east, heat.box.west)}
              title="Photos taken in the visible area"
            >
              <Icon name="photo" size={14} />
              <span className={label}>Photos in this area</span>
            </Link>
          )}
        </div>
        <section className="flex min-h-0 flex-col border-l border-border bg-surface max-md:border-t max-md:border-l-0" aria-label="Places">
          {sug && tab === 'suggested' && !sel ? (
            <SuggestionDetail
              s={sug}
              pos={pos}
              onSave={() => saveSuggestion(sug)}
              onDismiss={() => dismiss(sug)}
              onClose={() => setSug(null)}
            />
          ) : sel ? (
            <PlaceDetail
              p={sel}
              catLabel={catLabel}
              group={groupById(sel.group_id)}
              canEdit={canEdit(sel)}
              pos={pos}
              onEdit={() => editPlace(sel)}
              onClose={() => setParam('place', null)}
              onShowGroup={() => turnOn(sel.group_id)}
            />
          ) : (
            <>
              <div className="m-0 flex flex-none gap-1 overflow-x-auto border-b border-border px-2" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'places'}
                  className={tabClass(tab === 'places')}
                  onClick={() => setParam('tab', null)}
                >
                  Places <span className="text-muted">{f.places.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'suggested'}
                  className={tabClass(tab === 'suggested')}
                  onClick={() => setParam('tab', 'suggested')}
                >
                  Suggested{suggestions && suggestions.length > 0 && <span className="text-muted"> {suggestions.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'stats'}
                  className={tabClass(tab === 'stats')}
                  onClick={() => setParam('tab', 'stats')}
                >
                  Stats
                </button>
              </div>
              {tab === 'suggested' ? (
                <SuggestedTab
                  items={suggestions}
                  pending={suggestionsQ.isPending}
                  error={suggestionsQ.error}
                  retry={() => suggestionsQ.refetch()}
                  onSave={saveSuggestion}
                  onFocus={focusSuggestion}
                  onDismiss={dismiss}
                />
              ) : tab === 'stats' ? (
                <StatsTab onSelect={(id) => setParam('place', id)} catLabel={catLabel} />
              ) : (
                <PlacesList
                  places={f.places}
                  total={everything.length}
                  filtered={f.filtered}
                  loading={groups.isPending || (anyVisible && all.isPending)}
                  error={all.isError && !all.data ? all.error : null}
                  retry={() => all.refetch()}
                  emptyText={
                    f.filtered
                      ? 'No places match.'
                      : !groups.data?.length
                        ? 'No places yet. Create a group, then use Add place, search the map, import a file, or save a suggestion.'
                        : !anyVisible
                          ? 'Turn on a group in the sidebar to see its places. Search finds places in every group.'
                          : 'No places in the groups that are on.'
                  }
                  selected={selected}
                  pos={pos}
                  catLabel={catLabel}
                  groupName={groupName}
                  canEdit={canEdit}
                  onSelect={(id) => setParam('place', id)}
                  onEdit={editPlace}
                  onPrefetch={(id) => void qc.prefetchQuery(placeQuery(id))}
                  onClear={() => {
                    f.setText('')
                    f.clearFilters()
                  }}
                />
              )}
            </>
          )}
        </section>
      </div>
      {draft && (
        <PlaceDialog
          draft={draft}
          groups={mineGroups}
          categories={cats.data ?? []}
          onClose={() => setDraft(null)}
          onSaved={(p) => {
            turnOn(p.group_id)
            setParam('place', p.id)
          }}
          onDeleted={() => setParam('place', null)}
        />
      )}
      {groupDraft && (
        <GroupDialog
          group={groupDraft}
          onClose={() => setGroupDraft(null)}
          onDeleted={(id) => groupId === id && setParam('group', null)}
          onCreated={(g) => setVisible.mutate({ id: g.id, visible: true })}
        />
      )}
      <Confirm
        open={!!removingGroup}
        title={`Delete "${removingGroup?.name}"?`}
        body={`This also deletes the ${removingGroup?.count ?? 0} ${removingGroup?.count === 1 ? 'place' : 'places'} in it.`}
        onClose={() => setRemovingGroup(null)}
        onConfirm={() =>
          removingGroup && removeGroup.mutate(removingGroup, { onSuccess: () => groupId === removingGroup.id && setParam('group', null) })
        }
      />
      {importing && (
        <ImportDialog
          groups={mineGroups}
          onClose={() => setImporting(false)}
          onDone={async (gid) => {
            // Turn the group on, then fit the map to its places once they're loaded.
            const g = groupById(gid)
            if (g && !g.visible) await setVisible.mutateAsync({ id: gid, visible: true })
            const fresh = await qc.fetchQuery({ ...visiblePinsQuery, staleTime: 0 })
            const pts = fresh.filter((p) => p.group_id === gid).map((p) => [p.latitude, p.longitude] as [number, number])
            if (pts.length) setFit({ key: Date.now(), points: pts })
          }}
        />
      )}
    </AppShell>
  )
}
