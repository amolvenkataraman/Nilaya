// One contact (?person=<id>): photo, names and labels, every stored field as a definition list, keep-in-touch,
// notes, relationships and interactions, and when the record was added, updated and imported.
import { useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { toast } from '../../components/toast'
import {
  Avatar,
  Button,
  buttonClass,
  Chip,
  chipClass,
  Confirm,
  Menu,
  MenuItem,
  MenuSeparator,
  QueryView,
  Select,
  SkeletonRows,
} from '../../components/ui'
import { safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtDate, parseDayKey, shortStamp } from '../../lib/dates'
import {
  AVATAR_MAX,
  avatarSrc,
  exportHref,
  useAvatar,
  useContactMeta,
  useDeletePerson,
  usePerson,
  useSavePerson,
  type PersonDetail,
} from './api'
import { detailPane } from './detailPane'
import { Interactions } from './Interactions'
import { fmtBirthday, KIT, kitStatus } from './personFields'
import { Relationships } from './Relationships'
import { SectionLabel } from './SectionLabel'

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
const telHref = (v: string) => (/^[+\d][\d\s().-]{2,}$/.test(v) ? 'tel:' + v.replace(/[^\d+]/g, '') : null)
const preWrap = 'whitespace-pre-wrap wrap-anywhere'

export function PersonPane({
  id,
  onClose,
  onEdit,
  onOpen,
}: {
  id: string
  onClose: () => void
  onEdit: (p: PersonDetail) => void
  onOpen: (id: string) => void
}) {
  const person = usePerson(id)
  return (
    <QueryView
      query={person}
      skeleton={
        <section className={detailPane()}>
          <SkeletonRows rows={6} />
        </section>
      }
    >
      {(p) => <Person p={p} onClose={onClose} onEdit={onEdit} onOpen={onOpen} />}
    </QueryView>
  )
}

function Person({
  p,
  onClose,
  onEdit,
  onOpen,
}: {
  p: PersonDetail
  onClose: () => void
  onEdit: (p: PersonDetail) => void
  onOpen: (id: string) => void
}) {
  const save = useSavePerson()
  const remove = useDeletePerson()
  const avatar = useAvatar(p.id)
  const formats = useContactMeta().data?.import_formats
  const [confirm, setConfirm] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const profiles = p.profile_links.map((l) => ({ ...l, href: safeHref(l.url) }))
  const upload = (f: File | undefined) => {
    if (!f) return
    if (f.size > AVATAR_MAX) return toast.error('Photos can be up to 2 MB.')
    avatar.set.mutate(f, { onSuccess: () => toast.show('Photo updated') })
  }
  const importedFrom = p.sources.filter((x) => x !== 'manual').map((x) => formats?.[x] ?? x)
  return (
    <section className={detailPane()} aria-label={p.name}>
      <div className="flex items-center gap-1">
        {/* The list sits beside the pane on desktop; Back only matters on phones. */}
        <Button variant="ghost" size="sm" className="invisible max-md:visible" onClick={onClose}>
          <Icon name="chevronLeft" size={14} />
          Back
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon
          className={cn(p.favorite && 'text-warning! [&_svg]:fill-current')}
          aria-pressed={p.favorite}
          aria-label="Favourite"
          title={p.favorite ? 'Unfavourite' : 'Favourite'}
          onClick={() => save.mutate({ id: p.id, body: { favorite: !p.favorite } })}
        >
          <Icon name="star" />
        </Button>
        <Button size="sm" onClick={() => onEdit(p)}>
          <Icon name="edit" size={14} />
          Edit
        </Button>
        <Menu
          align="end"
          label="Contact actions"
          trigger={(t) => (
            <button {...t} className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })} aria-label="More actions">
              <Icon name="more" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon="camera"
                onClick={() => {
                  close()
                  fileInput.current?.click()
                }}
              >
                {p.has_avatar ? 'Change photo' : 'Add photo'}
              </MenuItem>
              {p.has_avatar && (
                <MenuItem
                  icon="x"
                  onClick={() => {
                    close()
                    avatar.remove.mutate(undefined, { onSuccess: () => toast.show('Photo removed') })
                  }}
                >
                  Remove photo
                </MenuItem>
              )}
              <MenuItem icon="arrowUp" href={exportHref('vcf', [p.id])} onClick={close}>
                Download vCard
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon="trash"
                danger
                onClick={() => {
                  close()
                  setConfirm(true)
                }}
              >
                Delete contact
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
      <header className="flex items-center gap-4">
        <button
          type="button"
          className="group relative flex-none rounded-full border-0 bg-transparent p-0"
          onClick={() => fileInput.current?.click()}
          aria-label={p.has_avatar ? 'Change photo' : 'Add photo'}
          title={p.has_avatar ? 'Change photo' : 'Add photo'}
          disabled={avatar.set.isPending}
        >
          <Avatar name={p.name} src={avatarSrc(p)} size={4} />
          <span
            className="absolute inset-0 grid place-items-center rounded-full bg-black/42 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:opacity-100"
            aria-hidden="true"
          >
            <Icon name="camera" size={16} />
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          hidden
          onChange={(e) => {
            upload(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <div className="min-w-0 flex-auto">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">{p.name || 'Unnamed'}</h2>
          {(p.title || p.company || p.department) && (
            <p className="text-sm text-muted">{[p.title, p.company, p.department].filter(Boolean).join(' · ')}</p>
          )}
          {p.nickname && <p className="text-xs text-muted">“{p.nickname}”</p>}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {p.groups.map((g) => (
              <Chip key={'g' + g}>
                <Icon name="folder" size={11} />
                {g}
              </Chip>
            ))}
            {p.tags.map((t) => (
              <Chip key={t}>#{t}</Chip>
            ))}
            {p.overdue && <Chip tone="warning">Time to reach out</Chip>}
          </div>
        </div>
      </header>

      <dl className="m-0 grid border-t border-border">
        {p.emails.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stored rows have no id and may repeat a value
          <Info key={'e' + i} icon="mail" label={e.label || 'Email'}>
            {EMAIL_RE.test(e.value) ? <a href={'mailto:' + e.value}>{e.value}</a> : e.value}
          </Info>
        ))}
        {p.phones.map((ph, i) => {
          const href = telHref(ph.value)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stored rows have no id and may repeat a value
            <Info key={'p' + i} icon="phone" label={ph.label || 'Phone'}>
              {href ? <a href={href}>{ph.value}</a> : ph.value}
            </Info>
          )
        })}
        {p.addresses.map((a, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stored rows have no id and may repeat a value
          <Info key={'a' + i} icon="pin" label={a.label || 'Address'} className={preWrap}>
            {[a.street, [a.city, a.region, a.postcode].filter(Boolean).join(', '), a.country].filter(Boolean).join('\n')}
          </Info>
        ))}
        {p.birthday && (
          <Info icon="gift" label="Birthday">
            {fmtBirthday(p.birthday)}
          </Info>
        )}
        {p.anniversary && (
          <Info icon="heart" label="Anniversary">
            {fmtBirthday(p.anniversary)}
          </Info>
        )}
        {p.links.map((l, i) => {
          const href = safeHref(l.url)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stored rows have no id and may repeat a value
            <Info key={'lk' + i} icon="link" label={l.label || 'Link'}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {l.url}
                </a>
              ) : (
                l.url
              )}
            </Info>
          )
        })}
        {p.custom_fields.map((f, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stored rows have no id and may repeat a key
          <Info key={'cf' + i} icon="info" label={f.key} className={preWrap}>
            {f.value}
          </Info>
        ))}
        <Info icon="clock" label="Last in touch">
          {p.last_contacted ? fmtDate(parseDayKey(p.last_contacted)) : <span className="text-muted">No interactions logged</span>}
          {p.keep_in_touch_days && p.next_due ? (
            <span className={p.overdue ? 'text-danger' : 'text-muted'}> · {kitStatus(p.next_due)}</span>
          ) : null}
        </Info>
        <Info icon="repeat" label={<label htmlFor="c-kit">Keep in touch</label>}>
          <Select
            id="c-kit"
            size="sm"
            width="content"
            className="max-w-full"
            value={p.keep_in_touch_days ?? 0}
            disabled={save.isPending}
            onChange={(e) => save.mutate({ id: p.id, body: { keep_in_touch_days: Number(e.target.value) || null } })}
          >
            {KIT.map(([d, l]) => (
              <option key={d} value={d}>
                {l}
              </option>
            ))}
            {p.keep_in_touch_days && !KIT.some(([d]) => d === p.keep_in_touch_days) ? (
              <option value={p.keep_in_touch_days}>Every {p.keep_in_touch_days} days</option>
            ) : null}
          </Select>
          {p.keep_in_touch_days && p.next_due ? <span className="text-muted"> · next {fmtDate(parseDayKey(p.next_due))}</span> : null}
        </Info>
        {p.how_met && (
          <Info icon="users" label="How we met" className={preWrap}>
            {p.how_met}
          </Info>
        )}
        {p.linked_user && (
          <Info icon="user" label="Account">
            {p.linked_user.name} <span className="text-muted">@{p.linked_user.username}</span>
          </Info>
        )}
        {profiles.length > 0 && (
          <Info icon="link" label="Profiles" className="flex flex-wrap gap-1">
            {profiles.map((l) =>
              l.href ? (
                <a
                  key={l.network + l.handle}
                  className={chipClass({ tone: 'content', interactive: true })}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={l.url ?? undefined}
                >
                  {l.label} <span className="text-muted">{l.handle}</span>
                  <Icon name="external" size={11} />
                </a>
              ) : (
                <Chip key={l.network + l.handle} title="No public profile link">
                  {l.label}: {l.handle}
                </Chip>
              ),
            )}
          </Info>
        )}
      </dl>
      {p.notes && (
        <div className="grid gap-2">
          <SectionLabel>Notes</SectionLabel>
          <p className={cn(preWrap, 'text-sm')}>{p.notes}</p>
        </div>
      )}
      <Relationships person={p} onOpen={onOpen} />
      <Interactions person={p} />
      <p className="border-t border-border pt-2 text-xs text-muted">
        Added {shortStamp(p.created_on)} · updated {shortStamp(p.updated_on)}
        {importedFrom.length ? ` · imported from ${importedFrom.join(', ')}` : ''}
      </p>
      <Confirm
        open={confirm}
        title={`Delete ${p.name || 'this contact'}?`}
        body="Their interactions and relationships are deleted too."
        onConfirm={() => {
          onClose()
          remove.mutate(p.id, { onSuccess: () => toast.show('Contact deleted') })
        }}
        onClose={() => setConfirm(false)}
      />
    </section>
  )
}

/** One row of the definition list: icon and label on the left (above on phones), the value on the right. */
function Info({ icon, label, className, children }: { icon: IconName; label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 border-b border-border py-2 text-sm max-md:grid-cols-1 max-md:gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted capitalize">
        <Icon name={icon} size={14} />
        {label}
      </dt>
      <dd className={cn('m-0 wrap-anywhere', className)}>{children}</dd>
    </div>
  )
}
