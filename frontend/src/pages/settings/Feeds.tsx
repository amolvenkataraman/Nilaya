// Settings › Calendar feeds: private ICS addresses for phone calendar apps. A new address is shown once.
import { useState } from 'react'
import { Button, Confirm, EmptyState, Menu, MenuItem, QueryView, Select, SkeletonRows } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { shortStamp } from '../../lib/dates'
import { plural } from '../../lib/format'
import { type Feed, useCreateFeed, useFeeds, useRevokeFeed } from './api'
import { day } from './ApiKeys'
import { cardClass } from './Card'
import { Chip } from './Chip'
import { ItemRow } from './ItemRow'
import { SecretBox } from './SecretBox'
import { SettingRow, SettingsSection, settingControl } from './SettingsSection'

const FEED_KINDS = { calendar: 'Calendar events', tasks: 'Tasks with due dates' } as const

export function FeedsSection() {
  const feeds = useFeeds()
  const [kind, setKind] = useState<Feed['kind']>('calendar')
  const [created, setCreated] = useState<{ url: string; name: string } | null>(null) // shown once
  const create = useCreateFeed(setCreated)
  return (
    <SettingsSection
      id="set-feeds"
      title="Calendar feeds"
      description={
        <>
          Private addresses to subscribe to from your phone's calendar app (iOS: Settings → Calendar → Accounts → Add subscribed calendar;
          Google Calendar: Add by URL). Anyone with the address can read the feed, so revoke it if it leaks.
        </>
      }
    >
      <div className={cardClass}>
        <SettingRow label="New feed" htmlFor="feed-kind" inline>
          <Select id="feed-kind" className={settingControl} value={kind} onChange={(e) => setKind(e.target.value as Feed['kind'])}>
            {Object.entries(FEED_KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={create.isPending}
            onClick={() => create.mutate({ kind, name: kind === 'tasks' ? 'Tasks' : 'Calendar' })}
          >
            <Icon name="plus" size={14} />
            Create
          </Button>
        </SettingRow>
        {created && (
          <div data-set-row="" className="grid gap-2 border-t border-border bg-accent-soft px-4 py-3" role="status">
            <div className="text-sm">
              <strong>{created.name}</strong> feed address. Copy it now: it's only shown once.
            </div>
            <SecretBox value={created.url} label="Feed address" />
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setCreated(null)}>
              Hide
            </Button>
          </div>
        )}
        <QueryView
          query={feeds}
          skeleton={<SkeletonRows rows={2} />}
          isEmpty={(d) => !d.length}
          empty={<EmptyState className="border-t border-border">No feeds yet.</EmptyState>}
        >
          {(list) =>
            list.map((f) => (
              <FeedRow
                key={f.id}
                f={f}
                busy={create.isPending}
                onRegenerate={() => create.mutate({ kind: f.kind, name: f.name, replace: f })}
              />
            ))
          }
        </QueryView>
      </div>
    </SettingsSection>
  )
}

function FeedRow({ f, busy, onRegenerate }: { f: Feed; busy: boolean; onRegenerate: () => void }) {
  const [confirm, setConfirm] = useState<'revoke' | 'regen' | null>(null)
  const revoke = useRevokeFeed(f)
  return (
    <ItemRow
      icon={f.kind === 'tasks' ? 'tasks' : 'calendar'}
      title={
        <>
          <span className="truncate">{FEED_KINDS[f.kind] ?? f.kind}</span>
          {f.name && <Chip>{f.name}</Chip>}
        </>
      }
      meta={
        <>
          <span>Created {day(f.created_on)}</span>
          <span>
            {f.last_fetched_on ? `Last fetched ${shortStamp(f.last_fetched_on)} · ${plural(f.fetches, 'time')}` : 'Never fetched'}
          </span>
        </>
      }
      actions={
        <>
          <Menu
            align="end"
            trigger={(p) => (
              <Button {...p} variant="ghost" size="sm" icon aria-label="Feed actions" disabled={busy}>
                <Icon name="more" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon="refresh"
                  onClick={() => {
                    close()
                    setConfirm('regen')
                  }}
                >
                  New address
                </MenuItem>
                <MenuItem
                  icon="trash"
                  danger
                  onClick={() => {
                    close()
                    setConfirm('revoke')
                  }}
                >
                  Revoke
                </MenuItem>
              </>
            )}
          </Menu>
          <Confirm
            open={confirm !== null}
            title={confirm === 'regen' ? 'Make a new address?' : 'Revoke this feed?'}
            body={
              confirm === 'regen'
                ? "The current address stops working; you'll need to subscribe again with the new one."
                : 'Calendar apps subscribed to it stop getting updates.'
            }
            confirmLabel={confirm === 'regen' ? 'New address' : 'Revoke'}
            onConfirm={() => (confirm === 'regen' ? onRegenerate() : revoke.mutate())}
            onClose={() => setConfirm(null)}
          />
        </>
      }
    />
  )
}
