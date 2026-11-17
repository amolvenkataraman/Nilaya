// The temporary display zone, shown while it's on: "Tokyo · GMT+9", click to change, × to go home.
import { Icon } from '../../components/Icon'
import { cn } from '../../lib/cn'
import { HOME_ZONE, gmtLabel, zoneCity } from './zone'

const part =
  'inline-flex cursor-pointer items-center gap-1.5 bg-transparent whitespace-nowrap text-current hover:bg-[color-mix(in_srgb,currentColor_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

export function ZoneChip({
  tz,
  now,
  onOpen,
  onReset,
  inTopbar,
}: {
  tz: string
  now: Date
  onOpen: () => void
  onReset: () => void
  /** Beside the title: "Back to …" only with room to spare (2xl); elsewhere (strip, phone bar) in full. */
  inTopbar?: boolean
}) {
  const home = zoneCity(HOME_ZONE)
  return (
    // biome-ignore lint/a11y/useSemanticElements: two buttons about one thing, not a form group
    <span
      className={cn(
        'inline-flex h-7 flex-none items-stretch justify-self-start rounded-full bg-accent-soft text-sm text-accent',
        inTopbar && 'ml-2',
      )}
      role="group"
      aria-label="Display time zone"
    >
      <button
        type="button"
        className={cn(part, 'rounded-l-full border-0 pr-1.5 pl-2.5')}
        onClick={onOpen}
        title={`Times are shown in ${tz} (${gmtLabel(now.getTime(), tz)}), for this window only. Click to change.`}
      >
        <Icon name="globe" size={14} />
        <span>{zoneCity(tz)}</span>
        <span className="font-medium tabular-nums opacity-80">{gmtLabel(now.getTime(), tz)}</span>
      </button>
      <button
        type="button"
        className={cn(
          part,
          'rounded-r-full border-y-0 border-r-0 border-l border-solid border-l-[color-mix(in_srgb,currentColor_25%,transparent)] pr-2.5 pl-2',
          inTopbar && 'max-2xl:pr-2 max-2xl:pl-1.5',
        )}
        onClick={onReset}
        aria-label={`Back to ${home}`}
        title={`Back to ${home} (${gmtLabel(now.getTime(), HOME_ZONE)})`}
      >
        <span className={cn(inTopbar && 'max-2xl:hidden')}>Back to {home}</span>
        <Icon name="x" size={13} />
      </button>
    </span>
  )
}
