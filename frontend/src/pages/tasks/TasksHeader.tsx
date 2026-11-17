// The list's title block: colour dot or saved-view icon, name, row count, "Shared", progress ("10 open ·
// 2 done", "3 of 12 done today"), the project's description, and the actions on the right (focus mode,
// share, the project or saved view menu, the shortcuts help).
import type { ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { Ring } from '../../components/TaskRow'
import { Button, chipClass } from '../../components/ui'
import { cn } from '../../lib/cn'
import type { Project } from '../../lib/types'
import { BtnLabel, toggledOn } from './TasksToolbar'

export function TasksHeader({
  title,
  project,
  savedView,
  count,
  progress,
  focus,
  onFocus,
  onShare,
  menu,
  onHelp,
}: {
  title: string
  project?: Project
  savedView: boolean
  /** Rows in the list, once loaded (list and table). */
  count?: number
  /** The progress line: [percent, text, tooltip]. */
  progress?: [number, string, string?]
  /** Focus mode, when the layout offers it. */
  focus?: boolean
  onFocus?: () => void
  onShare: () => void
  /** The project or saved-view menu. */
  menu?: ReactNode
  onHelp: () => void
}) {
  const real = project && !project.is_inbox
  return (
    <header className="mb-3 flex min-h-8 items-center gap-2 max-md:flex-wrap">
      <div className="min-w-0 flex-auto">
        <h1 className={cn('flex min-w-0 items-center gap-2', focus ? 'text-xl' : 'text-lg')}>
          {real && (
            <span aria-hidden="true" className="size-3 flex-none rounded-xs" style={{ background: project.colour || 'var(--app-muted)' }} />
          )}
          {savedView && <Icon name="filter" size={16} className="text-muted" />}
          <span className="truncate">{title}</span>
          {count != null && <span className="text-sm font-normal text-muted tabular-nums">{count.toLocaleString()}</span>}
          {real && project.shared && (
            <button
              type="button"
              className={cn(chipClass({ interactive: true }), 'gap-1 font-normal')}
              onClick={onShare}
              title="People with access"
            >
              <Icon name="users" size={11} />
              Shared
            </button>
          )}
        </h1>
        {progress && (
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted" title={progress[2]}>
            <Ring value={progress[0]} size={14} />
            {progress[1]}
          </p>
        )}
        {project?.description && <p className="truncate text-sm text-muted">{project.description}</p>}
      </div>
      {onFocus && (
        <Button size="sm" className={cn(focus && toggledOn)} aria-pressed={focus} onClick={onFocus} title="Focus mode (f)">
          <Icon name="target" size={14} />
          <BtnLabel>Focus</BtnLabel>
        </Button>
      )}
      {real && (
        <Button size="sm" onClick={onShare} title="Share">
          <Icon name="users" size={14} />
          <BtnLabel>Share</BtnLabel>
        </Button>
      )}
      {menu}
      <Button variant="ghost" size="sm" icon onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
        <Icon name="command" size={15} />
      </Button>
    </header>
  )
}
