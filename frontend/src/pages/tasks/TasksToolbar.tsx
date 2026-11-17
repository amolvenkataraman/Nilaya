// The row under the list title: the layout switch, Filter (priority, labels, assignee), Group, Sort,
// Completed, Save / Update view, and the active filters as removable chips below it.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Chip, Dot, fieldClass, Menu, MenuItem, MenuLabel, MenuSeparator, Segmented, type SegmentOption } from '../../components/ui'
import { cn } from '../../lib/cn'
import type { Sort } from '../../lib/qs'
import { PRIORITIES, type Label } from '../../lib/types'
import type { Grouping, LayoutName, TasksUrl } from './useTasksUrl'

const SORT_LABELS: Record<Sort, string> = {
  position: 'Manual',
  due: 'Due date',
  priority: 'Priority',
  created: 'Newest',
  updated: 'Recently updated',
  title: 'Title',
}
const PRIO_FILTERS: [number, string][] = [
  [0, 'Any priority'],
  [5, 'Low and up'],
  [10, 'Medium and up'],
  [15, 'High and up'],
  [20, 'Urgent'],
]
const GROUPS: [Grouping, string, string][] = [
  ['auto', 'Automatic', 'Group'],
  ['due', 'Due date', 'By due'],
  ['priority', 'Priority', 'By priority'],
  ['project', 'Project', 'By project'],
  ['none', 'No grouping', 'No groups'],
]

/** A toolbar toggle that is on (a filter applied, Completed shown, focus mode). */
export const toggledOn = 'border-accent! text-accent!'
/** Button text that phones drop (the icon stays). */
export const BtnLabel = ({ children }: { children: string }) => <span className="max-md:hidden">{children}</span>

/** Small "timeline" glyph for the layout switch (the shared icon set has none). */
export function TimelineIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={`${size / 16}rem`}
      height={`${size / 16}rem`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 6h9M8 12h11M6 18h8" />
    </svg>
  )
}

const layoutOption = (value: LayoutName, label: string, key: string, icon: string | null): SegmentOption<LayoutName> => ({
  value,
  title: `${label} (v ${key})`,
  label: (
    <>
      {icon ? <Icon name={icon} size={14} /> : <TimelineIcon />}
      <BtnLabel>{label}</BtnLabel>
    </>
  ),
})

export interface FilterChipInfo {
  key: string
  text: string
  colour?: string
  remove: () => void
}

export function TasksToolbar({
  url,
  layout,
  isProject,
  projectList,
  labels,
  me,
  sort,
  chips,
  canSaveView,
  canUpdateView,
  updatePending,
  onSaveView,
  onUpdateView,
}: {
  url: TasksUrl
  layout: LayoutName
  /** A real project (boards exist only there). */
  isProject: boolean
  /** A project or the inbox (manual order exists only there). */
  projectList: boolean
  labels?: Label[]
  me?: string
  /** The list's effective sort. */
  sort?: Sort
  chips: FilterChipInfo[]
  canSaveView: boolean
  canUpdateView: boolean
  updatePending: boolean
  onSaveView: () => void
  onUpdateView: () => void
}) {
  const { state, grouping, labelFilter, prioMin, assignee, showCompleted } = url
  const rows = layout === 'list' || layout === 'table'
  const notDone = state.view !== 'done'
  const options = [
    layoutOption('list', 'List', 'l', 'list'),
    ...(isProject ? [layoutOption('board', 'Board', 'b', 'board')] : []),
    layoutOption('table', 'Table', 't', 'layers'),
    layoutOption('calendar', 'Calendar', 'c', 'calendar'),
    layoutOption('timeline', 'Timeline', 'g', null),
  ]
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <Segmented label="Layout" value={layout} onChange={url.setLayout} options={options} />
        <span className="flex-1" />
        {layout !== 'board' && (
          <Menu
            align="end"
            label="Filter"
            width="16rem"
            trigger={(p) => (
              <Button {...p} size="sm" className={cn((labelFilter || prioMin || assignee) && toggledOn)}>
                <Icon name="filter" size={14} />
                <BtnLabel>Filter</BtnLabel>
                {chips.length ? ` · ${chips.length}` : ''}
              </Button>
            )}
          >
            {(close) => (
              <FilterMenu
                close={close}
                labels={labels}
                prioMin={prioMin}
                labelFilter={labelFilter}
                assignee={assignee}
                me={me}
                set={(k, v) => url.setKeys({ [k]: v })}
                clear={() => {
                  close()
                  url.clearFilters()
                }}
              />
            )}
          </Menu>
        )}
        {layout === 'list' && notDone && (
          <Menu
            align="end"
            label="Group"
            trigger={(p) => (
              <Button {...p} size="sm">
                <Icon name="layers" size={14} />
                <BtnLabel>{GROUPS.find(([k]) => k === grouping)?.[2] ?? 'Group'}</BtnLabel>
              </Button>
            )}
          >
            {(close) =>
              GROUPS.map(([k, l]) => (
                <MenuItem
                  key={k}
                  active={grouping === k}
                  end={grouping === k ? '✓' : undefined}
                  onClick={() => {
                    close()
                    url.setKeys({ group: k === 'auto' ? null : k })
                  }}
                >
                  {l}
                </MenuItem>
              ))
            }
          </Menu>
        )}
        {rows && notDone && (
          <Menu
            align="end"
            label="Sort"
            trigger={(p) => (
              <Button {...p} size="sm">
                <Icon name="sort" size={14} />
                <BtnLabel>{SORT_LABELS[sort ?? state.sort] ?? 'Sort'}</BtnLabel>
              </Button>
            )}
          >
            {(close) =>
              (Object.keys(SORT_LABELS) as Sort[])
                .filter((s) => s !== 'position' || projectList)
                .map((s) => (
                  <MenuItem
                    key={s}
                    active={s === sort}
                    end={s === sort ? '✓' : undefined}
                    onClick={() => {
                      close()
                      url.setSort(s)
                    }}
                  >
                    {SORT_LABELS[s]}
                  </MenuItem>
                ))
            }
          </Menu>
        )}
        {rows && notDone && (
          <Button
            size="sm"
            className={cn(showCompleted && toggledOn)}
            aria-pressed={showCompleted}
            onClick={() => url.setKeys({ done: showCompleted ? null : '1' })}
            title="Show completed tasks"
          >
            <Icon name="check" size={14} />
            <BtnLabel>Completed</BtnLabel>
          </Button>
        )}
        {canSaveView && (
          <Button size="sm" variant="primary" onClick={onSaveView}>
            Save view
          </Button>
        )}
        {canUpdateView && (
          <Button size="sm" variant="primary" onClick={onUpdateView} disabled={updatePending}>
            Update view
          </Button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="-mt-1 mb-2.5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Chip key={c.key} className="gap-1.25 pr-0.5">
              {c.colour && <Dot colour={c.colour} />}
              {c.text}
              <button
                type="button"
                className="inline-flex rounded-full border-0 bg-transparent p-0.5 text-muted hover:bg-hover hover:text-fg"
                onClick={c.remove}
                aria-label={`Remove filter ${c.text}`}
              >
                <Icon name="x" size={11} />
              </button>
            </Chip>
          ))}
        </div>
      )}
    </>
  )
}

function FilterMenu({
  close,
  labels,
  prioMin,
  labelFilter,
  assignee,
  me,
  set,
  clear,
}: {
  close: () => void
  labels?: Label[]
  prioMin: number
  labelFilter: string
  assignee: string
  me?: string
  set: (k: 'prio' | 'label' | 'assignee', v: string | null) => void
  clear: () => void
}) {
  const [who, setWho] = useState(assignee && assignee !== me ? assignee : '')
  const pick = (k: 'prio' | 'assignee', v: string | null) => {
    close()
    set(k, v)
  }
  return (
    <>
      <MenuLabel>Priority</MenuLabel>
      {PRIO_FILTERS.map(([v, l]) => (
        <MenuItem key={v} active={prioMin === v} end={prioMin === v ? '✓' : undefined} onClick={() => pick('prio', v ? String(v) : null)}>
          {l}
        </MenuItem>
      ))}
      {labels && labels.length > 0 && <MenuLabel>Labels (all of)</MenuLabel>}
      {labels?.map((l) => {
        const on = labelFilter.split(',').includes(String(l.id))
        return (
          <MenuItem
            key={l.id}
            active={on}
            end={on ? '✓' : undefined}
            onClick={() => {
              const ids = labelFilter ? labelFilter.split(',').filter(Boolean) : []
              set('label', (on ? ids.filter((x) => x !== String(l.id)) : [...ids, String(l.id)]).join(',') || null)
            }}
          >
            <span className="flex items-center gap-2">
              <Dot colour={l.colour} />
              {l.name}
            </span>
          </MenuItem>
        )
      })}
      <MenuLabel>Assignee</MenuLabel>
      <MenuItem active={!assignee} end={!assignee ? '✓' : undefined} onClick={() => pick('assignee', null)}>
        Anyone
      </MenuItem>
      {me && (
        <MenuItem active={assignee === me} end={assignee === me ? '✓' : undefined} onClick={() => pick('assignee', me)}>
          Me
        </MenuItem>
      )}
      <form
        className="grid gap-1.5 px-2 pt-1.5 pb-2"
        onSubmit={(e) => {
          e.preventDefault()
          pick('assignee', who.trim().replace(/^@/, '') || null)
        }}
      >
        <input
          className={cn(fieldClass.input, 'h-7.5! min-w-0 text-xs!')}
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="Username, then Enter"
          aria-label="Assignee username"
          maxLength={150}
        />
      </form>
      {labelFilter || prioMin || assignee ? (
        <>
          <MenuSeparator />
          <MenuItem icon="x" onClick={clear}>
            Clear all filters
          </MenuItem>
        </>
      ) : null}
    </>
  )
}

/** The active filters as chips (priority, each label, assignee). */
export function filterChips(url: TasksUrl, labels: Label[] | undefined, me: string | undefined): FilterChipInfo[] {
  const chips: FilterChipInfo[] = []
  if (url.prioMin)
    chips.push({
      key: 'prio',
      text: `Priority ≥ ${PRIORITIES.find((p) => p.value === url.prioMin)?.label ?? url.prioMin}`,
      remove: () => url.setKeys({ prio: null }),
    })
  for (const id of url.labelIds) {
    const l = labels?.find((x) => String(x.id) === id)
    chips.push({
      key: `l${id}`,
      text: l?.name ?? 'Label',
      colour: l?.colour,
      remove: () => url.setKeys({ label: url.labelIds.filter((x) => x !== id).join(',') || null }),
    })
  }
  if (url.assignee)
    chips.push({
      key: 'as',
      text: `Assignee: ${url.assignee === me ? 'me' : url.assignee}`,
      remove: () => url.setKeys({ assignee: null }),
    })
  return chips
}
