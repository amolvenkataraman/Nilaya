// Settings › Devices: the phones signed in to Nilaya's phone apps, which apps each one uses, and signing one out
// (a lost phone). Phones sign themselves in from the app, so there is nothing to create here.
import { useState } from 'react'
import { Button, cardClass, Chip, Confirm, EmptyState, QueryView, SettingsSection, SkeletonRows } from '../../components/ui'
import { shortStamp } from '../../lib/dates'
import { day } from './ApiKeys'
import { type Device, useDevices, useKeyApps, useSignOutDevice } from './api'
import { ItemRow } from './ItemRow'

export function DevicesSection() {
  const devices = useDevices()
  const apps = useKeyApps()
  const label = (app: string) => apps.data?.find((a) => a.app === app)?.label ?? app
  return (
    <SettingsSection
      id="set-devices"
      title="Devices"
      description="Phones signed in to Nilaya's phone apps. Sign out a phone you no longer use or have lost: its apps stop working until someone signs in on it again."
    >
      <div className={cardClass}>
        <QueryView
          query={devices}
          skeleton={<SkeletonRows rows={2} />}
          isEmpty={(d) => !d.length}
          empty={<EmptyState>No phones signed in. Sign in from a Nilaya phone app and it shows up here.</EmptyState>}
        >
          {(list) => list.map((d) => <DeviceRow key={d.id} d={d} label={label} />)}
        </QueryView>
      </div>
    </SettingsSection>
  )
}

function DeviceRow({ d, label }: { d: Device; label: (app: string) => string }) {
  const [confirm, setConfirm] = useState(false)
  const signOut = useSignOutDevice(d)
  return (
    <ItemRow
      icon="smartphone"
      title={<span className="truncate">{d.name}</span>}
      meta={
        <>
          <span>Signed in {day(d.created_on)}</span>
          <span>{d.last_used_on ? `Last used ${shortStamp(d.last_used_on)}` : 'Never used'}</span>
        </>
      }
      actions={
        <>
          <Button size="sm" disabled={signOut.isPending} onClick={() => setConfirm(true)}>
            Sign out
          </Button>
          <Confirm
            open={confirm}
            title={`Sign out ${d.name}?`}
            body="Its apps stop syncing and ask to sign in again. Nothing is deleted from the phone or from Nilaya."
            confirmLabel="Sign out"
            onConfirm={() => signOut.mutate()}
            onClose={() => setConfirm(false)}
          />
        </>
      }
    >
      {d.apps.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.apps.map((a) => (
            <Chip key={a} size="sm">
              {label(a)}
            </Chip>
          ))}
        </div>
      )}
    </ItemRow>
  )
}
