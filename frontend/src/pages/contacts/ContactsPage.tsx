// Contacts: people list with smart filters, groups and tags (multi-select for bulk export/delete), a
// detail pane (?person=<id>) with contact info, photo, interactions and relationships, the full edit
// form, the import wizard and the merge-duplicates view (?view=duplicates). This file holds the page state
// that lives in the URL, the sidebar, the shortcuts and the dialogs; the panes are their own files.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell, SIDE_EMPTY, SideItem, SideSection, sideItemClass } from '../../components/AppShell'
import { Icon, type IconName } from '../../components/Icon'
import { layerOpen } from '../../components/layers'
import { toast } from '../../components/toast'
import { afterG, Button, Confirm, isTyping, SearchBox, useDebounced, useHotkey, useIsPhone } from '../../components/ui'
import { plural } from '../../lib/format'
import {
  exportHref,
  personQuery,
  useBulkDelete,
  useContactStats,
  useContactTags,
  useDeleteTag,
  usePeople,
  type ContactStats,
  type Filter,
  type PersonBrief,
  type PersonDetail,
  type Tag,
} from './api'
import { ContactList } from './ContactList'
import { ContactsOverview } from './ContactsOverview'
import { DuplicatesPane } from './Duplicates'
import { ImportDialog } from './ImportDialog'
import { LabelsDialog } from './LabelsDialog'
import { MergeManyDialog } from './MergeDialogs'
import { PersonForm } from './PersonForm'
import { PersonPane } from './PersonPane'
import { RemindersDialog } from './RemindersDialog'

type Count = { [K in keyof ContactStats]-?: ContactStats[K] extends number ? K : never }[keyof ContactStats]
const FILTERS: { id: Filter; label: string; icon: IconName; count: Count }[] = [
  { id: '', label: 'All contacts', icon: 'users', count: 'total' },
  { id: 'favorites', label: 'Favourites', icon: 'star', count: 'favorites' },
  { id: 'overdue', label: 'Reach out', icon: 'clock', count: 'overdue' },
  { id: 'kit', label: 'Keeping in touch', icon: 'repeat', count: 'keep_in_touch' },
  { id: 'recent', label: 'Recently added', icon: 'sparkle', count: 'recent' },
  { id: 'birthdays', label: 'Birthdays', icon: 'calendar', count: 'birthdays_this_month' },
]

export default function ContactsPage() {
  const [search, setSearch] = useSearchParams()
  const filter = (search.get('filter') ?? '') as Filter
  const tag = search.get('tag') ?? ''
  const group = search.get('group') ?? ''
  const personId = search.get('person')
  const view = search.get('view')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 250)
  const people = usePeople({
    q: dq || undefined,
    filter: filter || undefined,
    tag: tag || undefined,
    group: group || undefined,
    sort: filter === 'overdue' ? 'due' : 'name',
  })
  const stats = useContactStats().data
  const tags = useContactTags().data
  const [editing, setEditing] = useState<PersonDetail | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const bulkDelete = useBulkDelete()
  const deleteTag = useDeleteTag()
  const phone = useIsPhone()
  const qc = useQueryClient()
  const searchRef = useRef<HTMLInputElement>(null)
  const [labels, setLabels] = useState<{ edit: number | null } | null>(null)
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [mergingSel, setMergingSel] = useState<PersonBrief[] | null>(null)
  const [confirmTag, setConfirmTag] = useState<Tag | null>(null)

  useEffect(() => {
    if (search.get('new') === '1') setEditing('new')
  }, [search])
  // A selection belongs to the list it was made in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list's parameters are the trigger, not inputs
  useEffect(() => setSelected(new Set()), [filter, tag, group, dq])

  const go = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(search)
    for (const [k, v] of Object.entries(change)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    next.delete('new')
    setSearch(next)
  }
  const items = people.data?.items
  const currentTag = tag
    ? tags?.find((t) => t.kind === 'tag' && t.name.toLowerCase() === tag.toLowerCase())
    : group
      ? tags?.find((t) => t.kind === 'group' && t.name.toLowerCase() === group.toLowerCase())
      : undefined
  const openLabel = (t: Tag) => {
    setLabels(null)
    go(
      t.kind === 'group'
        ? { group: t.name, tag: null, filter: null, person: null, view: null }
        : { tag: t.name, group: null, filter: null, person: null, view: null },
    )
  }
  const labelRenamed = (t: Tag, name: string) => {
    if (t.kind === 'tag' && tag === t.name) go({ tag: name })
    if (t.kind === 'group' && group === t.name) go({ group: name })
  }
  const labelDeleted = (t: Tag) => {
    if ((t.kind === 'tag' && tag === t.name) || (t.kind === 'group' && group === t.name)) go({ tag: null, group: null })
  }

  // Keyboard (as in the classic page): / search, N new, J/K or arrows move, E edit, Esc clears search / closes on phones.
  const free = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !e.altKey && !afterG(e) && !layerOpen(['dialog', 'menu', 'palette'])
  useSlashFocus(searchRef, free)
  useHotkey(
    (e) => e.key === 'Escape' && e.target === searchRef.current,
    () => {
      setQ('')
      searchRef.current?.blur()
    },
    true,
  )
  useHotkey(free, (e) => {
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault()
      setEditing('new')
    } else if ((e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && items?.length) {
      e.preventDefault()
      const d = e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1
      const i = items.findIndex((p) => p.id === personId)
      const next = i < 0 ? (d > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + d))
      go({ person: items[next].id, view: null })
    } else if (e.key === 'e' && personId) {
      const p = qc.getQueryData(personQuery(personId).queryKey)
      if (p) {
        e.preventDefault()
        setEditing(p)
      }
    } else if (e.key === 'Escape' && phone && (personId || view)) {
      go({ person: null, view: null })
    }
  })

  const sidebar = (
    <>
      <SideSection>
        {FILTERS.map((f) => (
          <SideItem
            key={f.id}
            icon={f.icon}
            label={f.label}
            active={filter === f.id && !tag && !group && !view}
            count={stats?.[f.count]}
            onClick={() => go({ filter: f.id || null, tag: null, group: null, person: null, view: null })}
          />
        ))}
      </SideSection>
      {tags?.some((t) => t.kind === 'group') && (
        <SideSection title="Groups">
          {tags
            .filter((t) => t.kind === 'group')
            .map((t) => (
              <SideItem
                key={t.id}
                icon="folder"
                label={t.name}
                count={t.count}
                active={group === t.name && !view}
                onClick={() => go({ group: t.name, tag: null, filter: null, person: null, view: null })}
              />
            ))}
        </SideSection>
      )}
      <SideSection title="Tags">
        {!tags?.some((t) => t.kind === 'tag') && <div className={SIDE_EMPTY}>No tags yet.</div>}
        {tags
          ?.filter((t) => t.kind === 'tag')
          .map((t) => (
            <SideItem
              key={t.id}
              icon="tag"
              label={t.name}
              count={t.count}
              active={tag === t.name && !view}
              onClick={() => go({ tag: t.name, group: null, filter: null, person: null, view: null })}
            />
          ))}
      </SideSection>
      <SideSection title="Tools">
        <SideItem icon="arrowDown" label="Import…" onClick={() => setImporting(true)} />
        <SideItem
          icon="users"
          label="Merge duplicates"
          active={view === 'duplicates'}
          onClick={() => go({ view: 'duplicates', person: null })}
        />
        <ExportItem format="vcf" label="Export all (vCard)" />
        <ExportItem format="csv" label="Export all (CSV)" />
        <SideItem icon="tag" label="Tags and groups…" onClick={() => setLabels({ edit: null })} />
        <SideItem icon="bell" label="Reminders…" onClick={() => setRemindersOpen(true)} />
      </SideSection>
    </>
  )
  const topbar = (
    <div className="flex w-full items-center gap-2">
      <SearchBox
        ref={searchRef}
        className="w-[min(20rem,100%)]"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, email, company, tag"
        aria-label="Search people"
        maxLength={100}
        title="Search (/)"
      />
      <Button variant="primary" size="sm" onClick={() => setEditing('new')} title="New contact (N)">
        <Icon name="plus" size={14} />
        <span className="max-md:hidden">New contact</span>
      </Button>
    </div>
  )
  const showList = !(phone && (personId || view))
  const title = view === 'duplicates' && phone ? '' : tag ? `#${tag}` : group || FILTERS.find((f) => f.id === filter)?.label

  return (
    <AppShell app="contacts" topbar={topbar} sidebar={sidebar} fullHeight>
      <div className="grid h-full min-h-0 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] max-md:grid-cols-[minmax(0,1fr)] min-[1800px]:grid-cols-[minmax(22rem,30rem)_minmax(0,1fr)]">
        {showList && (
          <ContactList
            title={title}
            items={items}
            total={people.data?.total}
            pending={people.isPending}
            error={people.error}
            filter={filter}
            narrowed={!!(dq || filter || tag || group)}
            search={dq}
            activeId={view ? null : personId}
            label={view ? undefined : currentTag}
            selected={selected}
            onSelect={setSelected}
            onOpen={(id) => go({ person: id, view: null })}
            onNew={() => setEditing('new')}
            onImport={() => setImporting(true)}
            onMerge={setMergingSel}
            onDeleteSelected={() => setConfirmBulk(true)}
            onRenameLabel={(t) => setLabels({ edit: t.id })}
            onDeleteLabel={setConfirmTag}
          />
        )}
        {view === 'duplicates' ? (
          <DuplicatesPane onOpen={(id) => go({ person: id, view: null })} onBack={() => go({ view: null })} />
        ) : personId ? (
          <PersonPane id={personId} onClose={() => go({ person: null })} onEdit={setEditing} onOpen={(id) => go({ person: id })} />
        ) : !phone ? (
          <ContactsOverview stats={stats} onOpen={(id) => go({ person: id })} onImport={() => setImporting(true)} />
        ) : null}
      </div>
      <PersonForm
        open={editing !== null}
        person={editing === 'new' ? null : editing}
        onClose={() => {
          setEditing(null)
          if (search.get('new')) go({})
        }}
        onSaved={(p) => {
          toast.show(editing === 'new' ? `Added ${p.name || 'contact'}` : 'Saved')
          go({ person: p.id, view: null })
        }}
      />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <LabelsDialog
        open={!!labels}
        startEditing={labels?.edit}
        onClose={() => setLabels(null)}
        onRenamed={labelRenamed}
        onDeleted={labelDeleted}
        onOpen={openLabel}
      />
      <RemindersDialog open={remindersOpen} onClose={() => setRemindersOpen(false)} />
      {mergingSel && (
        <MergeManyDialog
          people={mergingSel}
          onClose={() => setMergingSel(null)}
          onMerged={(p) => {
            setSelected(new Set())
            go({ person: p.id, view: null })
          }}
        />
      )}
      <Confirm
        open={!!confirmTag}
        title={`Delete ${confirmTag?.kind ?? 'tag'} “${confirmTag?.name ?? ''}”?`}
        body="The contacts stay; only the label is removed from them."
        onConfirm={() =>
          confirmTag &&
          deleteTag.mutate(confirmTag.id, {
            onSuccess: () => {
              toast.show(`Deleted ${confirmTag.name}`)
              labelDeleted(confirmTag)
            },
          })
        }
        onClose={() => setConfirmTag(null)}
      />
      <Confirm
        open={confirmBulk}
        title={`Delete ${plural(selected.size, 'contact')}?`}
        body="Their interactions and relationships are deleted too. This can't be undone."
        onConfirm={() => {
          const ids = [...selected]
          bulkDelete.mutate(ids, {
            onSuccess: () => {
              if (personId && selected.has(personId)) go({ person: null })
              setSelected(new Set())
              toast.show(`Deleted ${plural(ids.length, 'contact')}`)
            },
          })
        }}
        onClose={() => setConfirmBulk(false)}
      />
    </AppShell>
  )
}

/** A sidebar row that downloads every contact in one format (SideItem has no download link). */
function ExportItem({ format, label }: { format: 'vcf' | 'csv'; label: string }) {
  return (
    <a className={sideItemClass()} href={exportHref(format)} download>
      <Icon name="arrowUp" size={16} />
      <span className="min-w-0 flex-auto">{label}</span>
    </a>
  )
}

/**
 * "/" focuses the contacts search instead of opening the app-wide palette (Ctrl+K still opens that). This one
 * listens in the capture phase: the palette's hotkey is registered first (Shell mounts before the page), so a
 * normal hotkey would run after it.
 */
function useSlashFocus(input: RefObject<HTMLInputElement | null>, free: (e: KeyboardEvent) => boolean) {
  const freeRef = useRef(free)
  freeRef.current = free
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== '/' || isTyping(e) || !freeRef.current(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      input.current?.focus()
      input.current?.select()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [input])
}
