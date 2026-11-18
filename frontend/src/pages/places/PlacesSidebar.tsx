// The Places sidebar: groups (map visibility checkbox, select to filter, a menu of group actions, refresh,
// import, new group, show archived), then status, minimum rating and category filters with their counts.
import type { UseQueryResult } from '@tanstack/react-query'
import { SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, buttonClass, chipClass, ErrorBox, Menu, MenuItem, MenuSeparator, SkeletonRows, Switch } from '../../components/ui'
import { apiUrl } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { PlaceCategory } from '../../lib/types'
import { categoryIcon, type Group, STATUSES, useSaveGroup, useShowOnlyGroup } from './api'
import type { Counts } from './usePlaceFilters'

const tag = chipClass({ size: 'xs', className: 'ml-1.5' })

/** ⋯ menu of a group: show only, edit, public/private, export, archive, delete (owner actions only for owners). */
function GroupMenu({
  g,
  onOnly,
  onEdit,
  onDelete,
  onPatch,
}: {
  g: Group
  onOnly: () => void
  onEdit: () => void
  onDelete: () => void
  onPatch: (b: { is_public?: boolean; archived?: boolean }) => void
}) {
  const then = (close: () => void, fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <Menu
      align="end"
      label={`${g.name} options`}
      trigger={(p) => (
        <button
          {...p}
          type="button"
          className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })}
          aria-label={`${g.name} options`}
          title="Options"
        >
          <Icon name="more" size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          {!g.archived && (
            <MenuItem icon="map" onClick={then(close, onOnly)}>
              Show only this
            </MenuItem>
          )}
          {g.mine && (
            <MenuItem icon="edit" onClick={then(close, onEdit)}>
              Edit group
            </MenuItem>
          )}
          {g.mine && (
            <MenuItem icon={g.is_public ? 'shield' : 'users'} onClick={then(close, () => onPatch({ is_public: !g.is_public }))}>
              {g.is_public ? 'Make private' : 'Share with everyone (public)'}
            </MenuItem>
          )}
          <MenuItem icon="arrowUp" href={apiUrl(`places/groups/${g.id}/export`)} onClick={close}>
            Export GeoJSON
          </MenuItem>
          {g.mine && (
            <MenuItem icon="folder" onClick={then(close, () => onPatch({ archived: !g.archived }))}>
              {g.archived ? 'Unarchive' : 'Archive'}
            </MenuItem>
          )}
          {g.mine && (
            <>
              <MenuSeparator />
              <MenuItem icon="trash" danger onClick={then(close, onDelete)}>
                Delete group…
              </MenuItem>
            </>
          )}
        </>
      )}
    </Menu>
  )
}

export function PlacesSidebar({
  groups,
  refreshing,
  groupId,
  category,
  status,
  minRating,
  total,
  counts,
  categories,
  showArchived,
  setShowArchived,
  setParam,
  onAllPlaces,
  onRefresh,
  onImport,
  onNewGroup,
  onEditGroup,
  onDeleteGroup,
  onVisible,
  onSelectGroup,
}: {
  groups: UseQueryResult<Group[]>
  refreshing: boolean
  groupId?: number
  category?: string
  status?: string
  minRating: number
  /** Places in the selected group (or all groups that are on). */
  total: number
  counts: Counts
  categories: PlaceCategory[]
  showArchived: boolean
  setShowArchived: (v: boolean) => void
  setParam: (k: string, v: string | null) => void
  onAllPlaces: () => void
  onRefresh: () => void
  onImport: () => void
  onNewGroup: () => void
  onEditGroup: (g: Group) => void
  onDeleteGroup: (g: Group) => void
  onVisible: (g: Group, visible: boolean) => void
  onSelectGroup: (g: Group) => void
}) {
  const showOnly = useShowOnlyGroup()
  const saveGroup = useSaveGroup()
  const patch = (g: Group, body: { is_public?: boolean; archived?: boolean }) =>
    saveGroup.mutate(
      { id: g.id, body },
      {
        onSuccess: () =>
          toast.show(
            body.archived === true
              ? `Archived "${g.name}"`
              : body.archived === false
                ? `Unarchived "${g.name}"`
                : body.is_public
                  ? `"${g.name}" is public`
                  : `"${g.name}" is private`,
          ),
      },
    )
  const sortedCategories = categories.map((c) => ({ c, n: counts.category.get(c.key) ?? 0 })).sort((a, b) => b.n - a.n)
  return (
    <>
      <SideSection
        title="Groups"
        action={
          <span className="flex items-center">
            <Button variant="ghost" size="sm" icon onClick={onRefresh} aria-label="Refresh" title="Refresh">
              <Icon name="refresh" size={14} className={refreshing ? 'animate-[spin_0.9s_linear_infinite]' : undefined} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              onClick={onImport}
              aria-label="Import places"
              title="Import (GeoJSON, KML, GPX, Google Takeout, CSV)"
            >
              <Icon name="arrowDown" size={14} />
            </Button>
            <Button variant="ghost" size="sm" icon onClick={onNewGroup} aria-label="New group" title="New group">
              <Icon name="plus" size={14} />
            </Button>
          </span>
        }
      >
        {groups.isPending ? (
          <SkeletonRows rows={2} />
        ) : groups.error && !groups.data ? (
          <ErrorBox error={groups.error} retry={() => groups.refetch()} />
        ) : !groups.data?.length ? (
          <p className="px-3 py-1 text-xs text-muted">No groups yet. Use + to create one.</p>
        ) : (
          groups.data.map((g) => {
            const shown = g.visible && !g.archived
            return (
              // The row restyles SideItem's shared .side-item (unlayered CSS, hence the !): room for the checkbox
              // and the menu, the folder glyph swapped for the checkbox, dimmed while the group is off.
              <div
                key={g.id}
                className={cn(
                  'group/row relative [&>.side-item]:pr-8! [&>.side-item]:pl-7! [&>.side-item>svg:first-child]:hidden',
                  'hover:[&_.side-count]:invisible touch:[&_.side-count]:invisible',
                  !shown && '[&>.side-item]:opacity-50',
                )}
              >
                <input
                  type="checkbox"
                  className="absolute top-1/2 left-2 z-1 m-0 -translate-y-1/2 cursor-pointer accent-accent"
                  checked={shown}
                  disabled={g.archived}
                  onChange={(e) => onVisible(g, e.target.checked)}
                  aria-label={`Show ${g.name} on the map`}
                  title={g.archived ? 'Archived: unarchive to show it' : g.visible ? 'Shown: hide from the map' : 'Hidden: show on the map'}
                />
                <SideItem
                  icon="folder"
                  label={
                    <>
                      {g.name}
                      {g.archived && <span className={tag}>Archived</span>}
                      {g.is_public && <span className={tag}>Public</span>}
                      {!g.mine && <span className={tag}>Shared</span>}
                    </>
                  }
                  count={g.count}
                  active={groupId === g.id}
                  onClick={() => onSelectGroup(g)}
                />
                <span className="absolute top-1/2 right-0.5 flex -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 touch:opacity-100">
                  <GroupMenu
                    g={g}
                    onOnly={() => showOnly.mutate(g)}
                    onEdit={() => onEditGroup(g)}
                    onDelete={() => onDeleteGroup(g)}
                    onPatch={(body) => patch(g, body)}
                  />
                </span>
              </div>
            )
          })
        )}
        <div>
          <Switch checked={showArchived} onChange={setShowArchived} label="Show archived groups" />
        </div>
      </SideSection>
      <SideSection>
        <SideItem icon="map" label="All places" count={total} active={!category && !status && !minRating} onClick={onAllPlaces} />
        {STATUSES.map((s) => (
          <SideItem
            key={s.key}
            icon={s.icon}
            label={s.label}
            count={counts.status[s.key]}
            active={status === s.key}
            onClick={() => setParam('status', status === s.key ? null : s.key)}
          />
        ))}
      </SideSection>
      <SideSection title="Rating">
        <fieldset className="m-0 flex flex-wrap gap-1 border-0 px-2 py-0.5" aria-label="Minimum rating">
          {([0, 3, 4, 5] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={cn(
                chipClass({ tone: minRating === r ? 'accent' : 'neutral' }),
                'h-6! cursor-pointer gap-1.5',
                minRating !== r && 'hover:text-fg',
              )}
              aria-pressed={minRating === r}
              onClick={() => setParam('rating', r ? String(r) : null)}
            >
              {r ? `${r}★${r < 5 ? '+' : ''}` : 'Any'}
              <span className="text-muted">{r ? counts.rating[r] : total}</span>
            </button>
          ))}
        </fieldset>
      </SideSection>
      <SideSection title="Categories">
        {sortedCategories.map(({ c, n }) => (
          <SideItem
            key={c.key}
            icon={categoryIcon(c.key) ?? 'map-pin'}
            label={c.label}
            count={n || undefined}
            active={category === c.key}
            onClick={() => setParam('category', category === c.key ? null : c.key)}
          />
        ))}
      </SideSection>
    </>
  )
}
