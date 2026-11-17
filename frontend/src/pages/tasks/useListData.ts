// The rows behind the list, table and timeline layouts: the list's paged query, the "Completed" section's
// paged query and the timeline's bigger pages (followed up to a bound), with tasks deleted inside the undo
// window filtered out. Params are kept by value, so the memos downstream hit until the query really changes.
import { useEffect, useMemo } from 'react'
import { useTaskPages, type TaskQuery } from '../../lib/queries'
import type { TaskState } from '../../lib/qs'
import { listItems, listTotal } from '../../lib/taskLists'
import type { Overview, SavedView } from '../../lib/types'
import { completedParams, listParams, TIMELINE_PAGES, timelineParams, withFilters, type ExtraFilters } from './params'
import type { LayoutName } from './useTasksUrl'

/** `value`, kept identical while it's equal by content (query params are plain JSON). */
function useStable<T>(value: T): T {
  const key = JSON.stringify(value)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by content on purpose
  return useMemo(() => value, [key])
}

export function useListData({
  state,
  layout,
  filters,
  sortChosen,
  showCompleted,
  overview,
  saved,
  hidden,
}: {
  state: TaskState
  layout: LayoutName
  filters: ExtraFilters
  sortChosen: boolean
  showCompleted: boolean
  overview: Overview | undefined
  saved: SavedView | undefined
  hidden: Set<string>
}) {
  const rows = layout === 'list' || layout === 'table'
  const base = listParams(state, overview, saved, sortChosen)
  const params = useStable<TaskQuery | null>(base && withFilters(base, filters))
  const tlParams = useMemo(() => (params ? timelineParams(params) : null), [params])
  const doneParams = useMemo(
    () => (params && state.view !== 'done' && showCompleted && rows ? completedParams(params) : null),
    [params, state.view, showCompleted, rows],
  )

  const tasks = useTaskPages(params ?? {}, !!params && rows)
  const timeline = useTaskPages(tlParams ?? {}, !!tlParams && layout === 'timeline')
  const done = useTaskPages(doneParams ?? {}, !!doneParams)

  // The timeline needs every dated task of the list: follow its pages (bounded).
  const tlPages = timeline.data?.pages.length ?? 0
  const { hasNextPage: tlMore, isFetchingNextPage: tlFetching, fetchNextPage: tlNext } = timeline
  useEffect(() => {
    if (layout === 'timeline' && tlMore && !tlFetching && tlPages < TIMELINE_PAGES) tlNext()
  }, [layout, tlMore, tlFetching, tlPages, tlNext])

  const items = useMemo(() => listItems(tasks.data).filter((t) => !hidden.has(t.id)), [tasks.data, hidden])
  const open = useMemo(() => items.filter((t) => !t.done), [items])
  const doneList = useMemo(() => listItems(done.data).filter((t) => !hidden.has(t.id)), [done.data, hidden])
  const tlItems = useMemo(() => listItems(timeline.data).filter((t) => !hidden.has(t.id)), [timeline.data, hidden])

  return {
    params,
    doneParams,
    tasks,
    timeline,
    done,
    items,
    total: listTotal(tasks.data) ?? items.length,
    open,
    doneList,
    doneTotal: listTotal(done.data),
    tlItems,
  }
}

export type ListData = ReturnType<typeof useListData>
