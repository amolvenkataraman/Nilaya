// Notifications › Delivery channels: where notifications go besides the bell (ntfy, Gotify, email, Discord,
// webhooks). Each row shows the destination, the minimum priority, the last delivery or error, and a test.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon, type IconName } from '../../components/Icon'
import {
  Button,
  cardClass,
  Chip,
  Confirm,
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  QueryView,
  Select,
  SettingsSection,
  SkeletonRows,
  Switch,
} from '../../components/ui'
import { cn } from '../../lib/cn'
import { shortStamp } from '../../lib/dates'
import type { Channel, ChannelType } from '../../lib/types'
import { ItemRow } from '../settings/ItemRow'
import { channelsQuery, channelTypesQuery, MIN_PRIORITY, useChannelPatch, useDeleteChannel, useTestChannel } from './api'
import { ChannelDialog } from './ChannelDialog'

const KIND_ICON: Record<string, IconName> = { ntfy: 'send', gotify: 'send', email: 'mail', discord: 'comment', webhook: 'link' }
const priorityLabel = (p: number) => MIN_PRIORITY.find((x) => x.value === p)?.label ?? `Priority ${p}+`

export function ChannelsTab() {
  const channels = useQuery(channelsQuery())
  const types = useQuery(channelTypesQuery()).data
  const [editing, setEditing] = useState<Channel | 'new' | null>(null)
  // Short chip label: "Webhook (JSON, e.g. Home Assistant)" -> "Webhook"
  const label = (kind: string) => (types?.find((t) => t.kind === kind)?.label ?? kind).replace(/\s*\(.*\)$/, '')
  return (
    <SettingsSection
      page
      title="Delivery channels"
      description="Where notifications are sent besides the bell: your phone, email, chat or a webhook."
      actions={
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} />
          Add channel
        </Button>
      }
    >
      <div className="grid gap-2">
        <QueryView
          query={channels}
          skeleton={
            <div className={cardClass}>
              <SkeletonRows rows={3} avatar />
            </div>
          }
          isEmpty={(d) => !d.length}
          empty={
            <div className={cardClass}>
              <EmptyState>No channels yet. Notifications only show in the bell.</EmptyState>
            </div>
          }
        >
          {(list) => list.map((c) => <ChannelRow key={c.id} c={c} types={types} kindLabel={label(c.kind)} onEdit={() => setEditing(c)} />)}
        </QueryView>
      </div>
      {editing && types && <ChannelDialog channel={editing === 'new' ? null : editing} types={types} onClose={() => setEditing(null)} />}
    </SettingsSection>
  )
}

/** The first non-secret setting that's filled in: a topic URL, an address. */
function destination(c: Channel, types?: ChannelType[]): string {
  const fields = types?.find((t) => t.kind === c.kind)?.fields ?? []
  const pub = fields.find((f) => !f.secret && c.config[f.key])
  return pub ? String(c.config[pub.key]) : ''
}

function ChannelRow({ c, types, kindLabel, onEdit }: { c: Channel; types?: ChannelType[]; kindLabel: string; onEdit: () => void }) {
  const update = useChannelPatch()
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const test = useTestChannel(c, setResult)
  const remove = useDeleteChannel(c)
  const dest = destination(c, types)
  const status = (ok: boolean, text: string, live: boolean) => (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 max-md:items-start [&>svg]:shrink-0 max-md:[&>svg]:mt-0.75',
        ok ? 'text-success' : 'text-danger',
      )}
      role={live ? 'status' : undefined}
      title={live ? undefined : text}
    >
      <Icon name={ok ? 'check' : 'alert'} size={12} />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap max-md:whitespace-normal max-md:wrap-anywhere">{text}</span>
    </span>
  )
  return (
    <ItemRow
      variant="card"
      icon={KIND_ICON[c.kind] ?? 'bell'}
      off={!c.enabled}
      title={
        <>
          <span className="truncate">{c.name}</span>
          <Chip>{kindLabel}</Chip>
        </>
      }
      sub={
        dest && (
          <div className="truncate font-mono text-xs text-muted" title={dest}>
            {dest}
          </div>
        )
      }
      meta={
        <>
          <Chip size="sm">{priorityLabel(c.min_priority)}</Chip>
          <span className="max-md:whitespace-nowrap">{c.last_sent_at ? `Last sent ${shortStamp(c.last_sent_at)}` : 'Never sent'}</span>
          {result && status(result.ok, result.text, true)}
          {c.last_error && !result && status(false, c.last_error, false)}
        </>
      }
      actions={
        <>
          <Select
            size="sm"
            width="content"
            className="max-md:flex-1"
            aria-label={`Minimum priority for ${c.name}`}
            value={c.min_priority}
            onChange={(e) => update.mutate({ id: c.id, body: { min_priority: Number(e.target.value) } })}
          >
            {!MIN_PRIORITY.some((p) => p.value === c.min_priority) && <option value={c.min_priority}>Priority {c.min_priority}+</option>}
            {MIN_PRIORITY.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending || !c.enabled}>
            {test.isPending ? 'Sending…' : 'Test'}
          </Button>
          <span className="inline-flex" title={c.enabled ? 'Enabled' : 'Disabled'}>
            <Switch checked={c.enabled} onChange={(v) => update.mutate({ id: c.id, body: { enabled: v } })} ariaLabel="Enabled" />
          </span>
          <Menu
            align="end"
            label={`${c.name} actions`}
            trigger={(p) => (
              <Button {...p} variant="ghost" size="sm" icon aria-label={`More actions for ${c.name}`}>
                <Icon name="moreV" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon="edit"
                  onClick={() => {
                    close()
                    onEdit()
                  }}
                >
                  Edit
                </MenuItem>
                <MenuItem
                  icon="send"
                  onClick={() => {
                    close()
                    test.mutate()
                  }}
                >
                  Send test
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
                  Delete
                </MenuItem>
              </>
            )}
          </Menu>
          <Confirm
            open={confirm}
            title={`Delete "${c.name}"?`}
            body="Notifications will no longer be delivered here."
            onConfirm={() => remove.mutate()}
            onClose={() => setConfirm(false)}
          />
        </>
      }
    />
  )
}
