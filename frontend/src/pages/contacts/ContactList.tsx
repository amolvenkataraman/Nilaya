// The people list: a heading (or the bulk bar while some are selected), rows under letter headings, and the
// empty states. Each row has two targets: the avatar toggles selection, the rest opens the contact (or toggles
// too, once something is selected).
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { Avatar, Button, buttonClass, ErrorBox, Menu, MenuItem, MenuSeparator, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { fmtDate, parseDayKey } from '../../lib/dates'
import { avatarSrc, exportHref, type Filter, type PersonBrief, type Tag } from './api'
import { Chip } from './Chip'
import { letterGroups } from './contactGroups'
import { fmtBirthday } from './personFields'

export interface ContactListProps {
  title: ReactNode
  items: PersonBrief[] | undefined
  total: number | undefined
  pending: boolean
  error: unknown
  filter: Filter
  /** Something narrows the list (a search, a filter, a tag or group): changes the empty message. */
  narrowed: boolean
  search: string
  activeId: string | null
  /** The tag or group being shown, for its menu. */
  label?: Tag
  selected: Set<string>
  onSelect: (ids: Set<string>) => void
  onOpen: (id: string) => void
  onNew: () => void
  onImport: () => void
  onMerge: (people: PersonBrief[]) => void
  onDeleteSelected: () => void
  onRenameLabel: (t: Tag) => void
  onDeleteLabel: (t: Tag) => void
}

// `sticky` isn't generated (an older stylesheet owns that class name, see tailwind.css), hence sticky.
export function ContactList(props: ContactListProps) {
  const { items, filter, search, activeId, selected, onSelect } = props
  const list = useRef<HTMLElement>(null)
  // Letter headings only where the list is in name order (not search results, due dates, birthdays or newest first).
  const letters = !search && (filter === '' || filter === 'favorites')
  const groups = useMemo(() => letterGroups(items ?? [], filter === 'overdue'), [items, filter])
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    onSelect(next)
  }
  useEffect(() => {
    if (activeId) list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <section ref={list} className="overflow-y-auto border-r border-border bg-surface pb-4 max-md:border-r-0" aria-label="People">
      {selected.size > 0 ? <BulkBar {...props} /> : <ListHead {...props} />}
      {props.pending ? (
        <SkeletonRows rows={8} avatar />
      ) : props.error && !items ? (
        <ErrorBox error={props.error} />
      ) : !items?.length ? (
        <div className="grid content-center justify-items-center gap-3 px-4 py-12 text-center text-sm text-muted">
          <Icon name="users" size={28} />
          <p>{search ? `Nobody matches "${search}".` : props.narrowed ? 'Nobody here yet.' : 'No contacts yet.'}</p>
          {!props.narrowed && (
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={props.onNew}>
                <Icon name="plus" size={14} />
                Add a contact
              </Button>
              <Button onClick={props.onImport}>Import a file</Button>
            </div>
          )}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.letter}>
            {letters && (
              <div
                className="sticky top-0 z-1 border-b border-border bg-surface px-4 py-1 text-xs font-semibold text-muted"
                aria-hidden="true"
              >
                {g.letter}
              </div>
            )}
            {g.items.map((p) => (
              <Row
                key={p.id}
                p={p}
                filter={filter}
                active={p.id === activeId}
                on={selected.has(p.id)}
                selecting={selected.size > 0}
                onToggle={() => toggle(p.id)}
                onOpen={() => props.onOpen(p.id)}
              />
            ))}
          </div>
        ))
      )}
      {!!items?.length && props.total !== undefined && props.total > items.length && (
        <p className="px-4 py-3 text-center text-xs text-muted">
          Showing {items.length.toLocaleString()} of {props.total.toLocaleString()}. Search to narrow down.
        </p>
      )}
    </section>
  )
}

function ListHead({ title, total, label, items, onSelect, onRenameLabel, onDeleteLabel }: ContactListProps) {
  const kind = label?.kind === 'group' ? 'Group' : 'Tag'
  return (
    <div className="flex items-baseline gap-2 px-4 pt-4 pb-2">
      <h1 className="min-w-0 flex-auto truncate">{title}</h1>
      {total !== undefined && <span className="text-sm text-muted tabular-nums">{total}</span>}
      {label && (
        <Menu
          align="end"
          label={`${kind} actions`}
          trigger={(t) => (
            <button {...t} className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })} aria-label={`${kind} actions`}>
              <Icon name="more" size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon="check"
                onClick={() => {
                  close()
                  onSelect(new Set(items?.map((p) => p.id)))
                }}
              >
                Select everyone
              </MenuItem>
              <MenuItem
                icon="edit"
                onClick={() => {
                  close()
                  onRenameLabel(label)
                }}
              >
                Rename {label.kind}…
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon="trash"
                danger
                onClick={() => {
                  close()
                  onDeleteLabel(label)
                }}
              >
                Delete {label.kind}…
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </div>
  )
}

function BulkBar({ items, selected, onSelect, onMerge, onDeleteSelected }: ContactListProps) {
  const all = !!items?.length && items.every((p) => selected.has(p.id))
  const ids = [...selected]
  // The downloads read as content here, so they keep the body colour of the selection count.
  const link = buttonClass({ variant: 'ghost', size: 'sm', className: 'text-fg! hover:no-underline' })
  return (
    <div
      className="sticky top-0 z-2 flex min-h-13 items-center gap-1 border-b border-border bg-surface pt-2.5 pr-3 pb-2 pl-[1.0625rem]"
      role="toolbar"
      aria-label="Selected contacts"
    >
      <input
        type="checkbox"
        className="m-0 mr-2 size-4"
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = !all
        }}
        aria-label={all ? 'Clear selection' : 'Select all'}
        onChange={() => onSelect(all ? new Set() : new Set(items?.map((p) => p.id)))}
      />
      <strong className="min-w-0 flex-auto text-sm tabular-nums">{selected.size} selected</strong>
      <a className={link} href={exportHref('vcf', ids)} download title="Download as vCard">
        vCard
      </a>
      <a className={link} href={exportHref('csv', ids)} download title="Download as CSV">
        CSV
      </a>
      {selected.size > 1 && (
        <Button
          variant="ghost"
          size="sm"
          title="Merge into one contact"
          onClick={() => onMerge(items?.filter((p) => selected.has(p.id)) ?? [])}
        >
          Merge
        </Button>
      )}
      <Button variant="ghost" size="sm" icon aria-label="Delete selected" title="Delete" onClick={onDeleteSelected}>
        <Icon name="trash" size={14} />
      </Button>
      <Button variant="ghost" size="sm" icon aria-label="Clear selection" title="Clear selection" onClick={() => onSelect(new Set())}>
        <Icon name="x" size={14} />
      </Button>
    </div>
  )
}

function Row({
  p,
  filter,
  active,
  on,
  selecting,
  onToggle,
  onOpen,
}: {
  p: PersonBrief
  filter: Filter
  active: boolean
  on: boolean
  selecting: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const sub =
    filter === 'overdue' || filter === 'kit'
      ? p.next_due
        ? `Due ${fmtDate(parseDayKey(p.next_due))}`
        : 'No catch-up scheduled'
      : filter === 'birthdays' && p.birthday
        ? `Birthday ${fmtBirthday(p.birthday)}`
        : [p.title, p.company].filter(Boolean).join(' · ') || p.email || p.phone
  return (
    <div
      data-active={active || undefined}
      className={cn(
        'flex w-full items-center pr-4 pl-3 text-fg',
        on ? 'bg-[color-mix(in_srgb,var(--app-accent)_9%,transparent)]' : active ? 'bg-accent-soft' : 'hover:bg-hover',
      )}
    >
      {/* The avatar is the row's checkbox (as in mail apps): a real checkbox wouldn't show the photo. */}
      {/* biome-ignore lint/a11y/useSemanticElements: see above */}
      <button
        type="button"
        className="group relative grid flex-none place-items-center rounded-full border-0 bg-transparent p-1"
        role="checkbox"
        aria-checked={on}
        aria-label={`Select ${p.name || 'contact'}`}
        onClick={onToggle}
      >
        <Avatar name={p.name} src={avatarSrc(p)} size={2} />
        <span
          className={cn(
            'absolute inset-1 grid place-items-center rounded-full border-[1.5px] transition-opacity',
            on
              ? 'border-accent bg-accent text-accent-fg opacity-100'
              : cn(
                  'border-[color-mix(in_srgb,var(--app-muted)_70%,transparent)] bg-surface text-transparent',
                  selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                ),
          )}
          aria-hidden="true"
        >
          <Icon name="check" size={12} />
        </span>
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent py-2 pr-0 pl-2 text-left text-inherit"
        onClick={selecting ? onToggle : onOpen}
      >
        <span className="grid min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
            {p.name || 'Unnamed'}
            {p.favorite && <Icon name="star" size={12} className="flex-none fill-current text-warning" />}
          </span>
          <span className="truncate text-xs text-muted">{sub}</span>
        </span>
        {p.profile_links.length > 0 && (
          <span
            className="inline-flex flex-none items-center gap-0.75 text-xs text-muted"
            title={p.profile_links.map((l) => `${l.label}: ${l.handle}`).join('\n')}
          >
            <Icon name="link" size={12} />
            {p.profile_links.length}
          </span>
        )}
        {p.overdue && <Chip tone="warning">Reach out</Chip>}
      </button>
    </div>
  )
}
