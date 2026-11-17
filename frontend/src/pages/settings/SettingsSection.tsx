// The settings layout shared by Settings and Notifications: a titled section (heading, one-line description,
// actions on the right) over a card of hairline-separated rows, each a label with an optional hint and its
// control. Rows separate with a top border only when they follow another row, so a header block or a hidden
// input before the first row doesn't add a line.
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '../../lib/cn'
import { Icon } from '../../components/Icon'

/** The page column's padding and centring (the old `.page`); pages add their max width (Settings 52rem). */
export const pageClass = 'mx-auto w-full px-6 pt-5 pb-8 max-md:px-4 max-md:pt-3.5 max-md:pb-6'

export function SettingsSection({
  id,
  title,
  description,
  actions,
  page = false,
  children,
}: {
  /** The heading's id: the sidebar scrolls to it and the section is labelled by it. */
  id?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** The page's main heading (h1, larger), as in Notifications; else an h2. */
  page?: boolean
  children: ReactNode
}) {
  const Heading = page ? 'h1' : 'h2'
  return (
    <section className="mb-7 grid scroll-mt-15 gap-2.5" aria-labelledby={id}>
      <SectionHead>
        <div className={cn('min-w-0 flex-1', actions && 'max-md:basis-full')}>
          <Heading id={id} className={page ? 'text-lg font-semibold' : 'text-base font-semibold'}>
            {title}
          </Heading>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions}
      </SectionHead>
      {children}
    </section>
  )
}

/** The heading row on its own, for pages that lay out their body differently (Usage). */
export function SectionHead({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-end gap-3 max-md:flex-wrap max-md:items-start', className)}>{children}</div>
}

/** Marks a row so the next one draws the separator (see the file comment). */
const ROW = 'data-set-row'
const afterRow = '[[data-set-row]+&]:border-t [[data-set-row]+&]:border-border'

/** A label (with a hint under it) and its control. `align="top"` for tall controls; `inline` keeps the control
 *  beside the label on phones (switches, short selects); `control` lays out the control column. */
export function SettingRow({
  label,
  hint,
  htmlFor,
  align = 'center',
  inline = false,
  control = 'end',
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  htmlFor?: string
  align?: 'center' | 'top'
  inline?: boolean
  /** end: right-aligned; fill: the control takes the column; col: stacked (a field and its message). */
  control?: 'end' | 'fill' | 'col'
  children: ReactNode
}) {
  const labelClass = 'grid gap-0.5 text-sm font-medium'
  const hintEl = hint && <small className="text-xs font-normal text-muted">{hint}</small>
  return (
    <div
      {...{ [ROW]: '' }}
      className={cn(
        'grid min-h-13 grid-cols-[minmax(10rem,15rem)_minmax(0,1fr)] gap-4 px-4 py-3 max-md:gap-2',
        align === 'top' ? 'items-start' : 'items-center',
        inline ? 'max-md:grid-cols-[minmax(0,1fr)_auto]' : 'max-md:grid-cols-1',
        afterRow,
      )}
    >
      {htmlFor ? (
        <label className={labelClass} htmlFor={htmlFor}>
          {label}
          {hintEl}
        </label>
      ) : (
        <span className={labelClass}>
          {label}
          {hintEl}
        </span>
      )}
      <div
        className={cn(
          'flex min-w-0 gap-2',
          control === 'end' && cn('items-center justify-end', !inline && 'max-md:justify-start'),
          control === 'fill' && 'items-center *:flex-1',
          control === 'col' && 'flex-col items-stretch gap-1',
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** A read-only value in a row's control column. */
export function SettingValue({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-right text-sm wrap-anywhere text-muted max-md:text-left', className)}>{children}</span>
}

/** A select or time input in a row: as wide as its content (at least 12rem) beside the label, full width on
 *  phones. `!` because fieldClass sets w-full. */
export const settingControl = 'md:w-auto! md:min-w-48'

/** Segmented's buttons keep the browser's border and grey background without the old stylesheet (there's no
 *  preflight); pass as its className until components/ui/controls.tsx resets them itself. */
export const segmentedReset = '*:border-0 *:aria-[pressed=false]:bg-transparent'
/** The same for SearchBox's input (it keeps the browser's inset border). */
export const searchBoxReset = '[&_input]:border-0 [&_input]:p-0'

/** The card's foot: a status on the left, buttons on the right. */
export function SettingsFoot({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 rounded-b-md border-t border-border bg-bg px-4 py-2.5">{children}</div>
}

/** "Saving…", "Saved", an error: small and coloured by tone. */
export function SaveStatus({ tone, alert, children }: { tone?: 'ok' | 'err'; alert?: boolean; children?: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        tone === 'ok' ? 'text-success' : tone === 'err' ? 'text-danger' : 'text-muted',
      )}
      role={alert ? 'alert' : 'status'}
      aria-live={alert ? undefined : 'polite'}
    >
      {children}
    </span>
  )
}

/** "Saved" with a check, for settings that save as they change. */
export function SavedMark() {
  return (
    <>
      <Icon name="check" size={12} />
      Saved
    </>
  )
}

/** A row that goes somewhere: icon, label, a muted note on the right. External links get an arrow. */
export function SettingLink({ icon, label, note, to, href }: { icon: string; label: string; note: string; to?: string; href?: string }) {
  const className = cn(
    'flex items-center gap-2.5 px-4 py-3 text-sm text-fg first:rounded-t-md last:rounded-b-md hover:bg-hover hover:no-underline',
    '[&>svg]:shrink-0 [&>svg]:text-muted',
    '[[data-set-row]+&]:border-t [[data-set-row]+&]:border-border',
  )
  const inner = (
    <>
      <Icon name={icon} />
      <span>{label}</span>
      <span className="ml-auto text-sm text-muted">{note}</span>
      {href && <Icon name="external" size={14} />}
    </>
  )
  return href ? (
    <a {...{ [ROW]: '' }} className={className} href={href}>
      {inner}
    </a>
  ) : (
    <Link {...{ [ROW]: '' }} className={className} to={to ?? '/'}>
      {inner}
    </Link>
  )
}
